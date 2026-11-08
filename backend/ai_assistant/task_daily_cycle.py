"""One approved JD daily cycle for the disposable PostgreSQL rehearsal.

No URL, worker loop or recurring producer consumes this adapter. The public
definition remains disabled and its production SQL admission is unchanged.
"""
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.utils import timezone

from . import configuration, dingtalk, dingtalk_transport, pi_service, task_definitions, task_dependencies, task_dispatch
from .dingtalk_models import AiDingTalkSession
from .dingtalk_schedules import next_slot
from .pi_models import PiDispatch, PiEvent, PiOperation
from .policy import AiError, canonical, cas, current_principal, digest, mutation, passive
from .task_daily_sources import INVENTORY, REQUIRED_FIELDS, SALES, SHOP, read
from .task_models import TaskDefinition, TaskGrant, TaskRevision, TaskRun

SHANGHAI = ZoneInfo("Asia/Shanghai")
COST = {"modelTurns": 1, "externallyBillable": False}


def require_isolated():
    db = connection.settings_dict
    if (settings.DJANGO_ENVIRONMENT != "test" or settings.DJANGO_PROCESS_ROLE != "development"
            or connection.vendor != "postgresql" or db["HOST"] != "127.0.0.1"
            or db["NAME"] != "test_teruisi_ai_rehearsal" or not str(db["PORT"]).isdigit()
            or not 55440 <= int(db["PORT"]) <= 55999):
        task_dispatch.require_executor()


def target_for(principal, session, config):
    if not AiDingTalkSession.objects.filter(pk=session.id, config_digest=session.config_digest, sender_id=session.sender_id,
            owner_email=session.owner_email, corp_id=session.corp_id, robot_code=session.robot_code,
            conversation_type="1", scope_json=session.scope_json).exists():
        raise AiError("日报缺少原本人单聊身份回执", "access_denied", 403)
    bound = dingtalk.guard(session, config)
    if ((bound.email, bound.role, bound.scope) != (principal.email, principal.role, principal.scope)
            or session.conversation_type != "1" or not bound.email.endswith(".invalid")
            or not all(value.startswith("w12-isolated-") for value in (session.corp_id, session.robot_code, session.sender_id))):
        raise AiError("日报仅接受本隔离任务拥有者的已核单聊", "access_denied", 403)
    return {"connector": "dingtalk", "targetType": "person", "targetId": session.sender_id, "senderId": session.sender_id}


def approved_spec(revision, owner, session, config):
    spec = task_definitions.normalize(json.loads(revision.spec_json), owner)
    trigger = spec["trigger"]
    deps = spec["dataDependencies"]
    if (digest(spec) != revision.spec_digest or spec["shopSelection"] != SHOP or spec["skill"]["kind"] != "bundled"
            or trigger["kind"] != "time" or trigger["cadence"] != "daily"
            or spec["missedPolicy"] != "wait_for_data_until_deadline" or len(deps) != len(REQUIRED_FIELDS)
            or {dep["dataset"]: set(dep["requiredFields"]) for dep in deps} != REQUIRED_FIELDS
            or spec["deliveryTargets"] != [target_for(owner, session, config)]
            or configuration.resolve_model(spec["modelId"]).version != spec["modelVersion"]):
        raise AiError("日报定义与已批准的单店场景不符", "task_not_ready", 409)
    return spec


def update(run, **changes):
    for field, value in changes.items():
        setattr(run, field, value)
    run.updated_at = timezone.now()
    run.version += 1
    run.save(update_fields=[*changes, "version", "updated_at"])


@dataclass(frozen=True)
class DailyCycle:
    task_id: str
    revision_id: str
    task_version: int
    slot: datetime
    session_id: str
    config_digest: str

    @property
    def grant_id(self):
        # Unique for this definition, including across revisions and slots.
        return "w12-cycle-" + digest(self.task_id)

    def authorization(self, task, revision):
        return "w12-isolated:" + digest({"taskId": task.id, "taskVersion": self.task_version,
            "revisionId": revision.id, "revisionDigest": revision.spec_digest, "owner": task.owner_email,
            "role": task.actor_role, "scope": json.loads(task.scope_json), "scheduledAt": self.slot.isoformat(),
            "sessionId": self.session_id, "channelConfigDigest": self.config_digest, "cost": COST})

    def active_grant(self, task, revision, now):
        if ((task.id, task.version, task.current_revision, revision.id) !=
                (self.task_id, self.task_version, revision.revision, self.revision_id)
                or task.enabled or task.next_run_at is not None):
            return None
        return TaskGrant.objects.filter(pk=self.grant_id, revision=revision, owner_email=task.owner_email,
            authorization_ref=self.authorization(task, revision), revoked_at__isnull=True, expires_at__gt=now).first()

    def admit(self, task, trigger, key, scheduled_at, now):
        if (task.id, trigger, key, scheduled_at) != (self.task_id, "time", self.slot.isoformat(), self.slot) or now < self.slot:
            raise AiError("该时点不在隔离日报授权内", "access_denied", 403)
        revision = TaskRevision.objects.get(pk=self.revision_id, task=task)
        grant = self.active_grant(task, revision, now)
        if not grant:
            raise AiError("原日报任务或授权已失效", "access_denied", 403)
        return revision, grant

    def authorizes(self, run, now):
        return ((run.task_id, run.revision_id, run.grant_id, run.trigger_kind, run.occurrence_key, run.scheduled_at) ==
                (self.task_id, self.revision_id, self.grant_id, "time", self.slot.isoformat(), self.slot)
                and bool(self.active_grant(run.task, run.revision, now)))

    def tick(self, worker):
        require_isolated()
        run, _ = task_dispatch.accept_occurrence(self.task_id, trigger_kind="time", occurrence_key=self.slot.isoformat(),
            scheduled_at=self.slot, _daily_cycle=self)
        claimed = task_dispatch.claim(run.id, worker, _daily_cycle=self)
        if not claimed:
            return task_dispatch.observe(run.id)
        owner = task_dispatch.current_owner(claimed)
        spec = json.loads(claimed.revision.spec_json)
        snapshots = read(owner, spec, claimed.scheduled_at)
        dependencies = task_dependencies.evaluate(spec, claimed.scheduled_at, snapshots)
        with mutation(owner):
            current = TaskRun.objects.select_for_update().select_related("task", "revision").get(pk=run.id)
            task_dispatch.check_lease(current, worker, claimed.fence, timezone.now(), _daily_cycle=self)
            if not dependencies["ready"]:
                evidence = {"reason": "daily_sources_not_ready", "gaps": dependencies["gaps"]}
                update(current, status="waiting_data", error_code="daily_sources_not_ready", evidence_json=canonical(evidence))
                task_dispatch.incident(current, "waiting_data", evidence)
                return current
            evidence = {"dailySources": {"bindings": dependencies["bindings"], "facts": snapshots}}
            passive(evidence, 8192)
            update(current, error_code="", evidence_json=canonical(evidence))
            session = pi_service.create_session({"clientRequestId": "task-session-" + current.id,
                "scope": owner.scope, "shopSelection": SHOP}, owner)["session"]
            payload = task_dispatch.operation_payload(current)
            op_id = pi_service.prompt(session["id"], payload, owner)["operation"]["id"]
            return task_dispatch.handoff(current.id, worker, claimed.fence, op_id, _daily_cycle=self)

    def live_run(self, run_id):
        run = TaskRun.objects.select_for_update().select_related("task", "revision").get(pk=run_id, task_id=self.task_id)
        now = timezone.now()
        if not self.authorizes(run, now) or not run.scheduled_at <= now < run.deadline_at or run.status != "delegated":
            raise AiError("原日报任务或授权已失效", "access_denied", 403)
        task_dispatch.current_owner(run)
        return run

    def generate(self, run_id, submit):
        """Reserve the only model request and pass it to the isolated Runner seam."""
        require_isolated()
        with mutation():
            run = self.live_run(run_id)
            op = PiOperation.objects.select_related("session").get(pk=run.operation_id, status="running")
            task_dispatch.check_operation_binding(run, op)
            evidence = json.loads(run.evidence_json)
            if "modelRequestId" in evidence or PiDispatch.objects.filter(operation=op, kind="model").exists():
                raise AiError("原日报模型请求已预留，禁止重放", "conflict", 409)
            request_id = "w12-model-" + digest(run.id)
            update(run, evidence_json=canonical({**evidence, "modelRequestId": request_id}))
        return submit(op, request_id)

    def preview(self, run_id, owner):
        require_isolated()
        current_principal(owner, admin=True)
        with mutation(owner):
            run = self.live_run(run_id)
            if run.task.owner_email != owner.email.lower():
                raise AiError("仅日报拥有者可确认", "access_denied", 403)
            run = task_dispatch.observe(run.id)
            return draft(run)

    def deliver_once(self, run_id, owner, approval, session, config_reader, sender):
        require_isolated()
        current_principal(owner, admin=True, write=True)
        item = self.preview(run_id, owner)
        if item["approvalDigest"] != approval:
            raise AiError("日报草稿已变化，请重新确认", "version_conflict", 409)

        def verify_target():
            config = config_reader()
            if (session.id, digest(config), digest(target_for(owner, session, config))) != (
                    self.session_id, self.config_digest, item["intent"]["targetDigest"]):
                raise AiError("本人渠道已变化，禁止发送", "access_denied", 403)

        def before_send():
            with mutation(owner):
                run = self.live_run(run_id)
                verify_target()
                if run.execution_ref or draft(run)["approvalDigest"] != approval:
                    raise AiError("原日报投递已预留或内容变化，禁止发送", "conflict", 409)
                update(run, execution_ref="w12-delivery-" + item["intent"]["deliveryId"],
                    evidence_json=canonical({**json.loads(run.evidence_json), "approvedDeliveryDigest": approval}))

        verify_target()
        ref = "w12-delivery-" + item["intent"]["deliveryId"]
        reserved = False

        def reserve():
            nonlocal reserved
            before_send()
            reserved = True

        failed = False
        try:
            receipt = sender(config_reader, session, item["text"], before_send=reserve)
        except Exception as error:
            if not reserved:
                raise
            stage_error = getattr(dingtalk_transport, "DingTalkDeliveryError", None)
            failed = bool(stage_error and isinstance(error, stage_error) and error.delivery["outcome"] in {"not_sent", "rejected"})
            receipt = None
        if not reserved:
            raise AiError("未经过原投递围栏", "conflict", 409)
        accepted = (isinstance(receipt, dict) and receipt.get("platform") == "dingtalk" and receipt.get("state") == "accepted"
            and isinstance(receipt.get("receiptSha256"), str) and re.fullmatch(r"[0-9a-f]{64}", receipt["receiptSha256"]))
        outcome = {**item["intent"], "status": "sent" if accepted else "failed" if failed else "unknown",
                   "receiptRef": "w12-receipt-" + receipt["receiptSha256"] if accepted else ref}
        return task_dispatch.observe(run_id, delivery_receipt_reader=lambda run, key, target: outcome)


def approve(task_id, expected_version, owner, session, config):
    """Approve exactly the latest daily instant still inside its frozen window."""
    require_isolated()
    current_principal(owner, admin=True, write=True)
    with mutation(owner):
        task = task_definitions.owned(task_id, owner, lock=True)
        cas(task, expected_version)
        revision = task_definitions.revision_for(task)
        spec = approved_spec(revision, owner, session, config)
        trigger = spec["trigger"]
        now = timezone.now()
        slot = next_slot("daily", trigger["hour"], trigger["minute"], trigger["day"],
            now.astimezone(SHANGHAI) - timedelta(days=1, microseconds=1))
        deadline = slot + timedelta(seconds=trigger["windowSeconds"])
        if task.enabled or task.next_run_at is not None or not slot <= now < deadline:
            raise AiError("原日报时点不在本次批准窗口内", "task_not_ready", 409)
        cycle = DailyCycle(task.id, revision.id, task.version, slot, session.id, digest(config))
        grant, _ = TaskGrant.objects.get_or_create(pk=cycle.grant_id, defaults={"revision": revision, "owner_email": owner.email.lower(),
            "authorization_ref": cycle.authorization(task, revision), "expires_at": deadline})
        if grant != cycle.active_grant(task, revision, now):
            raise AiError("原日报定义已使用单周期授权", "access_denied", 403)
        return cycle


def draft(run):
    if (run.report_status, run.delivery_status, run.status) != ("ready", "pending", "delegated") or run.execution_ref:
        raise AiError("原日报草稿不可发送", "task_not_ready", 409)
    evidence = json.loads(run.evidence_json)
    dispatches = list(PiDispatch.objects.filter(operation_id=run.operation_id, kind="model").order_by("id")[:2])
    answer_events = list(PiEvent.objects.filter(operation_id=run.operation_id, event_type="assistant_message").order_by("event_seq")[:2])
    if (len(dispatches) != 1 or dispatches[0].request_id != evidence.get("modelRequestId") or dispatches[0].status != "completed"
            or dispatches[0].error_code or len(answer_events) != 1):
        raise AiError("日报缺少唯一原模型回执或正文", "task_not_ready", 409)
    answer = json.loads(answer_events[0].data_json)
    if answer.get("messageId") != dispatches[0].request_id or answer.get("finalDigest") != digest(answer.get("text", "")):
        raise AiError("日报正文与原模型请求不符", "task_not_ready", 409)
    sources = evidence["dailySources"]
    sales, stock = sources["facts"][SALES], sources["facts"][INVENTORY]
    body = (f"京东志高商用设备旗舰店经营日报\nERP本店销售 {sales['date']}：净销售额 {sales['sales_amount_cents']} 分，净销量 {sales['quantity']}。\n"
            f"库存 {stock['date']}：全部计入库存的仓可用量 {stock['included_warehouse_quantity']}。\n" + answer["text"])
    item = {"runId": run.id, "revisionId": run.revision_id, "grantId": run.grant_id, "operationId": run.operation_id,
        "dispatchId": dispatches[0].id, "sourceBindings": sources["bindings"],
        "intent": next(iter(json.loads(run.delivery_receipts_json).values())), "text": dingtalk.plain_reply(body, truncate=False)}
    return {**item, "approvalDigest": digest(item)}
