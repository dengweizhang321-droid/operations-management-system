"""Administrator-defined Shanghai schedules; no missed-slot replay or ambiguous resend."""
import base64
import json
from datetime import datetime, timedelta, timezone as utc
from zoneinfo import ZoneInfo

from django.utils import timezone
from sales.auth import Principal

from . import chat, dingtalk, dingtalk_settings, models as m, reports, scheduled_page_capture, schedule_monitor
from .configuration import resolve_model
from .model_capabilities import options as generation_options
from .provider_contract import PROVIDER_ADAPTER_VERSION
from .policy import AiError, current_principal, fields, identifier, integer, mutation, text, uid, digest, canonical

SHANGHAI = ZoneInfo("Asia/Shanghai")


def next_slot(cadence, hour, minute, day, after):
    local = after.astimezone(SHANGHAI)
    for offset in range(0, 33):
        date = local.date() + timedelta(days=offset)
        if cadence == "weekly" and date.isoweekday() != day:
            continue
        if cadence == "monthly" and date.day != day:
            continue
        candidate = datetime(date.year, date.month, date.day, hour, minute, tzinfo=SHANGHAI)
        if candidate > local:
            return candidate.astimezone(utc.utc)
    raise AiError("无法计算下次执行时间")


def record(row):
    return {"id": row.id, "name": row.name, "prompt": row.prompt,
        "contentType": row.content_type, "sourceRef": row.source_ref,
        "modelId": row.model_id, "executionMode": row.execution_mode,
        "cadence": row.cadence, "hour": row.hour, "minute": row.minute, "day": row.day,
        "targetType": row.target_type, "targetId": row.target_id, "senderId": row.sender_id,
        "enabled": row.enabled, "version": row.version,
        "nextRunAt": row.next_run_at.isoformat() if row.next_run_at else None,
        "lastRunAt": row.last_run_at.isoformat() if row.last_run_at else None}


def listing(principal):
    current_principal(principal, admin=True)
    items = list(m.AiDingTalkSchedule.objects.order_by("-updated_at")[:100])
    ids = [item.id for item in items]
    runs = m.AiDingTalkScheduleRun.objects.filter(schedule_id__in=ids).order_by("-created_at")[:100]
    return {"items": [record(item) for item in items], "runs": [
        {"id": run.id, "scheduleId": run.schedule_id, "scheduledAt": run.scheduled_at.isoformat(),
         "status": run.status, "errorCode": run.error_code, "completedAt": run.completed_at.isoformat() if run.completed_at else None}
        | {"dataStatus": run.data_status, "analysisStatus": run.analysis_status,
           "deliveryStatus": run.delivery_status, "stages": json.loads(run.stage_details_json),
           "modelSnapshot": json.loads(run.model_snapshot_json)}
        for run in runs]}


def save(body, principal):
    current_principal(principal, admin=True)
    required = {"name", "prompt", "cadence", "hour", "minute", "day", "targetType", "targetId", "senderId", "enabled"}
    fields(body, required | {"id", "expectedVersion", "contentType", "sourceRef", "modelId", "executionMode"}, required)
    name = text(body["name"], "名称", 100)
    content_type = body.get("contentType", "text")
    source_ref = body.get("sourceRef", "")
    mode = body.get("executionMode", "open_analysis")
    if mode not in ("open_analysis", "guangdong_monitor") or (mode != "open_analysis" and content_type != "text"):
        raise AiError("执行模式无效")
    model_id = body.get("modelId", "")
    if not isinstance(model_id, str) or (content_type != "text" and model_id):
        raise AiError("模型绑定无效")
    if not isinstance(content_type, str):
        raise AiError("投递内容类型无效")
    if content_type == "text":
        prompt = text(body["prompt"], "执行内容", 4000)
        if source_ref != "":
            raise AiError("文本任务不能指定文件或页面")
    elif content_type in {"screenshot", "report_file"}:
        if not isinstance(source_ref, str):
            raise AiError("媒体来源无效")
        prompt = text(body["prompt"], "附带文案", 4000, empty=True)
        if content_type == "report_file" and prompt:
            raise AiError("文件任务不执行 AI 指令")
        source_ref = identifier(source_ref) if content_type == "report_file" else source_ref
        if content_type == "screenshot" and source_ref not in scheduled_page_capture.PAGES:
            raise AiError("截图页面不在允许列表")
        if content_type == "report_file":
            report = reports.get(source_ref, principal)
            if report.workflow.status != "completed" or report.workflow.dry_run:
                raise AiError("报告尚未完成复核，不能定时投递", "conflict", 409)
    else:
        raise AiError("投递内容类型无效")
    cadence = body["cadence"]
    if cadence not in ("daily", "weekly", "monthly"):
        raise AiError("周期无效")
    hour, minute, day = (integer(body[k], k, *bounds) for k, bounds in
        (("hour", (0, 23)), ("minute", (0, 59)), ("day", (1, 28))))
    if cadence == "weekly" and day > 7:
        raise AiError("星期必须在 1–7 之间")
    if body["targetType"] not in ("group", "person") or type(body["enabled"]) is not bool:
        raise AiError("目标或开关无效")
    target = dingtalk.opaque(body["targetId"], "目标 ID", 256)
    sender = dingtalk.opaque(body["senderId"], "执行账号 staffId")
    if body["targetType"] == "person" and target != sender:
        raise AiError("个人投递只允许执行账号本人", "access_denied", 403)
    if body["targetType"] == "group":
        config = dingtalk_settings.read(principal)["config"]
        if not config["configured"] or not config["enabled"] or target not in {g["id"] for g in config["groups"] if g["enabled"]}:
            raise AiError("目标群尚未批准并启用", "access_denied", 403)
    now = timezone.now()
    with mutation(principal):
        if "id" in body:
            row = m.AiDingTalkSchedule.objects.select_for_update().filter(pk=identifier(body["id"])).first()
            if not row:
                raise AiError("任务不存在", "not_found", 404)
            if integer(body.get("expectedVersion"), "expectedVersion") != row.version:
                raise AiError("任务已被修改，请刷新", "version_conflict", 409)
            row.version += 1
        else:
            if "expectedVersion" in body or m.AiDingTalkSchedule.objects.count() >= 100:
                raise AiError("任务数量已达上限或版本无效")
            row = m.AiDingTalkSchedule(id=uid("ding-schedule"), owner_email=principal.email.lower())
        # Old clients may omit these fields when editing an existing task.
        # An explicit empty binding means resolve the default at each run.
        if "modelId" not in body and row.pk and row.model_id and content_type == "text":
            model_id = row.model_id
        if "executionMode" not in body and content_type == "text":
            mode = row.execution_mode
        if model_id and (body["enabled"] or row.model_id != model_id):
            resolve_model(model_id)
        row.name, row.prompt, row.cadence = name, prompt, cadence
        row.content_type, row.source_ref = content_type, source_ref
        row.model_id, row.execution_mode = model_id, mode
        row.hour, row.minute, row.day = hour, minute, day
        row.target_type, row.target_id, row.sender_id = body["targetType"], target, sender
        row.enabled, row.updated_at = body["enabled"], now
        row.next_run_at = next_slot(cadence, hour, minute, day, now) if row.enabled else None
        row.save()
    return {"item": record(row)}


def run_now(body, principal):
    current_principal(principal, admin=True)
    fields(body, {"id", "expectedVersion"}, {"id", "expectedVersion"})
    with mutation(principal):
        row = m.AiDingTalkSchedule.objects.select_for_update().filter(pk=identifier(body["id"])).first()
        if not row or not row.enabled:
            raise AiError("任务未启用或不存在", "not_found", 404)
        if row.version != integer(body["expectedVersion"], "expectedVersion"):
            raise AiError("任务版本已变化", "version_conflict", 409)
        if m.AiDingTalkScheduleRun.objects.filter(schedule=row, status__in=["queued", "running", "ready", "sending"]).exists():
            raise AiError("任务已有待执行项", "conflict", 409)
        scheduled_at = timezone.now()
        previous = m.AiDingTalkScheduleRun.objects.filter(schedule=row).order_by("-scheduled_at").values_list("scheduled_at", flat=True).first()
        if previous and scheduled_at <= previous:
            scheduled_at = previous + timedelta(microseconds=1)
        run = m.AiDingTalkScheduleRun.objects.create(id=uid("ding-run"), schedule=row,
            schedule_version=row.version, scheduled_at=scheduled_at, status="queued")
    return {"id": run.id, "status": run.status}


def recover_interrupted():
    with mutation():
        for run in m.AiDingTalkScheduleRun.objects.select_for_update().filter(status__in=["running", "ready", "sending"]):
            for phase in ("data", "analysis", "delivery"):
                if getattr(run, phase + "_status") == "running":
                    stage(run, phase, "unknown", "interrupted_result_unknown")
                elif getattr(run, phase + "_status") == "pending":
                    stage(run, phase, "not_required", "prior_stage_interrupted")
            run.status, run.error_code, run.completed_at = "unknown", "interrupted_result_unknown", timezone.now()
            run.save(update_fields=["status", "error_code", "completed_at"])


def stage(run, phase, status, code=""):
    details = json.loads(run.stage_details_json)
    item = details.setdefault(phase, {})
    stamp = timezone.now().isoformat()
    if status == "running":
        item["startedAt"] = stamp
    else:
        item["completedAt"] = stamp
    item["errorCode"] = code
    setattr(run, phase + "_status", status)
    run.stage_details_json = canonical(details)
    with mutation():
        run.save(update_fields=[phase + "_status", "stage_details_json"])


def model_snapshot(model):
    cfg = generation_options(model)
    return {"id": model.id, "name": model.name, "modelName": model.model_name,
        "version": model.version, "protocol": model.protocol, "adapterVersion": PROVIDER_ADAPTER_VERSION,
        "configurationDigest": digest([model.id, model.version, model.model_name, model.protocol,
            model.base_url, model.max_tokens, model.max_tool_rounds, model.max_total_tool_calls,
            model.reasoning_mode, model.temperature_milli, cfg]),
        "maxTokens": model.max_tokens, "maxToolRounds": model.max_tool_rounds,
        "maxTotalToolCalls": model.max_total_tool_calls, "taskTimeoutMs": cfg["taskTimeoutMs"],
        "contextWindowTokens": cfg["contextWindowTokens"]}


def step(config_reader, sender, media_sender=None):
    """Called by the singleton Stream receiver; a slot is never replayed after dispatch."""
    if not config_reader()["enabled"]:
        return False
    with mutation():
        now = timezone.now()
        run = m.AiDingTalkScheduleRun.objects.select_for_update().filter(status="queued").order_by("created_at").first()
        if run:
            if now - run.scheduled_at > timedelta(minutes=5):
                run.status, run.error_code, run.completed_at = "denied", "missed_window", now
                run.save(update_fields=["status", "error_code", "completed_at"])
                for phase in ("data", "analysis", "delivery"):
                    stage(run, phase, "not_required", "missed_window")
                return True
            run.status = "running"
            run.save(update_fields=["status"])
        else:
            row = m.AiDingTalkSchedule.objects.select_for_update().filter(enabled=True, next_run_at__lte=now).order_by("next_run_at").first()
            if row is None:
                return False
            slot = row.next_run_at
            row.next_run_at = next_slot(row.cadence, row.hour, row.minute, row.day, now)
            row.save(update_fields=["next_run_at"])
            if now - slot > timedelta(minutes=5):
                # A skipped original slot is observable, never a silent success
                # or a new delivery under the recovery date.
                skipped, created = m.AiDingTalkScheduleRun.objects.get_or_create(schedule=row, scheduled_at=slot,
                    defaults={"id": uid("ding-run"), "schedule_version": row.version,
                              "status": "denied", "error_code": "missed_window", "completed_at": now})
                if created:
                    for phase in ("data", "analysis", "delivery"):
                        stage(skipped, phase, "not_required", "missed_window")
                return True  # Preserve the existing no-backlog delivery policy.
            run, created = m.AiDingTalkScheduleRun.objects.get_or_create(schedule=row, scheduled_at=slot,
                defaults={"id": uid("ding-run"), "schedule_version": row.version, "status": "running"})
            if not created:
                return True
    row = run.schedule
    version, target = run.schedule_version, (row.target_type, row.target_id, row.sender_id)
    def live():
        row.refresh_from_db()
        if not row.enabled or row.version != version or (row.target_type, row.target_id, row.sender_id) != target:
            raise AiError("任务配置已变化", "access_denied", 403)
        current_principal(Principal(row.owner_email, row.owner_email, "admin", None), admin=True, background=True)
        config = config_reader()
        if row.target_type == "group" and row.target_id not in {g["id"] for g in config["groups"]}:
            raise AiError("目标群已撤销", "access_denied", 403)
        return config, dingtalk.principal_for(config, row.sender_id)
    sending = False
    active_phase = None
    bound_model = None
    snapshot = None
    facts = None
    try:
        config, principal = live()
        if row.content_type != "text" and (principal.email.lower() != row.owner_email.lower() or principal.role != "admin" or principal.scope is not None):
            raise AiError("媒体任务只允许创建管理员本人无范围限制的绑定账号执行", "access_denied", 403)
        session_key = digest(["schedule", config, row.id, version, run.id, row.sender_id, row.target_type, row.target_id, principal.email, principal.scope])
        with mutation(principal):
            session, _ = m.AiDingTalkSession.objects.get_or_create(pk=session_key, defaults={
                "config_digest": digest(config), "corp_id": config["corpId"], "robot_code": config["robotCode"],
                "sender_id": row.sender_id, "conversation_type": "2" if row.target_type == "group" else "1",
                "external_conversation_id": row.target_id, "owner_email": principal.email,
                "scope_json": canonical(principal.scope)})
        def channel_guard():
            live()
            status = m.AiDingTalkScheduleRun.objects.filter(pk=run.id).values_list("status", flat=True).get()
            if status not in {"running", "ready", "sending"}:
                raise AiError("执行槽已终止", "access_denied", 403)
            if bound_model is not None and model_snapshot(resolve_model(bound_model.id)) != snapshot:
                raise AiError("本次绑定的模型配置已变化", "schedule_model_changed", 409)
            return dingtalk.guard(session, config_reader())
        if row.content_type == "text":
            bound_model = resolve_model(row.model_id or None)
            snapshot = model_snapshot(bound_model)
            with mutation(principal):
                run.model_snapshot_json = canonical(snapshot)
                run.save(update_fields=["model_snapshot_json"])
            channel_guard()
            analysis_args = {}
            if row.execution_mode == "guangdong_monitor":
                active_phase = "data"
                stage(run, "data", "running")
                business_date = run.scheduled_at.astimezone(SHANGHAI).date().isoformat()
                facts = schedule_monitor.collect(principal, run.id, business_date, channel_guard)
                channel_guard()
                with mutation(principal):
                    run.facts_json = canonical(facts)
                    run.save(update_fields=["facts_json"])
                stage(run, "data", "succeeded")
                if not schedule_monitor.alerts(facts):
                    # Existing terminal denied state represents this explicit
                    # no-op; never claim a message was sent or call the model.
                    channel_guard()
                    with mutation(principal):
                        locked_task = m.AiDingTalkSchedule.objects.select_for_update().get(pk=row.id)
                        locked_run = m.AiDingTalkScheduleRun.objects.select_for_update().get(pk=run.id)
                        if not locked_task.enabled or locked_task.version != version or locked_run.status != "running":
                            raise AiError("任务或执行槽已变化", "access_denied", 403)
                        stage(run, "analysis", "not_required", "schedule_no_alerts")
                        stage(run, "delivery", "not_required", "schedule_no_alerts")
                        run.status, run.error_code, run.completed_at = "denied", "schedule_no_alerts", timezone.now()
                        run.save(update_fields=["status", "error_code", "completed_at"])
                        locked_task.last_run_at = run.scheduled_at
                        locked_task.save(update_fields=["last_run_at"])
                    return True
                analysis_args["scheduled_analysis"] = {"facts": facts, "systemPrompt": schedule_monitor.SYSTEM_PROMPT}
            else:
                stage(run, "data", "not_required", "data_within_open_analysis")
            active_phase = "analysis"
            stage(run, "analysis", "running")
            answer = chat.answer({"clientRequestId": "ding-scheduled-" + run.id, "message": row.prompt,
                "modelId": bound_model.id,
                "conversationId": session.conversation_id, "workspaceModule": "ai", "title": "志高助手 · 定时任务"},
                principal, run.id, dingtalk_session=session, channel_guard=channel_guard, channel_time=run.scheduled_at,
                **analysis_args)
            channel_guard()
            content = dingtalk.plain_reply(schedule_monitor.render(facts, answer["reply"]), truncate=False) if facts else dingtalk.plain_reply(answer["reply"])
            stage(run, "analysis", "succeeded")
            attachment = None
        elif row.content_type == "screenshot":
            active_phase = "data"
            stage(run, "data", "running")
            content = row.prompt
            attachment = (scheduled_page_capture.capture(row.source_ref, row.owner_email),
                          "系统页面-" + row.source_ref.replace(":", "-") + ".png", "image")
            stage(run, "data", "succeeded")
            stage(run, "analysis", "not_required")
        else:
            active_phase = "data"
            stage(run, "data", "running")
            content = ""
            result = reports.download(row.source_ref, {"format": "xlsx"}, principal)
            attachment = (base64.b64decode(result["base64"], validate=True), "报告-" + run.id + ".xlsx", "file")
            stage(run, "data", "succeeded")
            stage(run, "analysis", "not_required")
        channel_guard()
        active_phase = "delivery"
        with mutation(principal):
            run.status = "ready"
            run.content_text = content
            run.save(update_fields=["status", "content_text"])
        channel_guard()
        def delivery_guard():
            channel_guard()
            if facts:
                # Verify after destination preparation, immediately before the
                # external wire call. No second generation or automatic resend.
                current = schedule_monitor.collect(principal, run.id, facts["businessDate"], channel_guard, verify=True)
                if current != facts:
                    raise AiError("来源在分析后变化，本次未投递", "schedule_source_changed", 409)
                channel_guard()
        # Commit the irreversible external-send reservation before calling DWS.
        with mutation(principal):
            locked = m.AiDingTalkScheduleRun.objects.select_for_update().get(pk=run.id)
            if locked.status != "ready":
                raise AiError("执行槽状态已变化", "access_denied", 403)
            run.status = "sending"
            run.save(update_fields=["status"])
        sending = True
        stage(run, "delivery", "running")
        channel_guard()
        if attachment is None:
            sender(session, content, before_send=delivery_guard)
        elif media_sender is None:
            raise AiError("机器人媒体投递器不可用", "channel_unavailable", 503)
        else:
            if row.content_type == "screenshot" and content:
                media_sender(session, *attachment, content, before_send=channel_guard)
            else:
                media_sender(session, *attachment, before_send=channel_guard)
        with mutation():
            stage(run, "delivery", "succeeded")
            run.status, run.completed_at = "sent", timezone.now()
            run.save(update_fields=["status", "completed_at"])
            row.last_run_at = run.scheduled_at
            row.save(update_fields=["last_run_at"])
    except AiError as error:
        if active_phase:
            stage(run, active_phase, "unknown" if sending or error.code in ("delivery_unknown", "ai_chat_result_unknown") else "failed", error.code)
        for phase in ("data", "analysis", "delivery"):
            if getattr(run, phase + "_status") == "pending":
                stage(run, phase, "not_required", "prior_stage_failed")
        with mutation():
            run.status = "unknown" if sending or error.code in ("delivery_unknown", "ai_chat_result_unknown") else "denied" if error.status == 403 else "failed"
            run.error_code, run.completed_at = error.code, timezone.now()
            run.save(update_fields=["status", "error_code", "completed_at"])
    except Exception:
        if active_phase:
            stage(run, active_phase, "unknown", "execution_result_unknown")
        for phase in ("data", "analysis", "delivery"):
            if getattr(run, phase + "_status") == "pending":
                stage(run, phase, "not_required", "prior_stage_unknown")
        with mutation():
            run.status = "unknown"
            run.error_code, run.completed_at = "execution_result_unknown", timezone.now()
            run.save(update_fields=["status", "error_code", "completed_at"])
    return True
