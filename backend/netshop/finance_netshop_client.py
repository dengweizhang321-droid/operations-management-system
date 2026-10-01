"""Fixed signed finance reader transport; no writer or caller-supplied URL."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from .errors import NetshopApiError

PATH = "/api/finance/consumers/query"
OPERATION = "netshop_finance_read_v1"
MAX_BYTES = 2 * 1024 * 1024
MAX_SAFE = 9_007_199_254_740_991
REVISION = re.compile(r"^(?:0|[1-9]\d*):[a-f0-9]{12}$")
METRICS = ("grossSalesCents", "returnAmountCents", "netSalesCents", "netCostCents", "grossProfitCents",
           "grossMarginBps", "returnRateBps", "sellingExpenseCents", "smallProfitCents", "smallMarginBps",
           "otherExpenseCents", "profitCents", "profitMarginBps", "promotionExpenseCents", "promotionFeeRatioBps")
SOURCE_FIELDS = {"gross_margin", "gross_profit", "gross_sales", "net_cost", "net_sales", "other_expense_total",
                 "profit", "profit_margin", "return_amount", "selling_expense_total", "small_margin", "small_profit"}


def validate_finance_request(value):
    allowed = {"operation", "shopKeys", "months", "year", "expiresAtEpochMs", "expectedRevision", "snapshotToken"}
    if type(value) is not dict or set(value) - allowed or not {"operation", "shopKeys", "months", "year"} <= set(value) or value["operation"] != OPERATION:
        raise NetshopApiError("财报专题固定请求无效")
    for field, maximum in (("shopKeys", 50), ("months", 24)):
        rows = value[field]
        if type(rows) is not list or not 1 <= len(rows) <= maximum or any(type(v) is not str for v in rows) or len(set(rows)) != len(rows):
            raise NetshopApiError("财报专题范围无效")
    for key in value["shopKeys"]:
        try:
            pair = json.loads(key)
        except ValueError as error:
            raise NetshopApiError("财报专题原生店铺键无效") from error
        if type(pair) is not list or len(pair) != 2 or any(type(v) is not str or not v or v != v.strip() or len(v) > 100
                or re.search(r"[\x00-\x1f\x7f]", v) for v in pair) or key != json.dumps(pair, ensure_ascii=False, separators=(",", ":")):
            raise NetshopApiError("财报专题身份必须是原生JSON二元组")
    if any(re.fullmatch(r"(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])", m) is None for m in value["months"]) or type(value["year"]) is not str or re.fullmatch(r"(?:19|20|21)\d{2}", value["year"]) is None:
        raise NetshopApiError("财报专题自然月/年度无效")
    for key in ("expectedRevision", "snapshotToken"):
        if key in value and (type(value[key]) is not str or not (REVISION if key == "expectedRevision" else re.compile(r"^[a-f0-9]{64}$")).fullmatch(value[key])):
            raise NetshopApiError("财报专题版本无效")
    if "expiresAtEpochMs" in value and (type(value["expiresAtEpochMs"]) is not int or not 0 <= value["expiresAtEpochMs"] <= MAX_SAFE):
        raise NetshopApiError("财报专题UTC期限无效")
    return {**value, "shopKeys": sorted(value["shopKeys"]), "months": sorted(value["months"])}


def _unavailable():
    return NetshopApiError("财务拥有方读取暂时不可用", code="service_unavailable", status=503)


def _assert_body(data, spec, revision):
    required = {"schemaVersion", "operation", "scopeKey", "snapshotToken", "requestedScope", "sourceRevisions",
                "monthly", "annual", "metricSemantics", "limitations"}
    if set(data) != required or any(type(data[k]) is not str or re.fullmatch(r"[a-f0-9]{64}", data[k]) is None for k in ("scopeKey", "snapshotToken")):
        raise _unavailable()
    if data["metricSemantics"] != {"monthlyBasis": "finance_month", "annualProgressBasis": "finance_year_progress",
            "targetBasis": "finance_year_target", "nativeRatioUnit": "BASIS_POINT",
            "netshopIdentityMapping": "unverified", "dailyAllocation": False, "distributedSnapshot": False}:
        raise _unavailable()
    if any(type(data["metricSemantics"][k]) is not bool for k in ("dailyAllocation", "distributedSnapshot")):
        raise _unavailable()
    monthly = data["monthly"]
    if type(monthly) is not dict or set(monthly) != {"state", "reasonCode", "actualMonths", "effectiveShopKeys", "data",
            "monthEvidence", "fieldEvidence", "comparisonMonthEvidence", "currentMetricStates", "comparisonMetricStates"}:
        raise _unavailable()
    for key, expected in (("actualMonths", spec["months"]), ("effectiveShopKeys", spec["shopKeys"])):
        if type(monthly[key]) is not list or len(set(str(v) for v in monthly[key])) != len(monthly[key]) or any(type(v) is not str or v not in expected for v in monthly[key]):
            raise _unavailable()
    for key in ("monthEvidence", "comparisonMonthEvidence"):
        values = monthly[key]
        if type(values) is not list or len(values) > 120:
            raise _unavailable()
        seen = set()
        for value in values:
            if type(value) is not dict or set(value) != {"month", "status", "batchRef", "metadataVerified"} or type(value["month"]) is not str or not re.fullmatch(r"(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])", value["month"]) or value["month"] in seen or type(value["metadataVerified"]) is not bool or type(value["status"]) is not str or value["status"] not in {"completed", "processing", "absent", "failed"} or value["batchRef"] is not None and type(value["batchRef"]) is not str or value["metadataVerified"] and (value["status"] != "completed" or not value["batchRef"]):
                raise _unavailable()
            seen.add(value["month"])
        if key == "monthEvidence" and sorted(seen) != spec["months"]:
            raise _unavailable()
    available = [r["month"] for r in monthly["monthEvidence"] if r["status"] == "completed"]
    if monthly["actualMonths"] != available:
        raise _unavailable()
    comparison_months = {r["month"] for r in monthly["comparisonMonthEvidence"]}
    fields = monthly["fieldEvidence"]
    if type(fields) is not list or len(fields) != len(spec["shopKeys"]) * len(comparison_months):
        raise _unavailable()
    seen = set()
    for row in fields:
        if type(row) is not dict or set(row) != {"shopKey", "month", "fields"} or type(row["shopKey"]) is not str or row["shopKey"] not in spec["shopKeys"] or type(row["month"]) is not str or row["month"] not in comparison_months:
            raise _unavailable()
        identity = (row["shopKey"], row["month"])
        if identity in seen or type(row["fields"]) is not dict or set(row["fields"]) != SOURCE_FIELDS:
            raise _unavailable()
        seen.add(identity)
        for field in row["fields"].values():
            if type(field) is not dict or set(field) != {"rows", "amountPresent", "ratePresent"} or any(type(v) is not int or not 0 <= v <= MAX_SAFE for v in field.values()) or field["amountPresent"] > field["rows"] or field["ratePresent"] > field["rows"]:
                raise _unavailable()
    known = [key for key in spec["shopKeys"] if any(r["shopKey"] == key and r["month"] in available
             and any(f["rows"] for f in r["fields"].values()) for r in fields)]
    if monthly["effectiveShopKeys"] != known:
        raise _unavailable()
    if type(monthly["currentMetricStates"]) is not dict or set(monthly["currentMetricStates"]) != set(METRICS):
        raise _unavailable()
    for key, state in monthly["currentMetricStates"].items():
        if type(state) is not dict or set(state) != {"value", "unit", "status", "reasonCode"} or state["unit"] != ("BASIS_POINT" if key.endswith("Bps") else "CNY_CENT"):
            raise _unavailable()
        if state["status"] == "available":
            if state["reasonCode"] is not None or type(state["value"]) is not int or abs(state["value"]) > MAX_SAFE:
                raise _unavailable()
        elif state["status"] != "unavailable" or state["value"] is not None or state["reasonCode"] not in {"missing_month", "unverified_source", "missing_field", "no_records"}:
            raise _unavailable()
    native = monthly["data"]
    if monthly["state"] == "ready":
        if not monthly["actualMonths"] or not monthly["effectiveShopKeys"] or type(native) is not dict or native.get("hasData") is not True or native.get("selectedMonths") != monthly["actualMonths"] or native.get("selection", {}).get("shops") != monthly["effectiveShopKeys"]:
            raise _unavailable()
        current = native.get("current")
        if type(current) is not dict or set(current) != set(METRICS) or any(type(v) is not int or abs(v) > MAX_SAFE for v in current.values()):
            raise _unavailable()
        for key in METRICS:
            if key.endswith("Bps") or key == "promotionExpenseCents":
                if monthly["currentMetricStates"][key]["status"] != "unavailable" or monthly["currentMetricStates"][key]["reasonCode"] != "unverified_source":
                    raise _unavailable()
    elif monthly["state"] != "unavailable" or native is not None or monthly["reasonCode"] != "no_scope_records":
        raise _unavailable()
    annual = data["annual"]
    if type(annual) is not dict or set(annual) != {"state", "reasonCode", "data", "rateFieldsVerification"}:
        raise _unavailable()
    if annual["state"] == "ready":
        rows = annual["data"]
        if type(rows) is not dict or rows.get("year") != spec["year"] or type(rows.get("items")) is not list or len(rows["items"]) > len(spec["shopKeys"]):
            raise _unavailable()
        keys = [row.get("key") for row in rows["items"] if type(row) is dict]
        if len(keys) != len(rows["items"]) or len(set(str(v) for v in keys)) != len(keys) or any(v not in spec["shopKeys"] for v in keys):
            raise _unavailable()
    elif annual["state"] != "dependency_pending" or annual["data"] is not None or annual["reasonCode"] != "annual_exact_scope_provider_pending":
        raise _unavailable()
    if data["sourceRevisions"] != [{"domain": "finance", "kind": "owning_revision", "scopeKey": data["scopeKey"], "revision": revision}]:
        raise _unavailable()


def read_finance_netshop(principal, payload, *, deadline=None):
    started = time.monotonic()
    if deadline is not None and (type(deadline) not in {int, float} or not math.isfinite(deadline)
                                 or type(deadline) is int and abs(deadline) > MAX_SAFE):
        raise NetshopApiError("内部财报读取期限无效")
    end = min(started + 65, deadline) if deadline is not None else started + 65
    spec = validate_finance_request(payload)
    if "expiresAtEpochMs" in spec:
        end = min(end, started + (spec["expiresAtEpochMs"] / 1000 - time.time()))
    def check():
        if time.monotonic() >= end:
            raise NetshopApiError("财报读取共同期限已耗尽", code="source_not_ready", status=503)
    check()
    spec["expiresAtEpochMs"] = math.floor((time.time() + end - time.monotonic()) * 1000)
    base = os.getenv("TERUISI_DJANGO_FINANCE_READER_BASE_URL", "").strip()
    url = urllib.parse.urlsplit(base)
    if not base or url.scheme not in {"http", "https"} or not url.netloc or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"} or url.scheme == "http" and (url.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}:
        raise _unavailable()
    secret = os.getenv("TERUISI_DJANGO_INTERNAL_SECRET", "")
    if len(secret.encode()) < 32:
        raise _unavailable()
    body = json.dumps(spec, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(body) > 64 * 1024:
        raise NetshopApiError("财报专题请求超过64KiB", code="payload_too_large", status=413)
    body_digest = hashlib.sha256(body).hexdigest()
    actor = json.dumps({"email": principal.email, "displayName": principal.display_name,
                        "role": principal.role, "scope": principal.scope}, ensure_ascii=False, separators=(",", ":")).encode()
    envelope = base64.urlsafe_b64encode(actor).rstrip(b"=").decode("ascii")
    timestamp, request_id = str(int(time.time())), str(uuid.uuid4())
    signed = "\n".join(["v1", timestamp, request_id, "POST", PATH, "", body_digest, envelope])
    signature = hmac.new(secret.encode(), signed.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(base.rstrip("/") + PATH, data=body, method="POST", headers={
        "Content-Type": "application/json; charset=utf-8", "Accept": "application/json",
        "X-Teruisi-Principal": envelope, "X-Teruisi-Timestamp": timestamp, "X-Teruisi-Request-Id": request_id,
        "X-Teruisi-Content-SHA256": body_digest, "X-Teruisi-Signature": "v1=" + signature,
    })
    check()
    try:
        with urllib.request.urlopen(request, timeout=end - time.monotonic()) as response:
            check()
            if response.status != 200 or not re.match(r"^application/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)", response.headers.get("Content-Type", ""), re.I):
                raise _unavailable()
            declared = response.headers.get("Content-Length")
            if declared and (not declared.isdecimal() or int(declared) > MAX_BYTES):
                raise _unavailable()
            revision = response.headers.get("X-Finance-Data-Revision", "")
            if not REVISION.fullmatch(revision):
                raise _unavailable()
            raw = response.read(MAX_BYTES + 1)
            check()
            if len(raw) > MAX_BYTES: raise _unavailable()
    except urllib.error.HTTPError as error:
        if error.code in {401, 403}:
            raise NetshopApiError("当前账号无权读取财报专题", code="access_denied", status=error.code) from None
        if error.code == 409:
            raise NetshopApiError("财报参与版本已变化", code="insights_revision_changed", status=409) from None
        if error.code == 422:
            raise NetshopApiError("财报专题质量或容量不满足", code="quality_incomplete", status=422) from None
        raise _unavailable() from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        check()
        raise _unavailable() from error
    try:
        def duplicate_safe(pairs):
            result = {}
            for key, value in pairs:
                if key in result: raise ValueError("duplicate key")
                result[key] = value
            return result
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=duplicate_safe,
            parse_constant=lambda _v: (_ for _ in ()).throw(ValueError("non-finite")))
        data = value.get("data")
        scope = {k: spec[k] for k in ("shopKeys", "months", "year")}
        if value.get("operation") != OPERATION or type(data) is not dict or data.get("schemaVersion") != "finance-netshop-read-v1" or data.get("operation") != OPERATION or data.get("requestedScope") != scope:
            raise _unavailable()
        if data.get("sourceRevisions") != [{"domain": "finance", "kind": "owning_revision", "scopeKey": data.get("scopeKey"), "revision": revision}]:
            raise _unavailable()
        _assert_body(data, spec, revision)
        if spec.get("expectedRevision") not in {None, revision} or spec.get("snapshotToken") not in {None, data.get("snapshotToken")}:
            raise NetshopApiError("财报专题拥有方范围或版本变化", code="insights_revision_changed", status=409)
    except (ValueError, UnicodeDecodeError, AttributeError, TypeError) as error:
        raise _unavailable() from error
    check()
    return data, revision
