"""Only the explicit ERP raw-source two-period contract, under one parent budget.

Canonical aliases remain the existing netshop owner resolver; this adapter does
not invent channels, accept P taxonomy labels or reinterpret ERP raw identities.
"""
from __future__ import annotations
from datetime import date, timedelta
import json
import math
import time

from sales.netshop_periods import OPERATION, SCHEMA, MAX_BYTES, PAIR_RE, DATE_RE, MAX_SAFE, METRICS, METRIC_METADATA, NetshopPeriodsError, validate_netshop_periods
from .errors import NetshopApiError
from .sales_client import read_sales_consumer


def _check(deadline):
    if time.monotonic() >= deadline:
        raise NetshopApiError("跨域销售完整读取已超过共同期限", code="source_not_ready", status=503)


def _invalid(message):
    raise NetshopApiError(message, code="invalid_sales_periods_contract", status=503)


def _object(value, fields):
    if type(value) is not dict or set(value) != set(fields):
        _invalid("跨域销售嵌套对象字段缺失、未知或类型非法")
    return value


def _integer(value, minimum=0, maximum=MAX_SAFE):
    return type(value) is int and minimum <= value <= maximum


def _text(value, maximum, empty=False):
    return type(value) is str and len(value) <= maximum and (empty or bool(value.strip())) and not any(ord(c) < 32 or ord(c) == 127 for c in value)


def _enum(value, allowed):
    return type(value) is str and value in allowed


def _token(value):
    import re
    return type(value) is str and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def _identity(value, requested=False):
    row = _object(value, ("platform", "rawShopName", "rawChannel"))
    if not all(_text(row[key], 200, empty=key == "rawShopName" or not requested) for key in row):
        _invalid("跨域销售精确RAW三元组无效")
    return row


def _identity_tuple(row):
    return tuple(row[key] for key in ("platform", "rawShopName", "rawChannel"))


def _identity_order(row):
    return tuple(value.encode("utf8") for value in _identity_tuple(row))


def _window(value, expected):
    row = _object(value, ("startDate", "endExclusive", "endDate", "days"))
    if not _integer(row["days"], 1, 366) or any(type(row[key]) is not str for key in ("startDate", "endExclusive", "endDate")) or row != expected:
        _invalid("跨域销售响应窗口不属于用户独立真实窗口")


def _period(value, window):
    row = _object(value, ("values", "rowCount", "rowPresence", "orders", "observations"))
    count, presence = row["rowCount"], row["rowPresence"]
    if not _integer(count) or type(presence) is not bool or presence != (count > 0):
        _invalid("跨域销售有行状态非法")
    values = _object(row["values"], METRICS)
    if any(not _integer(v, -MAX_SAFE) if presence else v is not None for v in values.values()):
        _invalid("跨域销售金额/原生数量不能缺失、分数或伪零")
    if presence and (any(not _integer(values[key]) for key in ("positiveSalesCents", "refundCents", "positiveQuantity", "returnQuantity")) or values["netSalesCents"] != values["positiveSalesCents"]-values["refundCents"] or values["netQuantity"] != values["positiveQuantity"]-values["returnQuantity"] or values["grossProfitCents"] != values["netSalesCents"]-values["costCents"]):
        _invalid("跨域销售原始签名数量、净额或净额减成本口径非法")
    orders = _object(row["orders"], ("basis", "trustedOrderCount", "missingOrderNoRows", "netAmountPerOrder"))
    if not _enum(orders["basis"], ("ERP_order_no_only_within_exact_raw_source_identity",)):
        _invalid("跨域销售订单分母不得回退来源行键")
    trusted, missing = orders["trustedOrderCount"], orders["missingOrderNoRows"]
    if presence:
        if not _integer(trusted) or not _integer(missing, 0, count) or trusted > count-missing or (trusted == 0) != (missing == count):
            _invalid("跨域销售可信订单计数非法")
    elif trusted is not None or missing is not None:
        _invalid("跨域销售无记录订单不能补零")
    reason = "no_records" if not presence else "missing_order_no" if missing else "zero_denominator" if not trusted else None
    mean = _object(orders["netAmountPerOrder"], ("unit", "value", "numerator", "denominator", "status", "reasonCode"))
    if not _enum(mean["unit"], ("CNY_CENT_PER_ORDER",)) or not _enum(mean["status"], ("available", "unavailable")) or (mean["reasonCode"] is not None and not _enum(mean["reasonCode"], ("no_records", "missing_order_no", "zero_denominator"))) or mean["reasonCode"] != reason or mean["status"] != ("unavailable" if reason else "available"):
        _invalid("跨域销售订单均值或缺号原因非法")
    operands_valid = _integer(mean["numerator"], -MAX_SAFE) and _integer(mean["denominator"]) if presence else mean["numerator"] is None and mean["denominator"] is None
    if not operands_valid or mean["numerator"] != values["netSalesCents"] or mean["denominator"] != trusted:
        _invalid("跨域销售订单均值分子分母非法")
    result_valid = mean["value"] is None if reason else type(mean["value"]) in {int, float} and math.isfinite(mean["value"]) and mean["value"] == values["netSalesCents"]/trusted
    if not result_valid:
        _invalid("跨域销售订单均值不能伪造")
    observed = _object(row["observations"], ("basis", "requestedDays", "observedDateCount", "observedDateRanges", "completeness", "absenceMeaning"))
    if not _enum(observed["basis"], ("imported_business_date_records",)) or not _enum(observed["completeness"], ("unknown",)) or not _integer(observed["requestedDays"], 1, 366) or observed["requestedDays"] != window["days"] or not _integer(observed["observedDateCount"], 1 if presence else 0, min(window["days"], count)) or not _text(observed["absenceMeaning"], 500):
        _invalid("跨域销售观察日期不能冒店日完整结算")
    ranges = observed["observedDateRanges"]
    if type(ranges) is not list or len(ranges) > window["days"]:
        _invalid("跨域销售观察日期范围非法")
    previous, observed_count = None, 0
    for value in ranges:
        interval = _object(value, ("startDate", "endDate"))
        try:
            if any(type(v) is not str or not DATE_RE.fullmatch(v) for v in interval.values()): raise ValueError()
            start, end = (date.fromisoformat(interval[key]) for key in ("startDate", "endDate"))
        except ValueError:
            _invalid("跨域销售观察范围必须是真实ISO日期")
        if start > end or interval["startDate"] < window["startDate"] or interval["endDate"] >= window["endExclusive"] or previous is not None and start <= previous+timedelta(days=1):
            _invalid("跨域销售观察日期必须期内、有序、唯一且相邻压缩")
        observed_count += (end-start).days+1; previous = end
    if observed_count != observed["observedDateCount"]:
        _invalid("跨域销售观察压缩范围与日期数不一致")
    return row


def _decode_response(data, revision, spec):
    if type(revision) is not str or not PAIR_RE.fullmatch(revision) or any(int(item) > MAX_SAFE for item in revision.split(":")):
        _invalid("跨域销售响应头不是所属整数pair")
    intent = {"grain":spec["seriesGrain"],"rawOutlets":spec["seriesOutlets"]} if "seriesGrain" in spec else None
    data = _object(data, ("schemaVersion", "operation", "scopeKey", "snapshotToken", "requestedScope", "scopeMode", "periods", "periodTotals", "items", "candidatePagination", "latestRelevantBatch", "sourceRevisions", "metricSemantics", "metricMetadata",*(("series",) if intent else ())))
    if not _enum(data["schemaVersion"], (SCHEMA,)) or not _enum(data["operation"], (OPERATION,)) or not _token(data["scopeKey"]) or not _token(data["snapshotToken"]) or not _enum(data["scopeMode"], ("restricted", "unrestricted")):
        _invalid("跨域销售协议、token或授权模式无效")
    scope = _object(data["requestedScope"], ("current", "baseline", "rawOutlets", "categories",*(("seriesIntent",) if intent else ())))
    if intent and scope["seriesIntent"] != intent: _invalid("图形选择意图不属于原始请求")
    for kind in ("current", "baseline"): _window(scope[kind], spec[kind])
    if type(scope["rawOutlets"]) is not list or len(scope["rawOutlets"]) > 50 or sorted((_identity(row, True) for row in scope["rawOutlets"]), key=_identity_order) != spec["rawOutlets"] or type(scope["categories"]) is not list or scope["categories"] != spec["categories"] or any(not _text(value, 200) for value in scope["categories"]):
        _invalid("跨域销售响应范围不属于原始身份/来源标签请求")
    periods = _object(data["periods"], ("current", "baseline"))
    totals = _object(data["periodTotals"], ("current", "baseline"))
    for kind in ("current", "baseline"): _window(periods[kind], spec[kind]); _period(totals[kind], spec[kind])
    page = _object(data["candidatePagination"], ("collection", "candidateCount", "filteredCount", "q", "page", "pageSize", "returned", "hasMore", "truncated"))
    if not _enum(page["collection"], ("authorized_two_period_union_before_search_pagination",)) or not _integer(page["page"], 1, 10000) or not _integer(page["pageSize"], 1, 100) or page["page"] != spec["page"] or page["pageSize"] != spec["pageSize"] or not _text(page["q"], 120, True) or page["q"] != spec["q"] or not _integer(page["candidateCount"]) or not _integer(page["filteredCount"], 0, page["candidateCount"]) or not _integer(page["returned"], 0, spec["pageSize"]) or page["returned"] != min(spec["pageSize"], max(0, page["filteredCount"]-(spec["page"]-1)*spec["pageSize"])) or type(page["hasMore"]) is not bool or page["hasMore"] != (spec["page"]*spec["pageSize"] < page["filteredCount"]) or page["truncated"] is not False or type(data["items"]) is not list or len(data["items"]) != page["returned"]:
        _invalid("跨域销售完整候选分页不一致")
    previous = None
    selected = {_identity_tuple(row) for row in spec["rawOutlets"]}
    for value in data["items"]:
        item = _object(value, ("identity", "identityKey", "current", "baseline"))
        identity = _identity(item["identity"]); order = _identity_order(identity)
        expected_key = json.dumps(list(_identity_tuple(identity)), ensure_ascii=False, separators=(",", ":"))
        if type(item["identityKey"]) is not str or item["identityKey"] != expected_key or previous is not None and order <= previous or selected and _identity_tuple(identity) not in selected:
            _invalid("跨域销售候选RAW身份/key重复、乱序或越出显式范围")
        previous = order
        for kind in ("current", "baseline"): _period(item[kind], spec[kind])
        if item["current"]["rowCount"] == 0 and item["baseline"]["rowCount"] == 0:
            _invalid("跨域销售候选必须实际来自两期完整union")
    vectors = data["sourceRevisions"]
    if type(vectors) is not list or len(vectors) != 1:
        _invalid("跨域销售必须完整返回唯一参与pair向量")
    vector = _object(vectors[0], ("domain", "kind", "scopeKey", "revision"))
    if not _enum(vector["domain"], ("sales",)) or not _enum(vector["kind"], ("sales_erp_revision_pair",)) or vector["scopeKey"] != data["scopeKey"] or type(vector["scopeKey"]) is not str or vector["revision"] != revision or type(vector["revision"]) is not str:
        _invalid("跨域销售pair向量/范围与所属响应头错位")
    if spec["expectedRevision"] is not None and spec["expectedRevision"] != revision or spec["snapshotToken"] is not None and spec["snapshotToken"] != data["snapshotToken"]:
        raise NetshopApiError("跨域销售版本或范围已变化", code="sales_periods_revision_changed", status=409)
    batch = data["latestRelevantBatch"]
    if batch is not None:
        batch = _object(batch, ("id", "source", "completedAt", "rowCount"))
        if not _text(batch["id"], 200) or not _text(batch["source"], 200) or batch["completedAt"] is not None and not _text(batch["completedAt"], 100) or not _integer(batch["rowCount"]): _invalid("跨域销售相关批次元数据非法")
    semantics = data["metricSemantics"]
    if type(semantics) is not dict or not {"date", "netSalesCents", "costCents", "grossProfitCents", "reportedGrossProfitCents", "quantity", "orders", "category"}.issubset(semantics) or any(not _text(value, 2000) for value in semantics.values()): _invalid("跨域销售原生来源口径未完整声明")
    metadata = _object(data["metricMetadata"], METRIC_METADATA)
    for name, expected in METRIC_METADATA.items():
        actual = _object(metadata[name], expected)
        if any(not _enum(actual[key], (value,)) for key, value in expected.items()): _invalid("跨域销售成本证据或原生单位不得冒充已验证")
    if intent: _decode_series(data["series"], intent, data, spec)


def _decode_series(value, intent, parent, spec):
    from sales.netshop_period_series import SERIES_SCHEMA, SERIES_PROJECTION, WINDOW_COLUMNS, POINT_COLUMNS, SERIES_BASIS, period_buckets, restore_period_point
    series=_object(value,("schemaVersion","projection","windowColumns","metricColumns","pointColumns","scopeKey","intent","periods","basis","metricMetadata","sourceRevisions","items"))
    if not _enum(series["schemaVersion"],(SERIES_SCHEMA,)) or not _enum(series["projection"],(SERIES_PROJECTION,)) or series["windowColumns"]!=WINDOW_COLUMNS or series["metricColumns"]!=list(METRICS) or series["pointColumns"]!=POINT_COLUMNS or series["scopeKey"]!=parent["scopeKey"] or type(series["scopeKey"])is not str or series["intent"]!=intent:
        _invalid("序列版本、父范围或图形意图错位")
    _object(series["intent"],("grain","rawOutlets"))
    _object(series["periods"],("current","baseline"))
    for kind in ("current","baseline"):_window(series["periods"][kind],spec[kind])
    basis=_object(series["basis"],SERIES_BASIS)
    if any(not _enum(basis[key],(meaning,)) for key,meaning in SERIES_BASIS.items()) or series["metricMetadata"]!=parent["metricMetadata"] or series["sourceRevisions"]!=parent["sourceRevisions"]:
        _invalid("序列不能冒完整结算、累计日订单或混用单位/未知成本/版本")
    if type(series["items"])is not list or len(series["items"])!=len(intent["rawOutlets"]):_invalid("序列对象不得添加、省略或重复")
    for index,value in enumerate(series["items"]):
        row=_object(value,("identity","identityKey","current","baseline"));identity=_identity(row["identity"],True)
        if identity!=intent["rawOutlets"][index] or type(row["identityKey"])is not str or row["identityKey"]!=json.dumps(list(_identity_tuple(identity)),ensure_ascii=False,separators=(",",":")):_invalid("序列精确RAW身份/key或排列越界")
        for kind in ("current","baseline"):
            expected=period_buckets(spec[kind],intent["grain"]);points=row[kind]
            if type(points)is not list or len(points)!=len(expected):_invalid("序列不得截断完整原期自然桶")
            for point,window in zip(points,expected):
                try:decoded=restore_period_point(point)
                except (TypeError,ValueError):_invalid("序列元组列或类型非法")
                _window(decoded["window"],window);_period(decoded["facts"],window)


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
    try:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    except (TypeError, ValueError) as error:
        raise NetshopApiError("跨域销售响应无法无损验证", code="invalid_sales_periods_contract", status=503) from error
    if len(raw) > MAX_BYTES:
        raise NetshopApiError("跨域销售完整响应超过2MiB", code="response_too_large", status=413)
    _decode_response(data, revision, spec)
    _check(deadline)
    return data, revision
