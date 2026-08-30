#!/usr/bin/env python
"""Create and inspect a PostgreSQL backup with snapshot-bound evidence.

Credentials and connection coordinates are read only from libpq's PG*
environment variables.  The command prints one bounded JSON object and never
prints a connection string or native stderr.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import psycopg
from psycopg import sql


VERSION = "teruisi-postgres-consistent-backup-v1"
ALLOWED_TABLE_PREFIXES = ("sales_", "erp_", "finance_")
MAX_NATIVE_DIAGNOSTIC_BYTES = 16 * 1024


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _safe_native_diagnostic(completed: subprocess.CompletedProcess[bytes]) -> dict[str, Any]:
    stdout = completed.stdout or b""
    stderr = completed.stderr or b""
    bounded = (stdout + b"\n" + stderr)[:MAX_NATIVE_DIAGNOSTIC_BYTES]
    return {
        "exitCode": int(completed.returncode),
        "outputBytes": int(len(stdout) + len(stderr)),
        "capturedBytes": int(len(bounded)),
        "outputTruncated": len(stdout) + len(stderr) > len(bounded),
        "outputSha256": _sha256_bytes(bounded),
    }


def _table_names(cursor: psycopg.Cursor[Any]) -> list[str]:
    cursor.execute(
        "SELECT tablename FROM pg_catalog.pg_tables "
        "WHERE schemaname = 'public' ORDER BY tablename"
    )
    names = []
    for (name,) in cursor.fetchall():
        text = str(name)
        if text == "django_migrations" or text.startswith(ALLOWED_TABLE_PREFIXES):
            names.append(text)
    return names


def _canonical_loopback_address(value: Any) -> str:
    address = str(value).split("/", 1)[0]
    if address not in ("127.0.0.1", "::1"):
        raise RuntimeError("database is not bound to a loopback address")
    return address


def collect_evidence(
    connection: psycopg.Connection[Any],
    expected_database: str,
    expected_user: str,
) -> dict[str, Any]:
    """Collect exact, deterministic evidence from the current transaction."""

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT current_database(), current_user, "
            "COALESCE(inet_server_addr()::text, ''), inet_server_port(), "
            "pg_is_in_recovery(), current_setting('server_version_num')::integer"
        )
        identity = cursor.fetchone()
        if identity is None:
            raise RuntimeError("database identity probe returned no row")
        database_name, database_user, server_address, server_port, recovery, version = identity
        if str(database_name) != expected_database or str(database_user) != expected_user:
            raise RuntimeError("database identity does not match the approved target")
        canonical_server_address = _canonical_loopback_address(server_address)

        tables = _table_names(cursor)
        required = {
            "django_migrations",
            "sales_data_revisions",
            "sales_import_batches",
            "sales_order_lines",
            "sales_write_authority",
            "erp_product_master",
        }
        missing = sorted(required.difference(tables))
        if missing:
            raise RuntimeError("required database tables are missing")

        row_counts: dict[str, int] = {}
        for table in tables:
            cursor.execute(
                sql.SQL("SELECT COUNT(*) FROM {}").format(
                    sql.Identifier("public", table)
                )
            )
            row_counts[table] = int(cursor.fetchone()[0])

        cursor.execute(
            "SELECT app, name FROM django_migrations ORDER BY app, name"
        )
        migrations = [
            {"app": str(app), "name": str(name)}
            for app, name in cursor.fetchall()
        ]
        if not migrations:
            raise RuntimeError("django migration evidence is empty")

        cursor.execute(
            "SELECT domain, revision FROM sales_data_revisions ORDER BY domain"
        )
        revisions = {
            str(domain): int(revision) for domain, revision in cursor.fetchall()
        }
        if "sales" not in revisions or "erp" not in revisions:
            raise RuntimeError("sales/erp revision evidence is incomplete")

        cursor.execute(
            "SELECT status, authority_epoch::text, cutover_id "
            "FROM sales_write_authority WHERE id = 1"
        )
        authority = cursor.fetchone()
        if authority is None:
            raise RuntimeError("sales write authority singleton is missing")
        authority_status, authority_epoch, cutover_id = authority
        if str(authority_status) != "active" or not str(authority_epoch) or not str(cutover_id):
            raise RuntimeError("sales write authority is not active")

    content = {
        "tables": row_counts,
        "migrations": migrations,
        "revisions": revisions,
        "writeAuthority": {
            "status": str(authority_status),
            "authorityEpoch": str(authority_epoch),
            "cutoverId": str(cutover_id),
        },
    }
    content_bytes = json.dumps(
        content, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode("ascii")
    canonical = {
        "database": {
            "name": str(database_name),
            "user": str(database_user),
            "serverAddress": canonical_server_address,
            "serverPort": int(server_port),
            "inRecovery": bool(recovery),
            "serverVersionNumber": int(version),
        },
        **content,
        "contentSha256": _sha256_bytes(content_bytes),
    }
    canonical_bytes = json.dumps(
        canonical, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode("ascii")
    return {
        **canonical,
        "canonicalSha256": _sha256_bytes(canonical_bytes),
    }


def _validate_leaf(path_value: str, label: str) -> Path:
    path = Path(path_value).resolve(strict=True)
    if not path.is_file():
        raise RuntimeError(f"{label} is not a regular file")
    return path


def _validate_new_output(path_value: str) -> Path:
    path = Path(path_value).resolve(strict=False)
    if path.exists():
        raise RuntimeError("backup output already exists")
    parent = path.parent.resolve(strict=True)
    if not parent.is_dir() or path.parent != parent:
        raise RuntimeError("backup output parent is invalid")
    if path.suffix != ".dump":
        raise RuntimeError("backup output must use the .dump extension")
    return path


def run_backup(args: argparse.Namespace) -> dict[str, Any]:
    pg_dump = _validate_leaf(args.pg_dump, "pg_dump")
    output = _validate_new_output(args.output)
    completed: subprocess.CompletedProcess[bytes] | None = None

    try:
        with psycopg.connect("") as connection:
            connection.execute(
                "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
            )
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_export_snapshot()")
                snapshot = str(cursor.fetchone()[0])
            evidence = collect_evidence(
                connection,
                expected_database=args.expected_database,
                expected_user=args.expected_user,
            )
            command = [
                str(pg_dump),
                "--host=127.0.0.1",
                f"--port={int(args.port)}",
                f"--username={args.expected_user}",
                f"--dbname={args.expected_database}",
                "--format=custom",
                "--compress=6",
                "--no-owner",
                "--no-privileges",
                "--lock-wait-timeout=5000",
                f"--snapshot={snapshot}",
                f"--file={output}",
            ]
            completed = subprocess.run(
                command,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=int(args.timeout_seconds),
                env=os.environ.copy(),
            )
            if completed.returncode != 0:
                raise RuntimeError("pg_dump failed")
            if not output.is_file() or output.stat().st_size < 1:
                raise RuntimeError("pg_dump produced an empty archive")
            connection.commit()
        return {
            "version": VERSION,
            "status": "completed",
            "snapshotIdSha256": _sha256_bytes(snapshot.encode("utf-8")),
            "evidence": evidence,
            "nativeDiagnostic": _safe_native_diagnostic(completed),
        }
    except subprocess.TimeoutExpired as exc:
        bounded = ((exc.stdout or b"") + b"\n" + (exc.stderr or b""))[
            :MAX_NATIVE_DIAGNOSTIC_BYTES
        ]
        raise RuntimeError(
            "pg_dump timed out; diagnosticSha256=" + _sha256_bytes(bounded)
        ) from None
    except Exception:
        if output.exists():
            output.unlink()
        raise


def run_probe(args: argparse.Namespace) -> dict[str, Any]:
    with psycopg.connect("") as connection:
        connection.execute(
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
        )
        evidence = collect_evidence(
            connection,
            expected_database=args.expected_database,
            expected_user=args.expected_user,
        )
        connection.rollback()
    return {
        "version": VERSION,
        "status": "completed",
        "evidence": evidence,
    }


def run_restore(args: argparse.Namespace) -> dict[str, Any]:
    pg_restore = _validate_leaf(args.pg_restore, "pg_restore")
    archive = _validate_leaf(args.archive, "backup archive")
    command = [
        str(pg_restore),
        "--host=127.0.0.1",
        f"--port={int(args.port)}",
        f"--username={args.expected_user}",
        f"--dbname={args.expected_database}",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        str(archive),
    ]
    try:
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=int(args.timeout_seconds),
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired as exc:
        bounded = ((exc.stdout or b"") + b"\n" + (exc.stderr or b""))[
            :MAX_NATIVE_DIAGNOSTIC_BYTES
        ]
        raise RuntimeError(
            "pg_restore timed out; diagnosticSha256=" + _sha256_bytes(bounded)
        ) from None
    if completed.returncode != 0:
        diagnostic = _safe_native_diagnostic(completed)
        raise RuntimeError(
            "pg_restore failed; diagnosticSha256=" + diagnostic["outputSha256"]
        )
    return {
        "version": VERSION,
        "status": "completed",
        "nativeDiagnostic": _safe_native_diagnostic(completed),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup = subparsers.add_parser("backup")
    backup.add_argument("--pg-dump", required=True)
    backup.add_argument("--output", required=True)
    backup.add_argument("--expected-database", required=True)
    backup.add_argument("--expected-user", required=True)
    backup.add_argument("--port", required=True, type=int)
    backup.add_argument("--timeout-seconds", type=int, default=1800)

    probe = subparsers.add_parser("probe")
    probe.add_argument("--expected-database", required=True)
    probe.add_argument("--expected-user", required=True)

    restore = subparsers.add_parser("restore")
    restore.add_argument("--pg-restore", required=True)
    restore.add_argument("--archive", required=True)
    restore.add_argument("--expected-database", required=True)
    restore.add_argument("--expected-user", required=True)
    restore.add_argument("--port", required=True, type=int)
    restore.add_argument("--timeout-seconds", type=int, default=1800)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "backup":
            result = run_backup(args)
        elif args.command == "restore":
            result = run_restore(args)
        else:
            result = run_probe(args)
        print(json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
        return 0
    except Exception as exc:
        message = str(exc)
        # Never surface a URL or a credential-bearing native diagnostic.
        if "://" in message or "password" in message.lower():
            message = "database maintenance failed with redacted diagnostics"
        print(
            json.dumps(
                {
                    "version": VERSION,
                    "status": "failed",
                    "errorType": type(exc).__name__,
                    "errorSha256": _sha256_bytes(message.encode("utf-8")),
                },
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
