"""Shared read-only semantics. No new fact store, writes, or reader grants.

The overview keeps its v1 DTO. Its calendar and source-field predicates are
reused explicitly rather than replacing that already accepted implementation.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from math import isfinite
import json
import time
import uuid

from django.db.models import Count, Max

from .errors import NetshopApiError
from .models import NetshopImportBatch, NetshopRow
from .query import _canonical_token, parse_outlets, revision_value
from .store_overview import NumericMetricPresent, days, grouped_dates, periods, source_versions

SCHEMA_VERSION = "netshop-insights-v1"
MAX_SAFE = 9_007_199_254_740_991
MAX_DAYS, MAX_SHOPS, MAX_IDENTITIES = 366, 50, 100
PERIOD_KINDS = {"today", "yesterday", "last7", "last15", "last30", "month", "quarter", "custom", "rolling", "all"}
PRODUCT_FIELDS = {
    "payment": ("transactionAmountCents", "成交金额"),
    "visitors": ("visitors", "商品访客数"),
    "customers": ("transactionCustomers", "成交客户数"),
    "quantity": ("transactionQuantity", "成交商品件数"),
    "addCartCustomers": ("addCartCustomers", "加购客户数"),
}
PROMOTION_FIELDS = {"spend": ("spendCents", "花费"), "attributedPayment": ("netTransactionAmountCents", "总订单金额")}
BASES = {"product_day_sum", "platform_attributed", "erp_net_sales", "erp_order_margin", "erp_large_margin", "finance_month", "current_snapshot", "unverified"}
REASONS = {"no_records", "missing_day", "missing_field", "not_applicable", "unmapped", "ambiguous_mapping", "zero_denominator", "negative_denominator", "incomplete_baseline", "negative_baseline", "unverified_source", "attribution_window_unknown", "unsafe_integer", "incomplete_coverage", "no_comparable_date", "promotion_not_ready", "promotion_mismatch"}


def validate_metric(metric):
    """Reject illegal four-state combinations; preserve explicit true zero."""
    if not isinstance(metric, dict):
        raise NetshopApiError("指标须为对象")
    unit, status, value = metric.get("unit"), metric.get("status"), metric.get("value")
    reason = metric.get("reasonCode")
    if unit not in {"CNY_CENT", "COUNT", "RATIO", "MULTIPLE", "SECONDS"} or status not in {"available", "partial", "unavailable", "invalid"}:
        raise NetshopApiError("指标单位或状态无效")
    if metric.get("basis") not in BASES or metric.get("aggregation") not in {"sum", "ratio_of_sums", "source_value_only"}:
        raise NetshopApiError("指标口径无效")
    if reason is not None and reason not in REASONS:
        raise NetshopApiError("指标原因码无效")
    sources = metric.get("sourceIds")
    if not isinstance(sources, list) or len(sources) > 50 or any(not isinstance(s, str) or not s.strip() or len(s) > 200 for s in sources) or len(set(sources)) != len(sources):
        raise NetshopApiError("指标来源引用无效")
    if status in {"available", "partial"}:
        if type(value) not in {int, float} or not isfinite(value) or unit in {"CNY_CENT", "COUNT"} and (type(value) is not int or abs(value) > MAX_SAFE):
            raise NetshopApiError("指标数值无效")
        if not metric.get("sourceIds") or metric["basis"] == "unverified":
            raise NetshopApiError("有值指标须有可信来源")
    elif value is not None:
        raise NetshopApiError("不可用指标不能携带数值")
    if status == "available" and reason is not None or status != "available" and reason is None:
        raise NetshopApiError("指标原因与状态不一致")
    if status == "partial" and (metric["aggregation"] != "sum" or unit in {"RATIO", "MULTIPLE"}):
        raise NetshopApiError("部分覆盖不能冒充整期比率")
    if not isinstance(metric.get("coverageRef"), str) or not metric["coverageRef"].strip() or len(metric["coverageRef"]) > 200:
        raise NetshopApiError("指标必须绑定覆盖")
    if "numerator" in metric or "denominator" in metric:
        numerator, denominator = metric.get("numerator"), metric.get("denominator")
        if any(v is not None and (type(v) not in {int, float} or not isfinite(v)) for v in (numerator, denominator)):
            raise NetshopApiError("比率输入无效")
        if metric["aggregation"] != "ratio_of_sums" or status == "available" and (type(numerator) not in {int, float} or type(denominator) not in {int, float} or not isfinite(numerator) or not isfinite(denominator) or denominator <= 0):
            raise NetshopApiError("比率分子分母与可用状态不一致")
        if status == "available":
            expected = numerator/denominator
            if not isfinite(expected) or abs(expected-value) > 1e-12*max(1, abs(expected), abs(value)):
                raise NetshopApiError("比率与已提供分子分母不一致")
    return metric


def compare_metrics(current, baseline):
    validate_metric(current); validate_metric(baseline)
    method = "percentage_points" if current["unit"] == "RATIO" else "relative_change"
    reason = "not_applicable" if current["unit"] != baseline["unit"] or current["basis"] != baseline["basis"] or sorted(current["sourceIds"]) != sorted(baseline["sourceIds"]) else "incomplete_baseline" if current["status"] != "available" or baseline["status"] != "available" else "zero_denominator" if method == "relative_change" and baseline["value"] == 0 else "negative_baseline" if method == "relative_change" and baseline["value"] < 0 else None
    value = None if reason else (current["value"]-baseline["value"])*100 if method == "percentage_points" else (current["value"]-baseline["value"])/baseline["value"]
    if value is not None and not isfinite(value):
        value, reason = None, "unsafe_integer"
    return {"value": value, "method": method, "status": "unavailable" if reason else "available", "reasonCode": reason}


def comparison_calendar(p):
    """Non-bijective month-end/leap dates remain null, never duplicate a day."""
    current = days(p["current"]["startDate"], p["current"]["endDate"])
    result = []
    candidates_by_kind = {k: days(p[k]["startDate"], p[k]["endDate"]) for k in ("previous", "yearAgo")}
    for i, day in enumerate(current):
        d = date.fromisoformat(day)
        row = {"date": day}
        for kind in ("previous", "yearAgo"):
            candidates = candidates_by_kind[kind]
            calendar = kind == "yearAgo" or p["rule"] in {"上一完整自然月", "上月对应日期，月末收敛"}
            if calendar:
                y, m = (d.year-1, d.month) if kind == "yearAgo" else ((d.year-1, 12) if d.month == 1 else (d.year, d.month-1))
                target = date(y, m, d.day).isoformat() if d.day <= monthrange(y, m)[1] else None
            else:
                target = candidates[i] if i < len(candidates) else None
            row[kind] = target if target in candidates else None
        result.append(row)
    return result


def period_groups(start, end, grain):
    selected = days(start, end)
    if grain == "seven_days":
        return [selected[i:i+7] for i in range(0, len(selected), 7)]
    if grain not in {"day", "week", "month"}:
        raise NetshopApiError("日期粒度无效")
    return grouped_dates(selected, grain)


def parse_identities(values, dimension, platforms, outlets):
    """Exact (platform, shop, dimension, ID), not names or independent ranks."""
    if not values or len(values) > MAX_IDENTITIES:
        raise NetshopApiError("精确商品配对须提供1至100个identity")
    result, seen = [], set()
    allowed_shops = {(o["platform"], o["shopName"]) for o in outlets}
    for raw in values:
        try: value = json.loads(raw)
        except (ValueError, TypeError) as error: raise NetshopApiError("identity必须为四项JSON数组") from error
        if not isinstance(value, list) or len(value) != 4 or any(not isinstance(v, str) or not v or len(v) > 200 or any(ord(c) < 32 or ord(c) == 127 for c in v) for v in value):
            raise NetshopApiError("identity必须为平台/精确店铺/维度/ID")
        platform, name, kind, product = value
        if name != name.strip() or len(name) > 100:
            raise NetshopApiError("商品identity店铺须精确且不超过100字符")
        if kind != dimension or platform not in {"天猫", "京东"} or dimension == "sku" and platform != "京东" or platforms and platform not in platforms or allowed_shops and (platform, name) not in allowed_shops:
            raise NetshopApiError("商品identity不属于当前授权筛选范围", code="access_denied", status=403)
        key = tuple(value)
        if key in seen: raise NetshopApiError("identity不能重复")
        seen.add(key); result.append(key)
    return result


def coverage_for(platform, names, selected_dates, observed):
    missing = [{"shopKey": platform+"\x1f"+n, "dates": [d for d in selected_dates if (n, d) not in observed]} for n in names]
    expected = len(names)*len(selected_dates)
    covered = expected-sum(len(r["dates"]) for r in missing)
    return {"expectedShopDatePairs": expected, "coveredShopDatePairs": covered, "complete": expected > 0 and covered == expected, "missingByShop": [r for r in missing if r["dates"]], "truncated": False}


def validate_context(params):
    allowed = {"platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"}
    if set(params)-allowed or any(len(params.getlist(k)) != 1 for k in params if k not in {"platform", "outlet"}):
        raise NetshopApiError("共享请求包含未知或重复参数")
    platforms = params.getlist("platform")
    if not platforms or len(platforms) > 2 or len(set(platforms)) != len(platforms) or any(p not in {"天猫", "京东"} for p in platforms):
        raise NetshopApiError("共享请求须显式选择不重复平台")
    raw = params.getlist("outlet")
    if len(set(raw)) != len(raw): raise NetshopApiError("outlet不能重复")
    outlets = parse_outlets(raw, platforms)
    kind, dimension = params.get("periodKind", "custom"), params.get("dimension", "spu")
    if kind not in PERIOD_KINDS or dimension not in {"sku", "spu"}: raise NetshopApiError("共享日期意图或维度无效")
    if dimension == "sku" and "天猫" in platforms: raise NetshopApiError("天猫SKU日经营未接入", code="not_applicable", status=422)
    p = periods(params.get("startDate"), params.get("endDate"), kind)
    token = params.get("snapshotToken")
    if token is not None and (len(token) != 64 or any(c not in "0123456789abcdef" for c in token)):
        raise NetshopApiError("snapshotToken无效")
    return {"platforms": sorted(platforms), "outlets": outlets, "dimension": dimension, "kind": kind, "periods": p, "token": token}


def consistent_sources(read_versions, loader, attempts=2):
    """Vector equality only on each domain's typed key; no cross-token compare."""
    if attempts not in {1, 2}: raise NetshopApiError("版本重读预算无效")
    for _ in range(attempts):
        before = read_versions()
        payload = loader(before)
        if before == read_versions(): return payload, before
    raise NetshopApiError("参与来源版本持续变化，请重读", code="insights_revision_changed", status=409)


def require_supported_scope(principal):
    # Current signed scope is warehouses/channels/platforms. Netshop daily
    # facts have no validated ERP-channel/warehouse attribution; fail closed.
    if principal.scope is not None and (set(principal.scope) != {"platforms", "channels", "warehouses"} or principal.scope.get("channels") or principal.scope.get("warehouses")):
        raise NetshopApiError("共享网店读取尚不支持渠道或仓库限制范围", code="access_denied", status=403)


def actor_fence(principal):
    if principal.email == "local-admin@teruisi.local":
        if principal.role != "admin" or principal.scope is not None:
            raise NetshopApiError("保留边缘身份的角色或范围无效", code="access_denied", status=403)
        # This precise identity is accepted only after verify_principal at the
        # reader boundary. The existing Edge, not forwarded Host headers, owns
        # explicit local-access/build/loopback flags. No absent-user fallback.
        from django.conf import settings
        return {"email": principal.email, "role": "admin", "scope": None, "kind": "reserved_edge", "version": "netshop-insights-reserved-edge-v1", "deployment": {"environment": settings.DJANGO_ENVIRONMENT, "processRole": settings.DJANGO_PROCESS_ROLE, "debug": settings.DEBUG}}
    from access_control.models import AppUser
    actor = AppUser.objects.filter(email=principal.email.lower()).values("email", "role", "status", "scope", "version").first()
    if not actor or actor["status"] != "active" or actor["role"] != principal.role or actor["scope"] != principal.scope:
        raise NetshopApiError("当前账号或数据权限已变化", code="access_denied", status=403)
    return {**actor, "kind": "persisted_user"}


def context_versions(platform, names, revision):
    vector = source_versions(platform, names, revision)
    # Every effective shop/source member is explicit. The absence of a scope
    # revision is represented, not silently omitted from the advertised vector.
    for name in names:
        for source in ("product", "promotion"):
            vector.setdefault(source+":"+platform+"\x1f"+name, "absent")
    return vector


def read_context(principal, spec):
    actor = actor_fence(principal)
    require_supported_scope(principal)
    if principal.scope is not None and (not principal.scope["platforms"] or set(spec["platforms"])-set(principal.scope["platforms"])):
        raise NetshopApiError("共享平台超出权限", code="access_denied", status=403)
    deadline = time.monotonic()+65
    def load(before):
        effective, coverages, capabilities, freshness, sampled = [], {}, [], [], {}
        for platform in spec["platforms"]:
            names = [o["shopName"] for o in spec["outlets"] if o["platform"] == platform]
            if not spec["outlets"]:
                names = list(NetshopRow.objects.filter(platform=platform).exclude(shop_name="").values_list("shop_name", flat=True).distinct().order_by("shop_name")[:MAX_SHOPS+1])
            effective.extend(platform+"\x1f"+n for n in names)
            if len(effective) > MAX_SHOPS: raise NetshopApiError("授权店铺超过50家，请缩小范围", code="quality_incomplete", status=422)
            sampled[platform] = context_versions(platform, names, before)
            completed = NetshopImportBatch.objects.filter(status="completed", platform=platform).values("id")
            product = ("jd_sku_daily", spec["dimension"]+"_daily") if platform == "京东" else ("tmall_product_daily", "spu_daily")
            promotion = ("jd_promotion", "ad") if platform == "京东" else ("tmall_promotion", "promotion_daily")
            for source, dataset, fields in [(*product, PRODUCT_FIELDS), (*promotion, PROMOTION_FIELDS)]:
                base = NetshopRow.objects.filter(platform=platform, shop_name__in=names, source=source, dataset=dataset, last_import_batch_id__in=completed)
                ref = source+":"+dataset+":"+platform
                freshness.append({"sourceId": ref, "dataThrough": base.aggregate(day=Max("business_date"))["day"]})
                # Coverage of each actual comparison window, never union/max-day.
                for kind in ("current", "previous", "yearAgo"):
                    if time.monotonic() > deadline: raise NetshopApiError("共享来源读取超出预算", code="source_not_ready", status=503)
                    w = spec["periods"][kind]
                    rows = base.filter(business_date__gte=w["startDate"], business_date__lt=w["endExclusive"])
                    annotations = {"rows": Count("id"), **{k: Count("id", filter=NumericMetricPresent(aliases)) for k, aliases in fields.items()}}
                    observed = {(r["shop_name"], r["business_date"]): r for r in rows.values("shop_name", "business_date").annotate(**annotations)}
                    dates = days(w["startDate"], w["endDate"])
                    coverage_ref = ref+":"+kind
                    c = coverage_for(platform, names, dates, observed)
                    coverages[coverage_ref] = c
                    for key in fields:
                        valid = sum(r[key] == r["rows"] for r in observed.values())
                        capabilities.append({"sourceId": ref, "period": kind, "field": key, "coverageRef": coverage_ref, "presentShopDatePairs": valid, "status": "available" if c["complete"] and valid == c["expectedShopDatePairs"] else "unavailable", "reasonCode": None if c["complete"] and valid == c["expectedShopDatePairs"] else "missing_field" if valid < len(observed) else "missing_day" if observed else "no_records"})
        binding = {"schema": SCHEMA_VERSION, "principal": actor, "request": {k: v for k, v in spec.items() if k != "token"}, "effective": sorted(effective)}
        scope = _canonical_token(binding)
        vector = [{"domain": "netshop", "kind": "owning_revision", "scopeKey": scope, "revision": before}]
        for platform in spec["platforms"]:
            names = [k.split("\x1f")[1] for k in effective if k.startswith(platform+"\x1f")]
            vector.extend({"domain": "netshop", "kind": platform+":"+k, "scopeKey": scope, "revision": v} for k, v in sorted(sampled[platform].items()) if k != "netshop")
        token = _canonical_token({"scope": scope, "vector": vector})
        if spec["token"] and spec["token"] != token: raise NetshopApiError("共享范围版本已变化", code="insights_revision_changed", status=409)
        return {"schemaVersion": SCHEMA_VERSION, "requestId": str(uuid.uuid4()), "scopeKey": scope, "snapshotToken": token,
                "requestedScope": {"platforms": spec["platforms"], "shopKeys": [o["platform"]+"\x1f"+o["shopName"] for o in spec["outlets"]], "dimension": spec["dimension"], "periodKind": spec["kind"]},
                "effectiveScope": {"platforms": spec["platforms"], "shopKeys": sorted(effective), "dimension": spec["dimension"], "periodKind": spec["kind"]},
                "periods": spec["periods"], "calendar": comparison_calendar(spec["periods"]), "sourceRevisions": vector,
                "coverageBySource": coverages, "capabilities": capabilities, "freshness": freshness,
                "limitations": ["商品人数为商品×日累计；SKU/SPU不可相加", "字段能力不是映射、归因窗口或推广聚合一致性证明", "ERP/财报/库存须由所属consumer独立读取并验证修订向量"]}
    payload, _ = consistent_sources(revision_value, load)
    # Source vectors also have their own guards; global revision guards domain
    # writes, and this final comparison explicitly validates all vector members.
    expected = []
    for platform in spec["platforms"]:
        names = [k.split("\x1f")[1] for k in payload["effectiveScope"]["shopKeys"] if k.startswith(platform+"\x1f")]
        expected.extend({"domain": "netshop", "kind": platform+":"+k, "scopeKey": payload["scopeKey"], "revision": v} for k, v in sorted(context_versions(platform, names, payload["sourceRevisions"][0]["revision"]).items()) if k != "netshop")
    if expected != payload["sourceRevisions"][1:]: raise NetshopApiError("共享来源向量已变化", code="insights_revision_changed", status=409)
    if time.monotonic() > deadline: raise NetshopApiError("共享来源读取超出预算", code="source_not_ready", status=503)
    if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > 2*1024*1024:
        raise NetshopApiError("共享来源响应超过2MiB，请缩小范围", code="quality_incomplete", status=422)
    if actor_fence(principal) != actor:
        raise NetshopApiError("取数期间账号权限版本已变化", code="access_denied", status=403)
    return payload
