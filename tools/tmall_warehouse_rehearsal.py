"""Own one synthetic cluster; never production credentials, ports or services."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

ROOT = Path(os.environ.get("TMALL_SCHEMA_SOURCE_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
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
    directory = Path(os.environ["TMALL_SCHEMA_REHEARSAL_DIR"])
    params = connection.settings_dict
    if params["HOST"] != "127.0.0.1" or not 55471 <= int(params["PORT"]) < 55480 or params["NAME"] != "teruisi_tmall_schema_rehearsal":
        raise RuntimeError("Unexpected isolated JD148 database")
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
    if "--capture-catalog" in sys.argv:
        MigrationExecutor(connection).migrate([("inventory", "0017_tmall_warehouse")])
        grants()
        with connection.cursor() as cursor:
            captured = catalog.inspect_tables(cursor)
            captured["sequence"] = catalog.sequence_catalog(cursor)
        (ROOT / "tools/tmall_warehouse_catalog.json").write_text(json.dumps(captured, indent=2), encoding="utf8")
        return
    # A migration2 failure must roll both steps back to147 without any149 object.
    with patch.object(addition, "verify_initial_values", side_effect=ValueError("injected149 rollback")):
        reject(lambda: addition.apply_steps(connection, base147, before), "atomic147 rollback")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 147 or catalog.preservation(cursor) != before:
            raise RuntimeError("Atomic149 failure changed147")
    reject(lambda: addition.apply_steps(connection, base147, before | {"legacyRowsSha256":"0"*64}), "stale preservation")
    addition.apply_steps(connection, base147, before)
    grants()
    addition.check_database(connection, base147, empty=True, expected=before)
    from teruisi_backend.health import _validate_inventory_schema, _validate_inventory_writer_permissions, REQUIRED_BI_INVENTORY_COLUMNS
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_inventory_reader")
        _validate_inventory_schema(cursor,writer=False)
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_inventory_writer")
        _validate_inventory_schema(cursor,writer=True)
        _validate_inventory_writer_permissions(cursor)
        cursor.execute("RESET ROLE")
        for table in REQUIRED_BI_INVENTORY_COLUMNS:
            cursor.execute(sql.SQL("GRANT SELECT ON {} TO teruisi_bi_reader").format(sql.Identifier(table)))
        cursor.execute("SET ROLE teruisi_bi_reader")
        _validate_inventory_schema(cursor,writer=False,bi_consumer=True)
        reject(lambda:cursor.execute("SELECT * FROM inventory_tmall_warehouse_facts LIMIT 0"),"BI Tmall permission")
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_sales_owner")

    reject(lambda: addition.apply_steps(connection, base147, before), "committed149 replay")
    # Exercise real constrained database roles, including sequence allocation.
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_inventory_reader")
        for table in catalog.TABLES[:-1]:
            if table.endswith("audits"):
                reject(lambda: cursor.execute("SELECT * FROM inventory_tmall_warehouse_audits LIMIT 0"), "reader audit")
        for table in ("scopes", "batches", "facts"):
            cursor.execute("SELECT * FROM inventory_tmall_warehouse_" + table + " LIMIT 0")
            reject(lambda: cursor.execute("DELETE FROM inventory_tmall_warehouse_" + table + " WHERE false"), "reader write")
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_inventory_writer")
        cursor.execute("INSERT INTO inventory_tmall_warehouse_scopes(owner,revision,owner_token,updated_at) VALUES('fixture',0,'',now())")
        cursor.execute("UPDATE inventory_tmall_warehouse_scopes SET revision=revision WHERE owner='fixture'")
        reject(lambda: cursor.execute("DELETE FROM inventory_tmall_warehouse_scopes WHERE false"), "writer scope delete")
        reject(lambda: cursor.execute("UPDATE inventory_tmall_warehouse_batches SET row_count=row_count WHERE false"), "writer batch update")
        reject(lambda: cursor.execute("UPDATE inventory_tmall_warehouse_facts SET goods_name=goods_name WHERE false"), "writer fact update")
        reject(lambda: cursor.execute("DELETE FROM inventory_tmall_warehouse_audits WHERE false"), "writer audit delete")
        reject(lambda: cursor.execute("ALTER TABLE inventory_tmall_warehouse_scopes ADD COLUMN forbidden text"), "writer DDL")
        cursor.execute("SELECT nextval('inventory_tmall_warehouse_facts_id_seq')")
        reject(lambda: cursor.execute("SELECT setval('inventory_tmall_warehouse_facts_id_seq',1)"), "writer sequence set")
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_sales_owner")
        cursor.execute("DELETE FROM inventory_tmall_warehouse_scopes")
    # Reverse to148, keep a saved monitor preference, then run the exact148 child.
    MigrationExecutor(connection).migrate([("inventory", "0016_jd_product_monitoring")])
    base148 = base147 | set(monitoring.STEPS)
    with connection.cursor() as cursor:
        cursor.execute("UPDATE inventory_jd_logistics_departments SET unmonitored_product_codes='[\"kept-sku\"]'::jsonb")
        before148 = catalog.preservation(cursor)
        if verify_receipt_generation(cursor) != 148:
            raise RuntimeError("Reverse149 did not preserve148")
    with patch.object(addition, "verify_initial_values", side_effect=ValueError("injected148 rollback")):
        reject(lambda: addition.apply_steps(connection, base148, before148), "atomic148 rollback")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 148 or catalog.preservation(cursor) != before148:
            raise RuntimeError("Atomic149 failure changed148")
    addition.apply_steps(connection, base148, before148)
    grants()
    addition.check_database(connection, base148, empty=True, expected=before148)
    for statement in (
        "ALTER TABLE inventory_tmall_warehouse_scopes ADD COLUMN extra text",
        "ALTER TABLE inventory_tmall_warehouse_facts ALTER goods_id DROP NOT NULL",
        "DROP INDEX inv_tmw_fact_scope_idx",
        "ALTER TABLE inventory_tmall_warehouse_facts DROP CONSTRAINT inv_tmw_fact_identity_uq",
        "ALTER TABLE inventory_tmall_warehouse_scopes ENABLE ROW LEVEL SECURITY",
        "DELETE FROM django_migrations WHERE app='inventory' AND name='0017_tmall_warehouse'",
        "INSERT INTO django_migrations(app,name,applied) VALUES ('inventory','9999_unknown',now())",
        "GRANT UPDATE ON inventory_tmall_warehouse_batches TO teruisi_inventory_reader",
        "GRANT UPDATE ON SEQUENCE inventory_tmall_warehouse_facts_id_seq TO teruisi_inventory_writer"):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(statement)
                reject(lambda: verify_receipt_generation(cursor), statement)
            transaction.set_rollback(True)
    # Successful schema checks remain valid once real monitor rows are configured.
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO inventory_tmall_warehouse_scopes(owner,revision,owner_token,updated_at) VALUES('fixture',1,'',now())")
        addition.check_database(connection, base148)
        reject(lambda: addition.check_database(connection, base148, empty=True), "nonempty installation")
        transaction.set_rollback(True)
    # Lost receipt reconciliation reads committed149; it must never re-enter migrations.
    private=directory / "owned-operation";private.mkdir()
    addition.common.write(private / "plan.json", {})
    addition.common.write(private / "install-intent.json", {"version":addition.VERSION,
        "planSha256":addition.common.sha(private / "plan.json"),"at":"synthetic","preservation":before148})
    plan={"migrationSha256":"a"*64,"parentReferenceSha256":"b"*64,"steps":list(addition.steps_for_base(base148))}
    with patch.object(addition,"apply_steps",side_effect=RuntimeError("replay forbidden")):
        first=addition.install_schema("reconcile",connection,directory,"a"*32,private,plan,base148)
        if addition.install_schema("reconcile",connection,directory,"a"*32,private,plan,base148)!=first:
            raise RuntimeError("Committed149 reconcile not idempotent")
        reject(lambda:addition.install_schema("install",connection,directory,"a"*32,private,plan,base148),"intent replay")
    import unittest
    sys.path.insert(0,str(ROOT / "tests"))
    with connection.cursor() as cursor: cursor.execute("RESET ROLE")
    suite=unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromName("test_tmall_warehouse_addition"),
        unittest.defaultTestLoader.loadTestsFromName("inventory.tests.test_tmall_warehouse")])
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():raise RuntimeError("149 boundary tests failed")
    # Two actual writer sessions race one owner scope with different snapshots.
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import connections
    from inventory import tmall_warehouse as warehouse
    from inventory.errors import InventoryApiError
    from inventory.models import InventoryWriteAuthority
    from inventory.tmall_warehouse_models import TmallWarehouseFact,TmallWarehouseScope
    from inventory.tests.test_tmall_warehouse import payload,row,ACTOR
    import uuid
    from django.utils import timezone
    InventoryWriteAuthority.objects.filter(id=1).update(status="postgres",authority_epoch=uuid.uuid4(),cutover_id="tmall-fixture",migration_verify_run_id="tmall-fixture",activated_at=timezone.now())
    barrier=Barrier(2)
    def concurrent_write(index):
        owned=connections["default"]
        try:
            with owned.cursor() as cursor:cursor.execute("SET ROLE teruisi_inventory_writer")
            barrier.wait(timeout=10)
            try:
                return warehouse.import_payload(payload([row(str(index))],owner="concurrent-owner",expectedScopeRevision=0),ACTOR)["status"]
            except InventoryApiError as exc:return exc.code
        finally:owned.close()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(concurrent_write,[1,2]))
    if sorted(results)!=["completed","version_conflict"] or TmallWarehouseScope.objects.get(owner="concurrent-owner").revision!=1 or TmallWarehouseFact.objects.filter(owner="concurrent-owner").count()!=1:
        raise RuntimeError("Concurrent real writer scope CAS failed")
    proof={"version":"tmall-warehouse-private-postgres-v1","status":"passed","productionTouched":False,
        "steps":list(addition.STEPS),"codeSha256":addition.code_digest(ROOT),
        "migrationSha256":addition.common.digest(addition.common.migrations(ROOT)),
        "checks":sorted(addition.CHECKS),"generations":[147,148,149],"parentVariants":[[147,149],[148,149]],
        "legacyDataPreserved":True,"fullBackupOrRestorePerformed":False,"port":int(params["PORT"])}
    (directory / "tmall-warehouse-validation.json").write_text(json.dumps(proof,indent=2),encoding="utf8")
    print(json.dumps({"status":"passed","productionTouched":False,"validation":str(directory / "tmall-warehouse-validation.json")}),flush=True)

def launch():
    assert_isolated_source()
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="tmall-warehouse-", dir=scratch))
    port = None
    for candidate in range(55471, 55480):
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
    environment.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="tmall_fixture", PGPASSWORD=password,
        PGDATABASE="teruisi_tmall_schema_rehearsal", PYTHONUTF8="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://tmall_fixture:{password}@127.0.0.1:{port}/teruisi_tmall_schema_rehearsal",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend"), TMALL_SCHEMA_REHEARSAL_DIR=str(directory),
        TMALL_SCHEMA_SOURCE_ROOT=str(ROOT),
        TMALL_SCHEMA_CAPTURE_ONLY="1" if "--capture-catalog" in sys.argv else "0")
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        "    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or not 49152<=address[1]<=65535:\n"
        "        raise RuntimeError('Isolated schedule rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started = False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "tmall_fixture", "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "init", environment, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", environment, directory)
        started = True
        command([BIN / "createdb.exe", "teruisi_tmall_schema_rehearsal"], "createdb", environment, directory)
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
