"""Private real PostgreSQL gate comparison; no formal root/port/secrets.

Reuses the existing finite rehearsal's reviewed 143->149 setup statements.
The new adapter then verifies both full historical gates on the same synthetic
evidence, with only the fixed production identity replaced by an asserted
private cluster/role/port identity. It is not native service cold-start proof.
"""
import argparse
import hashlib
import inspect
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(os.environ.get("SCHEMA_TEST_SOURCE_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
HARNESS = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "backend"), str(HARNESS)]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")


def child(args):
    import pi_agent_rehearsal as existing
    # Exact setup prefix, retained as a separately hashed test dependency.
    prefix = inspect.getsource(existing.capture).split("    import pi_agent_catalog as pi_catalog\n", 1)[0]
    assert prefix.startswith("def capture():\n")
    setup_source = prefix.replace("def capture():", "def private_setup():", 1) + "    return connection,base149,provision\n"
    scope = dict(existing.__dict__)
    exec(compile(setup_source, "<reviewed-private-143-149-setup>", "exec"), scope)
    connection, base149, provision = scope["private_setup"]()
    import pi_agent_addition as pi
    import pi_agent_catalog as catalog
    with connection.cursor() as cursor:
        previous = catalog.preservation(cursor)
    pi.apply_steps(connection, base149, previous)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    provision(connection.connection, secrets.token_hex(32), secrets.token_hex(32))
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_sales_owner")
    pi.check_database(connection, base149)
    from schema_proof_fixture import ProofChain
    from schema_proof_probe import probe
    fixture = ProofChain(ROOT, Path(args.out) / "evidence-chain")
    results = []
    for sample in range(0 if args.skip_measurements else 3):
        for variant in ("baseline", "candidate"):
            env = dict(os.environ)
            env["PYTHONPATH"] = os.pathsep.join(([str(Path(args.baseline))] if variant == "baseline" else []) + [str(ROOT / "tools"), str(ROOT / "backend"), str(HARNESS)])
            for database in (False, True):
                command = [sys.executable, str(HARNESS / "schema_proof_probe.py"), "--root", str(fixture.root), "--runtime", str(fixture.runtime)]
                if database:
                    command += ["--database", "--private-data", str(Path(args.out) / "data"), "--private-port", os.environ["PGPORT"]]
                started = time.time()
                result = subprocess.run(command, env=env, cwd=ROOT, capture_output=True, timeout=900, creationflags=subprocess.CREATE_NO_WINDOW)
                name = f"{sample}-{variant}-{'database' if database else 'release'}"
                (Path(args.out) / (name + ".stdout.log")).write_bytes(result.stdout)
                (Path(args.out) / (name + ".stderr.log")).write_bytes(result.stderr)
                if result.returncode:
                    raise RuntimeError("Private gate failed: " + name)
                value = json.loads(result.stdout)
                value.update(sample=sample, variant=variant, startedUnix=started, finishedUnix=time.time())
                results.append(value)
                (Path(args.out) / "MEASUREMENTS.json").write_text(json.dumps(results, indent=2), encoding="utf8")
                print(json.dumps({k: value[k] for k in ("variant", "sample", "gate", "elapsedMs", "original139", "readBytes")}), flush=True)
    # Real catalogue, receipt, privilege and graph failures; each mutation rolls
    # back in this private cluster before the next case.
    from django.db import transaction
    from psycopg import sql
    checks = []
    class Rollback(Exception):
        pass
    def reject_sql(label, statement):
        rejected = False
        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("RESET ROLE")
                    cursor.execute(statement)
                    cursor.execute("SET ROLE teruisi_sales_owner")
                try:
                    pi.check_database(connection, base149)
                except (ValueError, RuntimeError):
                    rejected = True
                raise Rollback()
        except Rollback:
            pass
        with connection.cursor() as cursor:
            cursor.execute("SET ROLE teruisi_sales_owner")
        if not rejected:
            raise RuntimeError("Private negative accepted: " + label)
        pi.check_database(connection, base149)
        checks.append(label)
    reject_sql("missing-migration", "DELETE FROM django_migrations WHERE app='ai_assistant' AND name='0084_pi_agent_independent_runtime'")
    reject_sql("extra-migration", "INSERT INTO django_migrations(app,name,applied) VALUES('ai_assistant','9999_unknown',now())")
    reject_sql("missing-column", "ALTER TABLE ai_pi_sessions DROP COLUMN status CASCADE")
    with connection.cursor() as cursor:
        cursor.execute("SELECT i.indexname FROM pg_indexes i WHERE i.tablename='ai_pi_sessions' AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=to_regclass(i.indexname)) ORDER BY i.indexname LIMIT 1")
        index = cursor.fetchone()[0]
    reject_sql("missing-index", sql.SQL("DROP INDEX {}").format(sql.Identifier(index)))
    reject_sql("missing-permission", "REVOKE SELECT ON ai_pi_sessions FROM teruisi_ai_writer")
    from django.test.utils import override_settings
    with tempfile.TemporaryDirectory(prefix="pending-graph-", dir=args.out) as temporary:
        target = Path(temporary) / 'private_pending_migrations'
        target.mkdir()
        for file in (ROOT / "backend/ai_assistant/migrations").glob("*.py"):
            shutil.copyfile(file, target / file.name)
        (target / "0085_private_pending.py").write_text("from django.db import migrations\nclass Migration(migrations.Migration):\n dependencies=[('ai_assistant','0084_pi_agent_independent_runtime')]\n operations=[]\n", encoding="utf8")
        sys.path.insert(0, temporary)
        with override_settings(MIGRATION_MODULES={"ai_assistant": "private_pending_migrations"}):
            try:
                pi.check_database(connection, base149)
            except ValueError:
                checks.append("real-pending-graph")
            else:
                raise RuntimeError("Real pending graph was accepted")
        sys.path.remove(temporary)
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")
    try:
        probe(fixture.root, fixture.runtime, database=True, private_data=Path(args.out) / "data", private_port=int(os.environ["PGPORT"]), set_role=False)
    except ValueError as error:
        if str(error) != "Private schema gate identity changed":
            raise
        checks.append("wrong-role-rejected")
    else:
        raise RuntimeError("Wrong private role was accepted")
    connection.close()
    report = {"status": "passed", "productionTouched": False, "nativeColdStartPerformed": False,
        "setupSourceSha256": hashlib.sha256(setup_source.encode()).hexdigest(), "checks": checks,
        "measurements": results, "identitySeam": "Only fixed production data/port/db check replaced; real private cluster, owner and generation checks execute"}
    (Path(args.out) / "REPORT.json").write_text(json.dumps(report, indent=2), encoding="utf8")


def launch(args):
    directory = Path(args.out).resolve()
    if directory.exists():
        raise RuntimeError("Private output must be new")
    if not (directory.is_relative_to(Path(r"D:\codex-artifacts")) or directory.is_relative_to(Path(tempfile.gettempdir()).resolve())):
        raise RuntimeError("Private artifact root required")
    directory.mkdir()
    port = None
    for candidate in range(55531, 55540):
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", candidate))
            port = candidate
            break
        except OSError:
            pass
    if port is None:
        raise RuntimeError("No private port")
    password = secrets.token_hex(32)
    pwfile = directory / "password"
    pwfile.write_text(password, encoding="ascii")
    environment = {k: v for k, v in os.environ.items() if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
    environment.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="pi_fixture", PGPASSWORD=password,
        PGDATABASE="teruisi_pi_schema_rehearsal", PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
        DJANGO_SETTINGS_MODULE="teruisi_backend.settings", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development",
        TERUISI_DJANGO_DATABASE_URL=f"postgresql://pi_fixture:{password}@127.0.0.1:{port}/teruisi_pi_schema_rehearsal",
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32), DJANGO_SECRET_KEY=secrets.token_hex(32),
        PYTHONPATH=str(directory) + os.pathsep + str(ROOT / "backend"), PI_SCHEMA_REHEARSAL_DIR=str(directory), PI_SCHEMA_SOURCE_ROOT=str(ROOT), SCHEMA_TEST_SOURCE_ROOT=str(ROOT))
    (directory / "sitecustomize.py").write_text("import socket\n_original=socket.socket.connect\ndef connect(sock,address):\n if not isinstance(address,tuple) or address[0]!='127.0.0.1' or not 55531<=address[1]<=55539: raise RuntimeError('Private gate forbids external/production network')\n return _original(sock,address)\nsocket.socket.connect=connect\n", encoding="utf8")
    def command(arguments, label, timeout=600):
        with (directory / (label + ".log")).open("xb") as output:
            result = subprocess.run([str(x) for x in arguments], env=environment, cwd=ROOT, stdout=output, stderr=output,
                timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise RuntimeError(label + " failed; inspect private retained log")
    started = False
    try:
        command([BIN / "initdb.exe", "-D", directory / "data", "-U", "pi_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "init")
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=40\nshared_buffers=32MB\nmax_locks_per_transaction=256\n")
        command([BIN / "pg_ctl.exe", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start"], "start")
        started = True
        command([BIN / "createdb.exe", "teruisi_pi_schema_rehearsal"], "createdb")
        roles = ("teruisi_ai_seal_writer", "teruisi_sales_owner", "teruisi_ai_reader", "teruisi_ai_writer", "teruisi_inventory_reader", "teruisi_inventory_writer", "teruisi_bi_reader", "teruisi_finance_reader", "teruisi_finance_writer", "teruisi_netshop_reader", "teruisi_netshop_writer")
        for role in roles:
            command([BIN / "psql.exe", "-v", "ON_ERROR_STOP=1", "-c", f"CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"], role)
        command([sys.executable, __file__, "--child", "--out", directory, "--baseline", args.baseline] + (["--skip-measurements"] if args.skip_measurements else []), "gates", timeout=3600)
    finally:
        if started:
            command([BIN / "pg_ctl.exe", "-D", directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop")
        pwfile.unlink(missing_ok=True)
        environment.clear()
        if started and not (directory / "data/postmaster.pid").exists():
            shutil.rmtree(directory / "data")
        (directory / "CLEANUP.json").write_text(json.dumps({"stopped": started, "dataRemoved": not (directory / "data").exists(), "passwordRemoved": not pwfile.exists(), "port": port}), encoding="utf8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--child", action="store_true")
    parser.add_argument("--skip-measurements", action="store_true")
    args = parser.parse_args()
    child(args) if args.child else launch(args)
