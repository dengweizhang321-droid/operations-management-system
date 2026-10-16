"""Own one synthetic cluster; never production credentials, ports or services."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

ROOT = Path(os.environ.get("JD_SCHEMA_SOURCE_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
sys.path.insert(0, str(ROOT / "tools"))
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")


def assert_isolated_source():
    # ASCII escape spelling survives Windows shell/code-page transport.
    forbidden = (Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf").resolve(),
                 Path("D:/teruisi-runtime").resolve())
    if any(ROOT == path or path in ROOT.parents for path in forbidden):
        raise RuntimeError("Require isolated source outside production checkout/runtime")


def command(args, label, environment, directory, timeout=600):
    with (directory / (label + ".log")).open("xb") as output:
        result = subprocess.run([str(x) for x in args], env=environment, cwd=ROOT,
            stdout=output, stderr=output, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(label + " failed; inspect retained synthetic log")


def capture():
    assert_isolated_source()
    import django
    django.setup()
    from django.db import connection, transaction, DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from psycopg import sql
    from unittest.mock import patch
    import jd_logistics_catalog as original_catalog
    import jd_logistics_addition as original
    import jd_monitor_preferences_catalog as catalog
    import jd_monitor_preferences_addition as addition
    from ai_assistant.database_contract import provision
    from postgres_no_key_backup import verify_receipt_generation
    directory = Path(os.environ["JD_SCHEMA_REHEARSAL_DIR"])
    params = connection.settings_dict
    if params["HOST"] != "127.0.0.1" or not 55970 <= int(params["PORT"]) < 55980 or params["NAME"] != "teruisi_jd_schema_rehearsal":
        raise RuntimeError("Unexpected isolated JD147 database")
    executor = MigrationExecutor(connection)
    targets143 = [node for node in executor.loader.graph.leaf_nodes() if node[0] != "inventory"] + [("inventory", "0011_inventory_warehouse_mapping_settings")]
    executor.migrate(targets143)
    base143 = {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
    if len(base143) != 143:
        raise RuntimeError("Synthetic predecessor is not143")
    connection.ensure_connection()
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        for table in ("ai_dingtalk_schedules", "ai_dingtalk_schedule_runs", "django_migrations"):
            cursor.execute(sql.SQL("ALTER TABLE {} OWNER TO teruisi_sales_owner").format(sql.Identifier(table)))
        cursor.execute("ALTER FUNCTION public.ai_runtime_write_fence() OWNER TO teruisi_sales_owner")
        cursor.execute("ALTER FUNCTION public.ai_immutable_record_guard() OWNER TO teruisi_sales_owner")
        cursor.execute("GRANT USAGE,CREATE ON SCHEMA public TO teruisi_sales_owner")
        cursor.execute("SET ROLE teruisi_sales_owner")
    original.apply_steps(connection, base143)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
        from teruisi_backend.health import INVENTORY_WRITER_TABLE_PRIVILEGES
        for table in original_catalog.TABLES:
            cursor.execute(sql.SQL("GRANT {} ON {} TO teruisi_inventory_writer").format(sql.SQL(",".join(INVENTORY_WRITER_TABLE_PRIVILEGES[table])), sql.Identifier(table)))
            if not table.endswith("audits"):
                cursor.execute(sql.SQL("GRANT SELECT ON {} TO teruisi_inventory_reader").format(sql.Identifier(table)))
        cursor.execute("SET ROLE teruisi_sales_owner")
    base146 = base143 | set(original_catalog.STEPS)
    old_apps = MigrationExecutor(connection).loader.project_state([tuple(original_catalog.STEPS[-1].split(".", 1))]).apps
    model = old_apps.get_model("inventory", "JdLogisticsDepartment")
    model.objects.create(id="synthetic", name="existing-config", business_unit_code="synthetic", updated_by="fixture@example.invalid",
        logistics_enabled=True, monitor_enabled=True, push_enabled=False, store_keys=["synthetic-store"],
        capabilities={"existing": True}, stockout_threshold_days=7, replenishment_cycle_days=21, revision=9)
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 146:
            raise RuntimeError("Original146 catalogue failed")
        before = catalog.preservation(cursor)
    def reject(call, label):
        try:
            call()
        except (ValueError, RuntimeError, DatabaseError):
            return
        raise RuntimeError("Negative accepted: " + label)
    with patch.object(addition, "verify_initial_values", side_effect=ValueError("injected rollback")):
        reject(lambda: addition.apply_steps(connection, base146, before), "atomic rollback")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 146 or catalog.preservation(cursor) != before:
            raise RuntimeError("Atomic147 failure changed146")
    reject(lambda: addition.apply_steps(connection, base146, before | {"legacyRowsSha256": "0" * 64}), "stale preservation")
    addition.apply_steps(connection, base146, before)
    addition.check_database(connection, base146, empty=True, expected=before)
    reject(lambda: addition.apply_steps(connection, base146, before), "committed replay")
    with connection.cursor() as cursor:
        reject(lambda: original_catalog.verify_catalog(cursor, installed=True, permissions=True), "old146 must reject147")
        if verify_receipt_generation(cursor) != 147 or catalog.preservation(cursor) != before:
            raise RuntimeError("147 result differs")
        # Existing table grants already cover the new columns. No GRANT is issued.
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_inventory_reader")
        cursor.execute("SELECT warehouse_preferences, product_order FROM inventory_jd_logistics_departments WHERE id='synthetic'")
        if tuple(json.loads(value) if isinstance(value, str) else value for value in cursor.fetchone()) != ([], []):
            raise RuntimeError("Reader cannot see new defaults")
        reject(lambda: cursor.execute("UPDATE inventory_jd_logistics_departments SET product_order='[]' WHERE false"), "reader update")
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_inventory_writer")
        cursor.execute("UPDATE inventory_jd_logistics_departments SET warehouse_preferences=warehouse_preferences,product_order=product_order WHERE false")
        reject(lambda: cursor.execute("DELETE FROM inventory_jd_logistics_departments WHERE false"), "writer delete")
        reject(lambda: cursor.execute("ALTER TABLE inventory_jd_logistics_departments ADD COLUMN forbidden text"), "writer DDL")
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_sales_owner")
    # Actual reverse/forward compatibility, retaining legacy row values and ACL.
    MigrationExecutor(connection).migrate([tuple(original_catalog.STEPS[-1].split(".", 1))])
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 146 or catalog.preservation(cursor) != before:
            raise RuntimeError("Reverse147 did not preserve146")
    addition.apply_steps(connection, base146, before)
    for statement in ("ALTER TABLE inventory_jd_logistics_departments ADD COLUMN extra text",
        "ALTER TABLE inventory_jd_logistics_departments ALTER warehouse_preferences DROP NOT NULL",
        "ALTER TABLE inventory_jd_logistics_departments ALTER product_order SET DEFAULT '[]'::jsonb",
        "DROP INDEX inv_jdl_fact_scope_idx",
        "DELETE FROM django_migrations WHERE app='inventory' AND name='0015_jd_monitor_preferences'",
        "INSERT INTO django_migrations(app,name,applied) VALUES ('inventory','9999_unknown',now())",
        "GRANT UPDATE ON inventory_jd_logistics_departments TO teruisi_inventory_reader"):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(statement)
                reject(lambda: verify_receipt_generation(cursor), statement)
            transaction.set_rollback(True)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("UPDATE inventory_jd_logistics_departments SET name='drift'")
        reject(lambda: addition.check_database(connection, base146, empty=True, expected=before), "legacy data drift")
        transaction.set_rollback(True)
    # Lost result: original intent is retained; reconcile only reads committed147.
    private = directory / "owned-operation"; private.mkdir()
    addition.common.write(private / "plan.json", {})
    addition.common.write(private / "install-intent.json", {"version": addition.VERSION,
        "planSha256": addition.common.sha(private / "plan.json"), "at": "synthetic", "preservation": before})
    plan = {"migrationSha256": "a" * 64, "parentReferenceSha256": "b" * 64}
    with patch.object(addition, "apply_steps", side_effect=RuntimeError("replay forbidden")):
        first = addition.install_schema("reconcile", connection, directory, "a" * 32, private, plan, base146)
        if addition.install_schema("reconcile", connection, directory, "a" * 32, private, plan, base146) != first:
            raise RuntimeError("Committed147 reconcile not idempotent")
        reject(lambda: addition.install_schema("install", connection, directory, "a" * 32, private, plan, base146), "intent replay")
    import unittest
    sys.path.insert(0, str(ROOT / "tests"))
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName("test_jd_monitor_preferences_addition.PreferencesSchemaTests"))
    if not result.wasSuccessful():
        raise RuntimeError("147 private proof boundary tests failed")
    proof = {"version": "jd-monitor-preferences-private-postgres-v1", "status": "passed", "productionTouched": False,
        "steps": list(catalog.STEPS), "codeSha256": addition.code_digest(ROOT),
        "migrationSha256": addition.common.digest(addition.common.migrations(ROOT)),
        "checks": sorted(addition.CHECKS), "generations": [146, 147], "legacyDataPreserved": True,
        "fullBackupOrRestorePerformed": False, "port": int(params["PORT"])}
    (directory / "jd-monitor-preferences-validation.json").write_text(json.dumps(proof, indent=2), encoding="utf8")
    print(json.dumps({"status": "passed", "productionTouched": False, "validation": str(directory / "jd-monitor-preferences-validation.json")}), flush=True)

def launch():
    assert_isolated_source()
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="jd-monitor-preferences-", dir=scratch))
    port = None
    for candidate in range(55970, 55980):
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
    environment.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="jd_fixture", PGPASSWORD=password,
        PGDATABASE="teruisi_jd_schema_rehearsal", PYTHONUTF8="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://jd_fixture:{password}@127.0.0.1:{port}/teruisi_jd_schema_rehearsal",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend"), JD_SCHEMA_REHEARSAL_DIR=str(directory),
        JD_SCHEMA_SOURCE_ROOT=str(ROOT),
        JD_SCHEMA_CAPTURE_ONLY="1" if "--capture-catalog" in sys.argv else "0")
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        "    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or not 49152<=address[1]<=65535:\n"
        "        raise RuntimeError('Isolated schedule rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started = False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "jd_fixture", "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "init", environment, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", environment, directory)
        started = True
        command([BIN / "createdb.exe", "teruisi_jd_schema_rehearsal"], "createdb", environment, directory)
        roles = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_ai_reader", "teruisi_ai_writer",
                 "teruisi_inventory_reader", "teruisi_inventory_writer", "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer")
        for role in roles:
            command([BIN / "psql.exe", "-v", "ON_ERROR_STOP=1", "-c", f"CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"], role, environment, directory)
        command([sys.executable, __file__, "--child"] + (["--capture-catalog"] if "--capture-catalog" in sys.argv else []), "rehearsal", environment, directory)
        print(json.dumps({"status": "completed", "directory": str(directory), "productionTouched": False}), flush=True)
    finally:
        if started:
            command([BIN / "pg_ctl.exe", "-D", directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", environment, directory)
        password_file.unlink(missing_ok=True)
        print(json.dumps({"phase": "cleanup", "stopped": started, "passwordFileRemoved": not password_file.exists()}), flush=True)


if __name__ == "__main__":
    capture() if "--child" in sys.argv else launch()
