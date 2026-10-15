"""Explicit RAM-only targeted replenishment rehearsal; never starts a service."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]


def execute():
    import django
    django.setup()
    from django.conf import settings
    settings.DATABASES["default"]["NAME"] = ":memory:"
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    import unittest
    assert connection.vendor == "sqlite" and connection.settings_dict["NAME"] == ":memory:"
    old = [("inventory", "0013_jd_logistics_notifications")]
    new = [("inventory", "0014_jd_logistics_replenishment_cycle")]
    executor = MigrationExecutor(connection)
    executor.migrate(old)
    old_apps = executor.loader.project_state(old).apps
    Department = old_apps.get_model("inventory", "JdLogisticsDepartment")
    Mapping = old_apps.get_model("inventory", "JdLogisticsProductMapping")
    Manual = old_apps.get_model("inventory", "JdLogisticsTransferManual")
    Department.objects.create(id="legacy-cycle", name="结构验证合成部门", business_unit_code="LEGACY-CYCLE", updated_by="ram-fixture")
    Mapping.objects.create(id="mapping-fixture", department_id="legacy-cycle", goods_code="FIXTURE", erp_goods_code="ERP-FIXTURE", erp_goods_name="人工映射保留", updated_by="ram-fixture")
    Manual.objects.create(id="manual-fixture", department_id="legacy-cycle", document_no="FIXTURE-DOC", goods_code="FIXTURE", transfer_status="completed", flow_revision="0" * 64, updated_by="ram-fixture")
    executor = MigrationExecutor(connection)
    executor.migrate(new)
    from inventory.jd_logistics_models import JdLogisticsDepartment, JdLogisticsProductMapping, JdLogisticsTransferManual
    assert JdLogisticsDepartment.objects.get(id="legacy-cycle").replenishment_cycle_days == 30
    assert JdLogisticsDepartment.objects.count() == 1
    assert JdLogisticsProductMapping.objects.get().erp_goods_name == "人工映射保留"
    assert JdLogisticsTransferManual.objects.get().transfer_status == "completed"
    executor = MigrationExecutor(connection)
    executor.migrate(old)
    assert Department.objects.count() == 1 and Mapping.objects.get().erp_goods_code == "ERP-FIXTURE"
    assert Manual.objects.get().transfer_status == "completed"
    executor = MigrationExecutor(connection)
    executor.migrate(new)
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromName("inventory.tests.test_jd_logistics_replenishment"))
    evidence = {"tests": result.testsRun, "success": result.wasSuccessful(), "database": ":memory:", "newMigrationForwardReverse": True, "oldDepartmentsPreserved": True, "oldManualMappingAndStatePreserved": True, "newBusinessRowsSeeded": 0, "oldSuiteReplayed": False, "servicesStarted": 0, "externalMessagesSent": 0, "productionTouched": False}
    print(json.dumps(evidence))
    if not result.wasSuccessful():
        raise RuntimeError("Targeted replenishment RAM tests failed")


def main():
    if "--execute" in sys.argv:
        return execute()
    folder = ROOT / ".runtime"
    folder.mkdir(exist_ok=True)
    log = folder / ("jd-replenishment-ram-" + str(time.time_ns()) + ".log")
    environment = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
    environment.update(PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "backend"), DJANGO_SETTINGS_MODULE="teruisi_backend.settings", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_SQLITE_PATH=":memory:", DJANGO_DEBUG="true")
    started = time.monotonic()
    with log.open("w", encoding="utf-8") as output:
        process = subprocess.run([sys.executable, str(Path(__file__)), "--execute"], env=environment, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, timeout=120, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    print(json.dumps({"log": str(log), "exitCode": process.returncode, "seconds": round(time.monotonic() - started, 3), "database": ":memory:", "servicesStarted": 0, "productionTouched": False}))
    raise SystemExit(process.returncode)


if __name__ == "__main__":
    main()
