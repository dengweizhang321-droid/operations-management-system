"""Tmall source snapshots; these never become ERP or JD inventory facts."""
from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class TmallWarehouseScope(models.Model):
    owner = models.CharField(primary_key=True, max_length=160)
    revision = models.PositiveBigIntegerField(default=0)
    latest_snapshot_date = models.DateField(null=True, blank=True)
    owner_token = models.CharField(max_length=64, default="")
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_tmall_warehouse_scopes"


class TmallWarehouseBatch(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4)
    owner = models.CharField(max_length=160)
    snapshot_date = models.DateField()
    raw_file_hash = models.CharField(max_length=64)
    content_hash = models.CharField(max_length=64)
    file_name = models.CharField(max_length=255)
    row_count = models.PositiveIntegerField()
    status = models.CharField(max_length=16)
    reference_batch_id = models.CharField(max_length=64, default="")
    scope_revision = models.PositiveBigIntegerField()
    collected_at = models.DateTimeField(null=True, blank=True)
    source_as_of = models.CharField(max_length=40, default="")
    source_date = models.DateField(null=True, blank=True)
    source_url = models.CharField(max_length=300, default="")
    collector_evidence = models.JSONField(default=dict)
    # JSON lines provide portable exact membership filtering for historical
    # batches after their former facts have been atomically replaced.
    warehouse_membership = models.TextField(default="")
    actor = models.CharField(max_length=320)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_tmall_warehouse_batches"
        indexes = [models.Index(fields=["owner", "snapshot_date", "scope_revision"], name="inv_tmw_batch_scope_idx")]
        constraints = [models.CheckConstraint(condition=models.Q(status__in=["completed", "duplicate"]), name="inv_tmw_batch_status_ck")]


class TmallWarehouseFact(models.Model):
    batch = models.ForeignKey(TmallWarehouseBatch, on_delete=models.PROTECT)
    owner = models.CharField(max_length=160)
    snapshot_date = models.DateField()
    goods_id = models.CharField(max_length=160)
    goods_code = models.CharField(max_length=160, default="")
    goods_name = models.CharField(max_length=500, default="")
    warehouse = models.CharField(max_length=200)
    warehouse_code = models.CharField(max_length=160, default="")
    warehouse_key = models.CharField(max_length=256)
    region = models.CharField(max_length=160, default="")
    brand = models.CharField(max_length=160, default="")
    available_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    on_hand_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    sales_occupied_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    good_available_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    good_occupied_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    defective_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    purchase_in_transit_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    transfer_in_transit_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    sales_7d_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    sales_30d_quantity = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    source_attributes = models.JSONField(default=dict)
    source_row_number = models.PositiveIntegerField()

    class Meta:
        db_table = "inventory_tmall_warehouse_facts"
        indexes = [models.Index(fields=["owner", "snapshot_date", "warehouse"], name="inv_tmw_fact_scope_idx")]
        constraints = [models.UniqueConstraint(fields=["owner", "snapshot_date", "goods_id", "warehouse_key"], name="inv_tmw_fact_identity_uq")]


class TmallWarehouseAudit(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4)
    owner = models.CharField(max_length=160, default="")
    batch_id = models.CharField(max_length=64, default="")
    actor = models.CharField(max_length=320)
    status = models.CharField(max_length=16)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "inventory_tmall_warehouse_audits"
