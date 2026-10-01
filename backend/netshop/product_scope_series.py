"""I-owned whole-shop product series projection over the published P algorithms.

This is an internal reader, not an endpoint or an alternative product fact store.
The full F carrier is unchanged. Compact cells reference point coverage and the
fixed column definition, and never turn an absent row/projected default into zero.
"""
from __future__ import annotations

from copy import deepcopy

from django.db import DatabaseError, transaction
from django.db.models import Case, F, TextField, Value, When

from . import product_insights as owner
from .errors import NetshopApiError
from .insights_common import actor_fence, period_groups, read_context, validate_context
from .query import _canonical_token


SCHEMA = "netshop-product-scope-series-v1"
PROJECTION = "point-field-cells-v1"
PERIODS = ("current", "previous", "yearAgo")
FIELD_KEYS = tuple(owner.ALL_FIELDS)
COLUMN_KEYS = tuple(dict.fromkeys((*owner.CORE_KEYS, *owner.EXTRA_KEYS, "visitorValue")))
SHARED_PARAMETERS = owner.SHARED_PARAMETERS


def validate_product_scope_series_query(params):
    if not hasattr(params, "getlist"):
        raise NetshopApiError("商品序列须使用规范查询参数")
    if set(params) - (SHARED_PARAMETERS | {"grain"}) or len(params.getlist("grain")) > 1:
        raise NetshopApiError("商品序列请求包含未知或重复参数")
    grain = params.get("grain", "day")
    if grain not in {"day", "week", "month"}:
        raise NetshopApiError("商品序列粒度无效")
    shared = params.copy()
    shared.pop("grain", None)
    spec = validate_context(shared)
    if len(spec["platforms"]) != 1 or len(spec["outlets"]) != 1:
        raise NetshopApiError("商品序列须显式选择一个平台和一家精确店铺")
    return {**spec, "grain": grain}


def _point_metrics(aggregate, context, kind, group):
    # P's identity flag checks dates on this exact bucket instead of applying
    # the whole-period completeness to a single day. This private evaluation
    # carrier is never returned in place of the original F context.
    evaluation = {**context, "periods": {**context["periods"], kind: {"days": len(group)}}}
    metrics = owner._metrics(aggregate, evaluation, kind, identity=True)
    metrics.update(owner._extra_metrics(aggregate, evaluation, kind, identity=True))
    metrics["visitorValue"] = owner._visitor_value(metrics)
    return metrics


def _dependencies(key):
    return {
        "conversion": ["customers", "visitors"],
        "addCartRate": ["addCartCustomers", "visitors"],
        "searchClickRate": ["searchClicks", "searchImpressions"],
        "visitorValue": ["payment", "visitors"],
    }.get(key, [key])


def _columns(context):
    sample = _point_metrics({}, context, "current", ["placeholder"])
    return [
        {
            "key": key,
            "unit": sample[key]["unit"],
            "basis": sample[key]["basis"],
            "aggregation": sample[key]["aggregation"],
            "sourceIds": sample[key]["sourceIds"],
            "fields": _dependencies(key),
            **({"metricSchemaVersion": sample[key]["metricSchemaVersion"],
                "denominatorKind": sample[key]["denominatorKind"]} if key == "visitorValue" else {}),
        }
        for key in COLUMN_KEYS
    ]


def _bucket_aggregates(rows, groups, grain, daily):
    if grain == "day":
        return daily
    # Group the whole authorized source in SQL using P's exact annotations.
    # Ratios are evaluated by P after sums; no averages of daily percentages.
    cases = [
        When(business_date__gte=group[0], business_date__lte=group[-1], then=Value(group[0]))
        for group in groups
    ]
    grouped = rows.annotate(_series_bucket=Case(*cases, output_field=TextField()))
    return {
        row["_series_bucket"]: row
        for row in grouped.values("_series_bucket").annotate(**owner._annotations(owner.ALL_FIELDS))
    }


def _read_series(principal, spec, deadline):
    try:
        # A SQL failure rolls back its transaction before being classified.
        # Permission and revision errors remain their original 403/409.
        with transaction.atomic():
            actor = actor_fence(principal)
            context = read_context(principal, owner._shared_spec(spec), deadline=deadline)
            expected_shop = spec["outlets"][0]["platform"] + "\x1f" + spec["outlets"][0]["shopName"]
            if context["effectiveScope"]["shopKeys"] != [expected_shop]:
                raise NetshopApiError("商品序列来源范围不等于请求单店", code="access_denied", status=403)
            base = owner._base(context)
            columns = _columns(context)
            series, point_coverage = {}, {}
            source, dataset = owner._source(spec["platforms"][0], spec["dimension"])
            for kind in PERIODS:
                owner._check_budget(deadline)
                window = context["periods"][kind]
                groups = period_groups(window["startDate"], window["endDate"], spec["grain"])
                rows = owner._window_rows(base, window)
                daily = {
                    row["business_date"]: row
                    for row in rows.values("business_date").annotate(**owner._annotations(owner.ALL_FIELDS))
                }
                buckets = _bucket_aggregates(rows, groups, spec["grain"], daily)
                points = []
                for group in groups:
                    owner._check_budget(deadline)
                    aggregate = buckets.get(group[0], {})
                    metrics = _point_metrics(aggregate, context, kind, group)
                    ref = f"series:{kind}:{group[0]}"
                    point_coverage[ref] = {
                        "sourceId": f"{source}:{dataset}:{spec['platforms'][0]}",
                        "shopKey": expected_shop,
                        "dates": group,
                        "observedDates": [day for day in group if day in daily],
                        "rows": int(aggregate.get("rows") or 0),
                        "presentCounts": [int(aggregate.get(key + "_present") or 0) for key in FIELD_KEYS],
                        "missingFieldDates": [
                            [day for day in group if day not in daily
                             or daily[day][key + "_present"] != daily[day]["rows"]]
                            for key in FIELD_KEYS
                        ],
                    }
                    # The fourth slot is a strict column coverage index. The
                    # point ref + that column's field dependencies resolve it.
                    cells = [
                        [metrics[key]["value"], metrics[key]["status"], metrics[key]["reasonCode"], index,
                         metrics[key].get("numerator"), metrics[key].get("denominator")]
                        for index, key in enumerate(COLUMN_KEYS)
                    ]
                    points.append({"date": group[0], "endDate": group[-1], "coverageRef": ref, "cells": cells})
                series[kind] = points
            payload = {
                "schemaVersion": SCHEMA,
                "projection": PROJECTION,
                "context": context,
                "grain": spec["grain"],
                "columnDefinitions": columns,
                "coverageFields": list(FIELD_KEYS),
                "pointCoverage": point_coverage,
                "series": series,
                "joinedSourceRevisions": deepcopy(context["sourceRevisions"]),
                "consistency": "revision_vector_checked",
                "sectionToken": _canonical_token({
                    "schema": SCHEMA, "projection": PROJECTION, "scope": context["scopeKey"],
                    "snapshot": context["snapshotToken"], "grain": spec["grain"], "columns": list(COLUMN_KEYS),
                }),
                "limitations": [
                    "商品×日人数累计不是店铺去重UV；SKU/SPU不能相加",
                    "没有停留时长、跳失率、自然/付费拆分或历史档案/库存来源证明",
                    "本投影保留全部F载体；cell须与column和pointCoverage共同解码，不是原P DTO",
                ],
            }
            return owner._finish(payload, principal, actor, deadline)
    except DatabaseError as error:
        owner._check_budget(deadline)
        raise NetshopApiError("商品序列来源读取失败", code="service_unavailable", status=503) from error


def read_product_scope_series(principal, params, *, deadline=None):
    """Read exact single-shop full-source three-period series within 65 seconds."""
    spec = validate_product_scope_series_query(params)
    return owner._execute_product_reader(principal, spec, _read_series, deadline)
