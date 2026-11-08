"""Occurrence and handoff ledger, ready for a separately admitted executor.

This module never calls a provider, starts n8n, delivers messages or mutates a
Pi operation. An adopted adapter must attach the original operation atomically
and keep checking the grant before side effects. Lease expiry is coordination,
not evidence that an operation did not happen.
"""
import json
from datetime import timedelta
from django.utils import timezone
from .policy import AiError, canonical, current_principal, digest, fields, identifier, integer, mutation, passive, text, uid
from .schedule_core import is_missed_window
from .task_models import TaskDefinition, TaskGrant, TaskIncident, TaskRevision, TaskRun

TRIAGE_VERSION = "unified-task-triage-v1"
TRIAGE_RULES = {TRIAGE_VERSION: {
    "waiting_data": ("等待原时点精确数据依赖", "原截止时间内由可信数据读取器证明覆盖、字段及版本齐备"),
    "dispatch_unknown": ("认领并核对原 operation/action/execution 回执；禁止换 ID 重发", "可信原账本已协调且当前权限与原授权仍有效"),
    "authorization_expired": ("由任务拥有者重新审阅具体授权范围", "另行明确授权，未知原动作先协调"),
    "login_required": ("由任务拥有者处理原连接器登录", "原连接器身份验证通过并核对原动作回执"),
    "manual_required": ("认领后核查证据与原领域账本", "逐项满足记录的恢复条件；关闭分诊不代表重跑获准"),
}}


def require_executor():
    # Adoption needs a reviewed executor, trusted trigger/dependency adapters
    # and a new SQL admission branch. An environment flag cannot enable it.
    raise AiError("统一执行器尚未采用；内部派发入口关闭", "task_executor_not_adopted", 409)


def require_daily_cycle(cycle):
    from .task_daily_cycle import DailyCycle, require_isolated
    require_isolated()
    if type(cycle) is not DailyCycle:
        require_executor()


def evidence_record(run, raw):
    """Only references, never opaque external bodies, URLs or customer text."""
    result = {"sourceRefs": []}
    value = json.loads(raw)
    if isinstance(value, dict):
        for ref in value.get("sourceRefs", [])[:16] if isinstance(value.get("sourceRefs", []), list) else []:
            if isinstance(ref, dict) and ref.get("kind") in {"netshop_batch", "report"}:
                result["sourceRefs"].append({"kind": ref["kind"], "id": identifier(ref.get("id"))})
        reason = value.get("reason")
        if isinstance(reason, str) and len(reason) <= 160 and all(c.isalnum() or c in "_-" for c in reason):
            result["reasonCode"] = reason
    if run.operation_id:
        result["sourceRefs"].append({"kind": "operation", "id": run.operation_id,
            "readPath": "/api/ai/pi/operations/" + identifier(run.operation_id) + "/evidence"})
    if run.execution_ref:
        result["executionRef"] = run.execution_ref
    return result


def run_record(row, *, evidence=False):
    result = {"id": row.id, "revisionId": row.revision_id, "grantId": row.grant_id, "ruleVersion": row.rule_version,
        "triggerKind": row.trigger_kind, "occurrenceKey": row.occurrence_key, "scheduledAt": row.scheduled_at.isoformat(),
        "deadlineAt": row.deadline_at.isoformat(), "status": row.status, "operationId": row.operation_id,
        "executionRef": row.execution_ref, "errorCode": row.error_code, "version": row.version,
        "reportStatus": row.report_status, "deliveryStatus": row.delivery_status,
        "detailPath": f"/api/ai/pi/task-definitions/{row.task_id}/runs/{row.id}"}
    if evidence:
        result["evidence"] = evidence_record(row, row.evidence_json)
        result["deliveries"] = list(json.loads(row.delivery_receipts_json).values())
    return result


def incident_record(row, *, evidence=False):
    result = {"id": row.id, "runId": row.run_id, "errorClass": row.error_class, "ruleVersion": row.rule_version,
            "ownerEmail": row.owner_email, "assignee": row.assignee, "state": row.state,
            "nextAction": row.next_action, "resumeConditions": row.resume_conditions,
            "notificationKey": row.notification_key, "notificationStatus": row.notification_status,
            "version": row.version, "resolutionNote": row.resolution_note,
            "detailPath": f"/api/ai/pi/task-definitions/{row.run.task_id}/incidents/{row.id}"}
    if evidence:
        result["evidence"] = evidence_record(row.run, row.evidence_json)
    return result


def incident(run, error_class, evidence=None):
    rules = TRIAGE_RULES.get(run.rule_version, {})
    if error_class not in rules:
        raise AiError("未登记的分诊类别")
    passive(evidence or {}, 8192)
    action, conditions = rules[error_class]
    row, _created = TaskIncident.objects.get_or_create(notification_key=digest({"run": run.id, "class": error_class, "stage": "initial"}),
        defaults={"id": uid("task-incident"), "run": run, "error_class": error_class,
                  "rule_version": run.rule_version,
                  "evidence_json": canonical(evidence or {}), "owner_email": run.task.owner_email,
                  "next_action": action, "resume_conditions": conditions})
    return row


def accept_occurrence(task_id, *, trigger_kind, occurrence_key, scheduled_at, _daily_cycle=None):
    """Trusted adapter only. No public body can assert a verified occurrence.

    Time uses the original scheduled instant; messages use tenant/app/event ID;
    events use the domain's immutable batch/revision; conditions use rule and
    false-to-true transition watermarks. Their producers are not adopted yet.
    """
    if trigger_kind not in {"time", "message", "event", "condition"}:
        raise AiError("触发类型无效")
    key = text(occurrence_key, "原时点身份", 500)
    if scheduled_at is None or timezone.is_naive(scheduled_at):
        raise AiError("触发时点必须包含时区")
    with mutation():
        task = TaskDefinition.objects.select_for_update().get(pk=identifier(task_id))
        now = timezone.now()
        if _daily_cycle is not None:
            require_daily_cycle(_daily_cycle)
            revision, grant = _daily_cycle.admit(task, trigger_kind, key, scheduled_at, now)
        # Existing identities are returned before checking the latest revision:
        # editing a definition must not create another run for an old event.
        old = TaskRun.objects.filter(task=task, trigger_kind=trigger_kind, occurrence_key=key).first()
        if old:
            if _daily_cycle is not None and (old.revision_id, old.grant_id) != (revision.id, grant.id):
                raise AiError("原时点已绑定其他授权", "version_conflict", 409)
            return old, False
        if _daily_cycle is None:
            require_executor()
            revision = TaskRevision.objects.get(task=task, revision=task.current_revision)
        spec = json.loads(revision.spec_json)
        if _daily_cycle is None:
            if not task.enabled or spec["trigger"]["kind"] != trigger_kind:
                raise AiError("任务未启用或触发类型不符", "task_not_ready", 409)
            grant = TaskGrant.objects.filter(revision=revision, owner_email=task.owner_email,
                revoked_at__isnull=True, expires_at__gt=now).order_by("-created_at", "id").first()
        if not grant:
            raise AiError("原任务长期授权无效", "access_denied", 403)
        window = timedelta(seconds=spec["trigger"]["windowSeconds"])
        deadline = scheduled_at + window
        status = "missed" if is_missed_window(now, scheduled_at, window) else "queued"
        run = TaskRun.objects.create(id=uid("task-run"), task=task, revision=revision,
            grant=grant, rule_version=TRIAGE_VERSION,
            trigger_kind=trigger_kind, occurrence_key=key, scheduled_at=scheduled_at,
            deadline_at=deadline, status=status)
        if status == "missed" and spec["missedPolicy"] == "notify_only":
            incident(run, "manual_required", {"reason": "original_occurrence_missed_no_replay"})
        return run, True


def claim(run_id, worker_id, *, now=None, _daily_cycle=None):
    """A lease may resume pre-delegation work, never re-dispatch an old effect."""
    if _daily_cycle is not None:
        require_daily_cycle(_daily_cycle)
    now = now or timezone.now()
    worker_id = identifier(worker_id, "执行者")
    with mutation():
        run = TaskRun.objects.select_for_update().select_related("task", "revision").get(pk=identifier(run_id))
        if run.operation_id or run.execution_ref:
            return None
        if run.status == "leased" and run.lease_until and run.lease_until > now:
            return None
        if run.status not in {"queued", "waiting_data", "leased"}:
            return None
        if now < run.scheduled_at:
            return None
        if _daily_cycle is None:
            require_executor()
        current_owner(run)
        if not authorized(run, now, _daily_cycle):
            run.status, run.error_code = "canceled", "task_disabled_or_grant_revoked"
        elif now > run.deadline_at:
            run.status, run.error_code = "expired", "original_window_expired"
        else:
            run.status, run.lease_owner = "leased", worker_id
            run.lease_until = min(now + timedelta(seconds=60), run.deadline_at)
            run.fence += 1
        run.version += 1
        run.updated_at = now
        run.save()
        return run if run.status == "leased" else None


def check_lease_identity(run, worker_id, fence, now):
    if run.status != "leased" or run.lease_owner != worker_id or run.fence != fence or not run.lease_until or now >= run.lease_until or now < run.scheduled_at or now > run.deadline_at:
        raise AiError("原执行租约已失效", "version_conflict", 409)


def authorized(run, now, _daily_cycle=None):
    if _daily_cycle is not None:
        require_daily_cycle(_daily_cycle)
        return _daily_cycle.authorizes(run, now)
    return run.task.enabled and TaskGrant.objects.filter(
        pk=run.grant_id, revision=run.revision, owner_email=run.task.owner_email,
        revoked_at__isnull=True, expires_at__gt=now).exists()


def check_lease(run, worker_id, fence, now, *, _daily_cycle=None):
    check_lease_identity(run, worker_id, fence, now)
    current_owner(run)
    if not authorized(run, now, _daily_cycle):
        raise AiError("任务、原窗口或授权已失效", "access_denied", 403)


def current_owner(run):
    from sales.auth import Principal
    return current_principal(Principal(run.task.owner_email, run.task.owner_email,
        run.task.actor_role, json.loads(run.task.scope_json)), write=True, background=True)


def operation_payload(run):
    spec = json.loads(run.revision.spec_json)
    if spec["skill"]["kind"] != "bundled":
        raise AiError("资源库文字指导尚无 Pi 运行技能绑定", "task_not_ready", 409)
    context = {"taskId": run.task_id, "revisionId": run.revision_id, "revisionDigest": run.revision.spec_digest,
        "grantId": run.grant_id, "scheduledAt": run.scheduled_at.isoformat(), "occurrenceKey": run.occurrence_key,
        "parameters": spec["parameters"]}
    frozen_sources = json.loads(run.evidence_json).get("dailySources")
    if frozen_sources is not None:
        context["dailySources"] = frozen_sources
    return {"clientRequestId": run.id, "message": spec["prompt"] + "\n固定任务上下文：" + canonical(context),
        "modelId": spec["modelId"], "skillIds": [spec["skill"]["id"]], "scope": json.loads(run.task.scope_json),
        "shopSelection": spec["shopSelection"], "fileIds": [], "businessExecution": {"allowedActions": []}}


def check_operation_binding(run, op):
    spec = json.loads(run.revision.spec_json)
    expected = operation_payload(run)
    session = op.session
    if (session.owner_email != run.task.owner_email or session.actor_role != run.task.actor_role
            or session.scope_json != run.task.scope_json or session.selection_json != canonical(spec["shopSelection"])
            or session.client_request_id != "task-session-" + run.id
            or op.scope_json != run.task.scope_json or op.actor_role != run.task.actor_role
            or op.epoch != session.epoch or op.generation != session.generation
            or op.client_request_id != run.id or op.kind != "prompt"
            or op.model_id != spec["modelId"] or op.model_version != spec["modelVersion"]):
        raise AiError("Pi 操作与原任务、会话或模型绑定不符", "access_denied", 403)
    payload = json.loads(op.payload_json)
    required = {key: expected[key] for key in ("message", "skillIds", "shopSelection", "fileIds", "businessExecution")}
    # Newer Pi prompts also record branch provenance. A dedicated task session
    # may start without a native branch; an existing branch is not authorized.
    if "nativeBranchBinding" in payload:
        required["nativeBranchBinding"] = None
    if payload != required:
        raise AiError("Pi 指令、参数、店铺或动作授权与原版本不符", "access_denied", 403)
    skills = json.loads(op.skills_json)
    binding = spec["skill"]
    if (not isinstance(skills, list) or len(skills) != 1 or skills[0].get("id") != binding["id"]
            or skills[0].get("version") != binding["version"] or skills[0].get("sha256") != binding["digest"]):
        raise AiError("Pi Skill 版本或摘要与原任务不符", "access_denied", 403)


def handoff(run_id, worker_id, fence, operation_id, *, _daily_cycle=None):
    """Bind an already existing Pi operation, under its original identity.

    No retry caller may replace it. The actual adapter must create that
    operation and call this function within the same authority transaction.
    """
    if _daily_cycle is None:
        require_executor()
    else:
        require_daily_cycle(_daily_cycle)
    from .pi_models import PiOperation
    with mutation():
        run = TaskRun.objects.select_for_update().select_related("task", "revision").get(pk=identifier(run_id))
        check_lease(run, worker_id, fence, timezone.now(), _daily_cycle=_daily_cycle)
        op = PiOperation.objects.select_related("session").get(pk=identifier(operation_id))
        check_operation_binding(run, op)
        run.operation_id, run.status = op.id, "delegated"
        run.version += 1
        run.updated_at = timezone.now()
        run.save()
        return run


def observe(run_id, *, delivery_receipt_reader=None):
    """Observe original operation/receipts; this never initiates delivery.

    A reader is a trusted connector adapter over its original send ledger, not
    an HTTP request body. No production adapter is adopted; the default keeps
    delivery pending. A synthetic adapter is used only in the private rehearsal.
    """
    from .pi_models import PiOperation
    with mutation():
        run = TaskRun.objects.select_for_update().select_related("task", "revision").get(pk=identifier(run_id))
        if run.status != "delegated" or not run.operation_id:
            return run
        op = PiOperation.objects.filter(pk=run.operation_id).first()
        state = {"succeeded": "delegated", "failed": "failed", "canceled": "canceled", "frozen": "unknown", "unknown": "unknown"}.get(op.status if op else "unknown")
        if state:
            if op and op.status == "succeeded":
                run.report_status = "ready"
                expected = {}
                spec = json.loads(run.revision.spec_json)
                for target in spec["deliveryTargets"]:
                    key = digest({"runId": run.id, "target": target})
                    expected[key] = {"deliveryId": key, "targetDigest": digest(target), "status": "pending", "receiptRef": ""}
                receipts = json.loads(run.delivery_receipts_json)
                if receipts and set(receipts) != set(expected):
                    raise AiError("原投递身份集合与冻结任务不符", "conflict", 409)
                receipts = receipts or expected
                for key, receipt in receipts.items():
                    if receipt["deliveryId"] != key or receipt["targetDigest"] != expected[key]["targetDigest"]:
                        raise AiError("原投递目标绑定变化", "conflict", 409)
                    if receipt["status"] != "pending" or delivery_receipt_reader is None:
                        continue
                    original = delivery_receipt_reader(run, key, receipt["targetDigest"])
                    if original is None:
                        continue
                    fields(original, {"deliveryId", "targetDigest", "status", "receiptRef"}, {"deliveryId", "targetDigest", "status", "receiptRef"})
                    if (original["deliveryId"] != key or original["targetDigest"] != receipt["targetDigest"]
                            or original["status"] not in {"sent", "failed", "unknown"}):
                        raise AiError("原投递回执绑定不符", "conflict", 409)
                    identifier(original["receiptRef"], "原投递回执")
                    receipts[key] = dict(original)
                run.delivery_receipts_json = canonical(receipts)
                statuses = {value["status"] for value in receipts.values()}
                if "unknown" in statuses:
                    state, run.delivery_status = "unknown", "unknown"
                elif "failed" in statuses:
                    state, run.delivery_status = "failed", "failed"
                elif statuses == {"sent"}:
                    state, run.delivery_status = "succeeded", "sent"
                elif not receipts:
                    state, run.delivery_status = "succeeded", "not_required"
                else:
                    run.delivery_status = "pending"
            elif state in {"failed", "unknown", "canceled"}:
                run.report_status = "unknown" if state == "unknown" else "failed"
                run.delivery_status = "not_required"
            run.status, run.error_code = state, op.error_code if op else "original_operation_missing"
            if run.delivery_status in {"failed", "unknown"}:
                run.error_code = "delivery_" + run.delivery_status
            run.version += 1
            run.updated_at = timezone.now()
            run.save()
            if state in {"unknown", "failed"}:
                incident(run, "dispatch_unknown" if state == "unknown" else "manual_required", {"operationId": run.operation_id})
        return run


def incident_control(incident_id, payload, principal, action):
    current_principal(principal, admin=True, write=True)
    required = {"expectedVersion"} | ({"resolutionNote"} if action == "close" else set())
    fields(payload, required, required)
    with mutation(principal):
        row = TaskIncident.objects.select_for_update().filter(id=identifier(incident_id), owner_email=principal.email.lower()).first()
        if not row:
            raise AiError("分诊记录不存在", "not_found", 404)
        if row.version != integer(payload["expectedVersion"], "版本", 1):
            raise AiError("分诊记录已变化", "version_conflict", 409)
        if action == "claim" and row.state == "open":
            row.state, row.assignee = "claimed", principal.email.lower()
        elif action == "close" and row.state == "claimed" and row.assignee == principal.email.lower():
            row.state, row.resolution_note = "closed", text(payload["resolutionNote"], "处置说明", 2000)
        else:
            raise AiError("当前分诊状态不允许此操作", "conflict", 409)
        row.version += 1
        row.updated_at = timezone.now()
        row.save()
    return {"item": incident_record(row), "businessReplayed": False, "originalRunChanged": False}
