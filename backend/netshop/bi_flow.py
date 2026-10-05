"""Complete shop/platform flow summaries with owning netshop metric rules."""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from django.db import connection
from teruisi_backend.read_budget import bounded_read

from django.http import QueryDict
from django.views.decorators.http import require_GET

from .errors import NetshopApiError
from .query import revision_value
from .sales_client import CONTROLLED_JD_ALIASES
from .store_overview import read, validate
from .views import _principal, _platforms, _json, _error


def _combined(bodies):
    additive = {"payment", "visitors", "customers", "spend", "promotionPayment"}
    results = {}
    for key in additive:
        source = [body["summary"][key] for body in bodies]
        ready = bool(source) and all(value["status"] == "available" for value in source)
        known = [value for value in source if value["status"] in {"available", "partial"} and value["value"] is not None]
        results[key] = {"value": sum(value["value"] for value in known) if known else None,
            "unit": source[0]["unit"] if source else "COUNT" if key in {"visitors", "customers"} else "CNY_CENT",
            "status": "available" if ready else "partial" if known else "unavailable", "reasonCode": None if ready else "incomplete_source"}
    for key, numerator, denominator in (("conversion", "customers", "visitors"), ("spendRate", "spend", "payment"), ("roas", "promotionPayment", "spend")):
        a, b = results[numerator]["value"], results[denominator]["value"]
        valid = a is not None and b is not None and b > 0 and results[numerator]["status"] == results[denominator]["status"] == "available" and (key != "roas" or len(bodies) == 1)
        results[key] = {"value": a / b if valid else None, "unit": "MULTIPLE" if key == "roas" else "RATIO",
            "status": "available" if valid else "unavailable", "reasonCode": None if valid else "mixed_attribution" if key == "roas" and len(bodies) > 1 else "incomplete_source"}
    return results


def projection(principal, params):
    if principal.scope is not None:
        raise NetshopApiError("流量驾驶舱仅支持未受限数据范围", code="access_denied", status=403)
    allowed = {"platform", "shop", "parentPlatform", "parentShop", "startDate", "endDate", "periodKind"}
    if set(params) - allowed or any(len(params.getlist(key)) != 1 for key in params):
        raise NetshopApiError("流量驾驶舱参数未知或重复")
    platform, shop_key = params.get("platform", ""), params.get("shop", "")
    parent_platform, parent_shop = params.get("parentPlatform", ""), params.get("parentShop", "")
    if platform not in {"", "京东", "天猫"}:
        raise NetshopApiError("流量平台必须为京东或天猫")
    chosen = [platform] if platform else ["京东", "天猫"]
    if parent_platform:
        if parent_platform not in {"京东", "天猫"}:
            return {"schemaVersion": "netshop-bi-flow-v1", "status": "unavailable", "reasonCode": "parent_platform_unmapped", "platforms": [], "shops": [], "summary": {}, "options": []}
        chosen = [value for value in chosen if value == parent_platform]
    bound = None
    if parent_shop:
        matches = [name for name, pair in CONTROLLED_JD_ALIASES.items() if parent_platform == "京东" and parent_shop == pair[0]]
        if len(matches) != 1:
            return {"schemaVersion": "netshop-bi-flow-v1", "status": "unavailable", "reasonCode": "erp_store_mapping_unverified", "platforms": [], "shops": [], "summary": {}, "options": []}
        bound = matches[0]
    if shop_key:
        try:
            pair = json.loads(shop_key)
            if not isinstance(pair, list) or len(pair) != 2:
                raise ValueError()
            key_platform, key_shop = pair
            if key_platform not in chosen or not isinstance(key_shop, str) or not key_shop or bound and bound != key_shop:
                raise ValueError()
        except (TypeError, ValueError) as error:
            raise NetshopApiError("店铺不属于流量父范围", code="access_denied", status=403) from error
        chosen = [key_platform]; bound = key_shop
    if not chosen:
        raise NetshopApiError("流量选择与父平台冲突", code="access_denied", status=403)
    deadline = time.monotonic() + 8
    def owning_platform(value):
        _platforms(principal, [value])
        query = QueryDict(mutable=True)
        query.update({"platform": value, "startDate": params.get("startDate", ""), "endDate": params.get("endDate", ""),
            "periodKind": params.get("periodKind", "custom"), "previous": "0", "yearAgo": "0"})
        if bound:
            query.appendlist("outlet", value + "\x1f" + bound)
        spec = validate(query)
        spec["biSummary"] = True
        with bounded_read(NetshopApiError, seconds=max(.001, deadline-time.monotonic())):
            body = read(principal, spec, deadline=deadline)
        if body["shopPagination"]["hasMore"] or len(body["shops"]) != body["shopPagination"]["total"]:
            raise NetshopApiError("流量完整店铺集合缺失", code="quality_incomplete", status=422)
        return body
    # Independent owning platform reads share one deadline; each thread has
    # its own Django connection, closed before it returns.
    def worker(value):
        try:
            return owning_platform(value)
        finally:
            connection.close()
    if len(chosen) == 1:
        bodies = [owning_platform(chosen[0])]
    else:
        with ThreadPoolExecutor(max_workers=2) as pool:
            pending = [pool.submit(worker, value) for value in chosen]
            bodies = [future.result(timeout=max(.001, deadline-time.monotonic())) for future in pending]
    return {"schemaVersion": "netshop-bi-flow-v1", "status": "ready", "reasonCode": None,
        "productDimension": "spu_daily",
        "periods": bodies[0]["periods"], "summary": _combined(bodies),
        "platforms": [{"platform": body["filters"]["platform"], "metrics": body["summary"], "comparisons": body["comparisons"], "shops": len(body["shops"])} for body in bodies],
        "shops": [{"platform": body["filters"]["platform"], **shop} for body in bodies for shop in body["shops"]],
        "options": [{"platform": body["filters"]["platform"], **shop} for body in bodies for shop in body["shopOptions"] if not parent_shop or shop.get("shopName") == bound],
        "sourceRevisions": {body["filters"]["platform"]: body["sourceRevisions"] for body in bodies},
        "coverage": {body["filters"]["platform"]: body["coverageBySource"] for body in bodies},
        "limitations": ["商品×日累计不是店铺去重访客；SKU/SPU各使用拥有方选定唯一数据集", "ERP店铺仅采用已有精确受控映射，未证实映射不按名字猜测或扩大流量范围", "跨平台归因定义不同，合并ROI不可用；各平台/店铺比率使用拥有方同日同店规则"]}


@require_GET
def view(request):
    try:
        principal = _principal(request)
        before = revision_value()
        result = projection(principal, request.GET)
        if revision_value() != before:
            raise NetshopApiError("流量来源在读取期间变化", code="revision_changed", status=409)
        return _json(result, revision=before)
    except Exception as error:
        return _error(error, "流量驾驶舱读取失败")
