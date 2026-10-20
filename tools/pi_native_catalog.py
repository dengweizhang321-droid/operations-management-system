"""Finite Pi153 structure catalogue; never starts a service or seeds data."""
import importlib
from collections import Counter
from pathlib import Path

from psycopg import sql

STEPS = ("ai_assistant.0087_pi_native_capabilities",)
# Frozen after the migration's mandatory syntax/closure checks.
FILES = {'backend/ai_assistant/migrations/0087_pi_native_capabilities.py': '438a85491e92acc8f213794a196b0b59f2194c9ae566cb56926eceeac19777c0'}
TABLES = tuple(sorted(("ai_pi_native_states", "ai_pi_agents", "ai_pi_plan_revisions",
    "ai_pi_agent_messages", "ai_pi_agent_waits", "ai_pi_file_handoffs", "ai_pi_business_delegations")))


def models_at_revision():
    """Migration state only: no database query, model instance or application call."""
    from django.db.migrations.loader import MigrationLoader
    state = MigrationLoader(None).project_state([("ai_assistant", "0087_pi_native_capabilities")])
    return {model._meta.db_table: model for model in state.apps.get_app_config("ai_assistant").get_models()
            if model._meta.db_table in TABLES}


def verify_catalog(cursor, *, installed=True, permissions=True):
    import pi_business_catalog as parent
    # Earlier generations retain their already-granted ACLs during this addition.
    parent.verify_catalog(cursor, installed=True, permissions=True, native=installed)
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND relname=ANY(%s) AND relkind IN ('r','p','v','m','f') ORDER BY relname", [list(TABLES)])
    if [row[0] for row in cursor.fetchall()] != (list(TABLES) if installed else []):
        raise ValueError("Pi153 native tables absent, partial, extra or unrecorded")
    if not installed:
        return
    from ai_assistant.pi_native_health import verify_native
    from django.db import connection
    migration = importlib.import_module("ai_assistant.migrations.0087_pi_native_capabilities")
    verify_native(cursor, permissions=permissions)
    models = models_at_revision()
    if set(models) != set(TABLES):
        raise ValueError("Pi153 model membership differs")
    for table, model in models.items():
        target = "public." + table
        cursor.execute("SELECT pg_get_userbyid(relowner),relkind,relpersistence,relrowsecurity,relforcerowsecurity "
                       "FROM pg_class WHERE oid=to_regclass(%s)", [target])
        if cursor.fetchone() != ("teruisi_sales_owner", "r", "p", False, False):
            raise ValueError("Pi153 table identity differs: " + table)
        expected_columns = [(field.column, field.db_type(connection), not field.null, None, "", "")
                            for field in model._meta.local_fields]
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,"
            "pg_get_expr(d.adbin,d.adrelid),a.attgenerated,a.attidentity FROM pg_attribute a "
            "LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
            "WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [target])
        if cursor.fetchall() != expected_columns:
            raise ValueError("Pi153 column/default drift: " + table)
        expected_foreign = sorted((field.column, field.target_field.model._meta.db_table,
                                   field.target_field.column)
                                  for field in model._meta.local_fields if field.is_relation and field.db_constraint)
        cursor.execute("SELECT a.attname,rc.relname,ra.attname FROM pg_constraint c "
            "JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] "
            "JOIN pg_class rc ON rc.oid=c.confrelid "
            "JOIN pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=c.confkey[1] "
            "WHERE c.conrelid=to_regclass(%s) AND c.contype='f' ORDER BY a.attname,rc.relname,ra.attname", [target])
        if cursor.fetchall() != expected_foreign:
            raise ValueError("Pi153 foreign-key target drift: " + table)
        fields = {field.name: field for field in model._meta.local_fields}
        column = lambda name: fields[name].column
        opclass = lambda name: {"text": "text_ops", "bigint": "int8_ops", "integer": "int4_ops",
                                "timestamp with time zone": "timestamptz_ops", "boolean": "bool_ops"}[fields[name].db_type(connection)]
        expected_indexes = []
        for field in fields.values():
            if field.primary_key or field.unique or field.db_index:
                expected_indexes.append((bool(field.primary_key or field.unique), (field.column,), (opclass(field.name),)))
                if field.db_type(connection) == "text":
                    expected_indexes.append((False, (field.column,), ("text_pattern_ops",)))
        unique_constraints = [constraint for constraint in model._meta.constraints
                              if getattr(constraint, "fields", ())]
        for constraint in unique_constraints:
            if getattr(constraint, "condition", None) or getattr(constraint, "expressions", ()):
                raise ValueError("Pi153 only supports the reviewed nonconditional field indexes")
            expected_indexes.append((True, tuple(map(column, constraint.fields)), tuple(map(opclass, constraint.fields))))
        for index in model._meta.indexes:
            if any(name.startswith("-") for name in index.fields) or index.expressions or index.condition:
                raise ValueError("Pi153 only supports the reviewed ascending field indexes")
            expected_indexes.append((False, tuple(map(column, index.fields)), tuple(map(opclass, index.fields))))
        cursor.execute("SELECT i.indisunique,ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(num,ord) "
            "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.ord),"
            "ARRAY(SELECT o.opcname FROM unnest(i.indclass) WITH ORDINALITY k(num,ord) "
            "JOIN pg_opclass o ON o.oid=k.num ORDER BY k.ord),i.indisvalid,i.indisready,"
            "pg_get_expr(i.indpred,i.indrelid),pg_get_expr(i.indexprs,i.indrelid),m.amname "
            "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am m ON m.oid=c.relam "
            "WHERE i.indrelid=to_regclass(%s)", [target])
        indexes = cursor.fetchall()
        if any(row[3:] != (True, True, None, None, "btree") for row in indexes):
            raise ValueError("Pi153 index shape drift: " + table)
        if Counter((row[0], tuple(row[1]), tuple(row[2])) for row in indexes) != Counter(expected_indexes):
            raise ValueError("Pi153 index membership drift: " + table)
        cursor.execute("SELECT contype,convalidated,condeferrable,condeferred,"
            "ARRAY(SELECT a.attname FROM unnest(conkey) WITH ORDINALITY k(num,ord) "
            "JOIN pg_attribute a ON a.attrelid=conrelid AND a.attnum=k.num ORDER BY k.ord) "
            "FROM pg_constraint WHERE conrelid=to_regclass(%s)", [target])
        constraints = cursor.fetchall()
        if any(not row[1] or row[0] not in {"p", "u", "f", "c"}
               or row[2:4] != ((True, True) if row[0] == "f" else (False, False)) for row in constraints):
            raise ValueError("Pi153 constraint validity/deferral drift: " + table)
        if [tuple(row[4]) for row in constraints if row[0] == "p"] != [(model._meta.pk.column,)]:
            raise ValueError("Pi153 primary key drift: " + table)
        expected_unique = Counter(tuple(map(column, constraint.fields)) for constraint in unique_constraints)
        expected_unique.update((field.column,) for field in fields.values() if field.unique and not field.primary_key)
        if Counter(tuple(row[4]) for row in constraints if row[0] == "u") != expected_unique:
            raise ValueError("Pi153 unique identity drift: " + table)
        cursor.execute("SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' "
            "ELSE r.rolname END,a.privilege_type,a.is_grantable FROM pg_class c "
            "CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a "
            "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s)", [target])
        owner = {("OWNER", name, False) for name in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN")}
        privileges = ("SELECT", "INSERT") if table in migration.APPEND_ONLY else ("SELECT", "INSERT", "UPDATE")
        expected_acl = owner | ({("teruisi_ai_writer", name, False) for name in privileges} if permissions else set())
        if set(cursor.fetchall()) != expected_acl:
            raise ValueError("Pi153 ACL differs: " + table)
        cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(%s) AND attacl IS NOT NULL),"
                       "EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=to_regclass(%s))", [target, target])
        if cursor.fetchone() != (False, False):
            raise ValueError("Pi153 column ACL or policy drift: " + table)


def preservation(cursor):
    import bi_app_addition as common
    import pi_business_catalog as parent
    original = parent.preservation(cursor)
    values, permissions, count = {}, {}, original["rows"]
    for table in parent.TABLES:
        cursor.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY id LIMIT 100001").format(sql.Identifier(table)))
        rows = cursor.fetchall()
        if len(rows) > 100000:
            raise ValueError("Pi152 preservation exceeded bound")
        count += len(rows)
        values[table] = common.digest(rows)
        cursor.execute("SELECT relacl::text FROM pg_class WHERE oid=to_regclass(%s)", ["public." + table])
        permissions[table] = cursor.fetchone()
    return {"rows": count, "legacyRowsSha256": common.digest([original["legacyRowsSha256"], values]),
            "permissionsSha256": common.digest([original["permissionsSha256"], permissions])}


def verify_initial_values(cursor):
    for table in TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Pi153 structure adoption cannot seed or import data")


def verify_defaults(apps):
    # Existing defaults remain part of the finite predecessor contract.
    import pi_business_catalog as parent
    parent.verify_defaults(apps)
    module = importlib.import_module("ai_assistant.migrations.0087_pi_native_capabilities")
    if set(module.TABLES) != set(TABLES):
        raise ValueError("Pi153 migration table membership differs")
