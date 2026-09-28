"""Synthetic integration only: own cluster/port/credentials; no production DB."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
if ROOT == Path(r"D:\运营管理系统"):
    raise RuntimeError("Require isolated worktree")
scratch = ROOT / ".codex-tmp"
scratch.mkdir(exist_ok=True)
RUN = Path(tempfile.mkdtemp(prefix="drain-postgres-", dir=scratch))
PORT = next((port for port in range(55884, 55900) if subprocess.run(
    [sys.executable, "-c", "import socket,sys;s=socket.socket();s.bind(('127.0.0.1',int(sys.argv[1])));s.close()", str(port)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0), None)
if PORT is None:
    raise RuntimeError("No isolated test port available")
password = secrets.token_hex(32)
pwfile = RUN / "password"
pwfile.write_text(password, encoding="ascii")
environment = {k: v for k, v in os.environ.items() if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
environment.update(PGHOST="127.0.0.1", PGPORT=str(PORT), PGUSER="drain_fixture", PGPASSWORD=password,
    PGDATABASE="teruisi_ai_rehearsal", PYTHONUTF8="1", DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://drain_fixture:{password}@127.0.0.1:{PORT}/teruisi_ai_rehearsal",
    TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_ENVIRONMENT="test",
    TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
    PYTHONPATH=str(RUN) + os.pathsep + str(ROOT / "backend"))
(RUN / "sitecustomize.py").write_text('''import socket
_connect=socket.socket.connect
def connect(sock,address):
    if not isinstance(address,tuple) or address[0] != '127.0.0.1' or address[1] != ''' + str(PORT) + ''':
        raise RuntimeError('Isolated integration forbids external/production network')
    return _connect(sock,address)
socket.socket.connect=connect
''', encoding="utf8")

def run(args, label, timeout=240):
    with (RUN / (label + ".log")).open("wb") as out:
        result = subprocess.run([str(a) for a in args], env=environment, cwd=ROOT, stdout=out, stderr=out,
                                timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(f"{label} failed; inspect {RUN / (label + '.log')}")

started = False
try:
    print(json.dumps({"phase": "init", "directory": str(RUN), "port": PORT}), flush=True)
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "drain_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "init")
    with (RUN / "data/postgresql.conf").open("a", encoding="ascii") as stream:
        stream.write(f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start")
    started = True
    run([BIN / "createdb.exe", "teruisi_ai_rehearsal"], "createdb")
    # Same explicit prerequisite as the existing isolated AI rehearsal. No
    # production Provision or credentials are involved.
    run([BIN / "psql.exe", "-d", "teruisi_ai_rehearsal", "-v", "ON_ERROR_STOP=1", "-c",
         "CREATE ROLE teruisi_ai_seal_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"], "seal-role")
    for role in ("teruisi_ai_reader", "teruisi_ai_writer", "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer"):
        login = "LOGIN" if role.startswith("teruisi_ai_") else "NOLOGIN"
        run([BIN / "psql.exe", "-d", "teruisi_ai_rehearsal", "-v", "ON_ERROR_STOP=1", "-c",
             f"CREATE ROLE {role} {login} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"], role)
    print(json.dumps({"phase": "tests", "port": PORT}), flush=True)
    run([sys.executable, ROOT / "backend/manage.py", "test", "ai_assistant.test_dingtalk_schedules",
         "ai_assistant.test_dingtalk_schedule_worker", "sales.tests.test_write_api", "sales.tests.test_write_service", "--noinput", "--verbosity", "2"], "tests", 600)
    result = {"status": "passed", "port": PORT, "productionTouched": False, "externalEffects": False, "directory": str(RUN)}
    (RUN / "evidence.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps(result), flush=True)
finally:
    if started:
        run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop")
    pwfile.unlink(missing_ok=True)
    print(json.dumps({"phase": "cleanup", "stopped": started, "passwordFileRemoved": not pwfile.exists()}), flush=True)
