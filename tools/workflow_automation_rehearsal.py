"""Own one synthetic cluster; never production credentials, ports or services.

Builds a synthetic154 predecessor, then exercises this generation's own four
gates (admission/plan/install/finalize) positively and negatively. The ancestor
generations' installers are not re-rehearsed here -- each has its own rehearsal
-- so the154 predecessor is reached with Django's own executor and the real role
provisioning, not by replaying eleven apply_steps.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

ROOT = Path(os.environ.get("WORKFLOW_SCHEMA_SOURCE_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
sys.path.insert(0, str(ROOT / "tools"))
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
DATABASE = "teruisi_workflow_automation_rehearsal"
PORT_LOW, PORT_HIGH = 55500, 55510


def assert_isolated_source():
    # ASCII escape spelling survives Windows shell/code-page transport.
    forbidden = (Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf").resolve(),
                 Path("D:/teruisi-runtime").resolve())
    if any(ROOT == path or path in ROOT.parents for path in forbidden):
        raise RuntimeError("Require isolated source outside production checkout/runtime")


def command(args, label, environment, directory, timeout=900):
    with (directory / (label + ".log")).open("xb") as output:
        result = subprocess.run([str(x) for x in args], env=environment, cwd=ROOT,
            stdout=output, stderr=output, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(label + " failed; inspect retained synthetic log")


def domain_role_grants(script, variables):
    """Run a domain service's own embedded provisioning code, never a copy of it.

    The ancestor catalogues assert ACLs down to individual sequence USAGE
    grants, so reproducing those grants by hand here would be a second, drifting
    definition. This extracts the here-string each django-<domain>-service.ps1
    already embeds and executes exactly that.
    """
    import secrets as _secrets
    from unittest.mock import patch
    code = (ROOT / script).read_text(encoding="utf-8-sig").split("    $code = @'\n", 1)[1].split("\n'@", 1)[0]
    environment = {"TERUISI_PROVISION_DATABASE_URL": os.environ["TERUISI_DJANGO_DATABASE_URL"]}
    environment.update({name: _secrets.token_hex(32) for name in variables})
    with patch.dict(os.environ, environment):
        exec(compile(code, "private_role_provision.py", "exec"), {})


def build_parent154(connection):
    """Reach the exact154 receipt set with the project's own migrations/roles."""
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from psycopg import sql
    from ai_assistant.database_contract import provision
    executor = MigrationExecutor(connection)
    # Everything except workflow goes to its leaf; workflow stops at 0008, so the
    # two migrations this generation adopts are exactly what is missing. The
    # migrations run as the fixture superuser because some of them create roles,
    # which teruisi_sales_owner deliberately cannot do; ownership is reassigned
    # afterwards so every ancestor catalogue's owner-by-name assertion holds.
    targets = [node for node in executor.loader.graph.leaf_nodes() if node[0] != "workflow"]
    targets.append(("workflow", "0008_new_product_shop_plan"))
    executor.migrate(targets)
    with connection.cursor() as cursor:
        cursor.execute("GRANT USAGE,CREATE ON SCHEMA public TO teruisi_sales_owner")
        # Only public-schema application objects: REASSIGN OWNED would also try
        # to move catalogue objects the database system requires.
        # An identity/serial sequence cannot be reassigned on its own; it follows
        # its owning table, so those are filtered out here.
        cursor.execute("SELECT c.relkind,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                       "WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m') "
                       "AND pg_get_userbyid(c.relowner)=current_user "
                       "AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid "
                       "AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i')) "
                       "ORDER BY c.relkind,c.relname")
        for kind, name in cursor.fetchall():
            keyword = {"r": "TABLE", "p": "TABLE", "S": "SEQUENCE", "v": "VIEW", "m": "MATERIALIZED VIEW"}[kind]
            cursor.execute(sql.SQL("ALTER {} public.{} OWNER TO teruisi_sales_owner").format(
                sql.SQL(keyword), sql.Identifier(name)))
        cursor.execute("SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                       "WHERE n.nspname='public' AND pg_get_userbyid(p.proowner)=current_user ORDER BY 1")
        for (signature,) in cursor.fetchall():
            cursor.execute(sql.SQL("ALTER {} {} OWNER TO teruisi_sales_owner").format(
                sql.SQL("FUNCTION"), sql.SQL(signature)))
    base = {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
    if len(base) != 154:
        raise RuntimeError("Synthetic predecessor is not the exact154 catalogue: " + str(len(base)))
    connection.ensure_connection()
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    # Each domain's own embedded provisioning code, so the ancestor catalogues'
    # exact table/column/sequence ACL expectations are reproduced, not guessed.
    domain_role_grants("tools/django-inventory-service.ps1",
                       ("TERUISI_PROVISION_INVENTORY_READER_PASSWORD", "TERUISI_PROVISION_INVENTORY_WRITER_PASSWORD"))
    domain_role_grants("tools/django-workflow-service.ps1",
                       ("TERUISI_PROVISION_WORKFLOW_READER_PASSWORD", "TERUISI_PROVISION_WORKFLOW_WRITER_PASSWORD"))
    return base


def capture():
    import django
    django.setup()
    from django.db import connection, transaction, DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from psycopg import sql
    from unittest.mock import patch
    import workflow_automation_catalog as catalog
    import workflow_automation_addition as addition
    from postgres_no_key_backup import verify_receipt_generation
    directory = Path(os.environ["WORKFLOW_SCHEMA_REHEARSAL_DIR"])
    params = connection.settings_dict
    if (params["HOST"] != "127.0.0.1" or not PORT_LOW <= int(params["PORT"]) < PORT_HIGH
            or params["NAME"] != DATABASE):
        raise RuntimeError("Unexpected isolated Workflow156 database")

    def reject(call, label):
        try:
            call()
        except (ValueError, RuntimeError, DatabaseError):
            return
        raise RuntimeError("Negative accepted: " + label)

    base154 = build_parent154(connection)
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        if verify_receipt_generation(cursor) != 154:
            raise RuntimeError("Synthetic154 catalogue failed")
        before = catalog.preservation(cursor)

    if "--capture-catalog" in sys.argv:
        MigrationExecutor(connection).migrate([tuple(step.split(".", 1)) for step in catalog.STEPS])
        with connection.cursor() as cursor:
            reference = catalog.inspect_tables(cursor)
            reference["sequence"] = catalog.sequence_catalog(cursor)
        (ROOT / "tools/workflow_automation_catalog.json").write_text(
            json.dumps(reference, indent=2, default=str), encoding="utf8", newline="\n")
        print(json.dumps({"status": "catalog-captured", "productionTouched": False}), flush=True)
        return

    checks = set()
    # The second step must roll the first one back: a partial156 with the table
    # created but its registry unseeded must never be reachable.
    with patch.object(addition, "verify_initial_values", side_effect=ValueError("injected156 rollback")):
        reject(lambda: addition.apply_steps(connection, base154, before), "atomic154 rollback")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 154 or catalog.preservation(cursor) != before:
            raise RuntimeError("Atomic156 failure changed154")
        catalog.verify_tables(cursor, installed=False)
    checks.add("atomic-rollback-leaves-no-156-object")

    reject(lambda: addition.apply_steps(connection, base154, before | {"legacyRowsSha256": "0" * 64}),
           "stale preservation intent")
    checks.add("stale-intent-refused")
    reject(lambda: addition.apply_steps(connection, set(base154) | {"workflow.0009_automation_projection_b1"}, before),
           "wrong parent membership")
    reject(lambda: addition.steps_files(153), "wrong parent generation")
    reject(lambda: addition.steps_for_base(set(list(base154)[:153])), "short parent catalogue")
    checks.add("exact-154-parent-required")

    addition.apply_steps(connection, base154, before)
    checks.update({"atomic-upgrade", "exact-154-156", "registry-seeded", "legacy-data-preserved"})
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 156:
            raise RuntimeError("Exact156 postcondition failed")
        catalog.verify_catalog(cursor)
        catalog.verify_initial_values(cursor)
        catalog.verify_registry_rows(cursor)
        if catalog.preservation(cursor) != before:
            raise RuntimeError("Workflow156 changed legacy rows or permissions")
    checks.add("catalog-frozen")

    # Replay must be refused rather than silently re-applied.
    reject(lambda: addition.apply_steps(connection, base154, before), "replay after install")
    checks.add("no-replay")

    # A registry row edited after install must be caught by verify_registry_rows.
    # Each probe runs inside its own rolled-back transaction so the verified156
    # state the later checks read is never actually modified.
    class Rollback(Exception):
        pass

    def probe(body, label):
        try:
            with transaction.atomic(using=connection.alias):
                with connection.cursor() as cursor:
                    body(cursor)
                raise Rollback(label)
        except Rollback:
            return
    def tamper_registry(cursor):
        cursor.execute(sql.SQL("UPDATE {} SET label='tampered' WHERE module_key=%s").format(
            sql.Identifier(catalog.REGISTRY_TABLE)), [sorted(catalog.registry_rows())[0]])
        # verify_initial_values must NOT be what catches this: it says nothing
        # about the registry table, so a tampered row has to fail the dedicated
        # verify_registry_rows check instead.
        catalog.verify_initial_values(cursor)
        reject(lambda: catalog.verify_registry_rows(cursor), "tampered registry row")
    probe(tamper_registry, "registry")
    with connection.cursor() as cursor:
        catalog.verify_registry_rows(cursor)
    checks.add("registry-values-pinned")

    # A business row in one of the three empty tables must be caught too.
    def insert_business_row(cursor):
        cursor.execute("INSERT INTO automation_logical_runs(logical_run_id,chain_key,subject_key,plan_date,"
                       "business_range,trigger_source,plan_summary,overall_status,created_at,updated_at) "
                       "VALUES(gen_random_uuid(),'probe','probe',CURRENT_DATE,'{}','manual','{}','not_due',now(),now())")
        reject(lambda: catalog.verify_initial_values(cursor), "business row in empty table")
    probe(insert_business_row, "empty")
    checks.add("empty-tables-pinned")

    # A registry row deleted after install must be caught as well.
    def delete_registry_row(cursor):
        cursor.execute(sql.SQL("DELETE FROM {} WHERE module_key=%s").format(
            sql.Identifier(catalog.REGISTRY_TABLE)), [sorted(catalog.registry_rows())[0]])
        reject(lambda: catalog.verify_registry_rows(cursor), "missing registry row")
    probe(delete_registry_row, "registry-missing")
    checks.add("registry-membership-pinned")

    # The adopted tables stay owner-only: no workflow role may read them.
    for role in ("teruisi_workflow_reader", "teruisi_workflow_writer"):
        def role_read(cursor, role=role):
            cursor.execute("RESET ROLE")
            cursor.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(role)))
            for table in catalog.TABLES:
                reject(lambda table=table: cursor.execute(
                    sql.SQL("SELECT * FROM {} LIMIT 0").format(sql.Identifier(table))), "role read of " + table)
        probe(role_read, "role-" + role)
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
    checks.add("owner-only-acl")

    # Ordinary startup must find nothing pending after this generation.
    addition.check_database(connection, frozenset(base154), permissions=True, seeded=True)
    checks.add("no-pending-migrations")

    result = {"status": "completed", "generations": [154, 156], "checks": sorted(checks),
              "productionTouched": False, "fullBackupOrRestorePerformed": False,
              "database": params["NAME"], "port": int(params["PORT"])}
    (directory / "rehearsal-result.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps(result), flush=True)


def launch():
    assert_isolated_source()
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="workflow-automation-", dir=scratch))
    port = None
    for candidate in range(PORT_LOW, PORT_HIGH):
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", candidate))
            port = candidate
            break
        except OSError:
            pass
    if port is None:
        raise RuntimeError("No isolated Workflow156 rehearsal port")
    password = secrets.token_hex(32)
    password_file = directory / "password"
    password_file.write_text(password, encoding="ascii")
    environment = {k: v for k, v in os.environ.items() if k.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
    environment.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="workflow_fixture", PGPASSWORD=password,
        PGDATABASE=DATABASE, PYTHONUTF8="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://workflow_fixture:{password}@127.0.0.1:{port}/{DATABASE}",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend") + os.pathsep + str(ROOT / "tools"),
        WORKFLOW_SCHEMA_REHEARSAL_DIR=str(directory), WORKFLOW_SCHEMA_SOURCE_ROOT=str(ROOT))
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        f"    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or not {PORT_LOW}<=address[1]<{PORT_HIGH}:\n"
        "        raise RuntimeError('Isolated Workflow156 rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started = False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "workflow_fixture", "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "init", environment, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", environment, directory)
        started = True
        command([BIN / "createdb.exe", DATABASE], "createdb", environment, directory)
        roles = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_ai_reader", "teruisi_ai_writer",
                 "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer",
                 "teruisi_inventory_reader", "teruisi_inventory_writer", "teruisi_workflow_reader",
                 "teruisi_workflow_writer", "teruisi_market_reader", "teruisi_market_writer",
                 "teruisi_products_reader", "teruisi_products_writer", "teruisi_access_control_reader",
                 "teruisi_access_control_writer", "teruisi_customer_service_reader", "teruisi_customer_service_writer",
                 "teruisi_erp_reference_reader", "teruisi_erp_reference_writer")
        for role in roles:
            command([BIN / "psql.exe", "-v", "ON_ERROR_STOP=1", "-c",
                     f"CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"],
                    role, environment, directory)
        command([sys.executable, __file__, "--child", *sys.argv[1:]], "rehearsal", environment, directory)
        print(json.dumps({"status": "completed", "directory": str(directory), "productionTouched": False}), flush=True)
    finally:
        if started:
            command([BIN / "pg_ctl.exe", "-D", directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", environment, directory)
        password_file.unlink(missing_ok=True)
        print(json.dumps({"phase": "cleanup", "stopped": started, "passwordFileRemoved": not password_file.exists()}), flush=True)


if __name__ == "__main__":
    capture() if "--child" in sys.argv else launch()
