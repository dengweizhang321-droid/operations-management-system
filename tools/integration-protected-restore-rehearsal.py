"""No-new-keys synthetic backup/restore, invoked by the role rehearsal.

Requires the disposable 138-receipt integration database. No formal runtime,
credentials, maintenance operator or release gate is changed by this tool.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

import psycopg
from psycopg import sql
from protected_ai_shadow_evidence_0073 import _catalog_roots, _public_row_roots
import postgres_no_key_backup as no_key_backup

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
DATABASE = "teruisi_integration_role_probe"
ADMIN = "ai_rehearsal_admin"
OWNER = "teruisi_sales_owner"
KEY_TABLE = "public.protected_business_budget_v11_verifier_keys"


def packed(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True,
        separators=(",", ":"), default=str).encode("ascii")


def sha(value):
    return hashlib.sha256(packed(value)).hexdigest()


def collect(db, port):
    identity = db.execute("SELECT current_database(),current_user,inet_server_addr()::text,"
        "inet_server_port(),pg_is_in_recovery()").fetchone()
    if identity != (DATABASE, ADMIN, "127.0.0.1/32", port, False) and identity != (
            DATABASE, ADMIN, "127.0.0.1", port, False):
        raise RuntimeError("integration snapshot identity mismatch")
    db.execute("SET LOCAL TIME ZONE 'UTC'")
    db.execute("SET LOCAL search_path=pg_catalog,public")
    receipts = db.execute("SELECT app,name FROM public.django_migrations ORDER BY app,name").fetchall()
    if len(receipts) != 138 or ("ai_assistant", "0082_no_new_keys_profile") not in receipts:
        raise RuntimeError("integration receipt inventory is not the pinned generation")
    with db.cursor() as cursor:
        for app, migration in (
                ("ai_assistant", "0079_business_market_v6_source_ticket"),
                ("ai_assistant", "0074_business_market_v2_human_cap_approval"),
                ("ai_assistant", "0082_no_new_keys_profile"),
                ("finance", "0005_raw_column_evidence_v2"),
                ("finance", "0006_raw_workbook_bytes_v2")):
            importlib.import_module(app + ".migrations." + migration).verify_catalog(cursor)
    if db.execute("SELECT has_table_privilege(%s,%s,'SELECT'),"
            "has_any_column_privilege(%s,%s,'SELECT')", [OWNER, KEY_TABLE] * 2).fetchone() != (False, False):
        raise RuntimeError("ordinary owner can read private key material")
    roles = db.execute("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
        "rolcreaterole,rolreplication,rolbypassrls,rolpassword IS NOT NULL "
        "FROM pg_authid WHERE rolname LIKE 'teruisi_%' ORDER BY rolname").fetchall()
    permitted_login_roles = {OWNER, "teruisi_ai_reader", "teruisi_ai_writer"}
    if not roles or any(any(row[2:8]) or (row[1] and row[0] not in permitted_login_roles)
            or row[8] != row[1] for row in roles):
        raise RuntimeError("integration role privileges differ from closed synthetic plan")
    settings = db.execute("SELECT r.rolname,COALESCE(d.datname,''),s.setconfig "
        "FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole "
        "LEFT JOIN pg_database d ON d.oid=s.setdatabase "
        "WHERE r.rolname LIKE 'teruisi_%' ORDER BY r.rolname,d.datname").fetchall()
    for name, database, values in settings:
        if name not in permitted_login_roles or database not in ("", DATABASE):
            raise RuntimeError("unexpected role settings scope")
        for setting in values:
            key, value = setting.split("=", 1)
            if (key not in {"default_transaction_read_only", "statement_timeout",
                    "idle_in_transaction_session_timeout"}
                    or not value.replace("ms", "").replace("s", "").isdigit()
                        and value not in {"on", "off"}):
                raise RuntimeError("unexpected role setting")
    members = db.execute("SELECT count(*) FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid "
        "JOIN pg_roles c ON c.oid=m.member WHERE p.rolname LIKE 'teruisi_%' "
        "OR c.rolname LIKE 'teruisi_%'").fetchone()[0]
    if members:
        raise RuntimeError("integration roles unexpectedly have memberships")
    names = [row[0] for row in db.execute("SELECT tablename FROM pg_tables "
        "WHERE schemaname='public' ORDER BY tablename").fetchall()]
    rows = _public_row_roots(db, names)
    catalog = _catalog_roots(db, logical_restore=True)
    files = db.execute("SELECT format,count(*),sum(octet_length(content)) FROM "
        "public.ai_business_file_chunks GROUP BY format ORDER BY format").fetchall()
    if {row[0] for row in files} != {"html", "xlsx"} or any(row[1] < 1 or row[2] < 1 for row in files):
        raise RuntimeError("nonempty application HTML and XLSX chunks are required")
    if db.execute("SELECT count(*) FROM " + KEY_TABLE).fetchone() != (0,):
        raise RuntimeError("no-key backup requires an empty private key table")
    core = {"receipts": sha(receipts), "roles": sha([roles, settings]),
        "tableRows": rows["tableRowsRootSha256"],
        "catalog": catalog["catalogOwnerAclRootSha256"]}
    # Fixed source-code objects only; no row values or key/password material.
    diagnostic = {
        "constraint": db.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid='public.ai_business_evidence_runs'::regclass "
            "AND conname='ai_business_run_bound'").fetchone(),
        "index": db.execute("SELECT pg_get_indexdef('public.mkt_annotation_work_uq'::regclass)"
            ).fetchone(),
        "acl": db.execute("SELECT relacl::text,acldefault('r',relowner)::text FROM pg_class "
            "WHERE oid='public.access_control_data_revisions'::regclass").fetchone(),
        "remainingConstraints": db.execute("SELECT conname,pg_get_constraintdef(oid) "
            "FROM pg_constraint WHERE conname IN ('ai_business_file_chunk_bound',"
            "'ai_business_volume_chunk_bound','sales_options_shape_ck') ORDER BY conname").fetchall(),
    }
    return {"contentSha256": sha(core), "roots": core, "roles": roles, "roleSettings": settings,
        "tables": rows["tableCount"], "rowCount": rows["rowCount"],
        "fileFormats": files, "catalogSections": catalog["sections"],
        "catalogItems": catalog["items"], "tableRoots": rows["tables"],
        "fixedCatalogDiagnostic": diagnostic}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--source-port", type=int, required=True)
    parser.add_argument("--target-port", type=int, required=True)
    args = parser.parse_args()
    if (ROOT == Path(r"D:\运营管理系统").resolve()
            or args.run_root.resolve().parent != (ROOT / ".runtime").resolve()
            or not args.run_root.is_dir() or args.run_root.is_symlink()
            or not 55440 <= args.source_port <= 55999
            or not 55440 <= args.target_port <= 55999
            or args.source_port == args.target_port
            or os.environ.get("TERUISI_DJANGO_ENVIRONMENT") != "test"):
        raise RuntimeError("restore requires an existing isolated integration run")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", args.target_port))
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
    import django
    django.setup()
    root = args.run_root / "latest-no-key-restore"
    root.mkdir()
    source_password = os.environ["TERUISI_SYNTHETIC_PROBE_ADMIN_PASSWORD"]
    target_password = secrets.token_hex(32)
    base_env = {name: value for name, value in os.environ.items()
        if not name.startswith(("PG", "TERUISI_", "DJANGO_"))}
    source_env = {**base_env, "PGHOST": "127.0.0.1", "PGPORT": str(args.source_port),
        "PGUSER": ADMIN, "PGPASSWORD": source_password, "PGDATABASE": DATABASE}
    target_env = {**source_env, "PGPORT": str(args.target_port), "PGPASSWORD": target_password}
    restored_passwords = {}

    def connect(port, password, database=DATABASE):
        return psycopg.connect(host="127.0.0.1", port=port, dbname=database,
            user=ADMIN, password=password, autocommit=True)

    def native(command, environment, timeout=600):
        log = root / ("native-" + secrets.token_hex(4) + ".log")
        with log.open("wb") as output:
            result = subprocess.run([str(arg) for arg in command], env=environment,
                cwd=ROOT, stdout=output, stderr=output, timeout=timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if result.returncode:
            raise RuntimeError("isolated restore command failed; diagnosticSha256="
                + hashlib.sha256(log.read_bytes()).hexdigest())

    spec = importlib.util.spec_from_file_location("maintenance_core", ROOT / "tools" / "postgres-consistent-backup.py")
    maintenance_core = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(maintenance_core)

    def maintenance_call(function, arguments, environment):
        previous = dict(os.environ)
        try:
            os.environ.clear()
            os.environ.update(environment)
            return function(argparse.Namespace(**arguments))
        finally:
            os.environ.clear()
            os.environ.update(previous)

    archive = root / "integration.dump"
    with connect(args.source_port, source_password) as source:
        spec_checks = importlib.util.spec_from_file_location("no_key_pg_checks",
            ROOT / "tests" / "integration_no_key_pg_checks.py")
        checks_module = importlib.util.module_from_spec(spec_checks)
        spec_checks.loader.exec_module(checks_module)
        negative_checks = checks_module.verify(source)
        if source.execute("SELECT count(*) FROM " + KEY_TABLE).fetchone() != (0,):
            raise RuntimeError("source synthetic key table is not empty")
        source.execute("BEGIN")
        source.execute("INSERT INTO " + KEY_TABLE +
            " (key_id,secret,status,created_at) VALUES (%s,%s,'active',now())",
            ["synthetic-negative-row", b"synthetic-only-invalid-key-bytes-00"])
        try:
            collect(source, args.source_port)
        except RuntimeError as error:
            if "private key material exists" not in str(error):
                raise
        else:
            raise RuntimeError("no-key backup accepted a nonempty private key table")
        finally:
            source.execute("ROLLBACK")
        if archive.exists():
            raise RuntimeError("rejected key material created an archive")
        source.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
        snapshot = source.execute("SELECT pg_export_snapshot()").fetchone()[0]
        before = collect(source, args.source_port)
        production_profile_before = no_key_backup.collect(source)
        backup_payload = maintenance_call(maintenance_core.run_backup, {
            "profile": "no-new-keys", "pg_dump": str(BIN / "pg_dump.exe"),
            "output": str(archive), "expected_database": DATABASE, "expected_user": ADMIN,
            "port": args.source_port, "timeout_seconds": 600}, source_env)
        no_key_backup.verify_restored(production_profile_before, backup_payload["profileEvidence"])
        (root / "maintenance-backup-payload.json").write_bytes(packed(backup_payload))
        native([Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe",
            "-NoProfile", "-NonInteractive", "-File", ROOT / "tests/integration-no-key-maintenance-check.ps1",
            "-OperatorPath", ROOT / "tools/django-postgres-maintenance.ps1",
            "-PayloadPath", root / "maintenance-backup-payload.json", "-ExpectedPort", args.source_port], base_env)
        with archive.open("rb") as stream:
            archive_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
        source.execute("ROLLBACK")
    manifest = root / "backup-manifest.json"
    manifest.write_bytes(packed({"version": "teruisi-postgres-daily-backup-v2-no-keys",
        "status": "completed", "database": {"name": DATABASE}, "dump": {"sha256": archive_sha256},
        "profileEvidence": backup_payload["profileEvidence"]}))
    manifest_sha256 = hashlib.sha256(manifest.read_bytes()).hexdigest()
    data = root / "data"
    password_file = root / ".target-password"
    password_file.write_text(target_password, encoding="ascii")
    os.chmod(password_file, 0o600)
    started = False
    try:
        native([BIN / "initdb.exe", "-D", data, "-U", ADMIN, "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file], target_env)
        password_file.unlink()
        with (data / "postgresql.conf").open("a", encoding="utf-8") as output:
            output.write(f"\nlisten_addresses='127.0.0.1'\nport={args.target_port}\nmax_connections=30\n")
        native([BIN / "pg_ctl.exe", "-D", data, "-l", root / "postgres.log",
            "-w", "-t", "30", "start"], target_env, 60)
        started = True
        with connect(args.target_port, target_password, "postgres") as target:
            target.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(DATABASE), sql.Identifier(ADMIN)))
        with archive.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != archive_sha256:
                raise RuntimeError("archive changed before restore")
        maintenance_call(maintenance_core.run_restore, {
            "profile": "no-new-keys", "pg_restore": str(BIN / "pg_restore.exe"),
            "archive": str(archive), "expected_database": DATABASE, "expected_user": ADMIN,
            "port": args.target_port, "timeout_seconds": 600, "manifest": str(manifest),
            "approved_manifest_sha256": manifest_sha256}, {**target_env, "PGDATABASE": "postgres"})
        with connect(args.target_port, target_password) as target:
            # Temporary test DB credentials, never user-managed recovery keys.
            for name, login, *_ in before["roles"]:
                restored_passwords[name] = secrets.token_hex(32) if login else None
                if login:
                    target.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(
                        sql.Identifier(name), sql.Literal(restored_passwords[name])))
        with connect(args.target_port, target_password) as target:
            target.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
            after = collect(target, args.target_port)
            production_profile_after = no_key_backup.collect(target)
            no_key_backup.verify_restored(production_profile_before, production_profile_after)
            target.execute("ROLLBACK")
            if before["contentSha256"] != after["contentSha256"]:
                (root / "mismatch.json").write_bytes(packed({"source": before, "target": after}))
                raise RuntimeError("restored content/catalog roots differ; see mismatch.json")
            target.execute("BEGIN")
            target.execute("GRANT SELECT ON " + KEY_TABLE + " TO " + OWNER)
            try:
                collect(target, args.target_port)
            except RuntimeError:
                pass
            else:
                raise AssertionError("private key grant drift was accepted")
            finally:
                target.execute("ROLLBACK")
        restored_runtime = {}
        if all(restored_passwords.get(name) for name in ("teruisi_ai_reader", "teruisi_ai_writer")):
            from django.db import connection
            from django.test import override_settings
            from ai_assistant import health
            with connect(args.target_port, target_password) as target:
                epoch, cutover = target.execute("SELECT authority_epoch::text,cutover_id "
                    "FROM public.ai_write_authority WHERE id=1").fetchone()
            original = dict(connection.settings_dict)
            try:
                for role in ("ai_reader", "ai_writer"):
                    connection.close()
                    connection.settings_dict.update(HOST="127.0.0.1", PORT=str(args.target_port),
                        NAME=DATABASE, USER="teruisi_" + role, PASSWORD=restored_passwords["teruisi_" + role])
                    with override_settings(DJANGO_PROCESS_ROLE=role,
                            AI_WRITE_AUTHORITY_EPOCH=epoch, AI_WRITE_CUTOVER_ID=cutover):
                        restored_runtime[role] = health.check()["status"] == "ready"
            finally:
                connection.close()
                connection.settings_dict.update(original)
        result = {"status": "passed", "sourcePort": args.source_port, "targetPort": args.target_port,
            "tables": before["tables"], "rows": before["rowCount"],
            "fileFormats": before["fileFormats"], "roleCount": len(before["roles"]),
            "ownerAclAndRowsPreserved": True, "privateKeyGrantDriftRejected": True,
            "privateKeyRows": 0, "nonemptyPrivateKeyTableRejectedBeforeBackup": True,
            "archivePolicy": "no-new-keys-closed-profile-v1", "archiveEncrypted": False,
            "newRecoveryKeyGenerated": False, "archiveSha256": archive_sha256,
            "restoredRuntimeReady": restored_runtime,
            "contentSha256": before["contentSha256"], "productionWrites": False,
            "formalBackupPathVerified": False,
            "maintenancePythonBackupRestoreVerified": True}
        result["runtimePrivilegeNegativeChecks"] = negative_checks
        result["maintenancePowerShellPayloadVerified"] = True
        (root / "evidence.json").write_bytes(packed(result))
        print(json.dumps(result), flush=True)
    finally:
        password_file.unlink(missing_ok=True)
        if started:
            native([BIN / "pg_ctl.exe", "-D", data, "-m", "fast", "-w", "-t", "60", "stop"], target_env, 90)


if __name__ == "__main__":
    main()
