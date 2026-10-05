"""Read-only ERP/Jackyun part of the approved BI cockpit.

Existing sales authority, business-row exclusion and source identities remain
owning facts. Amounts are cents; absent periods are never healthy zeroes.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from django.db import connection
from django.db.models import Count, F, Func, JSONField, Q, Sum, BigIntegerField, Value
from django.db.models.functions import Coalesce, Length, Trim
from django.utils import timezone

from sales.models import ErpProductMaster, SalesOrderLine
from sales.query import add_days, add_years, metric_aggregates, sales_queryset, serialize_metric
from sales.summary import _custom_period, _period_for

from .errors import BiApiError

MAX_SAFE = 9_007_199_254_740_991
MAX_MEMBERS = 200
RANGES = {"today", "yesterday", "last7", "last15", "last30", "month", "quarter", "custom"}


def _text(value, label, maximum=200):
    if not isinstance(value, str) or value != value.strip() or len(value) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise BiApiError(f"{label}无效")
    return value


def parse_options(query):
    allowed = {"range", "startDate", "endDate", "platform", "shop"}
    if set(query) - allowed or any(len(query.getlist(key)) != 1 for key in query):
        raise BiApiError("驾驶舱参数未知或重复")
    range_name = query.get("range", "month")
    if range_name not in RANGES:
        raise BiApiError("驾驶舱统计周期无效")
    start, end = query.get("startDate"), query.get("endDate")
    if range_name == "custom":
        try:
            first, last = date.fromisoformat(start), date.fromisoformat(end)
            if first.isoformat() != start or last.isoformat() != end or not 1 <= (last - first).days + 1 <= 366:
                raise ValueError()
        except (TypeError, ValueError, OverflowError) as error:
            raise BiApiError("自定义周期须为有效的1—366个自然日") from error
    elif start is not None or end is not None:
        raise BiApiError("只有自定义周期可提供起止日期")
    platform = _text(query.get("platform", ""), "平台")
    shop = _text(query.get("shop", ""), "店铺")
    if shop and not platform:
        raise BiApiError("店铺必须与平台一起选择")
    return {"range": range_name, "startDate": start, "endDate": end, "platform": platform, "shop": shop}


def _window(start, end, *, allow_empty=False):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    empty = allow_empty and first == last + timedelta(days=1)
    if first.year < 2 or last.year > 9998 or first > last and not empty:
        raise BiApiError("比较日期超出有效范围")
    return {"startDate": start, "endDate": end, "endExclusive": add_days(end, 1), "days": (last - first).days + 1}


def periods(options, today=None):
    today = today or timezone.localdate()
    yesterday = (today - timedelta(days=1)).isoformat()
    kind = options["range"]
    if kind == "custom":
        if options["endDate"] > yesterday:
            raise BiApiError("经营日期不能晚于上海昨天；当天来源未完成")
        chosen = _custom_period(options["startDate"], options["endDate"])
    elif kind == "today":
        raise BiApiError("当天经营数据尚未完成，请选择昨天或其他完整周期")
    elif kind == "yesterday":
        chosen = _custom_period(yesterday, yesterday)
    else:
        chosen = _period_for(kind, yesterday)
    current = _window(chosen["startDate"], chosen["endDate"])
    previous = _window(chosen["previousStartDate"], chosen["previousEndDate"])
    year_ago = _window(add_years(current["startDate"], -1), add_years(current["endDate"], -1))
    # Goals belong to the current Shanghai calendar, even on Jan 1 / month 1.
    # Their actuals stop at yesterday; an unstarted current period is unknown,
    # not a fabricated zero and not the previous year's/month's target.
    year = today.year; month_start = today.replace(day=1).isoformat()
    if today.day == 1:
        previous_first = (today - timedelta(days=1)).replace(day=1)
        prior_month = {"previousStartDate": previous_first.isoformat(), "previousEndDate": (previous_first-timedelta(days=1)).isoformat()}
    else:
        prior_month = _custom_period(month_start, yesterday)
    annual_prior_end = (date.fromisoformat(month_start) - timedelta(days=1)).isoformat()
    goal_windows = {
        "annual": _window(f"{year}-01-01", yesterday, allow_empty=True),
        "annualYearAgo": _window(f"{year - 1}-01-01", add_years(yesterday, -1), allow_empty=True),
        "month": _window(month_start, yesterday, allow_empty=True),
        "monthPrevious": _window(prior_month["previousStartDate"], prior_month["previousEndDate"], allow_empty=True),
        "monthYearAgo": _window(add_years(month_start, -1), add_years(yesterday, -1), allow_empty=True),
    }
    if annual_prior_end >= f"{year}-01-01":
        goal_windows["annualPrevious"] = _window(f"{year}-01-01", annual_prior_end)
    return {"timezone": "Asia/Shanghai", "asOfDate": yesterday, "current": current, "previous": previous, "yearAgo": year_ago,
            "goalWindows": goal_windows, "rule": "同月上月同期；滚动/跨月前等长区间"}


def _query(windows, principal, options):
    first = min(window["startDate"] for window in windows.values())
    end = max(window["endExclusive"] for window in windows.values())
    queryset, _ = sales_queryset(start_date=first, end_exclusive=end, principal=principal,
        platforms=[options["platform"]] if options["platform"] else [],
        outlets=[{"platform": options["platform"], "shop": options["shop"]}] if options["shop"] else [], category_contract=True)
    included = Q()
    for window in windows.values():
        included |= _filter(window)
    return queryset.filter(included).annotate(_order_trim=Trim("order_no"), _order_len=Length("order_no"))


def _filter(window):
    return Q(business_date__gte=window["startDate"], business_date__lt=window["endExclusive"])


def _aggregates(windows):
    expressions = {}
    trusted = Q(_order_len__gte=1, _order_len__lte=200, order_no=F("_order_trim")) & ~Q(order_no="") & ~Q(order_no__regex=r"[\x00-\x1f\x7f]")
    function = "jsonb_build_array" if connection.vendor == "postgresql" else "json_array"
    identity = Func(*(F(key) for key in ("platform", "shop_name", "channel", "order_no")), function=function, output_field=JSONField())
    for label, window in windows.items():
        condition = _filter(window)
        for name, expr in metric_aggregates(filter_q=condition).items():
            expressions[f"{label}_{name}"] = expr
        expressions[f"{label}_rows"] = Count("pk", filter=condition)
        expressions[f"{label}_days"] = Count("business_date", distinct=True, filter=condition)
        expressions[f"{label}_trusted_orders"] = Count(identity, distinct=True, filter=condition & trusted)
        expressions[f"{label}_trusted_rows"] = Count("pk", filter=condition & trusted)
    return expressions


def _safe(value):
    if isinstance(value, bool) or not isinstance(value, int) or abs(value) > MAX_SAFE:
        raise BiApiError("经营金额或计数超过无损整数范围", code="unsafe_integer", status=413)
    return value


def _goal_aggregates(windows):
    return {key: expression for label, window in windows.items() for key, expression in (
        (f"{label}_net", Coalesce(Sum("allocated_amount_cents", filter=_filter(window), output_field=BigIntegerField()), Value(0))),
        (f"{label}_rows", Count("pk", filter=_filter(window))),
        (f"{label}_days", Count("business_date", distinct=True, filter=_filter(window))),
    )}


def _goal_metrics(row, label, window):
    count = int(row[f"{label}_rows"] or 0)
    days = int(row[f"{label}_days"] or 0)
    return {"netSalesCents": _safe(int(row[f"{label}_net"] or 0)) if count else None, "rowCount": count,
        "coverage": {"observedDays": days, "expectedDays": window["days"], "dateComplete": window["days"] > 0 and days == window["days"], "basis": "published_business_row_dates"}}


def _metrics(row, label, window):
    raw = {name: int(row.get(f"{label}_{name}") or 0) for name in metric_aggregates()}
    for value in raw.values():
        _safe(value)
    present = int(row.get(f"{label}_rows") or 0)
    covered_days = int(row.get(f"{label}_days") or 0)
    orders = int(row.get(f"{label}_trusted_orders") or 0)
    missing_orders = present - int(row.get(f"{label}_trusted_rows") or 0)
    value = serialize_metric(raw)
    net, cost = _safe(value["netSalesCents"]), _safe(value["costAmountCents"])
    large_margin = _safe(net - cost)
    return {"netSalesCents": net if present else None, "costCents": cost if present else None,
        "grossProfitCents": large_margin if present else None, "orderMarginCents": raw["gross_profit_cents"] if present else None,
        "positiveSalesCents": value["grossSalesCents"] if present else None, "refundCents": value["refundAmountCents"] if present else None,
        "grossMarginRate": large_margin / net if present and net > 0 else None,
        "refundRate": value["refundAmountCents"] / value["grossSalesCents"] if present and value["grossSalesCents"] > 0 else None,
        "trustedOrders": orders if present else None, "missingOrderNoRows": missing_orders if present else None,
        "averageOrderValueCents": net / orders if present and orders > 0 and missing_orders == 0 else None,
        "orderStatus": "available" if present and orders > 0 and missing_orders == 0 else "missing_order_no" if missing_orders else "no_records",
        "rowCount": present, "status": "available" if present else "unavailable",
        "coverage": {"observedDays": covered_days, "expectedDays": window["days"], "dateComplete": covered_days == window["days"],
            "basis": "published_business_row_dates", "disclosure": "仅证明已导入记录日期覆盖，不将缺记录日期假定零交易"}}


def _change(current, baseline):
    if current["netSalesCents"] is None or baseline["netSalesCents"] is None or baseline["netSalesCents"] <= 0:
        return None
    if not current["coverage"]["dateComplete"] or not baseline["coverage"]["dateComplete"]:
        return None
    return (current["netSalesCents"] - baseline["netSalesCents"]) / baseline["netSalesCents"]


def _bounded_groups(queryset, fields, windows):
    rows = list(queryset.values(*fields).annotate(**_aggregates(windows)).order_by(*fields)[:MAX_MEMBERS + 1])
    if len(rows) > MAX_MEMBERS:
        raise BiApiError("经营成员超过200项，请缩小范围；没有截断结果", code="capacity_exceeded", status=413)
    return rows


def sales_projection(principal, options):
    if principal.scope is not None:
        raise BiApiError("BI驾驶舱仅支持未受限数据范围账号", code="access_denied", status=403)
    spec = periods(options)
    windows = {key: spec[key] for key in ("current", "previous", "yearAgo")}
    queryset = _query(windows, principal, options)
    totals_row = queryset.aggregate(**_aggregates(windows))
    totals = {label: _metrics(totals_row, label, window) for label, window in windows.items()}
    shops = []
    for row in _bounded_groups(queryset, ["platform_key", "shop_key"], windows):
        values = {label: _metrics(row, label, window) for label, window in windows.items()}
        current, old = values["current"], values["yearAgo"]
        change = _change(current, old)
        shops.append({"key": json.dumps([row["platform_key"], row["shop_key"]], ensure_ascii=False, separators=(",", ":")),
            "platform": row["platform_key"], "name": row["shop_key"], **values, "yoy": change,
            "deltaCents": current["netSalesCents"] - old["netSalesCents"] if change is not None else None,
            "severity": "unknown" if change is None else "severe" if change <= -.2 else "warning" if change <= -.1 else "decline" if change < 0 else "healthy"})
    shops.sort(key=lambda row: row["yoy"] if row["yoy"] is not None else float("inf"))
    category_rows = _bounded_groups(queryset, ["resolved_category"], windows)
    categories = []
    for row in category_rows:
        values = {label: _metrics(row, label, window) for label, window in windows.items()}
        categories.append({"name": row["resolved_category"] or "未分类", **values,
            "yoy": _change(values["current"], values["yearAgo"]), "mom": _change(values["current"], values["previous"]),
            "categoryBasis": "jackyun_resolved_category"})
    categories.sort(key=lambda row: -(row["current"]["netSalesCents"] or 0))
    current_window = {"current": spec["current"]}
    daily_rows = list(_query(current_window, principal, options).values("business_date").annotate(**_aggregates(current_window)).order_by("business_date"))
    daily = [{"date": row["business_date"].isoformat(), **_metrics(row, "current", {**spec["current"], "days": 1})} for row in daily_rows]
    goal_windows = spec["goalWindows"]
    goal_query = _query(goal_windows, principal, options)
    goal_totals = goal_query.aggregate(**_goal_aggregates(goal_windows))
    goal_rows = list(goal_query.values("platform_key", "shop_key").annotate(**_goal_aggregates(goal_windows)).order_by("platform_key", "shop_key")[:MAX_MEMBERS + 1])
    if len(goal_rows) > MAX_MEMBERS:
        raise BiApiError("目标实际店铺超过200项，未截断", code="capacity_exceeded", status=413)
    actuals = {label: _goal_metrics(goal_totals, label, window) for label, window in goal_windows.items()}
    actuals["shops"] = [{"platform": row["platform_key"], "shop": row["shop_key"],
        "periods": {label: _goal_metrics(row, label, window) for label, window in goal_windows.items()}} for row in goal_rows]
    catalog_rows = list(SalesOrderLine.objects.filter(is_business_row=True).values("platform_key", "shop_key").distinct().order_by("platform_key", "shop_key")[:MAX_MEMBERS + 1])
    if len(catalog_rows) > MAX_MEMBERS:
        raise BiApiError("ERP选项超过200项，不能静默截断", code="capacity_exceeded", status=413)
    return {"periods": spec, "filters": {"platform": options["platform"], "shop": options["shop"]},
        "options": [{"platform": row["platform_key"], "shop": row["shop_key"]} for row in catalog_rows],
        "sales": {**totals, "daily": daily}, "shops": shops, "categories": categories, "goalActuals": actuals,
        "limitations": ["ERP净销售、大毛利、可信原订单均值各按所属规则；不是财报利润或支付客户客单价", "比较须有已导入记录日期覆盖，缺失/非正基期不按新增或正常处理"]}
