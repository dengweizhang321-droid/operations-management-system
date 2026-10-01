"""C composition over existing P/A owning projections; never another fact source."""
from __future__ import annotations

from copy import deepcopy
import time

from django.db.models import Exists, F, Max, OuterRef, Q
from django.http import QueryDict

from . import product_insights as P
from . import promotion_insights as A
from .errors import NetshopApiError
from .insights_common import context_versions, coverage_for, period_groups, read_context, validate_metric, validate_derived_money_per_count
from .query import _canonical_token, revision_value
from .store_overview import days

PRODUCT_KEYS = ("payment", "quantity", "visitors", "customers", "conversion", "visitorValue", "transactionOrders")
PROMOTION_KEYS = ("spend", "attributedPayment", "roas", "ctr", "cpc", "spendRate")
ERP_KEYS = ("erpNetSales", "orderMargin", "largeMargin", "largeMarginAmount", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate")


def budget(deadline):
    if time.monotonic() > deadline:
        raise NetshopApiError("比较读取超出65秒整体预算", code="source_not_ready", status=503)


def unavailable(key, ref, reason="unverified_source"):
    if key == "averageOrderValue":
        return validate_derived_money_per_count({"metricSchemaVersion": "netshop-money-per-count-v1", "unit": "CNY_CENT_PER_COUNT", "denominatorKind": "item_quantity", "aggregation": "ratio_of_sums", "value": None, "numerator": None, "denominator": None, "status": "unavailable", "reasonCode": reason, "basis": "erp_net_sales", "sourceIds": [], "coverageRef": ref})
    if key == "visitorValue":
        return {**P._visitor_value({"payment": unavailable("payment", ref, reason), "visitors": unavailable("visitors", ref, reason)}), "reasonCode": reason}
    if key in PROMOTION_KEYS:
        return A._metric(key, ref, [], reason=reason)
    return validate_metric({"value": None, "unit": "COUNT" if key in {"quantity", "visitors", "customers", "transactionOrders", "erpOrderCount", "returnQuantity"} else "RATIO" if key in {"conversion", "returnRate", "largeMargin"} else "CNY_CENT", "status": "unavailable", "reasonCode": reason,
                           "sourceIds": [], "basis": "erp_net_sales" if key in {"erpNetSales", "erpOrderCount", "returnQuantity", "returnRate"} else "erp_order_margin" if key == "orderMargin" else "erp_large_margin" if key in {"largeMargin", "largeMarginAmount"} else "product_day_sum", "aggregation": "ratio_of_sums" if key in {"conversion", "returnRate", "largeMargin"} else "sum", "coverageRef": ref})


def object_descriptors(current, baseline, mode):
    keys = sorted(set(current["effectiveScope"]["shopKeys"]) | set(baseline["effectiveScope"]["shopKeys"]))
    if mode == "shop":
        return [{"objectKey": "shop:"+key, "kind": "shop", "platform": key.split("\x1f")[0], "shopName": key.split("\x1f", 1)[1], "shopKeys": [key]} for key in keys]
    return [{"objectKey": "platform:"+platform, "kind": "platform", "platform": platform, "shopName": None,
             "shopKeys": [key for key in keys if key.startswith(platform+"\x1f")]} for platform in current["effectiveScope"]["platforms"]]


def _scoped_context(context, shop_keys, dates, observed):
    # P's owning metric helpers read this view only. Copy the dictionaries we
    # alter, preserving the original full F envelope without repeatedly copying
    # its 50-shop calendars/coverage for every natural-day chart bucket.
    scoped = {**context, "effectiveScope": {**context["effectiveScope"]}, "periods": {**context["periods"]}, "coverageBySource": {**context["coverageBySource"]}}
    platforms = sorted({k.split("\x1f")[0] for k in shop_keys}) or context["effectiveScope"]["platforms"]
    scoped["effectiveScope"].update(shopKeys=shop_keys, platforms=platforms)
    scoped["periods"]["current"] = {**scoped["periods"]["current"], "startDate": dates[0], "endDate": dates[-1], "days": len(dates)}
    for platform in platforms:
        names = [k.split("\x1f", 1)[1] for k in shop_keys if k.startswith(platform+"\x1f")]
        source, dataset = P._source(platform, context["effectiveScope"]["dimension"])
        scoped["coverageBySource"][source+":"+dataset+":"+platform+":current"] = coverage_for(platform, names, dates, {(n, d) for p, n, d in observed if p == platform})
    return scoped


def _aggregate_projection(rows):
    result = {"rows": 0, "days": len({r["business_date"] for r in rows})}
    for key in P.ALL_FIELDS:
        present = sum(int(r[key+"_present"]) for r in rows)
        result[key+"_present"] = present
        result[key] = sum(int(r[key]) for r in rows if r[key] is not None) if present else None
    result["rows"] = sum(int(r["rows"]) for r in rows)
    return result


def _rebind(metrics, ref):
    return {key: {**metric, "coverageRef": ref} for key, metric in metrics.items()}


def _product_metrics(rows, context, shop_keys, dates, ref, coverage):
    selected = [r for r in rows if r["platform"]+"\x1f"+r["shop_name"] in shop_keys and r["business_date"] in dates]
    observed = {(r["platform"], r["shop_name"], r["business_date"]) for r in selected}
    scoped = _scoped_context(context, shop_keys, dates, observed)
    aggregate = _aggregate_projection(selected)
    metrics = P._metrics(aggregate, scoped, "current")
    metrics["transactionOrders"] = P._extra_metrics(aggregate, scoped, "current")["transactionOrders"]
    metrics["visitorValue"] = P._visitor_value(metrics)
    expected = len(shop_keys)*len(dates)
    missing = [{"shopKey": key, "dates": [d for d in dates if (key.split("\x1f", 1)[0], key.split("\x1f", 1)[1], d) not in observed]} for key in shop_keys]
    coverage[ref] = {"expectedShopDatePairs": expected, "coveredShopDatePairs": len(observed), "complete": expected > 0 and len(observed) == expected, "missingByShop": [m for m in missing if m["dates"]], "truncated": False}
    return _rebind({key: metrics[key] for key in PRODUCT_KEYS}, ref), bool(selected)


def _category_base(reference, current, selection):
    category = selection["category"]
    if category["mode"] == "all": return reference
    if category["mode"] == "label_only":
        source, _ = P._source(category["platform"], current["effectiveScope"]["dimension"])
        evidence = P._category_evidence(category["label"], source, category["platform"], current)
        if category["sourceId"] != evidence["sourceId"] or category["evidenceVersion"] != evidence["version"]:
            raise NetshopApiError("来源类目证据版本或scope不成立", code="insights_revision_changed", status=409)
        candidates = P._window_rows(reference, current["periods"]["current"]).filter(platform=category["platform"], category=category["label"])
        if not candidates.exists():
            raise NetshopApiError("来源标签不是本期真实scope的候选", code="not_applicable", status=422)
        return P._cohort(reference.filter(platform=category["platform"]), {"category": category["label"], "periods": current["periods"], "dimension": current["effectiveScope"]["dimension"]})
    column = current["effectiveScope"]["dimension"]+"_id"
    unknown = P._window_rows(reference, current["periods"]["current"]).filter(category="", platform=OuterRef("platform"), shop_name=OuterRef("shop_name"), **{column: OuterRef(column)})
    return reference.filter(Exists(unknown))


def _product_structure(base, context, descriptor, metrics, rows, period, coverage, deadline):
    budget(deadline)
    shop_keys = descriptor["shopKeys"]
    scopes = Q(pk__in=[])
    for key in shop_keys:
        platform, name = key.split("\x1f", 1)
        scopes |= Q(platform=platform, shop_name=name)
    selected = P._window_rows(base.filter(scopes), context["periods"]["current"])
    dimension = context["effectiveScope"]["dimension"]
    spec = {"dimension": dimension, "platforms": context["effectiveScope"]["platforms"], "periods": context["periods"], "category": ""}
    grouped = selected.values("platform", "shop_name", dimension+"_id").annotate(category_label=Max("category"), **P._annotations({"payment": "transaction_amount_cents", "quantity": "transaction_quantity"}))
    dates = days(context["periods"]["current"]["startDate"], context["periods"]["current"]["endDate"])
    observed = {(r["platform"], r["shop_name"], r["business_date"]) for r in rows if r["platform"]+"\x1f"+r["shop_name"] in shop_keys}
    scoped = _scoped_context(context, shop_keys, dates, observed)
    ref = metrics["payment"]["coverageRef"]
    counts = P._counts(base.filter(scopes), spec, scoped)
    # P computes bounded source-label and transaction-mean price buckets in SQL.
    categories = P._derived_buckets(grouped, scoped, metrics["payment"])
    prices = P._derived_buckets(grouped, scoped, metrics["payment"], price=True)
    # P's count means observed identities. Binding that count to C's full
    # object/date coverage must disclose partial coverage instead of upgrading
    # an observed count into a complete-period product population.
    if not coverage[ref]["complete"]:
        for bucket in categories+prices:
            if bucket["products"]["status"] == "available":
                bucket["products"] = validate_metric({**bucket["products"], "status": "partial", "reasonCode": "incomplete_coverage"})
    top = list(grouped.order_by(F("payment").desc(nulls_last=True), "platform", "shop_name", dimension+"_id").values_list("payment", flat=True)[:10])
    complete = metrics["payment"]["status"] == "available"
    def top_money(number):
        provided = [v for v in top[:number] if v is not None]
        return P._money(sum(int(v) for v in provided) if provided else None, scoped, status="available" if complete else "partial" if provided else "unavailable", reason=None if complete else "incomplete_coverage" if provided else "no_records")
    output = {"collection": "complete_global_filter_set", "denominator": metrics["payment"], "categoryBasis": "source_label_only", "priceBasis": "transaction_mean", "dataProducts": counts["dataProducts"], "tradedProducts": counts["tradedProducts"], "categories": categories, "priceBands": prices,
              "top5Payment": top_money(5), "top10Payment": top_money(10),
              "top5Share": P._share(sum(int(v) for v in top[:5] if v is not None), metrics["payment"], scoped, complete=complete),
              "top10Share": P._share(sum(int(v) for v in top if v is not None), metrics["payment"], scoped, complete=complete)}
    def visit(value):
        if isinstance(value, dict):
            if "coverageRef" in value: value["coverageRef"] = ref
            for child in value.values(): visit(child)
        elif isinstance(value, list):
            for child in value: visit(child)
    visit(output)
    budget(deadline)
    return output


def _promotion_scope(principal, context, platform, deadline):
    names = [key.split("\x1f", 1)[1] for key in context["effectiveScope"]["shopKeys"] if key.startswith(platform+"\x1f")]
    params = QueryDict("", mutable=True)
    params["platform"] = platform
    params.setlist("outlet", [platform+"\x1f"+n for n in names])
    params.update({"dimension": "sku" if platform == "京东" else "spu", "startDate": context["periods"]["current"]["startDate"], "endDate": context["periods"]["current"]["endDate"], "periodKind": context["effectiveScope"]["periodKind"]})
    spec, _ = A._validate(params)
    owning_context = read_context(principal, spec, deadline=deadline)
    facts = A._read_facts(platform, names, owning_context["periods"], deadline)
    return A._Reader(owning_context, facts, platform)


def load_erp_comparison(principal, spec, current, baseline, *, deadline):
    """Reserved owning-consumer hook. No approved Sales comparison source yet."""
    budget(deadline)
    return {"state": "dependency_pending", "reasonCode": "unverified_source", "consumer": None, "sourceRevisions": []}


def load_comparison_sources(principal, spec, current, baseline, *, deadline):
    descriptors = object_descriptors(current, baseline, spec["comparisonScope"]["mode"])
    candidates = {d["objectKey"] for d in descriptors}
    if set(spec["chartObjectKeys"])-candidates:
        raise NetshopApiError("主图对象不属于完整授权候选集合", code="access_denied", status=403)
    charts = spec["chartObjectKeys"] or [d["objectKey"] for d in descriptors[:4]]
    reference = P._base(current)
    base = _category_base(reference, current, spec["comparisonScope"])
    coverage, objects, summaries, contexts, definitions = {}, {}, {}, [current, baseline], []
    daily_projections = {}
    for period, context in (("current", current), ("baseline", baseline)):
        budget(deadline)
        projection = list(P._window_rows(base, context["periods"]["current"]).values("platform", "shop_name", "business_date").annotate(**P._annotations(P.ALL_FIELDS)).order_by("platform", "shop_name", "business_date"))
        if len(projection) > 50*366:
            raise NetshopApiError("店日投影超过完整候选预算", code="quality_incomplete", status=422)
        daily_projections[period] = projection
        dates = days(context["periods"]["current"]["startDate"], context["periods"]["current"]["endDate"])
        all_keys = sorted({k for d in descriptors for k in d["shopKeys"]})
        summaries[period], _ = _product_metrics(projection, context, all_keys, dates, "comparison:"+period+":product:summary", coverage)
        if len(context["effectiveScope"]["platforms"]) > 1:
            for metric_key in ("visitors", "customers", "conversion", "visitorValue", "transactionOrders"):
                summaries[period][metric_key] = unavailable(metric_key, "comparison:"+period+":product:summary", "not_applicable")
        for descriptor in descriptors:
            budget(deadline)
            key = descriptor["objectKey"]
            item = objects.setdefault(key, {**descriptor, "trends": {}, "structure": {}, "presence": {}})
            ref = "comparison:"+period+":product:"+_canonical_token(key)[:16]
            item[period], item["presence"][period] = _product_metrics(projection, context, descriptor["shopKeys"], dates, ref, coverage)
            if key in charts:
                item["structure"][period] = _product_structure(base, context, descriptor, item[period], projection, period, coverage, deadline)
            item["trends"][period] = []
            if key in charts:
                for bucket in period_groups(dates[0], dates[-1], spec["trendGrain"]):
                    budget(deadline)
                    metrics, _ = _product_metrics(projection, context, descriptor["shopKeys"], bucket, ref+":trend:"+bucket[0], coverage)
                    item["trends"][period].append({"startDate": bucket[0], "endDate": bucket[-1], "days": len(bucket), "metrics": metrics})
                    budget(deadline)
    category_active = spec["comparisonScope"]["category"]["mode"] != "all"
    source_errors, source_states, source_scopes = [], [], []
    for period, context in (("current", current), ("baseline", baseline)):
        platform_summaries = []
        for platform in context["effectiveScope"]["platforms"]:
            budget(deadline)
            if category_active:
                source_states.append({"period": period, "platform": platform, "state": "unavailable", "code": "unmapped"})
                continue
            try:
                reader = _promotion_scope(principal, context, platform, deadline)
            except NetshopApiError as error:
                if error.status != 503: raise
                budget(deadline)
                source_errors.append({"period": period, "platform": platform, "source": "promotion", "state": "error", "code": error.code})
                source_states.append({"period": period, "platform": platform, "state": "error", "code": error.code})
                continue
            contexts.append(reader.context)
            source_states.append({"period": period, "platform": platform, "state": "ready", "code": None})
            definitions.append({"period": period, "platform": platform, "amountDefinition": "jd_total_order_amount" if platform == "京东" else "tmall_net_amount", "denominatorDimension": "sku" if platform == "京东" else "spu", "attributionWindow": None})
            names = [k.split("\x1f", 1)[1] for k in context["effectiveScope"]["shopKeys"] if k.startswith(platform+"\x1f")]
            dates = days(context["periods"]["current"]["startDate"], context["periods"]["current"]["endDate"])
            total, _ = reader.totals(names, dates, "comparison:"+period+":promotion:"+platform+":summary")
            platform_summaries.append(total)
            for key, item in objects.items():
                budget(deadline)
                if item["platform"] != platform: continue
                member_names = [k.split("\x1f", 1)[1] for k in item["shopKeys"]]
                metrics, matched = reader.totals(member_names, dates, "comparison:"+period+":promotion:"+_canonical_token(key)[:16])
                # Record presence is independent of the selected metric value.
                # A validated raw record can lack spend; errors/unmapped scopes
                # do not overwrite an already proved product record presence.
                promotion_coverage = reader.context["coverageBySource"][metrics["spend"]["coverageRef"]]
                item["presence"][period] = item["presence"][period] or promotion_coverage["coveredShopDatePairs"] > 0
                item[period].update({k: metrics[k] for k in PROMOTION_KEYS})
                item.setdefault("matchedRanges", {})[period] = matched
                for bucket in item["trends"][period]:
                    budget(deadline)
                    metric, _ = reader.totals(member_names, days(bucket["startDate"], bucket["endDate"]), "comparison:"+period+":promotion:"+_canonical_token(key)[:16]+":trend:"+bucket["startDate"])
                    bucket["metrics"].update({k: metric[k] for k in PROMOTION_KEYS})
                    budget(deadline)
            coverage.update({k: v for k, v in reader.context["coverageBySource"].items() if k.startswith("comparison:")})
            source_scopes.append({"period": period, "scopeKey": reader.context["scopeKey"], "snapshotToken": reader.context["snapshotToken"], "dimension": reader.context["effectiveScope"]["dimension"], "shopKeys": reader.context["effectiveScope"]["shopKeys"], "sourceRevisions": reader.context["sourceRevisions"], "coverageBySource": deepcopy(reader.context["coverageBySource"])})
        for key in PROMOTION_KEYS:
            if len(platform_summaries) == 1 and len(context["effectiveScope"]["platforms"]) == 1:
                summaries[period][key] = platform_summaries[0][key]
            elif key == "spend" and platform_summaries and len(platform_summaries) == len(context["effectiveScope"]["platforms"]):
                values = [v[key] for v in platform_summaries]
                reason = None if all(v["status"] == "available" for v in values) else "incomplete_coverage"
                provided = [v["value"] for v in values if v["value"] is not None]
                summaries[period][key] = A._metric(key, "comparison:"+period+":promotion:summary", list(dict.fromkeys(s for v in values for s in v["sourceIds"])), sum(provided) if provided else None, "available" if reason is None else "partial" if provided else "unavailable", reason if reason else None)
                pieces = [coverage[v["coverageRef"]] for v in values]
                coverage["comparison:"+period+":promotion:summary"] = {"expectedShopDatePairs": sum(v["expectedShopDatePairs"] for v in pieces), "coveredShopDatePairs": sum(v["coveredShopDatePairs"] for v in pieces), "complete": all(v["complete"] for v in pieces), "missingByShop": [m for v in pieces for m in v["missingByShop"]], "truncated": False}
            else:
                summaries[period][key] = unavailable(key, "comparison:"+period+":promotion:summary", "unmapped" if category_active else "not_applicable" if len(context["effectiveScope"]["platforms"]) > 1 else "unverified_source")
    erp = load_erp_comparison(principal, spec, current, baseline, deadline=deadline)
    for period in ("current", "baseline"):
        for key in ERP_KEYS: summaries[period][key] = unavailable(key, "comparison:"+period+":erp:summary", "unmapped" if category_active else erp["reasonCode"])
        for item in objects.values():
            for key in PROMOTION_KEYS+ERP_KEYS:
                item[period].setdefault(key, unavailable(key, "comparison:"+period+":unavailable", "unmapped" if category_active else "unverified_source"))
            for bucket in item["trends"][period]:
                for key in PROMOTION_KEYS+ERP_KEYS:
                    bucket["metrics"].setdefault(key, unavailable(key, "comparison:"+period+":unavailable", "unmapped" if category_active else "unverified_source"))
    raw_categories = list(P._window_rows(reference, current["periods"]["current"]).values("platform", "category").distinct().order_by("platform", "category")[:501])
    if len(raw_categories) > 500:
        raise NetshopApiError("本期完整来源标签超过500项，请缩小范围", code="quality_incomplete", status=422)
    category_options = [P._category_evidence(row["category"] or None, P._source(row["platform"], current["effectiveScope"]["dimension"])[0], row["platform"], current) for row in raw_categories]
    # Every metric, including honest pending/unmapped values, has a resolvable
    # coverage reference. These absent-source records never assert true zeros.
    def register(value):
        if isinstance(value, dict):
            ref = value.get("coverageRef")
            if isinstance(ref, str) and ref not in coverage:
                coverage[ref] = {"expectedShopDatePairs": 0, "coveredShopDatePairs": 0, "complete": False, "missingByShop": [], "truncated": False}
            for child in value.values(): register(child)
        elif isinstance(value, list):
            for child in value: register(child)
    register(objects); register(summaries)
    return {"objects": list(objects.values()), "summaries": summaries, "coverage": coverage, "contexts": contexts, "chartObjectKeys": charts, "categoryOptions": category_options,
            "sourceErrors": source_errors, "sourceStates": source_states, "sourceScopes": source_scopes, "promotionDefinitions": definitions, "erp": erp}


def validate_joined_revisions(contexts, *, deadline):
    budget(deadline)
    revision = revision_value()
    joined = []
    for context in contexts:
        expected = [{"domain": "netshop", "kind": "owning_revision", "scopeKey": context["scopeKey"], "revision": revision}]
        for platform in context["effectiveScope"]["platforms"]:
            names = [k.split("\x1f", 1)[1] for k in context["effectiveScope"]["shopKeys"] if k.startswith(platform+"\x1f")]
            expected.extend({"domain": "netshop", "kind": platform+":"+k, "scopeKey": context["scopeKey"], "revision": v} for k, v in sorted(context_versions(platform, names, revision).items()) if k != "netshop")
        if expected != context["sourceRevisions"]:
            raise NetshopApiError("比较参与来源版本变化", code="insights_revision_changed", status=409)
        for member in expected:
            if member not in joined: joined.append(member)
    budget(deadline)
    return joined
