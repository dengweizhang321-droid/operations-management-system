"""Native Pi catalog readiness; no task payloads or runtime requests are read."""
import importlib
import re


def normalize_check(value):
    """Normalize PostgreSQL's harmless text casts and IN/ANY rendering only."""
    value = re.sub(r"::(?:text|bigint|integer|character varying)(?:\[\])?", "", value)
    value = re.sub(r"\bIN\s*\(([^()]*)\)", r"= ANY ARRAY[\1]", value, flags=re.I)
    return re.sub(r'[\s()\"]', '', value).lower()


def verify_native(cursor, *, permissions=True):
    migration = importlib.import_module("ai_assistant.migrations.0087_pi_native_capabilities")
    from .pi_models import PI_MODELS
    models = {m._meta.db_table: m for m in PI_MODELS if m._meta.db_table in migration.TABLES}
    cursor.execute("SELECT p.prosrc,p.prosecdef,p.proconfig,l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure('public.ai_pi_native_guard()')")
    row = cursor.fetchone()
    if (not row or row[0] != migration.STATE_GUARD.split("$$")[1] or row[1] or row[3] != "plpgsql"
            or {v.replace(" ", "") for v in row[2] or []} != {"search_path=pg_catalog,public"}):
        raise ValueError("Pi native guard function drift")
    cursor.execute("SELECT c.relname,t.tgname,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgenabled,p.proname,t.tgargs "
        "FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND c.relname=ANY(%s) AND NOT t.tgisinternal", [list(migration.TABLES)])
    expected = {(table, "ai_write_fence", 31, False, False, "O", "ai_runtime_write_fence", b"") for table in migration.TABLES}
    expected.update((table, "ai_pi_native_state", 23, False, False, "O", "ai_pi_native_guard", b"") for table in migration.TABLES)
    expected.update((table, "ai_immutable_evidence", 27, False, False, "O", "ai_immutable_record_guard", b"") for table in migration.APPEND_ONLY)
    expected.update((table, "ai_immutable_identity", 19, False, False, "O", "ai_immutable_record_guard",
        b"\0".join(v.encode() for v in identity.split())+b"\0") for table, identity in migration.IDENTITIES.items())
    actual = {(*r[:7], bytes(r[7])) for r in cursor.fetchall()}
    if actual != expected:
        raise ValueError("Pi native trigger identity drift")
    cursor.execute("SELECT c.conname,pg_get_constraintdef(c.oid),c.convalidated FROM pg_constraint c WHERE c.conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY(%s))", [list(migration.TABLES)])
    checks = {name: value for name, value, validated in cursor.fetchall() if validated}
    for name, expected_check in migration.EXPECTED_CHECKS.items():
        if name not in checks or normalize_check(checks[name]) != normalize_check(expected_check):
            raise ValueError("Pi native check expression drift: "+name)
    for name, expression in {
        "ai_pi_native_mode": "CHECK (mode IN ('plan','execute') AND target_mode IN ('plan','execute') AND transition_status IN ('stable','switching'))",
        "ai_pi_agent_lifecycle": "CHECK (lifecycle IN ('open','canceling','closed'))",
        "ai_pi_agent_wait_status": "CHECK (status IN ('pending','ready','canceled','timeout'))",
        "ai_pi_delegation_status": "CHECK (status IN ('active','revoked'))",
    }.items():
        if name not in checks or normalize_check(checks[name]) != normalize_check(expression):
            raise ValueError("Pi native status constraint drift: "+name)
    for table, model in models.items():
        cursor.execute("SELECT c.conname,c.contype,array_agg(a.attname ORDER BY k.ordinality) "
            "FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) "
            "JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum "
            "WHERE c.conrelid=%s::regclass AND c.contype IN ('p','u') AND c.convalidated GROUP BY c.conname,c.contype", ["public."+table])
        unique = {name: (kind, tuple(columns)) for name, kind, columns in cursor.fetchall()}
        if not any(kind == "p" and columns == (model._meta.pk.column,) for kind, columns in unique.values()):
            raise ValueError("Pi native primary identity missing: "+table)
        for constraint in model._meta.constraints:
            if getattr(constraint, "fields", ()):
                expected_columns = tuple(model._meta.get_field(f).column for f in constraint.fields)
                if unique.get(constraint.name) != ("u", expected_columns):
                    raise ValueError("Pi native unique identity drift: "+constraint.name)
    if permissions:
        from .database_contract import WRITER_PRIVILEGES
        for table in migration.TABLES:
            cursor.execute("SELECT privilege,has_table_privilege('teruisi_ai_writer',%s,privilege) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege", ["public."+table])
            if {privilege for privilege, allowed in cursor.fetchall() if allowed} != set(WRITER_PRIVILEGES[table]):
                raise ValueError("Pi native writer ACL drift: "+table)
            cursor.execute("SELECT has_table_privilege('teruisi_ai_reader',%s,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')", ["public."+table])
            if cursor.fetchone() != (False,):
                raise ValueError("Pi native reader grant drift: "+table)
