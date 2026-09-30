"""Own synthetic PG instance, dynamic bind, no production connection fallback."""
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
RUN = ROOT / ".runtime" / ("foundation-pg-"+secrets.token_hex(6))
EVIDENCE = Path(r"E:\codex-artifacts\netshop-scheme2-20260930\foundation") / RUN.name
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0)); PORT = probe.getsockname()[1]
if PORT == 5432: raise RuntimeError("Refusing production port")
RUN.mkdir(parents=True); EVIDENCE.mkdir(parents=True)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"; pwfile.write_text(password, encoding="ascii")
env = {k: v for k, v in os.environ.items() if k in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
env.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "tools")+os.pathsep+str(ROOT / "backend"), TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true", TERUISI_DJANGO_DATABASE_URL=f"postgresql://foundation_fixture:{password}@127.0.0.1:{PORT}/foundation_fixture")
results = []
def run(args, label):
    before = time.monotonic()
    with (EVIDENCE/(label+".log")).open("w", encoding="utf-8") as log:
        result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    results.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic()-before, 3)})
    if result.returncode: raise RuntimeError(f"{label} failed ({result.returncode}); see {EVIDENCE}")

started = False
try:
    run([BIN/"initdb.exe", "-D", RUN/"data", "-U", "foundation_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb")
    pwfile.unlink()
    with (RUN/"data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN/"pg_ctl.exe", "-D", RUN/"data", "-l", RUN/"postgres.log", "-w", "-t", "30", "start"], "start"); started = True
    run([BIN/"createdb.exe", "-h", "127.0.0.1", "-p", str(PORT), "-U", "foundation_fixture", "foundation_fixture"], "database")
    labels = sys.argv[1:] or ["netshop.tests.test_insights_common", "netshop.tests.test_store_overview", "netshop.tests.test_query", "netshop.tests.test_api", "netshop.tests.test_consumers", "netshop.tests.test_source_revision_guard"]
    if any(not s.startswith("netshop.tests.test_") for s in labels): raise RuntimeError("Only netshop tests allowed")
    run([sys.executable, "backend/manage.py", "test", *labels, "--settings=netshop_overview_test_settings", "--noinput"], "tests")
finally:
    if pwfile.exists(): pwfile.unlink()
    if started: run([BIN/"pg_ctl.exe", "-D", RUN/"data", "-m", "fast", "-w", "-t", "30", "stop"], "stop")
    (EVIDENCE/"result.json").write_text(json.dumps({"fixture": "foundation-synthetic-v1", "port": PORT, "runtime": str(RUN), "stopped": started, "results": results}, indent=2), encoding="utf-8")
    print(f"Private foundation PostgreSQL stopped; evidence {EVIDENCE}")
