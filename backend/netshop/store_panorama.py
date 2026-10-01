"""Single-store read-only composition of the owning product/promotion readers.

No platform, advertising or ERP metric is recomputed here. Each owning envelope
retains its own scope, dimension, coverage and token. One outer read deadline
covers all sources and final actor/revision checks.
"""
from __future__ import annotations

import json
import re
import time

from django.db import DatabaseError, connection, transaction
from django.http import QueryDict

from .errors import NetshopApiError
from .insights_common import actor_fence, context_versions, read_context, validate_context
from .query import _canonical_token, positive, revision_value
from . import product_insights, promotion_insights
from .product_scope_series import read_product_scope_series

SCHEMA_VERSION = "netshop-store-panorama-v1"
READER_SECONDS = 65
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
SECTION_KEYS = (
    "performance", "traffic", "products", "promotion", "margin", "customers", "targets", "dataQuality",
)
SHARED_PARAMS = {"platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"}
TABLE_PARAMS = {"q", "page", "pageSize", "section", "sectionToken", "grain"}
SECTION_SOURCES = {
    "performance": ["products", "productSeries", "sales", "promotion"], "traffic": ["products", "productSeries"], "products": ["products"],
    "promotion": ["promotion"], "margin": ["sales"], "customers": ["products"], "targets": ["finance", "workflow"],
    "dataQuality": ["products", "productSeries", "promotion", "sales", "finance", "workflow"],
}
CAPABILITY_IDS = {
    "performance": ["platform_payment", "platform_quantity", "erp_net_sales", "orders", "order_average_value", "order_margin", "large_margin_rate", "platform_refund", "product_changes", "platform_trend", "platform_day_detail"],
    "traffic": ["page_views", "visitors", "customers", "conversion", "visitor_value", "favorites", "add_cart_customers", "add_cart_quantity", "order_customers", "order_quantity", "order_payment", "transaction_orders", "search_impressions", "search_clicks", "search_click_rate", "search_visitors", "search_customers", "stay_time", "bounce_rate", "traffic_trend"],
    "products": ["traded_products", "category_contribution", "top_concentration", "growth_decline", "product_detail", "inventory"],
    "promotion": ["spend", "attributed_payment", "roas", "cpc", "spend_rate", "trend", "distribution", "promotion_detail"],
    "margin": ["cost", "order_margin", "large_margin", "large_margin_rate", "return_amount", "return_quantity", "contribution"],
    "customers": ["new_old_buyers", "b2b_payment", "b2b_orders", "b2b_quantity", "b2b_product_structure", "unique_customers", "repeat_purchase", "b2b_share"],
    "targets": ["annual_target", "finance_month", "history", "events"],
    "dataQuality": ["coverage", "field_availability", "source_freshness", "mapping", "comparability", "import_records"],
}


def _budget(deadline):
    if time.monotonic() > deadline:
        raise NetshopApiError("店铺全景读取超出65秒整体预算，请缩小日期范围", code="source_not_ready", status=503)


def _validate(params: QueryDict):
    if set(params) - SHARED_PARAMS - TABLE_PARAMS or any(len(params.getlist(k)) != 1 for k in params):
        raise NetshopApiError("店铺全景请求包含未知或重复参数")
    shared = QueryDict("", mutable=True)
    for key in SHARED_PARAMS:
        if key in params:
            shared.setlist(key, params.getlist(key))
    spec = validate_context(shared)
    if len(spec["platforms"]) != 1 or len(spec["outlets"]) != 1:
        raise NetshopApiError("店铺全景须显式选择唯一平台和精确店铺")
    query = params.get("q", "")
    if len(query) > 120 or any(ord(c) < 32 or ord(c) == 127 for c in query):
        raise NetshopApiError("商品搜索最多120字符且不能含控制字符")
    section = params.get("section", "performance")
    if section not in SECTION_KEYS:
        raise NetshopApiError("店铺全景章节无效")
    grain = params.get("grain", "day")
    if grain not in {"day", "week", "month"}:
        raise NetshopApiError("店铺全景趋势粒度无效")
    for key in ("page", "pageSize"):
        if key in params and not re.fullmatch(r"[1-9]\d*", params[key]):
            raise NetshopApiError("店铺全景分页须无前导零的正整数")
    token = params.get("sectionToken")
    if token is not None and not re.fullmatch(r"[a-f0-9]{64}", token):
        raise NetshopApiError("店铺全景sectionToken无效")
    return spec, {
        "q": query.strip(), "page": positive(params.get("page"), 1, "page", 10000),
        "pageSize": positive(params.get("pageSize"), 5, "pageSize", 100), "section": section, "grain": grain,
    }, token


def _sql_fence(deadline):
    def fence(execute, sql, params, many, context):
        statement = re.sub(r"\A(?:\s+|/\*[\s\S]*?\*/|--[^\n]*(?:\n|$))*", "", str(sql))
        read = re.match(r"(?:SELECT|WITH|SHOW|EXPLAIN)\b", statement, re.I) is not None
        if read:
            _budget(deadline)
        result = execute(sql, params, many, context)
        if read:
            _budget(deadline)
        return result
    return fence


def _context_vector(context, deadline):
    _budget(deadline)
    revision = revision_value()
    vector = [{"domain": "netshop", "kind": "owning_revision", "scopeKey": context["scopeKey"], "revision": revision}]
    for platform in context["effectiveScope"]["platforms"]:
        names = [k.split("\x1f", 1)[1] for k in context["effectiveScope"]["shopKeys"] if k.startswith(platform + "\x1f")]
        vector.extend(
            {"domain": "netshop", "kind": platform + ":" + kind, "scopeKey": context["scopeKey"], "revision": value}
            for kind, value in sorted(context_versions(platform, names, revision).items()) if kind != "netshop"
        )
    _budget(deadline)
    if vector != context["sourceRevisions"]:
        raise NetshopApiError("全景参与来源版本已变化，请重新读取", code="insights_revision_changed", status=409)
    return vector


def _joined_vector(contexts):
    revisions = {}
    owning = {}
    for context in contexts:
        for item in context["sourceRevisions"]:
            key = (item["domain"], item["kind"], item["scopeKey"])
            if key in revisions and revisions[key]["revision"] != item["revision"]:
                raise NetshopApiError("全景来源向量不一致", code="insights_revision_changed", status=409)
            if item["kind"] == "owning_revision":
                if item["domain"] in owning and owning[item["domain"]] != item["revision"]:
                    raise NetshopApiError("全景拥有方来源版本不一致", code="insights_revision_changed", status=409)
                owning[item["domain"]] = item["revision"]
            revisions[key] = item
    return [revisions[key] for key in sorted(revisions)]


def _assert_context(source_context, context, *, dimension):
    left, right = source_context["effectiveScope"], context["effectiveScope"]
    if (left["platforms"] != right["platforms"] or left["shopKeys"] != right["shopKeys"]
            or left["dimension"] != dimension or left["periodKind"] != right["periodKind"]
            or source_context["periods"] != context["periods"]):
        raise NetshopApiError("全景来源返回错误店铺或日期范围", code="insights_revision_changed", status=409)


def _products_query(params, table):
    query = QueryDict("", mutable=True)
    for key in SHARED_PARAMS:
        if key in params:
            query.setlist(key, params.getlist(key))
    query.update({"q": table["q"], "page": str(table["page"]), "pageSize": str(table["pageSize"]), "sort": "payment_desc"})
    return product_insights.validate_product_query(query)


def _promotion_query(params, platform, grain):
    query = QueryDict("", mutable=True)
    for key in SHARED_PARAMS - {"snapshotToken", "dimension"}:
        if key in params:
            query.setlist(key, params.getlist(key))
    query.update({"dimension": "sku" if platform == "京东" else "spu", "q": "", "page": "1", "pageSize": "5", "objectKind": "product", "sort": "spend_desc", "trendGrain": grain})
    return query


def _read_products(principal, spec, deadline):
    # Public owning entry keeps its own fences while sharing the S deadline.
    return product_insights.read_product_insights(principal, spec, deadline=deadline)


def _read_promotion(principal, params, deadline):
    return promotion_insights.read_promotion_insights(principal, params, deadline=deadline)


def _read_series(principal, params, grain, deadline):
    query = QueryDict("", mutable=True)
    for key in SHARED_PARAMS:
        if key in params:
            query.setlist(key, params.getlist(key))
    query["grain"] = grain
    return read_product_scope_series(principal, query, deadline=deadline)


def _workflow_scope(context):
    platform, shop = context["effectiveScope"]["shopKeys"][0].split("\x1f", 1)
    window = context["periods"]["current"]
    return {"platform": platform, "shopName": shop, "startDate": window["startDate"], "endDate": window["endDate"]}


def _read_source(loader, deadline):
    _budget(deadline)
    try:
        # A failed primary SQL must not poison the next independent source.
        # PostgreSQL rolls this source frame/savepoint back before either
        # service-error branch below runs. Existing reader permissions stay.
        with transaction.atomic():
            data = loader()
    except NetshopApiError as error:
        if error.status != 503:
            raise
        _budget(deadline)
        return {"state": "error", "data": None, "code": "service_unavailable", "message": "所属只读来源暂时不可用；其他已核验章节仍可查看"}
    except DatabaseError:
        _budget(deadline)
        return {"state": "error", "data": None, "code": "service_unavailable", "message": "所属只读来源暂时不可用；其他已核验章节仍可查看"}
    _budget(deadline)
    return {"state": "ready", "data": data}


def _pending(message):
    return {"state": "unavailable", "data": None, "reasonCode": "dependency_pending", "message": message}


def _encode_response(payload):
    return json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")


def _series_capability(identifier, series):
    columns = {column["key"]: index for index, column in enumerate(series["columnDefinitions"])}
    selected = [columns["payment"]] if identifier == "platform_trend" else [columns["visitors"]] if identifier == "traffic_trend" else list(columns.values())
    cells = [point["cells"][index] for point in series["series"]["current"] for index in selected]
    allowed = {"available", "partial"} if identifier == "platform_day_detail" else {"available"}
    available = any(cell[1] in allowed for cell in cells)
    reasons = [cell[2] for cell in cells if cell[2] is not None]
    no_rows = all(series["pointCoverage"][point["coverageRef"]]["rows"] == 0 for point in series["series"]["current"])
    reason = "no_records" if no_rows or not reasons or all(value == "no_records" for value in reasons) else next((value for value in ("missing_field", "missing_day", "incomplete_coverage") if value in reasons), reasons[0])
    return available, reason


def _capability(identifier, metric=None, *, reason="dependency_pending", message="所属来源能力尚未验收或接线", available=False):
    if metric is not None:
        available = metric.get("status") == "available"
        reason = metric.get("reasonCode") or "incomplete_coverage"
    return {"id": identifier, "status": "available" if available else "unavailable", "reasonCode": None if available else reason, "message": message}


def _sections(sources, context):
    """Capability projection only; amounts, ratios and contributions stay owned."""
    product = sources["products"]["data"] if sources["products"]["state"] == "ready" else None
    promotion = sources["promotion"]["data"] if sources["promotion"]["state"] == "ready" else None
    series = sources["productSeries"]["data"] if sources["productSeries"]["state"] == "ready" else None
    workflow = sources["workflow"]["data"] if sources["workflow"]["state"] == "ready" else None
    p = product["sections"] if product else {}
    a = promotion["sections"] if promotion else {}
    summary = p.get("summary", {})
    extras = p.get("efficiency", {}).get("metrics", {})
    result = {}
    product_metrics = {
        "platform_payment": "payment", "platform_quantity": "quantity", "platform_refund": "refundPayment",
        "visitors": "visitors", "customers": "customers", "conversion": "conversion",
    }
    extra_metrics = {
        "page_views": "pageViews", "favorites": "favorites", "add_cart_customers": "addCartCustomers", "add_cart_quantity": "addCartQuantity",
        "order_customers": "orderCustomers", "order_quantity": "orderQuantity", "order_payment": "orderPayment",
        "transaction_orders": "transactionOrders", "search_impressions": "searchImpressions", "search_clicks": "searchClicks",
        "search_click_rate": "searchClickRate", "search_visitors": "searchVisitors", "search_customers": "searchCustomers",
    }
    promotion_metrics = {"spend": "spend", "attributed_payment": "attributedPayment", "roas": "roas", "cpc": "cpc", "spend_rate": "spendRate"}
    for section in SECTION_KEYS:
        states = [sources[key]["state"] for key in SECTION_SOURCES[section]]
        state = "ready" if all(s == "ready" for s in states) else "partial" if "ready" in states else "error" if "error" in states else "unavailable"
        capabilities = []
        for identifier in CAPABILITY_IDS[section]:
            metric, available, reason = None, False, "dependency_pending"
            message = "所属来源能力尚未验收或接线"
            if identifier in product_metrics and product:
                metric = summary.get(product_metrics[identifier])
                message = "复用商品所属服务的同店同维度完整范围指标，非店铺去重人数"
            elif identifier in extra_metrics and product:
                metric = extras.get(extra_metrics[identifier])
                message = "复用商品所属服务的字段存在性与完整范围口径"
            elif identifier == "visitor_value" and product:
                metric = p.get("efficiency", {}).get("visitorValue")
                message = "商品累计访客价值，保留所属整数分/次数，非去重UV价值"
            elif identifier in {"product_changes", "growth_decline"} and product:
                compared = p.get("comparisons", {}).get("payment", {}).get("previous", {})
                available = p.get("growth", {}).get("state") == "ready" and compared.get("status") == "available"
                reason = compared.get("reasonCode") or "incomplete_baseline"
                message = "复用商品完整集合跨期配对贡献；缺基期不推算新增或下降"
            elif identifier == "traded_products" and product:
                metric = p.get("counts", {}).get("tradedProducts")
                message = "来源中成交商品数，不冒充全店在售全集"
            elif identifier == "category_contribution" and product:
                metric = summary.get("payment")
                message = "来源类目标签贡献；尚非官方版本化类目字典"
            elif identifier == "top_concentration" and product:
                shares = [p.get("structure", {}).get(k, {}) for k in ("top5Share", "top10Share")]
                available = all(m.get("status") == "available" for m in shares)
                reason = next((m.get("reasonCode") for m in shares if m.get("reasonCode")), "unverified_source")
                message = "复用所属服务完整集合TOP5/10集中度"
            elif identifier == "product_detail" and product:
                observed = p.get("counts", {}).get("dataProducts", {})
                available = observed.get("status") == "available" and (observed.get("value") or 0) > 0
                reason = observed.get("reasonCode") or "no_records"
                message = "按精确平台、店铺、维度、商品ID进入所属详情"
            elif section == "promotion" and promotion:
                if identifier == "promotion_detail":
                    rows = a.get("items", [])
                    available = any(row.get("drillable") is True and row.get("id") is not None and row.get("objectKind") == "product" for row in rows)
                    reason = "no_records" if not rows else "missing_field" if all(row.get("id") is None for row in rows) else "unverified_source"
                    message = "所属服务提供可靠精确身份后才开放推广对象详情；同店推广专题可独立进入"
                elif identifier in promotion_metrics:
                    metric = a.get("summary", {}).get(promotion_metrics[identifier])
                else:
                    metric = a.get("summary", {}).get("spend")
                if identifier != "promotion_detail":
                    message = "复用推广独立信封；京东SKU或天猫SPU分母、覆盖和归因定义保持"
            elif section == "dataQuality" and identifier in {"coverage", "field_availability", "source_freshness"} and "ready" in states:
                available = True
                message = "各所属信封分别保留店日缺口、字段状态与实际截止日"
            elif identifier == "comparability" and product:
                compared = p.get("comparisons", {}).get("payment", {}).get("previous", {})
                available = compared.get("status") == "available"
                reason = compared.get("reasonCode") or "incomplete_baseline"
                message = "两期可比较性保留商品所属服务结果；跨域金额不自动对账"
            elif identifier in {"inventory", "mapping"}:
                reason = "unverified_source"
                message = "当前档案/库存及历史映射须按精确商品读取各自快照，不套用到历史事实"
            elif identifier in {"unique_customers", "repeat_purchase", "b2b_share"}:
                reason = "unverified_source"
                message = "缺稳定匿名客户历史或企业购子集关系证明，不能推算去重、复购或B端占比"
            elif identifier in {"stay_time", "bounce_rate", "new_old_buyers"}:
                reason = "unverified_source"
                message = ("天猫导入适配器允许保存可选JSON字段；本范围字段存在性和所属聚合尚未核验"
                           if context["effectiveScope"]["platforms"] == ["天猫"]
                           else "本范围尚无已核验的所属字段投影或聚合证据")
            elif identifier in {"platform_trend", "platform_day_detail", "traffic_trend"} and series:
                available, reason = _series_capability(identifier, series)
                message = "复用所属全店三期序列；按固定列/字段覆盖解码，不从商品页求和"
            elif identifier == "events" and workflow:
                available = bool(workflow["items"])
                reason = "no_records"
                message = "既有经营记录的发生时间与原类型/状态；仅该页，不推断因果"
            if "ready" not in states:
                metric, available = None, False
                reason = "dependency_pending" if state == "unavailable" else "unverified_source"
            capabilities.append(_capability(identifier, metric, available=available, reason=reason, message=message))
        result[section] = {"state": state, "sources": SECTION_SOURCES[section], "capabilities": capabilities}
    return result


def read_store_panorama(principal, params: QueryDict):
    deadline = time.monotonic() + READER_SECONDS
    with connection.execute_wrapper(_sql_fence(deadline)):
        actor = actor_fence(principal)
        _budget(deadline)
        spec, table, expected_token = _validate(params)
        context = read_context(principal, spec, deadline=deadline)
        sources = {
            "products": _read_source(lambda: _read_products(principal, _products_query(params, table), deadline), deadline),
            "productSeries": _read_source(lambda: _read_series(principal, params, table["grain"], deadline), deadline),
            "promotion": _read_source(lambda: _read_promotion(principal, _promotion_query(params, spec["platforms"][0], table["grain"]), deadline), deadline),
            "sales": _pending("精确店铺/渠道销售与毛利退货consumer尚待总控验收接线"),
            "finance": _pending("单店月财报及年度目标consumer尚待财务所属服务验收接线"),
            "workflow": _pending("精确店铺及事件发生期适配尚待验收接线；今日状态不是历史记录"),
        }
        if actor_fence(principal) != actor:
            raise NetshopApiError("全景取数期间账号权限版本变化", code="access_denied", status=403)
        _budget(deadline)
        contexts = [context]
        for source, dimension in (("products", spec["dimension"]), ("productSeries", spec["dimension"]), ("promotion", "sku" if spec["platforms"][0] == "京东" else "spu")):
            if sources[source]["state"] == "ready":
                owned = sources[source]["data"]["context"]
                _assert_context(owned, context, dimension=dimension)
                if source in {"products", "productSeries"} and owned["snapshotToken"] != context["snapshotToken"]:
                    raise NetshopApiError("商品信封不是全景同范围或版本", code="insights_revision_changed", status=409)
                contexts.append(owned)
        vector = _joined_vector(contexts)
        token = _canonical_token({"schemaVersion": SCHEMA_VERSION, "scopeKey": context["scopeKey"], "sourceRevisions": vector,
                                  "tableFilter": {"q": table["q"], "pageSize": table["pageSize"], "grain": table["grain"]}})
        if expected_token and expected_token != token:
            raise NetshopApiError("全景sectionToken不属于本次范围或来源版本", code="insights_revision_changed", status=409)
        payload = {
            "schemaVersion": SCHEMA_VERSION, "context": context, "sectionToken": token, "tableScope": table,
            "joinedSourceRevisions": vector, "consistency": "revision_vector_checked", "sources": sources,
            "sections": _sections(sources, context),
            "limitations": [
                "平台成交、ERP净销售、财报利润和广告归因分开呈现，不自动对账或推断因果",
                "商品访客与客户为商品×日累计；SKU/SPU不能相加，广告点击不推算访客",
                "所属来源按各自实际截止与覆盖展示，版本一致不表示存在跨域原子快照",
                "尚未接线的所属consumer不代表业务零值或无记录，不执行导入或工作流补跑",
            ],
        }
        for owned in contexts:
            _context_vector(owned, deadline)
        if actor_fence(principal) != actor:
            raise NetshopApiError("全景取数期间账号权限版本变化", code="access_denied", status=403)
        _budget(deadline)
        if len(_encode_response(payload)) > MAX_RESPONSE_BYTES:
            raise NetshopApiError("全景完整信封超过2MiB，请缩小范围", code="quality_incomplete", status=422)
        _budget(deadline)
        return payload
