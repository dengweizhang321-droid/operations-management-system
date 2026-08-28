from __future__ import annotations

import io
import json
import os
import sqlite3
import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.db import connection as target_connection
from django.test import TestCase

from sales.management.commands.migrate_sales_from_d1 import (
    BATCH_COLUMNS,
    CANONICAL_FORMAT_VERSION,
    LINE_COLUMNS,
    PRODUCT_COLUMNS,
    _target_binary_collation,
)
from sales.models import ErpProductMaster, SalesDataRevision, SalesImportBatch, SalesMigrationRun, SalesOrderLine


INTEGER_COLUMNS = {
    "id", "file_size_bytes", "row_count", "inserted_count", "duplicate_count", "warning_count",
    "source_row_number", "quantity", "list_unit_price_cents", "cost_amount_cents",
    "allocated_unit_price_cents", "allocated_amount_cents", "fee_allocation_cents",
    "gross_profit_cents", "gross_margin_bps", "untaxed_gross_profit_cents", "untaxed_gross_margin_bps",
}


def create_table(connection: sqlite3.Connection, name: str, columns: tuple[str, ...], primary: str) -> None:
    definitions = []
    for column in columns:
        sql_type = "INTEGER" if column in INTEGER_COLUMNS and (column != "id" or name == "sales_order_lines") else "TEXT"
        if name == "sales_order_lines" and column == "source_line_key":
            # Make the source's declared/default order differ from the target's
            # binary order so digest tests prove the migration overrides it.
            sql_type += " COLLATE NOCASE"
        suffix = " PRIMARY KEY" if column == primary else ""
        definitions.append(f'"{column}" {sql_type}{suffix}')
    connection.execute(f'CREATE TABLE "{name}" ({", ".join(definitions)})')


def line_values(identifier: int, key: str) -> tuple[object, ...]:
    values = {
        "id": identifier, "source_line_key": key, "source_row_hash": f"hash-{key}",
        "first_import_batch_id": "batch-1", "last_import_batch_id": "batch-1", "source_row_number": identifier,
        "order_no": f"order-{identifier}", "online_order_no": "", "channel": "渠道A", "platform": "京东",
        "shop_name": "京东一店", "logistics_company": "物流", "warehouse": "主仓", "product_code": f"P{identifier}",
        "online_spec_code": "", "product_name": f"商品{identifier}", "specification": "", "barcode": "", "supplier": "",
        "category": "品类", "quantity": 1, "list_unit_price_cents": 1000, "cost_amount_cents": 600,
        "allocated_unit_price_cents": 1000, "allocated_amount_cents": 1000, "fee_allocation_cents": 0,
        "gross_profit_cents": 400, "gross_margin_bps": 4000, "untaxed_gross_profit_cents": 400,
        "untaxed_gross_margin_bps": 4000, "order_time": "2026-08-01 00:00:00", "sales_time": "2026-08-01 00:00:00",
        "ship_time": "2026-08-01 00:00:00", "line_ship_time": "2026-08-01 00:00:00", "business_type": "销售",
        "created_at": "2026-08-01 00:00:00", "updated_at": "2026-08-01 00:00:00",
    }
    return tuple(values[column] for column in LINE_COLUMNS)


def install_source(path: Path) -> None:
    connection = sqlite3.connect(path)
    create_table(connection, "sales_import_batches", BATCH_COLUMNS, "id")
    create_table(connection, "sales_order_lines", LINE_COLUMNS, "id")
    connection.execute("CREATE UNIQUE INDEX source_line_key_unique ON sales_order_lines(source_line_key)")
    create_table(connection, "erp_product_master", PRODUCT_COLUMNS, "product_code")
    connection.execute("CREATE TABLE sales_overview_cache_state (id INTEGER PRIMARY KEY, sales_revision INTEGER NOT NULL, erp_product_revision INTEGER NOT NULL)")
    connection.execute("INSERT INTO sales_overview_cache_state VALUES (1, 8, 5)")
    batch = {
        "id": "batch-1", "source": "test", "file_name": "sales.xlsx", "file_size_bytes": 100,
        "file_hash": "a" * 64, "sheet_name": "销售", "status": "completed", "row_count": 2,
        "inserted_count": 2, "duplicate_count": 0, "warning_count": 0, "warnings_json": "[]",
        "totals_json": "{}", "created_at": "2026-08-01 00:00:00", "completed_at": "2026-08-01 01:00:00",
    }
    product = {
        "product_code": "P1", "product_name": "商品1", "brand": "", "specification": "", "barcode": "",
        "category": "品类", "supplier": "", "product_status": "", "source_row_number": 1,
        "last_import_batch_id": "erp-1", "created_at": "2026-08-01 00:00:00", "updated_at": "2026-08-01 00:00:00",
    }
    connection.execute(f'INSERT INTO sales_import_batches ({", ".join(BATCH_COLUMNS)}) VALUES ({", ".join("?" for _ in BATCH_COLUMNS)})', tuple(batch[column] for column in BATCH_COLUMNS))
    connection.execute(f'INSERT INTO erp_product_master ({", ".join(PRODUCT_COLUMNS)}) VALUES ({", ".join("?" for _ in PRODUCT_COLUMNS)})', tuple(product[column] for column in PRODUCT_COLUMNS))
    placeholders = ", ".join("?" for _ in LINE_COLUMNS)
    connection.execute(f'INSERT INTO sales_order_lines ({", ".join(LINE_COLUMNS)}) VALUES ({placeholders})', line_values(1, "L1"))
    connection.execute(f'INSERT INTO sales_order_lines ({", ".join(LINE_COLUMNS)}) VALUES ({placeholders})', line_values(2, "L2"))
    connection.commit()
    connection.close()


class SalesMigrationTests(TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.source = Path(self.temporary.name) / "d1.sqlite"
        install_source(self.source)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_command(self, *, source: Path | None = None, **options) -> str:
        stdout = io.StringIO()
        call_command(
            "migrate_sales_from_d1",
            source=str(source or self.source),
            batch_size=100,
            stdout=stdout,
            **options,
        )
        return stdout.getvalue()

    def approved_dry_run(self, *, source: Path | None = None) -> str:
        payload = json.loads(self.run_command(source=source, dry_run=True))
        self.assertEqual(payload["canonicalFormatVersion"], CANONICAL_FORMAT_VERSION)
        return str(payload["runId"])

    def apply_approved(self, approved_run_id: str, *, source: Path | None = None) -> str:
        return self.run_command(
            source=source,
            apply=True,
            approved_run_id=approved_run_id,
        )

    def test_apply_is_verified_idempotent_and_prunes_stale_rows(self) -> None:
        first_approval = self.approved_dry_run()
        self.apply_approved(first_approval)
        self.assertEqual(SalesOrderLine.objects.count(), 2)
        self.assertEqual(SalesImportBatch.objects.count(), 1)
        self.assertEqual(ErpProductMaster.objects.count(), 1)
        self.assertEqual(dict(SalesDataRevision.objects.values_list("domain", "revision")), {"sales": 8, "erp": 5})
        second_approval = self.approved_dry_run()
        self.apply_approved(second_approval)
        self.assertEqual(SalesOrderLine.objects.count(), 2)
        self.assertEqual(dict(SalesDataRevision.objects.values_list("domain", "revision")), {"sales": 8, "erp": 5})
        connection = sqlite3.connect(self.source)
        connection.execute("DELETE FROM sales_order_lines WHERE source_line_key = 'L2'")
        connection.execute("UPDATE sales_overview_cache_state SET sales_revision = 9 WHERE id = 1")
        connection.commit()
        connection.close()
        third_approval = self.approved_dry_run()
        self.apply_approved(third_approval)
        self.assertEqual(list(SalesOrderLine.objects.values_list("source_line_key", flat=True)), ["L1"])
        self.assertEqual(SalesDataRevision.objects.get(domain="sales").revision, 9)
        self.assertEqual(SalesMigrationRun.objects.filter(status="completed").count(), 3)
        latest = SalesMigrationRun.objects.filter(status="completed").order_by("-started_at").first()
        self.assertEqual(latest.source_revision, "9:5")
        self.assertEqual(latest.target_revision, "9:5")

    def test_verify_only_matches_after_apply(self) -> None:
        approval = self.approved_dry_run()
        self.apply_approved(approval)
        output = self.run_command(verify_only=True)
        self.assertIn('"status": "verified"', output)

    def test_apply_materializes_and_verifies_query_ready_projection(self) -> None:
        connection = sqlite3.connect(self.source)
        connection.execute(
            """
            UPDATE sales_order_lines
               SET platform = ' 京东 ', channel = ' 渠道A ', shop_name = ' ',
                   warehouse = ' 刷刷仓 ', category = ' 配件 ',
                   order_no = '', online_order_no = ''
             WHERE source_line_key = 'L2'
            """
        )
        connection.commit()
        connection.close()

        approval = self.approved_dry_run()
        self.apply_approved(approval)
        row = SalesOrderLine.objects.get(source_line_key="L2")
        self.assertEqual(row.business_date, date(2026, 8, 1))
        self.assertEqual(row.platform_key, "京东")
        self.assertEqual(row.channel_key, "渠道A")
        self.assertEqual(row.shop_key, "渠道A")
        self.assertEqual(row.resolved_category, "配件")
        self.assertEqual(row.order_identity, "L2")
        self.assertFalse(row.is_business_row)
        self.assertFalse(row.is_net_sales_row)
        self.assertFalse(row.is_net_quantity_row)

        SalesOrderLine.objects.filter(source_line_key="L2").update(platform_key="被篡改")
        with self.assertRaisesMessage(CommandError, "查询投影"):
            self.run_command(verify_only=True)

    def test_dry_run_rejects_ship_time_without_valid_business_date(self) -> None:
        connection = sqlite3.connect(self.source)
        connection.execute(
            "UPDATE sales_order_lines SET ship_time = 'not-a-date' WHERE source_line_key = 'L1'"
        )
        connection.commit()
        connection.close()

        with self.assertRaisesMessage(CommandError, "无法生成业务日期"):
            self.run_command(dry_run=True)
        self.assertEqual(SalesOrderLine.objects.count(), 0)
        self.assertEqual(SalesMigrationRun.objects.get().status, "failed")

    def test_source_row_id_changes_and_target_id_collisions_do_not_change_identity_or_digest(self) -> None:
        approval = self.approved_dry_run()
        self.apply_approved(approval)
        target_ids = dict(SalesOrderLine.objects.values_list("source_line_key", "id"))
        first_digest = SalesMigrationRun.objects.get(status="completed").source_digests["sales_order_lines"]

        connection = sqlite3.connect(self.source)
        # Move L2 away, then assign L1 a D1 id that is already owned by L2 in
        # Django. The D1 id is deliberately neither payload nor identity.
        connection.execute("UPDATE sales_order_lines SET id = 1000000 WHERE source_line_key = 'L2'")
        connection.execute(
            "UPDATE sales_order_lines SET id = ? WHERE source_line_key = 'L1'",
            (target_ids["L2"],),
        )
        connection.commit()
        connection.close()

        second_approval = self.approved_dry_run()
        self.apply_approved(second_approval)
        second_run = SalesMigrationRun.objects.filter(status="completed").order_by("-started_at").first()
        self.assertEqual(second_run.source_digests["sales_order_lines"], first_digest)
        self.assertEqual(
            dict(SalesOrderLine.objects.values_list("source_line_key", "id")),
            target_ids,
        )
        self.assertIn('"status": "verified"', self.run_command(verify_only=True))

    def test_non_ascii_stable_keys_use_explicit_binary_digest_order(self) -> None:
        connection = sqlite3.connect(self.source)
        connection.execute("UPDATE sales_order_lines SET source_line_key = 'a-中文' WHERE id = 1")
        connection.execute("UPDATE sales_order_lines SET source_line_key = 'B-éclair' WHERE id = 2")
        connection.commit()
        connection.close()

        approval = self.approved_dry_run()
        self.apply_approved(approval)
        self.assertEqual(
            list(
                SalesOrderLine.objects.order_by("source_line_key").values_list(
                    "source_line_key", flat=True
                )
            ),
            ["B-éclair", "a-中文"],
        )
        self.assertIn('"status": "verified"', self.run_command(verify_only=True))

    def test_target_binary_collation_is_fixed_for_supported_databases(self) -> None:
        self.assertEqual(_target_binary_collation("sqlite"), "BINARY")
        self.assertEqual(_target_binary_collation("postgresql"), "C")

    def test_dry_run_does_not_change_business_tables(self) -> None:
        output = self.run_command(dry_run=True)
        self.assertIn('"status": "dry_run_completed"', output)
        self.assertIn(f'"canonicalFormatVersion": "{CANONICAL_FORMAT_VERSION}"', output)
        self.assertEqual(SalesOrderLine.objects.count(), 0)
        run = SalesMigrationRun.objects.get()
        self.assertEqual(run.status, "dry_run_completed")
        self.assertEqual(run.canonical_format_version, CANONICAL_FORMAT_VERSION)
        self.assertTrue(run.source_counts)
        self.assertTrue(run.source_digests)

    def test_omitted_mode_and_apply_without_approval_never_write(self) -> None:
        with self.assertRaisesMessage(CommandError, "必须显式选择"):
            self.run_command()
        with self.assertRaisesMessage(CommandError, "--approved-run-id"):
            self.run_command(apply=True)
        self.assertEqual(SalesOrderLine.objects.count(), 0)
        self.assertFalse(SalesMigrationRun.objects.exists())

    def test_apply_rejects_approval_from_another_source_path(self) -> None:
        approval = self.approved_dry_run()
        alternate = Path(self.temporary.name) / "same-content-other-path.sqlite"
        alternate.write_bytes(self.source.read_bytes())
        with self.assertRaisesMessage(CommandError, "source_path_digest"):
            self.apply_approved(approval, source=alternate)
        self.assertEqual(SalesOrderLine.objects.count(), 0)
        self.assertFalse(SalesMigrationRun.objects.get(id=approval).consumed_by_run_id)

    def test_apply_rejects_content_changed_after_approval_even_when_stat_fingerprint_is_restored(self) -> None:
        approval = self.approved_dry_run()
        approved_stat = self.source.stat()
        connection = sqlite3.connect(self.source)
        connection.execute("UPDATE sales_order_lines SET product_name = 'changed' WHERE source_line_key = 'L1'")
        connection.commit()
        connection.close()
        os.utime(self.source, ns=(approved_stat.st_atime_ns, approved_stat.st_mtime_ns))

        with self.assertRaisesMessage(CommandError, "source_digests"):
            self.apply_approved(approval)
        self.assertEqual(SalesOrderLine.objects.count(), 0)
        self.assertFalse(SalesMigrationRun.objects.get(id=approval).consumed_by_run_id)

    def test_unrelated_file_mtime_change_does_not_replace_full_business_digest_approval(self) -> None:
        approval = self.approved_dry_run()
        stat = self.source.stat()
        os.utime(
            self.source,
            ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000),
        )
        self.apply_approved(approval)
        self.assertEqual(SalesOrderLine.objects.count(), 2)
        self.assertTrue(SalesMigrationRun.objects.get(id=approval).consumed_by_run_id)

    def test_apply_rejects_revision_changed_after_approval(self) -> None:
        approval = self.approved_dry_run()
        approved_stat = self.source.stat()
        connection = sqlite3.connect(self.source)
        connection.execute("UPDATE sales_overview_cache_state SET sales_revision = 9 WHERE id = 1")
        connection.commit()
        connection.close()
        os.utime(self.source, ns=(approved_stat.st_atime_ns, approved_stat.st_mtime_ns))

        with self.assertRaisesMessage(CommandError, "source_revision"):
            self.apply_approved(approval)
        self.assertEqual(SalesOrderLine.objects.count(), 0)
        self.assertFalse(SalesMigrationRun.objects.get(id=approval).consumed_by_run_id)

    def test_approval_is_consumed_atomically_and_only_once(self) -> None:
        approval_id = self.approved_dry_run()
        completed = json.loads(self.apply_approved(approval_id))
        approval = SalesMigrationRun.objects.get(id=approval_id)
        apply_run = SalesMigrationRun.objects.get(id=completed["runId"])
        self.assertEqual(approval.consumed_by_run_id, apply_run.id)
        self.assertIsNotNone(approval.approval_consumed_at)
        self.assertEqual(apply_run.approved_run_id, approval.id)

        with self.assertRaisesMessage(CommandError, "已被消费"):
            self.apply_approved(approval_id)
        self.assertEqual(SalesOrderLine.objects.count(), 2)
        approval.refresh_from_db()
        self.assertEqual(approval.consumed_by_run_id, apply_run.id)

    def test_source_cannot_alias_the_django_sqlite_target(self) -> None:
        with patch.dict(target_connection.settings_dict, {"NAME": str(self.source)}):
            with self.assertRaisesMessage(CommandError, "不能与 Django SQLite 目标使用同一文件"):
                self.run_command(dry_run=True)
        self.assertFalse(SalesMigrationRun.objects.exists())

    def test_source_revision_drift_rolls_back_business_snapshot(self) -> None:
        approval = self.approved_dry_run()
        with patch(
            "sales.management.commands.migrate_sales_from_d1._read_live_source_revision",
            return_value=(9, 5),
        ):
            with self.assertRaisesMessage(Exception, "版本水位在迁移期间变化"):
                self.apply_approved(approval)
        self.assertEqual(SalesOrderLine.objects.count(), 0)
        approval_run = SalesMigrationRun.objects.get(id=approval)
        self.assertFalse(approval_run.consumed_by_run_id)
        self.assertIsNone(approval_run.approval_consumed_at)
        self.assertEqual(SalesMigrationRun.objects.filter(status="failed").count(), 1)
