"""Independent disposable in-memory correctness checks; no timing claims."""
import os,sys,json,subprocess,importlib.util
from pathlib import Path
ROOT=next(parent for parent in Path(__file__).resolve().parents if (parent/'.git').exists())
OUT=ROOT/'.runtime/market-independent-20261005'
OUT.mkdir(parents=True,exist_ok=True)
for name in list(os.environ):
    if name.upper().startswith(('TERUISI_','DJANGO_','PG','AI_','OPENAI_','ARK_','OLLAMA_')): os.environ.pop(name)
os.environ.update(TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_SQLITE_PATH=':memory:',DJANGO_SETTINGS_MODULE='teruisi_backend.settings')
sys.path.insert(0,str(ROOT/'backend'))
import django
django.setup()
from django.db import connection
from django.test.utils import CaptureQueriesContext
from market import query,admin
from market.models import MarketRankingEntry,MarketPriceSnapshot,MarketImageCache,MarketDataRevision
with connection.schema_editor() as schema:
    for model in (MarketRankingEntry,MarketPriceSnapshot,MarketImageCache,MarketDataRevision):schema.create_model(model)
baseline='bab42d8ce836b4ee9acd82e80de085ff71f9f494'
path=OUT/'baseline-query.py'
path.write_bytes(subprocess.check_output(['git','show',baseline+':backend/market/query.py'],cwd=ROOT))
spec=importlib.util.spec_from_file_location('market.independent_baseline',path)
reference=importlib.util.module_from_spec(spec);sys.modules[spec.name]=reference;spec.loader.exec_module(reference)
from datetime import date,timedelta
rows=[]
for month in range(70):
    year=2020+month//12;m=1+month%12
    for day in (1,15,25):
      for price_filter in ('全部','0-100',''):
        stamp=f'{year}-{m:02d}-{day:02d}'
        rows.append(MarketRankingEntry(natural_key=f'{month}-{day}-{price_filter}',period_start=stamp,period_end=stamp,category='独立验证',scope='pop',ranking_dimension='SKU',sku_code='100001',quantity=day,gmv_cents=day*1000,price_band_filter=price_filter,raw_json={'large':'x'*4096},last_import_batch_id='synthetic',source_row_number=1))
MarketRankingEntry.objects.bulk_create(rows)
MarketRankingEntry.objects.create(natural_key='other',period_start='2026-01-01',period_end='2026-01-01',category='同码异类',scope='pop',ranking_dimension='SKU',sku_code='100001',last_import_batch_id='synthetic',source_row_number=1)
request=dict(operation='trend',skuCode='100001',category='独立验证',scope='pop',rankingDimension='SKU')
old=reference.item_trend(request)
with CaptureQueriesContext(connection) as captured:new=query.item_trend(request)
assert old==new
assert new['totalMonths']==70 and len(new['items'])==60 and new['truncated'] is True
fact_queries=[q['sql'] for q in captured if 'market_ranking_entries' in q['sql']]
assert any('LIMIT 60' in sql for sql in fact_queries)
assert all('raw_json' not in sql for sql in fact_queries)
filters=query.normalize_filters({'categories':['独立验证']}) if hasattr(query,'normalize_filters') else None
# Public parser spelling can evolve; bind preferred-row query through existing fixture defaults.
filters={name:[] for name in ('categories','scopes','brands','rankingDimensions','operationModes','subcategories','priceBands')}
filters.update(categories=['独立验证'],startDate=None,endDate=None,q='')
before=reference._preferred_rows(filters);after=query._preferred_rows(filters)
assert [r.id for r in before]==[r.id for r in after]
assert len(after)==210
comparison_request={'selections':[{'skuCode':'100001','category':'独立验证','scope':'pop','rankingDimension':'SKU'},{'skuCode':'100001','category':'同码异类','scope':'pop','rankingDimension':'SKU'}]}
comparison=admin.comparison(comparison_request)
admin_path=OUT/'baseline-admin.py';admin_path.write_bytes(subprocess.check_output(['git','show',baseline+':backend/market/admin.py'],cwd=ROOT))
admin_spec=importlib.util.spec_from_file_location('market.independent_baseline_admin',admin_path);baseline_admin=importlib.util.module_from_spec(admin_spec);sys.modules[admin_spec.name]=baseline_admin;admin_spec.loader.exec_module(baseline_admin);baseline_admin.item_trend=reference.item_trend
assert baseline_admin.comparison(comparison_request)==comparison
raw_compare_gmv=comparison['items'][0]['gmvCents'];preferred_gmv=sum(r.gmv_cents for r in after)
assert raw_compare_gmv==3*preferred_gmv
compare_duplicate_gap={'rawCompareGmvCents':raw_compare_gmv,'preferredGmvCents':preferred_gmv,'rawSourceMultiplier':3,'preexistingBehavior':True}
for status in ('ready','ready','failed','pending','queued','unknown'):
    MarketImageCache.objects.create(source_url='synthetic:'+str(MarketImageCache.objects.count()),status=status)
assert admin._image_summary()=={'total':6,'cached':2,'failed':1,'pending':3}
from market.filter_cache import cached_filters,FilterCache
from django.db import transaction
from unittest.mock import patch
MarketDataRevision.objects.create(domain='market',revision=1,source_digest='a'*64)
store=query._image_total_cache
count_calls=[]
def count_images():
    count_calls.append(1)
    return MarketRankingEntry.objects.exclude(image_url='').order_by().values('image_url').distinct().count()
assert cached_filters(count_images,cache_store=store)==0
assert cached_filters(count_images,cache_store=store)==0 and len(count_calls)==1
with transaction.atomic():
    MarketRankingEntry.objects.filter(pk=rows[0].pk).update(image_url='synthetic:first')
    assert cached_filters(count_images,cache_store=store)==1
    transaction.set_rollback(True)
assert cached_filters(count_images,cache_store=store)==0 and len(count_calls)==2
MarketRankingEntry.objects.filter(pk=rows[0].pk).update(image_url='synthetic:first')
MarketDataRevision.objects.filter(domain='market').update(revision=2,source_digest='b'*64)
assert cached_filters(count_images,cache_store=store)==1 and len(count_calls)==3
MarketImageCache.objects.filter(status='pending').update(status='ready')
assert cached_filters(count_images,cache_store=store)==1 and len(count_calls)==3
assert admin._image_summary()['cached']==3
with patch('market.filter_cache.settings.MARKET_WRITE_AUTHORITY_EPOCH','independent-next-epoch'):
    assert cached_filters(count_images,cache_store=store)==1 and len(count_calls)==4
from concurrent.futures import ThreadPoolExecutor
from threading import Event
entered=Event();release=Event();calls=[];concurrent=FilterCache(maximum_bytes=256)
def slow():
    calls.append(1);entered.set();assert release.wait(3);return 7
with ThreadPoolExecutor(max_workers=3) as pool:
    first=pool.submit(concurrent.read,('synthetic','rev'),slow,lambda:'rev');assert entered.wait(3)
    followers=[pool.submit(concurrent.read,('synthetic','rev'),slow,lambda:'rev') for _ in range(2)]
    release.set();assert [f.result() for f in [first,*followers]]==[7,7,7]
assert len(calls)==1
failed=FilterCache(maximum_bytes=256)
def failing():raise ValueError('synthetic-failure')
try:failed.read(('db','rev'),failing,lambda:'rev')
except ValueError:pass
try:failed.read(('db','rev'),lambda:999,lambda:'rev')
except query.MarketApiError:pass
else:raise AssertionError('failure backoff was bypassed')
assert failed.entry is None
report={'baseline':baseline,'rows':631,'trendFullDeepEquivalent':True,'trendMonths':70,'windowRows':60,'preferredIdentityEquivalent':True,'preferredRows':210,'knownCompareRawSourceGap':compare_duplicate_gap,'imageGroupedEquivalent':True,'imageScalarCacheRevisionTransactionStateAuthority':True,'scalarConcurrentSingleLoader':True,'scalarFailureBackoff':True,'factQueries':fact_queries,'database':'SQLite in-memory only','productionTouched':False,'performanceClaim':False}
(OUT/'equivalence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False))
