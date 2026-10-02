"""Bounded owning-reader aggregation for the balanced overview. No writes.

The selected SKU/SPU source is summed before formatting. Availability uses
normalized source fields, never typed-column default zero. Ratios require every
selected shop × day and promotion source/aggregate reconciliation.
"""
from __future__ import annotations

from datetime import date, timedelta
from calendar import monthrange
from math import isfinite
import uuid
import time
import json

from django.db.models import BooleanField, Count, F, Func, Max, Q, Sum

from sales.summary import _custom_comparison_period, _period_for
from sales.query import add_years
from .errors import NetshopApiError
from .models import (NetshopRow, NetshopImportBatch, NetshopPromotionShopDaily,
                     NetshopPromotionAggregateManifest, NetshopPromotionAggregateState,
                     NetshopProductDailyScopeRevision, NetshopPromotionScopeRevision)
from .query import period, positive, parse_outlets, _canonical_token, revision_value

MAX_SAFE = 9_007_199_254_740_991
KEYS = ("payment", "visitors", "customers", "spend", "promotionPayment", "spendRate", "conversion", "roas", "averageOrder", "uvValue", "paidVisitors", "freeVisitors", "b2bRate")
PRODUCT = {"payment": ("transaction_amount_cents", ("transactionAmountCents", "成交金额")), "visitors": ("visitors", ("visitors", "商品访客数")), "customers": ("transaction_customers", ("transactionCustomers", "成交客户数"))}
PROMOTION = {"spend": ("spend_cents", ("spendCents", "花费")), "promotionPayment": ("net_transaction_amount_cents", ("netTransactionAmountCents", "总订单金额"))}
SOURCES = {"京东": ("jd_sku_daily", "sku_daily", "jd_promotion", "ad"), "天猫": ("tmall_product_daily", "spu_daily", "tmall_promotion", "promotion_daily")}


def days(start, end):
    return [(date.fromisoformat(start) + timedelta(days=i)).isoformat() for i in range((date.fromisoformat(end)-date.fromisoformat(start)).days + 1)]


def window(start, end):
    return {"startDate": start, "endDate": end, "endExclusive": (date.fromisoformat(end)+timedelta(days=1)).isoformat(), "days": len(days(start, end))}


def periods(start, end, kind):
    try:
        selected = period(start, end, required=True)
    except (ValueError, OverflowError) as error:
        raise NetshopApiError("比较日期超出有效自然日范围") from error
    if selected["days"] > 366:
        raise NetshopApiError("网店总览最长支持366天")
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if s.year < 2 or e.year > 9998:
        raise NetshopApiError("比较日期超出有效自然日范围")
    preset_days = {"today": 1, "yesterday": 1, "last7": 7, "last15": 15, "last30": 30}
    if kind in preset_days and selected["days"] != preset_days[kind]:
        raise NetshopApiError("预设类型与实际起止日期不一致")
    if kind == "month" and (s.day != 1 or (s.year, s.month) != (e.year, e.month)):
        raise NetshopApiError("自然月类型与实际起止日期不一致")
    if kind in {"last7", "last15", "last30", "rolling"}:
        prior_end = s - timedelta(days=1)
        prior_start = prior_end - timedelta(days=selected["days"]-1)
        ps, pe, rule = str(prior_start), str(prior_end), "紧邻之前的等长滚动区间"
    elif kind == "quarter":
        p = _period_for("quarter", end)
        if p["startDate"] != start:
            raise NetshopApiError("季度范围与现系统规则不一致")
        ps, pe, rule = p["previousStartDate"], p["previousEndDate"], "现系统季度规则"
    else:
        ps, pe = _custom_comparison_period(s, e)
        rule = "前一日" if s == e else "上一完整自然月" if s.day == 1 and s.month == e.month and s.year == e.year and e.day == monthrange(e.year, e.month)[1] else "上月对应日期，月末收敛" if s.month == e.month and s.year == e.year else "紧邻之前的等长区间"
    return {"timezone": "Asia/Shanghai", "rule": rule, "ruleVersion": "sales-period-v1", "current": selected, "previous": window(ps, pe), "yearAgo": window(add_years(start, -1), add_years(end, -1))}


def validate(params):
    allowed = {"platform", "outlet", "startDate", "endDate", "periodKind", "trendGrain", "detailGrain", "previous", "yearAgo", "view", "shopKey", "overviewToken", "shopPage", "detailPage"}
    if set(params) - allowed or any(len(params.getlist(k)) != 1 for k in params if k != "outlet"):
        raise NetshopApiError("总览请求包含未知或重复参数")
    platform = params.get("platform")
    if platform not in SOURCES:
        raise NetshopApiError("必须选择唯一的天猫或京东平台")
    outlets = parse_outlets(params.getlist("outlet"), [platform])
    kind = params.get("periodKind", "custom")
    if kind not in {"today", "yesterday", "last7", "last15", "last30", "month", "quarter", "custom", "rolling", "all"}:
        raise NetshopApiError("统计周期类型无效")
    p = periods(params.get("startDate"), params.get("endDate"), kind)
    trend, detail, view = params.get("trendGrain", "day"), params.get("detailGrain", "day"), params.get("view", "overview")
    if trend not in {"day", "week", "month"} or detail not in {"day", "seven_days"} or view not in {"overview", "shop"}:
        raise NetshopApiError("总览视图或粒度无效")
    if params.get("previous", "1") not in {"0", "1"} or params.get("yearAgo", "1") not in {"0", "1"}:
        raise NetshopApiError("比较开关无效")
    if view == "shop" and (len(params.get("overviewToken", "")) != 64 or any(c not in "0123456789abcdef" for c in params.get("overviewToken", ""))):
        raise NetshopApiError("店铺详情需要有效overviewToken")
    return {"platform": platform, "outlets": outlets, "periods": p, "kind": kind, "trend": trend, "detail": detail, "view": view,
            "shopKey": params.get("shopKey"), "token": params.get("overviewToken"), "previous": params.get("previous", "1") == "1", "yearAgo": params.get("yearAgo", "1") == "1",
            "shopPage": positive(params.get("shopPage"), 1, "shopPage", 10000), "detailPage": positive(params.get("detailPage"), 1, "detailPage", 10000)}


def metric(key, value=None, status="unavailable", reason="unverified_source", sources=(), coverage=None):
    money = key in {"payment", "spend", "promotionPayment", "averageOrder", "uvValue"}
    unit = "CNY_CENT" if money else "MULTIPLE" if key == "roas" else "RATIO" if key in {"conversion", "spendRate", "b2bRate"} else "COUNT"
    if value is not None and (not isfinite(value) or unit in {"COUNT", "CNY_CENT"} and (type(value) is not int or abs(value) > MAX_SAFE)):
        value, status, reason = None, "invalid", "unsafe_integer"
    return {"value": value, "unit": unit, "status": status, "reasonCode": reason,
            "basis": "platform_attributed" if key in {"spend", "promotionPayment", "roas"} else "product_day_sum" if key in {"payment", "visitors", "customers", "conversion", "spendRate"} else "unverified",
            "sourceIds": list(sources), "coverage": coverage, "aggregation": "ratio_of_sums" if key in {"conversion", "spendRate", "roas"} else "sum" if key in PRODUCT or key in PROMOTION else "source_value_only"}


class NumericMetricPresent(Func):
    output_field = BooleanField()

    def __init__(self, names):
        self.names = names
        super().__init__(F("metrics_json"))

    def as_sql(self, compiler, connection, **extra):
        return self.as_postgresql(compiler, connection, **extra) if connection.vendor == "postgresql" else self.as_sqlite(compiler, connection, **extra)

    def as_postgresql(self, compiler, connection, **extra):
        column, params = compiler.compile(self.source_expressions[0])
        # This is a positive Count/Sum FILTER contract, not a public negated
        # predicate: absent/nonobject FALSE and the former SQL NULL both exclude.
        # Strict missing-key exists is UNKNOWN; an existing JSON null/string/
        # object/array must still block a later numeric alias. Strict root/type
        # guards also prevent lax array unwrapping and preserve numeric zero.
        paths = ["@." + json.dumps(name, ensure_ascii=False) for name in self.names]
        branches = []
        for index, path in enumerate(paths):
            prior = [f"(exists({previous})) is unknown" for previous in paths[:index]]
            branches.append("(" + " && ".join([*prior, f"exists({path})", f'{path}.type() == "number"']) + ")")
        query = 'strict $ ? (@.type() == "object") ? (' + " || ".join(branches) + ")"
        return f"jsonb_path_exists({column}, %s::jsonpath, '{{}}'::jsonb, true)", [*params, query]


    def as_sqlite(self, compiler, connection, **extra):
        column, params = compiler.compile(self.source_expressions[0])
        clauses, values = [], []
        for name in self.names:
            path = "$." + json.dumps(name, ensure_ascii=False)
            clauses.append(f"JSON_TYPE({column}, %s) IN ('integer','real')")
            values.extend([*params, path])
        return "(" + " OR ".join(clauses) + ")", values


def aggregate(queryset, fields):
    annotations = {"row_count": Count("id")}
    for key, (column, source_fields) in fields.items():
        # One JSON predicate per field, instead of repeating TOAST extraction
        # in sums and several scalar comparisons on the large JD source.
        annotations[key] = Sum(column)
        annotations[key + "_present"] = Count("id", filter=NumericMetricPresent(source_fields))
    return {(row["shop_name"], row["business_date"]): row for row in queryset.values("shop_name", "business_date").annotate(**annotations)}


def grouped_dates(selected, grain):
    groups = []
    for d in selected:
        parsed = date.fromisoformat(d)
        key = d if grain == "day" else str(parsed - timedelta(days=parsed.weekday())) if grain == "week" else d[:7]
        if not groups or groups[-1][0] != key:
            groups.append((key, []))
        groups[-1][1].append(d)
    return [g[1] for g in groups]


def source_versions(platform, selected_names, revision):
    source_revisions = {"netshop": revision}
    for model, label in [(NetshopProductDailyScopeRevision, "product"), (NetshopPromotionScopeRevision, "promotion")]:
        for shop_name, version in model.objects.filter(platform=platform, shop_name__in=selected_names).values_list("shop_name", "data_version"):
            source_revisions[label + ":" + platform + "\x1f" + shop_name] = str(version)
    manifest = NetshopPromotionAggregateManifest.objects.filter(platform=platform).first()
    source_revisions["promotionManifest"] = f"{manifest.data_version}:{manifest.ready}" if manifest else "absent"
    return source_revisions


def read(principal, spec):
    """Two fenced attempts; manifest and source revisions are separately bound."""
    deadline = time.monotonic() + 65
    for _ in range(2):
        before = revision_value()
        payload = _read_once(principal, spec, before, deadline)
        after = revision_value()
        bound_names = [o["shopName"] for o in spec["outlets"]] or [o["shopName"] for o in payload["shopOptions"]]
        if before == after and payload["sourceRevisions"] == source_versions(spec["platform"], bound_names, after):
            return payload
    raise NetshopApiError("网店来源版本持续变化，请重试总览", code="overview_revision_changed", status=409)


def _read_once(principal, spec, revision, deadline):
    def check_budget():
        if time.monotonic() > deadline:
            raise NetshopApiError("来源核验超过有界读取预算，请缩小范围后重试", code="source_not_ready", status=503)
    platform, p = spec["platform"], spec["periods"]
    product_source, product_dataset, promo_source, promo_dataset = SOURCES[platform]
    base = NetshopRow.objects.filter(platform=platform)
    product_base = base.filter(source=product_source, dataset=product_dataset)
    promo_base = base.filter(source=promo_source, dataset=promo_dataset)
    names = sorted(set(product_base.values_list("shop_name", flat=True).distinct()) | set(promo_base.values_list("shop_name", flat=True).distinct()))
    if len(names) > 50:
        raise NetshopApiError("授权店铺超过50家，请缩小范围", code="quality_incomplete", status=422)
    options = [{"shopKey": platform + "\x1f" + name, "shopName": name} for name in names if name]
    selected_names = [o["shopName"] for o in spec["outlets"]] or [o["shopName"] for o in options]
    # Empty, but explicitly requested, scopes must remain missing rather than zero.
    source_revisions = source_versions(platform, selected_names, revision)
    manifest = NetshopPromotionAggregateManifest.objects.filter(platform=platform).first()
    binding = {"schema": "netshop-store-overview-v1", "sources": [product_source, product_dataset, promo_source, promo_dataset], "metricRuleVersion": "netshop-balanced-v1", "principal": {"email": principal.email, "role": principal.role, "scope": principal.scope},
               "platform": platform, "shops": sorted(selected_names), "periods": p, "kind": spec["kind"], "trend": spec["trend"], "detail": spec["detail"], "previous": spec["previous"], "yearAgo": spec["yearAgo"]}
    scope_key = _canonical_token(binding)
    token = _canonical_token({"scope": scope_key, "revisions": source_revisions})
    if spec["view"] == "shop":
        if spec["token"] != token:
            raise NetshopApiError("网店数据版本已变化，请刷新总览", code="overview_revision_changed", status=409)
        shop_filter = parse_outlets([spec["shopKey"] or ""], [platform])[0]
        if shop_filter["shopName"] not in selected_names:
            raise NetshopApiError("店铺不属于当前总览范围", code="access_denied", status=403)
        selected_names = [shop_filter["shopName"]]
    ranges = [p["current"]]
    if spec["previous"]: ranges.append(p["previous"])
    if spec["yearAgo"]: ranges.append(p["yearAgo"])
    before_start = str(date.fromisoformat(p["current"]["startDate"]) - timedelta(days=6))
    query_ranges = [window(before_start, p["current"]["endDate"])] + ranges[1:]
    # Separate bounded windows keep the existing scope/date index usable; an
    # OR over current/previous/year windows produced a broad heap scan on JD.
    def scoped_rows(base_rows, w):
        return base_rows.filter(shop_name__in=selected_names, business_date__gte=w["startDate"], business_date__lt=w["endExclusive"], last_import_batch_id__in=completed)
    completed = NetshopImportBatch.objects.filter(status="completed", platform=platform).values("id")
    product, raw_promotion = {}, {}
    for w in query_ranges:
        check_budget()
        product.update(aggregate(scoped_rows(product_base, w), PRODUCT))
        # Wide JD reports carry hundreds of source fields. Bound each source
        # verification query to seven days while preserving the exact union.
        wd = days(w["startDate"], w["endDate"])
        for offset in range(0, len(wd), 7):
            check_budget()
            chunk = window(wd[offset], wd[min(offset + 6, len(wd) - 1)])
            raw_promotion.update(aggregate(scoped_rows(promo_base, chunk), PROMOTION))
    date_filter = Q(business_date__gte=before_start, business_date__lt=p["current"]["endExclusive"])
    for w in ranges[1:]: date_filter |= Q(business_date__gte=w["startDate"], business_date__lt=w["endExclusive"])
    promoted = {(r["shop_name"], r["business_date"]): r for r in NetshopPromotionShopDaily.objects.filter(date_filter, platform=platform, shop_name__in=selected_names, source=promo_source).values("shop_name", "business_date", "spend_cents", "net_transaction_amount_cents", "source_row_count")}
    states = {(r["shop_name"], r["business_date"]): r for r in NetshopPromotionAggregateState.objects.filter(date_filter, platform=platform, shop_name__in=selected_names, source=promo_source).values("shop_name", "business_date", "ready", "raw_row_count")}

    def value_for(key, names, dates):
        source = product_source if key in PRODUCT else promo_source
        mapping = product if key in PRODUCT else raw_promotion
        expected = len(names) * len(dates)
        if not expected:
            return metric(key, reason="no_records", sources=[source])
        valid_values, missing_reason = [], "no_records"
        for name in names:
            for day in dates:
                row = mapping.get((name, day))
                if row is None: continue
                if row[key + "_present"] != row["row_count"]:
                    missing_reason = "missing_field"; continue
                if key in PROMOTION:
                    if manifest is None or not manifest.ready:
                        missing_reason = "promotion_not_ready"; continue
                    a, state = promoted.get((name, day)), states.get((name, day))
                    column = PROMOTION[key][0]
                    if not a or not state or not state["ready"] or a["source_row_count"] != row["row_count"] or state["raw_row_count"] != row["row_count"] or a[column] != row[key]:
                        missing_reason = "promotion_mismatch"; continue
                valid_values.append(row[key])
        if not valid_values:
            return metric(key, reason=missing_reason, sources=[source], coverage={"coveredShopDatePairs": 0, "expectedShopDatePairs": expected})
        complete = len(valid_values) == expected
        return metric(key, sum(valid_values), "available" if complete else "partial", None if complete else "missing_field" if missing_reason == "missing_field" else "incomplete_coverage", [source], coverage={"coveredShopDatePairs": len(valid_values), "expectedShopDatePairs": expected})

    def totals(names, dates):
        result = {k: value_for(k, names, dates) for k in (*PRODUCT, *PROMOTION)}
        for key, numerator, denominator in [("conversion", "customers", "visitors"), ("spendRate", "spend", "payment"), ("roas", "promotionPayment", "spend")]:
            a, b = result[numerator], result[denominator]
            sources = list(dict.fromkeys(a["sourceIds"] + b["sourceIds"]))
            if a["status"] != "available" or b["status"] != "available": result[key] = metric(key, reason="incomplete_coverage", sources=sources)
            elif b["value"] == 0: result[key] = metric(key, reason="zero_denominator", sources=sources)
            else: result[key] = metric(key, a["value"] / b["value"], "available", None, sources)
        for key in KEYS:
            if key not in result: result[key] = metric(key)
        return result

    def compare(current, prior):
        result = {}
        for k in KEYS:
            a, b = current[k], prior[k]
            method = "percentage_points" if a["unit"] == "RATIO" else "relative_change"
            reason = "no_comparable_date" if b["reasonCode"] == "no_comparable_date" else "incomplete_baseline" if a["status"] != "available" or b["status"] != "available" else "zero_denominator" if method == "relative_change" and b["value"] == 0 else "negative_baseline" if method == "relative_change" and b["value"] < 0 else None
            value = None if reason else (a["value"] - b["value"])*100 if method == "percentage_points" else (a["value"]-b["value"])/abs(b["value"])
            result[k] = {"value": value, "method": method, "status": "unavailable" if reason else "available", "reasonCode": reason}
        return result

    current_dates = days(p["current"]["startDate"], p["current"]["endDate"])
    previous_dates = days(p["previous"]["startDate"], p["previous"]["endDate"])
    year_dates = days(p["yearAgo"]["startDate"], p["yearAgo"]["endDate"])

    def matched_dates(selected, comparison):
        candidate = previous_dates if comparison == "previous" else year_dates
        calendar = comparison == "yearAgo" or p["rule"] in {"上一完整自然月", "上月对应日期，月末收敛"}
        output = []
        for day in selected:
            if calendar:
                d = date.fromisoformat(day)
                if comparison == "yearAgo": y, m = d.year - 1, d.month
                else:
                    y, m = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
                if d.day > monthrange(y, m)[1]: return None
                target = date(y, m, d.day).isoformat()
            else:
                i = current_dates.index(day)
                if i >= len(candidate): return None
                target = candidate[i]
            if target not in candidate: return None
            output.append(target)
        return output if len(set(output)) == len(output) else None

    unavailable = {k: metric(k, reason="no_comparable_date") for k in KEYS}

    def comparisons(current, previous, year):
        a, b = compare(current, previous), compare(current, year)
        return {k: {"previous": a[k], "yearAgo": b[k]} for k in KEYS}

    def row(names, selected):
        current = totals(names, selected)
        matched = {k: matched_dates(selected, k) for k in ["previous", "yearAgo"]}
        previous = totals(names, matched["previous"]) if spec["previous"] and matched["previous"] else unavailable
        year = totals(names, matched["yearAgo"]) if spec["yearAgo"] and matched["yearAgo"] else unavailable
        return {"startDate": selected[0], "endDate": selected[-1], "days": len(selected), "metrics": current, "comparisons": comparisons(current, previous, year),
                "comparisonDates": {k: window(ds[0], ds[-1]) if ds else None for k, ds in matched.items()},
                "comparisonValues": {"previous": {k: previous[k]["value"] if previous[k]["status"] == "available" else None for k in ["payment", "spend"]}, "yearAgo": {k: year[k]["value"] if year[k]["status"] == "available" else None for k in ["payment", "spend"]}}}

    def summary_for(names):
        current = totals(names, current_dates)
        previous = totals(names, previous_dates) if spec["previous"] else unavailable
        year = totals(names, year_dates) if spec["yearAgo"] else unavailable
        return current, comparisons(current, previous, year)

    summary, comps = summary_for(selected_names)
    daily = [row(selected_names, [d]) for d in current_dates]
    trend = [row(selected_names, ds) for ds in grouped_dates(current_dates, spec["trend"])]
    detail_groups = [[d] for d in current_dates] if spec["detail"] == "day" else [current_dates[i:i+7] for i in range(0, len(current_dates), 7)]
    detail_groups.reverse()
    detail_offset = (spec["detailPage"]-1)*5
    details = [row(selected_names, ds) for ds in detail_groups[detail_offset:detail_offset+5]]
    shop_offset = (spec["shopPage"]-1)*10
    shops = []
    for name in selected_names[shop_offset:shop_offset+10]:
        stats, c = summary_for([name])
        shops.append({"shopKey": platform+"\x1f"+name, "shopName": name, "metrics": stats, "comparisons": c})
    moving = []
    for d in current_dates:
        dates = days(str(date.fromisoformat(d)-timedelta(days=6)), d)
        m = value_for("payment", selected_names, dates)
        moving.append({"date": d, "paymentCents": round(m["value"] / 7) if m["status"] == "available" else None})

    def coverage(mapping):
        missing = [{"shopKey": platform+"\x1f"+name, "dates": [d for d in current_dates if (name, d) not in mapping]} for name in selected_names]
        expected = len(selected_names)*len(current_dates)
        covered = expected - sum(len(s["dates"]) for s in missing)
        return {"expectedShopDatePairs": expected, "coveredShopDatePairs": covered, "complete": expected > 0 and covered == expected, "missingByShop": [s for s in missing if s["dates"]], "truncated": False}

    freshness = [{"sourceId": source, "dataThrough": rows.filter(shop_name__in=selected_names, last_import_batch_id__in=completed).aggregate(value=Max("business_date"))["value"]} for source, rows in [(product_source, product_base), (promo_source, promo_base)]]
    check_budget()
    return {"schemaVersion": "netshop-store-overview-v1", "requestId": str(uuid.uuid4()), "scopeKey": scope_key, "overviewToken": token, "sourceRevisions": source_revisions,
            "filters": {"platform": platform, "shopKeys": [platform+"\x1f"+n for n in selected_names], "periodKind": spec["kind"], "trendGrain": spec["trend"], "detailGrain": spec["detail"]},
            "periods": p, "freshness": freshness, "coverageBySource": {product_source: coverage(product), promo_source: coverage(raw_promotion)},
            "summary": summary, "comparisons": comps, "daily": daily, "trend": trend, "details": details,
            "detailPagination": {"page": spec["detailPage"], "pageSize": 5, "total": len(detail_groups), "hasMore": detail_offset+5 < len(detail_groups)},
            "shopOptions": options, "shops": shops, "shopPagination": {"page": spec["shopPage"], "pageSize": 10, "total": len(selected_names), "hasMore": shop_offset+10 < len(selected_names)},
            "movingAverage": moving, "annotations": []}
