"""Explicit private PostgreSQL rehearsal. No production settings or credentials.

Run with the installed Django Python from the repository root. Every child gets
an allowlisted environment and a newly generated loopback-only cluster.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
BIN = Path("D:/teruisi-runtime/django-sales/postgresql-17.11/bin")


def verify_stockout_v2():
    import django
    django.setup()
    import unittest
    from django.core.management import call_command
    from django.db import connection
    if connection.settings_dict["NAME"] != "jd_logistics_fixture" or connection.settings_dict["HOST"] != "127.0.0.1" or connection.settings_dict["PORT"] == "5432":
        raise RuntimeError("Refusing non-fixture database")
    # Fresh isolated schema is necessary; old migration/role/concurrency proofs
    # remain valid and are intentionally not replayed for this business delta.
    call_command("migrate", "inventory", "0013", verbosity=0, interactive=False)
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromName("inventory.tests.test_jd_logistics_stockout_v2"))
    if not result.wasSuccessful():
        raise RuntimeError("Stockout v2 targeted business delta failed")
    print(json.dumps({"stockoutV2Tests": result.testsRun, "oldSuiteReplayed": False, "priorMigrationRoleConcurrencyProofsReused": True, "realExternalMessagesSent": 0, "productionTouched": False}))


def verify():
    import django
    django.setup()
    from concurrent.futures import ThreadPoolExecutor
    import threading
    import unittest
    from django.core.management import call_command
    from django.db import connection, connections, DatabaseError
    from django.utils import timezone
    from inventory import jd_logistics as service
    from inventory.jd_logistics_models import JdLogisticsAudit, JdLogisticsBatch, JdLogisticsDepartment, JdLogisticsFact, JdLogisticsProductMapping, JdLogisticsScope, JdLogisticsTransferManual, JdLogisticsDelivery
    from inventory.models import InventoryWriteAuthority
    from inventory.tests.test_jd_logistics import ACTOR, flow, payload
    from teruisi_backend.health import INVENTORY_WRITER_TABLE_PRIVILEGES
    if connection.settings_dict["NAME"] != "jd_logistics_fixture" or connection.settings_dict["HOST"] != "127.0.0.1" or connection.settings_dict["PORT"] == "5432":
        raise RuntimeError("Refusing non-fixture database")
    call_command("migrate", "inventory", "0011", verbosity=0, interactive=False)
    old_tables = set(connection.introspection.table_names())
    call_command("migrate", "inventory", "0013", verbosity=0, interactive=False)
    models = (JdLogisticsDepartment, JdLogisticsScope, JdLogisticsBatch, JdLogisticsFact, JdLogisticsProductMapping, JdLogisticsTransferManual, JdLogisticsAudit, JdLogisticsDelivery)
    assert all(model.objects.count() == 0 for model in models), "Migration must not seed business data"
    call_command("migrate", "inventory", "0011", verbosity=0, interactive=False)
    assert set(connection.introspection.table_names()) == old_tables
    call_command("migrate", "inventory", "0013", verbosity=0, interactive=False)
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromNames(["inventory.tests.test_jd_logistics", "inventory.tests.test_jd_logistics_notifications"]))
    if not result.wasSuccessful():
        raise RuntimeError("Targeted PostgreSQL contracts failed")
    InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=__import__("uuid").uuid4(), cutover_id="pg-fixture", migration_verify_run_id="pg-fixture", activated_at=timezone.now())
    service.mutate({"operation": "settings", "departmentId": "dept-one", "name": "Concurrent synthetic", "businessUnitCode": "BU-01", "expectedRevision": 0}, ACTOR)
    barrier = threading.Barrier(2)
    def compete(code):
        connections.close_all()
        barrier.wait(timeout=10)
        try:
            return service.import_payload(payload([flow(code)]), ACTOR)["status"]
        except service.InventoryApiError as error:
            return error.code
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = sorted(pool.map(compete, ("race-a", "race-b")))
    assert outcomes == ["imported", "version_conflict"], outcomes
    assert JdLogisticsFact.objects.count() == 1
    assert JdLogisticsScope.objects.get().revision == 1
    assert JdLogisticsScope.objects.get().owner_token == ""
    reader_tables = [model._meta.db_table for model in models if model is not JdLogisticsAudit]
    with connection.cursor() as cursor:
        cursor.execute("CREATE ROLE jdl_fixture_reader NOLOGIN")
        cursor.execute("CREATE ROLE jdl_fixture_writer NOLOGIN")
        cursor.execute("GRANT USAGE ON SCHEMA public TO jdl_fixture_reader,jdl_fixture_writer")
        for table in reader_tables + ["inventory_data_revisions"]:
            cursor.execute(f'GRANT SELECT ON "{table}" TO jdl_fixture_reader')
        for table, privileges in INVENTORY_WRITER_TABLE_PRIVILEGES.items():
            if table.startswith("inventory_jd_logistics_") or table in {"inventory_write_authority", "inventory_data_revisions"}:
                cursor.execute(f'GRANT {",".join(privileges)} ON "{table}" TO jdl_fixture_writer')
        cursor.execute("GRANT UPDATE(updated_at) ON inventory_write_authority TO jdl_fixture_writer")
    def forbidden(role, sql):
        with connection.cursor() as cursor:
            cursor.execute("SET ROLE " + role)
            try:
                try:
                    cursor.execute(sql)
                except DatabaseError:
                    return
                raise AssertionError("Unexpected database privilege: " + role)
            finally:
                cursor.execute("RESET ROLE")
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE jdl_fixture_reader")
        assert service.read("flows", {"page": 1, "pageSize": 50})["total"] == 1
        cursor.execute("SELECT has_any_column_privilege(current_user,'inventory_write_authority','UPDATE')")
        reader_authority_update = bool(cursor.fetchone()[0])
        assert reader_authority_update is False
        cursor.execute("RESET ROLE")
    forbidden("jdl_fixture_reader", "SELECT * FROM inventory_jd_logistics_audits")
    forbidden("jdl_fixture_reader", "DELETE FROM inventory_jd_logistics_facts")
    forbidden("jdl_fixture_writer", "UPDATE inventory_jd_logistics_facts SET goods_code='denied'")
    forbidden("jdl_fixture_writer", "DELETE FROM inventory_jd_logistics_audits")
    forbidden("jdl_fixture_writer", "DELETE FROM inventory_jd_logistics_deliveries")
    forbidden("jdl_fixture_reader", "UPDATE inventory_write_authority SET updated_at=updated_at WHERE id=1")
    for critical in ("status", "authority_epoch", "cutover_id", "migration_verify_run_id", "activated_at"):
        forbidden("jdl_fixture_writer", f'UPDATE inventory_write_authority SET "{critical}"="{critical}" WHERE id=1')
    goods = JdLogisticsFact.objects.get().goods_code
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE jdl_fixture_writer")
        mapped = service.mutate({"operation": "mapping", "departmentId": "dept-one", "goodsCode": goods, "erpGoodsCode": "PG-ERP", "expectedRevision": 0}, ACTOR)
        assert mapped["erpGoodsCode"] == "PG-ERP"
        cursor.execute("RESET ROLE")
    # Synthetic notification concurrency: prove sending is visible through a
    # separate DB connection before the fake external boundary is invoked.
    from unittest.mock import patch
    from inventory import jd_logistics_notifications as notifications
    from inventory.tests.test_jd_logistics_notifications import seed_department, FakeGateway, ENABLED
    seed_department("notify-race", "NOTIFY-RACE")
    notification_barrier = threading.Barrier(2)
    visible_states = []
    def preflight_barrier(attempt):
        if attempt <= 2:
            notification_barrier.wait(timeout=10)
    def committed_sending():
        probe = connections["default"].copy(alias="notify-proof")
        try:
            with probe.cursor() as cursor:
                cursor.execute("SELECT status FROM inventory_jd_logistics_deliveries")
                visible_states.extend(row[0] for row in cursor.fetchall())
        finally:
            probe.close()
    gateway = FakeGateway(on_preflight=preflight_barrier, on_send=committed_sending)
    def race_notify(_index):
        connections.close_all()
        try:
            return notifications.notify({"operation": "notify", "departmentIds": ["notify-race"]}, ACTOR, gateway=gateway)["status"]
        finally:
            connections.close_all()
    with patch.object(notifications, "notification_policy", return_value=ENABLED):
        with ThreadPoolExecutor(max_workers=2) as pool:
            delivery_outcomes = sorted(pool.map(race_notify, (1, 2)))
        assert "sent" in delivery_outcomes and all(status in {"duplicate", "sent", "unknown"} for status in delivery_outcomes) and delivery_outcomes.count("sent") == 1, delivery_outcomes
        assert visible_states == ["sending"], visible_states
        assert len(gateway.sends) == 1
        JdLogisticsDelivery.objects.update(status="unknown", receipt_hash="")
        blocked = FakeGateway()
        result_unknown = notifications.notify({"operation": "notify", "departmentIds": ["notify-race"]}, ACTOR, gateway=blocked)
        assert result_unknown["status"] == "unknown" and not blocked.sends
        seed_department("notify-authority", "NOTIFY-AUTHORITY")
        authority_blocks = []
        def attempt_authority_transition(attempt):
            if attempt == 2:
                probe = connections["default"].copy(alias="notify-authority-proof")
                try:
                    with probe.cursor() as cursor:
                        cursor.execute("SET lock_timeout='150ms'")
                        try:
                            cursor.execute("UPDATE inventory_write_authority SET status='d1',authority_epoch=NULL,cutover_id='',migration_verify_run_id='',activated_at=NULL WHERE id=1")
                        except DatabaseError as error:
                            authority_blocks.append(getattr(error.__cause__, "sqlstate", ""))
                finally:
                    probe.close()
        authority_gateway = FakeGateway(on_preflight=attempt_authority_transition)
        authority_result = notifications.notify({"operation": "notify", "departmentIds": ["notify-authority"]}, ACTOR, gateway=authority_gateway)
        assert authority_blocks == ["55P03"], authority_blocks
        assert authority_result["status"] == "sent" and len(authority_gateway.sends) == 1
        assert InventoryWriteAuthority.objects.get(id=1).status == "postgres"
        seed_department("notify-real-writer", "NOTIFY-REAL-WRITER")
        writer_gateway = FakeGateway()
        authority = InventoryWriteAuthority.objects.get(id=1)
        from django.test import override_settings
        from teruisi_backend.health import _validate_inventory_notification_authority_permissions, ReadinessError
        with connection.cursor() as cursor:
            cursor.execute("SET ROLE jdl_fixture_writer")
            try:
                cursor.execute("SELECT has_table_privilege(current_user,'inventory_write_authority','UPDATE')")
                writer_table_update = bool(cursor.fetchone()[0])
                cursor.execute("SELECT attname FROM pg_attribute WHERE attrelid='inventory_write_authority'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege(current_user,attrelid,attname,'UPDATE') ORDER BY attname")
                writer_authority_columns = [row[0] for row in cursor.fetchall()]
                assert writer_table_update is False and writer_authority_columns == ["updated_at"]
                _validate_inventory_notification_authority_permissions(cursor)
                with override_settings(DJANGO_PROCESS_ROLE="inventory_writer", INVENTORY_WRITE_AUTHORITY_EPOCH=str(authority.authority_epoch), INVENTORY_WRITE_CUTOVER_ID=authority.cutover_id):
                    writer_result = notifications.notify({"operation": "notify", "departmentIds": ["notify-real-writer"]}, ACTOR, gateway=writer_gateway)
                assert writer_result["status"] == "sent" and len(writer_gateway.sends) == 1
            finally:
                cursor.execute("RESET ROLE")
            cursor.execute("GRANT UPDATE(status) ON inventory_write_authority TO jdl_fixture_writer")
            cursor.execute("SET ROLE jdl_fixture_writer")
            rejected = False
            try:
                try:
                    _validate_inventory_notification_authority_permissions(cursor)
                except ReadinessError:
                    rejected = True
            finally:
                cursor.execute("RESET ROLE")
                cursor.execute("REVOKE UPDATE(status) ON inventory_write_authority FROM jdl_fixture_writer")
            assert rejected, "Health must reject any critical authority column grant"
    print(json.dumps({"targetedTests": result.testsRun, "migrationForwardReverse": True, "migrationBusinessRowsSeeded": 0, "concurrentResults": outcomes, "oneWinnerOneStale": True, "readerAndWriterPrivilegeProbes": 13, "notificationRace": delivery_outcomes, "notificationExternalStubCalls": len(gateway.sends), "sendingVisibleBeforeExternalStub": visible_states, "authorityTransitionBlocked": authority_blocks, "actualWriterNotification": writer_result["status"], "actualWriterAuthorityUpdateColumns": writer_authority_columns, "authorityTableUpdate": writer_table_update, "readerAuthorityUpdate": reader_authority_update, "criticalColumnGrantRejected": rejected, "realExternalMessagesSent": 0, "productionTouched": False}))


def main():
    if "--verify" in sys.argv:
        return verify()
    if "--verify-stockout-v2" in sys.argv:
        return verify_stockout_v2()
    run_directory = ROOT / ".runtime" / ("jd-logistics-pg-" + secrets.token_hex(8))
    run_directory.mkdir(parents=True, exist_ok=False)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    if port == 5432:
        raise RuntimeError("Refusing production port")
    password = secrets.token_hex(40)
    password_file = run_directory / "password.txt"
    password_file.write_text(password, encoding="ascii")
    allowed = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    environment.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "backend"), DJANGO_SETTINGS_MODULE="teruisi_backend.settings", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true", TERUISI_DJANGO_DATABASE_URL=f"postgresql://jd_fixture:{password}@127.0.0.1:{port}/jd_logistics_fixture")
    steps = []
    def run(arguments, label, timeout=300):
        started = time.monotonic()
        with (run_directory / (label + ".log")).open("x", encoding="utf-8") as output:
            result = subprocess.run([str(value) for value in arguments], cwd=ROOT, env=environment, stdout=output, stderr=subprocess.STDOUT, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
        steps.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic() - started, 3)})
        if result.returncode:
            raise RuntimeError(label + " failed; see retained fixture log")
    started = stopped = False
    try:
        run([BIN / "initdb.exe", "-D", run_directory / "data", "-U", "jd_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "initdb", 60)
        password_file.unlink()
        with (run_directory / "data/postgresql.conf").open("a", encoding="utf-8") as configuration:
            configuration.write(f"\nport={port}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
        run([BIN / "pg_ctl.exe", "-D", run_directory / "data", "-l", run_directory / "postgres.log", "-w", "-t", "30", "start"], "start", 45)
        started = True
        run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", port, "-U", "jd_fixture", "jd_logistics_fixture"], "database", 30)
        delta = "--stockout-v2" in sys.argv
        run([sys.executable, Path(__file__), "--verify-stockout-v2" if delta else "--verify"], "verify-stockout-v2" if delta else "verify", 300)
    finally:
        if password_file.exists():
            password_file.unlink()
        if started:
            run([BIN / "pg_ctl.exe", "-D", run_directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", 45)
            stopped = True
        evidence = {"productionTouched": False, "started": started, "stopped": stopped, "port": port, "steps": steps}
        (run_directory / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(json.dumps({"evidence": str(run_directory / "evidence.json"), **evidence}, ensure_ascii=True))


if __name__ == "__main__":
    main()
