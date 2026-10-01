"""Disposable dynamic PostgreSQL for only the two new finance/netshop test modules."""
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
RUN = ROOT / ".runtime" / ("finance-netshop-pg-" + secrets.token_hex(6))
external = os.environ.get("TERUISI_FINANCE_NETSHOP_EVIDENCE_ROOT")
if not external or ROOT == Path(r"D:\运营管理系统"):
    raise RuntimeError("Requires independent tree and explicit external evidence root")
EVIDENCE = Path(external) / RUN.name
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PORT = probe.getsockname()[1]
if PORT == 5432:
    raise RuntimeError("Refusing production port")
RUN.mkdir(parents=True)
EVIDENCE.mkdir(parents=True)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"
pwfile.write_text(password, encoding="ascii")
env = {key: value for key, value in os.environ.items() if key in {
    "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
env.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
    PYTHONPATH=str(ROOT / "tools") + os.pathsep + str(ROOT / "backend"),
    TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true",
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://finance_fixture:{password}@127.0.0.1:{PORT}/finance_fixture",
    TERUISI_FINANCE_NETSHOP_CAPACITY=str(EVIDENCE / "capacity"))
results = []


def run(args, label, required=True):
    started = time.monotonic()
    with (EVIDENCE / (label + ".log")).open("x", encoding="utf-8") as output:
        code = subprocess.run([str(a) for a in args], cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0).returncode
    results.append({"step": label, "exitCode": code, "seconds": round(time.monotonic() - started, 3)})
    if required and code:
        raise RuntimeError(f"{label} failed ({code}); evidence retained at {EVIDENCE}")
    return code


started = False
try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "finance_fixture", "--auth=scram-sha-256",
         "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb")
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start")
    started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", PORT, "-U", "finance_fixture", "finance_fixture"], "database")
    labels = sys.argv[1:] or ["finance.tests.test_netshop_reads", "netshop.tests.test_finance_netshop_client"]
    allowed = {"finance.tests.test_netshop_reads", "netshop.tests.test_finance_netshop_client",
               "netshop.tests.test_finance_netshop_registered", "netshop.tests.test_finance_netshop_contract"}
    allowed.add("netshop.tests.test_bounded_consumer_http")
    if not labels or any(label not in allowed and not any(label.startswith(module + ".") for module in allowed) for label in labels):
        raise RuntimeError("Only the new scoped finance/netshop tests allowed")
    run([sys.executable, "backend/manage.py", "test", *labels, "--settings=netshop_finance_test_settings", "--noinput", "--verbosity", "2"], "tests")
finally:
    if pwfile.exists():
        pwfile.unlink()
    stop_code = run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", False) if started else None
    with (EVIDENCE / "result.json").open("x", encoding="utf-8") as output:
        json.dump({"fixture": "finance-netshop-synthetic-private-v1", "port": PORT, "runtime": str(RUN),
                   "stopped": started and stop_code == 0, "results": results}, output, indent=2)
    print(f"Private finance/netshop PostgreSQL stopped; evidence {EVIDENCE}")
