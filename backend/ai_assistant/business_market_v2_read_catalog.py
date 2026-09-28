"""Frozen default-closed market-v2 same-job read-receipt catalog."""
from importlib import import_module


def verify(cursor, error_type=ValueError, *, topology_guard_enabled=False, runtime_probe=False):
    migration = import_module(
        "ai_assistant.migrations.0062_business_market_v2_read_receipt_candidate")
    role = migration.ROLE
    cursor.execute("SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
        "rolcreaterole,rolreplication,rolbypassrls FROM pg_catalog.pg_roles "
        "WHERE rolname=%s", [role])
    if cursor.fetchone() != (False,) * 7:
        raise error_type("market read attestor role widened")
    cursor.execute("SELECT count(*) FROM pg_catalog.pg_auth_members WHERE "
        "roleid=%s::regrole OR member=%s::regrole", [role, role])
    if cursor.fetchone() != (0,):
        raise error_type("market read attestor membership drift")
    cursor.execute("SELECT relkind,pg_catalog.pg_get_userbyid(relowner) "
        "FROM pg_catalog.pg_class WHERE oid=to_regclass(%s)", [migration.TABLE])
    table = cursor.fetchone()
    if table is None or table[0] != "r":
        raise error_type("market read receipt table missing")
    owner = table[1]
    cursor.execute("SELECT attname,format_type(atttypid,atttypmod),attnotnull "
        "FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass(%s) "
        "AND attnum>0 AND NOT attisdropped ORDER BY attnum", [migration.TABLE])
    if cursor.fetchall() != [
            ("tool_dispatch_id", "character varying(160)", True),
            ("execution_report_id", "character varying(160)", True),
            ("job_id", "character varying(160)", True),
            ("provider_dispatch_id", "character varying(160)", True),
            ("receipt_json", "text", True),
            ("receipt_digest", "character varying(64)", True),
            ("recorded_at", "timestamp with time zone", True)]:
        raise error_type("market read receipt columns drift")
    cursor.execute("SELECT contype,pg_catalog.pg_get_constraintdef(oid) "
        "FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass(%s)",
        [migration.TABLE])
    if set(cursor.fetchall()) != {
            ("p", "PRIMARY KEY (tool_dispatch_id)"),
            ("f", "FOREIGN KEY (tool_dispatch_id) REFERENCES "
                "ai_agent_tool_dispatches(id) ON DELETE RESTRICT"),
            ("f", "FOREIGN KEY (execution_report_id) REFERENCES "
                "ai_report_runs(id) ON DELETE RESTRICT"),
            ("f", "FOREIGN KEY (job_id) REFERENCES "
                "ai_agent_jobs(id) ON DELETE RESTRICT"),
            ("f", "FOREIGN KEY (provider_dispatch_id) REFERENCES "
                "ai_agent_provider_dispatches(id) ON DELETE RESTRICT")}:
        raise error_type("market read receipt PK/FK drift")
    for account in (role, migration.READER, migration.WRITER):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
                          "REFERENCES", "TRIGGER"):
            cursor.execute("SELECT has_table_privilege(%s,%s,%s)",
                [account, migration.TABLE, privilege])
            if cursor.fetchone() != (False,):
                raise error_type("market read receipt table ACL opened")
        for privilege in ("SELECT", "INSERT", "UPDATE", "REFERENCES"):
            cursor.execute("SELECT has_any_column_privilege(%s,%s,%s)",
                [account, migration.TABLE, privilege])
            if cursor.fetchone() != (False,):
                raise error_type("market read receipt column ACL opened")
    for signature, definition, definer, grants in (
            ("public.ai_market_v2_read_receipt_guard()", migration.GUARD,
                False, {owner}),
            (migration.CLAIM_SIGNATURE, migration.CLAIM, True, {owner}),
            (migration.ATTEST_SIGNATURE, migration.ATTEST, True, {owner, role}),
            (migration.READ_SIGNATURE, migration.READ, True,
                {owner, migration.READER})):
        cursor.execute("SELECT p.prosrc,p.prosecdef,p.proconfig,"
            "pg_catalog.pg_get_userbyid(p.proowner),l.lanname "
            "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l "
            "ON l.oid=p.prolang WHERE p.oid=to_regprocedure(%s)", [signature])
        row = cursor.fetchone()
        if (row is None or row[0] != definition.split("$$", 2)[1]
                or row[1] is not definer or row[3] != owner
                or row[4] != "plpgsql"
                or {item.replace(" ", "") for item in (row[2] or [])}
                    != {"search_path=pg_catalog,public"}):
            raise error_type("market read receipt function drift")
        cursor.execute("SELECT pg_catalog.pg_get_userbyid(a.grantee),"
            "a.privilege_type FROM pg_catalog.pg_proc p,"
            "LATERAL pg_catalog.aclexplode(p.proacl) a "
            "WHERE p.oid=to_regprocedure(%s)", [signature])
        if set(cursor.fetchall()) != {(name, "EXECUTE") for name in grants}:
            raise error_type("market read receipt function ACL drift")
    cursor.execute("SELECT t.tgname,t.tgfoid::regprocedure::text,t.tgenabled,"
        "t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgqual "
        "FROM pg_catalog.pg_trigger t WHERE t.tgrelid=to_regclass(%s) "
        "AND NOT t.tgisinternal", [migration.TABLE])
    triggers = cursor.fetchall()
    wanted = {"ai_market_v2_read_receipt_guard":
        "public.ai_market_v2_read_receipt_guard()",
        "ai_market_v2_read_receipt_no_truncate":
        "public.ai_v4_seal_ticket_no_truncate()"}
    if topology_guard_enabled:
        from . import business_market_v6_paused_topology_sql as topology
        wanted["ai_market_v6_topology_effect_guard"] = topology.EFFECT_GUARD
        cursor.execute("SELECT p.prosrc,p.prosecdef,p.proconfig,"
            "pg_catalog.pg_get_userbyid(p.proowner),l.lanname "
            "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang "
            "WHERE p.oid=to_regprocedure(%s)", [topology.EFFECT_GUARD])
        row = cursor.fetchone()
        if (row is None or row[0] != topology.EFFECT_GUARD_SQL.split("$$", 2)[1]
                or row[1] is not True or row[3:] != (owner, "plpgsql")
                or {value.replace(" ", "") for value in row[2] or []} != {"search_path=pg_catalog,public"}):
            raise error_type("market topology effect guard drift")
        cursor.execute("SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE "
            "pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable "
            "FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,"
            "acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure(%s)", [topology.EFFECT_GUARD])
        if set(cursor.fetchall()) != {(owner, "EXECUTE", False)}:
            raise error_type("market topology effect guard ACL drift")
    if len(triggers) != len(wanted) or {item[0] for item in triggers} != set(wanted):
        raise error_type("market read receipt trigger set drift")
    for name, signature, enabled, event_bits, deferred, initially, predicate in triggers:
        cursor.execute("SELECT to_regprocedure(%s)::text", [wanted[name]])
        expected_bits = 34 if name.endswith("no_truncate") else 31
        if (signature != cursor.fetchone()[0] or enabled != "O" or event_bits != expected_bits
                or deferred or initially or predicate is not None):
            raise error_type("market read receipt trigger binding drift")
    if runtime_probe:
        probe = import_module("ai_assistant.migrations.0081_readiness_catalog_probe")
        probe.verify_catalog(cursor)
        cursor.execute("SELECT " + probe.SIGNATURE)
        if cursor.fetchone() != (True,):
            raise error_type("market read receipt must remain empty before activation")
    else:
        cursor.execute("SELECT count(*) FROM " + migration.TABLE)
        if cursor.fetchone() != (0,):
            raise error_type("market read receipt must remain empty before activation")
