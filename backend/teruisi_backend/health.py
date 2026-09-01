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
        if any(granted and privilege not in allowed for privilege, granted in actual.items()):
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
    try:
        with connection.cursor() as cursor:
            if netshop_writer_process:
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
                    "finance_writer_unavailable"
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
                    "finance_writer_unavailable"
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
    if netshop_writer_process:
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
