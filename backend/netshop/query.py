from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date, timedelta

from django.db.models import Count, Max, Min, Q, Sum
from django.utils import timezone

from sales.auth import Principal

from .errors import NetshopApiError
from .models import (
    NetshopDataRevision,
    NetshopImportBatch,
    NetshopProductDailyRevision,
    NetshopProductDailyScopeRevision,
    NetshopPromotionAggregateManifest,
    NetshopPromotionAggregateState,
    NetshopPromotionProductDaily,
    NetshopPromotionScopeRevision,
    NetshopPromotionShopDaily,
    NetshopRow,
)
from .sales_client import read_sales_consumer, sales_product_metrics
from .serialization import batch_payload


MAX_DAYS = 730
MAX_PAGE = 10_000
MAX_PAGE_SIZE = 100
MAX_PROMOTION_PAGE_SIZE = 500
MAX_OUTLETS = 50
OUTLET_SEPARATOR = "\x1f"
HEX_64_RE = re.compile(r"^[a-f0-9]{64}$")


def revision_value() -> str:
    row = NetshopDataRevision.objects.filter(domain="netshop").first()
    if row is None or row.revision < 0 or not HEX_64_RE.fullmatch(row.source_digest or ""):
        raise NetshopApiError(
            "网店数据版本不可用", code="service_unavailable", status=503
        )
    return f"{row.revision}:{row.source_digest[:12]}"


def positive(raw: str | None, fallback: int, label: str, maximum: int) -> int:
    if raw is None or raw == "":
        return fallback
    if not raw.isdigit() or raw.startswith("0"):
        raise NetshopApiError(f"{label}必须为十进制正整数")
    value = int(raw)
    if value < 1 or value > maximum:
        raise NetshopApiError(f"{label}超出允许范围")
    return value


def iso_date(value: str | None, label: str) -> str:
    candidate = (value or "").strip()
    try:
        normalized = date.fromisoformat(candidate).isoformat()
    except ValueError as error:
        raise NetshopApiError(f"{label}必须是有效的 YYYY-MM-DD 自然日") from error
    if normalized != candidate:
        raise NetshopApiError(f"{label}必须是有效的 YYYY-MM-DD 自然日")
    return normalized


def period(start: str | None, end: str | None, *, required: bool = False) -> dict[str, object] | None:
    raw_start = (start or "").strip()
    raw_end = (end or "").strip()
    if not raw_start and not raw_end:
        if required:
            raise NetshopApiError("必须同时提供 startDate 和 endDate")
        return None
    if not raw_start or not raw_end:
        raise NetshopApiError("startDate 和 endDate 必须同时提供")
    start_value = iso_date(raw_start, "startDate")
    end_value = iso_date(raw_end, "endDate")
    if start_value > end_value:
        raise NetshopApiError("startDate 不能晚于 endDate")
    days = (date.fromisoformat(end_value) - date.fromisoformat(start_value)).days + 1
    if days > MAX_DAYS:
        raise NetshopApiError(f"网店统计周期最多支持 {MAX_DAYS} 天")
    return {
        "startDate": start_value,
        "endDate": end_value,
        "endExclusive": (date.fromisoformat(end_value) + timedelta(days=1)).isoformat(),
        "days": days,
    }


def normalize_platforms(values: Sequence[str]) -> list[str]:
    result = list(dict.fromkeys(value.strip() for value in values if value.strip()))
    if len(result) > 20 or any(len(item) > 100 for item in result):
        raise NetshopApiError("platform 筛选超出限制")
    if any(item not in {"京东", "天猫"} for item in result):
        raise NetshopApiError("platform 包含不支持的网店平台")
    return sorted(result)


def parse_outlets(values: Sequence[str], platforms: Sequence[str]) -> list[dict[str, str]]:
    if len(values) > MAX_OUTLETS:
        raise NetshopApiError(f"outlet 筛选最多 {MAX_OUTLETS} 项")
    result: dict[tuple[str, str], dict[str, str]] = {}
    selected_platforms = set(platforms)
    for value in values:
        if value.count(OUTLET_SEPARATOR) != 1:
            raise NetshopApiError("outlet 必须使用有效的平台与店铺复合键")
        platform, shop_name = (part.strip() for part in value.split(OUTLET_SEPARATOR, 1))
        if (
            not platform
            or not shop_name
            or len(platform) > 100
            or len(shop_name) > 100
            or platform not in {"京东", "天猫"}
            or any(ord(char) < 32 or ord(char) == 127 for char in platform + shop_name)
        ):
            raise NetshopApiError("outlet 必须使用有效的平台与店铺复合键")
        if selected_platforms and platform not in selected_platforms:
            raise NetshopApiError("outlet 平台必须属于当前 platform 筛选")
        result[(platform, shop_name)] = {"platform": platform, "shopName": shop_name}
    return [result[key] for key in sorted(result)]


def _apply_platform_outlets(queryset, platforms: Sequence[str], outlets: Sequence[Mapping[str, str]]):
    if platforms:
        queryset = queryset.filter(platform__in=platforms)
    if outlets:
        outlet_filter = Q(pk__in=[])
        for item in outlets:
            outlet_filter |= Q(platform=item["platform"], shop_name=item["shopName"])
        queryset = queryset.filter(outlet_filter)
    return queryset


def _canonical_token(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _date_sequence(start: str, end: str) -> list[str]:
    current = date.fromisoformat(start)
    final = date.fromisoformat(end)
    values: list[str] = []
    while current <= final:
        values.append(current.isoformat())
        current += timedelta(days=1)
    return values


def overview(*, shop: str | None, platforms: Sequence[str]) -> dict[str, object]:
    rows = NetshopRow.objects.all()
    if shop:
        rows = rows.filter(Q(shop_name=shop) | Q(source="inv_selfop"))
    if platforms:
        rows = rows.filter(platform__in=platforms)
    grouped = rows.values("dataset", "source", "platform").annotate(
        date_min=Min("business_date"),
        date_max=Max("business_date"),
        snapshot_date=Max("snapshot_date"),
        row_count=Count("id"),
    ).order_by("dataset", "source", "platform")
    datasets: dict[str, object] = {}
    for row in grouped:
        batches = NetshopImportBatch.objects.filter(
            dataset=row["dataset"],
            source=row["source"],
            platform=row["platform"],
            status="completed",
        )
        if shop and row["source"] != "inv_selfop":
            batches = batches.filter(shop_name=shop)
        latest = batches.order_by("-completed_at", "-created_at", "-id").first()
        datasets[str(row["dataset"])] = {
            "source": row["source"],
            "dataset": row["dataset"],
            "dateMin": row["date_min"],
            "dateMax": row["date_max"],
            "snapshotDate": row["snapshot_date"],
            "rowCount": row["row_count"],
            "latestBatchId": latest.id if latest else None,
            "latestFileName": latest.file_name if latest else None,
            "completedAt": latest.completed_at if latest else None,
        }
    return {
        "shop": shop,
        "filters": {"shop": shop},
        "datasets": datasets,
        "date_max": {
            key: value["dateMax"] for key, value in datasets.items()  # type: ignore[index]
        },
    }


def _latest_batches(sources: Sequence[str]) -> list[NetshopImportBatch]:
    ordered = NetshopImportBatch.objects.filter(
        source__in=sources, status="completed"
    ).order_by("-completed_at", "-created_at", "-id")
    result: list[NetshopImportBatch] = []
    seen: set[tuple[str, str]] = set()
    for item in ordered:
        key = (item.platform, item.shop_name)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _latest_asset_batches(scopes: Sequence[tuple[str, str]]) -> dict[tuple[str, str, str], NetshopImportBatch]:
    if not scopes:
        return {}
    requested = set(scopes)
    result: dict[tuple[str, str, str], NetshopImportBatch] = {}
    rows = NetshopImportBatch.objects.filter(
        source__in=["tmall_product_assets", "jd_yimei_sku"], status="completed"
    ).order_by("-snapshot_date", "-completed_at", "-created_at", "-id")
    for batch in rows:
        matched_scope = (batch.platform, batch.shop_name)
        if batch.source == "jd_yimei_sku" and batch.shop_name == "":
            jd_scopes = [scope for scope in requested if scope[0] == "京东"]
            for scope in jd_scopes:
                result.setdefault((batch.source, *scope), batch)
            continue
        if matched_scope in requested:
            result.setdefault((batch.source, *matched_scope), batch)
    return result


def _image_assets(
    product_rows: Sequence[NetshopRow],
    asset_batches: Mapping[tuple[str, str, str], NetshopImportBatch],
) -> dict[tuple[str, str, str], NetshopRow]:
    tmall_spus: dict[tuple[str, str], set[str]] = defaultdict(set)
    jd_ids: dict[tuple[str, str], tuple[set[str], set[str]]] = {}
    for row in product_rows:
        scope = (row.platform, row.shop_name)
        if row.platform == "天猫" and row.spu_id:
            tmall_spus[scope].add(row.spu_id)
        elif row.platform == "京东":
            sku_set, code_set = jd_ids.setdefault(scope, (set(), set()))
            if row.sku_id:
                sku_set.add(row.sku_id)
            if row.product_code:
                code_set.add(row.product_code)
    result: dict[tuple[str, str, str], NetshopRow] = {}
    for scope, spu_ids in tmall_spus.items():
        batch = asset_batches.get(("tmall_product_assets", *scope))
        if not batch:
            continue
        for asset in NetshopRow.objects.filter(last_import_batch_id=batch.id, spu_id__in=spu_ids).order_by("-id"):
            result.setdefault((scope[0], scope[1], asset.spu_id), asset)
    for scope, (sku_ids, codes) in jd_ids.items():
        batch = asset_batches.get(("jd_yimei_sku", *scope))
        if not batch:
            continue
        assets = NetshopRow.objects.filter(last_import_batch_id=batch.id).filter(
            Q(sku_id__in=sku_ids) | Q(product_code__in=codes)
        ).order_by("-snapshot_date", "-id")
        for asset in assets:
            if asset.sku_id:
                result.setdefault((scope[0], scope[1], f"sku:{asset.sku_id}"), asset)
            if asset.product_code:
                result.setdefault((scope[0], scope[1], f"code:{asset.product_code}"), asset)
    return result


def _empty_sales() -> dict[str, object]:
    return {
        "costPriceCents": None,
        "netSalesCents": None,
        "grossMarginRate": None,
        "refundRate": None,
        "salesMatched": False,
    }


def _catalog_item(row: NetshopRow, asset: NetshopRow | None, *, include_source_snapshots: bool = False) -> tuple[dict[str, object], str]:
    raw = row.raw_json
    asset_raw = asset.raw_json if asset else {}
    spu_id = row.spu_id or str(raw.get("商品ID") or raw.get("商品编码") or "").strip()
    sku_id = row.sku_id or str(raw.get("SKUID") or "").strip()
    product_code = str(raw.get("SKU商家编码") or raw.get("商品编码") or row.product_code).strip()
    sales_code = str(raw.get("商家SKU") or raw.get("SKU商家编码") or "").strip()
    image_url = ""
    if asset and asset.image_content_sha256:
        image_url = f"/api/netshop/product-images/{asset.image_content_sha256}"
    else:
        image_url = (asset.image_url if asset else "") or row.image_url
    product_url = (
        str(asset_raw.get("商品链接") or "").strip()
        or row.product_url
        or (f"https://detail.tmall.com/item.htm?id={spu_id}" if row.platform == "天猫" and spu_id else "")
    )
    item = {
        "platform": row.platform,
        "shopName": row.shop_name,
        "spuId": spu_id,
        "skuId": sku_id,
        "productCode": product_code,
        "productName": row.product_name or str(raw.get("商品名称") or "").strip(),
        "imageUrl": image_url,
        "saleAttribute": row.sale_attribute,
        "category": row.category,
        "brand": row.brand,
        "price": row.price_cents / 100 if row.price_cents is not None else None,
        "priceCents": row.price_cents,
        "totalInventory": row.total_inventory,
        "availableInventory": row.available_inventory,
        "status": row.product_status,
        "productUrl": product_url,
        "createdAt": row.source_created_at,
        "snapshotDate": row.snapshot_date,
        **_empty_sales(),
    }
    if include_source_snapshots:
        image_date = asset.snapshot_date if asset and (asset.image_content_sha256 or asset.image_url) else row.snapshot_date if row.image_url else None
        item["catalogSnapshotDates"] = {"master": row.snapshot_date, "price": row.snapshot_date, "inventory": row.snapshot_date, "image": image_date}
    return item, sales_code


def product_catalog(
    principal: Principal,
    *,
    query: str,
    page: int,
    page_size: int,
    platforms: Sequence[str],
    outlets: Sequence[Mapping[str, str]],
    sales_period: Mapping[str, object] | None,
    view: str,
    expected_snapshot_token: str | None,
    catalog_filters: Mapping[str, object] | None = None,
) -> dict[str, object]:
    if len(query) > 120:
        raise NetshopApiError("q 最多 120 个字符")
    if view not in {"full", "page"}:
        raise NetshopApiError("view 必须是 full 或 page")
    sales_freshness, opening_sales_revision = read_sales_consumer(
        principal, {"operation": "freshness"}
    )
    batches_all = _latest_batches(["jd_product_master", "tmall_product_master"])
    visible = [item for item in batches_all if not platforms or item.platform in platforms]
    outlet_keys = {(item["platform"], item["shopName"]) for item in outlets}
    selected = [
        item
        for item in visible
        if not outlet_keys or (item.platform, item.shop_name) in outlet_keys
    ]
    asset_batches = _latest_asset_batches([(item.platform, item.shop_name) for item in selected])
    filter_binding = None
    filter_capabilities = None
    as_of_date = timezone.localdate()
    if catalog_filters and catalog_filters.get("requested"):
        from .catalog_filters import catalog_filter_binding
        filter_capabilities = {
            "latestMaster": True,
            "scopeKey": _canonical_token({"platforms": list(platforms), "outlets": list(outlets), "principal": [principal.email, principal.role, principal.scope], "heads": sorted((b.platform, b.shop_name, b.source, b.id) for b in selected)}),
            "sourceVersion": revision_value(),
            "fields": {key: True for key in ("product_status", "catalog_code", "category", "snapshot_date", "image_lookup", "exact_identity")},
        }
        # The legacy JD renderer also accepts globally shared and code-fallback
        # images. The new exact-shop/SKU predicate cannot prove that lookup yet.
        # Keep the renderer; refuse an unsupported quality filter explicitly.
        filter_capabilities["fields"]["image_lookup"] = not any(b.platform == "京东" for b in selected)
        filter_binding = catalog_filter_binding(catalog_filters, as_of_date=as_of_date, capabilities=filter_capabilities)
    snapshot_input = {
            "version": 2,
            "kind": "catalog",
            "revision": revision_value(),
            "salesRevision": opening_sales_revision,
            "platforms": list(platforms),
            "outlets": list(outlets),
            "salesPeriod": sales_period,
            "query": query,
            "heads": [
                [item.id, item.source, item.platform, item.shop_name, item.snapshot_date]
                for item in selected
            ],
            "assetHeads": sorted(
                [key + (value.id, value.snapshot_date or "") for key, value in asset_batches.items()]
            ),
        }
    if filter_binding is not None:
        snapshot_input["catalogFilters"] = filter_binding
    snapshot = _canonical_token(snapshot_input)
    if view == "page" and expected_snapshot_token != snapshot:
        raise NetshopApiError(
            "货品目录版本已变化，请重新加载",
            code="service_unavailable",
            status=503,
        )
    shops = sorted(
        [
            {
                "shopName": item.shop_name,
                "platform": item.platform,
                "snapshotDate": item.snapshot_date,
                "completedAt": item.completed_at,
            }
            for item in visible
        ],
        key=lambda item: (str(item["platform"]), str(item["shopName"])),
    )
    batch_ids = [item.id for item in selected]
    rows = NetshopRow.objects.filter(
        source__in=["jd_product_master", "tmall_product_master"],
        dataset="product_master",
        last_import_batch_id__in=batch_ids,
    )
    authoritative_total = sum(item.row_count for item in selected)
    if rows.count() != authoritative_total:
        raise NetshopApiError(
            "货品目录批次元数据与已发布事实不一致",
            code="service_unavailable",
            status=503,
        )
    summary = rows.aggregate(
        totalSkus=Count("id"),
        totalInventory=Sum("inventory_quantity"),
        availableInventory=Sum("inventory_quantity"),
    )
    on_sale = rows.filter(product_status="上架").count()
    if filter_binding is not None:
        from .catalog_filters import apply_catalog_filters
        rows = apply_catalog_filters(rows, catalog_filters, as_of_date=as_of_date, capabilities=filter_capabilities)
    if query:
        rows = rows.filter(
            Q(shop_name__icontains=query)
            | Q(spu_id__icontains=query)
            | Q(sku_id__icontains=query)
            | Q(product_code__icontains=query)
            | Q(product_name__icontains=query)
        )
    total = rows.count()
    offset = (page - 1) * page_size
    product_rows = list(
        rows.order_by("shop_name", "product_name", "sku_id", "platform", "id")[
            offset : offset + page_size
        ]
    )
    assets = _image_assets(product_rows, asset_batches)
    internal_items: list[tuple[dict[str, object], str]] = []
    for row in product_rows:
        asset = None
        if row.platform == "天猫":
            asset = assets.get((row.platform, row.shop_name, row.spu_id))
        else:
            asset = assets.get((row.platform, row.shop_name, f"sku:{row.sku_id}")) or assets.get(
                (row.platform, row.shop_name, f"code:{row.product_code}")
            )
        internal_items.append(_catalog_item(row, asset, include_source_snapshots=filter_binding is not None))
    outlet_scopes = [
        {"platform": item.platform, "shopName": item.shop_name}
        for item in selected
        if item.platform == "京东"
    ]
    allowed_channels = principal.scope["channels"] if principal.scope is not None else None
    metrics, sales_data, metrics_revision = sales_product_metrics(
        principal,
        identities=[
            {
                "platform": str(item["platform"]),
                "shopName": str(item["shopName"]),
                "salesProductCode": sales_code,
            }
            for item, sales_code in internal_items
            if item["platform"] == "京东"
        ],
        outlets=outlet_scopes,
        start_date=str(sales_period["startDate"]) if sales_period else None,
        end_exclusive=str(sales_period["endExclusive"]) if sales_period else None,
        allowed_channels=allowed_channels,
    )
    if metrics_revision != opening_sales_revision:
        raise NetshopApiError(
            "货品目录读取期间销售数据已更新",
            code="service_unavailable",
            status=503,
        )
    items: list[dict[str, object]] = []
    for item, sales_code in internal_items:
        if item["platform"] == "京东":
            item.update(metrics.get((str(item["platform"]), str(item["shopName"]), sales_code), _empty_sales()))
        items.append(item)
    closing_freshness, closing_sales_revision = read_sales_consumer(
        principal, {"operation": "freshness"}
    )
    if closing_sales_revision != opening_sales_revision:
        raise NetshopApiError(
            "货品目录读取期间销售数据已更新",
            code="service_unavailable",
            status=503,
        )
    page_payload: dict[str, object] = {
        "snapshotToken": snapshot,
        "items": items,
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total,
            "returned": len(items),
            "truncated": offset + len(items) < total,
        },
    }
    if filter_binding is not None:
        page_payload["catalogFilters"] = {**filter_binding, "summaryBasis": "complete_store_set_before_table_filters", "filteredRows": total}
        page_payload["catalogFilterCapabilities"] = {"mapping": {"supportedValues": ["all"], "reasonCode": "unverified_source"}, "unverified_mapping": {"supported": False, "reasonCode": "unverified_source"}, "missing_image": {"supported": filter_capabilities["fields"]["image_lookup"], "reasonCode": None if filter_capabilities["fields"]["image_lookup"] else "unverified_source"}}
    if view == "page":
        return page_payload
    return {
        **page_payload,
        "batch": batch_payload(selected[0]) if selected else None,
        "summary": {
            "totalSkus": summary["totalSkus"] or 0,
            "onSaleSkus": on_sale,
            "totalInventory": summary["totalInventory"] or 0,
            "availableInventory": summary["availableInventory"] or 0,
        },
        "shops": shops,
        "sales": {
            "periodStart": sales_period["startDate"] if sales_period else None,
            "periodEnd": sales_period["endDate"] if sales_period else None,
            "dataCutoffDate": sales_data.get("dataCutoffDate"),
            "platform": sales_data.get("platform", "京东"),
        },
    }


def product_image_metadata(content_hash: str, platforms: Sequence[str]) -> dict[str, object] | None:
    normalized = content_hash.strip().lower()
    if not HEX_64_RE.fullmatch(normalized) or not platforms:
        return None
    row = (
        NetshopRow.objects.filter(
            source="tmall_product_assets",
            dataset="spu_assets",
            platform__in=platforms,
            image_content_sha256=normalized,
            last_import_batch_id__in=NetshopImportBatch.objects.filter(
                source="tmall_product_assets", dataset="spu_assets", status="completed"
            ).values("id"),
        )
        .order_by("-snapshot_date", "-id")
        .first()
    )
    if not row:
        return None
    return {
        "contentHash": row.image_content_sha256,
        "objectKey": row.image_object_key,
        "mimeType": row.image_mime_type,
        "sizeBytes": row.image_size_bytes,
    }


PERFORMANCE_SUM_FIELDS = (
    "page_views",
    "visitors",
    "search_impressions",
    "search_clicks",
    "add_cart_customers",
    "add_cart_quantity",
    "order_customers",
    "order_quantity",
    "order_amount_cents",
    "transaction_orders",
    "transaction_amount_cents",
    "transaction_quantity",
    "transaction_customers",
    "favorites",
    "refund_amount_cents",
    "search_visitors",
    "search_transaction_customers",
)

PERFORMANCE_FIELD_ALIASES = {
    "page_views": ("pageViews", "商品浏览量"), "visitors": ("visitors", "商品访客数"),
    "search_impressions": ("searchImpressions", "搜索曝光次数"), "search_clicks": ("searchClicks", "搜索点击次数"),
    "add_cart_customers": ("addCartCustomers", "加购客户数"), "add_cart_quantity": ("addCartQuantity", "加购商品件数"),
    "order_customers": ("orderCustomers", "下单客户数"), "order_quantity": ("orderQuantity", "下单商品件数"),
    "order_amount_cents": ("orderAmountCents", "下单金额"), "transaction_orders": ("transactionOrders", "成交单量"),
    "transaction_amount_cents": ("transactionAmountCents", "成交金额"), "transaction_quantity": ("transactionQuantity", "成交商品件数"),
    "transaction_customers": ("transactionCustomers", "成交客户数"), "favorites": ("favorites",),
    "refund_amount_cents": ("refundAmountCents",), "search_visitors": ("searchVisitors",),
    "search_transaction_customers": ("searchTransactionCustomers",),
}


def _sum_annotations(fields: Sequence[str] = PERFORMANCE_SUM_FIELDS) -> dict[str, object]:
    return {field: Sum(field) for field in fields}


def _zero(value: object) -> int:
    return int(value or 0)


def _performance_summary_payload(
    aggregate: Mapping[str, object],
    *,
    snapshot: str,
    dimension: str,
    requested_period: Mapping[str, object] | None,
) -> dict[str, object]:
    visitors = _zero(aggregate.get("visitors"))
    transaction_customers = _zero(aggregate.get("transaction_customers"))
    search_impressions = _zero(aggregate.get("search_impressions"))
    search_clicks = _zero(aggregate.get("search_clicks"))
    transaction_amount_cents = _zero(aggregate.get("transaction_amount_cents"))
    order_amount_cents = _zero(aggregate.get("order_amount_cents"))
    return {
        "snapshotToken": snapshot,
        "dimension": dimension,
        "dataset": "sku_daily" if dimension == "sku" else "spu_daily",
        "requestedPeriod": {
            "startDate": requested_period["startDate"] if requested_period else None,
            "endDate": requested_period["endDate"] if requested_period else None,
        },
        "dateMin": aggregate.get("date_min"),
        "dataCutoffDate": aggregate.get("date_max"),
        "monetaryUnit": "cents",
        "visitorAggregation": "product_day_sum",
        "summary": {
            "productCount": _zero(aggregate.get("product_count")),
            "pageViews": _zero(aggregate.get("page_views")),
            "visitors": visitors,
            "searchImpressions": search_impressions,
            "searchClicks": search_clicks,
            "searchClickRate": search_clicks / search_impressions if search_impressions > 0 else None,
            "addCartCustomers": _zero(aggregate.get("add_cart_customers")),
            "addCartQuantity": _zero(aggregate.get("add_cart_quantity")),
            "orderCustomers": _zero(aggregate.get("order_customers")),
            "orderQuantity": _zero(aggregate.get("order_quantity")),
            "orderAmount": order_amount_cents / 100,
            "orderAmountCents": order_amount_cents,
            "transactionOrders": _zero(aggregate.get("transaction_orders")),
            "transactionAmount": transaction_amount_cents / 100,
            "transactionAmountCents": transaction_amount_cents,
            "transactionQuantity": _zero(aggregate.get("transaction_quantity")),
            "transactionCustomers": transaction_customers,
            "favorites": _zero(aggregate.get("favorites")),
            "refundAmountCents": _zero(aggregate.get("refund_amount_cents")),
            "searchVisitors": _zero(aggregate.get("search_visitors")),
            "searchTransactionCustomers": _zero(aggregate.get("search_transaction_customers")),
            "uvValue": transaction_amount_cents / 100 / visitors if visitors > 0 else None,
            "conversionRate": transaction_customers / visitors if visitors > 0 else None,
        },
    }


def _performance_assets(
    grouped: Sequence[Mapping[str, object]],
) -> dict[tuple[str, str, str], NetshopRow]:
    scopes = {(str(item["platform"]), str(item["shop_name"])) for item in grouped}
    heads = _latest_asset_batches(sorted(scopes))
    result: dict[tuple[str, str, str], NetshopRow] = {}
    for scope in scopes:
        tmall_head = heads.get(("tmall_product_assets", *scope))
        if tmall_head:
            spus = {str(item.get("spu_id") or "") for item in grouped if (item["platform"], item["shop_name"]) == scope}
            for row in NetshopRow.objects.filter(last_import_batch_id=tmall_head.id, spu_id__in=spus).order_by("-id"):
                result.setdefault((scope[0], scope[1], f"spu:{row.spu_id}"), row)
        jd_head = heads.get(("jd_yimei_sku", *scope))
        if jd_head:
            sku_ids = {str(item.get("sku_id") or "") for item in grouped if (item["platform"], item["shop_name"]) == scope}
            product_codes = {str(item.get("product_code") or "") for item in grouped if (item["platform"], item["shop_name"]) == scope}
            for row in NetshopRow.objects.filter(last_import_batch_id=jd_head.id).filter(
                Q(sku_id__in=sku_ids) | Q(product_code__in=product_codes)
            ).order_by("-snapshot_date", "-id"):
                if row.sku_id:
                    result.setdefault((scope[0], scope[1], f"sku:{row.sku_id}"), row)
                if row.product_code:
                    result.setdefault((scope[0], scope[1], f"code:{row.product_code}"), row)
    return result


def product_performance(
    *,
    dimension: str,
    query: str,
    page: int,
    page_size: int,
    platforms: Sequence[str],
    outlets: Sequence[Mapping[str, str]],
    requested_period: Mapping[str, object] | None,
    view: str,
    expected_snapshot_token: str | None,
    identities: Sequence[tuple[str, str, str, str]] = (),
    expected_source_revision: str | None = None,
) -> dict[str, object]:
    if dimension not in {"sku", "spu"}:
        raise NetshopApiError("dimension 必须且只能是 sku 或 spu")
    if view not in {"summary", "full", "page", "identities"}:
        raise NetshopApiError("view 必须是 summary、full、page 或 identities")
    if len(query) > 120:
        raise NetshopApiError("q 最多 120 个字符")
    dataset = "sku_daily" if dimension == "sku" else "spu_daily"
    identity_field = "sku_id" if dimension == "sku" else "spu_id"
    source_filter = Q(source="jd_sku_daily") if dimension == "sku" else Q(
        source__in=["jd_sku_daily", "tmall_product_daily"]
    )
    unrestricted = NetshopRow.objects.filter(source_filter, dataset=dataset).exclude(
        **{identity_field: ""}
    )
    unrestricted = _apply_platform_outlets(unrestricted, platforms, outlets)
    available = unrestricted.aggregate(date_min=Min("business_date"), date_max=Max("business_date"))
    rows = unrestricted
    if requested_period:
        rows = rows.filter(
            business_date__gte=requested_period["startDate"],
            business_date__lt=requested_period["endExclusive"],
        )
    if query:
        query_filter = (
            Q(sku_id__icontains=query)
            | Q(spu_id__icontains=query)
            | Q(product_code__icontains=query)
            | Q(product_name__icontains=query)
        )
        query_filter |= Q(**{f"{identity_field}__icontains": query})
        rows = rows.filter(query_filter)
    revision = revision_value()
    if view == "identities":
        if not identities or len(identities) > 100 or expected_source_revision != revision:
            raise NetshopApiError("精确配对来源版本已变化或身份无效", code="insights_revision_changed", status=409)
        exact = Q(pk__in=[])
        for platform, name, kind, product in identities:
            if kind != dimension:
                raise NetshopApiError("配对维度不一致")
            exact |= Q(platform=platform, shop_name=name, **{identity_field: product})
        rows = rows.filter(exact)
    scope_revisions = list(
        NetshopProductDailyScopeRevision.objects.filter(
            platform__in=platforms or ["京东", "天猫"]
        ).values_list("platform", "shop_name", "data_version")
    )
    snapshot = _canonical_token(
        {
            "version": 2,
            "kind": "product-performance",
            "revision": revision,
            "dimension": dimension,
            "query": query,
            "period": requested_period,
            "platforms": list(platforms),
            "outlets": list(outlets),
            "identities": list(identities),
            "scopeRevisions": sorted(scope_revisions),
        }
    )
    if view == "page" and expected_snapshot_token != snapshot:
        raise NetshopApiError(
            "商品日数据版本已变化，请重新加载",
            code="service_unavailable",
            status=503,
        )
    identity_values = ("platform", "shop_name", identity_field)
    product_count = rows.values(*identity_values).distinct().count()
    from .store_overview import NumericMetricPresent
    aggregate = rows.aggregate(
        date_min=Min("business_date"),
        date_max=Max("business_date"),
        date_count=Count("business_date", distinct=True),
        **_sum_annotations(),
        row_count=Count("id"),
        **{field+"_present": Count("id", filter=NumericMetricPresent(aliases)) for field, aliases in PERFORMANCE_FIELD_ALIASES.items()},
    )
    aggregate["product_count"] = product_count
    summary_payload = _performance_summary_payload(
        aggregate,
        snapshot=snapshot,
        dimension=dimension,
        requested_period=requested_period,
    )
    summary_payload["sourceRevision"] = revision
    selected_shops = {(o["platform"], o["shopName"]) for o in outlets} if outlets else set(unrestricted.values_list("platform", "shop_name").distinct()[:MAX_OUTLETS+1])
    if len(selected_shops) > MAX_OUTLETS:
        raise NetshopApiError("商品表现店铺超过50家，请缩小范围")
    expected_pairs = len(selected_shops)*int(requested_period["days"]) if requested_period else 0
    actual_pairs = rows.values("platform", "shop_name", "business_date").distinct().count()
    safe_limit = 9_007_199_254_740_991
    summary_payload["summaryFieldAvailability"] = {
        aliases[0]: {"complete": expected_pairs > 0 and actual_pairs == expected_pairs and aggregate[field+"_present"] == aggregate["row_count"] and abs(_zero(aggregate[field])) <= safe_limit,
                     "reasonCode": "unsafe_integer" if abs(_zero(aggregate[field])) > safe_limit else "missing_field" if aggregate[field+"_present"] != aggregate["row_count"] else "incomplete_coverage" if expected_pairs == 0 or actual_pairs != expected_pairs else None}
        for field, aliases in PERFORMANCE_FIELD_ALIASES.items()
    }
    if view == "summary":
        return summary_payload
    grouped = rows.values(*identity_values).annotate(
        sku_id_value=Max("sku_id"),
        spu_id_value=Max("spu_id"),
        product_code_value=Max("product_code"),
        product_name_value=Max("product_name"),
        category_value=Max("category"),
        date_min=Min("business_date"),
        date_max=Max("business_date"),
        data_days=Count("business_date", distinct=True),
        **_sum_annotations(),
    ).order_by("-transaction_amount_cents", "-visitors", identity_field)
    offset = (page - 1) * page_size
    if view == "identities": offset, page_size = 0, len(identities)
    grouped_page = list(grouped[offset : offset + page_size])
    presence_filter = Q(pk__in=[])
    for selected in grouped_page:
        presence_filter |= Q(platform=selected["platform"], shop_name=selected["shop_name"], **{identity_field: selected[identity_field]})
    presence_by_identity = {(r["platform"], r["shop_name"], r[identity_field]): r for r in rows.filter(presence_filter).values(*identity_values).annotate(
        row_count=Count("id"),
        **{field+"_present": Count("id", filter=NumericMetricPresent(aliases)) for field, aliases in PERFORMANCE_FIELD_ALIASES.items()},
    )} if grouped_page else {}
    assets = _performance_assets(grouped_page)
    items: list[dict[str, object]] = []
    for row in grouped_page:
        row.update(presence_by_identity[(row["platform"], row["shop_name"], row[identity_field])])
        platform = str(row["platform"])
        shop_name = str(row["shop_name"])
        sku_id = str(row["sku_id_value"] or "")
        spu_id = str(row["spu_id_value"] or "")
        product_code = str(row["product_code_value"] or "")
        asset = assets.get((platform, shop_name, f"spu:{spu_id}")) if platform == "天猫" else (
            assets.get((platform, shop_name, f"sku:{sku_id}"))
            or assets.get((platform, shop_name, f"code:{product_code}"))
        )
        image_url = ""
        product_url = ""
        if asset:
            image_url = (
                f"/api/netshop/product-images/{asset.image_content_sha256}"
                if asset.image_content_sha256
                else asset.image_url
            )
            product_url = asset.product_url
        if not product_url and platform == "天猫" and spu_id:
            product_url = f"https://detail.tmall.com/item.htm?id={spu_id}"
        visitors = _zero(row["visitors"])
        transaction_customers = _zero(row["transaction_customers"])
        search_impressions = _zero(row["search_impressions"])
        search_clicks = _zero(row["search_clicks"])
        transaction_amount = _zero(row["transaction_amount_cents"])
        order_amount = _zero(row["order_amount_cents"])
        items.append(
            {
                "id": str(row[identity_field]),
                "platform": platform,
                "skuId": sku_id,
                "spuId": spu_id,
                "productCode": product_code,
                "productName": str(row["product_name_value"] or ""),
                "imageUrl": image_url,
                "productUrl": product_url,
                "category": str(row["category_value"] or ""),
                "shopNames": [shop_name],
                "dateMin": row["date_min"],
                "dateMax": row["date_max"],
                "dataDays": _zero(row["data_days"]),
                "pageViews": _zero(row["page_views"]),
                "visitors": visitors,
                "searchImpressions": search_impressions,
                "searchClicks": search_clicks,
                "searchClickRate": search_clicks / search_impressions if search_impressions > 0 else None,
                "addCartCustomers": _zero(row["add_cart_customers"]),
                "addCartQuantity": _zero(row["add_cart_quantity"]),
                "orderCustomers": _zero(row["order_customers"]),
                "orderQuantity": _zero(row["order_quantity"]),
                "orderAmount": order_amount / 100,
                "orderAmountCents": order_amount,
                "transactionOrders": _zero(row["transaction_orders"]),
                "transactionAmount": transaction_amount / 100,
                "transactionAmountCents": transaction_amount,
                "transactionQuantity": _zero(row["transaction_quantity"]),
                "transactionCustomers": transaction_customers,
                "favorites": _zero(row["favorites"]),
                "refundAmountCents": _zero(row["refund_amount_cents"]),
                "searchVisitors": _zero(row["search_visitors"]),
                "searchTransactionCustomers": _zero(row["search_transaction_customers"]),
                "uvValue": transaction_amount / 100 / visitors if visitors > 0 else None,
                "conversionRate": transaction_customers / visitors if visitors > 0 else None,
                "fieldAvailability": {aliases[0]: {"complete": bool(requested_period) and row["data_days"] == requested_period["days"] and row[field+"_present"] == row["row_count"] and abs(_zero(row[field])) <= safe_limit,
                                                   "reasonCode": "unsafe_integer" if abs(_zero(row[field])) > safe_limit else "missing_field" if row[field+"_present"] != row["row_count"] else "incomplete_coverage" if not requested_period or row["data_days"] != requested_period["days"] else None}
                                      for field, aliases in PERFORMANCE_FIELD_ALIASES.items()},
            }
        )
    page_payload: dict[str, object] = {
        "snapshotToken": snapshot,
        "sourceRevision": revision,
        "items": items,
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": product_count,
            "returned": len(items),
            "truncated": offset + len(items) < product_count,
        },
    }
    if view == "identities":
        found = {(i["platform"], i["shopNames"][0], dimension, i["id"]) for i in items}
        return {**page_payload, "unmatched": [list(i) for i in identities if i not in found], "pairing": "exact_identity", "dimension": dimension}
    if view == "page":
        return page_payload
    daily_total = int(aggregate["date_count"] or 0)
    daily_rows = list(
        rows.values("business_date")
        .annotate(
            page_views=Sum("page_views"),
            visitors=Sum("visitors"),
            transaction_customers=Sum("transaction_customers"),
            transaction_quantity=Sum("transaction_quantity"),
            transaction_amount_cents=Sum("transaction_amount_cents"),
            refund_amount_cents=Sum("refund_amount_cents"),
            favorites=Sum("favorites"),
            add_cart_customers=Sum("add_cart_customers"),
            add_cart_quantity=Sum("add_cart_quantity"),
        )
        .order_by("-business_date")[:MAX_DAYS]
    )
    daily_rows.reverse()
    actual_dates = [str(item["business_date"]) for item in daily_rows]
    missing_dates = (
        sorted(
            set(_date_sequence(str(requested_period["startDate"]), str(requested_period["endDate"])))
            - set(actual_dates)
        )
        if requested_period
        else []
    )
    shops = list(
        rows.values("platform", "shop_name")
        .annotate(product_count=Count(identity_field, distinct=True))
        .order_by("platform", "shop_name")[:MAX_OUTLETS]
    )
    return {
        **summary_payload,
        **page_payload,
        "coverage": {
            "actualDates": actual_dates,
            "missingDates": missing_dates,
            "availableDateMin": available["date_min"],
            "availableDateMax": available["date_max"],
            "total": daily_total,
            "returned": len(actual_dates),
            "truncated": len(actual_dates) < daily_total,
        },
        "platforms": sorted({str(item["platform"]) for item in shops}),
        "shops": [
            {
                "shopName": item["shop_name"],
                "platform": item["platform"],
                "productCount": _zero(item["product_count"]),
            }
            for item in shops
        ],
        "daily": [
            {
                "date": item["business_date"],
                "pageViews": _zero(item["page_views"]),
                "visitors": _zero(item["visitors"]),
                "transactionCustomers": _zero(item["transaction_customers"]),
                "transactionQuantity": _zero(item["transaction_quantity"]),
                "transactionAmountCents": _zero(item["transaction_amount_cents"]),
                "refundAmountCents": _zero(item["refund_amount_cents"]),
                "favorites": _zero(item["favorites"]),
                "addCartCustomers": _zero(item["add_cart_customers"]),
                "addCartQuantity": _zero(item["add_cart_quantity"]),
            }
            for item in daily_rows
        ],
        "dailyPagination": {
            "total": daily_total,
            "returned": len(daily_rows),
            "truncated": len(daily_rows) < daily_total,
        },
    }


PROMOTION_SUM_FIELDS = (
    "spend_cents",
    "net_transaction_amount_cents",
    "gross_transaction_amount_cents",
    "impressions",
    "clicks",
    "net_orders",
    "favorites",
    "cart_quantity",
)


def _promotion_scope(
    *,
    platforms: Sequence[str],
    outlets: Sequence[Mapping[str, str]],
    requested_period: Mapping[str, object] | None,
    expected_snapshot_token: str | None = None,
) -> tuple[object, object, str]:
    if requested_period is None:
        raise NetshopApiError("推广聚合查询必须显式提供 startDate 和 endDate")
    if not platforms:
        raise NetshopApiError("推广聚合查询必须显式选择京东或天猫平台")
    shops = NetshopPromotionShopDaily.objects.filter(
        platform__in=platforms,
        business_date__gte=requested_period["startDate"],
        business_date__lte=requested_period["endDate"],
    )
    products = NetshopPromotionProductDaily.objects.filter(
        platform__in=platforms,
        business_date__gte=requested_period["startDate"],
        business_date__lte=requested_period["endDate"],
    )
    shops = _apply_platform_outlets(shops, platforms, outlets)
    products = _apply_platform_outlets(products, platforms, outlets)
    active_platforms = sorted(
        {
            item["platform"]
            for item in outlets
            if item["platform"] in platforms
        }
        if outlets
        else set(platforms)
    )
    manifests = {
        item.platform: item
        for item in NetshopPromotionAggregateManifest.objects.filter(
            platform__in=active_platforms
        )
    }
    if any(platform not in manifests or not manifests[platform].ready for platform in active_platforms):
        raise NetshopApiError(
            "所选推广聚合尚未完成回填或已失效",
            code="service_unavailable",
            status=503,
        )
    scope_revisions = list(
        NetshopPromotionScopeRevision.objects.filter(platform__in=active_platforms).values_list(
            "platform", "shop_name", "data_version"
        )
    )
    product_revisions = list(
        NetshopProductDailyScopeRevision.objects.filter(platform__in=active_platforms).values_list(
            "platform", "shop_name", "data_version"
        )
    )
    snapshot = _canonical_token(
        {
            "version": 2,
            "kind": "promotion",
            "revision": revision_value(),
            "period": requested_period,
            "platforms": list(platforms),
            "outlets": list(outlets),
            "manifests": sorted(
                (platform, manifests[platform].data_version) for platform in active_platforms
            ),
            "promotionRevisions": sorted(scope_revisions),
            "productDailyRevisions": sorted(product_revisions),
        }
    )
    if expected_snapshot_token and expected_snapshot_token != snapshot:
        raise NetshopApiError(
            "推广商品与概览数据版本已变化，请重新加载",
            code="service_unavailable",
            status=503,
        )
    return shops, products, snapshot


def _payment_daily(
    *,
    platforms: Sequence[str],
    outlets: Sequence[Mapping[str, str]],
    requested_period: Mapping[str, object],
) -> dict[tuple[str, str, str], dict[str, object]]:
    rows = NetshopRow.objects.filter(
        Q(source="tmall_product_daily", dataset="spu_daily", platform="天猫")
        | Q(source="jd_sku_daily", dataset="sku_daily", platform="京东"),
        business_date__gte=requested_period["startDate"],
        business_date__lte=requested_period["endDate"],
    )
    rows = _apply_platform_outlets(rows, platforms, outlets)
    from .store_overview import NumericMetricPresent
    rows = rows.filter(last_import_batch_id__in=NetshopImportBatch.objects.filter(status="completed").values("id"))
    return {
        (str(item["platform"]), str(item["shop_name"]), str(item["business_date"])): item
        for item in rows.values("platform", "shop_name", "business_date")
        .annotate(payment=Sum("transaction_amount_cents"), row_count=Count("id"), present=Count("id", filter=NumericMetricPresent(("transactionAmountCents", "成交金额"))))
        .order_by("platform", "shop_name", "business_date")
    }


def promotion_overview(
    *,
    platforms: Sequence[str],
    outlets: Sequence[Mapping[str, str]],
    requested_period: Mapping[str, object],
    expected_snapshot_token: str | None = None,
) -> dict[str, object]:
    shops, products, snapshot = _promotion_scope(
        platforms=platforms,
        outlets=outlets,
        requested_period=requested_period,
        expected_snapshot_token=expected_snapshot_token,
    )
    daily_rows = list(
        shops.values("business_date")
        .annotate(**_sum_annotations(PROMOTION_SUM_FIELDS))
        .order_by("business_date")[:MAX_DAYS]
    )
    aggregate = shops.aggregate(
        date_min=Min("business_date"),
        date_max=Max("business_date"),
        date_count=Count("business_date", distinct=True),
        **_sum_annotations(PROMOTION_SUM_FIELDS),
    )
    product_count = products.values("platform", "shop_name", "product_id").distinct().count()
    payment_pairs = _payment_daily(
        platforms=platforms, outlets=outlets, requested_period=requested_period
    )
    promotion_pairs = {(r["platform"], r["shop_name"], r["business_date"]): r for r in shops.values("platform", "shop_name", "business_date", "spend_cents", "net_transaction_amount_cents", "source_row_count")}
    from .store_overview import aggregate as source_aggregate, PROMOTION
    valid_promotion = {}
    for platform in platforms:
        source, dataset = ("jd_promotion", "ad") if platform == "京东" else ("tmall_promotion", "promotion_daily")
        raw = NetshopRow.objects.filter(platform=platform, source=source, dataset=dataset, business_date__gte=requested_period["startDate"], business_date__lte=requested_period["endDate"], last_import_batch_id__in=NetshopImportBatch.objects.filter(status="completed").values("id"))
        raw = _apply_platform_outlets(raw, platforms, outlets)
        valid_promotion.update({(platform, name, day): r for (name, day), r in source_aggregate(raw, PROMOTION).items()})
    if outlets:
        identities = {(o["platform"], o["shopName"]) for o in outlets}
    else:
        identities = set(NetshopRow.objects.filter(platform__in=platforms, source__in=["jd_sku_daily", "tmall_product_daily", "jd_promotion", "tmall_promotion"]).values_list("platform", "shop_name").distinct()[:MAX_OUTLETS+1])
        identities |= set(NetshopPromotionShopDaily.objects.filter(platform__in=platforms).values_list("platform", "shop_name").distinct()[:MAX_OUTLETS+1])
        identities.discard(("京东", "")); identities.discard(("天猫", ""))
    if len(identities) > MAX_OUTLETS:
        raise NetshopApiError("费率店铺范围超过50家，请明确筛选店铺")
    requested_dates = _date_sequence(str(requested_period["startDate"]), str(requested_period["endDate"]))
    expected_pairs = {(p, n, d) for p, n in identities for d in requested_dates}
    states = {(r["platform"], r["shop_name"], r["business_date"]): r for r in _apply_platform_outlets(NetshopPromotionAggregateState.objects.filter(platform__in=platforms, business_date__gte=requested_period["startDate"], business_date__lte=requested_period["endDate"]), platforms, outlets).values("platform", "shop_name", "business_date", "ready", "raw_row_count")}
    # Exact store-day intersection with source-field presence and aggregate
    # reconciliation, never A's ad divided by B's payment on the same date.
    matched_pairs = {key for key in expected_pairs if key in payment_pairs and key in promotion_pairs and key in valid_promotion
                     and payment_pairs[key]["present"] == payment_pairs[key]["row_count"]
                     and valid_promotion[key]["spend_present"] == valid_promotion[key]["row_count"]
                     and valid_promotion[key]["promotionPayment_present"] == valid_promotion[key]["row_count"]
                     and valid_promotion[key]["row_count"] == promotion_pairs[key]["source_row_count"]
                     and key in states and states[key]["ready"] and states[key]["raw_row_count"] == valid_promotion[key]["row_count"]
                     and valid_promotion[key]["spend"] == promotion_pairs[key]["spend_cents"]
                     and valid_promotion[key]["promotionPayment"] == promotion_pairs[key]["net_transaction_amount_cents"]}
    complete_pairs = bool(expected_pairs) and matched_pairs == expected_pairs
    payment_by_date = defaultdict(int)
    for key in matched_pairs: payment_by_date[key[2]] += _zero(payment_pairs[key]["payment"])
    complete_dates = {d for d in requested_dates if identities and all((p, n, d) in matched_pairs for p, n in identities)}
    daily_by_date = {str(item["business_date"]): item for item in daily_rows}
    promotion_dates = sorted(daily_by_date)
    product_daily_dates = sorted({key[2] for key in payment_pairs})
    intersection_dates = sorted({key[2] for key in matched_pairs})
    ratio_spend = sum(_zero(promotion_pairs[k]["spend_cents"]) for k in matched_pairs)
    ratio_transaction = sum(_zero(promotion_pairs[k]["net_transaction_amount_cents"]) for k in matched_pairs)
    platform_payment = sum(_zero(payment_pairs[k]["payment"]) for k in matched_pairs)
    spend = _zero(aggregate["spend_cents"])
    net = _zero(aggregate["net_transaction_amount_cents"])
    impressions = _zero(aggregate["impressions"])
    clicks = _zero(aggregate["clicks"])
    option_rows = NetshopPromotionShopDaily.objects.filter(platform__in=platforms)
    option_values = list(
        option_rows.values("platform", "shop_name")
        .distinct()
        .order_by("platform", "shop_name")[:MAX_OUTLETS]
    )
    option_total = option_rows.values("platform", "shop_name").distinct().count()
    return {
        "snapshotToken": snapshot,
        "monetaryUnit": "cents",
        "requestedPeriod": {
            "startDate": requested_period["startDate"],
            "endDate": requested_period["endDate"],
        },
        "dataCutoffDate": aggregate["date_max"],
        "coverage": {
            "promotionDates": promotion_dates,
            "productDailyDates": product_daily_dates,
            "intersectionDates": intersection_dates,
            "missingProductDailyDates": [item for item in requested_dates if item not in payment_by_date],
            "missingPromotionDates": [item for item in requested_dates if item not in daily_by_date],
            "promotionDatesPagination": {
                "total": _zero(aggregate["date_count"]),
                "returned": len(promotion_dates),
                "truncated": len(promotion_dates) < _zero(aggregate["date_count"]),
            },
            "productDailyDatesPagination": {
                "total": len(product_daily_dates),
                "returned": len(product_daily_dates),
                "truncated": False,
            },
            "intersectionTruncated": False,
            "expectedShopDatePairs": len(expected_pairs),
            "matchedShopDatePairs": len(matched_pairs),
            "complete": complete_pairs,
            "missingByShop": [{"shopKey": p+OUTLET_SEPARATOR+n, "dates": [d for d in requested_dates if (p, n, d) not in matched_pairs]} for p, n in sorted(identities)],
        },
        "summary": {
            "productCount": product_count,
            "spendCents": spend,
            "netTransactionAmountCents": net,
            "grossTransactionAmountCents": _zero(aggregate["gross_transaction_amount_cents"]),
            "platformPaymentAmountCents": platform_payment,
            "impressions": impressions,
            "clicks": clicks,
            "netOrders": _zero(aggregate["net_orders"]),
            "favorites": _zero(aggregate["favorites"]),
            "cartQuantity": _zero(aggregate["cart_quantity"]),
            "clickThroughRate": clicks / impressions if impressions > 0 else None,
            "averageClickCostCents": spend / clicks if clicks > 0 else None,
            "roas": net / spend if spend > 0 else None,
            "spendRate": ratio_spend / platform_payment if complete_pairs and platform_payment > 0 else None,
            "promotionTransactionShare": ratio_transaction / platform_payment if complete_pairs and platform_payment > 0 else None,
            "spendRateReason": None if complete_pairs and platform_payment > 0 else "zero_denominator" if complete_pairs else "incomplete_coverage",
            "matchedRange": {"spendCents": ratio_spend, "platformPaymentAmountCents": platform_payment, "spendRate": ratio_spend/platform_payment if platform_payment > 0 else None,
                             "coveredShopDatePairs": len(matched_pairs), "expectedShopDatePairs": len(expected_pairs),
                             "byShop": [{"shopKey": p+OUTLET_SEPARATOR+n, "dates": [d for d in requested_dates if (p, n, d) in matched_pairs]} for p, n in sorted(identities)]},
        },
        "daily": [
            {
                "date": item["business_date"],
                "spendCents": (day_spend := _zero(item["spend_cents"])),
                "netTransactionAmountCents": (day_net := _zero(item["net_transaction_amount_cents"])),
                "platformPaymentAmountCents": (payment := payment_by_date.get(str(item["business_date"]))),
                "impressions": _zero(item["impressions"]),
                "clicks": _zero(item["clicks"]),
                "netOrders": _zero(item["net_orders"]),
                "roas": day_net / day_spend if day_spend > 0 else None,
                "spendRate": day_spend / payment if str(item["business_date"]) in complete_dates and payment and payment > 0 else None,
                "promotionTransactionShare": day_net / payment if str(item["business_date"]) in complete_dates and payment and payment > 0 else None,
            }
            for item in daily_rows
        ],
        "dailyPagination": {
            "total": _zero(aggregate["date_count"]),
            "returned": len(daily_rows),
            "truncated": len(daily_rows) < _zero(aggregate["date_count"]),
        },
        "filterOptions": {
            "shops": [
                {"platform": item["platform"], "shopName": item["shop_name"]}
                for item in option_values
            ],
            "pagination": {
                "total": option_total,
                "returned": len(option_values),
                "truncated": len(option_values) < option_total,
            },
        },
    }


def promotion_items(
    *,
    query: str,
    page: int,
    page_size: int,
    platforms: Sequence[str],
    outlets: Sequence[Mapping[str, str]],
    requested_period: Mapping[str, object],
) -> dict[str, object]:
    if len(query) > 120:
        raise NetshopApiError("q 最多 120 个字符")
    _shops, products, snapshot = _promotion_scope(
        platforms=platforms, outlets=outlets, requested_period=requested_period
    )
    if query:
        products = products.filter(
            Q(product_id__icontains=query)
            | Q(product_name__icontains=query)
            | Q(product_line__icontains=query)
        )
    scope_cutoff = products.aggregate(date_max=Max("business_date"))["date_max"]
    grouped = products.values("platform", "shop_name", "product_id").annotate(
        product_name_value=Max("product_name"),
        date_min=Min("business_date"),
        date_max=Max("business_date"),
        data_days=Count("business_date", distinct=True),
        **_sum_annotations(PROMOTION_SUM_FIELDS),
    ).order_by("-net_transaction_amount_cents", "-spend_cents", "product_id")
    total = grouped.count()
    offset = (page - 1) * page_size
    page_rows = list(grouped[offset : offset + page_size])
    dates_by_identity: dict[tuple[str, str, str], list[str]] = {}
    if page_rows:
        for row in page_rows:
            key = (str(row["platform"]), str(row["shop_name"]), str(row["product_id"]))
            dates_by_identity[key] = list(
                products.filter(
                    platform=key[0], shop_name=key[1], product_id=key[2]
                )
                .order_by("business_date")
                .values_list("business_date", flat=True)
                .distinct()[:MAX_DAYS]
            )
    items: list[dict[str, object]] = []
    for row in page_rows:
        spend = _zero(row["spend_cents"])
        net = _zero(row["net_transaction_amount_cents"])
        impressions = _zero(row["impressions"])
        clicks = _zero(row["clicks"])
        key = (str(row["platform"]), str(row["shop_name"]), str(row["product_id"]))
        dates = dates_by_identity.get(key, [])
        items.append(
            {
                "id": row["product_id"],
                "platform": row["platform"],
                "productName": row["product_name_value"] or "",
                "shopName": row["shop_name"],
                "dateMin": row["date_min"],
                "dateMax": row["date_max"],
                "dates": dates,
                "datesTruncated": len(dates) < _zero(row["data_days"]),
                "dataDays": _zero(row["data_days"]),
                "spendCents": spend,
                "netTransactionAmountCents": net,
                "grossTransactionAmountCents": _zero(row["gross_transaction_amount_cents"]),
                "impressions": impressions,
                "clicks": clicks,
                "netOrders": _zero(row["net_orders"]),
                "favorites": _zero(row["favorites"]),
                "cartQuantity": _zero(row["cart_quantity"]),
                "clickThroughRate": clicks / impressions if impressions > 0 else None,
                "averageClickCostCents": spend / clicks if clicks > 0 else None,
                "roas": net / spend if spend > 0 else None,
            }
        )
    return {
        "snapshotToken": snapshot,
        "monetaryUnit": "cents",
        "requestedPeriod": {
            "startDate": requested_period["startDate"],
            "endDate": requested_period["endDate"],
        },
        "dataCutoffDate": scope_cutoff,
        "items": items,
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total,
            "returned": len(items),
            "truncated": offset + len(items) < total,
        },
    }


def promotion_performance(
    *,
    query: str,
    page: int,
    page_size: int,
    platforms: Sequence[str],
    outlets: Sequence[Mapping[str, str]],
    requested_period: Mapping[str, object],
) -> dict[str, object]:
    items = promotion_items(
        query=query,
        page=page,
        page_size=page_size,
        platforms=platforms,
        outlets=outlets,
        requested_period=requested_period,
    )
    overview_payload = promotion_overview(
        platforms=platforms,
        outlets=outlets,
        requested_period=requested_period,
        expected_snapshot_token=str(items["snapshotToken"]),
    )
    return {
        key: value
        for key, value in {
            **overview_payload,
            **items,
            "dateMin": (
                min(overview_payload["coverage"]["promotionDates"])  # type: ignore[index]
                if overview_payload["coverage"]["promotionDates"]  # type: ignore[index]
                else None
            ),
        }.items()
        if key != "snapshotToken"
    }
