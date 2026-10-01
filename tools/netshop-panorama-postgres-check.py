"""Run only panorama-owned tests on a new, normally stopped private PostgreSQL.

No runtime environment or production connection is inherited. Evidence and
fixture directories are exclusive per invocation; ports and credentials are
random. The PostgreSQL binary is reused without using its production cluster.
"""
from __future__ import annotations

import hashlib
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
RUN = ROOT / ".runtime" / ("panorama-pg-" + secrets.token_hex(10))
EVIDENCE = Path(r"E:\codex-artifacts\netshop-panorama-M5-20261001\core") / RUN.name
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PORT = probe.getsockname()[1]
if PORT == 5432:
    raise RuntimeError("Refusing the production PostgreSQL port")
if not (BIN / "initdb.exe").is_file():
    raise RuntimeError("Private fixture PostgreSQL binary is unavailable")
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
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://panorama_fixture:{password}@127.0.0.1:{PORT}/panorama_fixture",
    TERUISI_PANORAMA_QUERY_EVIDENCE_DIR=str(EVIDENCE),
    TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(40),
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
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "panorama_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb", timeout=60)
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start", timeout=45)
    started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", str(PORT), "-U", "panorama_fixture", "panorama_fixture"], "database", timeout=30)
    labels = sys.argv[1:] or ["netshop.tests.test_store_panorama", "netshop.tests.test_store_panorama_workflow"]
    if any(not label.startswith("netshop.tests.test_store_panorama") for label in labels):
        raise RuntimeError("Only panorama-owned test labels are allowed")
    # The extra owning workflow tables and URLs exist only in this private
    # fixture. No repository settings or runtime configuration is modified.
    settings_file = RUN / "panorama_workflow_test_settings.py"
    with settings_file.open("x", encoding="utf-8") as output:
        output.write('from netshop_products_test_settings import *\nINSTALLED_APPS = [*INSTALLED_APPS, "workflow.apps.WorkflowConfig"]\n')
    env["PYTHONPATH"] = str(RUN) + os.pathsep + env["PYTHONPATH"]
    run([sys.executable, "backend/manage.py", "test", *labels, "--settings=panorama_workflow_test_settings", "--noinput", "--verbosity=2"], "tests")
finally:
    if pwfile.exists():
        pwfile.unlink()
    try:
        if started:
            run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", timeout=45)
            stopped = True
    finally:
        source_paths = [ROOT / "backend/netshop/store_panorama.py", Path(__file__)]
        source_paths.extend(sorted((ROOT / "backend/netshop/tests").glob("test_store_panorama*.py")))
        with (EVIDENCE / "result.json").open("x", encoding="utf-8") as output:
            json.dump({"fixture": "panorama-synthetic-postgresql-v1", "port": PORT, "runtime": str(RUN), "started": started, "stopped": stopped, "results": results,
                       "sourceSha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths if p.is_file()}}, output, indent=2)
        print(f"Private panorama PostgreSQL normal stop={stopped}; evidence {EVIDENCE}")
