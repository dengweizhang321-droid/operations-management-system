"""Promotion owning-reader: completed facts, exact identities and fenced sources.

No writes, source acquisition, new shared metric algorithm or report generator.
Product, plan and term tables are alternative views of the same promotion rows.
"""
from __future__ import annotations

import json
import time
from calendar import monthrange
from datetime import date

from django.db.models import Count, Exists, Max, Min, OuterRef, Q, Sum
from django.http import QueryDict

from .analysis import DIMENSION_FIELDS, _scalar
from .errors import NetshopApiError
from .insights_common import (MAX_SAFE, actor_fence, compare_metrics, context_versions,
                              coverage_for, period_groups, read_context,
                              validate_context, validate_metric)
from .models import (NetshopImportBatch, NetshopPromotionAggregateManifest,
                     NetshopPromotionAggregateState, NetshopPromotionProductDaily,
                     NetshopPromotionShopDaily, NetshopRow)
from .promotion_diagnostic import SHOP_NAME, MAX_SOURCE_ROWS
from .query import _canonical_token, positive, revision_value
from .store_overview import NumericMetricPresent, days

METRICS = {
    "spend": ("spend_cents", ("spendCents", "花费"), "CNY_CENT"),
    "attributedPayment": ("net_transaction_amount_cents", ("netTransactionAmountCents", "总订单金额"), "CNY_CENT"),
    "impressions": ("impressions", ("impressions", "展现数"), "COUNT"),
    "clicks": ("clicks", ("clicks", "点击数"), "COUNT"),
    "orders": ("net_orders", ("netOrders", "总订单行"), "COUNT"),
}
CONTROL_COLUMNS = tuple(v[0] for v in METRICS.values()) + ("gross_transaction_amount_cents", "favorites", "cart_quantity")
KEYS = (*METRICS, "roas", "ctr", "cpc", "spendRate")
CONTEXT_PARAMS = {"platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"}
EXTRA_PARAMS = {"q", "objectKind", "objectId", "shopKey", "page", "pageSize", "sort", "sectionToken", "trendGrain", "focusDate", "objectStartDate", "objectEndDate"}
MAX_GROUPS = 100_000
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def _budget(deadline):
    if time.monotonic() > deadline:
        raise NetshopApiError("推广读取超出65秒整体预算，请缩小范围", code="source_not_ready", status=503)


def _validate(params, detail=False):
    if set(params) - CONTEXT_PARAMS - EXTRA_PARAMS or any(len(params.getlist(k)) != 1 for k in params if k != "outlet"):
        raise NetshopApiError("推广请求包含未知或重复参数")
    platform = params.get("platform")
    if platform not in {"京东", "天猫"}:
        raise NetshopApiError("推广须选择唯一京东或天猫平台")
    context = QueryDict("", mutable=True)
    for key in CONTEXT_PARAMS:
        if key in params: context.setlist(key, params.getlist(key))
    # Denominator is the platform's actual source, independent of table views.
    dimension = "sku" if platform == "京东" else "spu"
    if params.get("dimension", dimension) != dimension:
        raise NetshopApiError("推广费率分母须京东SKU日或天猫SPU日", code="not_applicable", status=422)
    context["dimension"] = dimension
    spec = validate_context(context)
    kind = params.get("objectKind", "product")
    if kind not in {"product", "plan", "unit", "keyword", "search_term"}:
        raise NetshopApiError("推广对象类型无效")
    query = params.get("q", "")
    if len(query) > 120 or any(ord(c) < 32 or ord(c) == 127 for c in query): raise NetshopApiError("q最多120字符且不能含控制字符")
    query = query.strip()
    grain = params.get("trendGrain", "day")
    if grain not in {"day", "week", "month"}: raise NetshopApiError("趋势粒度无效")
    sort = params.get("sort", "spend_desc")
    if sort not in {"spend_desc", "attributedPayment_desc", "roas_desc", "spend_change_desc", "spend_change_asc"}:
        raise NetshopApiError("推广排序无效")
    focus = params.get("focusDate")
    if focus and focus not in days(spec["periods"]["current"]["startDate"], spec["periods"]["current"]["endDate"]):
        raise NetshopApiError("对象定位日不属于本期")
    start, end = params.get("objectStartDate"), params.get("objectEndDate")
    if bool(start) != bool(end) or focus and (start or end): raise NetshopApiError("对象日期须成对且不能与focusDate混用")
    if detail and (focus or start or end): raise NetshopApiError("详情使用原整期范围；对象定位日期只用于列表")
    if start and (start > end or start not in days(spec["periods"]["current"]["startDate"], spec["periods"]["current"]["endDate"]) or end not in days(spec["periods"]["current"]["startDate"], spec["periods"]["current"]["endDate"])):
        raise NetshopApiError("对象日期须属于本期")
    token = params.get("sectionToken")
    if token is not None and (len(token) != 64 or any(c not in "0123456789abcdef" for c in token)):
        raise NetshopApiError("sectionToken无效")
    object_id, shop_key = params.get("objectId"), params.get("shopKey")
    if detail and (not object_id or not shop_key or not token or "objectKind" not in params): raise NetshopApiError("推广详情须精确shopKey/objectId/objectKind/sectionToken")
    if object_id is not None and (len(object_id) != 64 or any(c not in "0123456789abcdef" for c in object_id) or not shop_key):
        raise NetshopApiError("推广objectId须为服务返回的稳定对象键且提供精确店铺")
    return spec, {"objectKind": kind, "q": query, "grain": grain, "focusDate": focus, "objectStartDate": start or focus, "objectEndDate": end or focus, "sort": sort,
                  "objectId": object_id, "shopKey": shop_key, "token": token,
                  "page": positive(params.get("page"), 1, "page", 10000),
                  "pageSize": positive(params.get("pageSize"), 20, "pageSize", 100)}


def _metric(key, ref, sources, value=None, status="unavailable", reason="no_records", *, numerator=None, denominator=None):
    unit = METRICS[key][2] if key in METRICS else "CNY_CENT" if key in {"payment", "cpc"} else "MULTIPLE" if key == "roas" else "RATIO"
    ratio = key in {"roas", "ctr", "cpc", "spendRate"}
    if value is not None and (abs(value) > MAX_SAFE or unit in {"CNY_CENT", "COUNT"} and not ratio and type(value) is not int):
        value, status, reason = None, "invalid", "unsafe_integer"
    result = {"value": value, "unit": unit, "status": status, "reasonCode": reason,
              "sourceIds": list(dict.fromkeys(sources)), "basis": "product_day_sum" if key in {"payment", "spendRate"} else "platform_attributed",
              "aggregation": "ratio_of_sums" if ratio else "sum", "coverageRef": ref}
    if ratio: result.update(numerator=numerator, denominator=denominator)
    if key == "cpc":
        from .insights_common import validate_derived_money_per_count
        result.update(metricSchemaVersion="netshop-money-per-count-v1", unit="CNY_CENT_PER_COUNT", denominatorKind="clicks")
        return validate_derived_money_per_count(result)
    return validate_metric(result)


def _ratio(key, a, b, ref):
    reason = ("unsafe_integer" if a["status"] == "invalid" or b["status"] == "invalid" else
              "incomplete_coverage" if a["status"] != "available" or b["status"] != "available" else
              "zero_denominator" if b["value"] == 0 else "negative_denominator" if b["value"] < 0 else "not_applicable" if key == "cpc" and a["value"] < 0 else None)
    return _metric(key, ref, a["sourceIds"]+b["sourceIds"], None if reason else a["value"]/b["value"],
                   "invalid" if reason == "unsafe_integer" else "unavailable" if reason else "available", reason,
                   numerator=a["value"], denominator=b["value"])


def _empty():
    return {"row_count": 0, **{c: 0 for c in CONTROL_COLUMNS}, **{k+"_present": 0 for k in METRICS}}


def _add(target, row):
    for key in ("row_count", *CONTROL_COLUMNS, *(k+"_present" for k in METRICS)):
        target[key] += row[key]


def _source_rows(platform, names, source, dataset):
    owners = NetshopImportBatch.objects.filter(id=OuterRef("last_import_batch_id"), status="completed",
        source=source, dataset=dataset, platform=platform, shop_name=OuterRef("shop_name"),
        date_min__lte=OuterRef("business_date"), date_max__gte=OuterRef("business_date"), row_count__gt=0)
    return NetshopRow.objects.filter(platform=platform, shop_name__in=names, source=source, dataset=dataset).annotate(owner_ok=Exists(owners))


def _read_facts(platform, names, p, deadline):
    promo_source, promo_dataset = ("jd_promotion", "ad") if platform == "京东" else ("tmall_promotion", "promotion_daily")
    product_source, product_dataset = ("jd_sku_daily", "sku_daily") if platform == "京东" else ("tmall_product_daily", "spu_daily")
    id_column = "sku_id" if platform == "京东" else "spu_id"
    raw_base = _source_rows(platform, names, promo_source, promo_dataset)
    product_base = _source_rows(platform, names, product_source, product_dataset)
    raw, product = {}, {}
    for kind in ("current", "previous", "yearAgo"):
        dates = days(p[kind]["startDate"], p[kind]["endDate"])
        for offset in range(0, len(dates), 7):
            _budget(deadline)
            start, end = dates[offset], dates[min(offset+6, len(dates)-1)]
            scoped = {"business_date__gte": start, "business_date__lte": end}
            annotations = {"row_count": Count("id"), "owned_count": Count("id", filter=Q(owner_ok=True)),
                "title": Max("product_name"), **{c: Sum(c) for c in CONTROL_COLUMNS},
                **{k+"_present": Count("id", filter=NumericMetricPresent(v[1])) for k, v in METRICS.items()}}
            for r in raw_base.filter(**scoped).values("shop_name", "business_date", id_column).annotate(**annotations).order_by():
                if len(r[id_column]) > 200 or any(ord(c) < 32 or ord(c) == 127 for c in r[id_column]):
                    raise NetshopApiError("推广商品源身份超过共享有界长度或包含控制字符", code="quality_incomplete", status=422)
                raw[(r["shop_name"], r["business_date"], r[id_column])] = r
            _budget(deadline)
            for r in product_base.filter(**scoped, owner_ok=True).values("shop_name", "business_date", id_column).annotate(
                row_count=Count("id"), payment=Sum("transaction_amount_cents"),
                payment_present=Count("id", filter=NumericMetricPresent(("transactionAmountCents", "成交金额"))),
                mapped_spus=Count("spu_id", distinct=True), spu_min=Min("spu_id"), spu_max=Max("spu_id"), title=Max("product_name")).order_by():
                product[(r["shop_name"], r["business_date"], r[id_column])] = r
            if len(raw)+len(product) > MAX_GROUPS:
                raise NetshopApiError("推广完整对象集合超过有界上限，请缩小店铺或日期", code="quality_incomplete", status=422)
    day_filter = Q()
    for kind in ("current", "previous", "yearAgo"):
        w = p[kind]
        day_filter |= Q(business_date__gte=w["startDate"], business_date__lt=w["endExclusive"])
    shop_raw, raw_by_day, raw_by_object, product_by_object, product_daily = {}, {}, {}, {}, {}
    for (shop, day, object_id), r in raw.items():
        _add(shop_raw.setdefault((shop, day), _empty()), r)
        raw_by_day.setdefault((shop, day), {})[(shop, day, object_id)] = r
        raw_by_object.setdefault((shop, object_id), {})[(shop, day)] = r
    for (shop, day, object_id), r in product.items():
        product_by_object.setdefault((shop, object_id), {})[(shop, day)] = r
        cell = product_daily.setdefault((shop, day), {"payment": 0, "row_count": 0, "payment_present": 0})
        for k in cell: cell[k] += r[k]
    _budget(deadline)
    manifest = NetshopPromotionAggregateManifest.objects.filter(platform=platform).first()
    states = {(r["shop_name"], r["business_date"]): r for r in NetshopPromotionAggregateState.objects.filter(day_filter, platform=platform, shop_name__in=names).values()}
    shops = {(r["shop_name"], r["business_date"]): r for r in NetshopPromotionShopDaily.objects.filter(day_filter, platform=platform, shop_name__in=names).values()}
    products = {(r["shop_name"], r["business_date"], r["product_id"]): r for r in NetshopPromotionProductDaily.objects.filter(day_filter, platform=platform, shop_name__in=names).values()}
    _budget(deadline)
    # No records with an absent manifest remains no_records. Any advertised
    # state or fact with a nonready manifest must fail the corresponding values.
    ready = bool(manifest and manifest.ready)
    failures, published_by_day = {}, {}
    for key, value in products.items(): published_by_day.setdefault(key[:2], {})[key] = value
    for key in set(shop_raw) | set(states) | set(shops):
        r, s, a = shop_raw.get(key), states.get(key), shops.get(key)
        if not ready: failures[key] = "promotion_not_ready"; continue
        object_rows = raw_by_day.get(key, {})
        published = published_by_day.get(key, {})
        valid = bool(r and s and a and s["ready"] and s["source"] == a["source"] == promo_source
            and s["raw_row_count"] == a["source_row_count"] == r["row_count"]
            and s["product_row_count"] == a["product_count"] == len(object_rows)
            and set(object_rows) == set(published)
            and all(a[c] == r[c] for c in CONTROL_COLUMNS))
        if valid:
            valid = all(v["owned_count"] == v["row_count"] and published[k]["source"] == promo_source
                and published[k]["source_row_count"] == v["row_count"]
                and all(published[k][c] == v[c] for c in CONTROL_COLUMNS) for k, v in object_rows.items())
        if not valid: failures[key] = "promotion_mismatch"
    # Publication ownership is part of metadata, independently of raw owners.
    batch_ids = {r["source_batch_id"] for r in [*states.values(), *shops.values(), *products.values()]}
    owners, batch_list = {}, sorted(batch_ids)
    for offset in range(0, len(batch_list), 1000):
        _budget(deadline)
        owners.update({r.id: r for r in NetshopImportBatch.objects.filter(id__in=batch_list[offset:offset+1000])})
    for item in [*states.values(), *shops.values(), *products.values()]:
        o = owners.get(item["source_batch_id"])
        if not o or o.status != "completed" or o.row_count < 1 or o.warning_count < 0 or (o.platform, o.shop_name, o.source, o.dataset) != (platform, item["shop_name"], promo_source, promo_dataset) or not o.date_min or not o.date_max or not o.date_min <= item["business_date"] <= o.date_max:
            failures[(item["shop_name"], item["business_date"])] = "promotion_mismatch"
    product_universe = {key: all(bool(k[2]) for k in objects) for key, objects in raw_by_day.items()}
    return {"raw": raw, "product": product, "shopRaw": shop_raw, "productUniverse": product_universe, "rawByObject": raw_by_object, "productByObject": product_by_object, "productDaily": product_daily, "failures": failures,
            "ready": ready, "source": promo_source, "productSource": product_source, "idColumn": id_column,
            "rawBase": raw_base, "metadata": {"aggregateReconciled": not failures, "invalidShopDates": [
                {"shopKey": platform+"\x1f"+n, "date": d, "reasonCode": reason} for (n, d), reason in sorted(failures.items())]}}


class _Reader:
    def __init__(self, context, facts, platform):
        self.context, self.facts, self.platform = context, facts, platform

    def totals(self, names, dates, ref, object_id=None, product_applicable=True, raw_override=None, absence_universe=None, allow_absence=True):
        facts = self.facts
        object_view = object_id is not None or raw_override is not None
        raw = raw_override if raw_override is not None else facts["shopRaw"] if object_id is None else facts["rawByObject"].get((names[0], object_id), {})
        product = facts["productDaily"] if object_id is None else facts["productByObject"].get((names[0], object_id), {})
        universe = absence_universe if absence_universe is not None else facts["productUniverse"]
        verified_absence = {key for key, control in facts["shopRaw"].items() if object_view and allow_absence and (object_id is None or bool(object_id)) and universe.get(key) and key not in raw and key not in facts["failures"]
            and all(control[k+"_present"] == control["row_count"] and abs(control[v[0]]) <= MAX_SAFE for k, v in METRICS.items())}
        observed = {key for key in set(raw) | verified_absence if key[0] in names and key[1] in dates and key not in facts["failures"]}
        c = coverage_for(self.platform, names, dates, observed)
        self.context["coverageBySource"][ref] = c
        result = {}
        for key in METRICS:
            provided, reason = [], "no_records"
            for n in names:
                for d in dates:
                    r = raw.get((n, d))
                    if (n, d) in facts["failures"]: reason = facts["failures"][(n, d)]; continue
                    if not r:
                        control = facts["shopRaw"].get((n, d))
                        if (n, d) in verified_absence and control:
                            if control[key+"_present"] == control["row_count"]: provided.append(0)
                            else: reason = "missing_field"
                        continue
                    if r[key+"_present"] != r["row_count"]: reason = "missing_field"; continue
                    provided.append(r[METRICS[key][0]])
            complete = c["expectedShopDatePairs"] > 0 and len(provided) == c["expectedShopDatePairs"]
            value = sum(provided) if provided else None
            status = "available" if complete else "partial" if provided else "unavailable"
            result[key] = _metric(key, ref, [facts["source"]], value, status,
                None if complete else reason if reason != "no_records" else "incomplete_coverage" if provided else "no_records")
        for key, a, b in [("roas", "attributedPayment", "spend"), ("ctr", "clicks", "impressions"), ("cpc", "spend", "clicks")]:
            result[key] = _ratio(key, result[a], result[b], ref)
        matching_raw, matching_product = {}, {}
        for n in names:
            for d in dates:
                key = (n, d)
                if key not in observed: continue
                a, b = raw.get(key), product.get(key)
                raw_control, product_control = facts["shopRaw"].get(key), facts["productDaily"].get(key)
                if key in verified_absence and not a and raw_control and raw_control["spend_present"] == raw_control["row_count"]: a = _empty()
                if object_id is not None and not b and product_control and product_control["payment_present"] == product_control["row_count"]:
                    b = {"payment": 0, "row_count": 0, "payment_present": 0}
                if a is not None and b is not None and a["spend_present"] == a["row_count"] and b["payment_present"] == b["row_count"]:
                    matching_raw[key], matching_product[key] = a, b
        matched = set(matching_raw)
        matched_ref = ref+":matched"
        whole_ref = ref+":paired-whole"
        whole_matching = coverage_for(self.platform, names, dates, matched)
        self.context["coverageBySource"][whole_ref] = whole_matching
        matched_c = {"expectedShopDatePairs": len(matched), "coveredShopDatePairs": len(matched), "complete": bool(matched), "missingByShop": [], "truncated": False}
        self.context["coverageBySource"][matched_ref] = matched_c
        sums = sum(matching_raw[k]["spend_cents"] for k in matched), sum(matching_product[k]["payment"] for k in matched)
        a = _metric("spend", matched_ref, [facts["source"]], sums[0] if matched else None, "available" if matched else "unavailable", None if matched else "no_records")
        b = _metric("payment", matched_ref, [facts["productSource"]], sums[1] if matched else None, "available" if matched else "unavailable", None if matched else "no_records")
        matched_rate = _ratio("spendRate", a, b, matched_ref)
        applicable = object_id is None or product_applicable
        result["spendRate"] = _ratio("spendRate", a, b, whole_ref) if whole_matching["complete"] and applicable else _metric("spendRate", whole_ref,
            [facts["source"], facts["productSource"]], reason="incomplete_coverage" if applicable else "not_applicable")
        matched_range = {"scopeLabel": "仅已匹配平台×店铺×日期"+("×商品" if object_id else ""),
            "coverageRef": matched_ref, "metrics": {"spend": a, "payment": b, "spendRate": matched_rate},
            "shopDates": [{"shopKey": self.platform+"\x1f"+n, "dates": [d for d in dates if (n, d) in matched]} for n in names]}
        if not applicable: matched_range = None
        return result, matched_range

    def windows(self, names, ref, object_id=None, product_applicable=True, selected_dates=None, raw_override=None, absence_universe=None, allow_absence=True):
        metrics, matched = {}, None
        for kind in ("current", "previous", "yearAgo"):
            w = self.context["periods"][kind]
            dates = selected_dates[kind] if selected_dates else days(w["startDate"], w["endDate"])
            metrics[kind], m = self.totals(names, dates, ref+":"+kind, object_id, product_applicable, raw_override, absence_universe, allow_absence)
            if selected_dates and kind != "current" and len(dates) != len(selected_dates["current"]):
                metrics[kind] = {k: _metric(k, ref+":"+kind, v["sourceIds"], reason="no_comparable_date") for k, v in metrics[kind].items()}
            if kind == "current": matched = m
        comparisons = {k: {v: _compare(k, metrics["current"][k], metrics[v][k]) for v in ("previous", "yearAgo")} for k in KEYS}
        changes = {k: {v: _delta(k, metrics["current"][k], metrics[v][k]) for v in ("previous", "yearAgo")} for k in ("spend", "attributedPayment")}
        return metrics["current"], comparisons, matched, changes


def _page(items, options):
    query = options["q"].casefold()
    selected = [r for r in items if not query or query in ((r["id"] or "")+" "+r["title"]+" "+r["shopName"]).casefold()]
    if options["objectId"]:
        selected = [r for r in selected if r["rowKey"] == options["objectId"] and r["shopKey"] == options["shopKey"]]
    key = options["sort"]
    def number(r):
        value = r["changes"]["spend"]["previous"]["value"] if key.startswith("spend_change") else r["metrics"][key.removesuffix("_desc")]["value"]
        return value
    selected.sort(key=lambda r: (number(r) is None, (number(r) or 0)*(1 if key.endswith("_asc") else -1), r["shopKey"], r["rowKey"]))
    total, start = len(selected), (options["page"]-1)*options["pageSize"]
    page = selected[start:start+options["pageSize"]]
    return {"items": page, "pagination": {"page": options["page"], "pageSize": options["pageSize"], "total": total,
        "returned": len(page), "hasMore": start+len(page) < total, "truncated": start+len(page) < total}, "summaryUnaffectedBySearch": True, "collection": "paired_full_set_before_pagination"}


def _change(current, baseline):
    return current["value"]-baseline["value"] if current["status"] == baseline["status"] == "available" else None


def _delta(key, current, baseline):
    reason = "not_applicable" if current["unit"] != baseline["unit"] or current["basis"] != baseline["basis"] or current["sourceIds"] != baseline["sourceIds"] else "unsafe_integer" if current["status"] == "invalid" or baseline["status"] == "invalid" else "incomplete_baseline" if current["status"] != "available" or baseline["status"] != "available" else None
    return _metric(key, current["coverageRef"], current["sourceIds"], None if reason else current["value"]-baseline["value"],
        "invalid" if reason == "unsafe_integer" else "unavailable" if reason else "available", reason)


def _compare(key, current, baseline):
    if key == "cpc":
        from .insights_common import compare_derived_money_per_count
        return compare_derived_money_per_count(current, baseline)
    return compare_metrics(current, baseline)


def _objects(reader, names, options, deadline):
    facts, p, platform = reader.facts, reader.context["periods"], reader.platform
    identities = sorted(facts["rawByObject"])
    selected_dates = _list_dates(reader.context, options)
    result = []
    for n, object_id in identities:
        _budget(deadline)
        object_rows = facts["rawByObject"][(n, object_id)]
        if not any(d in selected_dates["current"] for _, d in object_rows) and options["objectStartDate"]: continue
        product_rows = list(facts["productByObject"].get((n, object_id), {}).values())
        relation_values = {r[k] for r in product_rows for k in ("spu_min", "spu_max") if r[k]}
        ambiguity = any(r["mapped_spus"] > 1 for r in product_rows) or len(relation_values) > 1
        mapping_reason = "unmapped" if not object_id else "ambiguous_mapping" if ambiguity else None if product_rows else "unmapped"
        metrics, comparisons, matched, changes = reader.windows([n], "promotion:object:"+_canonical_token([platform, n, object_id])[:16], object_id,
            platform == "天猫" and mapping_reason is None, selected_dates)
        current_rows = [r for (_, d), r in object_rows.items() if d in selected_dates["current"]]
        title = max((r["title"] for r in object_rows.values()), default="")
        row_key = _row_key(platform, n, "product", object_id)
        if not object_id:
            for values in comparisons.values():
                for value in values.values(): value.update(value=None, status="unavailable", reasonCode="not_applicable")
            changes = {k: {v: _metric(k, metrics[k]["coverageRef"], metrics[k]["sourceIds"], reason="not_applicable") for v in ("previous", "yearAgo")} for k in ("spend", "attributedPayment")}
        row = {"platform": platform, "shopKey": platform+"\x1f"+n, "shopName": n, "objectKind": "product", "id": object_id or None, "title": title or object_id or "未提供商品ID",
            "rowKey": row_key, "identityKind": "follow_order_sku" if platform == "京东" else "promotion_product",
            "planId": None, "unitId": None, "matchType": None, "drillable": bool(object_id),
            "mapping": {"status": "matched" if mapping_reason is None else "ambiguous" if ambiguity else "unmapped",
                        "linkIdentity": {"platform": platform, "shopName": n, "dimension": "sku" if platform == "京东" else "spu", "id": object_id} if mapping_reason is None else None,
                        "advertisedSkuId": None, "triggerSkuId": None, "followSkuId": object_id if platform == "京东" else None,
                        "evidence": "exact_source_identity" if mapping_reason is None else "unverified"},
            "metrics": metrics, "comparisons": comparisons, "matchedRange": matched,
            "spendShare": _ratio("ctr", metrics["spend"], reader.focused_summary["spend"], metrics["spend"]["coverageRef"]),
            "changes": changes, "observedDates": sorted(r["business_date"] for r in current_rows), "coverageRef": metrics["spend"]["coverageRef"],
            "observation": _observation(reader, [n], object_rows, selected_dates, facts["productUniverse"], bool(object_id)),
            "identitySemantics": "跟单SKU归因视角，费用不是独立投放SKU效果" if platform == "京东" else "推广商品ID"}
        result.append(row)
    return result


def _row_key(platform, name, kind, identity):
    return _canonical_token({"platform": platform, "shopName": name, "objectKind": kind, "sourceIdentity": identity})


def _observation(reader, names, source_rows, selected_dates, universe, real_identity):
    result = {}
    for kind, dates in selected_dates.items():
        observed = [d for d in dates if any((n, d) in source_rows for n in names)]
        absent = []
        if real_identity:
            for d in dates:
                valid = True
                for n in names:
                    key = (n, d)
                    control = reader.facts["shopRaw"].get(key)
                    if key in source_rows or key in reader.facts["failures"] or not universe.get(key) or not control or any(control[k+"_present"] != control["row_count"] or abs(control[v[0]]) > MAX_SAFE for k, v in METRICS.items()):
                        valid = False; break
                if valid: absent.append(d)
        result[kind] = {"observedDates": observed, "verifiedAbsentDates": absent}
    return result


def _list_dates(context, options):
    p = context["periods"]
    current = days(options["objectStartDate"] or p["current"]["startDate"], options["objectEndDate"] or p["current"]["endDate"])
    if not options["objectStartDate"]: return {k: days(p[k]["startDate"], p[k]["endDate"]) for k in ("current", "previous", "yearAgo")}
    calendar = {r["date"]: r for r in context["calendar"]}
    return {"current": current, **{k: [calendar[d][k] for d in current if calendar[d][k]] for k in ("previous", "yearAgo")}}


def _dimensions(reader, names, options, deadline, principal):
    platform, p = reader.platform, reader.context["periods"]
    supported = principal.role == "admin" and platform == "京东" and names == [SHOP_NAME] and 1 <= p["current"]["days"] <= 7
    capability = {"status": "available" if supported else "unavailable", "reasonCode": None if supported else "not_applicable",
        "scope": {"platform": "京东", "shopName": SHOP_NAME, "maximumDays": 7},
        "limitation": "原管理员权限、志高商用设备旗舰店京东单店1—7天真实明细；无源不生成计划或词"}
    if not supported: return {k: [] for k in ("plan", "unit", "keyword", "search_term")}, capability
    if options["objectKind"] == "product": return {k: [] for k in ("plan", "unit", "keyword", "search_term")}, capability
    selected_dates = _list_dates(reader.context, options)
    groups = {options["objectKind"]: {}}
    universe = {}
    for window_kind in ("current", "previous", "yearAgo"):
        _budget(deadline)
        w = p[window_kind]
        source = reader.facts["rawBase"].filter(owner_ok=True, business_date__gte=w["startDate"], business_date__lt=w["endExclusive"])
        if source.count() > MAX_SOURCE_ROWS:
            raise NetshopApiError("计划词原始行超过原诊断上限", code="quality_incomplete", status=422)
        columns = ("shop_name", "business_date", "raw_json", "sku_id", "metrics_json", *CONTROL_COLUMNS)
        for index, row in enumerate(source.values(*columns).iterator(chunk_size=2000)):
            if index % 1000 == 0: _budget(deadline)
            if (row["shop_name"], row["business_date"]) in reader.facts["failures"]: continue
            raw = row["raw_json"] if isinstance(row["raw_json"], dict) else {}
            source_metrics = row["metrics_json"] if isinstance(row["metrics_json"], dict) else {}
            dims = {}
            for field, aliases in DIMENSION_FIELDS.items():
                values = {_scalar(raw, (alias,)) for alias in aliases} - {None}
                dims[field] = next(iter(values)) if len(values) == 1 else None
            for kind in groups:
                # Plans never use a name as ID. Terms preserve their actual
                # plan/unit/match relation rather than a cartesian join.
                parts = (dims["planId"],) if kind == "plan" else (dims["planId"], dims["unitId"]) if kind == "unit" else (
                    dims["keyword" if kind == "keyword" else "searchTerm"], dims["planId"], dims["unitId"], dims["matchType"])
                day_key = (SHOP_NAME, row["business_date"])
                universe[day_key] = universe.get(day_key, True) and all(value is not None for value in parts)
                object_id = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
                group = groups[kind].setdefault(object_id, {"id": object_id, "dims": dims, "periods": {}, "relations": set()})
                if len(groups[kind]) > 30_000: raise NetshopApiError("计划词完整分组超过原上限", code="quality_incomplete", status=422)
                bucket = group["periods"].setdefault(window_kind, {})
                cell = bucket.setdefault((SHOP_NAME, row["business_date"]), _empty())
                source_row = {"row_count": 1, **{c: row[c] for c in CONTROL_COLUMNS}, **{k+"_present": int(any(type(source_metrics.get(alias)) in {int, float} for alias in v[1])) for k, v in METRICS.items()}}
                _add(cell, source_row)
                group["relations"].add((row["sku_id"] or None, dims["promotedSkuId"], dims["triggerSkuId"], dims["keyword"], dims["searchTerm"], dims["planId"], dims["unitId"], dims["matchType"]))
    sections = {k: [] for k in ("plan", "unit", "keyword", "search_term")}
    for kind, values in groups.items():
        items = []
        for object_id, group in values.items():
            dims = group["dims"]
            all_period_rows = {}
            for cells in group["periods"].values(): all_period_rows.update(cells)
            real_identity = all(value is not None for value in json.loads(object_id))
            metrics, comparisons, _, changes = reader.windows(names, "promotion:"+kind+":"+_canonical_token(object_id)[:16], selected_dates=selected_dates, raw_override=all_period_rows, absence_universe=universe, allow_absence=real_identity)
            metrics["spendRate"] = _metric("spendRate", metrics["spend"]["coverageRef"], [reader.facts["source"], reader.facts["productSource"]], reason="not_applicable")
            for v in comparisons["spendRate"].values(): v.update(value=None, status="unavailable", reasonCode="not_applicable")
            title = dims["planName"] if kind == "plan" else dims["unitName"] if kind == "unit" else dims["keyword" if kind == "keyword" else "searchTerm"]
            rows = {k: r for k, r in group["periods"].get("current", {}).items() if k[1] in selected_dates["current"]}
            if not rows and options["objectStartDate"]: continue
            prior = {k: r for k, r in group["periods"].get("previous", {}).items() if k[1] in selected_dates["previous"]}
            actual_id = dims["planId"] if kind == "plan" else dims["unitId"] if kind == "unit" else dims["keyword" if kind == "keyword" else "searchTerm"]
            if actual_id is None or not real_identity:
                for values in comparisons.values():
                    for v in values.values(): v.update(value=None, status="unavailable", reasonCode="not_applicable")
                changes = {k: {v: _metric(k, metrics[k]["coverageRef"], metrics[k]["sourceIds"], reason="not_applicable") for v in ("previous", "yearAgo")} for k in ("spend", "attributedPayment")}
            unit_ids = {v[6] for v in group["relations"]}
            match_types = {v[7] for v in group["relations"]}
            items.append({"platform": platform, "shopKey": platform+"\x1f"+SHOP_NAME, "shopName": SHOP_NAME,
                "objectKind": kind, "rowKey": _row_key(platform, SHOP_NAME, kind, json.loads(object_id)), "id": actual_id,
                "title": title or "未提供身份/无词投放", "identityKind": kind,
                "planId": dims["planId"], "unitId": next(iter(unit_ids)) if len(unit_ids) == 1 else None,
                "matchType": next(iter(match_types)) if len(match_types) == 1 else None, "drillable": actual_id is not None,
                "mapping": {"status": "not_applicable", "linkIdentity": None, "evidence": "unverified",
                    "advertisedSkuId": None, "triggerSkuId": None, "followSkuId": None},
                "coverageRef": metrics["spend"]["coverageRef"], "observedDates": sorted(k[1] for k in rows),
                "observation": _observation(reader, names, all_period_rows, selected_dates, universe, real_identity),
                "metrics": metrics, "comparisons": comparisons, "changes": changes,
                "spendShare": _ratio("ctr", metrics["spend"], reader.focused_summary["spend"], metrics["spend"]["coverageRef"]),
                "missingIdentity": dims["planId"] is None if kind == "plan" else dims["unitId"] is None if kind == "unit" else dims["keyword" if kind == "keyword" else "searchTerm"] is None,
                "relations": [{"kind": "explicit_source_fields", "description": "来源同一行关联：跟单SKU="+(v[0] or "未提供")+"；推广SKU="+(v[1] or "未提供")+"；触发SKU="+(v[2] or "未提供")+"；匹配方式="+(v[7] or "未提供"),
                    "sourceFields": ["跟单SKU ID", "智能投放推广SKU ID", "触发SKU ID", "关键词", "搜索词", "计划ID", "单元ID", "匹配方式"],
                    "targets": [{"objectKind": "product", "id": v[0], "rowKey": _row_key(platform, SHOP_NAME, "product", v[0]) if v[0] else None},
                        {"objectKind": "plan", "id": v[5], "rowKey": _row_key(platform, SHOP_NAME, "plan", [v[5]]) if v[5] else None},
                        {"objectKind": "unit", "id": v[6], "rowKey": _row_key(platform, SHOP_NAME, "unit", [v[5], v[6]]) if v[6] else None},
                        {"objectKind": "keyword", "id": v[3], "rowKey": _row_key(platform, SHOP_NAME, "keyword", [v[3], v[5], v[6], v[7]]) if v[3] else None},
                        {"objectKind": "search_term", "id": v[4], "rowKey": _row_key(platform, SHOP_NAME, "search_term", [v[4], v[5], v[6], v[7]]) if v[4] else None}]}
                    for v in sorted(group["relations"], key=lambda v: tuple(x or "" for x in v))], "_sourceRows": all_period_rows,
                "_universe": universe, "_allowAbsence": real_identity})
        sections[kind] = items
    return sections, capability


def _read(principal, params, detail=False):
    deadline = time.monotonic()+65
    actor = actor_fence(principal)
    _budget(deadline)
    spec, options = _validate(params, detail)
    if options["objectKind"] != "product" and principal.role != "admin":
        raise NetshopApiError("计划单元和词明细保持原管理员权限", code="access_denied", status=403)
    context = read_context(principal, spec)
    _budget(deadline)
    platform = spec["platforms"][0]
    names = [k.split("\x1f", 1)[1] for k in context["effectiveScope"]["shopKeys"]]
    if options["shopKey"] and options["shopKey"] not in context["effectiveScope"]["shopKeys"]:
        raise NetshopApiError("推广对象店铺不属于授权范围", code="access_denied", status=403)
    section_token = _canonical_token({"version": "promotion-insights-v1", "snapshot": context["snapshotToken"],
        "scope": context["scopeKey"]})
    if options["token"] and options["token"] != section_token:
        raise NetshopApiError("推广对象来源版本已变化", code="insights_revision_changed", status=409)
    facts = _read_facts(platform, names, context["periods"], deadline)
    reader = _Reader(context, facts, platform)
    summary, comparisons, matched, summary_changes = reader.windows(names, "promotion:summary")
    reader.summary = summary
    p = context["periods"]
    list_dates = _list_dates(context, options)
    reader.focused_summary, _ = reader.totals(names, list_dates["current"], "promotion:focused-scope")
    trend = []
    for dates in period_groups(p["current"]["startDate"], p["current"]["endDate"], options["grain"]):
        _budget(deadline)
        current, _ = reader.totals(names, dates, "promotion:trend:"+dates[0])
        calendar = {r["date"]: r for r in context["calendar"]}
        baseline_dates = [calendar[d]["previous"] for d in dates if calendar[d]["previous"]]
        baseline, _ = reader.totals(names, baseline_dates, "promotion:trend-prior:"+dates[0])
        if len(baseline_dates) != len(dates):
            baseline = {k: _metric(k, "promotion:trend-prior:"+dates[0], m["sourceIds"], reason="no_comparable_date") for k, m in baseline.items()}
        trend.append({"startDate": dates[0], "endDate": dates[-1], "days": len(dates),
            "truncatedPeriod": options["grain"] == "week" and len(dates) != 7 or options["grain"] == "month" and (date.fromisoformat(dates[0]).day != 1 or date.fromisoformat(dates[-1]).day != monthrange(date.fromisoformat(dates[-1]).year, date.fromisoformat(dates[-1]).month)[1]),
            "metrics": current, "coverageRef": current["spend"]["coverageRef"], "comparisons": {k: _compare(k, current[k], baseline[k]) for k in KEYS},
            "change": {k: _change(current[k], baseline[k]) for k in ("spend", "attributedPayment")}, "focusDate": dates[0]})
    shops = []
    for n in names:
        metrics, comp, matching, shop_changes = reader.windows([n], "promotion:shop:"+_canonical_token(n)[:16])
        shops.append({"platform": platform, "shopKey": platform+"\x1f"+n, "shopName": n,
            "metrics": metrics, "comparisons": comp, "changes": shop_changes, "matchedRange": matching,
            "coverageRef": metrics["spend"]["coverageRef"],
            "spendShare": _ratio("ctr", metrics["spend"], summary["spend"], metrics["spend"]["coverageRef"])})
    objects = _objects(reader, names, options, deadline)
    products = _page(objects, options)
    dimensions, diagnostic = _dimensions(reader, names, options, deadline, principal)
    active = products if options["objectKind"] == "product" else _page(dimensions[options["objectKind"]], options)
    attribution = {"amountDefinition": "jd_total_order_amount" if platform == "京东" else "tmall_net_amount",
        "orderDefinition": "jd_order_lines" if platform == "京东" else "tmall_net_transactions", "window": None,
        "amountLabel": "京东归因总订单金额" if platform == "京东" else "天猫归因净成交金额",
        "orderLabel": "京东总订单行" if platform == "京东" else "天猫净成交笔数", "roiDisplayLabel": "ROI",
        "roiMeaning": "platform_attributed_amount_divided_by_spend", "denominatorDataset": "sku_daily" if platform == "京东" else "spu_daily",
        "sourceMatrix": [{"sourceId": facts["source"], "metrics": list(METRICS), "aggregateReconciled": facts["metadata"]["aggregateReconciled"]},
                         {"sourceId": facts["productSource"], "metrics": ["payment"], "purpose": "exact_shop_date_denominator"}],
        "limitations": ["归因窗口未知，ROI为倍数，不能解释利润或广告增量", "订单行/笔数不能替换成交客户数", "归因成交不是已验证渠道子集，不推算自然成交", "推广商品/触发SKU/跟单SKU分别建模，各视角同一事实不能相加",
            "对象空集合0仅指已导入且核对完整的来源中未报告该对象，不代表平台真实零投放；缺ID或多义关系不推断缺席0", "nullID未知桶保留本期来源金额，不能跨期作为同一实体比较或纳入贡献榜"]}
    object_capabilities = {}
    for kind in ("product", "plan", "unit", "keyword", "search_term"):
        eligible = kind == "product" or diagnostic["status"] == "available"
        loaded = kind == "product" or eligible and options["objectKind"] == kind
        collection = objects if kind == "product" else dimensions[kind]
        valid_id = any(r["id"] is not None for r in collection)
        reason = None if loaded and valid_id else "missing_field" if loaded and collection else "no_records" if loaded else "unverified_source" if eligible else "not_applicable"
        object_capabilities[kind] = {"status": "available" if reason is None else "unavailable", "reasonCode": reason,
            "canQuery": eligible, "message": "跟单SKU或推广商品ID，精确店铺隔离" if kind == "product" else diagnostic["limitation"]+("；选中后按真实来源核验" if eligible and not loaded else ""),
            "sourceIds": [facts["source"]], "unidentifiedCount": sum(r["id"] is None for r in collection) if loaded else None}
    matrix = [{"sourceId": facts["source"], "label": "京东推广明细" if platform == "京东" else "天猫推广商品日",
        "coverageRef": summary["spend"]["coverageRef"], "fields": [{"field": k, "status": "available" if summary[k]["status"] == "available" else "unavailable", "reasonCode": summary[k]["reasonCode"]} for k in METRICS],
        "notes": ["完成事实与manifest/state/shop/product聚合核对", "分类字典未获可靠映射，商品分类为未知", "归因窗口未提供"]},
        {"sourceId": facts["productSource"], "label": "京东商品SKU日" if platform == "京东" else "天猫商品SPU日",
         "coverageRef": facts["productSource"]+":"+("sku_daily" if platform == "京东" else "spu_daily")+":"+platform+":current",
         "fields": [{"field": c["field"], "status": c["status"], "reasonCode": c["reasonCode"]} for c in context["capabilities"] if c["sourceId"].startswith(facts["productSource"]+":") and c["period"] == "current"],
         "notes": ["推广费率按同平台×店铺×日期配对，商品层还需精确适用身份"]}]
    active_objects = objects if options["objectKind"] == "product" else dimensions[options["objectKind"]]
    comparable = [r for r in active_objects if r["id"] is not None and all(r["changes"][key]["previous"]["status"] == "available" for key in ("spend", "attributedPayment"))]
    contributions = {"collection": "comparable_full_set_before_search_pagination", "comparedObjectCount": len(comparable),
        "excludedObjectCount": len(active_objects)-len(comparable), "previous": {}}
    for name, key, sign in [("spendIncrease", "spend", 1), ("spendDecrease", "spend", -1), ("attributedPaymentIncrease", "attributedPayment", 1), ("attributedPaymentDecrease", "attributedPayment", -1)]:
        items = [r for r in comparable if r["changes"][key]["previous"]["value"]*sign > 0]
        items.sort(key=lambda r: (-r["changes"][key]["previous"]["value"]*sign, r["rowKey"]))
        contributions["previous"][name] = items[:10]
    sections = {"summary": summary, "comparisons": comparisons, "changes": summary_changes, "matchedRange": matched, "attribution": attribution,
        "items": active["items"], "pagination": active["pagination"], "objectKind": options["objectKind"],
        "trend": {"grain": options["grain"], "items": trend}, "shops": {"visible": len(names) > 1, "items": shops},
        "objectCapabilities": object_capabilities, "sourceMatrix": matrix, "limitations": attribution["limitations"], "contributions": contributions,
        "diagnostic": {"status": diagnostic["status"], "reasonCode": diagnostic["reasonCode"], "message": diagnostic["limitation"],
            "shopName": SHOP_NAME if diagnostic["status"] == "available" else None, "maximumDays": 7, "paidModelAllowed": False,
            "reportFormats": ["html", "xlsx"] if diagnostic["status"] == "available" else []},
        "dataQuality": facts["metadata"],
        "listScope": {"objectKind": options["objectKind"], "q": options["q"], "objectStartDate": list_dates["current"][0], "objectEndDate": list_dates["current"][-1],
            "comparisonDates": {k: list_dates[k] for k in ("previous", "yearAgo")}, "summaryUnaffectedBySearch": True}}
    if detail:
        candidates = objects if options["objectKind"] == "product" else dimensions[options["objectKind"]]
        item = next((r for r in candidates if r["shopKey"] == options["shopKey"] and r["rowKey"] == options["objectId"] and r["id"] is not None), None)
        if not item: raise NetshopApiError("此范围没有该精确推广对象", code="not_found", status=404)
        object_trend = []
        if item["objectKind"] == "product":
            for dates in period_groups(p["current"]["startDate"], p["current"]["endDate"], options["grain"]):
                metrics, _ = reader.totals([item["shopName"]], dates, "promotion:detail:"+dates[0], item["id"], platform == "天猫" and item["mapping"]["status"] == "matched")
                object_trend.append({"startDate": dates[0], "endDate": dates[-1], "days": len(dates), "metrics": metrics, "coverageRef": metrics["spend"]["coverageRef"]})
        else:
            for dates in period_groups(p["current"]["startDate"], p["current"]["endDate"], options["grain"]):
                metrics, _ = reader.totals([item["shopName"]], dates, "promotion:detail:"+dates[0], raw_override=item["_sourceRows"], absence_universe=item["_universe"], allow_absence=item["_allowAbsence"])
                metrics["spendRate"] = _metric("spendRate", metrics["spend"]["coverageRef"], [facts["source"], facts["productSource"]], reason="not_applicable")
                object_trend.append({"startDate": dates[0], "endDate": dates[-1], "days": len(dates), "metrics": metrics, "coverageRef": metrics["spend"]["coverageRef"]})
        sections = {"item": item, "trend": {"grain": options["grain"], "items": object_trend},
            "relations": item.get("relations", []), "limitations": attribution["limitations"]}
    # Export only coverage referenced by returned sections. Sorting the complete
    # object universe must not balloon the response with off-page objects.
    refs = set()
    def collect(value):
        if isinstance(value, dict):
            if isinstance(value.get("coverageRef"), str): refs.add(value["coverageRef"])
            for v in value.values(): collect(v)
        elif isinstance(value, list):
            for v in value: collect(v)
    for collection in [objects, *dimensions.values()]:
        for r in collection:
            for key in ("_sourceRows", "_universe", "_allowAbsence"): r.pop(key, None)
    collect(sections)
    sections["coverage"] = {k: v for k, v in context["coverageBySource"].items() if k in refs and k.startswith("promotion:")}
    context["coverageBySource"] = {k: v for k, v in context["coverageBySource"].items() if not k.startswith("promotion:")}
    payload = {"columnVersion": "netshop-promotion-v1", "context": context, "sectionToken": section_token, "sections": sections}
    _budget(deadline)
    current_revision = revision_value()
    expected = [{"domain": "netshop", "kind": "owning_revision", "scopeKey": context["scopeKey"], "revision": current_revision}]
    expected.extend({"domain": "netshop", "kind": platform+":"+k, "scopeKey": context["scopeKey"], "revision": v}
        for k, v in sorted(context_versions(platform, names, current_revision).items()) if k != "netshop")
    if expected != context["sourceRevisions"]:
        raise NetshopApiError("推广读取期间来源版本变化", code="insights_revision_changed", status=409)
    if actor_fence(principal) != actor: raise NetshopApiError("推广读取期间账号权限变化", code="access_denied", status=403)
    _budget(deadline)
    if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise NetshopApiError("推广完整响应超过2MiB，请缩小范围", code="quality_incomplete", status=422)
    _budget(deadline)
    return payload


def read_promotion_insights(principal, params: QueryDict) -> dict:
    return _read(principal, params)


def read_promotion_detail(principal, params: QueryDict) -> dict:
    return _read(principal, params, detail=True)
