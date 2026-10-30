"""Persistent automation projection models (B1 minimal model).

Scope for this unit: four tables covering module registry, logical runs,
execution attempts and module results for the 京准通推广链 pilot
(`chain_key=jd_promotion`, `subject_key=jd-yiyong-director`). No frontend,
no rule editing, no gate① implementation, no n8n changes.

These models live in their own file and are imported into ``models.py`` so
the existing 562-line file is not extended with this unit's tables; they
still migrate under the ``workflow`` app with an independent migration
sequence starting at ``0009``.

Design notes (see docs/autoimport-workflow-unification-20261029/REPORT.md
§4.1/§4.2 and 京东单店试点.md for the authoritative field list and the
historical replay shape this unit must express):

* ``AutomationModule`` is a code-side registry, not a user-editable table.
  Values must never carry scripts, URLs or file paths; ``CODE_TOKEN_RE``
  enforces that for the free-form registry fields below.
* The three execution/business/delivery axes are three independent
  CharField columns on ``AutomationModuleResult`` with disjoint value
  domains (see ``EXECUTION_AXIS_CHOICES`` / ``BUSINESS_AXIS_CHOICES`` /
  ``DELIVERY_AXIS_CHOICES``). Nothing here merges them into one status or
  reconstructs them from booleans; the merge/override judgment itself is
  explicitly out of scope for this unit (that is B2's gate work).
* ``AutomationAttempt.parent_attempt_id`` is self-referencing so the
  2026-09-12 commercial-equipment-store shape (execution 1268 failed ->
  1287 failed -> 1303 succeeded) can be stored as one logical run with
  three attempts, the second and third each pointing at their immediate
  predecessor. Retry budget is read off ``AutomationLogicalRun`` (by
  counting attempts under the same ``logical_run_id``), not reset by a new
  ``native_execution_id`` appearing.
* ``AutomationModuleResult`` identity is the five dimensions
  ``logical_run_id + module_key + subject_key + dataset + date_range``
  (date_range doubles as "snapshot" for snapshot-dated modules — this
  pilot's module is day-dated, so a single ``date_range`` column carries
  both shapes rather than two parallel nullable columns that could drift).
* Business-domain evidence is read-only: this file does not add fields to
  ``backend/netshop/`` models and does not add a netshop write path. It
  only stores foreign-key-shaped references (``netshop_import_batch_id``)
  into the existing ``NetshopImportBatch`` primary key.
"""

from __future__ import annotations

import re
import uuid

from django.core.exceptions import ValidationError
from django.db import models


# Registry values (module_key, platform, chain_key, domain, dataset,
# depends_on entries, allowed_actions entries) must be stable code-like
# tokens: no "://", no path separators, no whitespace, no shell
# metacharacters. This is enforced at the model layer (not just at the
# admin/API layer) so direct ORM/shell writes cannot smuggle an execution
# target into a column that downstream automation code might ever read as
# a path or URL.
CODE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def validate_code_token(value: str) -> None:
    if not value or not CODE_TOKEN_RE.match(value):
        raise ValidationError(
            "字段只允许稳定代码键字符（字母数字下划线点横线），"
            "不得包含协议、路径分隔符或脚本片段：%(value)r",
            params={"value": value},
        )


def validate_code_token_list(values) -> None:
    if not isinstance(values, list):
        raise ValidationError("必须是字符串数组")
    for item in values:
        if not isinstance(item, str):
            raise ValidationError("数组元素必须是字符串")
        validate_code_token(item)


DATE_POLICY_CHOICES = [
    ("rolling_45d", "rolling_45d"),
    ("month_to_yesterday", "month_to_yesterday"),
    ("recent_7d_gap", "recent_7d_gap"),
    ("snapshot_day", "snapshot_day"),
    ("rolling_30d", "rolling_30d"),
    ("fixed_yesterday", "fixed_yesterday"),
]

EVIDENCE_REQUIREMENT_CHOICES = [
    ("batch", "batch"),
    ("coverage", "coverage"),
    ("pairing", "pairing"),
    ("release", "release"),
]

TRIGGER_SOURCE_CHOICES = [
    ("schedule", "schedule"),
    ("manual", "manual"),
    ("recovery", "recovery"),
    ("backfill", "backfill"),
]

ATTEMPT_STAGE_CHOICES = [
    ("claim", "claim"),
    ("plan", "plan"),
    ("download", "download"),
    ("validate", "validate"),
    ("import", "import"),
    ("verify", "verify"),
    ("release", "release"),
]

PHASE_STATUS_CHOICES = [
    ("not_started", "not_started"),
    ("pending", "pending"),
    ("in_progress", "in_progress"),
    ("succeeded", "succeeded"),
    ("failed", "failed"),
    ("skipped", "skipped"),
]

EVIDENCE_STATE_CHOICES = [
    ("verified", "verified"),
    ("stale", "stale"),
    ("missing", "missing"),
    ("contradictory", "contradictory"),
]

# --- Three independent axes (REPORT.md §4.2). Disjoint value domains by
# construction: no value appears in more than one axis, so a stray
# cross-assignment is rejected by the CheckConstraint below rather than
# silently accepted as a plausible-looking string. ---

EXECUTION_AXIS_CHOICES = [
    ("not_due", "not_due"),
    ("pending_claim", "pending_claim"),
    ("queued", "queued"),
    ("running", "running"),
    ("failed", "failed"),
    ("needs_human", "needs_human"),
    ("result_unknown", "result_unknown"),
    ("finished", "finished"),
]

BUSINESS_AXIS_CHOICES = [
    ("not_started", "not_started"),
    ("partial", "partial"),
    ("submitted_unverified", "submitted_unverified"),
    ("verified", "verified"),
    ("no_new_needed", "no_new_needed"),
    ("gap_remaining", "gap_remaining"),
]

DELIVERY_AXIS_CHOICES = [
    ("not_required", "not_required"),
    ("pending", "pending"),
    ("sent", "sent"),
    ("failed", "failed"),
    ("unknown", "unknown"),
]


class AutomationModule(models.Model):
    """Code-side module registry. Not a user-editable table.

    Rows are expected to be seeded/maintained by migrations or management
    commands that ship with code review, not by an admin UI or API in this
    unit (no editing interface exists yet — out of scope per task).
    """

    module_key = models.CharField(
        primary_key=True,
        max_length=120,
        validators=[validate_code_token],
    )
    label = models.CharField(max_length=200)
    platform = models.CharField(max_length=40, validators=[validate_code_token])
    chain_key = models.CharField(max_length=80, validators=[validate_code_token], db_index=True)
    domain = models.CharField(max_length=32, validators=[validate_code_token])
    dataset = models.CharField(max_length=64, validators=[validate_code_token])
    date_policy = models.CharField(max_length=32, choices=DATE_POLICY_CHOICES)
    depends_on = models.JSONField(default=list, validators=[validate_code_token_list])
    imports_data = models.BooleanField(default=True)
    evidence_requirement = models.CharField(max_length=16, choices=EVIDENCE_REQUIREMENT_CHOICES)
    allowed_actions = models.JSONField(default=list, validators=[validate_code_token_list])
    schedulable = models.BooleanField(default=True)
    contract_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "automation_modules"
        indexes = [
            models.Index(fields=["chain_key", "domain"], name="automation_module_chain_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - debug convenience
        return self.module_key


class AutomationLogicalRun(models.Model):
    """One logical run: a single planned business execution.

    A manual full re-collection creates a *new* ``AutomationLogicalRun``.
    A recovery of an existing run instead adds a new
    :class:`AutomationAttempt` under the *same* logical run — see
    ``trigger_source`` and the attempt's ``parent_attempt_id``.
    """

    logical_run_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chain_key = models.CharField(max_length=80, validators=[validate_code_token], db_index=True)
    subject_key = models.CharField(max_length=120, db_index=True)
    plan_date = models.DateField(db_index=True)
    business_range = models.JSONField(default=dict)
    trigger_source = models.CharField(max_length=16, choices=TRIGGER_SOURCE_CHOICES)
    plan_summary = models.JSONField(default=dict)
    overall_status = models.CharField(max_length=16, choices=EXECUTION_AXIS_CHOICES, default="not_due")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "automation_logical_runs"
        constraints = [
            models.UniqueConstraint(
                fields=["chain_key", "subject_key", "plan_date", "trigger_source"],
                condition=models.Q(trigger_source__in=["schedule", "backfill"]),
                name="automation_logical_run_identity_uq",
            ),
        ]
        indexes = [
            models.Index(
                fields=["chain_key", "subject_key", "plan_date"],
                name="automation_run_subj_date_idx",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover - debug convenience
        return f"{self.chain_key}:{self.subject_key}:{self.plan_date}"


class AutomationAttempt(models.Model):
    """One execution attempt under a logical run.

    ``parent_attempt_id`` self-references the immediately preceding
    attempt when ``recovery_reason`` is set, so a chain of recoveries
    (1268 -> 1287 -> 1303) is reconstructible by walking parent links,
    while still all sharing one ``logical_run_id`` for retry-budget
    purposes.
    """

    attempt_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    logical_run = models.ForeignKey(
        AutomationLogicalRun,
        to_field="logical_run_id",
        on_delete=models.CASCADE,
        related_name="attempts",
        db_column="logical_run_id",
    )
    native_workflow_id = models.CharField(max_length=120, default="")
    native_execution_id = models.CharField(max_length=120, default="", db_index=True)
    parent_attempt = models.ForeignKey(
        "self",
        to_field="attempt_id",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="child_attempts",
        db_column="parent_attempt_id",
    )
    recovery_reason = models.CharField(max_length=64, default="")
    stage = models.CharField(max_length=16, choices=ATTEMPT_STAGE_CHOICES)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    error_class = models.CharField(max_length=120, default="")
    native_evidence_ref = models.CharField(max_length=500, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "automation_attempts"
        constraints = [
            # A given native execution id can only ever be recorded once as
            # an attempt under one logical run — prevents the same n8n
            # execution from accidentally being attached to two logical
            # runs (would break retry-budget accounting).
            models.UniqueConstraint(
                fields=["native_workflow_id", "native_execution_id"],
                condition=~models.Q(native_execution_id=""),
                name="automation_attempt_native_execution_uq",
            ),
        ]
        indexes = [
            models.Index(fields=["logical_run", "created_at"], name="automation_attempt_run_idx"),
            models.Index(fields=["parent_attempt"], name="automation_attempt_parent_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - debug convenience
        return f"{self.logical_run_id}:{self.native_execution_id or self.attempt_id}"


class AutomationModuleResult(models.Model):
    """Per-module result for one logical run.

    Identity is five-dimensional: ``logical_run`` + ``module_key`` +
    ``subject_key`` + ``dataset`` + ``date_range``. All five are part of
    the unique constraint below so results for different dates or
    datasets under the same logical run never collide or overwrite each
    other.

    Phase status columns (download/validate/import/verify/release) are
    separate fields, not a single pipeline-stage enum, so a module that
    has, say, finished download but not yet import does not have to
    overload one column to express a partial state.

    The three outcome axes (execution/business/delivery) are separate
    fields with disjoint value domains — see module-level
    ``EXECUTION_AXIS_CHOICES`` / ``BUSINESS_AXIS_CHOICES`` /
    ``DELIVERY_AXIS_CHOICES``. This unit only stores the fields; the
    judgment that writes them (gate①/②/③) is explicitly B2's work.

    Evidence fields are split into two separate groups that must not be
    mixed:
    * "current upload" fields describe the file this module result's own
      attempt produced (``current_raw_file_sha256`` /
      ``current_content_fingerprint`` / ``current_row_count`` /
      ``current_warning_count``).
    * "historical reuse batch" fields describe a pre-existing batch this
      result is citing as authoritative evidence for a "no new data
      needed" outcome (``reused_batch_id`` / ``reused_coverage_revision``),
      used when the correct answer is "no gap, nothing new to import" and
      the evidence is an existing completed batch rather than a new one.

    ``netshop_import_batch_id`` is a bare reference to a business-domain
    evidence batch's primary key (no FK/db-level join) because this app
    does not own any business-domain table and must not create a
    cross-app hard dependency that could block that domain's own
    migrations or constrain its retirement path; the reference is
    read-only lookup data. The column name predates the 京东客服链
    extension (B2 pilot shipped it netshop-only) and is kept unchanged to
    avoid an unrelated migration; for a module result whose
    ``AutomationModule.domain == "customer_service"`` this column holds a
    ``CustomerServiceImportBatch.id`` instead of a
    ``NetshopImportBatch.id`` — callers must resolve which domain a
    result belongs to via its module's ``domain`` field, never by
    guessing from the id's shape.
    """

    id = models.BigAutoField(primary_key=True)
    logical_run = models.ForeignKey(
        AutomationLogicalRun,
        to_field="logical_run_id",
        on_delete=models.CASCADE,
        related_name="module_results",
        db_column="logical_run_id",
    )
    module_key = models.CharField(max_length=120, validators=[validate_code_token])
    subject_key = models.CharField(max_length=120)
    dataset = models.CharField(max_length=64, validators=[validate_code_token])
    date_range = models.CharField(
        max_length=64,
        help_text="固定业务日期范围或快照日标识，与身份五维之一绑定",
    )

    # Phase status columns.
    download_status = models.CharField(max_length=16, choices=PHASE_STATUS_CHOICES, default="not_started")
    validate_status = models.CharField(max_length=16, choices=PHASE_STATUS_CHOICES, default="not_started")
    import_status = models.CharField(max_length=16, choices=PHASE_STATUS_CHOICES, default="not_started")
    verify_status = models.CharField(max_length=16, choices=PHASE_STATUS_CHOICES, default="not_started")
    release_status = models.CharField(max_length=16, choices=PHASE_STATUS_CHOICES, default="not_started")

    # Three independent outcome axes.
    execution_state = models.CharField(max_length=16, choices=EXECUTION_AXIS_CHOICES, default="not_due")
    business_state = models.CharField(max_length=24, choices=BUSINESS_AXIS_CHOICES, default="not_started")
    delivery_state = models.CharField(max_length=16, choices=DELIVERY_AXIS_CHOICES, default="not_required")

    # Domain evidence — read-only references into backend/netshop/, never
    # written back into that domain.
    netshop_import_batch_id = models.CharField(max_length=1024, default="")
    current_raw_file_sha256 = models.CharField(max_length=64, default="")
    current_content_fingerprint = models.CharField(max_length=64, default="")
    current_row_count = models.BigIntegerField(null=True, blank=True)
    current_warning_count = models.BigIntegerField(null=True, blank=True)
    reused_batch_id = models.CharField(max_length=1024, default="")
    reused_coverage_revision = models.CharField(max_length=64, default="")

    evidence_state = models.CharField(max_length=16, choices=EVIDENCE_STATE_CHOICES, default="missing")
    evidence_source = models.CharField(max_length=64, default="")
    evidence_observed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "automation_module_results"
        constraints = [
            models.UniqueConstraint(
                fields=["logical_run", "module_key", "subject_key", "dataset", "date_range"],
                name="automation_module_result_identity_uq",
            ),
        ]
        indexes = [
            models.Index(
                fields=["module_key", "subject_key", "dataset"],
                name="automation_result_mod_subj_idx",
            ),
            models.Index(fields=["evidence_state"], name="automation_result_evidence_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - debug convenience
        return f"{self.logical_run_id}:{self.module_key}:{self.date_range}"
