"""Synthetic 142/143 migration and independent dump/restore proof."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import tempfile
from unittest.mock import patch

import psycopg
from psycopg import sql
import ai_schedule_addition as addition
import ai_schedule_addition_catalog as catalog
import bi_app_addition as common
import postgres_no_key_backup as backup
from ai_schedule_addition_rehearsal import command


def reject(operation, label):
    try:
        operation()
    except (ValueError, RuntimeError, psycopg.Error):
        return
    raise RuntimeError("Negative schedule check unexpectedly accepted: " + label)


def restore_point(generation, directory, binary):
    port = int(os.environ["PGPORT"])
    source_parameters = dict(host="127.0.0.1", port=port, user=os.environ["PGUSER"],
                             password=os.environ["PGPASSWORD"], dbname="teruisi_ai_rehearsal")
    archive = directory / f"generation-{generation}.dump"
    with psycopg.connect(**source_parameters) as source:
        source.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        with source.cursor() as cursor:
            if backup.verify_receipt_generation(cursor) != generation:
                raise RuntimeError("Source schedule generation differs")
        expected = backup.collect(source)
        evidence = {"migrations": [{"app": app, "name": name} for app, name in source.execute("SELECT app,name FROM django_migrations ORDER BY app,name")],
                    "tables": {"django_migrations": generation}}
        payload = directory / f"maintenance-evidence-{generation}.json"
        payload.write_text(json.dumps({"evidence": evidence, "profileEvidence": expected}, default=str), encoding="utf8")
        for shell in ("powershell.exe", "pwsh.exe"):
            command([shell, "-NoProfile", "-NonInteractive", "-File", Path(__file__).resolve().parents[1] / "tests/ai-schedule-no-key-evidence.test.ps1",
                "-OperatorPath", Path(__file__).resolve().parents[1] / "tools/django-postgres-maintenance.ps1", "-PayloadPath", payload,
                "-ExpectedPort", str(port)], f"ps-evidence-{generation}-{shell}", os.environ.copy(), directory)
        snapshot = source.execute("SELECT pg_export_snapshot()").fetchone()[0]
        command([binary / "pg_dump.exe", "--format=custom", "--file", archive, "--snapshot", snapshot,
                 "--dbname", "teruisi_ai_rehearsal"], f"dump-{generation}", os.environ.copy(), directory)
    restore_directory = Path(tempfile.mkdtemp(prefix=f"restore-{generation}-", dir=directory))
    restore_port = None
    for candidate in range(55950, 55960):
        try:
            with socket.socket() as probe: probe.bind(("127.0.0.1", candidate))
            restore_port = candidate
            break
        except OSError:
            pass
    if restore_port is None:
        raise RuntimeError("No independent schedule restore port")
    password = secrets.token_hex(32)
    password_file = restore_directory / "password"
    password_file.write_text(password, encoding="ascii")
    environment = {**os.environ, "PGPORT": str(restore_port), "PGPASSWORD": password, "PGDATABASE": "postgres"}
    started = False
    try:
        command([binary / "initdb.exe", "-D", restore_directory / "data", "-U", os.environ["PGUSER"],
            "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", password_file], f"restore-init-{generation}", environment, directory)
        with (restore_directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={restore_port}\nmax_connections=30\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([binary / "pg_ctl.exe", "-D", restore_directory / "data", "-l", restore_directory / "postgres.log", "-w", "-t", "30", "start"], f"restore-start-{generation}", environment, directory)
        started = True
        parameters = {**source_parameters, "port": restore_port, "password": password, "dbname": "postgres"}
        with psycopg.connect(**parameters, autocommit=True) as admin:
            backup.provision_restore_roles(admin, expected["roles"], expected_database="teruisi_ai_rehearsal", expected_port=restore_port)
            admin.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier("teruisi_ai_rehearsal"), sql.Identifier(os.environ["PGUSER"])))
            backup.apply_restore_role_settings(admin, expected["roles"], "teruisi_ai_rehearsal")
        environment["PGDATABASE"] = "teruisi_ai_rehearsal"
        command([binary / "pg_restore.exe", "--exit-on-error", "--dbname", "teruisi_ai_rehearsal", archive], f"restore-data-{generation}", environment, directory)
        parameters["dbname"] = "teruisi_ai_rehearsal"
        with psycopg.connect(**parameters) as restored:
            with restored.cursor() as cursor:
                if backup.verify_receipt_generation(cursor) != generation:
                    raise RuntimeError("Restored AI schedule generation differs")
            actual = backup.collect(restored)
            backup.verify_restored(expected, actual)
            changed = json.loads(json.dumps(actual))
            changed["tables"]["ai_dingtalk_schedules"]["rows"] += 1
            changed["contentSha256"] = backup.digest({key: changed[key] for key in ("profile", "roles", "tables", "catalog")})
            reject(lambda: backup.verify_restored(expected, changed), "restored rows")
            reject(lambda: _reject_key_claim(actual), "private key archive claim")
        return {"generation": generation, "sourcePort": port, "restorePort": restore_port,
            "contentSha256": expected["contentSha256"], "dumpSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "roleAclAndCatalogueVerified": True, "productionTouched": False}
    finally:
        if started:
            command([binary / "pg_ctl.exe", "-D", restore_directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], f"restore-stop-{generation}", environment, directory)
        password_file.unlink(missing_ok=True)


def _reject_key_claim(actual):
    backup.validate_evidence({**actual, "privateKeyRows": 1})


def rehearse(connection, base, directory, binary):
    from django.db import transaction, DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from ai_assistant.database_contract import provision
    root = Path(__file__).resolve().parents[1]
    code_sha = addition.code_digest(root)
    migration_sha = common.digest(common.migrations(root))
    apps = MigrationExecutor(connection).loader.project_state([("ai_assistant", "0082_no_new_keys_profile")]).apps
    for index in range(2):
        task = apps.get_model("ai_assistant", "AiDingTalkSchedule").objects.create(id=f"old-task-{index}",
            name="synthetic old task", prompt="synthetic prompt", cadence="daily", hour=9, minute=0,
            target_type="person", target_id="synthetic", sender_id="synthetic", owner_email="fixture@example.invalid", enabled=index == 0)
        apps.get_model("ai_assistant", "AiDingTalkScheduleRun").objects.create(id=f"old-slot-{index}", schedule_id=task.id,
            schedule_version=1, scheduled_at=datetime(2026, 10, 14, 1, tzinfo=timezone.utc), status="unknown" if index == 0 else "sent",
            error_code="delivery_unknown" if index == 0 else "")
    connection.ensure_connection()
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        for table in ("ai_dingtalk_schedules", "ai_dingtalk_schedule_runs", "django_migrations"):
            cursor.execute(sql.SQL("ALTER TABLE {} OWNER TO teruisi_sales_owner").format(sql.Identifier(table)))
        cursor.execute("ALTER FUNCTION public.ai_runtime_write_fence() OWNER TO teruisi_sales_owner")
        cursor.execute("ALTER FUNCTION public.ai_immutable_record_guard() OWNER TO teruisi_sales_owner")
    before_rows = catalog.original_rows(connection)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("ALTER ROLE teruisi_ai_budget_v11_key_owner LOGIN")
        reject(lambda: backup.verify_closed_profile(connection.connection, lock=False), "closed-key role login")
        transaction.set_rollback(True)
    before_restore = restore_point(142, directory, binary)
    # Every negative catalogue alteration is rolled back in the private DB.
    table_negatives = ("ALTER TABLE ai_dingtalk_schedules DROP COLUMN name",
        "ALTER TABLE ai_dingtalk_schedules ADD COLUMN extra text",
        "ALTER TABLE ai_dingtalk_schedules DISABLE TRIGGER ai_write_fence",
        "DROP TRIGGER ai_write_fence ON ai_dingtalk_schedule_runs",
        "DROP TRIGGER ai_write_fence ON ai_dingtalk_schedules; CREATE TRIGGER ai_write_fence BEFORE INSERT OR UPDATE OR DELETE ON ai_dingtalk_schedules FOR EACH ROW WHEN (false) EXECUTE FUNCTION ai_runtime_write_fence()",
        "DROP TRIGGER ai_immutable_identity ON ai_dingtalk_schedules; CREATE TRIGGER ai_immutable_identity BEFORE UPDATE OF prompt ON ai_dingtalk_schedules FOR EACH ROW EXECUTE FUNCTION ai_immutable_record_guard('id','owner_email')",
        "GRANT UPDATE ON ai_dingtalk_schedules TO teruisi_ai_reader",
        "GRANT UPDATE(prompt) ON ai_dingtalk_schedules TO teruisi_ai_reader",
        "ALTER TABLE ai_dingtalk_schedules ENABLE ROW LEVEL SECURITY",
        "CREATE POLICY unreviewed ON ai_dingtalk_schedules FOR SELECT USING(true)",
        "UPDATE pg_index SET indisvalid=false WHERE indexrelid='ai_ding_schedule_due'::regclass",
        "DROP INDEX ai_ding_schedule_due",
        "ALTER TABLE ai_dingtalk_schedule_runs DROP CONSTRAINT ai_ding_run_status",
        "ALTER FUNCTION ai_runtime_write_fence() OWNER TO schedule_fixture")
    for statement in (*table_negatives, "ALTER TABLE ai_dingtalk_schedules ADD COLUMN model_id text",
                      "ALTER TABLE ai_dingtalk_schedule_runs ADD CONSTRAINT ai_schedule_unrecorded CHECK(true)",
                      "INSERT INTO django_migrations(app,name,applied) VALUES ('ai_assistant','0083_schedule_execution_profile',now())",
                      "INSERT INTO django_migrations(app,name,applied) VALUES ('ai_assistant','0084_unknown',now())"):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(statement)
                reject(lambda: backup.verify_receipt_generation(cursor), "unrecorded or unknown generation")
            transaction.set_rollback(True)
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
    try:
        try:
            with patch.object(addition, "verify_defaults", side_effect=ValueError("injected post-DDL failure")):
                addition.apply_steps(connection, base, expected_before=before_rows)
        except ValueError as error:
            if str(error) != "injected post-DDL failure":
                raise
        else:
            raise RuntimeError("Injected migration failure did not roll back")
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != base:
            raise RuntimeError("Failed migration retained its receipt")
        if catalog.original_rows(connection) != before_rows:
            raise RuntimeError("Failed migration changed old rows")
        first, after_rows = addition.apply_steps(connection, base, expected_before=before_rows)
        if first != after_rows or after_rows != before_rows:
            raise RuntimeError("Atomic schedule migration changed old data")
        reject(lambda: addition.apply_steps(connection, base), "committed migration replay")
    finally:
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
    with connection.cursor() as cursor:
        catalog.verify_catalog(cursor, installed=True)
        catalog.verify_defaults(cursor)
        cursor.execute("SET ROLE teruisi_ai_reader")
        for table, columns in catalog.COLUMNS.items():
            cursor.execute(sql.SQL("SELECT {} FROM {} LIMIT 1").format(sql.SQL(",").join(map(sql.Identifier, columns)), sql.Identifier(table)))
        try:
            cursor.execute("UPDATE ai_dingtalk_schedule_runs SET data_status='failed' WHERE false")
        except DatabaseError:
            pass
        else:
            raise RuntimeError("AI reader gained writes")
        cursor.execute("RESET ROLE")
        cursor.execute("SET ROLE teruisi_ai_writer")
        cursor.execute("UPDATE ai_dingtalk_schedule_runs SET data_status='pending' WHERE false")
        try:
            cursor.execute("DELETE FROM inventory_stock_lines WHERE false")
        except DatabaseError:
            pass
        else:
            raise RuntimeError("AI writer gained inventory writes")
        cursor.execute("RESET ROLE")
    for statement in (*table_negatives, "ALTER TABLE ai_dingtalk_schedules ALTER model_id DROP NOT NULL",
                      "ALTER TABLE ai_dingtalk_schedules ALTER model_id SET DEFAULT ''",
                      "ALTER TABLE ai_dingtalk_schedule_runs DROP CONSTRAINT ai_schedule_data_status",
                      "ALTER TABLE ai_dingtalk_schedule_runs DROP CONSTRAINT ai_schedule_artifacts_bound",
                      "DELETE FROM django_migrations WHERE app='ai_assistant' AND name='0083_schedule_execution_profile'"):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(statement)
                reject(lambda: backup.verify_receipt_generation(cursor), "143 schema drift")
            transaction.set_rollback(True)
    after_restore = restore_point(143, directory, binary)
    if code_sha != addition.code_digest(root) or migration_sha != common.digest(common.migrations(root)):
        raise RuntimeError("Tested schedule source changed during rehearsal")
    proof = {"version": "ai-schedule-private-postgres-v1", "status": "passed", "productionTouched": False,
        "steps": list(addition.STEPS), "codeSha256": code_sha, "migrationSha256": migration_sha,
        "checks": sorted(addition.CHECKS), "before": before_restore, "after": after_restore,
        "beforeRows": before_rows, "afterRows": after_rows,
        "legacyGenerationTestsSha256": common.sha(directory / "legacy-generation-tests.log")}
    (directory / "schedule-validation.json").write_text(json.dumps(proof, indent=2), encoding="utf8")
    print(json.dumps({"status": "passed", "generations": [142, 143], "independentClusters": True,
                      "productionTouched": False, "validation": str(directory / "schedule-validation.json")}), flush=True)
