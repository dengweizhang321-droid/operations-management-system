from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "postgres-consistent-backup.py"
SPEC = importlib.util.spec_from_file_location("postgres_consistent_backup", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


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
