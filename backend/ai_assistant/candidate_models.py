"""A Skill candidate distilled from one finished task's evidence.

A candidate is a proposal, not a method in use. It carries where it came from
(the operation, the report version digest, the confirmed corrections it read)
so a reviewer can check the distillation against the run rather than trusting
the model's summary of it.

Candidates never execute and are never discovered: reaching the Pi runtime
requires a separate, reviewed publication step. The status column is the only
path from draft to approved, and approving re-reads the content digest so an
edit after review cannot inherit the old approval.
"""
from django.db import models
from django.utils import timezone

from .pi_models import PiOperation

STATUSES = ("draft", "in_review", "approved", "rejected", "superseded")


class AiSkillCandidate(models.Model):
    id = models.TextField(primary_key=True)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    owner_email = models.TextField()
    #: Pins the exact run this was distilled from, including its sources,
    #: artifacts and live corrections.
    report_version_digest = models.TextField()
    report_version_json = models.TextField()
    #: The model's structured output, validated against a registered schema.
    content_json = models.TextField()
    content_digest = models.TextField()
    schema_ref = models.TextField()
    schema_digest = models.TextField()
    #: Which confirmed corrections the distillation was allowed to read.
    feedback_ids_json = models.TextField(default="[]")
    #: Recommendations the report never executed stay flagged here too: an
    #: approved candidate is an approved method, not a validated outcome.
    unverified_count = models.PositiveIntegerField(default=0)
    status = models.TextField(default="draft")
    reviewed_by = models.TextField(default="")
    reviewed_at = models.DateTimeField(null=True)
    review_note = models.TextField(default="")
    version = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_skill_candidates"
        constraints = [
            # One live distillation per run and schema. Superseded rows remain,
            # so an earlier reading of the same run stays auditable.
            models.UniqueConstraint(
                fields=["operation", "schema_ref"],
                condition=models.Q(status__in=("draft", "in_review", "approved")),
                name="ai_skill_candidate_live_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=STATUSES),
                name="ai_skill_candidate_status",
            ),
            models.CheckConstraint(
                condition=models.Q(version__gte=1),
                name="ai_skill_candidate_version",
            ),
            # A reviewed candidate must say who reviewed it; a draft must not
            # claim a reviewer.
            models.CheckConstraint(
                condition=(
                    models.Q(status__in=("draft", "in_review"), reviewed_by="", reviewed_at__isnull=True)
                    | models.Q(status__in=("approved", "rejected", "superseded"))
                ),
                name="ai_skill_candidate_review_identity",
            ),
        ]
        indexes = [
            models.Index(fields=["owner_email", "status"], name="ai_skill_candidate_owner_idx"),
            models.Index(fields=["operation", "status"], name="ai_skill_candidate_op_idx"),
        ]
