"""Run focused contracts against exact copied owner bytes; deny all live I/O."""
import os
import sys
import socket
import sqlite3
from urllib.parse import unquote
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

root = Path(sys.argv[1]).resolve()
expected = Path(__file__).resolve().parents[3] / ".runtime" / "owner-acceptance"
if root != expected.resolve():
    raise RuntimeError("Exact private owner-acceptance root required")
source = root / "backend"
for name in tuple(os.environ):
    if name.startswith(("TERUISI_", "PG", "DJANGO_")) or name in ("DATABASE_URL", "PYTHONPATH"):
        os.environ.pop(name, None)
os.environ.update({"DJANGO_SETTINGS_MODULE": "teruisi_backend.settings", "TERUISI_DJANGO_ENVIRONMENT": "development",
                   "TERUISI_DJANGO_SQLITE_PATH": str(root / "fixture.sqlite3"), "PYTHONDONTWRITEBYTECODE": "1"})
private_temp = root / "temp"
private_temp.mkdir(exist_ok=True)
os.environ.update({"TMPDIR": str(private_temp), "TEMP": str(private_temp), "TMP": str(private_temp)})
import tempfile
tempfile.tempdir = str(private_temp)
os.chdir(root)
sys.path.insert(0, str(source))
sys.dont_write_bytecode = True
from isolation_guards import install, fixture_argv
install(root, Path(__file__).resolve())
if len(sys.argv) > 2 and sys.argv[2] == "--fixture-tool":
    import runpy
    tool = Path(sys.argv[3]).resolve()
    if tool.parent != root / "tools": raise RuntimeError("Child tool escaped owned root")
    fixture_argv([sys.executable, *sys.argv[3:]], root, {Path(sys.executable).resolve()})
    sys.argv = [str(tool), *sys.argv[4:]]
    runpy.run_path(str(tool), run_name="__main__")
    sys.exit(0)
import django
django.setup()
from django.conf import settings
if settings.DATABASES["default"]["ENGINE"] != "django.db.backends.sqlite3":
    raise RuntimeError("Owner contract tests require isolated SQLite")
from django.core.management import call_command
call_command("test", "access_control.tests.test_policy", "access_control.tests.test_api", "access_control.tests.test_migration",
             "customer_service.tests.test_api", "customer_service.tests.test_migration", "customer_service.tests.test_retirement",
             verbosity=1, interactive=False)
