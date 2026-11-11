"""Authorized dataset export -> separate container broker -> passive table output.

No Python execution, subprocess, pandas import, SQL or file export in Django.
"""
import hashlib
import hmac
import http.client
import logging
import os
from pathlib import Path
import re
import time
import uuid
from functools import partial
from threading import BoundedSemaphore

from pandas_runner.protocol import MAX_INPUT, MAX_OUTPUT, MAX_ROWS, MAX_CODE, PATH, PORT, decode, encode, signature, validate_job, validate_result
from pandas_runner.key_file import read_key
from . import datasets, transport
from .pandas_diagnostics import no_stage, reference, stage
from .policy import AiError, canonical, current_principal, digest, fields, scope_covers

_slots = BoundedSemaphore(1)
logger = logging.getLogger(__name__)


class SandboxDiagnosticError(AiError):
    def __init__(self, message, code, status, diagnostic_code):
        super().__init__(message, code, status)
        self.diagnostic_code = diagnostic_code


def diagnostic_code(error):
    if isinstance(error, (SandboxDiagnosticError, datasets.SourceResultError)):
        return error.diagnostic_code  # Fixed at the originating failure site.
    if isinstance(error, AiError) and error.code in {
        "invalid_request", "access_denied", "not_found", "payload_too_large", "rate_limited",
        "service_unavailable", "provider_timeout", "ai_request_cancelled", "cancel_check_unavailable",
    }:
        return error.code
    if isinstance(error, TimeoutError):
        return "timeout"
    if isinstance(error, (OSError, http.client.HTTPException)):
        return "transport_error"
    if isinstance(error, (ValueError, TypeError, RecursionError)):
        return "invalid_structure"
    return "unexpected_error"


def log_stage(event):
    logger.info("pandas_stage %s", canonical(event))

# These dataset adapters explicitly accept page/limit and return pagination.
# Do not infer paging for arbitrary native tool responses.
PAGED_DATASETS = frozenset({
    "inventory_age", "inventory_inbound", "inventory_guangdong", "finance_targets",
    "netshop_catalog", "netshop_products", "customer_service", "workflow_operations", "workflow_tasks",
    "workflow_launch_projects",
})
MAX_EXPORT_PAGES = 20


def native_page(dataset, data, path, parent, rows, args, expected_total, *, paged_export=False):
    pagination = data.get("pagination") if (paged_export or dataset in PAGED_DATASETS) and path == "items" else None
    if pagination is not None:
        if not isinstance(pagination, dict):
            raise AiError("分析数据集分页信息无效")
        page, size, total = (pagination.get(k) for k in ("page", "pageSize", "total"))
        more = pagination.get("truncated")
        # Guangdong's source contract uses totalPages instead of truncated.
        # Only this exact dataset may derive the flag, after validating all counts.
        if dataset == "inventory_guangdong" and "truncated" not in pagination:
            total_pages = pagination.get("totalPages")
            if (type(size) is not int or size <= 0 or type(total) is not int or total < 0
                    or type(total_pages) is not int or total_pages != (total + size - 1) // size
                    or type(page) is not int):
                raise AiError("广东库存分页计数无效")
            more = page < total_pages
        if (type(page) is not int or page != args.get("page", 1)
                or type(size) is not int or not 1 <= size <= 50
                or "limit" in args and size != args["limit"]
                or type(total) is not int or total < 0
                or type(more) is not bool or more != (page * size < total)
                or len(rows) != max(0, min(size, total - (page - 1) * size))
                or pagination.get("returned", len(rows)) != len(rows)
                or expected_total is not None and total != expected_total
                or incomplete({k: v for k, v in data.items() if k != "pagination"})):
            raise AiError("分析数据集分页不完整或查询期间总行数变化，请缩小范围")
        return more, total
    complete = parent.get("truncated") is False or parent.get("hasMore") is False
    total = parent.get("totalMatched", parent.get("total"))
    if (not complete or incomplete(parent) or data.get("truncated") is True
            or data.get("hasMore") is True or type(total) is int and total != len(rows)):
        raise AiError("分析数据集未证明完整返回，请缩小范围或使用逐行数据集")
    return False, None


def select_columns(rows, columns):
    if columns is None:
        return rows
    if (not isinstance(columns, list) or not 1 <= len(columns) <= 100
            or any(not isinstance(c, str) or not 1 <= len(c) <= 128 for c in columns)
            or len(set(columns)) != len(columns)):
        raise AiError("columns 必须是非重复字段名数组")
    if any(any(c not in row for c in columns) for row in rows):
        raise AiError("columns 含来源中不存在的字段，请先查询数据集确认字段")
    # Only project already-authorized source fields; never flatten nested objects
    # or turn missing keys into fabricated nulls.
    return [{c: row[c] for c in columns} for row in rows]


def product_page_identity(data, rows, expected_version, seen):
    pagination = data.get("pagination")
    if (not isinstance(pagination, dict) or type(pagination.get("returned")) is not int
            or type(pagination.get("pageSize")) is not int or not 1 <= pagination["pageSize"] <= 20):
        raise AiError("商品日来源缺少完整分页证明")
    revision, snapshot = data.get("sourceRevision"), data.get("snapshotToken")
    if (not isinstance(revision, str) or not re.fullmatch(r"[0-9]+:[a-f0-9]{12}", revision)
            or not isinstance(snapshot, str) or not re.fullmatch(r"[a-f0-9]{64}", snapshot)):
        raise AiError("商品日来源缺少版本证明")
    version = revision, snapshot
    if expected_version is not None and version != expected_version:
        raise SandboxDiagnosticError("商品日来源版本已变化，请缩小范围后重新发起", "version_conflict", 409,
                                     "source_revision_changed")
    for row in rows:
        platform, shops, product = row.get("platform"), row.get("shopNames"), row.get("id")
        if (platform not in ("京东", "天猫") or not isinstance(shops, list) or len(shops) != 1
                or not isinstance(shops[0], str) or not shops[0]
                or not isinstance(product, str) or not product or row.get("spuId") != product):
            raise AiError("商品日来源缺少平台、店铺或 SPU 行身份")
        identity = platform, shops[0], product
        if identity in seen:
            raise AiError("商品日来源包含重复行，导出已停止")
        seen.add(identity)
    return version


def sales_page_identity(rows, seen):
    for row in rows:
        category = row.get("category")
        if not isinstance(category, str) or not category or category in seen:
            raise AiError("销售品类来源包含无效或重复行，导出已停止")
        seen.add(category)


def require_complete_sales_collection(data, parent, rows, path):
    trend = path == "trend.items"
    matched, returned = data.get("totalMatched"), parent.get("returned")
    # The trend flag only describes its row cap, independent of the detail page
    # and the owning reader's separate cap on the number of trend categories.
    cap = parent.get("categoryLimit") if trend else len(rows)
    keys = set()
    for row in rows:
        key = (row.get("category"), row.get("period")) if trend else (row.get("category"),)
        if any(not isinstance(part, str) or not part for part in key) or key in keys:
            raise AiError("销售品类来源包含无效或重复行")
        keys.add(key)
    if (type(cap) is not int or (trend and cap < 1) or type(matched) is not int or not 0 <= matched <= cap
            or matched != len({key[0] for key in keys})
            or type(returned) is not int or returned != len(rows)
            or parent.get("truncated") is not False or parent.get("truncatedFields") or parent.get("hasMore") or incomplete(rows)):
        if not trend:
            raise AiError("销售品类详情未证明完整返回，请缩小范围或增加 limit")
        raise SandboxDiagnosticError("销售品类趋势未证明覆盖全部匹配品类，请缩小品类范围或选用完整详情",
                                     "invalid_request", 400, "incomplete_sales_category_trend")


def unavailable(reason="runner_unavailable"):
    return SandboxDiagnosticError("pandas 容器沙箱未就绪、执行失败或结果未知；请勿自动重试。",
                                  "service_unavailable", 503, reason)


def config():
    # Explicit independent credential; never borrow the database/edge secret.
    key_path = os.getenv("TERUISI_PANDAS_RUNNER_KEY_FILE", "")
    image = os.getenv("TERUISI_PANDAS_RUNNER_IMAGE", "")
    if not key_path or not Path(key_path).is_absolute() or not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise unavailable("invalid_runner_configuration")
    try:
        key = read_key(key_path)
    except (OSError, ValueError, TypeError) as error:
        raise unavailable("runner_key_unavailable") from error
    if not 32 <= len(key) <= 128:
        raise unavailable("invalid_runner_key_length")
    return key, image


def call_runner(job, configuration, diagnostic_stage=no_stage):
    key, expected_image = configuration
    raw = encode(validate_job(job))
    nonce, stamp = uuid.uuid4().hex, str(int(time.time()))
    broker_ref = reference(nonce)
    runner_stage = partial(diagnostic_stage, brokerRef=broker_ref)
    with runner_stage("runner_prepare"):
        from pandas_runner.native_isolation import native_port
        connection = http.client.HTTPConnection("127.0.0.1", native_port(PORT), timeout=transport.remaining_budget(22))
    try:
        # The preceding prepare event binds the nonce digest even if no response returns.
        with runner_stage("signed_send"):
            connection.request("POST", PATH, body=raw, headers={"Content-Type": "application/json",
                "X-Nonce": nonce, "X-Timestamp": stamp, "X-Signature": signature(key, stamp, nonce, raw)})
        with runner_stage("runner_reply_read"):
            owned_socket = connection.sock
            stop = transport.watch_socket_cancellation(lambda: owned_socket) if owned_socket else lambda: None
            try:
                response = connection.getresponse()
                body = response.read(MAX_OUTPUT + 1025)
            finally:
                stop()
        with runner_stage("runner_reply_authentication"):
            if len(body) > MAX_OUTPUT + 1024 or response.getheader("Content-Type") != "application/json":
                raise unavailable("invalid_runner_envelope")
            if not hmac.compare_digest(response.getheader("X-Signature", ""), signature(key, stamp, nonce, body, "response")):
                raise unavailable("unverified_runner_reply")
        with runner_stage("runner_result_validation"):
            if response.status != 200:
                raise unavailable("signed_runner_failure")
            value = decode(body)
            if not isinstance(value, dict) or set(value) != {"result", "image", "cleanupVerified"}:
                raise unavailable("invalid_runner_result_envelope")
            if value["image"] != expected_image:
                raise unavailable("runner_image_mismatch")
            if value["cleanupVerified"] is not True:
                raise unavailable("runner_cleanup_unverified")
            return validate_result(value["result"])
    except (OSError, ValueError, TypeError, http.client.HTTPException) as error:
        raise unavailable() from error
    finally:
        connection.close()


def incomplete(value):
    if isinstance(value, dict):
        if value.get("truncated") or value.get("hasMore") or value.get("truncatedFields"):
            return True
        return any(incomplete(v) for v in value.values())
    return isinstance(value, list) and any(incomplete(v) for v in value)


def collection(data, path):
    parent = data
    names = path.split(".")
    for name in names[:-1]:
        parent = parent.get(name) if isinstance(parent, dict) else None
    rows = parent.get(names[-1]) if isinstance(parent, dict) else None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise AiError("数据集 collection 必须指向实际存在的记录数组")
    return parent, rows


def export_frames(inputs, principal, request_id, surface, diagnostic_stage=no_stage):
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 3:
        raise AiError("一次分析需要 1 至 3 个数据集")
    frames, sources = {}, []
    for item in inputs:
        fields(item, {"name", "dataset", "query", "collection", "columns"}, {"name", "dataset", "query"})
        name, dataset = item["name"], item["dataset"]
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", name) or name in frames:
            raise AiError("数据集别名无效或重复")
        if not isinstance(dataset, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", dataset):
            raise AiError("dataset 无效")
        query = item["query"]
        if not isinstance(query, dict) or set(query) & {"cursor", "textOffset"}:
            raise AiError("导出必须从完整范围第一页开始")
        if "page" in query and (type(query["page"]) is not int or query["page"] != 1):
            raise AiError("导出必须从第一页开始，不能把最后一页当作全量")
        path = item.get("collection", "rows" if dataset.startswith("rows_") else "items")
        if not isinstance(path, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,3}", path):
            raise AiError("collection 无效")
        records = dataset in datasets.record_catalog.SPECS
        if records and path != "rows":
            raise AiError("逐行数据集必须使用 rows")
        product_export = dataset == "netshop_product_daily"
        if product_export and path != "items":
            raise AiError("商品日完整导出必须使用 items")
        sales_export = dataset == "sales_category" and path == "items"
        args = dict(query)
        if product_export or sales_export:
            args.pop("page", None)
        if sales_export:
            # Page size is the source's 50 maximum unless the caller chose a smaller one.
            args["limit"] = args.get("limit", 50)
        sales_keys = set()
        product_version, product_keys = None, set()
        rows, cursors, pages, first, last = [], set(), 0, None, None
        expected_total = None
        while True:
            page_stage = partial(diagnostic_stage, sourceIndex=len(sources), page=pages + 1,
                                 dataset=dataset if records or dataset in datasets.DATASETS else "unrecognized")
            with page_stage("source_page_admission"):
                transport.remaining_budget()
                if pages >= MAX_EXPORT_PAGES:
                    raise AiError("导出超过 20 页，请缩小筛选范围", "payload_too_large", 413)
            # Reuses discovery, current principal, field grants, freshness and
            # central per-source audit on every page; cannot choose SQL or URLs.
            continuation = {"pandas_product_page": (pages + 1, product_version[1] if product_version else None)} if product_export else {}
            if sales_export:
                continuation = {"pandas_sales_page": pages + 1}
            envelope = datasets.query(dataset, {"query": args}, principal,
                                      f"{request_id[:80]}.export.{len(sources)}.{pages}", surface=surface,
                                      diagnostic_stage=page_stage, **continuation)
            first = first or envelope
            last = envelope
            data = envelope["data"]
            with page_stage("source_collection"):
                parent, current = collection(data, path)
            pages += 1
            with page_stage("source_pagination"):
                if records:
                    if (type(data.get("hasMore")) is not bool or data.get("truncatedFields")
                            or any(v.get("nextOffset") is not None for v in data.get("cellWindows", {}).values())):
                        raise AiError("源字段不完整，不能用于 pandas 分析")
                    more, cursor = data["hasMore"], data.get("nextCursor")
                    if (more and (not current or not isinstance(cursor, str) or not cursor or cursor in cursors)
                            or not more and (cursor is not None or data.get("truncated"))):
                        raise AiError("源分页或截断状态不一致")
                elif sales_export:
                    sales_page_identity(current, sales_keys)
                    more, expected_total = native_page(dataset, data, path, parent, current, {"page": pages, "limit": args["limit"]},
                                                       expected_total, paged_export=True)
                    available_rows = MAX_ROWS - sum(len(frame) for key, frame in frames.items() if key != name)
                    if expected_total > min(available_rows, MAX_EXPORT_PAGES * data["pagination"]["pageSize"]):
                        raise AiError("销售品类导出超过页数或行数上限，请缩小范围", "payload_too_large", 413)
                    cursor = None
                elif dataset == "sales_category" and path == "trend.items":
                    require_complete_sales_collection(data, parent, current, path)
                    more = False
                else:
                    if product_export:
                        product_version = product_page_identity(data, current, product_version, product_keys)
                    paging_args = {"page": pages, "limit": args.get("limit", 10)} if product_export else args
                    more, expected_total = native_page(dataset, data, path, parent, current, paging_args, expected_total,
                                                       paged_export=product_export)
                    if product_export:
                        available_rows = MAX_ROWS - sum(len(frame) for key, frame in frames.items() if key != name)
                        if expected_total > min(available_rows, MAX_EXPORT_PAGES * data["pagination"]["pageSize"]):
                            raise AiError("商品日导出超过页数或行数上限，请缩小范围", "payload_too_large", 413)
                    cursor = None
            with page_stage("source_projection"):
                rows.extend(select_columns(current, item.get("columns")))
                frames[name] = rows
                if sum(len(v) for v in frames.values()) > MAX_ROWS or len(encode(frames)) > MAX_INPUT - MAX_CODE:
                    raise AiError("导出超过 2000 行或 2 MiB，请缩小范围", "payload_too_large", 413)
            if not more:
                break
            if records:
                cursors.add(cursor)
                args = {**query, "cursor": cursor}
            elif not product_export and not sales_export:
                args = {**query, "page": pages + 1, "limit": data["pagination"]["pageSize"]}
        sources.append({"name": name, "dataset": dataset, "collection": path, "query": query,
            "source": first["source"], "dataCutoffDate": (first if product_export else last).get("dataCutoffDate"),
            "queriedAt": first.get("queriedAt"), "completedAt": last.get("queriedAt"),
            "freshness": first.get("freshness"), "rows": len(rows), "pages": pages,
            "sha256": hashlib.sha256(encode(rows)).hexdigest(), "complete": True,
            "columns": item.get("columns"),
            **({"sourceRevision": product_version[0]} if product_export else {}),
            "consistency": "live_per_page" if records or pages > 1 else "live_per_source"})
    return frames, sources


def run(payload, principal, request_id):
    invocation_ref = reference(request_id)
    parent = payload.get("parentRequestRef") if isinstance(payload, dict) else None
    valid_parent = isinstance(parent, str) and re.fullmatch(r"[a-f0-9]{64}", parent) is not None
    request_stage = partial(stage, log_stage, diagnostic_code, component="django",
                            requestRef=parent if valid_parent else invocation_ref, invocationRef=invocation_ref)
    required = {"operation", "inputsJson", "code", "surface"}
    with request_stage("request_admission"):
        fields(payload, required | {"parentRequestRef"}, required)
        if "parentRequestRef" in payload and not valid_parent:
            raise AiError("pandas 关联标识无效")
        if payload["surface"] not in {"ai_chat", "dingtalk_chat"}:
            raise AiError("pandas 分析入口无效", "access_denied", 403)
        principal = current_principal(principal)
        if principal.role not in {"analyst", "operator", "admin"}:
            raise AiError("当前账号不能运行 pandas 分析", "access_denied", 403)
    with request_stage("runner_configuration"):
        configuration = config()  # Missing container configuration fails before export.
    with request_stage("request_input"):
        raw, code = payload["inputsJson"], payload["code"]
        if not isinstance(raw, str) or len(raw.encode()) > 16000 or not isinstance(code, str) or not 1 <= len(code.encode()) <= MAX_CODE:
            raise AiError("数据集参数或 pandas 代码超限")
        try:
            inputs = decode(raw)
        except (ValueError, RecursionError) as error:
            raise AiError("inputsJson 必须是有效 JSON 数组") from error
    with request_stage("execution_slot"):
        if not _slots.acquire(blocking=False):
            raise AiError("pandas 沙箱繁忙，请稍后再发起分析", "rate_limited", 429)
    try:
        with request_stage("source_export"), transport.request_budget(8):
            frames, sources = export_frames(inputs, principal, request_id, payload["surface"], request_stage)
        with request_stage("dispatch_permission"):
            current = current_principal(principal)
            if current.role != principal.role or not scope_covers(current.scope, principal.scope):
                raise AiError("分析期间账号权限已变化", "access_denied", 403)
        with request_stage("runner_job_validation"):
            try:
                job = validate_job({"code": code, "frames": frames})
            except ValueError as error:
                raise AiError("数据字段或大小不符合 pandas 输入契约") from error
        result = call_runner(job, configuration, request_stage)
        # Revocation during execution also suppresses results and artifacts.
        with request_stage("result_permission"):
            current = current_principal(principal)
            if current.role != principal.role or not scope_covers(current.scope, principal.scope):
                raise AiError("分析期间账号权限已变化", "access_denied", 403)
        with request_stage("result_envelope"):
            answer = {"items": result["rows"], "columns": result["columns"], "returned": len(result["rows"]),
                "truncated": False, "sources": sources, "codeDigest": digest(code), "resultDigest": digest(result),
                "executionEnvironment": "isolated_container", "image": configuration[1], "cleanupVerified": True,
                "consistency": "live_per_source_or_page_not_atomic_snapshot",
                "notice": "代码计算结果需核对业务口径；完整导出不代表日期覆盖完整或跨页/跨域一致快照。金额单位沿用源字段。"}
            if len(canonical(answer)) > 39500:
                raise AiError("分析结果及来源超过输出上限", "payload_too_large", 413)
            return answer
    finally:
        _slots.release()
