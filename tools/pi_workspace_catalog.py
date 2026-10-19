"""Exact Pi151 workspace catalogue; existing150 membership remains separately verified."""
import json
from pathlib import Path
from psycopg import sql

STEPS = ("ai_assistant.0085_pi_workspace_controls",)
FILES = {"backend/ai_assistant/migrations/0085_pi_workspace_controls.py": "b4bd9ca8d870caa3b747b70446108a67af820610e79273ca35a752e850091d07"}
TABLES = ("ai_pi_controls", "ai_pi_ui_requests", "ai_pi_workspaces")

def inspect_tables(cursor, tables=TABLES):
    from postgres_restore_semantics import normalize_dump_expression
    result = {}
    for table in tables:
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
                         "policies": cursor.fetchall()}
    return result


def verify_catalog(cursor, *, installed=True, permissions=True, business=False):
    import pi_agent_catalog as parent
    parent.verify_catalog(cursor, installed=True, permissions=permissions, workspace=installed, business=business)
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname=ANY(%s) AND relkind IN ('r','p','v','m','f') ORDER BY relname", [list(TABLES)])
    if [row[0] for row in cursor.fetchall()] != (list(TABLES) if installed else []):
        raise ValueError("Pi151 workspace tables absent, partial, extra or unrecorded")
    if not installed:
        return
    from ai_assistant.pi_health import verify_workspace
    verify_workspace(cursor)
    reference = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf8"))
    actual = json.loads(json.dumps(inspect_tables(cursor)))
    for table in TABLES:
        wanted = reference[table]
        if not permissions:
            actual[table].pop("acl")
            wanted = {key: value for key, value in wanted.items() if key != "acl"}
        if actual[table] != wanted:
            raise ValueError("Pi151 schema/owner/index/constraint/ACL differs: " + table)


def preservation(cursor):
    """Hash only existing AI control rows; never publish content or credentials."""
    import bi_app_addition as common
    values, permissions, count = {}, {}, 0
    for table in ("ai_models", "ai_conversations", "ai_agent_jobs", "ai_agent_provider_dispatches", "ai_agent_tool_dispatches", "ai_pi_sessions", "ai_pi_operations", "ai_pi_dispatches", "ai_pi_events", "ai_pi_files", "ai_pi_exports", "ai_pi_export_pages", "ai_pi_gateway_nonces"):
        cursor.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY {} LIMIT 100001").format(sql.Identifier(table), sql.Identifier("nonce" if table == "ai_pi_gateway_nonces" else "id")))
        rows = cursor.fetchall()
        if len(rows) > 100000:
            raise ValueError("Pi150 preservation projection exceeded bound")
        count += len(rows)
        values[table] = common.digest(rows)
        cursor.execute("SELECT c.relacl::text FROM pg_class c WHERE c.oid=to_regclass(%s)", ["public."+table])
        permissions[table] = cursor.fetchone()
    return {"rows": count, "legacyRowsSha256": common.digest(values), "permissionsSha256": common.digest(permissions)}


def verify_initial_values(cursor):
    for table in TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Pi150 schema adoption cannot seed or import business rows")


def verify_defaults(apps):
    workspace = apps.get_model("ai_assistant", "PiWorkspace")()
    control = apps.get_model("ai_assistant", "PiControl")()
    request = apps.get_model("ai_assistant", "PiUiRequest")()
    if (workspace.status, workspace.control_seq, control.status, request.status) != ("uninitialized", 0, "prepared", "pending"):
        raise ValueError("Pi151 control defaults changed")
