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
import re
import subprocess
import sys
from typing import Any

import psycopg
from psycopg import sql


VERSION = "teruisi-postgres-consistent-backup-v1"
ALLOWED_TABLE_PREFIXES = (
    "sales_", "erp_", "finance_", "netshop_", "market_", "product_",
    "inventory_", "replenishment_", "workflow_",
)
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
        netshop_required = {
            "netshop_data_revisions",
            "netshop_import_batches",
            "netshop_rows",
            "netshop_write_authority",
        }
        netshop_tables = {name for name in tables if name.startswith("netshop_")}
        if netshop_tables:
            required.update(netshop_required)
        market_required = {
            "market_data_revisions",
            "market_import_batches",
            "market_ranking_entries",
            "market_write_authority",
        }
        market_tables = {name for name in tables if name.startswith("market_")}
        if market_tables:
            required.update(market_required)
        products_required = {
            "product_data_revisions",
            "product_shipping_rate_import_batches",
            "product_shipping_rates",
            "product_inventory_projection",
            "product_write_authority",
        }
        products_tables = {name for name in tables if name.startswith("product_")}
        if products_tables:
            required.update(products_required)
        inventory_required = {
            "inventory_data_revisions",
            "inventory_import_batches",
            "inventory_stock_lines",
            "inventory_age_lines",
            "inventory_write_authority",
            "inventory_operating_settings",
            "replenishment_plan_items",
            "inventory_replenishment_group_deliveries",
        }
        inventory_tables = {
            name for name in tables
            if name.startswith("inventory_") or name.startswith("replenishment_")
        }
        if inventory_tables:
            required.update(inventory_required)
        workflow_required = {
            "workflow_data_revisions",
            "workflow_write_authority",
            "workflow_operations_write_authority",
            "workflow_new_product_projects",
            "workflow_new_product_targets",
            "workflow_new_product_stages",
            "workflow_new_product_activities",
            "workflow_new_product_lines",
            "workflow_new_product_line_codes",
            "workflow_new_product_weekly_report_config",
            "workflow_new_product_weekly_deliveries",
            "workflow_tasks",
            "workflow_task_comments",
            "workflow_task_activity_logs",
            "workflow_task_reminders",
            "workflow_task_templates",
            "workflow_task_entity_links",
            "workflow_task_attachments",
            "workflow_attachment_cleanup_queue",
            "workflow_operation_records",
            "workflow_operation_activities",
        }
        workflow_tables = {name for name in tables if name.startswith("workflow_")}
        if workflow_tables:
            required.update(workflow_required)
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

        netshop_revisions: dict[str, dict[str, Any]] | None = None
        netshop_authority: dict[str, str] | None = None
        if netshop_tables:
            cursor.execute(
                "SELECT domain, revision, source_digest "
                "FROM netshop_data_revisions ORDER BY domain"
            )
            netshop_revisions = {
                str(domain): {
                    "revision": int(revision),
                    "sourceDigest": str(source_digest),
                }
                for domain, revision, source_digest in cursor.fetchall()
            }
            revision = netshop_revisions.get("netshop")
            if (
                revision is None
                or int(revision["revision"]) < 0
                or re.fullmatch(r"[0-9a-f]{64}", str(revision["sourceDigest"])) is None
            ):
                raise RuntimeError("netshop revision evidence is incomplete")
            cursor.execute(
                "SELECT status, COALESCE(authority_epoch::text, ''), cutover_id, "
                "migration_verify_run_id FROM netshop_write_authority WHERE id = 1"
            )
            netshop_authority_row = cursor.fetchone()
            if netshop_authority_row is None:
                raise RuntimeError("netshop write authority singleton is missing")
            netshop_status, netshop_epoch, netshop_cutover, netshop_run = (
                str(value or "") for value in netshop_authority_row
            )
            if netshop_status not in {"d1", "postgres"}:
                raise RuntimeError("netshop write authority status is invalid")
            if netshop_run and re.fullmatch(r"netshop-[0-9a-f]{24}", netshop_run) is None:
                raise RuntimeError("netshop migration run evidence is invalid")
            if netshop_status == "postgres":
                if (
                    re.fullmatch(r"[0-9a-fA-F-]{36}", netshop_epoch) is None
                    or re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", netshop_cutover) is None
                    or not netshop_run
                ):
                    raise RuntimeError("active netshop write authority evidence is incomplete")
            elif netshop_epoch or netshop_cutover:
                raise RuntimeError("inactive netshop write authority contains activation evidence")
            netshop_authority = {
                "status": netshop_status,
                "authorityEpoch": netshop_epoch,
                "cutoverId": netshop_cutover,
                "migrationRunId": netshop_run,
            }

        market_revisions: dict[str, dict[str, Any]] | None = None
        market_authority: dict[str, str] | None = None
        if market_tables:
            cursor.execute(
                "SELECT domain, revision, source_digest "
                "FROM market_data_revisions ORDER BY domain"
            )
            market_revisions = {
                str(domain): {
                    "revision": int(revision),
                    "sourceDigest": str(source_digest),
                }
                for domain, revision, source_digest in cursor.fetchall()
            }
            revision = market_revisions.get("market")
            if (
                revision is None
                or int(revision["revision"]) < 1
                or re.fullmatch(r"[0-9a-f]{64}", str(revision["sourceDigest"])) is None
            ):
                raise RuntimeError("market revision evidence is incomplete")
            cursor.execute(
                "SELECT status, COALESCE(authority_epoch::text, ''), cutover_id, "
                "migration_verify_run_id FROM market_write_authority WHERE id = 1"
            )
            market_authority_row = cursor.fetchone()
            if market_authority_row is None:
                raise RuntimeError("market write authority singleton is missing")
            market_status, market_epoch, market_cutover, market_run = (
                str(value or "") for value in market_authority_row
            )
            if market_status not in {"d1", "postgres"}:
                raise RuntimeError("market write authority status is invalid")
            if market_run and re.fullmatch(r"market-[0-9a-f]{24}", market_run) is None:
                raise RuntimeError("market migration run evidence is invalid")
            if market_status == "postgres":
                if (
                    re.fullmatch(r"[0-9a-fA-F-]{36}", market_epoch) is None
                    or re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", market_cutover) is None
                    or not market_run
                ):
                    raise RuntimeError("active market write authority evidence is incomplete")
            elif market_epoch or market_cutover:
                raise RuntimeError("inactive market write authority contains activation evidence")
            market_authority = {
                "status": market_status,
                "authorityEpoch": market_epoch,
                "cutoverId": market_cutover,
                "migrationRunId": market_run,
            }

        products_revisions: dict[str, dict[str, Any]] | None = None
        products_authority: dict[str, str] | None = None
        if products_tables:
            cursor.execute(
                "SELECT domain, revision, source_digest "
                "FROM product_data_revisions ORDER BY domain"
            )
            products_revisions = {
                str(domain): {
                    "revision": int(revision),
                    "sourceDigest": str(source_digest),
                }
                for domain, revision, source_digest in cursor.fetchall()
            }
            revision = products_revisions.get("products")
            if (
                revision is None
                or int(revision["revision"]) < 0
                or (
                    int(revision["revision"]) > 0
                    and re.fullmatch(r"[0-9a-f]{64}", str(revision["sourceDigest"])) is None
                )
            ):
                raise RuntimeError("products revision evidence is incomplete")
            cursor.execute(
                "SELECT status, COALESCE(authority_epoch::text, ''), cutover_id, "
                "migration_verify_run_id FROM product_write_authority WHERE id = 1"
            )
            products_authority_row = cursor.fetchone()
            if products_authority_row is None:
                raise RuntimeError("products write authority singleton is missing")
            products_status, products_epoch, products_cutover, products_run = (
                str(value or "") for value in products_authority_row
            )
            if products_status not in {"d1", "postgres"}:
                raise RuntimeError("products write authority status is invalid")
            if products_run and re.fullmatch(r"products-apply-[0-9a-f]{32}", products_run) is None:
                raise RuntimeError("products migration run evidence is invalid")
            if products_status == "postgres":
                if (
                    int(revision["revision"]) < 1
                    or re.fullmatch(r"[0-9a-fA-F-]{36}", products_epoch) is None
                    or re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", products_cutover) is None
                    or not products_run
                ):
                    raise RuntimeError("active products write authority evidence is incomplete")
            elif products_epoch or products_cutover:
                raise RuntimeError("inactive products write authority contains activation evidence")
            products_authority = {
                "status": products_status,
                "authorityEpoch": products_epoch,
                "cutoverId": products_cutover,
                "migrationRunId": products_run,
            }

        inventory_revisions: dict[str, dict[str, Any]] | None = None
        inventory_authority: dict[str, str] | None = None
        if inventory_tables:
            cursor.execute(
                "SELECT domain, revision, source_digest "
                "FROM inventory_data_revisions ORDER BY domain"
            )
            inventory_revisions = {
                str(domain): {
                    "revision": int(revision),
                    "sourceDigest": str(source_digest),
                }
                for domain, revision, source_digest in cursor.fetchall()
            }
            revision = inventory_revisions.get("inventory")
            if (
                revision is None
                or int(revision["revision"]) < 0
                or (
                    int(revision["revision"]) > 0
                    and re.fullmatch(r"[0-9a-f]{64}", str(revision["sourceDigest"])) is None
                )
            ):
                raise RuntimeError("inventory revision evidence is incomplete")
            cursor.execute(
                "SELECT status, COALESCE(authority_epoch::text, ''), cutover_id, "
                "migration_verify_run_id FROM inventory_write_authority WHERE id = 1"
            )
            inventory_authority_row = cursor.fetchone()
            if inventory_authority_row is None:
                raise RuntimeError("inventory write authority singleton is missing")
            inventory_status, inventory_epoch, inventory_cutover, inventory_run = (
                str(value or "") for value in inventory_authority_row
            )
            if inventory_status not in {"d1", "postgres"}:
                raise RuntimeError("inventory write authority status is invalid")
            if inventory_run and re.fullmatch(r"inventory-apply-[0-9a-f]{32}", inventory_run) is None:
                raise RuntimeError("inventory migration run evidence is invalid")
            if inventory_status == "postgres":
                if (
                    int(revision["revision"]) < 1
                    or re.fullmatch(r"[0-9a-fA-F-]{36}", inventory_epoch) is None
                    or re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", inventory_cutover) is None
                    or not inventory_run
                ):
                    raise RuntimeError("active inventory write authority evidence is incomplete")
            elif inventory_epoch or inventory_cutover:
                raise RuntimeError("inactive inventory write authority contains activation evidence")
            inventory_authority = {
                "status": inventory_status,
                "authorityEpoch": inventory_epoch,
                "cutoverId": inventory_cutover,
                "migrationRunId": inventory_run,
            }

        workflow_revisions: dict[str, dict[str, Any]] | None = None
        workflow_authority: dict[str, str] | None = None
        workflow_operations_authority: dict[str, str] | None = None
        if workflow_tables:
            cursor.execute(
                "SELECT domain, revision, source_digest "
                "FROM workflow_data_revisions ORDER BY domain"
            )
            workflow_revisions = {
                str(domain): {
                    "revision": int(revision),
                    "sourceDigest": str(source_digest),
                }
                for domain, revision, source_digest in cursor.fetchall()
            }
            revision = workflow_revisions.get("workflow")
            if (
                revision is None
                or int(revision["revision"]) < 0
                or (
                    int(revision["revision"]) > 0
                    and re.fullmatch(r"[0-9a-f]{64}", str(revision["sourceDigest"])) is None
                )
            ):
                raise RuntimeError("workflow revision evidence is incomplete")
            cursor.execute(
                "SELECT status, COALESCE(authority_epoch::text, ''), cutover_id, "
                "migration_verify_run_id FROM workflow_write_authority WHERE id=1"
            )
            authority_row = cursor.fetchone()
            if authority_row is None:
                raise RuntimeError("workflow write authority singleton is missing")
            workflow_status, workflow_epoch, workflow_cutover, workflow_run = (
                str(value or "") for value in authority_row
            )
            if workflow_status not in {"disabled", "postgres"}:
                raise RuntimeError("workflow write authority status is invalid")
            if workflow_run and re.fullmatch(r"workflow-[0-9a-f]{32}", workflow_run) is None:
                raise RuntimeError("workflow migration run evidence is invalid")
            if workflow_status == "postgres":
                if (
                    int(revision["revision"]) < 1
                    or re.fullmatch(r"[0-9a-fA-F-]{36}", workflow_epoch) is None
                    or re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", workflow_cutover) is None
                    or not workflow_run
                ):
                    raise RuntimeError("active workflow write authority evidence is incomplete")
            elif workflow_epoch or workflow_cutover:
                raise RuntimeError("inactive workflow write authority contains activation evidence")
            workflow_authority = {
                "status": workflow_status,
                "authorityEpoch": workflow_epoch,
                "cutoverId": workflow_cutover,
                "migrationRunId": workflow_run,
            }
            cursor.execute(
                "SELECT status, COALESCE(authority_epoch::text, ''), cutover_id, "
                "migration_verify_run_id FROM workflow_operations_write_authority WHERE id=1"
            )
            operations_authority_row = cursor.fetchone()
            if operations_authority_row is None:
                raise RuntimeError("workflow operations write authority singleton is missing")
            operations_status, operations_epoch, operations_cutover, operations_run = (
                str(value or "") for value in operations_authority_row
            )
            if operations_status not in {"disabled", "postgres"}:
                raise RuntimeError("workflow operations write authority status is invalid")
            if operations_run and re.fullmatch(r"workflow-ops-[0-9a-f]{32}", operations_run) is None:
                raise RuntimeError("workflow operations migration run evidence is invalid")
            if operations_status == "postgres":
                if (
                    int(revision["revision"]) < 1
                    or re.fullmatch(r"[0-9a-fA-F-]{36}", operations_epoch) is None
                    or re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", operations_cutover) is None
                    or not operations_run
                ):
                    raise RuntimeError("active workflow operations authority evidence is incomplete")
            elif operations_epoch or operations_cutover:
                raise RuntimeError("inactive workflow operations authority contains activation evidence")
            workflow_operations_authority = {
                "status": operations_status,
                "authorityEpoch": operations_epoch,
                "cutoverId": operations_cutover,
                "migrationRunId": operations_run,
            }

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
    if netshop_revisions is not None and netshop_authority is not None:
        content["netshopRevisions"] = netshop_revisions
        content["netshopWriteAuthority"] = netshop_authority
    if market_revisions is not None and market_authority is not None:
        content["marketRevisions"] = market_revisions
        content["marketWriteAuthority"] = market_authority
    if products_revisions is not None and products_authority is not None:
        content["productsRevisions"] = products_revisions
        content["productsWriteAuthority"] = products_authority
    if inventory_revisions is not None and inventory_authority is not None:
        content["inventoryRevisions"] = inventory_revisions
        content["inventoryWriteAuthority"] = inventory_authority
    if (
        workflow_revisions is not None
        and workflow_authority is not None
        and workflow_operations_authority is not None
    ):
        content["workflowRevisions"] = workflow_revisions
        content["workflowWriteAuthority"] = workflow_authority
        content["workflowOperationsWriteAuthority"] = workflow_operations_authority
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
