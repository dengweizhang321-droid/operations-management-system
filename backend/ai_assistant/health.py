import re
from django.conf import settings
from django.db import connection, transaction
from django.http import JsonResponse
from .database_contract import MODELS, READ_TABLES, WRITER_PRIVILEGES
from .control_models import AiDataRevision, AiWriteAuthority, AiMigrationRun
from .table_manifest import AI_TABLES


def check():
    if set(AI_TABLES) != set(MODELS):
        raise ValueError("AI backup inventory drift")
    if connection.vendor != "postgresql":
        raise ValueError("AI runtime requires PostgreSQL")
    writer = settings.DJANGO_PROCESS_ROLE == "ai_writer"
    expected = "teruisi_ai_writer" if writer else "teruisi_ai_reader"
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "SELECT current_user,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user"
        )
        row = cursor.fetchone()
        if not row or row[0] != expected or any(row[1:]):
            raise ValueError("AI database role mismatch")
        cursor.execute("SHOW transaction_read_only")
        if (cursor.fetchone()[0] == "on") == writer:
            raise ValueError("AI read/write connection mismatch")
        cursor.execute(
            "SELECT has_schema_privilege(current_user,'public','CREATE'),has_database_privilege(current_user,current_database(),'CREATE')"
        )
        if any(cursor.fetchone()):
            raise ValueError("AI runtime retains DDL privileges")
        cursor.execute(
            "SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)"
        )
        if cursor.fetchone():
            raise ValueError("AI runtime role membership is not empty")
        allowed = (
            WRITER_PRIVILEGES
            if writer
            else {table: ("SELECT",) for table in READ_TABLES}
        )
        cursor.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
        )
        for (table,) in cursor.fetchall():
            for privilege in [
                "SELECT",
                "INSERT",
                "UPDATE",
                "DELETE",
                "TRUNCATE",
                "REFERENCES",
                "TRIGGER",
            ]:
                cursor.execute(
                    "SELECT has_table_privilege(current_user,%s,%s)",
                    ("public." + table, privilege),
                )
                if cursor.fetchone()[0] != (privilege in allowed.get(table, ())):
                    raise ValueError(
                        "AI table privileges differ from the closed contract"
                    )
        for table, model in MODELS.items():
            cursor.execute(
                "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=%s AND a.attnum>0 AND NOT a.attisdropped",
                (table,),
            )
            if {r[0] for r in cursor.fetchall()} != {
                f.column for f in model._meta.local_concrete_fields
            }:
                raise ValueError("AI schema mismatch")
        cursor.execute(
            "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'ai_%'"
        )
        indexes = {row[0] for row in cursor.fetchall()}
        required = {
            index.name for model in MODELS.values() for index in model._meta.indexes
        } | {
            "ai_memory_active_key_uq",
            "ai_default_text_model_uq",
            "ai_space_default_scene_uq",
        }
        if not required <= indexes:
            raise ValueError("AI indexes incomplete")
        import importlib

        fencing = importlib.import_module(
            "ai_assistant.migrations.0003_runtime_fencing"
        )
        required_triggers = (
            {(table, "ai_write_fence") for table in fencing.TABLES}
            | {(table, "ai_immutable_evidence") for table in fencing.APPEND_ONLY}
            | {(table, "ai_immutable_identity") for table in fencing.IDENTITIES}
            | {("ai_memory_entries", "ai_memory_requires_audit")}
            | {
                ("ai_space_asset_payloads", "ai_write_fence"),
                ("ai_space_asset_payloads", "ai_immutable_evidence"),
                ("ai_space_asset_payloads", "ai_asset_payload_complete"),
                ("ai_space_assets", "ai_asset_payload_complete"),
            }
            | {
                (table, "ai_terminal_control")
                for table in (
                    "ai_write_authority",
                    "ai_data_revisions",
                    "ai_migration_runs",
                )
            }
        )
        cursor.execute(
            "SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname LIKE 'ai_%'"
        )
        triggers = {
            (table, trigger)
            for table, trigger, enabled in cursor.fetchall()
            if enabled == "O"
        }
        if not required_triggers <= triggers:
            raise ValueError("AI write fences or immutable audit guards missing")
        cursor.execute("SELECT convalidated FROM pg_constraint WHERE conrelid='public.ai_space_asset_payloads'::regclass AND conname='ai_payload_size'")
        if cursor.fetchone() != (True,):
            raise ValueError("AI image payload size constraint missing")
        authority = AiWriteAuthority.objects.get(id=1)
        revision = AiDataRevision.objects.get(domain="ai-assistant")
        if (
            authority.status != "postgres"
            or str(authority.authority_epoch) != settings.AI_WRITE_AUTHORITY_EPOCH
            or authority.cutover_id != settings.AI_WRITE_CUTOVER_ID
            or revision.revision < 1
            or not re.fullmatch("[a-f0-9]{64}", revision.source_digest)
        ):
            raise ValueError("AI authority or revision invalid")
        adopted = AiMigrationRun.objects.get(
            id=authority.migration_verify_run_id, mode="apply", status="verified"
        )
        if (
            adopted.source_snapshot_digest != revision.source_digest
            or adopted.target_snapshot_digest != revision.source_digest
            or adopted.source_counts != adopted.target_counts
        ):
            raise ValueError("AI adoption evidence invalid")
    return {
        "status": "ready",
        "service": "teruisi-django",
        "database": "ready",
        "domain": "ai-assistant",
        "authority": "postgres",
        "processRole": settings.DJANGO_PROCESS_ROLE,
        "revision": str(revision.revision),
        "cutoverId": authority.cutover_id,
    }


def ready():
    try:
        return JsonResponse(check(), headers={"Cache-Control": "no-store"})
    except Exception:
        return JsonResponse(
            {"status": "not_ready", "code": "ai_service_unavailable"},
            status=503,
            headers={"Cache-Control": "no-store"},
        )
