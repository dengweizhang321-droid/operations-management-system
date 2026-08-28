from __future__ import annotations

import io
import json
import sqlite3
import tempfile
from dataclasses import replace
from pathlib import Path
from unittest.mock import MagicMock, call, patch

from django.core.management import call_command, CommandError
from django.db import connection as target_connection
from django.test import TestCase

from sales.models import (
    ErpProductMaster,
    SalesDataRevision,
    SalesImportBatch,
    SalesMigrationLock,
    SalesOrderLine,
    sales_projection_values,
)
from sales.projection_sync import (
    CANONICAL_FORMAT_VERSION,
    ERP_PRODUCT_COLUMNS,
    OUTBOX_COLUMNS,
    SALES_BATCH_COLUMNS,
    SALES_LINE_SOURCE_COLUMNS,
    ProjectionSyncError,
    SourceState,
    _acquire_target_lock,
    _postgres_stage,
    initialize_checkpoint,
    read_checkpoint,
    retry_source_changes,
    sync_projection_once,
)


SOURCE_EPOCH = "0123456789abcdef0123456789abcdef"
INTEGER_COLUMNS = {
    "file_size_bytes",
    "row_count",
    "inserted_count",
    "duplicate_count",
    "warning_count",
    "source_row_number",
    "quantity",
    "list_unit_price_cents",
    "cost_amount_cents",
    "allocated_unit_price_cents",
    "allocated_amount_cents",
    "fee_allocation_cents",
    "gross_profit_cents",
    "gross_margin_bps",
    "untaxed_gross_profit_cents",
    "untaxed_gross_margin_bps",
}


def _create_payload_table(
    source: sqlite3.Connection,
    table: str,
    columns: tuple[str, ...],
    primary_key: str,
) -> None:
    definitions = []
    for column in columns:
        kind = "INTEGER" if column in INTEGER_COLUMNS else "TEXT"
        suffix = " PRIMARY KEY" if column == primary_key else ""
        definitions.append(f'"{column}" {kind}{suffix}')
    source.execute(f'CREATE TABLE "{table}" ({", ".join(definitions)})')


def _insert(
    source: sqlite3.Connection,
    table: str,
    columns: tuple[str, ...],
    payload: dict[str, object],
) -> None:
    quoted = ", ".join(f'"{column}"' for column in columns)
    placeholders = ", ".join("?" for _ in columns)
    source.execute(
        f'INSERT INTO "{table}" ({quoted}) VALUES ({placeholders})',
        tuple(payload[column] for column in columns),
    )


def _sales_batch(
    batch_id: str,
    *,
    row_count: int,
    content_hash: str,
) -> dict[str, object]:
    return {
        "id": batch_id,
        "source": "test-sales",
        "file_name": f"{batch_id}.xlsx",
        "file_size_bytes": 100,
        "file_hash": content_hash,
        "sheet_name": "销售",
        "status": "completed",
        "row_count": row_count,
        "inserted_count": row_count,
        "duplicate_count": 0,
        "warning_count": 0,
        "warnings_json": "[]",
        "totals_json": json.dumps(
            {"contentHash": content_hash}, separators=(",", ":")
        ),
        "created_at": "2026-08-28 09:00:00",
        "completed_at": "2026-08-28 09:00:01",
    }


def _line(
    key: str,
    *,
    channel: str,
    platform: str,
    product_code: str,
    source_category: str,
    ship_time: str = "2026-08-01 10:00:00",
    batch_id: str = "baseline-sales",
) -> dict[str, object]:
    identifier = sum(ord(character) for character in key)
    return {
        "source_line_key": key,
        "source_row_hash": f"row-hash-{key}",
        "first_import_batch_id": batch_id,
        "last_import_batch_id": batch_id,
        "source_row_number": identifier,
        "order_no": f"order-{key}",
        "online_order_no": "",
        "channel": channel,
        "platform": platform,
        "shop_name": f"{platform}一店",
        "logistics_company": "物流",
        "warehouse": "主仓",
        "product_code": product_code,
        "online_spec_code": "",
        "product_name": f"商品-{product_code}",
        "specification": "标准",
        "barcode": f"barcode-{product_code}",
        "supplier": "供应商",
        "category": source_category,
        "quantity": 1,
        "list_unit_price_cents": 1000,
        "cost_amount_cents": 600,
        "allocated_unit_price_cents": 1000,
        "allocated_amount_cents": 1000,
        "fee_allocation_cents": 0,
        "gross_profit_cents": 400,
        "gross_margin_bps": 4000,
        "untaxed_gross_profit_cents": 400,
        "untaxed_gross_margin_bps": 4000,
        "order_time": ship_time,
        "sales_time": ship_time,
        "ship_time": ship_time,
        "line_ship_time": ship_time,
        "business_type": "销售",
        "created_at": ship_time,
        "updated_at": ship_time,
    }


def _product(
    code: str,
    category: str,
    *,
    batch_id: str = "baseline-erp",
) -> dict[str, object]:
    return {
        "product_code": code,
        "product_name": f"商品-{code}",
        "brand": "",
        "specification": "标准",
        "barcode": f"barcode-{code}",
        "category": category,
        "supplier": "供应商",
        "product_status": "在售",
        "source_row_number": int(code[1:]),
        "last_import_batch_id": batch_id,
        "created_at": "2026-08-01 00:00:00",
        "updated_at": "2026-08-01 00:00:00",
    }


def install_source(path: Path) -> None:
    source = sqlite3.connect(path)
    source.execute(
        "CREATE TABLE sales_projection_source_state ("
        "id INTEGER PRIMARY KEY, source_epoch TEXT NOT NULL, created_at TEXT, updated_at TEXT)"
    )
    source.execute(
        "INSERT INTO sales_projection_source_state VALUES (1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        (SOURCE_EPOCH,),
    )
    source.execute(
        "CREATE TABLE sales_overview_cache_state ("
        "id INTEGER PRIMARY KEY, sales_revision INTEGER NOT NULL, "
        "erp_product_revision INTEGER NOT NULL)"
    )
    source.execute("INSERT INTO sales_overview_cache_state VALUES (1, 1, 1)")
    source.execute(
        "CREATE TABLE sales_projection_outbox ("
        "event_sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, "
        "source_epoch TEXT NOT NULL, domain TEXT NOT NULL, operation TEXT NOT NULL, "
        "scope_json TEXT NOT NULL, source_batch_id TEXT NOT NULL, "
        "sales_revision INTEGER NOT NULL, erp_revision INTEGER NOT NULL, "
        "row_count INTEGER NOT NULL, content_hash TEXT NOT NULL, "
        "canonical_format_version TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    _create_payload_table(
        source, "sales_import_batches", SALES_BATCH_COLUMNS, "id"
    )
    line_columns = ("id", *SALES_LINE_SOURCE_COLUMNS)
    _create_payload_table(source, "sales_order_lines", line_columns, "id")
    _create_payload_table(source, "erp_product_master", ERP_PRODUCT_COLUMNS, "product_code")
    source.execute(
        "CREATE TABLE erp_reference_import_batches ("
        "id TEXT PRIMARY KEY, source_key TEXT NOT NULL, status TEXT NOT NULL, "
        "row_count INTEGER NOT NULL, totals_json TEXT NOT NULL)"
    )

    baseline_hash = "a" * 64
    _insert(
        source,
        "sales_import_batches",
        SALES_BATCH_COLUMNS,
        _sales_batch("baseline-sales", row_count=2, content_hash=baseline_hash),
    )
    for identifier, payload in enumerate(
        (
            _line(
                "OLD",
                channel="天猫",
                platform="天猫",
                product_code="P1",
                source_category="源类目P1",
            ),
            _line(
                "KEEP",
                channel="京东",
                platform="京东",
                product_code="P2",
                source_category="源类目P2",
            ),
        ),
        start=1,
    ):
        _insert(
            source,
            "sales_order_lines",
            line_columns,
            {"id": identifier, **payload},
        )
    for payload in (_product("P1", "旧ERP类目P1"), _product("P2", "旧ERP类目P2")):
        _insert(source, "erp_product_master", ERP_PRODUCT_COLUMNS, payload)
    source.commit()
    source.close()


def _install_target() -> None:
    SalesDataRevision.objects.bulk_create(
        [
            SalesDataRevision(domain="sales", revision=1, source_digest="sales-v1"),
            SalesDataRevision(domain="erp", revision=1, source_digest="erp-v1"),
        ]
    )
    baseline_hash = "a" * 64
    batch = _sales_batch("baseline-sales", row_count=2, content_hash=baseline_hash)
    SalesImportBatch.objects.create(**batch, migration_generation="baseline")
    categories = {"P1": "旧ERP类目P1", "P2": "旧ERP类目P2"}
    for payload in (_product("P1", categories["P1"]), _product("P2", categories["P2"])):
        ErpProductMaster.objects.create(**payload, migration_generation="baseline")
    for payload in (
        _line(
            "OLD",
            channel="天猫",
            platform="天猫",
            product_code="P1",
            source_category="源类目P1",
        ),
        _line(
            "KEEP",
            channel="京东",
            platform="京东",
            product_code="P2",
            source_category="源类目P2",
        ),
    ):
        SalesOrderLine.objects.create(
            **payload,
            **sales_projection_values(
                payload, erp_category=categories[payload["product_code"]]
            ),
            migration_generation="baseline",
        )


def _sales_scope_json(channels: list[str] | None = None) -> str:
    return json.dumps(
        {
            "startDate": "2026-08-01",
            "endDate": "2026-08-01",
            "channels": channels,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def publish_sales(
    path: Path,
    rows: list[dict[str, object]],
    *,
    sequence: int = 1,
    revision: int = 2,
    batch_id: str = "sales-batch-2",
    format_version: str = CANONICAL_FORMAT_VERSION,
) -> str:
    content_hash = "b" * 64
    source = sqlite3.connect(path)
    source.execute(
        "DELETE FROM sales_order_lines WHERE ship_time >= '2026-08-01' "
        "AND ship_time < '2026-08-02' AND channel = '天猫'"
    )
    line_columns = ("id", *SALES_LINE_SOURCE_COLUMNS)
    next_id = int(source.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM sales_order_lines").fetchone()[0])
    for offset, payload in enumerate(rows):
        _insert(
            source,
            "sales_order_lines",
            line_columns,
            {"id": next_id + offset, **payload},
        )
    _insert(
        source,
        "sales_import_batches",
        SALES_BATCH_COLUMNS,
        _sales_batch(batch_id, row_count=len(rows), content_hash=content_hash),
    )
    source.execute(
        "UPDATE sales_overview_cache_state SET sales_revision = ? WHERE id = 1",
        (revision,),
    )
    event_id = f"{SOURCE_EPOCH}:sales:{batch_id}"
    event = {
        "event_sequence": sequence,
        "event_id": event_id,
        "source_epoch": SOURCE_EPOCH,
        "domain": "sales",
        "operation": "replace_scope",
        "scope_json": _sales_scope_json(["天猫"]),
        "source_batch_id": batch_id,
        "sales_revision": revision,
        "erp_revision": 1,
        "row_count": len(rows),
        "content_hash": content_hash,
        "canonical_format_version": format_version,
        "created_at": "2026-08-28 10:00:00",
    }
    _insert(source, "sales_projection_outbox", OUTBOX_COLUMNS, event)
    source.commit()
    source.close()
    return event_id


def publish_erp(path: Path, products: list[dict[str, object]]) -> str:
    sequence = 2
    batch_id = "erp-batch-2"
    content_hash = "c" * 64
    source = sqlite3.connect(path)
    source.execute("DELETE FROM erp_product_master")
    for payload in products:
        _insert(source, "erp_product_master", ERP_PRODUCT_COLUMNS, payload)
    source.execute(
        "INSERT INTO erp_reference_import_batches "
        "(id, source_key, status, row_count, totals_json) VALUES (?, 'products', 'completed', ?, ?)",
        (
            batch_id,
            len(products),
            json.dumps({"contentHash": content_hash}, separators=(",", ":")),
        ),
    )
    source.execute(
        "UPDATE sales_overview_cache_state SET erp_product_revision = 2 WHERE id = 1"
    )
    event_id = f"{SOURCE_EPOCH}:erp:{batch_id}"
    event = {
        "event_sequence": sequence,
        "event_id": event_id,
        "source_epoch": SOURCE_EPOCH,
        "domain": "erp",
        "operation": "replace_all",
        "scope_json": '{"source":"products"}',
        "source_batch_id": batch_id,
        "sales_revision": 2,
        "erp_revision": 2,
        "row_count": len(products),
        "content_hash": content_hash,
        "canonical_format_version": CANONICAL_FORMAT_VERSION,
        "created_at": "2026-08-28 10:05:00",
    }
    _insert(source, "sales_projection_outbox", OUTBOX_COLUMNS, event)
    source.commit()
    source.close()
    return event_id


def publish_overlapping_sales(path: Path, rows: list[dict[str, object]]) -> str:
    batch_id = "sales-batch-3"
    content_hash = "d" * 64
    source = sqlite3.connect(path)
    source.execute(
        "DELETE FROM sales_order_lines WHERE ship_time >= '2026-08-01' "
        "AND ship_time < '2026-08-02'"
    )
    line_columns = ("id", *SALES_LINE_SOURCE_COLUMNS)
    for identifier, payload in enumerate(rows, start=100):
        _insert(
            source,
            "sales_order_lines",
            line_columns,
            {"id": identifier, **payload},
        )
    _insert(
        source,
        "sales_import_batches",
        SALES_BATCH_COLUMNS,
        _sales_batch(batch_id, row_count=len(rows), content_hash=content_hash),
    )
    source.execute(
        "UPDATE sales_overview_cache_state SET sales_revision = 3 WHERE id = 1"
    )
    event_id = f"{SOURCE_EPOCH}:sales:{batch_id}"
    _insert(
        source,
        "sales_projection_outbox",
        OUTBOX_COLUMNS,
        {
            "event_sequence": 2,
            "event_id": event_id,
            "source_epoch": SOURCE_EPOCH,
            "domain": "sales",
            "operation": "replace_scope",
            "scope_json": _sales_scope_json(None),
            "source_batch_id": batch_id,
            "sales_revision": 3,
            "erp_revision": 1,
            "row_count": len(rows),
            "content_hash": content_hash,
            "canonical_format_version": CANONICAL_FORMAT_VERSION,
            "created_at": "2026-08-28 10:03:00",
        },
    )
    source.commit()
    source.close()
    return event_id


class ProjectionSyncTests(TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.source = Path(self.temporary.name) / "authoritative.sqlite"
        install_source(self.source)
        _install_target()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def initialize(self) -> None:
        result = initialize_checkpoint(self.source)
        self.assertEqual(result["status"], "initialized")

    @staticmethod
    def replacement_line() -> dict[str, object]:
        return _line(
            "NEW",
            channel="天猫",
            platform="天猫",
            product_code="P1",
            source_category="源类目P1",
            batch_id="sales-batch-2",
        )

    def test_sales_scope_and_erp_replace_all_publish_atomically_and_replay_is_idempotent(self) -> None:
        self.initialize()
        sales_event_id = publish_sales(self.source, [self.replacement_line()])

        sales_result = sync_projection_once(self.source, batch_size=100)
        self.assertEqual(sales_result["status"], "synchronized")
        self.assertEqual(sales_result["eventCount"], 1)
        self.assertEqual(
            set(SalesOrderLine.objects.values_list("source_line_key", flat=True)),
            {"KEEP", "NEW"},
        )
        self.assertTrue(SalesImportBatch.objects.filter(id="sales-batch-2").exists())
        checkpoint = read_checkpoint()
        self.assertEqual(checkpoint.last_event_id, sales_event_id)
        self.assertEqual(checkpoint.sales_revision, 2)

        before_ids = dict(
            SalesOrderLine.objects.values_list("source_line_key", "id")
        )
        replay = sync_projection_once(self.source, batch_size=100)
        self.assertEqual(replay["status"], "up_to_date")
        self.assertEqual(
            dict(SalesOrderLine.objects.values_list("source_line_key", "id")),
            before_ids,
        )

        publish_erp(
            self.source,
            [_product("P1", "新ERP类目P1", batch_id="erp-batch-2")],
        )
        erp_result = sync_projection_once(self.source, batch_size=100)
        self.assertEqual(erp_result["erpRowCount"], 1)
        self.assertEqual(
            list(ErpProductMaster.objects.values_list("product_code", flat=True)),
            ["P1"],
        )
        self.assertEqual(
            SalesOrderLine.objects.get(source_line_key="NEW").resolved_category,
            "新ERP类目P1",
        )
        self.assertEqual(
            SalesOrderLine.objects.get(source_line_key="KEEP").resolved_category,
            "源类目P2",
        )
        self.assertEqual(
            dict(SalesDataRevision.objects.values_list("domain", "revision")),
            {"sales": 2, "erp": 2},
        )
        checkpoint = read_checkpoint()
        self.assertEqual(checkpoint.last_event_sequence, 2)
        self.assertEqual((checkpoint.sales_revision, checkpoint.erp_revision), (2, 2))

    def test_empty_authoritative_scope_deletes_only_that_range(self) -> None:
        self.initialize()
        publish_sales(self.source, [])

        result = sync_projection_once(self.source, batch_size=100)

        self.assertEqual(result["salesScopes"][0]["rowCount"], 0)
        self.assertFalse(SalesOrderLine.objects.filter(source_line_key="OLD").exists())
        self.assertTrue(SalesOrderLine.objects.filter(source_line_key="KEEP").exists())
        self.assertEqual(SalesDataRevision.objects.get(domain="sales").revision, 2)

    def test_contiguous_overlapping_scopes_are_consumed_to_one_fixed_head(self) -> None:
        self.initialize()
        publish_sales(self.source, [self.replacement_line()])
        final_tmall = _line(
            "FINAL-TMALL",
            channel="天猫",
            platform="天猫",
            product_code="P1",
            source_category="源类目P1",
            batch_id="sales-batch-3",
        )
        final_jd = _line(
            "FINAL-JD",
            channel="京东",
            platform="京东",
            product_code="P2",
            source_category="源类目P2",
            batch_id="sales-batch-3",
        )
        head_event_id = publish_overlapping_sales(
            self.source, [final_tmall, final_jd]
        )

        result = sync_projection_once(self.source, batch_size=100)

        self.assertEqual(result["eventCount"], 2)
        self.assertEqual(result["headSequence"], 2)
        self.assertEqual(
            set(SalesOrderLine.objects.values_list("source_line_key", flat=True)),
            {"FINAL-TMALL", "FINAL-JD"},
        )
        self.assertEqual(
            set(SalesImportBatch.objects.values_list("id", flat=True)),
            {"baseline-sales", "sales-batch-2", "sales-batch-3"},
        )
        checkpoint = read_checkpoint()
        self.assertEqual(checkpoint.last_event_id, head_event_id)
        self.assertEqual(
            (checkpoint.last_event_sequence, checkpoint.sales_revision), (2, 3)
        )

    def test_failure_after_fact_apply_rolls_back_facts_batches_revisions_and_checkpoint(self) -> None:
        self.initialize()
        publish_sales(self.source, [self.replacement_line()])

        with patch(
            "sales.projection_sync._publish_checkpoint",
            side_effect=ProjectionSyncError("injected publish failure"),
        ):
            with self.assertRaisesMessage(ProjectionSyncError, "injected publish failure"):
                sync_projection_once(self.source, batch_size=100)

        self.assertEqual(
            set(SalesOrderLine.objects.values_list("source_line_key", flat=True)),
            {"OLD", "KEEP"},
        )
        self.assertFalse(SalesImportBatch.objects.filter(id="sales-batch-2").exists())
        self.assertEqual(SalesDataRevision.objects.get(domain="sales").revision, 1)
        self.assertEqual(read_checkpoint().last_event_sequence, 0)

    def test_source_drift_after_extract_rolls_back_target_transaction(self) -> None:
        self.initialize()
        event_id = publish_sales(self.source, [self.replacement_line()])
        stable = SourceState(SOURCE_EPOCH, 1, event_id, 2, 1)

        with patch(
            "sales.projection_sync._read_live_source_state",
            side_effect=[stable, replace(stable, sales_revision=3)],
        ):
            with self.assertRaisesMessage(ProjectionSyncError, "抽取期间变化"):
                sync_projection_once(self.source, batch_size=100)

        self.assertTrue(SalesOrderLine.objects.filter(source_line_key="OLD").exists())
        self.assertFalse(SalesOrderLine.objects.filter(source_line_key="NEW").exists())
        self.assertEqual(read_checkpoint().last_event_sequence, 0)
        self.assertEqual(SalesDataRevision.objects.get(domain="sales").revision, 1)

    def test_source_drift_is_retried_from_a_fresh_snapshot(self) -> None:
        self.initialize()
        event_id = publish_sales(self.source, [self.replacement_line()])
        stable = SourceState(SOURCE_EPOCH, 1, event_id, 2, 1)
        drifted = replace(stable, sales_revision=3)

        with patch(
            "sales.projection_sync._read_live_source_state",
            side_effect=[stable, drifted, stable, stable],
        ):
            result = retry_source_changes(
                lambda: sync_projection_once(self.source, batch_size=100),
                attempts=2,
                delay_seconds=0,
            )

        self.assertEqual(result["status"], "synchronized")
        self.assertEqual(
            set(SalesOrderLine.objects.values_list("source_line_key", flat=True)),
            {"KEEP", "NEW"},
        )
        self.assertEqual(read_checkpoint().last_event_sequence, 1)

    def test_sequence_gap_fails_closed_without_target_changes(self) -> None:
        self.initialize()
        publish_sales(
            self.source,
            [self.replacement_line()],
            sequence=2,
            revision=2,
        )

        with self.assertRaisesMessage(ProjectionSyncError, "缺口或乱序"):
            sync_projection_once(self.source, batch_size=100)

        self.assertTrue(SalesOrderLine.objects.filter(source_line_key="OLD").exists())
        self.assertEqual(read_checkpoint().last_event_sequence, 0)

    def test_revision_jump_fails_closed_without_target_changes(self) -> None:
        self.initialize()
        publish_sales(
            self.source,
            [self.replacement_line()],
            sequence=1,
            revision=3,
        )

        with self.assertRaisesMessage(ProjectionSyncError, "revision 未按单步严格推进"):
            sync_projection_once(self.source, batch_size=100)

        self.assertTrue(SalesOrderLine.objects.filter(source_line_key="OLD").exists())
        self.assertEqual(read_checkpoint().last_event_sequence, 0)

    def test_duplicate_event_id_after_checkpoint_fails_closed(self) -> None:
        self.initialize()
        publish_sales(self.source, [self.replacement_line()])
        sync_projection_once(self.source, batch_size=100)
        source = sqlite3.connect(self.source)
        first = source.execute(
            f"SELECT {', '.join(OUTBOX_COLUMNS)} FROM sales_projection_outbox "
            "WHERE event_sequence = 1"
        ).fetchone()
        duplicate = dict(zip(OUTBOX_COLUMNS, first, strict=True))
        duplicate["event_sequence"] = 2
        duplicate["sales_revision"] = 3
        duplicate["created_at"] = "2026-08-28 10:01:00"
        source.execute(
            "UPDATE sales_overview_cache_state SET sales_revision = 3 WHERE id = 1"
        )
        _insert(source, "sales_projection_outbox", OUTBOX_COLUMNS, duplicate)
        source.commit()
        source.close()

        with self.assertRaisesMessage(ProjectionSyncError, "重复 event_id"):
            sync_projection_once(self.source, batch_size=100)

        self.assertEqual(read_checkpoint().last_event_sequence, 1)
        self.assertEqual(SalesDataRevision.objects.get(domain="sales").revision, 2)

    def test_source_epoch_change_fails_closed(self) -> None:
        self.initialize()
        source = sqlite3.connect(self.source)
        source.execute(
            "UPDATE sales_projection_source_state SET source_epoch = ? WHERE id = 1",
            ("f" * 32,),
        )
        source.commit()
        source.close()

        with self.assertRaisesMessage(ProjectionSyncError, "source_epoch 已变化"):
            sync_projection_once(self.source, batch_size=100)

        self.assertEqual(read_checkpoint().source_epoch, SOURCE_EPOCH)
        self.assertEqual(SalesDataRevision.objects.get(domain="sales").revision, 1)

    def test_content_digest_or_format_mismatch_fails_closed(self) -> None:
        self.initialize()
        publish_sales(self.source, [self.replacement_line()])
        source = sqlite3.connect(self.source)
        source.execute(
            "UPDATE sales_import_batches SET totals_json = '{}' "
            "WHERE id = 'sales-batch-2'"
        )
        source.commit()
        source.close()

        with self.assertRaisesMessage(ProjectionSyncError, "content_hash"):
            sync_projection_once(self.source, batch_size=100)
        self.assertTrue(SalesOrderLine.objects.filter(source_line_key="OLD").exists())

        source = sqlite3.connect(self.source)
        source.execute(
            "UPDATE sales_import_batches SET totals_json = ? "
            "WHERE id = 'sales-batch-2'",
            [json.dumps({"contentHash": "b" * 64}, separators=(",", ":"))],
        )
        source.execute(
            "UPDATE sales_projection_outbox SET canonical_format_version = "
            "'sales-projection-v999' WHERE event_sequence = 1"
        )
        source.commit()
        source.close()
        with self.assertRaisesMessage(ProjectionSyncError, "format version"):
            sync_projection_once(self.source, batch_size=100)
        self.assertEqual(read_checkpoint().last_event_sequence, 0)

    def test_final_scope_row_count_mismatch_fails_closed(self) -> None:
        self.initialize()
        publish_sales(self.source, [self.replacement_line()])
        source = sqlite3.connect(self.source)
        source.execute("DELETE FROM sales_order_lines WHERE source_line_key = 'NEW'")
        source.commit()
        source.close()

        with self.assertRaisesMessage(ProjectionSyncError, "权威范围不一致"):
            sync_projection_once(self.source, batch_size=100)

        self.assertTrue(SalesOrderLine.objects.filter(source_line_key="OLD").exists())
        self.assertFalse(SalesImportBatch.objects.filter(id="sales-batch-2").exists())
        self.assertEqual(read_checkpoint().last_event_sequence, 0)

    def test_full_migration_lock_blocks_sync_then_retry_succeeds(self) -> None:
        self.initialize()
        publish_sales(self.source, [self.replacement_line()])
        SalesMigrationLock.objects.filter(name="sales_snapshot").update(owner_id="full-run")

        with self.assertRaisesMessage(ProjectionSyncError, "全量销售快照迁移"):
            sync_projection_once(self.source, batch_size=100)
        self.assertEqual(read_checkpoint().last_event_sequence, 0)

        SalesMigrationLock.objects.filter(name="sales_snapshot").update(owner_id="")
        self.assertEqual(
            sync_projection_once(self.source, batch_size=100)["status"],
            "synchronized",
        )
        self.assertEqual(
            sync_projection_once(self.source, batch_size=100)["status"],
            "up_to_date",
        )

    def test_postgres_path_uses_transaction_advisory_lock_and_copy_staging(self) -> None:
        advisory_cursor = MagicMock()
        advisory_cursor.__enter__.return_value = advisory_cursor
        advisory_cursor.fetchone.return_value = (True,)

        stage_cursor = MagicMock()
        stage_cursor.__enter__.return_value = stage_cursor
        raw_cursor = MagicMock()
        stage_cursor.cursor = raw_cursor
        copy_context = MagicMock()
        copier = MagicMock()
        copy_context.__enter__.return_value = copier
        raw_cursor.copy.return_value = copy_context

        fake_connection = MagicMock()
        fake_connection.vendor = "postgresql"
        fake_connection.ops.quote_name.side_effect = lambda value: f'"{value}"'
        fake_connection.cursor.side_effect = [advisory_cursor, stage_cursor]

        with patch("sales.projection_sync.target_connection", fake_connection):
            _acquire_target_lock()
            count = _postgres_stage(
                target_table="sales_import_batches",
                stage_table="sales_projection_stage_batches",
                columns=("id", "status"),
                payloads=(
                    {"id": "batch-a", "status": "completed"},
                    {"id": "batch-b", "status": "completed"},
                ),
            )

        self.assertEqual(count, 2)
        self.assertIn("pg_try_advisory_xact_lock", advisory_cursor.execute.call_args.args[0])
        self.assertIn("CREATE TEMP TABLE", stage_cursor.execute.call_args_list[0].args[0])
        self.assertIn("ON COMMIT DROP", stage_cursor.execute.call_args_list[0].args[0])
        self.assertIn("COPY", raw_cursor.copy.call_args.args[0])
        copier.write_row.assert_has_calls(
            [
                call(("batch-a", "completed")),
                call(("batch-b", "completed")),
            ]
        )

    def test_checkpoint_initialization_requires_revision_match_and_is_one_time(self) -> None:
        SalesDataRevision.objects.filter(domain="sales").update(revision=9)
        with self.assertRaisesMessage(ProjectionSyncError, "revision 与 D1 源完全一致"):
            initialize_checkpoint(self.source)
        self.assertIsNone(read_checkpoint())

        SalesDataRevision.objects.filter(domain="sales").update(revision=1)
        initialize_checkpoint(self.source)
        with self.assertRaisesMessage(ProjectionSyncError, "不得重新绑定源"):
            initialize_checkpoint(self.source)

    def test_empty_outbox_initializes_current_non_default_revision_baseline(self) -> None:
        source = sqlite3.connect(self.source)
        source.execute(
            "UPDATE sales_overview_cache_state SET sales_revision = 8, "
            "erp_product_revision = 5 WHERE id = 1"
        )
        source.commit()
        source.close()
        SalesDataRevision.objects.filter(domain="sales").update(revision=8)
        SalesDataRevision.objects.filter(domain="erp").update(revision=5)

        result = initialize_checkpoint(self.source)

        self.assertEqual(result["headSequence"], 0)
        self.assertEqual((result["salesRevision"], result["erpRevision"]), (8, 5))
        checkpoint = read_checkpoint()
        self.assertEqual(checkpoint.last_event_id, "")
        self.assertEqual(
            (
                checkpoint.last_event_sequence,
                checkpoint.sales_revision,
                checkpoint.erp_revision,
            ),
            (0, 8, 5),
        )

    def test_management_command_initializes_and_polls_once(self) -> None:
        initialized = io.StringIO()
        call_command(
            "sync_sales_projection",
            source=str(self.source),
            initialize_checkpoint=True,
            source_change_retries=1,
            stdout=initialized,
        )
        self.assertEqual(json.loads(initialized.getvalue())["status"], "initialized")

        output = io.StringIO()
        call_command(
            "sync_sales_projection",
            source=str(self.source),
            source_change_retries=1,
            batch_size=100,
            stdout=output,
        )
        self.assertEqual(json.loads(output.getvalue())["status"], "up_to_date")

        with self.assertRaisesMessage(CommandError, "不能与 --watch"):
            call_command(
                "sync_sales_projection",
                source=str(self.source),
                initialize_checkpoint=True,
                watch=True,
            )

    def test_up_to_date_check_refreshes_checkpoint_heartbeat(self) -> None:
        self.initialize()
        with target_connection.cursor() as cursor:
            cursor.execute(
                "UPDATE sales_projection_sync_checkpoint SET "
                "updated_at = %s, last_checked_at = %s WHERE id = 1",
                ["2000-01-01 00:00:00", "2000-01-01 00:00:00"],
            )

        result = sync_projection_once(self.source, batch_size=100)

        self.assertEqual(result["status"], "up_to_date")
        checkpoint = read_checkpoint()
        self.assertFalse(checkpoint.last_checked_at.startswith("2000-01-01"))
