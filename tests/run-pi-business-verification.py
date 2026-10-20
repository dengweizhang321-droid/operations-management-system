"""Run only Pi business acceptance against a disposable database, never runtime config."""
import os
from pathlib import Path
import secrets
import sys
import importlib
import socket
import subprocess
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
# Do not inherit a production connection, authority, callback or bot config.
for key in list(os.environ):
    if key.startswith(("TERUISI_", "DJANGO_", "PI_", "AI_")):
        del os.environ[key]
os.environ.update(TERUISI_DJANGO_ENVIRONMENT="test", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
    TERUISI_DJANGO_SQLITE_PATH=str(ROOT / ".runtime" / "pi-business-test-unused.sqlite3"),
    TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), TERUISI_N8N_STATUS_DATABASE_PATH="")
import django
from django.conf import settings
settings.DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
settings.MIGRATION_MODULES = {name.split(".")[0]: None for name in settings.INSTALLED_APPS if not name.startswith("django.")}
settings.MIGRATION_MODULES["contenttypes"] = None
postgres = "--postgres" in sys.argv
if postgres:
    sys.argv.remove("--postgres")
    # A new cluster under this worktree, on a distinct loopback port. Neither
    # production configuration nor the production cluster is opened.
    binary = Path("D:/teruisi-runtime/django-sales/postgresql-17.11/bin")
    scratch = ROOT / ".runtime"
    scratch.mkdir(exist_ok=True)
    assert not scratch.is_symlink() and not scratch.is_junction()
    assert scratch.resolve().is_relative_to(ROOT.resolve())
    cluster = Path(tempfile.mkdtemp(prefix="pi-business-pg-", dir=scratch))
    assert cluster.resolve().is_relative_to(scratch.resolve())
    sid = subprocess.check_output(["powershell", "-NoProfile", "-Command",
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], creationflags=subprocess.CREATE_NO_WINDOW).decode().strip()
    subprocess.run(["icacls", str(cluster), "/grant", "*"+sid+":(OI)(CI)F"],
        stdout=subprocess.DEVNULL, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    pgdata = cluster / "data"
    port = 55873
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))
    def pg(command, *args):
        # A Windows PostgreSQL child can inherit the parent's pipe handle even
        # after pg_ctl exits. Use a file so waiting never depends on pipe EOF.
        output = cluster / (command + ".log")
        with output.open("wb") as log:
            result = subprocess.run([str(binary / (command + ".exe")), *map(str, args)], stdout=log,
                stderr=subprocess.STDOUT, timeout=45, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise RuntimeError(output.read_text(encoding="utf-8", errors="replace"))
    pg("initdb", "-D", pgdata, "-U", "pi_fixture", "--auth=trust", "--encoding=UTF8", "--no-locale")
    settings.DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "postgres", "USER": "pi_fixture",
        "HOST": "127.0.0.1", "PORT": str(port), "TEST": {"NAME": "pi_business_verification"}}}
from django.test.runner import DiscoverRunner

class BusinessRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        result = super().setup_databases(**kwargs)
        if postgres:
            from django.db import connection
            guard = importlib.import_module("ai_assistant.migrations.0086_pi_business_actions")
            with connection.cursor() as cursor:
                cursor.execute(guard.STATE_GUARD)
                for table in ("ai_pi_business_intents", "ai_pi_business_actions"):
                    cursor.execute(f'CREATE TRIGGER ai_pi_business_state BEFORE INSERT OR UPDATE ON "{table}" FOR EACH ROW EXECUTE FUNCTION ai_pi_business_guard()')
            print("PRIVATE_PG: exact 0086 business state triggers installed; ORM schema, no production ACL or full migration claim", flush=True)
        return result

started = False
try:
    django.setup()
    if postgres:
        started = True
        pg("pg_ctl", "-D", pgdata, "-l", cluster / "postgres.log", "-o", f"-h 127.0.0.1 -p {port}", "-w", "-t", "20", "start")
    runner = BusinessRunner(verbosity=2)
    failures = runner.run_tests(sys.argv[1:] or ["ai_assistant.test_pi_business_verification", "ai_assistant.test_pi_business_boundaries"])
finally:
    if started:
        pg("pg_ctl", "-D", pgdata, "-m", "fast", "-w", "stop")
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError("Private PG port still open after stop")
        print("PRIVATE_PG_STOPPED: private cluster stopped, port closed", flush=True)
raise SystemExit(bool(failures))
