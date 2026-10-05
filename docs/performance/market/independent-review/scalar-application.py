"""Independent actual overview wiring against a copy of synthetic preview SQLite."""
import os,sys,json,sqlite3
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.git').exists());OUT=ROOT/'.runtime/market-independent-20261005'
SOURCE=ROOT/'.runtime/preview/demo-1791212224923-ee9514f1.sqlite3';DB=OUT/'scalar-application.sqlite3'
assert SOURCE.is_file() and SOURCE.resolve().is_relative_to((ROOT/'.runtime/preview').resolve())
assert not DB.exists(),'Each run needs its own fresh copy'
with sqlite3.connect(SOURCE) as source,sqlite3.connect(DB) as target:source.backup(target)
for key in list(os.environ):
    if key.upper().startswith(('TERUISI_','DJANGO_','PG','AI_','OPENAI_','ARK_','OLLAMA_')):os.environ.pop(key)
os.environ.update(TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_SQLITE_PATH=str(DB),DJANGO_SETTINGS_MODULE='teruisi_backend.settings');sys.path.insert(0,str(ROOT/'backend'))
import django;django.setup()
from django.db import connection,transaction
from django.test.utils import CaptureQueriesContext
from market import query
from market.filter_cache import FilterCache
from market.models import MarketRankingEntry,MarketImageCache,MarketDataRevision
from sales.auth import Principal
principal=Principal('independent@example.invalid','Synthetic','admin',None)
def sales(_p,req):return {'rows':[{'productCode':c,'owned':False,'ownSalesCents':0} for c in req['productCodes']]},'1:synthetic'
def read():return query.overview(principal,{'operation':'overview','view':'ranking','page':1,'pageSize':20,'filters':{},'includeFilterOptions':False},sales_loader=sales)
query._image_total_cache=FilterCache(maximum_bytes=256)
first=read();total=first['imageCache']['total'];assert total==1
source_url=MarketRankingEntry.objects.first().image_url
MarketImageCache.objects.create(source_url=source_url,status='ready',content_sha256='a'*64)
with CaptureQueriesContext(connection) as captured:second=read()
assert second['imageCache']['total']==1 and second['imageCache']['cached']==1
assert not any('SELECT DISTINCT' in q['sql'] and 'image_url' in q['sql'] for q in captured)
def add():return MarketRankingEntry.objects.create(natural_key='independent-added',source_row_number=1000,period_start='2026-10-01',period_end='2026-10-04',category='演示净水设备',scope='全部',sku_code='independent-add',image_url='data:image/svg+xml,synthetic-second',last_import_batch_id='synthetic-only')
with transaction.atomic():
    add();assert read()['imageCache']['total']==2;transaction.set_rollback(True)
assert read()['imageCache']['total']==1
add();MarketDataRevision.objects.filter(domain='market').update(revision=999,source_digest='b'*64)
with CaptureQueriesContext(connection) as changed:third=read()
assert third['imageCache']['total']==2
assert any('SELECT DISTINCT' in q['sql'] and 'image_url' in q['sql'] for q in changed)
report={'database':str(DB.relative_to(ROOT)),'actualOverviewWiring':True,'coldTotal':1,'warmTotal':1,'liveReadyState':1,'warmSkipsDistinctScan':True,'transactionRollbackNoPollution':True,'committedFactAndRevisionTotal':2,'rebuildDistinctScan':True,'productionTouched':False,'externalCalls':0,'performanceClaim':False}
(OUT/'scalar-application.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
