"""Paired current-main comparison in the owned synthetic PostgreSQL runner."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import types
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from django.db import close_old_connections
from unittest.mock import patch
from urllib.parse import urlsplit

BASELINE = "bab42d8ce836b4ee9acd82e80de085ff71f9f494"
db = urlsplit(os.environ.get("TERUISI_DJANGO_DATABASE_URL", ""))
if db.hostname != "127.0.0.1" or not db.port or db.port == 5432 or not os.environ.get("PRODUCT_OVERVIEW_EVIDENCE"):
    raise RuntimeError("Use the private products performance runner")
import django
django.setup()
from django.core.management import call_command
from django.db import connection
from django.utils import timezone
from sales.auth import Principal
from sales.models import SalesOrderLine, SalesImportBatch, ErpProductMaster, SalesDataRevision, sales_projection_values
from products import query as candidate
from products.models import ProductInventoryProjection, ProductInventoryProjectionControl, ProductShippingRate
from products.summary_cache import SummaryCache

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ["PRODUCT_OVERVIEW_EVIDENCE"])
call_command("migrate", interactive=False, verbosity=0)
stamp = timezone.now().isoformat()
count = 8500
digest = hashlib.sha256(b"products-performance-all-pages-v1").hexdigest()
SalesImportBatch.objects.create(id="perf-sales", source="synthetic", file_name="Synthetic scale", file_size_bytes=0, file_hash=digest, sheet_name="synthetic", status="completed", row_count=count*30, inserted_count=count*30, created_at=stamp, completed_at=stamp)
ErpProductMaster.objects.bulk_create([ErpProductMaster(product_code=f"PERF-{i:05d}", product_name=f"Synthetic product {i}", category=f"Category {i%10}", supplier=f"Supplier {i%20}", source_row_number=i+1, last_import_batch_id="perf-erp", created_at=stamp, updated_at=stamp) for i in range(count)], batch_size=1000)
defaults = {f.name:"" for f in SalesOrderLine._meta.fields if f.get_internal_type()=="TextField" and not f.has_default()}
for day in range(1,31):
    rows=[]
    for i in range(count):
        qty = -1 if (i+day)%11==0 else i%5+1
        raw=dict(source_line_key=f"perf-{day}-{i}", ship_time=f"2026-09-{day:02d}T10:00:00+08:00", product_code=f"PERF-{i:05d}", product_name=f"Synthetic product {i}", category=f"Category {i%10}", warehouse="fixture", channel="fixture-shop", platform="fixture", shop_name="fixture-shop", order_no=f"perf-{day}-{i}")
        values={**defaults, **raw, **sales_projection_values(raw)}
        values.update(source_row_hash=hashlib.sha256(raw["source_line_key"].encode()).hexdigest(), first_import_batch_id="perf-sales", last_import_batch_id="perf-sales", source_row_number=(day-1)*count+i+1, quantity=qty, list_unit_price_cents=29900, cost_amount_cents=19000*qty, allocated_unit_price_cents=29900, allocated_amount_cents=29900*qty, fee_allocation_cents=1000*qty, gross_profit_cents=(9000+i%4*1000)*qty, gross_margin_bps=3311, untaxed_gross_profit_cents=9900*qty, untaxed_gross_margin_bps=3311, created_at=stamp, updated_at=stamp)
        rows.append(SalesOrderLine(**values))
    SalesOrderLine.objects.bulk_create(rows,batch_size=1000)
for domain in ("sales","erp"):
    SalesDataRevision.objects.update_or_create(domain=domain,defaults={"revision":1})
control=ProductInventoryProjectionControl.objects.get(id=1)
control.active_revision="c"*64; control.active_total=count; control.active_source_batch_id="fixture-stock"; control.active_snapshot_date="2026-09-30"; control.save()
ProductInventoryProjection.objects.bulk_create([ProductInventoryProjection(projection_revision=control.active_revision,product_code=f"PERF-{i:05d}",brand="Fixture",available_quantity=i,known_stock_value_cents=i*19000,priced_available_quantity=i if i%2 else 0,source_batch_id="fixture-stock",snapshot_date="2026-09-30") for i in range(count)],batch_size=1000)
ProductShippingRate.objects.bulk_create([ProductShippingRate(product_code=f"PERF-{i:05d}",shipping_rate=["0",".05","-.01","1.25"][i%4],source_row_number=i+1,last_import_batch_id="fixture-rate") for i in range(count)],batch_size=1000)
with connection.cursor() as cursor:
    cursor.execute("ANALYZE sales_order_lines")
baseline=types.ModuleType("products._current_main_baseline"); baseline.__package__="products"
exec(compile(subprocess.check_output(["git","show",BASELINE+":backend/products/query.py"],cwd=ROOT,encoding="utf-8"),"baseline-query.py","exec"),baseline.__dict__)
principal=Principal("fixture@example.invalid","Fixture","admin",None)
scope=dict(range="custom",startDate="2026-09-01",endDate="2026-09-30",pageSize=50)
caches={"baseline":SummaryCache(),"candidate":SummaryCache()}
records=[]; equality=[]; plans={}

def measure(implementation,scenario,opts,repeat):
    module=baseline if implementation=="baseline" else candidate
    stats={"queries":0,"sqlMs":0,"returnedRows":{},"phasesMs":{}}
    captured=[]
    def execute(fn,sql,params,many,context):
        start=time.perf_counter()
        try: return fn(sql,params,many,context)
        finally:
            stats["queries"]+=1; stats["sqlMs"]+=(time.perf_counter()-start)*1000
            if sql.lstrip().upper().startswith("SELECT"):
                table=next((t for t in ["sales_order_lines","erp_product_master","product_inventory_projection","product_shipping_rates"] if ('"'+t+'"') in sql),"metadata")
                stats["returnedRows"][table]=stats["returnedRows"].get(table,0)+max(0,context["cursor"].cursor.rowcount)
                if repeat==0 and scenario=="cold-first" and table=="sales_order_lines": captured.append((sql,params))
    def timed(name,fn):
        def wrapper(*a,**kw):
            start=time.perf_counter()
            try:return fn(*a,**kw)
            finally:stats["phasesMs"][name]=stats["phasesMs"].get(name,0)+(time.perf_counter()-start)*1000
        return wrapper
    from contextlib import ExitStack
    start=time.perf_counter()
    with ExitStack() as stack:
        stack.enter_context(patch("products.summary_cache.cache",caches[implementation]))
        for name in ["_read_dimensions","_sales_performance","_merge","_item","_page_items","cached_base"]:
            if hasattr(module,name):stack.enter_context(patch.object(module,name,timed(name,getattr(module,name))))
        stack.enter_context(connection.execute_wrapper(execute))
        payload=module.product_summary(principal,opts)
    elapsed=(time.perf_counter()-start)*1000
    serialize=time.perf_counter(); body=json.dumps(payload,ensure_ascii=False).encode(); serialize=(time.perf_counter()-serialize)*1000
    records.append(dict(implementation=implementation,scenario=scenario,repeat=repeat,totalMs=elapsed,serializeMs=serialize,responseBytes=len(body),pythonAndFetchMs=elapsed-stats["sqlMs"],**stats))
    if captured:
        raw=[]
        with connection.cursor() as cursor:
            for sql,params in captured:
                cursor.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sql,params)
                raw.append(cursor.fetchone()[0])
        plans[implementation]=raw
    return payload

if sys.argv[1:] == ['contention']:
    observations=[]
    for implementation,module in [('baseline',baseline),('candidate',candidate)]:
        shared=SummaryCache()
        with patch('products.summary_cache.cache',shared):
            warm=module.product_summary(principal,scope)
            entered=Event()
            original=module._sales_performance
            def load(*a,**kw):
                entered.set()
                return original(*a,**kw)
            def read(options):
                close_old_connections()
                start=time.perf_counter();stats={'queries':0,'salesQueries':0}
                def execute(fn,sql,params,many,context):
                    stats['queries']+=1
                    if '"sales_order_lines"' in sql:stats['salesQueries']+=1
                    return fn(sql,params,many,context)
                try:
                    with connection.execute_wrapper(execute):result=module.product_summary(principal,options)
                    return {'ms':(time.perf_counter()-start)*1000,'total':result['pagination']['total'],**stats}
                finally:connection.close()
            with patch.object(module,'_sales_performance',load), ThreadPoolExecutor(max_workers=2) as pool:
                start=time.perf_counter()
                cold=pool.submit(read,{**scope,'startDate':'2026-09-11','projection':'initial-page'})
                if not entered.wait(5):raise AssertionError('cold loader not entered')
                warm_read=pool.submit(read,{**scope,'page':2,'projection':'page','expectedSnapshotToken':warm['snapshotToken']})
                observations.append({'implementation':implementation,'cold':cold.result(),'warm':warm_read.result(),'wallMs':(time.perf_counter()-start)*1000})
    (OUT/'contention.json').write_text(json.dumps({'baseline':BASELINE,'products':count,'salesRows':count*30,'observations':observations,'method':'two owned threads; warm request starts when cold cache loader enters sales, no injected sleep; existing cache global lock unchanged; one sample per implementation'},indent=2),encoding='utf-8')
    print(OUT/'contention.json')
    sys.exit(0)

for repeat in range(3):
    for cache in caches.values():cache.entries.clear();cache.bytes=0
    for scenario,opts in [("cold",scope),("revisit",scope),("page",{**scope,"page":2}),("sort",{**scope,"sortBy":"grossProfitCents"}),("search",{**scope,"query":"PERF-00001 PERF-08499"}),("margin",{**scope,"marginBands":["below35"]}),("filter",{**scope,"categories":["Category 1"]}),("date",{**scope,"startDate":"2026-09-10"}),("refresh",scope)]:
        completed={}
        for implementation in ("baseline","candidate"):
            if scenario in ("page","sort"):
                completed[implementation]=measure(implementation,scenario,{**opts,"projection":"page","expectedSnapshotToken":snapshot},repeat)
            else:
                initial=measure(implementation,scenario+"-first",{**opts,"projection":"initial-page"},repeat)
                if initial["projection"]=="full":completed[implementation]=initial
                else:
                    overview=measure(implementation,scenario+"-rest",{**opts,"projection":"overview","expectedSnapshotToken":initial["snapshotToken"]},repeat)
                    completed[implementation]={**overview,"projection":"full","items":initial["items"]}
            snapshot=completed[implementation]["snapshotToken"]
        assert completed["baseline"]=={k:v for k,v in completed["candidate"].items() if k!="salesSourceRevision"},scenario
        equality.append(f"{scenario}/{repeat}")
    for implementation in ("baseline","candidate"):
        caches[implementation].entries.clear();caches[implementation].bytes=0
    a=measure("baseline","full",scope,repeat);b=measure("candidate","full",scope,repeat)
    assert a=={k:v for k,v in b.items() if k!="salesSourceRevision"}; equality.append(f"full/{repeat}")
(OUT/"benchmark.json").write_text(json.dumps(dict(baseline=BASELINE,fixture="synthetic-only",products=count,salesRows=count*30,inventoryRows=count,rateRows=count,scope=scope,records=records,exactEquivalence=equality,rowCountMeaning="SELECT output rows, NOT base-table scanned rows; EXPLAIN separately",phaseMeaning="inclusive; cached_base includes dimensions, sales and merge; Python includes fetch/materialization",plans=plans),indent=2),encoding="utf-8")
print(OUT/"benchmark.json")
