"""Synthetic PostgreSQL verification in this worktree; no production connection."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN = ROOT / ".runtime" / "preview" / ("overview-pg-" + secrets.token_hex(6))
PORT = 55693
with socket.socket() as probe:
    probe.bind(("127.0.0.1", PORT))
RUN.mkdir(parents=True)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"
pwfile.write_text(password, encoding="ascii")
env = {**os.environ, "PGPASSWORD": password, "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1"}
env.pop("TERUISI_DJANGO_SQLITE_PATH", None)
env["PYTHONPATH"] = str(ROOT / "tools") + os.pathsep + str(ROOT / "backend")
env.update(TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true", TERUISI_DJANGO_DATABASE_URL=f"postgresql://overview_fixture:{password}@127.0.0.1:{PORT}/overview_fixture")


def run(args, label):
    with (RUN / (label + ".log")).open("w", encoding="utf-8") as log:
        result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        print(f"{label} failed; see {RUN / (label + '.log')}")
        raise RuntimeError(f"{label} failed ({result.returncode})")


started = False
try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "overview_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb")
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start")
    started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", str(PORT), "-U", "overview_fixture", "overview_fixture"], "database")
    run([sys.executable, "backend/manage.py", "test", "netshop.tests.test_store_overview", "netshop.tests.test_query", "netshop.tests.test_api", "netshop.tests.test_analysis", "netshop.tests.test_source_revision_guard", "--settings=netshop_overview_test_settings", "--noinput"], "netshop-tests")
    print(f"PostgreSQL netshop tests passed; logs: {RUN}")
finally:
    if pwfile.exists(): pwfile.unlink()
    if started:
        run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop")
        print("Isolated PostgreSQL stopped; production untouched")
