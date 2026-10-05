"""Independent private-PG role and source-selection race probes."""
import hashlib
import json
import os
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parents[4]
url=urlparse(os.environ["TERUISI_DJANGO_DATABASE_URL"])
assert url.hostname=="127.0.0.1" and url.port!=5432 and url.path=="/inventory_review"
OUT=Path(os.environ["INVENTORY_REVIEW_EVIDENCE"])
import django
django.setup()
from django.core.management import call_command
from django.db import connection
from django.utils import timezone
from inventory import read_cache as rc, query, views
from inventory.models import InventoryAgeLine,InventoryDataRevision,InventoryImportBatch,InventoryImportScopeHead
from inventory.views import _consistent_read
from sales.auth import Principal
from sales.models import SalesDataRevision
call_command("migrate",interactive=False,verbosity=0)
checks=[]
principal=Principal("review@example.invalid","Independent review","admin",None)
for domain in ("sales","erp"):
    SalesDataRevision.objects.update_or_create(domain=domain,defaults={"revision":1})
InventoryDataRevision.objects.filter(domain="inventory").update(revision=1)
counter=[0]
def loader():counter[0]+=1;return {"n":counter[0]}

# Existing BI-like consumers need revision reads but no write-authority SELECT.
with connection.cursor() as cursor:
    for role in ("inventory_review_role_a","inventory_review_role_b"):
        cursor.execute(f'CREATE ROLE "{role}" NOLOGIN')
        cursor.execute(f'GRANT USAGE ON SCHEMA public TO "{role}"')
        for model in (InventoryDataRevision,SalesDataRevision):
            cursor.execute(f'GRANT SELECT ON TABLE "{model._meta.db_table}" TO "{role}"')
try:
    for role in ("inventory_review_role_a","inventory_review_role_b","inventory_review_role_a"):
        with connection.cursor() as cursor:cursor.execute(f'SET ROLE "{role}"')
        rc.cached_base("role-probe",principal,"all",loader)
    assert counter[0]==2, "Actual PG role did not isolate reuse"
    checks.append("actual-two-NOLOGIN-PG-roles-without-authority-table-permission")
finally:
    with connection.cursor() as cursor:cursor.execute("RESET ROLE")

head=InventoryImportScopeHead.objects.get(dataset="age")
today=timezone.localdate();now=timezone.now()
for index,quantity in ((1,10),(2,100)):
    digest=hashlib.sha256(str(index).encode()).hexdigest()
    day=today-timedelta(days=2-index)
    batch=InventoryImportBatch.objects.create(id=f"review-age-{index}",dataset="age",source="synthetic-only",file_name="Independent synthetic",file_size_bytes=0,file_hash=digest,raw_file_hash=digest,content_hash=digest,scope_key=head.scope_key,sheet_name="fixture",snapshot_date=day,status="completed",completed_at=now,row_count=1,inserted_count=1)
    InventoryAgeLine.objects.create(batch_id=batch.id,row_key="review",source_row_number=1,snapshot_date=day,warehouse="广东仓",warehouse_type="owned",product_code="REVIEW-1",product_name="Independent synthetic",category="Synthetic",available_quantity=quantity,unit_cost_cents=0,inventory_age_days=100,sales_7d_quantity=0,sales_30d_quantity=0)
head.current_batch_id="review-age-1";head.save()
rc.cache.clear()
native_snapshot=rc.snapshot
calls=[0]
def racing_snapshot():
    calls[0]+=1
    # The outer consistent-read sampled old revisions; the source batch has now
    # been selected but the base-cache key has not sampled versions yet.
    if calls[0]==2:
        InventoryImportScopeHead.objects.filter(dataset="age").update(current_batch_id="review-age-2")
        InventoryDataRevision.objects.filter(domain="inventory").update(revision=2)
    return native_snapshot()
with patch.object(rc,"snapshot",racing_snapshot), patch.object(views,"snapshot",racing_snapshot):
    result,revision=_consistent_read(lambda:query.inventory_age_analysis({},principal))
assert result["sync"]["latestInventoryBatchId"]=="review-age-2" and result["items"][0]["availableQuantity"]==100
again=query.inventory_age_analysis({},principal)
assert again["items"][0]["availableQuantity"]==100 and again["sync"]["latestInventoryBatchId"]=="review-age-2"
checks.append("commit-between-batch-selection-and-cache-key-does-not-poison-next-current-batch")
assert result["items"][0]["stockValueCents"]==0
checks.append("explicit-zero-cost-remains-zero-and-not-missing")
result={"status":"passed","checks":checks,"privateDatabase":"inventory_review","port":url.port,"sourceHashes":{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in ("backend/inventory/read_cache.py","backend/inventory/query.py","backend/inventory/views.py")},"limitations":"Tiny independent PG race/role probes; business-scale equivalence is separate."}
(OUT/"pg-independent-result.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
print(json.dumps(result,indent=2))
