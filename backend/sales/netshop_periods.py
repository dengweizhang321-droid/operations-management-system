"""Owned, bounded ERP two-period facts. No legacy ranking/cost/identity rewrite.

The signed consumer boundary calls validate_netshop_periods/read_netshop_periods
directly, without the legacy summary cache. Raw identities are never aliases.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta
import hashlib
import json
import math
import re
import time

from django.db import connection, transaction
from django.db.models import Count, F, Func, JSONField, Q, Sum, TextField, Value
from django.db.models.functions import Coalesce, Length, NullIf, Trim

from .analysis import expressions
from .auth import Principal, ROLES
from .models import SalesDataRevision, SalesImportBatch, SalesOrderLine, UNCATEGORIZED
from .query import _apply_principal_scope, binary_order, SalesAccessError

OPERATION = "netshop_periods_v1"
SCHEMA = "netshop-sales-periods-v1"
MAX_BYTES = 2 * 1024 * 1024
MAX_SAFE = 9_007_199_254_740_991
IDENTITY_FIELDS = ("platform", "rawShopName", "rawChannel")
RAW_FIELDS = ("platform", "shop_name", "channel")
METRICS = tuple(expressions())
PAIR_RE = re.compile(r"^(0|[1-9]\d*):(0|[1-9]\d*)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
METRIC_METADATA = {
    "money": {"unit": "CNY_CENT", "basis": "persisted_sales_source_amounts"},
    "quantity": {"unit": "NATIVE_INTEGER_QUANTITY", "basis": "is_net_quantity_row_signed_source_quantity", "fractionalValues": "not_supported_by_owning_column"},
    "cost": {"basis": "persisted_typed_source_cost", "originalFieldPresence": "unknown", "historicalCostVerification": "unknown", "historicalMappingVerification": "unknown", "zeroCostVerification": "unknown", "verification": "unverified_source", "primaryMetricUse": "unavailable_or_partial"},
    "grossProfit": {"basis": "net_sales_minus_persisted_source_cost", "originalFieldPresence": "unknown", "historicalCostVerification": "unknown", "historicalMappingVerification": "unknown", "verification": "unverified_source", "primaryMetricUse": "unavailable_or_partial"},
    "reportedGrossProfit": {"basis": "persisted_gross_profit_may_be_write_chain_recomputed", "originalFieldPresence": "unknown", "historicalCostVerification": "unknown", "historicalMappingVerification": "unknown", "verification": "unverified_source", "primaryMetricUse": "unavailable_or_partial"},
}


class NetshopPeriodsError(ValueError):
    def __init__(self, message, *, code="invalid_sales_periods_request", status=400):
        super().__init__(message)
        self.code, self.status = code, status


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _digest(value):
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _text(value, maximum, *, empty=False):
    if type(value) is not str or len(value) > maximum or (not empty and not value.strip()) or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise NetshopPeriodsError("销售精确身份或查询文字无效")
    return value


def _window(value):
    if type(value) is not dict or set(value) != {"startDate", "endExclusive"}:
        raise NetshopPeriodsError("两期须分别提供完整左闭右开窗口")
    try:
        if any(type(value[key]) is not str or not DATE_RE.fullmatch(value[key]) for key in value):
            raise ValueError()
        start, end = date.fromisoformat(value["startDate"]), date.fromisoformat(value["endExclusive"])
        days = (end - start).days
        if not 1 <= days <= 366:
            raise ValueError()
    except ValueError as error:
        raise NetshopPeriodsError("每个独立销售窗口须为真实日期且1—366天") from error
    return {**value, "endDate": (end - timedelta(days=1)).isoformat(), "days": days}


def validate_netshop_periods(payload):
    required = {"operation", "current", "baseline"}
    allowed = required | {"rawOutlets", "categories", "q", "page", "pageSize", "expectedRevision", "snapshotToken", "expiresAtEpochMs", "seriesGrain", "seriesOutlets", "seriesPlatforms"}
    if type(payload) is not dict or set(payload) - allowed or required - set(payload) or payload["operation"] != OPERATION:
        raise NetshopPeriodsError("销售两期请求包含未知、缺少或错误字段")
    result = {"operation": OPERATION, "current": _window(payload["current"]), "baseline": _window(payload["baseline"])}
    outlets = payload.get("rawOutlets", [])
    if type(outlets) is not list or len(outlets) > 50:
        raise NetshopPeriodsError("精确销售来源身份最多50个")
    identities, seen = [], set()
    for item in outlets:
        if type(item) is not dict or set(item) != set(IDENTITY_FIELDS):
            raise NetshopPeriodsError("原始身份必须完整提供platform/rawShopName/rawChannel，未知渠道不能匹配全店")
        row = {key: _text(item[key], 200, empty=key == "rawShopName") for key in IDENTITY_FIELDS}
        key = tuple(row.values())
        if key in seen:
            raise NetshopPeriodsError("原始销售三元组不能重复")
        seen.add(key); identities.append(row)
    result["rawOutlets"] = sorted(identities, key=lambda item: tuple(item[key].encode() for key in IDENTITY_FIELDS))
    if "seriesPlatforms" in payload:
        platforms=payload["seriesPlatforms"]
        if "seriesOutlets" in payload or type(payload.get("seriesGrain"))is not str or payload["seriesGrain"] not in {"day","week","month"} or type(platforms)is not list or not 1<=len(platforms)<=2 or any(type(value)is not str or value not in {"京东","天猫"} for value in platforms) or len(set(platforms))!=len(platforms):
            raise NetshopPeriodsError("平台序列须给1—2个精确京东/天猫，与RAW图形对象互斥并配真实粒度")
        if identities and any(platform not in {row["platform"] for row in identities} for platform in platforms):
            raise NetshopPeriodsError("平台序列越出父显式RAW范围")
        result["seriesGrain"]=payload["seriesGrain"];result["seriesPlatforms"]=sorted(platforms,key=lambda item:item.encode())
    elif "seriesGrain" in payload or "seriesOutlets" in payload:
        if type(payload.get("seriesGrain")) is not str or payload["seriesGrain"] not in {"day", "week", "month"} or type(payload.get("seriesOutlets")) is not list or not 1 <= len(payload["seriesOutlets"]) <= 4:
            raise NetshopPeriodsError("图形序列须同时提供真实粒度及1—4个精确RAW对象")
        selected, selected_keys = [], set()
        for item in payload["seriesOutlets"]:
            if type(item) is not dict or set(item) != set(IDENTITY_FIELDS):
                raise NetshopPeriodsError("图形序列身份必须是完整RAW三元组")
            row = {key: _text(item[key], 200, empty=key == "rawShopName") for key in IDENTITY_FIELDS}
            key = tuple(row.values())
            if key in selected_keys or seen and key not in seen:
                raise NetshopPeriodsError("图形序列对象重复或越出显式完整请求范围")
            selected_keys.add(key); selected.append(row)
        result["seriesGrain"] = payload["seriesGrain"]
        result["seriesOutlets"] = sorted(selected, key=lambda item: tuple(item[key].encode() for key in IDENTITY_FIELDS))
    categories = payload.get("categories", [])
    if type(categories) is not list or len(categories) > 50:
        raise NetshopPeriodsError("来源类目标签最多50项")
    categories = [_text(item, 200) for item in categories]
    if len(set(categories)) != len(categories):
        raise NetshopPeriodsError("来源类目标签不能重复")
    result["categories"] = sorted(categories, key=lambda item: item.encode())
    result["q"] = _text(payload.get("q", ""), 120, empty=True).strip()
    for field, default, maximum in (("page", 1, 10000), ("pageSize", 20, 100)):
        value = payload.get(field, default)
        if type(value) is not int or not 1 <= value <= maximum:
            raise NetshopPeriodsError("销售候选分页超出范围")
        result[field] = value
    if "expiresAtEpochMs" in payload:
        expiry = payload["expiresAtEpochMs"]
        if type(expiry) is not int or not 0 <= expiry <= MAX_SAFE:
            raise NetshopPeriodsError("签名内部UTC截止必须是安全整数毫秒")
        result["expiresAtEpochMs"] = expiry
    for field in ("expectedRevision", "snapshotToken"):
        value = payload.get(field)
        if value is not None:
            valid = type(value) is str and (PAIR_RE.fullmatch(value) if field == "expectedRevision" else re.fullmatch(r"[a-f0-9]{64}", value))
            if not valid or field == "expectedRevision" and any(int(item) > MAX_SAFE for item in value.split(":")):
                raise NetshopPeriodsError("销售拥有方版本或范围token无效")
        result[field] = value
    return result


def _check(deadline):
    if time.monotonic() >= deadline:
        raise NetshopPeriodsError("销售两期完整读取超出期限", code="source_not_ready", status=503)


def _actor(principal):
    if principal.role not in ROLES:
        raise NetshopPeriodsError("当前角色无权读取销售数据", code="access_denied", status=403)
    if principal.email == "local-admin@teruisi.local":
        # Reuse F's exact signed-edge exception, never absent ordinary users.
        from netshop.insights_common import actor_fence
        try:
            return actor_fence(principal)
        except Exception as error:
            from netshop.errors import NetshopApiError
            if isinstance(error, NetshopApiError):
                raise NetshopPeriodsError(str(error), code=error.code, status=error.status) from error
            raise
    from access_control.models import AppUser
    actor = AppUser.objects.filter(email=principal.email.lower()).values("email", "role", "status", "scope", "version").first()
    if not actor or actor["status"] != "active" or actor["role"] != principal.role or actor["scope"] != principal.scope:
        raise NetshopPeriodsError("当前销售账号或授权范围已变化", code="access_denied", status=403)
    return actor


def _revision():
    rows = dict(SalesDataRevision.objects.filter(domain__in=("sales", "erp")).values_list("domain", "revision"))
    if set(rows) != {"sales", "erp"} or any(type(value) is not int or not 0 <= value <= MAX_SAFE for value in rows.values()):
        raise NetshopPeriodsError("销售/ERP拥有方版本未就绪", code="source_not_ready", status=503)
    return f'{rows["sales"]}:{rows["erp"]}'


def _timeout_ms(raw):
    match = re.fullmatch(r"(\d+)(ms|s|min|h|d)?", raw)
    if not match:
        raise NetshopPeriodsError("无法验证原单SQL期限", code="source_not_ready", status=503)
    return int(match[1]) * {None: 1, "ms": 1, "s": 1000, "min": 60000, "h": 3600000, "d": 86400000}[match[2]]


@contextmanager
def _sql_budget(deadline):
    if connection.vendor != "postgresql":
        raise NetshopPeriodsError("销售两期消费者只支持已授权PostgreSQL读取", code="source_not_ready", status=503)
    _check(deadline)
    with connection.cursor() as cursor:
        cursor.execute("SHOW statement_timeout"); previous = cursor.fetchone()[0]
    _check(deadline)
    configured = _timeout_ms(previous)
    ceiling = min(configured or 7000, 7000)

    def execute(executor, sql, params, many, context):
        _check(deadline)
        remaining = max(1, math.floor((deadline - time.monotonic()) * 1000))
        executor("SELECT set_config('statement_timeout', %s, true)", [str(min(ceiling, remaining))], False, context)
        value = executor(sql, params, many, context)
        _check(deadline)
        return value

    try:
        with transaction.atomic(), connection.execute_wrapper(execute):
            yield
    finally:
        # Restoring session configuration is cleanup, not another business read.
        if connection.in_atomic_block and not connection.needs_rollback:
            with connection.cursor() as cursor:
                cursor.execute("SELECT set_config('statement_timeout', %s, true)", [previous])


def _date_q(window):
    return Q(business_date__gte=window["startDate"], business_date__lt=window["endExclusive"])


def _exact_q(identity):
    platform, shop, channel = (identity[key] for key in IDENTITY_FIELDS)
    p, s, c = platform.strip(), shop.strip(), channel.strip()
    return Q(platform=platform, platform_key=p or UNCATEGORIZED, shop_name=shop, shop_key=s or c or p or UNCATEGORIZED, channel=channel, channel_key=c or UNCATEGORIZED)


def _safe(value):
    if value is None:
        return None
    integer = int(value)
    if value != integer or abs(integer) > MAX_SAFE:
        raise NetshopPeriodsError("销售指标超出无损整数范围", code="unsafe_integer", status=413)
    return integer


def _aggregates(filter_q=None):
    metrics = {key: Sum(value, filter=filter_q) for key, value in expressions().items()}
    trusted = Q(_order_len__gte=1, _order_len__lte=200, order_no=F("_order_trim")) & ~Q(order_no="") & ~Q(order_no__regex=r"[\x00-\x1f\x7f]")
    query = trusted if filter_q is None else filter_q & trusted
    identity = Func(*(F(key) for key in ("platform", "shop_name", "channel", "order_no")), function="jsonb_build_array", output_field=JSONField())
    return {**metrics, "rowCount": Count("id", filter=filter_q), "trustedOrderCount": Count(identity, distinct=True, filter=query), "orderNoRows": Count("id", filter=query)}


def _date_ranges(values):
    result = []
    for day in sorted(set(values)):
        text = day.isoformat()
        if result and (day - date.fromisoformat(result[-1]["endDate"])).days == 1:
            result[-1]["endDate"] = text
        else:
            result.append({"startDate": text, "endDate": text})
    return result


def _period(row, dates_seen, window):
    count = _safe(row["rowCount"])
    values = {key: _safe(row[key]) if count else None for key in METRICS}
    order_count, present = _safe(row["trustedOrderCount"]), _safe(row["orderNoRows"])
    missing = count - present
    reason = "no_records" if not count else "missing_order_no" if missing else "zero_denominator" if not order_count else None
    return {"values": values, "rowCount": count, "rowPresence": count > 0,
            "orders": {"basis": "ERP_order_no_only_within_exact_raw_source_identity", "trustedOrderCount": order_count if count else None,
                       "missingOrderNoRows": missing if count else None,
                       "netAmountPerOrder": {"unit": "CNY_CENT_PER_ORDER", "value": values["netSalesCents"] / order_count if reason is None else None,
                                             "numerator": values["netSalesCents"], "denominator": order_count if count else None,
                                             "status": "available" if reason is None else "unavailable", "reasonCode": reason}},
            "observations": {"basis": "imported_business_date_records", "requestedDays": window["days"], "observedDateCount": len(set(dates_seen)),
                             "observedDateRanges": _date_ranges(dates_seen), "completeness": "unknown",
                             "absenceMeaning": "无记录日期不能判为店日缺源、真实零或完整结算"}}


def read_netshop_periods(principal: Principal, request, *, deadline=None):
    started = time.monotonic()
    if deadline is not None and (type(deadline) not in {int, float} or not math.isfinite(deadline)):
        raise NetshopPeriodsError("内部销售读取期限无效")
    deadline = min(deadline, started + 65) if deadline is not None else started + 65
    _check(deadline)
    # Revalidate a normalized internal shape; never drop arbitrary nested keys.
    wire = dict(request)
    for key in ("current", "baseline"):
        if type(wire.get(key)) is dict:
            value = wire[key]
            if set(value) - {"startDate", "endExclusive", "endDate", "days"}:
                raise NetshopPeriodsError("销售窗口包含未知字段")
            plain = {name: value[name] for name in ("startDate", "endExclusive") if name in value}
            normalized = _window(plain)
            if any(value[name] != normalized[name] for name in ("endDate", "days") if name in value):
                raise NetshopPeriodsError("销售内部窗口与真实日期不一致")
            wire[key] = plain
    spec = validate_netshop_periods(wire)
    if "seriesPlatforms" in spec: spec["platformSeriesIntent"]={"grain":spec["seriesGrain"],"platformNames":spec["seriesPlatforms"]}
    elif "seriesGrain" in spec: spec["seriesIntent"] = {"grain":spec["seriesGrain"],"rawOutlets":spec["seriesOutlets"]}
    if "expiresAtEpochMs" in spec:
        remaining = (spec["expiresAtEpochMs"] - time.time() * 1000) / 1000
        deadline = min(deadline, time.monotonic() + remaining)
    _check(deadline)
    with _sql_budget(deadline):
        actor = _actor(principal); before = _revision()
        if spec["expectedRevision"] is not None and spec["expectedRevision"] != before:
            raise NetshopPeriodsError("销售/ERP拥有方版本已变化", code="sales_periods_revision_changed", status=409)
        scope = {key: spec[key] for key in ("current", "baseline", "rawOutlets", "categories")}
        if "seriesIntent" in spec: scope["seriesIntent"] = spec["seriesIntent"]
        if "platformSeriesIntent" in spec: scope["platformSeriesIntent"] = spec["platformSeriesIntent"]
        scope_key = _digest({"schema": SCHEMA, "scope": scope, "actor": actor})
        token = _digest({"schema": SCHEMA, "scopeKey": scope_key, "revision": before})
        if spec["snapshotToken"] is not None and spec["snapshotToken"] != token:
            raise NetshopPeriodsError("销售两期范围或授权版本已变化", code="sales_periods_revision_changed", status=409)
        try:
            base, mode = _apply_principal_scope(SalesOrderLine.objects.filter(is_business_row=True), principal)
        except SalesAccessError as error:
            raise NetshopPeriodsError(str(error), code="access_denied", status=403) from error
        if spec["rawOutlets"]:
            selected = Q(pk__in=[])
            for identity in spec["rawOutlets"]:
                selected |= _exact_q(identity)
            base = base.filter(selected)
        if spec["categories"]:
            base = base.filter(resolved_category__in=spec["categories"])
        base = base.filter(_date_q(spec["current"]) | _date_q(spec["baseline"])).annotate(_order_trim=Trim("order_no"), _order_len=Length("order_no"))
        coherent = base.annotate(
            _expected_platform=Coalesce(NullIf(Trim("platform"), Value("")), Value(UNCATEGORIZED), output_field=TextField()),
            _expected_channel=Coalesce(NullIf(Trim("channel"), Value("")), Value(UNCATEGORIZED), output_field=TextField()),
            _expected_shop=Coalesce(NullIf(Trim("shop_name"), Value("")), NullIf(Trim("channel"), Value("")), NullIf(Trim("platform"), Value("")), Value(UNCATEGORIZED), output_field=TextField()),
        )
        if coherent.exclude(platform_key=F("_expected_platform"), channel_key=F("_expected_channel"), shop_key=F("_expected_shop")).exists():
            raise NetshopPeriodsError("授权范围内RAW身份与销售投影键不一致", code="source_not_ready", status=503)
        totals = {}
        for kind in ("current", "baseline"):
            rows = base.filter(_date_q(spec[kind]))
            totals[kind] = _period(rows.aggregate(**_aggregates()), list(rows.values_list("business_date", flat=True).distinct()), spec[kind])
        candidates = base.values(*RAW_FIELDS).distinct()
        total = candidates.count()
        filtered = candidates
        if spec["q"]:
            filtered = filtered.filter(Q(platform__contains=spec["q"]) | Q(shop_name__contains=spec["q"]) | Q(channel__contains=spec["q"]))
        filtered_total = filtered.count()
        page, size = spec["page"], spec["pageSize"]
        selected = list(filtered.order_by(*(binary_order(field) for field in RAW_FIELDS))[(page-1)*size:page*size])
        identities = [{key: row[field] for key, field in zip(IDENTITY_FIELDS, RAW_FIELDS)} for row in selected]
        page_q = Q(pk__in=[])
        for identity in identities:
            page_q |= _exact_q(identity)
        page_base = base.filter(page_q)
        aggregates = {}
        for kind in ("current", "baseline"):
            for row in page_base.values(*RAW_FIELDS).annotate(**_aggregates(_date_q(spec[kind]))):
                aggregates.setdefault(tuple(row[field] for field in RAW_FIELDS), {})[kind] = row
        observed = {}
        for row in page_base.values(*RAW_FIELDS, "business_date").distinct():
            observed.setdefault(tuple(row[field] for field in RAW_FIELDS), []).append(row["business_date"])
        items = []
        for identity in identities:
            key = tuple(identity.values())
            paired = {}
            for kind in ("current", "baseline"):
                seen = [day for day in observed.get(key, []) if spec[kind]["startDate"] <= day.isoformat() < spec[kind]["endExclusive"]]
                paired[kind] = _period(aggregates[key][kind], seen, spec[kind])
            items.append({"identity": identity, "identityKey": json.dumps(list(key), ensure_ascii=False, separators=(",", ":")), **paired})
        batch = SalesImportBatch.objects.filter(status="completed", id__in=base.values("last_import_batch_id")).order_by("-completed_at", "-created_at", "id").values("id", "source", "completed_at", "row_count").first()
        result = {"schemaVersion": SCHEMA, "operation": OPERATION, "scopeKey": scope_key, "snapshotToken": token,
                  "requestedScope": scope, "scopeMode": mode, "periods": {kind: spec[kind] for kind in ("current", "baseline")},
                  "periodTotals": totals, "items": items,
                  "candidatePagination": {"collection": "authorized_two_period_union_before_search_pagination", "candidateCount": total,
                                          "filteredCount": filtered_total, "q": spec["q"], "page": page, "pageSize": size, "returned": len(items), "hasMore": page*size < filtered_total, "truncated": False},
                  "latestRelevantBatch": {"id": batch["id"], "source": batch["source"], "completedAt": batch["completed_at"], "rowCount": batch["row_count"]} if batch else None,
                  "sourceRevisions": [{"domain": "sales", "kind": "sales_erp_revision_pair", "scopeKey": scope_key, "revision": before}],
                  "metricMetadata": {name: dict(item) for name, item in METRIC_METADATA.items()},
                  "metricSemantics": {"date": "发货business_date，用户独立窗口不自动调整到cutoff", "netSalesCents": "原分摊金额有符号求和，含配件/补差价且已排除原is_business_row刷刷仓",
                                      "grossProfitCents": "原analysis.expressions净额减源成本，不扣fee", "reportedGrossProfitCents": "来源订单行原gross_profit_cents，独立列示不替代大毛利",
                                      "quantity": "NATIVE_INTEGER_QUANTITY：既有BigIntegerField及写入安全整数门禁；原is_net_quantity_row/源数量正负规则，不等同订单/行COUNT",
                                      "costCents": "原持久化typed成本有符号整数分；非空列不证明导入原字段presence、历史成本或历史商品映射。0可为原真零、豁免或SYSTEM_COST_UNRESOLVED，未做逐行历史验证",
                                      "orders": "仅可信ERP原order_no按精确来源三元组去重，不用online_order_no或source_line_key；均值不是支付客户客单价",
                                      "category": "resolved_category来源标签，非官方或历史分类ID"}}
        if "seriesIntent" in spec:
            from .netshop_period_series import read_period_series
            result["series"] = read_period_series(base, spec, scope_key, before, deadline=deadline)
        if "platformSeriesIntent" in spec:
            from .netshop_platform_series import read_platform_series
            result["platformSeries"]=read_platform_series(base,principal,spec,scope_key,before,deadline=deadline)
        raw = _canonical(result).encode()
        if len(raw) > MAX_BYTES:
            raise NetshopPeriodsError("销售两期完整响应超过2MiB，请缩小范围或分页", code="response_too_large", status=413)
        _check(deadline)
        if _actor(principal) != actor:
            raise NetshopPeriodsError("销售读取期间授权已变化", code="access_denied", status=403)
        if _revision() != before:
            raise NetshopPeriodsError("销售参与版本在读取期间变化", code="sales_periods_revision_changed", status=409)
        _check(deadline)
        return result
