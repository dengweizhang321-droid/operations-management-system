"""Closed runtime grants; only AI records can be written by the AI writer."""

from . import models as m
from .control_models import (
    AiDataRevision,
    AiWriteAuthority,
    AiWriteReceipt,
    AiMutationAudit,
    AiMigrationRun,
)

CONTROL_MODELS = (
    AiDataRevision,
    AiWriteAuthority,
    AiWriteReceipt,
    AiMutationAudit,
    AiMigrationRun,
)
MODELS = {
    **m.HISTORICAL_MODELS,
    **{model._meta.db_table: model for model in CONTROL_MODELS},
}
READ_TABLES = {
    "ai_models",
    "ai_channels",
    "ai_conversations",
    "ai_conversation_messages",
    "ai_conversation_scopes",
    "ai_artifacts",
    "ai_memory_entries",
    "ai_knowledge_entries",
    "ai_analysis_runs",
    "ai_agent_jobs",
    "ai_agent_checkpoints",
    "ai_workflow_runs",
    "ai_workflow_node_runs",
    "ai_space_templates",
    "ai_space_model_profiles",
    "ai_space_jobs",
    "ai_space_job_items",
    "ai_space_assets",
    "ai_space_asset_favorites",
    "ai_data_revisions",
    "ai_write_authority",
    "ai_migration_runs",
    "access_control_users",
}
APPEND_ONLY = {
    "ai_chat_provider_dispatches",
    "ai_agent_checkpoints",
    "ai_agent_events",
    "ai_agent_provider_results",
    "ai_agent_tool_results",
    "ai_analysis_runs",
    "ai_artifact_deliveries",
    "ai_channel_callback_events",
    "ai_conversation_deletion_audits",
    "ai_memory_audit_logs",
    "ai_space_admin_audits",
    "ai_space_dispatch_receipts",
    "ai_space_dispatch_results",
    "ai_tool_audit_logs",
    "ai_workflow_events",
    "ai_mutation_audits",
}
WRITER_PRIVILEGES = {
    table: ("SELECT", "INSERT", "UPDATE", "DELETE") for table in MODELS
}
for table in APPEND_ONLY:
    WRITER_PRIVILEGES[table] = ("SELECT", "INSERT")
for table in {
    "ai_migration_runs",
    "ai_write_authority",
    "ai_space_schema_upgrades",
    "ai_system_settings",
    "ai_memory_commit_guards",
}:
    WRITER_PRIVILEGES[table] = ("SELECT",)
WRITER_PRIVILEGES["ai_data_revisions"] = ("SELECT", "UPDATE")
for table in {
    "ai_memory_entries",
    "ai_chat_request_receipts",
    "ai_write_request_receipts",
    "ai_agent_provider_dispatches",
    "ai_agent_tool_dispatches",
}:
    WRITER_PRIVILEGES[table] = ("SELECT", "INSERT", "UPDATE")
WRITER_PRIVILEGES["access_control_users"] = ("SELECT",)


def provision(connection, reader_password, writer_password):
    from psycopg import sql

    if (
        min(len(reader_password), len(writer_password)) < 32
        or reader_password == writer_password
    ):
        raise ValueError("Independent AI role passwords are required")
    with connection.transaction(), connection.cursor() as cursor:
        for role, password in [
            ("teruisi_ai_reader", reader_password),
            ("teruisi_ai_writer", writer_password),
        ]:
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,))
            if not cursor.fetchone():
                cursor.execute(
                    sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role))
                )
            cursor.execute(
                sql.SQL(
                    "ALTER ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD {}"
                ).format(sql.Identifier(role), sql.Literal(password))
            )
            cursor.execute(
                "SELECT parent.rolname FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid JOIN pg_roles member ON member.oid=membership.member WHERE member.rolname=%s",
                (role,),
            )
            for (parent,) in cursor.fetchall():
                cursor.execute(
                    sql.SQL("REVOKE {} FROM {}").format(
                        sql.Identifier(parent), sql.Identifier(role)
                    )
                )
            cursor.execute(
                sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {}").format(
                    sql.Identifier(role)
                )
            )
            cursor.execute(
                sql.SQL("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {}").format(
                    sql.Identifier(role)
                )
            )
            cursor.execute(
                sql.SQL("REVOKE ALL ON SCHEMA public FROM {}").format(
                    sql.Identifier(role)
                )
            )
            cursor.execute(
                sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(
                    sql.Identifier(role)
                )
            )
            cursor.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(connection.info.dbname), sql.Identifier(role)
                )
            )
            privileges = (
                {table: ("SELECT",) for table in READ_TABLES}
                if role == "teruisi_ai_reader"
                else WRITER_PRIVILEGES
            )
            for table, allowed in privileges.items():
                cursor.execute(
                    sql.SQL("GRANT {} ON {} TO {}").format(
                        sql.SQL(",").join(sql.SQL(v) for v in allowed),
                        sql.Identifier(table),
                        sql.Identifier(role),
                    )
                )
            cursor.execute(
                sql.SQL("ALTER ROLE {} SET default_transaction_read_only={}").format(
                    sql.Identifier(role),
                    sql.SQL("on" if role == "teruisi_ai_reader" else "off"),
                )
            )
            cursor.execute(
                sql.SQL("ALTER ROLE {} SET statement_timeout='15000'").format(
                    sql.Identifier(role)
                )
            )
            cursor.execute(
                sql.SQL(
                    "ALTER ROLE {} SET idle_in_transaction_session_timeout='30000'"
                ).format(sql.Identifier(role))
            )
