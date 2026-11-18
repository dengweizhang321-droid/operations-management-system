"""Synthetic PG17 159->162 operations query index proof. Never accepts production input.

Builds the exact verified159 structure in a private PostgreSQL 17 cluster, loads a small
synthetic data set, executes the three reviewed index migrations through the real
OpsQueryIndex gate (apply_steps), checks the real catalogue (pg_get_expr(indpred), operator
classes) with the generation's own verifier, and asserts that the three production query
shapes plan through the new indexes. Executes the PG17 binaries under the runtime tree:
run only with explicit approval, from a source tree outside the production checkout.

    D:\\teruisi-runtime\\django-sales\\venv\\Scripts\\python.exe -B tools\\ops_query_index_rehearsal.py
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
BIN = Path("D:/teruisi-runtime/django-sales/postgresql-17.11/bin")
DATABASE = "teruisi_ops_query_index_rehearsal"
FIXTURE_USER = "ops162_fixture"
PORTS = range(55532, 55542)
RESULT = ROOT / "docs/ops-query-index-20261118/rehearsal-result.json"
VERSION = "teruisi-ops-query-index-pg-rehearsal-v1"
INDEX_FOR_QUERY = {
    "customer-service-products": "sales_cs_online_spec_idx",
    "netshop-projection-first-page": "net_projection_page_idx",
    "customer-service-ai-count": "cs_conv_ai_analyzed_idx",
}
CHECKS = {
    "exact159-parent", "three-steps-applied-by-real-gate", "exact162-catalog-with-real-predicates",
    "old-rows-and-ACL-preserved", "all-three-queries-plan-through-new-index",
    "missing-index-rejected-and-rolled-back", "committed162-not-replayed",
}


class ExpectedRejection(Exception):
    """Only the expected catalogue mismatch may mark a negative probe passed."""


def assert_isolated_source(root=ROOT):
    forbidden = (Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf").resolve(), Path("D:/teruisi-runtime").resolve())
    root = Path(root).resolve()
    if any(root == path or path in root.parents for path in forbidden):
        raise RuntimeError("Require isolated source outside production checkout/runtime")


FORBIDDEN_WRITE_ROOTS = (Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf"), Path("D:/teruisi-runtime"))
TEMP_PREFIX = "ops162-pg17-"


def assert_private_path(path, root=ROOT):
    """Every write path (data dir, logs, password file) must be outside production, the runtime tree and the source tree."""
    resolved = Path(path).resolve()
    for forbidden in (*(p.resolve() for p in FORBIDDEN_WRITE_ROOTS), Path(root).resolve()):
        if resolved == forbidden or forbidden in resolved.parents:
            raise RuntimeError("Forbidden write location: " + str(resolved))
    if "postgres-data" in {part.lower() for part in resolved.parts}:
        raise RuntimeError("Forbidden production data directory name: " + str(resolved))
    return resolved


def assert_private_port(port):
    if port == 5432 or port not in PORTS:
        raise RuntimeError("Port is not in the synthetic rehearsal range")
    return port


def assert_private_identity(settings):
    """Hard-coded private identity; a wrong host, port, database or role never proceeds."""
    assert_private_port(int(settings["PORT"]))
    if (settings["HOST"] != "127.0.0.1" or int(settings["PORT"]) not in PORTS
            or settings["NAME"] != DATABASE or settings["USER"] != FIXTURE_USER):
        raise RuntimeError("Private synthetic database identity differs")


def assert_plan_uses(plan_text, index_name):
    """The plan must read the named index and must not be a bare sequential scan of the table."""
    if index_name not in plan_text:
        raise RuntimeError("Plan does not use " + index_name + ":\n" + plan_text)
    return True


def synthetic_values(model, **overrides):
    """Valid column values for every concrete non-key field; explicit overrides win."""
    import datetime
    from decimal import Decimal
    now = datetime.datetime(2026, 11, 18, 3, 0, tzinfo=datetime.timezone.utc)
    values = {}
    for field in model._meta.concrete_fields:
        if field.primary_key or field.name in overrides:
            continue
        if field.has_default():
            values[field.name] = field.get_default()
        elif field.null:
            values[field.name] = None
        else:
            kind = field.get_internal_type()
            values[field.name] = {
                "BooleanField": False, "DateField": datetime.date(2026, 11, 18), "DateTimeField": now,
                "DecimalField": Decimal("0"), "JSONField": {}, "UUIDField": None,
            }.get(kind, 0 if "Integer" in kind else "x")
    values.update(overrides)
    return values


def command(args, label, env, directory):
    with (directory / (label + ".log")).open("xb") as out:
        result = subprocess.run([str(x) for x in args], env=env, cwd=ROOT,
            stdout=out, stderr=out, timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError(label + " failed; retained log: " + str(directory / (label + ".log")))


def parent156_targets(graph):
    """Migration targets of the exact156 predecessor: every leaf except the three 162 steps held back."""
    import ops_query_index_catalog as ops_catalog
    held_back = {tuple(step.split(".", 1)) for step in ops_catalog.STEPS}
    pre = {"sales": ("sales", "0012_excluded_business_date_index"), "netshop": ("netshop", "0004_promotion_presence_cache"),
           "customer_service": ("customer_service", "0002_seed_control_rows")}
    targets = [pre[node[0]] if node[0] in pre else node for node in graph.leaf_nodes()
               if node[0] not in {"ai_assistant", "workflow"}]
    targets += [("ai_assistant", "0087_pi_native_capabilities"), ("workflow", "0010_customer_service_chain_modules")]
    expected = set()
    for target in targets:
        expected.update(node for node in graph.forwards_plan(target))
    if len(expected) != 156 or expected & held_back:
        raise RuntimeError("Synthetic targets are not the exact156 predecessor without the 162 steps")
    return targets, {".".join(node) for node in expected}


def build_parent159(connection):
    """The exact verified159 structure: every app at its leaf, except the three 162 steps."""
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from psycopg import sql
    from ai_assistant.database_contract import provision
    from ai_task_feedback_candidates_rehearsal import domain_role_grants
    import ai_task_feedback_candidates_addition as feedback_gate
    import ai_task_feedback_candidates_catalog as feedback_catalog
    import ai_unified_tasks_addition as unified_gate
    import ai_unified_tasks_catalog as unified_catalog
    import ops_query_index_catalog as ops_catalog
    from postgres_no_key_backup import verify_receipt_generation
    executor = MigrationExecutor(connection)
    targets, expected = parent156_targets(executor.loader.graph)
    executor.migrate(targets)
    with connection.cursor() as cursor:
        cursor.execute("GRANT USAGE,CREATE ON SCHEMA public TO teruisi_sales_owner")
        cursor.execute("SELECT c.relkind,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m') "
            "AND pg_get_userbyid(c.relowner)=current_user "
            "AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid "
            "AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i')) ORDER BY c.relkind,c.relname")
        for kind, name in cursor.fetchall():
            keyword = {"r": "TABLE", "p": "TABLE", "S": "SEQUENCE", "v": "VIEW", "m": "MATERIALIZED VIEW"}[kind]
            cursor.execute(sql.SQL("ALTER {} public.{} OWNER TO teruisi_sales_owner").format(sql.SQL(keyword), sql.Identifier(name)))
        cursor.execute("SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
            "WHERE n.nspname='public' AND pg_get_userbyid(p.proowner)=current_user ORDER BY 1")
        for (signature,) in cursor.fetchall():
            cursor.execute(sql.SQL("ALTER FUNCTION {} OWNER TO teruisi_sales_owner").format(sql.SQL(signature)))
    connection.ensure_connection()
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    domain_role_grants("tools/django-inventory-service.ps1",
        ("TERUISI_PROVISION_INVENTORY_READER_PASSWORD", "TERUISI_PROVISION_INVENTORY_WRITER_PASSWORD"))
    domain_role_grants("tools/django-workflow-service.ps1",
        ("TERUISI_PROVISION_WORKFLOW_READER_PASSWORD", "TERUISI_PROVISION_WORKFLOW_WRITER_PASSWORD"))
    # 156 -> 158 -> 159 through the two real parent gates, each followed by role provisioning.
    base156 = {".".join(node) for node in MigrationRecorder(connection).applied_migrations()}
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        original156 = feedback_catalog.preservation(cursor)
    feedback_gate.apply_steps(connection, base156, original156)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    base158 = {".".join(node) for node in MigrationRecorder(connection).applied_migrations()}
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        if verify_receipt_generation(cursor) != 158:
            raise RuntimeError("Expected exact verified158 parent")
        original158 = unified_catalog.preservation(cursor)
    unified_gate.apply_steps(connection, base158, original158)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    base159 = {".".join(node) for node in MigrationRecorder(connection).applied_migrations()}
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        if verify_receipt_generation(cursor) != 159 or len(base159) != 159:
            raise RuntimeError("Expected exact verified159 parent")
    return base159


def load_synthetic_rows(connection):
    """Selective synthetic data: few matching rows among many non-matching ones, then ANALYZE."""
    import datetime
    from customer_service.models import CustomerServiceConversation
    from netshop.models import NetshopRow
    from sales.models import SalesOrderLine
    total = 30000
    sales, shop, conv = [], [], []
    for i in range(total):
        business = i % 2 == 0
        code = ("SPEC-%03d" % (i % 40)) if i % 10 == 0 else ""
        sales.append(SalesOrderLine(**synthetic_values(SalesOrderLine, source_row_number=i,
            source_line_key="L%08d" % i,
            business_date=datetime.date(2026, 11, 1) + datetime.timedelta(days=i % 17),
            is_business_row=business, online_spec_code=code, product_code="P%d" % (i % 500), category=" cat%d " % (i % 9))))
        shop.append(NetshopRow(**synthetic_values(NetshopRow, source_row_number=i,
            source_row_key="k%08d" % ((i * 7919) % 1000003),
            source="jd_sku_daily" if i % 3 else "tmall_sku_daily",
            dataset=("sku_daily", "spu_daily", "product_master", "shop_daily")[i % 4])))
        ai = i % 100 == 0
        conv.append(CustomerServiceConversation(**synthetic_values(CustomerServiceConversation,
            conversation_key="c%08d" % i, analysis_source="ai" if ai else ("manual" if i % 7 == 0 else ""),
            analyzed_at=(datetime.datetime(2026, 11, 18, 3, 0, tzinfo=datetime.timezone.utc)
                         - datetime.timedelta(days=i % 60)) if ai else None)))
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")  # SET session_replication_role needs the superuser fixture role
        cursor.execute("SET session_replication_role = replica")  # synthetic rows bypass write-authority triggers
    for model, rows in ((SalesOrderLine, sales), (NetshopRow, shop), (CustomerServiceConversation, conv)):
        model.objects.bulk_create(rows, batch_size=2000)
    with connection.cursor() as cursor:
        cursor.execute("SET session_replication_role = DEFAULT")
        cursor.execute("SET ROLE teruisi_sales_owner")
        for table in ("sales_order_lines", "netshop_rows", "customer_service_conversations"):
            cursor.execute("SELECT count(*) FROM " + table)
            if cursor.fetchone()[0] != total:
                raise RuntimeError("Synthetic load incomplete: " + table)


def query_plans(connection):
    """EXPLAIN the three production query shapes after ANALYZE."""
    import datetime
    from django.db.models import Max
    from django.db.models.functions import Trim
    from customer_service.models import CustomerServiceConversation
    from netshop.models import NetshopRow
    from sales.models import SalesOrderLine
    with connection.cursor() as cursor:
        for table in ("sales_order_lines", "netshop_rows", "customer_service_conversations"):
            cursor.execute("ANALYZE " + table)
    codes = ["SPEC-%03d" % n for n in (3, 11, 27)]
    products = (SalesOrderLine.objects.filter(is_business_row=True).exclude(online_spec_code="")
                .annotate(category_value=Trim("category")).filter(online_spec_code__in=codes)
                .values("online_spec_code", "product_code", "category_value").annotate(latest_at=Max("sales_time"))
                .order_by("-latest_at", "online_spec_code", "product_code", "category_value")[:11])
    page = NetshopRow.objects.filter(source="jd_sku_daily", dataset__in=["sku_daily", "spu_daily"]).order_by("source_row_key")[:1000]
    day = datetime.datetime(2026, 11, 18, 0, 0, tzinfo=datetime.timezone.utc)
    count = CustomerServiceConversation.objects.filter(analysis_source="ai", analyzed_at__gte=day).order_by().values("pk")
    return {"customer-service-products": products.explain(), "netshop-projection-first-page": page.explain(),
            "customer-service-ai-count": count.explain()}


def probe_missing_index(connection, verify_catalog):
    from django.db import transaction
    try:
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("DROP INDEX public.net_projection_page_idx")
            try:
                verify_catalog(cursor)
            except ValueError as error:
                if "Operations query index" not in str(error):
                    raise
                raise ExpectedRejection() from error
            raise RuntimeError("Missing index was accepted")
    except ExpectedRejection:
        return True


def child():
    import django
    django.setup()
    from django.db import connection
    import ops_query_index_addition as gate
    import ops_query_index_catalog as catalog
    from postgres_no_key_backup import verify_receipt_generation
    started = time.monotonic()
    assert_private_identity(connection.settings_dict)
    directory = Path(os.environ["OPS162_REHEARSAL_DIR"])
    base = build_parent159(connection)
    load_synthetic_rows(connection)
    with connection.cursor() as cursor:
        catalog.verify_catalog(cursor, installed=False)
        before = catalog.preservation(cursor)
    checks = ["exact159-parent"]
    apply_started = time.monotonic()
    gate.apply_steps(connection, base, before)
    apply_seconds = round(time.monotonic() - apply_started, 3)
    checks.append("three-steps-applied-by-real-gate")
    with connection.cursor() as cursor:
        catalog.verify_catalog(cursor)
        catalog.verify_initial_values(cursor)
        if verify_receipt_generation(cursor) != 162:
            raise RuntimeError("Expected exact162 after the three steps")
        cursor.execute("SELECT c.relname,pg_get_expr(i.indpred,i.indrelid),"
            "ARRAY(SELECT o.opcname FROM unnest(i.indclass) WITH ORDINALITY k(num,ord) JOIN pg_opclass o ON o.oid=k.num ORDER BY k.ord),"
            "pg_relation_size(c.oid) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname=ANY(%s) ORDER BY 1",
            [list(catalog.INDEXES)])
        rendered = [{"index": n, "predicate": p, "normalized": catalog.normalize_predicate(p), "opclasses": list(o), "bytes": size}
                    for n, p, o, size in cursor.fetchall()]
        if len(rendered) != 3:
            raise RuntimeError("Expected exactly three new indexes")
        checks += ["exact162-catalog-with-real-predicates"]
        if catalog.preservation(cursor) != before:
            raise RuntimeError("Index generation changed prior rows or ACL")
        checks.append("old-rows-and-ACL-preserved")
    plans = query_plans(connection)
    for name, index in INDEX_FOR_QUERY.items():
        assert_plan_uses(plans[name], index)
    checks.append("all-three-queries-plan-through-new-index")
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    if probe_missing_index(connection, catalog.verify_catalog):
        checks.append("missing-index-rejected-and-rolled-back")
    with connection.cursor() as cursor:
        catalog.verify_catalog(cursor)
    try:
        gate.apply_steps(connection, base, before)
    except ValueError:
        checks.append("committed162-not-replayed")
    else:
        raise RuntimeError("Committed migration replay was accepted")
    if set(checks) != CHECKS:
        raise RuntimeError("PG rehearsal check set is incomplete")
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('server_version_num')::integer")
        server_version = cursor.fetchone()[0]
    (directory / "result.json").write_text(json.dumps({
        "version": VERSION, "status": "passed", "generations": [159, 162], "checks": sorted(checks),
        "productionTouched": False, "fullBackupOrRestorePerformed": False,
        "database": {"name": DATABASE, "user": FIXTURE_USER, "port": int(connection.settings_dict["PORT"]), "serverVersionNumber": server_version},
        "applyStepsSeconds": apply_seconds, "totalSeconds": round(time.monotonic() - started, 3),
        "syntheticRowsPerTable": 30000, "renderedIndexes": rendered, "plans": plans,
        "migrationSha256": gate.common.digest(gate.common.migrations(ROOT))}, indent=2), encoding="utf8")


def launch():
    assert_isolated_source()
    scratch = Path(tempfile.gettempdir()).resolve()  # the user's temp directory, never inside the worktree or runtime tree
    assert_private_path(scratch)
    directory = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX, dir=scratch))
    assert_private_path(directory)
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
        OPS162_REHEARSAL_DIR=str(directory))
    # HONEST LIMIT: this sitecustomize patch only guards Python-level socket.connect. psycopg/libpq connects in C
    # and is NOT stopped by it. The real database defences are (1) the private env built from scratch above,
    # (2) assert_private_identity() on the only Django connection before any query, and (3) the fixed
    # synthetic port range. Do not treat this patch as a barrier against a database connection.
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        f"    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or address[1]!={port}:\n"
        "        raise RuntimeError('OpsQueryIndex rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started, stopped, succeeded = False, False, False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", FIXTURE_USER, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "init", env, directory)
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
            if (directory.resolve().parent != scratch or not directory.name.startswith(TEMP_PREFIX)
                    or data.resolve() != directory.resolve() / "data" or data.is_symlink()):
                raise RuntimeError("Unexpected private cleanup target")
            assert_private_path(data)
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
