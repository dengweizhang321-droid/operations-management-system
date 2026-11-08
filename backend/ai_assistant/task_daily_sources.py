"""Minimal owning-domain projections for the isolated JD daily cycle."""
from datetime import timedelta
from time import monotonic
from zoneinfo import ZoneInfo

from django.db.models import Count, Q, Sum

from inventory.import_service import SCOPE_KEYS
from inventory.models import InventoryImportFingerprint, InventoryStockLine
from inventory.query import _latest_batch
from inventory.revisions import revision_value
from inventory.warehouse_mapping import classify_warehouse
from inventory.warehouse_mapping_service import effective_mapping, mapping_revision
from netshop.sales_client import sales_alias
from sales.analysis import expressions
from sales.consumers import _scoped_business
from sales.models import SalesImportBatch, SalesImportFingerprint, SalesImportScopeHead
from sales.netshop_periods import _revision, _sql_budget
from sales.write_service import SALES_IMPORT_SOURCE, _scope_key

from .policy import AiError

SHOP = {"platform": "京东", "shop": "志高商用设备旗舰店"}
SALES = "erp_shop_sales"
INVENTORY = "inventory_included_warehouses"
INVENTORY_SCOPE = {"warehousePolicy": "全部计入库存的仓"}
REQUIRED_FIELDS = {SALES: {"sales_amount_cents", "quantity"}, INVENTORY: {"included_warehouse_quantity"}}
MAX_GROUPS = 2000
MAX_SAFE = 2**53 - 1


def _erp_sales(principal, day, revision):
    alias = sales_alias(SHOP["platform"], SHOP["shop"])
    head = SalesImportScopeHead.objects.filter(pk=_scope_key(), status="ready").first()
    if not head or not head.current_batch_id:
        return None
    batch = SalesImportBatch.objects.filter(pk=head.current_batch_id, source=SALES_IMPORT_SOURCE,
        scope_key=head.scope_key, status="completed", published_state_token=head.state_token).first()
    scope = batch.scope_json if batch and batch.completed_at and batch.published_state_token and isinstance(batch.scope_json, dict) else {}
    channel = alias["rawChannel"]
    if (scope.get("source") != "sales_ledger" or not isinstance(scope.get("startDate"), str)
            or not isinstance(scope.get("endDate"), str) or not scope["startDate"] <= day <= scope["endDate"]
            or ("channels" in scope and (not isinstance(scope["channels"], list) or channel not in scope["channels"]))):
        return None
    if not SalesImportFingerprint.objects.filter(domain="sales", batch_id=batch.id, scope_key=head.scope_key,
            scope_json=scope, content_hash=batch.content_hash, row_count=batch.row_count, status="completed",
            publication_sequence__gt=0).exists():
        return None
    rows = _scoped_business(principal).filter(business_date=day).filter(
        Q(channel=channel) | Q(platform=alias["platform"], shop_name=alias["rawShopName"]))
    expected = rows.filter(platform=alias["platform"], shop_name=alias["rawShopName"], channel=channel, last_import_batch_id=batch.id)
    if rows.exclude(pk__in=expected.values("pk")).exists():
        return None
    metrics = expressions()
    values = expected.aggregate(sales_amount_cents=Sum(metrics["netSalesCents"]), quantity=Sum(metrics["netQuantity"]))
    # A committed import interval does not attest an absent shop-day as zero.
    if any(value is None or abs(value) > MAX_SAFE for value in values.values()):
        return None
    return {"dataset": SALES, "scope": SHOP, "date": day, "complete": True, "batchId": batch.id,
        "revision": revision, "fields": sorted(values), **{key: int(value) for key, value in values.items()}}


def _inventory(day, revision, mapping):
    batch = _latest_batch("stock")
    if (not batch or not batch.completed_at or not batch.published_state_token
            or batch.snapshot_date.isoformat() != day or batch.scope_key != SCOPE_KEYS["stock"]):
        return None
    if not InventoryImportFingerprint.objects.filter(dataset="stock", batch_id=batch.id, scope_key=batch.scope_key,
            scope_json={"dataset": "stock", "snapshotDate": day}, content_hash=batch.content_hash, row_count=batch.row_count,
            published_state_token=batch.published_state_token, status="completed").exists():
        return None
    rows = InventoryStockLine.objects.filter(batch_id=batch.id).values(
        "warehouse", "warehouse_type", "warehouse_category", "include_in_inventory", "snapshot_date").annotate(
        count=Count("pk"), quantity=Sum("available_quantity")).order_by("warehouse", "warehouse_type", "warehouse_category",
        "include_in_inventory", "snapshot_date")[:MAX_GROUPS + 1]
    groups = list(rows)
    if (not groups or len(groups) > MAX_GROUPS or sum(row["count"] for row in groups) != batch.row_count
            or any(row["snapshot_date"] != batch.snapshot_date for row in groups)):
        return None
    quantity = 0
    for row in groups:
        if row["warehouse"].strip() != "刷刷仓" and classify_warehouse(row["warehouse"], stored_type=row["warehouse_type"],
                stored_category=row["warehouse_category"], stored_include_in_inventory=row["include_in_inventory"],
                mapping=mapping).include_in_inventory:
            quantity += row["quantity"]
    if abs(quantity) > MAX_SAFE:
        return None
    return {"dataset": INVENTORY, "scope": INVENTORY_SCOPE, "date": day, "complete": True, "batchId": batch.id,
        "revision": revision + "/" + mapping_revision(mapping), "fields": ["included_warehouse_quantity"],
        "included_warehouse_quantity": int(quantity)}


def read(principal, spec, scheduled_at):
    from .task_daily_cycle import require_isolated
    require_isolated()
    if principal.role != "admin" or principal.scope is not None or spec["shopSelection"] != SHOP:
        raise AiError("日报取数须绑定原店铺和无范围限制的管理员", "access_denied", 403)
    local_day = scheduled_at.astimezone(ZoneInfo("Asia/Shanghai")).date()
    dates = {dep["dataset"]: (local_day - timedelta(days=dep["dayOffset"])).isoformat()
             for dep in spec["dataDependencies"]}
    with _sql_budget(monotonic() + 8):
        sales_revision, inventory_revision, mapping = _revision(), revision_value(), effective_mapping()
        sales = _erp_sales(principal, dates[SALES], sales_revision)
        stock = _inventory(dates[INVENTORY], inventory_revision, mapping)
        if (_revision() != sales_revision or revision_value() != inventory_revision
                or mapping_revision(effective_mapping()) != mapping_revision(mapping)):
            return {SALES: None, INVENTORY: None}
    return {SALES: sales, INVENTORY: stock}
