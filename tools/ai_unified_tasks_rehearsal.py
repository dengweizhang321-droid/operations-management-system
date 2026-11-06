"""Synthetic PG17 158->159 structure/ACL proof. Never accepts production input."""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
BIN = Path("D:/teruisi-runtime/django-sales/postgresql-17.11/bin")
DATABASE = "teruisi_ai_unified_tasks_rehearsal"
PORTS = range(55522, 55532)
RESULT = ROOT / "docs/ai-p2-20261107/structure-result.json"


def command(args, label, env, directory):
    with (directory / (label + ".log")).open("xb") as out:
        result = subprocess.run([str(x) for x in args], env=env, cwd=ROOT,
            stdout=out, stderr=out, timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError(label + " failed; retained log: " + str(directory / (label + ".log")))


def child():
    import django
    django.setup()
    from django.db import connection, transaction, DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from ai_task_feedback_candidates_rehearsal import build_parent156
    from ai_task_feedback_candidates_addition import apply_steps as apply_parent
    from ai_task_feedback_candidates_catalog import preservation as parent_preservation
    from ai_assistant.database_contract import provision
    from postgres_no_key_backup import verify_receipt_generation
    import ai_unified_tasks_catalog as catalog
    import ai_unified_tasks_addition as gate
    p = connection.settings_dict
    if p["HOST"] != "127.0.0.1" or int(p["PORT"]) not in PORTS or p["NAME"] != DATABASE or p["USER"] != "ai159_fixture":
        raise RuntimeError("Private synthetic database identity differs")
    directory = Path(os.environ["AI159_REHEARSAL_DIR"])
    base156, _targets = build_parent156(connection)
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        original = parent_preservation(cursor)
    apply_parent(connection, base156, original)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        if verify_receipt_generation(cursor) != 158:
            raise RuntimeError("Expected exact verified158 parent")
        before = catalog.preservation(cursor)
    base = {".".join(node) for node in MigrationRecorder(connection).applied_migrations()}
    if "--capture-catalog" in sys.argv:
        MigrationExecutor(connection).migrate([("ai_assistant", "0090_unified_tasks")])
    else:
        gate.apply_steps(connection, base, before)
        with connection.cursor() as cursor:
            catalog.verify_catalog(cursor, permissions=False)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        captured = catalog.capture(cursor)
        if "--capture-catalog" in sys.argv:
            (ROOT / "tools/ai_unified_tasks_catalog.json").write_text(json.dumps(captured, indent=2) + "\n", encoding="utf8", newline="\n")
        catalog.verify_catalog(cursor)
        catalog.verify_initial_values(cursor)
        if catalog.preservation(cursor) != before or verify_receipt_generation(cursor) != 159:
            raise RuntimeError("Structure addition changed prior rows/ACL or generation")
    checks = ["exact158-parent", "exact159-catalog", "new-tables-empty", "old-rows-and-ACL-preserved", "restricted-writer-zero-reader-grants"]
    if "--capture-catalog" not in sys.argv:
        # A disabled native FK trigger must change the frozen catalog, not
        # merely leave a convalidated flag that looks healthy.
        with connection.cursor() as cursor:
            cursor.execute("SELECT n.nspname,c.relname,t.tgname FROM pg_trigger t JOIN pg_constraint k ON k.oid=t.tgconstraint "
                "JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE t.tgisinternal AND k.contype='f' AND k.conrelid=ANY(%s::regclass[]) ORDER BY 1,2,3 LIMIT 1",
                [["public." + table for table in catalog.TABLES]])
            target = cursor.fetchone()
        from psycopg import sql
        try:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("RESET ROLE")
                cursor.execute(sql.SQL("ALTER TABLE {}.{} DISABLE TRIGGER {}").format(*(sql.Identifier(v) for v in target)))
                cursor.execute("SET ROLE teruisi_sales_owner")
                try:
                    catalog.verify_catalog(cursor)
                except ValueError:
                    raise DatabaseError("expected_catalog_rejection")
                raise RuntimeError("Disabled FK trigger was accepted")
        except DatabaseError:
            checks.append("disabled-native-FK-rejected-and-rolled-back")
        with connection.cursor() as cursor:
            catalog.verify_catalog(cursor)
        try:
            gate.apply_steps(connection, base, before)
        except ValueError:
            checks.append("committed159-not-replayed")
        else:
            raise RuntimeError("Committed migration replay was accepted")
    (directory / "result.json").write_text(json.dumps({"status": "passed", "generations": [158, 159],
        "checks": checks, "productionTouched": False, "fullBackupOrRestorePerformed": False,
        "port": int(p["PORT"]), "database": DATABASE, "codeSha256": gate.code_digest(ROOT),
        "migrationSha256": gate.common.digest(gate.common.migrations(ROOT))}, indent=2), encoding="utf8")


def launch():
    from ai_task_feedback_candidates_rehearsal import assert_isolated_source
    assert_isolated_source()
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="ai159-pg17-", dir=scratch))
    port = None
    for candidate in PORTS:
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", candidate))
            port = candidate
            break
        except OSError:
            pass
    if port is None:
        raise RuntimeError("No isolated port")
    password = secrets.token_hex(32)
    pwfile = directory / "password"
    pwfile.write_text(password, encoding="ascii")
    env = {k: v for k, v in os.environ.items() if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
    env.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="ai159_fixture", PGPASSWORD=password,
        PGDATABASE=DATABASE, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://ai159_fixture:{password}@127.0.0.1:{port}/{DATABASE}",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend") + os.pathsep + str(ROOT / "tools"),
        AI159_REHEARSAL_DIR=str(directory))
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        f"    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or address[1]!={port}:\n"
        "        raise RuntimeError('Unified task rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started, stopped, succeeded = False, False, False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "ai159_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "init", env, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as out:
            out.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", env, directory)
        started = True
        command([BIN / "createdb.exe", DATABASE], "createdb", env, directory)
        roles = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_ai_reader", "teruisi_ai_writer",
            "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer",
            "teruisi_inventory_reader", "teruisi_inventory_writer", "teruisi_workflow_reader", "teruisi_workflow_writer",
            "teruisi_market_reader", "teruisi_market_writer", "teruisi_products_reader", "teruisi_products_writer",
            "teruisi_access_control_reader", "teruisi_access_control_writer", "teruisi_customer_service_reader",
            "teruisi_customer_service_writer", "teruisi_erp_reference_reader", "teruisi_erp_reference_writer")
        for role in roles:
            command([BIN / "psql.exe", "-v", "ON_ERROR_STOP=1", "-c", f"CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"], role, env, directory)
        command([sys.executable, __file__, "--child", *sys.argv[1:]], "rehearsal", env, directory)
        succeeded = True
    finally:
        if started:
            command([BIN / "pg_ctl.exe", "-D", directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", env, directory)
            stopped = True
        pwfile.unlink(missing_ok=True)
        data = directory / "data"
        if data.exists() and (stopped or not started):
            if directory.resolve().parent != scratch.resolve() or data.is_symlink():
                raise RuntimeError("Unexpected private cleanup target")
            shutil.rmtree(data)
        cleanup = {"started": started, "stopped": stopped, "privateDataRemoved": not data.exists(), "childExitZero": succeeded}
        (directory / "cleanup.json").write_text(json.dumps(cleanup), encoding="utf8")
        print(json.dumps({"phase": "cleanup", "directory": str(directory), **cleanup}), flush=True)
    if "--capture-catalog" not in sys.argv:
        result = json.loads((directory / "result.json").read_text(encoding="utf8"))
        result["cleanup"] = cleanup
        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf8", newline="\n")


if __name__ == "__main__":
    child() if "--child" in sys.argv else launch()
