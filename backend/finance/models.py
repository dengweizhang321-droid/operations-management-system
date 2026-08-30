from __future__ import annotations

import uuid

from django.db import models


class FinanceImportBatch(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    source = models.CharField(max_length=200)
    file_name = models.TextField()
    file_size_bytes = models.BigIntegerField()
    file_hash = models.CharField(max_length=64, unique=True)
    raw_file_hash = models.CharField(max_length=64, default="", db_index=True)
    content_hash = models.CharField(max_length=64, default="", db_index=True)
    scope_key = models.CharField(max_length=64, default="", db_index=True)
    published_state_token = models.CharField(max_length=64, default="")
    status = models.CharField(max_length=32)
    row_count = models.BigIntegerField(default=0)
    inserted_count = models.BigIntegerField(default=0)
    duplicate_count = models.BigIntegerField(default=0)
    warning_count = models.BigIntegerField(default=0)
    parsed_month_count = models.BigIntegerField(default=0)
    imported_month_count = models.BigIntegerField(default=0)
    skipped_month_count = models.BigIntegerField(default=0)
    subject_count = models.BigIntegerField(default=0)
    months_json = models.JSONField(default=list)
    warnings_json = models.JSONField(default=list)
    actor_email = models.CharField(max_length=320, default="")
    created_at = models.TextField()
    completed_at = models.TextField(null=True, blank=True)
    migration_generation = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        db_table = "finance_import_batches"
        indexes = [models.Index(fields=["created_at"], name="fin_batch_created_idx")]


class FinanceMonth(models.Model):
    month = models.CharField(primary_key=True, max_length=7)
    batch_id = models.CharField(max_length=64, db_index=True)
    sheet_name = models.TextField()
    business_name = models.TextField()
    source_file_name = models.TextField()
    status = models.CharField(max_length=32, default="processing")
    shop_count = models.BigIntegerField(default=0)
    subject_count = models.BigIntegerField(default=0)
    imported_at = models.TextField()
    migration_generation = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        db_table = "finance_months"
        indexes = [
            models.Index(fields=["status", "month"], name="fin_month_status_idx"),
            models.Index(fields=["status", "batch_id"], name="fin_month_batch_idx"),
        ]


class FinanceLine(models.Model):
    id = models.BigAutoField(primary_key=True)
    month = models.CharField(max_length=7)
    section = models.CharField(max_length=32)
    metric_key = models.TextField()
    subject_name = models.TextField()
    scope_key = models.TextField()
    scope_type = models.CharField(max_length=32)
    scope_name = models.TextField()
    group_name = models.TextField(default="")
    value_type = models.CharField(max_length=32)
    amount_cents = models.BigIntegerField(null=True, blank=True)
    rate_bps = models.BigIntegerField(null=True, blank=True)
    raw_value = models.TextField(default="")
    source_row_count = models.BigIntegerField(default=1)
    sort_order = models.BigIntegerField(default=0)
    is_total = models.BooleanField(default=False)
    created_at = models.TextField()
    migration_generation = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        db_table = "finance_lines"
        constraints = [
            models.UniqueConstraint(
                fields=["month", "section", "scope_key", "subject_name"],
                name="fin_line_identity_uq",
            )
        ]
        indexes = [
            models.Index(
                fields=["month", "section", "scope_type", "scope_name"],
                name="fin_line_scope_idx",
            ),
            models.Index(fields=["metric_key", "month"], name="fin_line_metric_idx"),
            models.Index(fields=["subject_name", "month"], name="fin_line_subject_idx"),
            models.Index(fields=["month", "group_name", "scope_name"], name="fin_line_shop_idx"),
        ]


class FinanceTarget(models.Model):
    id = models.CharField(primary_key=True, max_length=128)
    period_type = models.CharField(max_length=16)
    period_key = models.CharField(max_length=100)
    platform = models.CharField(max_length=100, default="")
    shop_name = models.CharField(max_length=100, default="")
    category = models.CharField(max_length=100, default="")
    manager = models.CharField(max_length=120, default="")
    sales_target_cents = models.BigIntegerField(default=0)
    profit_target_cents = models.BigIntegerField(default=0)
    small_margin_bps = models.BigIntegerField(default=0)
    inventory_cleanup_target_cents = models.BigIntegerField(default=0)
    promotion_fee_ratio_bps = models.BigIntegerField(default=0)
    stagnant_inventory_target_cents = models.BigIntegerField(default=0)
    version = models.BigIntegerField(default=1)
    created_at = models.TextField()
    updated_at = models.TextField()
    migration_generation = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        db_table = "finance_targets_scoped"
        constraints = [
            models.UniqueConstraint(
                fields=["period_type", "period_key", "platform", "shop_name", "category"],
                name="fin_target_scope_uq",
            )
        ]
        indexes = [
            models.Index(fields=["period_type", "period_key"], name="fin_target_period_idx"),
            models.Index(
                fields=["platform", "shop_name", "period_type", "period_key"],
                name="fin_target_shop_idx",
            ),
        ]


class FinanceTargetDeletionAudit(models.Model):
    audit_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    target_id = models.CharField(max_length=128)
    period_type = models.CharField(max_length=16)
    period_key = models.CharField(max_length=100)
    platform = models.CharField(max_length=100)
    shop_name = models.CharField(max_length=100)
    category = models.CharField(max_length=100)
    actor = models.CharField(max_length=320)
    old_version = models.BigIntegerField()
    expected_version = models.BigIntegerField()
    reason = models.CharField(max_length=200)
    deleted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "finance_target_deletion_audits"


class FinanceImportScopeHead(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    scope_key = models.CharField(max_length=64, unique=True)
    state_token = models.CharField(max_length=64, default="0" * 64)
    status = models.CharField(max_length=32, default="ready")
    owner_token = models.CharField(max_length=64, default="")
    current_batch_id = models.CharField(max_length=64, default="")
    generation = models.BigIntegerField(default=0)
    owner_started_at = models.DateTimeField(null=True, blank=True)
    heartbeat_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "finance_import_scope_heads"


class FinanceImportAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_id = models.CharField(max_length=64, default="")
    scope_key = models.CharField(max_length=64, default="", db_index=True)
    raw_file_hash = models.CharField(max_length=64, default="", db_index=True)
    content_hash = models.CharField(max_length=64, default="")
    outcome = models.CharField(max_length=32)
    error_code = models.CharField(max_length=64, default="")
    actor_email = models.CharField(max_length=320, default="")
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "finance_import_attempts"
        indexes = [models.Index(fields=["scope_key", "created_at"], name="fin_attempt_scope_idx")]


class FinanceImportFingerprint(models.Model):
    id = models.BigAutoField(primary_key=True)
    batch_id = models.CharField(max_length=64, unique=True)
    scope_key = models.CharField(max_length=64, db_index=True)
    content_hash = models.CharField(max_length=64)
    raw_file_hash = models.CharField(max_length=64, db_index=True)
    row_count = models.BigIntegerField()
    published_state_token = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "finance_import_fingerprints"


class FinanceDataRevision(models.Model):
    domain = models.CharField(primary_key=True, max_length=32)
    revision = models.BigIntegerField(default=0)
    source_digest = models.CharField(max_length=64, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "finance_data_revisions"


class FinanceWriteAuthority(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    status = models.CharField(max_length=16, default="d1")
    authority_epoch = models.UUIDField(null=True, blank=True)
    cutover_id = models.CharField(max_length=128, default="")
    migration_verify_run_id = models.CharField(max_length=64, default="")
    activated_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "finance_write_authority"


class FinanceWriteRequestReceipt(models.Model):
    request_id = models.CharField(primary_key=True, max_length=128)
    body_sha256 = models.CharField(max_length=64)
    query_sha256 = models.CharField(max_length=64)
    method = models.CharField(max_length=8)
    path = models.CharField(max_length=200)
    actor_email = models.CharField(max_length=320)
    status = models.CharField(max_length=32, default="processing")
    response_status = models.PositiveIntegerField(default=0)
    response_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "finance_write_request_receipts"


class FinanceMigrationRun(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    mode = models.CharField(max_length=16)
    status = models.CharField(max_length=32)
    source_path_digest = models.CharField(max_length=64)
    source_snapshot_digest = models.CharField(max_length=64)
    target_snapshot_digest = models.CharField(max_length=64, default="")
    source_counts = models.JSONField(default=dict)
    target_counts = models.JSONField(default=dict)
    approved_run_id = models.CharField(max_length=64, default="")
    manifest = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "finance_migration_runs"
