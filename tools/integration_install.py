"""Explicit mixed-identity installation from a protected immutable source copy.

The PowerShell controller must hold the existing service mutex and maintenance
fence. This process also holds a database advisory lock, repeats filesystem and
database bindings at every step, and leaves unmatched intents on any failure.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

import psycopg
from psycopg import sql
from integration_migration_plan import build_plan, canonical, digest, load_policy, PlanBlocked, DELTA_VERSION
from integration_migration_journal import Journal, _write_new, apply_one
from integration_release_gate import (VERSION, POLICY, migration_digest, read_json,
    verify_backup_restore, verify_deployment, DELTA_POLICY, DELTA_RELEASE, DELTA_ACTIVE,
    delta_directory, verify_delta_deployment, require_delta_after_backup)

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(r"D:\teruisi-runtime\django-sales")
OWNER = "teruisi_sales_owner"
DATABASE = "teruisi_sales"
LOCK = 7843018267419


def apply_django_step(approved, journal, inspect, use_role):
    """The same execution engine is used by the disposable full-chain test."""
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    def execute(step, identity):
        use_role(identity == "privileged")
        MigrationExecutor(connection).migrate([tuple(step.split(".", 1))])
    return apply_one(journal, approved, inspect, execute)


def context(runtime, operation_id=None):
    if Path(runtime).resolve() != RUNTIME.resolve():
        raise PlanBlocked("formal installer runtime is not the fixed production root")
    if operation_id is not None:
        operation_root = delta_directory(RUNTIME, operation_id)
        plan, plan_sha = read_json(operation_root / "plan.json")
    else:
        plan, plan_sha = read_json(RUNTIME / "integration-install-plan.json")
        operation_root = RUNTIME / "integration-installs" / str(plan.get("operationId", ""))
    if ROOT != (operation_root / "source").resolve():
        raise PlanBlocked("formal installer must run from its protected source snapshot")
    verified = verify_delta_deployment(RUNTIME / "app", RUNTIME, operation_id, after_deployment=True) if operation_id else verify_deployment(RUNTIME / "app", RUNTIME, after_deployment=True)
    if verified != plan:
        raise PlanBlocked("installation plan changed while checking context")
    return operation_root, plan, plan_sha


def bootstrap(admin, policy, operation_root, binding):
    _write_new(operation_root / "bootstrap-intent.json", {"bindingSha256": binding,
        "roles": policy.bootstrap_roles})
    with admin.transaction():
        for name in policy.bootstrap_roles:
            row = admin.execute("SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,"
                "rolreplication,rolbypassrls,rolpassword IS NULL FROM pg_authid WHERE rolname=%s", [name]).fetchone()
            if row is None:
                admin.execute(sql.SQL("CREATE ROLE {} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB "
                    "NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL").format(sql.Identifier(name)))
            elif row != (False,)*7 + (True,):
                raise PlanBlocked("bootstrap role is not closed")
        if admin.execute("SELECT count(*) FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid "
                "JOIN pg_roles c ON c.oid=m.member WHERE p.rolname=ANY(%s) OR c.rolname=ANY(%s)",
                [list(policy.bootstrap_roles)]*2).fetchone() != (0,):
            raise PlanBlocked("bootstrap role has memberships")
    _write_new(operation_root / "bootstrap-outcome.json", {"bindingSha256": binding,
        "status": "committed", "roleCount": len(policy.bootstrap_roles)})


def install(runtime, operation_id=None):
    operation_root, approved, plan_sha = context(runtime, operation_id)
    delta = approved.get("generation") == DELTA_VERSION
    if bool(operation_id) != delta:
        raise PlanBlocked("installation generation must be explicitly selected")
    policy = load_policy(ROOT / (DELTA_POLICY if delta else POLICY))
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    original = dict(connection.settings_dict)
    if (original["NAME"] != DATABASE or original["USER"] != OWNER
            or original["HOST"] != "127.0.0.1" or int(original["PORT"]) != 5432):
        raise PlanBlocked("ordinary migration connection does not match the fixed database")
    secret = os.environ.pop("TERUISI_INTEGRATION_ADMIN_PASSWORD", "")
    if not secret:
        raise PlanBlocked("existing privileged credential is unavailable")
    try:
        with psycopg.connect(host="127.0.0.1", port=5432, dbname=DATABASE,
                user="postgres", password=secret, autocommit=True,
                application_name="teruisi_integration_installer",
                options="-c statement_timeout=900000 -c lock_timeout=10000") as admin:
            identity = admin.execute("SELECT current_database(),current_user,inet_server_port(),"
                "rolsuper FROM pg_roles WHERE rolname=current_user").fetchone()
            if identity != (DATABASE, "postgres", 5432, True):
                raise PlanBlocked("privileged migration identity changed")
            if admin.execute("SELECT pg_try_advisory_lock(%s)", [LOCK]).fetchone() != (True,):
                raise PlanBlocked("another integration installer owns the database lock")
            try:
                cluster = admin.execute("SELECT system_identifier::text FROM pg_control_system()").fetchone()[0]
                oid = admin.execute("SELECT oid FROM pg_database WHERE datname=current_database()").fetchone()[0]
                binding = digest({"plan": plan_sha, "cluster": cluster, "databaseOid": oid})

                def use_role(privileged=False):
                    connection.close()
                    connection.settings_dict.update(original)
                    if privileged:
                        connection.settings_dict.update(USER="postgres", PASSWORD=secret)
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT current_database(),current_user,inet_server_port(),"
                            "rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=current_user")
                        row = cursor.fetchone()
                        expected = (DATABASE, "postgres" if privileged else OWNER, 5432)
                        if row[:3] != expected or not privileged and any(row[3:]):
                            raise PlanBlocked("migration connection identity or privileges changed")

                def inspect():
                    _, current, current_sha = context(runtime, operation_id)
                    if current_sha != plan_sha or current != approved:
                        raise PlanBlocked("maintenance or installation binding changed")
                    use_role(False)
                    executor = MigrationExecutor(connection)
                    pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
                    return build_plan(policy, ROOT, sorted(MigrationRecorder(connection).applied_migrations()),
                        [(m.app_label,m.name,reverse) for m,reverse in pending], binding)

                before = inspect()
                if before.completed:
                    raise PlanBlocked("installer requires an untouched baseline; partial results need audit")
                directory = operation_root / "migration-journal"
                directory.mkdir()
                journal = Journal(directory, approved["operationId"], generation=policy.version,
                    baseline_witness=approved["operationWitness"] if delta else None)
                journal.initialize(before)
                if delta:
                    from postgres_no_key_backup import verify_closed_profile, role_contract
                    with admin.transaction():
                        verify_closed_profile(admin)
                        if digest(role_contract(admin)) != approved["operationWitness"]["rolesSha256"]:
                            raise PlanBlocked("delta ordinary/protected role witness changed")
                        admin.execute("SET LOCAL TIME ZONE 'UTC'")
                        hashes = admin.execute("SELECT sha256(convert_to(row_to_json(t)::text,'UTF8')) "
                            "FROM public.netshop_write_authority t ORDER BY 1").fetchall()
                        authority = hashlib.sha256(b''.join(value for (value,) in hashes)).hexdigest()
                        if authority != approved["operationWitness"]["authoritySha256"]:
                            raise PlanBlocked("delta authority witness changed")
                else:
                    bootstrap(admin, policy, operation_root, binding)
                models_before = admin.execute("SELECT id,model_type,max_total_tool_calls,version "
                    "FROM ai_models ORDER BY id").fetchall()
                while before.next_step:
                    before = apply_django_step(before, journal, inspect, use_role)
                expected = models_before if delta else [(key,kind,300 if kind in ("text","vision") and limit == 74 else limit,
                    version+1 if kind in ("text","vision") and limit == 74 else version)
                    for key,kind,limit,version in models_before]
                if admin.execute("SELECT id,model_type,max_total_tool_calls,version FROM ai_models ORDER BY id").fetchall() != expected:
                    raise PlanBlocked("model budget migration changed unexpected rows")
                from postgres_no_key_backup import verify_closed_profile
                with admin.transaction():
                    verify_closed_profile(admin)
                result = {"version": DELTA_RELEASE if delta else VERSION, "status": "schema_installed",
                    "operationId": approved["operationId"], "policySha256": policy.sha256,
                    "migrationSha256": migration_digest(ROOT), "bindingSha256": binding,
                    "journalCommittedSteps": len(before.completed), "journalSha256": journal.complete_digest(before),
                    "modelBudgetAndVersionsVerified": True}
                if delta:
                    result.update(generation=DELTA_VERSION,
                        baselineWitnessSha256=approved["baselineWitnessSha256"],
                        operationWitnessSha256=approved["operationWitnessSha256"])
                _write_new(operation_root / "evidence/installed.json", result)
                if delta:
                    _write_new(RUNTIME / "integration-active-generation.json", {
                        "version": DELTA_ACTIVE, "generation": DELTA_VERSION,
                        "operationId": approved["operationId"],
                        "installedSha256": hashlib.sha256(canonical(result)).hexdigest(),
                        "candidateManifestSha256": approved["candidateManifestSha256"]})
                return result
            finally:
                admin.execute("SELECT pg_advisory_unlock(%s)", [LOCK])
    finally:
        secret = None
        connection.close()
        connection.settings_dict.update(original)


def finalize(runtime, operation_id=None):
    operation_root, plan, _ = context(runtime, operation_id)
    delta = plan.get("generation") == DELTA_VERSION
    installed, installed_sha = read_json(operation_root / "evidence/installed.json")
    _, after_backup_sha = read_json(operation_root / "evidence/after-backup.json")
    _, after_restore_sha = read_json(operation_root / "evidence/after-restore.json")
    manifest = verify_backup_restore(operation_root / "evidence/after-backup.json", after_backup_sha,
        operation_root / "evidence/after-restore.json", after_restore_sha, protected=True)
    if manifest.get("software", {}).get("deploymentManifestSha256") != plan["candidateManifestSha256"]:
        raise PlanBlocked("post-install backup came from a different deployed application")
    if delta:
        require_delta_after_backup(manifest, plan["candidateManifestSha256"])
    if (installed.get("status") != "schema_installed" or installed.get("policySha256") != plan["policySha256"]
            or installed.get("migrationSha256") != plan["migrationSha256"]
            or installed.get("journalCommittedSteps") != (1 if delta else 76)):
        raise PlanBlocked("installation outcome is incomplete")
    receipt = {"version": DELTA_RELEASE if delta else VERSION, "status": "verified", "operationId": plan["operationId"],
        "migrationSha256": plan["migrationSha256"], "policySha256": plan["policySha256"],
        "installedSha256": installed_sha, "afterBackupSha256": after_backup_sha,
        "afterRestoreSha256": after_restore_sha}
    if delta:
        receipt.update(generation=DELTA_VERSION, baselineWitnessSha256=plan["baselineWitnessSha256"],
                       operationWitnessSha256=plan["operationWitnessSha256"])
    _write_new(operation_root / "release.json" if delta else RUNTIME / "integration-release.json", receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install", "finalize"))
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--operation-id")
    args = parser.parse_args()
    try:
        if not args.execute:
            raise PlanBlocked("explicit execution is required")
        result = install(args.runtime, args.operation_id) if args.action == "install" else finalize(args.runtime, args.operation_id)
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"status": "blocked", "errorType": type(error).__name__,
            "errorSha256": hashlib.sha256(str(error).encode()).hexdigest()}, separators=(",", ":")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
