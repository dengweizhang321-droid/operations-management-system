"""Synthetic PG17 162->163 sales subdivision edits proof. Never accepts production input.

Builds the exact verified162 structure in a private PostgreSQL 17 cluster (the verified159 parent
through the real parent gates, then the three OpsQueryIndex steps through the real OpsQueryIndex gate),
loads a few synthetic rows, executes sales.0014 through the real SalesSubdivisionEdits gate
(apply_steps), checks the real catalogue with the generation's own verifier in the owner-only state and
after the ACL grants, asserts the reader/writer privileges and the sequence privilege actually enforced
by PostgreSQL, and proves that a missing table, an excess grant and a replay are refused.
Executes the PG17 binaries under the runtime tree: run only with explicit approval, from a source tree
outside the production checkout.

    D:\\teruisi-runtime\\django-sales\\venv\\Scripts\\python.exe -B tools\\sales_subdivision_edits_rehearsal.py
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import ops_query_index_rehearsal as parent_rehearsal  # noqa: E402  (only its helpers; nothing runs on import)

BIN = parent_rehearsal.BIN
DATABASE = "teruisi_sales_subdivision_edits_rehearsal"
FIXTURE_USER = "sub163_fixture"
PORTS = range(55542, 55552)
RESULT = ROOT / "docs/subdivision-category-edit-20261126/rehearsal-result.json"
VERSION = "teruisi-sales-subdivision-edits-pg-rehearsal-v1"
TEMP_PREFIX = "sub163-pg17-"
CHECKS = {
    "exact162-parent", "step-applied-by-real-gate", "exact163-catalog-owner-only", "exact163-catalog-provisioned-acl",
    "old-rows-and-ACL-preserved", "new-tables-empty", "reader-writer-privileges-enforced",
    "missing-table-rejected-and-rolled-back", "excess-grant-rejected", "committed163-not-replayed",
}
ROLES = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_sales_reader", "teruisi_sales_writer",
         "teruisi_ai_reader", "teruisi_ai_writer",
         "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer",
         "teruisi_inventory_reader", "teruisi_inventory_writer", "teruisi_workflow_reader", "teruisi_workflow_writer",
         "teruisi_market_reader", "teruisi_market_writer", "teruisi_products_reader", "teruisi_products_writer",
         "teruisi_access_control_reader", "teruisi_access_control_writer", "teruisi_customer_service_reader",
         "teruisi_customer_service_writer", "teruisi_erp_reference_reader", "teruisi_erp_reference_writer")


class ExpectedRejection(Exception):
    """Only the expected catalogue mismatch may mark a negative probe passed."""


def assert_private_port(port):
    if port == 5432 or port not in PORTS:
        raise RuntimeError("Port is not in the synthetic rehearsal range")
    return port


def assert_private_identity(settings):
    """Hard-coded private identity; a wrong host, port, database or role never proceeds."""
    assert_private_port(int(settings["PORT"]))
    if settings["HOST"] != "127.0.0.1" or settings["NAME"] != DATABASE or settings["USER"] != FIXTURE_USER:
        raise RuntimeError("Private synthetic database identity differs")


def build_parent162(connection):
    """The exact verified162 structure: the real verified159 parent plus the three real OpsQueryIndex steps."""
    from django.db.migrations.recorder import MigrationRecorder
    import ops_query_index_addition as ops_gate
    import ops_query_index_catalog as ops_catalog
    from postgres_no_key_backup import verify_receipt_generation
    base159 = parent_rehearsal.build_parent159(connection)
    with connection.cursor() as cursor:
        before = ops_catalog.preservation(cursor)
    ops_gate.apply_steps(connection, base159, before)
    base162 = {".".join(node) for node in MigrationRecorder(connection).applied_migrations()}
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 162 or len(base162) != 162:
            raise RuntimeError("Expected exact verified162 parent")
    return base162


def load_synthetic_rows(connection):
    """A few parent rows, so the preservation digest is not trivially empty."""
    import datetime
    from sales.models import SalesOrderLine
    rows = [SalesOrderLine(**parent_rehearsal.synthetic_values(
        SalesOrderLine, source_row_number=i, source_line_key="L%08d" % i,
        business_date=datetime.date(2026, 11, 1) + datetime.timedelta(days=i % 7),
        is_business_row=True, product_code="P%d" % (i % 20))) for i in range(300)]
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
        cursor.execute("SET session_replication_role = replica")
    SalesOrderLine.objects.bulk_create(rows, batch_size=100)
    with connection.cursor() as cursor:
        cursor.execute("SET session_replication_role = DEFAULT")
        cursor.execute("SET ROLE teruisi_sales_owner")


def provision_acl(connection):
    """The same grants the ordinary Django start applies (provision, then provision_subdivisions)."""
    from sales.analysis_options_permissions import provision
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
        provision(cursor)
        cursor.execute("SET ROLE teruisi_sales_owner")


def refuses(callback, needle):
    """True only when the callback raises the catalogue ValueError that names the expected cause."""
    try:
        callback()
    except ValueError as error:
        if needle not in str(error):
            raise
        return True
    raise RuntimeError("Expected refusal was accepted: " + needle)


def enforce_privileges(connection):
    """What PostgreSQL itself enforces for the reader and writer roles, rolled back afterwards."""
    from django.db import transaction, DatabaseError
    results = {}

    def attempt(cursor, statement):
        cursor.execute("SAVEPOINT probe")
        try:
            cursor.execute(statement)
        except DatabaseError:
            cursor.execute("ROLLBACK TO SAVEPOINT probe")
            return False
        cursor.execute("RELEASE SAVEPOINT probe")
        return True

    insert_label = ("INSERT INTO sales_subdivision_labels(major_category,name,sort_order,is_deleted,created_at,updated_at,updated_by) "
                    "VALUES ('c','n',0,false,now(),now(),'x')")
    insert_override = ("INSERT INTO sales_product_subdivision_overrides(product_code,major_category,label,source_name,updated_at,updated_by) "
                       "VALUES ('p','c','','',now(),'x')")
    try:
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
            cursor.execute("SET LOCAL ROLE teruisi_sales_reader")
            results["reader"] = {
                "select": [attempt(cursor, "SELECT 1 FROM sales_subdivision_labels LIMIT 1"),
                           attempt(cursor, "SELECT 1 FROM sales_product_subdivision_overrides LIMIT 1")],
                "write": [attempt(cursor, insert_label), attempt(cursor, insert_override)]}
            cursor.execute("RESET ROLE")
            cursor.execute("SET LOCAL ROLE teruisi_sales_writer")
            results["writer"] = {
                "insert": [attempt(cursor, insert_label), attempt(cursor, insert_override)],
                "update": [attempt(cursor, "UPDATE sales_subdivision_labels SET sort_order=1"),
                           attempt(cursor, "UPDATE sales_product_subdivision_overrides SET label='x'")],
                "delete": [attempt(cursor, "DELETE FROM sales_subdivision_labels"),
                           attempt(cursor, "DELETE FROM sales_product_subdivision_overrides")],
                "truncate": attempt(cursor, "TRUNCATE sales_subdivision_labels"),
                "sequence": attempt(cursor, "SELECT nextval(pg_get_serial_sequence('sales_subdivision_labels','id'))")}
            raise ExpectedRejection()
    except ExpectedRejection:
        pass
    if results != {
        "reader": {"select": [True, True], "write": [False, False]},
        "writer": {"insert": [True, True], "update": [True, True], "delete": [False, True], "truncate": False, "sequence": True},
    }:
        raise RuntimeError("Reader/writer privileges differ from the reviewed contract: " + json.dumps(results))
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
    return results


def child():
    import django
    django.setup()
    from django.db import connection, transaction
    import sales_subdivision_edits_addition as gate
    import sales_subdivision_edits_catalog as catalog
    from postgres_no_key_backup import verify_receipt_generation
    started = time.monotonic()
    assert_private_identity(connection.settings_dict)
    directory = Path(os.environ["SUB163_REHEARSAL_DIR"])
    base = build_parent162(connection)
    load_synthetic_rows(connection)
    checks = []
    with connection.cursor() as cursor:
        catalog.verify_catalog(cursor, installed=False)
        before = catalog.preservation(cursor)
    checks.append("exact162-parent")
    apply_started = time.monotonic()
    gate.apply_steps(connection, base, before)
    apply_seconds = round(time.monotonic() - apply_started, 3)
    checks.append("step-applied-by-real-gate")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor, subdivision_permissions=False) != 163:
            raise RuntimeError("Expected exact163 after the step")
        catalog.verify_catalog(cursor, permissions=False)
        catalog.verify_catalog(cursor, permissions="either")
        refuses(lambda: catalog.verify_tables(cursor, permissions=True), "ACL differs")
    checks.append("exact163-catalog-owner-only")
    with connection.cursor() as cursor:
        catalog.verify_initial_values(cursor)
    checks.append("new-tables-empty")
    provision_acl(connection)
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 163:
            raise RuntimeError("Expected exact163 with the provisioned ACL")
        catalog.verify_catalog(cursor, permissions=True)
        catalog.verify_catalog(cursor, permissions="either")
        refuses(lambda: catalog.verify_tables(cursor, permissions=False), "ACL differs")
        cursor.execute("SELECT 1")
        if catalog.preservation(cursor) != before:
            raise RuntimeError("The step or the grants changed prior rows or ACL")
    checks += ["exact163-catalog-provisioned-acl", "old-rows-and-ACL-preserved"]
    enforce_privileges(connection)
    checks.append("reader-writer-privileges-enforced")

    def probe(statement, verifier):
        try:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(statement)
                try:
                    verifier(cursor)
                except ValueError as error:
                    raise ExpectedRejection() from error
                raise RuntimeError("Deviation was accepted: " + statement)
        except ExpectedRejection:
            return True
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    if probe("DROP TABLE public.sales_product_subdivision_overrides", lambda c: catalog.verify_catalog(c)):
        checks.append("missing-table-rejected-and-rolled-back")
    if (probe("GRANT DELETE ON public.sales_subdivision_labels TO teruisi_sales_writer", lambda c: catalog.verify_catalog(c))
            and probe("GRANT INSERT ON public.sales_product_subdivision_overrides TO teruisi_sales_reader", lambda c: catalog.verify_catalog(c))
            and probe("GRANT SELECT ON public.sales_subdivision_labels TO PUBLIC", lambda c: catalog.verify_catalog(c, permissions="either"))):
        checks.append("excess-grant-rejected")
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        catalog.verify_catalog(cursor)
    try:
        gate.apply_steps(connection, base, before)
    except ValueError:
        checks.append("committed163-not-replayed")
    else:
        raise RuntimeError("Committed migration replay was accepted")
    if set(checks) != CHECKS:
        raise RuntimeError("PG rehearsal check set is incomplete")
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('server_version_num')::integer")
        server_version = cursor.fetchone()[0]
    (directory / "result.json").write_text(json.dumps({
        "version": VERSION, "status": "passed", "generations": [162, 163], "checks": sorted(checks),
        "productionTouched": False, "fullBackupOrRestorePerformed": False,
        "database": {"name": DATABASE, "user": FIXTURE_USER, "port": int(connection.settings_dict["PORT"]), "serverVersionNumber": server_version},
        "applyStepsSeconds": apply_seconds, "totalSeconds": round(time.monotonic() - started, 3),
        "syntheticSalesRows": 300,
        "migrationSha256": gate.common.digest(gate.common.migrations(ROOT)),
        "catalogSha256": gate.catalog_digest()}, indent=2), encoding="utf8")


def launch():
    parent_rehearsal.assert_isolated_source()
    scratch = Path(tempfile.gettempdir()).resolve()  # the user's temp directory, never inside the worktree or runtime tree
    parent_rehearsal.assert_private_path(scratch)
    directory = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX, dir=scratch))
    parent_rehearsal.assert_private_path(directory)
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
    assert_private_port(port)
    password = secrets.token_hex(32)
    pwfile = directory / "password"
    pwfile.write_text(password, encoding="ascii")
    env = {k: v for k, v in os.environ.items() if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
    env.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER=FIXTURE_USER, PGPASSWORD=password,
        PGDATABASE=DATABASE, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        PYTHONPYCACHEPREFIX=str(directory / "isolated-empty-bytecode-cache"),
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://{FIXTURE_USER}:{password}@127.0.0.1:{port}/{DATABASE}",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend") + os.pathsep + str(ROOT / "tools"),
        SUB163_REHEARSAL_DIR=str(directory))
    # HONEST LIMIT: this sitecustomize patch only guards Python-level socket.connect. psycopg/libpq connects in C
    # and is NOT stopped by it. The real database defences are (1) the private env built from scratch above,
    # (2) assert_private_identity() on the only Django connection before any query, and (3) the fixed
    # synthetic port range. Do not treat this patch as a barrier against a database connection.
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        f"    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or address[1]!={port}:\n"
        "        raise RuntimeError('SalesSubdivisionEdits rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    command = parent_rehearsal.command
    started, stopped, succeeded = False, False, False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", FIXTURE_USER, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "init", env, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as out:
            out.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", env, directory)
        started = True
        command([BIN / "createdb.exe", DATABASE], "createdb", env, directory)
        for role in ROLES:
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
            if (directory.resolve().parent != scratch or not directory.name.startswith(TEMP_PREFIX)
                    or data.resolve() != directory.resolve() / "data" or data.is_symlink()):
                raise RuntimeError("Unexpected private cleanup target")
            parent_rehearsal.assert_private_path(data)
            shutil.rmtree(data)
        cleanup = {"started": started, "stopped": stopped, "privateDataRemoved": not data.exists(), "passwordFileRemoved": not pwfile.exists(), "childExitZero": succeeded}
        (directory / "cleanup.json").write_text(json.dumps(cleanup), encoding="utf8")
        print(json.dumps({"phase": "cleanup", "directory": str(directory), **cleanup}), flush=True)
    result = json.loads((directory / "result.json").read_text(encoding="utf8"))
    result["cleanup"] = cleanup
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf8", newline="\n")
    if directory.parent == scratch and directory.name.startswith(TEMP_PREFIX) and not directory.is_symlink():
        shutil.rmtree(directory)  # success: logs are no longer needed; on failure they are retained


if __name__ == "__main__":
    child() if "--child" in sys.argv else launch()
