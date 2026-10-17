"""Own one synthetic cluster; never production credentials, ports or services."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

ROOT = Path(os.environ.get("PI_SCHEMA_SOURCE_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
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
    import django
    django.setup()
    from django.db import connection, transaction, DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from psycopg import sql
    from unittest.mock import patch
    import jd_logistics_catalog as original_catalog
    import jd_logistics_addition as original
    import jd_monitor_preferences_catalog as preferences_catalog
    import jd_monitor_preferences_addition as preferences
    import tmall_warehouse_catalog as catalog
    import jd_product_monitoring_addition as monitoring
    import tmall_warehouse_addition as addition
    from ai_assistant.database_contract import provision
    from postgres_no_key_backup import verify_receipt_generation
    directory = Path(os.environ["PI_SCHEMA_REHEARSAL_DIR"])
    params = connection.settings_dict
    if params["HOST"] != "127.0.0.1" or not 55531 <= int(params["PORT"]) < 55540 or params["NAME"] != "teruisi_pi_schema_rehearsal":
        raise RuntimeError("Unexpected isolated JD148 database")
    executor = MigrationExecutor(connection)
    targets143 = [node for node in executor.loader.graph.leaf_nodes() if node[0] not in {"inventory", "ai_assistant"}] + [("inventory", "0011_inventory_warehouse_mapping_settings"), ("ai_assistant", "0083_schedule_execution_profile")]
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
        before146 = preferences_catalog.preservation(cursor)
    preferences.apply_steps(connection, base146, before146)
    base147 = base146 | set(preferences_catalog.STEPS)
    with connection.cursor() as cursor:
        cursor.execute("UPDATE inventory_jd_logistics_departments SET warehouse_preferences='[{\"warehouseId\":\"synthetic-existing\",\"visible\":false,\"displayName\":\"kept\"}]'::jsonb,product_order='[\"synthetic-existing-sku\"]'::jsonb")
        if verify_receipt_generation(cursor) != 147:
            raise RuntimeError("Original147 catalogue failed")
        before = catalog.preservation(cursor)
    def reject(call, label):
        try:
            call()
        except (ValueError, RuntimeError, DatabaseError):
            return
        raise RuntimeError("Negative accepted: " + label)
    def grants():
        code=(ROOT / "tools/django-inventory-service.ps1").read_text(encoding="utf-8-sig").split("    $code = @'\n",1)[1].split("\n'@",1)[0]
        environment={"TERUISI_PROVISION_DATABASE_URL":os.environ["TERUISI_DJANGO_DATABASE_URL"],
            "TERUISI_PROVISION_INVENTORY_READER_PASSWORD":secrets.token_hex(32),
            "TERUISI_PROVISION_INVENTORY_WRITER_PASSWORD":secrets.token_hex(32)}
        with patch.dict(os.environ,environment):
            exec(compile(code,"private_inventory_role_provision.py","exec"),{})
    addition.apply_steps(connection, base147, before)
    grants()
    base149 = base147 | set(addition.STEPS)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
        if verify_receipt_generation(cursor) != 149:
            raise RuntimeError("Exact149 predecessor failed")
        for table in ("ai_models", "ai_conversations", "ai_agent_jobs", "ai_agent_provider_dispatches", "ai_agent_tool_dispatches"):
            cursor.execute(sql.SQL("ALTER TABLE {} OWNER TO teruisi_sales_owner").format(sql.Identifier(table)))
        cursor.execute("SET ROLE teruisi_sales_owner")
    import pi_agent_catalog as pi_catalog
    import pi_agent_addition as pi
    checks = set()
    with connection.cursor() as cursor:
        previous = pi_catalog.preservation(cursor)
    if "--capture-catalog" in sys.argv:
        MigrationExecutor(connection).migrate([("ai_assistant", "0084_pi_agent_independent_runtime")])
        with connection.cursor() as cursor: cursor.execute("RESET ROLE")
        provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
        with connection.cursor() as cursor:
            reference = pi_catalog.inspect_tables(cursor)
        (ROOT / "tools/pi_agent_catalog.json").write_text(json.dumps(reference,indent=2),encoding="utf8",newline="\n")
        return
    with patch.object(pi, "verify_initial_values", side_effect=ValueError("injected150 rollback")):
        reject(lambda: pi.apply_steps(connection, base149, previous), "atomic150 rollback")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 149 or pi_catalog.preservation(cursor) != previous:
            raise RuntimeError("Atomic150 rollback changed149")
    checks.add("rollback")
    reject(lambda: pi.apply_steps(connection, base149, previous | {"legacyRowsSha256":"0"*64}), "stale preservation")
    pi.apply_steps(connection, base149, previous)
    checks.update({"atomic-upgrade", "exact-149-150", "defaults-empty", "legacy-data-preserved"})
    with connection.cursor() as cursor: cursor.execute("RESET ROLE")
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        if verify_receipt_generation(cursor) != 150:
            raise RuntimeError("Exact150 postcondition failed")
        pi_catalog.verify_initial_values(cursor)
        if pi_catalog.preservation(cursor) != previous:
            raise RuntimeError("Pi migration changed legacy AI values or ACL")
        cursor.execute("RESET ROLE")
        for role in ("teruisi_ai_reader", "teruisi_ai_writer", "teruisi_inventory_writer"):
            cursor.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(role)))
            for table in pi_catalog.TABLES:
                if role == "teruisi_ai_writer":
                    cursor.execute(sql.SQL("SELECT * FROM {} LIMIT 0").format(sql.Identifier(table)))
                    reject(lambda table=table: cursor.execute(sql.SQL("ALTER TABLE {} ADD COLUMN forbidden text").format(sql.Identifier(table))), "writer DDL")
                    reject(lambda table=table: cursor.execute(sql.SQL("DELETE FROM {} WHERE false").format(sql.Identifier(table))), "writer delete")
                else:
                    reject(lambda table=table: cursor.execute(sql.SQL("SELECT * FROM {} LIMIT 0").format(sql.Identifier(table))), "foreign or reader Pi access")
            cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_sales_owner")
    checks.add("permissions")
    for statement in (
        "ALTER TABLE ai_pi_sessions ADD COLUMN extra text",
        "ALTER TABLE ai_pi_sessions DISABLE TRIGGER USER",
        "DELETE FROM django_migrations WHERE app='ai_assistant' AND name='0084_pi_agent_independent_runtime'",
        "INSERT INTO django_migrations(app,name,applied) VALUES ('ai_assistant','9999_unknown',now())",
        "GRANT SELECT ON ai_pi_files TO teruisi_ai_reader"):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(statement)
                reject(lambda: verify_receipt_generation(cursor), statement)
            transaction.set_rollback(True)
    checks.add("negative-catalogues")
    reject(lambda: pi.apply_steps(connection, base149, previous), "committed150 replay")
    private = directory / "intent-only"
    private.mkdir()
    pi.common.write(private / "plan.json", {"synthetic":True})
    pi.common.write(private / "install-intent.json", {"version":pi.VERSION,"planSha256":pi.common.sha(private/"plan.json"),"at":"synthetic","preservation":previous})
    plan = {"migrationSha256":"a"*64,"parentReferenceSha256":"b"*64,"steps":list(pi.STEPS)}
    with patch.object(pi,"apply_steps",side_effect=RuntimeError("replay forbidden")):
        first = pi.install_schema("reconcile",connection,directory,"a"*32,private,plan,base149)
        if pi.install_schema("reconcile",connection,directory,"a"*32,private,plan,base149) != first:
            raise RuntimeError("Committed150 reconcile changed")
        reject(lambda:pi.install_schema("install",connection,directory,"a"*32,private,plan,base149),"unknown intent replay")
    checks.add("unknown-no-replay")
    with connection.cursor() as cursor: cursor.execute("RESET ROLE")
    import unittest
    sys.path.insert(0,str(ROOT / "tests"))
    suite = unittest.defaultTestLoader.loadTestsFromName("test_pi_agent_addition")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise RuntimeError("Pi finite installer unit proof failed")
    checks.update({"parent-source-binding", "bad-evidence", "pointer-cas", "lifecycle-routing"})
    # The Django contract suite exercises concurrent claim/epoch and legacy queue isolation.
    suite = unittest.defaultTestLoader.loadTestsFromName("ai_assistant.test_pi_runtime")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise RuntimeError("Pi runtime state and legacy queue contract failed")
    checks.update({"pi-state-fencing", "legacy-queue-isolation"})
    if checks != pi.CHECKS:
        raise RuntimeError("Pi proof check inventory mismatch")
    proof = {"version":"pi-agent-private-postgres-v1","status":"passed","productionTouched":False,
        "steps":list(pi.STEPS),"codeSha256":pi.code_digest(ROOT),
        "migrationSha256":pi.common.digest(pi.common.migrations(ROOT)),"checks":sorted(checks),
        "generations":[149,150],"parentVariants":[[149,150]],"legacyDataPreserved":True,
        "fullBackupOrRestorePerformed":False,"port":int(params["PORT"])}
    (directory / "pi-agent-validation.json").write_text(json.dumps(proof,indent=2),encoding="utf8",newline="\n")
    print(json.dumps({"status":"passed","productionTouched":False,"validation":str(directory / "pi-agent-validation.json")}),flush=True)


def launch():
    assert_isolated_source()
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="pi-agent-", dir=scratch))
    port = None
    for candidate in range(55531, 55540):
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
    environment.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="pi_fixture", PGPASSWORD=password,
        PGDATABASE="teruisi_pi_schema_rehearsal", PYTHONUTF8="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://pi_fixture:{password}@127.0.0.1:{port}/teruisi_pi_schema_rehearsal",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend"), PI_SCHEMA_REHEARSAL_DIR=str(directory),
        PI_SCHEMA_SOURCE_ROOT=str(ROOT),
        PI_SCHEMA_CAPTURE_ONLY="1" if "--capture-catalog" in sys.argv else "0")
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        "    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or not 49152<=address[1]<=65535:\n"
        "        raise RuntimeError('Isolated schedule rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started = False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "pi_fixture", "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "init", environment, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", environment, directory)
        started = True
        command([BIN / "createdb.exe", "teruisi_pi_schema_rehearsal"], "createdb", environment, directory)
        roles = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_ai_reader", "teruisi_ai_writer",
                 "teruisi_inventory_reader", "teruisi_inventory_writer", "teruisi_bi_reader", "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer")
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
