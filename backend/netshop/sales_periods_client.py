"""Only the explicit ERP raw-source two-period contract, under one parent budget.

Canonical aliases remain the existing netshop owner resolver; this adapter does
not invent channels, accept P taxonomy labels or reinterpret ERP raw identities.
"""
from __future__ import annotations
import json
import math
import time

from sales.netshop_periods import OPERATION, SCHEMA, MAX_BYTES, PAIR_RE, MAX_SAFE, METRICS, NetshopPeriodsError, validate_netshop_periods
from .errors import NetshopApiError
from .sales_client import read_sales_consumer


def _check(deadline):
    if time.monotonic() >= deadline:
        raise NetshopApiError("跨域销售完整读取已超过共同期限", code="source_not_ready", status=503)


def read_sales_periods(principal, request, *, deadline=None, reader=None):
    """Internal caller supplies ERP-native cohorts, never P.category passthrough.

    The I-owned common RPC adapter adds optional ``deadline`` with min(8s,
    remaining); its legacy None path remains unchanged. UTC expiry is signed in
    this new body so transport time cannot grant the sales service a fresh 65s.
    """
    now = time.monotonic()
    if deadline is not None and (type(deadline) not in {int, float} or not math.isfinite(deadline)):
        raise NetshopApiError("跨域销售内部期限无效")
    deadline = min(deadline, now + 65) if deadline is not None else now + 65
    _check(deadline)
    if type(request) is not dict or "expiresAtEpochMs" in request:
        raise NetshopApiError("业务请求不能控制内部RPC截止")
    try:
        spec = validate_netshop_periods(request)
    except NetshopPeriodsError as error:
        raise NetshopApiError(str(error), code=error.code, status=error.status) from error
    wire = dict(request)
    # Always propagate one outer remaining allowance, not 65s per page/source.
    remaining = deadline - time.monotonic()
    _check(deadline)
    wire["expiresAtEpochMs"] = math.floor(time.time()*1000 + remaining*1000)
    data, revision = (reader or read_sales_consumer)(principal, wire, deadline=deadline)
    _check(deadline)
    if type(revision) is not str or not PAIR_RE.fullmatch(revision) or any(int(item)>MAX_SAFE for item in revision.split(":")):
        raise NetshopApiError("跨域销售响应头不是所属整数pair", code="invalid_sales_periods_contract", status=503)
    try:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    except (TypeError, ValueError) as error:
        raise NetshopApiError("跨域销售响应无法无损验证", code="invalid_sales_periods_contract", status=503) from error
    if len(raw) > MAX_BYTES:
        raise NetshopApiError("跨域销售完整响应超过2MiB", code="response_too_large", status=413)
    if type(data) is not dict or data.get("schemaVersion") != SCHEMA or data.get("operation") != OPERATION:
        raise NetshopApiError("跨域销售响应协议无效", code="invalid_sales_periods_contract", status=503)
    scope = data.get("requestedScope")
    if type(scope) is not dict or any(scope.get(key) != spec[key] for key in ("current", "baseline", "rawOutlets", "categories")):
        raise NetshopApiError("跨域销售响应范围不属于原请求", code="invalid_sales_periods_contract", status=503)
    vector = data.get("sourceRevisions")
    if type(vector) is not list or len(vector) != 1 or vector[0] != {"domain": "sales", "kind": "sales_erp_revision_pair", "scopeKey": data.get("scopeKey"), "revision": revision}:
        raise NetshopApiError("跨域销售必须复验完整所属pair向量", code="invalid_sales_periods_contract", status=503)
    if spec["expectedRevision"] is not None and spec["expectedRevision"] != revision or spec["snapshotToken"] is not None and spec["snapshotToken"] != data.get("snapshotToken"):
        raise NetshopApiError("跨域销售版本或范围已变化", code="sales_periods_revision_changed", status=409)
    page = data.get("candidatePagination", {})
    if type(page) is not dict or any(page.get(key) != spec[key] for key in ("q", "page", "pageSize")):
        raise NetshopApiError("跨域销售候选页属于其他请求", code="invalid_sales_periods_contract", status=503)
    required = {"schemaVersion","operation","scopeKey","snapshotToken","requestedScope","scopeMode","periods","periodTotals","items","candidatePagination","latestRelevantBatch","sourceRevisions","metricSemantics"}
    if set(data) != required or data.get("periods") != {kind:spec[kind] for kind in ("current","baseline")} or type(data.get("items")) is not list:
        raise NetshopApiError("跨域销售完整信封不完整", code="invalid_sales_periods_contract", status=503)
    def assert_period(value, kind):
        if type(value) is not dict or type(value.get("rowCount")) is not int or value["rowCount"]<0 or value.get("rowPresence") != (value["rowCount"]>0):
            raise NetshopApiError("跨域销售有行状态非法", code="invalid_sales_periods_contract", status=503)
        metrics=value.get("values")
        if type(metrics) is not dict or set(metrics)!=set(METRICS) or any((type(v)is not int or abs(v)>MAX_SAFE) if value["rowPresence"] else v is not None for v in metrics.values()):
            raise NetshopApiError("跨域销售金额/数量不能缺失或伪0", code="invalid_sales_periods_contract", status=503)
        orders=value.get("orders",{});observed=value.get("observations",{})
        if type(orders)is not dict or orders.get("basis")!="ERP_order_no_only_within_exact_raw_source_identity" or type(observed)is not dict or observed.get("completeness")!="unknown" or observed.get("requestedDays")!=spec[kind]["days"]:
            raise NetshopApiError("跨域销售订单或观察口径非法", code="invalid_sales_periods_contract", status=503)
    totals=data.get("periodTotals")
    if type(totals)is not dict or set(totals)!={"current","baseline"}:
        raise NetshopApiError("跨域销售两期汇总缺失", code="invalid_sales_periods_contract", status=503)
    for kind in ("current","baseline"):assert_period(totals[kind],kind)
    if page.get("collection")!="authorized_two_period_union_before_search_pagination" or page.get("truncated")is not False or page.get("returned")!=len(data["items"]):
        raise NetshopApiError("跨域销售完整候选页无效", code="invalid_sales_periods_contract", status=503)
    for item in data["items"]:
        if type(item)is not dict or set(item)!={"identity","identityKey","current","baseline"}:
            raise NetshopApiError("跨域销售候选缺少完整两期", code="invalid_sales_periods_contract", status=503)
        for kind in ("current","baseline"):assert_period(item[kind],kind)
    _check(deadline)
    return data, revision
