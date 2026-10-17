"""Catalog-only verification; Pi payloads are never selected by readiness."""
import importlib


def verify(cursor):
    migration = importlib.import_module("ai_assistant.migrations.0084_pi_agent_independent_runtime")
    for name, definition in (("ai_pi_state_guard", migration.STATE_GUARD), ("ai_pi_binding_guard", migration.BINDING_GUARD)):
        cursor.execute("SELECT p.prosrc,p.prosecdef,p.proconfig,l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(%s)", ["public."+name+"()"])
        row = cursor.fetchone()
        if (not row or row[0] != definition.split("$$")[1] or row[1] or row[3] != "plpgsql"
                or {item.replace(" ", "") for item in (row[2] or [])} != {"search_path=pg_catalog,public"}):
            raise ValueError("Pi runtime function drift")
    cursor.execute("SELECT c.relname,t.tgname,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgenabled,p.proname "
        "FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND c.relname=ANY(%s) AND NOT t.tgisinternal", [list(migration.PI_TABLES)])
    expected = {(table, "ai_write_fence", 31, False, False, "O", "ai_runtime_write_fence") for table in migration.PI_TABLES}
    expected.update((table, "ai_immutable_evidence", 27, False, False, "O", "ai_immutable_record_guard") for table in migration.PI_APPEND_ONLY)
    expected.update((table, "ai_immutable_identity", 19, False, False, "O", "ai_immutable_record_guard") for table in migration.PI_IDENTITIES)
    expected.update((table, "ai_pi_state", 23, False, False, "O", "ai_pi_state_guard") for table in ("ai_pi_sessions", "ai_pi_operations", "ai_pi_dispatches"))
    expected.update((table, "ai_pi_binding", 21, True, True, "O", "ai_pi_binding_guard") for table in ("ai_pi_sessions", "ai_pi_operations"))
    if set(cursor.fetchall()) != expected:
        raise ValueError("Pi runtime trigger drift")
    cursor.execute("SELECT conname FROM pg_constraint WHERE conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY(%s)) AND convalidated", [list(migration.PI_TABLES)])
    constraints = {row[0] for row in cursor.fetchall()}
    if not {"ai_pi_session_client_unique", "ai_pi_operation_client_unique", "ai_pi_operation_seq_unique", "ai_pi_dispatch_identity_unique",
            "ai_pi_event_seq_unique", "ai_pi_file_client_unique", "ai_pi_export_request_unique", "ai_pi_export_page_unique",
            "ai_pi_operation_status", "ai_pi_session_status", "ai_pi_file_payload_hash"} <= constraints:
        raise ValueError("Pi runtime constraints missing")
    cursor.execute("SELECT indisvalid,indisready,indisunique,pg_get_expr(indpred,indrelid) FROM pg_index WHERE indexrelid=to_regclass('public.ai_pi_one_active_operation')")
    index = cursor.fetchone()
    if not index or index[:3] != (True, True, True) or any(value not in (index[3] or "") for value in ("queued", "running", "canceling", "unknown")):
        raise ValueError("Pi unique active-operation fence missing")
