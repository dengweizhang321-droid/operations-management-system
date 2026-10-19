"""Durable, user-attributed Pi business actions; model calls only prepare.

One browser-granted intent owns one action ID. Neither a new model invocation,
an expired worker lease nor a lost acknowledgement grants permission to replay.
"""
import json
import hmac
from datetime import datetime, timedelta

from django.utils import timezone
from sales.auth import Principal
from . import pi_service as service
from .pi_models import PiBusinessAction, PiBusinessAudit, PiBusinessIntent, PiOperation, PiSession, PiWorkspace
from .policy import AiError, canonical, current_principal, digest, fields, identifier, integer, mutation, passive, scope_covers, uid

KINDS = {"create_work_plan": "work_plan.create", "save_replenishment_draft": "replenishment_draft.create",
    "execute_registered_gap": "n8n_gap.run", "deliver_report": "report.deliver"}
TOOLS = {"prepare_pi_work_plan": "create_work_plan", "prepare_pi_replenishment_draft": "save_replenishment_draft",
    "prepare_pi_gap_execution": "execute_registered_gap", "prepare_pi_report_delivery": "deliver_report"}
PENDING = {"prepared", "queued", "claimed"}
TERMINAL = {"succeeded", "failed", "canceled"}


def grants(value):
    if value is None:
        return []
    fields(value, {"allowedActions"}, {"allowedActions"})
    allowed = value["allowedActions"]
    if (not isinstance(allowed, list) or len(allowed)>4 or any(not isinstance(x, str) or x not in KINDS for x in allowed)
            or len(set(allowed)) != len(allowed)):
        raise AiError("业务执行授权类型无效")
    return allowed


def create_intents(session, operation, allowed, message, principal):
    if allowed and principal.role not in {"operator", "admin"}:
        raise AiError("业务执行仅允许运营或管理员", "access_denied", 403)
    for kind in allowed:
        PiBusinessIntent.objects.create(id=uid("pi-intent"), action_id=uid("pi-action"), session=session,
            parent_operation=operation, action_type=kind, owner_email=principal.email.lower(), actor_role=principal.role,
            scope_json=operation.scope_json, epoch=operation.epoch, generation=operation.generation,
            user_message_digest=digest(message), expires_at=timezone.now()+timedelta(hours=24))


def intent_record(row):
    return {"userIntentId": row.id, "actionId": row.action_id, "actionType": row.action_type,
        "parentOperationId": row.parent_operation_id, "expiresAt": row.expires_at.isoformat()}


def intents(operation):
    return [intent_record(row) for row in PiBusinessIntent.objects.filter(parent_operation=operation).order_by("action_type")]


def action_record(row):
    result = {"id": row.id, "actionId": row.id, "userIntentId": row.user_intent_id, "parentOperationId": row.parent_operation_id,
        "invocationId": row.invocation_id, "actionType": row.action_type, "status": row.status, "version": row.version,
        "preview": json.loads(row.preview_json), "previewDigest": row.preview_digest, "targetVersion": row.target_version,
        "confirmationExpiresAt": row.confirmation_expires_at.isoformat() if row.confirmation_expires_at else None,
        "cancelRequested": row.cancel_requested, "result": json.loads(row.result_json), "errorCode": row.error_code,
        "createdAt": row.created_at.isoformat(), "updatedAt": row.updated_at.isoformat()}
    result["controls"] = [{"clientRequestId": value["clientRequestId"], "command": entry.event_type[7:], "status": value.get("status", row.status)}
        for entry in PiBusinessAudit.objects.filter(action=row, event_type__startswith="client:").order_by("-created_at")[:100]
        if (value := json.loads(entry.data_json)).get("clientRequestId")]
    return result


def _audit(action, kind, data, *, audit_id=None):
    passive(data, 128*1024)
    PiBusinessAudit.objects.create(id=audit_id or uid("pi-business-audit"), action=action, event_type=kind, data_json=canonical(data))
    session = PiSession.objects.select_for_update().get(pk=action.session_id)
    service.event(session, "business_action", action_record(action), action.parent_operation)


def _principal(action, *, effect=False):
    session = PiSession.objects.get(pk=action.session_id)
    op = PiOperation.objects.get(pk=action.parent_operation_id)
    principal = current_principal(Principal(action.owner_email, action.owner_email, action.actor_role, json.loads(action.scope_json)), write=True, background=True)
    if principal.role not in {"operator", "admin"} or (session.owner_email, session.epoch, session.generation, session.actor_role) != (action.owner_email, action.epoch, action.generation, action.actor_role) or session.status == "frozen":
        raise AiError("业务动作的身份或环境代际已失效", "pi_business_fenced", 403)
    if not scope_covers(principal.scope, action.scope_json) or not scope_covers(json.loads(session.scope_json), action.scope_json):
        raise AiError("业务动作范围已失效", "pi_business_fenced", 403)
    if effect:
        workspace = PiWorkspace.objects.filter(session_id=action.session_id, generation=action.generation).first()
        if workspace and workspace.status in {"paused", "unknown", "frozen"}:
            raise AiError("工作区已暂停或控制结果未知", "pi_business_fenced", 409)
        if action.cancel_requested or op.cancel_requested or op.status not in {"running", "succeeded"} or session.status in {"canceling", "unknown"}:
            raise AiError("已停止新增业务动作；已派发效果须保留原回执", "pi_business_canceled", 409)
        if action.user_intent.expires_at <= timezone.now():
            raise AiError("用户业务意图已过期", "pi_business_intent_expired", 409)
        if (not action.confirmation_digest or action.confirmation_digest != action.preview_digest
                or not action.confirmation_expires_at or action.confirmation_expires_at <= timezone.now()):
            raise AiError("业务动作确认已过期或与预览不一致", "pi_business_confirmation_expired", 409)
    return principal


def _owned(session_id, action_id, principal, *, lock=False):
    session = service.get_session(session_id, principal, lock=lock)
    if session.status == "frozen":
        raise AiError("旧业务动作已隔离", "access_denied", 403)
    query = PiBusinessAction.objects.select_for_update() if lock else PiBusinessAction.objects
    action = query.filter(pk=identifier(action_id, "actionId"), session=session, generation=session.generation).first()
    if not action:
        raise AiError("业务动作不存在", "not_found", 404)
    return action


def listing(session_id, params, principal):
    fields(params, {"limit", "recipients"})
    limit = service.number(params.get("limit", "50"), "limit", 1, 100)
    session = service.get_session(session_id, principal)
    if session.status == "frozen":
        return {"items": [], "intents": [], "hasMore": False}
    rows = list(PiBusinessAction.objects.filter(session=session, generation=session.generation).order_by("-created_at")[:limit+1])
    result = {"items": [action_record(row) for row in rows[:limit]], "hasMore": len(rows)>limit,
        "intents": [intent_record(row) for row in PiBusinessIntent.objects.filter(session=session, generation=session.generation).order_by("-created_at")[:100]]}
    if params.get("recipients") == "true":
        from . import pi_business_domains as domains
        result["recipients"] = domains.recipients(principal)["items"]
    elif "recipients" in params:
        raise AiError("recipients 参数无效")
    return result


def tool_prepare(operation, user_intent_id, tool_name, parameters, invocation_id):
    if tool_name not in TOOLS:
        raise AiError("业务工具未登记", "access_denied", 403)
    principal = service.principal_for_work(operation)
    from . import pi_selection
    if pi_selection.for_operation(operation):
        raise AiError("单店环境尚不能证明这些跨领域业务动作的归属", "access_denied", 403)
    passive(parameters, 128*1024)
    invocation_id = identifier(invocation_id, "invocationId")
    binding = digest({"toolName": tool_name, "parameters": parameters})
    def admit():
        op = PiOperation.objects.select_for_update().get(pk=operation.pk)
        service.principal_for_work(op)
        intent = PiBusinessIntent.objects.filter(id=identifier(user_intent_id, "userIntentId"), parent_operation=op,
            action_type=TOOLS[tool_name], epoch=op.epoch, generation=op.generation).first()
        if not intent or intent.expires_at <= timezone.now() or intent.user_message_digest != digest(json.loads(op.payload_json).get("message", "")):
            raise AiError("缺少当前用户明确授予的业务意图", "pi_business_intent_required", 403)
        old = PiBusinessAction.objects.select_for_update().filter(pk=intent.action_id).first()
        if old:
            if old.request_digest != binding:
                raise AiError("该用户意图已绑定另一份内容，请以新一轮明确意图准备", "pi_business_intent_consumed", 409)
            return op, intent, old
        return op, intent, None
    with mutation(principal):
        op, intent, old = admit()
        if old:
            return {"action": action_record(old), "replayed": True}
    # Owning-domain reads happen without an AI transaction. The immutable user
    # intent already exists; the final admission repeats after this network gap.
    from . import pi_business_domains as domains
    prepared = domains.prepare(principal, KINDS[intent.action_type], parameters)
    passive(prepared, 128*1024)
    with mutation(principal):
        op, intent, old = admit()
        if old:
            return {"action": action_record(old), "replayed": True}
        if intent.action_type == "execute_registered_gap" and prepared["preview"].get("noGap") is True:
            # Authoritative coverage is already complete. Keep the original
            # user intent but create neither an action nor an execution task.
            return {"status": "no_gap", "actionId": intent.action_id, "userIntentId": intent.id,
                "executionCreated": False, "coverage": prepared["preview"]["coverage"], "replayed": False}
        preview = {"actionType": intent.action_type, "details": prepared["preview"], "scope": prepared["scope"],
            "targetVersion": str(prepared["targetVersion"]), "epoch": op.epoch, "generation": op.generation}
        action = PiBusinessAction.objects.create(id=intent.action_id, session=op.session, parent_operation=op, user_intent=intent,
            invocation_id=invocation_id, action_type=intent.action_type, owner_email=intent.owner_email, actor_role=principal.role,
            scope_json=op.scope_json, epoch=op.epoch, generation=op.generation, request_digest=binding,
            parameters_json=canonical(prepared["parameters"]), preview_json=canonical(preview), preview_digest=digest(preview),
            target_version=str(prepared["targetVersion"]), confirmation_expires_at=intent.expires_at)
        _audit(action, "prepared", {"invocationId": invocation_id, "requestDigest": binding, "previewDigest": action.preview_digest})
        return {"action": action_record(action), "replayed": False}


def tool_status(operation, action_id):
    principal = service.principal_for_work(operation)
    row = _owned(operation.session_id, action_id, principal)
    return {"action": action_record(row)}


def tool_options(operation):
    principal = service.principal_for_work(operation)
    from . import pi_selection
    if pi_selection.for_operation(operation):
        raise AiError("单店环境不开放跨领域业务动作", "access_denied", 403)
    granted = intents(operation)
    if not granted:
        raise AiError("本轮没有业务执行授权", "access_denied", 403)
    result = {"intents": granted}
    if any(item["actionType"] == "deliver_report" for item in granted):
        from . import pi_business_domains as domains
        result["recipients"] = domains.recipients(principal)["items"]
        from .pi_models import PiFile
        files = PiFile.objects.filter(session_id=operation.session_id, owner_email=principal.email.lower(),
            generation=operation.generation, direction__in=["output", "export"]).defer("payload").order_by("-created_at")[:100]
        result["files"] = [{"fileId": row.id, "fileName": row.file_name, "mimeType": row.mime_type,
            "sizeBytes": row.size_bytes, "sha256": row.sha256, "parentOperationId": row.operation_id}
            for row in files if scope_covers(principal.scope, row.scope_json) and row.file_name.rsplit(".", 1)[-1].lower() in {"pdf", "xlsx"}][:40]
    if any(item["actionType"] == "execute_registered_gap" for item in granted):
        from . import pi_business_n8n
        result["capabilities"] = pi_business_n8n.capabilities(principal)
    return result


def consumer(operation_name, payload, principal):
    required = {"parentOperationId", "surface"}
    allowed = required | ({"userIntentId", "toolName", "parameters", "invocationId"} if operation_name == "pi-business-prepare" else
        set() if operation_name == "pi-business-options" else {"actionId"})
    fields(payload, allowed, allowed)
    if payload["surface"] != "pi_business":
        raise AiError("业务入口无效", "access_denied", 403)
    op = PiOperation.objects.filter(pk=identifier(payload["parentOperationId"]), session__owner_email=principal.email.lower()).first()
    if not op:
        raise AiError("Pi 操作不存在", "not_found", 404)
    service.principal_for_work(op)
    return (tool_prepare(op, payload["userIntentId"], payload["toolName"], payload["parameters"], payload["invocationId"]) if operation_name == "pi-business-prepare" else
        tool_options(op) if operation_name == "pi-business-options" else tool_status(op, payload["actionId"]))


def control(session_id, payload, principal):
    fields(payload, {"command", "clientRequestId", "actionId", "expectedVersion", "previewDigest"}, {"command", "clientRequestId", "actionId"})
    command = payload["command"]
    if command not in {"confirm", "cancel", "reconcile"}:
        raise AiError("业务动作控制无效")
    identifier(payload["clientRequestId"], "clientRequestId")
    control_id = "pi-business-client-"+digest([session_id, payload["clientRequestId"]])
    def acknowledge(action):
        _audit(action, "client:"+command, {"clientRequestId": payload["clientRequestId"], "requestDigest": digest(payload), "status": action.status}, audit_id=control_id)
    observed, observed_version = None, None
    if command == "reconcile":
        candidate = _owned(session_id, payload["actionId"], principal)
        _principal(candidate)
        if candidate.status in {"unknown", "dispatched"}:
            from . import pi_business_domains as domains
            observed_version = candidate.version
            observed = domains.observe(candidate, principal)
            passive(observed, 128*1024)
    with mutation(principal):
        action = _owned(session_id, payload["actionId"], principal, lock=True)
        # Client IDs are content-bound receipts. A repeated confirm never requeues.
        row = PiBusinessAudit.objects.filter(pk=control_id).first()
        if row:
            prior = json.loads(row.data_json)
            if row.action_id != action.id or row.event_type != "client:"+command or prior["requestDigest"] != digest(payload):
                raise AiError("业务控制标识内容变化", "conflict", 409)
            return {"action": action_record(action), "replayed": True}
        _principal(action)
        if action.status in TERMINAL:
            acknowledge(action)
            return {"action": action_record(action), "replayed": False}
        if command == "confirm":
            if action.status != "prepared" or action.version != integer(payload.get("expectedVersion"), "expectedVersion") or payload.get("previewDigest") != action.preview_digest:
                raise AiError("预览版本已变化，请读取原动作", "version_conflict", 409)
            action.confirmation_digest = action.preview_digest
            _principal(action, effect=True)
            action.status = "queued"
        elif command == "cancel":
            action.cancel_requested = True
            if action.status in PENDING:
                action.status, action.error_code = "canceled", "pi_business_canceled"
            # dispatched/unknown is not rolled back or described as canceled.
        else:
            if action.status not in {"unknown", "dispatched", "succeeded"}:
                acknowledge(action)
                return {"action": action_record(action), "replayed": False}
            if observed_version == action.version and observed and observed.get("status") in {"succeeded", "failed"}:
                if action.action_type == "execute_registered_gap":
                    observed = _merge_n8n_receipt(json.loads(action.result_json), observed)
                action.status, action.result_json = observed["status"], canonical(observed)
        action.version += 1
        action.updated_at = timezone.now()
        action.save()
        acknowledge(action)
        return {"action": action_record(action), "replayed": False}


def cancel_parent(operation):
    for action in PiBusinessAction.objects.select_for_update().filter(parent_operation=operation).exclude(status__in=TERMINAL):
        action.cancel_requested = True
        if action.status in PENDING:
            action.status, action.error_code = "canceled", "pi_business_canceled"
        action.version += 1
        action.updated_at = timezone.now()
        action.save()
        _audit(action, "parent_stopped", {"status": action.status, "effectsRolledBack": False})


def claim():
    with mutation():
        for action in PiBusinessAction.objects.select_for_update().filter(status__in=["claimed", "dispatched"], lease_expires_at__lt=timezone.now()):
            action.status, action.error_code = "unknown", "pi_business_worker_lost"
            action.version += 1
            action.save()
            _audit(action, "unknown", {"code": action.error_code, "replayAllowed": False})
        action = PiBusinessAction.objects.select_for_update().filter(status="queued").order_by("created_at", "id").first()
        if not action:
            return None
        try:
            _principal(action, effect=True)
        except AiError as error:
            action.status, action.error_code = "failed", error.code
            action.version += 1
            action.save()
            _audit(action, "claim_refused", {"code": error.code})
            return None
        action.status, action.lease_token = "claimed", uid("pi-action-lease")
        action.lease_expires_at = timezone.now()+timedelta(seconds=120)
        action.version += 1
        action.save()
        _audit(action, "claimed", {"leaseDigest": digest(action.lease_token)})
        return action


def pre_effect_check(action):
    with mutation():
        current = PiBusinessAction.objects.select_for_update().get(pk=action.pk)
        if (current.lease_token != action.lease_token or current.status != "dispatched"
                or not current.lease_expires_at or current.lease_expires_at <= timezone.now()):
            raise AiError("业务动作派发所有者已失效", "pi_business_owner_lost", 409)
        return _principal(current, effect=True)


def admission(payload, principal):
    fields(payload, {"actionId", "dispatchToken"}, {"actionId", "dispatchToken"})
    with mutation(principal):
        action = PiBusinessAction.objects.select_for_update().filter(pk=identifier(payload["actionId"])).first()
        token = payload["dispatchToken"]
        if (not action or not isinstance(token, str) or not token or not action.lease_token
                or not hmac.compare_digest(token, action.lease_token)
                or action.owner_email != principal.email.lower() or action.actor_role != principal.role
                or not scope_covers(principal.scope, action.scope_json)):
            raise AiError("业务派发凭证无效", "access_denied", 403)
        pre_effect_check(action)
        return {"ok": True, "actionId": action.id, "version": action.version, "previewDigest": action.preview_digest}


def authorize_n8n(action_id, execution_id):
    """Called only by the native n8n metadata verifier, never by a model tool."""
    with mutation():
        action = PiBusinessAction.objects.select_for_update().filter(pk=identifier(action_id)).first()
        if not action or action.action_type != "execute_registered_gap" or action.status != "dispatched":
            raise AiError("n8n 动作已停止或不是有效派发", "pi_business_fenced", 403)
        principal = _principal(action, effect=True)
        receipt = json.loads(action.result_json)
        bound = receipt.get("executionId") or receipt.get("receipt", {}).get("executionId")
        if not bound or str(bound) != str(execution_id):
            raise AiError("n8n 执行不属于原业务动作", "pi_business_fenced", 403)
        return principal


def _merge_n8n_receipt(existing, incoming):
    """Native execution binding can arrive before the webhook acknowledgement."""
    prior_receipt, receipt = existing.get("receipt", {}), incoming.get("receipt", {})
    if not isinstance(prior_receipt, dict) or not isinstance(receipt, dict):
        raise AiError("n8n 原执行回执结构无效", "pi_n8n_execution_binding_conflict", 409)
    bound = existing.get("executionId") or prior_receipt.get("executionId")
    received = incoming.get("executionId") or receipt.get("executionId")
    if bound and received and str(bound) != str(received):
        raise AiError("n8n 原执行身份冲突，禁止替换或重放", "pi_n8n_execution_binding_conflict", 409)
    merged = {**existing, **incoming}
    merged_receipt = {**prior_receipt, **receipt}
    for key in ("executionId", "workflowId", "versionId", "storeKey"):
        prior, current = prior_receipt.get(key), receipt.get(key)
        if prior is not None:
            if current is not None and str(prior) != str(current):
                raise AiError("n8n 原执行范围冲突，禁止替换或重放", "pi_n8n_execution_binding_conflict", 409)
            merged_receipt[key] = prior
    if bound:
        merged["executionId"] = bound
        merged_receipt["executionId"] = bound
    if merged_receipt:
        merged["receipt"] = merged_receipt
    return merged


def observe_pending_n8n(stopped=None):
    """Observe one original native execution, without dispatching any work.

An append-only lease fences concurrent observers. Lost observation replies are
safe to observe again after expiry because this path never invokes execute().
"""
    if stopped is not None and stopped.is_set():
        return
    with mutation():
        action = PiBusinessAction.objects.select_for_update().filter(action_type="execute_registered_gap",
            status__in=["dispatched", "unknown"], updated_at__lte=timezone.now()-timedelta(seconds=3)).exclude(
            error_code="pi_business_observation_fenced").order_by("updated_at", "id").first()
        if not action:
            return
        previous = PiBusinessAudit.objects.filter(action=action, event_type="native_observation_started").order_by("-created_at", "-id").first()
        if previous and not PiBusinessAudit.objects.filter(pk=previous.id+"-completed").exists():
            lease = json.loads(previous.data_json)
            if datetime.fromisoformat(lease["expiresAt"]) > timezone.now():
                return
        try:
            principal = _principal(action)
        except AiError as error:
            action.status = "unknown"
            action.error_code = "pi_business_observation_fenced" if error.status == 403 else error.code
            action.version += 1
            action.updated_at = timezone.now()
            action.save()
            _audit(action, "native_observation_refused", {"code": error.code, "replayAllowed": False})
            return
        observation_id = uid("pi-native-observe")
        expected_version, owner = action.version, action.lease_token
        _audit(action, "native_observation_started", {"expiresAt": (timezone.now()+timedelta(seconds=60)).isoformat(),
            "version": expected_version, "ownerDigest": digest(owner)}, audit_id=observation_id)
    result, error_code = None, ""
    try:
        if stopped is not None and stopped.is_set():
            raise AiError("Pi worker 正在停止", "pi_worker_stopped", 503)
        from . import pi_business_domains as domains
        result = domains.observe(action, principal)
        passive(result, 128*1024)
    except Exception as error:
        error_code = getattr(error, "code", "pi_n8n_observation_unavailable")
    with mutation():
        row = PiBusinessAction.objects.select_for_update().get(pk=action.pk)
        latest = PiBusinessAudit.objects.filter(action=row, event_type="native_observation_started").order_by("-created_at", "-id").first()
        stale = (not latest or latest.id != observation_id or row.version != expected_version
            or row.lease_token != owner or row.status not in {"dispatched", "unknown"})
        if not stale:
            try:
                _principal(row)
                if result is not None:
                    merged = _merge_n8n_receipt(json.loads(row.result_json), result)
                    row.result_json = canonical(merged)
                    if result.get("status") in {"succeeded", "failed"}:
                        row.status = result["status"]
                        row.error_code = ""
            except AiError as error:
                error_code = error.code
                if error.code == "pi_n8n_execution_binding_conflict":
                    row.status, row.error_code = "unknown", error.code
            row.version += 1
            row.updated_at = timezone.now()
            row.save()
        _audit(row, "native_observation_completed", {"stale": stale, "code": error_code,
            "status": row.status, "receiptDigest": digest(result) if result is not None else None,
            "replayAllowed": False}, audit_id=observation_id+"-completed")


def perform(action, stopped=None):
    from . import pi_business_domains as domains
    dispatched = False
    try:
        with mutation():
            current = PiBusinessAction.objects.select_for_update().get(pk=action.pk)
            if current.status != "claimed" or current.lease_token != action.lease_token:
                return
            if stopped is not None and stopped.is_set():
                raise AiError("Pi worker 正在停止", "pi_worker_stopped", 503)
            principal = _principal(current, effect=True)
            current.status = "dispatched"
            current.version += 1
            current.save()
            _audit(current, "dispatch_intent", {"actionId": current.id, "invocationId": current.invocation_id,
                "previewDigest": current.preview_digest, "targetVersion": current.target_version})
        dispatched = True
        pre_effect_check(current)
        from . import transport
        def cancel_on_stop():
            if stopped is not None and stopped.is_set():
                raise AiError("Pi worker 正在停止，已派发结果需观察原回执", "pi_worker_stopped", 503)
        with transport.request_cancellation(cancel_on_stop):
            result = domains.execute(current, principal)
        passive(result, 128*1024)
        with mutation():
            row = PiBusinessAction.objects.select_for_update().get(pk=action.pk)
            if row.lease_token != action.lease_token or row.status not in {"dispatched", "unknown"}:
                raise AiError("业务动作回执所有者冲突", "pi_business_owner_lost", 409)
            row.status = ("unknown" if result.get("status") == "unknown" else
                "dispatched" if result.get("status") in {"running", "accepted", "queued"} else
                "failed" if result.get("status") == "failed" else "succeeded")
            if row.action_type == "execute_registered_gap":
                result = _merge_n8n_receipt(json.loads(row.result_json), result)
            row.result_json = canonical(result)
            row.lease_expires_at = None
            row.version += 1
            row.updated_at = timezone.now()
            row.save()
            _audit(row, "receipt", {"status": row.status, "receiptDigest": digest(result), "cancelRequested": row.cancel_requested})
    except Exception as error:
        with mutation():
            row = PiBusinessAction.objects.select_for_update().get(pk=action.pk)
            if row.lease_token != action.lease_token or row.status in TERMINAL:
                return
            row.status = "unknown" if dispatched else "failed"
            row.error_code = getattr(error, "code", "pi_business_result_unknown")
            row.version += 1
            row.updated_at = timezone.now()
            row.save()
            _audit(row, "unknown" if dispatched else "dispatch_refused", {"code": row.error_code, "replayAllowed": False})
