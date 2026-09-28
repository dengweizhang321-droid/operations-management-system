"""Real PostgreSQL privilege negatives invoked only by the isolated runner."""
from importlib import import_module
import psycopg


def verify(db):
    checks = 0
    profile = import_module("ai_assistant.migrations.0082_no_new_keys_profile")
    probe = import_module("ai_assistant.migrations.0081_readiness_catalog_probe")
    from ai_assistant import business_v4_report_restricted_page_sql as page

    def catalogs():
        with db.cursor() as cursor:
            profile.verify_catalog(cursor)
            probe.verify_catalog(cursor)

    for role in ("teruisi_ai_reader", "teruisi_ai_writer"):
        db.execute("BEGIN")
        try:
            db.execute("SET LOCAL ROLE " + role)
            assert db.execute("SELECT " + profile.SIGNATURE).fetchone() == (True,)
            assert db.execute("SELECT " + probe.SIGNATURE).fetchone() == (True,)
            db.execute("SELECT app,name FROM public.django_migrations LIMIT 1")
            # Existing audit dataset remains available through original grants.
            db.execute("SELECT id FROM public.ai_tool_audit_logs LIMIT 0")
            for query in (
                "SELECT * FROM public.django_migrations LIMIT 0",
                "DELETE FROM public.django_migrations WHERE false",
                "SELECT * FROM " + profile.KEY_TABLE + " LIMIT 0",
                "SELECT * FROM " + probe.TABLE + " LIMIT 0",
                "INSERT INTO " + profile.KEY_TABLE + " SELECT * FROM " + profile.KEY_TABLE,
            ):
                db.execute("SAVEPOINT forbidden")
                try:
                    db.execute(query)
                except psycopg.errors.InsufficientPrivilege:
                    checks += 1
                else:
                    raise AssertionError("ordinary AI role gained a protected capability")
                finally:
                    db.execute("ROLLBACK TO SAVEPOINT forbidden")
            for signature in (page.RO_BINDINGS, page.RO_READ, page.PAGE):
                assert db.execute("SELECT has_function_privilege(current_user,%s,'EXECUTE')",
                    [signature]).fetchone() == (False,)
                checks += 1
        finally:
            db.execute("ROLLBACK")
    for index, mutation in enumerate((
        "GRANT EXECUTE ON FUNCTION " + profile.SIGNATURE + " TO PUBLIC",
        "ALTER FUNCTION " + probe.SIGNATURE + " SECURITY INVOKER",
        "ALTER FUNCTION " + profile.SIGNATURE + " VOLATILE",
        "GRANT SELECT ON " + profile.KEY_TABLE + " TO teruisi_sales_owner",
        "ALTER ROLE teruisi_ai_budget_v11_sign_login LOGIN",
        "GRANT teruisi_ai_budget_v11_sign_login TO teruisi_sales_owner",
        "GRANT EXECUTE ON FUNCTION " + page.PAGE + " TO teruisi_ai_reader",
        "GRANT SELECT(id) ON public.django_migrations TO teruisi_ai_reader",
        "GRANT UPDATE(name) ON public.django_migrations TO teruisi_ai_writer",
    )):
        db.execute("BEGIN")
        try:
            db.execute(mutation)
            try:
                catalogs()
            except RuntimeError:
                checks += 1
            else:
                raise AssertionError("changed protected catalog was accepted: case " + str(index))
        finally:
            db.execute("ROLLBACK")
        catalogs()
    import postgres_no_key_backup
    db.execute("BEGIN")
    try:
        db.execute("CREATE FUNCTION public.no_key_catalog_body_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$")
        before = postgres_no_key_backup.collect(db)
        db.execute("CREATE OR REPLACE FUNCTION public.no_key_catalog_body_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$")
        after = postgres_no_key_backup.collect(db)
        assert before["catalog"]["functions"] != after["catalog"]["functions"]
        assert before["catalog"]["functionAttributes"] == after["catalog"]["functionAttributes"]
        checks += 1
    finally:
        db.execute("ROLLBACK")
    return checks
