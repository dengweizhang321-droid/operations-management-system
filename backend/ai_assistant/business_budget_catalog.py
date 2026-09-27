"""Verify unchanged v10 surfaces alongside the installed v11 file guards."""
from importlib import import_module


def verify_v11_budget_catalog(cursor, *, file_guard_verifier):
    """The 0059 verifier expects old file guards that 0066 legitimately replaces.

    Verify those guards against 0066, while retaining every v10 attestation,
    dormant publication and reader-fence body, owner and EXECUTE ACL check.
    Historical migration verifiers remain unchanged for their own generations.
    """
    attestation = import_module(
        "ai_assistant.migrations.0057_business_promotion_budget_v10_attestation")
    publication = import_module(
        "ai_assistant.migrations.0058_business_promotion_budget_v10_publish_gate")
    reader = import_module(
        "ai_assistant.migrations.0059_business_promotion_budget_v10_reader_fence")
    stage = import_module("ai_assistant.business_promotion_budget_v11_stage_sql")
    attestation.verify_catalog(cursor)
    file_guard_verifier(cursor, budget_stage_enabled=True,
        publish_gate_enabled=True, slim_stage_enabled=True)
    stage.verify_catalog(cursor)
    definitions = (
        (publication.READY_SIGNATURE, publication.READY_REQUIREMENTS, publication.ROLE),
        (publication.PUBLISH_SIGNATURE, publication.PUBLISH, publication.ROLE),
        (publication.OUTCOME_SIGNATURE, publication.OUTCOME, publication.ROLE),
        (reader.BODY_SIGNATURE, reader.BODY, reader.ATTESTOR),
        (reader.READ_SIGNATURE, reader.READ, reader.READER),
    )
    for signature, definition, grantee in definitions:
        cursor.execute("SELECT p.prosrc,p.prosecdef,p.proconfig,l.lanname,"
            "p.proowner=(SELECT c.relowner FROM pg_catalog.pg_class c WHERE "
            "c.oid='public.ai_business_promotion_budget_v10_attestations'::regclass) "
            "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang "
            "WHERE p.oid=to_regprocedure(%s)", [signature])
        row = cursor.fetchone()
        if (row is None or row[0] != definition.split("$$", 2)[1]
                or row[1] is not True or row[3] != "plpgsql" or row[4] is not True
                or {part.replace(" ", "") for part in (row[2] or [])}
                    != {"search_path=pg_catalog,public"}):
            raise RuntimeError("current budget frozen function body or owner drift")
        cursor.execute("SELECT CASE WHEN acl.grantee=p.proowner THEN 'OWNER' "
            "WHEN acl.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
            "acl.privilege_type,acl.is_grantable FROM pg_catalog.pg_proc p "
            "CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,"
            "pg_catalog.acldefault('f',p.proowner))) acl "
            "LEFT JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee "
            "WHERE p.oid=to_regprocedure(%s)", [signature])
        if set(cursor.fetchall()) != {("OWNER", "EXECUTE", False), (grantee, "EXECUTE", False)}:
            raise RuntimeError("current budget frozen EXECUTE ACL drift")
    cursor.execute("SELECT has_table_privilege(%s,%s,'SELECT')",
        [reader.READER, attestation.TABLE])
    if cursor.fetchone() != (False,):
        raise RuntimeError("current budget reader obtained private attestation table")
