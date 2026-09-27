"""Latest-generation synthetic backup/restore, invoked by the role rehearsal.

Requires the disposable 136-receipt integration database. No formal runtime,
credentials, maintenance operator or release gate is changed by this tool.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

import psycopg
from psycopg import sql
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from protected_ai_archive_recovery import (
    RecoveryBlocked, create_envelope, public_fingerprint, recover_envelope)
from protected_ai_archive_v2_stream import (
    ArchiveInvalid, open_verified_stream, seal_process_stdout)
from protected_ai_shadow_evidence_0073 import _catalog_roots, _public_row_roots

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
    if len(receipts) != 136 or ("ai_assistant", "0080_model_tool_budget_300") not in receipts:
        raise RuntimeError("integration receipt inventory is not the pinned generation")
    with db.cursor() as cursor:
        for app, migration in (
                ("ai_assistant", "0079_business_market_v6_source_ticket"),
                ("ai_assistant", "0074_business_market_v2_human_cap_approval"),
                ("ai_assistant", "0075_business_v4_report_restricted_page"),
                ("finance", "0005_raw_column_evidence_v2"),
                ("finance", "0006_raw_workbook_bytes_v2")):
            importlib.import_module(app + ".migrations." + migration).verify_catalog(cursor)
    if db.execute("SELECT has_table_privilege(%s,%s,'SELECT'),"
            "has_any_column_privilege(%s,%s,'SELECT')", [OWNER, KEY_TABLE] * 2).fetchone() != (False, False):
        raise RuntimeError("ordinary owner can read private key material")
    roles = db.execute("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
        "rolcreaterole,rolreplication,rolbypassrls,rolpassword IS NOT NULL "
        "FROM pg_authid WHERE rolname LIKE 'teruisi_%' ORDER BY rolname").fetchall()
    if not roles or any(any(row[2:8]) or row[1] != (row[0] == OWNER)
            or row[8] != (row[0] == OWNER) for row in roles):
        raise RuntimeError("integration role privileges differ from closed synthetic plan")
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
    if db.execute("SELECT count(*) FROM " + KEY_TABLE).fetchone() != (1,):
        raise RuntimeError("one nonempty synthetic private key is required")
    core = {"receipts": sha(receipts), "roles": sha(roles),
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
    return {"contentSha256": sha(core), "roots": core, "roles": roles,
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
    root = args.run_root / "latest-encrypted-restore"
    root.mkdir()
    source_password = os.environ["TERUISI_SYNTHETIC_PROBE_ADMIN_PASSWORD"]
    target_password = secrets.token_hex(32)
    base_env = {name: value for name, value in os.environ.items()
        if not name.startswith(("PG", "TERUISI_", "DJANGO_"))}
    source_env = {**base_env, "PGHOST": "127.0.0.1", "PGPORT": str(args.source_port),
        "PGUSER": ADMIN, "PGPASSWORD": source_password, "PGDATABASE": DATABASE}
    target_env = {**source_env, "PGPORT": str(args.target_port), "PGPASSWORD": target_password}

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

    recovery = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    recovery_password = secrets.token_hex(32).encode()
    public_pem = recovery.public_key().public_bytes(serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo)
    encrypted_private = recovery.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.BestAvailableEncryption(recovery_password))
    recipient = public_fingerprint(public_pem)
    archive = root / "integration.dump.aead"
    with connect(args.source_port, source_password) as source:
        if source.execute("SELECT count(*) FROM " + KEY_TABLE).fetchone() != (0,):
            raise RuntimeError("source synthetic key table is not empty")
        source.execute("INSERT INTO " + KEY_TABLE +
            " (key_id,secret,status,created_at) VALUES (%s,%s,'active',now())",
            ["integration-synthetic-key", secrets.token_bytes(32)])
        source.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        snapshot = source.execute("SELECT pg_export_snapshot()").fetchone()[0]
        before = collect(source, args.source_port)
        context = sha({"content": before["contentSha256"], "snapshot": sha(snapshot),
            "version": "integration-protected-restore-v1"})
        envelope, provider = create_envelope(public_pem, key_id="integration-test",
            context_sha256=context, expected_recipient_sha256=recipient)
        sealed = seal_process_stdout([BIN / "pg_dump.exe", "--format=custom", "--compress=6",
            "--lock-wait-timeout=5000", "--snapshot=" + snapshot], archive,
            key_id="integration-test", context_sha256=context, key_provider=provider,
            env=source_env, timeout_seconds=600)
        source.execute("ROLLBACK")
    del provider, recovery
    binding = {"expected_key_id": "integration-test", "expected_context_sha256": context,
        "expected_recipient_sha256": recipient}
    try:
        recover_envelope(envelope, encrypted_private, b"wrong-synthetic-password", **binding)
    except RecoveryBlocked:
        pass
    else:
        raise RuntimeError("incorrect recovery password accepted")
    provider = recover_envelope(envelope, encrypted_private, recovery_password, **binding)
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
            for name, login, *_ in before["roles"]:
                target.execute(sql.SQL("CREATE ROLE {} {} NOINHERIT NOSUPERUSER NOCREATEDB "
                    "NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}").format(
                    sql.Identifier(name), sql.SQL("LOGIN" if login else "NOLOGIN"),
                    sql.Literal(secrets.token_hex(32) if login else None)))
            target.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(DATABASE), sql.Identifier(OWNER)))
        with open_verified_stream(archive, expected_key_id="integration-test",
                expected_context_sha256=context, key_provider=provider) as verified:
            restored = verified.copy_to_transactional_process([BIN / "pg_restore.exe",
                "--single-transaction", "--exit-on-error", "--dbname", DATABASE],
                env=target_env, timeout_seconds=600)
            if restored != sealed:
                raise RuntimeError("restored stream differs from backup")
        with connect(args.target_port, target_password) as target:
            target.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
            after = collect(target, args.target_port)
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
        result = {"status": "passed", "sourcePort": args.source_port, "targetPort": args.target_port,
            "tables": before["tables"], "rows": before["rowCount"],
            "fileFormats": before["fileFormats"], "roleCount": len(before["roles"]),
            "ownerAclAndRowsPreserved": True, "privateKeyGrantDriftRejected": True,
            "wrongRecoveryPasswordRejected": True, "encryptedRecoveryEnvelopeVerified": True,
            "plaintextDumpFiles": len(list(root.glob("*.dump"))),
            "contentSha256": before["contentSha256"], "productionWrites": False,
            "formalBackupPathVerified": False, "productionKeyCustodyConfigured": False}
        (root / "evidence.json").write_bytes(packed(result))
        print(json.dumps(result), flush=True)
    finally:
        password_file.unlink(missing_ok=True)
        if started:
            native([BIN / "pg_ctl.exe", "-D", data, "-m", "fast", "-w", "-t", "60", "stop"], target_env, 90)


if __name__ == "__main__":
    main()
