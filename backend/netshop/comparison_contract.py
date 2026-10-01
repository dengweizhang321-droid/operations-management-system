"""Strict C v1 request, with two independently valid shared current windows."""
from __future__ import annotations

import json
import re
from datetime import date

from django.http import QueryDict

from .errors import NetshopApiError
from .insights_common import validate_context
from .query import positive

COMPARISON_SCHEMA = "netshop-comparison-v1"
SHARED_PARAMETERS = {"platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"}
COMPARISON_PARAMETERS = {"comparisonScope", "selectedBaseline", "chartObjectKeys", "metricKey", "trendGrain", "page", "pageSize", "sort", "sectionToken"}
ERP_METRIC_KEYS = {"erpNetSales", "orderMargin", "largeMargin", "largeMarginAmount", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate"}
METRIC_KEYS = {"payment", "quantity", "visitors", "customers", "conversion", "visitorValue", "transactionOrders", "spend", "attributedPayment", "roas", "ctr", "cpc", "spendRate"} | ERP_METRIC_KEYS
SORTS = {"value_desc", "value_asc", "growth_desc", "decline_desc", "name_asc"}


def _json(raw, label):
    try:
        valid_size = type(raw) is str and len(raw.encode("utf-8")) <= 8192
    except UnicodeError as error:
        raise NetshopApiError(label + "须为有效UTF8 JSON") from error
    if not valid_size:
        raise NetshopApiError(label + "须为有界JSON")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise NetshopApiError(label + "包含重复JSON字段")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, RecursionError, UnicodeError) as error:
        raise NetshopApiError(label + "不是有效JSON") from error


def _closed(value, keys, label):
    if type(value) is not dict or set(value) != set(keys):
        raise NetshopApiError(label + "字段不符合闭集")


def _text(value, maximum, label):
    if type(value) is not str or not value or value != value.strip() or len(value) > maximum or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value):
        raise NetshopApiError(label + "无效")
    return value


def validate_comparison_category(value, platforms):
    if type(value) is not dict or type(value.get("mode")) is not str:
        raise NetshopApiError("比较类目无效")
    if value["mode"] in {"all", "unknown"}:
        _closed(value, {"mode"}, "比较类目")
    elif value["mode"] == "label_only":
        _closed(value, {"mode", "platform", "sourceId", "label", "evidenceVersion"}, "来源标签类目")
        if value["platform"] not in platforms:
            raise NetshopApiError("来源标签平台不属于比较范围")
        _text(value["label"], 120, "来源标签")
        _text(value["sourceId"], 200, "来源ID")
        _text(value["evidenceVersion"], 200, "类目证据版本")
    else:
        raise NetshopApiError("C v1不支持未经拥有方核验的类目ID", code="not_applicable", status=422)
    return value


def validate_selected_windows(current_spec, selected):
    if type(selected) is not dict or type(selected.get("kind")) is not str:
        raise NetshopApiError("比较基期无效")
    if selected["kind"] in {"previous", "yearAgo"}:
        _closed(selected, {"kind"}, "比较基期")
        window = current_spec["periods"][selected["kind"]]
        start, end = window["startDate"], window["endDate"]
    elif selected["kind"] == "custom":
        _closed(selected, {"kind", "startDate", "endDate"}, "自选基期")
        start, end = selected["startDate"], selected["endDate"]
    else:
        raise NetshopApiError("比较基期类型无效")
    for candidate in (start, end):
        if type(candidate) is not str:
            raise NetshopApiError("基期日期须为准确ISO自然日")
        try:
            if date.fromisoformat(candidate).isoformat() != candidate: raise ValueError()
        except ValueError as error:
            raise NetshopApiError("基期日期须为准确ISO自然日") from error
    if start > end:
        raise NetshopApiError("基期起始日不能晚于截止日")
    if (date.fromisoformat(end)-date.fromisoformat(start)).days + 1 > 366:
        raise NetshopApiError("所选基期无法绑定独立合法F current（最多366天）", code="not_applicable", status=422)
    shared = QueryDict("", mutable=True)
    shared.setlist("platform", current_spec["platforms"])
    shared.setlist("outlet", [o["platform"] + "\x1f" + o["shopName"] for o in current_spec["outlets"]])
    shared.update({"dimension": current_spec["dimension"], "startDate": start, "endDate": end, "periodKind": "custom"})
    return validate_context(shared)


def build_period_bindings(current_context, baseline_context):
    current, baseline = current_context["periods"]["current"], baseline_context["periods"]["current"]
    return {"current": current, "baseline": baseline,
            "equalLength": current["days"] == baseline["days"],
            "overlap": max(current["startDate"], baseline["startDate"]) <= min(current["endDate"], baseline["endDate"]),
            "amountScaling": "none", "dateAlignment": "independent_calendar_windows"}


def parse_comparison_v1(params):
    if not isinstance(params, QueryDict) or set(params)-SHARED_PARAMETERS-COMPARISON_PARAMETERS or any(len(params.getlist(k)) != 1 for k in params if k not in {"platform", "outlet"}):
        raise NetshopApiError("比较请求包含未知或重复参数")
    shared = params.copy()
    for key in COMPARISON_PARAMETERS:
        if key in shared: del shared[key]
    current = validate_context(shared)
    scope = _json(params.get("comparisonScope", '{"schemaVersion":"comparison-scope-v1","mode":"shop","metricSource":"platform","category":{"mode":"all"},"coverageFilter":"all"}'), "comparisonScope")
    _closed(scope, {"schemaVersion", "mode", "metricSource", "category", "coverageFilter"}, "comparisonScope")
    if any(type(scope[k]) is not str for k in ("schemaVersion", "mode", "metricSource", "coverageFilter")) or scope["schemaVersion"] != "comparison-scope-v1" or scope["mode"] not in {"shop", "platform"} or scope["metricSource"] not in {"platform", "erp"} or scope["coverageFilter"] not in {"all", "complete", "partial"}:
        raise NetshopApiError("comparisonScope枚举无效")
    validate_comparison_category(scope["category"], current["platforms"])
    selected = _json(params.get("selectedBaseline", '{"kind":"previous"}'), "selectedBaseline")
    baseline = validate_selected_windows(current, selected)
    charts = _json(params.get("chartObjectKeys", "[]"), "chartObjectKeys")
    if type(charts) is not list or len(charts) > 4 or any(type(k) is not str or not k or len(k) > 210 for k in charts) or len(set(charts)) != len(charts):
        raise NetshopApiError("主图须为最多4个唯一实际对象键")
    for key in charts:
        if key.startswith("shop:"):
            parts = key[5:].split("\x1f")
            if len(parts) != 2 or parts[0] not in {"京东", "天猫"}: raise NetshopApiError("主图店铺须精确平台店铺复合键")
            _text(parts[1], 100, "主图店铺")
        elif key not in {"platform:京东", "platform:天猫"}:
            raise NetshopApiError("主图对象键格式无效")
    metric, sort, grain = params.get("metricKey", "erpNetSales" if scope["metricSource"] == "erp" else "payment"), params.get("sort", "value_desc"), params.get("trendGrain", "day")
    if metric not in METRIC_KEYS or sort not in SORTS or grain not in {"day", "week", "month"}:
        raise NetshopApiError("比较指标、排序或趋势粒度无效")
    if (metric in ERP_METRIC_KEYS) != (scope["metricSource"] == "erp"):
        raise NetshopApiError("指标不属于所选来源")
    token = params.get("sectionToken")
    if token is not None and not re.fullmatch(r"[0-9a-f]{64}", token):
        raise NetshopApiError("比较sectionToken无效")
    for key in ("page", "pageSize"):
        if key in params and not re.fullmatch(r"[1-9][0-9]*", params[key]): raise NetshopApiError("比较分页须准确正整数")
    return {"currentSpec": current, "baselineSpec": baseline, "comparisonScope": scope,
            "selectedBaseline": selected, "chartObjectKeys": charts, "metricKey": metric,
            "sort": sort, "trendGrain": grain, "page": positive(params.get("page"), 1, "page", 10000),
            "pageSize": positive(params.get("pageSize"), 20, "pageSize", 100), "sectionToken": token}
