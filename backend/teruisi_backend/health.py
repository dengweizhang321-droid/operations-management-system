"""Liveness and fail-closed readiness probes for the local Django service."""

from __future__ import annotations

import logging
import re
import uuid

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from sales.runtime_guard import (
    WriterRuntimeGuardError,
    validate_erp_reference_runtime_state,
    validate_writer_runtime_state,
)


logger = logging.getLogger(__name__)
HEX_64 = re.compile(r"^[0-9a-f]{64}$")

REQUIRED_COLUMNS = {
    "sales_order_lines": {
        "business_date",
        "platform_key",
        "channel_key",
        "shop_key",
        "resolved_category",
        "order_identity",
        "is_business_row",
        "is_net_sales_row",
        "is_net_quantity_row",
        "migration_generation",
    },
    "sales_import_batches": {"migration_generation"},
    "erp_product_master": {"migration_generation"},
    "sales_data_revisions": {"domain", "revision", "source_digest"},
    "erp_reference_sync_checkpoint": {
        "source_epoch",
        "source_path_digest",
        "last_event_sequence",
        "last_event_id",
        "erp_revision",
        "content_hash",
        "row_count",
        "source_batch_id",
        "last_checked_at",
    },
}
REQUIRED_SALES_INDEXES = {
    "sales_biz_date_idx",
    "sales_platform_shop_date_idx",
    "sales_channel_date_idx",
    "sales_category_date_idx",
    "sales_product_date_idx",
}
REQUIRED_FINANCE_COLUMNS = {
    "finance_import_batches": {
        "id", "status", "raw_file_hash", "content_hash", "scope_key",
        "published_state_token", "migration_generation",
    },
    "finance_months": {"month", "batch_id", "status", "migration_generation"},
    "finance_lines": {
        "month", "section", "metric_key", "subject_name", "scope_key",
        "scope_type", "scope_name", "group_name", "amount_cents", "rate_bps",
        "migration_generation",
    },
    "finance_targets_scoped": {
        "id", "period_type", "period_key", "platform", "shop_name", "category", "version",
    },
    "finance_data_revisions": {"domain", "revision", "source_digest"},
}
REQUIRED_FINANCE_WRITER_COLUMNS = {
    **REQUIRED_FINANCE_COLUMNS,
    "finance_target_deletion_audits": {"audit_id", "target_id", "old_version", "reason"},
    "finance_import_scope_heads": {"scope_key", "state_token", "status", "owner_token", "generation"},
    "finance_import_attempts": {"id", "scope_key", "outcome", "error_code"},
    "finance_import_fingerprints": {"batch_id", "scope_key", "content_hash"},
    "finance_write_authority": {"id", "status", "authority_epoch", "cutover_id"},
    "finance_write_request_receipts": {
        "request_id", "body_sha256", "query_sha256", "status", "response_payload",
    },
}
REQUIRED_FINANCE_INDEXES = {
    "fin_line_scope_idx", "fin_line_metric_idx", "fin_line_subject_idx", "fin_line_shop_idx",
}
REQUIRED_FINANCE_READER_COLLATION = "zh-Hans-CN-x-icu"
FINANCE_WRITER_TABLE_PRIVILEGES = {
    "finance_import_batches": ("SELECT", "INSERT", "UPDATE"),
    "finance_months": ("SELECT", "INSERT", "UPDATE"),
    "finance_lines": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "finance_targets_scoped": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "finance_target_deletion_audits": ("SELECT", "INSERT"),
    "finance_import_scope_heads": ("SELECT", "INSERT", "UPDATE"),
    "finance_import_attempts": ("SELECT", "INSERT", "UPDATE"),
    "finance_import_fingerprints": ("SELECT", "INSERT"),
    "finance_data_revisions": ("SELECT", "INSERT", "UPDATE"),
    "finance_write_authority": ("SELECT",),
    "finance_write_request_receipts": ("SELECT", "INSERT", "UPDATE"),
}
FINANCE_WRITER_FORBIDDEN_TABLES = (
    "sales_order_lines",
    "sales_import_batches",
    "sales_data_revisions",
    "sales_write_authority",
    "erp_product_master",
    "erp_reference_sync_checkpoint",
    "finance_migration_runs",
)
FINANCE_WRITER_AUTO_ID_TABLES = ("finance_lines", "finance_import_fingerprints")
REQUIRED_NETSHOP_COLUMNS = {
    "netshop_import_batches": {
        "id", "source", "dataset", "platform", "shop_name", "status",
        "raw_file_hash", "content_hash", "scope_key", "published_state_token",
        "migration_generation",
    },
    "netshop_rows": {
        "source_row_key", "last_import_batch_id", "source", "dataset",
        "platform", "shop_name", "business_date", "snapshot_date", "sku_id",
        "spu_id", "transaction_amount_cents", "spend_cents", "migration_generation",
    },
    "netshop_promotion_product_daily": {
        "platform", "shop_name", "business_date", "product_id", "spend_cents",
        "net_transaction_amount_cents", "source_batch_id",
    },
    "netshop_promotion_shop_daily": {
        "platform", "shop_name", "business_date", "product_count", "spend_cents",
        "net_transaction_amount_cents", "source_batch_id",
    },
    "netshop_promotion_aggregate_state": {
        "platform", "shop_name", "business_date", "ready", "source_batch_id",
    },
    "netshop_promotion_aggregate_manifest": {"platform", "ready", "data_version"},
    "netshop_product_daily_revisions": {"platform", "data_version"},
    "netshop_product_daily_scope_revisions": {"platform", "shop_name", "data_version"},
    "netshop_promotion_scope_revisions": {"platform", "shop_name", "data_version"},
    "netshop_data_revisions": {"domain", "revision", "source_digest"},
}
REQUIRED_NETSHOP_WRITER_COLUMNS = {
    **REQUIRED_NETSHOP_COLUMNS,
    "netshop_import_scope_heads": {"scope_key", "state_token", "status", "owner_token", "generation"},
    "netshop_import_attempts": {"id", "scope_key", "outcome", "error_code"},
    "netshop_import_fingerprints": {"batch_id", "scope_key", "content_hash"},
    "netshop_promotion_aggregate_control": {"platform", "maintenance_version", "maintenance_token"},
    "netshop_asset_uploads": {"id", "fingerprint", "status", "owner_generation"},
    "netshop_asset_upload_chunks": {"upload_id", "chunk_index", "object_key", "sha256"},
    "netshop_asset_upload_results": {"upload_id", "result_json"},
    "netshop_write_authority": {"id", "status", "authority_epoch", "cutover_id"},
    "netshop_write_request_receipts": {"request_id", "body_sha256", "query_sha256", "status"},
}
REQUIRED_NETSHOP_INDEXES = {
    "net_scope_date_idx", "net_master_head_idx", "net_batch_page_idx",
}
NETSHOP_WRITER_TABLE_PRIVILEGES = {
    "netshop_import_batches": ("SELECT", "INSERT", "UPDATE"),
    "netshop_rows": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "netshop_promotion_product_daily": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "netshop_promotion_shop_daily": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "netshop_promotion_aggregate_state": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "netshop_promotion_aggregate_manifest": ("SELECT", "INSERT", "UPDATE"),
    "netshop_promotion_aggregate_control": ("SELECT", "INSERT", "UPDATE"),
    "netshop_product_daily_revisions": ("SELECT", "INSERT", "UPDATE"),
    "netshop_product_daily_scope_revisions": ("SELECT", "INSERT", "UPDATE"),
    "netshop_promotion_scope_revisions": ("SELECT", "INSERT", "UPDATE"),
    "netshop_data_revisions": ("SELECT", "INSERT", "UPDATE"),
    "netshop_import_scope_heads": ("SELECT", "INSERT", "UPDATE"),
    "netshop_import_attempts": ("SELECT", "INSERT", "UPDATE"),
    "netshop_import_fingerprints": ("SELECT", "INSERT"),
    "netshop_asset_uploads": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "netshop_asset_upload_chunks": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "netshop_asset_upload_results": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "netshop_write_authority": ("SELECT",),
    "netshop_write_request_receipts": ("SELECT", "INSERT", "UPDATE", "DELETE"),
}
NETSHOP_WRITER_AUTO_ID_TABLES = (
    "netshop_rows", "netshop_promotion_product_daily", "netshop_promotion_shop_daily",
    "netshop_promotion_aggregate_state", "netshop_product_daily_scope_revisions",
    "netshop_promotion_scope_revisions", "netshop_import_fingerprints",
    "netshop_asset_upload_chunks",
)
REQUIRED_MARKET_COLUMNS = {
    "market_import_batches": {
        "id", "source_type", "status", "raw_file_hash", "content_hash",
        "scope_json", "published_state_token", "migration_generation",
    },
    "market_ranking_entries": {
        "natural_key", "period_start", "period_end", "category", "scope",
        "price_band_filter", "ranking_dimension", "sku_code", "gmv_cents",
        "last_import_batch_id", "migration_generation",
    },
    "market_master_identities": {
        "category", "scope", "ranking_dimension", "sku_code", "latest_entry_id",
    },
    "market_price_snapshots": {
        "category", "scope", "sku_code", "ranking_dimension", "month",
        "image_content_sha256", "confirmation_status",
        "confirmed_market_price_cents", "migration_generation",
    },
    "market_image_cache": {
        "source_url", "status", "object_key", "content_sha256", "migration_generation",
    },
    "market_annotation_jobs": {
        "id", "category", "prompt_version_id", "status", "migration_generation",
    },
    "market_annotation_items": {
        "id", "job_id", "category", "scope", "sku_code", "ranking_dimension",
        "month", "image_content_sha256", "status", "version", "migration_generation",
    },
    "market_netshop_projection": {
        "projection_revision", "projection_key", "kind", "business_date",
        "sku_id", "spu_id", "transaction_amount_cents",
    },
    "market_netshop_projection_control": {
        "id", "active_revision", "active_total", "syncing_revision",
        "owner_token_hash", "lease_expires_at",
    },
    "market_data_revisions": {"domain", "revision", "source_digest"},
}
REQUIRED_MARKET_WRITER_COLUMNS = {
    **REQUIRED_MARKET_COLUMNS,
    "market_import_scope_heads": {
        "scope_key", "state_token", "status", "owner_token", "generation",
    },
    "market_import_attempts": {"id", "scope_key", "outcome", "error_code"},
    "market_import_fingerprints": {
        "batch_id", "scope_key", "content_hash", "published_state_token",
    },
    "market_write_authority": {
        "id", "status", "authority_epoch", "cutover_id", "migration_verify_run_id",
    },
    "market_write_request_receipts": {
        "request_id", "body_sha256", "query_sha256", "status", "response_payload",
    },
    "market_image_cache_jobs": {"id", "scope_key", "status", "lease_epoch"},
    "market_image_cache_job_items": {"job_id", "source_url", "status"},
    "market_image_cache_claims": {
        "source_url", "job_id", "claim_token_hash", "job_epoch", "lease_expires_at",
    },
    "market_annotation_commit_receipts": {
        "id", "job_item_id", "idempotency_key", "request_digest",
    },
}
REQUIRED_MARKET_INDEXES = {
    "mkt_entry_period_idx", "mkt_entry_category_idx", "mkt_entry_identity_idx",
}
MARKET_WRITER_TABLE_PRIVILEGES = {
    "market_import_batches": ("SELECT", "INSERT", "UPDATE"),
    "market_ranking_entries": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_master_identities": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_sku_gmv_totals": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_price_snapshots": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_data_revisions": ("SELECT", "INSERT", "UPDATE"),
    "market_import_scope_heads": ("SELECT", "INSERT", "UPDATE"),
    "market_import_attempts": ("SELECT", "INSERT", "UPDATE"),
    "market_import_fingerprints": ("SELECT", "INSERT"),
    "market_write_authority": ("SELECT",),
    "market_write_request_receipts": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_image_cache": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_image_cache_jobs": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_image_cache_job_items": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_image_cache_claims": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_price_band_versions": ("SELECT", "INSERT", "UPDATE"),
    "market_price_band_items": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_master_mapping_rules": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_subcategory_taxonomy": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_brand_suggestions": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_brand_recognition_jobs": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_brand_seeds": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_download_configs": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_download_tasks": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_master_audit_logs": ("SELECT", "INSERT"),
    "market_annotation_prompt_versions": ("SELECT", "INSERT", "UPDATE"),
    "market_annotation_jobs": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_annotation_items": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_sku_annotations": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_annotation_commit_receipts": ("SELECT", "INSERT"),
    "market_annotation_validation_samples": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_annotation_validation_runs": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_annotation_validation_results": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_annotation_prompt_audits": ("SELECT", "INSERT"),
    "market_annotation_local_agents": ("SELECT", "INSERT", "UPDATE"),
    "market_annotation_concurrency_settings": ("SELECT", "INSERT", "UPDATE"),
    "market_annotation_cloud_runs": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_netshop_projection": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "market_netshop_projection_control": ("SELECT", "INSERT", "UPDATE"),
}
MARKET_WRITER_AUTO_ID_TABLES = (
    "market_ranking_entries", "market_master_identities", "market_import_fingerprints",
    "market_image_cache_job_items", "market_annotation_concurrency_settings",
    "market_netshop_projection",
)
REQUIRED_PRODUCTS_COLUMNS = {
    "sales_order_lines": {"business_date", "product_code", "platform", "shop_name"},
    "sales_import_batches": {"id", "status", "completed_at"},
    "erp_product_master": {"product_code", "product_name", "category", "supplier"},
    "sales_data_revisions": {"domain", "revision", "source_digest"},
    "erp_reference_sync_checkpoint": {
        "id", "erp_revision", "content_hash", "row_count", "last_checked_at",
    },
    "product_shipping_rate_import_batches": {
        "id", "status", "raw_file_hash", "content_hash", "scope_key",
        "published_state_token", "migration_generation",
    },
    "product_shipping_rates": {
        "product_code", "shipping_rate", "last_import_batch_id", "migration_generation",
    },
    "product_data_revisions": {"domain", "revision", "source_digest"},
    "product_inventory_projection": {
        "projection_revision", "product_code", "available_quantity",
        "known_stock_value_cents", "priced_available_quantity", "source_batch_id",
    },
    "product_inventory_projection_control": {
        "id", "active_revision", "active_total", "active_source_batch_id",
        "active_snapshot_date", "syncing_revision", "owner_token_hash", "lease_expires_at",
    },
}
REQUIRED_PRODUCTS_WRITER_COLUMNS = {
    **{
        table: columns
        for table, columns in REQUIRED_PRODUCTS_COLUMNS.items()
        if table.startswith("product_")
    },
    "product_import_scope_heads": {
        "scope_key", "state_token", "status", "owner_token", "generation",
    },
    "product_import_attempts": {"id", "scope_key", "outcome", "error_code"},
    "product_import_fingerprints": {
        "batch_id", "scope_key", "content_hash", "published_state_token",
    },
    "product_write_authority": {
        "id", "status", "authority_epoch", "cutover_id", "migration_verify_run_id",
    },
    "product_write_request_receipts": {
        "request_id", "body_sha256", "query_sha256", "status", "response_payload",
    },
    "product_raw_upload_sessions": {
        "id", "fingerprint", "actor_email", "status", "owner_token",
        "owner_generation", "result_batch_id", "expires_at",
    },
    "product_raw_upload_chunks": {
        "session_id", "chunk_index", "object_key", "sha256", "payload",
    },
}
REQUIRED_PRODUCTS_READER_INDEXES = {
    "prod_rate_batch_created_idx", "prod_rate_batch_status_idx", "prod_inventory_projection_idx",
}
REQUIRED_PRODUCTS_WRITER_INDEXES = REQUIRED_PRODUCTS_READER_INDEXES | {
    "prod_attempt_scope_idx", "prod_upload_fingerprint_idx",
    "prod_upload_expiry_idx", "prod_raw_chunk_order_idx",
}
PRODUCTS_WRITER_TABLE_PRIVILEGES = {
    "product_shipping_rate_import_batches": ("SELECT", "INSERT", "UPDATE"),
    "product_shipping_rates": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "product_import_scope_heads": ("SELECT", "UPDATE"),
    "product_import_attempts": ("SELECT", "INSERT", "UPDATE"),
    "product_import_fingerprints": ("SELECT", "INSERT", "UPDATE"),
    "product_data_revisions": ("SELECT", "UPDATE"),
    "product_write_authority": ("SELECT",),
    "product_write_request_receipts": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "product_inventory_projection": ("SELECT", "INSERT", "DELETE"),
    "product_inventory_projection_control": ("SELECT", "UPDATE"),
    "product_raw_upload_sessions": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "product_raw_upload_chunks": ("SELECT", "INSERT", "UPDATE", "DELETE"),
}
PRODUCTS_WRITER_AUTO_ID_TABLES = (
    "product_import_fingerprints", "product_inventory_projection", "product_raw_upload_chunks",
)
REQUIRED_INVENTORY_COLUMNS = {
    "sales_order_lines": {"business_date", "product_code", "platform", "shop_name"},
    "sales_import_batches": {"id", "status", "completed_at"},
    "sales_data_revisions": {"domain", "revision", "source_digest"},
    "erp_product_master": {"product_code", "product_name", "category", "supplier"},
    "erp_reference_sync_checkpoint": {
        "id", "erp_revision", "content_hash", "row_count", "last_checked_at",
    },
    "inventory_import_batches": {
        "id", "dataset", "status", "snapshot_date", "completed_at", "row_count",
        "published_state_token", "migration_generation",
    },
    "inventory_stock_lines": {
        "batch_id", "row_key", "snapshot_date", "warehouse", "product_code",
        "available_quantity", "unit_cost_cents", "migration_generation",
    },
    "inventory_age_lines": {
        "batch_id", "row_key", "snapshot_date", "warehouse", "product_code",
        "available_quantity", "inventory_age_days", "stock_value_cents",
        "migration_generation",
    },
    "inventory_data_revisions": {"domain", "revision", "source_digest"},
    "replenishment_plan_items": {
        "id", "source_batch_id", "product_code", "warehouse", "planned_quantity",
        "status", "migration_generation", "brand", "category", "supplier", "buyer",
        "operator_name", "department", "plan_type", "order_date",
        "expected_arrival_date", "requires_inspection", "current_stock_quantity",
        "sales_30d_quantity", "notes",
    },
    "inventory_operating_settings": {
        "id", "target_days", "critical_days", "slow_days", "stagnant_days",
        "auto_replenishment", "inventory_alert", "allow_negative_inventory",
    },
}
REQUIRED_INVENTORY_WRITER_COLUMNS = {
    **REQUIRED_INVENTORY_COLUMNS,
    "inventory_import_scope_heads": {
        "dataset", "scope_key", "state_token", "status", "owner_token", "generation",
    },
    "inventory_import_attempts": {
        "id", "dataset", "scope_key", "row_count", "excluded_count", "outcome",
        "error_code", "metadata",
    },
    "inventory_import_fingerprints": {
        "dataset", "batch_id", "scope_key", "content_hash", "published_state_token",
    },
    "inventory_write_authority": {
        "id", "status", "authority_epoch", "cutover_id", "migration_verify_run_id",
    },
    "inventory_write_request_receipts": {
        "request_id", "body_sha256", "query_sha256", "status", "response_payload",
    },
    "inventory_raw_upload_sessions": {
        "id", "fingerprint", "dataset", "actor_email", "status", "owner_token",
        "owner_generation", "result_batch_id", "expires_at",
    },
    "inventory_raw_upload_chunks": {
        "session_id", "chunk_index", "object_key", "sha256", "payload",
    },
    "inventory_replenishment_group_deliveries": {
        "id", "idempotency_key", "plan_ids", "target_group_name", "robot_name",
        "message_sha256", "message_text", "status", "provider_receipt",
        "error_code", "claimed_by", "created_at", "updated_at", "delivered_at",
    },
}
REQUIRED_INVENTORY_READER_INDEXES = {
    "inv_batch_scope_idx", "inv_batch_created_idx", "inv_stock_lookup_idx",
    "inv_stock_product_idx", "inv_age_lookup_idx", "inv_age_product_idx",
    "inv_plan_status_idx",
}
REQUIRED_INVENTORY_WRITER_INDEXES = REQUIRED_INVENTORY_READER_INDEXES | {
    "inv_attempt_scope_idx", "inv_upload_fingerprint_idx", "inv_upload_expiry_idx",
    "inv_raw_chunk_order_idx", "inv_group_delivery_time_idx",
    "inv_group_delivery_status_idx",
}
INVENTORY_WRITER_TABLE_PRIVILEGES = {
    "sales_order_lines": ("SELECT",),
    "sales_import_batches": ("SELECT",),
    "sales_data_revisions": ("SELECT",),
    "erp_product_master": ("SELECT",),
    "erp_reference_sync_checkpoint": ("SELECT",),
    "inventory_import_batches": ("SELECT", "INSERT", "UPDATE"),
    "inventory_stock_lines": ("SELECT", "INSERT", "DELETE"),
    "inventory_age_lines": ("SELECT", "INSERT", "DELETE"),
    "inventory_import_scope_heads": ("SELECT", "UPDATE"),
    "inventory_import_attempts": ("SELECT", "INSERT", "UPDATE"),
    "inventory_import_fingerprints": ("SELECT", "INSERT"),
    "inventory_data_revisions": ("SELECT", "UPDATE"),
    "inventory_write_authority": ("SELECT",),
    "inventory_write_request_receipts": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "inventory_raw_upload_sessions": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "inventory_raw_upload_chunks": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "replenishment_plan_items": ("SELECT", "INSERT", "UPDATE"),
    "inventory_replenishment_group_deliveries": ("SELECT", "INSERT", "UPDATE"),
    "inventory_operating_settings": ("SELECT", "UPDATE"),
}
INVENTORY_WRITER_AUTO_ID_TABLES = (
    "inventory_stock_lines", "inventory_age_lines", "inventory_import_fingerprints",
    "inventory_raw_upload_chunks",
)
REQUIRED_WORKFLOW_COLUMNS = {
    "workflow_data_revisions": {"domain", "revision", "source_digest"},
    "workflow_write_authority": {
        "id", "status", "authority_epoch", "cutover_id", "migration_verify_run_id",
    },
    "workflow_operations_write_authority": {
        "id", "status", "authority_epoch", "cutover_id", "migration_verify_run_id",
    },
    "workflow_tasks": {
        "id", "title", "work_content", "category", "owner", "shop_name",
        "start_date", "due_date", "status", "priority", "version", "created_by",
        "updated_by", "created_at", "updated_at", "deleted_at", "deleted_by",
    },
    "workflow_task_comments": {"id", "task_id", "content", "created_by", "created_at"},
    "workflow_task_activity_logs": {"id", "task_id", "action", "summary", "metadata", "actor_email", "created_at"},
    "workflow_task_reminders": {"id", "task_id", "remind_at", "note", "status", "created_by", "updated_at"},
    "workflow_task_templates": {"id", "name", "title", "active", "version", "created_by", "updated_by", "updated_at"},
    "workflow_task_entity_links": {"id", "task_id", "entity_type", "entity_id", "label", "url", "created_by"},
    "workflow_task_attachments": {"id", "task_id", "file_name", "mime_type", "size_bytes", "sha256", "object_key", "created_by"},
    "workflow_operation_records": {
        "id", "record_type", "title", "status", "priority", "platform", "channel",
        "shop_name", "occurred_at", "version", "created_by", "updated_by", "deleted_at",
    },
    "workflow_operation_activities": {"id", "record_id", "action", "actor_email", "actor_role", "from_version", "to_version", "detail"},
    "workflow_new_product_projects": {
        "id", "product_name", "supplier_name", "brand", "category",
        "erp_product_code", "sku_code", "spu_code", "proposed_date", "owner",
        "target_launch_date", "lifecycle_status", "priority", "source_ref", "version",
        "created_at", "updated_at", "deleted_at",
    },
    "workflow_new_product_targets": {
        "id", "project_id", "platform", "shop_name", "channel", "listing_sku", "status",
    },
    "workflow_new_product_stages": {
        "id", "project_id", "stage_key", "status", "owner", "planned_due_date",
        "completed_at", "blocker", "evidence_url", "version",
    },
    "workflow_new_product_activities": {
        "id", "project_id", "action", "actor_email", "actor_role", "from_version",
        "to_version", "stage_key", "changed_fields", "created_at",
    },
    "workflow_new_product_lines": {
        "id", "name", "match_terms", "product_image_url", "monitoring_start_date",
        "product_image_file_name", "product_image_mime_type", "product_image_size_bytes",
        "product_image_sha256", "product_image_bytes",
        "weekly_unit_target", "weekly_sales_target_cents", "active", "version",
        "created_at", "updated_at", "deleted_at",
    },
    "workflow_new_product_line_codes": {
        "id", "product_line_id", "product_code", "product_name", "source",
        "source_batch_id", "active", "created_at", "updated_at",
    },
    "workflow_new_product_weekly_report_config": {
        "id", "enabled", "target_group_name", "robot_name", "send_weekday",
        "send_local_time", "version", "updated_at",
    },
    "workflow_new_product_weekly_deliveries": {
        "id", "week_start", "week_end", "target_group_name", "robot_name",
        "idempotency_key", "report_sha256", "data_cutoff_date", "status",
        "attempt_count", "provider_receipt", "error_code", "created_at", "updated_at",
    },
    "sales_order_lines": {
        "product_code", "business_date", "quantity", "allocated_amount_cents",
        "gross_profit_cents", "is_business_row", "is_net_sales_row", "is_net_quantity_row",
    },
    "sales_import_batches": {"id", "status", "file_name", "completed_at"},
    "erp_product_master": {"product_code", "product_name", "last_import_batch_id"},
}
REQUIRED_WORKFLOW_WRITER_COLUMNS = {
    **REQUIRED_WORKFLOW_COLUMNS,
    "workflow_write_request_receipts": {
        "request_id", "body_sha256", "query_sha256", "method", "path", "actor_email",
        "status", "claim_token", "response_status", "response_payload", "expires_at",
    },
    "workflow_attachment_cleanup_queue": {"object_key", "attempts", "last_error", "enqueued_at", "updated_at"},
}
REQUIRED_WORKFLOW_INDEXES = {
    "workflow_np_status_due_idx", "workflow_np_supplier_idx", "workflow_np_updated_idx",
    "workflow_np_target_shop_idx", "workflow_np_stage_state_idx", "workflow_np_activity_idx",
    "workflow_npl_active_start_idx", "workflow_npl_updated_idx", "workflow_npl_code_line_idx",
    "workflow_npl_active_name_uq", "workflow_npl_code_batch_idx", "workflow_npl_delivery_week_idx", "workflow_npl_delivery_time_idx",
    "workflow_task_status_idx", "workflow_task_deleted_idx", "workflow_task_updated_idx",
    "workflow_task_comment_idx", "workflow_task_activity_idx", "workflow_task_reminder_idx",
    "workflow_template_active_idx", "workflow_task_link_idx", "workflow_task_link_uq",
    "workflow_task_attach_idx", "workflow_ops_type_time_idx", "workflow_ops_shop_time_idx",
    "workflow_ops_updated_idx", "workflow_ops_activity_idx", "workflow_attach_cleanup_idx",
}
WORKFLOW_WRITER_TABLE_PRIVILEGES = {
    "workflow_data_revisions": ("SELECT", "UPDATE"),
    "workflow_write_authority": ("SELECT",),
    "workflow_operations_write_authority": ("SELECT",),
    "workflow_write_request_receipts": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "workflow_new_product_projects": ("SELECT", "INSERT", "UPDATE"),
    "workflow_new_product_targets": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "workflow_new_product_stages": ("SELECT", "INSERT", "UPDATE"),
    "workflow_new_product_activities": ("SELECT", "INSERT"),
    "workflow_new_product_lines": ("SELECT", "INSERT", "UPDATE"),
    "workflow_new_product_line_codes": ("SELECT", "INSERT", "UPDATE"),
    "workflow_new_product_weekly_report_config": ("SELECT", "UPDATE"),
    "workflow_new_product_weekly_deliveries": ("SELECT", "INSERT", "UPDATE"),
    "workflow_tasks": ("SELECT", "INSERT", "UPDATE"),
    "workflow_task_comments": ("SELECT", "INSERT"),
    "workflow_task_activity_logs": ("SELECT", "INSERT"),
    "workflow_task_reminders": ("SELECT", "INSERT", "UPDATE"),
    "workflow_task_templates": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "workflow_task_entity_links": ("SELECT", "INSERT", "DELETE"),
    "workflow_task_attachments": ("SELECT", "INSERT", "DELETE"),
    "workflow_attachment_cleanup_queue": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "workflow_operation_records": ("SELECT", "INSERT", "UPDATE"),
    "workflow_operation_activities": ("SELECT", "INSERT"),
    "sales_order_lines": ("SELECT",),
    "sales_import_batches": ("SELECT",),
    "erp_product_master": ("SELECT",),
}
REQUIRED_WRITER_COLUMNS = {
    "sales_order_lines": {
        "source_line_key",
        "last_import_batch_id",
        "business_date",
    },
    "sales_import_batches": {
        "id",
        "status",
        "content_hash",
        "scope_key",
        "published_state_token",
    },
    "sales_data_revisions": {"domain", "revision", "source_digest"},
    "sales_write_authority": {"id", "status", "authority_epoch", "cutover_id"},
    "sales_cutover_attestations": {
        "cutover_id",
        "d1_authority_epoch",
        "source_path_digest",
        "migration_apply_run_id",
        "migration_verify_run_id",
        "cleanup_manifest_id",
        "cleanup_manifest_sha256",
        "payload",
        "payload_sha256",
        "observed_at",
    },
    "sales_import_scope_heads": {
        "scope_key",
        "state_token",
        "status",
        "owner_token",
        "generation",
    },
    "sales_import_attempts": {"id", "scope_key", "outcome", "error_code"},
    "sales_import_fingerprints": {
        "domain",
        "batch_id",
        "scope_key",
        "content_hash",
    },
    "sales_raw_upload_sessions": {
        "id",
        "status",
        "owner_token",
        "owner_generation",
        "result_batch_id",
        "expires_at",
    },
    "sales_raw_upload_chunks": {
        "session_id", "chunk_index", "object_key", "sha256", "payload",
    },
    "sales_staged_import_sessions": {
        "id",
        "status",
        "owner_token",
        "raw_upload_owner_token",
        "raw_upload_owner_generation",
        "expires_at",
    },
    "sales_staged_import_chunks": {"session_id", "chunk_index", "content_hash"},
    "sales_write_request_receipts": {
        "request_id",
        "body_sha256",
        "claim_token",
        "status",
        "response_payload",
    },
    "erp_product_master": {"product_code"},
    "erp_reference_sync_checkpoint": {
        "source_epoch",
        "source_path_digest",
        "last_event_sequence",
        "last_event_id",
        "erp_revision",
        "content_hash",
        "row_count",
        "source_batch_id",
        "last_checked_at",
    },
}
WRITER_TABLE_PRIVILEGES = {
    "sales_order_lines": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "sales_import_batches": ("SELECT", "INSERT", "UPDATE"),
    "sales_data_revisions": ("SELECT", "INSERT", "UPDATE"),
    "sales_write_authority": ("SELECT",),
    "sales_cutover_attestations": ("SELECT",),
    "sales_import_scope_heads": ("SELECT", "INSERT", "UPDATE"),
    "sales_import_attempts": ("SELECT", "INSERT", "UPDATE"),
    "sales_import_fingerprints": ("SELECT", "INSERT"),
    "sales_raw_upload_sessions": ("SELECT", "INSERT", "UPDATE"),
    "sales_raw_upload_chunks": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "sales_staged_import_sessions": ("SELECT", "INSERT", "UPDATE"),
    "sales_staged_import_chunks": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "sales_write_request_receipts": ("SELECT", "INSERT", "UPDATE"),
    "erp_product_master": ("SELECT",),
    "erp_reference_sync_checkpoint": ("SELECT",),
}
WRITER_FORBIDDEN_PROTECTED_TABLE_PRIVILEGES = {
    "sales_write_authority": ("INSERT", "UPDATE", "DELETE", "TRUNCATE"),
    "erp_product_master": ("INSERT", "UPDATE", "DELETE", "TRUNCATE"),
    "erp_reference_sync_checkpoint": ("INSERT", "UPDATE", "DELETE", "TRUNCATE"),
    "sales_cutover_attestations": ("INSERT", "UPDATE", "DELETE", "TRUNCATE"),
    "sales_legacy_upload_audits": ("INSERT", "UPDATE", "DELETE", "TRUNCATE"),
}
WRITER_AUTO_ID_TABLES = (
    "sales_order_lines",
    "sales_import_fingerprints",
    "sales_raw_upload_chunks",
    "sales_staged_import_chunks",
)


class ReadinessError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _response(payload: dict[str, object], status: int = 200) -> JsonResponse:
    response = JsonResponse(payload, status=status)
    response["Cache-Control"] = "no-store"
    return response


def _column_names(cursor, table: str) -> set[str]:
    return {item.name for item in connection.introspection.get_table_description(cursor, table)}


def _validate_schema(cursor) -> None:
    tables = set(connection.introspection.table_names(cursor))
    for table, expected_columns in REQUIRED_COLUMNS.items():
        if table not in tables:
            raise ReadinessError("projection_schema_missing")
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError("projection_schema_incomplete")

    constraints = connection.introspection.get_constraints(cursor, "sales_order_lines")
    present_indexes = {name for name, value in constraints.items() if value.get("index")}
    if not REQUIRED_SALES_INDEXES.issubset(present_indexes):
        raise ReadinessError("projection_indexes_incomplete")


def _validate_writer_schema(cursor) -> None:
    tables = set(connection.introspection.table_names(cursor))
    for table, expected_columns in REQUIRED_WRITER_COLUMNS.items():
        if table not in tables:
            raise ReadinessError("sales_writer_schema_missing")
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError("sales_writer_schema_incomplete")


def _validate_finance_schema(cursor, *, writer: bool) -> None:
    tables = set(connection.introspection.table_names(cursor))
    expected = REQUIRED_FINANCE_WRITER_COLUMNS if writer else REQUIRED_FINANCE_COLUMNS
    for table, expected_columns in expected.items():
        if table not in tables:
            raise ReadinessError("finance_writer_schema_missing" if writer else "finance_reader_schema_missing")
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError("finance_writer_schema_incomplete" if writer else "finance_reader_schema_incomplete")
    constraints = connection.introspection.get_constraints(cursor, "finance_lines")
    present_indexes = {name for name, value in constraints.items() if value.get("index")}
    if not REQUIRED_FINANCE_INDEXES.issubset(present_indexes):
        raise ReadinessError("finance_projection_indexes_incomplete")
    if not writer and connection.vendor == "postgresql":
        cursor.execute(
            "SELECT 1 FROM pg_collation WHERE collname = %s",
            [REQUIRED_FINANCE_READER_COLLATION],
        )
        if cursor.fetchone() is None:
            raise ReadinessError("finance_reader_collation_missing")


def _validate_finance_revision(cursor) -> None:
    cursor.execute(
        "SELECT revision, source_digest FROM finance_data_revisions WHERE domain='finance'"
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) < 0 or not HEX_64.fullmatch(str(row[1] or "")):
        raise ReadinessError("finance_reader_revision_invalid")


def _validate_finance_writer_authority(cursor) -> None:
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id FROM finance_write_authority WHERE id = 1"
    )
    row = cursor.fetchone()
    if row is None or str(row[0]) != "postgres":
        raise ReadinessError("finance_writer_authority_inactive")
    try:
        epoch = str(uuid.UUID(str(row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("finance_writer_authority_invalid") from error
    if epoch != settings.FINANCE_WRITE_AUTHORITY_EPOCH or str(row[2]) != settings.FINANCE_WRITE_CUTOVER_ID:
        raise ReadinessError("finance_writer_authority_mismatch")


def _validate_finance_writer_permissions(cursor) -> None:
    if connection.vendor != "postgresql":
        if settings.DJANGO_ENVIRONMENT == "production":
            raise ReadinessError("finance_writer_database_not_postgresql")
        return
    cursor.execute("SHOW transaction_read_only")
    if cursor.fetchone()[0] != "off":
        raise ReadinessError("finance_writer_database_read_only")
    for table, privileges in FINANCE_WRITER_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute("SELECT has_table_privilege(current_user, %s, %s)", [table, privilege])
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("finance_writer_database_privilege_missing")
    for table in FINANCE_WRITER_FORBIDDEN_TABLES:
        for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
            cursor.execute("SELECT has_table_privilege(current_user, %s, %s)", [table, privilege])
            if cursor.fetchone()[0] is not False:
                raise ReadinessError("finance_writer_database_privilege_excessive")
    for table in FINANCE_WRITER_AUTO_ID_TABLES:
        cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", [table])
        sequence = cursor.fetchone()[0]
        if sequence:
            cursor.execute("SELECT has_sequence_privilege(current_user, %s, 'USAGE')", [sequence])
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("finance_writer_database_privilege_missing")


def _validate_netshop_schema(cursor, *, writer: bool) -> None:
    tables = set(connection.introspection.table_names(cursor))
    expected = REQUIRED_NETSHOP_WRITER_COLUMNS if writer else REQUIRED_NETSHOP_COLUMNS
    for table, expected_columns in expected.items():
        if table not in tables:
            raise ReadinessError("netshop_writer_schema_missing" if writer else "netshop_reader_schema_missing")
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError("netshop_writer_schema_incomplete" if writer else "netshop_reader_schema_incomplete")
    constraints = connection.introspection.get_constraints(cursor, "netshop_rows")
    present_indexes = {name for name, value in constraints.items() if value.get("index")}
    if not REQUIRED_NETSHOP_INDEXES.issubset(present_indexes):
        raise ReadinessError("netshop_projection_indexes_incomplete")


def _validate_netshop_revision(cursor) -> None:
    cursor.execute(
        "SELECT revision, source_digest FROM netshop_data_revisions WHERE domain='netshop'"
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) < 1 or not HEX_64.fullmatch(str(row[1] or "")):
        raise ReadinessError("netshop_reader_revision_invalid")


def _validate_netshop_writer_authority(cursor) -> None:
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id FROM netshop_write_authority WHERE id = 1"
    )
    row = cursor.fetchone()
    if row is None or str(row[0]) != "postgres":
        raise ReadinessError("netshop_writer_authority_inactive")
    try:
        epoch = str(uuid.UUID(str(row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("netshop_writer_authority_invalid") from error
    if epoch != settings.NETSHOP_WRITE_AUTHORITY_EPOCH or str(row[2]) != settings.NETSHOP_WRITE_CUTOVER_ID:
        raise ReadinessError("netshop_writer_authority_mismatch")


def _validate_netshop_relation_privilege_rows(
    rows, *, application_schema: str
) -> None:
    for row in rows:
        schema_name, table_name = str(row[0]), str(row[1])
        actual = {
            "INSERT": bool(row[2]) or bool(row[6]),
            "UPDATE": bool(row[3]) or bool(row[7]),
            "DELETE": bool(row[4]),
            "TRUNCATE": bool(row[5]),
        }
        allowed = (
            set(NETSHOP_WRITER_TABLE_PRIVILEGES.get(table_name, ()))
            if schema_name == application_schema
            else set()
        )
        if any(
            granted and privilege not in allowed
            for privilege, granted in actual.items()
        ):
            raise ReadinessError("netshop_writer_database_privilege_excessive")


def _validate_netshop_writer_permissions(cursor) -> None:
    if connection.vendor != "postgresql":
        if settings.DJANGO_ENVIRONMENT == "production":
            raise ReadinessError("netshop_writer_database_not_postgresql")
        return
    cursor.execute("SHOW transaction_read_only")
    if cursor.fetchone()[0] != "off":
        raise ReadinessError("netshop_writer_database_read_only")
    cursor.execute("SELECT current_schema()")
    application_schema = str(cursor.fetchone()[0])
    cursor.execute(
        "SELECT has_schema_privilege(current_user, current_schema(), 'CREATE'), "
        "has_database_privilege(current_user, current_database(), 'CREATE')"
    )
    ddl_privileges = cursor.fetchone()
    if bool(ddl_privileges[0]) or bool(ddl_privileges[1]):
        raise ReadinessError("netshop_writer_database_privilege_excessive")
    for table, privileges in NETSHOP_WRITER_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute("SELECT has_table_privilege(current_user, %s, %s)", [table, privilege])
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("netshop_writer_database_privilege_missing")
    cursor.execute(
        "SELECT n.nspname,c.relname,"
        "has_table_privilege(current_user,c.oid,'INSERT'),"
        "has_table_privilege(current_user,c.oid,'UPDATE'),"
        "has_table_privilege(current_user,c.oid,'DELETE'),"
        "has_table_privilege(current_user,c.oid,'TRUNCATE'),"
        "has_any_column_privilege(current_user,c.oid,'INSERT'),"
        "has_any_column_privilege(current_user,c.oid,'UPDATE') "
        "FROM pg_catalog.pg_class c "
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
        "WHERE c.relkind IN ('r','p','v','m','f') "
        "AND n.nspname <> 'information_schema' "
        "AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'"
    )
    _validate_netshop_relation_privilege_rows(
        cursor.fetchall(), application_schema=application_schema
    )
    for table in NETSHOP_WRITER_AUTO_ID_TABLES:
        cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", [table])
        sequence = cursor.fetchone()[0]
        if sequence:
            cursor.execute("SELECT has_sequence_privilege(current_user, %s, 'USAGE')", [sequence])
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("netshop_writer_database_privilege_missing")


def _validate_market_schema(cursor, *, writer: bool) -> None:
    tables = set(connection.introspection.table_names(cursor))
    expected = REQUIRED_MARKET_WRITER_COLUMNS if writer else REQUIRED_MARKET_COLUMNS
    for table, expected_columns in expected.items():
        if table not in tables:
            raise ReadinessError(
                "market_writer_schema_missing" if writer else "market_reader_schema_missing"
            )
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError(
                "market_writer_schema_incomplete" if writer else "market_reader_schema_incomplete"
            )
    constraints = connection.introspection.get_constraints(
        cursor, "market_ranking_entries"
    )
    present_indexes = {
        name for name, value in constraints.items() if value.get("index")
    }
    if not REQUIRED_MARKET_INDEXES.issubset(present_indexes):
        raise ReadinessError("market_projection_indexes_incomplete")


def _validate_market_revision(cursor) -> None:
    cursor.execute(
        "SELECT revision, source_digest FROM market_data_revisions WHERE domain='market'"
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) < 1 or not HEX_64.fullmatch(str(row[1] or "")):
        raise ReadinessError("market_reader_revision_invalid")


def _validate_market_writer_authority(cursor) -> None:
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id "
        "FROM market_write_authority WHERE id = 1"
    )
    row = cursor.fetchone()
    if row is None or str(row[0]) != "postgres":
        raise ReadinessError("market_writer_authority_inactive")
    try:
        epoch = str(uuid.UUID(str(row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("market_writer_authority_invalid") from error
    if (
        epoch != settings.MARKET_WRITE_AUTHORITY_EPOCH
        or str(row[2]) != settings.MARKET_WRITE_CUTOVER_ID
    ):
        raise ReadinessError("market_writer_authority_mismatch")


def _validate_market_writer_permissions(cursor) -> None:
    if connection.vendor != "postgresql":
        if settings.DJANGO_ENVIRONMENT == "production":
            raise ReadinessError("market_writer_database_not_postgresql")
        return
    cursor.execute("SHOW transaction_read_only")
    if cursor.fetchone()[0] != "off":
        raise ReadinessError("market_writer_database_read_only")
    cursor.execute("SELECT current_schema()")
    application_schema = str(cursor.fetchone()[0])
    cursor.execute(
        "SELECT has_schema_privilege(current_user, current_schema(), 'CREATE'), "
        "has_database_privilege(current_user, current_database(), 'CREATE')"
    )
    ddl_privileges = cursor.fetchone()
    if bool(ddl_privileges[0]) or bool(ddl_privileges[1]):
        raise ReadinessError("market_writer_database_privilege_excessive")
    for table, privileges in MARKET_WRITER_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute(
                "SELECT has_table_privilege(current_user, %s, %s)",
                [table, privilege],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("market_writer_database_privilege_missing")
    cursor.execute(
        "SELECT n.nspname,c.relname,"
        "has_table_privilege(current_user,c.oid,'INSERT'),"
        "has_table_privilege(current_user,c.oid,'UPDATE'),"
        "has_table_privilege(current_user,c.oid,'DELETE'),"
        "has_table_privilege(current_user,c.oid,'TRUNCATE'),"
        "has_any_column_privilege(current_user,c.oid,'INSERT'),"
        "has_any_column_privilege(current_user,c.oid,'UPDATE') "
        "FROM pg_catalog.pg_class c "
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
        "WHERE c.relkind IN ('r','p','v','m','f') "
        "AND n.nspname <> 'information_schema' "
        "AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'"
    )
    for row in cursor.fetchall():
        schema_name, table_name = str(row[0]), str(row[1])
        actual = {
            "INSERT": bool(row[2]) or bool(row[6]),
            "UPDATE": bool(row[3]) or bool(row[7]),
            "DELETE": bool(row[4]),
            "TRUNCATE": bool(row[5]),
        }
        allowed = (
            set(MARKET_WRITER_TABLE_PRIVILEGES.get(table_name, ()))
            if schema_name == application_schema
            else set()
        )
        if any(
            granted and privilege not in allowed
            for privilege, granted in actual.items()
        ):
            raise ReadinessError("market_writer_database_privilege_excessive")
    for table in MARKET_WRITER_AUTO_ID_TABLES:
        cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", [table])
        sequence = cursor.fetchone()[0]
        if sequence:
            cursor.execute(
                "SELECT has_sequence_privilege(current_user, %s, 'USAGE')",
                [sequence],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("market_writer_database_privilege_missing")


def _validate_products_schema(cursor, *, writer: bool) -> None:
    tables = set(connection.introspection.table_names(cursor))
    expected = REQUIRED_PRODUCTS_WRITER_COLUMNS if writer else REQUIRED_PRODUCTS_COLUMNS
    for table, expected_columns in expected.items():
        if table not in tables:
            raise ReadinessError(
                "products_writer_schema_missing" if writer else "products_reader_schema_missing"
            )
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError(
                "products_writer_schema_incomplete" if writer else "products_reader_schema_incomplete"
            )
    indexed_tables = (
        "product_shipping_rate_import_batches",
        "product_import_attempts",
        "product_inventory_projection",
        "product_raw_upload_sessions",
        "product_raw_upload_chunks",
    )
    present_indexes: set[str] = set()
    for table in indexed_tables:
        if table in tables:
            constraints = connection.introspection.get_constraints(cursor, table)
            present_indexes.update(
                name for name, value in constraints.items() if value.get("index")
            )
    required_indexes = (
        REQUIRED_PRODUCTS_WRITER_INDEXES if writer else REQUIRED_PRODUCTS_READER_INDEXES
    )
    if not required_indexes.issubset(present_indexes):
        raise ReadinessError("products_projection_indexes_incomplete")


def _validate_products_revision(cursor) -> None:
    cursor.execute(
        "SELECT revision, source_digest FROM product_data_revisions WHERE domain='products'"
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) < 1 or not HEX_64.fullmatch(str(row[1] or "")):
        raise ReadinessError("products_reader_revision_invalid")


def _validate_products_writer_authority(cursor) -> None:
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id "
        "FROM product_write_authority WHERE id = 1"
    )
    row = cursor.fetchone()
    if row is None or str(row[0]) != "postgres":
        raise ReadinessError("products_writer_authority_inactive")
    try:
        epoch = str(uuid.UUID(str(row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("products_writer_authority_invalid") from error
    if (
        epoch != settings.PRODUCTS_WRITE_AUTHORITY_EPOCH
        or str(row[2]) != settings.PRODUCTS_WRITE_CUTOVER_ID
    ):
        raise ReadinessError("products_writer_authority_mismatch")


def _validate_products_writer_permissions(cursor) -> None:
    if connection.vendor != "postgresql":
        if settings.DJANGO_ENVIRONMENT == "production":
            raise ReadinessError("products_writer_database_not_postgresql")
        return
    cursor.execute("SHOW transaction_read_only")
    if cursor.fetchone()[0] != "off":
        raise ReadinessError("products_writer_database_read_only")
    cursor.execute("SELECT current_schema()")
    application_schema = str(cursor.fetchone()[0])
    cursor.execute(
        "SELECT has_schema_privilege(current_user, current_schema(), 'CREATE'), "
        "has_database_privilege(current_user, current_database(), 'CREATE')"
    )
    ddl_privileges = cursor.fetchone()
    if bool(ddl_privileges[0]) or bool(ddl_privileges[1]):
        raise ReadinessError("products_writer_database_privilege_excessive")
    for table, privileges in PRODUCTS_WRITER_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute(
                "SELECT has_table_privilege(current_user, %s, %s)",
                [table, privilege],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("products_writer_database_privilege_missing")
    cursor.execute(
        "SELECT n.nspname,c.relname,"
        "has_table_privilege(current_user,c.oid,'INSERT'),"
        "has_table_privilege(current_user,c.oid,'UPDATE'),"
        "has_table_privilege(current_user,c.oid,'DELETE'),"
        "has_table_privilege(current_user,c.oid,'TRUNCATE'),"
        "has_any_column_privilege(current_user,c.oid,'INSERT'),"
        "has_any_column_privilege(current_user,c.oid,'UPDATE') "
        "FROM pg_catalog.pg_class c "
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
        "WHERE c.relkind IN ('r','p','v','m','f') "
        "AND n.nspname <> 'information_schema' "
        "AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'"
    )
    for row in cursor.fetchall():
        schema_name, table_name = str(row[0]), str(row[1])
        actual = {
            "INSERT": bool(row[2]) or bool(row[6]),
            "UPDATE": bool(row[3]) or bool(row[7]),
            "DELETE": bool(row[4]),
            "TRUNCATE": bool(row[5]),
        }
        allowed = (
            set(PRODUCTS_WRITER_TABLE_PRIVILEGES.get(table_name, ()))
            if schema_name == application_schema
            else set()
        )
        if any(
            granted and privilege not in allowed
            for privilege, granted in actual.items()
        ):
            raise ReadinessError("products_writer_database_privilege_excessive")
    for table in PRODUCTS_WRITER_AUTO_ID_TABLES:
        cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", [table])
        sequence = cursor.fetchone()[0]
        if sequence:
            cursor.execute(
                "SELECT has_sequence_privilege(current_user, %s, 'USAGE')",
                [sequence],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("products_writer_database_privilege_missing")


def _validate_inventory_schema(cursor, *, writer: bool) -> None:
    tables = set(connection.introspection.table_names(cursor))
    expected = REQUIRED_INVENTORY_WRITER_COLUMNS if writer else REQUIRED_INVENTORY_COLUMNS
    for table, expected_columns in expected.items():
        if table not in tables:
            raise ReadinessError(
                "inventory_writer_schema_missing" if writer else "inventory_reader_schema_missing"
            )
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError(
                "inventory_writer_schema_incomplete" if writer else "inventory_reader_schema_incomplete"
            )
    indexed_tables = (
        "inventory_import_batches", "inventory_stock_lines", "inventory_age_lines",
        "inventory_import_attempts", "inventory_raw_upload_sessions",
        "inventory_raw_upload_chunks", "replenishment_plan_items",
        "inventory_replenishment_group_deliveries",
    )
    present_indexes: set[str] = set()
    for table in indexed_tables:
        if table in tables:
            constraints = connection.introspection.get_constraints(cursor, table)
            present_indexes.update(
                name for name, value in constraints.items() if value.get("index")
            )
    required_indexes = (
        REQUIRED_INVENTORY_WRITER_INDEXES
        if writer
        else REQUIRED_INVENTORY_READER_INDEXES
    )
    if not required_indexes.issubset(present_indexes):
        raise ReadinessError("inventory_indexes_incomplete")


def _validate_inventory_revision(cursor) -> None:
    cursor.execute(
        "SELECT revision, source_digest FROM inventory_data_revisions "
        "WHERE domain='inventory'"
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) < 1 or not HEX_64.fullmatch(str(row[1] or "")):
        raise ReadinessError("inventory_reader_revision_invalid")


def _validate_inventory_writer_authority(cursor) -> None:
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id, migration_verify_run_id "
        "FROM inventory_write_authority WHERE id = 1"
    )
    row = cursor.fetchone()
    if row is None or str(row[0]) != "postgres":
        raise ReadinessError("inventory_writer_authority_inactive")
    try:
        epoch = str(uuid.UUID(str(row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("inventory_writer_authority_invalid") from error
    if (
        epoch != settings.INVENTORY_WRITE_AUTHORITY_EPOCH
        or str(row[2]) != settings.INVENTORY_WRITE_CUTOVER_ID
        or not re.fullmatch(r"inventory-apply-[0-9a-f]{32}", str(row[3] or ""))
    ):
        raise ReadinessError("inventory_writer_authority_mismatch")


def _validate_inventory_writer_permissions(cursor) -> None:
    if connection.vendor != "postgresql":
        if settings.DJANGO_ENVIRONMENT == "production":
            raise ReadinessError("inventory_writer_database_not_postgresql")
        return
    cursor.execute("SHOW transaction_read_only")
    if cursor.fetchone()[0] != "off":
        raise ReadinessError("inventory_writer_database_read_only")
    cursor.execute("SELECT current_schema()")
    application_schema = str(cursor.fetchone()[0])
    cursor.execute(
        "SELECT has_schema_privilege(current_user, current_schema(), 'CREATE'), "
        "has_database_privilege(current_user, current_database(), 'CREATE')"
    )
    if any(bool(value) for value in cursor.fetchone()):
        raise ReadinessError("inventory_writer_database_privilege_excessive")
    for table, privileges in INVENTORY_WRITER_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute(
                "SELECT has_table_privilege(current_user, %s, %s)",
                [table, privilege],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("inventory_writer_database_privilege_missing")
    cursor.execute(
        "SELECT n.nspname,c.relname,"
        "has_table_privilege(current_user,c.oid,'INSERT'),"
        "has_table_privilege(current_user,c.oid,'UPDATE'),"
        "has_table_privilege(current_user,c.oid,'DELETE'),"
        "has_table_privilege(current_user,c.oid,'TRUNCATE'),"
        "has_any_column_privilege(current_user,c.oid,'INSERT'),"
        "has_any_column_privilege(current_user,c.oid,'UPDATE') "
        "FROM pg_catalog.pg_class c "
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
        "WHERE c.relkind IN ('r','p','v','m','f') "
        "AND n.nspname <> 'information_schema' "
        "AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'"
    )
    for row in cursor.fetchall():
        schema_name, table_name = str(row[0]), str(row[1])
        actual = {
            "INSERT": bool(row[2]) or bool(row[6]),
            "UPDATE": bool(row[3]) or bool(row[7]),
            "DELETE": bool(row[4]),
            "TRUNCATE": bool(row[5]),
        }
        allowed = (
            set(INVENTORY_WRITER_TABLE_PRIVILEGES.get(table_name, ()))
            if schema_name == application_schema
            else set()
        )
        if any(granted and privilege not in allowed for privilege, granted in actual.items()):
            raise ReadinessError("inventory_writer_database_privilege_excessive")
    for table in INVENTORY_WRITER_AUTO_ID_TABLES:
        cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", [table])
        sequence = cursor.fetchone()[0]
        if sequence:
            cursor.execute(
                "SELECT has_sequence_privilege(current_user, %s, 'USAGE')",
                [sequence],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("inventory_writer_database_privilege_missing")


def _validate_workflow_schema(cursor, *, writer: bool) -> None:
    tables = set(connection.introspection.table_names(cursor))
    expected = REQUIRED_WORKFLOW_WRITER_COLUMNS if writer else REQUIRED_WORKFLOW_COLUMNS
    for table, expected_columns in expected.items():
        if table not in tables:
            raise ReadinessError(
                "workflow_writer_schema_missing" if writer else "workflow_reader_schema_missing"
            )
        if not expected_columns.issubset(_column_names(cursor, table)):
            raise ReadinessError(
                "workflow_writer_schema_incomplete" if writer else "workflow_reader_schema_incomplete"
            )
    present_indexes: set[str] = set()
    for table in (
        "workflow_new_product_projects", "workflow_new_product_targets",
        "workflow_new_product_stages", "workflow_new_product_activities",
        "workflow_new_product_lines", "workflow_new_product_line_codes",
        "workflow_new_product_weekly_deliveries",
        "workflow_tasks", "workflow_task_comments", "workflow_task_activity_logs",
        "workflow_task_reminders", "workflow_task_templates", "workflow_task_entity_links",
        "workflow_task_attachments", "workflow_attachment_cleanup_queue",
        "workflow_operation_records", "workflow_operation_activities",
    ):
        constraints = connection.introspection.get_constraints(cursor, table)
        present_indexes.update(
            name for name, value in constraints.items()
            if value.get("index") or value.get("unique")
        )
    if not REQUIRED_WORKFLOW_INDEXES.issubset(present_indexes):
        raise ReadinessError("workflow_indexes_incomplete")


def _validate_workflow_revision(cursor) -> None:
    cursor.execute(
        "SELECT revision, source_digest FROM workflow_data_revisions WHERE domain='workflow'"
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) < 1 or not HEX_64.fullmatch(str(row[1] or "")):
        raise ReadinessError("workflow_reader_revision_invalid")


def _validate_workflow_writer_authority(cursor) -> None:
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id, migration_verify_run_id "
        "FROM workflow_write_authority WHERE id=1"
    )
    row = cursor.fetchone()
    if row is None or str(row[0]) != "postgres":
        raise ReadinessError("workflow_writer_authority_inactive")
    try:
        epoch = str(uuid.UUID(str(row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("workflow_writer_authority_invalid") from error
    if (
        epoch != settings.WORKFLOW_WRITE_AUTHORITY_EPOCH
        or str(row[2]) != settings.WORKFLOW_WRITE_CUTOVER_ID
        or not re.fullmatch(r"workflow-[0-9a-f]{32}", str(row[3] or ""))
    ):
        raise ReadinessError("workflow_writer_authority_mismatch")
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id, migration_verify_run_id "
        "FROM workflow_operations_write_authority WHERE id=1"
    )
    operations_row = cursor.fetchone()
    if operations_row is None or str(operations_row[0]) != "postgres":
        raise ReadinessError("workflow_operations_writer_authority_inactive")
    try:
        operations_epoch = str(uuid.UUID(str(operations_row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("workflow_operations_writer_authority_invalid") from error
    if (
        operations_epoch != settings.WORKFLOW_OPERATIONS_WRITE_AUTHORITY_EPOCH
        or str(operations_row[2]) != settings.WORKFLOW_OPERATIONS_WRITE_CUTOVER_ID
        or not re.fullmatch(r"workflow-ops-[0-9a-f]{32}", str(operations_row[3] or ""))
    ):
        raise ReadinessError("workflow_operations_writer_authority_mismatch")


def _validate_workflow_writer_permissions(cursor) -> None:
    if connection.vendor != "postgresql":
        if settings.DJANGO_ENVIRONMENT == "production":
            raise ReadinessError("workflow_writer_database_not_postgresql")
        return
    cursor.execute("SHOW transaction_read_only")
    if cursor.fetchone()[0] != "off":
        raise ReadinessError("workflow_writer_database_read_only")
    cursor.execute("SELECT current_schema()")
    application_schema = str(cursor.fetchone()[0])
    cursor.execute(
        "SELECT has_schema_privilege(current_user, current_schema(), 'CREATE'), "
        "has_database_privilege(current_user, current_database(), 'CREATE')"
    )
    if any(bool(value) for value in cursor.fetchone()):
        raise ReadinessError("workflow_writer_database_privilege_excessive")
    for table, privileges in WORKFLOW_WRITER_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute(
                "SELECT has_table_privilege(current_user, %s, %s)", [table, privilege]
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("workflow_writer_database_privilege_missing")
    cursor.execute(
        "SELECT n.nspname,c.relname,"
        "has_table_privilege(current_user,c.oid,'INSERT'),"
        "has_table_privilege(current_user,c.oid,'UPDATE'),"
        "has_table_privilege(current_user,c.oid,'DELETE'),"
        "has_table_privilege(current_user,c.oid,'TRUNCATE'),"
        "has_any_column_privilege(current_user,c.oid,'INSERT'),"
        "has_any_column_privilege(current_user,c.oid,'UPDATE') "
        "FROM pg_catalog.pg_class c "
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
        "WHERE c.relkind IN ('r','p','v','m','f') "
        "AND n.nspname <> 'information_schema' "
        "AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'"
    )
    for row in cursor.fetchall():
        schema_name, table_name = str(row[0]), str(row[1])
        actual = {
            "INSERT": bool(row[2]) or bool(row[6]),
            "UPDATE": bool(row[3]) or bool(row[7]),
            "DELETE": bool(row[4]),
            "TRUNCATE": bool(row[5]),
        }
        allowed = (
            set(WORKFLOW_WRITER_TABLE_PRIVILEGES.get(table_name, ()))
            if schema_name == application_schema
            else set()
        )
        if any(granted and privilege not in allowed for privilege, granted in actual.items()):
            raise ReadinessError("workflow_writer_database_privilege_excessive")


def _validate_writer_authority(cursor) -> str:
    cursor.execute(
        "SELECT status, authority_epoch, cutover_id "
        "FROM sales_write_authority WHERE id = 1"
    )
    row = cursor.fetchone()
    if row is None or str(row[0]) != "active":
        raise ReadinessError("sales_writer_authority_inactive")
    try:
        epoch = str(uuid.UUID(str(row[1])))
    except (ValueError, TypeError, AttributeError) as error:
        raise ReadinessError("sales_writer_authority_invalid") from error
    if (
        epoch != settings.SALES_WRITE_AUTHORITY_EPOCH
        or str(row[2]) != settings.SALES_WRITE_CUTOVER_ID
    ):
        raise ReadinessError("sales_writer_authority_mismatch")
    return str(row[2])


def _validate_writer_permissions(cursor) -> None:
    if connection.vendor != "postgresql":
        if settings.DJANGO_ENVIRONMENT == "production":
            raise ReadinessError("sales_writer_database_not_postgresql")
        return
    cursor.execute("SHOW transaction_read_only")
    if cursor.fetchone()[0] != "off":
        raise ReadinessError("sales_writer_database_read_only")
    for table, privileges in WRITER_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute(
                "SELECT has_table_privilege(current_user, %s, %s)",
                [table, privilege],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("sales_writer_database_privilege_missing")
    for table, privileges in WRITER_FORBIDDEN_PROTECTED_TABLE_PRIVILEGES.items():
        for privilege in privileges:
            cursor.execute(
                "SELECT has_table_privilege(current_user, %s, %s)",
                [table, privilege],
            )
            if cursor.fetchone()[0] is not False:
                raise ReadinessError("sales_writer_database_privilege_excessive")
            if privilege in {"INSERT", "UPDATE"}:
                cursor.execute(
                    "SELECT has_any_column_privilege(current_user, %s, %s)",
                    [table, privilege],
                )
                if cursor.fetchone()[0] is not False:
                    raise ReadinessError("sales_writer_database_privilege_excessive")
    for table in WRITER_AUTO_ID_TABLES:
        cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", [table])
        sequence = cursor.fetchone()[0]
        if sequence:
            cursor.execute(
                "SELECT has_sequence_privilege(current_user, %s, 'USAGE')",
                [sequence],
            )
            if cursor.fetchone()[0] is not True:
                raise ReadinessError("sales_writer_database_privilege_missing")


def _validate_reader_state(cursor) -> None:
    try:
        validate_erp_reference_runtime_state(cursor)
    except WriterRuntimeGuardError as error:
        raise ReadinessError(error.code) from error
    cursor.execute(
        "SELECT revision, source_digest FROM sales_data_revisions WHERE domain='sales'"
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) < 1 or not HEX_64.fullmatch(str(row[1] or "")):
        raise ReadinessError("sales_reader_revision_invalid")


@require_GET
def live(_request):
    return _response({"status": "ok", "service": "teruisi-django"})


@require_GET
def ready(_request):
    writer_process = settings.DJANGO_PROCESS_ROLE == "sales_writer"
    finance_writer_process = settings.DJANGO_PROCESS_ROLE == "finance_writer"
    finance_reader_process = settings.DJANGO_PROCESS_ROLE == "finance_reader"
    netshop_writer_process = settings.DJANGO_PROCESS_ROLE == "netshop_writer"
    netshop_reader_process = settings.DJANGO_PROCESS_ROLE == "netshop_reader"
    market_writer_process = settings.DJANGO_PROCESS_ROLE == "market_writer"
    market_reader_process = settings.DJANGO_PROCESS_ROLE == "market_reader"
    products_writer_process = settings.DJANGO_PROCESS_ROLE == "products_writer"
    products_reader_process = settings.DJANGO_PROCESS_ROLE == "products_reader"
    inventory_writer_process = settings.DJANGO_PROCESS_ROLE == "inventory_writer"
    inventory_reader_process = settings.DJANGO_PROCESS_ROLE == "inventory_reader"
    workflow_writer_process = settings.DJANGO_PROCESS_ROLE == "workflow_writer"
    workflow_reader_process = settings.DJANGO_PROCESS_ROLE == "workflow_reader"
    try:
        with connection.cursor() as cursor:
            if workflow_writer_process:
                _validate_workflow_schema(cursor, writer=True)
                _validate_workflow_revision(cursor)
                _validate_workflow_writer_authority(cursor)
                _validate_workflow_writer_permissions(cursor)
            elif workflow_reader_process:
                _validate_workflow_schema(cursor, writer=False)
                _validate_workflow_revision(cursor)
                if settings.DJANGO_EXPECT_READ_ONLY:
                    if connection.vendor != "postgresql":
                        raise ReadinessError("database_role_not_read_only")
                    cursor.execute("SHOW transaction_read_only")
                    if cursor.fetchone()[0] != "on":
                        raise ReadinessError("database_role_not_read_only")
            elif inventory_writer_process:
                _validate_inventory_schema(cursor, writer=True)
                _validate_inventory_revision(cursor)
                _validate_inventory_writer_authority(cursor)
                _validate_reader_state(cursor)
                _validate_inventory_writer_permissions(cursor)
            elif inventory_reader_process:
                _validate_inventory_schema(cursor, writer=False)
                _validate_inventory_revision(cursor)
                _validate_reader_state(cursor)
                if settings.DJANGO_EXPECT_READ_ONLY:
                    if connection.vendor != "postgresql":
                        raise ReadinessError("database_role_not_read_only")
                    cursor.execute("SHOW transaction_read_only")
                    if cursor.fetchone()[0] != "on":
                        raise ReadinessError("database_role_not_read_only")
            elif products_writer_process:
                _validate_products_schema(cursor, writer=True)
                _validate_products_revision(cursor)
                _validate_products_writer_authority(cursor)
                _validate_products_writer_permissions(cursor)
            elif products_reader_process:
                _validate_products_schema(cursor, writer=False)
                _validate_products_revision(cursor)
                _validate_reader_state(cursor)
                if settings.DJANGO_EXPECT_READ_ONLY:
                    if connection.vendor != "postgresql":
                        raise ReadinessError("database_role_not_read_only")
                    cursor.execute("SHOW transaction_read_only")
                    if cursor.fetchone()[0] != "on":
                        raise ReadinessError("database_role_not_read_only")
            elif market_writer_process:
                _validate_market_schema(cursor, writer=True)
                _validate_market_revision(cursor)
                _validate_market_writer_authority(cursor)
                _validate_market_writer_permissions(cursor)
            elif market_reader_process:
                _validate_market_schema(cursor, writer=False)
                _validate_market_revision(cursor)
                if settings.DJANGO_EXPECT_READ_ONLY:
                    if connection.vendor != "postgresql":
                        raise ReadinessError("database_role_not_read_only")
                    cursor.execute("SHOW transaction_read_only")
                    if cursor.fetchone()[0] != "on":
                        raise ReadinessError("database_role_not_read_only")
            elif netshop_writer_process:
                _validate_netshop_schema(cursor, writer=True)
                _validate_netshop_revision(cursor)
                _validate_netshop_writer_authority(cursor)
                _validate_netshop_writer_permissions(cursor)
            elif netshop_reader_process:
                _validate_netshop_schema(cursor, writer=False)
                _validate_netshop_revision(cursor)
                if settings.DJANGO_EXPECT_READ_ONLY:
                    if connection.vendor != "postgresql":
                        raise ReadinessError("database_role_not_read_only")
                    cursor.execute("SHOW transaction_read_only")
                    if cursor.fetchone()[0] != "on":
                        raise ReadinessError("database_role_not_read_only")
            elif finance_writer_process:
                _validate_finance_schema(cursor, writer=True)
                _validate_finance_revision(cursor)
                _validate_finance_writer_authority(cursor)
                _validate_finance_writer_permissions(cursor)
            elif finance_reader_process:
                _validate_finance_schema(cursor, writer=False)
                _validate_finance_revision(cursor)
                if settings.DJANGO_EXPECT_READ_ONLY:
                    if connection.vendor != "postgresql":
                        raise ReadinessError("database_role_not_read_only")
                    cursor.execute("SHOW transaction_read_only")
                    if cursor.fetchone()[0] != "on":
                        raise ReadinessError("database_role_not_read_only")
            elif writer_process:
                _validate_writer_schema(cursor)
                cutover_id = _validate_writer_authority(cursor)
                _validate_writer_permissions(cursor)
                # Sales imports resolve ERP categories in the same transaction. A
                # writer must therefore fail closed when the independently owned
                # D1 -> PostgreSQL ERP bridge is stopped, stale, or divergent.
                # This deliberately reuses the reader's exact checkpoint/revision/
                # digest/row-count contract without requiring a read-only database
                # connection for the writer process.
                try:
                    validate_writer_runtime_state(cutover_id=cutover_id, cursor=cursor)
                except WriterRuntimeGuardError as error:
                    raise ReadinessError(error.code) from error
            else:
                _validate_schema(cursor)
                _validate_reader_state(cursor)
                if settings.DJANGO_EXPECT_READ_ONLY:
                    if connection.vendor != "postgresql":
                        raise ReadinessError("database_role_not_read_only")
                    cursor.execute("SHOW transaction_read_only")
                    if cursor.fetchone()[0] != "on":
                        raise ReadinessError("database_role_not_read_only")
    except ReadinessError as error:
        logger.warning("readiness_failed code=%s", error.code)
        return _response(
            {
                "status": "not_ready",
                "service": "teruisi-django",
                "code": (
                    "workflow_writer_unavailable"
                    if workflow_writer_process
                    else "workflow_reader_unavailable"
                    if workflow_reader_process
                    else "inventory_writer_unavailable"
                    if inventory_writer_process
                    else "inventory_reader_unavailable"
                    if inventory_reader_process
                    else "products_writer_unavailable"
                    if products_writer_process
                    else "products_reader_unavailable"
                    if products_reader_process
                    else "market_writer_unavailable"
                    if market_writer_process
                    else "market_reader_unavailable"
                    if market_reader_process
                    else "finance_writer_unavailable"
                    if finance_writer_process
                    else "finance_reader_unavailable"
                    if finance_reader_process
                    else "netshop_writer_unavailable"
                    if netshop_writer_process
                    else "netshop_reader_unavailable"
                    if netshop_reader_process
                    else "sales_writer_unavailable"
                    if writer_process
                    else "sales_reader_unavailable"
                ),
            },
            status=503,
        )
    except Exception as error:  # Database/driver details must stay out of HTTP.
        logger.exception(
            "readiness_failed code=sales_reader_probe_error type=%s",
            type(error).__name__,
        )
        return _response(
            {
                "status": "not_ready",
                "service": "teruisi-django",
                "code": (
                    "workflow_writer_unavailable"
                    if workflow_writer_process
                    else "workflow_reader_unavailable"
                    if workflow_reader_process
                    else "inventory_writer_unavailable"
                    if inventory_writer_process
                    else "inventory_reader_unavailable"
                    if inventory_reader_process
                    else "products_writer_unavailable"
                    if products_writer_process
                    else "products_reader_unavailable"
                    if products_reader_process
                    else "market_writer_unavailable"
                    if market_writer_process
                    else "market_reader_unavailable"
                    if market_reader_process
                    else "finance_writer_unavailable"
                    if finance_writer_process
                    else "finance_reader_unavailable"
                    if finance_reader_process
                    else "netshop_writer_unavailable"
                    if netshop_writer_process
                    else "netshop_reader_unavailable"
                    if netshop_reader_process
                    else "sales_writer_unavailable"
                    if writer_process
                    else "sales_reader_unavailable"
                ),
            },
            status=503,
        )
    payload = {
        "status": "ready",
        "service": "teruisi-django",
        "database": "ready",
    }
    if workflow_writer_process:
        payload["workflowWriter"] = "ready"
    elif workflow_reader_process:
        payload["workflowReader"] = "ready"
    elif inventory_writer_process:
        payload["inventoryWriter"] = "ready"
    elif inventory_reader_process:
        payload["inventoryReader"] = "ready"
    elif products_writer_process:
        payload["productsWriter"] = "ready"
    elif products_reader_process:
        payload["productsReader"] = "ready"
    elif market_writer_process:
        payload["marketWriter"] = "ready"
    elif market_reader_process:
        payload["marketReader"] = "ready"
    elif netshop_writer_process:
        payload["netshopWriter"] = "ready"
    elif netshop_reader_process:
        payload["netshopReader"] = "ready"
    elif finance_writer_process:
        payload["financeWriter"] = "ready"
    elif finance_reader_process:
        payload["financeReader"] = "ready"
    else:
        payload["writer" if writer_process else "reader"] = "ready"
    return _response(payload)
