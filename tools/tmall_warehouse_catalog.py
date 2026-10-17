"""Exact PostgreSQL17 Tmall warehouse schema and minimal inventory grants."""
import json
from pathlib import Path
from psycopg import sql

STEPS = ("inventory.0017_tmall_warehouse",)
FILES = {"backend/inventory/migrations/0017_tmall_warehouse.py": "fbb8e96c56dcec5c5b3acc70cf9dbf186c8e589a17243ed9e3b373bd73c24610"}
TABLES = tuple("inventory_tmall_warehouse_" + name for name in ("audits", "batches", "facts", "scopes"))

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


def sequence_catalog(cursor):
    cursor.execute("SELECT pg_get_serial_sequence('public.inventory_tmall_warehouse_facts','id')")
    sequence = cursor.fetchone()[0]
    cursor.execute("SELECT pg_get_userbyid(c.relowner),c.relkind,c.relpersistence, "
        "a.privilege_type,a.is_grantable,CASE WHEN a.grantee=c.relowner THEN 'OWNER' "
        "WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END FROM pg_class c "
        "CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('S',c.relowner))) a "
        "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s) ORDER BY 6,4,5", [sequence])
    return {"name": sequence, "acl": cursor.fetchall()}


def verify_catalog(cursor, *, installed=True, permissions=True):
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND relname LIKE 'inventory_tmall_warehouse_%%' "
        "AND relkind IN ('r','p','v','m','f') ORDER BY relname")
    if [row[0] for row in cursor.fetchall()] != (list(TABLES) if installed else []):
        raise ValueError("Tmall149 tables absent, partial, extra or unrecorded")
    if not installed:
        return
    reference = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf8"))
    actual = json.loads(json.dumps(inspect_tables(cursor)))
    for table in TABLES:
        wanted = reference[table]
        if not permissions:
            actual[table].pop("acl")
            wanted = {key: value for key, value in wanted.items() if key != "acl"}
        if actual[table] != wanted:
            raise ValueError("Tmall149 schema/owner/index/constraint/ACL differs: " + table)
    actual_sequence = json.loads(json.dumps(sequence_catalog(cursor)))
    wanted_sequence = reference["sequence"]
    if not permissions:
        actual_sequence = {"name": actual_sequence["name"], "identity": sorted({tuple(row[:3]) for row in actual_sequence["acl"] if row[-1] == "OWNER"})}
        wanted_sequence = {"name": wanted_sequence["name"], "identity": sorted({tuple(row[:3]) for row in wanted_sequence["acl"] if row[-1] == "OWNER"})}
    if actual_sequence != wanted_sequence:
        raise ValueError("Tmall149 sequence ownership or exact privileges differ")


def preservation(cursor):
    """Protect existing JD department rows and grants including all preference fields."""
    import bi_app_addition as common
    cursor.execute("SELECT to_jsonb(t) FROM public.inventory_jd_logistics_departments t ORDER BY id LIMIT 10001")
    rows = cursor.fetchall()
    if len(rows) > 10000:
        raise ValueError("Tmall149 legacy preservation projection exceeded bound")
    # 0016 adds exactly its empty preference column; remove only that pending field.
    rows = [(json.loads(row[0]) if isinstance(row[0], str) else dict(row[0]),) for row in rows]
    for row in rows:
        if row[0].get("unmonitored_product_codes") == []:
            row[0].pop("unmonitored_product_codes")
    cursor.execute("SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END, "
        "a.privilege_type,a.is_grantable FROM pg_class c "
        "CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a "
        "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass('public.inventory_jd_logistics_departments') ORDER BY 1,2,3")
    acl = cursor.fetchall()
    cursor.execute("SELECT t.attname,CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END, "
        "a.privilege_type,a.is_grantable FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid "
        "CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee "
        "WHERE c.oid=to_regclass('public.inventory_jd_logistics_departments') AND t.attnum>0 "
        "AND NOT t.attisdropped AND t.attname<>'unmonitored_product_codes' ORDER BY 1,2,3,4")
    return {"rows": len(rows), "legacyRowsSha256": common.digest(rows), "permissionsSha256": common.digest([acl, cursor.fetchall()])}


def verify_initial_values(cursor):
    for table in TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Schema-only Tmall adoption cannot seed or import business rows")


def verify_defaults(apps):
    from jd_product_monitoring_catalog import verify_defaults as verify_monitoring
    verify_monitoring(apps)
    scope = apps.get_model("inventory", "TmallWarehouseScope")()
    if scope.revision != 0 or scope.owner_token != "" or scope.latest_snapshot_date is not None:
        raise ValueError("Tmall scope defaults differ")
