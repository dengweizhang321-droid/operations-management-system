"""Synthetic two-cluster 140/142 dump/restore with the original no-key consumer.

Only called by test-jackyun-recovery-postgres.py. No production connections,
credentials, snapshots, service lifecycle, or business files are used.
"""
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

import django
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN = Path(os.environ["JACKYUN_PRIVATE_EVIDENCE_DIR"]).resolve()
if not RUN.is_relative_to((ROOT / ".codex-tmp").resolve()) or ROOT == Path(r"D:\运营管理系统"):
    raise RuntimeError("Private rehearsal requires its own isolated workspace")
port = int(os.environ["PGPORT"])
if not 55910 <= port < 55925 or os.environ["PGHOST"] != "127.0.0.1" or os.environ["PGDATABASE"] != "teruisi_ai_rehearsal":
    raise RuntimeError("Unexpected source cluster identity")
sys.path.insert(0, str(ROOT / "backend"))
django.setup()
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone
import bi_app_addition as parent
import jackyun_audit_addition as addition
import postgres_no_key_backup as backup


def command(arguments, name, env, timeout=240):
    with (RUN / (name + ".log")).open("xb") as output:
        result = subprocess.run([str(x) for x in arguments], env=env, cwd=ROOT, stdout=output, stderr=output,
                                timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(name + " failed; inspect the retained synthetic log")


def restore_point(generation):
    source_parameters = {"host": "127.0.0.1", "port": port, "user": os.environ["PGUSER"],
                         "password": os.environ["PGPASSWORD"], "dbname": os.environ["PGDATABASE"]}
    archive = RUN / f"generation-{generation}.dump"
    with psycopg.connect(**source_parameters) as original:
        original.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        identity = original.execute("SELECT current_database(),inet_server_port()").fetchone()
        if identity != ("teruisi_ai_rehearsal", port): raise RuntimeError("Source identity changed")
        with original.cursor() as cursor:
            if backup.verify_receipt_generation(cursor) != generation: raise RuntimeError("Unexpected source generation")
        expected = backup.collect(original)
        snapshot = original.execute("SELECT pg_export_snapshot()").fetchone()[0]
        command([BIN / "pg_dump.exe", "--format=custom", "--file", archive, "--snapshot", snapshot, "--dbname", "teruisi_ai_rehearsal"],
                f"dump-{generation}", os.environ.copy())
    (RUN / f"source-{generation}.json").write_text(json.dumps(expected, default=str, indent=2), encoding="utf8")
    restore_dir = Path(tempfile.mkdtemp(prefix=f"restore-{generation}-", dir=RUN))
    restore_port = None
    for candidate in range(55925, 55940):
        try:
            with socket.socket() as probe: probe.bind(("127.0.0.1", candidate))
            restore_port = candidate; break
        except OSError: pass
    if restore_port is None: raise RuntimeError("No independent restore port")
    password = secrets.token_hex(32)
    password_file = restore_dir / "password"; password_file.write_text(password, encoding="ascii")
    restore_env = {**os.environ, "PGPORT": str(restore_port), "PGPASSWORD": password, "PGDATABASE": "postgres"}
    started = False
    try:
        command([BIN / "initdb.exe", "-D", restore_dir / "data", "-U", os.environ["PGUSER"], "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", password_file],
                f"restore-init-{generation}", restore_env)
        with (restore_dir / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={restore_port}\nmax_connections=30\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", restore_dir / "data", "-l", restore_dir / "postgres.log", "-w", "-t", "30", "start"], f"restore-start-{generation}", restore_env)
        started = True
        parameters = {**source_parameters, "port": restore_port, "password": password, "dbname": "postgres"}
        with psycopg.connect(**parameters, autocommit=True) as admin:
            backup.provision_restore_roles(admin, expected["roles"], expected_database="teruisi_ai_rehearsal", expected_port=restore_port)
            admin.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier("teruisi_ai_rehearsal"), sql.Identifier(os.environ["PGUSER"])))
            backup.apply_restore_role_settings(admin, expected["roles"], "teruisi_ai_rehearsal")
        restore_env["PGDATABASE"] = "teruisi_ai_rehearsal"
        command([BIN / "pg_restore.exe", "--exit-on-error", "--dbname", "teruisi_ai_rehearsal", archive], f"restore-data-{generation}", restore_env)
        parameters["dbname"] = "teruisi_ai_rehearsal"
        with psycopg.connect(**parameters) as restored:
            with restored.cursor() as cursor:
                if backup.verify_receipt_generation(cursor) != generation: raise RuntimeError("Restored generation differs")
            actual = backup.collect(restored)
            backup.verify_restored(expected, actual)
            if restored.execute("SELECT count(*) FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')").fetchone() != (0,):
                raise RuntimeError("Unexpected restore tablespace")
        return {"generation": generation, "sourcePort": port, "restorePort": restore_port,
                "contentSha256": expected["contentSha256"], "dumpSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "roleAclAndCatalogueVerified": True, "productionTouched": False}
    finally:
        if started:
            command([BIN / "pg_ctl.exe", "-D", restore_dir / "data", "-m", "fast", "-w", "-t", "30", "stop"], f"restore-stop-{generation}", restore_env)
        password_file.unlink(missing_ok=True)


call_command("migrate", interactive=False, verbosity=0)
old_targets = [("erp_reference", "0002_erpproductmaster_erpreferenceimportscopehead_and_more"), ("sales", "0010_analysis_options")]
executor = MigrationExecutor(connection); executor.migrate(old_targets)
apps = MigrationExecutor(connection).loader.project_state(old_targets).apps
apps.get_model("erp_reference", "ErpReferenceImportAttempt").objects.create(source_key="products", actor_email="fixture@example.test", raw_file_hash="1" * 64, outcome="rejected", file_name="fixture.xlsx", file_size_bytes=512)
apps.get_model("sales", "SalesImportAttempt").objects.create(id="private-old-audit", actor_email="fixture@example.test", raw_file_hash="2" * 64, outcome="rejected", file_name="fixture.xlsx", file_size_bytes=512)
apps.get_model("sales", "SalesRawUploadSession").objects.create(actor_email="fixture@example.test", client_fingerprint="private-old-session", file_name="fixture.xlsx", file_size_bytes=512, chunk_size_bytes=1048576, chunk_count=1, expected_start_date="2026-10-01", expected_end_date="2026-10-12", expires_at=timezone.now() + timedelta(hours=1))
base = {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
if len(base) != 140: raise RuntimeError("Private baseline is not the complete 140 catalogue")
before = restore_point(140)
addition.apply_steps(connection, base)
after = restore_point(142)
(RUN / "private-restore.json").write_text(json.dumps({"status": "passed", "before": before, "after": after}, indent=2), encoding="utf8")
print(json.dumps({"status": "passed", "generations": [140, 142], "independentClusters": True, "productionTouched": False}), flush=True)
