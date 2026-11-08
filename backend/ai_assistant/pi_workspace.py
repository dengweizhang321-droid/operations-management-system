"""Pi workspace authority. Controls have identities independent of model runs.

No browser body is passed through to the private gateway. Every mutation first
reserves its immutable receipt under the same authority lock as prompt/stop.
An interrupted send is observed by ID; it is never sent again.
"""
import base64
import hashlib
import json
import logging
import re

from django.utils import timezone
from . import pi_service as service, pi_transport
from .pi_models import PiWorkspace, PiControl, PiUiRequest, PiSession, PiOperation
from .policy import AiError, canonical, current_principal, digest, fields, identifier, integer, mutation, passive, record, text, uid

logger = logging.getLogger(__name__)

COMMANDS = {"steer", "follow_up", "clear_queue", "bash", "abort_bash", "tree", "stats", "session_new", "session_switch",
    "session_fork", "session_clone", "session_navigate", "compact", "export_html", "model_set", "thinking_set", "ui_response",
    "terminal_create", "terminal_input", "terminal_resize", "terminal_close", "file_list", "file_read", "file_download",
    "file_write", "file_mkdir", "file_rename", "file_delete",
    "pause", "wake", "reset", "upgrade", "research_search", "research_read", "dependency_install", "skills_reload"}
RUNNING_COMMANDS = {"steer", "follow_up", "clear_queue", "abort_bash", "ui_response", "pause", "terminal_input", "terminal_resize", "terminal_close", "model_set", "thinking_set", "skills_reload"}
READ_COMMANDS = {"tree", "stats", "file_list", "file_read", "file_download", "export_html"}
LOCAL_MODEL_SNAPSHOT = "localModelSnapshot"
PRIVATE_KEYS = {"pendingGatewayRequests", "gateway", "capability", "capabilityHash", "thinking", "thinkingSignature", "providerFrame", "encryptedRunnerResponse",
    LOCAL_MODEL_SNAPSHOT}


def public(value, depth=0):
    if depth > 20:
        raise AiError("Pi 工作区状态深度超限", "pi_runner_unknown", 503)
    if isinstance(value, dict):
        result = {k: public(v, depth+1) for k, v in value.items() if k not in PRIVATE_KEYS}
        safe_thinking = value.get("thinking")
        if isinstance(safe_thinking, dict) and set(safe_thinking) <= {"requested", "effective", "pending", "supported"}:
            result["thinking"] = public(safe_thinking, depth+1)
        return result
    if isinstance(value, list):
        return [public(v, depth+1) for v in value]
    return value


def result_summary(value, maximum=4096):
    raw = canonical(value).encode()
    if len(raw) <= maximum:
        return value
    metadata = {key: value[key] for key in ("path", "sha256", "sizeBytes", "downloadId", "fileId", "terminalId", "inputId", "inputSeq", "status", "disposition", "effectiveModel", "thinkingLevel", "planId", "planRevision", "rootSessionId", "modeRevision", "treeVersion", "agentId", "sessionId", "operationId", "waitId", "cursor") if isinstance(value, dict) and key in value}
    if isinstance(value, dict) and isinstance(value.get("sources"), list):
        metadata["sources"] = [{key: source[key] for key in ("url", "title", "sha256", "fetchedAt") if key in source}
            for source in value["sources"][:10] if isinstance(source, dict)]
    return {**metadata, "resultOmitted": True, "resultSha256": hashlib.sha256(raw).hexdigest(), "originalBytes": len(raw)}


def control_record(row, *, history=False):
    result = json.loads(row.result_json)
    return {**record(row, "id client_request_id epoch generation control_seq command status error_code created_at updated_at"),
        "operationId": row.operation_id, "result": result_summary(result, 4096 if history else 768 * 1024)}


def workspace_record(session, workspace):
    frozen = session.status == "frozen"
    state = {} if frozen else json.loads(workspace.state_json)
    state.pop(LOCAL_MODEL_SNAPSHOT, None)
    from .pi_native import snapshot
    return {"native": snapshot(session), "epoch": session.epoch, "generation": session.generation, "status": "frozen" if frozen else workspace.status,
        "initialized": workspace.status not in {"uninitialized", "frozen"}, "controlSeq": workspace.control_seq,
        "effective": {} if frozen else {"modelId": workspace.model_id, "modelVersion": workspace.model_version, "thinkingLevel": workspace.thinking_level},
        "state": state, "usage": None if frozen else usage_record(session), "updatedAt": workspace.updated_at.isoformat()}


def usage_record(session):
    from .pi_models import PiDispatch
    from .models import AiModels
    from .model_capabilities import usage_numbers
    rows = list(PiDispatch.objects.filter(operation__session=session, operation__generation=session.generation, kind="model")
        .order_by("-created_at", "id").values("id", "operation_id", "status", "usage_json", "operation__model_id", "operation__model_version")[:101])
    model_ids = {row["operation__model_id"] for row in rows[:100]}
    models = {row.id: row for row in AiModels.objects.filter(id__in=model_ids).only("id", "name", "model_name", "version")}
    items = []
    for row in rows[:100]:
        try: measured = usage_numbers(json.loads(row["usage_json"]))
        except (ValueError, TypeError): measured = usage_numbers({})
        model_id = row["operation__model_id"]; model = models.get(model_id)
        if model and model.version != row["operation__model_version"]: model = None
        items.append({"dispatchId": row["id"], "operationId": row["operation_id"], "modelId": model_id,
            "modelVersion": row["operation__model_version"], "modelConfigName": model.name if model else None,
            "modelName": model.model_name if model else None, "modelMetadataStatus": "matched_version" if model else "historical_version_unavailable", "status": row["status"], **measured, "cost": None,
            "costStatus": "unknown" if row["status"] in {"sent", "unknown"} else "not_configured"})
    totals = {key: sum(item[key] for item in items if item[key] is not None) for key in ("inputTokens", "outputTokens", "reasoningTokens")}
    return {"source": "django_model_dispatch_ledger", "window": "latest_100_dispatches", "hasMore": len(rows)>100, "items": items,
        "knownTokenTotals": totals, "missingUsageDispatches": sum(item["inputTokens"] is None or item["outputTokens"] is None for item in items),
        "cost": None, "costStatus": "unknown" if any(item["status"] in {"sent", "unknown"} for item in items) else "not_configured"}


def _workspace(session):
    row, _ = PiWorkspace.objects.get_or_create(session=session, defaults={"generation": session.generation})
    if row.generation != session.generation:
        row.generation, row.status, row.state_json = session.generation, "uninitialized", "{}"
        row.save(update_fields=["generation", "status", "state_json"])
    return row


def _operation(session):
    return PiOperation.objects.filter(session=session, generation=session.generation).select_related("session").order_by("-seq").first()


def _unresolved_activity(session, state):
    from .pi_models import PiDispatch
    activities = state.get("activities", [])
    if (state.get("hasUnresolvedActivities") is True or isinstance(activities, list)
            and any(isinstance(item, dict) and item.get("status") == "unknown" for item in activities)):
        return True
    ledger = PiDispatch.objects.filter(operation__session=session, operation__generation=session.generation)
    if ledger.filter(kind__in=["activity:begin", "activity:end"], status__in=["sent", "unknown"]).exists():
        return True
    active = [item.get("activityId") for item in activities if isinstance(item, dict) and item.get("status") == "active"] if isinstance(activities, list) else []
    ended = ledger.filter(kind="activity:end", status="completed").values("request_id")
    # A completed begin is still a lease. Missing activity state is never proof
    # that it ended, including after a broker restart or an older observation.
    return ledger.filter(kind="activity:begin", status="completed").exclude(request_id__in=ended).exclude(request_id__in=active).exists()


def _activity(operation, control, principal, action, *, timeout_ms=None):
    """One signed activity transition, with the original uncertain send frozen.

    HTTP observations never call this function. A known duplicate returns its
    original receipt; a sent/unknown record is never dispatched again.
    """
    from .pi_worker import identity
    from .pi_models import PiDispatch
    sequence = 1 if action == "begin" else 2
    payload = {"action": "activity_"+action, "activityId": control.id, "activitySeq": sequence}
    if action == "begin":
        integer(timeout_ms, "timeoutMs")
        payload.update(kind="dependency_fetch", timeoutMs=timeout_ms)
    request = {**identity(operation), "command": "workspace", "payload": payload}
    binding = digest(request)
    with mutation(principal):
        session = service.get_session(control.session_id, principal, lock=True)
        if session.status == "frozen" or (session.epoch, session.generation) != (control.epoch, control.generation):
            raise AiError("旧代际下载活动已失效", "access_denied", 403)
        prior = PiDispatch.objects.filter(operation=operation, kind="activity:"+action, request_id=control.id).first()
        if prior:
            if prior.request_digest != binding or prior.status != "completed":
                raise AiError("原下载活动结果未知，禁止重发", "pi_activity_unknown", 409)
            return json.loads(prior.response_json)
        dispatch = PiDispatch.objects.create(id=uid("pi-activity"), operation=operation, kind="activity:"+action,
            request_id=control.id, request_digest=binding, status="sent")
        service.event(session, "workspace_activity", {"controlId": control.id, "action": action, "activitySeq": sequence, "status": "sent"}, operation)
    try:
        result = pi_transport.command(request)
        activity = result.get("activity")
        if (not isinstance(activity, dict) or activity.get("activityId") != control.id or type(activity.get("activitySeq")) is not int
                or activity["activitySeq"] != sequence or activity.get("kind") != "dependency_fetch"
                or activity.get("status") != ("active" if action == "begin" else "completed")
                or type(activity.get("deadline")) is not int or activity["deadline"] < 1
                or action == "begin" and activity["deadline"] <= int(timezone.now().timestamp()*1000)):
            raise AiError("下载活动回执身份或状态未知", "pi_activity_unknown", 503)
        if action == "end":
            begin = PiDispatch.objects.get(operation=operation, kind="activity:begin", request_id=control.id, status="completed")
            if json.loads(begin.response_json).get("deadline") != activity["deadline"]:
                raise AiError("下载活动结束回执改变了原期限", "pi_activity_unknown", 503)
        with mutation():
            session = PiSession.objects.select_for_update().get(pk=control.session_id)
            dispatch.status, dispatch.response_json, dispatch.completed_at = "completed", canonical(public(activity)), timezone.now()
            dispatch.save(update_fields=["status", "response_json", "completed_at"])
            service.event(session, "workspace_activity", {"controlId": control.id, "action": action,
                "activitySeq": sequence, "status": activity["status"], "deadline": activity["deadline"]}, operation)
        return activity
    except Exception as error:
        with mutation():
            session = PiSession.objects.select_for_update().get(pk=control.session_id)
            dispatch.status, dispatch.error_code, dispatch.completed_at = "unknown", getattr(error, "code", "pi_activity_unknown"), timezone.now()
            dispatch.save(update_fields=["status", "error_code", "completed_at"])
            service.event(session, "workspace_activity", {"controlId": control.id, "action": action,
                "activitySeq": sequence, "status": "unknown", "code": dispatch.error_code}, operation)
        raise AiError("下载活动结果未知，禁止自动重发或安装", "pi_activity_unknown", 503) from error


def _known_result(row, receipt):
    if receipt.get("controlId", receipt.get("id")) != row.id or receipt.get("controlSeq") != row.control_seq:
        raise AiError("Pi 控制回执身份不匹配", "pi_control_unknown", 503)
    status = receipt.get("status")
    if status not in {"queued", "accepted", "handled", "completed", "failed", "unknown"}:
        raise AiError("Pi 控制回执状态无效", "pi_control_unknown", 503)
    if row.status in {"completed", "handled", "failed"}:
        return
    if row.command == "mode_set" and "admission" in json.loads(row.payload_json) and status in {"completed", "handled"}:
        result = receipt.get("result", {})
        if result.get("drained") is not True or result.get("admission") != json.loads(row.payload_json)["admission"]:
            raise AiError("模式切换缺少原版本排空证明", "pi_mode_drain_unknown", 503)
    if row.status == "unknown" and status != "unknown":
        locked = PiSession.objects.select_for_update().get(pk=row.session_id)
        service.event(locked, "workspace_control_reconciled", {"controlId": row.id, "command": row.command,
            "previousStatus": "unknown", "previousErrorCode": row.error_code, "observedStatus": status}, row.operation)
    result = public(receipt.get("result", {}))
    if row.command == "stats":
        result = {"piSessionCounts": {key: value for key, value in result.items()
            if key in {"userMessages", "assistantMessages", "toolCalls", "toolResults", "totalMessages"} and type(value) is int},
            "authoritative": False, "usageSource": "django_model_dispatch_ledger"}
    row.status, row.result_json = status, canonical(result)
    row.error_code = str(receipt.get("errorCode", ""))[:160]
    row.updated_at = timezone.now()
    row.save(update_fields=["status", "result_json", "error_code", "updated_at"])


def _capture_download(row, receipt, operation, principal):
    """Convert an immutable Runner snapshot to an immutable domain attachment."""
    if row.command not in {"file_download", "export_html"} or receipt.get("status") not in {"completed", "handled"}:
        return receipt
    result = receipt.get("result", {})
    if not isinstance(result, dict) or not isinstance(result.get("downloadId"), str):
        return receipt
    from .pi_models import PiFile
    key = row.id+"-download"
    attachment = PiFile.objects.filter(session_id=row.session_id, client_request_id=key).first()
    if not attachment:
        from .pi_worker import identity
        observed = pi_transport.command({**identity(operation), "command": "workspace", "payload": {"action": "download", "downloadId": result["downloadId"]}}).get("download", {})
        try:
            raw = base64.b64decode(observed["base64"], validate=True)
            if (observed.get("downloadId", result["downloadId"]) != result["downloadId"] or len(raw) != result["sizeBytes"]
                    or hashlib.sha256(raw).hexdigest() != result["sha256"] or observed.get("sha256") != result["sha256"]):
                raise ValueError("snapshot_hash_mismatch")
        except (ValueError, KeyError, TypeError) as error:
            raise AiError("Pi 下载快照完整性不匹配", "pi_file_snapshot_unknown", 503) from error
        with mutation(principal):
            session = service.get_session(row.session_id, principal, lock=True)
            if session.status == "frozen" or session.generation != row.generation:
                raise AiError("旧代际下载已隔离", "access_denied", 403)
            attachment = service.save_file(session, operation, key, result.get("path", "session.html"),
                "text/html" if row.command == "export_html" else observed.get("mimeType", "application/octet-stream"), raw,
                direction="output", manifest={"controlId": row.id, "downloadId": result["downloadId"], "immutableSnapshot": True})
    return {**receipt, "result": {**result, "fileId": attachment.id, "file": service.file_record(attachment)}}


def _effective_readback(row, receipt, workspace):
    if row.status in {"completed", "handled", "failed"}:
        return
    if receipt.get("status") not in {"completed", "handled"}:
        return
    payload, result = json.loads(row.payload_json), receipt.get("result", {})
    if row.command in {"session_new", "session_switch", "session_fork", "session_clone"}:
        from .pi_native import history_changed
        history_changed(PiSession.objects.select_for_update().get(pk=row.session_id))
    if row.command == "model_set":
        from . import configuration
        from .model_capabilities import options
        model = configuration.resolve_model(payload["modelId"])
        opts = options(model)
        from .pi_native import model_binding
        expected = {k: v for k, v in model_binding(model).items() if k in {"contextWindow", "maxTokens", "reasoning", "supportedThinkingLevels"}}
        if result.get("effectiveModel") != expected:
            raise AiError("实际模型元数据未确认，不能标记切换成功", "pi_effective_model_unknown", 503)
        workspace.model_id, workspace.model_version = model.id, model.version
    if row.command == "thinking_set":
        if result.get("thinkingLevel") != payload["level"]:
            raise AiError("实际思考等级未确认，不能标记切换成功", "pi_effective_thinking_unknown", 503)
        workspace.thinking_level = payload["level"]
    if row.command == "wake":
        from . import pi_native
        pi_native.authorize(row.operation, kind="workspace", name="wake", lock=True, require_supplied=False)
        if (result.get("localRestoreVersion") != 1 or result.get("generation") != row.generation
                or not result.get("containerId") or result.get("admission") != payload.get("admission")
                or result["admission"] != pi_native.admission(row.operation)):
            raise AiError("Pi 唤醒缺少当前本地执行绑定证明", "pi_wake_unknown", 503)
    if row.command == "reclaim_stopped":
        if result != {**payload["expected"], "containerRemoved": True, "volumePreserved": True}:
            raise AiError("回收缺少外壳删除与工作卷保留证明", "pi_reclaim_unknown", 409)
        workspace.status = "paused" if payload["requireLocalRestore"] else "ready"
    if row.command == "upgrade":
        plans = json.loads(workspace.state_json).get("upgradePlans", [])
        plan = next((p for p in plans if isinstance(p, dict) and p.get("planId") == payload["planId"]), None)
        if (not plan or any(result.get(key) != plan.get(key) for key in ("planId", "fromImage", "toImage", "sourceSha256", "protocolVersion"))
                or result.get("generation") != row.generation or result.get("preservedWorkspace") is not True):
            raise AiError("升级实际版本与已登记计划不匹配", "pi_upgrade_unknown", 503)


def ingest(session, workspace, operation, result, *, snapshot=True):
    """Persist only signed state, with public UI IDs bound to this live run."""
    state = result.get("workspace", result.get("state", {}))
    if not isinstance(state, dict):
        raise AiError("Pi 工作区状态无效", "pi_runner_unknown", 503)
    if isinstance(state.get("state"), dict):
        state = state["state"]
    state = public(state)
    controls = state.get("controls", result.get("controls", []))
    if isinstance(controls, list):
        for receipt in controls[:200]:
            if not isinstance(receipt, dict):
                continue
            row = PiControl.objects.filter(id=receipt.get("controlId", receipt.get("id")), session=session, generation=session.generation).first()
            if row:
                if not snapshot and row.command in {"wake", "reclaim_stopped"}:
                    continue
                if snapshot:
                    _effective_readback(row, receipt, workspace)
                _known_result(row, receipt)
    if not snapshot:
        return
    activities = state.get("activities", [])
    if (not isinstance(activities, list) or len(activities) > 100
            or "hasUnresolvedActivities" in state and type(state["hasUnresolvedActivities"]) is not bool):
        raise AiError("Pi 下载活动状态无效", "pi_runner_unknown", 503)
    for activity in activities:
        if (not isinstance(activity, dict) or not isinstance(activity.get("activityId"), str)
                or activity.get("kind") != "dependency_fetch" or activity.get("status") not in {"active", "completed", "unknown"}
                or type(activity.get("deadline")) is not int or activity["deadline"] < 1
                or not isinstance(activity.get("operationId"), str)):
            raise AiError("Pi 下载活动身份无效", "pi_runner_unknown", 503)
    pending = state.get("pendingUi", state.get("pendingUIRequests", []))
    ui = []
    if isinstance(pending, list) and operation:
        for request in pending[:32]:
            if not isinstance(request, dict):
                continue
            runner_id = request.get("requestId", request.get("id"))
            if not isinstance(runner_id, str) or not 1 <= len(runner_id) <= 160:
                continue
            # The signed Runner identity alone does not make stale UI requests
            # answerable after terminal state or cancellation.
            if operation.status != "running" or operation.cancel_requested:
                continue
            if request.get("operationId", operation.id) != operation.id:
                continue
            from .pi_native import validate_questionnaire
            validate_questionnaire(request)
            row, _ = PiUiRequest.objects.get_or_create(operation=operation, runner_request_id=runner_id,
                defaults={"id": uid("pi-ui"), "session": session, "generation": session.generation, "request_json": canonical(public(request))})
            if row.request_json != canonical(public(request)):
                raise AiError("原交互问题内容发生变化", "pi_questionnaire_changed", 503)
            if row.status == "pending":
                ui.append({**public(request), "id": row.id, "requestId": row.id, "operationId": operation.id})
    state["pendingUi"] = ui
    state.pop("pendingUIRequests", None)
    state.pop("controls", None)
    if operation and state.get("environmentStatus") == "stopped":
        # A stopped Runner reconstructed from SQLite has no process-local
        # effective model. Keep the prior proof separate from live readback.
        thinking = state.get("thinking")
        missing = state.get("effectiveModel") is None and (thinking is None or
            isinstance(thinking, dict) and thinking.get("effective") is None)
        model_snapshot = _historical_local_model_snapshot(operation, workspace, session=session,
            state=None if missing else state)
        if model_snapshot:
            state[LOCAL_MODEL_SNAPSHOT] = model_snapshot
    passive(state, 4 * 1024 * 1024)
    workspace.state_json, workspace.updated_at = canonical(state), timezone.now()
    unresolved = PiControl.objects.filter(session=session, generation=session.generation, status__in=["sent", "unknown"]).exists()
    activity_unknown = _unresolved_activity(session, state)
    if activity_unknown and workspace.status != "frozen":
        workspace.status = "unknown"
    elif workspace.status not in {"paused", "frozen"} and not unresolved and session.status not in {"unknown", "frozen"}:
        workspace.status = "ready"
    workspace.save(update_fields=["state_json", "updated_at", "status", "model_id", "model_version", "thinking_level"])


def detail(session_id, params, principal, *, poll=True):
    fields(params, {"afterTerminalSeq", "recoveryBeforeControlSeq", "recoveryControlSeq", "recoveryTextOffset"})
    before_control_seq = service.number(params["recoveryBeforeControlSeq"], "recoveryBeforeControlSeq", 1, 2**53-1) if "recoveryBeforeControlSeq" in params else None
    if "recoveryTextOffset" in params and "recoveryControlSeq" not in params:
        raise AiError("原记录正文游标需要控制序号")
    session = service.get_session(session_id, principal)
    with mutation():
        session = service.get_session(session_id, principal, lock=True)
        workspace = _workspace(session)
        observation_seq = workspace.control_seq
        observation_identity = (session.epoch, session.generation, session.status == "frozen")
    observation_error = None
    operation = _operation(session)
    if poll and operation and session.status != "frozen" and workspace.status != "uninitialized":
        payload = {"action": "state"}
        if "afterTerminalSeq" in params:
            try:
                cursor = json.loads(params["afterTerminalSeq"])
                if not isinstance(cursor, dict) or len(cursor)>8:
                    raise ValueError()
                for key, value in cursor.items():
                    identifier(key); integer(value, "afterTerminalSeq", 0)
            except (ValueError, TypeError) as error:
                raise AiError("终端游标无效") from error
            payload["afterTerminalSeq"] = cursor
        try:
            from .pi_worker import identity
            result = pi_transport.command({**identity(operation), "command": "workspace", "payload": payload})
            signed_state = result.get("workspace", result.get("state", {}))
            if isinstance(signed_state, dict):
                reads = 0
                for receipt in signed_state.get("controls", [])[-100:]:
                    if isinstance(receipt, dict):
                        control = PiControl.objects.filter(id=receipt.get("controlId", receipt.get("id")), session=session, generation=session.generation).first()
                        if (control and control.status not in {"completed", "handled", "failed"} and receipt.get("resultOmitted")
                                and receipt.get("status") in {"completed", "handled", "failed"} and reads < 10):
                            full = pi_transport.command({**identity(operation), "command": "workspace", "payload": {"action": "receipt", "controlId": control.id}}).get("control")
                            if not isinstance(full, dict) or full.get("controlId") != control.id or full.get("controlSeq") != control.control_seq:
                                raise AiError("Pi 完整控制回执不匹配", "pi_control_unknown", 503)
                            receipt.clear(); receipt.update(full); reads += 1
                        if control and control.command in {"file_download", "export_html"}:
                            hydrated = _capture_download(control, receipt, control.operation or operation, principal)
                            receipt.update(hydrated)
            with mutation():
                current = service.get_session(session_id, principal, lock=True)
                if (current.epoch, current.generation) == (session.epoch, session.generation) and current.status != "frozen":
                    workspace = _workspace(current)
                    current_operation = PiOperation.objects.get(pk=operation.pk)
                    ingest(current, workspace, current_operation, result, snapshot=workspace.control_seq == observation_seq)
                    session = current
        except AiError as error:
            # Read failures do not prove a mutation failed, nor authorize one.
            workspace.refresh_from_db()
            session.refresh_from_db()
            state = json.loads(workspace.state_json)
            state["observationError"] = error.code
            workspace.state_json = canonical(state)
            observation_error = error.code
    # A network gap cannot pin old scope or generation into the response.
    with mutation(principal):
        session = service.get_session(session_id, principal, lock=True)
        if (session.epoch, session.generation, session.status == "frozen") != observation_identity:
            raise AiError("读取期间环境授权或代际已变化，请重新读取", "pi_observation_changed", 409)
        workspace = _workspace(session)
        if observation_error:
            workspace.state_json = canonical({**json.loads(workspace.state_json), "observationError": observation_error})
        from .pi_native import snapshot
        result = {"native": snapshot(session), "session": service.session_record(session), "workspace": workspace_record(session, workspace),
            "controls": [] if session.status == "frozen" else [control_record(c, history=True) for c in PiControl.objects.filter(session=session, generation=session.generation).order_by("-control_seq")[:100]]}
        from .pi_context import recovery
        result["recovery"] = recovery(session, workspace, before_control_seq=before_control_seq)
        if "recoveryControlSeq" in params:
            from .pi_context import control_evidence
            result["recovery"]["sourceControl"] = control_evidence(session,
                service.number(params["recoveryControlSeq"], "recoveryControlSeq", 1, 2**53-1),
                service.number(params.get("recoveryTextOffset", "0"), "recoveryTextOffset", 0, 2**53-1))
    return result


def _validate(command, payload):
    if not isinstance(command, str) or command not in COMMANDS:
        raise AiError("Pi 工作区控制不受支持", "pi_control_unsupported", 400)
    passive(payload, 9 * 1024 * 1024)
    if not isinstance(payload, dict):
        raise AiError("控制参数必须是对象")
    if any(k in payload for k in {"gateway", "capability", "operationId", "ownerId", "conversationId", "epoch", "generation", "seq", "controlId", "controlSeq"}):
        raise AiError("浏览器不能提供执行身份或网关能力", "access_denied", 403)
    schemas = {
        "steer": ({"message"}, {"message"}), "follow_up": ({"message"}, {"message"}),
        "bash": ({"command", "excludeFromContext"}, {"command"}), "compact": ({"customInstructions"}, set()),
        "model_set": ({"modelId"}, {"modelId"}), "thinking_set": ({"level"}, {"level"}),
        "ui_response": ({"requestId", "value", "confirmed", "cancelled"}, {"requestId"}),
        "session_switch": ({"sessionId"}, {"sessionId"}), "session_fork": ({"entryId"}, {"entryId"}),
        "session_navigate": ({"entryId"}, {"entryId"}), "terminal_create": ({"cols", "rows"}, set()),
        "terminal_input": ({"terminalId", "inputId", "inputSeq", "data"}, {"terminalId", "inputId", "inputSeq", "data"}),
        "terminal_resize": ({"terminalId", "cols", "rows"}, {"terminalId", "cols", "rows"}), "terminal_close": ({"terminalId"}, {"terminalId"}),
        "file_list": ({"path"}, set()), "file_read": ({"path", "expectedSha256"}, {"path"}),
        "file_download": ({"path", "expectedSha256"}, {"path"}), "file_write": ({"path", "base64", "expectedSha256"}, {"path", "base64", "expectedSha256"}),
        "file_mkdir": ({"path"}, {"path"}), "file_rename": ({"path", "target", "expectedSha256"}, {"path", "target", "expectedSha256"}),
        "file_delete": ({"path", "expectedSha256"}, {"path", "expectedSha256"}),
        "research_search": ({"query"}, {"query"}), "research_read": ({"url"}, {"url"}),
        "dependency_install": ({"ecosystem", "packages"}, {"ecosystem", "packages"}), "upgrade": ({"planId"}, {"planId"}),
    }
    allowed, required = schemas.get(command, (set(), set()))
    fields(payload, allowed, required)
    for name in ("path", "target"):
        if name in payload:
            value = text(payload[name], name, 500)
            if value.startswith(("/", "\\")) or "\\" in value or ":" in value or any(part in {"", ".", ".."} for part in value.split("/")):
                raise AiError("工作区路径无效")
    if "expectedSha256" in payload and not (command == "file_write" and payload["expectedSha256"] is None):
        if not isinstance(payload["expectedSha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", payload["expectedSha256"]):
            raise AiError("文件版本摘要无效")
    for name in ("terminalId", "inputId", "sessionId", "entryId", "planId"):
        if name in payload:
            identifier(payload[name], name)
    for name in ("cols", "rows"):
        if name in payload: integer(payload[name], name, 2, 500)
    if "inputSeq" in payload: integer(payload["inputSeq"], "inputSeq")
    if "data" in payload: text(payload["data"], "终端输入", 32768, empty=True)
    for name in ("excludeFromContext", "confirmed", "cancelled"):
        if name in payload and type(payload[name]) is not bool: raise AiError(name+" 必须为布尔值")
    if "command" in payload: text(payload["command"], "命令", 262144)
    if "customInstructions" in payload: text(payload["customInstructions"], "压缩指令", 10000, empty=True)
    if "base64" in payload:
        if not isinstance(payload["base64"], str) or len(payload["base64"])>12*1024*1024: raise AiError("文件超出大小边界", "payload_too_large", 413)
        try: base64.b64decode(payload["base64"], validate=True)
        except (ValueError, TypeError) as error: raise AiError("文件不是有效 base64") from error
    if command in {"steer", "follow_up"}:
        fields(payload, {"message"}, {"message"}); text(payload["message"], "消息", 200000)
    if command == "model_set":
        fields(payload, {"modelId"}, {"modelId"}); identifier(payload["modelId"], "modelId")
    if command == "thinking_set":
        fields(payload, {"level"}, {"level"})
        if payload["level"] not in {"off", "minimal", "low", "medium", "high", "xhigh", "max"}:
            raise AiError("思考等级无效")
    if command == "ui_response":
        fields(payload, {"requestId", "value", "confirmed", "cancelled"}, {"requestId"}); identifier(payload["requestId"])
        answers = set(payload) & {"value", "confirmed", "cancelled"}
        if len(answers) != 1 or "cancelled" in payload and payload["cancelled"] is not True:
            raise AiError("交互回复必须提供唯一明确结果")
        if "value" in payload: text(payload["value"], "交互回复", 65536, empty=True)
    if command == "upgrade":
        fields(payload, {"planId"}, {"planId"}); identifier(payload["planId"], "planId")
    if command in {"reset", "pause", "wake"}:
        fields(payload, set())


def _new_operation(session, workspace, principal, kind, payload, *, queued):
    from . import configuration
    model = configuration.resolve_model(workspace.model_id or None)
    previous = _operation(session) if kind == "workspace:compact" else None
    inherited_skills = json.loads(previous.skills_json) if previous else []
    session.operation_seq += 1
    payload = {**payload, "shopSelection": json.loads(session.selection_json),
        **({"thinkingLevel": workspace.thinking_level} if workspace.thinking_level else {})}
    operation = PiOperation.objects.create(id=uid("pi-op"), session=session, client_request_id=uid("workspace"),
        request_digest=digest(payload), kind=kind, epoch=session.epoch, generation=session.generation, seq=session.operation_seq,
        actor_role=principal.role, scope_json=session.scope_json, payload_json=canonical(payload), model_id=model.id, model_version=model.version,
        skills_json=canonical(inherited_skills))
    session.active_operation_id, session.status = operation.id, "queued"
    session.save()
    if not workspace.model_id:
        workspace.model_id, workspace.model_version = model.id, model.version
        workspace.save(update_fields=["model_id", "model_version"])
    if not queued:
        # Reuse the real claim/deadline path; no background queue is consulted.
        from datetime import timedelta
        from .model_capabilities import options
        from .pi_models import PiDispatch
        now = timezone.now()
        budget = options(model)["taskTimeoutMs"]
        operation.status, operation.lease_token, operation.lease_expires_at = "running", uid("pi-lease"), now+timedelta(seconds=120)
        operation.save()
        deadline = {"startedAt": now.isoformat(), "deadlineAt": str(int(now.timestamp()*1000)+budget), "deadlineUnit": "unix_milliseconds_decimal", "taskTimeoutMs": budget}
        PiDispatch.objects.create(id=uid("pi-deadline"), operation=operation, kind="control:deadline", request_id="deadline", request_digest=digest(deadline), response_json=canonical(deadline), status="completed", completed_at=now)
        session.status = "running"; session.save(update_fields=["status"])
    return operation


def _create_environment(operation):
    from . import pi_worker, configuration
    from .model_capabilities import options
    model = configuration.resolve_model(operation.model_id)
    opts = options(model)
    from .pi_native import model_binding
    binding = model_binding(model, json.loads(operation.payload_json).get("thinkingLevel", ""))
    import os
    return pi_worker.runner_dispatch(operation, "create", {"admission": pi_worker.native_admission(operation), "gateway": pi_worker.gateway_capability(operation), "skillIds": [], "skillVersion": os.getenv("PI_SKILL_VERSION", "1.0.0"), "model": binding})


def _finish_init(operation):
    with mutation():
        session = PiSession.objects.select_for_update().get(pk=operation.session_id)
        current = PiOperation.objects.select_for_update().get(pk=operation.pk)
        if current.status == "running" and session.active_operation_id == current.id:
            current.status, current.capability_hash, current.lease_token, current.lease_expires_at = "succeeded", "", "", None
            current.save()
            session.status, session.active_operation_id = "idle", ""
            session.save()


def _historical_local_model_snapshot(operation, workspace, *, session, state=None):
    """Match passive model settings to this workspace's original authority."""
    from . import configuration, pi_native
    from .pi_models import PiDispatch
    if (session.status != "idle" or session.active_operation_id or workspace.status not in {"ready", "paused"}
            or (workspace.session_id, workspace.generation) != (session.id, session.generation)
            or (operation.session_id, operation.epoch, operation.generation, operation.actor_role, operation.scope_json)
            != (session.id, session.epoch, session.generation, session.actor_role, session.scope_json)):
        return None
    state = json.loads(workspace.state_json) if state is None else state
    saved = state.get(LOCAL_MODEL_SNAPSHOT)
    if saved is None:
        projection = state.get("effectiveModel")
        thinking = state.get("thinking")
        level = thinking.get("effective") if isinstance(thinking, dict) else None
    else:
        if not isinstance(saved, dict) or not isinstance(saved.get("model"), dict):
            return None
        level = saved["model"].get("thinkingLevel")
        projection = {key: value for key, value in saved["model"].items() if key != "thinkingLevel"}
    if not isinstance(projection, dict) or not isinstance(level, str):
        return None

    model_id, version = workspace.model_id, workspace.model_version
    if not model_id:
        # A prompt may have initialized Pi before Django created a workspace
        # record. An operation with only a rejected/unknown create proves no model.
        known = PiDispatch.objects.filter(operation__session_id=operation.session_id,
            operation__epoch=operation.epoch, operation__generation=operation.generation,
            kind="runner:create", status="completed", error_code="").select_related("operation").order_by("-operation__seq").first()
        if not known:
            return None
        model_id, version = known.operation.model_id, known.operation.model_version
    if not model_id or version < 1:
        return None
    binding = digest({"owner": session.owner_email, "role": session.actor_role, "scope": session.scope_json,
        "selection": session.selection_json, "session": session.id, "epoch": session.epoch, "generation": session.generation,
        "modelId": model_id, "modelVersion": version})
    if saved is not None and saved.get("binding") != binding:
        return None
    try:
        model = configuration.resolve_model(model_id)
        if model.version != version:
            return None
        bindings = [pi_native.model_binding(model, level)]
        if level == "off" and model.reasoning_mode != "disabled":
            bindings.append(pi_native.model_binding(effective_model(model, level), level))
    except AiError:
        return None
    keys = ("contextWindow", "maxTokens", "reasoning", "supportedThinkingLevels")
    for config in bindings:
        expected = {key: config[key] for key in keys}
        if projection == expected and level in config["supportedThinkingLevels"]:
            return {"binding": binding, "model": {**expected, "thinkingLevel": level}}
    return None


def _historical_local_model(operation, workspace, *, session=None):
    snapshot = _historical_local_model_snapshot(operation, workspace, session=session or workspace.session)
    return snapshot["model"] if snapshot else None


def control(session_id, body, principal):
    from . import pi_native
    if isinstance(body, dict) and body.get("command") in pi_native.COMMANDS:
        return pi_native.control(session_id, body, principal)
    # Targeted messages retain the existing transport and queue semantics.
    if isinstance(body, dict) and isinstance(body.get("payload"), dict) and body["payload"].get("targetAgentId"):
        target_payload = dict(body["payload"])
        target = target_payload.pop("targetAgentId")
        origin = service.get_session(session_id, principal)
        with mutation(principal):
            state = pi_native.state_for(origin, lock=True)
            member = pi_native._target(state, target)
        return control(member.session_id, {**body, "payload": target_payload}, principal)
    fields(body, {"clientRequestId", "command", "payload"}, {"clientRequestId", "command", "payload"})
    key = identifier(body["clientRequestId"], "clientRequestId")
    if key.startswith("native-"):
        raise AiError("控制标识属于系统保留范围", "access_denied", 403)
    command, payload = body["command"], body["payload"]
    _validate(command, payload)
    current_principal(principal, write=True)
    service.get_session(session_id, principal)
    binding = digest(body)
    initialize = False
    runner_sent, environment_known = False, True
    activity_uncertain = False
    with mutation(principal):
        session = service.get_session(session_id, principal, lock=True)
        workspace = _workspace(session)
        old = PiControl.objects.filter(session=session, client_request_id=key).first()
        if old:
            if old.request_digest != binding:
                raise AiError("控制请求标识已绑定其他内容", "conflict", 409)
            rotated_capacity = old.command == "reset" and old.status == "failed" and old.error_code == "pi_session_limit" and json.loads(old.result_json).get("generationRotated") is True
            if (old.generation != session.generation and not (old.command in {"reset", "upgrade"} and (old.status == "handled" or rotated_capacity)
                    and old.generation+1 == session.generation and (not rotated_capacity or old.epoch+1 == session.epoch))) or session.status == "frozen":
                raise AiError("旧环境控制已隔离", "access_denied", 403)
            return {**detail(session_id, {}, principal, poll=False), "control": control_record(old), "replayed": True}
        if session.status == "frozen":
            raise AiError("当前环境权限已冻结", "access_denied", 403)
        if command not in READ_COMMANDS and _unresolved_activity(session, json.loads(workspace.state_json)):
            raise AiError("原下载活动尚未确认结束，请观察原回执", "pi_activity_unknown", 409)
        if PiControl.objects.filter(session=session, generation=session.generation, status__in=["sent", "unknown"]).exists() and command != "pause":
            raise AiError("原控制效果尚未确认，请观察原回执", "pi_control_unknown", 409)
        exclusive = {"dependency_install", "upgrade", "reset", "model_set", "session_new", "session_switch", "session_fork", "session_clone", "reclaim_stopped"}
        if (command not in READ_COMMANDS or command == "export_html") and PiControl.objects.filter(session=session, generation=session.generation,
                command__in=exclusive, status__in=["prepared", "queued", "sent", "accepted", "unknown"]).exists():
            raise AiError("环境变更尚未确定完成，禁止新增写入或终端输入", "pi_control_active", 409)
        compatible = READ_COMMANDS | {"steer", "follow_up", "clear_queue", "abort_bash", "ui_response", "terminal_create", "terminal_input", "terminal_resize", "terminal_close", "thinking_set", "skills_reload"}
        if command not in compatible and PiControl.objects.filter(session=session, generation=session.generation,
                status__in=["prepared", "queued", "accepted"]).exists():
            raise AiError("原工作区控制尚未完成，请观察原回执", "pi_control_active", 409)
        operation = _operation(session)
        if command in {"session_new", "session_switch", "session_fork", "session_clone"}:
            pi_native.history_preflight(session)
        if operation and command not in {"clear_queue", "abort_bash", "ui_response", "terminal_close", "pause"}:
            # Internal re-authorization, no client-supplied admission to compare.
            pi_native.authorize(operation, kind="workspace", name=command, lock=True, require_supplied=False)
        active = operation and operation.status in service.ACTIVE
        if active and operation.kind == "workspace:compact" and command not in (READ_COMMANDS - {"export_html"}) | {"pause"}:
            raise AiError("原压缩尚未完成，请观察原控制回执", "pi_control_active", 409)
        if command == "pause" and active:
            raise AiError("暂停环境需要先停止当前操作并确认终态", "pi_operation_active", 409)
        if (session.status == "unknown" or operation and operation.status == "unknown") and command != "pause":
            raise AiError("未知操作保留执行围栏", "pi_operation_active", 409)
        if workspace.status == "paused" and command not in {"wake", "reset", "upgrade", "pause", *READ_COMMANDS}:
            raise AiError("环境已暂停，请先唤醒", "pi_environment_paused", 409)
        if active and command not in RUNNING_COMMANDS and command not in READ_COMMANDS:
            raise AiError("此控制需要空闲安全点", "pi_operation_active", 409)
        if command in {"steer", "follow_up", "ui_response"} and (not active or operation.status != "running" or operation.cancel_requested):
            raise AiError("此控制需要正在执行的操作", "pi_no_active_operation", 409)
        if command == "ui_response":
            request = PiUiRequest.objects.select_for_update().filter(id=payload["requestId"], session=session, operation=operation,
                generation=session.generation, status="pending").first()
            if not request:
                raise AiError("交互请求不存在或已过期", "pi_ui_expired", 409)
            request_kind = json.loads(request.request_json).get("method")
            pi_native.validate_questionnaire_answer(request, payload)
            if "cancelled" not in payload and ((request_kind == "confirm" and "confirmed" not in payload)
                    or (request_kind in {"select", "input", "editor"} and "value" not in payload)):
                raise AiError("交互回复类型与请求不匹配")
        if command == "thinking_set":
            from . import configuration
            model = configuration.resolve_model(workspace.model_id or (operation.model_id if operation else None))
            effective_model(model, payload["level"])
        if command == "upgrade":
            plans = json.loads(workspace.state_json).get("upgradePlans", [])
            if not any(isinstance(p, dict) and p.get("planId") == payload["planId"] for p in plans):
                raise AiError("环境升级需要已登记的新镜像与兼容性计划", "pi_upgrade_plan_required", 409)
        recovery_manifest = None
        if command == "compact":
            from .pi_context import recovery, compact_payload
            recovery_manifest = recovery(session, workspace)
            payload = compact_payload(payload, recovery_manifest)
        workspace.control_seq += 1
        workspace.updated_at = timezone.now(); workspace.save(update_fields=["control_seq", "updated_at"])
        # `active` is the routing switch between model_set's two mechanisms:
        # while active, model_set stays a lightweight control (below) that the
        # Pi runner queues as pendingModel and applies at its own safe point
        # (pi_runner/workspace.py:558-585); only when genuinely idle does it
        # fall through to a full _create_environment rebuild via needs_init.
        # model_set is in `exclusive`, not `compatible`, specifically so a
        # sibling control left accepted while NOT active (e.g. bash) blocks
        # model_set earlier, before this clause can race a rebuild against
        # that still-live container. See
        # test_model_set_with_bash_in_flight_rejects_cleanly_and_session_stays_usable.
        needs_init = not active and (not operation or workspace.status == "uninitialized" or command == "model_set")
        research = command in {"research_search", "research_read"}
        row = PiControl.objects.create(id=uid("pi-control"), session=session, operation=None if command == "compact" or needs_init and not research else operation, client_request_id=key,
            request_digest=binding, epoch=session.epoch, generation=session.generation, control_seq=workspace.control_seq,
            command=command, payload_json=canonical(payload))
        if command == "compact":
            operation = _new_operation(session, workspace, principal, "workspace:compact",
                {"controlId": row.id, "recovery": recovery_manifest}, queued=True)
            row.operation, row.status = operation, "queued"; row.save(update_fields=["operation", "status"])
            service.event(session, "workspace_control", {"controlId": row.id, "command": command, "status": "queued"}, operation)
            return {**detail(session_id, {}, principal, poll=False), "control": control_record(row), "replayed": False}
        if needs_init and not research and command not in {"reset", "upgrade"}:
            operation = _new_operation(session, workspace, principal, "workspace:init", {"controlId": row.id}, queued=False)
            row.operation = operation; row.save(update_fields=["operation"]); initialize = True
        if command == "pause" and active:
            # Stop admission is serialized here with every gateway reservation.
            operation.cancel_requested = True
            if operation.status == "running":
                operation.status, session.status = "canceling", "canceling"
                session.save(update_fields=["status"])
            operation.save(update_fields=["cancel_requested", "status"])
            service.stop_exports(operation)
        if command == "ui_response":
            request.response_control, request.status = row, "responded"
            request.save(update_fields=["response_control", "status"])
            payload = {**payload, "requestId": request.runner_request_id}
        row.status = "sent"; row.save(update_fields=["status"])
    try:
        if command == "reset":
            return _rotate(row, session, workspace, operation, principal)
        if initialize:
            environment_known = False
            created = _create_environment(operation)
            environment_known = True
            with mutation(): ingest(session, workspace, operation, created)
        selected_model = None
        if command == "model_set":
            from . import configuration
            from .model_capabilities import options
            selected_model = configuration.resolve_model(payload["modelId"])
            opts = options(selected_model)
            from .pi_worker import gateway_capability
            payload = {"model": pi_native.model_binding(selected_model, workspace.thinking_level), "gateway": gateway_capability(operation)}
        if command in {"research_search", "research_read"}:
            from .pi_research import execute_public_research
            action = "search" if command == "research_search" else "read"
            explicit = payload.get("query" if action == "search" else "url")
            result = execute_public_research(action, payload, explicit_query=explicit)
            receipt = {"controlId": row.id, "controlSeq": row.control_seq, "status": "completed", "result": result}
            response = {}
        else:
            if command == "dependency_install":
                from .pi_research import DependencyBroker
                from .configuration import resolve_model
                from .model_capabilities import options
                fields(payload, {"ecosystem", "packages"}, {"ecosystem", "packages"})
                budget = integer(options(resolve_model(workspace.model_id or operation.model_id))["taskTimeoutMs"], "taskTimeoutMs")
                remaining = int(row.created_at.timestamp()*1000) + budget - int(timezone.now().timestamp()*1000)
                if remaining <= 0:
                    raise AiError("依赖下载已达到本次配置时限", "pi_task_deadline", 409)
                activity_uncertain = True
                _activity(operation, row, principal, "begin", timeout_ms=remaining)
                activity_uncertain = False
                try:
                    payload = {"bundle": DependencyBroker().fetch(payload["ecosystem"], payload["packages"])}
                except Exception as fetch_error:
                    # The broker performs only bounded GETs. No installation
                    # has been admitted; end the lease before reporting a known
                    # fetch failure. An uncertain end keeps the original fence.
                    with mutation():
                        locked = PiSession.objects.select_for_update().get(pk=row.session_id)
                        service.event(locked, "workspace_activity_fetch_failed", {"controlId": row.id,
                            "code": getattr(fetch_error, "code", "pi_dependency_fetch_failed")}, operation)
                    activity_uncertain = True
                    _activity(operation, row, principal, "end")
                    activity_uncertain = False
                    raise
            from .pi_worker import identity
            if command in {"wake", "upgrade"}:
                with mutation(principal):
                    locked = service.get_session(session_id, principal, lock=True)
                    if (locked.epoch, locked.generation, locked.status) != (row.epoch, row.generation, session.status):
                        raise AiError("Pi 本地环境的原会话状态已变化", "pi_tree_fenced", 409)
                    pi_native.authorize(operation, kind="workspace", name=command, lock=True, require_supplied=False)
                    model = _historical_local_model(operation, _workspace(locked), session=locked)
                    row.payload_json = canonical({**payload, "admission": pi_native.admission(operation),
                        **({"localModel": model} if model is not None else {})})
                    row.save(update_fields=["payload_json"])
                    payload = json.loads(row.payload_json)
            else:
                payload = {**payload, "admission": pi_native.admission(operation)}
            runner_sent = True
            response = pi_transport.command({**identity(operation), "command": "workspace", "payload": {"action": "control",
                "controlId": row.id, "controlSeq": row.control_seq, "command": "resource_install" if command == "dependency_install" else command, "payload": payload}})
            receipt = response.get("control", response.get("workspace", {}).get("control"))
            if not isinstance(receipt, dict):
                raise AiError("Pi 控制回执缺失", "pi_control_unknown", 503)
            if command == "dependency_install" and receipt.get("status") in {"queued", "accepted", "handled", "completed", "failed"}:
                activity_uncertain = True
                _activity(operation, row, principal, "end")
                activity_uncertain = False
            receipt = _capture_download(row, receipt, operation, principal)
        with mutation():
            current = service.get_session(session_id, principal, lock=True)
            if (current.epoch, current.generation) != (session.epoch, session.generation) or current.status == "frozen":
                raise AiError("迟到的控制属于旧代际", "access_denied", 403)
            workspace = _workspace(current)
            _effective_readback(row, receipt, workspace)
            _known_result(row, receipt)
            if response:
                ingest(current, workspace, operation, response, snapshot=workspace.control_seq == row.control_seq)
            if row.status in {"handled", "completed"}:
                if command == "clear_queue":
                    pi_native.clear_agent_queue(current)
                if command == "pause": workspace.status = "paused"
                if command == "wake": workspace.status = "ready"
                workspace.save()
            elif command == "wake" and row.status == "failed" and response.get("workspace", {}).get("environmentStatus") == "stopped":
                workspace.status = "paused"
                workspace.save(update_fields=["status"])
            elif command == "wake" and row.status == "unknown":
                workspace.status = "unknown"
                workspace.save(update_fields=["status"])
            # History reconciliation may append root events through a separately
            # loaded session instance under this same authority transaction.
            current.refresh_from_db(fields=["event_seq", "updated_at"])
            service.event(current, "workspace_control", {"controlId": row.id, "command": command, "status": row.status}, operation)
        if initialize:
            _finish_init(operation)
        return {**detail(session_id, {}, principal, poll=False), "control": control_record(row), "replayed": False}
    except Exception as error:
        from .pi_transport import SessionLimitRejected
        known_capacity = False
        if initialize and isinstance(error, SessionLimitRejected):
            from .pi_worker import fail_before_prompt
            known_capacity = fail_before_prompt(operation, error)
        # The catch remains deliberately wide. This
        # catch is deliberately wide because `unknown` is a safety fence, not
        # error handling -- anything unexpected after the request may have
        # reached the Runner, so it must keep blocking an automatic resend.
        # The cost is that a programming error (KeyError/TypeError/AttributeError
        # against our own structures) is reported as "result unknown" with no
        # trace of what actually broke. Logging here, before the fence logic,
        # is what tells those two apart in production.
        #
        # A missing `code` is the signal, not `not isinstance(error, AiError)`:
        # deliberate failures in this block carry a code the fence then reads
        # on the next line, and not all of them are AiError -- pi_research's
        # ResearchError is a coded ValueError (pi_research.py:36-39), so keying
        # on AiError would log every research network failure as a code fault
        # and bury the real ones. Programming errors carry no code.
        #
        # `runner_sent` is the same request-boundary flag the fence uses below;
        # it is set at pi_workspace.py:684 immediately before pi_transport
        # .command, so a False here means nothing was put on the wire.
        if not hasattr(error, "code"):
            logger.exception(
                "pi_workspace control raised an uncoded exception: controlId=%s command=%s session=%s "
                "errorType=%s runnerSent=%s environmentKnown=%s activityUncertain=%s",
                row.id, command, session_id, type(error).__name__,
                runner_sent, environment_known, activity_uncertain)
        with mutation():
            row.refresh_from_db()
            if row.status not in {"completed", "handled", "failed"}:
                known_upgrade = getattr(error, "code", "") == "workspace_native_image_upgrade_required"
                known_unsent = known_capacity or known_upgrade or not runner_sent and environment_known and not activity_uncertain and command not in {"reset", "upgrade"}
                row.status, row.error_code, row.updated_at = "failed" if known_unsent else "unknown", getattr(error, "code", "pi_control_unknown"), timezone.now()
                row.save(update_fields=["status", "error_code", "updated_at"])
                if not known_unsent:
                    workspace.status = "unknown"; workspace.save(update_fields=["status"])
                locked = PiSession.objects.select_for_update().get(pk=row.session_id)
                service.event(locked, "workspace_control_unknown" if not known_unsent else "workspace_control_failed",
                    {"controlId": row.id, "command": row.command, "status": row.status, "code": row.error_code}, row.operation)
        if initialize and getattr(error, "code", "") == "workspace_native_image_upgrade_required":
            from .pi_worker import fail_before_prompt
            fail_before_prompt(operation, error)
        elif initialize and not known_capacity and (runner_sent or not environment_known or activity_uncertain):
            from .pi_gateway import freeze
            freeze(operation, getattr(error, "code", "pi_control_unknown"))
        elif initialize:
            _finish_init(operation)
        if isinstance(error, AiError):
            raise
        raise AiError("Pi 控制结果未知，禁止自动重发", getattr(error, "code", "pi_control_unknown"), 503) from error


def reclaim_stopped(session_id, principal, *, request_id=None, expected=None):
    """Maintenance only. Observe with no request ID; apply one exact shell receipt."""
    from . import pi_native
    from .pi_models import PiBusinessAction, PiDispatch, PiExport
    from .pi_worker import identity
    from pi_runner.protocol import workspace_key

    def eligible(session, *, lock=False):
        operation = _operation(session)
        workspace = PiWorkspace.objects.filter(session=session, generation=session.generation).first()
        operations = PiOperation.objects.filter(session=session, epoch=session.epoch, generation=session.generation)
        controls = PiControl.objects.filter(session=session, epoch=session.epoch, generation=session.generation)
        if (session.status != "idle" or session.active_operation_id or not operation or operation.epoch != session.epoch
                or not workspace or workspace.status not in {"ready", "paused"}
                or operations.exclude(status__in=["succeeded", "failed", "canceled"]).exists()
                or controls.exclude(status__in=["completed", "handled", "failed"]).exists()
                or PiDispatch.objects.filter(operation__in=operations).exclude(status="completed").exists()
                or PiExport.objects.filter(operation__in=operations, status__in=["queued", "running"]).exists()
                or PiUiRequest.objects.filter(operation__in=operations, status="pending").exists()
                or PiBusinessAction.objects.filter(parent_operation__in=operations, status__in=["prepared", "queued", "claimed", "dispatched", "unknown"]).exists()
                or _unresolved_activity(session, json.loads(workspace.state_json))):
            raise AiError("Django 会话或原回执尚未安全终结", "pi_reclaim_workspace_unverified", 409)
        pi_native.authorize(operation, kind="workspace", name="wake", lock=lock, require_supplied=False)
        return operation, workspace

    if request_id is not None:
        identifier(request_id, "requestId")
        if (not isinstance(expected, dict) or set(expected) != {"containerId", "volume", "image", "lastSeq"}
                or not re.fullmatch(r"[a-f0-9]{64}", expected.get("containerId", ""))
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", expected.get("image", ""))
                or not re.fullmatch(r"[a-z0-9-]{1,128}", expected.get("volume", ""))
                or type(expected["lastSeq"]) is not int or not 0 <= expected["lastSeq"] <= 9007199254740991):
            raise AiError("必须提供拟回收外壳的精确绑定", "pi_reclaim_binding_required", 409)

    current_principal(principal, write=True)
    session = service.get_session(session_id, principal)
    if request_id is not None:
        prior = PiControl.objects.filter(session=session, client_request_id=request_id).first()
        if prior:
            if (prior.command != "reclaim_stopped" or prior.request_digest != digest(expected)
                    or (prior.epoch, prior.generation) != (session.epoch, session.generation) or session.status == "frozen"):
                raise AiError("回收请求已绑定其他内容或代际", "pi_reclaim_binding_changed", 409)
            return {"control": control_record(prior), "replayed": True}
    operation, workspace = eligible(session)
    runner_identity = identity(operation)
    state = pi_transport.command({**runner_identity, "command": "workspace", "payload": {"action": "state"}}).get("workspace", {})
    shell = {k: state.get(k) for k in ("workspaceId", "containerId", "volume", "image", "lastSeq")}
    if (state.get("environmentStatus") != "stopped" or state.get("retainedWorkspace") is not False
            or shell["workspaceId"] != workspace_key(runner_identity) or state.get("generation") != session.generation
            or not isinstance(shell["containerId"], str) or type(shell["lastSeq"]) is not int
            or not 0 <= shell["lastSeq"] <= operation.seq
            or state.get("admission") != pi_native.admission(operation)):
        raise AiError("Runner 外壳、状态或准入不匹配", "pi_reclaim_binding_changed", 409)
    if request_id is None:
        return {"observed": shell, "epoch": session.epoch, "generation": session.generation}
    if shell != {**expected, "workspaceId": workspace_key(runner_identity)}:
        raise AiError("Runner 外壳已变化，须重新核对", "pi_reclaim_binding_changed", 409)
    with mutation(principal):
        current = service.get_session(session_id, principal, lock=True)
        if PiControl.objects.filter(session=current, client_request_id=request_id).exists():
            raise AiError("请读取原回收请求回执", "pi_control_active", 409)
        latest, workspace = eligible(current, lock=True)
        admission = pi_native.admission(latest)
        if identity(latest) != runner_identity or admission != state["admission"]:
            raise AiError("会话或准入已变化，须重新核对", "pi_reclaim_binding_changed", 409)
        workspace.control_seq += 1
        workspace.save(update_fields=["control_seq"])
        row = PiControl.objects.create(id=uid("pi-control"), session=current, operation=latest, client_request_id=request_id,
            request_digest=digest(expected), epoch=current.epoch, generation=current.generation, control_seq=workspace.control_seq,
            command="reclaim_stopped", payload_json=canonical({"expected": shell, "admission": admission,
                "requireLocalRestore": workspace.status == "paused"}), status="sent")
    try:
        response = pi_transport.command({**runner_identity, "command": "workspace", "payload": {"action": "control",
            "controlId": row.id, "controlSeq": row.control_seq, "command": row.command, "payload": json.loads(row.payload_json)}})
        receipt = response.get("control", {})
        with mutation(principal):
            current = service.get_session(session_id, principal, lock=True)
            if (current.epoch, current.generation) != (row.epoch, row.generation) or current.status != "idle":
                raise AiError("迟到的回收结果属于原代际", "pi_reclaim_unknown", 409)
            if receipt.get("status") not in {"completed", "failed"} or receipt.get("command") != row.command:
                raise AiError("回收效果待核原回执", "pi_reclaim_unknown", 409)
            if receipt["status"] == "completed" and receipt.get("result") != {**shell, "containerRemoved": True, "volumePreserved": True}:
                raise AiError("回收缺少外壳删除与工作卷保留证明", "pi_reclaim_unknown", 409)
            _known_result(row, receipt)
            if row.status == "completed":
                workspace = _workspace(current)
                ingest(current, workspace, latest, response)
                workspace.status = "paused" if json.loads(row.payload_json)["requireLocalRestore"] else "ready"
                workspace.save(update_fields=["status"])
            service.event(current, "workspace_control", {"controlId": row.id, "command": row.command, "status": row.status}, latest)
    except Exception as error:
        with mutation():
            row.refresh_from_db()
            if row.status == "sent":
                current = PiSession.objects.select_for_update().get(pk=session_id)
                row.status, row.error_code = "unknown", "pi_reclaim_unknown"
                row.save(update_fields=["status", "error_code"])
                if (current.epoch, current.generation) == (row.epoch, row.generation) and current.status != "frozen":
                    PiWorkspace.objects.filter(session=current, generation=row.generation).exclude(status="frozen").update(status="unknown")
                service.event(current, "workspace_control_unknown", {"controlId": row.id, "command": row.command, "code": row.error_code}, latest)
        raise AiError("回收结果未知，禁止重发；请观察原回执", "pi_reclaim_unknown", 409) from error
    return {"control": control_record(row), "replayed": False}


def _rotate(row, session, workspace, operation, principal):
    from . import pi_worker
    # No active/unknown operation or unresolved control can be bypassed by a
    # new generation. The old named volume remains audit evidence.
    with mutation(principal):
        from .pi_native import rotate_root_environment
        rotate_root_environment(service.get_session(session.id, principal, lock=True))
    if operation:
        pi_worker.dispose_environment(operation)
    with mutation(principal):
        current = service.get_session(session.id, principal, lock=True)
        if PiOperation.objects.filter(session=current, status__in=service.ACTIVE).exists():
            raise AiError("旧操作尚未确定结束", "pi_operation_active", 409)
        current.epoch += 1; current.generation += 1; current.runner_event_seq = 0; current.save()
        workspace.generation, workspace.status, workspace.state_json = current.generation, "uninitialized", "{}"
        workspace.save()
        new = _new_operation(current, workspace, principal, "workspace:init", {"controlId": row.id}, queued=False)
    from .pi_transport import SessionLimitRejected
    try:
        result = _create_environment(new)
    except SessionLimitRejected as error:
        if not pi_worker.fail_before_prompt(new, error):
            from .pi_gateway import freeze
            freeze(new, "pi_create_rejection_unmatched")
            raise
        with mutation():
            row.status, row.error_code = "failed", error.code
            row.result_json = canonical({"generation": current.generation, "epoch": current.epoch,
                "preservedOldGeneration": True, "generationRotated": True, "replacementCreated": False})
            row.save(update_fields=["status", "error_code", "result_json"])
            locked = PiSession.objects.select_for_update().get(pk=current.pk)
            service.event(locked, "workspace_control_failed", {"controlId": row.id, "command": "reset",
                "status": "failed", "code": error.code, "generationRotated": True}, new)
        raise
    with mutation():
        ingest(current, workspace, new, result)
        row.status, row.result_json = "handled", canonical({"generation": current.generation, "epoch": current.epoch, "preservedOldGeneration": True})
        row.save(update_fields=["status", "result_json"])
        PiUiRequest.objects.filter(session=current, status="pending").exclude(generation=current.generation).update(status="expired")
    _finish_init(new)
    return {**detail(session.id, {}, principal, poll=False), "control": control_record(row), "replayed": False}


def effective_model(model, level):
    """Return an in-memory model copy; the selected level is an op snapshot.

    The global model configuration is never edited by a session control.
    Unsupported endpoint parameter relationships fail before a control send.
    """
    if not level:
        return model
    import copy
    from .model_capabilities import options, validate
    result = copy.copy(model)
    cfg = options(model)
    if level == "off":
        result.reasoning_mode = "disabled"
        if cfg["reasoningFormat"] in {"anthropic_budget", "anthropic_adaptive"}:
            cfg["reasoningFormat"] = "default"
        cfg["reasoningEffort"] = "none" if cfg["reasoningFormat"] in {"thinking", "reasoning_effort"} else "default"
    else:
        if result.reasoning_mode == "disabled":
            raise AiError("当前模型配置禁用了思考", "pi_thinking_unsupported", 409)
        if cfg["reasoningFormat"] not in {"thinking", "reasoning_effort", "anthropic_adaptive"}:
            raise AiError("当前模型配置没有可调思考强度参数", "pi_thinking_unsupported", 409)
        cfg["reasoningEffort"] = level
    result.generation_options_json = canonical(validate(cfg, protocol=result.protocol, max_tokens=result.max_tokens, reasoning_mode=result.reasoning_mode))
    return result
