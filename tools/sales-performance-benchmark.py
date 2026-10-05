"""Paired fixed-scope synthetic measurements; no production fallback."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import types
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "bab42d8ce836b4ee9acd82e80de085ff71f9f494"
RUN = Path(os.environ["SALES_PERFORMANCE_EVIDENCE"])
url = urlsplit(os.environ.get("TERUISI_DJANGO_DATABASE_URL", ""))
if url.hostname != "127.0.0.1" or not url.port or url.port == 5432 or url.path != "/sales_fixture":
    raise RuntimeError("Use the private sales PostgreSQL runner")
import django
django.setup()
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import Client
from sales import summary, category, views, consumers
from sales import calculation_cache
from sales.auth import Principal
from sales.models import SalesOrderLine, SalesImportBatch, ErpProductMaster, SalesDataRevision, sales_projection_values
from sales.tests.factories import TEST_SECRET, signed_headers
from finance.models import FinanceWriteAuthority, FinanceTarget
from finance.import_service import import_finance_payload
from finance.tests.factories import prepared_payload

call_command("migrate", interactive=False, verbosity=0)
os.environ["TERUISI_DJANGO_INTERNAL_SECRET"] = TEST_SECRET
count = 2000
stamp = "2026-10-05T12:00:00+08:00"
digest = hashlib.sha256(b"sales-performance-synthetic-v1").hexdigest()
SalesImportBatch.objects.create(id="sales-perf", source="synthetic", file_name="合成销售性能", file_size_bytes=0,
    file_hash=digest, sheet_name="synthetic", status="completed", row_count=count*75, inserted_count=count*75,
    created_at=stamp, completed_at=stamp)
ErpProductMaster.objects.bulk_create([ErpProductMaster(product_code=f"PERF-{i:04d}", product_name=f"合成商品{i:04d}",
    category=f"合成品类{i%60:02d}", supplier=f"合成供应商{i%10}", source_row_number=i+1,
    last_import_batch_id="perf-erp") for i in range(count)], batch_size=1000)
defaults = {f.name: "" for f in SalesOrderLine._meta.fields if f.get_internal_type() == "TextField" and not f.has_default()}
for month, days in [("2026-09", 30), ("2025-09", 30), ("2026-08", 15)]:
    for day in range(1, days+1):
        rows = []
        for i in range(count):
            qty = -1 if (i+day)%11 == 0 else i%5+1
            raw = dict(source_line_key=f"perf-{month}-{day}-{i}", ship_time=f"{month}-{day:02d}T10:00:00+08:00",
                product_code=f"PERF-{i:04d}", product_name=f"合成商品{i:04d}", category=f"合成品类{i%60:02d}",
                warehouse="刷刷仓" if i%199 == 0 else "合成仓", channel=f"渠道{i%5}",
                platform="京东" if i%2 else "天猫", shop_name=f"合成店{i%120:03d}", order_no=f"order-{month}-{day}-{i//2}")
            values = {**defaults, **raw, **sales_projection_values(raw)}
            values.update(source_row_hash=hashlib.sha256(raw["source_line_key"].encode()).hexdigest(),
                first_import_batch_id="sales-perf", last_import_batch_id="sales-perf", source_row_number=i+1,
                quantity=qty, list_unit_price_cents=10000+i*10, cost_amount_cents=6000*qty,
                allocated_unit_price_cents=10000+i*10, allocated_amount_cents=(10000+i*10)*qty,
                fee_allocation_cents=100*qty, gross_profit_cents=(4000+i*10)*qty,
                gross_margin_bps=4000, untaxed_gross_profit_cents=4000*qty, untaxed_gross_margin_bps=4000,
                created_at=stamp, updated_at=stamp)
            rows.append(SalesOrderLine(**values))
        SalesOrderLine.objects.bulk_create(rows, batch_size=1000)
for domain in ("sales", "erp"):
    SalesDataRevision.objects.update_or_create(domain=domain, defaults={"revision": 1})
FinanceWriteAuthority.objects.filter(id=1).update(status="postgres")
import_finance_payload(prepared_payload("2025-09", "2026-08", "2026-09"), "fixture@example.invalid")
FinanceTarget.objects.bulk_create([FinanceTarget(id=f"synthetic-target-{i}", period_type="year", period_key="2026",
    platform="京东" if i%2 else "天猫", shop_name=f"合成店{i:03d}", manager="合成负责人",
    sales_target_cents=10000000, profit_target_cents=1000000, gross_margin_bps=3000,
    promotion_fee_ratio_bps=800) for i in range(120)])
with connection.cursor() as cursor:
    cursor.execute("ANALYZE sales_order_lines")
principal = Principal("fixture@example.invalid", "Synthetic", "admin", None)

def baseline_module(name, file):
    module = types.ModuleType("sales._baseline_" + name)
    module.__package__ = "sales"
    source = subprocess.check_output(["git", "show", f"{BASELINE}:backend/sales/{file}.py"], cwd=ROOT, encoding="utf-8")
    exec(compile(source, f"baseline-{file}.py", "exec"), module.__dict__)
    return module

old_summary = baseline_module("summary", "summary")
old_category = baseline_module("category", "category")
old_views = baseline_module("views", "views")
old_views.get_sales_summary = old_summary.get_sales_summary
old_views.get_category_analysis = old_category.get_category_analysis
old_views.get_category_detail = old_category.get_category_detail
old_consumers = baseline_module("consumers", "consumers")
old_consumers.get_sales_summary = old_summary.get_sales_summary
records, equivalents = [], []

def measure(label, reader, *args, **kwargs):
    stats = {"sqlMs": 0, "queries": 0}
    def execute(fn, sql, params, many, context):
        started = time.perf_counter()
        try:
            return fn(sql, params, many, context)
        finally:
            stats["sqlMs"] += (time.perf_counter()-started)*1000
            stats["queries"] += 1
    started = time.perf_counter()
    with connection.execute_wrapper(execute):
        result = reader(*args, **kwargs)
    elapsed = (time.perf_counter()-started)*1000
    start_json = time.perf_counter()
    body = json.dumps(result, ensure_ascii=False, default=str).encode()
    records.append({"scenario": label, "domainMs": round(elapsed, 3), "sqlMs": round(stats["sqlMs"], 3),
        "queries": stats["queries"], "pythonFetchMs": round(elapsed-stats["sqlMs"], 3),
        "serializeMs": round((time.perf_counter()-start_json)*1000, 3), "responseBytes": len(body),
        "bodySHA256": hashlib.sha256(body).hexdigest()})
    return result

summary_args = dict(range_name="custom", projection="full", start_date="2026-09-01", end_date="2026-09-30",
    product_queries=[], product_codes=[], platforms=[], shop=None, outlets=[], categories=[], principal=principal)
category_args = dict(startDate="2026-09-01", endDate="2026-09-30", categories=[], channels=[], platforms=[], outlets=[],
    productQueries=[], productCodes=[], brands=[], level=1, granularity="day", sortBy="netSalesCents", direction="desc", page=1, pageSize=20)

def benchmark(baseline_only=False):
    for repeat in range(3):
        cache.clear()
        calculation_cache.clear()
        for scenario, patch in [("first", {}), ("revisit", {}), ("date", {"start_date": "2026-09-10"}),
                ("filter", {"platforms": ["京东"]}), ("refresh", {})]:
            old = measure(f"baseline/summary/{scenario}/{repeat}", old_summary.get_sales_summary, **{**summary_args, **patch})
            if not baseline_only:
                if scenario == "first":
                    calculation_cache.clear()
                core = measure(f"candidate/summary/{scenario}/{repeat}/core", summary.get_sales_summary, **{**summary_args, **patch, "projection": "core"})
                new = measure(f"candidate/summary/{scenario}/{repeat}", summary.get_sales_summary, **{**summary_args, **patch})
                assert old == new, f"summary changed: {scenario}"
                for key in ("current", "previous", "yearAgo", "startDate", "endDate", "requestedStartDate", "requestedEndDate"):
                    assert old[key] == core[key], f"core changed: {scenario}/{key}"
                equivalents.append(f"summary/{scenario}/{repeat}")
        for scenario, patch in [("first", {}), ("revisit", {}), ("page", {"page": 2}), ("sort", {"sortBy": "grossProfitCents"}),
                ("date", {"startDate": "2026-09-10"}), ("filter", {"platforms": ["京东"]}), ("week", {"granularity": "week"}),
                ("month", {"granularity": "month"}), ("refresh", {})]:
            old = measure(f"baseline/category/{scenario}/{repeat}", old_category.get_category_analysis, {**category_args, **patch}, principal)
            if not baseline_only:
                if scenario == "first": calculation_cache.clear()
                new = measure(f"candidate/category/{scenario}/{repeat}", category.get_category_analysis, {**category_args, **patch}, principal)
                assert old == new, f"category changed: {scenario}"
                equivalents.append(f"category/{scenario}/{repeat}")
        old = measure(f"baseline/detail/{repeat}", old_category.get_category_detail, {**category_args, "category": "合成品类00"}, principal)
        if not baseline_only:
            new = measure(f"candidate/detail/{repeat}", category.get_category_detail, {**category_args, "category": "合成品类00"}, principal)
            assert old == new
            equivalents.append(f"detail/{repeat}")
        # Actual HTTP view with signed envelopes for unchanged finance pages.
        for name, endpoint in [("finance", "/api/finance/analysis?month=2026-09"),
                ("annual", "/api/finance/targets?view=annual&year=2026&page=1&pageSize=100"),
                ("annual-page", "/api/finance/targets?view=annual&year=2026&page=2&pageSize=100"),
                ("targets", "/api/finance/targets?view=items&year=2026&page=1&pageSize=100"),
                ("targets-page", "/api/finance/targets?view=items&year=2026&page=2&pageSize=100"),
                ("options", "/api/finance/targets?view=options")]:
            def load():
                response = Client().get(endpoint, headers=signed_headers(endpoint))
                assert response.status_code == 200, response.content
                return response.json()
            measure(f"unchanged/{name}/{repeat}", load)
    if not baseline_only:
        for key in sorted(category.SORT_KEYS):
            for direction in ("asc", "desc"):
                args={**category_args,"sortBy":key,"direction":direction}
                old=measure(f"baseline/category-sort/{key}/{direction}",old_category.get_category_analysis,args,principal)
                new=measure(f"candidate/category-sort/{key}/{direction}",category.get_category_analysis,args,principal)
                assert old==new,key
                equivalents.append(f"category-sort/{key}/{direction}")
        request=consumers.validate_consumer_request({"operation":"summary","range":"custom","startDate":"2026-09-01","endDate":"2026-10-01","productQueries":[],"platforms":[],"outlets":[],"categories":[]})
        old=measure("baseline/consumer",old_consumers.execute_consumer_query,principal,request)
        new=measure("candidate/consumer",consumers.execute_consumer_query,principal,request)
        assert old==new
        equivalents.append("shared-summary-consumer")
    output = {"baseline": BASELINE, "fixture": "synthetic-only-v1", "salesRows": count*75, "products": count,
        "categories": 60, "outlets": 120, "targets": 120, "database": "PostgreSQL17 private loopback",
        "cacheCondition": "first=response AND calculation caches empty per region per repeat; SQL buffers warmed by baseline before candidate; candidate summary records core separately and full reuses its metrics; all measurements serial; no production credentials",
        "records": records, "equivalentCases": equivalents}
    (RUN / ("baseline.json" if baseline_only else "benchmark.json")).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"records": len(records), "equivalentCases": len(equivalents), "evidence": str(RUN)}, ensure_ascii=True), flush=True)

if sys.argv[1:] == ["baseline"]:
    benchmark(True)
elif sys.argv[1:] == ["benchmark"]:
    benchmark()
elif sys.argv[1:] == ["serve"]:
    from sales_performance_server import serve
    serve(ROOT, RUN, old_views)
else:
    raise RuntimeError("Choose baseline, benchmark or serve")
