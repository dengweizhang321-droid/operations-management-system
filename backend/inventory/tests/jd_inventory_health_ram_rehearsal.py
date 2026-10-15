"""RAM-only health delta runner; no old suite, services, or external calls."""
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
    MigrationExecutor(connection).migrate([("inventory", "0014_jd_logistics_replenishment_cycle")])
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName("inventory.tests.test_jd_inventory_health"))
    print(json.dumps({"tests": result.testsRun, "success": result.wasSuccessful(), "database": ":memory:", "newMigration": False, "oldSuitesReplayed": False, "servicesStarted": 0, "externalMessagesSent": 0, "productionTouched": False}))
    if not result.wasSuccessful():
        raise RuntimeError("Targeted inventory health RAM tests failed")


def main():
    if "--execute" in sys.argv:
        return execute()
    folder = ROOT / ".runtime"
    folder.mkdir(exist_ok=True)
    log = folder / ("jd-inventory-health-ram-" + str(time.time_ns()) + ".log")
    environment = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
    environment.update(PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "backend"), DJANGO_SETTINGS_MODULE="teruisi_backend.settings", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_SQLITE_PATH=":memory:", DJANGO_DEBUG="true")
    started = time.monotonic()
    with log.open("w", encoding="utf-8") as output:
        process = subprocess.run([sys.executable, str(Path(__file__)), "--execute"], env=environment, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, timeout=120, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    print(json.dumps({"log": str(log), "exitCode": process.returncode, "seconds": round(time.monotonic() - started, 3), "database": ":memory:", "servicesStarted": 0, "productionTouched": False}))
    raise SystemExit(process.returncode)


if __name__ == "__main__":
    main()
