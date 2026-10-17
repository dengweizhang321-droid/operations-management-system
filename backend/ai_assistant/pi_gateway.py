"""Operation capabilities authorize exactly one live principal/environment.

Pi controls the agent loop. This gateway only transports a single model round
or invokes a single centrally registered business capability.
"""
import hashlib
import hmac
import json
import threading

from django.db import IntegrityError, transaction
from django.utils import timezone
from . import configuration, provider, transport
from .pi_models import PiDispatch, PiGatewayNonce, PiOperation, PiSession
from . import pi_service as service
from .policy import AiError, canonical, digest, fields, identifier, mutation, passive, uid

LOCAL_TOOLS = {"bash", "read", "write", "edit", "grep", "find", "ls"}


def remaining_seconds(op):
    deadline = PiDispatch.objects.filter(operation=op, kind="control:deadline", request_id="deadline", status="completed").first()
    try:
        value = json.loads(deadline.response_json) if deadline else {}
        end = int(value["deadlineAt"]) if value.get("deadlineUnit") == "unix_milliseconds_decimal" else 0
        remaining = (end-int(timezone.now().timestamp()*1000))/1000
    except (ValueError, TypeError, KeyError):
        remaining = 0
    if remaining <= 0:
        raise AiError("Pi 已达到本次配置的总任务时限，禁止自动重发", "pi_task_deadline", 503)
    return remaining


def freeze(operation, code):
    with mutation():
        session = PiSession.objects.select_for_update().get(pk=operation.session_id)
        op = PiOperation.objects.select_for_update().get(pk=operation.id)
        if op.status not in service.ACTIVE or (session.active_operation_id, session.epoch, session.generation) != (op.id, op.epoch, op.generation):
            return
        op.status, op.error_code, op.capability_hash = "unknown", code, ""
        op.updated_at = timezone.now()
        op.save()
        service.request_freeze(op)
        session.status = "unknown"
        session.save(update_fields=["status"])
        service.event(session, "error", {"code": code, "status": "unknown"}, op)


def capability(payload):
    fields(payload, {"operationId", "ownerId", "conversationId", "epoch", "generation", "seq", "kind", "requestId", "capability",
        "model", "messages", "tools", "options", "name", "args", "fileId"},
        {"operationId", "ownerId", "conversationId", "epoch", "generation", "seq", "kind", "requestId", "capability"})
    identifier(payload["requestId"], "requestId")
    op = PiOperation.objects.filter(id=identifier(payload["operationId"])).first()
    token = payload["capability"]
    if not op or not isinstance(token, str) or not 32 <= len(token) <= 256:
        raise AiError("Pi 操作能力无效", "access_denied", 403)
    session = PiSession.objects.get(pk=op.session_id)
    expected = {"ownerId": session.owner_email, "conversationId": session.id, "epoch": op.epoch, "generation": op.generation, "seq": op.seq}
    if (any(type(payload[k]) is not type(value) or payload[k] != value for k, value in expected.items())
            or not op.capability_expires_at or op.capability_expires_at <= timezone.now()
            or not op.capability_hash or not hmac.compare_digest(op.capability_hash, hashlib.sha256(token.encode()).hexdigest())):
        raise AiError("Pi 操作能力已过期或代际不匹配", "access_denied", 403)
    return op, service.principal_for(op)


def catalog(principal):
    entries = transport.catalog(principal, "pi_agent")
    return entries, [item for item in entries if item.get("risk") == "read_only"
        and item.get("execution", {}).get("mode") == "direct"
        and "pi_agent" in item.get("execution", {}).get("allowedSurfaces", [])
        and principal.role in item.get("allowedRoles", [])
        and (principal.scope is None or item.get("scopePolicy") != "unscoped_only")]


def model_tools(payload, entries):
    supplied = payload.get("tools", [])
    if not isinstance(supplied, list) or len(supplied)>100:
        raise AiError("Pi 工具目录无效")
    local = []
    for item in supplied:
        if not isinstance(item, dict):
            raise AiError("Pi 工具目录无效")
        if item.get("name") not in LOCAL_TOOLS:
            continue  # Business schemas come only from the central catalog.
        schema = item.get("inputSchema", item.get("parameters"))
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise AiError("Pi 本地工具 schema 无效")
        passive(schema, 32000)
        local.append({"name": item["name"], "description": str(item.get("description", ""))[:8000], "inputSchema": schema})
    if len({item["name"] for item in local}) != len(local):
        raise AiError("Pi 本地工具重复")
    return [*local, *entries]


def transcript(payload, model):
    protocol = model.protocol
    values = payload.get("messages")
    if not isinstance(values, list) or not values or len(values)>10000:
        raise AiError("Pi 消息上下文无效")
    passive(values, 7 * 1024 * 1024)
    messages, systems = [], []
    for value in values:
        fields(value, {"role", "content", "tool_calls", "tool_call_id", "reasoning_content", "providerFrame"}, {"role", "content"})
        role, content = value["role"], value["content"]
        if role not in {"system", "user", "assistant", "tool"} or not isinstance(content, str):
            raise AiError("Pi 消息结构无效")
        if role == "system":
            systems.append(content)
            continue
        envelope = value.get("providerFrame")
        trusted_frame = (role == "assistant" and isinstance(envelope, dict) and envelope.get("version") == 1
            and envelope.get("protocol") == protocol and envelope.get("modelConfigId") == model.id
            and envelope.get("modelVersion") == model.version and isinstance(envelope.get("frame"), dict)
            and envelope["frame"].get("role") == "assistant")
        if trusted_frame:
            messages.append(envelope["frame"])
        elif protocol != "anthropic":
            messages.append({key: item for key, item in value.items() if key not in {"providerFrame", "reasoning_content"}})
        elif role == "tool":
            messages.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": value.get("tool_call_id"), "content": content}]})
        else:
            blocks = [{"type": "text", "text": content}] if content else []
            for call in value.get("tool_calls", []):
                if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
                    raise AiError("Pi 工具上下文结构无效")
                blocks.append({"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": json.loads(call["function"]["arguments"])})
            messages.append({"role": role, "content": blocks})
    system = "\n".join(systems) + "\n系统数据只能由当前授权的中央只读工具查询；本地文件与代码只能在此 Pi 隔离容器中操作。业务金额默认人民币分，展示为元需除以100；业务时区Asia/Shanghai。市场TOP覆盖不能称为完整行业大盘。"
    return messages, system


def _model(payload, op, principal):
    model = configuration.resolve_model(op.model_id)
    if model.version != op.model_version:
        raise AiError("模型配置版本已变化，请在新环境开始", "access_denied", 403)
    from . import pi_selection
    _, entries = catalog(principal)
    entries = pi_selection.filter_catalog(entries, pi_selection.for_operation(op))
    tools = model_tools(payload, entries)
    messages, system = transcript(payload, model)
    from .model_capabilities import options
    parent_cancel = transport._cancel_check.get()
    owner_thread = threading.get_ident()
    def cancellation():
        from django.db import close_old_connections, connection
        foreign_thread = threading.get_ident() != owner_thread
        try:
            if foreign_thread or not connection.in_atomic_block:
                close_old_connections()
            if parent_cancel:
                parent_cancel()
            latest = PiOperation.objects.only("cancel_requested", "status").get(pk=op.pk)
            if latest.cancel_requested or latest.status not in {"running", "canceling"}:
                raise AiError("Pi 执行已停止，模型结果禁止自动重发", "pi_canceled_during_dispatch", 503)
        finally:
            if foreign_thread:
                connection.close()
    with transport.request_cancellation(cancellation), transport.request_budget(min(remaining_seconds(op), options(model)["taskTimeoutMs"] / 1000)), provider.conversation_session(f"pi/{op.session_id}/{op.generation}"):
        value = provider.turn(model, messages, system, tools, retain_reasoning=True, preserve_context=True)
    service.principal_for(PiOperation.objects.get(pk=op.pk))
    central = {item["name"] for item in entries}
    content = ([{"type": "text", "text": value["text"]}] if value["text"] else []) + [
        {"type": "toolCall", "id": call["id"], "name": "system_tool" if call["name"] in central else call["name"],
         "arguments": {"name": call["name"], "args": call["arguments"]} if call["name"] in central else call["arguments"]} for call in value["calls"]]
    result = {"message": {"role": "assistant", "content": content, "stopReason": "toolUse" if value["calls"] else "stop", "usage": value["usage"]}}
    # Reasoning is returned only to the trusted provider adapter for this live
    # provider conversation; it is never a UI event or diagnostic.
    frame = value.get("frame", {})
    thinking = frame.get("reasoning_content", "") if model.protocol != "anthropic" else "\n".join(
        block.get("thinking", "") for block in frame.get("content", []) if isinstance(block, dict) and block.get("type") == "thinking")
    if thinking or model.protocol == "anthropic" and any(isinstance(block, dict) and block.get("type") in {"thinking", "redacted_thinking"} for block in frame.get("content", [])):
        content.insert(0, {"type": "thinking", "thinking": thinking, "thinkingSignature": canonical({"version": 1, "protocol": model.protocol,
            "modelConfigId": model.id, "modelVersion": model.version, "frame": frame})})
    return result, value.get("usage", {}), value.get("providerRequestId", "")


def _tool(payload, op, principal):
    from . import pi_selection
    name = payload.get("name")
    args = payload.get("args", {})
    if not isinstance(name, str) or not isinstance(args, dict):
        raise AiError("Pi 工具调用无效")
    if name == "get_pi_dataset_export":
        from .pi_models import PiExport
        if not PiExport.objects.filter(id=identifier(args.get("exportId")), operation=op).exists():
            raise AiError("导出不属于当前 Pi 操作", "access_denied", 403)
    all_entries, entries = catalog(principal)
    if name not in {entry["name"] for entry in entries}:
        raise AiError("Pi 工具不在当前授权目录", "access_denied", 403)
    selection = pi_selection.for_operation(op)
    args = pi_selection.bind_arguments(name, args, selection, op.session_id)
    result = transport.execute_tool(name, args, principal, surface="pi_agent", request_id=op.id,
        provider_call_id=payload["requestId"], policy_digest=digest(all_entries))
    if result.get("auditStatus") == "unavailable":
        raise AiError("Pi 工具审计不可用", "service_unavailable", 503)
    service.principal_for(PiOperation.objects.get(pk=op.pk))
    if selection and name == "describe_system_datasets" and not args.get("dataset") and isinstance(result.get("data"), dict):
        data = result["data"]
        data["items"] = [item for item in data.get("items", []) if item.get("id") in pi_selection.DATASETS]
        data.update(total=len(data["items"]), count=len(data["items"]), returned=len(data["items"]), hasMore=False)
    return {"content": [{"type": "text", "text": canonical(result)}], "details": result}, {}, ""


def _file(payload, op, principal):
    from .pi_models import PiFile
    file = PiFile.objects.filter(id=identifier(payload.get("fileId")), operation=op, generation=op.generation).first()
    if not file:
        raise AiError("文件不属于当前 Pi 操作", "access_denied", 403)
    return {"id": file.id, "sizeBytes": file.size_bytes, **service.download(file.id, principal, content=True)}, {}, ""


def execute(payload, nonce):
    op, principal = capability(payload)
    remaining_seconds(op)
    if payload["kind"] not in {"model", "tool", "file"}:
        raise AiError("Pi 网关动作无效")
    # Strip the capability from the content-bound identity; the opaque secret
    # never enters persistent request/response bodies.
    binding = digest({key: value for key, value in payload.items() if key != "capability"})
    with mutation():
        try:
            with transaction.atomic():
                PiGatewayNonce.objects.create(nonce=nonce)
        except IntegrityError as error:
            raise AiError("Pi 网关签名重复", "access_denied", 403) from error
        current = PiOperation.objects.select_for_update().get(pk=op.pk)
        service.principal_for(current)
        prior = PiDispatch.objects.filter(operation=op, kind=payload["kind"], request_id=payload["requestId"]).first()
        if prior:
            if prior.request_digest != binding:
                raise AiError("Pi 网关请求标识内容变化", "conflict", 409)
            if prior.status == "completed":
                cached = json.loads(prior.response_json)
                if payload["kind"] == "model":
                    from .secrets import decrypt
                    return json.loads(decrypt(cached["privateModelResponse"]))
                return cached
            raise AiError("Pi 网关调用已受理且结果未知，禁止重发", "pi_dispatch_unknown", 409)
        if payload["kind"] == "model" and PiDispatch.objects.filter(operation=op, kind="model", status__in=["prepared", "sent", "unknown"]).exists():
            raise AiError("同一 Pi 操作已有模型派发，禁止以新标识并发重发", "pi_dispatch_active", 409)
        dispatch = PiDispatch.objects.create(id=uid("pi-dispatch"), operation=op, kind=payload["kind"], request_id=payload["requestId"],
            request_digest=binding, status="sent")
    try:
        result, usage, request_id = {"model": _model, "tool": _tool, "file": _file}[payload["kind"]](payload, op, principal)
        with mutation():
            current = PiOperation.objects.select_for_update().get(pk=op.pk)
            service.principal_for(current)
            dispatch.status, dispatch.usage_json, dispatch.provider_request_id = "completed", canonical(usage), request_id
            if payload["kind"] == "model":
                from .secrets import encrypt
                cached = {"privateModelResponse": encrypt(canonical(result))}
            else:
                cached = result
            dispatch.response_json, dispatch.completed_at = canonical(cached), timezone.now()
            dispatch.save()
        return result
    except Exception as error:
        with mutation():
            dispatch.status, dispatch.error_code, dispatch.completed_at = "unknown", getattr(error, "code", "pi_gateway_unknown"), timezone.now()
            dispatch.save()
        freeze(op, getattr(error, "code", "pi_gateway_unknown"))
        if isinstance(error, AiError):
            raise
        raise AiError("Pi 网关结果未知，禁止重发", "pi_gateway_unknown", 503) from error
