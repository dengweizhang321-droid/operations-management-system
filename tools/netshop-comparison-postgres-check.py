"""Create one private synthetic PostgreSQL per C run and normally stop it."""
from __future__ import annotations
import json
import csv
import hashlib
import io
import os
from pathlib import Path
import secrets
import re
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN = ROOT / ".runtime" / ("comparison-pg-"+secrets.token_hex(10))
EVIDENCE = Path(r"E:\codex-artifacts\netshop-scheme2-20261001\comparison\query") / RUN.name
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PORT = probe.getsockname()[1]
if PORT == 5432: raise RuntimeError("Refusing production port")
RUN.mkdir(parents=True, exist_ok=False)
EVIDENCE.mkdir(parents=True, exist_ok=False)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"
env = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
env.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT/"tools")+os.pathsep+str(ROOT/"backend"), TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true", TERUISI_DJANGO_DATABASE_URL=f"postgresql://comparison_fixture:{password}@127.0.0.1:{PORT}/comparison_fixture", TERUISI_COMPARISON_EVIDENCE_DIR=str(EVIDENCE))
results = []
SOURCE_FILES = ["backend/netshop/comparison_adapter.py", "backend/netshop/comparison_insights.py", "backend/netshop/comparison_contract.py", "backend/netshop/tests/test_comparison_erp.py", "backend/netshop/tests/test_comparison_insights.py", "backend/netshop/sales_periods_client.py", "backend/sales/netshop_periods.py", "backend/sales/netshop_period_series.py", "backend/sales/netshop_platform_series.py", "tools/netshop-comparison-postgres-check.py"]
def source_snapshot():
    return {"head":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip(),"sha256":{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in SOURCE_FILES}}
source_before = source_snapshot()

def run(args, label, timeout=900):
    before = time.monotonic()
    with (EVIDENCE/(label+".log")).open("x", encoding="utf-8") as log:
        result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    results.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic()-before, 3)})
    if result.returncode: raise RuntimeError(f"{label} failed ({result.returncode}); evidence {EVIDENCE}")

started = stopped = False
try:
    if os.name == "nt":
        who = subprocess.run(["whoami.exe", "/user", "/fo", "csv", "/nh"], check=True, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        sid = next(csv.reader(io.StringIO(who.stdout)))[-1].strip()
        if not re.fullmatch(r"S-1-[0-9-]+", sid): raise RuntimeError("Cannot prove current fixture owner")
        run(["icacls.exe", RUN, "/inheritance:r", "/grant:r", "*"+sid+":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "/q"], "private-directory", 30)
    with pwfile.open("x", encoding="ascii") as output: output.write(password)
    run([BIN/"initdb.exe", "-D", RUN/"data", "-U", "comparison_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb", 60)
    pwfile.unlink()
    with (RUN/"data/postgresql.conf").open("a", encoding="utf-8") as config: config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='64MB'\n")
    run([BIN/"pg_ctl.exe", "-D", RUN/"data", "-l", RUN/"postgres.log", "-w", "-t", "30", "start"], "start", 45)
    started = True
    run([BIN/"createdb.exe", "-h", "127.0.0.1", "-p", PORT, "-U", "comparison_fixture", "comparison_fixture"], "database", 30)
    labels = sys.argv[1:] or ["netshop.tests.test_comparison_insights"]
    # The only non-C regression is I's published owning-reader deadline suite.
    if any(not label.startswith("netshop.tests.test_comparison") and label != "netshop.tests.test_nested_reader_deadline" for label in labels): raise RuntimeError("Only C tests and the approved shared deadline regression allowed")
    run([sys.executable, "backend/manage.py", "test", *labels, "--settings=netshop_comparison_test_settings", "--noinput", "--verbosity=2"], "tests")
finally:
    if pwfile.exists(): pwfile.unlink()
    try:
        if started:
            run([BIN/"pg_ctl.exe", "-D", RUN/"data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", 45)
            stopped = True
    finally:
        source_after = source_snapshot()
        with (EVIDENCE/"result.json").open("x", encoding="utf-8") as output: json.dump({"fixture": "comparison-synthetic-v1", "port": PORT, "runtime": str(RUN), "started": started, "stopped": stopped, "results": results, "sourceBefore":source_before,"sourceAfter":source_after,"sourceStable":source_before==source_after}, output, indent=2)
        print(f"Private comparison PostgreSQL started={started}, normal stop={stopped}; evidence {EVIDENCE}")
