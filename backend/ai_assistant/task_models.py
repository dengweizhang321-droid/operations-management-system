"""Unified task control records. No model here schedules or sends anything."""
from django.db import models
from django.utils import timezone


class TaskDefinition(models.Model):
    id = models.TextField(primary_key=True)
    owner_email = models.TextField()
    actor_role = models.TextField()
    scope_json = models.TextField()
    name = models.TextField()
    current_revision = models.PositiveBigIntegerField(default=1)
    version = models.PositiveBigIntegerField(default=1)
    enabled = models.BooleanField(default=False)
    executor_kind = models.TextField(default="unified_pi")
    next_run_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_task_definitions"
        indexes = [models.Index(fields=["owner_email", "updated_at"], name="ai_task_owner_idx")]
        constraints = [
            models.CheckConstraint(condition=models.Q(version__gte=1, current_revision__gte=1), name="ai_task_counters"),
            models.CheckConstraint(condition=models.Q(executor_kind="unified_pi"), name="ai_task_executor"),
            models.CheckConstraint(condition=models.Q(enabled=False, next_run_at__isnull=True) | models.Q(enabled=True), name="ai_task_disabled_clock"),
        ]


class TaskRevision(models.Model):
    id = models.TextField(primary_key=True)
    task = models.ForeignKey(TaskDefinition, on_delete=models.PROTECT)
    revision = models.PositiveBigIntegerField()
    spec_json = models.TextField()
    spec_digest = models.TextField()
    created_by = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_task_revisions"
        constraints = [models.UniqueConstraint(fields=["task", "revision"], name="ai_task_revision_uq"),
                       models.CheckConstraint(condition=models.Q(revision__gte=1), name="ai_task_revision_positive")]


class TaskGrant(models.Model):
    id = models.TextField(primary_key=True)
    revision = models.ForeignKey(TaskRevision, on_delete=models.PROTECT)
    owner_email = models.TextField()
    authorization_ref = models.TextField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_task_grants"


class TaskRun(models.Model):
    id = models.TextField(primary_key=True)
    task = models.ForeignKey(TaskDefinition, on_delete=models.PROTECT)
    revision = models.ForeignKey(TaskRevision, on_delete=models.PROTECT)
    trigger_kind = models.TextField()
    occurrence_key = models.TextField()
    scheduled_at = models.DateTimeField()
    deadline_at = models.DateTimeField()
    status = models.TextField(default="queued")
    operation_id = models.TextField(default="")
    execution_ref = models.TextField(default="")
    lease_owner = models.TextField(default="")
    lease_until = models.DateTimeField(null=True)
    fence = models.PositiveBigIntegerField(default=0)
    error_code = models.TextField(default="")
    evidence_json = models.TextField(default="{}")
    version = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_task_runs"
        indexes = [models.Index(fields=["task", "created_at"], name="ai_task_run_time_idx")]
        constraints = [
            models.UniqueConstraint(fields=["task", "trigger_kind", "occurrence_key"], name="ai_task_occurrence_uq"),
            models.CheckConstraint(condition=models.Q(trigger_kind__in=("time", "message", "event", "condition")), name="ai_task_trigger_kind"),
            models.CheckConstraint(condition=models.Q(status__in=("queued", "waiting_data", "leased", "delegated", "succeeded", "failed", "unknown", "missed", "expired", "canceled")), name="ai_task_run_status"),
            models.CheckConstraint(condition=models.Q(version__gte=1), name="ai_task_run_version"),
            models.CheckConstraint(condition=models.Q(deadline_at__gte=models.F("scheduled_at")), name="ai_task_run_window"),
        ]


class TaskIncident(models.Model):
    id = models.TextField(primary_key=True)
    run = models.ForeignKey(TaskRun, on_delete=models.PROTECT)
    error_class = models.TextField()
    rule_version = models.TextField(default="unified-task-triage-v1")
    evidence_json = models.TextField(default="{}")
    owner_email = models.TextField()
    assignee = models.TextField(default="")
    state = models.TextField(default="open")
    next_action = models.TextField()
    resume_conditions = models.TextField()
    notification_key = models.TextField(unique=True)
    notification_status = models.TextField(default="not_sent")
    resolution_note = models.TextField(default="")
    version = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_task_incidents"
        constraints = [
            models.CheckConstraint(condition=models.Q(state__in=("open", "claimed", "closed")), name="ai_task_incident_state"),
            models.CheckConstraint(condition=models.Q(version__gte=1), name="ai_task_incident_version"),
            models.CheckConstraint(condition=models.Q(notification_status__in=("not_sent", "legacy_notified", "pending", "sent", "failed", "unknown")), name="ai_task_notification_status"),
        ]


TASK_MODELS = (TaskDefinition, TaskRevision, TaskGrant, TaskRun, TaskIncident)
