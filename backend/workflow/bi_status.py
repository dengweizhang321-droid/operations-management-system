"""Bounded owning projection of pending plans and product launches."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db.models import DateTimeField, Exists, F, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone
from django.views.decorators.http import require_GET

from .errors import WorkflowApiError
from .models import NewProductActivity, NewProductProject, NewProductStage, WorkflowTask, WorkflowTaskActivityLog
from .operations_views import _operations_principal
from .revisions import revision_value
from .views import _error, _json
from teruisi_backend.read_budget import bounded_read

MAX_ACTIVE = 10_000
PROGRESS_ACTIONS = {"task.created", "task.updated", "task.status_changed", "comment.created", "attachment.created", "attachment.deleted", "link.created", "link.deleted"}


def _last_activity(queryset, log, relation, actions):
    activity = log.objects.filter(**{relation: OuterRef("pk")}, action__in=actions).order_by("-created_at").values("created_at")[:1]
    return queryset.annotate(_progress=Greatest(F("created_at"), Coalesce(Subquery(activity, output_field=DateTimeField()), F("created_at"))))


def _date(value):
    if isinstance(value, date):
        return value
    try:
        parsed = date.fromisoformat(value)
        return parsed if parsed.isoformat() == value else None
    except (TypeError, ValueError):
        return None


def projection(principal, mine=False):
    if principal.scope is not None:
        raise WorkflowApiError("运营驾驶舱仅支持未受限数据范围", code="access_denied", status=403)
    today = timezone.localdate()
    upcoming_end = today + timedelta(days=6)
    # Seven full days without a business activity, not the start of this week.
    stagnant_at = timezone.now() - timedelta(days=7)
    owners = {principal.email.strip(), principal.display_name.strip()} - {""}
    tasks = WorkflowTask.objects.filter(deleted_at__isnull=True, status__in=["待开始", "工作中"])
    projects = NewProductProject.objects.filter(deleted_at__isnull=True, lifecycle_status="active")
    open_stage = NewProductStage.objects.filter(project=OuterRef("pk")).exclude(status__in=["completed", "not_applicable"])
    has_stage = NewProductStage.objects.filter(project=OuterRef("pk"))
    projects = projects.annotate(_open_stage=Exists(open_stage), _has_stage=Exists(has_stage)).filter(Q(_open_stage=True) | Q(_has_stage=False))
    if mine:
        tasks = tasks.filter(owner__in=owners)
        projects = projects.filter(owner__in=owners)
    tasks = _last_activity(tasks, WorkflowTaskActivityLog, "task", PROGRESS_ACTIONS)
    projects = _last_activity(projects, NewProductActivity, "project", {"project.created", "project.updated", "stage.updated"})
    task_rows = list(tasks.values("id", "title", "owner", "shop_name", "due_date", "_progress").order_by("id")[:MAX_ACTIVE + 1])
    project_rows = list(projects.values("id", "product_name", "owner", "target_launch_date", "_progress").order_by("id")[:MAX_ACTIVE + 1])
    if len(task_rows) + len(project_rows) > MAX_ACTIVE:
        raise WorkflowApiError("活跃运营事项超过10000项，不能静默截断", code="capacity_exceeded", status=413)
    records, invalid_dates = [], 0
    for kind, values in (("plan", task_rows), ("launch", project_rows)):
        for row in values:
            raw_due = row["due_date"] if kind == "plan" else row["target_launch_date"]
            due = _date(raw_due)
            if due is None and raw_due not in {None, "", "待排期"}:
                invalid_dates += 1
            progress = row["_progress"]
            records.append({"id": f"{kind}:{row['id']}", "objectId": str(row["id"]), "kind": kind,
                "title": row["title"] if kind == "plan" else row["product_name"], "owner": row["owner"],
                "shopName": row.get("shop_name", ""), "dueDate": due.isoformat() if due else None,
                "lastProgressAt": progress.isoformat(), "_due": due, "_stagnant": progress <= stagnant_at})
    groups = []
    for bucket, label, matches in (
        ("overdue", "已逾期", lambda row: row["_due"] is not None and row["_due"] < today),
        ("upcoming", "7天内到期", lambda row: row["_due"] is not None and today <= row["_due"] <= upcoming_end),
        ("inactive", "7天无进展", lambda row: row["_stagnant"]),
    ):
        for kind in ("plan", "launch"):
            selected = sorted((row for row in records if row["kind"] == kind and matches(row)), key=lambda row: (row["dueDate"] or "9999-12-31", row["lastProgressAt"], row["id"]))
            groups.append({"key": f"{bucket}-{kind}", "bucket": bucket, "kind": kind, "label": label + (" · 工作计划" if kind == "plan" else " · 新品上架"),
                "total": len(selected), "returned": min(20, len(selected)), "truncated": len(selected) > 20,
                "items": [{key: value for key, value in row.items() if not key.startswith("_")} for row in selected[:20]]})
    all_ids = {row["id"] for row in records if row["_stagnant"] or row["_due"] is not None and row["_due"] <= upcoming_end}
    return {"schemaVersion": "workflow-bi-status-v1", "asOfDate": today.isoformat(), "upcomingThrough": upcoming_end.isoformat(),
        "inactiveThrough": stagnant_at.isoformat(), "mine": mine, "groups": groups, "uniqueAttentionCount": len(all_ids), "invalidDueDateCount": invalid_dates,
        "limitations": ["只统计未完成工作计划和活跃未完成新品；暂停/取消及软删除排除", "未动以业务活动时间判断，不以系统自动updated_at代替", "分组可重叠，关注总数去重；明细每组20条，完整处理进入运营事务"]}


@require_GET
def status(request):
    try:
        principal = _operations_principal(request, {"viewer", "analyst", "operator", "admin"}, unrestricted=True)
        if set(request.GET) - {"mine"} or len(request.GET.getlist("mine")) > 1 or request.GET.get("mine", "0") not in {"0", "1"}:
            raise WorkflowApiError("运营驾驶舱只接受唯一mine=0或1")
        with bounded_read(WorkflowApiError):
            before = revision_value()
            data = projection(principal, request.GET.get("mine", "0") == "1")
            if revision_value() != before:
                raise WorkflowApiError("运营来源在读取期间变化", code="revision_changed", status=409)
        return _json(data, revision=before)
    except Exception as error:
        return _error(error, "运营待处理读取失败")
