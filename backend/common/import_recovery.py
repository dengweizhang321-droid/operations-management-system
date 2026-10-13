"""Read-only reconciliation over domain-owned import audits, never a claim.

Missing/expired sessions do not establish absence of a committed import.
The caller owns permission/scope validation and provides exact audit queries.
"""
from datetime import date
import hashlib
import json
from pathlib import Path
import re

HEX = re.compile(r"^[0-9a-f]{64}$")
GUARD_FINGERPRINT = re.compile(r"(?:^|:)jky-recovery-v1:([A-Za-z0-9._-]{1,96}):(products|inventory|inventory_age|sales|combos):([a-f0-9]{64}):([a-f0-9]{64}|initial)$")


def recovery_rules_digest(domain):
    """Bounded public code/rule identity; no credentials or business values.

    Published runtime manifests cover the complete deployed dependency closure.
    Source tests also bind the actual domain code and its packaged JSON rules.
    This is an identity comparison, never a second business version or claim.
    """
    if domain not in {"erp_reference", "inventory", "sales"}:
        raise ValueError("恢复规则所属域无效")
    root = Path(__file__).resolve().parents[1]
    files = [Path(__file__).resolve(), *sorted((root / domain).glob("*.py")), *sorted((root / domain).glob("*.json"))]
    if len(files) > 100:
        raise ValueError("恢复规则文件超过上限")
    digest = hashlib.sha256(b"import-recovery-rules-v1\n")
    for file in files:
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("恢复规则文件身份无效")
        data = file.read_bytes()
        digest.update(str(file.relative_to(root)).replace("\\", "/").encode("utf8") + b"\0" + hashlib.sha256(data).digest())
    manifest = root.parent / "deployment.json"
    if manifest.exists():
        if manifest.is_symlink() or manifest.stat().st_size > 65536:
            raise ValueError("恢复规则部署身份无效")
        value = json.loads(manifest.read_text(encoding="utf-8-sig"))
        if not isinstance(value, dict) or not HEX.fullmatch(value.get("appFingerprint") or ""):
            raise ValueError("恢复规则部署摘要缺失")
        digest.update(value["appFingerprint"].encode("ascii"))
    return digest.hexdigest()


def fingerprint_baseline(value, module, raw_hash):
    if "jky-recovery-v1:" not in value:
        return None
    match = GUARD_FINGERPRINT.search(value)
    if not match or match[2] != module or match[3] != raw_hash:
        raise ValueError("恢复上传与原文件身份不一致")
    return match[4]


def lock_upload_guard(guard, model, actor_email, module, raw_hash):
    if guard is None:
        return None
    if not isinstance(guard, dict) or set(guard) != {"uploadId", "ownerToken", "ownerGeneration"}:
        raise ValueError("发布所有权证明字段无效")
    if not isinstance(guard["ownerToken"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,64}", guard["ownerToken"]):
        raise ValueError("发布 owner token 无效")
    if isinstance(guard["ownerGeneration"], bool) or not isinstance(guard["ownerGeneration"], int):
        raise ValueError("发布 owner 代次无效")
    session = model.objects.select_for_update().filter(id=guard["uploadId"], actor_email=actor_email).first()
    if session is None or session.status != "processing" or session.owner_token != guard["ownerToken"] or session.owner_generation != guard["ownerGeneration"]:
        raise ValueError("发布所有权已变化")
    if hasattr(session, "source_key") and session.source_key != module or hasattr(session, "dataset") and session.dataset != ("stock" if module == "inventory" else "age"):
        raise ValueError("发布上传来源不一致")
    embedded = fingerprint_baseline(session.fingerprint, module, raw_hash)
    if embedded is not None:
        return embedded
    return session.result_payload.get("_publicationBaseline", {}).get("stateToken", "unproven")


def assert_scope_baseline(expected, actual):
    if expected is not None and expected != actual:
        raise ValueError("JACKYUN_SCOPE_VERSION_MANUAL_ACTION：原采集范围版本或处理规则已变化，禁止恢复旧数据；请核对当前批次和规则")


def upload_trace(guard, model, actor_email):
    if guard is None:
        return {"raw_upload_id": "", "upload_fingerprint": ""}
    session = model.objects.get(id=guard["uploadId"], actor_email=actor_email)
    return {"raw_upload_id": str(session.id), "upload_fingerprint": session.fingerprint}


def recovery_query(params, allowed_scope):
    allowed = {"recovery", "rawFileHash", "fileName", "fileSizeBytes", "fingerprint", *allowed_scope}
    if params.get("uploadId") is not None:
        allowed.add("uploadId")
    if set(params) - allowed or any(len(params.getlist(k)) != 1 for k in params):
        raise ValueError("恢复查询参数未知或重复")
    query = {key: params.get(key) for key in params}
    if query.get("recovery") not in {"scope", "result"}:
        raise ValueError("恢复查询必须为 scope 或 result")
    if query["recovery"] == "scope":
        if set(query) != {"recovery", *allowed_scope}:
            raise ValueError("范围版本查询字段无效")
    else:
        if set(query) != allowed or not HEX.fullmatch(query["rawFileHash"] or ""):
            raise ValueError("恢复查询缺少精确文件身份")
        size = query["fileSizeBytes"] or ""
        if not re.fullmatch(r"[1-9]\d{0,8}", size) or int(size) > 128 * 1024 * 1024:
            raise ValueError("恢复文件大小无效")
        if not query["fileName"] or len(query["fileName"]) > 255 or not query["fingerprint"] or len(query["fingerprint"]) > 255:
            raise ValueError("恢复文件或上传指纹无效")
        query["fileSizeBytes"] = int(size)
        if "uploadId" in query and not re.fullmatch(r"[a-f0-9-]{36}", query["uploadId"] or ""):
            raise ValueError("恢复上传标识无效")
    for key in {"snapshotDate", "startDate", "endDate"} & set(query):
        value = query[key]
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError("恢复日期无效")
    return query


def reconcile(*, attempts, sessions, batch_reader):
    audits = list(attempts[:101])
    uploads = list(sessions[:3])
    if len(audits) > 100 or len(uploads) > 1:
        return {"status": "unknown", "reason": "ambiguous_identity"}
    if any(a.outcome == "processing" for a in audits):
        return {"status": "waiting", "reason": "processing"}
    successes = [a for a in audits if a.outcome in {"imported", "duplicate"}]
    batches = {a.batch_id for a in successes}
    if len(batches) > 1 or "" in batches:
        return {"status": "unknown", "reason": "ambiguous_committed_batches"}
    if successes:
        batch = batch_reader(next(iter(batches)))
        if batch is None or batch.get("status") != "completed":
            return {"status": "unknown", "reason": "batch_evidence_missing"}
        if batch.pop("evidenceConflict", False):
            return {"status": "unknown", "reason": "current_evidence_conflict", "historicallyCommitted": True}
        current = batch.pop("currentEffective")
        return {"status": "committed_current" if current else "committed_superseded", "batch": batch,
                "outcomes": sorted({a.outcome for a in successes}), "historicallyCommitted": True,
                "currentEffective": current}
    if uploads:
        session = uploads[0]
        if session.status == "processing":
            return {"status": "waiting", "reason": "upload_processing"}
        if session.status in {"uploading", "ready"}:
            return {"status": "uncommitted_upload", "uploadId": str(session.id), "uploadStatus": session.status}
        return {"status": "unknown", "reason": "session_without_publication_proof"}
    return {"status": "unknown", "reason": "no_durable_publication_proof"}
