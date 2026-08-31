"""Lightweight dynamic safety checks shared by writer readiness and transactions."""

from __future__ import annotations

import re
from datetime import UTC

from django.conf import settings
from django.db import connection
from django.utils import timezone

from .cutover_attestation import (
    SalesCutoverAttestationError,
    require_valid_cutover_attestation,
)


HEX_64_RE = re.compile(r"^[0-9a-f]{64}$")


class WriterRuntimeGuardError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def validate_erp_reference_runtime_state(cursor=None) -> None:
    owns_cursor = cursor is None
    if owns_cursor:
        cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT revision, source_digest FROM sales_data_revisions WHERE domain='erp'"
        )
        revision_row = cursor.fetchone()
        if revision_row is None:
            raise WriterRuntimeGuardError("erp_reference_revision_missing")
        revision = int(revision_row[0])
        revision_digest = str(revision_row[1] or "")
        if revision < 1 or not HEX_64_RE.fullmatch(revision_digest):
            raise WriterRuntimeGuardError("erp_reference_revision_invalid")
        cursor.execute(
            "SELECT source_epoch, source_path_digest, last_event_sequence, "
            "last_event_id, erp_revision, content_hash, row_count, "
            "source_batch_id, last_checked_at "
            "FROM erp_reference_sync_checkpoint WHERE id = 1"
        )
        checkpoint = cursor.fetchone()
        if checkpoint is None:
            raise WriterRuntimeGuardError("erp_reference_checkpoint_missing")
        (
            source_epoch,
            source_path_digest,
            raw_sequence,
            raw_event_id,
            raw_erp_revision,
            raw_content_hash,
            raw_row_count,
            raw_source_batch_id,
            last_checked_at,
        ) = checkpoint
        sequence = int(raw_sequence)
        erp_revision = int(raw_erp_revision)
        row_count = int(raw_row_count)
        event_id = str(raw_event_id or "")
        source_batch_id = str(raw_source_batch_id or "")
        content_hash = str(raw_content_hash or "")
        source_epoch = str(source_epoch or "")
        if (
            not re.fullmatch(r"[0-9a-f]{32}", source_epoch)
            or not HEX_64_RE.fullmatch(str(source_path_digest or ""))
            or not HEX_64_RE.fullmatch(content_hash)
            or sequence < 0
            or erp_revision < 1
            or row_count <= 0
            or bool(event_id) != (sequence > 0)
            or (sequence > 0 and event_id != f"{source_epoch}:erp:{source_batch_id}")
            or (revision, revision_digest) != (erp_revision, content_hash)
        ):
            raise WriterRuntimeGuardError("erp_reference_checkpoint_invalid")
        if last_checked_at is None:
            raise WriterRuntimeGuardError("erp_reference_checkpoint_stale")
        if timezone.is_naive(last_checked_at):
            last_checked_at = timezone.make_aware(last_checked_at, UTC)
        age_seconds = (timezone.now() - last_checked_at).total_seconds()
        if age_seconds < -5 or age_seconds > settings.ERP_REFERENCE_SYNC_MAX_AGE_SECONDS:
            raise WriterRuntimeGuardError("erp_reference_checkpoint_stale")
        cursor.execute("SELECT COUNT(*) FROM erp_product_master")
        if int(cursor.fetchone()[0]) != row_count:
            raise WriterRuntimeGuardError("erp_reference_checkpoint_invalid")
    finally:
        if owns_cursor:
            cursor.close()


def validate_writer_runtime_state(*, cutover_id: str, cursor=None) -> None:
    try:
        # Runtime verification is intentionally lightweight: exact immutable
        # payload/hash/column binding only. Activation performs the one-time
        # full baseline scan; legal later sales writes must not invalidate it.
        require_valid_cutover_attestation(cutover_id=cutover_id)
    except SalesCutoverAttestationError as error:
        raise WriterRuntimeGuardError("sales_cutover_attestation_invalid") from error
    validate_erp_reference_runtime_state(cursor)
