"""Authorized dataset export -> separate container broker -> passive table output.

No Python execution, subprocess, pandas import, SQL or file export in Django.
"""
import hashlib
import hmac
import http.client
import os
from pathlib import Path
import re
import time
import uuid
from threading import BoundedSemaphore

from pandas_runner.protocol import MAX_INPUT, MAX_OUTPUT, MAX_ROWS, MAX_CODE, PATH, PORT, decode, encode, signature, validate_job, validate_result
from pandas_runner.key_file import read_key
from . import datasets, transport
from .policy import AiError, canonical, current_principal, digest, fields, scope_covers

_slots = BoundedSemaphore(1)


def unavailable():
    return AiError("pandas 容器沙箱未就绪、执行失败或结果未知；请勿自动重试。", "service_unavailable", 503)


def config():
    # Explicit independent credential; never borrow the database/edge secret.
    key_path = os.getenv("TERUISI_PANDAS_RUNNER_KEY_FILE", "")
    image = os.getenv("TERUISI_PANDAS_RUNNER_IMAGE", "")
    if not key_path or not Path(key_path).is_absolute() or not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise unavailable()
    try:
        key = read_key(key_path)
    except (OSError, ValueError, TypeError) as error:
        raise unavailable() from error
    if not 32 <= len(key) <= 128:
        raise unavailable()
    return key, image


def call_runner(job, configuration):
    key, expected_image = configuration
    raw = encode(validate_job(job))
    nonce, stamp = uuid.uuid4().hex, str(int(time.time()))
    connection = http.client.HTTPConnection("127.0.0.1", PORT, timeout=transport.remaining_budget(22))
    try:
        connection.request("POST", PATH, body=raw, headers={"Content-Type": "application/json",
            "X-Nonce": nonce, "X-Timestamp": stamp, "X-Signature": signature(key, stamp, nonce, raw)})
        owned_socket = connection.sock
        stop = transport.watch_socket_cancellation(lambda: owned_socket) if owned_socket else lambda: None
        try:
            response = connection.getresponse()
            body = response.read(MAX_OUTPUT + 1025)
        finally:
            stop()
        if (response.status != 200 or len(body) > MAX_OUTPUT + 1024
                or response.getheader("Content-Type") != "application/json"
                or not hmac.compare_digest(response.getheader("X-Signature", ""), signature(key, stamp, nonce, body, "response"))):
            raise unavailable()
        value = decode(body)
        if (set(value) != {"result", "image", "cleanupVerified"} or value["image"] != expected_image
                or value["cleanupVerified"] is not True):
            raise unavailable()
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


def export_frames(inputs, principal, request_id, surface):
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 3:
        raise AiError("一次分析需要 1 至 3 个数据集")
    frames, sources = {}, []
    for item in inputs:
        fields(item, {"name", "dataset", "query", "collection"}, {"name", "dataset", "query"})
        name, dataset = item["name"], item["dataset"]
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", name) or name in frames:
            raise AiError("数据集别名无效或重复")
        if not isinstance(dataset, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", dataset):
            raise AiError("dataset 无效")
        query = item["query"]
        if not isinstance(query, dict) or set(query) & {"cursor", "textOffset"}:
            raise AiError("导出必须从完整范围第一页开始")
        path = item.get("collection", "rows" if dataset.startswith("rows_") else "items")
        if not isinstance(path, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,3}", path):
            raise AiError("collection 无效")
        records = dataset in datasets.record_catalog.SPECS
        if records and path != "rows":
            raise AiError("逐行数据集必须使用 rows")
        args = dict(query)
        rows, cursors, pages, first, last = [], set(), 0, None, None
        while True:
            transport.remaining_budget()
            if pages >= 20:
                raise AiError("导出超过 20 页，请缩小筛选范围", "payload_too_large", 413)
            # Reuses discovery, current principal, field grants, freshness and
            # central per-source audit on every page; cannot choose SQL or URLs.
            envelope = datasets.query(dataset, {"query": args}, principal,
                                      f"{request_id[:80]}.export.{len(sources)}.{pages}", surface=surface)
            first = first or envelope
            last = envelope
            data = envelope["data"]
            parent, current = collection(data, path)
            pages += 1
            if records:
                if (type(data.get("hasMore")) is not bool or data.get("truncatedFields")
                        or any(v.get("nextOffset") is not None for v in data.get("cellWindows", {}).values())):
                    raise AiError("源字段不完整，不能用于 pandas 分析")
                more, cursor = data["hasMore"], data.get("nextCursor")
                if (more and (not current or not isinstance(cursor, str) or not cursor or cursor in cursors)
                        or not more and (cursor is not None or data.get("truncated"))):
                    raise AiError("源分页或截断状态不一致")
            else:
                # Native tools have heterogeneous paging. Only explicitly complete
                # collections are admitted; never invent an offset/page contract.
                complete = parent.get("truncated") is False or parent.get("hasMore") is False
                total = parent.get("totalMatched", parent.get("total"))
                if not complete or incomplete(data) or type(total) is int and total != len(current):
                    raise AiError("分析数据集未证明完整返回，请缩小范围或使用逐行数据集")
                more, cursor = False, None
            rows.extend(current)
            frames[name] = rows
            if sum(len(v) for v in frames.values()) > MAX_ROWS or len(encode(frames)) > MAX_INPUT - MAX_CODE:
                raise AiError("导出超过 2000 行或 2 MiB，请缩小范围", "payload_too_large", 413)
            if not more:
                break
            cursors.add(cursor)
            args = {**query, "cursor": cursor}
        sources.append({"name": name, "dataset": dataset, "collection": path, "query": query,
            "source": first["source"], "dataCutoffDate": last.get("dataCutoffDate"),
            "queriedAt": first.get("queriedAt"), "completedAt": last.get("queriedAt"),
            "freshness": first.get("freshness"), "rows": len(rows), "pages": pages,
            "sha256": hashlib.sha256(encode(rows)).hexdigest(), "complete": True,
            "consistency": "live_per_page" if records else "live_per_source"})
    return frames, sources


def run(payload, principal, request_id):
    fields(payload, {"operation", "inputsJson", "code", "surface"}, {"operation", "inputsJson", "code", "surface"})
    if payload["surface"] not in {"ai_chat", "dingtalk_chat"}:
        raise AiError("pandas 分析入口无效", "access_denied", 403)
    principal = current_principal(principal)
    if principal.role not in {"analyst", "operator", "admin"}:
        raise AiError("当前账号不能运行 pandas 分析", "access_denied", 403)
    configuration = config()  # Missing container configuration fails before export.
    raw, code = payload["inputsJson"], payload["code"]
    if not isinstance(raw, str) or len(raw.encode()) > 16000 or not isinstance(code, str) or not 1 <= len(code.encode()) <= MAX_CODE:
        raise AiError("数据集参数或 pandas 代码超限")
    try:
        inputs = decode(raw)
    except (ValueError, RecursionError) as error:
        raise AiError("inputsJson 必须是有效 JSON 数组") from error
    if not _slots.acquire(blocking=False):
        raise AiError("pandas 沙箱繁忙，请稍后再发起分析", "rate_limited", 429)
    try:
        with transport.request_budget(8):
            frames, sources = export_frames(inputs, principal, request_id, payload["surface"])
        current = current_principal(principal)
        if current.role != principal.role or not scope_covers(current.scope, principal.scope):
            raise AiError("分析期间账号权限已变化", "access_denied", 403)
        try:
            job = validate_job({"code": code, "frames": frames})
        except ValueError as error:
            raise AiError("数据字段或大小不符合 pandas 输入契约") from error
        result = call_runner(job, configuration)
        # Revocation during execution also suppresses results and artifacts.
        current = current_principal(principal)
        if current.role != principal.role or not scope_covers(current.scope, principal.scope):
            raise AiError("分析期间账号权限已变化", "access_denied", 403)
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
