"""JD source facts are separate from ERP inventory snapshots and manual evidence."""
from __future__ import annotations

import uuid
from django.db import models
from django.utils import timezone


class JdLogisticsDepartment(models.Model):
    id = models.CharField(primary_key=True, max_length=80)
    name = models.CharField(max_length=200)
    business_unit_code = models.CharField(max_length=100, unique=True)
    store_keys = models.JSONField(default=list)
    capabilities = models.JSONField(default=dict)
    logistics_enabled = models.BooleanField(default=False)
    monitor_enabled = models.BooleanField(default=False)
    push_enabled = models.BooleanField(default=False)
    stockout_threshold_days = models.PositiveIntegerField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    updated_by = models.CharField(max_length=320)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_jd_logistics_departments"


class JdLogisticsScope(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    department = models.ForeignKey(JdLogisticsDepartment, on_delete=models.PROTECT)
    source_kind = models.CharField(max_length=32)
    revision = models.PositiveBigIntegerField(default=0)
    owner_token = models.CharField(max_length=64, default="")
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_jd_logistics_scopes"
        constraints = [models.UniqueConstraint(fields=["department", "source_kind"], name="inv_jdl_scope_uq")]


class JdLogisticsBatch(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4)
    department = models.ForeignKey(JdLogisticsDepartment, on_delete=models.PROTECT)
    source_kind = models.CharField(max_length=32)
    range_start = models.DateField()
    range_end = models.DateField()
    warehouse_code = models.CharField(max_length=100, default="")
    warehouse_key = models.CharField(max_length=256, default="")
    raw_file_hash = models.CharField(max_length=64)
    content_hash = models.CharField(max_length=64)
    file_name = models.CharField(max_length=255)
    row_count = models.PositiveIntegerField()
    status = models.CharField(max_length=16)
    reference_batch_id = models.CharField(max_length=64, default="")
    scope_revision = models.PositiveBigIntegerField()
    origin = models.CharField(max_length=16)
    store_key = models.CharField(max_length=100, default="")
    identity_evidence = models.JSONField(default=dict)
    collector_evidence = models.JSONField(default=dict)
    collected_at = models.DateTimeField(default=timezone.now)
    source_as_of = models.CharField(max_length=40, default="")
    actor = models.CharField(max_length=320)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_jd_logistics_batches"
        indexes = [models.Index(fields=["department", "source_kind", "created_at"], name="inv_jdl_batch_idx")]


class JdLogisticsFact(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4)
    department = models.ForeignKey(JdLogisticsDepartment, on_delete=models.PROTECT)
    batch = models.ForeignKey(JdLogisticsBatch, on_delete=models.PROTECT)
    source_kind = models.CharField(max_length=32)
    business_date = models.DateField()
    warehouse_code = models.CharField(max_length=100, default="")
    warehouse_key = models.CharField(max_length=256, default="")
    goods_code = models.CharField(max_length=160)
    goods_code_kind = models.CharField(max_length=32, default="department_product")
    document_no = models.CharField(max_length=160, default="")
    row_hash = models.CharField(max_length=64)
    occurrence = models.PositiveIntegerField()
    data = models.JSONField()

    class Meta:
        db_table = "inventory_jd_logistics_facts"
        indexes = [models.Index(fields=["department", "source_kind", "business_date"], name="inv_jdl_fact_scope_idx"), models.Index(fields=["department", "document_no", "goods_code"], name="inv_jdl_fact_doc_idx")]
        constraints = [models.UniqueConstraint(fields=["batch", "row_hash", "occurrence"], name="inv_jdl_fact_occ_uq")]


class JdLogisticsProductMapping(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    department = models.ForeignKey(JdLogisticsDepartment, on_delete=models.PROTECT)
    goods_code = models.CharField(max_length=160)
    goods_code_kind = models.CharField(max_length=32, default="department_product")
    erp_goods_code = models.CharField(max_length=160, default="")
    erp_goods_name = models.CharField(max_length=500, default="")
    status = models.CharField(max_length=16, default="unconfirmed")
    note = models.CharField(max_length=1000, default="")
    revision = models.PositiveBigIntegerField(default=0)
    updated_by = models.CharField(max_length=320)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_jd_logistics_mappings"
        constraints = [models.UniqueConstraint(fields=["department", "goods_code_kind", "goods_code"], name="inv_jdl_mapping_uq")]


class JdLogisticsTransferManual(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    department = models.ForeignKey(JdLogisticsDepartment, on_delete=models.PROTECT)
    document_no = models.CharField(max_length=160)
    goods_code = models.CharField(max_length=160)
    transfer_status = models.CharField(max_length=16, default="pending")
    erp_document_no = models.CharField(max_length=160, default="")
    note = models.CharField(max_length=1000, default="")
    flow_revision = models.CharField(max_length=64)
    revision = models.PositiveBigIntegerField(default=0)
    updated_by = models.CharField(max_length=320)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_jd_logistics_manual_states"
        constraints = [models.UniqueConstraint(fields=["department", "document_no", "goods_code"], name="inv_jdl_manual_uq")]


class JdLogisticsAudit(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4)
    department_id = models.CharField(max_length=80, default="")
    operation = models.CharField(max_length=32)
    object_key = models.CharField(max_length=64, default="")
    actor = models.CharField(max_length=320)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_jd_logistics_audits"


class JdLogisticsDelivery(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4)
    idempotency_key = models.CharField(max_length=64, unique=True)
    business_date = models.DateField()
    department_ids = models.JSONField(default=list)
    status = models.CharField(max_length=16, default="sending")
    owner_token = models.CharField(max_length=64)
    risk_count = models.PositiveIntegerField()
    displayed_count = models.PositiveIntegerField()
    risk_snapshot = models.JSONField(default=list)
    scope_snapshot = models.JSONField(default=dict)
    run_metadata = models.JSONField(default=dict)
    message_text = models.TextField()
    message_hash = models.CharField(max_length=64)
    config_digest = models.CharField(max_length=64)
    source_digest = models.CharField(max_length=64)
    scope_digest = models.CharField(max_length=64)
    target_digest = models.CharField(max_length=64)
    receipt_hash = models.CharField(max_length=64, default="")
    error_code = models.CharField(max_length=64, default="")
    actor = models.CharField(max_length=320)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "inventory_jd_logistics_deliveries"
        indexes = [models.Index(fields=["business_date", "status"], name="inv_jdl_delivery_guard_idx")]
        constraints = [models.CheckConstraint(condition=models.Q(status__in=["sending", "sent", "unknown", "denied"]), name="inv_jdl_delivery_status_ck")]
