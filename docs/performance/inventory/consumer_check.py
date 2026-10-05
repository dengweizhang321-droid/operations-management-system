"""Business-scale legacy consumer checks using a private least-privilege role."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import types
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory
from psycopg import sql
from inventory import guangdong as gd
from inventory import consumers
from inventory.read_cache import cache
from bi import views as bi_views, query as bi_query
from sales.tests.factories import signed_headers, TEST_SECRET


def run(principal, old_query, old_gd, baseline):
    root=Path(__file__).resolve().parents[3]
    # This is the existing BI SELECT-only table contract. No write-authority
    # SELECT or new grants are needed by the inventory cache.
    tables=("bi_migration_runs","sales_data_revisions","sales_import_batches","sales_order_lines",
        "erp_product_master","erp_combo_items","erp_reference_import_batches_pg",
        "erp_reference_import_scope_heads","erp_reference_write_authority",
        "inventory_import_batches","inventory_stock_lines","inventory_age_lines","inventory_data_revisions",
        "replenishment_plan_items","inventory_operating_settings","inventory_guangdong_monitor_items",
        "inventory_guangdong_supplier_cycles")
    with connection.cursor() as cursor:
        cursor.execute("CREATE ROLE inventory_fixture_bi NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE")
        cursor.execute("GRANT USAGE ON SCHEMA public TO inventory_fixture_bi")
        for table in tables:
            cursor.execute(sql.SQL("GRANT SELECT ON {} TO inventory_fixture_bi").format(sql.Identifier(table)))
        cursor.execute("SET ROLE inventory_fixture_bi")
        cursor.execute("SELECT current_user, has_table_privilege(current_user,'inventory_write_authority','SELECT'), has_table_privilege(current_user,'inventory_stock_lines','UPDATE')")
        role,authority_read,stock_write=cursor.fetchone()
    if authority_read or stock_write:raise AssertionError("Role permissions expanded")
    os.environ["TERUISI_DJANGO_INTERNAL_SECRET"]=TEST_SECRET
    url="/api/bi/overview?range=custom&startDate=2026-09-01&endDate=2026-09-30"
    factory=RequestFactory()
    results=[]
    def read_bi():
        response=bi_views.overview(factory.get(url,headers=signed_headers(url)))
        if response.status_code!=200:raise AssertionError(f"BI full response: {response.status_code} {response.content[:200]}")
        data=json.loads(response.content);data.pop("generatedAt")
        return data
    try:
        with patch.object(bi_query,"inventory_overview",old_query.inventory_overview),patch.object(gd,"overview_risks",old_gd.overview_risks):old=read_bi()
        cache.clear()
        for condition in ("cold","warm"):
            actual=read_bi()
            if actual!=old:raise AssertionError("Full BI business response changed")
            results.append({"case":"bi/full/"+condition,"exactDeepEqual":True,"sha256":hashlib.sha256(json.dumps(actual,sort_keys=True).encode()).hexdigest()})
        old_consumers=types.ModuleType("inventory._baseline_consumers");old_consumers.__package__="inventory"
        exec(compile(subprocess.check_output(["git","show",baseline+":backend/inventory/consumers.py"],cwd=root,encoding="utf-8"),"baseline-consumers.py","exec"),old_consumers.__dict__)
        for operation,payload in [("stock_projection",{"offset":0,"limit":2000}),
            ("stock_projection",{"offset":2000,"limit":2000}),
            ("system_cost_snapshot",{}),("freshness",{})]:
            request=consumers.validate_consumer_request({"operation":operation,**payload})
            old=old_consumers.execute_consumer_query(principal,request)
            actual=consumers.execute_consumer_query(principal,request)
            if old!=actual:raise AssertionError("Inventory consumer changed: "+operation)
            results.append({"case":operation+"/"+str(payload.get("offset",0)),"exactDeepEqual":True,"sha256":hashlib.sha256(json.dumps(actual,sort_keys=True).encode()).hexdigest()})
        out=Path(os.environ["INVENTORY_PERFORMANCE_EVIDENCE"])/"consumer-check.json"
        out.write_text(json.dumps({"baseline":baseline,"fixture":"private business-scale synthetic PostgreSQL",
            "role":role,"inventoryAuthoritySelect":authority_read,"inventoryStockUpdate":stock_write,
            "selectTableContract":tables,"rows":{"stock":24000,"age":24000,"sales":240000},
            "results":results,"sourceHashes":{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/"backend/inventory").glob("*.py")}},indent=2))
        print(out)
    finally:
        with connection.cursor() as cursor:cursor.execute("RESET ROLE")
