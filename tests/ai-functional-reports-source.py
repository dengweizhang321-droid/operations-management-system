"""W12 owning PostgreSQL source checks, without opening the daily executor gate."""
from datetime import date, timedelta
import hashlib
import json
import os
import sys

from ai_functional_environment import OUT, SOURCE, environment, network_guard


DAY = date(2026, 11, 7)
KEY = "isofunc-daily-source"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def seed_sales():
    from ai_assistant.task_daily_sources import SHOP
    from django.utils import timezone
    from netshop.sales_client import sales_alias
    from sales.models import SalesImportBatch, SalesImportFingerprint, SalesImportScopeHead
    from sales.tests.factories import make_line
    from sales.write_service import SALES_IMPORT_SOURCE, _bump_sales_revision, _scope_key

    alias = sales_alias(SHOP["platform"], SHOP["shop"])
    channel, shop = alias["rawChannel"], alias["rawShopName"]
    today = DAY.isoformat()
    stamp = timezone.now().isoformat()
    scope = {"source": "sales_ledger", "startDate": today, "endDate": today, "channels": [channel]}
    batches = []
    for suffix, sequence, count in (("previous", 1, 0), ("head", 2, 6)):
        batch_id = f"{KEY}-{suffix}"
        sha = digest(batch_id)
        batch = SalesImportBatch.objects.create(id=batch_id, source=SALES_IMPORT_SOURCE, file_name="synthetic.xlsx",
            file_size_bytes=1, file_hash=sha, raw_file_hash=sha, content_hash=sha, scope_key=_scope_key(),
            published_state_token=sha, sheet_name="synthetic", status="completed", row_count=count,
            created_at=stamp, completed_at=stamp, scope_json=scope)
        SalesImportFingerprint.objects.create(domain="sales", batch_id=batch.id, scope_key=batch.scope_key, scope_json=scope,
            import_hash=sha, raw_file_hash=sha, content_hash=sha, row_count=count, status="completed", publication_sequence=sequence)
        batches.append(batch)
    previous, head = batches
    SalesImportScopeHead.objects.update_or_create(pk=head.scope_key, defaults={"status": "ready", "current_batch_id": head.id,
        "state_token": head.published_state_token, "generation": 2})

    lines = []
    for ordinal, (name, platform, raw_shop, raw_channel, warehouse, ship, cents, units) in enumerate([
        ("sale", alias["platform"], shop, channel, "广东仓", f"{today} 10:00:00", 20_000, 5),
        ("refund", alias["platform"], shop, channel, "广东仓", f"{today} 11:00:00", -3_000, -1),
        ("other-shop", alias["platform"], "隔离非目标店", "隔离非目标渠道", "广东仓", f"{today} 12:00:00", 90_000, 90),
        ("other-platform", "天猫", shop, "隔离非目标渠道", "广东仓", f"{today} 13:00:00", 95_000, 95),
        ("excluded-warehouse", alias["platform"], shop, channel, "刷刷仓", f"{today} 14:00:00", 96_000, 96),
        ("outside-day", alias["platform"], shop, channel, "广东仓", f"{DAY + timedelta(days=1)} 00:00:00", 97_000, 97),
    ], start=2_807_001):
        line = make_line(ordinal, f"{KEY}-{name}", platform=platform, shop_name=raw_shop, channel=raw_channel, warehouse=warehouse,
            ship_time=ship, line_ship_time=ship, allocated_amount_cents=cents, quantity=units,
            first_import_batch_id=head.id, last_import_batch_id=head.id)
        line.save(force_insert=True)
        lines.append(line)
    _bump_sales_revision(head.content_hash)
    return alias, previous, head, lines[:2]


def seed_stock():
    from django.utils import timezone
    from inventory.import_service import SCOPE_KEYS
    from inventory.models import InventoryImportBatch, InventoryImportFingerprint, InventoryOperatingSettings, InventoryStockLine
    from inventory.revisions import bump_revision

    InventoryOperatingSettings.objects.get_or_create(id=1)
    batch_id = KEY + "-stock"
    sha = digest(batch_id)
    batch = InventoryImportBatch.objects.create(id=batch_id, dataset="stock", source="synthetic", file_name="synthetic.xlsx",
        file_size_bytes=1, file_hash=sha, raw_file_hash=sha, content_hash=sha, scope_key=SCOPE_KEYS["stock"], sheet_name="synthetic",
        snapshot_date=DAY, row_count=4, status="completed", completed_at=timezone.now(), published_state_token=sha)
    fingerprint = InventoryImportFingerprint.objects.create(dataset="stock", batch_id=batch.id, scope_key=batch.scope_key,
        scope_json={"dataset": "stock", "snapshotDate": DAY.isoformat()}, raw_file_hash=sha, import_hash=sha, content_hash=sha,
        row_count=batch.row_count, published_state_token=sha)
    for number, warehouse, qty in [(1, "广东仓", 30), (2, "隔离自营仓", 25), (3, "刷刷仓", 500), (4, "一个小太阳仓", 700)]:
        InventoryStockLine.objects.create(batch_id=batch.id, row_key=str(number), source_row_number=number,
            snapshot_date=DAY, warehouse=warehouse, product_code="isofunc-stock-product", available_quantity=qty)
    return batch, fingerprint, bump_revision({"fixture": batch.id})


def main(email):
    private_env = environment()
    os.environ.clear()
    os.environ.update(private_env)
    network_guard()
    sys.path.insert(0, str(SOURCE / "backend"))
    import django
    django.setup()
    from access_control.models import AppUser
    from ai_assistant import task_daily_sources
    from ai_assistant.policy import AiError, current_principal
    from ai_assistant.task_daily_cycle import require_isolated
    from django.conf import settings
    from django.db import connection, transaction
    from inventory.warehouse_mapping_service import effective_mapping
    from sales.auth import Principal
    from sales.models import SalesOrderLine
    from sales.netshop_periods import _revision

    require(settings.DJANGO_ENVIRONMENT == "development" and connection.vendor == "postgresql", "requires the shared private development PostgreSQL")
    with connection.cursor() as cursor:
        cursor.execute("SELECT host(inet_server_addr()), inet_server_port(), current_database(), current_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)")
        identity = cursor.fetchone()
    require(identity == ("127.0.0.1", 55488, "functional_ai", "functional_app", False), "private PostgreSQL identity differs")
    stored = AppUser.objects.get(email=email)
    owner = current_principal(Principal(stored.email, stored.display_name, stored.role_id, stored.scope), admin=True)
    try:
        require_isolated()
    except AiError as error:
        require(error.code == "task_executor_not_adopted", "unexpected W12 executor admission failure")
        gate = {"status": error.status, "code": error.code}
    else:
        raise AssertionError("W12 executor unexpectedly admitted to shared development database")

    evidence = {"gate": gate, "databaseIdentity": identity, "day": DAY.isoformat(), "cases": {}}
    with transaction.atomic():
        alias, previous, head, target = seed_sales()
        stock, fingerprint, stock_revision = seed_stock()
        sales_revision, mapping = _revision(), effective_mapping()
        day = DAY.isoformat()
        sales = task_daily_sources._erp_sales(owner, day, sales_revision)
        inventory = task_daily_sources._inventory(day, stock_revision, mapping)
        require((sales["sales_amount_cents"], sales["quantity"], sales["batchId"]) == (17_000, 4, head.id), "W12 source must keep exact ERP net values")
        require((inventory["included_warehouse_quantity"], inventory["batchId"]) == (55, stock.id), "W12 included warehouses only")
        evidence["cases"]["positive"] = {"erp": sales, "inventory": inventory}

        for case, changes, both in (
            ("wrong-platform-mixed", {"platform": "天猫"}, False),
            ("wrong-shop-mixed", {"shop_name": "隔离冲突店"}, False),
            ("wrong-channel-mixed", {"channel": "隔离冲突渠道"}, False),
            ("wrong-channel-only", {"channel": "隔离冲突渠道"}, True),
            ("old-batch-mixed", {"last_import_batch_id": previous.id}, False),
        ):
            with transaction.atomic():
                SalesOrderLine.objects.filter(pk__in=[line.pk for line in target] if both else [target[-1].pk]).update(**changes)
                require(task_daily_sources._erp_sales(owner, day, sales_revision) is None, f"conflict {case} must remain incomplete")
                evidence["cases"][case] = "source_coverage_not_proven"
                transaction.set_rollback(True)

        require(task_daily_sources._inventory((DAY + timedelta(days=1)).isoformat(), stock_revision, mapping) is None, "wrong inventory day must remain incomplete")
        fingerprint.delete()
        require(task_daily_sources._inventory(day, stock_revision, mapping) is None, "missing inventory publication fingerprint must remain incomplete")
        evidence["cases"]["inventory-wrong-day"] = "source_coverage_not_proven"
        evidence["cases"]["inventory-missing-fingerprint"] = "source_coverage_not_proven"
        evidence["erpAlias"] = {"platform": alias["platform"], "rawShop": alias["rawShopName"], "rawChannel": alias["rawChannel"]}
        transaction.set_rollback(True)
    from sales.models import SalesImportBatch
    require(not SalesImportBatch.objects.filter(id__startswith=KEY).exists(), "temporary W12 transactions must roll back")
    evidence["fixtureRowsRolledBack"] = True
    evidence["modelPosts"] = 0
    evidence["recipientPosts"] = 0
    out = OUT / "reports" / "W12-sources.json"
    with out.open("x", encoding="utf-8") as stream:
        json.dump(evidence, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(f"W12 source and executor gate checks passed: {len(evidence['cases'])} source cases")


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].startswith("isofunc-report-") or not sys.argv[1].endswith("@example.invalid"):
        raise SystemExit("Provide the existing synthetic report owner email")
    main(sys.argv[1])
