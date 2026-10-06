"""Private PostgreSQL BI tests. Never inherits runtime credentials or port5432."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN = ROOT / ".runtime" / ("bi-cockpit-pg-" + secrets.token_hex(10))
RUN.mkdir(parents=True, exist_ok=False)
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0)); port = probe.getsockname()[1]
if port == 5432: raise RuntimeError("Refusing production port")
password = secrets.token_hex(40)
pwfile = RUN / "password.txt"; pwfile.write_text(password, encoding="ascii")
env = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
env.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "tools") + os.pathsep + str(ROOT / "backend"), TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true", TERUISI_BI_PERMISSION_TEST="1", TERUISI_DJANGO_DATABASE_URL=f"postgresql://bi_fixture:{password}@127.0.0.1:{port}/bi_fixture")
steps = []
def run(args, label, timeout=600):
    started = time.monotonic()
    with (RUN / (label + ".log")).open("x", encoding="utf8") as log:
        result = subprocess.run([str(arg) for arg in args], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    steps.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic()-started, 3)})
    if result.returncode: raise RuntimeError(f"{label} failed; see {RUN / (label + '.log')}")
started = stopped = False
try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "bi_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb", 60)
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf8") as config: config.write(f"\nport={port}\nlisten_addresses='127.0.0.1'\nmax_connections=32\nshared_buffers='32MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "start"], "start", 45); started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", port, "-U", "bi_fixture", "bi_fixture"], "database", 30)
    run([sys.executable, "backend/manage.py", "test", "bi.tests.test_api", "bi.tests.test_cockpit", "bi.tests.test_sources", "bi.tests.test_transport", "bi.tests.test_cockpit_permissions", "finance.tests.test_api", "finance.tests.test_erp_targets", "netshop.tests.test_store_overview", "netshop.tests.test_bounded_consumer_http", "--settings=bi_cockpit_test_settings", "--noinput", "--verbosity=2"], "tests")
finally:
    if pwfile.exists(): pwfile.unlink()
    if started:
        run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "stop"], "stop", 45); stopped = True
    (RUN / "evidence.json").write_text(json.dumps({"productionTouched": False, "started": started, "stopped": stopped, "steps": steps}, indent=2), encoding="utf8")
    print(json.dumps({"evidence": str(RUN / "evidence.json"), "stopped": stopped, "steps": steps}, ensure_ascii=True))
