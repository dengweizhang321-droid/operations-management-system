"""Own two synthetic clusters; never production credentials, ports or services."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")


def command(args, label, environment, directory, timeout=600):
    with (directory / (label + ".log")).open("xb") as output:
        result = subprocess.run([str(x) for x in args], env=environment, cwd=ROOT,
            stdout=output, stderr=output, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(label + " failed; inspect retained synthetic log")


def capture():
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    directory = Path(os.environ["AI_SCHEDULE_REHEARSAL_DIR"])
    params = connection.settings_dict
    if (params["HOST"] != "127.0.0.1" or not 55940 <= int(params["PORT"]) < 55950
            or params["NAME"] != "teruisi_ai_rehearsal"):
        raise RuntimeError("Unexpected isolated schedule database")
    executor = MigrationExecutor(connection)
    targets = [node for node in executor.loader.graph.leaf_nodes() if node[0] != "ai_assistant"] + [("ai_assistant", "0082_no_new_keys_profile")]
    executor.migrate(targets)
    base = {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
    if len(base) != 142:
        raise RuntimeError("Synthetic predecessor is not the exact 142 catalogue")
    from ai_schedule_addition_catalog import COLUMNS, constraint_rows
    if os.environ.get("AI_SCHEDULE_CAPTURE_ONLY") == "1":
        from ai_assistant.database_contract import provision
        from ai_schedule_addition_catalog import inspect_tables, inspect_functions
        provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
        from psycopg import sql
        with connection.cursor() as cursor:
            for table in ("ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"):
                cursor.execute(sql.SQL("ALTER TABLE {} OWNER TO teruisi_sales_owner").format(sql.Identifier(table)))
            cursor.execute("ALTER FUNCTION public.ai_runtime_write_fence() OWNER TO teruisi_sales_owner")
            cursor.execute("ALTER FUNCTION public.ai_immutable_record_guard() OWNER TO teruisi_sales_owner")
            before = {"tables": inspect_tables(cursor), "functions": inspect_functions(cursor)}
        (directory / "catalog-142-full.json").write_text(json.dumps(before, indent=2), encoding="utf8")
        MigrationExecutor(connection).migrate([("ai_assistant", "0083_schedule_execution_profile")])
        with connection.cursor() as cursor:
            value = {table: constraint_rows(cursor, table) for table in COLUMNS}
        (directory / "catalog-143.json").write_text(json.dumps(value, indent=2), encoding="utf8")
        print(json.dumps({"status": "catalog-captured", "productionTouched": False}), flush=True)
        return
    from ai_schedule_addition_private import rehearse
    rehearse(connection, base, directory, BIN)


def launch():
    if ROOT == Path(r"D:\运营管理系统"):
        raise RuntimeError("Require isolated worktree")
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="ai-schedule-addition-", dir=scratch))
    port = None
    for candidate in range(55940, 55950):
        try:
            with socket.socket() as probe: probe.bind(("127.0.0.1", candidate))
            port = candidate
            break
        except OSError:
            pass
    if port is None:
        raise RuntimeError("No isolated schedule rehearsal port")
    password = secrets.token_hex(32)
    password_file = directory / "password"
    password_file.write_text(password, encoding="ascii")
    environment = {k: v for k, v in os.environ.items() if k.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
    environment.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="schedule_fixture", PGPASSWORD=password,
        PGDATABASE="teruisi_ai_rehearsal", PYTHONUTF8="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://schedule_fixture:{password}@127.0.0.1:{port}/teruisi_ai_rehearsal",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend"), AI_SCHEDULE_REHEARSAL_DIR=str(directory),
        AI_SCHEDULE_CAPTURE_ONLY="1" if "--capture-catalog" in sys.argv else "0")
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        "    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or not 55940<=address[1]<55960:\n"
        "        raise RuntimeError('Isolated schedule rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started = False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "schedule_fixture", "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "init", environment, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", environment, directory)
        started = True
        command([BIN / "createdb.exe", "teruisi_ai_rehearsal"], "createdb", environment, directory)
        roles = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_ai_reader", "teruisi_ai_writer",
                 "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer")
        for role in roles:
            command([BIN / "psql.exe", "-v", "ON_ERROR_STOP=1", "-c", f"CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"], role, environment, directory)
        if "--capture-catalog" not in sys.argv:
            command([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_netshop_presence_generation.py"],
                    "legacy-generation-tests", environment, directory)
        command([sys.executable, __file__, "--child"], "rehearsal", environment, directory)
        print(json.dumps({"status": "completed", "directory": str(directory), "productionTouched": False}), flush=True)
    finally:
        if started:
            command([BIN / "pg_ctl.exe", "-D", directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", environment, directory)
        password_file.unlink(missing_ok=True)
        print(json.dumps({"phase": "cleanup", "stopped": started, "passwordFileRemoved": not password_file.exists()}), flush=True)


if __name__ == "__main__":
    capture() if "--child" in sys.argv else launch()
