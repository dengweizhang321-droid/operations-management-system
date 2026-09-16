from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "postgres-consistent-backup.py"
SPEC = importlib.util.spec_from_file_location("postgres_consistent_backup", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
sys.path.insert(0, str(ROOT / "backend"))
from ai_assistant.table_manifest import AI_TABLES
PRE_EVIDENCE_TABLES = set(AI_TABLES) - {"ai_business_evidence_runs", "ai_business_evidence_chunks", "ai_business_file_runs", "ai_business_file_chunks", "ai_business_evidence_sources"}


class _EvidenceCursor:
    def __init__(self, tables, migrations):
        self.tables = sorted(tables)
        self.migrations = sorted(migrations)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, statement):
        query = statement if isinstance(statement, str) else statement.as_string()
        if "current_database()" in query:
            self.rows = [("fixture", "fixture_owner", "127.0.0.1/32", 15479, False, 170011)]
        elif "pg_catalog.pg_tables" in query:
            self.rows = [(table,) for table in self.tables]
        elif "SELECT app, name FROM django_migrations" in query:
            self.rows = self.migrations
        elif query.startswith("SELECT COUNT(*)"):
            self.rows = [(0,)]
        elif "FROM sales_data_revisions" in query:
            self.rows = [("sales", 1), ("erp", 1)]
        elif "FROM sales_write_authority" in query:
            self.rows = [("active", "11111111-1111-1111-1111-111111111111", "fixture-cutover")]
        elif "FROM ai_data_revisions" in query:
            self.rows = [(0, "")]
        elif "FROM ai_write_authority" in query:
            self.rows = [("d1", "", "", "")]
        else:
            raise AssertionError("Unexpected evidence query: " + query)

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0]


def _ai_evidence(tables, migrations):
    base_tables = {
        "django_migrations", "sales_data_revisions", "sales_import_batches",
        "sales_order_lines", "sales_write_authority", "erp_product_master",
    }
    cursor = _EvidenceCursor(base_tables | set(tables), [("sales", "0001_initial"), *migrations])
    connection = mock.Mock()
    connection.cursor.return_value = cursor
    return MODULE.collect_evidence(connection, "fixture", "fixture_owner")


class _SnapshotCursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, statement):
        self.statement = statement

    def fetchone(self):
        return ("00000003-00000001-1",)


class _SnapshotConnection:
    def __init__(self):
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, statement):
        self.statement = statement

    def cursor(self):
        return _SnapshotCursor()

    def commit(self):
        self.committed = True


class ConsistentBackupTests(unittest.TestCase):
    def test_business_evidence_tables_require_exact_migration_generation(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py") if p.stem[:4].isdigit() and int(p.stem[:4]) <= 19)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 61)
        before_directory = _ai_evidence(set(AI_TABLES)-{"ai_business_evidence_sources"}, [m for m in migrations if int(m[1][:4]) <= 18])
        self.assertEqual(len([name for name in before_directory["tables"] if name.startswith("ai_")]), 60)
        previous = [item for item in migrations if int(item[1][:4]) <= 13]
        self.assertEqual(len([name for name in _ai_evidence(PRE_EVIDENCE_TABLES, previous)["tables"] if name.startswith("ai_")]), 56)
        for tables, history in [(set(AI_TABLES)-{"ai_business_evidence_chunks"}, migrations), (set(AI_TABLES)-{"ai_business_file_chunks"}, migrations), (AI_TABLES, previous), (AI_TABLES, [m for m in migrations if m[1] != "0013_dingtalk_schedule_media"]), (AI_TABLES, [m for m in migrations if m[1] != "0015_business_collection"])]:
            with self.assertRaises(RuntimeError):
                _ai_evidence(tables, history)
        for missing in ("0014_business_evidence", "0015_business_collection", "0016_business_files", "0017_business_file_renderer", "0018_business_excel_renderer", "0019_business_source_directory"):
            with self.subTest(missing=missing), self.assertRaises(RuntimeError):
                _ai_evidence(AI_TABLES, [m for m in migrations if m[1] != missing])
        with self.assertRaises(RuntimeError):
            _ai_evidence(set(AI_TABLES)-{"ai_business_evidence_sources"}, migrations)

    def test_evidence_accepts_both_backup_generations_with_stable_content_digest(self):
        legacy_tables = set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_conversation_workspaces", "ai_dingtalk_sessions", "ai_dingtalk_receipts", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}
        legacy_migrations = [("ai_assistant", "0001_initial"), ("ai_assistant", "0005_postgres_image_payload")]
        legacy = _ai_evidence(legacy_tables, legacy_migrations)
        current = _ai_evidence(PRE_EVIDENCE_TABLES, [*legacy_migrations, ("ai_assistant", "0006_conversation_workspaces"), ("ai_assistant", "0007_dingtalk_readonly"), ("ai_assistant", "0008_dingtalk_settings"), ("ai_assistant", "0009_model_generation_capabilities"), ("ai_assistant", "0010_dingtalk_schedules"), ("ai_assistant", "0011_prompt_settings"), ("ai_assistant", "0012_report_library"), ("ai_assistant", "0013_dingtalk_schedule_media")])
        pre_settings = _ai_evidence(set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}, [*legacy_migrations, ("ai_assistant", "0006_conversation_workspaces"), ("ai_assistant", "0007_dingtalk_readonly")])
        self.assertEqual(len([name for name in pre_settings["tables"] if name.startswith("ai_")]), 48)
        pre_dingtalk = _ai_evidence(set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_dingtalk_sessions", "ai_dingtalk_receipts", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}, [*legacy_migrations, ("ai_assistant", "0006_conversation_workspaces")])
        self.assertEqual(len([name for name in pre_dingtalk["tables"] if name.startswith("ai_")]), 46)
        self.assertEqual(len([name for name in legacy["tables"] if name.startswith("ai_")]), 45)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 56)
        self.assertEqual(legacy["contentSha256"], _ai_evidence(legacy_tables, legacy_migrations)["contentSha256"])
        self.assertNotEqual(legacy["contentSha256"], current["contentSha256"])
        self.assertEqual(legacy["aiAssistant"], current["aiAssistant"])

    def test_evidence_rejects_inconsistent_ai_schema_and_migration_inventory(self):
        initial = ("ai_assistant", "0001_initial")
        workspace = ("ai_assistant", "0006_conversation_workspaces")
        legacy_tables = set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_conversation_workspaces", "ai_dingtalk_sessions", "ai_dingtalk_receipts", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}
        for tables, migrations in [
            (legacy_tables, [initial, workspace]),
            (PRE_EVIDENCE_TABLES, [initial]),
            (PRE_EVIDENCE_TABLES, [workspace]),
            (PRE_EVIDENCE_TABLES, []),
            (set(), [initial]),
            (set(), [workspace]),
            (set(PRE_EVIDENCE_TABLES) | {"ai_unknown"}, [initial, workspace]),
        ]:
            with self.subTest(tables=len(tables), migrations=migrations):
                with self.assertRaisesRegex(RuntimeError, "AI .* (inventory|migration)"):
                    _ai_evidence(tables, migrations)

    def test_loopback_identity_normalizes_postgres_inet_cidr_text(self):
        self.assertEqual(
            MODULE._canonical_loopback_address("127.0.0.1/32"),
            "127.0.0.1",
        )
        self.assertEqual(MODULE._canonical_loopback_address("::1/128"), "::1")
        with self.assertRaisesRegex(RuntimeError, "not bound to a loopback"):
            MODULE._canonical_loopback_address("127.0.0.2/32")

    def test_backup_binds_dump_to_exported_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="teruisi-pg-helper-") as temporary:
            root = Path(temporary)
            pg_dump = root / "pg_dump.exe"
            pg_dump.write_bytes(b"fixture")
            output = root / "backup.dump"
            connection = _SnapshotConnection()
            captured_command = []

            def fake_run(command, **kwargs):
                captured_command.extend(command)
                output.write_bytes(b"valid-custom-archive-fixture")
                self.assertEqual(kwargs["timeout"], 77)
                self.assertEqual(kwargs["stdout"], subprocess.PIPE)
                self.assertEqual(kwargs["stderr"], subprocess.PIPE)
                return subprocess.CompletedProcess(command, 0, b"", b"")

            args = argparse.Namespace(
                pg_dump=str(pg_dump),
                output=str(output),
                expected_database="teruisi_sales",
                expected_user="teruisi_sales_owner",
                port=5432,
                timeout_seconds=77,
            )
            with (
                mock.patch.object(MODULE.psycopg, "connect", return_value=connection),
                mock.patch.object(
                    MODULE,
                    "collect_evidence",
                    return_value={"contentSha256": "a" * 64},
                ),
                mock.patch.object(MODULE.subprocess, "run", side_effect=fake_run),
            ):
                result = MODULE.run_backup(args)

            self.assertTrue(connection.committed)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(len(result["snapshotIdSha256"]), 64)
            self.assertIn("--snapshot=00000003-00000001-1", captured_command)
            self.assertIn("--format=custom", captured_command)
            self.assertIn("--no-owner", captured_command)
            self.assertIn("--no-privileges", captured_command)
            self.assertNotIn("password", " ".join(captured_command).lower())

    def test_failed_backup_removes_only_its_new_output(self):
        with tempfile.TemporaryDirectory(prefix="teruisi-pg-helper-") as temporary:
            root = Path(temporary)
            pg_dump = root / "pg_dump.exe"
            pg_dump.write_bytes(b"fixture")
            output = root / "backup.dump"
            connection = _SnapshotConnection()

            def fake_run(command, **kwargs):
                output.write_bytes(b"partial")
                return subprocess.CompletedProcess(command, 9, b"", b"failure")

            args = argparse.Namespace(
                pg_dump=str(pg_dump),
                output=str(output),
                expected_database="teruisi_sales",
                expected_user="teruisi_sales_owner",
                port=5432,
                timeout_seconds=77,
            )
            with (
                mock.patch.object(MODULE.psycopg, "connect", return_value=connection),
                mock.patch.object(MODULE, "collect_evidence", return_value={}),
                mock.patch.object(MODULE.subprocess, "run", side_effect=fake_run),
            ):
                with self.assertRaisesRegex(RuntimeError, "pg_dump failed"):
                    MODULE.run_backup(args)
            self.assertFalse(output.exists())
            self.assertTrue(pg_dump.exists())

    def test_restore_is_single_transaction_and_bounded(self):
        with tempfile.TemporaryDirectory(prefix="teruisi-pg-helper-") as temporary:
            root = Path(temporary)
            pg_restore = root / "pg_restore.exe"
            archive = root / "approved.dump"
            pg_restore.write_bytes(b"fixture")
            archive.write_bytes(b"archive")
            captured_command = []

            def fake_run(command, **kwargs):
                captured_command.extend(command)
                self.assertEqual(kwargs["timeout"], 91)
                return subprocess.CompletedProcess(command, 0, b"", b"")

            args = argparse.Namespace(
                pg_restore=str(pg_restore),
                archive=str(archive),
                expected_database="teruisi_sales",
                expected_user="postgres",
                port=55432,
                timeout_seconds=91,
            )
            with mock.patch.object(MODULE.subprocess, "run", side_effect=fake_run):
                result = MODULE.run_restore(args)
            self.assertEqual(result["status"], "completed")
            self.assertIn("--port=55432", captured_command)
            self.assertIn("--single-transaction", captured_command)
            self.assertIn("--no-owner", captured_command)
            self.assertIn("--no-privileges", captured_command)

    def test_native_diagnostic_is_bounded_and_contains_no_output(self):
        completed = subprocess.CompletedProcess(
            ["fixture"], 4, b"x" * 20000, b"secret-text" * 2000
        )
        diagnostic = MODULE._safe_native_diagnostic(completed)
        self.assertEqual(diagnostic["exitCode"], 4)
        self.assertEqual(diagnostic["capturedBytes"], MODULE.MAX_NATIVE_DIAGNOSTIC_BYTES)
        self.assertTrue(diagnostic["outputTruncated"])
        self.assertEqual(set(diagnostic), {
            "exitCode", "outputBytes", "capturedBytes", "outputTruncated", "outputSha256"
        })


if __name__ == "__main__":
    unittest.main()
