"""Keep experimental signing/report capabilities closed without new key custody."""
from importlib import import_module
from django.db import migrations
from ai_assistant import business_v4_report_restricted_page_sql as page

SIGNATURE = "public.ai_protected_profile_has_no_keys()"
KEY_TABLE = "public.protected_business_budget_v11_verifier_keys"
BODY = " SELECT NOT EXISTS(SELECT 1 FROM public.protected_business_budget_v11_verifier_keys) "
ROLES = (
    "teruisi_ai_budget_v11_attestor", "teruisi_ai_budget_v11_key_owner",
    "teruisi_ai_budget_v11_publisher", "teruisi_ai_market_paid_adopter",
    "teruisi_ai_market_paid_reserver", "teruisi_ai_market_paid_starter",
    "teruisi_ai_budget_v11_attest_login", "teruisi_ai_budget_v11_sign_login",
    "teruisi_ai_budget_v11_publish_login", "teruisi_ai_market_rate_proposer",
    "teruisi_ai_market_cap_proposer", "teruisi_ai_market_proposal_revoker",
    "teruisi_ai_budget_v11_attestor_v2_login", "teruisi_ai_market_v6_topology_login",
    "teruisi_ai_budget_v11_download_v2_login", "teruisi_ai_market_v6_source_login",
)


def verify_catalog(cursor):
    cursor.execute("SELECT pg_get_userbyid(relowner),relrowsecurity FROM pg_class WHERE oid=%s::regclass", [KEY_TABLE])
    if cursor.fetchone() != ("teruisi_ai_budget_v11_key_owner", False):
        raise RuntimeError("no-key profile private table owner changed")
    cursor.execute("SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode("
        "COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=%s::regclass "
        "AND a.grantee<>c.relowner", [KEY_TABLE])
    if cursor.fetchone() != (0,):
        raise RuntimeError("no-key profile private table privileges changed")
    cursor.execute("SELECT count(*) FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid "
        "CROSS JOIN LATERAL aclexplode(t.attacl) a WHERE c.oid=%s::regclass AND a.grantee<>c.relowner", [KEY_TABLE])
    if cursor.fetchone() != (0,):
        raise RuntimeError("no-key profile private column privileges changed")
    cursor.execute("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
        "rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY(%s)", [list(ROLES)])
    roles = cursor.fetchall()
    if len(roles) != len(ROLES) or any(row[1:] != (False,) * 7 for row in roles):
        raise RuntimeError("no-key profile requires closed protected roles")
    cursor.execute("SELECT count(*) FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid "
        "JOIN pg_roles c ON c.oid=m.member WHERE p.rolname=ANY(%s) OR c.rolname=ANY(%s)",
        [list(ROLES), list(ROLES)])
    if cursor.fetchone() != (0,):
        raise RuntimeError("no-key profile protected role membership changed")
    cursor.execute("SELECT p.prosrc,p.prosecdef,p.provolatile,p.proconfig,r.rolsuper,"
        "pg_get_function_result(p.oid),l.lanname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner "
        "JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(%s)", [SIGNATURE])
    row = cursor.fetchone()
    if (row is None or row[:3] != (BODY, True, "s") or row[4:] != (True, "boolean", "sql")
            or {value.replace(" ", "") for value in row[3] or []} != {"search_path=pg_catalog,public"}):
        raise RuntimeError("no-key profile probe body or owner changed")
    cursor.execute("SELECT CASE WHEN a.grantee=p.proowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' "
        "ELSE r.rolname END,a.privilege_type,a.is_grantable FROM pg_proc p "
        "CROSS JOIN LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee "
        "WHERE p.oid=to_regprocedure(%s)", [SIGNATURE])
    if set(cursor.fetchall()) != {("OWNER", "EXECUTE", False),
            (page.READER, "EXECUTE", False), (page.WRITER, "EXECUTE", False)}:
        raise RuntimeError("no-key profile probe privileges changed")
    cursor.execute("SELECT " + SIGNATURE)
    if cursor.fetchone() != (True,):
        raise RuntimeError("private key material exists; no-key backup profile is not admitted")
    import_module("ai_assistant.migrations.0075_business_v4_report_restricted_page"
        ).verify_catalog(cursor, reader_closed=True)


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")
        if cursor.fetchone() != (True,):
            raise RuntimeError("no-key profile requires the privileged installer")
        cursor.execute("SELECT EXISTS(SELECT 1 FROM " + KEY_TABLE + ")")
        if cursor.fetchone() != (False,):
            raise RuntimeError("cannot adopt no-key profile over existing private keys")
        for signature in (page.RO_BINDINGS, page.RO_READ, page.PAGE):
            cursor.execute("REVOKE ALL ON FUNCTION " + signature + " FROM PUBLIC,"
                + page.READER + "," + page.WRITER)
        cursor.execute("CREATE FUNCTION " + SIGNATURE + " RETURNS boolean LANGUAGE sql "
            "STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$" + BODY + "$$")
        cursor.execute("REVOKE ALL ON FUNCTION " + SIGNATURE + " FROM PUBLIC")
        cursor.execute("GRANT EXECUTE ON FUNCTION " + SIGNATURE + " TO " + page.READER + "," + page.WRITER)
        verify_catalog(cursor)


class Migration(migrations.Migration):
    dependencies = [("ai_assistant", "0081_readiness_catalog_probe")]
    operations = [migrations.RunPython(install)]
