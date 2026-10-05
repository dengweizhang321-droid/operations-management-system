"""BI read-only composition: owning RPCs, shared deadline, no second facts."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import json
import time

from django.db import connection, transaction

from sales.query import revision_token

from .cockpit_sales import parse_options, periods, sales_projection, MAX_SAFE, _safe
from .errors import BiApiError
from .source_reader import read as read_source

SCHEMA = "bi-cockpit-v1"
MAX_BYTES = 2 * 1024 * 1024


def parse_request(query):
    extra = {"mine", "flowPlatform", "flowShop", "deferFlow"}
    if set(query) - (extra | {"range", "startDate", "endDate", "platform", "shop"}) or any(len(query.getlist(key)) != 1 for key in query):
        raise BiApiError("驾驶舱参数未知或重复")
    base = query.copy()
    for key in extra:
        base.pop(key, None)
    options = parse_options(base)
    if query.get("mine", "0") not in {"0", "1"} or query.get("deferFlow", "0") not in {"0", "1"} or query.get("flowPlatform", "") not in {"", "京东", "天猫"}:
        raise BiApiError("驾驶舱局部筛选无效")
    shop = query.get("flowShop", "")
    if not isinstance(shop, str) or len(shop) > 500:
        raise BiApiError("流量店铺键无效")
    if shop:
        try:
            pair = json.loads(shop)
            if not isinstance(pair, list) or len(pair) != 2 or pair[0] not in {"京东", "天猫"} or not isinstance(pair[1], str) or not pair[1] or len(pair[1]) > 200:
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise BiApiError("流量店铺复合键无效") from error
    return {**options, "mine": query.get("mine", "0"), "flowPlatform": query.get("flowPlatform", ""), "flowShop": shop, "deferFlow": query.get("deferFlow", "0") == "1"}


def _budget(deadline):
    if time.monotonic() >= deadline:
        raise BiApiError("BI整体65秒读取预算耗尽", code="source_timeout", status=503)


def _fence(deadline):
    def execute(executor, sql, params, many, context):
        _budget(deadline)
        if connection.vendor == "postgresql" and not sql.lstrip().upper().startswith(("SAVEPOINT", "RELEASE", "ROLLBACK")):
            milliseconds = max(1, min(7000, int((deadline - time.monotonic()) * 1000)))
            executor("SELECT set_config('statement_timeout', %s, true)", [str(milliseconds)], False, context)
        result = executor(sql, params, many, context)
        _budget(deadline)
        return result
    return execute


def _source(principal, source, params, deadline):
    try:
        return read_source(principal, source, params, deadline=deadline)
    except BiApiError as error:
        if error.status in {401, 403}:
            raise
        return {"source": source, "status": "unavailable", "revision": None, "reasonCode": error.code, "data": None}


def _ratio(a, b):
    return a / b if a is not None and b is not None and b > 0 else None


def _relative(a, b, eligible):
    return (a - b) / b if eligible and a is not None and b is not None and b > 0 else None


def goals(sales, target_source):
    actuals, windows = sales["goalActuals"], sales["periods"]["goalWindows"]
    items = target_source["data"]["items"] if target_source["status"] == "ready" else []
    year, month = windows["annual"]["startDate"][:4], windows["month"]["startDate"][:7]
    rows = []
    for kind, period, actual_key, prior_key, year_key in (("year", year, "annual", "annualPrevious", "annualYearAgo"), ("month", month, "month", "monthPrevious", "monthYearAgo")):
        scoped = [row for row in items if row["periodType"] == kind and row["periodKey"] == period]
        for row in scoped:
            if row.get("basis") != "erp_net_sales" or isinstance(row.get("salesTargetCents"), bool) or not isinstance(row.get("salesTargetCents"), int) or not 0 <= row["salesTargetCents"] <= MAX_SAFE:
                raise BiApiError("所属ERP目标口径或金额无效", code="source_invalid", status=503)
        filters = sales["filters"]
        company = next((row for row in scoped if not row["platform"] and not row["shopName"]), None) if not filters["platform"] and not filters["shop"] else None
        selected = [row for row in scoped if row["platform"] and row["shopName"] and (not filters["platform"] or row["platform"] == filters["platform"]) and (not filters["shop"] or row["shopName"] == filters["shop"])]
        planned = [company] if company else selected
        target = _safe(sum(row["salesTargetCents"] for row in planned)) if planned else None
        def value(key):
            if key not in windows:
                return None, False
            if company or not planned:
                entry = actuals[key]
                return entry["netSalesCents"], entry["coverage"]["dateComplete"]
            matched = [next((entry["periods"][key] for entry in actuals["shops"] if (entry["platform"], entry["shop"]) == (row["platform"], row["shopName"])), None) for row in planned]
            if any(entry is None or entry["netSalesCents"] is None for entry in matched):
                return None, False
            return _safe(sum(entry["netSalesCents"] for entry in matched)), all(entry["coverage"]["dateComplete"] for entry in matched)
        current, current_ok = value(actual_key); previous, previous_ok = value(prior_key); old, old_ok = value(year_key)
        target_status = "source_unavailable" if target_source["status"] != "ready" else "not_set" if target is None else "zero_target" if target == 0 else "ready"
        completion = _ratio(current, target) if current_ok and target_status == "ready" else None
        start, end = windows[actual_key]["startDate"], windows[actual_key]["endDate"]
        elapsed = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        if kind == "year":
            total_days = (date(int(year) + 1, 1, 1) - date(int(year), 1, 1)).days
        else:
            first = date.fromisoformat(start)
            next_month = date(first.year + (first.month == 12), 1 if first.month == 12 else first.month + 1, 1)
            total_days = (next_month - first).days
        rows.append({"kind": kind, "period": period, "basis": "erp_net_sales", "targetCents": target, "actualCents": current,
            "completion": completion, "targetStatus": target_status, "actualCoverageComplete": current_ok,
            "startDate": start, "endDate": end, "pace": elapsed / total_days, "targetedShops": len(planned), "companyTarget": company is not None,
            "mom": _relative(current, previous, current_ok and previous_ok), "yoy": _relative(current, old, current_ok and old_ok),
            "progressChangePp": ((current - previous) / target * 100) if kind == "year" and completion is not None and previous is not None and previous_ok else None,
            "sourceTargetIds": [row["id"] for row in planned]})
    return {"basis": "erp_net_sales", "periods": rows, "items": items, "sourceStatus": target_source["status"],
        "disclosure": "公司目标优先；否则仅已明确设置ERP目标店铺进入完成率分子分母。目标不线性摊月、不复制财报目标。实际日期覆盖不足时不计算完成率"}


def read_cockpit(principal, options):
    if principal.scope is not None:
        raise BiApiError("BI驾驶舱仅支持未受限数据范围账号", code="access_denied", status=403)
    deadline = time.monotonic() + 65
    with transaction.atomic(), connection.execute_wrapper(_fence(deadline)):
        before = revision_token()
        core = sales_projection(principal, options)
        if revision_token() != before:
            raise BiApiError("销售来源读取期间变化", code="revision_changed", status=409)
    window = core["periods"]["current"]
    requests = {
        "targets": {"year": core["periods"]["goalWindows"]["annual"]["startDate"][:4], "month": core["periods"]["goalWindows"]["month"]["startDate"][:7]},
        "operations": {"mine": options["mine"]}, "inventory": {},
        "flow": {"startDate": window["startDate"], "endDate": window["endDate"], "periodKind": options["range"],
            "platform": options["flowPlatform"], "shop": options["flowShop"], "parentPlatform": options["platform"], "parentShop": options["shop"]},
    }
    _budget(deadline)
    if options.get("deferFlow"):
        requests.pop("flow")
    with ThreadPoolExecutor(max_workers=3) as pool:
        tasks = {key: pool.submit(_source, principal, key, params, deadline) for key, params in requests.items()}
        try:
            sources = {key: task.result(timeout=max(.001, deadline - time.monotonic())) for key, task in tasks.items()}
        except TimeoutError as error:
            raise BiApiError("所属来源超过整体读取预算", code="source_timeout", status=503) from error
    _budget(deadline)
    if options.get("deferFlow"):
        sources["flow"] = {"source": "flow", "status": "unavailable", "revision": None, "reasonCode": "deferred", "data": None}
    if revision_token() != before:
        raise BiApiError("组合读取期间销售来源变化", code="revision_changed", status=409)
    if sources["inventory"]["status"] == "ready" and sources["inventory"]["data"].get("salesRevision") != before:
        sources["inventory"] = {"source": "inventory", "status": "unavailable", "revision": None, "reasonCode": "sales_revision_changed", "data": None}
    # Financial goals are joined to ERP: verify the target revision again.
    if sources["targets"]["status"] == "ready":
        check = _source(principal, "targets", requests["targets"], deadline)
        if check["status"] != "ready" or check["revision"] != sources["targets"]["revision"]:
            sources["targets"] = {"source": "targets", "status": "unavailable", "revision": None, "reasonCode": "revision_changed", "data": None}
    target_goals = goals(core, sources["targets"])
    vector = {"salesErp": before, **{key: source["revision"] for key, source in sources.items()}}
    actor = {"email": principal.email, "displayName": principal.display_name, "role": principal.role, "scope": principal.scope}
    digest = hashlib.sha256(json.dumps({"actor": actor, "scope": options, "periods": core["periods"], "vector": vector}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    result = {"contractVersion": SCHEMA, "projection": "cockpit", "revision": digest, "sourceRevisions": vector, "erp": core,
        "goals": target_goals, "sources": sources, "limitations": ["逐来源拥有方快照，不宣称跨域单一原子快照", "缺源不补零、不读取退役D1/R2事实，不进行业务补跑或通知"]}
    _budget(deadline)
    if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_BYTES:
        raise BiApiError("驾驶舱响应超过2MiB，结果没有截断", code="capacity_exceeded", status=413)
    return result, digest


def read_flow(principal, options):
    if principal.scope is not None:
        raise BiApiError("BI流量仅支持未受限数据范围", code="access_denied", status=403)
    window = periods(options)["current"]
    deadline = time.monotonic()+65
    source = _source(principal, "flow", {"startDate": window["startDate"], "endDate": window["endDate"], "periodKind": options["range"], "platform": options["flowPlatform"], "shop": options["flowShop"], "parentPlatform": options["platform"], "parentShop": options["shop"]}, deadline)
    actor = {"email": principal.email, "role": principal.role, "scope": principal.scope}
    digest = hashlib.sha256(json.dumps({"actor": actor, "scope": options, "window": window, "revision": source["revision"]}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    result = {"contractVersion": "bi-flow-v1", "projection": "flow", "revision": digest, "window": window, "source": source}
    _budget(deadline)
    if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_BYTES:
        raise BiApiError("流量响应超过2MiB，未截断", code="capacity_exceeded", status=413)
    return result, digest
