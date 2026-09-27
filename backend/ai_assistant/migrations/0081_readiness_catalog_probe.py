"""Narrow runtime metadata checks without direct access to closed receipt rows."""
from django.db import migrations

SIGNATURE = "public.ai_market_v2_read_receipts_empty()"
TABLE = "public.ai_business_market_v2_read_receipts"
ROLES = ("teruisi_ai_reader", "teruisi_ai_writer")
BODY = " SELECT NOT EXISTS(SELECT 1 FROM public.ai_business_market_v2_read_receipts) "


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    quote = schema_editor.connection.ops.quote_name
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class "
            "WHERE oid=%s::regclass", [TABLE])
        owner = cursor.fetchone()[0]
        cursor.execute("CREATE FUNCTION " + SIGNATURE + " RETURNS boolean LANGUAGE sql "
            "STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$" + BODY + "$$")
        cursor.execute("ALTER FUNCTION " + SIGNATURE + " OWNER TO " + quote(owner))
        cursor.execute("REVOKE ALL ON FUNCTION " + SIGNATURE + " FROM PUBLIC")
        for role in ROLES:
            cursor.execute("GRANT EXECUTE ON FUNCTION " + SIGNATURE + " TO " + quote(role))
            cursor.execute("GRANT SELECT (app,name) ON TABLE public.django_migrations TO " + quote(role))
        verify_catalog(cursor)


def verify_catalog(cursor):
    cursor.execute("SELECT p.prosrc,p.prosecdef,p.provolatile,p.proconfig,"
        "p.proowner=c.relowner,pg_get_function_result(p.oid),l.lanname "
        "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang "
        "JOIN pg_catalog.pg_class c ON c.oid=%s::regclass "
        "WHERE p.oid=to_regprocedure(%s)", [TABLE, SIGNATURE])
    row = cursor.fetchone()
    if (row is None or row[:3] != (BODY, True, "s") or row[4:] != (True, "boolean", "sql")
            or {value.replace(" ", "") for value in row[3] or []} != {"search_path=pg_catalog,public"}):
        raise RuntimeError("readiness probe function body or owner drift")
    cursor.execute("SELECT CASE WHEN a.grantee=p.proowner THEN 'OWNER' "
        "WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,a.privilege_type,a.is_grantable "
        "FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a "
        "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=to_regprocedure(%s)", [SIGNATURE])
    if set(cursor.fetchall()) != {("OWNER", "EXECUTE", False),
            *((role, "EXECUTE", False) for role in ROLES)}:
        raise RuntimeError("readiness probe function ACL drift")
    for role in ROLES:
        cursor.execute("SELECT has_table_privilege(%s,'public.django_migrations',"
            "'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),"
            "has_any_column_privilege(%s,'public.django_migrations','INSERT,UPDATE,REFERENCES')",
            [role, role])
        if cursor.fetchone() != (False, False):
            raise RuntimeError("readiness migration metadata privileges expanded")
        cursor.execute("SELECT attname FROM pg_attribute WHERE attrelid='public.django_migrations'::regclass "
            "AND attnum>0 AND NOT attisdropped AND has_column_privilege(%s,attrelid,attnum,'SELECT') "
            "ORDER BY attname", [role])
        if cursor.fetchall() != [("app",), ("name",)]:
            raise RuntimeError("readiness migration metadata columns changed")


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP FUNCTION " + SIGNATURE)
        for role in ROLES:
            cursor.execute("REVOKE SELECT (app,name) ON TABLE public.django_migrations FROM " + role)


class Migration(migrations.Migration):
    dependencies = [("ai_assistant", "0080_model_tool_budget_300")]
    operations = [migrations.RunPython(install, uninstall)]
