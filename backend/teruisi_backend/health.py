"""Liveness and fail-closed readiness probes for the local Django service."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone as datetime_timezone

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET


logger = logging.getLogger(__name__)
HEX_32 = re.compile(r"^[0-9a-f]{32}$")
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
    "sales_projection_sync_checkpoint": {
        "id",
        "source_epoch",
        "source_path_digest",
        "last_event_sequence",
        "last_event_id",
        "sales_revision",
        "erp_revision",
        "created_at",
        "updated_at",
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


def _parse_checked_at(value: object) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ReadinessError("projection_checkpoint_invalid") from error
    else:
        raise ReadinessError("projection_checkpoint_invalid")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime_timezone.utc)
    return parsed.astimezone(datetime_timezone.utc)


def _validate_projection(cursor) -> None:
    cursor.execute(
        "SELECT domain, revision, source_digest FROM sales_data_revisions "
        "WHERE domain IN ('sales', 'erp') ORDER BY domain"
    )
    rows = cursor.fetchall()
    if [row[0] for row in rows] != ["erp", "sales"]:
        raise ReadinessError("projection_revision_incomplete")
    revisions: dict[str, int] = {}
    for domain, raw_revision, raw_digest in rows:
        revision = int(raw_revision)
        digest = str(raw_digest or "")
        if revision < 1 or (digest and not HEX_64.fullmatch(digest)):
            raise ReadinessError("projection_revision_invalid")
        revisions[str(domain)] = revision

    cursor.execute(
        "SELECT source_epoch, source_path_digest, last_event_sequence, last_event_id, "
        "sales_revision, erp_revision, last_checked_at "
        "FROM sales_projection_sync_checkpoint WHERE id = 1"
    )
    checkpoint = cursor.fetchone()
    if checkpoint is None:
        raise ReadinessError("projection_checkpoint_missing")
    source_epoch = str(checkpoint[0])
    source_path_digest = str(checkpoint[1])
    event_sequence = int(checkpoint[2])
    event_id = str(checkpoint[3])
    sales_revision = int(checkpoint[4])
    erp_revision = int(checkpoint[5])
    if not HEX_32.fullmatch(source_epoch) or not HEX_64.fullmatch(source_path_digest):
        raise ReadinessError("projection_checkpoint_invalid")
    if event_sequence < 0 or bool(event_id) != (event_sequence > 0):
        raise ReadinessError("projection_checkpoint_invalid")
    if event_sequence > 0:
        event_parts = event_id.split(":", 2)
        if (
            len(event_parts) != 3
            or event_parts[0] != source_epoch
            or event_parts[1] not in {"sales", "erp"}
            or not event_parts[2]
        ):
            raise ReadinessError("projection_checkpoint_invalid")
    if (sales_revision, erp_revision) != (revisions["sales"], revisions["erp"]):
        raise ReadinessError("projection_checkpoint_mismatch")

    checked_at = _parse_checked_at(checkpoint[6])
    age_seconds = (timezone.now() - checked_at).total_seconds()
    if age_seconds < -30 or age_seconds > settings.PROJECTION_SYNC_MAX_AGE_SECONDS:
        raise ReadinessError("projection_sync_stale")


@require_GET
def live(_request):
    return _response({"status": "ok", "service": "teruisi-django"})


@require_GET
def ready(_request):
    try:
        with connection.cursor() as cursor:
            _validate_schema(cursor)
            _validate_projection(cursor)
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
                "code": "projection_unavailable",
            },
            status=503,
        )
    except Exception as error:  # Database/driver details must stay out of HTTP.
        logger.exception(
            "readiness_failed code=projection_probe_error type=%s",
            type(error).__name__,
        )
        return _response(
            {
                "status": "not_ready",
                "service": "teruisi-django",
                "code": "projection_unavailable",
            },
            status=503,
        )
    return _response(
        {
            "status": "ready",
            "service": "teruisi-django",
            "database": "ready",
            "projection": "ready",
        }
    )
