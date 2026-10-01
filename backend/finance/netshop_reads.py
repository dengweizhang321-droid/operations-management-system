"""Bounded exact native-finance reads for S/C; no routes or permission changes.

Monthly and annual values are produced by their existing owners. Presence here
is a separate source annotation: the owner's legacy default zero is not proof.
"""
from __future__ import annotations

from contextlib import contextmanager
import inspect
import json
import math
import re
import time

from django.db import DatabaseError, connection, transaction
from django.db.models import Count, Q

from access_control.models import AppUser
from business_analysis.contracts import digest
from sales.auth import Principal
from . import analysis as monthly_owner
from .annual_progress import annual_progress
from .errors import FinanceApiError
from .models import FinanceDataRevision, FinanceImportBatch, FinanceLine, FinanceMonth

OPERATION = "netshop_finance_read_v1"
SCHEMA = "finance-netshop-read-v1"
MAX_SAFE = 9_007_199_254_740_991
REVISION_RE = re.compile(r"^(?:0|[1-9]\d*):[a-f0-9]{12}$")
AMOUNTS = {
    "grossSalesCents": "gross_sales", "returnAmountCents": "return_amount",
    "netSalesCents": "net_sales", "netCostCents": "net_cost", "grossProfitCents": "gross_profit",
    "sellingExpenseCents": "selling_expense_total", "smallProfitCents": "small_profit",
    "otherExpenseCents": "other_expense_total",
}
RATIOS = {
    "grossMarginBps": ("grossProfitCents", "netSalesCents"),
    "returnRateBps": ("returnAmountCents", "grossSalesCents"),
    "smallMarginBps": ("smallProfitCents", "netSalesCents"),
    "profitMarginBps": ("profitCents", "netSalesCents"),
    "promotionFeeRatioBps": ("promotionExpenseCents", "netSalesCents"),
}
METRICS = tuple(monthly_owner._empty_metrics())
BODY_FIELDS = {"operation", "shopKeys", "months", "year", "expiresAtEpochMs", "expectedRevision", "snapshotToken"}
SEMANTICS = {"monthlyBasis": "finance_month", "annualProgressBasis": "finance_year_progress",
             "targetBasis": "finance_year_target", "nativeRatioUnit": "BASIS_POINT",
             "netshopIdentityMapping": "unverified", "dailyAllocation": False, "distributedSnapshot": False}


def _safe_scalars(value):
    if type(value) is int and abs(value) > MAX_SAFE or type(value) is float and not math.isfinite(value):
        raise FinanceApiError("财报专题原生数值超过无损范围", code="unsafe_integer", status=422)
    if type(value) is dict:
        for child in value.values(): _safe_scalars(child)
    elif type(value) is list:
        for child in value: _safe_scalars(child)


def validate_netshop_read(payload):
    if type(payload) is not dict or set(payload) - BODY_FIELDS or not {"operation", "shopKeys", "months", "year"} <= set(payload):
        raise FinanceApiError("财报专题查询字段无效")
    if payload["operation"] != OPERATION:
        raise FinanceApiError("财报专题operation无效")
    keys, months = payload["shopKeys"], payload["months"]
    if type(keys) is not list or not 1 <= len(keys) <= 50 or len(set(str(k) for k in keys)) != len(keys):
        raise FinanceApiError("财报专题必须提供1—50个不重复原生店铺键")
    pairs = []
    for key in keys:
        if type(key) is not str or len(key) > 240:
            raise FinanceApiError("财报店铺键必须是原生JSON平台店铺二元组")
        try:
            value = json.loads(key)
        except (ValueError, TypeError) as error:
            raise FinanceApiError("财报店铺键无效") from error
        if type(value) is not list or len(value) != 2 or any(type(v) is not str or not v or v != v.strip()
                or len(v) > 100 or re.search(r"[\x00-\x1f\x7f]", v) for v in value):
            raise FinanceApiError("财报店铺身份须精确且有界")
        canonical = monthly_owner.finance_shop_key(*value)
        if key != canonical or not monthly_owner._selectable_shop(value[1]):
            raise FinanceApiError("财报店铺键须使用原生规范序列化")
        pairs.append(tuple(value))
    if type(months) is not list or not 1 <= len(months) <= 24 or any(type(v) is not str or not monthly_owner.MONTH_RE.fullmatch(v) for v in months) or len(set(months)) != len(months):
        raise FinanceApiError("财报专题须显式提供1—24个不重复自然月")
    year = payload["year"]
    if type(year) is not str or re.fullmatch(r"(?:19|20|21)\d{2}", year) is None:
        raise FinanceApiError("财报专题年度无效")
    result = {"operation": OPERATION, "shopKeys": sorted(keys), "months": sorted(months), "year": year}
    for key in ("expiresAtEpochMs", "expectedRevision", "snapshotToken"):
        if key in payload:
            value = payload[key]
            valid = type(value) is int and 0 <= value <= MAX_SAFE if key == "expiresAtEpochMs" else type(value) is str and bool((REVISION_RE if key == "expectedRevision" else re.compile(r"^[a-f0-9]{64}$")).fullmatch(value))
            if not valid:
                raise FinanceApiError("财报专题期限或版本无效")
            result[key] = value
    return result


def _check(deadline):
    if time.monotonic() >= deadline:
        raise FinanceApiError("财报专题共同读取期限已耗尽", code="source_not_ready", status=503)


def _deadline(spec, parent=None):
    if parent is not None and (type(parent) not in {int, float} or not math.isfinite(parent)
                               or type(parent) is int and abs(parent) > MAX_SAFE):
        raise FinanceApiError("内部财报读取期限无效")
    started = time.monotonic()
    end = min(started + 65, parent) if parent is not None else started + 65
    if "expiresAtEpochMs" in spec:
        end = min(end, started + (spec["expiresAtEpochMs"] / 1000 - time.time()))
    _check(end)
    return end


def _actor(principal):
    if principal.role not in {"viewer", "analyst", "operator", "admin"} or principal.scope is not None:
        raise FinanceApiError("财报专题仅允许原未受限身份", code="access_denied", status=403)
    row = AppUser.objects.filter(email=principal.email.strip().lower()).values("email", "role", "status", "scope", "version").first()
    if not row or row["status"] != "active" or row["role"] != principal.role or row["scope"] is not None:
        raise FinanceApiError("当前财报账号或权限版本不可用", code="access_denied", status=403)
    return row


def _revision():
    row = FinanceDataRevision.objects.filter(domain="finance").values("revision", "source_digest").first()
    if not row or type(row["revision"]) is not int or not 0 <= row["revision"] <= MAX_SAFE or not re.fullmatch(r"[a-f0-9]{64}", row["source_digest"]):
        raise FinanceApiError("财报拥有方版本未就绪", code="source_not_ready", status=503)
    return f'{row["revision"]}:{row["source_digest"][:12]}'


@contextmanager
def _sql_fence(deadline):
    if connection.vendor != "postgresql":
        raise FinanceApiError("财报专题须使用已授权PostgreSQL", code="source_not_ready", status=503)
    _check(deadline)
    def fence(execute, sql, params, many, context):
        statement = re.sub(r"\A(?:\s+|/\*[\s\S]*?\*/|--[^\n]*(?:\n|$))*", "", str(sql))
        read = re.match(r"(?:SELECT|WITH|SHOW|EXPLAIN)\b", statement, re.I) is not None
        if read: _check(deadline)
        value = execute(sql, params, many, context)
        if read: _check(deadline)
        return value
    with connection.execute_wrapper(fence):
        yield


def _pair_query(pairs):
    query = Q(pk__in=[])
    for platform, name in pairs:
        query |= Q(group_name__in=[platform, ""] if platform == "未分组" else [platform], scope_name=name)
    return query


def _presence(pairs, months):
    facts = FinanceLine.objects.filter(section="summary", scope_type="shop", month__in=months,
                                      metric_key__in=monthly_owner.METRIC_KEYS).filter(_pair_query(pairs))
    rows = facts.values("month", "group_name", "scope_name", "metric_key").annotate(
        rows=Count("id"), amountPresent=Count("amount_cents"), ratePresent=Count("rate_bps"))
    by_key = {(r["month"], r["group_name"] or "未分组", r["scope_name"], r["metric_key"]): r for r in rows}
    result = []
    for platform, name in pairs:
        for month in months:
            fields = {key: {
                "rows": int(by_key.get((month, platform, name, key), {}).get("rows", 0)),
                "amountPresent": int(by_key.get((month, platform, name, key), {}).get("amountPresent", 0)),
                "ratePresent": int(by_key.get((month, platform, name, key), {}).get("ratePresent", 0)),
            } for key in sorted(monthly_owner.METRIC_KEYS)}
            result.append({"shopKey": monthly_owner.finance_shop_key(platform, name), "month": month, "fields": fields})
    return result


def _month_metadata(months):
    values = {row["month"]: row for row in FinanceMonth.objects.filter(month__in=months).values("month", "batch_id", "status", "source_file_name")}
    batches = {row["id"]: row for row in FinanceImportBatch.objects.filter(id__in=[v["batch_id"] for v in values.values()]).values("id", "status", "months_json")}
    return [
        {"month": month, "status": values.get(month, {}).get("status", "absent"),
         "batchRef": values.get(month, {}).get("batch_id"),
         "metadataVerified": bool(values.get(month, {}).get("status") == "completed"
              and batches.get(values[month]["batch_id"], {}).get("status") == "completed"
              and month in (batches.get(values[month]["batch_id"], {}).get("months_json") or []))}
        for month in sorted(set(months))
    ]


def _metric_states(data, evidence, month_metadata, spec):
    selected = [row for row in evidence if row["month"] in spec["months"]]
    verified_months = {row["month"] for row in month_metadata if row["metadataVerified"]}
    completed_months = {row["month"] for row in month_metadata if row["status"] == "completed"}
    complete_scope = all(month in verified_months for month in spec["months"])
    def present(row, key):
        field = row["fields"][key]
        return field["rows"] > 0 and field["amountPresent"] == field["rows"]
    states = {}
    for key in METRICS:
        if key in AMOUNTS:
            valid = all(present(row, AMOUNTS[key]) for row in selected)
        elif key == "profitCents":
            direct = all(present(row, "profit") for row in selected)
            fallback = all(row["fields"]["profit"]["rows"] == 0 and present(row, "small_profit")
                           and present(row, "other_expense_total") for row in selected)
            valid = direct or fallback
        else:
            # Promotion invoices and derived rates need separate evidence;
            # defaults/owner-filled rate scalars are deliberately unverified.
            valid = False
        reason = None if data and complete_scope and valid else "missing_month" if any(month not in completed_months for month in spec["months"]) else "unverified_source" if not complete_scope else "missing_field" if data else "no_records"
        if data and key not in AMOUNTS and key != "profitCents":
            reason = "unverified_source"
        states[key] = {"value": data["current"][key] if reason is None else None,
                       "unit": "BASIS_POINT" if key.endswith("Bps") else "CNY_CENT",
                       "status": "available" if reason is None else "unavailable", "reasonCode": reason}
    return states


def read_netshop_finance(principal: Principal, payload, *, deadline=None, annual_provider=None):
    started = time.monotonic()
    spec = validate_netshop_read(payload)
    end = min(_deadline(spec, deadline), started + 65)
    _check(end)
    try:
        with transaction.atomic(), _sql_fence(end):
            actor = _actor(principal)
            revision = _revision()
            if spec.get("expectedRevision") not in {None, revision}:
                raise FinanceApiError("财报参与版本已变化", code="finance_netshop_revision_changed", status=409)
            pairs = [tuple(json.loads(key)) for key in spec["shopKeys"]]
            months = _month_metadata(spec["months"])
            actual_months = [row["month"] for row in months if row["status"] == "completed"]
            requested_evidence = _presence(pairs, spec["months"])
            known_pairs = [pair for pair in pairs if any(e["shopKey"] == monthly_owner.finance_shop_key(*pair)
                           and e["month"] in actual_months and any(f["rows"] for f in e["fields"].values()) for e in requested_evidence)]
            monthly = monthly_owner.get_finance_analysis(requested_months=actual_months,
                all_months=False, fallback_to_latest=False, shop_keys=[monthly_owner.finance_shop_key(*p) for p in known_pairs]) if actual_months and known_pairs else None
            # Preserve native comparison windows, while independently proving
            # their field presence. These are not the F daily comparison rules.
            related_months = sorted(set(spec["months"] + (
                monthly["previousMonths"] + monthly["yearAgoMonths"] + [r["month"] for r in monthly["timeline"]]
                if monthly else [])))
            related_metadata = _month_metadata(related_months)
            evidence = _presence(pairs, related_months)
            comparison_states = {}
            for kind, months_key in (("previous", "previousMonths"), ("yearAgo", "yearAgoMonths")):
                native_value = monthly[kind] if monthly else None
                comparison_states[kind] = _metric_states(
                    {"current": native_value} if native_value is not None else None,
                    evidence, related_metadata, {"months": monthly[months_key] if monthly else []})
            provider = annual_provider or annual_progress
            if "shop_pairs" not in inspect.signature(provider).parameters:
                annual = {"state": "dependency_pending", "reasonCode": "annual_exact_scope_provider_pending", "data": None}
            else:
                annual = {"state": "ready", "reasonCode": None,
                          "data": provider(spec["year"], 1, len(pairs), shop_pairs=pairs)}
            annual["rateFieldsVerification"] = {
                "grossMarginBps": "unverified_source",
                "promotionFeeRatioBps": "unverified_source",
            }
            scope = digest({"schema": SCHEMA, "request": {k: spec[k] for k in ("shopKeys", "months", "year")}, "actor": actor})
            snapshot = digest({"scope": scope, "revision": revision})
            if spec.get("snapshotToken") not in {None, snapshot}:
                raise FinanceApiError("财报专题范围或版本已变化", code="finance_netshop_revision_changed", status=409)
            result = {
                "schemaVersion": SCHEMA, "operation": OPERATION, "scopeKey": scope, "snapshotToken": snapshot,
                "requestedScope": {k: spec[k] for k in ("shopKeys", "months", "year")},
                "sourceRevisions": [{"domain": "finance", "kind": "owning_revision", "scopeKey": scope, "revision": revision}],
                "monthly": {"state": "ready" if monthly else "unavailable", "reasonCode": None if monthly else "no_scope_records",
                            "actualMonths": actual_months, "effectiveShopKeys": [monthly_owner.finance_shop_key(*p) for p in known_pairs],
                            "data": monthly, "monthEvidence": months, "fieldEvidence": evidence,
                            "comparisonMonthEvidence": related_metadata,
                            "currentMetricStates": _metric_states(monthly, evidence, months, spec),
                            "comparisonMetricStates": comparison_states},
                "annual": annual,
                "metricSemantics": SEMANTICS.copy(),
                "limitations": ["保留原完整monthly DTO及原月比较语义，不是F日范围金额；不按日线性摊月",
                    "原DTO默认0或shops省略不是真实0/本店不存在；仅额外字段状态可作已证实当前金额",
                    "JSON财务店铺键是拥有方身份；与网店采集店铺的映射仍unverified",
                    "年度目标仍全年配置，未制造月目标/日利润或事件因果；未验证字段明确unverified"],
            }
            _check(end)
            if _actor(principal) != actor:
                raise FinanceApiError("财报读取期间账号权限变化", code="access_denied", status=403)
            if _revision() != revision or _month_metadata(related_months) != related_metadata:
                raise FinanceApiError("财报读取期间参与版本变化", code="finance_netshop_revision_changed", status=409)
            # Count the actual existing consumer envelope, not just its data.
            _safe_scalars(result)
            encoded = json.dumps({"operation": OPERATION, "data": result}, ensure_ascii=False, allow_nan=False).encode("utf-8")
            _check(end)
            if len(encoded) > 2 * 1024 * 1024:
                raise FinanceApiError("财报专题响应超过2MiB", code="quality_incomplete", status=422)
            return result
    except DatabaseError as error:
        _check(end)
        raise FinanceApiError("财报专题来源或必要读取权限不可用", code="service_unavailable", status=503) from error
