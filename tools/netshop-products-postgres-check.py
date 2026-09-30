"""Start and normally stop one product-owned PostgreSQL fixture per run.

No production variables, connections or fixture directories are inherited.
Logs and evidence are create-only under this run's unique immutable directory.
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

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
EVIDENCE_ROLE = os.environ.get("TERUISI_PRODUCTS_PG_EVIDENCE_ROLE", "query")
if EVIDENCE_ROLE not in {"query", "lead"}:
    raise RuntimeError("Evidence role must be exactly query or lead")
RUN = ROOT / ".runtime" / ("products-pg-" + secrets.token_hex(10))
EVIDENCE = Path(r"E:\codex-artifacts\netshop-scheme2-20261001\products") / EVIDENCE_ROLE / RUN.name
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PORT = probe.getsockname()[1]
if PORT in {5432, 3120, 18120, 18121, 13120}:
    raise RuntimeError("Refusing production or reserved product ports")
RUN.mkdir(parents=True, exist_ok=False)
EVIDENCE.mkdir(parents=True, exist_ok=False)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"
with pwfile.open("x", encoding="ascii") as output:
    output.write(password)
env = {
    key: value for key, value in os.environ.items()
    if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}
}
env.update(
    PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
    PYTHONPATH=str(ROOT / "tools") + os.pathsep + str(ROOT / "backend"),
    TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development",
    DJANGO_DEBUG="true",
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://products_fixture:{password}@127.0.0.1:{PORT}/products_fixture",
    TERUISI_PRODUCTS_QUERY_EVIDENCE_DIR=str(EVIDENCE),
)
results = []


def run(args, label, *, timeout=600):
    before = time.monotonic()
    with (EVIDENCE / (label + ".log")).open("x", encoding="utf-8") as log:
        result = subprocess.run(
            [str(value) for value in args], cwd=ROOT, env=env,
            stdout=log, stderr=subprocess.STDOUT, timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    results.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic() - before, 3)})
    if result.returncode:
        raise RuntimeError(f"{label} failed ({result.returncode}); evidence {EVIDENCE}")


started, stopped = False, False
try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "products_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb", timeout=60)
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start", timeout=45)
    started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", str(PORT), "-U", "products_fixture", "products_fixture"], "database", timeout=30)
    labels = sys.argv[1:] or ["netshop.tests.test_product_insights", "netshop.tests.test_product_insights_detail", "netshop.tests.test_product_insights_catalog_filters"]
    if any(not label.startswith("netshop.tests.test_product_insights") for label in labels):
        raise RuntimeError("Only product-owned tests may use this fixture runner")
    run([sys.executable, "backend/manage.py", "test", *labels, "--settings=netshop_products_test_settings", "--noinput", "--verbosity=2"], "tests")
finally:
    if pwfile.exists():
        pwfile.unlink()
    try:
        if started:
            run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", timeout=45)
            stopped = True
    finally:
        with (EVIDENCE / "result.json").open("x", encoding="utf-8") as output:
            json.dump({"fixture": "products-synthetic-v1", "evidenceRole": EVIDENCE_ROLE, "port": PORT, "runtime": str(RUN), "started": started, "stopped": stopped, "results": results}, output, indent=2)
        print(f"Private product PostgreSQL normal stop={stopped}; evidence {EVIDENCE}")
