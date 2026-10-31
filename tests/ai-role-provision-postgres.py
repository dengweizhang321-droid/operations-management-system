"""Exercise the real AI provisioner against a disposable PostgreSQL cluster.

Uses synthetic empty tables, not a full migration or native lifecycle rehearsal.
No production URL, runtime, credentials, services or publisher are used.
"""
import argparse
import ast
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def verify(port, data):
    import django
    from django.conf import settings
    import psycopg
    from psycopg import sql

    sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tools")]
    settings_ast = ast.parse((ROOT / "backend/teruisi_backend/settings.py").read_text(encoding="utf-8"))
    apps = next(ast.literal_eval(node.value) for node in settings_ast.body if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == "INSTALLED_APPS" for target in node.targets))
    settings.configure(INSTALLED_APPS=apps, SECRET_KEY="fixture-only",
                       DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}})
    django.setup()
    from ai_assistant import database_contract as contract
    from ai_assistant import table_manifest as manifest
    from workflow_automation_catalog import preservation

    groups = [
        ("0084_pi_agent_independent_runtime", manifest.PI_TABLES, "Pi schema"),
        ("0085_pi_workspace_controls", manifest.PI_WORKSPACE_TABLES, "Pi workspace"),
        ("0086_pi_business_actions", manifest.PI_BUSINESS_TABLES, "Pi business"),
        ("0087_pi_native_capabilities", manifest.PI_NATIVE_TABLES, "Pi native"),
    ]
    all_pi = set().union(*(set(tables) for _, tables, _ in groups))
    passwords = (secrets.token_hex(32), secrets.token_hex(32))
    columns = {table: {field.column for field in model._meta.local_fields if field.column}
               for table, model in contract.MODELS.items()}
    for table in contract.READ_TABLES | set(contract.WRITER_PRIVILEGES):
        columns.setdefault(table, {"id"})
    datasets = json.loads((ROOT / "backend/system_datasets/manifest.json").read_text(encoding="utf-8"))
    for spec in datasets["datasets"]:
        if spec["domain"] == "ai_assistant":
            columns.setdefault(spec["table"], set()).update(
                field["column"] for field in [*spec["fields"].values(), *spec.get("paginationOnlyFields", {}).values()])
    checks = []
    with psycopg.connect(host="127.0.0.1", port=port, dbname="postgres",
                        user="provision_fixture", password=os.environ["PGPASSWORD"], autocommit=True) as db:
        with db.cursor() as cur:
            cur.execute("SHOW data_directory")
            assert Path(cur.fetchone()[0]).resolve() == data.resolve()
            cur.execute("SHOW port")
            assert int(cur.fetchone()[0]) == port and port != 5432
        for depth in range(5):
            present = set().union(*(set(tables) for _, tables, _ in groups[:depth]))
            with db.cursor() as cur:
                cur.execute("DROP SCHEMA public CASCADE")
                cur.execute("CREATE SCHEMA public")
                cur.execute("CREATE TABLE django_migrations(app text, name text)")
                # A non-Pi addition's receipts do not affect the four Pi guards.
                for name in ("0009_automation_projection_b1", "0010_customer_service_chain_modules"):
                    cur.execute("INSERT INTO django_migrations VALUES ('workflow', %s)", [name])
                for name, _, _ in groups[:depth]:
                    cur.execute("INSERT INTO django_migrations VALUES ('ai_assistant', %s)", [name])
                for table, fields in columns.items():
                    if table in all_pi - present:
                        continue
                    cur.execute(sql.SQL("CREATE TABLE {} ({})").format(sql.Identifier(table),
                        sql.SQL(",").join(sql.SQL("{} text").format(sql.Identifier(field)) for field in sorted(fields))))
            contract.provision(db, *passwords)
            # Reproduce b8c0ed58's predecessor ACL, then reconcile using the real function.
            with db.cursor() as cur:
                cur.execute("REVOKE DELETE ON ai_write_request_receipts FROM teruisi_ai_writer")
                cur.execute("SELECT has_table_privilege('teruisi_ai_writer', 'ai_write_request_receipts', 'DELETE')")
                assert cur.fetchone() == (False,)
                before = preservation(cur) if depth == 4 else None
            contract.provision(db, *passwords)
            with db.cursor() as cur:
                if before is not None:
                    assert preservation(cur) == before, "Workflow Finalize preservation changed during DELETE repair"
                    checks.append("Workflow Finalize legacy row/ACL preservation unchanged")
                cur.execute("SELECT privilege_type FROM information_schema.role_table_grants "
                            "WHERE grantee='teruisi_ai_writer' AND table_name='ai_write_request_receipts'")
                assert {row[0] for row in cur.fetchall()} == set(contract.WRITER_PRIVILEGES["ai_write_request_receipts"])
                cur.execute("SELECT count(*) FROM django_migrations WHERE app='workflow'")
                assert cur.fetchone() == (2,)
            checks.append(f"WorkflowAutomation with {depth} complete Pi generations: provision and DELETE repair")
        # Full inventory is installed now. Every guard must still reject each mismatch.
        for name, tables, label in groups:
            for mismatch in ("missing-receipt", "missing-tables", "partial-tables"):
                with db.transaction(force_rollback=True):
                    with db.cursor() as cur:
                        if mismatch == "missing-receipt":
                            cur.execute("DELETE FROM django_migrations WHERE app='ai_assistant' AND name=%s", [name])
                        else:
                            targets = tables if mismatch == "missing-tables" else tables[:1]
                            for table in targets:
                                cur.execute(sql.SQL("DROP TABLE {}").format(sql.Identifier(table)))
                    try:
                        contract.provision(db, *passwords)
                    except ValueError as error:
                        assert str(error) == label + " receipt/table inventory mismatch", str(error)
                    else:
                        raise AssertionError(f"Accepted {label}: {mismatch}")
                checks.append(f"{label}: rejects {mismatch}")
        contract.provision(db, *passwords)
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postgres-bin", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    out, binaries = args.out.resolve(), args.postgres_bin.resolve()
    for candidate in (out, binaries):
        if "teruisi-runtime" in {part.lower() for part in candidate.parts}:
            parser.error("Production runtime paths are forbidden")
    out.mkdir(parents=True, exist_ok=False)
    data = out / "data"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert port != 5432
    allowed = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    password = secrets.token_hex(40)
    environment.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1")
    password_file = out / "password.txt"
    password_file.write_text(password, encoding="ascii")
    steps, checks = [], []
    started = stopped = False

    def run(label, arguments):
        with (out / (label + ".log")).open("xb") as log:
            result = subprocess.run([str(value) for value in arguments], env=environment,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=60,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        steps.append({"step": label, "exitCode": result.returncode})
        assert result.returncode == 0, label + " failed; see fixture log"

    try:
        run("initdb", [binaries / "initdb.exe", "-D", data, "-U", "provision_fixture",
                       "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", password_file])
        password_file.unlink()
        with (data / "postgresql.conf").open("a", encoding="ascii") as config:
            config.write(f"\nport={port}\nlisten_addresses='127.0.0.1'\nmax_connections=12\nshared_buffers='16MB'\n")
        run("start", [binaries / "pg_ctl.exe", "-D", data, "-l", out / "postgres.log", "-w", "-t", "30", "start"])
        started = True
        previous = os.environ.get("PGPASSWORD")
        try:
            os.environ["PGPASSWORD"] = password
            checks = verify(port, data)
        finally:
            if previous is None:
                os.environ.pop("PGPASSWORD", None)
            else:
                os.environ["PGPASSWORD"] = previous
    finally:
        password_file.unlink(missing_ok=True)
        if started:
            run("stop", [binaries / "pg_ctl.exe", "-D", data, "-m", "fast", "-w", "-t", "30", "stop"])
            stopped = True
        evidence = {"productionTouched": False, "nativeColdStart": False,
                    "syntheticTablesOnly": True, "port": port, "started": started,
                    "stopped": stopped, "checks": checks, "steps": steps}
        (out / "RESULT.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(evidence))


if __name__ == "__main__":
    main()
