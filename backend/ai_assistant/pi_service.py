"""Authoritative Pi session, operation, event and passive file service."""
import base64
import hashlib
import json
import re
from pathlib import Path

from django.db import IntegrityError
from django.utils import timezone
from sales.auth import Principal
from .pi_models import PiSession, PiOperation, PiDispatch, PiEvent, PiFile
from .policy import (AiError, canonical, current_principal, digest, fields, identifier,
    integer, mutation, record, scope_covers, text, uid, valid_scope)

ACTIVE = {"queued", "running", "canceling", "unknown"}
TERMINAL = {"succeeded", "failed", "canceled", "frozen"}
SKILL_IDS = ("sales-promotion-inventory", "stock-replenishment", "excel-report")
MAX_INPUT_FILE = 512 * 1024
MAX_OUTPUT_FILE = 8 * 1024 * 1024
MIME_TYPES = {"text/plain", "text/csv", "text/markdown", "text/html", "application/json",
    "application/pdf", "application/zip", "application/octet-stream", "image/png", "image/jpeg", "image/webp",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def operation_record(row, *, skills_loaded=None):
    if skills_loaded is None:
        skills_loaded = PiDispatch.objects.filter(operation=row, kind="control:skills_loaded", status="completed").exists()
    return {**record(row, "id client_request_id kind status epoch generation seq model_id model_version error_code created_at updated_at"),
        "executionType": "pi_rpc", "skills": json.loads(row.skills_json), "skillsLoaded": skills_loaded}


def session_record(row):
    result = record(row, "id title status epoch generation active_operation_id created_at updated_at")
    result["createClientRequestId"] = row.client_request_id
    if row.status == "frozen":
        result["title"] = "已隔离会话"
    if row.status != "frozen":
        result["scope"] = json.loads(row.scope_json)
        result["shopSelection"] = json.loads(row.selection_json)
    return result


def file_record(row):
    return {**record(row, "id client_request_id file_name mime_type size_bytes sha256 direction created_at"),
        "operationId": row.operation_id, "manifest": json.loads(row.manifest_json)}


def event(session, kind, data, operation=None):
    # Caller owns the session lock inside the AI authority transaction.
    encoded = canonical(data)
    if len(encoded.encode()) > 4 * 1024 * 1024 - 32768:
        raise AiError("Pi 单条事件超过传输边界，未截断保存", "payload_too_large", 413)
    session.event_seq += 1
    session.updated_at = timezone.now()
    session.save(update_fields=["event_seq", "updated_at"])
    return PiEvent.objects.create(id=uid("pi-event"), session=session, operation=operation,
        generation=session.generation, event_seq=session.event_seq, event_type=kind, data_json=encoded)


def _owner(session, principal):
    if session.owner_email != principal.email.lower():
        raise AiError("Pi 会话不存在", "not_found", 404)


def _freeze(session):
    # Changing permissions must quarantine the old environment before any byte
    # or context is returned. Unknown effects retain the active session fence.
    if session.status != "frozen":
        operation = PiOperation.objects.filter(id=session.active_operation_id).first()
        if operation and operation.status in ACTIVE:
            operation.status = "unknown"
            operation.error_code = operation.error_code or "pi_permission_changed"
            operation.capability_hash = ""
            operation.save(update_fields=["status", "error_code", "capability_hash"])
            request_freeze(operation)
        session.status = "frozen"
        session.save(update_fields=["status"])
        event(session, "environment_frozen", {"reason": "permission_changed"})


def request_freeze(operation):
    PiDispatch.objects.get_or_create(operation=operation, kind="control:freeze", request_id="dispose",
        defaults={"id": uid("pi-freeze"), "request_digest": digest({"operationId": operation.id, "action": "dispose"}), "status": "prepared"})


def get_session(session_id, principal, *, lock=False):
    current_principal(principal)
    query = PiSession.objects.select_for_update() if lock else PiSession.objects
    row = query.filter(id=identifier(session_id)).first()
    if not row:
        raise AiError("Pi 会话不存在", "not_found", 404)
    _owner(row, principal)
    if row.actor_role != principal.role or not scope_covers(principal.scope, row.scope_json):
        with mutation():
            row = PiSession.objects.select_for_update().get(pk=row.pk)
            _freeze(row)
    return row


def create_session(payload, principal):
    from . import pi_selection
    fields(payload, {"clientRequestId", "title", "scope", "shopSelection"}, {"clientRequestId"})
    key = identifier(payload["clientRequestId"], "clientRequestId")
    title = text(payload.get("title", "新对话"), "标题", 160)
    scope = payload.get("scope", principal.scope)
    if not valid_scope(scope) or not scope_covers(principal.scope, scope):
        raise AiError("会话范围超出当前授权", "access_denied", 403)
    selection = pi_selection.normalize(payload.get("shopSelection"), principal)
    binding = digest({"payload": payload, "scope": scope, "role": principal.role, "shopSelection": selection})
    with mutation(principal):
        existing = PiSession.objects.filter(owner_email=principal.email.lower(), client_request_id=key).first()
        if existing:
            if existing.request_digest != binding:
                raise AiError("请求标识已绑定其他内容", "conflict", 409)
            return {"session": session_record(existing), "replayed": True}
        row = PiSession.objects.create(id=uid("pi-session"), owner_email=principal.email.lower(),
            actor_role=principal.role, client_request_id=key, request_digest=binding, title=title,
            scope_json=canonical(scope), selection_json=canonical(selection))
        event(row, "session_created", {})
        return {"session": session_record(row), "replayed": False}


def listing(params, principal):
    fields(params, {"limit"})
    limit = number(params.get("limit", "30"), "limit", 1, 100)
    current_principal(principal)
    rows = list(PiSession.objects.filter(owner_email=principal.email.lower()).order_by("-updated_at", "id")[:limit + 1])
    items = []
    for row in rows[:limit]:
        row = get_session(row.id, principal)
        value = session_record(row)
        if row.status == "frozen":
            value["title"] = "已隔离会话"
        items.append(value)
    return {"items": items, "hasMore": len(rows) > limit}


def detail(session_id, principal):
    row = get_session(session_id, principal)
    if row.status == "frozen":
        return {"session": {**session_record(row), "title": "已隔离会话"}, "operations": [], "files": []}
    operations = list(PiOperation.objects.filter(session=row, generation=row.generation).order_by("-seq")[:100])
    loaded_ids = set(PiDispatch.objects.filter(operation_id__in=[op.id for op in operations], kind="control:skills_loaded", status="completed").values_list("operation_id", flat=True))
    return {"session": session_record(row),
        "operations": [operation_record(op, skills_loaded=op.id in loaded_ids) for op in operations],
        "files": [file_record(f) for f in PiFile.objects.filter(session=row, generation=row.generation).defer("payload").order_by("-created_at")[:100]],
        "controlRequests": [{"clientRequestId": d.request_id, "operationId": d.operation_id, "status": d.status}
            for d in PiDispatch.objects.filter(operation__session=row, operation__generation=row.generation, kind="client:abort").order_by("-created_at")[:100]]}


def number(value, name, lo, hi):
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,12}", value):
        value = int(value)
    return integer(value, name, lo, hi)


def events(session_id, params, principal):
    fields(params, {"after", "limit"})
    after, limit = number(params.get("after", "0"), "after", 0, 2**53-1), number(params.get("limit", "100"), "limit", 1, 200)
    session = get_session(session_id, principal)
    if session.status == "frozen":
        return {"items": [], "after": after, "hasMore": False, "session": {**session_record(session), "title": "已隔离会话"}}
    rows = list(PiEvent.objects.filter(session=session, generation=session.generation, event_seq__gt=after).order_by("event_seq")[:limit+1])
    items, used = [], 0
    for row in rows[:limit]:
        item = {"eventSeq": row.event_seq, "operationId": row.operation_id, "type": row.event_type,
            "data": json.loads(row.data_json), "createdAt": row.created_at.isoformat()}
        size = len(canonical(item).encode())
        if items and used + size > 1024 * 1024:
            break
        items.append(item)
        used += size
    return {"items": items,
        "after": items[-1]["eventSeq"] if items else after, "hasMore": len(rows)>len(items),
        "session": session_record(session)}


def skills():
    from pi_runner.skills import build
    import os
    version = os.getenv("PI_SKILL_VERSION", "1.0.0")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise AiError("Pi 技能配置版本无效", "pi_skills_unavailable", 503)
    root = Path(__file__).resolve().parents[1] / "pi_runner" / "bundled_skills" / version
    if not root.is_dir():
        raise AiError("Pi 技能配置未部署", "pi_skills_unavailable", 503)
    try:
        manifest = build(root)
        items = []
        for item in manifest["skills"]:
            source = (root / item["id"] / "SKILL.md").read_text(encoding="utf-8")
            head = source.split("---", 2)[1]
            name = re.search(r"^name:\s*(.+)$", head, re.M)
            description = re.search(r"^description:\s*(.+)$", head, re.M)
            if not name or not description:
                raise ValueError("skill_frontmatter_missing")
            items.append({**item, "name": name[1], "description": description[1], "status": "available", "discovery": "configured_bundle"})
        return items
    except (OSError, ValueError, TypeError) as error:
        raise AiError("Pi 技能发现失败，未加载技能", "pi_skills_unavailable", 503) from error


def prompt(session_id, payload, principal):
    from . import pi_selection
    fields(payload, {"clientRequestId", "message", "modelId", "skillIds", "scope", "fileIds", "shopSelection"}, {"clientRequestId", "message"})
    key, message = identifier(payload["clientRequestId"], "clientRequestId"), text(payload["message"], "消息", 200000)
    existing_session = get_session(session_id, principal)
    scope = payload.get("scope", json.loads(existing_session.scope_json) if existing_session.status != "frozen" else principal.scope)
    if not valid_scope(scope) or not scope_covers(principal.scope, scope):
        raise AiError("本轮数据范围超出当前授权", "access_denied", 403)
    selection = pi_selection.normalize(payload.get("shopSelection", json.loads(existing_session.selection_json)), principal)
    skill_ids, file_ids = payload.get("skillIds", []), payload.get("fileIds", [])
    if (not isinstance(skill_ids, list) or len(skill_ids)>3 or len(set(skill_ids)) != len(skill_ids)
            or any(item not in SKILL_IDS for item in skill_ids) or not isinstance(file_ids, list) or len(file_ids)>16):
        raise AiError("技能或文件标识无效")
    from . import configuration
    model = configuration.resolve_model(payload.get("modelId"))
    binding = digest({"payload": payload, "scope": scope, "role": principal.role, "shopSelection": selection})
    with mutation(principal):
        session = get_session(session_id, principal, lock=True)
        prior = PiOperation.objects.filter(session=session, client_request_id=key).first()
        if prior:
            if prior.request_digest != binding:
                raise AiError("请求标识已绑定其他内容", "conflict", 409)
            if prior.generation != session.generation or session.status == "frozen":
                raise AiError("旧环境已隔离", "access_denied", 403)
            return {"session": session_record(session), "operation": operation_record(prior), "replayed": True}
        if PiOperation.objects.filter(session=session, status__in=ACTIVE).exists():
            raise AiError("会话已有执行或未知操作，请观察原操作", "pi_operation_active", 409)
        # A scope change starts a clean environment; no context or file is reused.
        if session.status == "frozen" or canonical(scope) != session.scope_json or canonical(selection) != session.selection_json or session.actor_role != principal.role:
            session.epoch += 1
            session.generation += 1
            session.runner_event_seq = 0
            session.scope_json, session.actor_role = canonical(scope), principal.role
            session.selection_json = canonical(selection)
        files = []
        for file_id in file_ids:
            f = PiFile.objects.filter(id=identifier(file_id), session=session, generation=session.generation, direction="input").first()
            if not f or not scope_covers(scope, f.scope_json):
                raise AiError("文件不在本轮授权范围", "access_denied", 403)
            files.append(f.id)
        if sum(PiFile.objects.get(id=f).size_bytes for f in files)>MAX_OUTPUT_FILE:
            raise AiError("本轮附件超过 8 MiB", "payload_too_large", 413)
        selected = [item for item in skills() if item["id"] in skill_ids]
        if any(item["status"] != "available" for item in selected):
            raise AiError("所选技能尚未安装", "service_unavailable", 503)
        session.operation_seq += 1
        op = PiOperation.objects.create(id=uid("pi-op"), session=session, client_request_id=key, request_digest=binding,
            epoch=session.epoch, generation=session.generation, seq=session.operation_seq, actor_role=principal.role,
            scope_json=canonical(scope), model_id=model.id, model_version=model.version,
            skills_json=canonical(selected), payload_json=canonical({"message": message, "fileIds": files, "skillIds": skill_ids, "shopSelection": selection}))
        session.active_operation_id, session.status = op.id, "queued"
        session.save()
        event(session, "user_message", {"text": message}, op)
        event(session, "status", {"status": "queued"}, op)
        return {"session": session_record(session), "operation": operation_record(op), "replayed": False}


def abort(session_id, payload, principal):
    fields(payload, {"clientRequestId"}, {"clientRequestId"})
    identifier(payload["clientRequestId"], "clientRequestId")
    get_session(session_id, principal)
    with mutation(principal):
        session = get_session(session_id, principal, lock=True)
        prior = PiDispatch.objects.filter(operation__session=session, kind="client:abort", request_id=payload["clientRequestId"]).first()
        if prior:
            return {"session": session_record(session), "operation": operation_record(prior.operation), "replayed": True}
        op = PiOperation.objects.filter(id=session.active_operation_id).first()
        if not op or op.status not in ACTIVE:
            return {"session": session_record(session), "operation": operation_record(op) if op else None}
        op.cancel_requested = True
        # A request to stop cannot resolve an unknown POST or release its fence.
        if op.status == "queued":
            op.status = "canceled"
            session.active_operation_id, session.status = "", "idle"
            session.save()
        elif op.status != "unknown":
            op.status, session.status = "canceling", "canceling"
            session.save()
        op.updated_at = timezone.now()
        op.save()
        PiDispatch.objects.create(id=uid("pi-control"), operation=op, kind="client:abort", request_id=payload["clientRequestId"],
            request_digest=digest(payload), status="completed", completed_at=timezone.now())
        event(session, "status", {"status": op.status}, op)
        return {"session": session_record(session), "operation": operation_record(op)}


def safe_file(file_name, mime_type, raw, maximum):
    name = text(file_name, "文件名", 160)
    if name in {".", ".."} or re.search(r'[\\/:<>"|?*\x00-\x1f]', name) or name.endswith((".", " ")):
        raise AiError("文件名无效")
    if mime_type not in MIME_TYPES or not isinstance(raw, bytes) or not 0 < len(raw) <= maximum:
        raise AiError("文件类型或大小无效", "payload_too_large", 413)
    return name


def save_file(session, operation, key, file_name, mime_type, raw, *, direction="input", manifest=None, request_binding=None):
    if not isinstance(mime_type, str) or not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", mime_type) or len(mime_type)>160:
        raise AiError("文件 MIME 类型无效")
    declared_mime = mime_type
    mime_type = mime_type if mime_type in MIME_TYPES else "application/octet-stream"
    source_path = None
    if direction != "input" and isinstance(file_name, str) and "/" in file_name:
        parts = file_name.split("/")
        if len(file_name)>500 or any(part in {"", ".", ".."} for part in parts) or "\\" in file_name:
            raise AiError("产物来源路径无效")
        source_path, file_name = file_name, parts[-1]
        file_name = hashlib.sha256(source_path.encode()).hexdigest()[:12]+"-"+file_name[-147:]
    name = safe_file(file_name, mime_type, raw, MAX_INPUT_FILE if direction == "input" else MAX_OUTPUT_FILE)
    sha = hashlib.sha256(raw).hexdigest()
    identity = request_binding or digest({"name": name, "mime": declared_mime, "sourcePath": source_path, "sha": sha, "generation": session.generation})
    old = PiFile.objects.filter(session=session, client_request_id=key).first()
    if old:
        if old.request_digest != identity:
            raise AiError("文件请求标识已绑定其他内容", "conflict", 409)
        return old
    description = {"owner": session.owner_email, "conversationId": session.id, "operationId": operation.id if operation else None,
        "generation": session.generation, "sizeBytes": len(raw), "mimeType": mime_type, "declaredMimeType": declared_mime,
        "sourcePath": source_path, "sha256": sha, **(manifest or {})}
    f = PiFile.objects.create(id=uid("pi-file"), session=session, operation=operation, owner_email=session.owner_email,
        client_request_id=key, request_digest=identity, generation=session.generation, scope_json=operation.scope_json if operation else session.scope_json,
        file_name=name, mime_type=mime_type, size_bytes=len(raw), sha256=sha, direction=direction, manifest_json=canonical(description), payload=raw)
    event(session, "file_ready", {"file": file_record(f)}, operation)
    return f


def upload(session_id, payload, principal):
    fields(payload, {"clientRequestId", "fileName", "mimeType", "base64"}, {"clientRequestId", "fileName", "mimeType", "base64"})
    key = identifier(payload["clientRequestId"])
    if not isinstance(payload["base64"], str) or len(payload["base64"])>(MAX_INPUT_FILE+2)//3*4:
        raise AiError("附件超过 512 KiB", "payload_too_large", 413)
    try:
        raw = base64.b64decode(payload["base64"], validate=True)
    except (ValueError, TypeError) as error:
        raise AiError("文件不是有效 base64") from error
    get_session(session_id, principal)
    with mutation(principal):
        session = get_session(session_id, principal, lock=True)
        if session.status == "frozen":
            raise AiError("旧环境已隔离，请开始新会话", "access_denied", 403)
        binding = digest({"payload": payload, "scope": principal.scope, "role": principal.role, "generation": session.generation})
        return {"file": file_record(save_file(session, None, key, payload["fileName"], payload["mimeType"], raw, request_binding=binding))}


def download(file_id, principal, *, content=False):
    f = PiFile.objects.filter(id=identifier(file_id)).first()
    if not f:
        raise AiError("文件不存在", "not_found", 404)
    session = get_session(f.session_id, principal)
    if session.status == "frozen" or session.generation != f.generation or not scope_covers(principal.scope, f.scope_json):
        raise AiError("文件不在当前授权范围", "not_found", 404)
    if not content:
        return {"file": file_record(f)}
    raw = bytes(f.payload)
    if len(raw) != f.size_bytes or hashlib.sha256(raw).hexdigest() != f.sha256:
        raise AiError("文件完整性核验失败", "service_unavailable", 503)
    return {"base64": base64.b64encode(raw).decode(), "mimeType": f.mime_type, "fileName": f.file_name, "sha256": f.sha256}


def principal_for(operation):
    session = PiSession.objects.get(id=operation.session_id)
    value = Principal(session.owner_email, session.owner_email, operation.actor_role, json.loads(operation.scope_json))
    try:
        value = current_principal(value, write=True, background=True)
        if (session.epoch, session.generation, session.active_operation_id) != (operation.epoch, operation.generation, operation.id):
            raise AiError("Pi 执行代际已失效", "access_denied", 403)
        if session.status == "frozen" or operation.status not in {"running", "canceling"}:
            raise AiError("Pi 执行权限已冻结", "access_denied", 403)
        return value
    except AiError:
        with mutation():
            locked = PiSession.objects.select_for_update().get(id=session.id)
            if (locked.active_operation_id, locked.epoch, locked.generation) == (operation.id, operation.epoch, operation.generation):
                _freeze(locked)
        raise
