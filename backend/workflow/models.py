from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class WorkflowDataRevision(models.Model):
    domain = models.CharField(primary_key=True, max_length=32)
    revision = models.BigIntegerField(default=0)
    source_digest = models.CharField(max_length=64, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workflow_data_revisions"


class WorkflowWriteAuthority(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    status = models.CharField(max_length=16, default="disabled")
    authority_epoch = models.UUIDField(null=True, blank=True)
    cutover_id = models.CharField(max_length=128, default="")
    migration_verify_run_id = models.CharField(max_length=64, default="")
    activated_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workflow_write_authority"
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="workflow_auth_singleton_ck"),
            models.CheckConstraint(
                condition=models.Q(status__in=["disabled", "postgres"]),
                name="workflow_auth_status_ck",
            ),
        ]


class WorkflowMigrationRun(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    mode = models.CharField(max_length=16)
    status = models.CharField(max_length=24)
    source_path_digest = models.CharField(max_length=64)
    source_snapshot_digest = models.CharField(max_length=64)
    target_snapshot_digest = models.CharField(max_length=64, default="")
    source_counts = models.JSONField(default=dict)
    target_counts = models.JSONField(default=dict)
    gap_counts = models.JSONField(default=dict)
    approved_run_id = models.CharField(max_length=64, default="")
    manifest = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "workflow_migration_runs"


class WorkflowWriteRequestReceipt(models.Model):
    request_id = models.CharField(primary_key=True, max_length=128)
    body_sha256 = models.CharField(max_length=64)
    query_sha256 = models.CharField(max_length=64)
    method = models.CharField(max_length=8)
    path = models.CharField(max_length=240)
    actor_email = models.CharField(max_length=320)
    status = models.CharField(max_length=32, default="processing")
    claim_token = models.CharField(max_length=64, default="")
    response_status = models.PositiveIntegerField(default=0)
    response_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "workflow_write_request_receipts"


class NewProductProject(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_name = models.CharField(max_length=200)
    supplier_name = models.CharField(max_length=200, default="")
    brand = models.CharField(max_length=120, default="")
    category = models.CharField(max_length=120, default="")
    erp_product_code = models.CharField(max_length=160, default="")
    sku_code = models.CharField(max_length=160, default="")
    spu_code = models.CharField(max_length=160, default="")
    product_image_url = models.URLField(max_length=1000, default="")
    proposed_by = models.CharField(max_length=120, default="")
    proposed_date = models.DateField(db_index=True)
    owner = models.CharField(max_length=120, default="")
    target_launch_date = models.DateField(null=True, blank=True, db_index=True)
    lifecycle_status = models.CharField(max_length=16, default="active", db_index=True)
    priority = models.CharField(max_length=16, default="normal", db_index=True)
    recommended_price_cents = models.BigIntegerField(null=True, blank=True)
    approved_price_cents = models.BigIntegerField(null=True, blank=True)
    estimated_gross_margin_bps = models.IntegerField(null=True, blank=True)
    source = models.CharField(max_length=24, default="manual", db_index=True)
    source_ref = models.CharField(max_length=200, default="")
    notes = models.TextField(default="")
    version = models.PositiveBigIntegerField(default=1)
    created_by = models.CharField(max_length=320)
    updated_by = models.CharField(max_length=320)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.CharField(max_length=320, default="")

    class Meta:
        db_table = "workflow_new_product_projects"
        indexes = [
            models.Index(fields=["lifecycle_status", "target_launch_date"], name="workflow_np_status_due_idx"),
            models.Index(fields=["supplier_name", "proposed_date"], name="workflow_np_supplier_idx"),
            models.Index(fields=["updated_at", "id"], name="workflow_np_updated_idx"),
        ]


class NewProductTarget(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(NewProductProject, on_delete=models.CASCADE, related_name="targets")
    platform = models.CharField(max_length=80)
    shop_name = models.CharField(max_length=160)
    channel = models.CharField(max_length=80, default="")
    listing_sku = models.CharField(max_length=160, default="")
    listing_url = models.URLField(max_length=1000, default="")
    status = models.CharField(max_length=24, default="pending")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workflow_new_product_targets"
        constraints = [
            models.UniqueConstraint(
                fields=["project", "platform", "shop_name"],
                name="workflow_np_target_identity_uq",
            ),
        ]
        indexes = [
            models.Index(fields=["platform", "shop_name"], name="workflow_np_target_shop_idx"),
        ]


class NewProductStage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(NewProductProject, on_delete=models.CASCADE, related_name="stages")
    stage_key = models.CharField(max_length=24)
    status = models.CharField(max_length=24, default="not_started", db_index=True)
    owner = models.CharField(max_length=120, default="")
    planned_due_date = models.DateField(null=True, blank=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    blocker = models.CharField(max_length=500, default="")
    notes = models.TextField(default="")
    evidence_url = models.URLField(max_length=1000, default="")
    evidence_label = models.CharField(max_length=160, default="")
    version = models.PositiveBigIntegerField(default=1)
    updated_by = models.CharField(max_length=320, default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workflow_new_product_stages"
        constraints = [
            models.UniqueConstraint(fields=["project", "stage_key"], name="workflow_np_stage_uq"),
        ]
        indexes = [
            models.Index(fields=["stage_key", "status", "planned_due_date"], name="workflow_np_stage_state_idx"),
        ]


class NewProductActivity(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(NewProductProject, on_delete=models.CASCADE, related_name="activities")
    action = models.CharField(max_length=64)
    actor_email = models.CharField(max_length=320)
    actor_role = models.CharField(max_length=16)
    from_version = models.PositiveBigIntegerField(null=True, blank=True)
    to_version = models.PositiveBigIntegerField()
    stage_key = models.CharField(max_length=24, default="")
    from_status = models.CharField(max_length=24, default="")
    to_status = models.CharField(max_length=24, default="")
    changed_fields = models.JSONField(default=list)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "workflow_new_product_activities"
        indexes = [
            models.Index(fields=["project", "created_at"], name="workflow_np_activity_idx"),
        ]
