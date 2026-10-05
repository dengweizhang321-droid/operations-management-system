"""Owned synthetic PostgreSQL session, with no production connection fallback."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if not (ROOT / ".git").is_file() or not subprocess.check_output(
    ["git", "branch", "--show-current"], cwd=ROOT, encoding="utf-8"
).strip().startswith("codex/"):
    raise RuntimeError("Use an independent codex worktree")
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN = ROOT / ".runtime" / ("sales-performance-pg-" + secrets.token_hex(8))
RUN.mkdir(parents=True, exist_ok=False)
testing = not (sys.argv[1:] and sys.argv[1] in {"baseline", "benchmark", "serve"})
if testing:
    port = None
    for candidate in range(55440, 56000):
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", candidate))
                port = candidate
            break
        except OSError:
            continue
    if port is None:
        raise RuntimeError("No isolated rehearsal port")
else:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
if port == 5432:
    raise RuntimeError("Refusing production port")
password = secrets.token_hex(40)
database_name = "teruisi_ai_rehearsal" if testing else "sales_fixture"
pwfile = RUN / "password.txt"
pwfile.write_text(password, encoding="ascii")
env = {k: v for k, v in os.environ.items() if k.upper() in {
    "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA"
}}
env.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
    PYTHONPATH=str(ROOT / "tools") + os.pathsep + str(ROOT / "backend"),
    DJANGO_SETTINGS_MODULE="sales_performance_settings", TERUISI_DJANGO_ENVIRONMENT="test",
    TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true",
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://sales_fixture:{password}@127.0.0.1:{port}/{database_name}",
    SALES_PERFORMANCE_EVIDENCE=str(RUN))
if sys.argv[1:] == ["serve"]:
    token = os.environ.get("SALES_PERFORMANCE_LAB_TOKEN", "")
    if len(token) != 64:
        raise RuntimeError("Serve requires the owned UI lab launcher")
    env["SALES_PERFORMANCE_LAB_TOKEN"] = token
    env["SALES_PERFORMANCE_LAB_PORT"] = os.environ["SALES_PERFORMANCE_LAB_PORT"]
steps = []

def run(args, name, timeout=600):
    with (RUN / (name + ".log")).open("w", encoding="utf-8") as log:
        result = subprocess.run([str(v) for v in args], cwd=ROOT, env=env,
            stdout=log, stderr=subprocess.STDOUT, timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW)
    steps.append({"step": name, "exitCode": result.returncode})
    if result.returncode:
        raise RuntimeError(f"{name} failed: {RUN}")

started = False
try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "sales_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb", 60)
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a") as config:
        config.write(f"\nport={port}\nlisten_addresses='127.0.0.1'\nmax_connections=20\nshared_buffers='64MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "start"], "start", 45)
    started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", port, "-U", "sales_fixture", database_name], "database", 30)
    if sys.argv[1:] and sys.argv[1] in {"baseline", "benchmark", "serve"}:
        run([sys.executable, "tools/sales-performance-benchmark.py", *sys.argv[1:]], sys.argv[1], 36000 if sys.argv[1] == "serve" else 600)
    else:
        labels = sys.argv[1:] or ["sales.tests.test_api", "sales.tests.test_periods", "sales.tests.test_consumers_api", "sales.tests.test_singleflight", "bi.tests.test_api", "products.tests.test_api", "finance.tests"]
        run([sys.executable, "backend/manage.py", "test", *labels, "--noinput", "--verbosity=2"], "tests", 600)
finally:
    if pwfile.exists():
        pwfile.unlink()
    if started:
        run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "stop"], "stop", 45)
    (RUN / "result.json").write_text(json.dumps({"fixture": "synthetic-only", "port": port, "steps": steps}, indent=2))
    print(RUN, flush=True)
