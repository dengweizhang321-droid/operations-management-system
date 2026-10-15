"""Own two synthetic clusters; never production credentials, ports or services."""
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
    import jd_logistics_catalog as catalog
    import jd_logistics_addition as addition
    from ai_assistant.database_contract import provision
    directory = Path(os.environ["JD_SCHEMA_REHEARSAL_DIR"])
    params = connection.settings_dict
    if params["HOST"] != "127.0.0.1" or not 55960 <= int(params["PORT"]) < 55970 or params["NAME"] != "teruisi_jd_schema_rehearsal":
        raise RuntimeError("Unexpected isolated JD database")
    executor = MigrationExecutor(connection)
    targets = [node for node in executor.loader.graph.leaf_nodes() if node[0] != "inventory"] + [("inventory", "0011_inventory_warehouse_mapping_settings")]
    executor.migrate(targets)
    base = {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
    if len(base) != 143:
        raise RuntimeError("Synthetic predecessor is not143")
    connection.ensure_connection()
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        for table in ("ai_dingtalk_schedules", "ai_dingtalk_schedule_runs", "django_migrations"):
            cursor.execute(sql.SQL("ALTER TABLE {} OWNER TO teruisi_sales_owner").format(sql.Identifier(table)))
        cursor.execute("ALTER FUNCTION public.ai_runtime_write_fence() OWNER TO teruisi_sales_owner")
        cursor.execute("ALTER FUNCTION public.ai_immutable_record_guard() OWNER TO teruisi_sales_owner")
        cursor.execute("GRANT USAGE,CREATE ON SCHEMA public TO teruisi_sales_owner")
    def grant_inventory():
        from teruisi_backend.health import INVENTORY_WRITER_TABLE_PRIVILEGES
        with connection.cursor() as cursor:
            for table in catalog.TABLES:
                cursor.execute(sql.SQL("GRANT {} ON {} TO teruisi_inventory_writer").format(sql.SQL(",".join(INVENTORY_WRITER_TABLE_PRIVILEGES[table])), sql.Identifier(table)))
                if not table.endswith("audits"):
                    cursor.execute(sql.SQL("GRANT SELECT ON {} TO teruisi_inventory_reader").format(sql.Identifier(table)))
    def reject(call, label):
        try:
            call()
        except (ValueError,RuntimeError,DatabaseError):
            return
        raise RuntimeError("Negative accepted: " + label)
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
    if "--capture-catalog" in sys.argv:
        MigrationExecutor(connection).migrate([tuple(catalog.STEPS[-1].split(".",1))])
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
        grant_inventory()
        with connection.cursor() as cursor:
            reference = catalog.inspect_tables(cursor)
        (ROOT / "tools/jd_logistics_catalog.json").write_text(json.dumps(reference,indent=2),encoding="utf8")
        return
    from postgres_no_key_backup import verify_receipt_generation
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) !=143:
            raise RuntimeError("Base catalogue failed143")
    try:
        with patch.object(addition,"verify_empty",side_effect=ValueError("injected rollback")):
            addition.apply_steps(connection,base)
    except ValueError as error:
        if str(error)!="injected rollback":
            raise
    else:
        raise RuntimeError("Injected failure did not rollback")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor)!=143:
            raise RuntimeError("Atomic rollback failed")
    # Legacy partial/unrecorded/extra identities must fail without a146 receipt.
    for statement in ("CREATE TABLE inventory_jd_logistics_extra(id int)", "CREATE TABLE inventory_jd_logistics_facts(id int)",
        "INSERT INTO django_migrations(app,name,applied) VALUES ('inventory','0012_jd_logistics',now())",
        "INSERT INTO django_migrations(app,name,applied) VALUES ('inventory','9999_unknown',now())"):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(statement)
                reject(lambda:verify_receipt_generation(cursor),statement)
            transaction.set_rollback(True)
    addition.apply_steps(connection,base)
    reject(lambda:addition.apply_steps(connection,base),"committed replay")
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    grant_inventory()
    with connection.cursor() as cursor:
        catalog.verify_catalog(cursor,installed=True,permissions=True)
        catalog.verify_empty(cursor)
        if verify_receipt_generation(cursor)!=146:
            raise RuntimeError("Result catalogue failed146")
    addition.check_database(connection,base,permissions=True,empty=True)
    for statement in ("ALTER TABLE inventory_jd_logistics_departments ADD COLUMN extra text",
        "ALTER TABLE inventory_jd_logistics_departments ALTER name DROP NOT NULL",
        "ALTER TABLE inventory_jd_logistics_departments DROP CONSTRAINT inv_jdl_replen_cycle_ck",
        "DROP INDEX inv_jdl_fact_scope_idx",
        "ALTER TABLE inventory_jd_logistics_facts ENABLE ROW LEVEL SECURITY",
        "DELETE FROM django_migrations WHERE app='inventory' AND name='0013_jd_logistics_notifications'",
        "INSERT INTO django_migrations(app,name,applied) VALUES ('inventory','9999_unknown',now())"):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(statement)
                reject(lambda:verify_receipt_generation(cursor),statement)
            transaction.set_rollback(True)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("GRANT UPDATE ON inventory_jd_logistics_facts TO teruisi_inventory_reader")
            reject(lambda:catalog.verify_catalog(cursor,installed=True,permissions=True),"reader writes")
        transaction.set_rollback(True)
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_inventory_reader")
        for table in catalog.TABLES:
            if not table.endswith("audits"):
                cursor.execute(sql.SQL("SELECT * FROM {} LIMIT 1").format(sql.Identifier(table)))
        reject(lambda:cursor.execute("DELETE FROM inventory_jd_logistics_facts WHERE false"),"reader delete")
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_inventory_writer")
        cursor.execute("UPDATE inventory_jd_logistics_departments SET name=name WHERE false")
        reject(lambda:cursor.execute("UPDATE inventory_jd_logistics_facts SET goods_code=goods_code WHERE false"),"writer fact update")
        reject(lambda:cursor.execute("DELETE FROM inventory_jd_logistics_audits WHERE false"),"writer audit delete")
        cursor.execute("RESET ROLE")
    # Start an actual isolated inventory_reader process with the granted login,
    # then exercise its real HMAC GET boundary over loopback HTTP.
    import base64, hashlib, hmac, time, urllib.request, urllib.error
    reader_password=secrets.token_hex(32)
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("ALTER ROLE teruisi_inventory_reader LOGIN PASSWORD {}").format(sql.Literal(reader_password)))
        cursor.execute("GRANT USAGE ON SCHEMA public TO teruisi_inventory_reader")
        cursor.execute("GRANT SELECT ON inventory_data_revisions TO teruisi_inventory_reader")
    env=os.environ.copy()
    env.update(TERUISI_DJANGO_PROCESS_ROLE="inventory_reader",TERUISI_DJANGO_EXPECT_READ_ONLY="1",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://teruisi_inventory_reader:{reader_password}@127.0.0.1:{params['PORT']}/teruisi_jd_schema_rehearsal")
    reader_port=int(params["PORT"])+1
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with (directory/"reader-process.log").open("xb") as output:
        child=subprocess.Popen([sys.executable,"-m","waitress",f"--listen=127.0.0.1:{reader_port}","teruisi_backend.wsgi:application"],env=env,stdout=output,stderr=output,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for attempt in range(80):
                if child.poll() is not None:
                    raise RuntimeError("Isolated reader process exited; inspect reader-process.log")
                try:
                    with opener.open(f"http://127.0.0.1:{reader_port}/health/live",timeout=1) as response:
                        if response.status==200:break
                except OSError:time.sleep(0.1)
            else:raise RuntimeError("Isolated inventory reader failed to start")
            path="/api/inventory/jd-logistics";query="operation=options"
            principal=base64.urlsafe_b64encode(json.dumps({"email":"fixture@example.invalid","displayName":"synthetic","role":"admin","scope":None},separators=(",",":")).encode()).decode().rstrip("=")
            timestamp=str(int(time.time()));request_id=secrets.token_hex(16);body=hashlib.sha256(b"").hexdigest()
            canonical="\n".join(["v1",timestamp,request_id,"GET",path,query,body,principal])
            signature=hmac.new(env["TERUISI_DJANGO_INTERNAL_SECRET"].encode(),canonical.encode(),hashlib.sha256).hexdigest()
            headers={"X-Teruisi-Principal":principal,"X-Teruisi-Timestamp":timestamp,"X-Teruisi-Request-Id":request_id,"X-Teruisi-Content-SHA256":body,"X-Teruisi-Signature":"v1="+signature}
            with opener.open(urllib.request.Request(f"http://127.0.0.1:{reader_port}{path}?{query}",headers=headers),timeout=5) as response:
                data=json.load(response)
                if response.status!=200 or data.get("success") is not True or data["data"].get("departments")!=[]:
                    raise RuntimeError("Isolated signed JD reader GET failed")
            try:opener.open(f"http://127.0.0.1:{reader_port}{path}?{query}",timeout=5)
            except urllib.error.HTTPError as error:
                if error.code!=401:raise
            else:raise RuntimeError("Unsigned JD reader request accepted")
            (directory/"reader-proof.json").write_text(json.dumps({"status":"passed","processRole":"inventory_reader","signedOptions":200,"unsignedOptions":401,"productionTouched":False}),encoding="utf8")
        finally:
            child.terminate();child.wait(timeout=10)
    apps=MigrationExecutor(connection).loader.project_state().apps
    catalog.verify_defaults(apps)
    # Insert defaults and cycle checks only in the synthetic cluster.
    model=apps.get_model("inventory","JdLogisticsDepartment")
    with transaction.atomic():
        item=model.objects.create(id="synthetic",name="synthetic",business_unit_code="synthetic",updated_by="fixture@example.invalid")
        if item.logistics_enabled or item.monitor_enabled or item.push_enabled or item.replenishment_cycle_days!=30:
            raise RuntimeError("JD defaults enabled capabilities")
        transaction.set_rollback(True)
    proof={"version":"jd-schema-private-postgres-v1","status":"passed","productionTouched":False,
        "steps":list(catalog.STEPS),"codeSha256":addition.code_digest(ROOT),"migrationSha256":addition.common.digest(addition.common.migrations(ROOT)),
        "checks":sorted(addition.CHECKS),"generations":[143,146]}
    (directory/"jd-schema-validation.json").write_text(json.dumps(proof,indent=2),encoding="utf8")
    print(json.dumps({"status":"passed","productionTouched":False,"validation":str(directory/"jd-schema-validation.json")}),flush=True)


def launch():
    if ROOT == Path(r"D:\运营管理系统"):
        raise RuntimeError("Require isolated worktree")
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="jd-schema-addition-", dir=scratch))
    port = None
    for candidate in range(55960, 55970):
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
