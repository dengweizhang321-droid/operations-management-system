"""Finite Pi152 structural catalogue, derived from frozen0086 metadata only.

No rehearsal or application operation is performed by this module. Database
inspection is used only by the native migration/start gates when authorized.
"""
import importlib
from collections import Counter
from pathlib import Path
from psycopg import sql

STEPS = ("ai_assistant.0086_pi_business_actions",)
FILES = {"backend/ai_assistant/migrations/0086_pi_business_actions.py": "3435b5970ffb5d5530e60aed6156e7b7e7792fb0cbff5e198ef8a3b264ee4213"}
TABLES = ("ai_pi_business_actions", "ai_pi_business_audits", "ai_pi_business_intents")


def definitions():
    from django.db import migrations
    module = importlib.import_module("ai_assistant.migrations.0086_pi_business_actions")
    result, names = {}, {}
    for operation in module.Migration.operations:
        if isinstance(operation, migrations.CreateModel):
            table = operation.options["db_table"]
            if table not in TABLES:
                raise ValueError("Pi152 migration contains another table")
            result[table] = {"fields": list(operation.fields), "constraints": list(operation.options.get("constraints", [])),
                             "indexes": list(operation.options.get("indexes", []))}
            names[operation.name.lower()] = table
        elif isinstance(operation, migrations.AddField):
            result[names[operation.model_name]]["fields"].append((operation.name, operation.field))
        elif isinstance(operation, migrations.AddConstraint):
            result[names[operation.model_name]]["constraints"].append(operation.constraint)
        elif isinstance(operation, migrations.AddIndex):
            result[names[operation.model_name]]["indexes"].append(operation.index)
        elif not isinstance(operation, migrations.RunPython):
            raise ValueError("Pi152 contains an unsupported structure operation")
    if set(result) != set(TABLES):
        raise ValueError("Pi152 requires exactly three new business ledgers")
    return result


def verify_catalog(cursor, *, installed=True, permissions=True):
    import pi_workspace_catalog as parent
    parent.verify_catalog(cursor, installed=True, permissions=permissions, business=installed)
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname LIKE 'ai_pi_business_%%' AND relkind IN ('r','p','v','m','f') ORDER BY relname")
    if [row[0] for row in cursor.fetchall()] != (list(TABLES) if installed else []):
        raise ValueError("Pi152 business tables absent, partial, extra or unrecorded")
    if not installed:
        return
    from ai_assistant.pi_health import verify_business
    verify_business(cursor)
    types = {"TextField": "text", "PositiveBigIntegerField": "bigint", "DateTimeField": "timestamp with time zone", "BooleanField": "boolean"}
    for table, definition in definitions().items():
        target = "public." + table
        fields = definition["fields"]
        column = lambda name, field: name + "_id" if field.is_relation else name
        columns = {name: column(name, field) for name, field in fields}
        expected = [(columns[name], "text" if field.is_relation else types[field.get_internal_type()], not field.null, None, "", "") for name, field in fields]
        cursor.execute("SELECT pg_get_userbyid(relowner),relkind,relpersistence,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=to_regclass(%s)", [target])
        if cursor.fetchone() != ("teruisi_sales_owner", "r", "p", False, False):
            raise ValueError("Pi152 table identity drift: " + table)
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attgenerated,a.attidentity FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [target])
        if cursor.fetchall() != expected:
            raise ValueError("Pi152 column/default drift: " + table)
        expected_indexes = []
        for name, field in fields:
            col = columns[name]
            if field.primary_key or field.unique or field.db_index:
                expected_indexes.append((bool(field.primary_key or field.unique), (col,), ("text_ops",)))
                expected_indexes.append((False, (col,), ("text_pattern_ops",)))
        for constraint in definition["constraints"]:
            if hasattr(constraint, "fields") and constraint.fields:
                expected_indexes.append((True, tuple(columns[name] for name in constraint.fields), tuple("text_ops" for _ in constraint.fields)))
        for index in definition["indexes"]:
            expected_indexes.append((False, tuple(columns[name] for name in index.fields), tuple("timestamptz_ops" if dict(fields)[name].get_internal_type()=="DateTimeField" else "text_ops" for name in index.fields)))
        cursor.execute("SELECT i.indisunique,ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.ord),ARRAY(SELECT o.opcname FROM unnest(i.indclass) WITH ORDINALITY k(num,ord) JOIN pg_opclass o ON o.oid=k.num ORDER BY k.ord),i.indisvalid,i.indisready,pg_get_expr(i.indpred,i.indrelid),pg_get_expr(i.indexprs,i.indrelid),m.amname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am m ON m.oid=c.relam WHERE i.indrelid=to_regclass(%s)", [target])
        actual_indexes = []
        for unique, keys, classes, valid, ready, predicate, expression, method in cursor.fetchall():
            if (valid, ready, predicate, expression, method) != (True, True, None, None, "btree"):
                raise ValueError("Pi152 index shape drift: " + table)
            actual_indexes.append((unique, tuple(keys), tuple(classes)))
        if Counter(actual_indexes) != Counter(expected_indexes):
            raise ValueError("Pi152 index membership drift: " + table)
        cursor.execute("SELECT conname,contype,convalidated,condeferrable,condeferred,ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord),pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE conrelid=to_regclass(%s)", [target])
        actual = cursor.fetchall()
        expected_unique = Counter(tuple(columns[name] for name in constraint.fields) for constraint in definition["constraints"] if getattr(constraint,"fields",()))
        expected_unique.update((columns[name],) for name, field in fields if field.unique and not field.primary_key)
        if Counter(tuple(row[5]) for row in actual if row[1]=="u") != expected_unique:
            raise ValueError("Pi152 unique constraint drift: " + table)
        if [tuple(row[5]) for row in actual if row[1]=="p"] != [("id",)]:
            raise ValueError("Pi152 primary key drift: " + table)
        expected_fk = Counter((columns[name],) for name,field in fields if field.is_relation)
        if Counter(tuple(row[5]) for row in actual if row[1]=="f") != expected_fk:
            raise ValueError("Pi152 foreign key drift: " + table)
        for row in actual:
            if not row[2] or row[1] not in {"p","u","f","c"} or (row[3],row[4]) != ((True,True) if row[1]=="f" else (False,False)):
                raise ValueError("Pi152 constraint shape drift: " + table)
        from postgres_restore_semantics import normalize_dump_expression
        expected_checks = {table+"_"+columns[name]+"_check": "CHECK ("+columns[name]+" >= 0)"
            for name,field in fields if field.get_internal_type()=="PositiveBigIntegerField"}
        if table=="ai_pi_business_actions":
            status_constraint=next(c for c in definition["constraints"] if c.name=="ai_pi_business_action_status")
            statuses=dict(status_constraint.condition.children)["status__in"]
            expected_checks.update({
                "ai_pi_business_action_status": "CHECK (status = ANY (ARRAY["+", ".join("'"+status+"'::text" for status in statuses)+"]))",
                "ai_pi_business_digest_hash": "CHECK ((request_digest ~ '^[a-f0-9]{64}$'::text) AND (preview_digest ~ '^[a-f0-9]{64}$'::text))",
                "ai_pi_business_payload_bytes": "CHECK ((octet_length(parameters_json) <= 131072) AND (octet_length(preview_json) <= 131072) AND (octet_length(result_json) <= 131072))"})
        elif table=="ai_pi_business_audits":
            expected_checks["ai_pi_business_audit_bytes"]="CHECK (octet_length(data_json) <= 131072)"
        if {row[0]:normalize_dump_expression(row[6]) for row in actual if row[1]=="c"} != {name:normalize_dump_expression(value) for name,value in expected_checks.items()}:
            raise ValueError("Pi152 check constraint definition drift: "+table)
        references={"pisession":"ai_pi_sessions","pioperation":"ai_pi_operations","pibusinessintent":"ai_pi_business_intents","pibusinessaction":"ai_pi_business_actions"}
        expected_fk_definitions=Counter("FOREIGN KEY ("+columns[name]+") REFERENCES "+references[field.remote_field.model.split(".")[-1]]+"(id) DEFERRABLE INITIALLY DEFERRED" for name,field in fields if field.is_relation)
        if Counter(row[6] for row in actual if row[1]=="f") != expected_fk_definitions:
            raise ValueError("Pi152 foreign key target drift: "+table)
        cursor.execute("SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass(%s)",[target])
        if not {index.name for index in definition["indexes"]} <= {row[0] for row in cursor.fetchall()}:
            raise ValueError("Pi152 named indexes missing: "+table)
        named = {constraint.name for constraint in definition["constraints"]}
        if not named <= {row[0] for row in actual}:
            raise ValueError("Pi152 named constraints missing: " + table)
        cursor.execute("SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,a.privilege_type,a.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s)", [target])
        actual_acl = set(cursor.fetchall())
        owner = {( "OWNER", privilege, False) for privilege in ("DELETE","INSERT","MAINTAIN","REFERENCES","SELECT","TRIGGER","TRUNCATE","UPDATE")}
        writer_privileges = ("INSERT","SELECT","UPDATE") if table == "ai_pi_business_actions" else ("INSERT","SELECT")
        wanted_acl = owner | {( "teruisi_ai_writer", privilege, False) for privilege in writer_privileges}
        if actual_acl != (wanted_acl if permissions else owner):
            raise ValueError("Pi152 table ACL drift: " + table)
        cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(%s) AND attacl IS NOT NULL),EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=to_regclass(%s))", [target,target])
        if cursor.fetchone() != (False,False):
            raise ValueError("Pi152 column ACL or policy drift: " + table)


def preservation(cursor):
    import bi_app_addition as common
    import pi_workspace_catalog as parent
    original = parent.preservation(cursor)
    values, permissions, count = {}, {}, original["rows"]
    for table in parent.TABLES:
        key = "session_id" if table == "ai_pi_workspaces" else "id"
        cursor.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY {} LIMIT 100001").format(sql.Identifier(table),sql.Identifier(key)))
        rows = cursor.fetchall()
        if len(rows)>100000:
            raise ValueError("Pi151 preservation exceeded bound")
        count += len(rows)
        values[table] = common.digest(rows)
        cursor.execute("SELECT relacl::text FROM pg_class WHERE oid=to_regclass(%s)", ["public."+table])
        permissions[table] = cursor.fetchone()
    return {"rows":count,"legacyRowsSha256":common.digest([original["legacyRowsSha256"],values]),"permissionsSha256":common.digest([original["permissionsSha256"],permissions])}


def verify_initial_values(cursor):
    for table in TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Pi152 installation cannot seed business rows")


def verify_defaults(apps):
    from pi_workspace_catalog import verify_defaults as parent_defaults
    parent_defaults(apps)
    value = apps.get_model("ai_assistant", "PiBusinessAction")()
    if (value.status,value.version,value.cancel_requested) != ("prepared",1,False):
        raise ValueError("Pi152 business action defaults drift")
