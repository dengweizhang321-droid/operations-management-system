"""Fixed synthetic scale; records database time separately from Python work."""
import hashlib
import json
import os
from pathlib import Path
import time
import subprocess
import types
from urllib.parse import urlsplit

scope_url=urlsplit(os.environ.get('TERUISI_DJANGO_DATABASE_URL',''))
if scope_url.hostname!='127.0.0.1' or not scope_url.port or scope_url.port==5432 or not os.environ.get('PRODUCT_OVERVIEW_EVIDENCE',''):
    raise RuntimeError('Use the private PostgreSQL benchmark runner')
import django
django.setup()
from django.core.management import call_command
from django.db import connection
from django.utils import timezone
from sales.auth import Principal
from sales.models import SalesOrderLine, SalesImportBatch, ErpProductMaster, SalesDataRevision, sales_projection_values
from products.query import product_summary
from products.summary_cache import cache

call_command("migrate", interactive=False, verbosity=0)
stamp = timezone.now().isoformat()
count = 8500
digest = hashlib.sha256(b"product-overview-scale-v1").hexdigest()
SalesImportBatch.objects.create(id="perf-sales", source="synthetic", file_name="Synthetic scale", file_size_bytes=0, file_hash=digest, sheet_name="synthetic", status="completed", row_count=count*30, inserted_count=count*30, created_at=stamp, completed_at=stamp)
ErpProductMaster.objects.bulk_create([ErpProductMaster(product_code=f"PERF-{i:05d}", product_name=f"Synthetic product {i}", category=f"Category {i%10}", supplier=f"Supplier {i%20}", source_row_number=i+1, last_import_batch_id="perf-erp", created_at=stamp, updated_at=stamp) for i in range(count)], batch_size=1000)
text_defaults = {field.name:"" for field in SalesOrderLine._meta.fields if field.get_internal_type()=="TextField" and not field.has_default()}
for day in range(1,31):
    rows=[]
    for i in range(count):
        negative = (i+day)%11==0
        qty = -1 if negative else i%5+1
        raw=dict(source_line_key=f"perf-{day}-{i}", ship_time=f"2026-09-{day:02d}T10:00:00+08:00", product_code=f"PERF-{i:05d}", product_name=f"Synthetic product {i}", category=f"Category {i%10}", warehouse="fixture", channel="fixture-shop", platform="fixture", shop_name="fixture-shop", order_no=f"perf-{day}-{i}")
        values={**text_defaults, **raw, **sales_projection_values(raw)}
        values.update(source_row_hash=hashlib.sha256(raw['source_line_key'].encode()).hexdigest(), first_import_batch_id="perf-sales", last_import_batch_id="perf-sales", source_row_number=(day-1)*count+i+1, quantity=qty, list_unit_price_cents=29900, cost_amount_cents=19000*qty, allocated_unit_price_cents=29900, allocated_amount_cents=29900*qty, fee_allocation_cents=1000*qty, gross_profit_cents=(9000+i%4*1000)*qty, gross_margin_bps=3311, untaxed_gross_profit_cents=9900*qty, untaxed_gross_margin_bps=3311, created_at=stamp, updated_at=stamp)
        rows.append(SalesOrderLine(**values))
    SalesOrderLine.objects.bulk_create(rows,batch_size=1000)
for domain in ('sales','erp'):
    SalesDataRevision.objects.update_or_create(domain=domain,defaults={'revision':1})
with connection.cursor() as cursor:
    cursor.execute('ANALYZE sales_order_lines')
principal=Principal('fixture@example.invalid','Fixture','admin',None)
scope=dict(range='custom',startDate='2026-09-01',endDate='2026-09-30',pageSize=50)
records=[]
def measure(name, options, reader=product_summary, state="hit"):
    stats={'sqlMs':0,'queries':0}
    def execute(fn,sql,params,many,context):
        start=time.perf_counter()
        try: return fn(sql,params,many,context)
        finally:
            stats['sqlMs']+=(time.perf_counter()-start)*1000
            stats['queries']+=1
    start=time.perf_counter()
    with connection.execute_wrapper(execute):
        payload=reader(principal,options)
    elapsed=(time.perf_counter()-start)*1000
    body=json.dumps(payload,ensure_ascii=False)
    records.append({'scenario':name,'calculationCache':state,'totalMs':round(elapsed,2),**{k:round(v,2) for k,v in stats.items()},'pythonAndFetchMs':round(elapsed-stats['sqlMs'],2),'responseBytes':len(body.encode()),'snapshot':payload['snapshotToken'],'total':payload['pagination']['total']})
    return payload
root=Path(__file__).resolve().parents[1]
baseline=types.ModuleType('products._baseline');baseline.__package__='products'
exec(compile(subprocess.check_output(['git','show','31d0d806:backend/products/query.py'],cwd=root,encoding='utf-8'),'baseline-query.py','exec'),baseline.__dict__)
equivalence=[]
for repeat in range(3):
    cache.entries.clear();cache.bytes=0
    for scenario,opts,state in [
        ('cold',scope,'miss'),('revisit',scope,'hit'),
        ('page',{**scope,'page':2},'hit'),('sort',{**scope,'sortBy':'grossProfitCents'},'hit'),
        ('filter',{**scope,'categories':['Category 1']},'hit'),
        ('date',{**scope,'startDate':'2026-09-10'},'miss'),('refresh',scope,'hit')]:
        baseline_opts = {**opts,'projection':'page','expectedSnapshotToken':last_snapshot} if scenario in {'page','sort'} else opts
        old=measure(f'baseline/{scenario}/{repeat}',baseline_opts,baseline.product_summary,'none (database pages warmed)')
        last_snapshot = old['snapshotToken']
        if scenario in {'page','sort'}:
            new=measure(f'candidate/{scenario}/{repeat}',{**opts,'projection':'page','expectedSnapshotToken':old['snapshotToken']},state=state)
            expected={k:v for k,v in old.items() if k in {'snapshotToken','sort','pagination','items'}}
            expected['projection']='page'
        else:
            initial=measure(f'candidate/{scenario}/{repeat}/first',{**opts,'projection':'initial-page'},state=state)
            overview=measure(f'candidate/{scenario}/{repeat}/rest',{**opts,'projection':'overview','expectedSnapshotToken':initial['snapshotToken']},state='hit')
            new={**overview,'projection':'full','items':initial['items']};expected=old
        if new!=expected:raise AssertionError(f'business changed: {scenario}')
        equivalence.append(f'{scenario}/{repeat}')
out=Path(os.environ['PRODUCT_OVERVIEW_EVIDENCE'])/'benchmark.json'
out.write_text(json.dumps({'baseline':'31d0d806','products':count,'salesRows':count*30,'range':scope,'records':records,'exactEquivalence':equivalence},indent=2),encoding='utf-8')
print(out)
