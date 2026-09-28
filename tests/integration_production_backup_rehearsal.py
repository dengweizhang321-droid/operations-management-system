"""Restore an approved baseline backup to an isolated E-drive test cluster.

Only migration/health checks run. No web services, jobs, providers or messaging
processes start. Native errors stay in the private test directory; stdout is
limited to phase names, counts and hashes.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import types
from urllib.parse import quote

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
PARENT = Path(r"E:\codex-artifacts\upstream-integration-20260927")
BASELINE = "108fed614c2f03f26caf4cf169a26ea3d48609ee"
DB = "teruisi_sales"
OWNER = "teruisi_sales_owner"
sys.path.insert(0, str(ROOT / "tools"))
from integration_migration_plan import canonical, digest, load_policy, build_plan
from integration_migration_journal import Journal
from integration_install import apply_django_step


def announce(stage, **fields):
    print(json.dumps({"stage": stage, "productionWrites": False, **fields}), flush=True)


def worker(args):
    port = args.port
    if os.environ.get("TERUISI_DJANGO_ENVIRONMENT") != "test" or not 55440 <= port <= 55999:
        raise RuntimeError("isolated test environment required")
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from django.test import override_settings
    from ai_assistant import database_contract, health
    policy = load_policy(ROOT / "config/integration-migration-policy-v3.json")
    policy.verify_source(ROOT)
    settings = dict(connection.settings_dict)
    if (settings["HOST"] != "127.0.0.1" or int(settings["PORT"]) != port
            or settings["NAME"] != DB or settings["USER"] != OWNER):
        raise RuntimeError("clone Django connection mismatch")
    admin_password = os.environ["TERUISI_CLONE_ADMIN_PASSWORD"]
    reader_password, writer_password = secrets.token_hex(32), secrets.token_hex(32)
    with psycopg.connect(host="127.0.0.1", port=port, dbname=DB, user="postgres",
            password=admin_password, autocommit=True) as admin:
        # Reapply the exact original AI grants, using disposable credentials.
        blob = subprocess.check_output(["git", "show", BASELINE +
            ":backend/ai_assistant/database_contract.py"], cwd=ROOT)
        old = types.ModuleType("ai_assistant._baseline_contract")
        old.__package__ = "ai_assistant"
        exec(compile(blob, "baseline-contract.py", "exec"), old.__dict__)
        old.provision(admin, reader_password, writer_password)
        original_models = admin.execute("SELECT id,model_type,max_total_tool_calls,version FROM ai_models ORDER BY id").fetchall()
        cluster = admin.execute("SELECT system_identifier::text FROM pg_control_system()").fetchone()[0]
        binding = digest({"cluster": cluster, "port": port, "backupSha256": args.approved_sha256})

        def use_role(privileged=False):
            connection.close()
            connection.settings_dict.update(settings)
            if privileged:
                connection.settings_dict.update(USER="postgres", PASSWORD=admin_password)
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database(),current_user,inet_server_port()")
                if cursor.fetchone() != (DB, "postgres" if privileged else OWNER, port):
                    raise RuntimeError("clone role identity changed")

        def inspect():
            use_role(False)
            executor = MigrationExecutor(connection)
            return build_plan(policy, ROOT, sorted(MigrationRecorder(connection).applied_migrations()),
                [(m.app_label,m.name,reverse) for m,reverse in executor.migration_plan(executor.loader.graph.leaf_nodes())], binding)

        before = inspect()
        if before.completed:
            raise RuntimeError("clone backup is not the untouched baseline")
        journal_root = args.run_root / "migration-journal"
        journal_root.mkdir()
        journal = Journal(journal_root, binding[:32])
        journal.initialize(before)
        announce("real_data_migrations", baselineCount=62)
        while before.next_step:
            before = apply_django_step(before, journal, inspect, use_role)
        expected = [(key,kind,300 if kind in ("text","vision") and limit==74 else limit,
            version+1 if kind in ("text","vision") and limit==74 else version)
            for key,kind,limit,version in original_models]
        if admin.execute("SELECT id,model_type,max_total_tool_calls,version FROM ai_models ORDER BY id").fetchall() != expected:
            raise RuntimeError("clone model migration changed unexpected values")
        database_contract.provision(admin, reader_password, writer_password)
        epoch, cutover = admin.execute("SELECT authority_epoch::text,cutover_id FROM ai_write_authority WHERE id=1").fetchone()
        ready = {}
        for role, password in (("ai_reader", reader_password),("ai_writer",writer_password)):
            connection.close()
            connection.settings_dict.update(settings)
            connection.settings_dict.update(USER="teruisi_"+role,PASSWORD=password)
            with override_settings(DJANGO_PROCESS_ROLE=role,AI_WRITE_AUTHORITY_EPOCH=epoch,
                    AI_WRITE_CUTOVER_ID=cutover):
                ready[role] = health.check()["status"] == "ready"
        connection.close()
        result = {"status": "passed", "productionWrites": False,
            "baselineBackupSha256": args.approved_sha256, "reviewedPolicySha256": policy.sha256,
            "migrationCount": 138, "journalCommittedSteps": len(before.completed),
            "journalSha256": journal.complete_digest(before), "runtimeReady": ready,
            "modelBudgetAndVersionsVerified": True,
            "limitation": "baseline data and AI grants tested; other domain services were not started"}
        (args.run_root / "result.json").write_bytes(canonical(result))
        announce("real_data_upgrade_passed", migrationCount=138, runtimeReady=ready)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--backup-directory", type=Path, required=True)
    parser.add_argument("--approved-sha256", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if (ROOT.resolve() == Path(r"D:\运营管理系统").resolve() or args.run_root.resolve().parent != PARENT
            or not re.fullmatch(r"production-clone-[0-9a-f]{12}", args.run_root.name)
            or not args.run_root.is_dir() or not 55440 <= args.port <= 55999):
        raise RuntimeError("invalid isolated clone root or port")
    for path in (args.run_root, *args.run_root.parents):
        if path.is_symlink() or getattr(path,"is_junction",lambda:False)():
            raise RuntimeError("redirected clone root")
    if args.worker:
        worker(args)
        return
    with socket.socket() as listener:
        listener.bind(("127.0.0.1",args.port))
    manifest_path = args.backup_directory / "backup-manifest.json"
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != args.approved_sha256:
        raise RuntimeError("baseline backup manifest changed")
    manifest=json.loads(raw)
    if (manifest["version"] != "teruisi-postgres-daily-backup-v1" or manifest["status"] != "completed"
            or len(manifest["evidence"]["migrations"]) != 62):
        raise RuntimeError("baseline backup generation invalid")
    archive=args.backup_directory / "teruisi-sales.dump"
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream,"sha256").hexdigest() != manifest["dump"]["sha256"]:
            raise RuntimeError("baseline archive bytes changed")
    data=args.run_root / "data"
    if data.exists():
        raise RuntimeError("clone cluster already exists")
    admin_password, owner_password=secrets.token_hex(32),secrets.token_hex(32)
    environment={key:value for key,value in os.environ.items() if not key.startswith(("PG","TERUISI_","DJANGO_"))}
    environment.update(PGHOST="127.0.0.1",PGPORT=str(args.port),PGUSER="postgres",PGDATABASE=DB,
        PGPASSWORD=admin_password,PYTHONUTF8="1")
    def native(command,env=environment,timeout=1800):
        logfile=args.run_root / ("native-"+secrets.token_hex(4)+".log")
        with logfile.open("wb") as output:
            result=subprocess.run([str(v) for v in command],env=env,cwd=ROOT,
                stdout=output,stderr=output,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise RuntimeError("clone native operation failed; diagnosticSha256="+hashlib.sha256(logfile.read_bytes()).hexdigest())
    pwfile=args.run_root / ".temporary-db-credential"
    pwfile.write_text(admin_password,encoding="ascii")
    started=False
    try:
        native([BIN/'initdb.exe','-D',data,'-U','postgres','--auth=scram-sha-256',
            '--encoding=UTF8','--locale=C','--pwfile',pwfile])
        pwfile.unlink()
        with (data/'postgresql.conf').open('a') as out:
            out.write(f"\nlisten_addresses='127.0.0.1'\nport={args.port}\nmax_connections=40\nshared_buffers=128MB\n")
        native([BIN/'pg_ctl.exe','-D',data,'-l',args.run_root/'postgres.log','-w','-t','60','start'],timeout=90)
        started=True
        policy=load_policy(ROOT/'config/integration-migration-policy-v3.json')
        inventory=json.loads(Path(r'E:\codex-artifacts\upstream-integration-20260927\production-readonly-inventory-20260928.json').read_text(encoding='utf-8-sig'))
        with psycopg.connect(host='127.0.0.1',port=args.port,user='postgres',password=admin_password,
                dbname='postgres',autocommit=True) as db:
            for name,login,inherit,*flags in inventory['roles']:
                if any(flags) or not re.fullmatch(r'teruisi_[a-z_]+',name):
                    raise RuntimeError('unreviewed baseline role')
                db.execute(sql.SQL('CREATE ROLE {} {} {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}').format(
                    sql.Identifier(name),sql.SQL('LOGIN' if login else 'NOLOGIN'),sql.SQL('INHERIT' if inherit else 'NOINHERIT'),
                    sql.Literal(owner_password if name==OWNER else None)))
            for name in policy.bootstrap_roles:
                db.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS').format(sql.Identifier(name)))
            db.execute(sql.SQL('CREATE DATABASE {} OWNER {}').format(sql.Identifier(DB),sql.Identifier(OWNER)))
        announce('restore_real_baseline',port=args.port,dumpBytes=archive.stat().st_size)
        native([BIN/'pg_restore.exe','--dbname',DB,'--single-transaction','--exit-on-error',
            '--no-owner','--no-privileges','--role='+OWNER,archive])
        announce('baseline_restored',port=args.port)
        environment.update(TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_PROCESS_ROLE='development',
            TERUISI_DJANGO_DATABASE_URL=f'postgresql://{OWNER}:{quote(owner_password)}@127.0.0.1:{args.port}/{DB}',
            TERUISI_CLONE_ADMIN_PASSWORD=admin_password,DJANGO_SECRET_KEY=secrets.token_hex(32),
            TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32))
        native([sys.executable,'-B',__file__,*sys.argv[1:],'--worker'],timeout=3600)
        result=json.loads((args.run_root/'result.json').read_bytes())
        announce('completed',migrationCount=result['migrationCount'],runtimeReady=result['runtimeReady'])
    finally:
        pwfile.unlink(missing_ok=True)
        if started:
            native([BIN/'pg_ctl.exe','-D',data,'-m','fast','-w','-t','120','stop'],timeout=150)
            announce('isolated_cluster_stopped',port=args.port)


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        announce('failed',errorType=type(error).__name__,errorSha256=hashlib.sha256(str(error).encode()).hexdigest())
        raise SystemExit(1)
