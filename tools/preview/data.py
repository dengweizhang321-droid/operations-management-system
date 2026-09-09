"""Synthetic UI fixtures and private SQLite snapshots; no production connections."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import timedelta

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".runtime" / "preview"


def checked_path(value):
    target = Path(value).resolve()
    if target.parent != RUNTIME.resolve() or target.suffix != ".sqlite3":
        raise RuntimeError("Preview database must be a direct child of .runtime/preview")
    return target


def seed():
    import django
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
    django.setup()
    from django.core.management import call_command
    from django.db import transaction
    from django.utils import timezone
    from sales.models import SalesImportBatch, SalesOrderLine, ErpProductMaster, SalesDataRevision, sales_projection_values
    from inventory.models import InventoryImportBatch, InventoryStockLine, InventoryAgeLine, InventoryImportScopeHead, InventoryDataRevision, GuangdongMonitorItem, GuangdongSupplierCycle
    call_command("migrate", interactive=False, verbosity=0)
    now = timezone.now()
    today = timezone.localdate()
    stamp = now.isoformat()
    digest = hashlib.sha256(b"teruisi-synthetic-preview-v1").hexdigest()
    with transaction.atomic():
        SalesImportBatch.objects.create(id="preview-sales", source="synthetic-preview", file_name="合成演示销售", file_size_bytes=0, file_hash=digest, sheet_name="演示", status="completed", row_count=180, inserted_count=180, created_at=stamp, completed_at=stamp)
        for i in range(6):
            code = f"DEMO-{i+1:03d}"
            name = ["商用电风扇", "台式绞肉机", "不锈钢切片机", "多功能料理机", "商用电热锅", "立式搅拌机"][i]
            ErpProductMaster.objects.create(product_code=code, product_name=name, category="演示设备", supplier=f"演示供应商{i%2+1}", source_row_number=i+1, last_import_batch_id="preview-erp", created_at=stamp, updated_at=stamp)
            GuangdongMonitorItem.objects.create(product_code=code, updated_by="preview@teruisi.local")
            for day in range(30):
                date = today - timedelta(days=day+1)
                qty = (day+i)%5+1
                raw = dict(source_line_key=f"preview-{i}-{day}", ship_time=f"{date}T10:00:00+08:00", product_code=code, product_name=name, warehouse="广东仓", category="演示设备", channel="自营", platform="京东" if i%2 else "天猫", shop_name=f"演示店铺{i%2+1}", order_no=f"DEMO-{i}-{day}")
                values = {field.name: "" for field in SalesOrderLine._meta.fields if field.get_internal_type() == "TextField" and not field.has_default()}
                values.update(raw)
                values.update(sales_projection_values(raw))
                values.update(source_row_hash=hashlib.sha256(raw["source_line_key"].encode()).hexdigest(), first_import_batch_id="preview-sales", last_import_batch_id="preview-sales", source_row_number=i*30+day+1, quantity=qty, list_unit_price_cents=29900, cost_amount_cents=19000*qty, allocated_unit_price_cents=29900, allocated_amount_cents=29900*qty, fee_allocation_cents=1000*qty, gross_profit_cents=9900*qty, gross_margin_bps=3311, untaxed_gross_profit_cents=9900*qty, untaxed_gross_margin_bps=3311, created_at=stamp, updated_at=stamp)
                SalesOrderLine.objects.create(**values)
        for dataset, model in [("stock", InventoryStockLine), ("age", InventoryAgeLine)]:
            head = InventoryImportScopeHead.objects.get(dataset=dataset)
            batch_id = f"preview-{dataset}"
            batch_hash = hashlib.sha256(batch_id.encode()).hexdigest()
            InventoryImportBatch.objects.create(id=batch_id, dataset=dataset, source="synthetic-preview", file_name="合成演示库存", file_size_bytes=0, file_hash=batch_hash, raw_file_hash=batch_hash, content_hash=batch_hash, scope_key=head.scope_key, sheet_name="演示", snapshot_date=today, status="completed", row_count=6, inserted_count=6, completed_at=now)
            for i in range(6):
                fields = dict(batch_id=batch_id, row_key=f"广东仓:DEMO-{i+1:03d}", source_row_number=i+1, snapshot_date=today, warehouse="广东仓", warehouse_type="owned", product_code=f"DEMO-{i+1:03d}", product_name=ErpProductMaster.objects.get(pk=f"DEMO-{i+1:03d}").product_name, available_quantity=[0,8,30,90,200,500][i], unit_cost_cents=19000, inventory_age_days=i*40, sales_7d_quantity=20, sales_30d_quantity=90)
                if dataset == "stock":
                    fields.update(on_hand_quantity=fields["available_quantity"], supplier=f"演示供应商{i%2+1}", in_transit_quantity=i*5)
                model.objects.create(**fields)
            head.current_batch_id = batch_id
            head.state_token = batch_hash
            head.save()
        for i in (1,2):
            GuangdongSupplierCycle.objects.create(supplier=f"演示供应商{i}", lead_days=14, buffer_days=7, updated_by="preview@teruisi.local")
        for domain in ("sales", "erp"):
            SalesDataRevision.objects.update_or_create(domain=domain, defaults={"revision":1})
        InventoryDataRevision.objects.update_or_create(domain="inventory", defaults={"revision":1})
    print(json.dumps({"fixture":"synthetic-v1", "anchorDate":str(today), "sales":180, "products":6, "stock":6, "age":6}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["seed", "copy"])
    parser.add_argument("target")
    parser.add_argument("--source")
    args = parser.parse_args()
    target = checked_path(args.target)
    if target.exists():
        raise RuntimeError("Refusing to overwrite a preview database; choose a fresh generation")
    if os.getenv("TERUISI_DJANGO_DATABASE_URL"):
        raise RuntimeError("Preview forbids PostgreSQL connection variables")
    os.environ["TERUISI_DJANGO_SQLITE_PATH"] = str(target)
    if args.action == "seed":
        seed()
    else:
        source = checked_path(args.source)
        with sqlite3.connect(source.as_uri()+"?mode=ro", uri=True) as src, sqlite3.connect(target) as dst:
            if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Invalid preview snapshot")
            src.backup(dst)
        print("Preview snapshot copied")
