"""Exact PostgreSQL17 JD schema; no adoption receipts or business rows read."""
import json
from pathlib import Path
from psycopg import sql

STEPS = ("inventory.0012_jd_logistics", "inventory.0013_jd_logistics_notifications", "inventory.0014_jd_logistics_replenishment_cycle")
FILES = dict(zip(("backend/inventory/migrations/" + step.split(".",1)[1] + ".py" for step in STEPS), (
    "48630cca03aa6466920a80d96fbfa64780d281875a67fab9287e9c41f2130a98",
    "6e593c335afa158d9229b7f44574310b541fb40234b327420bdda1ac5c0533ad",
    "3a6b78020181978ee290a1354ed4d5a8aa94504410aded12e1a397376a1d72b4")))
TABLES = tuple("inventory_jd_logistics_" + name for name in ("audits", "batches", "deliveries", "departments", "facts", "manual_states", "mappings", "scopes"))

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


def verify_catalog(cursor, *, installed, permissions=False):
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname LIKE 'inventory_jd_logistics_%%' AND relkind IN ('r','p','v','m','f') ORDER BY relname")
    names = [row[0] for row in cursor.fetchall()]
    if names != (list(TABLES) if installed else []):
        raise ValueError("JD schema is absent, partial, extra or unrecorded")
    if not installed:
        return
    actual = json.loads(json.dumps(inspect_tables(cursor)))
    reference = json.loads(Path(__file__).with_name("jd_logistics_catalog.json").read_text(encoding="utf8"))
    for table in TABLES:
        # Installation creates owner-only objects; the existing inventory role
        # provisioner grants the exact reader/writer ACL before finalization.
        wanted = reference[table]
        if not permissions:
            actual[table].pop("acl")
            wanted = {key: value for key, value in wanted.items() if key != "acl"}
        if actual[table] != wanted:
            raise ValueError("JD complete schema/owner/index/guard/ACL differs: " + table)


def verify_empty(cursor):
    for table in TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Schema-only JD adoption must not import or seed business rows")


def verify_defaults(apps):
    model = apps.get_model("inventory", "JdLogisticsDepartment")
    value = model()
    if any(getattr(value, key) is not False for key in ("logistics_enabled", "monitor_enabled", "push_enabled")) or value.capabilities != {} or value.replenishment_cycle_days != 30:
        raise ValueError("JD capabilities or scheduling defaults changed")
