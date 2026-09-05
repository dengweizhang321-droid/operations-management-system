from __future__ import annotations

import io
import gc
import json
from contextlib import contextmanager
from pathlib import Path
import sqlite3
import tempfile

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from access_control.models import (
    AccessControlDataRevision,
    AccessControlMigrationRun,
    AccessControlWriteAuthority,
    AppUser,
    PermissionAuditEvent,
)


BOOTSTRAP = "dengweizhang321@gmail.com"


def _create_source(path: Path) -> None:
    with sqlite3.connect(path) as source:
        source.executescript(
            """
            CREATE TABLE app_users (
              email TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL,
              status TEXT NOT NULL, scope_json TEXT, created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            INSERT INTO app_users VALUES
              ('dengweizhang321@gmail.com','系统管理员','admin','active',NULL,
               '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'),
              ('agent@example.com','分析员甲','analyst','active',
               '{"warehouses":["主仓"],"channels":[],"platforms":["京东"]}',
               '2026-02-01T00:00:00Z','2026-02-02T00:00:00Z');
            """
        )


def _command(name: str, **options: object) -> dict[str, object]:
    output = io.StringIO()
    call_command(name, stdout=output, **options)
    return json.loads(output.getvalue())


def _statements(name: str) -> list[str]:
    source = (Path(__file__).resolve().parents[3] / "drizzle" / name).read_text(encoding="utf-8")
    return [statement.strip() for statement in source.split("--> statement-breakpoint") if statement.strip()]


@contextmanager
def _source_fixture():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        source_path = Path(directory) / "source.sqlite"
        _create_source(source_path)
        try:
            yield source_path
        finally:
            # CPython 3.14 can defer collection of closed sqlite connection cycles
            # on Windows, which otherwise keeps the fixture file open at cleanup.
            gc.collect()


class AccessControlMigrationTests(TestCase):
    def test_exact_dry_run_apply_and_verify_only(self) -> None:
        with _source_fixture() as source_path:
            dry_run = _command(
                "migrate_access_control_from_d1", source=str(source_path), mode="dry-run"
            )
            self.assertEqual(dry_run["counts"], {
                "users": 2, "active": 2, "disabled": 0, "restricted": 1, "admins": 1,
            })
            applied = _command(
                "migrate_access_control_from_d1", source=str(source_path), mode="apply",
                approve_run_id=dry_run["runId"],
            )
            self.assertEqual(applied["sourceDigest"], applied["targetDigest"])
            self.assertEqual(set(AppUser.objects.values_list("email", flat=True)), {BOOTSTRAP, "agent@example.com"})
            self.assertEqual(PermissionAuditEvent.objects.filter(action="d1_users_migrated").count(), 1)
            revision = AccessControlDataRevision.objects.get(domain="access-control")
            self.assertGreaterEqual(revision.revision, 1)
            self.assertEqual(revision.source_digest, applied["sourceDigest"])
            authority = AccessControlWriteAuthority.objects.get(id=1)
            self.assertEqual(authority.status, "d1")
            self.assertEqual(authority.migration_verify_run_id, applied["runId"])
            verified = _command(
                "migrate_access_control_from_d1", source=str(source_path), mode="verify-only"
            )
            self.assertEqual(verified["sourceDigest"], verified["targetDigest"])

            with self.assertRaises(CommandError):
                _command(
                    "migrate_access_control_from_d1", source=str(source_path), mode="apply",
                    approve_run_id=dry_run["runId"],
                )

    def test_apply_rejects_changed_source_after_dry_run(self) -> None:
        with _source_fixture() as source_path:
            dry_run = _command(
                "migrate_access_control_from_d1", source=str(source_path), mode="dry-run"
            )
            with sqlite3.connect(source_path) as source:
                source.execute(
                    "UPDATE app_users SET display_name='已变更' WHERE email='agent@example.com'"
                )
            with self.assertRaises(CommandError):
                _command(
                    "migrate_access_control_from_d1", source=str(source_path), mode="apply",
                    approve_run_id=dry_run["runId"],
                )
            self.assertFalse(
                AccessControlMigrationRun.objects.filter(mode="apply").exists()
            )

    def test_authority_handoff_and_terminal_d1_guards(self) -> None:
        with _source_fixture() as source_path:
            dry_run = _command(
                "migrate_access_control_from_d1", source=str(source_path), mode="dry-run"
            )
            applied = _command(
                "migrate_access_control_from_d1", source=str(source_path), mode="apply",
                approve_run_id=dry_run["runId"],
            )
            with sqlite3.connect(source_path) as source:
                for statement in _statements("0111_access_control_write_authority.sql"):
                    source.execute(statement)

            cutover_id = "access-control-test-cutover"
            prepared = _command(
                "access_control_write_authority", source=str(source_path), prepare=True,
                approved_run_id=applied["runId"], cutover_id=cutover_id,
            )
            self.assertEqual(prepared["status"], "prepared")
            with sqlite3.connect(source_path) as source, self.assertRaises(sqlite3.IntegrityError):
                source.execute("UPDATE app_users SET display_name='blocked' WHERE email=?", (BOOTSTRAP,))

            _command(
                "access_control_write_authority", source=str(source_path), abort_pending=True,
                approved_run_id=applied["runId"], cutover_id=cutover_id,
            )
            _command(
                "access_control_write_authority", source=str(source_path), prepare=True,
                approved_run_id=applied["runId"], cutover_id=cutover_id,
            )
            activated = _command(
                "access_control_write_authority", source=str(source_path), activate=True,
                approved_run_id=applied["runId"], cutover_id=cutover_id,
            )
            self.assertEqual(activated["status"], "activated")
            self.assertEqual(AccessControlWriteAuthority.objects.get(id=1).status, "postgres")

            retirement = _statements("0112_access_control_domain_retirement.sql")
            with sqlite3.connect(source_path, isolation_level=None) as source:
                source.execute("BEGIN IMMEDIATE")
                for statement in retirement[:4]:
                    source.execute(statement)
                digest = "a" * 64
                source.execute(
                    """INSERT INTO domain_retirement_receipts
                    (domain,version,status,cutover_id,plan_id,attestation_sha256,
                     smoke_receipt_sha256,preflight_evidence_sha256,migration_sha256,
                     audit_id,preserved_evidence_sha256,created_at,completed_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)""",
                    (
                        "access-control", "access-control-domain-retirement-receipt-v1",
                        "approved", cutover_id, digest, digest, digest, digest, digest,
                        digest, digest, "2026-09-05T00:00:00Z",
                    ),
                )
                for statement in retirement[4:]:
                    source.execute(statement)
                source.commit()
                self.assertEqual(source.execute("SELECT COUNT(*) FROM app_users").fetchone()[0], 0)
                self.assertEqual(
                    source.execute("SELECT status FROM domain_retirement_receipts WHERE domain='access-control'").fetchone()[0],
                    "completed",
                )
                for sql in (
                    "INSERT INTO app_users(email) VALUES ('x')",
                    "INSERT INTO access_control_write_authority(id) VALUES (1)",
                ):
                    with self.assertRaises(sqlite3.IntegrityError):
                        source.execute(sql)
                for sql in (
                    "UPDATE app_users SET email='x'",
                    "DELETE FROM app_users",
                    "UPDATE access_control_write_authority SET id=1",
                    "DELETE FROM access_control_write_authority",
                ):
                    source.execute(sql)
                self.assertEqual(source.execute("SELECT COUNT(*) FROM app_users").fetchone()[0], 0)
                self.assertEqual(source.execute("SELECT COUNT(*) FROM access_control_write_authority").fetchone()[0], 0)
