"""Probe the integrated migration chain with a real unprivileged owner.

Uses only a fresh synthetic PostgreSQL cluster in this worktree. A failed
migration is reported with SQLSTATE and catalog/receipt rollback checks;
native errors, passwords and connection URLs are not printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
BASELINE = "108fed614c2f03f26caf4cf169a26ea3d48609ee"
DATABASE = "teruisi_integration_role_probe"
OWNER = "teruisi_sales_owner"
ADMIN = "ai_rehearsal_admin"
CLOSED_ROLES = (
    "teruisi_ai_market_attestor", "teruisi_ai_budget_v10_attestor",
    "teruisi_ai_market_context_attestor", "teruisi_ai_market_read_attestor",
    "teruisi_ai_market_plan_attestor", "teruisi_ai_market_synthetic_attestor",
    "teruisi_ai_market_cost_attestor", "teruisi_ai_budget_v11_attestor",
    "teruisi_ai_budget_v11_key_owner", "teruisi_ai_budget_v11_publisher",
    "teruisi_ai_market_paid_adopter", "teruisi_ai_market_paid_reserver",
    "teruisi_ai_market_paid_starter", "teruisi_ai_budget_v11_attest_login",
    "teruisi_ai_budget_v11_sign_login", "teruisi_ai_budget_v11_publish_login",
    "teruisi_ai_market_rate_proposer", "teruisi_ai_market_cap_proposer",
    "teruisi_ai_market_proposal_revoker", "teruisi_ai_budget_v11_attestor_v2_login",
    "teruisi_ai_market_v6_topology_login", "teruisi_ai_budget_v11_download_v2_login",
    "teruisi_ai_market_v6_source_login",
)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
        ensure_ascii=True, default=str).encode("ascii")


def baseline_targets():
    output = subprocess.check_output(["git", "ls-tree", "-r", "--name-only",
        BASELINE, "backend"], cwd=ROOT, text=True)
    targets = {}
    for name in output.splitlines():
        parts = name.split("/")
        if (len(parts) == 4 and parts[2] == "migrations"
                and parts[3][:4].isdigit() and parts[3].endswith(".py")):
            targets[parts[1]] = max(targets.get(parts[1], ""), parts[3][:-3])
    if targets.get("ai_assistant", "")[:4] != "0013":
        raise RuntimeError("pinned baseline migration inventory changed")
    return sorted(targets.items())


def worker(stage, port, privileged_steps, reviewed_policy):
    from urllib.parse import urlparse
    connection_url = os.environ.get("TERUISI_DJANGO_DATABASE_URL", "")
    parsed = urlparse(connection_url)
    if (os.environ.get("TERUISI_DJANGO_ENVIRONMENT") != "test"
            or parsed.hostname != "127.0.0.1" or parsed.port != port
            or parsed.path != "/" + DATABASE or parsed.username != OWNER
            or not 55440 <= port <= 55999):
        raise RuntimeError("synthetic worker identity mismatch")
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    passwords = {OWNER: parsed.password,
        ADMIN: os.environ["TERUISI_SYNTHETIC_PROBE_ADMIN_PASSWORD"]}

    def use_role(role):
        if role not in passwords:
            raise RuntimeError("unknown synthetic role")
        connection.close()
        connection.settings_dict["USER"] = role
        connection.settings_dict["PASSWORD"] = passwords[role]
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_user,inet_server_port()")
            if cursor.fetchone() != (DATABASE, role, port):
                raise RuntimeError("migration role switch changed database identity")

    def state():
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_user,"
                "inet_server_port(),rolsuper,rolcreaterole,rolcreatedb,rolbypassrls "
                "FROM pg_roles WHERE rolname=current_user")
            if cursor.fetchone() != (DATABASE, OWNER, port, False, False, False, False):
                raise RuntimeError("ordinary role gained privileges or changed identity")
            cursor.execute("SELECT c.relname,c.relkind,c.relowner::regrole::text,"
                "c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE n.nspname='public' ORDER BY c.relname")
            relations = cursor.fetchall()
            cursor.execute("SELECT p.proname,pg_get_function_identity_arguments(p.oid),"
                "p.proowner::regrole::text,p.prosrc,p.proacl::text FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' "
                "ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)")
            functions = cursor.fetchall()
            cursor.execute("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
                "rolcreaterole,rolreplication,rolbypassrls FROM pg_roles "
                "WHERE rolname LIKE 'teruisi_%' ORDER BY rolname")
            roles = cursor.fetchall()
            cursor.execute("SELECT p.rolname,m.rolname,a.admin_option FROM pg_auth_members a "
                "JOIN pg_roles p ON p.oid=a.roleid JOIN pg_roles m ON m.oid=a.member "
                "WHERE p.rolname LIKE 'teruisi_%' OR m.rolname LIKE 'teruisi_%' "
                "ORDER BY p.rolname,m.rolname")
            members = cursor.fetchall()
            cursor.execute("SELECT id,model_type,max_total_tool_calls,version FROM ai_models "
                "ORDER BY id")
            models = cursor.fetchall()
        receipts = sorted(MigrationRecorder(connection).applied_migrations())
        return {"receipts": receipts, "catalogSha256": hashlib.sha256(
            canonical([relations, functions, roles, members])).hexdigest(),
            "models": models, "roleMembers": members}

    executor = MigrationExecutor(connection)
    if stage == "baseline":
        targets = baseline_targets()
        targets.extend(node for node in executor.loader.graph.leaf_nodes()
            if node[0] == "contenttypes")
        executor.migrate(targets)
        if os.environ.get("TERUISI_SYNTHETIC_BASELINE_RUNTIME_GRANTS") == "1":
            # Execute the exact upstream baseline contract against this fresh
            # synthetic cluster. Existing runtime grants matter during upgrade.
            import types
            import psycopg
            blob = subprocess.check_output(["git", "show", BASELINE +
                ":backend/ai_assistant/database_contract.py"], cwd=ROOT)
            old_contract = types.ModuleType("ai_assistant._pinned_baseline_contract")
            old_contract.__package__ = "ai_assistant"
            exec(compile(blob, "pinned-baseline-ai-contract.py", "exec"), old_contract.__dict__)
            with psycopg.connect(host="127.0.0.1", port=port, dbname=DATABASE,
                    user=ADMIN, password=passwords[ADMIN]) as admin:
                old_contract.provision(admin, secrets.token_hex(32), secrets.token_hex(32))
        from ai_assistant.models import AiModels
        for model_type in ("text", "vision", "image"):
            AiModels.objects.create(id="integration-probe-" + model_type,
                name="Synthetic migration fixture", protocol="openai_compatible",
                model_type=model_type, model_name="synthetic-fixture", status="disabled",
                max_total_tool_calls=74, version=5)
        result = {"status": "baseline_created", "state": state(),
            "pinnedBaselineRuntimeGrants": os.environ.get("TERUISI_SYNTHETIC_BASELINE_RUNTIME_GRANTS") == "1"}
    elif stage == "files":
        from django.test import Client
        from ai_assistant.test_business_files import BusinessFileTests
        fixture = BusinessFileTests("test_actual_pair_persists_and_downloads_with_no_new_source_or_model_calls")
        fixture.client = Client()
        try:
            fixture.setUp()
            fixture.test_actual_pair_persists_and_downloads_with_no_new_source_or_model_calls()
        finally:
            fixture.doCleanups()
        result = {"status": "synthetic_application_files_created", "productionWrites": False}
    elif stage == "runtime":
        import uuid
        import psycopg
        from django.test import override_settings
        from django.utils import timezone
        from ai_assistant import database_contract, health
        from ai_assistant.control_models import AiDataRevision, AiWriteAuthority, AiMigrationRun
        epoch = str(uuid.uuid4())
        synthetic_digest = hashlib.sha256(b"synthetic-runtime-authority-fixture").hexdigest()
        from sales.models import SalesDataRevision, SalesWriteAuthority
        for domain in ("sales", "erp"):
            SalesDataRevision.objects.get_or_create(domain=domain)
        SalesWriteAuthority.objects.filter(id=1).update(status="active",
            cutover_id="integration-runtime-synthetic", activated_at=timezone.now())
        from market.models import MarketDataRevision
        MarketDataRevision.objects.filter(domain="market", revision=0).update(
            revision=1, source_digest=synthetic_digest)
        adoption_id = "ai-apply-" + secrets.token_hex(16)
        # Explicit synthetic authority fixture for readiness only. This is not
        # a historical D1 migration or evidence about the production authority.
        revision = AiDataRevision.objects.get(domain="ai-assistant")
        AiDataRevision.objects.filter(domain=revision.domain).update(
            revision=max(revision.revision, 1), source_digest=synthetic_digest)
        AiMigrationRun.objects.create(id=adoption_id, mode="apply", status="verified",
            source_path_digest=synthetic_digest, source_snapshot_digest=synthetic_digest,
            target_snapshot_digest=synthetic_digest, source_counts={}, target_counts={})
        AiWriteAuthority.objects.filter(id=1, status="d1").update(status="postgres",
            authority_epoch=epoch, cutover_id="integration-runtime-synthetic",
            migration_verify_run_id=adoption_id, activated_at=timezone.now())
        passwords["teruisi_ai_reader"] = secrets.token_hex(32)
        passwords["teruisi_ai_writer"] = secrets.token_hex(32)
        with psycopg.connect(host="127.0.0.1", port=port, dbname=DATABASE,
                user=ADMIN, password=passwords[ADMIN], autocommit=True) as admin:
            database_contract.provision(admin, passwords["teruisi_ai_reader"],
                passwords["teruisi_ai_writer"])
        ready = {}
        for role in ("ai_reader", "ai_writer"):
            use_role("teruisi_" + role)
            with override_settings(DJANGO_PROCESS_ROLE=role,
                    AI_WRITE_AUTHORITY_EPOCH=epoch,
                    AI_WRITE_CUTOVER_ID="integration-runtime-synthetic"):
                ready[role] = health.check()["status"] == "ready"
        use_role(OWNER)
        result = {"status": "runtime_ready", "roles": ready,
            "syntheticAuthorityFixture": True, "productionWrites": False}
    else:
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
        completed = []
        initial = state()
        policy = None
        if reviewed_policy:
            from integration_migration_plan import build_plan, confirm_single_step, load_policy
            policy = load_policy(ROOT / "config/integration-migration-policy-v3.json")

        def current_plan():
            active = MigrationExecutor(connection)
            pending = active.migration_plan(active.loader.graph.leaf_nodes())
            return build_plan(policy, ROOT,
                sorted(MigrationRecorder(connection).applied_migrations()),
                [(item.app_label, item.name, backwards) for item, backwards in pending],
                os.environ["TERUISI_SYNTHETIC_PROBE_BINDING"])

        journal = None
        if policy is not None:
            from integration_migration_journal import Journal
            run_root = Path(os.environ["TERUISI_SYNTHETIC_PROBE_RUN_ROOT"])
            if (run_root.resolve().parent != (ROOT / ".runtime").resolve()
                    or not run_root.name.startswith("ai-pg-") or run_root.is_symlink()):
                raise RuntimeError("synthetic journal root identity changed")
            directory = run_root / "migration-journal"
            directory.mkdir()
            journal = Journal(directory, os.environ["TERUISI_SYNTHETIC_PROBE_BINDING"][:32])
            journal.initialize(current_plan())

        for migration, reverse in plan:
            if reverse:
                raise RuntimeError("probe cannot reverse a migration")
            before = state()
            step = [migration.app_label, migration.name]
            selected_role = (ADMIN if migration.app_label == "ai_assistant"
                and migration.name[:4] in privileged_steps else OWNER)
            approved = current_plan() if policy else None
            if approved is not None:
                if (approved.next_step != ".".join(step) or
                        approved.next_identity != ("privileged" if selected_role == ADMIN else "owner")):
                    raise RuntimeError("requested migration differs from reviewed policy")
            try:
                if journal:
                    from integration_install import apply_django_step
                    def inspect_step():
                        use_role(OWNER)
                        return current_plan()
                    verified = apply_django_step(approved, journal, inspect_step,
                        lambda privileged: use_role(ADMIN if privileged else OWNER))
                else:
                    use_role(selected_role)
                    MigrationExecutor(connection).migrate([tuple(step)])
            except Exception as error:
                cause = error
                while getattr(cause, "__cause__", None) is not None:
                    cause = cause.__cause__
                use_role(OWNER)
                after = state()
                result = {"status": "migration_blocked", "step": step,
                    "selectedRole": selected_role,
                    "errorType": type(error).__name__,
                    "sqlstate": getattr(cause, "sqlstate", None),
                    "messageSha256": hashlib.sha256(str(error).encode()).hexdigest(),
                    "rolledBack": before == after, "completed": completed,
                    "plan": [[m.app_label, m.name] for m, _ in plan],
                    "productionWrites": False}
                break
            use_role(OWNER)
            after = state()
            if set(map(tuple, after["receipts"])) - set(map(tuple, before["receipts"])) != {tuple(step)}:
                raise RuntimeError("migration applied an unexpected dependency")
            if approved is not None:
                confirm_single_step(approved, verified)
            completed.append(step)
        else:
            final = state()
            expected_models = [(identity, kind, 300 if kind in ("text", "vision") else cap,
                version + 1 if kind in ("text", "vision") else version)
                for identity, kind, cap, version in initial["models"]]
            if final["models"] != expected_models or final["roleMembers"]:
                raise RuntimeError("model migration effect or closed-role membership differs")
            result = {"status": "mixed_completed" if privileged_steps else "ordinary_completed",
                "completed": completed, "privilegedSteps": privileged_steps,
                "baselineReceiptCount": len(initial["receipts"]),
                "finalReceiptCount": len(final["receipts"]),
                "modelBudgetAndVersionsVerified": True,
                "ordinaryRoleStillUnprivileged": True,
                "reviewedPolicySha256": policy.sha256 if policy else None,
                "journalSha256": journal.complete_digest(current_plan()) if journal else None,
                "journalCommittedSteps": len(completed) if journal else 0,
                "productionInstallerEngineVerified": bool(journal),
                "pinnedBaselineRuntimeGrants": os.environ.get("TERUISI_SYNTHETIC_BASELINE_RUNTIME_GRANTS") == "1",
                "roleMemberships": 0, "productionWrites": False}
    print(json.dumps(result), flush=True)


def run_probe(port, preprovision, privileged_steps, restore_port, reviewed_policy, verify_runtime,
              baseline_runtime_grants=False):
    if (ROOT.resolve() == Path(r"D:\运营管理系统").resolve()
            or not 55440 <= port <= 55999):
        raise RuntimeError("probe requires an isolated worktree and test port")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))
    if reviewed_policy:
        from integration_migration_plan import load_policy, PRIVILEGED_STEPS
        policy = load_policy(ROOT / "config/integration-migration-policy-v3.json")
        policy.verify_source(ROOT)
        if (not preprovision or set(privileged_steps) != {key.split(".")[1][:4] for key in PRIVILEGED_STEPS}
                or set(policy.bootstrap_roles) != set(CLOSED_ROLES) | {"teruisi_ai_seal_writer"}):
            raise RuntimeError("role rehearsal differs from reviewed bootstrap policy")
    runtime = ROOT / ".runtime"
    runtime.mkdir(exist_ok=True)
    if runtime.is_symlink() or getattr(runtime, "is_junction", lambda: False)():
        raise RuntimeError("isolated runtime cannot be redirected")
    run_root = runtime / ("ai-pg-" + secrets.token_hex(6))
    run_root.mkdir()
    admin_password, owner_password = secrets.token_hex(32), secrets.token_hex(32)
    password_file = run_root / ".synthetic-password"
    password_file.write_text(admin_password, encoding="ascii")
    os.chmod(password_file, 0o600)
    env = {name: value for name, value in os.environ.items()
        if not name.startswith(("PG", "TERUISI_", "DJANGO_"))}
    env.update(PGHOST="127.0.0.1", PGPORT=str(port), PGUSER=ADMIN,
        PGPASSWORD=admin_password, PGDATABASE="postgres", PYTHONUTF8="1")

    def native(args, *, environment=None, timeout=300):
        logfile = run_root / ("native-" + secrets.token_hex(4) + ".log")
        with logfile.open("wb") as output:
            process = subprocess.run([str(arg) for arg in args], cwd=ROOT,
                env=environment or env, stdout=output, stderr=output,
                timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if process.returncode:
            raise RuntimeError("synthetic command failed; log=" + str(logfile))
        return logfile.read_text(encoding="utf-8", errors="replace")

    data = run_root / "data"
    started = False
    try:
        native([BIN / "initdb.exe", "-D", data, "-U", ADMIN,
            "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C",
            "--pwfile", password_file])
        password_file.unlink()
        with (data / "postgresql.conf").open("a", encoding="utf-8") as output:
            output.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=30\n")
        native([BIN / "pg_ctl.exe", "-D", data, "-l", run_root / "postgres.log",
            "-w", "-t", "30", "start"], timeout=60)
        started = True
        import psycopg
        from psycopg import sql
        with psycopg.connect(host="127.0.0.1", port=port, dbname="postgres",
                user=ADMIN, password=admin_password, autocommit=True) as admin:
            admin.execute(sql.SQL("CREATE ROLE {} LOGIN NOINHERIT NOSUPERUSER "
                "NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}").format(
                    sql.Identifier(OWNER), sql.Literal(owner_password)))
            admin.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(DATABASE), sql.Identifier(OWNER)))
            for name in ("teruisi_ai_reader", "teruisi_ai_writer",
                    "teruisi_finance_reader", "teruisi_finance_writer",
                    "teruisi_netshop_reader", "teruisi_netshop_writer",
                    "teruisi_ai_seal_writer"):
                admin.execute(sql.SQL("CREATE ROLE {} NOLOGIN NOINHERIT NOSUPERUSER "
                    "NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS").format(sql.Identifier(name)))
            if preprovision:
                for name in CLOSED_ROLES:
                    admin.execute(sql.SQL("CREATE ROLE {} NOLOGIN NOINHERIT NOSUPERUSER "
                        "NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL"
                        ).format(sql.Identifier(name)))
            cluster = admin.execute("SELECT system_identifier FROM pg_control_system()").fetchone()[0]
            database_oid = admin.execute("SELECT oid FROM pg_database WHERE datname=%s", [DATABASE]).fetchone()[0]
        django_env = {**env, "TERUISI_DJANGO_ENVIRONMENT": "test",
            "TERUISI_SYNTHETIC_BASELINE_RUNTIME_GRANTS": "1" if baseline_runtime_grants else "0",
            "TERUISI_SYNTHETIC_PROBE_RUN_ROOT": str(run_root),
            "TERUISI_DJANGO_PROCESS_ROLE": "development",
            "TERUISI_DJANGO_DATABASE_URL":
                f"postgresql://{OWNER}:{owner_password}@127.0.0.1:{port}/{DATABASE}",
            "DJANGO_SECRET_KEY": secrets.token_hex(32),
            "TERUISI_DJANGO_INTERNAL_SECRET": secrets.token_hex(32),
            "TERUISI_SYNTHETIC_PROBE_BINDING": hashlib.sha256(canonical({
                "cluster": cluster, "databaseOid": database_oid, "port": port,
                "runRoot": str(run_root), "environment": "test"})).hexdigest(),
            "TERUISI_SYNTHETIC_PROBE_ADMIN_PASSWORD": admin_password}
        stages = ["baseline", "probe"] + (["files"] if restore_port else []) + (["runtime"] if verify_runtime else [])
        migration_result = None
        for stage in stages:
            print(json.dumps({"stage": stage, "port": port,
                "runRoot": str(run_root), "productionWrites": False}), flush=True)
            args = [sys.executable, "-B", __file__, "--worker", stage, "--port", str(port)]
            for number in privileged_steps:
                args += ["--privileged-ai-step", number]
            if reviewed_policy:
                args += ["--use-reviewed-policy"]
            output = native(args, environment=django_env, timeout=900)
            payloads = [line for line in output.splitlines() if line.startswith("{")]
            if len(payloads) != 1:
                raise RuntimeError("synthetic worker must return one result object")
            result = json.loads(payloads[0])
            if stage == "probe":
                migration_result = result
            result["rehearsalScriptSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            result["migrationSourcesSha256"] = hashlib.sha256(canonical({
                str(path.relative_to(ROOT)).replace("\\", "/"):
                    hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted((ROOT / "backend").glob("*/migrations/*.py"))
            })).hexdigest()
            (run_root / (stage + ".json")).write_bytes(canonical(result))
            if stage == "probe" and restore_port and result["status"] != "mixed_completed":
                raise RuntimeError("restore requires a completed mixed migration rehearsal")
        if restore_port:
            print(json.dumps({"stage": "no_key_new_cluster_restore", "sourcePort": port,
                "targetPort": restore_port, "productionWrites": False}), flush=True)
            output = native([sys.executable, "-B", ROOT / "tools" /
                "integration-protected-restore-rehearsal.py", "--run-root", run_root,
                "--source-port", str(port), "--target-port", str(restore_port)],
                environment=django_env, timeout=900)
            print(output.strip(), flush=True)
        print(json.dumps({name: value for name, value in result.items()
            if name not in ("completed", "plan")}
            | {"completedCount": len((migration_result or {}).get("completed", []))}), flush=True)
    finally:
        password_file.unlink(missing_ok=True)
        if started:
            native([BIN / "pg_ctl.exe", "-D", data, "-m", "fast", "-w", "-t", "60", "stop"], timeout=90)
            print(json.dumps({"stage": "isolated_cluster_stopped", "port": port,
                "productionWrites": False}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--worker", choices=("baseline", "probe", "files", "runtime"))
    parser.add_argument("--restore-port", type=int)
    parser.add_argument("--preprovision-closed-roles", action="store_true")
    parser.add_argument("--use-reviewed-policy", action="store_true")
    parser.add_argument("--verify-runtime", action="store_true")
    parser.add_argument("--baseline-runtime-grants", action="store_true")
    parser.add_argument("--privileged-ai-step", action="append", default=[],
        choices=[f"{value:04}" for value in range(14, 80)] + ["0082"])
    args = parser.parse_args()
    if args.restore_port is not None and (not 55440 <= args.restore_port <= 55999
            or args.restore_port == args.port or args.worker):
        parser.error("restore requires a distinct isolated port on the parent runner")
    if args.worker:
        worker(args.worker, args.port, args.privileged_ai_step, args.use_reviewed_policy)
    else:
        run_probe(args.port, args.preprovision_closed_roles, args.privileged_ai_step,
            args.restore_port, args.use_reviewed_policy, args.verify_runtime, args.baseline_runtime_grants)


if __name__ == "__main__":
    main()
