from __future__ import annotations

from django.db import models


class SalesImportBatch(models.Model):
    id = models.CharField(primary_key=True, max_length=200)
    source = models.CharField(max_length=200)
    file_name = models.TextField()
    file_size_bytes = models.BigIntegerField()
    file_hash = models.CharField(max_length=128, unique=True)
    sheet_name = models.TextField()
    status = models.CharField(max_length=50)
    row_count = models.BigIntegerField(default=0)
    inserted_count = models.BigIntegerField(default=0)
    duplicate_count = models.BigIntegerField(default=0)
    warning_count = models.BigIntegerField(default=0)
    warnings_json = models.TextField(default="[]")
    totals_json = models.TextField(default="{}")
    created_at = models.TextField()
    completed_at = models.TextField(null=True, blank=True)
    migration_generation = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        db_table = "sales_import_batches"
        indexes = [models.Index(fields=["created_at"], name="sales_batch_created_idx")]


class SalesOrderLine(models.Model):
    # D1's row id is allocation-local and can change when its snapshot is rebuilt.
    # Django owns this surrogate key; source_line_key is the cross-store identity.
    id = models.BigAutoField(primary_key=True)
    source_line_key = models.TextField(unique=True)
    source_row_hash = models.TextField()
    first_import_batch_id = models.TextField()
    last_import_batch_id = models.TextField()
    source_row_number = models.BigIntegerField()
    order_no = models.TextField()
    online_order_no = models.TextField()
    channel = models.TextField()
    platform = models.TextField()
    shop_name = models.TextField()
    logistics_company = models.TextField()
    warehouse = models.TextField()
    product_code = models.TextField()
    online_spec_code = models.TextField(default="")
    product_name = models.TextField()
    specification = models.TextField()
    barcode = models.TextField()
    supplier = models.TextField()
    category = models.TextField()
    quantity = models.BigIntegerField()
    list_unit_price_cents = models.BigIntegerField()
    cost_amount_cents = models.BigIntegerField()
    allocated_unit_price_cents = models.BigIntegerField()
    allocated_amount_cents = models.BigIntegerField()
    fee_allocation_cents = models.BigIntegerField()
    gross_profit_cents = models.BigIntegerField()
    gross_margin_bps = models.BigIntegerField()
    untaxed_gross_profit_cents = models.BigIntegerField()
    untaxed_gross_margin_bps = models.BigIntegerField()
    order_time = models.TextField()
    sales_time = models.TextField()
    ship_time = models.TextField()
    line_ship_time = models.TextField()
    business_type = models.TextField()
    created_at = models.TextField()
    updated_at = models.TextField()
    migration_generation = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        db_table = "sales_order_lines"
        indexes = [
            models.Index(fields=["ship_time"], name="sales_line_ship_idx"),
            models.Index(fields=["sales_time"], name="sales_line_sale_idx"),
            models.Index(fields=["channel"], name="sales_line_channel_idx"),
            models.Index(fields=["platform"], name="sales_line_platform_idx"),
            models.Index(fields=["product_code"], name="sales_line_product_idx"),
            models.Index(fields=["last_import_batch_id"], name="sales_line_batch_idx"),
        ]


class ErpProductMaster(models.Model):
    product_code = models.TextField(primary_key=True)
    product_name = models.TextField()
    brand = models.TextField(default="")
    specification = models.TextField(default="")
    barcode = models.TextField(default="")
    category = models.TextField(default="")
    supplier = models.TextField(default="")
    product_status = models.TextField(default="")
    source_row_number = models.BigIntegerField()
    last_import_batch_id = models.TextField()
    created_at = models.TextField()
    updated_at = models.TextField()
    migration_generation = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        db_table = "erp_product_master"
        indexes = [
            models.Index(fields=["product_name"], name="erp_product_name_idx"),
            models.Index(fields=["barcode"], name="erp_product_barcode_idx"),
            models.Index(fields=["last_import_batch_id"], name="erp_product_batch_idx"),
        ]


class SalesDataRevision(models.Model):
    domain = models.CharField(primary_key=True, max_length=32)
    revision = models.BigIntegerField(default=0)
    source_digest = models.CharField(max_length=64, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_data_revisions"


class SalesMigrationRun(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    status = models.CharField(max_length=32)
    dry_run = models.BooleanField(default=False)
    source_fingerprint = models.CharField(max_length=128)
    source_path_digest = models.CharField(max_length=64)
    generation = models.CharField(max_length=64)
    source_revision = models.CharField(max_length=64, default="")
    target_revision = models.CharField(max_length=64, default="")
    canonical_format_version = models.CharField(max_length=64, default="")
    approved_run_id = models.CharField(max_length=64, blank=True, default="")
    consumed_by_run_id = models.CharField(max_length=64, blank=True, default="")
    approval_consumed_at = models.DateTimeField(null=True, blank=True)
    source_counts = models.JSONField(default=dict)
    target_counts = models.JSONField(default=dict)
    source_digests = models.JSONField(default=dict)
    target_digests = models.JSONField(default=dict)
    error_code = models.CharField(max_length=100, blank=True, default="")
    error_message = models.TextField(blank=True, default="")
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sales_migration_runs"
        indexes = [models.Index(fields=["status", "started_at"], name="sales_migration_status_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["approved_run_id"],
                condition=models.Q(approved_run_id__gt=""),
                name="uniq_sales_mig_approval",
            )
        ]


class SalesMigrationLock(models.Model):
    name = models.CharField(primary_key=True, max_length=64)
    owner_id = models.CharField(max_length=64, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_migration_locks"
