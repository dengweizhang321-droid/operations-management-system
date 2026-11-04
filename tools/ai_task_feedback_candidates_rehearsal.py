"""Own a synthetic PG17 156->158 cluster, never production data or identity.

The parent is explicitly AI0087/workflow0010, with all other app leaves and
the exact reviewed156 receipt set checked by the unchanged ancestor catalogues.
This is database layer B. File admission/prepared/active bindings are layer A.
"""
import copy
from datetime import datetime, timezone
import importlib
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
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
DATABASE = "teruisi_ai_feedback_candidates_rehearsal"
PORT_LOW, PORT_HIGH = 55512, 55521
RESULT_FOLDER = ROOT / "docs/ai-task-feedback-candidates-addition-20261104"


def assert_isolated_source():
    forbidden = (Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf").resolve(),
                 Path("D:/teruisi-runtime").resolve())
    if any(ROOT == path or path in ROOT.parents for path in forbidden):
        raise RuntimeError("Require isolated source outside production checkout/runtime")


def command(args, label, environment, directory, timeout=900):
    with (directory / (label + ".log")).open("xb") as output:
        result = subprocess.run([str(x) for x in args], env=environment, cwd=ROOT,
            stdout=output, stderr=output, timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError(label + " failed; inspect retained private synthetic log")


def domain_role_grants(script, variables):
    """Execute the ancestor service's own provisioning here-string verbatim."""
    from unittest.mock import patch
    source = (ROOT / script).read_text(encoding="utf-8-sig")
    code = source.split("    $code = @'\n", 1)[1].split("\n'@", 1)[0]
    environment = {"TERUISI_PROVISION_DATABASE_URL": os.environ["TERUISI_DJANGO_DATABASE_URL"]}
    environment.update({name: secrets.token_hex(32) for name in variables})
    with patch.dict(os.environ, environment):
        exec(compile(code, "private_ancestor_role_provision.py", "exec"), {})


def build_parent156(connection):
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from psycopg import sql
    from ai_assistant.database_contract import provision
    executor = MigrationExecutor(connection)
    targets = [node for node in executor.loader.graph.leaf_nodes()
               if node[0] not in {"ai_assistant", "workflow"}]
    targets += [("ai_assistant", "0087_pi_native_capabilities"),
                ("workflow", "0010_customer_service_chain_modules")]
    expected = {".".join(node) for node in executor.loader.graph.forwards_plan(targets[0])}
    for target in targets[1:]:
        expected.update(".".join(node) for node in executor.loader.graph.forwards_plan(target))
    if len(expected) != 156 or any(step.startswith(("ai_assistant.0088", "ai_assistant.0089")) for step in expected):
        raise RuntimeError("Synthetic targets are not the exact156 predecessor")
    executor.migrate(targets)
    # Migrations need the fixture superuser for historical role definitions.
    # Reassign only public application objects, never global/system objects.
    with connection.cursor() as cursor:
        cursor.execute("GRANT USAGE,CREATE ON SCHEMA public TO teruisi_sales_owner")
        cursor.execute("SELECT c.relkind,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m') "
            "AND pg_get_userbyid(c.relowner)=current_user "
            "AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid "
            "AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i')) ORDER BY c.relkind,c.relname")
        for kind, name in cursor.fetchall():
            keyword = {"r": "TABLE", "p": "TABLE", "S": "SEQUENCE", "v": "VIEW", "m": "MATERIALIZED VIEW"}[kind]
            cursor.execute(sql.SQL("ALTER {} public.{} OWNER TO teruisi_sales_owner").format(
                sql.SQL(keyword), sql.Identifier(name)))
        cursor.execute("SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
            "WHERE n.nspname='public' AND pg_get_userbyid(p.proowner)=current_user ORDER BY 1")
        for (signature,) in cursor.fetchall():
            cursor.execute(sql.SQL("ALTER FUNCTION {} OWNER TO teruisi_sales_owner").format(sql.SQL(signature)))
    base = {".".join(node) for node in MigrationRecorder(connection).applied_migrations()}
    if base != expected:
        raise RuntimeError("Synthetic parent receipts differ from the explicit156 graph")
    connection.ensure_connection()
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    domain_role_grants("tools/django-inventory-service.ps1",
        ("TERUISI_PROVISION_INVENTORY_READER_PASSWORD", "TERUISI_PROVISION_INVENTORY_WRITER_PASSWORD"))
    domain_role_grants("tools/django-workflow-service.ps1",
        ("TERUISI_PROVISION_WORKFLOW_READER_PASSWORD", "TERUISI_PROVISION_WORKFLOW_WRITER_PASSWORD"))
    # Nonempty synthetic rows in all four workflow parent tables. This exercises
    # migration-state PK ordering (three tables deliberately have no id).
    apps = executor.loader.project_state(targets).apps
    run = apps.get_model("workflow", "AutomationLogicalRun").objects.create(
        chain_key="synthetic", subject_key="synthetic", plan_date="2026-11-04", trigger_source="manual")
    apps.get_model("workflow", "AutomationAttempt").objects.create(logical_run=run, stage="claim")
    apps.get_model("workflow", "AutomationModuleResult").objects.create(logical_run=run,
        module_key="synthetic", subject_key="synthetic", dataset="synthetic", date_range="2026-11-04")
    return base, targets


def native_fk_triggers(cursor, tables):
    """Only the native RI triggers belonging to this generation's two FKs."""
    cursor.execute("SELECT con.conname,n.nspname,c.relname,t.tgname,t.tgtype,t.tgenabled,"
        "t.tgdeferrable,t.tginitdeferred,pn.nspname,p.proname,encode(t.tgargs,'hex'),"
        "con.convalidated,con.condeferrable,con.condeferred "
        "FROM pg_constraint con JOIN pg_trigger t ON t.tgconstraint=con.oid "
        "JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace "
        "WHERE con.contype='f' AND con.conrelid=ANY(%s::regclass[]) AND t.tgisinternal "
        "ORDER BY con.conname,n.nspname,c.relname,t.tgtype,p.proname",
        [["public." + table for table in tables]])
    rows = cursor.fetchall()
    if len(rows) != 8 or len({row[0] for row in rows}) != 2:
        raise RuntimeError("Expected four native RI triggers for each of the two new FKs")
    return rows


class RollbackProbe(Exception):
    pass


def capture():
    import django
    django.setup()
    from django.db import connection, transaction, DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from psycopg import sql, DatabaseError as PsycopgDatabaseError
    from unittest.mock import patch
    import bi_app_addition as common
    import ai_task_feedback_candidates_catalog as catalog
    import ai_task_feedback_candidates_addition as addition
    from ai_assistant.database_contract import provision
    from postgres_no_key_backup import verify_receipt_generation
    directory = Path(os.environ["AI158_REHEARSAL_DIR"])
    params = connection.settings_dict
    if (params["HOST"] != "127.0.0.1" or not PORT_LOW <= int(params["PORT"]) < PORT_HIGH
            or params["NAME"] != DATABASE or params["USER"] != "ai158_fixture"):
        raise RuntimeError("Unexpected isolated AI158 database identity")
    checks, negatives = [], []
    source_names = sorted({name for name in addition.CODE_FILES if not name.endswith((".ps1", ".mjs"))} | {
        "tools/ai_task_feedback_candidates_rehearsal.py", "tests/ai158-acl-catalog-boundary.py",
        "backend/teruisi_backend/settings.py", "tools/django-inventory-service.ps1",
        "tools/django-workflow-service.ps1"})
    source_files = {name: common.sha(ROOT / name) for name in source_names}

    def reject(call, label):
        try:
            call()
        except (ValueError, RuntimeError, DatabaseError, PsycopgDatabaseError) as error:
            negatives.append({"check": label, "exception": type(error).__name__})
            return
        raise RuntimeError("Negative accepted: " + label)

    def probe(body, label):
        try:
            with transaction.atomic(using=connection.alias):
                with connection.cursor() as cursor:
                    body(cursor)
                raise RollbackProbe(label)
        except RollbackProbe:
            return

    def probe_native_fk_triggers(*, require_rejection):
        with connection.cursor() as cursor:
            catalog.verify_catalog(cursor)
            rows = native_fk_triggers(cursor, catalog.TABLES)
        observations = []
        for row in rows:
            def disable_ri(cursor, row=row):
                cursor.execute("RESET ROLE")
                cursor.execute(sql.SQL("ALTER TABLE {}.{} DISABLE TRIGGER {}").format(
                    sql.Identifier(row[1]), sql.Identifier(row[2]), sql.Identifier(row[3])))
                cursor.execute("SELECT tgenabled FROM pg_trigger WHERE tgrelid=to_regclass(%s) AND tgname=%s",
                    [row[1] + "." + row[2], row[3]])
                if cursor.fetchone() != ("D",):
                    raise RuntimeError("Native RI trigger was not actually disabled")
                cursor.execute("SET ROLE teruisi_sales_owner")
                rejected = False
                try:
                    catalog.verify_catalog(cursor)
                except ValueError:
                    rejected = True
                observations.append({"constraint": row[0], "schema": row[1], "table": row[2],
                    "trigger": row[3], "type": row[4], "beforeEnabled": row[5], "disabledEnabled": "D",
                    "deferrable": row[6], "initiallyDeferred": row[7], "functionSchema": row[8],
                    "function": row[9], "args": row[10], "catalogRejected": rejected})
                if require_rejection:
                    if not rejected:
                        raise RuntimeError("Catalog accepted disabled native FK trigger: " + row[3])
                    negatives.append({"check": "native-FK-trigger-disabled:" + row[0] + ":" + row[2] + ":" + row[9],
                                      "exception": "ValueError"})
            probe(disable_ri, row[3])
        with connection.cursor() as cursor:
            catalog.verify_catalog(cursor)
        return observations

    base, targets = build_parent156(connection)
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        if verify_receipt_generation(cursor) != 156:
            raise RuntimeError("Ancestor catalogues did not recognize the exact156 fixture")
        before = catalog.preservation(cursor)
    checks.append("exact156-ancestor-catalogues-and-real-domain-provision")
    (directory / "parent156.json").write_text(json.dumps({"targets": targets,
        "receipts": sorted(base), "preservation": before}, indent=2), encoding="utf8")

    if "--capture-catalog" in sys.argv or "--probe-fk-triggers" in sys.argv:
        MigrationExecutor(connection).migrate([tuple(step.split(".", 1)) for step in catalog.STEPS])
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
        provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
        with connection.cursor() as cursor:
            cursor.execute("SET ROLE teruisi_sales_owner")
            reference = catalog.capture(cursor)
        if "--probe-fk-triggers" in sys.argv:
            # Observe the existing collector before changing its expectation.
            # Only RI triggers belonging to these two new FK constraints are
            # touched, including their referenced-side triggers on the parent.
            observations = probe_native_fk_triggers(require_rejection="--require-fk-rejection" in sys.argv)
            result = {"status": "observed", "layer": "B-native-FK-probe", "productionTouched": False,
                "port": int(params["PORT"]), "observations": observations,
                "allDisabledNativeTriggersRejected": all(item["catalogRejected"] for item in observations),
                "rolledBackAndOriginalCatalogRestored": True, "sourceFiles": source_files}
            (directory / "fk-internal-probe.json").write_text(json.dumps(result, indent=2), encoding="utf8")
            print(json.dumps({"status": "observed", "nativeTriggers": len(observations),
                "rejected": sum(item["catalogRejected"] for item in observations)}), flush=True)
            return
        (ROOT / "tools/ai_task_feedback_candidates_catalog.json").write_text(
            json.dumps(reference, indent=2, default=str) + "\n", encoding="utf8", newline="\n")
        print(json.dumps({"status": "catalog-captured", "productionTouched": False}), flush=True)
        return

    # Execute the first migration and half of the second, then fail with a REAL
    # PG division-by-zero while its CREATE FUNCTION runs. Both DDL and both
    # django_migrations records must roll back in the addition's outer txn.
    second = importlib.import_module("ai_assistant.migrations.0089_skill_candidates")
    with patch.object(second, "CANDIDATE_GUARD", "SELECT 1/0"):
        reject(lambda: addition.apply_steps(connection, base, before), "real-second-DDL-failure")
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 156 or catalog.preservation(cursor) != before:
            raise RuntimeError("Failed second DDL changed156")
        catalog.verify_tables(cursor, installed=False)
    if {".".join(node) for node in MigrationRecorder(connection).applied_migrations()} != base:
        raise RuntimeError("Failed atomic DDL retained a migration receipt")
    checks.append("both-DDL-and-receipts-rollback-after-real-second-step-failure")
    reject(lambda: addition.apply_steps(connection, base, before | {"legacyRowsSha256": "0" * 64}),
           "stale-preservation-intent")
    reject(lambda: addition.apply_steps(connection, base | {catalog.STEPS[0]}, before), "partial157-parent")
    reject(lambda: addition.steps_files(157), "unsupported157-generation")
    checks.append("stale-intent-and-partial157-refused")

    # Use the real install helper and create-only intent/installed files. This
    # bypasses only the production file-runtime/identity CLI, covered in A.
    runtime = directory / "file-runtime"
    operation = "b" * 32
    folder = addition.directory(runtime, operation)
    folder.mkdir(parents=True)
    plan = {"steps": list(catalog.STEPS), "migrationSha256": common.digest(catalog.FILES),
            "parentReferenceSha256": "a" * 64}
    common.write(folder / "plan.json", plan)
    addition.install_schema("install", connection, runtime, operation, folder, plan, base)
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor, ai_task_feedback_permissions=False) != 158:
            raise RuntimeError("Owner-only installed158 is not recognized")
        catalog.verify_tables(cursor, permissions=False)
        catalog.verify_initial_values(cursor)
        if catalog.preservation(cursor) != before:
            raise RuntimeError("Install changed original rows or ACLs")
        reject(lambda: catalog.verify_tables(cursor, permissions=True), "final-ACL-before-provision")
    checks.append("real-install158-owner-only-and-empty-preserves156")
    reject(lambda: addition.apply_steps(connection, base, before), "install-replay-after158")

    # Intercept exactly one live GRANT; let PG itself fail inside provision's
    # real transaction, after all earlier statements have executed unchanged.
    class FailingCursor:
        def __init__(self, cursor, owner):
            self.cursor, self.owner = cursor, owner
        def __enter__(self):
            self.cursor.__enter__()
            return self
        def __exit__(self, *args):
            return self.cursor.__exit__(*args)
        def execute(self, statement, args=None):
            rendered = statement.as_string(connection.connection) if hasattr(statement, "as_string") else statement
            if rendered.startswith("GRANT ") and '"ai_task_feedback"' in rendered:
                self.owner.injected += 1
                return self.cursor.execute("SELECT 1/0")
            return self.cursor.execute(statement, args)
        def __getattr__(self, name):
            return getattr(self.cursor, name)
    class FailingProvisionConnection:
        injected = 0
        def cursor(self):
            return FailingCursor(connection.connection.cursor(), self)
        def __getattr__(self, name):
            return getattr(connection.connection, name)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    failing = FailingProvisionConnection()
    reject(lambda: provision(failing, secrets.token_hex(32), secrets.token_hex(32)), "real-provision-mid-GRANT-failure")
    if failing.injected != 1:
        raise RuntimeError("Provision negative did not reach the new table's actual GRANT")
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        catalog.verify_tables(cursor, permissions=False)
        if catalog.preservation(cursor) != before:
            raise RuntimeError("Failed provision changed original ACLs")
    reject(lambda: addition.check_database(connection, base, permissions=True, empty=True, expected=before),
           "finalize-database-gate-after-provision-failure")
    if (folder / "finalized.json").exists():
        raise RuntimeError("Failed provision produced a finalized receipt")
    checks.append("real-provision-failure-rolls-back-and-finalize-database-gate-refuses")

    # Reconcile confirms the committed DDL even before provision is repaired.
    # If it tries migration replay, the sentinel raises AssertionError (not an
    # allowed rejection); SQL CREATE/ALTER/DROP is separately counted below.
    from django.db.backends.utils import CursorWrapper
    real_execute = CursorWrapper.execute
    ddl = []
    def audited_execute(cursor, query, params=None):
        text = query.as_string(connection.connection) if hasattr(query, "as_string") else query
        if text.lstrip().upper().startswith(("CREATE ", "ALTER ", "DROP ")):
            ddl.append(text.split()[0])
        return real_execute(cursor, query, params)
    with patch.object(addition, "apply_steps", side_effect=AssertionError("reconcile replayed DDL")), \
            patch.object(CursorWrapper, "execute", audited_execute):
        addition.install_schema("reconcile", connection, runtime, operation, folder, plan, base)
    if ddl:
        raise RuntimeError("Reconcile executed DDL")
    checks.append("real-reconcile-confirms-installed158-with-zero-DDL-and-zero-replay")

    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
        catalog.verify_catalog(cursor)
        if verify_receipt_generation(cursor) != 158 or catalog.preservation(cursor) != before:
            raise RuntimeError("Final158 catalogue or unchanged156 preservation failed")
    addition.check_database(connection, base, permissions=True, empty=True, expected=before)
    checks.append("real-AI-provision-writer-four-reader-zero-final158-and-no-pending")

    # Every scalar leaf of the exact frozen tables/functions snapshot must
    # participate in the live comparison. Change one expectation at a time,
    # read the REAL database, require rejection, and restore it byte-for-byte.
    reference = catalog.expected()
    def leaves(value, path=()):
        if isinstance(value, dict):
            for key, child in value.items():
                yield from leaves(child, (*path, key))
        elif isinstance(value, list):
            if not value:
                yield path
            for index, child in enumerate(value):
                yield from leaves(child, (*path, index))
        else:
            yield path
    for path in list(leaves(reference["tables"], ("tables",))) + list(leaves(reference["functions"], ("functions",))):
        changed = copy.deepcopy(reference)
        node = changed
        for key in path[:-1]:
            node = node[key]
        value = node[path[-1]]
        node[path[-1]] = not value if isinstance(value, bool) else (value + 1 if isinstance(value, int) else "__tampered__")
        with patch.object(catalog, "expected", return_value=changed):
            with connection.cursor() as cursor:
                reject(lambda: catalog.verify_tables(cursor), "snapshot-leaf:" + ".".join(map(str, path)))
    checks.append("every-frozen-table-and-function-leaf-has-live-negative")

    def sql_drift(query, label):
        def body(cursor):
            cursor.execute(query)
            reject(lambda: catalog.verify_tables(cursor), label)
        probe(body, label)
    for table in catalog.TABLES:
        for query, label in [
            (f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY", "rls"),
            (f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY", "force-rls"),
            (f"ALTER TABLE {table} ALTER status SET DEFAULT 'draft'", "column-default"),
            (f"ALTER TABLE {table} ALTER owner_email DROP NOT NULL", "column-nullability"),
            (f"ALTER TABLE {table} ALTER owner_email TYPE varchar(200)", "column-type"),
            (f"GRANT SELECT ON {table} TO teruisi_ai_reader", "reader-grant"),
            (f"GRANT SELECT ON {table} TO PUBLIC", "public-table-grant"),
            (f"GRANT SELECT(owner_email) ON {table} TO teruisi_ai_reader", "column-acl"),
            (f"CREATE POLICY synthetic_policy ON {table} USING (true)", "extra-policy"),
            (f"ALTER TABLE {table} DISABLE TRIGGER ai_write_fence", "write-fence-disabled"),
            (f"ALTER TABLE {table} DISABLE TRIGGER ai_immutable_identity", "identity-trigger-disabled"),
        ]:
            sql_drift(query, table + ":" + label)
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            sql_drift(f"REVOKE {privilege} ON {table} FROM teruisi_ai_writer", table + ":missing-writer-" + privilege)
        sql_drift(f"GRANT INSERT ON {table} TO teruisi_ai_writer WITH GRANT OPTION", table + ":writer-grant-option")
        entry = reference["tables"][table]
        for constraint in entry["constraints"]:
            sql_drift(sql.SQL("ALTER TABLE {} DROP CONSTRAINT {}").format(
                sql.Identifier(table), sql.Identifier(constraint[0])), table + ":drop-constraint:" + constraint[0])
        constrained = {constraint[0] for constraint in entry["constraints"]}
        for index in entry["indexes"]:
            if index[0] not in constrained:
                sql_drift(sql.SQL("DROP INDEX {}").format(sql.Identifier(index[0])), table + ":drop-index:" + index[0])
        state_trigger = "ai_task_feedback_state" if table == "ai_task_feedback" else "ai_skill_candidate_state"
        sql_drift(f"ALTER TABLE {table} DISABLE TRIGGER {state_trigger}", table + ":guard-trigger-disabled")
    for name, migration, constant in [
        ("ai_task_feedback_guard", "0088_task_feedback", "BINDING_GUARD"),
        ("ai_skill_candidate_guard", "0089_skill_candidates", "CANDIDATE_GUARD"),
    ]:
        body = getattr(importlib.import_module("ai_assistant.migrations." + migration), constant)
        sql_drift(body.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION").replace("RETURN NEW;", "RETURN NULL;"), name + ":body")
        for clause in ("SECURITY DEFINER", "IMMUTABLE", "PARALLEL SAFE", "COST 1", "SET search_path=public"):
            sql_drift(f"ALTER FUNCTION public.{name}() {clause}", name + ":" + clause)
        sql_drift(f"REVOKE EXECUTE ON FUNCTION public.{name}() FROM PUBLIC", name + ":function-ACL")
        sql_drift(f"CREATE FUNCTION public.{name}(text) RETURNS text LANGUAGE sql AS 'SELECT $1'", name + ":extra-overload")
    checks.append("real-SQL-drift-probes-cover-columns-constraints-indexes-triggers-guards-security-and-ACL")
    native_fk_observations = probe_native_fk_triggers(require_rejection=True)
    checks.append("all-eight-native-FK-child-and-parent-triggers-disabled-are-rejected")

    # The preservation digest must notice existing workflow data and ACL edits.
    def changed_old_row(cursor):
        cursor.execute("UPDATE automation_modules SET label='synthetic-changed' WHERE module_key=(SELECT min(module_key) FROM automation_modules)")
        if catalog.preservation(cursor) == before:
            raise RuntimeError("Preservation ignored an old workflow row")
    probe(changed_old_row, "old-row")
    def changed_old_acl(cursor):
        cursor.execute("GRANT SELECT ON automation_logical_runs TO teruisi_ai_reader")
        if catalog.preservation(cursor) == before:
            raise RuntimeError("Preservation ignored an old workflow ACL")
    probe(changed_old_acl, "old-acl")
    checks.append("nonempty-parent-workflow-rows-and-ACL-preservation-negatives")

    # Keep the inherited total500000 bound before any install-intent/DDL is
    # emitted, including the four newly preserved workflow tables. The real
    # workflow queries still run; only the synthetic inherited count changes.
    import workflow_automation_catalog as parent_catalog
    with connection.cursor() as cursor:
        original_parent = parent_catalog.preservation(cursor)
    with patch.object(parent_catalog, "preservation", return_value=original_parent | {"rows": 500000}):
        with connection.cursor() as cursor:
            reject(lambda: catalog.preservation(cursor), "parent-plus-workflow-total-row-bound")
    checks.append("preservation-total500000-bound-before-DDL")

    # Exercise each new migration-state default assertion independently, then
    # restore the real Field object and its cached getter before the next one.
    executor = MigrationExecutor(connection)
    apps = executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps
    for model_name, names in {
        "AiTaskFeedback": ("old_value_json", "applies_to", "source", "status", "version"),
        "AiSkillCandidate": ("feedback_ids_json", "unverified_count", "status", "reviewed_by", "reviewed_at", "review_note", "version"),
    }.items():
        for name in names:
            field = apps.get_model("ai_assistant", model_name)._meta.get_field(name)
            original_default = field.default
            try:
                field.default = 999 if isinstance(original_default, int) else "__tampered_default__"
                field.__dict__.pop("_get_default", None)
                reject(lambda: catalog.verify_defaults(apps), "migration-state-default:" + model_name + "." + name)
            finally:
                field.default = original_default
                field.__dict__.pop("_get_default", None)
    checks.append("each-new-migration-state-default-has-negative-and-is-restored")
    addition.check_database(connection, base, permissions=True, empty=True, expected=before)
    if source_files != {name: common.sha(ROOT / name) for name in source_names}:
        raise RuntimeError("B-layer source files changed during rehearsal; result cannot bind different bytes")
    result = {"status": "completed", "layer": "B", "generations": [156, 158],
        "checks": checks, "negativeChecks": negatives, "negativeCount": len(negatives),
        "productionTouched": False, "fullBackupOrRestorePerformed": False,
        "database": params["NAME"], "port": int(params["PORT"]),
        "parent156": {"targets": targets, "receipts": sorted(base), "preservation": before},
        "fileGateLayerARequired": True, "nativeColdStartPerformed": False,
        "sourceFiles": source_files, "sourceBinding": "sha256-raw-file-bytes-at-start-and-finish",
        "nativeForeignKeyTriggerChecks": native_fk_observations}
    (directory / "rehearsal-result.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps({"status": "completed", "checks": len(checks), "negatives": len(negatives)}), flush=True)


def launch():
    assert_isolated_source()
    scratch = ROOT / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="ai158-pg17-", dir=scratch))
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
        raise RuntimeError("No isolated AI158 rehearsal port")
    password = secrets.token_hex(32)
    password_file = directory / "password"
    password_file.write_text(password, encoding="ascii")
    environment = {k: v for k, v in os.environ.items() if k.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
    environment.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="ai158_fixture", PGPASSWORD=password,
        PGDATABASE=DATABASE, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://ai158_fixture:{password}@127.0.0.1:{port}/{DATABASE}",
        TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend") + os.pathsep + str(ROOT / "tools"),
        AI158_REHEARSAL_DIR=str(directory))
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n"
        f"    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or address[1]!={port}:\n"
        "        raise RuntimeError('AI158 rehearsal forbids external/production network')\n"
        "    return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    started, stopped, succeeded = False, False, False
    try:
        print(json.dumps({"phase": "init", "directory": str(directory), "port": port}), flush=True)
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "ai158_fixture", "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "init", environment, directory)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start", environment, directory)
        started = True
        command([BIN / "createdb.exe", DATABASE], "createdb", environment, directory)
        roles = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_ai_reader", "teruisi_ai_writer",
            "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer",
            "teruisi_inventory_reader", "teruisi_inventory_writer", "teruisi_workflow_reader", "teruisi_workflow_writer",
            "teruisi_market_reader", "teruisi_market_writer", "teruisi_products_reader", "teruisi_products_writer",
            "teruisi_access_control_reader", "teruisi_access_control_writer", "teruisi_customer_service_reader",
            "teruisi_customer_service_writer", "teruisi_erp_reference_reader", "teruisi_erp_reference_writer")
        for role in roles:
            command([BIN / "psql.exe", "-v", "ON_ERROR_STOP=1", "-c",
                f"CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"],
                role, environment, directory)
        command([sys.executable, __file__, "--child", *sys.argv[1:]], "rehearsal", environment, directory)
        succeeded = True
    finally:
        if started:
            command([BIN / "pg_ctl.exe", "-D", directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", environment, directory)
            stopped = True
        password_file.unlink(missing_ok=True)
        # Exact verified private directory only; no symlinks or runtime paths.
        data = directory / "data"
        if data.exists() and (stopped or not started):
            if directory.resolve().parent != scratch.resolve() or data.is_symlink():
                raise RuntimeError("Refuse unexpected synthetic cleanup target")
            shutil.rmtree(data)
        cleanup = {"started": started, "stopped": stopped, "passwordFileRemoved": not password_file.exists(),
                   "privateDataRemoved": not data.exists(), "childExitZero": succeeded}
        (directory / "cleanup-result.json").write_text(json.dumps(cleanup, indent=2), encoding="utf8")
        print(json.dumps({"phase": "cleanup", "directory": str(directory), **cleanup}), flush=True)
    if "--probe-fk-triggers" in sys.argv:
        result = json.loads((directory / "fk-internal-probe.json").read_text(encoding="utf8"))
        result.update(cleanup=cleanup, completedAt=datetime.now(timezone.utc).isoformat())
        RESULT_FOLDER.mkdir(parents=True, exist_ok=True)
        probe_name = "b-layer-fk-internal-probe-after.json" if "--require-fk-rejection" in sys.argv else "b-layer-fk-internal-probe.json"
        (RESULT_FOLDER / probe_name).write_text(json.dumps(result, indent=2) + "\n", encoding="utf8", newline="\n")
    elif "--capture-catalog" not in sys.argv:
        result = json.loads((directory / "rehearsal-result.json").read_text(encoding="utf8"))
        result.update(cleanup=cleanup, completedAt=datetime.now(timezone.utc).isoformat())
        RESULT_FOLDER.mkdir(parents=True, exist_ok=True)
        (RESULT_FOLDER / "b-layer-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8", newline="\n")
        native_fk_result = {"status": "observed", "layer": "B-native-FK-probe-after", "productionTouched": False,
            "port": result["port"], "observations": result["nativeForeignKeyTriggerChecks"],
            "allDisabledNativeTriggersRejected": all(item["catalogRejected"] for item in result["nativeForeignKeyTriggerChecks"]),
            "rolledBackAndOriginalCatalogRestored": True, "sourceFiles": result["sourceFiles"], "cleanup": cleanup,
            "completedAt": result["completedAt"]}
        (RESULT_FOLDER / "b-layer-fk-internal-probe-after.json").write_text(json.dumps(native_fk_result, indent=2) + "\n", encoding="utf8", newline="\n")


if __name__ == "__main__":
    capture() if "--child" in sys.argv else launch()
