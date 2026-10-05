"""Independent complete read-payload equivalence on nonempty synthetic SQLite."""
import os,sys,json,sqlite3,subprocess,importlib.util,hashlib,secrets
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.git').exists());OUT=ROOT/'.runtime/market-independent-20261005';SOURCE=ROOT/'.runtime/preview/demo-1791212224923-ee9514f1.sqlite3';DB=OUT/('nonempty-equivalence-'+secrets.token_hex(4)+'.sqlite3')
assert not DB.exists()
with sqlite3.connect(SOURCE) as s,sqlite3.connect(DB) as t:s.backup(t)
for k in list(os.environ):
    if k.upper().startswith(('TERUISI_','DJANGO_','PG','AI_','OPENAI_','ARK_','OLLAMA_')):os.environ.pop(k)
os.environ.update(TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_SQLITE_PATH=str(DB),DJANGO_SETTINGS_MODULE='teruisi_backend.settings');sys.path.insert(0,str(ROOT/'backend'))
import django;django.setup()
from market import query,admin
from market.models import MarketRankingEntry,MarketPriceSnapshot
from django.db import connection
from django.test.utils import CaptureQueriesContext
from sales.auth import Principal
baseline='bab42d8ce836b4ee9acd82e80de085ff71f9f494'
def load(name,path):
    dest=OUT/('baseline-'+name+'.py');dest.write_bytes(subprocess.check_output(['git','show',baseline+':'+path],cwd=ROOT))
    spec=importlib.util.spec_from_file_location('market.independent_'+name,dest);mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod);return mod
bq=load('query','backend/market/query.py');ba=load('admin','backend/market/admin.py');bm=load('master_query','backend/market/master_query.py');ba.item_trend=bq.item_trend;ba.master_page=bm.master_page
principal=Principal('fixture@example.invalid','Synthetic','admin',None)
def sales(_p,req):return {'rows':[{'productCode':c,'owned':False,'ownSalesCents':0} for c in req['productCodes']]},'1:synthetic'
checks=[]
def same(name,left,right):
    assert left==right,name+' differs'
    checks.append({'name':name,'sha256':hashlib.sha256(json.dumps(right,sort_keys=True,ensure_ascii=False,default=str).encode()).hexdigest()})
for view in ('ranking','full'):
    for n,filters in enumerate(({}, {'categories':['演示净水设备']},{'categories':['演示净水设备','演示厨房设备'],'startDate':'2026-10-01','endDate':'2026-10-04'})):
        for page in ((1,2) if view=='ranking' else (1,)):
            req={'operation':'overview','view':view,'page':page,'pageSize':20,'filters':filters,'includeFilterOptions':False}
            same(f'{view}-scope{n}-page{page}',bq.overview(principal,req,sales_loader=sales),query.overview(principal,req,sales_loader=sales))
for view in ('settings_status','database_primary','database_filters','database_secondary','system_kpis'):
    req={'operation':'master','view':view,'params':{}}
    same(view,ba.execute_master_query(req),admin.execute_master_query(req))
for section in ('subcategory','brand','mapping','data'):
    for params in ({'section':section},{'section':section,'category':'演示净水设备','page':2,'pageSize':10}):
        same(f'workspace-{section}-{params.get("page",1)}',ba.master_workspace(params),admin.master_workspace(params))
for pending in (False,True):
    for scope in ({},{'q':'not-existing'},{'categories':['演示净水设备']},{'categories':['演示净水设备','演示厨房设备']},{'priceStatuses':['confirmed']},{'priceStatuses':['pending']},{'candidatePriceSources':['ai']},{'candidatePriceSources':['non_ai']},{'annotationStatuses':['pending']},{'includeHistory':True}):
        for page in (1,2,10000):
            params={**scope,'page':page,'pageSize':10}
            before=ba.list_master(params,pending=pending)
            with CaptureQueriesContext(connection) as captured:after=admin.list_master(params,pending=pending)
            same(f'master-pending{pending}-{scope}-page{page}',before,after)
            assert sum('WITH source AS' in q['sql'] for q in captured)==1
first=list(MarketRankingEntry.objects.order_by('id')[:2]);selections=[{'category':r.category,'scope':r.scope,'skuCode':r.sku_code,'rankingDimension':r.ranking_dimension} for r in first]
same('compare-two-identities',ba.comparison({'selections':selections}),admin.comparison({'selections':selections}))
empty_scope=admin.comparison({'selections':selections,'startDate':'2000-01-01','endDate':'2000-01-31'})
excluded_category=admin.comparison({'selections':selections,'categories':['no-existing-category']})
assert len(excluded_category['items'])==2
assert len(empty_scope['items'])==2,'Documented existing comparison scope gap changed'
compare_gap={'emptyDateRangeReturnedItems':len(empty_scope['items']),'categoryExcludedReturnedItems':len(excluded_category['items']),'baselineBehaviorPreserved':True}
req={'operation':'trend',**selections[0]};same('trend-formal-price',bq.item_trend(req),query.item_trend(req))
report={'baseline':baseline,'baselineMasterBoundSeparately':True,'singleCTEPerMasterRead':True,'knownCompareScopeGap':compare_gap,'database':str(DB.relative_to(ROOT)),'checks':checks,'count':len(checks),'allDeepEquivalent':True,'synthetic':True,'productionTouched':False,'externalCalls':0,'performanceClaim':False}
(OUT/'nonempty-equivalence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'count':len(checks),'allDeepEquivalent':True}))


