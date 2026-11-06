"""Strict, versioned task drafts. Saving never grants recurring execution."""
import json
import re
from django.utils import timezone
from .policy import (AiError, canonical, current_principal, digest, fields,
                     identifier, integer, mutation, passive, text, uid)
from .task_models import TaskDefinition, TaskRevision, TaskRun, TaskIncident


def _enum(value, choices, name):
    if not isinstance(value, str) or value not in choices:
        raise AiError(name + "无效")
    return value


def _sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise AiError("Skill 摘要无效")
    return value


def normalize(spec, principal):
    fields(spec, {"skill", "prompt", "shopSelection", "modelId", "modelVersion", "trigger", "dataDependencies", "deliveryTargets", "missedPolicy", "parameters"},
           {"skill", "prompt", "shopSelection", "modelId", "modelVersion", "trigger", "dataDependencies", "deliveryTargets", "missedPolicy", "parameters"})
    from . import pi_selection, report_library
    skill = spec["skill"]
    fields(skill, {"kind", "id", "version", "digest"}, {"kind", "id", "version", "digest"})
    _enum(skill["kind"], {"library_guidance", "bundled"}, "Skill 类型")
    identifier(skill["id"])
    _sha(skill["digest"])
    if skill["kind"] == "library_guidance":
        version = integer(skill["version"], "Skill 版本", 1)
        library = report_library.snapshot(version)
        selected = next((v for v in library["config"]["skills"] if v["id"] == skill["id"] and v["enabled"]), None)
        if not selected or digest(selected) != skill["digest"]:
            raise AiError("Skill 版本或摘要与已发布资源不符", "version_conflict", 409)
    else:
        from .pi_service import skills
        selected = next((v for v in skills() if v["id"] == skill["id"]), None)
        if not selected or selected["version"] != skill["version"] or selected["sha256"] != skill["digest"]:
            raise AiError("Skill 版本或摘要与审核资源包不符", "version_conflict", 409)
    selection = pi_selection.normalize(spec["shopSelection"], principal)
    if selection is None:
        raise AiError("首批自动任务必须绑定一个明确店铺")
    trigger = spec["trigger"]
    if not isinstance(trigger, dict):
        raise AiError("触发定义必须是对象")
    kind = _enum(trigger.get("kind"), {"time", "message", "event", "condition"}, "触发类型")
    if kind == "time":
        fields(trigger, {"kind", "timezone", "cadence", "hour", "minute", "day", "windowSeconds"},
               {"kind", "timezone", "cadence", "hour", "minute", "day", "windowSeconds"})
        _enum(trigger["timezone"], {"Asia/Shanghai"}, "时区")
        cadence = _enum(trigger["cadence"], {"daily", "weekly", "monthly"}, "周期")
        integer(trigger["hour"], "小时", 0, 23)
        integer(trigger["minute"], "分钟", 0, 59)
        integer(trigger["day"], "日期", 1, 7 if cadence == "weekly" else 28)
    elif kind == "message":
        fields(trigger, {"kind", "connector", "command", "windowSeconds"}, {"kind", "connector", "command", "windowSeconds"})
        _enum(trigger["connector"], {"dingtalk"}, "连接器")
        text(trigger["command"], "明确命令", 100)
    elif kind == "event":
        fields(trigger, {"kind", "source", "eventType", "windowSeconds"}, {"kind", "source", "eventType", "windowSeconds"})
        _enum(trigger["source"], {"netshop", "report"}, "事件来源")
        _enum(trigger["eventType"], {"import_completed", "report_ready"}, "事件类型")
        if (trigger["source"], trigger["eventType"]) not in {("netshop", "import_completed"), ("report", "report_ready")}:
            raise AiError("事件类型与来源不符")
    else:
        fields(trigger, {"kind", "metric", "operator", "threshold", "ruleVersion", "windowSeconds"},
               {"kind", "metric", "operator", "threshold", "ruleVersion", "windowSeconds"})
        _enum(trigger["metric"], {"netshop.product_daily.coverage_complete", "netshop.promotion_daily.coverage_complete"}, "获准指标")
        _enum(trigger["operator"], {"eq"}, "条件操作符")
        if type(trigger["threshold"]) is not bool:
            raise AiError("覆盖条件必须为布尔值")
        identifier(trigger["ruleVersion"])
    integer(trigger["windowSeconds"], "原时点窗口", 60, 86400)
    deps = spec["dataDependencies"]
    if not isinstance(deps, list) or len(deps) > 4:
        raise AiError("数据依赖数量无效")
    for dep in deps:
        fields(dep, {"dataset", "dayOffset", "requiredFields"}, {"dataset", "dayOffset", "requiredFields"})
        _enum(dep["dataset"], {"netshop_product_daily", "netshop_promotion_daily"}, "数据依赖")
        integer(dep["dayOffset"], "相对原时点日期", 1, 31)
        if not isinstance(dep["requiredFields"], list) or not 1 <= len(dep["requiredFields"]) <= 20 or any(not isinstance(v, str) for v in dep["requiredFields"]) or len(set(dep["requiredFields"])) != len(dep["requiredFields"]):
            raise AiError("必需字段列表无效")
        for field in dep["requiredFields"]:
            identifier(field, "必需字段")
    targets = spec["deliveryTargets"]
    if not isinstance(targets, list) or len(targets) > 4:
        raise AiError("投递目标数量无效")
    for target in targets:
        fields(target, {"connector", "targetType", "targetId", "senderId"}, {"connector", "targetType", "targetId", "senderId"})
        _enum(target["connector"], {"dingtalk"}, "连接器")
        _enum(target["targetType"], {"person", "group"}, "投递目标")
        from .dingtalk import opaque
        opaque(target["targetId"], "目标 ID", 256)
        opaque(target["senderId"], "发送者 ID")
        if target["targetType"] == "person" and target["targetId"] != target["senderId"]:
            raise AiError("个人投递仅可绑定执行账号本人", "access_denied", 403)
    if len({canonical(v) for v in targets}) != len(targets):
        raise AiError("投递目标不能重复")
    _enum(spec["missedPolicy"], {"skip", "notify_only", "wait_for_data_until_deadline"}, "漏跑策略")
    if type(spec["parameters"]) is not dict:
        raise AiError("任务参数必须是对象")
    passive(spec["parameters"], 4096)
    result = {**spec, "prompt": text(spec["prompt"], "任务内容", 20000), "shopSelection": selection,
              "modelId": identifier(spec["modelId"]), "modelVersion": integer(spec["modelVersion"], "模型版本", 1)}
    passive(result, 32768)
    return result


def owned(task_id, principal, *, lock=False):
    current_principal(principal, admin=True)
    query = TaskDefinition.objects.select_for_update() if lock else TaskDefinition.objects
    row = query.filter(id=identifier(task_id), owner_email=principal.email.lower()).first()
    if not row:
        raise AiError("任务不存在", "not_found", 404)
    return row


def revision_for(row):
    return TaskRevision.objects.get(task=row, revision=row.current_revision)


def record(row):
    rev = revision_for(row)
    return {"id": row.id, "name": row.name, "ownerEmail": row.owner_email, "executorKind": row.executor_kind,
            "enabled": row.enabled, "version": row.version, "revision": rev.revision,
            "revisionId": rev.id, "digest": rev.spec_digest, "spec": json.loads(rev.spec_json),
            "nextRunAt": row.next_run_at.isoformat() if row.next_run_at else None,
            "updatedAt": row.updated_at.isoformat()}


def save(payload, principal):
    current_principal(principal, admin=True, write=True)
    fields(payload, {"id", "expectedVersion", "name", "spec"}, {"name", "spec"})
    spec = normalize(payload["spec"], principal)
    name = text(payload["name"], "名称", 100)
    with mutation(principal):
        if "id" in payload:
            row = owned(payload["id"], principal, lock=True)
            if integer(payload.get("expectedVersion"), "版本", 1) != row.version:
                raise AiError("任务已更新，请重新读取", "version_conflict", 409)
            if row.enabled:
                raise AiError("编辑前须停用未来触发，在途执行保留原版本", "conflict", 409)
            if revision_for(row).spec_json != canonical(spec) or row.name != name:
                row.current_revision += 1
                row.version += 1
                row.name, row.updated_at = name, timezone.now()
                row.save()
            else:
                return {"item": record(row), "unchanged": True}
        else:
            if "expectedVersion" in payload or TaskDefinition.objects.filter(owner_email=principal.email.lower()).count() >= 100:
                raise AiError("任务数量或初始版本无效")
            row = TaskDefinition.objects.create(id=uid("task"), owner_email=principal.email.lower(), actor_role=principal.role,
                scope_json=canonical(principal.scope), name=name)
        TaskRevision.objects.create(id=uid("task-revision"), task=row, revision=row.current_revision,
            spec_json=canonical(spec), spec_digest=digest(spec), created_by=principal.email.lower())
    return {"item": record(row)}


def listing(params, principal):
    current_principal(principal, admin=True)
    fields(params, set())
    rows = list(TaskDefinition.objects.filter(owner_email=principal.email.lower()).order_by("-updated_at", "id")[:101])
    return {"items": [record(row) for row in rows[:100]], "hasMore": len(rows) > 100}


def detail(task_id, params, principal, section=None):
    fields(params, set())
    row = owned(task_id, principal)
    if section == "revisions":
        rows = list(TaskRevision.objects.filter(task=row).order_by("-revision")[:51])
        return {"items": [{"id": r.id, "revision": r.revision, "digest": r.spec_digest, "spec": json.loads(r.spec_json)} for r in rows[:50]], "hasMore": len(rows) > 50}
    if section == "runs":
        rows = list(TaskRun.objects.filter(task=row).order_by("-created_at", "id")[:101])
        return {"items": [{"id": r.id, "revisionId": r.revision_id, "triggerKind": r.trigger_kind, "occurrenceKey": r.occurrence_key,
            "scheduledAt": r.scheduled_at.isoformat(), "deadlineAt": r.deadline_at.isoformat(), "status": r.status,
            "operationId": r.operation_id, "executionRef": r.execution_ref, "errorCode": r.error_code, "version": r.version} for r in rows[:100]], "hasMore": len(rows) > 100}
    if section == "incidents":
        from .task_dispatch import incident_record
        rows = list(TaskIncident.objects.filter(run__task=row).order_by("-created_at", "id")[:101])
        return {"items": [incident_record(r) for r in rows[:100]], "hasMore": len(rows) > 100}
    from .task_connectors import readiness
    return {"item": record(row), "readiness": readiness(row, principal)}


def control(task_id, payload, principal, action):
    current_principal(principal, admin=True, write=True)
    fields(payload, {"expectedVersion"}, {"expectedVersion"})
    with mutation(principal):
        row = owned(task_id, principal, lock=True)
        if row.version != integer(payload["expectedVersion"], "版本", 1):
            raise AiError("任务版本已变化", "version_conflict", 409)
        if action == "enable":
            from .task_connectors import readiness
            state = readiness(row, principal)
            raise AiError("自动任务尚未准入：" + "、".join(state["blockers"]), "task_not_ready", 409)
        if action != "disable":
            raise AiError("任务操作不存在", "not_found", 404)
        row.enabled, row.next_run_at = False, None
        row.version += 1
        row.updated_at = timezone.now()
        row.save()
        # Disable future dispatch, without rewriting an original operation.
        from .task_models import TaskGrant
        TaskGrant.objects.filter(revision__task=row, revoked_at__isnull=True).update(revoked_at=timezone.now())
    return {"item": record(row)}
