"""Independent product-Q fixture runner. Never uses a production connection.

Each invocation exclusively creates its own PG runtime and immutable evidence.
The only existing runtime access is reading the installed PostgreSQL binaries.
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
RUN_ID = "products-review-pg-" + secrets.token_hex(12)
RUN = ROOT / ".runtime" / "products-review" / RUN_ID
EVIDENCE = Path(r"E:\codex-artifacts\netshop-scheme2-20261001\products\review") / RUN_ID
labels = sys.argv[1:] or [
    "netshop.tests.test_product_insights",
    "netshop.tests.test_product_insights_detail",
    "netshop.tests.test_product_insights_review",
]
if any(not name.startswith("netshop.tests.test_product_insights") for name in labels):
    raise RuntimeError("This Q runner accepts only product-owned tests")
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PORT = probe.getsockname()[1]
if PORT in {5432, 3120, 18120, 18121, 13120}:
    raise RuntimeError("Refusing a production/reserved port")
RUN.mkdir(parents=True, exist_ok=False)
EVIDENCE.mkdir(parents=True, exist_ok=False)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"
with pwfile.open("x", encoding="ascii") as handle:
    handle.write(password)
env = {
    key: value for key, value in os.environ.items()
    if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}
}
env.update(
    PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
    PYTHONPATH=str(ROOT / "tools") + os.pathsep + str(ROOT / "backend"),
    TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development",
    DJANGO_DEBUG="true",
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://products_review_fixture:{password}@127.0.0.1:{PORT}/products_review_fixture",
    TERUISI_PRODUCTS_QUERY_EVIDENCE_DIR=str(EVIDENCE),
)
results = []


def run(args, label, timeout=600):
    before = time.monotonic()
    with (EVIDENCE / (label + ".log")).open("x", encoding="utf-8") as log:
        result = subprocess.run(
            [str(value) for value in args], cwd=ROOT, env=env,
            stdout=log, stderr=subprocess.STDOUT, timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    results.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic() - before, 3)})
    if result.returncode:
        raise RuntimeError(f"{label} failed ({result.returncode}); independent evidence {EVIDENCE}")


started = stopped = False
try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "products_review_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb", 60)
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start", 45)
    started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", PORT, "-U", "products_review_fixture", "products_review_fixture"], "database", 30)
    run([sys.executable, "backend/manage.py", "test", *labels, "--settings=netshop_products_test_settings", "--noinput", "--verbosity=2"], "tests")
finally:
    if pwfile.exists():
        pwfile.unlink()
    try:
        if started:
            run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", 45)
            stopped = True
    finally:
        with (EVIDENCE / "result.json").open("x", encoding="utf-8") as handle:
            json.dump({"fixture": "products-independent-review-v1", "port": PORT, "runtime": str(RUN), "started": started, "stopped": stopped, "results": results}, handle, indent=2)
        print(json.dumps({"evidence": str(EVIDENCE), "port": PORT, "normalStop": stopped}), flush=True)
