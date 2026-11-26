"""Category subdivision analysis (third tab of the sales category analysis).

Products are mapped to subdivisions by ``EffectiveMapping.resolve`` (manual,
then spec code, then name-to-code, then name fallback). A mapped product counts
toward its subdivision regardless of its ERP category. Products whose ERP
category is covered by the selected major category but that are not mapped form
the separate "unclassified" bucket, which never enters the subdivision table and
is not part of the share denominator. Every effective label of the major
category is listed, with zeros when it has no sales. The trend is always daily.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Sequence

from django.db.models import Case, Q, Value, When

from . import subdivisions
from .auth import Principal
from .calculation_cache import reuse
from .category import (
    DETAIL_TREND_PERIOD_LIMIT,
    _base,
    _category_trend,
    _comparison_aggregates,
    _comparison_periods,
    _comparison_queryset,
    _period_annotation,
    _rate,
    _serialize_category,
    _validate_range,
)
from .query import SalesRequestError, add_days, binary_text_key, category_aggregates

PAIR_LIMIT = 5000
PRODUCT_LIMIT = 50

SORT_KEYS = {
    "subdivision", "netSalesCents", "shareRate", "netQuantity", "refundRate", "refundAmountCents",
    "grossProfitCents", "grossMarginRate", "yearOverYearRate", "weekOverWeekRate", "productCount",
}
_SUMMARY_KEYS = {
    "grossSalesCents": "gross_sales_cents", "refundAmountCents": "refund_amount_cents",
    "netSalesCents": "net_sales_cents", "costAmountCents": "cost_amount_cents",
    "positiveQuantity": "positive_quantity", "returnQuantity": "return_quantity",
    "netQuantity": "net_quantity", "grossProfitCents": "gross_profit_cents",
    "lineCount": "line_count",
    "currentWeekNetSalesCents": "current_week_net_sales_cents",
    "previousWeekNetSalesCents": "previous_week_net_sales_cents",
    "yearAgoNetSalesCents": "year_ago_net_sales_cents",
}
_COVERAGE_BUCKETS = ("manual", "code", "name_to_code", "name", "unclassified")
_CODE_SOURCES = {"manual", "code", "name_to_code"}


def candidate_filter(mapping: subdivisions.EffectiveMapping, major: str) -> Q:
    """Covered ERP category, or an exact hit on a raw map code / fallback name."""
    return (
        Q(resolved_category__in=mapping.covered_categories(major))
        | Q(product_code__in=mapping.raw_codes(major))
        | Q(product_name__in=mapping.raw_fallback_names(major))
    )


def _subdivision_case(mapping: subdivisions.EffectiveMapping, major: str, pairs: Sequence[tuple[str, str]]):
    covered = mapping.covered_categories(major)
    codes: dict[str, set[str]] = defaultdict(set)
    names: dict[str, set[str]] = defaultdict(set)
    foreign_codes: set[str] = set()
    foreign_names: set[str] = set()
    blocked_codes: set[str] = set()
    for code, name in pairs:
        label, owner, matched_by = mapping.resolve(code, name)
        if matched_by is not None and owner is not None and owner != major:
            # Mapped to another major category: never counted here, not even as unclassified.
            if matched_by == "name":
                foreign_names.add(name)
            else:
                foreign_codes.add(code)
        elif label and matched_by in _CODE_SOURCES:
            codes[label].add(code)
        elif label and matched_by == "name":
            names[label].add(name)
        elif code and mapping.code_owned(code):
            # Owned by a manual/code entry whose label is unusable: a name match must not capture it.
            blocked_codes.add(code)
    # Every code branch precedes every name branch so code always wins; the
    # unclassified branch is last so any mapped product keeps its subdivision.
    whens = [When(product_code__in=sorted(foreign_codes), then=Value(""))] if foreign_codes else []
    whens += [When(product_code__in=sorted(values), then=Value(label)) for label, values in sorted(codes.items())]
    if blocked_codes:
        whens.append(When(product_code__in=sorted(blocked_codes), resolved_category__in=covered, then=Value(subdivisions.UNCLASSIFIED_LABEL)))
        whens.append(When(product_code__in=sorted(blocked_codes), then=Value("")))
    whens += [When(product_name__in=sorted(values), then=Value(label)) for label, values in sorted(names.items())]
    if foreign_names:
        whens.append(When(product_name__in=sorted(foreign_names), then=Value("")))
    whens.append(When(resolved_category__in=covered, then=Value(subdivisions.UNCLASSIFIED_LABEL)))
    return Case(*whens, default=Value(""))


def _product_entry(row: dict[str, Any], matched_by: str | None) -> dict[str, Any]:
    net = int(row["net_sales_cents"] or 0)
    cost = int(row["cost_amount_cents"] or 0)
    return {
        "productCode": row["product_code"] or "", "productName": row["product_name"] or "",
        "erpCategory": row["resolved_category"] or "", "matchedBy": matched_by or "none",
        "netSalesCents": net, "netQuantity": int(row["net_quantity"] or 0),
        "grossMarginRate": 0 if net == 0 else (net - cost) / net,
    }


def _top_products(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    ordered = sorted(items, key=lambda p: (-p["netSalesCents"], binary_text_key(p["productCode"]), binary_text_key(p["productName"])))
    return ordered[:PRODUCT_LIMIT], len(ordered) > PRODUCT_LIMIT


def _compute(params: dict[str, Any], principal: Principal, comparisons: dict[str, Any],
             mapping: subdivisions.EffectiveMapping, major: str) -> dict[str, Any]:
    union_queryset, scope_mode = _comparison_queryset(params, principal, comparisons)
    union_queryset = union_queryset.filter(candidate_filter(mapping, major))
    pair_rows = [tuple(pair) for pair in union_queryset.order_by().values_list("product_code", "product_name").distinct()[: PAIR_LIMIT + 1]]
    if len(pair_rows) > PAIR_LIMIT:
        raise SalesRequestError(f"品类细分商品数超过 {PAIR_LIMIT}，暂不支持")
    case = _subdivision_case(mapping, major, pair_rows)
    group_rows = list(
        union_queryset.annotate(subdivision=case).exclude(subdivision="")
        .order_by().values("subdivision").annotate(**_comparison_aggregates(params, comparisons))
        .filter(line_count__gt=0)
    )

    current_queryset, _ = _base(params, principal)
    product_rows = list(
        current_queryset.filter(candidate_filter(mapping, major)).annotate(subdivision=case).exclude(subdivision="")
        .order_by().values("subdivision", "product_code", "product_name", "resolved_category")
        .annotate(**category_aggregates()).filter(line_count__gt=0)
    )
    products: dict[str, list[dict[str, Any]]] = defaultdict(list)
    coverage_keys: dict[str, set[str]] = {key: set() for key in _COVERAGE_BUCKETS}
    coverage_net = {key: 0 for key in _COVERAGE_BUCKETS}
    mapped_codes: set[str] = set()
    for row in product_rows:
        label = row["subdivision"]
        code, name = row["product_code"] or "", row["product_name"] or ""
        matched_by = None if label == subdivisions.UNCLASSIFIED_LABEL else mapping.resolve(code, name)[2]
        bucket = matched_by or "unclassified"
        coverage_keys[bucket].add(code or f"name:{name}")
        coverage_net[bucket] += int(row["net_sales_cents"] or 0)
        if label != subdivisions.UNCLASSIFIED_LABEL and code:
            mapped_codes.add(code)
        products[label].append(_product_entry(row, matched_by))
    top: dict[str, dict[str, Any]] = {}
    for label, items in products.items():
        listed, truncated = _top_products(items)
        top[label] = {"products": listed, "productsTruncated": truncated}

    return {
        "scopeMode": scope_mode,
        "pairs": pair_rows,
        "rows": group_rows,
        "products": top,
        "mappedProductCount": len(mapped_codes),
        "coverage": {key: {"productCount": len(coverage_keys[key]), "netSalesCents": coverage_net[key]} for key in coverage_keys},
    }


def _summary(rows: Sequence[dict[str, Any]], mapped_product_count: int) -> dict[str, int | float | None]:
    """Whole-table totals; ratios are recomputed from summed amounts, never added up."""
    result: dict[str, int | float | None] = {target: sum(int(row.get(source) or 0) for row in rows) for target, source in _SUMMARY_KEYS.items()}
    net = int(result["netSalesCents"] or 0)
    result["grossMarginRate"] = 0 if net == 0 else (net - int(result["costAmountCents"] or 0)) / net
    result["productCount"] = mapped_product_count
    result["subdivisionCount"] = len(rows)
    result["shareRate"] = None if net == 0 else 1
    result["yearOverYearRate"] = _rate(net, int(result["yearAgoNetSalesCents"] or 0))
    result["weekOverWeekRate"] = _rate(int(result["currentWeekNetSalesCents"] or 0), int(result["previousWeekNetSalesCents"] or 0))
    return result


def _trend_rows(params: dict[str, Any], principal: Principal, labels: Sequence[str], mapping: subdivisions.EffectiveMapping,
                major: str, case) -> list[dict[str, Any]]:
    if not labels:
        return []
    queryset, _ = _base(params, principal)
    queryset = queryset.filter(candidate_filter(mapping, major)).annotate(subdivision=case).filter(subdivision__in=list(labels))
    queryset = _period_annotation(queryset, "day")
    aggregate = category_aggregates()
    rows = list(queryset.order_by().values("period_key", "subdivision").annotate(net_sales_cents=aggregate["net_sales_cents"]))
    for row in rows:
        value = row["period_key"]
        normalized = value.isoformat() if hasattr(value, "isoformat") else str(value)
        row["period_key"] = normalized[:10]
    recent = set(sorted({row["period_key"] for row in rows}, reverse=True)[:DETAIL_TREND_PERIOD_LIMIT])
    rows = [row for row in rows if row["period_key"] in recent]
    rows.sort(key=lambda row: (row["period_key"], binary_text_key(row["subdivision"])))
    return rows


def _order(metrics: list[dict[str, Any]], sort_by: str, direction: str) -> list[dict[str, Any]]:
    descending = direction == "desc"
    by_name = sorted(metrics, key=lambda item: binary_text_key(item["subdivision"]))
    if sort_by == "subdivision":
        return sorted(by_name, key=lambda item: binary_text_key(item["subdivision"]), reverse=descending)
    # NULL ranks last in both directions; the stable sort keeps name order for ties.
    valued = [item for item in by_name if item[sort_by] is not None]
    nulls = [item for item in by_name if item[sort_by] is None]
    return sorted(valued, key=lambda item: item[sort_by], reverse=descending) + nulls


def get_subdivision_analysis(params: dict[str, Any], principal: Principal) -> dict[str, Any]:
    _validate_range(params["startDate"], params["endDate"])
    if params["sortBy"] not in SORT_KEYS:
        raise SalesRequestError("sortBy 无效")
    mapping = subdivisions.load_effective(principal)
    major = (params.get("majorCategory") or "").strip() or mapping.major_categories()[0]
    if major not in mapping.major_categories():
        raise SalesRequestError("majorCategory 无效")
    labels = mapping.labels(major)
    if len(labels) > subdivisions.LABEL_LIMIT:
        raise SalesRequestError(f"细分数量超过 {subdivisions.LABEL_LIMIT}，暂不支持")
    # The third tab is not narrowed by the category multi-select.
    params = {**params, "categories": []}
    comparisons = _comparison_periods(params["startDate"], params["endDate"])
    scope = {key: value for key, value in params.items() if key not in {"sortBy", "direction", "page", "pageSize", "granularity"}}
    scope["mapVersion"] = mapping.version
    # configVersion is read fresh on every request, so an edit invalidates this scope at once.
    scope["configVersion"] = mapping.config_version
    scope["majorCategory"] = major
    computed = reuse("category-subdivisions", scope, principal, lambda: _compute(params, principal, comparisons, mapping, major))

    unclassified_label = subdivisions.UNCLASSIFIED_LABEL
    rows_by_label = {row["subdivision"]: row for row in computed["rows"]}
    mapped_rows = [rows_by_label[item["name"]] for item in labels if item["name"] in rows_by_label]
    unclassified_row = rows_by_label.get(unclassified_label)
    summary = _summary(mapped_rows, int(computed["mappedProductCount"]))
    summary["subdivisionCount"] = len(labels)
    mapped_net = int(summary["netSalesCents"] or 0)
    metrics = [{
        **_serialize_category({**rows_by_label.get(item["name"], {}), "resolved_category": item["name"]}, mapped_net),
        "subdivision": item["name"], "labelSource": item["source"],
    } for item in labels]

    ordered = _order(metrics, params["sortBy"], params["direction"])
    offset = (params["page"] - 1) * params["pageSize"]
    page_items = ordered[offset : offset + params["pageSize"]]

    trend_by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if page_items:
        case = _subdivision_case(mapping, major, computed["pairs"])
        for row in _trend_rows(params, principal, [item["subdivision"] for item in page_items], mapping, major, case):
            trend_by_label[row["subdivision"]].append(row)
    empty_products = {"products": [], "productsTruncated": False}
    details = [{
        **item,
        "trend": _category_trend(trend_by_label[item["subdivision"]]),
        **computed["products"].get(item["subdivision"], empty_products),
    } for item in page_items]

    unclassified_metric = {
        **_serialize_category({**(unclassified_row or {}), "resolved_category": unclassified_label}, mapped_net),
        "subdivision": unclassified_label,
    }
    data_cutoff = max((str(row.get("latest_business_date") or "") for row in computed["rows"]), default="") or None
    return {
        "range": {"startDate": params["startDate"], "endDate": params["endDate"], "endExclusive": add_days(params["endDate"], 1), "timezone": "Asia/Shanghai"},
        "comparisonPeriods": comparisons,
        "dataCutoffDate": data_cutoff,
        "mapping": mapping.mapping_info(major),
        "summary": summary,
        "coverage": computed["coverage"],
        "unclassified": {
            **unclassified_metric,
            "visible": unclassified_row is not None and (unclassified_metric["lineCount"] > 0 or unclassified_metric["netSalesCents"] != 0),
            **computed["products"].get(unclassified_label, empty_products),
        },
        "details": {
            "items": details,
            "pagination": {"page": params["page"], "pageSize": params["pageSize"], "total": len(metrics), "returned": len(details), "truncated": offset + len(details) < len(metrics)},
            "sort": {"by": params["sortBy"], "direction": params["direction"]},
            "trend": {"granularity": "day", "periodLimit": DETAIL_TREND_PERIOD_LIMIT},
        },
    }
