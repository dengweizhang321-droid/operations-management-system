"""Product-owned read-only insights over the published PostgreSQL facts.

The shared context owns dates, account fencing and typed source revisions. This
module owns complete-set product aggregation and exact identity pairing; no
browser joins, current-to-historical mapping, source writes or reader grants.
"""
from __future__ import annotations

import json
import re
import time
from datetime import date, timedelta

from django.db import DatabaseError, connection, transaction
from django.db.models import (
    BigIntegerField, Case, Count, Exists, ExpressionWrapper, F, FloatField, Max, OuterRef, Q, Subquery, Sum, Value, When,
)

from .errors import NetshopApiError
from .catalog_filters import ASSET_SOURCE_DATASETS, CATALOG_STALE_AFTER_DAYS, _with_image
from .insights_common import (
    MAX_SAFE, actor_fence, compare_metrics, context_versions, parse_identities,
    read_context, resolve_read_deadline, validate_context, validate_metric, validate_derived_money_per_count,
    compare_derived_money_per_count,
)
from .models import (
    NetshopImportBatch, NetshopPromotionAggregateManifest, NetshopPromotionAggregateState,
    NetshopPromotionProductDaily, NetshopRow,
)
from .query import (
    PERFORMANCE_FIELD_ALIASES, _canonical_token, positive, revision_value,
)
from .store_overview import NumericMetricPresent


PRODUCT_SCHEMA = "netshop-product-insights-v1"
CORE_FIELDS = {
    "payment": "transaction_amount_cents",
    "quantity": "transaction_quantity",
    "visitors": "visitors",
    "customers": "transaction_customers",
    "addCartCustomers": "add_cart_customers",
    "refundPayment": "refund_amount_cents",
}
CORE_KEYS = (
    "payment", "quantity", "visitors", "customers", "conversion",
    "addCartRate", "refundPayment",
)
SHARED_PARAMETERS = {
    "platform", "outlet", "dimension", "startDate", "endDate", "periodKind",
    "snapshotToken",
}
PRODUCT_PARAMETERS = {
    "q", "category", "page", "pageSize", "sort", "productIdentity", "sectionToken",
    "section", "source",
}
SORTS = {"payment_desc", "payment_asc", "visitors_desc", "visitors_asc", "conversion_desc", "conversion_asc", "growth_desc", "decline_desc"}
DETAIL_SECTIONS = {"overview", "trends", "daily", "catalog", "sku", "promotion", "erp"}
DETAIL_SOURCES = {"platform", "promotion", "erp"}
EXTRA_FIELDS = {
    "pageViews": "page_views", "favorites": "favorites",
    "addCartCustomers": "add_cart_customers", "addCartQuantity": "add_cart_quantity",
    "orderCustomers": "order_customers", "orderQuantity": "order_quantity",
    "orderPayment": "order_amount_cents", "transactionOrders": "transaction_orders",
    "searchImpressions": "search_impressions", "searchClicks": "search_clicks",
    "searchVisitors": "search_visitors", "searchCustomers": "search_transaction_customers",
}
EXTRA_KEYS = tuple(EXTRA_FIELDS) + ("searchClickRate",)
ALL_FIELDS = {**CORE_FIELDS, **EXTRA_FIELDS}


def validate_product_query(params, *, detail=False):
    """Only the frozen public parameters; no principal/SQL/URL inputs."""
    if set(params) - SHARED_PARAMETERS - PRODUCT_PARAMETERS or any(
        len(params.getlist(key)) != 1
        for key in params if key not in {"platform", "outlet"}
    ):
        raise NetshopApiError("商品请求包含未知或重复参数")
    shared = params.copy()
    for key in PRODUCT_PARAMETERS:
        if key in shared:
            del shared[key]
    spec = validate_context(shared)
    query, category = params.get("q", "").strip(), params.get("category", "").strip()
    if len(query) > 120 or len(category) > 120 or any(
        ord(char) < 32 or ord(char) == 127 for char in query + category
    ):
        raise NetshopApiError("商品搜索或类目无效")
    sort = params.get("sort", "payment_desc")
    if sort not in SORTS:
        raise NetshopApiError("商品排序无效")
    section_token = params.get("sectionToken")
    if section_token is not None and (
        len(section_token) != 64 or any(c not in "0123456789abcdef" for c in section_token)
    ):
        raise NetshopApiError("商品sectionToken无效")
    identity = None
    if params.get("productIdentity") is not None:
        identity = parse_identities(
            [params["productIdentity"]], spec["dimension"], spec["platforms"], spec["outlets"],
        )[0]
    if detail and identity is None or not detail and identity is not None:
        raise NetshopApiError("单品详情须精确身份，商品列表不能传详情身份")
    section, source = params.get("section", "overview"), params.get("source", "platform")
    if section not in DETAIL_SECTIONS or source not in DETAIL_SOURCES or (
        "source" in params and section not in {"trends", "daily"}
    ) or not detail and ("section" in params or "source" in params):
        raise NetshopApiError("商品详情分区与来源组合无效")
    if detail and (len(spec["platforms"]) != 1 or len(spec["outlets"]) != 1 or not any(o["platform"] == identity[0] and o["shopName"] == identity[1] for o in spec["outlets"])):
        raise NetshopApiError("单品详情须显式精确店铺范围")
    if any(key in params and not re.fullmatch(r"[1-9]\d*", params[key]) for key in ("page", "pageSize")):
        raise NetshopApiError("商品分页须无前导零的正整数")
    return {
        **spec, "query": query, "category": category,
        "page": positive(params.get("page"), 1, "page", 10000),
        "pageSize": positive(params.get("pageSize"), 20, "pageSize", 100),
        "sort": sort, "identity": identity, "sectionToken": section_token,
        "section": section if detail else None, "source": source if detail else None,
    }


def _check_budget(deadline):
    if time.monotonic() > deadline:
        raise NetshopApiError("商品来源读取超出65秒预算", code="source_not_ready", status=503)


def _shared_spec(spec):
    return {key: spec[key] for key in ("platforms", "outlets", "dimension", "kind", "periods", "token")}


def _source(platform, dimension):
    return ("jd_sku_daily", dimension + "_daily") if platform == "京东" else ("tmall_product_daily", "spu_daily")


def _completed_match():
    return NetshopImportBatch.objects.filter(
        id=OuterRef("last_import_batch_id"), status="completed",
        platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
        source=OuterRef("source"), dataset=OuterRef("dataset"),
    )


def _base(context):
    """The batch must belong to this exact row's source, dataset and shop."""
    scopes = Q(pk__in=[])
    for shop_key in context["effectiveScope"]["shopKeys"]:
        platform, shop = shop_key.split("\x1f")
        source, dataset = _source(platform, context["effectiveScope"]["dimension"])
        scopes |= Q(platform=platform, shop_name=shop, source=source, dataset=dataset)
    completed = _completed_match()
    identity_column = context["effectiveScope"]["dimension"] + "_id"
    return NetshopRow.objects.filter(scopes, Exists(completed)).exclude(**{identity_column: ""})


def _window_rows(base, window):
    return base.filter(business_date__gte=window["startDate"], business_date__lt=window["endExclusive"])


def _identity_fields(spec):
    return ("platform", "shop_name", spec["dimension"] + "_id")


def _identity_filter(identities):
    result = Q(pk__in=[])
    for platform, shop, dimension, product in identities:
        result |= Q(platform=platform, shop_name=shop, **{dimension + "_id": product})
    return result


def _presence(column):
    return NumericMetricPresent(PERFORMANCE_FIELD_ALIASES[column])


def _annotations(fields=CORE_FIELDS, prefix="", filter_q=None):
    condition = filter_q or Q()
    values = {
        prefix + "rows": Count("id", filter=condition),
        prefix + "days": Count("business_date", distinct=True, filter=condition),
    }
    for key, column in fields.items():
        # Sum only the proved numeric rows. A typed default zero is not a fact.
        present = condition & Q(_presence(column))
        values[prefix + key] = Sum(column, filter=present)
        values[prefix + key + "_present"] = Count("id", filter=present)
    return values


def _aggregate(rows, fields=CORE_FIELDS):
    return rows.aggregate(**_annotations(fields))


def _grouped(rows, spec):
    return rows.values(*_identity_fields(spec)).annotate(
        title=Max("product_name"), category_label=Max("category"),
        **_annotations(),
    )


def _global_complete(context, kind):
    refs = [
        f"{_source(platform, context['effectiveScope']['dimension'])[0]}:"
        f"{context['effectiveScope']['dimension']}_daily:{platform}:{kind}"
        for platform in context["effectiveScope"]["platforms"]
    ]
    return bool(context["effectiveScope"]["shopKeys"]) and all(
        context["coverageBySource"][ref]["complete"] for ref in refs
        if context["coverageBySource"][ref]["expectedShopDatePairs"] > 0
    )


def _metric(key, value, status, reason, sources, coverage_ref, *, numerator=None, denominator=None, unit=None, basis="product_day_sum", aggregation=None):
    unit = unit or ("RATIO" if key in {"conversion", "addCartRate", "searchClickRate"} else "CNY_CENT" if key in {"payment", "refundPayment", "orderPayment", "visitorValue"} else "COUNT")
    if value is not None and (type(value) not in {int, float} or unit in {"CNY_CENT", "COUNT"} and (type(value) is not int or abs(value) > MAX_SAFE)):
        value, status, reason = None, "invalid", "unsafe_integer"
    result = {
        "value": value, "unit": unit, "status": status, "reasonCode": reason,
        "basis": basis, "sourceIds": sources,
        "aggregation": aggregation or ("ratio_of_sums" if unit in {"RATIO", "MULTIPLE"} else "sum"),
        "coverageRef": coverage_ref,
    }
    if result["aggregation"] == "ratio_of_sums":
        result.update(numerator=numerator, denominator=denominator)
    return validate_metric(result)


def _metrics(aggregate, context, kind, *, platform=None, prefix="", identity=False):
    sources = [_source(p, context["effectiveScope"]["dimension"])[0] for p in ([platform] if platform else context["effectiveScope"]["platforms"])]
    coverage_ref = "products:" + kind
    row_count = int(aggregate.get(prefix + "rows") or 0)
    complete_days = int(aggregate.get(prefix + "days") or 0) == context["periods"][kind]["days"] if identity else _global_complete(context, kind)
    result = {}
    for key in CORE_FIELDS:
        present = int(aggregate.get(prefix + key + "_present") or 0)
        value = aggregate.get(prefix + key)
        reason = None if row_count and present == row_count and complete_days else "missing_field" if present < row_count else "missing_day" if row_count else "no_records"
        status = "available" if reason is None else "partial" if present else "unavailable"
        result[key] = _metric(key, int(value) if present else None, status, reason, sources, coverage_ref)
    for key, numerator_key in (("conversion", "customers"), ("addCartRate", "addCartCustomers")):
        numerator, denominator = result[numerator_key], result["visitors"]
        reason = "incomplete_coverage" if numerator["status"] != "available" or denominator["status"] != "available" else "zero_denominator" if denominator["value"] == 0 else "negative_denominator" if denominator["value"] < 0 else None
        result[key] = _metric(key, numerator["value"] / denominator["value"] if reason is None else None, "available" if reason is None else "unavailable", reason, sources, coverage_ref, numerator=numerator["value"], denominator=denominator["value"])
    return {key: result[key] for key in CORE_KEYS}


def _extra_metrics(aggregate, context, kind, *, platform=None, identity=False):
    sources = [_source(p, context["effectiveScope"]["dimension"])[0] for p in ([platform] if platform else context["effectiveScope"]["platforms"])]
    row_count = int(aggregate.get("rows") or 0)
    complete = int(aggregate.get("days") or 0) == context["periods"][kind]["days"] if identity else _global_complete(context, kind)
    result = {}
    for key in EXTRA_FIELDS:
        present = int(aggregate.get(key + "_present") or 0)
        reason = None if row_count and present == row_count and complete else "missing_field" if present < row_count else "missing_day" if row_count else "no_records"
        value = int(aggregate[key]) if present else None
        result[key] = _metric(key, value, "available" if reason is None else "partial" if present else "unavailable", reason, sources, "products:" + kind)
    impressions, clicks = result["searchImpressions"], result["searchClicks"]
    reason = "incomplete_coverage" if impressions["status"] != "available" or clicks["status"] != "available" else "zero_denominator" if impressions["value"] == 0 else "negative_denominator" if impressions["value"] < 0 else None
    result["searchClickRate"] = _metric("searchClickRate", clicks["value"] / impressions["value"] if reason is None else None, "available" if reason is None else "unavailable", reason, sources, "products:" + kind, numerator=clicks["value"], denominator=impressions["value"])
    return result


def _visitor_value(metrics):
    payment, visitors = metrics["payment"], metrics["visitors"]
    invalid = payment["status"] == "invalid" or visitors["status"] == "invalid"
    complete = payment["status"] == "available" and visitors["status"] == "available"
    reason = "unsafe_integer" if invalid else "incomplete_coverage" if not complete else "zero_denominator" if visitors["value"] == 0 else "negative_denominator" if visitors["value"] < 0 else None
    return validate_derived_money_per_count({
        "metricSchemaVersion": "netshop-money-per-count-v1", "unit": "CNY_CENT_PER_COUNT",
        "denominatorKind": "product_day_visitors_sum", "aggregation": "ratio_of_sums",
        "value": payment["value"] / visitors["value"] if reason is None else None,
        "numerator": payment["value"], "denominator": visitors["value"],
        "status": "invalid" if invalid else "available" if reason is None else "unavailable",
        "reasonCode": reason, "basis": "product_day_sum", "sourceIds": payment["sourceIds"],
        "coverageRef": payment["coverageRef"],
    })


def _comparison(current, prior, year):
    return {key: {"previous": compare_metrics(current[key], prior[key]), "yearAgo": compare_metrics(current[key], year[key])} for key in CORE_KEYS}


def _payment_delta(current, previous):
    reason = "incomplete_baseline" if previous["status"] != "available" else "incomplete_coverage" if current["status"] != "available" else "not_applicable" if current["sourceIds"] != previous["sourceIds"] or current["basis"] != previous["basis"] else None
    return _metric("payment", current["value"] - previous["value"] if reason is None else None, "available" if reason is None else "unavailable", reason, current["sourceIds"], "products:paired_current")


def _pagination(spec, total, returned):
    more = (spec["page"] - 1) * spec["pageSize"] + returned < total
    return {"page": spec["page"], "pageSize": spec["pageSize"], "total": total, "returned": returned, "hasMore": more, "truncated": more}


def _search(rows, spec):
    if spec["query"]:
        query = spec["query"]
        matching = rows.filter(Q(product_name__icontains=query) | Q(product_code__icontains=query) | Q(sku_id__icontains=query) | Q(spu_id__icontains=query)).filter(
            platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
            **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")},
        )
        rows = rows.filter(Exists(matching))
    return rows


def _empty_metrics(context, kind, platform=None):
    return _metrics({}, context, kind, platform=platform, identity=True)


def _baseline_read(loader, kind, errors, deadline):
    _check_budget(deadline)
    if kind in errors:
        return None
    try:
        # A query timeout cannot poison the current-period transaction.
        with transaction.atomic():
            value = loader()
    except NetshopApiError as error:
        if error.status != 503:
            raise
    except DatabaseError:
        pass
    else:
        _check_budget(deadline)
        return value
    _check_budget(deadline)
    errors[kind] = {"state": "error", "data": None, "code": "service_unavailable", "message": "基期事实读取失败；本期保留，比较不可用"}
    return None


def _baseline_map(base, spec, identities, kind, deadline, errors):
    _check_budget(deadline)
    window = spec["periods"][kind]
    grouped = _grouped(_window_rows(base, window).filter(_identity_filter(identities)), spec)
    return _baseline_read(lambda: {tuple(row[field] for field in _identity_fields(spec)): row for row in grouped}, kind, errors, deadline) or {}


def _rows_payload(grouped_rows, base, spec, context, deadline, errors):
    identities = [(row["platform"], row["shop_name"], spec["dimension"], row[spec["dimension"] + "_id"]) for row in grouped_rows]
    previous = _baseline_map(base, spec, identities, "previous", deadline, errors) if identities else {}
    year = _baseline_map(base, spec, identities, "yearAgo", deadline, errors) if identities else {}
    output = []
    for row in grouped_rows:
        key = tuple(row[field] for field in _identity_fields(spec))
        current_metrics = _metrics(row, context, "current", platform=row["platform"], identity=True)
        prior_metrics = _metrics(previous.get(key, {}), context, "previous", platform=row["platform"], identity=True)
        year_metrics = _metrics(year.get(key, {}), context, "yearAgo", platform=row["platform"], identity=True)
        output.append({
            "identity": {"platform": row["platform"], "shopName": row["shop_name"], "dimension": spec["dimension"], "id": row[spec["dimension"] + "_id"]},
            "title": row["title"] or row[spec["dimension"] + "_id"],
            "category": row["category_label"] or None, "imageUrl": None, "imageStatus": "unverified",
            "metrics": current_metrics, "comparisons": _comparison(current_metrics, prior_metrics, year_metrics),
            "baselineMetrics": {"previous": prior_metrics, "yearAgo": year_metrics},
            "paymentDelta": _payment_delta(current_metrics["payment"], prior_metrics["payment"]),
        })
    return output


def _paired_query(base, spec):
    """Pair the complete SQL candidate set before ordering or LIMIT/OFFSET."""
    current, previous = spec["periods"]["current"], spec["periods"]["previous"]
    cq = Q(business_date__gte=current["startDate"], business_date__lt=current["endExclusive"])
    pq = Q(business_date__gte=previous["startDate"], business_date__lt=previous["endExclusive"])
    grouped = base.filter(cq | pq).values(*_identity_fields(spec)).annotate(
        **_annotations({"payment": "transaction_amount_cents"}, "current_", cq),
        **_annotations({"payment": "transaction_amount_cents"}, "previous_", pq),
    ).filter(
        current_rows__gt=0, previous_rows__gt=0,
        current_payment_present=F("current_rows"), previous_payment_present=F("previous_rows"),
        current_days=current["days"], previous_days=previous["days"],
        current_payment__gte=-MAX_SAFE, current_payment__lte=MAX_SAFE,
        previous_payment__gte=-MAX_SAFE, previous_payment__lte=MAX_SAFE,
    # CombinedExpression otherwise infers IntegerField; Django would optimize
    # away the JS-safe bound as outside int32 even though SQL SUM is numeric.
    ).annotate(delta=ExpressionWrapper(F("current_payment") - F("previous_payment"), output_field=BigIntegerField())).filter(delta__gte=-MAX_SAFE, delta__lte=MAX_SAFE)
    return grouped


def _list_rows(base, spec):
    current = _window_rows(base, spec["periods"]["current"])
    identity_columns = _identity_fields(spec)
    offset = (spec["page"] - 1) * spec["pageSize"]
    if spec["sort"] in {"growth_desc", "decline_desc"}:
        paired = _paired_query(base, spec)
        sign = {"delta__gt": 0} if spec["sort"] == "growth_desc" else {"delta__lt": 0}
        paired = paired.filter(**sign)
        # Search applies to the current list, never to summary or complete-set totals.
        if spec["query"]:
            matched = _search(current, spec).filter(
                platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
                **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")},
            )
            paired = paired.filter(Exists(matched))
        paired = paired.order_by("-delta" if spec["sort"] == "growth_desc" else "delta", *identity_columns)
        total = paired.count()
        identities = [(r["platform"], r["shop_name"], spec["dimension"], r[spec["dimension"] + "_id"]) for r in paired[offset:offset + spec["pageSize"]]]
        grouped = list(_grouped(current.filter(_identity_filter(identities)), spec))
        ranks = {(p, s, i): rank for rank, (p, s, _, i) in enumerate(identities)}
        grouped.sort(key=lambda row: ranks[tuple(row[f] for f in identity_columns)])
        return grouped, total
    grouped = _grouped(_search(current, spec), spec)
    quality = Q(days=spec["periods"]["current"]["days"])
    if spec["sort"].startswith("conversion_"):
        order = F("sort_value").asc(nulls_last=True) if spec["sort"].endswith("_asc") else F("sort_value").desc(nulls_last=True)
        valid = quality & Q(visitors__gt=0, visitors__lte=MAX_SAFE, customers__gte=-MAX_SAFE, customers__lte=MAX_SAFE, visitors_present=F("rows"), customers_present=F("rows"))
        grouped = grouped.annotate(sort_value=Case(When(valid, then=ExpressionWrapper(F("customers") * 1.0 / F("visitors"), output_field=FloatField())), default=Value(None), output_field=FloatField())).order_by(order, *identity_columns)
    else:
        column, direction = spec["sort"].rsplit("_", 1)
        valid = quality & Q(**{column + "_present": F("rows"), column + "__gte": -MAX_SAFE, column + "__lte": MAX_SAFE})
        grouped = grouped.annotate(sort_value=Case(When(valid, then=F(column)), default=Value(None))).order_by(F("sort_value").asc(nulls_last=True) if direction == "asc" else F("sort_value").desc(nulls_last=True), *identity_columns)
    return list(grouped[offset:offset + spec["pageSize"]]), grouped.count()


def _section_token(context, spec):
    return _canonical_token({
        "kind": PRODUCT_SCHEMA, "contextScope": context["scopeKey"],
        "sourceRevisions": context["sourceRevisions"],
        "filter": {"q": spec["query"], "category": spec["category"], "sort": spec["sort"], "pageSize": spec["pageSize"], "identity": spec["identity"], "section": spec["section"], "source": spec["source"]},
    })


def _counts(base, spec, context):
    current = _window_rows(base, spec["periods"]["current"])
    grouped = _grouped(current, spec)
    observed = grouped.count()
    traded = grouped.filter(payment__gt=0, payment_present=F("rows")).count()
    payment_missing = grouped.exclude(payment_present=F("rows")).exists()
    sources = [_source(platform, spec["dimension"])[0] for platform in spec["platforms"]]
    complete = _global_complete(context, "current")
    return {
        "dataProducts": _metric("quantity", observed if complete or observed else None, "available" if complete else "partial" if observed else "unavailable", None if complete else "incomplete_coverage" if observed else "no_records", sources, "products:current"),
        "tradedProducts": _metric("quantity", traded if complete or observed else None, "available" if complete and not payment_missing else "partial" if observed else "unavailable", None if complete and not payment_missing else "missing_field" if payment_missing else "incomplete_coverage" if observed else "no_records", sources, "products:current"),
    }


def _cohort(base, spec):
    """Category selects current-period identities, never baseline row labels."""
    if not spec["category"]:
        return base
    candidates = _window_rows(base, spec["periods"]["current"]).filter(
        category=spec["category"], platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
        **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")},
    )
    return base.filter(Exists(candidates))


def _category_evidence(label, source=None, platform=None, context=None):
    return {"status": "label_only" if label else "unknown", "sourceId": source, "namespace": None,
            "platform": platform, "version": context["sourceRevisions"][0]["revision"] if context else None,
            "id": None, "label": label or None, "parentId": None, "effectiveFrom": None, "effectiveTo": None}


def _mapping(reason="unverified_source", *, source=None, code=None, version=None):
    return {"status": "unmapped" if reason == "unmapped" else "ambiguous" if reason == "ambiguous_mapping" else "unverified",
            "method": "unverified", "sourceId": source, "version": version, "code": code,
            "effectiveFrom": None, "effectiveTo": None, "reasonCode": reason}


def _metadata(spec):
    return {"summaryScope": "global_category_filtered", "tableSearchScope": "identity_title_code_only",
            "categoryBasis": "source_label_only", "priceBasis": "transaction_mean",
            "limitations": [
                "汇总、商品数、结构和关注清单使用完整全局类目范围，不受表内搜索或分页影响",
                "类目筛选由本期来源标签选定商品身份，基期保持同一身份；不是历史类目迁移分析或官方跨平台字典",
                "商品访客、客户和加购人数为商品×日累计；加购率为客户人数/访客，SKU与SPU不能相加",
                "无商品行不补基期0；增长下降只排两期完整字段可比集合，缺少基期另列未知；全集增减金额是完整可比子集，不从页累计",
                "价格带按成交金额/成交件数，不按当前标价；当前档案、图片和库存均标自身快照",
                "访客累计价值为合计平台成交分/商品×日访客，以netshop-money-per-count-v1保留未舍入商；不是店铺去重UV价值",
                "资料快照与经营事实各自截止；资料质量只读机械阈值不改变事实有效性，ERP映射未核验不当已确认未关联",
                "ERP历史编码映射、成本完整性与逐日consumer尚未验证；未关联不按0成本算毛利",
                "SPU下SKU历史关系尚未验证；不能套用当前目录关系",
            ]}


def _money(value, context, kind="current", *, status="available", reason=None):
    return _metric("payment", value if status in {"available", "partial"} else None, status, reason, [_source(p, context["effectiveScope"]["dimension"])[0] for p in context["effectiveScope"]["platforms"]], "products:" + kind)


def _share(value, denominator, context, *, complete=True):
    reason = "incomplete_coverage" if not complete or denominator["status"] != "available" else "zero_denominator" if denominator["value"] == 0 else "negative_denominator" if denominator["value"] < 0 else None
    return _metric("share", value / denominator["value"] if reason is None else None, "available" if reason is None else "unavailable", reason, denominator["sourceIds"], "products:current", unit="RATIO", numerator=value, denominator=denominator["value"])


def _derived_buckets(grouped, context, denominator, *, price=False):
    """SQL aggregates the full identity projection; only bounded buckets leave DB."""
    from django.core.exceptions import EmptyResultSet
    try:
        sql, params = grouped.query.sql_with_params()
    except EmptyResultSet:
        return []
    if price:
        expression = "CASE WHEN quantity_present<>rows OR payment_present<>rows OR quantity<=0 THEN '价格未知' WHEN payment*1.0/quantity<50000 THEN '成交均价 <500元' WHEN payment*1.0/quantity<200000 THEN '成交均价 500–1999元' WHEN payment*1.0/quantity<500000 THEN '成交均价 2000–4999元' ELSE '成交均价 ≥5000元' END"
    else:
        expression = "platform || ' / ' || COALESCE(NULLIF(category_label,''),'未提供类目')"
    statement = f"SELECT {expression} AS label, SUM(payment) AS amount, COUNT(*) AS products, COUNT(*) FILTER (WHERE payment_present=rows AND days=%s) AS valid FROM ({sql}) AS product_set GROUP BY 1 ORDER BY 1 LIMIT 501"
    with connection.cursor() as cursor:
        cursor.execute(statement, [context["periods"]["current"]["days"], *params])
        buckets = cursor.fetchall()
    if len(buckets) > 500:
        raise NetshopApiError("完整类目分组超过500项，请缩小范围", code="quality_incomplete", status=422)
    output = []
    for label, payment, products, valid in buckets:
        amount = int(payment) if payment is not None else None
        complete = valid == products and denominator["status"] == "available"
        money = _money(amount, context, status="unavailable" if amount is None else "available" if complete else "partial", reason="missing_field" if amount is None else None if complete else "incomplete_coverage")
        item = {"label": label, "payment": money, "share": _share(amount, denominator, context, complete=complete and amount is not None),
                "products": _metric("quantity", int(products), "available", None, denominator["sourceIds"], "products:current")}
        if not price:
            platform, literal = label.split(" / ", 1)
            item["categoryEvidence"] = _category_evidence(None if literal == "未提供类目" else literal, _source(platform, context["effectiveScope"]["dimension"])[0], platform, context)
        output.append(item)
    return output


def _structure(base, spec, context, summary, baseline_errors, deadline):
    _check_budget(deadline)
    current = _window_rows(base, spec["periods"]["current"])
    grouped = current.values(*_identity_fields(spec)).annotate(category_label=Max("category"), **_annotations({"payment": "transaction_amount_cents", "quantity": "transaction_quantity"}))
    number = grouped.count()
    complete = summary["payment"]["status"] == "available"
    top = list(grouped.order_by(F("payment").desc(nulls_last=True), *_identity_fields(spec)).values_list("payment", flat=True)[:10])
    top5, top10 = sum(int(value) for value in top[:5] if value is not None), sum(int(value) for value in top if value is not None)
    has_top = any(value is not None for value in top)
    paired = _paired_query(base, spec)
    qualification = {"current": number, "paired": 0, "missingPrevious": 0, "missingYearAgo": 0, "incomplete": 0}
    classification = {}
    if "previous" not in baseline_errors:
        paired_count = paired.count()
        qualification["paired"] = paired_count
        prior = _window_rows(base, spec["periods"]["previous"]).filter(platform=OuterRef("platform"), shop_name=OuterRef("shop_name"), **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")})
        qualification["missingPrevious"] = grouped.filter(~Exists(prior)).count()
        qualification["incomplete"] = max(0, number - qualification["missingPrevious"] - paired_count)
        for key, conditions in {"continuous": {"current_payment__gt": 0, "previous_payment__gt": 0}, "newlyTraded": {"current_payment__gt": 0, "previous_payment": 0}, "noLongerTraded": {"current_payment": 0, "previous_payment__gt": 0}}.items():
            classification[key] = _metric("quantity", paired.filter(**conditions).count(), "available" if paired_count == number else "partial", None if paired_count == number else "incomplete_baseline", summary["payment"]["sourceIds"], "products:current")
    else:
        for key in ("continuous", "newlyTraded", "noLongerTraded"):
            classification[key] = _metric("quantity", None, "unavailable", "incomplete_baseline", summary["payment"]["sourceIds"], "products:current")
        qualification["missingPrevious"] = number
    classification["unknownBaseline"] = _metric("quantity", number - qualification["paired"], "available", None, summary["payment"]["sourceIds"], "products:current")
    year = _window_rows(base, spec["periods"]["yearAgo"]).filter(platform=OuterRef("platform"), shop_name=OuterRef("shop_name"), **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")})
    qualification["missingYearAgo"] = number if "yearAgo" in baseline_errors else grouped.filter(~Exists(year)).count()
    change_values = paired.aggregate(pairedCurrentPayment=Sum("current_payment"), pairedPreviousPayment=Sum("previous_payment"), growthPayment=Sum("delta", filter=Q(delta__gt=0)), declinePayment=Sum("delta", filter=Q(delta__lt=0)), netChange=Sum("delta")) if qualification["paired"] and "previous" not in baseline_errors else None
    changes = {key: _metric("payment", int(change_values[key] or 0) if change_values is not None else None, "available" if change_values is not None else "unavailable", None if change_values is not None else "incomplete_baseline", summary["payment"]["sourceIds"], "products:paired_current") for key in ("pairedCurrentPayment", "pairedPreviousPayment", "growthPayment", "declinePayment", "netChange")}
    _check_budget(deadline)
    return {"collection": "complete_global_filter_set", "denominator": summary["payment"],
            "top5Payment": _money(top5, context, status="available" if complete else "partial" if has_top else "unavailable", reason=None if complete else "incomplete_coverage" if has_top else "missing_field" if top else "no_records"),
            "top10Payment": _money(top10, context, status="available" if complete else "partial" if has_top else "unavailable", reason=None if complete else "incomplete_coverage" if has_top else "missing_field" if top else "no_records"),
            "top5Share": _share(top5, summary["payment"], context, complete=complete), "top10Share": _share(top10, summary["payment"], context, complete=complete),
            "categories": _derived_buckets(grouped, context, summary["payment"]), "priceBands": _derived_buckets(grouped, context, summary["payment"], price=True),
            "categoryBasis": "source_label_only", "priceBasis": "transaction_mean", "classification": classification, "qualification": qualification, "changes": changes}


def _efficiency(base, spec, context, deadline, errors):
    _check_budget(deadline)
    current = _window_rows(base, spec["periods"]["current"])
    aggregate = _aggregate(current, ALL_FIELDS)
    grouped = _grouped(current, spec)
    rules = {"id": "visitors-ge-300-conversion-lt-1pct-v1", "minimumVisitors": 300, "maximumConversion": 0.01, "requireComplete": True}
    qualified = grouped.filter(visitors__gte=300, visitors__lte=MAX_SAFE, customers__gte=0, customers__lte=MAX_SAFE, visitors_present=F("rows"), customers_present=F("rows"), days=spec["periods"]["current"]["days"]).filter(customers__lt=F("visitors") * 0.01).order_by("-visitors", *_identity_fields(spec))
    total = qualified.count()
    offset = (spec["page"] - 1) * spec["pageSize"]
    rows = list(qualified[offset:offset + spec["pageSize"]])
    return {"metrics": _extra_metrics(aggregate, context, "current"), "rules": rules,
            "watchlist": _rows_payload(rows, base, spec, context, deadline, errors), "pagination": _pagination(spec, total, len(rows)),
            "scanned": grouped.count(), "qualified": total}


def _snapshot_metric(key, value, source, *, reason=None, unit="COUNT"):
    return _metric(key, value if reason is None else None, "available" if reason is None and value is not None else "unavailable", reason or (None if value is not None else "missing_field"), [source], "products:current_snapshot", unit=unit, basis="current_snapshot", aggregation="source_value_only")


def _latest_head(platform, shop, source, dataset=None):
    batches = NetshopImportBatch.objects.filter(platform=platform, shop_name=shop, source=source, status="completed")
    if dataset:
        batches = batches.filter(dataset=dataset)
    return batches.order_by("-snapshot_date", "-completed_at", "-created_at", "-id").first()


def _catalog_profile(identity, context, *, deadline):
    _check_budget(deadline)
    platform, shop, dimension, product = identity
    source = "jd_product_master" if platform == "京东" else "tmall_product_master"
    head = _latest_head(platform, shop, source, "product_master")
    _check_budget(deadline)
    if head is None:
        return None
    master = NetshopRow.objects.filter(platform=platform, shop_name=shop, source=source, dataset="product_master", last_import_batch_id=head.id)
    master_total = master.count()
    _check_budget(deadline)
    if master_total != head.row_count:
        raise NetshopApiError("当前货品档案事实与完成批次不一致", code="service_unavailable", status=503)
    selected = master.filter(**{dimension + "_id": product})
    count = selected.count()
    _check_budget(deadline)
    if not count:
        return None
    first = selected.order_by("sku_id", "id").first()
    _check_budget(deadline)
    values = selected.aggregate(total=Sum("total_inventory"), available=Sum("available_inventory"), total_present=Count("total_inventory"), available_present=Count("available_inventory"), prices=Count("price_cents", distinct=True), price=Max("price_cents"), price_present=Count("price_cents"), codes=Count("product_code", distinct=True), titles=Count("product_name", distinct=True), categories=Count("category", distinct=True), skus=Count("sku_id", distinct=True))
    _check_budget(deadline)
    image_source = "jd_yimei_sku" if platform == "京东" else "tmall_product_assets"
    image_head = _latest_head(platform, shop, image_source, ASSET_SOURCE_DATASETS[image_source])
    _check_budget(deadline)
    image = None
    if image_head:
        image = NetshopRow.objects.filter(platform=platform, shop_name=shop, source=image_source, dataset=ASSET_SOURCE_DATASETS[image_source], last_import_batch_id=image_head.id, **{"sku_id" if platform == "京东" else "spu_id": first.sku_id if platform == "京东" else product}).filter(Exists(_completed_match())).order_by("-snapshot_date", "-id").first()
        _check_budget(deadline)
    image_url = f"/api/netshop/product-images/{image.image_content_sha256}" if image and image.image_content_sha256 else image.image_url if image and image.image_url else first.image_url or None
    image_verified = True
    try:
        # New insights have no audited code-semantic capability from a current
        # lookup. Reuse full-master proof; possible code images stay unknown.
        _with_image(selected, master, {"fields": {"jd_code_fallback": False}}).filter(catalog_has_image=False).count()
    except NetshopApiError as error:
        if error.status != 422:
            raise
        image_verified = False
        image_url = None
    raw = first.raw_json
    # JD's typed product_code may be the platform's 商品编码/SPU, not ERP or
    # merchant SKU. Only Tmall's published master projection has that meaning.
    merchant_code = str(raw.get("商家SKU") or raw.get("SKU商家编码") or (first.product_code if platform == "天猫" else "") or "").strip() or None
    code = merchant_code if count == 1 else None
    mapping = _mapping("ambiguous_mapping" if count > 1 and values["codes"] > 1 else "unverified_source", source=source, code=code, version=context["sourceRevisions"][0]["revision"])
    quality = []
    if not image_verified: quality.append("image_identity_unverified")
    elif not image_url: quality.append("missingImage")
    if not merchant_code: quality.append("missingCode")
    if not first.category: quality.append("missingCategory")
    if values["titles"] > 1 or values["categories"] > 1: quality.append("conflict")
    from django.utils import timezone
    if head.snapshot_date and head.snapshot_date < (timezone.localdate() - timedelta(days=CATALOG_STALE_AFTER_DAYS)).isoformat(): quality.append("stale")
    quality.append("mapping_unverified")
    price_reason = "ambiguous_mapping" if values["prices"] > 1 else "missing_field" if values["price_present"] != count else None
    return {"identity": {"platform": platform, "shopName": shop, "dimension": dimension, "id": product}, "title": first.product_name or product,
            "imageUrl": image_url, "productUrl": first.product_url or None, "skuId": first.sku_id or None if count == 1 else None,
            "spuId": first.spu_id or None, "merchantCode": code, "erpCode": None, "brand": first.brand or None,
            "category": first.category or None, "specification": first.sale_attribute or None if count == 1 else f"当前目录含 {count} 个SKU规格",
            "state": first.product_status or None,
            "price": _snapshot_metric("price", int(values["price"]) if values["price"] is not None else None, source, reason=price_reason, unit="CNY_CENT"),
            "inventory": {"total": _snapshot_metric("total", int(values["total"]) if values["total"] is not None else None, source, reason="ambiguous_mapping" if values["skus"] != count else "missing_field" if values["total_present"] != count else None),
                          "available": _snapshot_metric("available", int(values["available"]) if values["available"] is not None else None, source, reason="ambiguous_mapping" if values["skus"] != count else "missing_field" if values["available_present"] != count else None)},
            "snapshots": {"master": head.snapshot_date, "image": image_head.snapshot_date if image else head.snapshot_date if first.image_url else None, "price": head.snapshot_date, "inventory": head.snapshot_date},
            "mapping": mapping, "categoryEvidence": _category_evidence(first.category, source, platform, context), "quality": quality,
            "imageStatus": "unverified" if not image_verified else "available" if image_url else "missing"}


def _source_section(loader, deadline):
    _check_budget(deadline)
    try:
        with transaction.atomic():
            value = loader()
    except NetshopApiError as error:
        if error.status != 503:
            raise
    except DatabaseError:
        pass
    else:
        _check_budget(deadline)
        return {"state": "ready", "data": value}
    _check_budget(deadline)
    return {"state": "error", "data": None, "code": "service_unavailable", "message": "来源读取失败，未将错误当无记录"}


def _published_rows(platform, shop, source, dataset):
    completed = _completed_match()
    return NetshopRow.objects.filter(platform=platform, shop_name=shop, source=source, dataset=dataset).filter(Exists(completed))


def _promotion_data(spec, context, deadline):
    """Reuse the existing published raw/preaggregate identity, never A's draft."""
    platform, shop, dimension, product = spec["identity"]
    source, dataset = ("jd_promotion", "ad") if platform == "京东" else ("tmall_promotion", "promotion_daily")
    ref = source + ":" + dataset + ":" + platform + ":current"
    definitions = {"spend": ("spend_cents", ("spendCents", "花费")), "attributedPayment": ("net_transaction_amount_cents", ("netTransactionAmountCents", "总订单金额")), "clicks": ("clicks", ("clicks", "点击数"))}
    def empty(reason):
        metrics = {key: _metric(key, None, "unavailable", reason, [source], ref, unit="CNY_CENT" if key != "clicks" else "COUNT", basis="platform_attributed") for key in definitions}
        metrics["roas"] = _metric("roas", None, "unavailable", reason, [source], ref, unit="MULTIPLE", basis="platform_attributed")
        return {"metrics": metrics, "mapping": _mapping(reason, source=source), "attributionWindow": None}, {}
    if platform == "京东" and dimension == "spu":
        return empty("unverified_source")
    manifest = NetshopPromotionAggregateManifest.objects.filter(platform=platform).first()
    if manifest is None or not manifest.ready:
        return empty("promotion_not_ready")
    _check_budget(deadline)
    raw = _window_rows(_published_rows(platform, shop, source, dataset), spec["periods"]["current"])
    raw = raw.filter(**{"sku_id" if platform == "京东" else "spu_id": product})
    annotations = {"rows": Count("id")}
    for key, (column, aliases) in definitions.items():
        annotations[key] = Sum(column, filter=NumericMetricPresent(aliases))
        annotations[key + "_present"] = Count("id", filter=NumericMetricPresent(aliases))
    observed = {row["business_date"]: row for row in raw.values("business_date").annotate(**annotations)}
    aggregate = {row.business_date: row for row in NetshopPromotionProductDaily.objects.filter(platform=platform, shop_name=shop, product_id=product, source=source, business_date__gte=spec["periods"]["current"]["startDate"], business_date__lt=spec["periods"]["current"]["endExclusive"])}
    if not observed:
        return empty("promotion_mismatch" if aggregate else "no_records")
    states = {row.business_date: row for row in NetshopPromotionAggregateState.objects.filter(platform=platform, shop_name=shop, source=source, business_date__gte=spec["periods"]["current"]["startDate"], business_date__lt=spec["periods"]["current"]["endExclusive"])}
    # State attests the whole shop/day. Its raw count must agree with the whole
    # completed source rather than the selected product's narrower row count.
    all_raw = _window_rows(_published_rows(platform, shop, source, dataset), spec["periods"]["current"])
    shop_counts = {row["business_date"]: row["rows"] for row in all_raw.values("business_date").annotate(rows=Count("id"))}
    daily = {}
    valid_values = {key: [] for key in definitions}
    for day, row in observed.items():
        published, state = aggregate.get(day), states.get(day)
        matching = published is not None and state is not None and state.ready and state.raw_row_count == shop_counts.get(day) and published.source_row_count == row["rows"]
        metrics = {}
        for key, (column, _) in definitions.items():
            reason = "missing_field" if row[key + "_present"] != row["rows"] else "promotion_mismatch" if not matching or getattr(published, column, None) != row[key] else None
            value = int(row[key]) if reason is None else None
            metrics[key] = _metric(key, value, "available" if reason is None else "unavailable", reason, [source], ref, unit="COUNT" if key == "clicks" else "CNY_CENT", basis="platform_attributed")
            if reason is None:
                valid_values[key].append(value)
        spend, attributed = metrics["spend"], metrics["attributedPayment"]
        reason = "incomplete_coverage" if spend["status"] != "available" or attributed["status"] != "available" else "zero_denominator" if spend["value"] == 0 else "negative_denominator" if spend["value"] < 0 else None
        metrics["roas"] = _metric("roas", attributed["value"] / spend["value"] if reason is None else None, "available" if reason is None else "unavailable", reason, [source], ref, unit="MULTIPLE", basis="platform_attributed", numerator=attributed["value"], denominator=spend["value"])
        daily[day] = metrics
    totals = {}
    for key in definitions:
        values = valid_values[key]
        complete = len(values) == spec["periods"]["current"]["days"]
        reasons = {row[key]["reasonCode"] for row in daily.values() if row[key]["reasonCode"]}
        reason = None if complete else "promotion_mismatch" if "promotion_mismatch" in reasons else "missing_field" if "missing_field" in reasons else "missing_day"
        totals[key] = _metric(key, sum(values) if values else None, "available" if complete else "partial" if values else "unavailable", reason, [source], ref, unit="COUNT" if key == "clicks" else "CNY_CENT", basis="platform_attributed")
    spend, attributed = totals["spend"], totals["attributedPayment"]
    reason = "incomplete_coverage" if spend["status"] != "available" or attributed["status"] != "available" else "zero_denominator" if spend["value"] == 0 else "negative_denominator" if spend["value"] < 0 else None
    totals["roas"] = _metric("roas", attributed["value"] / spend["value"] if reason is None else None, "available" if reason is None else "unavailable", reason, [source], ref, unit="MULTIPLE", basis="platform_attributed", numerator=attributed["value"], denominator=spend["value"])
    mapping = {"status": "verified", "method": "exact_code_shop", "sourceId": source, "version": context["sourceRevisions"][0]["revision"], "code": product, "effectiveFrom": spec["periods"]["current"]["startDate"], "effectiveTo": spec["periods"]["current"]["endDate"], "reasonCode": None}
    return {"metrics": totals, "mapping": mapping, "attributionWindow": None}, daily


def _erp_data(catalog):
    mapping = catalog["mapping"] if catalog else _mapping("unverified_source")
    reason = "ambiguous_mapping" if mapping["status"] == "ambiguous" else "unmapped" if mapping["status"] == "unmapped" else "unverified_source"
    metrics = {}
    for key in ("netSales", "cost", "largeMarginRate", "orderMargin", "returnAmount", "returnQuantity"):
        unit = "RATIO" if key == "largeMarginRate" else "COUNT" if key == "returnQuantity" else "CNY_CENT"
        basis = "erp_large_margin" if key == "largeMarginRate" else "erp_order_margin" if key == "orderMargin" else "erp_net_sales"
        metrics[key] = _metric(key, None, "unavailable", reason, ["sales_consumer"], "products:erp", unit=unit, basis=basis)
    return {"metrics": metrics, "mapping": mapping}


def _daily_data(base, spec, context, deadline, *, promotion=None):
    """Expected calendar is paginated; absent days carry nulls, never zero."""
    from .store_overview import days
    window = spec["periods"]["current"]
    selected = days(window["startDate"], window["endDate"])
    offset = (spec["page"] - 1) * spec["pageSize"]
    selected_page = selected[offset:offset + spec["pageSize"]]
    source = spec["source"]
    if source == "erp":
        return {"state": "error", "data": None, "code": "service_unavailable", "message": "现有ERP consumer没有经历史映射验证的单品逐日合同；未以0或当前库存补数"}
    _check_budget(deadline)
    rows = _window_rows(base, window).filter(business_date__in=selected_page).values("business_date").annotate(**_annotations(ALL_FIELDS)) if source == "platform" else []
    observed = {row["business_date"]: row for row in rows}
    items = []
    for day in selected_page:
        if source == "platform":
            one_day = {**context, "periods": {**context["periods"], "current": {"startDate": day, "endDate": day, "endExclusive": (date.fromisoformat(day) + timedelta(days=1)).isoformat(), "days": 1}}}
            metrics = {**_metrics(observed.get(day, {}), one_day, "current", platform=spec["identity"][0], identity=True), **_extra_metrics(observed.get(day, {}), one_day, "current", platform=spec["identity"][0], identity=True)}
        else:
            _, daily = promotion
            source_id = "jd_promotion" if spec["identity"][0] == "京东" else "tmall_promotion"
            metrics = daily.get(day) or (promotion[0]["metrics"] if promotion[0]["mapping"]["status"] != "verified" else {key: _metric(key, None, "unavailable", "no_records", [source_id], "products:promotion", unit="MULTIPLE" if key == "roas" else "COUNT" if key == "clicks" else "CNY_CENT", basis="platform_attributed") for key in ("spend", "attributedPayment", "roas", "clicks")})
        item = {"date": day, "source": source, "metrics": metrics}
        if source == "platform":
            item["visitorValue"] = _visitor_value(metrics)
        items.append(item)
    definitions = ["自然日来自请求本期；未提供行/字段为空，真实0须数字字段存在", "金额为人民币分；人数为商品×日累计，SKU/SPU不相加"] if source == "platform" else ["京东为跟单SKU总订单金额，天猫为商品净归因成交；与平台支付/ERP净销售分开", "ROAS=归因成交/花费，归因窗口未知；不是利润或增量", "缺报日为空，不从其它商品、店铺或当前SKU归属补0"]
    return {"state": "ready", "data": {"source": source, "items": items, "pagination": _pagination(spec, len(selected), len(items)), "definitions": definitions, "startDate": window["startDate"], "endDate": window["endDate"], "sourceRevisions": context["sourceRevisions"]}}


def _quality(base, spec, context, deadline):
    from django.utils import timezone
    from django.db.models.functions import Coalesce, NullIf
    from django.db.models.fields.json import KeyTextTransform
    _check_budget(deadline)
    selected_scopes = Q(pk__in=[])
    for key in context["effectiveScope"]["shopKeys"]:
        platform, shop = key.split("\x1f")
        selected_scopes |= Q(platform=platform, shop_name=shop)
    batches = NetshopImportBatch.objects.filter(selected_scopes, status="completed", source__in=["jd_product_master", "tmall_product_master"], dataset="product_master").order_by("-snapshot_date", "-completed_at", "-created_at", "-id")
    heads = {}
    for batch in batches:
        heads.setdefault((batch.platform, batch.shop_name), batch)
    master = NetshopRow.objects.filter(selected_scopes, source__in=["jd_product_master", "tmall_product_master"], dataset="product_master", last_import_batch_id__in=[batch.id for batch in heads.values()]).filter(Exists(_completed_match()))
    full_master = master
    cohort = _window_rows(base, spec["periods"]["current"]).filter(platform=OuterRef("platform"), shop_name=OuterRef("shop_name"), **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")})
    master = master.filter(Exists(cohort))
    master = master.annotate(merchant=Coalesce(NullIf(KeyTextTransform("商家SKU", "raw_json"), Value("")), NullIf(KeyTextTransform("SKU商家编码", "raw_json"), Value("")), Case(When(platform="天猫", then=NullIf(F("product_code"), Value(""))), default=Value(None), output_field=NetshopRow._meta.get_field("product_code")), output_field=NetshopRow._meta.get_field("product_code")))
    total = master.count()
    sources = ["jd_product_master" if p == "京东" else "tmall_product_master" for p in context["effectiveScope"]["platforms"]]
    if not total:
        values = {key: None for key in ("missingImage", "missingCode", "missingCategory", "conflict", "stale", "unmapped")}
    else:
        missing_code = master.filter(merchant__isnull=True).count()
        conflicts = master.exclude(sku_id="").values("platform", "shop_name", "sku_id").annotate(titles=Count("product_name", distinct=True), codes=Count("product_code", distinct=True), parents=Count("spu_id", distinct=True)).filter(Q(titles__gt=1) | Q(codes__gt=1) | Q(parents__gt=1)).count()
        try:
            missing_image = _with_image(master, full_master, {"fields": {"jd_code_fallback": False}}).filter(catalog_has_image=False).count()
        except NetshopApiError as error:
            if error.status != 422:
                raise
            missing_image = None
        values = {"missingImage": missing_image, "missingCode": missing_code, "missingCategory": master.filter(category="").count(), "conflict": conflicts, "stale": master.filter(snapshot_date__isnull=False, snapshot_date__regex=r"^\d{4}-\d{2}-\d{2}$", snapshot_date__lt=(timezone.localdate() - timedelta(days=CATALOG_STALE_AFTER_DAYS)).isoformat()).exclude(snapshot_date="").count(), "unmapped": None}
    counts = {}
    for key, value in values.items():
        counts[key] = _metric(key, None if key == "unmapped" else value, "unavailable" if key == "unmapped" or value is None else "available", "unverified_source" if key == "unmapped" or key == "missingImage" and total and value is None else "no_records" if value is None else None, sources, "products:current_snapshot", basis="current_snapshot")
    return {"counts": counts, "staleAfterDays": CATALOG_STALE_AFTER_DAYS, "basis": "current_snapshot"}


def _page_images(items, context, deadline, *, image_uncertain=False):
    """Only exact shop/ID current image metadata, read in one bounded query."""
    if not items:
        return
    scope = Q(pk__in=[])
    candidates = Q(pk__in=[])
    for item in items:
        identity = item["identity"]
        source = "tmall_product_assets" if identity["platform"] == "天猫" else "jd_yimei_sku"
        if identity["platform"] == "京东" and identity["dimension"] != "sku":
            continue  # A current SKU image is not a proved historical SPU image.
        scope |= Q(platform=identity["platform"], shop_name=identity["shopName"], source=source, dataset=ASSET_SOURCE_DATASETS[source])
        candidates |= Q(platform=identity["platform"], shop_name=identity["shopName"], source=source, dataset=ASSET_SOURCE_DATASETS[source], **{identity["dimension"] + "_id": identity["id"]})
    _check_budget(deadline)
    heads = {}
    for batch in NetshopImportBatch.objects.filter(scope, status="completed").order_by("-snapshot_date", "-completed_at", "-created_at", "-id"):
        heads.setdefault((batch.source, batch.platform, batch.shop_name), batch.id)
    images = {}
    for row in NetshopRow.objects.filter(candidates, last_import_batch_id__in=heads.values()).filter(Exists(_completed_match())).only("platform", "shop_name", "sku_id", "spu_id", "image_url", "image_content_sha256").order_by("id"):
        key = (row.platform, row.shop_name, row.spu_id if row.platform == "天猫" else row.sku_id)
        images.setdefault(key, f"/api/netshop/product-images/{row.image_content_sha256}" if row.image_content_sha256 else row.image_url or None)
    for item in items:
        identity = item["identity"]
        item["imageUrl"] = images.get((identity["platform"], identity["shopName"], identity["id"]))
        item["imageStatus"] = "available" if item["imageUrl"] else "unverified" if image_uncertain or identity["platform"] == "京东" and identity["dimension"] == "spu" else "missing"


def _finish(payload, principal, actor, deadline):
    context = payload["context"]
    _check_budget(deadline)
    revision = revision_value()
    if context["sourceRevisions"][0]["revision"] != revision:
        raise NetshopApiError("商品读取期间来源版本变化", code="insights_revision_changed", status=409)
    expected = []
    for platform in context["effectiveScope"]["platforms"]:
        names = [key.split("\x1f")[1] for key in context["effectiveScope"]["shopKeys"] if key.startswith(platform + "\x1f")]
        expected.extend({"domain": "netshop", "kind": platform + ":" + key, "scopeKey": context["scopeKey"], "revision": value} for key, value in sorted(context_versions(platform, names, revision).items()) if key != "netshop")
    if expected != context["sourceRevisions"][1:]:
        raise NetshopApiError("商品参与来源向量变化", code="insights_revision_changed", status=409)
    if actor_fence(principal) != actor:
        raise NetshopApiError("商品取数期间账号权限版本变化", code="access_denied", status=403)
    _check_budget(deadline)
    if len(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")) > 2 * 1024 * 1024:
        raise NetshopApiError("商品响应超过2MiB，请缩小范围", code="quality_incomplete", status=422)
    _check_budget(deadline)
    return payload


def _execute_product_reader(principal, spec, reader, deadline=None):
    """One outer deadline fences every new read statement, including helpers.

    An already executing SQL is not killed. Post-execution expiry fails the
    whole read and no subsequent read SQL starts. Transaction cleanup remains
    permitted; the existing per-statement limit is not changed here.
    """
    deadline = resolve_read_deadline(deadline)
    def fence(execute, sql, params, many, context):
        statement = re.sub(r"\A(?:\s+|/\*[\s\S]*?\*/|--[^\n]*(?:\n|$))*", "", str(sql))
        read_sql = re.match(r"(?:SELECT|WITH|SHOW|EXPLAIN)\b", statement, re.I) is not None
        if read_sql:
            _check_budget(deadline)
        value = execute(sql, params, many, context)
        if read_sql:
            _check_budget(deadline)
        return value
    with connection.execute_wrapper(fence):
        return reader(principal, spec, deadline)


def read_product_insights(principal, spec, *, deadline=None):
    return _execute_product_reader(principal, spec, _read_product_insights, deadline)


def _read_product_insights(principal, spec, deadline):
    """A single shared-context read (at most two attempts), then one fact read.

    The outer deadline starts before the initial actor SQL and includes the last
    actor SQL and serialization. There is no nested retry multiplier.
    """
    actor = actor_fence(principal)
    _check_budget(deadline)
    context = read_context(principal, _shared_spec(spec), deadline=deadline)
    _check_budget(deadline)
    section_token = _section_token(context, spec)
    if spec["sectionToken"] and spec["sectionToken"] != section_token:
        raise NetshopApiError("商品sectionToken不属于当前范围或版本", code="insights_revision_changed", status=409)
    base = _cohort(_base(context), spec)
    metrics, baseline_errors = {}, {}
    for kind in ("current", "previous", "yearAgo"):
        _check_budget(deadline)
        aggregate = _aggregate(_window_rows(base, spec["periods"][kind])) if kind == "current" else _baseline_read(lambda: _aggregate(_window_rows(base, spec["periods"][kind])), kind, baseline_errors, deadline)
        _check_budget(deadline)
        metrics[kind] = _metrics(aggregate or {}, context, kind)
    _check_budget(deadline)
    grouped, total = _list_rows(base, spec)
    _check_budget(deadline)
    items = _rows_payload(grouped, base, spec, context, deadline, baseline_errors)
    growth_spec = {**spec, "sort": "decline_desc" if spec["sort"] == "decline_desc" else "growth_desc"}
    if spec["sort"] == growth_spec["sort"]:
        growth_items, growth_total = items, total
    else:
        growth_rows, growth_total = _list_rows(base, growth_spec) if "previous" not in baseline_errors and metrics["previous"]["payment"]["reasonCode"] != "no_records" else ([], 0)
        growth_items = _rows_payload(growth_rows, base, growth_spec, context, deadline, baseline_errors)
    for kind in baseline_errors:
        metrics[kind] = _empty_metrics(context, kind)
        for item in items + growth_items:
            empty = _empty_metrics(context, kind, item["identity"]["platform"])
            for key in CORE_KEYS:
                item["comparisons"][key][kind] = compare_metrics(item["metrics"][key], empty[key])
            item["baselineMetrics"][kind] = empty
            item["paymentDelta"] = _payment_delta(item["metrics"]["payment"], item["baselineMetrics"]["previous"]["payment"])
    efficiency = _efficiency(base, spec, context, deadline, baseline_errors)
    structure = _structure(base, spec, context, metrics["current"], baseline_errors, deadline)
    quality = _quality(base, spec, context, deadline)
    _page_images(items + growth_items + efficiency["watchlist"], context, deadline, image_uncertain=quality["counts"]["missingImage"]["reasonCode"] == "unverified_source")
    # Optional sections may perform more exact baseline reads. Clear all
    # comparisons for a failed baseline, not only the later watchlist rows.
    for kind in baseline_errors:
        metrics[kind] = _empty_metrics(context, kind)
        for item in items + growth_items + efficiency["watchlist"]:
            empty = _empty_metrics(context, kind, item["identity"]["platform"])
            for key in CORE_KEYS:
                item["comparisons"][key][kind] = compare_metrics(item["metrics"][key], empty[key])
            item["baselineMetrics"][kind] = empty
            item["paymentDelta"] = _payment_delta(item["metrics"]["payment"], item["baselineMetrics"]["previous"]["payment"])
    visitor_values = {kind: _visitor_value(metrics[kind]) for kind in ("current", "previous", "yearAgo")}
    efficiency["visitorValue"] = visitor_values["current"]
    efficiency["visitorValueComparisons"] = {kind: compare_derived_money_per_count(visitor_values["current"], visitor_values[kind]) for kind in ("previous", "yearAgo")}
    payload = {
        "schemaVersion": PRODUCT_SCHEMA, "context": context, "sectionToken": section_token,
        "tableScope": {"q": spec["query"], "category": spec["category"], "sort": spec["sort"], "page": spec["page"], "pageSize": spec["pageSize"]},
        "joinedSourceRevisions": context["sourceRevisions"], "consistency": "revision_vector_checked",
        "sections": {
            "summary": metrics["current"],
            "comparisons": _comparison(metrics["current"], metrics["previous"], metrics["yearAgo"]),
            "items": items, "pagination": _pagination(spec, total, len(items)),
            "counts": _counts(base, spec, context),
            "baselineReads": {kind: baseline_errors.get(kind, {"state": "ready", "data": metrics[kind]}) for kind in ("previous", "yearAgo")},
            "growth": baseline_errors.get("previous", {"state": "ready", "data": {"collection": "paired_full_set_before_pagination", "items": growth_items, "pagination": _pagination(spec, growth_total, len(growth_items))}}),
            "structure": structure, "efficiency": efficiency, "dataQuality": quality,
            "metadata": _metadata(spec),
        },
    }
    return _finish(payload, principal, actor, deadline)


def read_product_detail(principal, spec, *, deadline=None):
    return _execute_product_reader(principal, spec, _read_product_detail, deadline)


def _read_product_detail(principal, spec, deadline):
    """Exact, single-shop product; current catalogue and each source separated."""
    if spec["identity"] is None:
        raise NetshopApiError("详情缺少商品精确身份")
    actor = actor_fence(principal)
    _check_budget(deadline)
    context = read_context(principal, _shared_spec(spec), deadline=deadline)
    _check_budget(deadline)
    section_token = _section_token(context, spec)
    if spec["sectionToken"] and spec["sectionToken"] != section_token:
        raise NetshopApiError("单品sectionToken不属于当前范围或版本", code="insights_revision_changed", status=409)
    base = _base(context).filter(_identity_filter([spec["identity"]]))
    metrics, errors = {}, {}
    for kind in ("current", "previous", "yearAgo"):
        _check_budget(deadline)
        loader = lambda: _aggregate(_window_rows(base, spec["periods"][kind]), ALL_FIELDS)
        aggregate = loader() if kind == "current" else _baseline_read(loader, kind, errors, deadline)
        _check_budget(deadline)
        metrics[kind] = _metrics(aggregate or {}, context, kind, platform=spec["identity"][0], identity=True)
        if kind == "current":
            extras = _extra_metrics(aggregate or {}, context, kind, platform=spec["identity"][0], identity=True)
    _check_budget(deadline)
    grouped = _grouped(_window_rows(base, spec["periods"]["current"]), spec).order_by(*_identity_fields(spec)).first()
    _check_budget(deadline)
    platform, shop, dimension, product = spec["identity"]
    identity = {"platform": platform, "shopName": shop, "dimension": dimension, "id": product}
    catalog_section = _source_section(lambda: _catalog_profile(spec["identity"], context, deadline=deadline), deadline)
    catalog = catalog_section["data"] if catalog_section["state"] == "ready" else None
    performance = {"identity": identity, "title": grouped["title"] if grouped and grouped["title"] else catalog["title"] if catalog else product, "category": grouped["category_label"] if grouped and grouped["category_label"] else None, "imageUrl": catalog["imageUrl"] if catalog else None, "imageStatus": catalog["imageStatus"] if catalog else "unverified", "metrics": metrics["current"], "comparisons": _comparison(metrics["current"], metrics["previous"], metrics["yearAgo"]), "baselineMetrics": {"previous": metrics["previous"], "yearAgo": metrics["yearAgo"]}, "paymentDelta": _payment_delta(metrics["current"]["payment"], metrics["previous"]["payment"])}
    promotion_data = [None]
    def load_promotion():
        value = _promotion_data(spec, context, deadline)
        promotion_data[0] = value
        return value[0]
    promotion_section = _source_section(load_promotion, deadline)
    sections = {"performance": performance, "baselineReads": {kind: errors.get(kind, {"state": "ready", "data": metrics[kind]}) for kind in ("previous", "yearAgo")},
                "catalog": catalog_section, "extras": extras, "promotion": promotion_section, "erp": {"state": "ready", "data": _erp_data(catalog)},
                "skuContribution": {"status": "unavailable", "reasonCode": "not_applicable" if dimension == "sku" else "unverified_source", "basis": "historical_relation", "relationVersion": None, "items": [], "pagination": _pagination(spec, 0, 0)},
                "metadata": _metadata(spec)}
    visitor_values = {kind: _visitor_value(metrics[kind]) for kind in ("current", "previous", "yearAgo")}
    sections["visitorValue"] = visitor_values["current"]
    sections["visitorValueComparisons"] = {kind: compare_derived_money_per_count(visitor_values["current"], visitor_values[kind]) for kind in ("previous", "yearAgo")}
    if spec["section"] in {"daily", "trends"}:
        sections[spec["section"]] = promotion_section if spec["source"] == "promotion" and promotion_section["state"] == "error" else _daily_data(base, spec, context, deadline, promotion=promotion_data[0])
    payload = {"schemaVersion": PRODUCT_SCHEMA, "context": context, "sectionToken": section_token,
               "tableScope": {"q": spec["query"], "category": spec["category"], "sort": spec["sort"], "page": spec["page"], "pageSize": spec["pageSize"], "section": spec["section"], "source": spec["source"]},
               "identity": identity, "joinedSourceRevisions": context["sourceRevisions"], "consistency": "revision_vector_checked", "sections": sections}
    return _finish(payload, principal, actor, deadline)
