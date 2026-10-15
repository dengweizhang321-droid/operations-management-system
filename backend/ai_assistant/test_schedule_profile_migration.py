"""Upgrade real 0082 schedule rows in a separate synthetic PostgreSQL database."""
import copy
import secrets
import uuid
from datetime import datetime, timezone

from django.db import connection, connections, DatabaseError
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase


class ScheduleProfileMigrationTests(SimpleTestCase):
    databases = "__all__"

    def test_forward_upgrade_preserves_old_tasks_slots_and_exact_role_grants(self):
        if connection.vendor != "postgresql":
            self.skipTest("requires isolated PostgreSQL")
        cfg = connection.settings_dict
        if (cfg["HOST"] != "127.0.0.1" or not 55440 <= int(cfg["PORT"]) <= 55999
                or "teruisi_ai_rehearsal" not in cfg["NAME"]):
            self.fail("migration proof only accepts the synthetic rehearsal cluster")
        from psycopg import sql
        alias = "schedule_upgrade_" + uuid.uuid4().hex
        params = connection.get_connection_params()
        params["dbname"] = "postgres"
        admin = connection.Database.connect(**params, autocommit=True)
        db = None
        original_databases = type(self).databases
        try:
            admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(alias)))
            connections.databases[alias] = {**copy.deepcopy(cfg), "NAME": alias}
            type(self).databases = set(original_databases) | {alias}
            db = connections[alias]
            executor = MigrationExecutor(db)
            targets = [node for node in executor.loader.graph.leaf_nodes() if node[0] != "ai_assistant"] + [("ai_assistant", "0082_no_new_keys_profile")]
            executor.migrate(targets)
            old_apps = executor.loader.project_state(targets).apps
            task = old_apps.get_model("ai_assistant", "AiDingTalkSchedule").objects.using(alias).create(
                id="old-task", name="旧任务", prompt="合成任务", cadence="daily", hour=9, minute=0,
                target_type="person", target_id="fixture", sender_id="fixture", owner_email="fixture@example.invalid", enabled=True)
            old_apps.get_model("ai_assistant", "AiDingTalkScheduleRun").objects.using(alias).create(
                id="old-slot", schedule_id=task.id, schedule_version=1,
                scheduled_at=datetime(2026, 10, 14, 1, tzinfo=timezone.utc), status="unknown", error_code="delivery_unknown")
            latest = [("ai_assistant", "0083_schedule_execution_profile")]
            executor = MigrationExecutor(db)
            executor.migrate(latest)
            # An already applied forward migration is a no-op, not a row reset.
            MigrationExecutor(db).migrate(latest)
            with db.cursor() as cursor:
                cursor.execute("SELECT model_id,execution_mode,version,enabled FROM ai_dingtalk_schedules WHERE id='old-task'")
                self.assertEqual(cursor.fetchone(), ("", "open_analysis", 1, True))
                cursor.execute("SELECT status,error_code,facts_json,content_text FROM ai_dingtalk_schedule_runs WHERE id='old-slot'")
                self.assertEqual(cursor.fetchone(), ("unknown", "delivery_unknown", "{}", ""))
                cursor.execute("SELECT conname FROM pg_constraint WHERE conrelid='ai_dingtalk_schedule_runs'::regclass")
                self.assertTrue({"ai_schedule_data_status", "ai_schedule_analysis_status", "ai_schedule_delivery_status", "ai_schedule_artifacts_bound"} <= {row[0] for row in cursor.fetchall()})
            from .database_contract import provision
            db.ensure_connection()
            provision(db.connection, secrets.token_hex(32), secrets.token_hex(32))
            with db.cursor() as cursor:
                cursor.execute("SET ROLE teruisi_ai_reader")
                cursor.execute("SELECT model_id,execution_mode FROM ai_dingtalk_schedules LIMIT 1")
                cursor.execute("SELECT data_status,analysis_status,delivery_status,facts_json,model_snapshot_json,content_text,stage_details_json FROM ai_dingtalk_schedule_runs LIMIT 1")
                with self.assertRaises(DatabaseError):
                    cursor.execute("UPDATE ai_dingtalk_schedule_runs SET delivery_status='succeeded' WHERE false")
                cursor.execute("RESET ROLE")
                cursor.execute("SET ROLE teruisi_ai_writer")
                cursor.execute("SELECT stage_details_json FROM ai_dingtalk_schedule_runs LIMIT 1")
                with self.assertRaises(DatabaseError):
                    cursor.execute("DELETE FROM inventory_stock_lines WHERE false")
                cursor.execute("RESET ROLE")
                with self.assertRaises(DatabaseError):
                    cursor.execute("UPDATE ai_dingtalk_schedule_runs SET delivery_status='invalid' WHERE id='old-slot'")
                cursor.execute("SELECT status,error_code FROM ai_dingtalk_schedule_runs WHERE id='old-slot'")
                self.assertEqual(cursor.fetchone(), ("unknown", "delivery_unknown"))
        finally:
            if db is not None:
                db.close()
                del connections[alias]
                connections.databases.pop(alias, None)
            # The only drop target is the unique database created above, on the
            # isolated loopback port already checked before opening admin.
            admin.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(alias)))
            admin.close()
            type(self).databases = original_databases
