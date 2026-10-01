"""Read-only C v1 owner: complete authorized pair set, then bounded presentation."""
from __future__ import annotations

from datetime import date
import json
import re
import time

from django.db import connection

from .comparison_adapter import budget, load_comparison_sources, validate_joined_revisions, unavailable, validate_comparison_metric, validate_erp_revision, refresh_erp_projection
from .comparison_contract import COMPARISON_SCHEMA, METRIC_KEYS, build_period_bindings, parse_comparison_v1
from .errors import NetshopApiError
from .insights_common import MAX_SAFE, actor_fence, compare_metrics, compare_derived_money_per_count, read_context, require_supported_scope, validate_metric
from .query import _canonical_token

MAX_RESPONSE_BYTES = 2*1024*1024
PROMOTION_PARALLEL_KEYS = {"attributedPayment", "roas", "ctr", "cpc", "spendRate"}
PRODUCT_PARALLEL_KEYS = {"visitors", "customers", "conversion", "visitorValue", "transactionOrders"}
ADDITIVE_KEYS = {"payment", "quantity", "visitors", "customers", "transactionOrders", "spend", "attributedPayment", "erpNetSales", "orderMargin", "largeMarginAmount", "erpOrderCount", "erpNetQuantity", "returnQuantity"}


def _compare(current, baseline):
    if current["unit"] == "NATIVE_INTEGER_QUANTITY":
        validate_comparison_metric(current); validate_comparison_metric(baseline)
        return compare_metrics({**current, "unit": "COUNT"}, {**baseline, "unit": "COUNT"})
    return compare_derived_money_per_count(current, baseline) if current["unit"] == "CNY_CENT_PER_COUNT" else compare_metrics(current, baseline)


def _delta(current, baseline):
    if current["unit"] == "NATIVE_INTEGER_QUANTITY":
        validate_comparison_metric(current); validate_comparison_metric(baseline)
        return validate_comparison_metric({**current, "value": None, "status": "unavailable", "reasonCode": "incomplete_baseline"})
    if current["unit"] == "CNY_CENT_PER_COUNT":
        return {**current, "value": None, "numerator": None, "denominator": None, "status": "unavailable", "reasonCode": "not_applicable"}
    compatible = current["unit"] == baseline["unit"] and current["basis"] == baseline["basis"] and sorted(current["sourceIds"]) == sorted(baseline["sourceIds"])
    reason = "not_applicable" if not compatible else "incomplete_baseline" if any(m["status"] != "available" for m in (current, baseline)) else None
    value = None if reason else current["value"]-baseline["value"]
    if value is not None and abs(value) > MAX_SAFE:
        value, reason = None, "unsafe_integer"
    return validate_metric({"value": value, "unit": current["unit"], "status": "invalid" if reason == "unsafe_integer" else "unavailable" if reason else "available", "reasonCode": reason,
                           "basis": current["basis"], "sourceIds": current["sourceIds"], "aggregation": "source_value_only", "coverageRef": current["coverageRef"]})


def _share(metric, denominator, metric_key):
    reason = "not_applicable" if metric_key not in ADDITIVE_KEYS else "incomplete_coverage" if metric["status"] != "available" or denominator["status"] != "available" else "zero_denominator" if denominator["value"] == 0 else "negative_denominator" if denominator["value"] < 0 else None
    return validate_metric({"value": None if reason else metric["value"]/denominator["value"], "unit": "RATIO", "status": "unavailable" if reason else "available", "reasonCode": reason, "basis": metric["basis"], "sourceIds": denominator["sourceIds"], "aggregation": "ratio_of_sums", "numerator": metric["value"], "denominator": denominator["value"], "coverageRef": metric["coverageRef"]})


def _sum_metrics(values, template):
    if template["unit"] in {"RATIO", "MULTIPLE", "CNY_CENT_PER_COUNT", "NATIVE_INTEGER_QUANTITY"}:
        return {**template, "value": None, "status": "unavailable", "reasonCode": "not_applicable", **({"numerator": None, "denominator": None} if "numerator" in template else {})}
    reason = None if values and all(v["status"] == "available" for v in values) else "incomplete_baseline"
    value = sum(v["value"] for v in values) if not reason else None
    if value is not None and abs(value) > MAX_SAFE: value, reason = None, "unsafe_integer"
    return validate_metric({**template, "value": value, "status": "invalid" if reason == "unsafe_integer" else "unavailable" if reason else "available", "reasonCode": reason,
                           "sourceIds": list(dict.fromkeys(s for v in values for s in v["sourceIds"]))})


def _qualified(item, spec):
    metric = spec["metricKey"]
    current, baseline = item["current"][metric], item["baseline"][metric]
    current_complete, baseline_complete = current["status"] == "available", baseline["status"] == "available"
    parallel = len(spec["currentSpec"]["platforms"]) > 1 and metric in PROMOTION_PARALLEL_KEYS | PRODUCT_PARALLEL_KEYS
    comparison = _compare(current, baseline)
    comparable = current_complete and baseline_complete and comparison["status"] == "available" and not parallel
    reasons = list(dict.fromkeys(m["reasonCode"] for m in (current, baseline) if m["reasonCode"]))
    if comparison["status"] != "available" and comparison["reasonCode"] not in reasons:
        reasons.append(comparison["reasonCode"])
    if parallel: reasons.append("not_applicable")
    return {"currentComplete": current_complete, "baselineComplete": baseline_complete, "comparable": comparable}, reasons


def _row(item, summaries, spec):
    qualification, reasons = _qualified(item, spec)
    metric = spec["metricKey"]
    return {key: item[key] for key in ("objectKey", "kind", "platform", "shopName", "shopKeys")} | {
        "current": item["current"], "baseline": item["baseline"],
        "comparisons": {key: _compare(item["current"][key], item["baseline"][key]) for key in sorted(METRIC_KEYS)},
        "delta": _delta(item["current"][metric], item["baseline"][metric]),
        "share": {p: _share(item[p][metric], summaries[p][metric], metric) for p in ("current", "baseline")},
        "qualification": qualification, "exclusionReasons": reasons}


def _rank_key(row, spec):
    metric, sort = spec["metricKey"], spec["sort"]
    available = row["qualification"]["currentComplete"] and row["qualification"]["baselineComplete"] and "not_applicable" not in row["exclusionReasons"]
    if sort in {"growth_desc", "decline_desc"}: available = available and row["qualification"]["comparable"] and row["comparisons"][metric]["status"] == "available"
    if not available: return (1, 0, row["objectKey"])
    if sort == "name_asc": return (0, 0, row["objectKey"])
    value = row["comparisons"][metric]["value"] if sort in {"growth_desc", "decline_desc"} else row["current"][metric]["value"]
    return (0, value if sort in {"value_asc", "decline_desc"} else -value, row["objectKey"])


def _contributions(rows, summaries, spec):
    metric = spec["metricKey"]
    template = summaries["current"][metric]
    reason = "not_applicable" if metric not in ADDITIVE_KEYS else "incomplete_coverage" if any(summaries[p][metric]["status"] != "available" for p in ("current", "baseline")) or any(r["delta"]["status"] != "available" for r in rows) else None
    if reason:
        empty = {**template, "value": None, "status": "unavailable", "reasonCode": reason, **({"numerator": None, "denominator": None} if "numerator" in template else {})}
        return {k: empty for k in ("continuousCurrent", "continuousBaseline", "continuousDelta", "scopeDelta")} | {"status": "unavailable", "reasonCode": reason}
    continuous_current = _sum_metrics([r["current"][metric] for r in rows], template)
    continuous_baseline = _sum_metrics([r["baseline"][metric] for r in rows], summaries["baseline"][metric])
    continuous_delta = _delta(continuous_current, continuous_baseline)
    # Only exact complete membership supports decomposition; missing rows are
    # never inferred as entry/exit zero. With identical union, scope effect is 0.
    scope_delta = {**continuous_delta, "value": 0}
    return {"continuousCurrent": continuous_current, "continuousBaseline": continuous_baseline, "continuousDelta": continuous_delta, "scopeDelta": scope_delta,
            "status": "available", "reasonCode": None}


def build_comparison_result(spec, sources, current, baseline, section_token, joined):
    rows = [_row(item, sources["summaries"], spec) for item in sources["objects"]]
    full = sorted(rows, key=lambda row: _rank_key(row, spec))
    filter_kind = spec["comparisonScope"]["coverageFilter"]
    filtered = [r for r in full if filter_kind == "all" or (r["qualification"]["currentComplete"] and r["qualification"]["baselineComplete"]) == (filter_kind == "complete")]
    offset = (spec["page"]-1)*spec["pageSize"]
    page = filtered[offset:offset+spec["pageSize"]]
    pagination = {"page": spec["page"], "pageSize": spec["pageSize"], "total": len(filtered), "returned": len(page), "hasMore": offset+len(page) < len(filtered), "truncated": False}
    metric = spec["metricKey"]
    summary = {**sources["summaries"], "comparisons": {key: _compare(sources["summaries"]["current"][key], sources["summaries"]["baseline"][key]) for key in sorted(METRIC_KEYS)}, "delta": _delta(sources["summaries"]["current"][metric], sources["summaries"]["baseline"][metric])}
    trend, structure = [], []
    for item in sources["objects"]:
        if item["objectKey"] not in sources["chartObjectKeys"]: continue
        series = {p: [{"date": b["startDate"], "bucketEnd": b["endDate"], "metric": b["metrics"][metric]} for b in item["trends"][p]] for p in ("current", "baseline")}
        basis = {p: series[p][0]["metric"] if series[p] else unavailable(metric, "comparison:empty:trend") for p in ("current", "baseline")}
        reason = "incomplete_baseline" if any(m["status"] != "available" for m in basis.values()) else "zero_denominator" if any(m["value"] == 0 for m in basis.values()) else "negative_baseline" if any(m["value"] < 0 for m in basis.values()) else None
        trend.append({"objectKey": item["objectKey"], **series, "indexBasis": {"status": "unavailable" if reason else "available", "reasonCode": reason, **basis}})
        counts = {p: item["structure"][p]["tradedProducts"] for p in ("current", "baseline")}
        structure.append({"objectKey": item["objectKey"], **{p: {k: v for k, v in item["structure"][p].items() if k not in {"dataProducts", "tradedProducts"}} for p in ("current", "baseline")}, "counts": counts})
    lightweight = [{**{k: row[k] for k in ("objectKey", "kind", "platform", "shopName", "shopKeys", "qualification", "exclusionReasons")}, "currentPresence": source["presence"]["current"], "baselinePresence": source["presence"]["baseline"]} for row, source in zip(rows, sources["objects"])]
    relationships = build_period_bindings(current, baseline)
    overlap = max(0, (min(date.fromisoformat(relationships[p]["endDate"]) for p in ("current", "baseline"))-max(date.fromisoformat(relationships[p]["startDate"]) for p in ("current", "baseline"))).days+1)
    limitations = ["完整授权两期候选按精确平台/店铺配对，平台及旗下店铺不混排累计", "不完整对象保留供核查，排列在可信对象后；增长/下降只对完整可比对象排序", "分类使用reference current来源标签cohort，不证明官方字典或两期历史分类", "本基期长度和重叠按实值披露，金额不按天数缩放，不伪造每日配对", "ERP只读取已有sales_alias给出已证非空channel的精确RAW三元组；未知或多义映射不回全店", "ERP观察日期完整性未知，净额/可信订单/原生数量只披露观察汇总，不进入完整排名或增长", "ERP存储毛利及净额减存成本额未验证原字段/历史成本/历史映射/零成本，保留partial原值；毛利率/退货率/可信客单主值不可用", "商品成交订单为商品×日累计，不能称店铺去重订单或用作客单价分母", "跨平台商品访客/客户/成交订单累计与衍生效率仅并列，SKU/SPU及不同来源不当同口径店效率榜", "跨平台归因指标仅并列观察，不混合归因总额、评分或排名", "独立领域向量前后复验，不表示分布式原子快照"]
    limitations.append("本期/基期记录标记只表示已纳入且可读的P/A记录并集，不依赖所选指标是否有值；错误或未映射来源仍未知，ERP记录单独由所属sourceEvidence披露")
    if sources["sourceErrors"]:
        limitations += ["推广来源读取失败，独立商品章节保留；错误状态不等于无记录"]
    return {"schemaVersion": COMPARISON_SCHEMA, "currentContext": current, "baselineContext": baseline, "sectionToken": section_token,
            "comparisonScope": spec["comparisonScope"], "selectedBaseline": spec["selectedBaseline"], "metricKey": metric,
            "trendGrain": spec["trendGrain"], "sort": spec["sort"], "chartObjectKeys": sources["chartObjectKeys"], "joinedSourceRevisions": joined,
            "consistency": "revision_vector_checked_non_atomic", "sections": {
                "scale": {"metricKey": metric, "summary": summary, "items": page, "pagination": pagination, "contributions": _contributions(rows, sources["summaries"], spec)},
                "efficiency": {"items": [r["objectKey"] for r in page], "distribution": [{"objectKey": r["objectKey"], "metric": r["current"][metric], "qualification": r["qualification"]} for r in full], "definitions": ["矩阵与完整排名共享分页；分布来自完整候选而非当前页", "比例按完整同源分子/分母重算，不平均店铺比率，不设综合评分", "商品访客/客户是商品×日累计，非店铺UV；ERP原订单号分组可观察，缺失号及未核店日完整性保留原状态，不称付款客户客单价"]},
                "trends": {"grain": spec["trendGrain"], "items": trend, "definitions": ["两期分别返回真实自然日/周/月桶，缺数据保持空值，不补零", "指数分别以各期第一个自然桶的正且完整selected metric为100；缺失/零/负不算指数", "两期窗口独立，金额不按日数缩放", "ERP店铺及平台序列由拥有方同RPC按完整授权RAW范围与自然桶聚合，订单为各桶真实distinct原订单；观察日期仍未证完整，不重算利润或按日数分摊", "平台成员精确对齐父完整两期候选，包含基期有而本期无的成员；不累加店铺日订单或缩水平台范围"]},
                "structure": {"items": structure, "categoryBasis": "reference_current_cohort", "sameProduct": {"status": "unavailable", "reasonCode": "unmapped"}, "categoryOptions": sources["categoryOptions"], "definitions": ["结构仅展示当前主图对象，来自其完整商品集合，不受排名分页影响", "类目为所属来源标签，无官方ID、跨平台归并或有效期证明", "价格带是同源成交金额/件数的成交均价，当前目录价格不回填历史", "同款映射未核验，不按同名商品猜测"]},
                "promotion": {"items": [r["objectKey"] for r in page], "sourceScopes": sources["sourceScopes"], "sourceStates": sources["sourceStates"], "sourceDefinitions": ["推广矩阵与完整排名共享分页；完整店铺指标由推广拥有者计算", "京东归因为总订单金额，天猫归因为净成交金额；窗口未知，不代表利润或广告增量", "推广费率主值只用完整相同店日配对；京东SKU/天猫SPU分母由A所属scope保留", "分类条件缺可靠推广映射时不可用，不回退全店或按比例分摊"]},
                "comparability": {"items": lightweight, "coverage": sources["coverage"], "erpState": {"state": sources["erp"]["state"], "code": sources["erp"]["reasonCode"]}, "erpEvidence": sources["erp"]["evidence"], "counts": {"candidates": len(rows), "currentComplete": sum(r["qualification"]["currentComplete"] for r in rows), "baselineComplete": sum(r["qualification"]["baselineComplete"] for r in rows), "comparable": sum(r["qualification"]["comparable"] for r in rows), "excluded": sum(not r["qualification"]["comparable"] for r in rows)}, "periodRelationship": {"sameLength": relationships["equalLength"], "overlapDays": overlap}, "limitations": limitations, "population": "complete_authorized_candidate_union"}}}


def read_comparison_insights(principal, params):
    deadline = time.monotonic()+65
    def fence(execute, sql, values, many, context):
        statement = re.sub(r"\A(?:\s+|/\*[\s\S]*?\*/|--[^\n]*(?:\n|$))*", "", str(sql))
        reading = re.match(r"(?:SELECT|WITH|SHOW|EXPLAIN)\b", statement, re.I) is not None
        if reading: budget(deadline)
        result = execute(sql, values, many, context)
        if reading: budget(deadline)
        return result
    with connection.execute_wrapper(fence):
        spec = parse_comparison_v1(params)
        require_supported_scope(principal)
        actor = actor_fence(principal)
        current = read_context(principal, spec["currentSpec"], deadline=deadline)
        baseline = read_context(principal, spec["baselineSpec"], deadline=deadline)
        # Context retries must not establish a mixed pair after a source change.
        if current["sourceRevisions"][0]["revision"] != baseline["sourceRevisions"][0]["revision"]:
            raise NetshopApiError("本基期所属来源版本变化", code="insights_revision_changed", status=409)
        sources = load_comparison_sources(principal, spec, current, baseline, deadline=deadline)
        joined = validate_joined_revisions(sources["contexts"], deadline=deadline, principal=principal, erp=sources["erp"])
        def token_for(vector):
            return _canonical_token({"schema": COMPARISON_SCHEMA, "actor": actor, "currentScope": current["scopeKey"], "currentSnapshot": current["snapshotToken"], "baselineScope": baseline["scopeKey"], "baselineSnapshot": baseline["snapshotToken"], "selection": spec["comparisonScope"], "selectedBaseline": spec["selectedBaseline"], "metricKey": spec["metricKey"], "sort": spec["sort"], "trendGrain": spec["trendGrain"], "chartObjectKeys": sources["chartObjectKeys"], "pageSize": spec["pageSize"], "erpMappings": sources["erp"]["evidence"]["mappings"], "erpSnapshot": sources["erp"]["evidence"]["source"]["snapshotToken"] if sources["erp"]["state"] == "ready" else None, "erpPlatformSnapshots": [{"platform":carrier["platform"],"scopeKey":carrier["source"]["scopeKey"],"snapshotToken":carrier["source"]["snapshotToken"]} for carrier in sources["erp"]["evidence"].get("platformPeriods",[])], "joined": vector})
        section_token = token_for(joined)
        if spec["sectionToken"] and section_token != spec["sectionToken"]:
            raise NetshopApiError("比较sectionToken不属于本基期/来源/账号/显示范围", code="insights_revision_changed", status=409)
        result = build_comparison_result(spec, sources, current, baseline, section_token, joined)
        budget(deadline)
        encoded = json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_RESPONSE_BYTES:
            raise NetshopApiError("完整比较响应超过2MiB，请缩短期间、切换周/月或减少主图对象后重试", code="quality_incomplete", status=422)
        budget(deadline)
        erp_before = sources["erp"]["state"]
        validate_erp_revision(principal, sources["erp"], deadline=deadline)
        if erp_before == "ready" and sources["erp"]["state"] == "error":
            refresh_erp_projection(sources, current, baseline)
            joined = validate_joined_revisions(sources["contexts"], deadline=deadline, principal=principal, erp=sources["erp"])
            result = build_comparison_result(spec, sources, current, baseline, token_for(joined), joined)
            budget(deadline)
            if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_RESPONSE_BYTES:
                raise NetshopApiError("完整比较响应超过2MiB，请缩短期间、切换周/月或减少主图对象后重试", code="quality_incomplete", status=422)
            budget(deadline)
        if validate_joined_revisions(sources["contexts"], deadline=deadline, principal=principal, erp=sources["erp"]) != joined:
            raise NetshopApiError("比较末次来源向量变化", code="insights_revision_changed", status=409)
        if actor_fence(principal) != actor:
            raise NetshopApiError("比较读取期间账号权限变化", code="access_denied", status=403)
        budget(deadline)
        return result
