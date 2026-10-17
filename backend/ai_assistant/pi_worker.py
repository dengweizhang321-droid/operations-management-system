"""Independent Pi-only queue worker: python -m ai_assistant.pi_worker.

Run from backend with the AI writer's isolated runtime configuration. This
process never consumes AiAgentJobs or AiWorkflowRuns and never replays POSTs
whose outcome was not durably recorded.
"""
import base64
from datetime import timedelta
import hashlib
import json
import os
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "teruisi_backend.settings")


def identity(op):
    return {"operationId": op.id, "ownerId": op.session.owner_email, "conversationId": op.session_id,
        "epoch": op.epoch, "generation": op.generation, "seq": op.seq}


def runner_dispatch(op, command, payload, *, request_id=None):
    from django.utils import timezone
    from .pi_models import PiDispatch, PiOperation
    from .pi_gateway import freeze
    from . import pi_transport, pi_service as service
    from .policy import AiError, canonical, digest, mutation, uid
    request = {**identity(op), "command": command, "payload": payload}
    request_id = request_id or command
    binding = digest(request)
    with mutation():
        current = PiOperation.objects.get(pk=op.pk)
        service.principal_for(current)
        if command == "prompt" and current.cancel_requested:
            raise AiError("Pi 已在首次模型派发前停止", "pi_canceled_before_prompt", 409)
        prior = PiDispatch.objects.filter(operation=op, kind="runner:"+command, request_id=request_id).first()
        if prior:
            # create/prompt/abort/ack are each dispatched at most once. A sent
            # record after process death is not proof of non-delivery.
            if prior.request_digest != binding or prior.status != "completed":
                raise AiError("PiRunner 派发已受理且结果未知", "pi_dispatch_unknown", 409)
            from .secrets import decrypt
            return json.loads(decrypt(json.loads(prior.response_json)["encryptedRunnerResponse"]))
        dispatch = PiDispatch.objects.create(id=uid("pi-dispatch"), operation=op, kind="runner:"+command,
            request_id=request_id, request_digest=binding, status="sent")
    try:
        result = pi_transport.command(request)
        with mutation():
            from .secrets import encrypt
            dispatch.status, dispatch.response_json, dispatch.completed_at = "completed", canonical({"encryptedRunnerResponse": encrypt(canonical(result))}), timezone.now()
            dispatch.save()
        return result
    except Exception as error:
        with mutation():
            dispatch.status, dispatch.error_code, dispatch.completed_at = "unknown", getattr(error, "code", "pi_runner_unknown"), timezone.now()
            dispatch.save()
        freeze(op, getattr(error, "code", "pi_runner_unknown"))
        raise


def claim():
    from django.utils import timezone
    from .pi_models import PiOperation, PiSession, PiDispatch
    from . import pi_service as service
    from .policy import AiError, mutation, uid, canonical, digest
    with mutation():
        # Expired work is frozen in place. There is no automatic recovery claim.
        for old in PiOperation.objects.select_for_update().filter(status__in=["running", "canceling"], lease_expires_at__lt=timezone.now()):
            old.status, old.error_code, old.capability_hash = "unknown", "pi_worker_lost", ""
            old.save(update_fields=["status", "error_code", "capability_hash"])
            service.request_freeze(old)
            session = PiSession.objects.select_for_update().get(pk=old.session_id)
            session.status = "unknown"
            session.save(update_fields=["status"])
            service.event(session, "error", {"code": "pi_worker_lost", "status": "unknown"}, old)
        from .configuration import resolve_model
        from .model_capabilities import options
        while True:
            op = PiOperation.objects.select_for_update().filter(status="queued").order_by("created_at", "id").first()
            if not op:
                return None
            try:
                model = resolve_model(op.model_id)
                if model.version != op.model_version:
                    raise AiError("模型版本已变化", "pi_model_changed", 409)
                budget = options(model)["taskTimeoutMs"]
                if type(budget) is not int or not 1 <= budget <= 2**53-1:
                    raise AiError("模型任务时限无效", "pi_model_configuration", 400)
            except (AiError, ValueError, TypeError) as error:
                # No dispatch has occurred: this is a definite configuration
                # failure, not an unknown POST. Do not poison the FIFO queue.
                op.status, op.error_code = "failed", getattr(error, "code", "pi_model_configuration")
                op.save(update_fields=["status", "error_code"])
                session = PiSession.objects.select_for_update().get(pk=op.session_id)
                session.status, session.active_operation_id = "idle", ""
                session.save(update_fields=["status", "active_operation_id"])
                service.event(session, "error", {"code": op.error_code, "status": "failed"}, op)
                continue
            break
        op.status, op.lease_token, op.lease_expires_at = "running", uid("pi-lease"), timezone.now()+timedelta(seconds=120)
        op.save(update_fields=["status", "lease_token", "lease_expires_at"])
        started = timezone.now()
        deadline = {"startedAt": started.isoformat(), "deadlineAt": str(int(started.timestamp()*1000)+budget),
            "deadlineUnit": "unix_milliseconds_decimal", "taskTimeoutMs": budget}
        PiDispatch.objects.create(id=uid("pi-deadline"), operation=op, kind="control:deadline", request_id="deadline",
            request_digest=digest(deadline), response_json=canonical(deadline), status="completed", completed_at=started)
        session = PiSession.objects.select_for_update().get(pk=op.session_id)
        session.status = "running"
        session.save(update_fields=["status"])
        service.event(session, "status", {"status": "running"}, op)
        return op


def gateway_capability(op):
    from django.utils import timezone
    from .pi_models import PiOperation
    from .policy import AiError, mutation
    from .model_capabilities import options
    from .configuration import resolve_model
    url = os.getenv("PI_GATEWAY_URL", "http://127.0.0.1:8112/api/ai/pi/gateway")
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != 8112
            or parsed.path != "/api/ai/pi/gateway" or parsed.query or parsed.fragment or parsed.username):
        raise AiError("Pi 网关必须使用独立精确回环路径", "service_unavailable", 503)
    token = secrets.token_urlsafe(48)
    seconds = 300  # Renewable operation-bound capability; not a run timeout.
    with mutation():
        PiOperation.objects.filter(pk=op.pk, lease_token=op.lease_token, status="running").update(
            capability_hash=hashlib.sha256(token.encode()).hexdigest(), capability_expires_at=timezone.now()+timedelta(seconds=seconds))
    return {"url": url, "capability": token}


def ingest(op, result):
    from django.utils import timezone
    from .pi_models import PiOperation, PiSession
    from . import pi_service as service
    from .policy import AiError, canonical, mutation
    values = result.get("events", [])
    if not isinstance(values, list) or len(values)>1000:
        raise AiError("PiRunner 事件响应无效", "pi_runner_unknown", 503)
    settled = False
    with mutation():
        current = PiOperation.objects.select_for_update().get(pk=op.pk)
        service.principal_for(current)
        if current.lease_token != op.lease_token:
            raise AiError("Pi worker 租约失效", "pi_runner_unknown", 409)
        session = PiSession.objects.select_for_update().get(pk=op.session_id)
        for value in values:
            if not isinstance(value, dict) or type(value.get("eventSeq")) is not int:
                raise AiError("PiRunner 事件标识无效", "pi_runner_unknown", 503)
            seq = value["eventSeq"]
            if seq <= session.runner_event_seq:
                continue
            if seq != session.runner_event_seq+1:
                raise AiError("PiRunner 事件序号存在缺口", "pi_runner_unknown", 503)
            session.runner_event_seq = seq
            if value.get("operationId") != op.id or value.get("seq") != op.seq:
                # A late previous-run event cannot be attached to this run.
                continue
            kind = value.get("type", value.get("event", {}).get("type"))
            data = value.get("data", value.get("event", value))
            if not isinstance(data, dict):
                data = {}
            if kind == "agent_settled":
                settled = True
                service.event(session, "agent_settled", {"status": data.get("status", "settled")}, current)
            elif kind in {"text_delta", "assistant_message", "user_message"}:
                txt = data.get("text", data.get("delta", ""))
                if isinstance(txt, str):
                    service.event(session, kind, {"text": txt}, current)
            elif kind == "message_update":
                update = data.get("assistantMessageEvent", {})
                if isinstance(update, dict) and update.get("type") == "text_delta" and isinstance(update.get("delta"), str):
                    service.event(session, "text_delta", {"text": update["delta"]}, current)
            elif kind == "message_end":
                message = data.get("message", {})
                if isinstance(message, dict) and message.get("role") == "assistant":
                    content = message.get("content", [])
                    txt = "\n".join(block["text"] for block in content if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)) if isinstance(content, list) else ""
                    if txt:
                        service.event(session, "assistant_message", {"text": txt}, current)
            elif kind in {"tool_execution_start", "tool_execution_end"}:
                service.event(session, "tool_start" if kind.endswith("start") else "tool_end", {"name": str(data.get("toolName", ""))[:160]}, current)
            elif kind == "error":
                service.event(session, "error", {"code": "pi_agent_error"}, current)
        session.save(update_fields=["runner_event_seq"])
        current.lease_expires_at, current.updated_at = timezone.now()+timedelta(seconds=120), timezone.now()
        current.save(update_fields=["lease_expires_at", "updated_at"])
    return settled


def complete(op, result):
    from django.utils import timezone
    from .pi_models import PiOperation, PiSession, PiExport
    from . import pi_service as service
    from .policy import AiError, mutation
    status = result.get("status")
    if status not in {"settled", "handled", "failed", "aborted"} or result.get("hasMore") is True:
        return False
    receipt = result.get("terminalReceipt")
    if (result.get("filesCollected") is not True or not isinstance(receipt, dict) or receipt.get("operationId") != op.id
            or receipt.get("status") != status or type(receipt.get("eventSeq")) is not int):
        return False
    files = result.get("files", [])
    if not isinstance(files, list) or len(files)>30:
        raise AiError("PiRunner 文件响应无效", "pi_runner_unknown", 503)
    if receipt.get("files") != [item.get("sha256") for item in files if isinstance(item, dict)]:
        raise AiError("PiRunner 终态与文件清单不匹配", "pi_runner_unknown", 503)
    with mutation():
        current = PiOperation.objects.select_for_update().get(pk=op.pk)
        service.principal_for(current)
        session = PiSession.objects.select_for_update().get(pk=op.session_id)
        if receipt["eventSeq"] > session.runner_event_seq:
            return False
        if PiExport.objects.filter(operation=current, status__in=["queued", "running"]).exists():
            return False
        for index, item in enumerate(files):
            if not isinstance(item, dict) or not isinstance(item.get("base64"), str) or len(item["base64"])>12*1024*1024:
                raise AiError("PiRunner 文件内容无效", "pi_runner_unknown", 503)
            raw = base64.b64decode(item["base64"], validate=True)
            if hashlib.sha256(raw).hexdigest() != item.get("sha256"):
                raise AiError("PiRunner 文件哈希不匹配", "pi_runner_unknown", 503)
            service.save_file(session, current, f"{op.id}-{index}", item.get("fileName"), item.get("mimeType"), raw, direction="output")
        current.status = "canceled" if current.cancel_requested or status == "aborted" else "failed" if status == "failed" else "succeeded"
        current.capability_hash, current.lease_token, current.lease_expires_at = "", "", None
        current.updated_at = timezone.now()
        current.save()
        session.status, session.active_operation_id = "idle", ""
        session.save()
        service.event(session, "status", {"status": current.status}, current)
    return True


def heartbeat(op, stopped):
    from django.db import connections
    try:
        return _heartbeat_loop(op, stopped)
    finally:
        connections.close_all()


def _heartbeat_loop(op, stopped):
    from django.db import close_old_connections
    from django.utils import timezone
    from .pi_models import PiOperation
    from . import pi_service as service
    from .policy import AiError, current_principal, mutation
    from sales.auth import Principal
    while not stopped.wait(10):
        close_old_connections()
        try:
            with mutation():
                current = PiOperation.objects.select_for_update().get(pk=op.pk)
                from .pi_models import PiSession
                session = PiSession.objects.select_for_update().get(pk=op.session_id)
                if (current.lease_token != op.lease_token or current.status not in {"running", "canceling"}
                        or (session.active_operation_id, session.epoch, session.generation) != (op.id, op.epoch, op.generation)):
                    return
                try:
                    current_principal(Principal(session.owner_email, session.owner_email, current.actor_role, json.loads(current.scope_json)), write=True)
                except AiError:
                    service._freeze(session)
                    return
                current.lease_expires_at = timezone.now()+timedelta(seconds=120)
                current.capability_expires_at = timezone.now()+timedelta(seconds=300)
                current.save(update_fields=["lease_expires_at", "capability_expires_at"])
        except Exception:
            return


def bridge(op, result):
    """Only HMAC-authenticated runner state can supply bridge requests."""
    from . import pi_gateway
    from .policy import AiError
    pending = result.get("state", {}).get("pendingGatewayRequests", result.get("pendingGatewayRequests", []))
    if not isinstance(pending, list) or len(pending)>32:
        raise AiError("Pi 网关桥请求无效", "pi_runner_unknown", 503)
    for payload in pending:
        if not isinstance(payload, dict) or any(payload.get(key) != value for key, value in identity(op).items()):
            raise AiError("Pi 网关桥请求身份无效", "pi_runner_unknown", 503)
        response = pi_gateway.execute(payload, secrets.token_hex(16))
        runner_dispatch(op, "gateway_response", {"requestId": payload["requestId"], "response": response}, request_id=payload["requestId"])


def dispose_environment(operation, *, current=None):
    from django.utils import timezone
    from .pi_models import PiDispatch
    from . import pi_transport
    from .policy import AiError, canonical, digest, mutation, uid
    key = "generation-"+str(current.generation) if current else "dispose"
    kind = "control:rotate" if current else "control:freeze"
    with mutation():
        record, _ = PiDispatch.objects.get_or_create(operation=operation, kind=kind, request_id=key,
            defaults={"id": uid("pi-dispose"), "request_digest": digest({"operation": operation.id, "generation": key}), "status": "prepared"})
        if record.status == "completed":
            return
        if record.status != "prepared":
            raise AiError("旧 Pi 环境停止结果未知", "pi_cleanup_unknown", 409)
        record.status = "sent"
        record.save(update_fields=["status"])
    try:
        result = pi_transport.command({**identity(operation), "command": "dispose", "payload": {}})
        if result.get("status") != "disposed":
            raise AiError("旧 Pi 环境停止结果未知", "pi_cleanup_unknown", 503)
        with mutation():
            record.status, record.response_json, record.completed_at = "completed", canonical({"status": "disposed"}), timezone.now()
            record.save()
    except Exception:
        with mutation():
            record.status, record.error_code, record.completed_at = "unknown", "pi_cleanup_unknown", timezone.now()
            record.save()
        raise


def handled(result):
    return result.get("status") == "handled" and any(
        isinstance(event, dict) and event.get("type") == "response"
        and event.get("data", event).get("disposition") == "handled" for event in result.get("events", []))


def perform(op, stopped=None):
    from .pi_models import PiOperation, PiFile, PiSession
    from .pi_gateway import freeze
    from . import pi_service as service, pi_transport
    from .policy import AiError
    stopped = stopped or threading.Event()
    heartbeat_stopped = threading.Event()
    renewer = threading.Thread(target=heartbeat, args=(op, heartbeat_stopped), name="pi-operation-heartbeat", daemon=True)
    renewer.start()
    try:
        principal = service.principal_for(op)
        previous = PiOperation.objects.filter(session_id=op.session_id, generation__lt=op.generation).order_by("-generation", "-seq").first()
        if previous:
            dispose_environment(previous, current=op)
        gateway = gateway_capability(op)
        payload = json.loads(op.payload_json)
        selected = json.loads(op.skills_json)
        from .configuration import resolve_model
        from .model_capabilities import options
        model = resolve_model(op.model_id)
        model_options = options(model)
        model_binding = {"id": model.id, "modelName": "operation-model", "contextWindow": model_options["contextWindowTokens"],
            "maxTokens": model.max_tokens, "reasoning": model.reasoning_mode != "disabled"}
        version = selected[0]["version"] if selected else os.getenv("PI_SKILL_VERSION", "1.0.0")
        created = runner_dispatch(op, "create", {"gateway": gateway, "skillIds": payload["skillIds"], "skillVersion": version,
            "model": model_binding})
        advertised = created.get("skills", created.get("state", {}).get("skills", []))
        if selected:
            if not isinstance(advertised, list):
                raise AiError("Pi 技能证明缺失", "pi_skills_mismatch", 503)
            available = {item.get("id"): item for item in advertised if isinstance(item, dict)}
            if any(item["id"] not in available or any(available[item["id"]].get(k) != item[k] for k in ("version", "sha256", "resources")) for item in selected):
                raise AiError("Pi 技能版本或资源哈希不匹配", "pi_skills_mismatch", 503)
            commands = created.get("state", {}).get("commands", [])
            discovered = {command.get("name") for command in commands if isinstance(command, dict) and command.get("source") == "skill"}
            if not {"skill:"+item["id"] for item in selected} <= discovered:
                raise AiError("Pi 未发现选定技能命令", "pi_skills_mismatch", 503)
        from .policy import canonical, digest, mutation, uid
        from .pi_models import PiDispatch
        from django.utils import timezone
        loaded = [{key: item[key] for key in ("id", "version", "sha256")} for item in selected]
        with mutation():
            session = PiSession.objects.select_for_update().get(pk=op.session_id)
            PiDispatch.objects.create(id=uid("pi-skills-loaded"), operation=op, kind="control:skills_loaded", request_id="skills",
                request_digest=digest(selected), response_json=canonical({"skills": loaded}), status="completed", completed_at=timezone.now())
            service.event(session, "skills_loaded", {"skills": loaded}, op)
        files = []
        for file_id in payload["fileIds"]:
            f = PiFile.objects.get(pk=file_id)
            data = service.download(f.id, principal, content=True)
            files.append({"id": f.id, "sizeBytes": f.size_bytes, **data})
        from .pi_gateway import remaining_seconds
        remaining_ms = max(1, int(remaining_seconds(op)*1000))
        accepted = runner_dispatch(op, "prompt", {"message": payload["message"], "skillIds": payload["skillIds"], "gateway": gateway, "files": files,
            "model": model_binding, "timeoutMs": remaining_ms})
        settled = ingest(op, accepted) or handled(accepted)
        result = accepted
        aborted = False
        while not stopped.is_set():
            current = PiOperation.objects.get(pk=op.pk)
            service.principal_for(current)
            from .pi_gateway import remaining_seconds
            remaining_seconds(current)
            bridge(op, result)
            if current.cancel_requested and not aborted:
                result = runner_dispatch(op, "abort", {})
                settled = ingest(op, result) or handled(result) or settled
                aborted = True
            if settled and complete(op, result):
                # ACK is cleanup after durable terminal evidence. A failed ACK
                # never replays prompt or changes the terminal business result.
                try:
                    pi_transport.command({**identity(op), "command": "ack", "payload": {}})
                except AiError:
                    pass
                return
            session = PiSession.objects.get(pk=op.session_id)
            result = pi_transport.command({**identity(op), "command": "state", "payload": {"afterEventSeq": session.runner_event_seq}})
            if result.get("status") == "unknown":
                raise AiError("PiRunner 执行结果未知", "pi_runner_unknown", 503)
            settled = ingest(op, result) or handled(result) or settled
            stopped.wait(.5)
        freeze(op, "pi_worker_stopped")
    except Exception as error:
        if getattr(error, "code", "") == "pi_canceled_before_prompt":
            try:
                dispose_environment(op)
                from .policy import mutation
                with mutation():
                    current = PiOperation.objects.select_for_update().get(pk=op.pk)
                    session = PiSession.objects.select_for_update().get(pk=op.session_id)
                    if (current.cancel_requested and not PiDispatch.objects.filter(operation=op, kind="runner:prompt").exists()
                            and session.active_operation_id == op.id):
                        current.status, current.capability_hash, current.lease_token, current.lease_expires_at = "canceled", "", "", None
                        current.save()
                        session.status, session.active_operation_id = "idle", ""
                        session.save()
                        service.event(session, "status", {"status": "canceled"}, current)
            except Exception:
                freeze(op, "pi_cleanup_unknown")
        else:
            from django.db import DatabaseError
            freeze(op, getattr(error, "code", "pi_worker_database_unknown" if isinstance(error, DatabaseError) else "pi_worker_unknown"))
    finally:
        heartbeat_stopped.set()
        renewer.join(timeout=2)
        if stopped.is_set():
            try:
                dispose_environment(op)
            except Exception:
                pass  # The original operation and cleanup dispatch stay unknown.


def export_loop(stopped):
    from django.db import connections
    try:
        return _export_loop(stopped)
    finally:
        connections.close_all()


def _export_loop(stopped):
    from django.db import close_old_connections
    from django.utils import timezone
    from .pi_models import PiExport, PiDispatch
    from . import pi_exports
    from .policy import mutation
    while not stopped.is_set():
        close_old_connections()
        with mutation():
            PiExport.objects.filter(status="running", updated_at__lt=timezone.now()-timedelta(minutes=5)).update(status="failed", error_code="pi_export_worker_lost")
        cleanup = PiDispatch.objects.filter(kind="control:freeze", status="prepared").select_related("operation__session").order_by("created_at").first()
        if cleanup:
            try:
                dispose_environment(cleanup.operation)
            except Exception:
                pass
        row = pi_exports.claim()
        if row:
            try:
                pi_exports.perform(row)
            except Exception:
                pass
        else:
            stopped.wait(.5)


def lifecycle_control(path, token, stopped):
    while not stopped.wait(.25):
        try:
            value = json.loads(path.read_bytes())
            if (set(value) != {"version", "token", "intent"} or value["version"] != 1
                    or value["token"] != token or value["intent"] not in {"running", "stop"}):
                stopped.set()
            elif value["intent"] == "stop":
                stopped.set()
        except (OSError, ValueError, TypeError):
            stopped.set()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--control-file")
    parser.add_argument("--control-token")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    import django
    django.setup()
    from django.conf import settings
    from django.db import close_old_connections
    if settings.DJANGO_PROCESS_ROLE != "ai_writer":
        raise SystemExit("Pi worker requires the independent AI writer runtime configuration")
    if args.check:
        from .pi_transport import secret
        from .pi_service import skills
        from .policy import authority
        authority()
        secret()
        values = skills()
        print(json.dumps({"status": "verified", "queue": "pi", "providerCalls": 0,
            "skillVersion": values[0]["version"] if values else None}, separators=(",", ":")))
        return
    stopped = threading.Event()
    if bool(args.control_file) != bool(args.control_token):
        raise SystemExit("Pi lifecycle identity is incomplete")
    if args.control_file:
        path = Path(args.control_file)
        if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1 or path.stat().st_size>2048:
            raise SystemExit("Pi lifecycle control file is invalid")
        threading.Thread(target=lifecycle_control, args=(path, args.control_token, stopped), name="pi-lifecycle-control", daemon=True).start()
    thread = threading.Thread(target=export_loop, args=(stopped,), name="pi-export-queue", daemon=True)
    thread.start()
    try:
        while not stopped.is_set():
            close_old_connections()
            op = claim()
            if op:
                from . import transport
                from .policy import AiError
                def canceled():
                    if stopped.is_set():
                        raise AiError("Pi worker 正在停止", "pi_worker_stopped", 503)
                with transport.request_cancellation(canceled):
                    perform(op, stopped)
            else:
                stopped.wait(.5)
    except KeyboardInterrupt:
        stopped.set()
    finally:
        stopped.set()
        thread.join(timeout=5)
        if args.control_file:
            # Receipt contains no model prompt, customer data or channel secret.
            done = Path(str(path)+".stopped")
            with done.open("x", encoding="utf-8") as file:
                file.write(json.dumps({"version": 1, "token": args.control_token, "status": "stopped"}, separators=(",", ":")))


if __name__ == "__main__":
    main()
