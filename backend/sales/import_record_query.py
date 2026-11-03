"""Shared, read-only history projection. Each reader queries only its own table.

Opt-in on existing history endpoints; ordinary history callers are unchanged.
"""
from datetime import timezone
from django.db import connection
from django.db.models import Case, CharField, DateTimeField, F, Q, Value, When
from django.db.models.functions import Cast, Coalesce, Collate, Concat, NullIf


LABELS = {
    "sales": "吉客云 ERP · 销售明细", "inventory": "吉客云 ERP · 分仓库存",
    "inventory_age": "吉客云 ERP · 库龄分析", "products": "吉客云 ERP · 货品导出",
    "combos": "吉客云 ERP · 组合装及子件", "finance": "月度财报 · 志高事业部",
    "jd_promotion": "京准通 · 推广商品日数据", "jd_sku": "京东店铺 · 商品 SKU",
    "jd_sku_images": "京东店铺 · SKU 主图", "jd_spu_daily": "京东店铺 · 商品 SPU 日数据",
    "jd_sku_daily": "京东店铺 · 商品 SKU 日数据", "tmall_product_master": "天猫店铺 · 店铺货品",
    "tmall_product_assets": "天猫店铺 · SPU 商品图", "tmall_product_daily": "天猫店铺 · 生意参谋商品日数据",
    "tmall_promotion": "天猫店铺 · 推广商品日数据", "customer_service": "客服会话",
    "sku_shipping_rates": "年度利润表 · SKU 快递费率",
}


def records_requested(params):
    return params.get("records") == "1"


def list_records(domain, params, error_class):
    try:
        return _list_records(domain, params)
    except ValueError as error:
        raise error_class(str(error), status=400) from error


def _list_records(domain, params):
    # Imports stay local: domain readers never evaluate another domain's model.
    if domain == "sales":
        from sales.models import SalesImportBatch as Model
        from sales.write_service import batch_payload as serialize
    elif domain == "inventory":
        from inventory.models import InventoryImportBatch as Model
        from inventory.import_service import _batch_payload as serialize
    elif domain == "erp":
        from erp_reference.models import ErpReferenceImportBatch as Model
        from erp_reference.import_service import _batch_payload as serialize
    elif domain == "finance":
        from finance.models import FinanceImportBatch as Model
        from finance.serialization import batch_payload as serialize
    elif domain == "netshop":
        from netshop.models import NetshopImportBatch as Model
        from netshop.serialization import batch_payload as serialize
    elif domain == "customer_service":
        from customer_service.models import CustomerServiceImportBatch as Model
        from customer_service.import_service import _batch_payload as serialize
    elif domain == "products":
        from products.models import ProductShippingRateImportBatch as Model
        from products.import_service import _batch_payload as serialize
    else:
        raise ValueError("Unknown history domain")

    def invalid(message):
        # Views invoke this after normal authentication and translate locally.
        raise ValueError(message)

    if set(params) - {"records", "recordSource", "recordStatus", "page", "pageSize"}:
        invalid("运行记录包含未知参数")
    if any(len(params.getlist(key)) != 1 for key in params):
        invalid("运行记录参数不可重复")
    try:
        page, size = int(params.get("page", "1")), int(params.get("pageSize", "20"))
    except ValueError:
        invalid("分页参数必须是整数")
    if not 1 <= page <= 10000 or not 1 <= size <= 100:
        invalid("分页参数超出范围")
    source, status = params.get("recordSource", ""), params.get("recordStatus", "")
    if source and source not in LABELS:
        invalid("数据类型无效")

    rows = Model.objects.all()
    if domain == "inventory":
        key = Case(When(dataset="age", then=Value("inventory_age")), default=Value("inventory"), output_field=CharField())
    elif domain == "erp":
        key = F("source_key")
    elif domain == "netshop":
        rows = rows.filter(Q(source__in=["jd_promotion", "jd_product_master", "jd_yimei_sku"]) | Q(source__startswith="tmall_") | Q(dataset__in=["spu_daily", "sku_daily"]))
        key = Case(
            *[When(source=value, then=Value(value)) for value in ["jd_promotion", "tmall_product_master", "tmall_product_assets", "tmall_product_daily", "tmall_promotion"]],
            When(dataset="spu_daily", then=Value("jd_spu_daily")), When(dataset="sku_daily", then=Value("jd_sku_daily")),
            When(source="jd_yimei_sku", then=Value("jd_sku_images")), default=Value("jd_sku"), output_field=CharField())
    else:
        key = Value("sku_shipping_rates" if domain == "products" else domain, output_field=CharField())
    rows = rows.annotate(record_key=key)
    sources = [{"key": value, "label": LABELS.get(value, value)} for value in rows.order_by().values_list("record_key", flat=True).distinct()]
    if source:
        rows = rows.filter(record_key=source)

    success = Q(status__in=["imported", "completed", "success", "done"])
    if domain == "customer_service":
        # Match the existing UI's warnings.length (serializer caps at WARNING_LIMIT).
        warning = Q(warnings_json__items__0__isnull=False)
    else:
        warning = Q(warning_count__gt=0)
    groups = {
        "failed": Q(status__in=["failed", "rejected", "error"]),
        "running": Q(status__in=["processing", "running", "staging", "committing"]),
        "pending": Q(status__in=["pending", "queued", "created"]),
        "duplicate": Q(status="duplicate"), "warning": Q(status="partial") | (success & warning),
        "completed": success & ~warning,
    }
    known = Q()
    for predicate in groups.values():
        known |= predicate
    groups["other"] = ~known
    if status:
        if status not in groups:
            invalid("状态无效")
        rows = rows.filter(groups[status])
    # Text-backed legacy dates and native timestamps compare as real instants.
    if Model._meta.get_field("created_at").get_internal_type() == "TextField":
        rows = rows.annotate(record_raw=Coalesce(NullIf("completed_at", Value("")), "created_at", output_field=CharField()))
        # Legacy unzoned strings were shown in the browser's Shanghai business
        # timezone. Do not reinterpret those strings as UTC during SQL sorting.
        text = Case(When(record_raw__regex=r"(Z|[+-]\d{2}(?::?\d{2})?)$", then=F("record_raw")), default=Concat("record_raw", Value("+08:00")), output_field=CharField())
        stamp = Cast(text, DateTimeField())
    else:
        stamp = Coalesce("completed_at", "created_at", output_field=DateTimeField())
    rows = rows.annotate(record_time=stamp).order_by("-record_time", Collate("record_key", "C") if connection.vendor == "postgresql" else "record_key", Collate("id", "C") if connection.vendor == "postgresql" else "id")
    total, offset = rows.count(), (page - 1) * size
    items = []
    for row in rows[offset:offset + size]:
        item = serialize(row)
        item.update(sourceKey=row.record_key, sourceLabel=LABELS.get(row.record_key, row.record_key), sortAt=row.record_time.astimezone(timezone.utc).isoformat(timespec="microseconds"))
        if domain == "customer_service":
            item.update(fileName=f'{item["sessionFileName"]} + {item["chatFileName"]}', rowCount=item["conversationCount"], insertedCount=item["matchedCount"], warningCount=len(item["warnings"]), warnings=[{"message": value} for value in item["warnings"]])
            item["sourceLabel"] = f'客服会话 · {item["shopName"] or "志高商用设备"}'
        if row.record_key == "tmall_product_assets":
            item["sourceLabel"] = f'{item["shopName"].removeprefix("天猫-") or "天猫店铺"} · SPU 商品图'
        items.append(item)
    truncated = offset + len(items) < total
    return {"items": items, "sources": sources, "pagination": {"page": page, "pageSize": size, "total": total, "returned": len(items), "truncated": truncated, "completeness": "truncated_do_not_infer_absence" if truncated else "complete"}}
