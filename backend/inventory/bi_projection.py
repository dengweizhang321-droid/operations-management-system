"""Owning inventory/Guangdong summary, without copying stock facts to BI."""
from django.views.decorators.http import require_GET
import re

from .errors import InventoryApiError
from .guangdong import RISK_LABELS, _bounded_items, _project_items
from .query import _overview_items, _quality, _metrics, _health_distribution_items, _sales_revision
from .revisions import revision_value
from .views import _principal, _json, _error
from teruisi_backend.read_budget import bounded_read


def projection(principal):
    if principal.scope is not None:
        raise InventoryApiError("库存驾驶舱仅支持未受限数据范围", code="access_denied", status=403)
    options = {"startDate": None, "endDate": None, "query": None, "warehouses": [], "brands": [], "categories": [], "warehouseTypes": [], "statuses": []}
    latest, all_items, settings, first, last, sales_revision = _overview_items(principal, options)
    included = [item for item in all_items if item.get("includedInInventory", True)]
    from django.utils import timezone
    stale = bool(latest and (timezone.localdate() - latest.snapshot_date).days > 3)
    quality = _quality(included, stale, bool(settings["autoReplenishment"]))
    metrics, health = _metrics(included, quality, bool(settings["inventoryAlert"]), health_items=_health_distribution_items(included))
    names = ["≤30天", "31–60天", "61–90天", ">90天", "近30日无销量", "销量未匹配"]
    buckets = {name: {"label": name, "knownStockValueCents": 0, "positions": 0} for name in names}
    for item in included:
        demand, days = item["sales30d"], item["coverageDays"]
        group = "销量未匹配" if demand is None else "近30日无销量" if demand <= 0 else "销量未匹配" if days is None else "≤30天" if days <= 30 else "31–60天" if days <= 60 else "61–90天" if days <= 90 else ">90天"
        buckets[group]["knownStockValueCents"] += int(item["knownStockValueCents"])
        buckets[group]["positions"] += 1
    known = int(metrics["knownStockValueCents"])
    risk = buckets[">90天"]["knownStockValueCents"] + buckets["近30日无销量"]["knownStockValueCents"]
    watched = [row for row in _bounded_items() if row.active]
    gd_all, gd_latest, *_ = _project_items(principal, watched)
    order = {key: index for index, key in enumerate(("no_stock", "urgent", "warning", "unknown", "stale", "healthy"))}
    gd_all.sort(key=lambda row: (order.get(row["risk"], 5), row["productCode"]))
    gd_counts = {risk: sum(row["risk"] == risk for row in gd_all) for risk in RISK_LABELS}
    gd_abnormal = [row for row in gd_all if row["risk"] != "healthy"]
    pending = sum(row["availableQuantity"] is None or row["leadDays"] is None or row["turnoverDays"] is None for row in gd_all)
    if _sales_revision() != sales_revision:
        raise InventoryApiError("库存与广东仓计算期间销售版本变化", code="revision_changed", status=409)
    versions = re.fullmatch(r"sales:(0|[1-9]\d*)/erp:(0|[1-9]\d*)", sales_revision)
    if versions is None:
        raise InventoryApiError("库存销售版本格式无效", code="revision_changed", status=503)
    samples = sorted((item for item in included if item["sales30d"] is None or (item["coverageDays"] or 0) > 90 or item["status"] in {"no_stock", "urgent", "warning"}), key=lambda item: -int(item["knownStockValueCents"]))[:20]
    return {"schemaVersion": "inventory-bi-cockpit-v1", "hasInventory": latest is not None,
        "snapshotDate": latest.snapshot_date.isoformat() if latest else None, "stale": stale,
        "demandWindow": {"startDate": first.isoformat() if first else None, "endDate": last.isoformat() if last else None},
        "salesRevision": f"{versions[1]}:{versions[2]}", "metrics": metrics, "quality": quality, "buckets": list(buckets.values()),
        "riskValueCents": risk, "riskShareKnown": risk / known if known > 0 else None, "health": health,
        "samples": [{key: item[key] for key in ("productCode", "productName", "warehouse", "availableQuantity", "coverageDays", "knownStockValueCents", "status", "reason")} for item in samples],
        "guangdong": {"snapshotDate": gd_latest.snapshot_date.isoformat() if gd_latest else None, "watchCount": len(watched),
            "counts": gd_counts, "pendingCount": pending, "returned": min(20, len(gd_abnormal)), "total": len(gd_all), "anomalyCount": len(gd_abnormal),
            "truncated": len(gd_abnormal) > 20,
            "items": [{key: row.get(key) for key in ("productCode", "productName", "availableQuantity", "turnoverDays", "leadDays", "bufferDays", "risk", "riskLabel", "riskReasons")} for row in gd_abnormal[:20]]},
        "limitations": ["公司库存采用最新快照及原30日正向出库窗口，不按店铺或销售选期分摊", "所有货值占比以已覆盖成本货值为基数，缺成本及缺销量分别披露", "覆盖天数不当财务周转率；广东仓风险复用生产周期、安全天数和原人工设置"]}


@require_GET
def cockpit(request):
    try:
        principal = _principal(request, {"viewer", "analyst", "operator", "admin"})
        if request.GET:
            raise InventoryApiError("库存驾驶舱不接受任意范围参数")
        with bounded_read(InventoryApiError):
            before = revision_value()
            result = projection(principal)
            if revision_value() != before:
                raise InventoryApiError("库存来源读取期间变化", code="revision_changed", status=409)
        return _json(result, revision=before)
    except Exception as error:
        return _error(error, "库存驾驶舱读取失败")
