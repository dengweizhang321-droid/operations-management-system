"""Category subdivision analysis (third tab of the sales category analysis).

Products are mapped to subdivisions by ``subdivisions.resolve`` (code first,
name second). A mapped product counts toward its subdivision regardless of its
ERP category. Products whose ERP category is covered by a map but that are not
in the map form the separate "unclassified" bucket, which never enters the
subdivision table and is not part of the share denominator.
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
    GRANULARITIES,
    SORT_KEYS,
    _base,
    _category_trend,
    _comparison_aggregates,
    _comparison_periods,
    _comparison_queryset,
    _period_annotation,
    _serialize_category,
    _validate_range,
)
from .query import SalesRequestError, add_days, binary_text_key, category_aggregates

PAIR_LIMIT = 5000
PRODUCT_LIMIT = 50

_SORT_KEY_MAP = {key: key for key in SORT_KEYS} | {"shareRate": "netSalesCents"}
_SUMMARY_KEYS = {
    "grossSalesCents": "gross_sales_cents", "refundAmountCents": "refund_amount_cents",
    "netSalesCents": "net_sales_cents", "costAmountCents": "cost_amount_cents",
    "positiveQuantity": "positive_quantity", "returnQuantity": "return_quantity",
    "netQuantity": "net_quantity", "grossProfitCents": "gross_profit_cents",
    "productCount": "product_count", "lineCount": "line_count",
}


def candidate_filter() -> Q:
    """Covered ERP category, or an exact hit on a raw map code/name."""
    return (
        Q(resolved_category__in=list(subdivisions.covered_categories()))
        | Q(product_code__in=list(subdivisions.raw_codes()))
        | Q(product_name__in=list(subdivisions.raw_names()))
    )


def _subdivision_case(pairs: Sequence[tuple[str, str]]):
    codes: dict[str, set[str]] = defaultdict(set)
    names: dict[str, set[str]] = defaultdict(set)
    for code, name in pairs:
        label, matched_by = subdivisions.resolve(code, name)
        if matched_by == "code" and label:
            codes[label].add(code)
        elif matched_by == "name" and label:
            names[label].add(name)
    # Every code branch precedes every name branch so code always wins; the
    # unclassified branch is last so any mapped product keeps its subdivision.
    whens = [When(product_code__in=sorted(values), then=Value(label)) for label, values in sorted(codes.items())]
    whens += [When(product_name__in=sorted(values), then=Value(label)) for label, values in sorted(names.items())]
    whens.append(When(resolved_category__in=list(subdivisions.covered_categories()), then=Value(subdivisions.UNCLASSIFIED_LABEL)))
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


def _compute(params: dict[str, Any], principal: Principal, comparisons: dict[str, Any]) -> dict[str, Any]:
    union_queryset, scope_mode = _comparison_queryset(params, principal, comparisons)
    union_queryset = union_queryset.filter(candidate_filter())
    pair_rows = [tuple(pair) for pair in union_queryset.order_by().values_list("product_code", "product_name").distinct()[: PAIR_LIMIT + 1]]
    if len(pair_rows) > PAIR_LIMIT:
        raise SalesRequestError(f"品类细分商品数超过 {PAIR_LIMIT}，暂不支持")
    case = _subdivision_case(pair_rows)
    group_rows = list(
        union_queryset.annotate(subdivision=case).exclude(subdivision="")
        .order_by().values("subdivision").annotate(**_comparison_aggregates(params, comparisons))
        .filter(line_count__gt=0)
    )

    current_queryset, _ = _base(params, principal)
    product_rows = list(
        current_queryset.filter(candidate_filter()).annotate(subdivision=case).exclude(subdivision="")
        .order_by().values("subdivision", "product_code", "product_name", "resolved_category")
        .annotate(**category_aggregates()).filter(line_count__gt=0)
    )
    products: dict[str, list[dict[str, Any]]] = defaultdict(list)
    coverage_keys: dict[str, set[str]] = {key: set() for key in ("code", "name", "unclassified")}
    coverage_net = {key: 0 for key in coverage_keys}
    for row in product_rows:
        label = row["subdivision"]
        code, name = row["product_code"] or "", row["product_name"] or ""
        matched_by = None if label == subdivisions.UNCLASSIFIED_LABEL else subdivisions.resolve(code, name)[1]
        bucket = matched_by or "unclassified"
        coverage_keys[bucket].add(code or f"name:{name}")
        coverage_net[bucket] += int(row["net_sales_cents"] or 0)
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
        "coverage": {key: {"productCount": len(coverage_keys[key]), "netSalesCents": coverage_net[key]} for key in coverage_keys},
    }


def _summary(rows: Sequence[dict[str, Any]]) -> dict[str, int | float]:
    result: dict[str, int | float] = {target: sum(int(row.get(source) or 0) for row in rows) for target, source in _SUMMARY_KEYS.items()}
    net = int(result["netSalesCents"])
    result["grossMarginRate"] = 0 if net == 0 else (net - int(result["costAmountCents"])) / net
    result["subdivisionCount"] = len(rows)
    return result


def _trend_rows(params: dict[str, Any], principal: Principal, labels: Sequence[str], case) -> list[dict[str, Any]]:
    if not labels:
        return []
    queryset, _ = _base(params, principal)
    queryset = queryset.filter(candidate_filter()).annotate(subdivision=case).filter(subdivision__in=list(labels))
    queryset = _period_annotation(queryset, params["granularity"])
    aggregate = category_aggregates()
    rows = list(queryset.order_by().values("period_key", "subdivision").annotate(net_sales_cents=aggregate["net_sales_cents"]))
    for row in rows:
        value = row["period_key"]
        normalized = value.isoformat() if hasattr(value, "isoformat") else str(value)
        row["period_key"] = normalized[:7] if params["granularity"] == "month" else normalized[:10]
    recent = set(sorted({row["period_key"] for row in rows}, reverse=True)[:DETAIL_TREND_PERIOD_LIMIT])
    rows = [row for row in rows if row["period_key"] in recent]
    rows.sort(key=lambda row: (row["period_key"], binary_text_key(row["subdivision"])))
    return rows


def get_subdivision_analysis(params: dict[str, Any], principal: Principal) -> dict[str, Any]:
    _validate_range(params["startDate"], params["endDate"])
    if params["granularity"] not in GRANULARITIES:
        raise SalesRequestError("granularity 必须是 day, week, month 之一")
    if params["sortBy"] not in SORT_KEYS:
        raise SalesRequestError("sortBy 无效")
    # The third tab is not narrowed by the category multi-select.
    params = {**params, "categories": []}
    comparisons = _comparison_periods(params["startDate"], params["endDate"])
    scope = {key: value for key, value in params.items() if key not in {"sortBy", "direction", "page", "pageSize", "granularity"}}
    scope["mapVersion"] = subdivisions.map_version()
    computed = reuse("category-subdivisions", scope, principal, lambda: _compute(params, principal, comparisons))

    unclassified_label = subdivisions.UNCLASSIFIED_LABEL
    mapped_rows = [row for row in computed["rows"] if row["subdivision"] != unclassified_label]
    unclassified_row = next((row for row in computed["rows"] if row["subdivision"] == unclassified_label), None)
    summary = _summary(mapped_rows)
    mapped_net = int(summary["netSalesCents"])
    metrics = [{**_serialize_category({**row, "resolved_category": row["subdivision"]}, mapped_net), "subdivision": row["subdivision"]} for row in mapped_rows]

    key = _SORT_KEY_MAP[params["sortBy"]]
    if params["direction"] == "desc":
        ordered = sorted(metrics, key=lambda item: (item[key] is None, -(item[key] or 0), binary_text_key(item["subdivision"])))
    else:
        # SQLite's ascending order places NULL before numeric values.
        ordered = sorted(metrics, key=lambda item: (item[key] is not None, item[key] or 0, binary_text_key(item["subdivision"])))
    offset = (params["page"] - 1) * params["pageSize"]
    page_items = ordered[offset : offset + params["pageSize"]]

    trend_by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if page_items:
        case = _subdivision_case(computed["pairs"])
        for row in _trend_rows(params, principal, [item["subdivision"] for item in page_items], case):
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
        "mapping": subdivisions.mapping_info(),
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
            "trend": {"granularity": params["granularity"], "periodLimit": DETAIL_TREND_PERIOD_LIMIT},
        },
    }
