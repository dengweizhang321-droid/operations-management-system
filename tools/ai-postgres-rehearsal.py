"""Launch an isolated PostgreSQL cluster; production ports/data are never used."""

from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--all-backend-tests", action="store_true")
arguments = parser.parse_args()
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
PORT = 55443
RUN = ROOT / ".runtime" / ("ai-pg-" + secrets.token_hex(6))
RUN.mkdir(parents=True)
RUN = RUN.resolve()
if (
    not RUN.is_relative_to((ROOT / ".runtime").resolve())
    or ROOT.resolve() == Path(r"D:\运营管理系统").resolve()
):
    raise RuntimeError("This rehearsal requires an isolated worktree.")
with socket.socket() as probe:
    probe.bind(("127.0.0.1", PORT))
password = secrets.token_hex(32)
password_file = RUN / "password.txt"
password_file.write_text(password, encoding="ascii")
os.chmod(password_file, 0o600)
environment = {
    **os.environ,
    "PGPASSWORD": password,
    "PGHOST": "127.0.0.1",
    "PGPORT": str(PORT),
    "PGUSER": "ai_rehearsal_admin",
    "PGDATABASE": "postgres",
}


def run(arguments, timeout=300, env=None):
    # pg_ctl's descendant cmd.exe can retain PIPE handles after pg_ctl exits.
    # File handles keep subprocess.wait bounded without waiting for child EOF.
    output = RUN / ("command-" + secrets.token_hex(4) + ".log")
    with output.open("wb") as stream:
        result = subprocess.run(
            [str(v) for v in arguments],
            env=env or environment,
            cwd=ROOT,
            stdout=stream,
            stderr=stream,
            timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    data = output.read_bytes()
    if result.returncode:
        # All subprocess arguments are fixed paths/options. Credentials stay in
        # environment and a private temporary file; no URL is printed.
        (RUN / "failure.log").write_bytes(data)
        raise RuntimeError("Isolated command failed; see " + str(RUN / "failure.log"))
    return data.decode("utf-8", errors="replace")


started = False
try:
    run(
        [
            BIN / "initdb.exe",
            "-D",
            RUN / "data",
            "-U",
            "ai_rehearsal_admin",
            "--auth=scram-sha-256",
            "--encoding=UTF8",
            "--locale=C",
            "--pwfile",
            password_file,
        ]
    )
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(
            f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nmax_connections=128\n"
        )
    run(
        [
            BIN / "pg_ctl.exe",
            "-D",
            RUN / "data",
            "-l",
            RUN / "postgres.log",
            "-w",
            "-t",
            "30",
            "start",
        ],
        60,
    )
    started = True
    run([BIN / "createdb.exe", "teruisi_ai_rehearsal"])
    django_env = {
        **environment,
        "DJANGO_SECRET_KEY": secrets.token_hex(32),
        "TERUISI_DJANGO_INTERNAL_SECRET": secrets.token_hex(32),
        "TERUISI_DJANGO_DATABASE_URL": f"postgresql://ai_rehearsal_admin:{quote(password)}@127.0.0.1:{PORT}/teruisi_ai_rehearsal",
        "TERUISI_DJANGO_ENVIRONMENT": "test",
        "TERUISI_DJANGO_PROCESS_ROLE": "development",
        "DJANGO_SETTINGS_MODULE": "teruisi_backend.settings",
        "PYTHONUTF8": "1",
    }
    print(
        json.dumps(
            {
                "stage": "isolated_cluster_started",
                "port": PORT,
                "productionWrites": False,
            }
        ),
        flush=True,
    )
    tests = run(
        [
            sys.executable,
            ROOT / "backend/manage.py",
            "test",
            "ai_assistant",
            "--noinput",
            "--verbosity",
            "1",
        ],
        env=django_env,
    )
    (RUN / "tests.log").write_text(tests, encoding="utf-8")
    if arguments.all_backend_tests:
        # Existing domain unit suites include SQLite-specific fixtures. Exercise
        # their supported unit environment separately from AI's PostgreSQL gates.
        unit_env = {
            **django_env,
            "TERUISI_DJANGO_SQLITE_PATH": str(RUN / "backend-unit.sqlite3"),
        }
        unit_env.pop("TERUISI_DJANGO_DATABASE_URL", None)
        unit_tests = run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "test",
                "ai_assistant",
                "access_control",
                "sales",
                "erp_reference",
                "finance",
                "netshop",
                "market",
                "products",
                "inventory",
                "workflow",
                "customer_service",
                "bi",
                "teruisi_backend",
                "--noinput",
                "--verbosity",
                "1",
            ],
            env=unit_env,
        )
        (RUN / "backend-regression.log").write_text(unit_tests, encoding="utf-8")
    run(
        [
            sys.executable,
            ROOT / "backend/manage.py",
            "migrate",
            "--noinput",
            "--verbosity",
            "0",
        ],
        env=django_env,
    )
    source = ROOT / ".runtime/ai-source-rehearsal.sqlite"
    dry = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "dry-run",
            ],
            env=django_env,
        )
    )
    applied = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "apply",
                "--approve-run-id",
                dry["runId"],
            ],
            env=django_env,
        )
    )
    verified = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "verify-only",
            ],
            env=django_env,
        )
    )
    # Restore the complete isolated database before runtime traffic can change it.
    archive = RUN / "isolated-preactivation.dump"
    run(
        [
            BIN / "pg_dump.exe",
            "--format=custom",
            "--file",
            archive,
            "teruisi_ai_rehearsal",
        ]
    )
    run([BIN / "createdb.exe", "teruisi_ai_restore"])
    run(
        [
            BIN / "pg_restore.exe",
            "--exit-on-error",
            "--dbname",
            "teruisi_ai_restore",
            archive,
        ]
    )
    restore_env = {
        **django_env,
        "TERUISI_DJANGO_DATABASE_URL": django_env[
            "TERUISI_DJANGO_DATABASE_URL"
        ].replace("/teruisi_ai_rehearsal", "/teruisi_ai_restore"),
    }
    restored = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "verify-only",
            ],
            env=restore_env,
        )
    )
    if restored["targetDigest"] != verified["targetDigest"]:
        raise RuntimeError("Isolated backup restoration digest mismatch")
    run(
        [
            sys.executable,
            ROOT / "tools/ai-runtime-rehearsal.py",
            "--run-root",
            RUN,
            "--apply-run",
            applied["runId"],
        ],
        env=django_env,
    )
    # A post-activation archive must retain the terminal authority and runtime
    # mutations too; a pre-activation restore alone cannot prove PNR recovery.
    run(
        [
            BIN / "pg_dump.exe",
            "--format=custom",
            "--file",
            RUN / "isolated-postactivation.dump",
            "teruisi_ai_rehearsal",
        ]
    )
    run([BIN / "createdb.exe", "teruisi_ai_terminal_restore"])
    run(
        [
            BIN / "pg_restore.exe",
            "--exit-on-error",
            "--dbname",
            "teruisi_ai_terminal_restore",
            RUN / "isolated-postactivation.dump",
        ]
    )
    import hashlib
    import psycopg

    sys.path.insert(0, str(ROOT / "backend"))
    from ai_assistant.table_manifest import AI_TABLES

    def restored_tables(database):
        with psycopg.connect(
            django_env["TERUISI_DJANGO_DATABASE_URL"].replace(
                "/teruisi_ai_rehearsal", "/" + database
            )
        ) as restored_connection:
            evidence = {}
            for table in AI_TABLES:
                rows = restored_connection.execute(
                    f'SELECT row_to_json(t)::text FROM "{table}" t'
                ).fetchall()
                normalized = sorted(
                    json.dumps(
                        json.loads(row[0]), sort_keys=True, separators=(",", ":")
                    )
                    for row in rows
                )
                evidence[table] = hashlib.sha256(
                    "\n".join(normalized).encode()
                ).hexdigest()
            status = restored_connection.execute(
                "SELECT status FROM ai_write_authority WHERE id=1"
            ).fetchone()[0]
            if status != "postgres":
                raise RuntimeError("Restored AI terminal authority is missing")
            return evidence

    terminal = restored_tables("teruisi_ai_rehearsal")
    if restored_tables("teruisi_ai_terminal_restore") != terminal:
        raise RuntimeError("Post-activation AI restore differs from the source")
    report = {
        "status": "passed",
        "port": PORT,
        "productionWrites": False,
        "dryRun": dry,
        "apply": applied,
        "verify": verified,
        "restored": restored,
        "terminalRestore": {
            "status": "passed",
            "tables": len(AI_TABLES),
            "authority": "postgres",
            "productionDatabaseTouched": False,
        },
        "system": json.loads((RUN / "system-result.json").read_text(encoding="utf-8")),
    }
    (RUN / "result.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": "passed",
                "sourceDigest": verified["sourceDigest"],
                "targetDigest": verified["targetDigest"],
                "totalRows": sum(verified["counts"].values()),
                "result": str(RUN / "result.json"),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
finally:
    if started:
        run(
            [
                BIN / "pg_ctl.exe",
                "-D",
                RUN / "data",
                "-m",
                "fast",
                "-w",
                "-t",
                "30",
                "stop",
            ],
            60,
        )
    password_file.unlink(missing_ok=True)
