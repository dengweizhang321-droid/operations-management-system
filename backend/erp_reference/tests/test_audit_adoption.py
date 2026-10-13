"""Real PostgreSQL transaction/schema regression for the finite audit append."""
from datetime import timedelta
from pathlib import Path
import sys
from unittest.mock import patch

from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from django.test import TransactionTestCase
from django.utils import timezone

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))
import jackyun_audit_addition as addition
from jackyun_audit_catalog import original_rows, verify_catalog
from postgres_no_key_backup import verify_receipt_generation

OLD = [("erp_reference", "0002_erpproductmaster_erpreferenceimportscopehead_and_more"), ("sales", "0010_analysis_options")]


class AuditAdoptionTests(TransactionTestCase):
    def setUp(self):
        if connection.vendor != "postgresql":
            self.fail("This evidence requires real isolated PostgreSQL")
        executor = MigrationExecutor(connection)
        self.leaves = executor.loader.graph.leaf_nodes()
        executor.migrate(OLD)
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(self.leaves))
        apps = MigrationExecutor(connection).loader.project_state(OLD).apps
        apps.get_model("erp_reference", "ErpReferenceImportAttempt").objects.create(
            source_key="products", actor_email="fixture@example.test", raw_file_hash="1" * 64,
            outcome="rejected", file_name="fixture.xlsx", file_size_bytes=512)
        apps.get_model("sales", "SalesImportAttempt").objects.create(
            id="fixture-audit", actor_email="fixture@example.test", raw_file_hash="2" * 64,
            outcome="rejected", file_name="fixture.xlsx", file_size_bytes=512)
        apps.get_model("sales", "SalesRawUploadSession").objects.create(
            actor_email="fixture@example.test", client_fingerprint="fixture", file_name="fixture.xlsx", file_size_bytes=512,
            chunk_size_bytes=1048576, chunk_count=1, expected_start_date="2026-10-01", expected_end_date="2026-10-12",
            expires_at=timezone.now() + timedelta(hours=1))
        self.base = {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
        self.assertEqual(len(self.base), 140)

    def test_upgrade_preserves_audits_and_legacy_uploads_and_rejects_replay(self):
        before = original_rows(connection)
        with connection.cursor() as cursor:
            self.assertEqual(verify_receipt_generation(cursor), 140)
        old, new = addition.apply_steps(connection, self.base, expected_before=before)
        self.assertEqual(old, before); self.assertEqual(new, before)
        with connection.cursor() as cursor:
            self.assertEqual(verify_receipt_generation(cursor), 142)
            for table in ("erp_reference_import_attempts", "sales_import_attempts"):
                cursor.execute(f"SELECT raw_upload_id,upload_fingerprint FROM {table}")
                self.assertTrue(all(row == ("", "") for row in cursor.fetchall()))
            cursor.execute("SELECT publication_baseline='{}'::jsonb FROM sales_raw_upload_sessions")
            self.assertEqual(cursor.fetchall(), [(True,)])
        with self.assertRaises(ValueError): addition.apply_steps(connection, self.base)
        self.assertEqual(original_rows(connection), before)

    def test_late_failure_rolls_back_both_schema_and_migration_receipts(self):
        before = original_rows(connection)
        actual = addition.verify_catalog
        def reject_after(cursor, *, installed):
            actual(cursor, installed=installed)
            if installed: raise ValueError("synthetic failure after both migrations")
        with patch.object(addition, "verify_catalog", side_effect=reject_after):
            with self.assertRaisesMessage(ValueError, "synthetic failure"):
                addition.apply_steps(connection, self.base)
        self.assertEqual({".".join(x) for x in MigrationRecorder(connection).applied_migrations()}, self.base)
        with connection.cursor() as cursor:
            verify_catalog(cursor, installed=False)
            self.assertEqual(verify_receipt_generation(cursor), 140)
        self.assertEqual(original_rows(connection), before)

    def test_wrong_intent_unknown_receipt_and_half_generation_are_rejected(self):
        wrong = original_rows(connection); wrong["sales_import_attempts"]["sha256"] = "e" * 64
        with self.assertRaisesMessage(ValueError, "install intent"):
            addition.apply_steps(connection, self.base, expected_before=wrong)
        MigrationExecutor(connection).migrate([tuple(addition.STEPS[0].split(".", 1))])
        with connection.cursor() as cursor:
            with self.assertRaises(RuntimeError): verify_receipt_generation(cursor)
        with self.assertRaises(ValueError): addition.apply_steps(connection, self.base)

    def test_missing_index_wrong_type_and_unrecorded_schema_are_rejected(self):
        with connection.cursor() as cursor, transaction.atomic():
            cursor.execute("ALTER TABLE sales_raw_upload_sessions ADD COLUMN publication_baseline jsonb")
            with self.assertRaises(ValueError): verify_receipt_generation(cursor)
            transaction.set_rollback(True)
        addition.apply_steps(connection, self.base)
        with connection.cursor() as cursor, transaction.atomic():
            cursor.execute("ALTER TABLE sales_import_attempts ALTER COLUMN raw_upload_id TYPE varchar(35)")
            with self.assertRaises(ValueError): verify_receipt_generation(cursor)
            transaction.set_rollback(True)
        with connection.cursor() as cursor, transaction.atomic():
            cursor.execute("SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid "
                           "JOIN pg_attribute a ON a.attrelid=i.indrelid AND i.indkey[0]=a.attnum "
                           "WHERE i.indrelid='public.sales_import_attempts'::regclass AND a.attname='upload_fingerprint' LIMIT 1")
            from psycopg import sql
            cursor.execute(sql.SQL("DROP INDEX {}").format(sql.Identifier(cursor.fetchone()[0])))
            with self.assertRaises(ValueError): verify_receipt_generation(cursor)
            transaction.set_rollback(True)

    def test_ordinary_reader_cannot_apply_ddl_or_change_migration_records(self):
        with connection.cursor() as cursor, transaction.atomic():
            cursor.execute("SET LOCAL ROLE teruisi_finance_reader")
            with self.assertRaises(Exception):
                with transaction.atomic(): cursor.execute("ALTER TABLE sales_import_attempts ADD COLUMN forbidden integer")
            with self.assertRaises(Exception):
                with transaction.atomic(): cursor.execute("INSERT INTO django_migrations(app,name,applied) VALUES('foreign','0001_wrong',now())")
            transaction.set_rollback(True)
