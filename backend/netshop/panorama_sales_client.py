"""S display projection of the public, bounded ERP two-period owning RPC.

The two complete owning envelopes remain evidence. No ERP costs, profits,
source identity, order denominator, product ranking or daily facts are invented.
"""
from __future__ import annotations

import os

from .errors import NetshopApiError
from .insights_common import actor_fence
from .sales_client import CONTROLLED_JD_ALIASES, sales_alias
from .sales_periods_client import read_sales_periods

SCHEMA_VERSION = "netshop-panorama-sales-v1"
KEYS = ("netSales", "cost", "netQuantity", "positiveQuantity", "returnAmount", "returnQuantity", "orderMargin", "largeMargin", "largeMarginRate", "orders", "orderAverageValue")
VALUE_KEYS = {"netSales": "netSalesCents", "netQuantity": "netQuantity", "positiveQuantity": "positiveQuantity", "returnAmount": "refundCents", "returnQuantity": "returnQuantity"}
NATIVE_KEYS = {"netQuantity", "positiveQuantity", "returnQuantity"}


def resolve_panorama_sales(context):
    platform, name = context["effectiveScope"]["shopKeys"][0].split("\x1f", 1)
    if platform != "京东" or name not in CONTROLLED_JD_ALIASES:
        return None
    alias = sales_alias(platform, name)
    # Do not strip original strings, wildcard the channel, or ask for a union.
    if not alias["rawShopName"].strip() or not alias["rawChannel"] or not alias["rawChannel"].strip():
        return None
    return {"platform": platform, "rawShopName": alias["rawShopName"], "rawChannel": alias["rawChannel"]}


def _request(context, identity, kind, revision=None):
    periods = context["periods"]
    value = {"operation": "netshop_periods_v1", "current": {k: periods["current"][k] for k in ("startDate", "endExclusive")},
             "baseline": {k: periods[kind][k] for k in ("startDate", "endExclusive")}, "rawOutlets": [identity], "q": "", "page": 1, "pageSize": 20}
    if revision is not None:
        value["expectedRevision"] = revision
    return value


def _references(owning):
    refs, pair = {}, None
    for body in owning.values():
        if body is None:
            continue
        for ref in body["sourceRevisions"]:
            if pair is not None and pair != ref["revision"]:
                raise NetshopApiError("ERP两期信封来源版本不一致", code="insights_revision_changed", status=409)
            pair = ref["revision"]
            key = (ref["domain"], ref["kind"], ref["scopeKey"])
            if key in refs and refs[key]["revision"] != pair:
                raise NetshopApiError("ERP参与向量版本不一致", code="insights_revision_changed", status=409)
            refs[key] = ref
    return [refs[key] for key in sorted(refs)]


def _read_temporal_pair(principal, context, identity, kind, revision, grain, deadline):
    parent, pair = read_sales_periods(principal, _request(context, identity, kind, revision), deadline=deadline)
    # Exact S identity has at most one complete, unsearched candidate. The
    # owner rejects an absent identity for series; retain its null parent.
    if not parent["items"]:
        return parent, pair
    if len(parent["items"]) != 1 or parent["items"][0]["identity"] != identity:
        raise NetshopApiError("ERP完整候选不是已核验唯一原始身份", code="insights_revision_changed", status=409)
    request = {**_request(context, identity, kind, pair), "seriesGrain": grain, "seriesOutlets": [identity]}
    selected, selected_pair = read_sales_periods(principal, request, deadline=deadline)
    if selected_pair != pair or selected["periodTotals"] != parent["periodTotals"]:
        raise NetshopApiError("ERP序列与原两期记录或版本不一致", code="insights_revision_changed", status=409)
    return selected, pair


def _metric(key, period, coverage_ref):
    exists = period is not None and period["rowPresence"]
    source = ["erp_sales:netshop_periods_v1"]
    basis = "erp_order_margin" if key == "orderMargin" else "erp_large_margin" if key in {"largeMargin", "largeMarginRate"} else "erp_net_sales"
    reason = "not_applicable" if period is None else "incomplete_coverage" if exists else "no_records"
    metric = {"value": None, "unit": "NATIVE_INTEGER_QUANTITY" if key in NATIVE_KEYS else "COUNT" if key == "orders" else "RATIO" if key == "largeMarginRate" else "CNY_CENT",
              "status": "unavailable", "reasonCode": reason, "sourceIds": source, "basis": basis, "aggregation": "sum", "coverageRef": coverage_ref}
    if key in VALUE_KEYS:
        metric.update(value=period["values"][VALUE_KEYS[key]] if exists else None, status="partial" if exists else "unavailable")
    elif key == "orders":
        metric.update(value=period["orders"]["trustedOrderCount"] if exists else None, status="partial" if exists else "unavailable")
    elif key == "orderAverageValue":
        # Keep the exact owned, potentially fractional, integer-cents/order mean.
        original = period["orders"]["netAmountPerOrder"] if period is not None else {"unit": "CNY_CENT_PER_ORDER", "value": None, "numerator": None, "denominator": None, "status": "unavailable", "reasonCode": "not_applicable"}
        metric.update(original, aggregation="ratio_of_sums")
    else:
        metric["reasonCode"] = "not_applicable" if period is None else "unverified_source" if exists else "no_records"
        if key == "largeMarginRate":
            metric.update(aggregation="ratio_of_sums", numerator=None, denominator=None)
    return metric


def read_panorama_sales(principal, context, *, deadline, grain="day"):
    from .store_panorama import _budget
    _budget(deadline)
    actor = actor_fence(principal)
    if grain not in {"day", "week", "month"}:
        raise NetshopApiError("ERP序列粒度无效")
    identity = resolve_panorama_sales(context)
    if identity is None:
        raise NetshopApiError("店铺尚无已核验的ERP原始店铺及明确渠道映射", code="not_applicable", status=422)
    if context["periods"]["previous"]["days"] > 366:
        raise NetshopApiError("ERP基期超过所属366日上限，不能截日", code="not_applicable", status=422)
    # The old common reader has a compatibility fallback. S explicitly refuses
    # it before calling the approved public RPC, including in private fixtures.
    if not os.getenv("TERUISI_DJANGO_SALES_READER_BASE_URL", "").strip():
        raise NetshopApiError("ERP固定只读端点未配置", code="service_unavailable", status=503)
    previous, pair = _read_temporal_pair(principal, context, identity, "previous", None, grain, deadline)
    year = None
    if context["periods"]["yearAgo"]["days"] <= 366:
        year, second_pair = _read_temporal_pair(principal, context, identity, "yearAgo", pair, grain, deadline)
        if pair != second_pair or previous["periodTotals"]["current"] != year["periodTotals"]["current"]:
            raise NetshopApiError("ERP两次本期事实或版本不一致", code="insights_revision_changed", status=409)
    if actor_fence(principal) != actor:
        raise NetshopApiError("ERP读取期间账号权限变化", code="access_denied", status=403)
    owning = {"previous": previous, "yearAgo": year}
    period_rows = {"current": previous["periodTotals"]["current"], "previous": previous["periodTotals"]["baseline"], "yearAgo": year["periodTotals"]["baseline"] if year else None}
    periods = {}
    for kind, row in period_rows.items():
        window = context["periods"][kind]
        ref = "sales:" + (previous if kind != "yearAgo" or year is None else year)["scopeKey"] + ":" + kind
        periods[kind] = {"startDate": window["startDate"], "endDate": window["endDate"], "metrics": {key: _metric(key, row, ref) for key in KEYS}}
    platform, name = context["effectiveScope"]["shopKeys"][0].split("\x1f", 1)
    _budget(deadline)
    return {"schemaVersion": SCHEMA_VERSION, "scope": {"platform": platform, "shopName": name, "startDate": context["periods"]["current"]["startDate"], "endDate": context["periods"]["current"]["endDate"]},
            "channel": identity["rawChannel"], "rawOutlets": [identity], "owning": owning, "sourceRevisions": _references(owning), "periods": periods,
            "comparisons": {key: {kind: {"value": None, "method": "percentage_points" if key == "largeMarginRate" else "relative_change", "status": "unavailable", "reasonCode": "incomplete_baseline"} for kind in ("previous", "yearAgo")} for key in KEYS},
            "daily": [], "items": [], "pagination": {"page": 1, "pageSize": 20, "total": 0, "returned": 0, "truncated": False, "hasMore": False},
            "limitations": [
                "ERP净额和原生整数数量仅披露已导入记录范围，observations不是店日完整结算；比较不冒完整增长",
                "订单均值是ERP已导入订单组净额均值，按原整数分/订单组未舍入值，不是平台支付客单价",
                "历史成本/映射和原订单毛利尚未核验，成本相关主值不可用，原值与全部metadata保留在所属信封",
                "所属consumer只提供RAW身份候选与两期记录；没有商品贡献排行，日/周/月序列仅保留所属opt-in信封",
                "原生序列仅在精确身份属于两期完整候选时由所属服务生成，缺桶null；日期仍是已导入业务日记录",
                "同比超过366日不截日，保留原日期和not_applicable状态；多域仍为non_atomic观察",
            ]}


def verify_panorama_sales(principal, context, data, *, deadline):
    from .store_panorama import _budget
    _budget(deadline)
    actor = actor_fence(principal)
    expected = _references(data["owning"])
    pair = expected[0]["revision"]
    reread = {}
    identity = data["rawOutlets"][0]
    for kind in ("previous", "yearAgo"):
        if data["owning"][kind] is None:
            reread[kind] = None
            continue
        request = _request(context, identity, kind, pair)
        intent = data["owning"][kind]["requestedScope"].get("seriesIntent")
        if intent is not None:
            request.update(seriesGrain=intent["grain"], seriesOutlets=intent["rawOutlets"])
        body, revision = read_sales_periods(principal, request, deadline=deadline)
        if revision != pair or body["periodTotals"] != data["owning"][kind]["periodTotals"]:
            raise NetshopApiError("ERP参与记录或版本已变化", code="insights_revision_changed", status=409)
        if body.get("series") != data["owning"][kind].get("series"):
            raise NetshopApiError("ERP所属序列在最终核验期间已变化", code="insights_revision_changed", status=409)
        reread[kind] = body
    if actor_fence(principal) != actor:
        raise NetshopApiError("ERP最终核验期间账号权限变化", code="access_denied", status=403)
    if _references(reread) != expected:
        raise NetshopApiError("ERP参与范围或修订已变化", code="insights_revision_changed", status=409)
    _budget(deadline)
