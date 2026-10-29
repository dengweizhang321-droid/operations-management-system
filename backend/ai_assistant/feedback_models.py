"""One explicit user correction against one finished task's report.

Separate from memory and knowledge on purpose. Memory holds an owner's stable
preferences, knowledge holds confirmed metric definitions; neither records
"this part of that report was wrong". Keeping corrections here is what stops a
single report's conclusion from being read later as a standing rule.

Three fields carry that weight. `source` marks whether a human confirmed the
correction or a model proposed it, so a model's own rewording can never be
cited as confirmed. `applies_to` defaults to this one report, so a scope wider
than the report is always a deliberate choice. And `status` lets a correction
be superseded without rewriting history.
"""
from django.db import models
from django.utils import timezone

from .pi_models import PiOperation

TARGET_KINDS = ("metric_definition", "scope", "section", "threshold", "other")
APPLIES_TO = ("this_report", "this_shop", "all_shops")
SOURCES = ("user", "model_suggested")
STATUSES = ("confirmed", "superseded", "withdrawn")


class AiTaskFeedback(models.Model):
    id = models.TextField(primary_key=True)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    generation = models.PositiveBigIntegerField()
    owner_email = models.TextField()
    target_kind = models.TextField()
    # Free text under a length bound for now: the locator syntax waits for the
    # first daily report to define its sections (F1 in the design).
    target_ref = models.TextField()
    old_value_json = models.TextField(default="null")
    new_value_json = models.TextField()
    applies_to = models.TextField(default="this_report")
    source = models.TextField(default="user")
    confirmed_by = models.TextField()
    confirmed_at = models.DateTimeField(default=timezone.now)
    status = models.TextField(default="confirmed")
    version = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_task_feedback"
        constraints = [
            # One live correction per target. Superseded and withdrawn rows stay
            # for the audit trail, so the condition is on confirmed only.
            models.UniqueConstraint(
                fields=["operation", "target_kind", "target_ref"],
                condition=models.Q(status="confirmed"),
                name="ai_task_feedback_live_target_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(target_kind__in=TARGET_KINDS),
                name="ai_task_feedback_target_kind",
            ),
            models.CheckConstraint(
                condition=models.Q(applies_to__in=APPLIES_TO),
                name="ai_task_feedback_applies_to",
            ),
            models.CheckConstraint(
                condition=models.Q(source__in=SOURCES),
                name="ai_task_feedback_source",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=STATUSES),
                name="ai_task_feedback_status",
            ),
            models.CheckConstraint(
                condition=models.Q(generation__gte=1, version__gte=1),
                name="ai_task_feedback_counters",
            ),
        ]
        indexes = [
            models.Index(fields=["operation", "status"], name="ai_task_feedback_op_idx"),
            models.Index(fields=["owner_email", "confirmed_at"], name="ai_task_feedback_owner_idx"),
        ]
