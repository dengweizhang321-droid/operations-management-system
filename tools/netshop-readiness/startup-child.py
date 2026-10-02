"""Private child of the candidate's real process launcher; no business data IO.

Loads the candidate WSGI app in its production reader environment, binds only a
dynamic loopback Waitress listener, and reports inherited dependency wiring.
The separate business probe exercises real authenticated domain reads.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
from pathlib import Path
import sys
import threading
import time
import traceback


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--ready", required=True)
    parser.add_argument("--stop", required=True)
    parser.add_argument("--nonce", required=True)
    args = parser.parse_args()
    root, ready, stop = Path(args.candidate).resolve(), Path(args.ready), Path(args.stop)
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(root / "backend"))
    report: dict[str, object] = {"schemaVersion": "netshop-startup-child-v1", "nonce": args.nonce, "pid": os.getpid(), "state": "failed"}
    server = None
    try:
        # Production settings mandate port 5432. Use synthetic identity only,
        # and block the actual driver before importing any candidate code.
        if os.environ.get("TERUISI_DJANGO_DATABASE_URL") != "postgresql://startup_fixture:fixture@127.0.0.1:5432/startup_fixture":
            raise RuntimeError("unsafe_fixture_database")
        import psycopg
        def deny_database(*_args, **_kwargs):
            raise RuntimeError("database_io_forbidden_in_startup_probe")
        psycopg.connect = deny_database
        psycopg.Connection.connect = classmethod(deny_database)
        psycopg.AsyncConnection.connect = classmethod(deny_database)
        try:
            psycopg.connect()
        except RuntimeError as blocked:
            if str(blocked) != "database_io_forbidden_in_startup_probe":
                raise
        else:
            raise RuntimeError("database_guard_failed")
        dependencies = {}
        for line in (root / "backend" / "requirements.txt").read_text(encoding="utf-8-sig").splitlines():
            match = re.fullmatch(r"([A-Za-z0-9_-]+)(?:\[[A-Za-z0-9_,.-]+\])?==([^\s]+)", line.strip())
            if match:
                installed = importlib.metadata.version(match[1])
                dependencies[match[1]] = installed
                if installed != match[2]:
                    raise RuntimeError("candidate_dependency_mismatch")
        from teruisi_backend.wsgi import application
        from django.conf import settings
        import teruisi_backend.wsgi as wsgi
        from waitress import create_server

        expected = {"sales": ("TERUISI_DJANGO_SALES_READER_BASE_URL", "http://127.0.0.1:8001"),
                    "finance": ("TERUISI_DJANGO_FINANCE_READER_BASE_URL", "http://127.0.0.1:8011"),
                    "workflow": ("TERUISI_DJANGO_WORKFLOW_READER_BASE_URL", "http://127.0.0.1:8061")}
        peers = {name: {"present": bool(os.environ.get(key)), "matchesRequiredEndpoint": os.environ.get(key) == value}
                 for name, (key, value) in expected.items()}
        wsgi_path = Path(wsgi.__file__).resolve()
        if wsgi_path != root / "backend" / "teruisi_backend" / "wsgi.py":
            raise RuntimeError("candidate_module_mismatch")
        role_ok = settings.DJANGO_PROCESS_ROLE == "netshop_reader" and settings.DJANGO_EXPECT_READ_ONLY is True and settings.DJANGO_ENVIRONMENT == "production" and settings.DEBUG is False
        server = create_server(application, host="127.0.0.1", port=0, threads=1,
                               connection_limit=4, channel_timeout=3, expose_tracebacks=False)
        port = int(server.effective_port)
        if port < 1024 or port in {3000, 5432, 5791, 8001, 8011, 8021, 8022, 8061}:
            raise RuntimeError("unsafe_fixture_listener")
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        report.update(state="running", roleVerified=role_ok, dependencies=peers,
                      pythonVersion=".".join(str(v) for v in sys.version_info[:3]), packageVersions=dependencies,
                      listenerPort=port, wsgiSha256=hashlib.sha256(wsgi_path.read_bytes()).hexdigest(),
                      businessDatabaseConnected=False, databaseDriverBlocked=True, businessSourceRequests=0)
        pending = ready.with_suffix(".pending")
        with pending.open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=True)
        pending.rename(ready)
        deadline = time.monotonic() + 40
        while not stop.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        if not stop.exists():
            return 2
        return 0
    except Exception as error:
        report["exceptionType"] = type(error).__name__
        report["frames"] = [{"file": Path(f.filename).name, "line": f.lineno, "function": f.name}
                            for f in traceback.extract_tb(error.__traceback__)[-3:]]
        report["reason"] = str(error) if isinstance(error, RuntimeError) and str(error) in {
            "unsafe_fixture_database", "candidate_module_mismatch", "unsafe_fixture_listener"
        } else "candidate_wsgi_start_failed"
        if not ready.exists():
            with ready.open("x", encoding="utf-8") as output:
                json.dump(report, output)
        # Keep the process alive long enough for the real launcher identity receipt.
        deadline = time.monotonic() + 15
        while not stop.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        return 1
    finally:
        if server is not None:
            server.task_dispatcher.shutdown(timeout=2)
            server.close()


if __name__ == "__main__":
    raise SystemExit(main())
