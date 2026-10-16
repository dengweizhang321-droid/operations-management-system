"""Targeted monitor regression using only an in-memory synthetic database."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def execute():
    import django
    django.setup()
    from django.conf import settings
    settings.DATABASES["default"]["NAME"] = ":memory:"
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    import unittest
    assert connection.vendor == "sqlite" and connection.settings_dict["NAME"] == ":memory:"
    MigrationExecutor(connection).migrate([("inventory", "0015_jd_monitor_preferences")])
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(name) for name in (
        "inventory.tests.test_jd_monitor_preferences",
        "inventory.tests.test_jd_inventory_health",
        "inventory.tests.test_jd_logistics_notifications",
    ))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    if "--execute" in sys.argv:
        execute()
    environment = {key: value for key, value in os.environ.items() if key.upper() in {
        "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE",
        "LOCALAPPDATA", "APPDATA", "PROGRAMFILES",
    }}
    environment.update(PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "backend"),
                       DJANGO_SETTINGS_MODULE="teruisi_backend.settings", DJANGO_DEBUG="true",
                       TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development",
                       TERUISI_DJANGO_SQLITE_PATH=":memory:")
    result = subprocess.run([sys.executable, __file__, "--execute"], cwd=ROOT, env=environment,
                            timeout=120, capture_output=True, encoding="utf-8",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    print(result.stdout, end="")
    print(result.stderr, end="", file=sys.stderr)
    raise SystemExit(result.returncode)
