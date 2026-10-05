"""Synthetic business-scale PostgreSQL before/after comparison, never production."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import types
from datetime import timedelta
from unittest.mock import patch

if not os.environ.get("INVENTORY_PERFORMANCE_EVIDENCE"):
    raise RuntimeError("Use pg_runner.py benchmark")
import django
django.setup()
from django.core.management import call_command
from django.db import connection
from django.utils import timezone
from inventory import query, guangdong as gd
from inventory.models import (InventoryImportBatch, InventoryStockLine, InventoryAgeLine,
    InventoryDataRevision, InventoryImportScopeHead, GuangdongMonitorItem, GuangdongSupplierCycle,
    ReplenishmentPlanItem)
from inventory.read_cache import cache
from sales.auth import Principal
from sales.models import SalesImportBatch, SalesOrderLine, ErpProductMaster, SalesDataRevision, sales_projection_values
from sales.tests.factories import make_line

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(os.environ["INVENTORY_PERFORMANCE_EVIDENCE"])
BASELINE = "bab42d8ce836b4ee9acd82e80de085ff71f9f494"
call_command("migrate", interactive=False, verbosity=0)
now, today = timezone.now(), timezone.localdate()
stamp = now.isoformat()
count = 8000
codes = [f"PERF-{i:05d}" for i in range(count)]
ErpProductMaster.objects.bulk_create([ErpProductMaster(product_code=code,
    product_name=f"Synthetic product {i}", brand=f"Brand {i%4}", category=f"Category {i%10}",
    supplier=f"Supplier {i%20}", source_row_number=i+1, last_import_batch_id="perf-erp",
    created_at=stamp, updated_at=stamp) for i,code in enumerate(codes)], batch_size=1000)

for dataset, model in (("stock", InventoryStockLine), ("age", InventoryAgeLine)):
    head = InventoryImportScopeHead.objects.get(dataset=dataset)
    digest = hashlib.sha256(dataset.encode()).hexdigest()
    batch = InventoryImportBatch.objects.create(id="perf-"+dataset, dataset=dataset,
        source="synthetic-only", file_name="Synthetic fixture", file_size_bytes=0,
        file_hash=digest, raw_file_hash=digest, content_hash=digest, scope_key=head.scope_key,
        sheet_name="synthetic", snapshot_date=today, status="completed", completed_at=now,
        row_count=count*3, inserted_count=count*3)
    rows = []
    for i, code in enumerate(codes):
        warehouses = ["广东仓" if i < 2000 else "菜鸟履约仓", "自营仓", "京东北京仓" if i < 2500 else "售后仓"]
        for n, warehouse in enumerate(warehouses):
            values = dict(batch_id=batch.id, row_key=warehouse+":"+code,
                source_row_number=i*3+n+1, snapshot_date=today, warehouse=warehouse,
                warehouse_type="jd_rdc" if n==2 and i<2500 else "owned", product_code=code,
                product_name=f"Synthetic product {i}", category=f"Category {i%10}",
                available_quantity=[0,8,30,90,200,500,-3][i%7],
                unit_cost_cents=0 if i%17==0 else 19000, inventory_age_days=i%400,
                sales_7d_quantity=None if i%23==0 else i%8,
                sales_30d_quantity=None if i%23==0 else i%30)
            if dataset=="stock": values.update(on_hand_quantity=values["available_quantity"],
                in_transit_quantity=i%5, brand=f"Brand {i%4}", supplier=f"Supplier {i%20}")
            rows.append(model(**values))
    model.objects.bulk_create(rows, batch_size=1000)
    head.current_batch_id=batch.id; head.state_token=digest; head.save()

GuangdongMonitorItem.objects.bulk_create([GuangdongMonitorItem(product_code=code,
    updated_by="fixture@example.invalid") for code in codes[:1000]])
GuangdongSupplierCycle.objects.bulk_create([GuangdongSupplierCycle(supplier=f"Supplier {i}",
    lead_days=10+i, buffer_days=7, updated_by="fixture@example.invalid") for i in range(20)])
SalesImportBatch.objects.create(id="perf-sales", source="synthetic-only", file_name="Synthetic sales",
    file_size_bytes=0, file_hash=hashlib.sha256(b"sales").hexdigest(), sheet_name="synthetic",
    status="completed", row_count=count*30, inserted_count=count*30, created_at=stamp, completed_at=stamp)
template = make_line(1,"template",product_code=codes[0])
template_values = {field.attname:getattr(template,field.attname) for field in SalesOrderLine._meta.concrete_fields}
def synthetic_line(identifier, key, **updates):
    values={**template_values,"id":identifier,"source_line_key":key,"source_row_hash":hashlib.sha256(key.encode()).hexdigest(),"source_row_number":identifier,**updates}
    values.update(sales_projection_values(values,erp_category=values["category"]))
    return SalesOrderLine(**values)
for day in range(1,31):
    rows=[]
    for i,code in enumerate(codes):
        warehouse=["广东仓" if i < 2000 else "菜鸟履约仓", "自营仓", "京东北京仓" if i < 2500 else "售后仓"][day%3]
        rows.append(synthetic_line((day-1)*count+i+1, f"perf-{day}-{i}", product_code=code,
            product_name=f"Synthetic product {i}", warehouse=warehouse, category=f"Category {i%10}",
            ship_time=f"{today-timedelta(days=day)} 10:00:00", quantity=-1 if (i+day)%13==0 else i%5+1,
            first_import_batch_id="perf-sales", last_import_batch_id="perf-sales"))
    SalesOrderLine.objects.bulk_create(rows, batch_size=1000)
for domain in ("sales", "erp"):
    SalesDataRevision.objects.update_or_create(domain=domain, defaults={"revision":1})
InventoryDataRevision.objects.filter(domain="inventory").update(revision=1)
with connection.cursor() as cursor:
    cursor.execute("ANALYZE")

for i in range(60):
    ReplenishmentPlanItem.objects.create(id=f"perf-plan-{i}",source_batch_id="perf-stock",
        product_code=codes[i],product_name=f"Synthetic product {i}",brand=f"Brand {i%4}",
        category=f"Category {i%10}",supplier=f"Supplier {i%20}",warehouse="广东仓",
        buyer="Synthetic buyer",operator_name="Synthetic operator",department="Synthetic",
        current_stock_quantity=i,sales_30d_quantity=30,suggested_quantity=10,planned_quantity=20,
        order_date=today,status="draft" if i%2 else "confirmed")

principal = Principal("fixture@example.invalid", "Fixture", "admin", None)
old_query = types.ModuleType("inventory._baseline_query"); old_query.__package__="inventory"
exec(compile(subprocess.check_output(["git", "show", BASELINE+":backend/inventory/query.py"], cwd=ROOT, encoding="utf-8"), "baseline-query.py", "exec"),old_query.__dict__)
old_gd = types.ModuleType("inventory._baseline_guangdong"); old_gd.__package__="inventory"
exec(compile(subprocess.check_output(["git", "show", BASELINE+":backend/inventory/guangdong.py"], cwd=ROOT, encoding="utf-8"), "baseline-guangdong.py", "exec"),old_gd.__dict__)

records=[]; equivalence=[]; fixtures={}
def measure(label, reader, options):
    stats={"sqlMs":0, "queries":0}
    def execute(fn, sql, params, many, context):
        start=time.perf_counter()
        try: return fn(sql,params,many,context)
        finally: stats["sqlMs"]+=(time.perf_counter()-start)*1000; stats["queries"]+=1
    start=time.perf_counter()
    with connection.execute_wrapper(execute): payload=reader(options)
    total=(time.perf_counter()-start)*1000
    start=time.perf_counter(); body=json.dumps(payload,ensure_ascii=False)
    serialization=(time.perf_counter()-start)*1000
    records.append({"scenario":label,"totalMs":round(total,2),"sqlMs":round(stats["sqlMs"],2),
        "queries":stats["queries"],"pythonFetchAndCopyMs":round(total-stats["sqlMs"],2),
        "serializationMs":round(serialization,2),"responseBytes":len(body.encode())})
    return payload

cases={
    "overview":(lambda o:old_query.inventory_overview(principal,{"view":"overview",**o}),lambda o:query.inventory_overview(principal,{"view":"overview",**o})),
    "plan":(lambda o:old_query.inventory_overview(principal,{"view":"plan",**o}),lambda o:query.inventory_overview(principal,{"view":"plan",**o})),
    "age":(old_query.inventory_age_analysis,lambda o:query.inventory_age_analysis(o,principal)),
    "stale":(lambda o:old_query.inventory_age_analysis({"statuses":["stagnant","slow","aged"],**o}),lambda o:query.inventory_age_analysis({"statuses":["stagnant","slow","aged"],**o},principal)),
    "inbound":(lambda o:old_query.inventory_inbound_monitor(principal,o),lambda o:query.inventory_inbound_monitor(principal,o)),
    "guangdong":(lambda o:old_gd.monitor(principal,o),lambda o:gd.monitor(principal,o)),
}
if sys.argv[1:] == ["consumers"]:
    from consumer_check import run
    run(principal,old_query,old_gd,BASELINE)
    sys.exit(0)

if sys.argv[1:] == ["regional"]:
    from progressive_benchmark import run
    run(cases,principal,old_gd,BASELINE)
    sys.exit(0)

for name,(old,new) in cases.items():
    for repeat in range(3):
        cache.clear()
        for scenario,options in [("first",{}),("reentry",{}),("filter",{"categories":["Category 1"]}),
             ("page",{"page":2,"planPage":2}),("refresh",{}),("search",{"query":"PERF-0001"})]:
            with patch.object(gd,"overview_risks",old_gd.overview_risks):
                expected=measure(f"before/{name}/{scenario}/{repeat}",old,options)
            actual=measure(f"after/{name}/{scenario}/{repeat}",new,options)
            if expected != actual: raise AssertionError(f"Business mismatch: {name}/{scenario}/{repeat}")
            equivalence.append(f"{name}/{scenario}/{repeat}")
            if scenario=="first" and repeat==0: fixtures[name]=actual
        print(f"completed {name}/{repeat}",flush=True)

# Current-page detail enrichment and exports also agree; management reads keep
# their bounded SQL contracts and are separately measured.
for name,fn in [("watchlist",gd.list_items), ("product-search",lambda:gd.search_products("PERF-0001"))]:
    measure("management/"+name,lambda _:fn(),{})
from inventory import guangdong_views
from django.test import RequestFactory
from sales.tests.factories import signed_headers, TEST_SECRET
os.environ["TERUISI_DJANGO_INTERNAL_SECRET"]=TEST_SECRET
factory=RequestFactory()
for endpoint in ("watchlist","suppliers","products"):
    url="/api/inventory/guangdong-monitor/"+endpoint+("?q=PERF" if endpoint=="products" else "")
    response=getattr(guangdong_views,endpoint)(factory.get(url,headers=signed_headers(url)))
    if response.status_code!=200: raise AssertionError(f"management {endpoint}: {response.status_code}")
    fixtures[endpoint]=json.loads(response.content)

# Complete base invalidation: updated version must trigger a new load and still
# produce exactly the old authoritative result.
for domain in ("inventory", "sales", "erp"):
    model=InventoryDataRevision if domain=="inventory" else SalesDataRevision
    model.objects.filter(domain=domain).update(revision=2)
    with patch.object(gd,"overview_risks",old_gd.overview_risks): expected=old_query.inventory_overview(principal,{"view":"overview"})
    actual=measure("after/version-update/"+domain,lambda o:query.inventory_overview(principal,o),{"view":"overview"})
    if expected!=actual: raise AssertionError("version update changed business")
    equivalence.append("version-update/"+domain)

result={"baseline":BASELINE,"fixture":"synthetic business scale on private PostgreSQL",
    "products":count,"stockRows":count*3,"ageRows":count*3,"salesRows":count*30,
    "jdProducts":2500,"watchedProducts":1000,"anchorDate":str(today),
    "conditions":"single client; OS/PG pages warm; no production connections; cold means process calculation cache empty; baseline and candidate alternate",
    "records":records,"exactDeepEquivalence":equivalence,"cacheBytes":cache.bytes,
    "limitations":["Python residual includes ORM fetch/materialization/copy, not only business math",
        "HTTP/frontend timings measured separately; no production P95 claim",
        "Fixed authoritative sorting; global date controls do not change latest snapshot/latest 30 day inventory semantics"]}
(OUT/"benchmark.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
fixture_dir=ROOT/".runtime/inventory-performance-ui"
fixture_dir.mkdir(exist_ok=True)
(fixture_dir/"fixtures.json").write_text(json.dumps(fixtures,ensure_ascii=False),encoding="utf-8")
print(OUT/"benchmark.json")
