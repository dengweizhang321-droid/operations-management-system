"""Exact, narrow PG17 catalog for the AI0090 schema-only addition.

The table inspection SQL is derived from workflow_automation_catalog. Its
complete table objects are frozen independently here; no ancestor bytes or
expectations are changed. Functions are inspected separately because the new
RunPython migration step installs its guard.
"""
import json
from pathlib import Path

from psycopg import sql

STEPS = ("ai_assistant.0090_unified_tasks",)
FILES = {"backend/ai_assistant/migrations/0090_unified_tasks.py": "f955d5ffbca0a3eea761597b79e7445e76e37ccf329e39aafa022f91d301e39a"}
TABLES = ("ai_task_definitions", "ai_task_grants", "ai_task_incidents", "ai_task_revisions", "ai_task_runs")
FUNCTIONS = ("ai_unified_task_guard",)
VERSION = "teruisi-ai-unified-tasks-catalog-v1"


def models_at_revision():
    from django.db.migrations.loader import MigrationLoader
    state = MigrationLoader(None).project_state([tuple(STEPS[-1].split(".", 1))])
    return {model._meta.db_table: model for model in state.apps.get_app_config("ai_assistant").get_models()
            if model._meta.db_table in TABLES}


def inspect_tables(cursor):
    from postgres_restore_semantics import normalize_dump_expression
    result = {}
    for table in TABLES:
        target = "public." + table
        cursor.execute("SELECT pg_get_userbyid(relowner),relkind,relpersistence,relrowsecurity,relforcerowsecurity "
                       "FROM pg_class WHERE oid=to_regclass(%s)", [target])
        identity = cursor.fetchone()
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,"
                       "pg_get_expr(d.adbin,d.adrelid),a.attgenerated,a.attidentity,"
                       "CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END "
                       "FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
                       "WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [target])
        columns = cursor.fetchall()
        cursor.execute("SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) "
                       "FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname", [target])
        constraints = [(*row[:-1], normalize_dump_expression(row[-1])) for row in cursor.fetchall()]
        cursor.execute("SELECT c.relname,i.indisvalid,i.indisready,i.indisunique,pg_get_indexdef(i.indexrelid) "
                       "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass(%s) ORDER BY c.relname", [target])
        indexes = cursor.fetchall()
        cursor.execute("SELECT t.tgname,t.tgtype,t.tgenabled,n.nspname,p.proname,encode(t.tgargs,'hex'),pg_get_triggerdef(t.oid) "
                       "FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace "
                       "WHERE t.tgrelid=to_regclass(%s) AND NOT t.tgisinternal ORDER BY t.tgname", [target])
        triggers = cursor.fetchall()
        # FK enforcement also lives on the referenced table. Bind every native
        # RI trigger belonging to this table's FK, on both sides, using stable
        # identities rather than PostgreSQL's generated OID-bearing names.
        cursor.execute(
            "SELECT rn.nspname,r.relname,cn.nspname,c.relname,pn.nspname,peer.relname,"
            "con.conname,t.tgtype,t.tgenabled,t.tgdeferrable,t.tginitdeferred,"
            "fn.nspname,p.proname,pg_get_function_identity_arguments(p.oid),encode(t.tgargs,'hex') "
            "FROM pg_trigger t JOIN pg_constraint con ON con.oid=t.tgconstraint AND con.contype='f' "
            "JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace "
            "JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace "
            "JOIN pg_class peer ON peer.oid=con.confrelid JOIN pg_namespace pn ON pn.oid=peer.relnamespace "
            "JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace fn ON fn.oid=p.pronamespace "
            "WHERE con.conrelid=to_regclass(%s) AND t.tgisinternal "
            "ORDER BY con.conname,rn.nspname,r.relname,t.tgtype,fn.nspname,p.proname,"
            "pg_get_function_identity_arguments(p.oid),encode(t.tgargs,'hex')", [target])
        foreign_key_triggers = cursor.fetchall()
        cursor.execute("SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
                       "a.privilege_type,a.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a "
                       "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s) ORDER BY 1,2,3", [target])
        acl = cursor.fetchall()
        cursor.execute("SELECT t.attname,CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
                       "a.privilege_type,a.is_grantable FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid "
                       "CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee "
                       "WHERE c.oid=to_regclass(%s) AND t.attnum>0 AND NOT t.attisdropped ORDER BY 1,2,3,4", [target])
        column_acl = cursor.fetchall()
        cursor.execute("SELECT polname FROM pg_policy WHERE polrelid=to_regclass(%s) ORDER BY polname", [target])
        result[table] = {"identity": identity, "columns": columns, "constraints": constraints,
                         "indexes": indexes, "triggers": triggers, "acl": acl, "columnAcl": column_acl,
                         "foreignKeyTriggers": foreign_key_triggers, "policies": cursor.fetchall()}
    return result


def inspect_functions(cursor):
    """The reviewed name, including every overload; no other AI functions."""
    cursor.execute(
        "SELECT p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),"
        "pg_get_function_result(p.oid),pg_get_userbyid(p.proowner),l.lanname,"
        "p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.provolatile,p.proparallel,"
        "p.proretset,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
        "JOIN pg_language l ON l.oid=p.prolang "
        "WHERE n.nspname='public' AND p.proname=ANY(%s) "
        "ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)", [list(FUNCTIONS)])
    columns = ("schema", "name", "arguments", "result", "owner", "language", "kind",
               "securityDefiner", "leakproof", "strict", "volatility", "parallel",
               "returnsSet", "configuration", "source", "definition")
    rows = cursor.fetchall()
    result = {}
    for oid, *values in rows:
        item = dict(zip(columns, values))
        cursor.execute(
            "SELECT CASE WHEN a.grantee=p.proowner THEN 'OWNER' "
            "WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
            "a.privilege_type,a.is_grantable FROM pg_proc p "
            "CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a "
            "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=%s ORDER BY 1,2,3", [oid])
        item["acl"] = cursor.fetchall()
        result[item["schema"] + "." + item["name"] + "(" + item["arguments"] + ")"] = item
    return result


def capture(cursor):
    """Used only to freeze a reviewed isolated migration result, never to learn live expectations."""
    return {"version": VERSION, "migrationFiles": FILES,
            "tables": inspect_tables(cursor), "functions": inspect_functions(cursor)}


def expected():
    return json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf8"))


def verify_tables(cursor, *, installed=True, permissions=True):
    """This generation only. Install requires owner-only; final checks require provisioned ACL."""
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND relname=ANY(%s) "
        "AND relkind IN ('r','p','v','m','f') ORDER BY relname", [list(TABLES)])
    present = [row[0] for row in cursor.fetchall()]
    functions = inspect_functions(cursor)
    if present != (list(TABLES) if installed else []) or not installed and functions:
        raise ValueError("AI159 tables or guard functions absent, partial or unrecorded")
    if not installed:
        return
    reference = expected()
    actual = json.loads(json.dumps(capture(cursor)))
    if not permissions:
        # Migration issues no GRANT. Do not simply omit ACL comparison here:
        # that would admit early writer/reader privileges before ProvisionRoles.
        reference = {**reference, "tables": {
            table: {**item, "acl": [row for row in item["acl"] if row[0] == "OWNER"]}
            for table, item in reference["tables"].items()}}
    if actual != reference:
        raise ValueError("AI159 exact table/function/index/constraint/owner/ACL catalog differs")


def verify_catalog(cursor, *, installed=True, permissions=True):
    import ai_task_feedback_candidates_catalog as parent
    parent.verify_catalog(cursor, installed=True, permissions=True)
    verify_tables(cursor, installed=installed, permissions=permissions)


def preservation(cursor):
    """Extend the parent's row/ACL digest to its four existing automation tables."""
    import bi_app_addition as common
    import ai_task_feedback_candidates_catalog as parent
    from sales_preflight_catalog import order_columns
    original = parent.preservation(cursor)
    order = order_columns(parent.TABLES, parent.models_at_revision())
    objects = parent.inspect_tables(cursor)
    values, permissions, count = {}, {}, original["rows"]
    for table in parent.TABLES:
        cursor.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY {} LIMIT 100001").format(
            sql.Identifier(table), sql.Identifier(order[table])))
        rows = cursor.fetchall()
        if len(rows) > 100000 or count + len(rows) > 500000:
            raise ValueError("AI159 parent preservation exceeded bound")
        count += len(rows)
        values[table] = common.digest(rows)
        permissions[table] = {key: objects[table][key] for key in ("acl", "columnAcl")}
    return {"rows": count, "legacyRowsSha256": common.digest([original["legacyRowsSha256"], values]),
            "permissionsSha256": common.digest([original["permissionsSha256"], permissions])}


def verify_initial_values(cursor):
    for table in TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Schema-only AI159 adoption cannot seed or import business rows")


def verify_defaults(apps):
    from ai_task_feedback_candidates_catalog import verify_defaults as verify_parent
    verify_parent(apps)
    defaults = {
        "TaskDefinition": {"enabled": False, "version": 1, "current_revision": 1, "executor_kind": "unified_pi", "next_run_at": None},
        "TaskRun": {"status": "queued", "version": 1, "fence": 0, "operation_id": "", "execution_ref": "", "evidence_json": "{}", "report_status": "pending", "delivery_status": "pending", "delivery_receipts_json": "{}"},
        "TaskIncident": {"state": "open", "version": 1, "notification_status": "not_sent", "rule_version": "unified-task-triage-v1"},
    }
    for name, fields in defaults.items():
        model = apps.get_model("ai_assistant", name)()
        if any(getattr(model, field) != value for field, value in fields.items()):
            raise ValueError("AI159 migration-state defaults differ: " + name)
