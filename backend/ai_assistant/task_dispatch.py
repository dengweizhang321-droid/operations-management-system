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
from .task_models import TaskDefinition, TaskGrant, TaskIncident, TaskRevision, TaskRun

TRIAGE = {
    "waiting_data": ("等待原时点精确数据依赖", "原截止时间内由可信数据读取器证明覆盖、字段及版本齐备"),
    "dispatch_unknown": ("认领并核对原 operation/action/execution 回执；禁止换 ID 重发", "可信原账本已协调且当前权限与原授权仍有效"),
    "authorization_expired": ("由任务拥有者重新审阅具体授权范围", "另行明确授权，未知原动作先协调"),
    "login_required": ("由任务拥有者处理原连接器登录", "原连接器身份验证通过并核对原动作回执"),
    "manual_required": ("认领后核查证据与原领域账本", "逐项满足记录的恢复条件；关闭分诊不代表重跑获准"),
}


def incident_record(row):
    return {"id": row.id, "runId": row.run_id, "errorClass": row.error_class, "ruleVersion": row.rule_version,
            "ownerEmail": row.owner_email, "assignee": row.assignee, "state": row.state,
            "nextAction": row.next_action, "resumeConditions": row.resume_conditions,
            "notificationKey": row.notification_key, "notificationStatus": row.notification_status,
            "version": row.version, "resolutionNote": row.resolution_note}


def incident(run, error_class, evidence=None):
    if error_class not in TRIAGE:
        raise AiError("未登记的分诊类别")
    passive(evidence or {}, 8192)
    action, conditions = TRIAGE[error_class]
    row, _created = TaskIncident.objects.get_or_create(notification_key=digest({"run": run.id, "class": error_class, "stage": "initial"}),
        defaults={"id": uid("task-incident"), "run": run, "error_class": error_class,
                  "evidence_json": canonical(evidence or {}), "owner_email": run.task.owner_email,
                  "next_action": action, "resume_conditions": conditions})
    return row


def accept_occurrence(task_id, *, trigger_kind, occurrence_key, scheduled_at):
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
        # Existing identities are returned before checking the latest revision:
        # editing a definition must not create another run for an old event.
        old = TaskRun.objects.filter(task=task, trigger_kind=trigger_kind, occurrence_key=key).first()
        if old:
            return old, False
        revision = TaskRevision.objects.get(task=task, revision=task.current_revision)
        spec = json.loads(revision.spec_json)
        if not task.enabled or spec["trigger"]["kind"] != trigger_kind:
            raise AiError("任务未启用或触发类型不符", "task_not_ready", 409)
        now = timezone.now()
        deadline = scheduled_at + timedelta(seconds=spec["trigger"]["windowSeconds"])
        grant = TaskGrant.objects.filter(revision=revision, owner_email=task.owner_email,
            revoked_at__isnull=True, expires_at__gt=now).exists()
        if not grant:
            raise AiError("原任务长期授权无效", "access_denied", 403)
        status = "queued" if now <= deadline else "missed"
        run = TaskRun.objects.create(id=uid("task-run"), task=task, revision=revision,
            trigger_kind=trigger_kind, occurrence_key=key, scheduled_at=scheduled_at,
            deadline_at=deadline, status=status)
        if status == "missed" and spec["missedPolicy"] == "notify_only":
            incident(run, "manual_required", {"reason": "original_occurrence_missed_no_replay"})
        return run, True


def claim(run_id, worker_id, *, now=None):
    """A lease may resume pre-delegation work, never re-dispatch an old effect."""
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
        grant = TaskGrant.objects.filter(revision=run.revision, owner_email=run.task.owner_email,
            revoked_at__isnull=True, expires_at__gt=now).exists()
        if not run.task.enabled or not grant:
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


def check_lease(run, worker_id, fence, now):
    if run.status != "leased" or run.lease_owner != worker_id or run.fence != fence or not run.lease_until or now >= run.lease_until:
        raise AiError("原执行租约已失效", "version_conflict", 409)
    if not run.task.enabled or now > run.deadline_at or not TaskGrant.objects.filter(
            revision=run.revision, owner_email=run.task.owner_email, revoked_at__isnull=True, expires_at__gt=now).exists():
        raise AiError("任务、原窗口或授权已失效", "access_denied", 403)


def handoff(run_id, worker_id, fence, operation_id):
    """Bind an already existing Pi operation, under its original identity.

    No retry caller may replace it. The actual adapter must create that
    operation and call this function within the same authority transaction.
    """
    from .pi_models import PiOperation
    with mutation():
        run = TaskRun.objects.select_for_update().select_related("task", "revision").get(pk=identifier(run_id))
        check_lease(run, worker_id, fence, timezone.now())
        op = PiOperation.objects.select_related("session").get(pk=identifier(operation_id))
        if op.session.owner_email != run.task.owner_email or op.scope_json != run.task.scope_json or op.actor_role != run.task.actor_role:
            raise AiError("Pi 执行身份与原任务不符", "access_denied", 403)
        if op.client_request_id != run.id:
            raise AiError("Pi 操作未绑定原 run 身份", "conflict", 409)
        run.operation_id, run.status = op.id, "delegated"
        run.version += 1
        run.updated_at = timezone.now()
        run.save()
        return run


def observe(run_id):
    """Only observe the original Pi operation. Unknown never creates a new one."""
    from .pi_models import PiOperation
    with mutation():
        run = TaskRun.objects.select_for_update().select_related("task").get(pk=identifier(run_id))
        if run.status != "delegated" or not run.operation_id:
            return run
        op = PiOperation.objects.filter(pk=run.operation_id).first()
        state = {"succeeded": "succeeded", "failed": "failed", "canceled": "canceled", "frozen": "unknown", "unknown": "unknown"}.get(op.status if op else "unknown")
        if state:
            run.status, run.error_code = state, op.error_code if op else "original_operation_missing"
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
