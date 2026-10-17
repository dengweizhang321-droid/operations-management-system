"""Finite schema-only PiAgent child of the unchanged verified 149 generation.

The production lifecycle/mutex/credentials stay with bi-app-adopt.ps1. An
uncertain installation is never retried; reconcile only proves a committed150.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sys

import bi_app_addition as common
import tmall_warehouse_addition as parent
from jackyun_audit_addition import publish
from pi_agent_catalog import (FILES, STEPS, verify_catalog, verify_defaults,
    preservation, verify_initial_values)

VERSION = "teruisi-pi-agent-schema-addition-v1"
POLICY = "schema-only-no-full-backup-or-restore-v1"
ACTIVE = "pi-agent-addition-active.json"
CHECKS = {"atomic-upgrade", "rollback", "exact-149-150", "negative-catalogues",
          "defaults-empty", "permissions", "unknown-no-replay", "parent-source-binding",
          "legacy-data-preserved", "bad-evidence", "pointer-cas", "lifecycle-routing",
          "pi-state-fencing", "legacy-queue-isolation"}
CODE_FILES = tuple(dict.fromkeys((*parent.CODE_FILES,
    "tools/pi_agent_addition.py", "tools/pi_agent_catalog.py", "tools/pi_agent_catalog.json",

    "tools/pi_agent_candidate.py", "tools/main-schema-release.mjs", "tools/publish-prepared-main.mjs", "tools/pi_agent_prepare_runtime.py", "tools/django-ai.ps1",
    "tools/publish-main-command.mjs", "tools/manual-maintenance-start.ps1", "tools/manual-maintenance-lock.psm1",
    "tools/manual-maintenance-continuation.mjs", "tools/manual-maintenance-continuation.ps1",
    "backend/ai_assistant/pi_health.py", "backend/ai_assistant/pi_models.py",
    "backend/ai_assistant/database_contract.py", "backend/ai_assistant/table_manifest.py",
    "backend/ai_assistant/pi_worker.py", "backend/ai_assistant/pi_service.py",
    "backend/ai_assistant/pi_gateway.py", "backend/ai_assistant/pi_exports.py",
    "backend/ai_assistant/pi_transport.py", "backend/ai_assistant/pi_selection.py",
    "backend/teruisi_backend/health.py",
    "tools/integration_migration_plan.py", "tools/integration_migration_journal.py",
    "tools/protected_ai_shadow_evidence_0073.py", "tools/django-integration-install.ps1",
    "config/integration-migration-policy-v3.json", "config/integration-migration-policy-v4-netshop-presence.json")))


def directory(runtime, operation):
    if not isinstance(operation, str) or not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise ValueError("Invalid PiAgent schema operation")
    return Path(runtime) / "pi-agent-additions" / operation


def steps_files(generation):
    if type(generation) is not int or generation != 149:
        raise ValueError("Only the exact verified149 parent is supported")
    return STEPS, FILES


def steps_for_base(base):
    if len(base) != 149 or set(base) & set(STEPS):
        raise ValueError("Pi150 parent migration membership differs")
    return STEPS


def source_delta(root, baseline):
    before, after = common.migrations(baseline), common.migrations(root)
    if (set(before) & set(FILES) or set(after) != set(before) | set(FILES)
            or any(after[p] != value for p, value in before.items())
            or any(after.get(p) != value for p, value in FILES.items())):
        raise ValueError("Only the exact reviewed149-to150 delta is supported")
    return common.digest(after)


def parent_proof(runtime, baseline):
    receipt, _, folder = parent.verify_active(baseline, runtime)
    previous, _ = parent.parent_proof(runtime, folder / "baseline")
    catalogue = previous | set(parent.steps_for_base(previous))
    if len(catalogue) != 149 or receipt["migrationCount"] != 149:
        raise ValueError("Pi150 requires its exact verified149 parent")
    steps_for_base(catalogue)
    return catalogue, common.sha(Path(runtime) / parent.ACTIVE)


def code_digest(root):
    return common.digest({name: common.sha(Path(root) / name) for name in CODE_FILES})


def source_inventory(root):
    """Exact shipped backend bytes, excluding the same caches/tests as CopyApp."""
    root = Path(root)
    result = {}
    for path in (root / "backend").rglob("*"):
        if not path.is_file() or path.suffix in {".pyc", ".pyo"}:
            continue
        relative = path.relative_to(root)
        if set(relative.parts) & {".runtime", "__pycache__", ".pytest_cache", ".mypy_cache", "tests"}:
            continue
        if any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (path, *path.parents)) or path.stat().st_nlink != 1:
            raise ValueError("Unsafe PiAgent source inventory")
        result[relative.as_posix()] = common.sha(path)
    if not result:
        raise ValueError("Missing PiAgent backend source inventory")
    result["config/jd-logistics-notifications.json"] = common.sha(root / "config/jd-logistics-notifications.json")
    result.update({name: common.sha(root / name) for name in CODE_FILES})
    return common.digest(result)


def admission(root, runtime, evidence, evidence_sha):
    value = common.read(evidence, evidence_sha)
    base, parent_sha = parent_proof(runtime, Path(runtime) / "app")
    steps, files = steps_files(len(base))
    required = {"version", "status", "predecessorSha256", "parentReferenceSha256", "migrationSha256",
                "steps", "stepFiles", "validation", "validationSha256", "codeSha256", "sourceSha256", "databasePolicy"}
    if (type(value) is not dict or set(value) != required or value["version"] != VERSION
            or value["status"] != "reviewed" or value["steps"] != list(steps)
            or value["stepFiles"] != files or value["databasePolicy"] != POLICY):
        raise ValueError("Exact reviewed PiAgent schema-only candidate is required")
    if (value["predecessorSha256"] != common.sha(Path(runtime) / "app/deployment.json")
            or value["parentReferenceSha256"] != parent_sha
            or value["migrationSha256"] != source_delta(root, Path(runtime) / "app")
            or value["codeSha256"] != code_digest(root) or value["sourceSha256"] != source_inventory(root)):
        raise ValueError("PiAgent candidate, exact predecessor or reviewed source changed")
    proof = common.read(value["validation"], value["validationSha256"])
    if (proof.get("version") != "pi-agent-private-postgres-v1" or proof.get("status") != "passed"
            or proof.get("productionTouched") is not False or proof.get("steps") != list(STEPS)
            or proof.get("generations") != [149, 150]
            or proof.get("parentVariants") != [[149, 150]]
            or proof.get("fullBackupOrRestorePerformed") is not False
            or proof.get("codeSha256") != value["codeSha256"]
            or proof.get("migrationSha256") != value["migrationSha256"]
            or set(proof.get("checks", [])) != CHECKS):
        raise ValueError("Bound PiAgent isolated structure, permission and negative proof is incomplete")
    return value


def prepared_binding(runtime, prepared_id, receipt_sha, candidate_sha):
    if not re.fullmatch(r"[0-9a-f]{32}", prepared_id or ""):
        raise ValueError("Exact PiAgent prepared application is required")
    receipt = common.read(Path(runtime) / ("app.prepare-" + prepared_id + ".json"), receipt_sha)
    expected = {"version", "id", "runtimeRoot", "predecessorManifestSha256", "candidateManifestSha256"}
    if (type(receipt) is not dict or set(receipt) != expected
            or receipt["version"] != "teruisi-django-prepared-app-v1" or receipt["id"] != prepared_id
            or Path(receipt["runtimeRoot"]) != Path(runtime)
            or receipt["candidateManifestSha256"] != candidate_sha
            or not common.HEX.fullmatch(receipt["predecessorManifestSha256"])):
        raise ValueError("PiAgent prepared receipt identity changed")
    if not common.HEX.fullmatch(candidate_sha or ""):
        raise ValueError("Invalid PiAgent candidate manifest hash")
    return receipt


def load_plan(runtime, operation):
    folder = directory(runtime, operation)
    if any(folder.glob("*.tmp")) or any(Path(runtime).glob(ACTIVE + ".*.tmp")):
        raise ValueError("Uncertain PiAgent evidence publication; preserve temporary files")
    plan = common.read(folder / "plan.json")
    base, parent_sha = parent_proof(runtime, folder / "baseline")
    if (plan.get("version") != VERSION or plan.get("operationId") != operation
            or plan.get("steps") != list(steps_for_base(base)) or plan.get("databasePolicy") != POLICY):
        raise ValueError("PiAgent plan identity changed")
    evidence = common.read(folder / "candidate.json", plan["candidateEvidenceSha256"])
    if (parent_sha != plan["parentReferenceSha256"]
            or any(plan.get(key) != value for key, value in evidence.items() if key != "status")
            or common.sha(folder / "baseline/deployment.json") != plan["predecessorSha256"]):
        raise ValueError("PiAgent plan no longer matches exact parent or review")
    prepared = prepared_binding(runtime, plan["preparedAppId"], plan["preparedReceiptSha256"], plan["candidateManifestSha256"])
    if prepared["predecessorManifestSha256"] != plan["predecessorSha256"]:
        raise ValueError("PiAgent prepared predecessor differs from plan")
    return folder, plan


def verify_active(root, runtime, *, installed=False):
    pointer = common.read(Path(runtime) / ACTIVE)
    if (type(pointer) is not dict or set(pointer) != {"version", "operationId", "receiptSha256", "parentReferenceSha256"}
            or pointer["version"] != VERSION):
        raise ValueError("Invalid PiAgent schema active reference")
    folder, plan = load_plan(runtime, pointer["operationId"])
    receipt = common.read(folder / ("installed.json" if installed else "finalized.json"), pointer["receiptSha256"])
    intent = install_intent(folder)
    if (pointer["parentReferenceSha256"] != plan["parentReferenceSha256"]
            or receipt.get("version") != VERSION or receipt.get("status") != ("schema_installed" if installed else "verified")
            or receipt.get("planSha256") != common.sha(folder / "plan.json")
            or receipt.get("steps") != plan["steps"] or receipt.get("migrationCount") != 150
            or receipt.get("migrationSha256") != source_delta(root, folder / "baseline")
            or receipt["migrationSha256"] != plan["migrationSha256"]
            or receipt.get("legacyDataPreserved") is not True or receipt.get("defaultsEmpty") is not True
            or receipt.get("preservation") != intent["preservation"]
            or receipt.get("installIntentSha256") != common.sha(folder / "install-intent.json")
            or receipt.get("databasePolicy") != POLICY or not installed and receipt.get("permissionsVerified") is not True):
        raise ValueError("PiAgent schema receipt is incomplete or changed")
    return receipt, plan, folder


def database_identity(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", "127.0.0.1", 5432):
            raise ValueError("PiAgent schema database identity changed")


def apply_steps(connection, base, expected):
    from django.db import transaction
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    steps = steps_for_base(base)
    targets = [tuple(STEPS[-1].split(".", 1))]
    with transaction.atomic(using=connection.alias):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(150,20261017)")
            if cursor.fetchone() != (True,):
                raise ValueError("Another PiAgent schema migration owner is active")
            if verify_receipt_generation(cursor) != len(base):
                raise ValueError("PiAgent schema requires exact149; never replay")
            cursor.execute("LOCK TABLE public.ai_models IN SHARE MODE")
            if preservation(cursor) != expected:
                raise ValueError("PI150 legacy rows or permissions changed after intent")
            verify_catalog(cursor, installed=False)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base):
            raise ValueError("PiAgent parent migration catalogue changed")
        executor = MigrationExecutor(connection)
        pending = [(".".join((step.app_label, step.name)), reverse) for step, reverse in executor.migration_plan(targets)]
        if pending != [(step, False) for step in steps]:
            raise ValueError("Only the exact reviewed finite forward migration chain may execute")
        verify_defaults(executor.loader.project_state(targets).apps)
        for target in [tuple(step.split(".", 1)) for step in steps]:
            MigrationExecutor(connection).migrate([target])
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base)):
            raise ValueError("Unexpected PiAgent schema migration result")
        with connection.cursor() as cursor:
            if verify_receipt_generation(cursor, jd_permissions=False) != 150:
                raise ValueError("PiAgent schema result is not exact150")
            verify_catalog(cursor, permissions=False)
            verify_initial_values(cursor)
            if preservation(cursor) != expected:
                raise ValueError("PI150 changed existing AI rows or permissions")


def install_intent(folder):
    value = common.read(Path(folder) / "install-intent.json")
    state = value.get("preservation")
    if (type(value) is not dict or set(value) != {"version", "planSha256", "at", "preservation"}
            or value["version"] != VERSION or value["planSha256"] != common.sha(Path(folder) / "plan.json")
            or type(state) is not dict or set(state) != {"rows", "legacyRowsSha256", "permissionsSha256"}
            or type(state["rows"]) is not int or not 0 <= state["rows"] <= 500000
            or any(not isinstance(state[key], str) or not common.HEX.fullmatch(state[key])
                   for key in ("legacyRowsSha256", "permissionsSha256"))):
        raise ValueError("PI150 unknown intent binding changed; no replay")
    return value


def publish_installed(runtime, operation, folder, plan):
    intent = install_intent(folder)
    value = {"version": VERSION, "status": "schema_installed", "steps": plan["steps"], "migrationCount": 150,
        "migrationSha256": plan["migrationSha256"], "planSha256": common.sha(folder / "plan.json"),
        "legacyDataPreserved": True, "preservation": intent["preservation"],
        "installIntentSha256": common.sha(folder / "install-intent.json"),
        "defaultsEmpty": True, "databasePolicy": POLICY}
    file = folder / "installed.json"
    if file.exists():
        if common.read(file) != value:
            raise ValueError("PiAgent original installed receipt differs")
    else:
        publish(file, value)
    pointer = {"version": VERSION, "operationId": operation, "receiptSha256": common.sha(file),
               "parentReferenceSha256": plan["parentReferenceSha256"]}
    active = Path(runtime) / ACTIVE
    if active.exists():
        if common.read(active) != pointer:
            raise ValueError("Another PiAgent schema operation owns active reference")
    else:
        publish(active, pointer)
    return value


def check_database(connection, base, *, permissions=True, empty=False, expected=None):
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor, jd_permissions=permissions) != 150:
            raise ValueError("PiAgent schema catalogue is incomplete")
        verify_catalog(cursor, permissions=permissions)
        if empty:
            verify_initial_values(cursor)
        if expected is not None and preservation(cursor) != expected:
            raise ValueError("PI150 legacy data or permissions differ from original intent")
    executor = MigrationExecutor(connection)
    if ({".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base))
            or executor.migration_plan(executor.loader.graph.leaf_nodes())):
        raise ValueError("Pending or unknown migrations; ordinary PiAgent startup cannot migrate")
    verify_defaults(executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps)


def complete_database(root, runtime):
    receipt, _, folder = verify_active(root, runtime)
    base, _ = parent_proof(runtime, folder / "baseline")
    from django.db import connection
    database_identity(connection)
    check_database(connection, base, permissions=True)
    return {"status": "complete", "migrationCount": receipt["migrationCount"]}


def install_schema(command, connection, runtime, operation, folder, plan, base):
    from postgres_no_key_backup import verify_receipt_generation
    intent_file = folder / "install-intent.json"
    if command == "reconcile":
        intent = install_intent(folder)
        check_database(connection, base, empty=True, expected=intent["preservation"])
        return publish_installed(runtime, operation, folder, plan)
    with connection.cursor() as cursor:
        generation = verify_receipt_generation(cursor)
    if intent_file.exists() or (runtime / ACTIVE).exists() or generation != len(base):
        raise ValueError("PiAgent install intent/result exists; reconcile without replay")
    with connection.cursor() as cursor:
        state = preservation(cursor)
    publish(intent_file, {"version": VERSION, "planSha256": common.sha(folder / "plan.json"),
                          "at": datetime.now(timezone.utc).isoformat(), "preservation": state})
    apply_steps(connection, base, state)
    return publish_installed(runtime, operation, folder, plan)


def main(args):
    root, runtime = Path(args.root).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed PiAgent schema runtime is required")
    if args.command == "admission":
        return admission(root, runtime, args.evidence, args.evidence_sha)
    if args.command in {"release", "successor"}:
        return verify_active(root, runtime)[0]
    if args.command != "deployment" and (not args.execute or not args.schema_only):
        raise ValueError("Explicit schema-only PiAgent adoption execution required")
    if args.command == "plan":
        evidence = admission(root, runtime, args.evidence, args.evidence_sha)
        window_sha = common.maintenance(runtime, args.maintenance)
        prepared = prepared_binding(runtime, args.prepared_id, args.prepared_receipt_sha, args.candidate_sha)
        if prepared["predecessorManifestSha256"] != evidence["predecessorSha256"]:
            raise ValueError("PiAgent prepared predecessor differs from evidence")
        folder = directory(runtime, args.operation)
        if folder.exists() or (runtime / ACTIVE).exists():
            raise ValueError("PiAgent schema operation already exists")
        folder.mkdir(parents=True)
        shutil.copytree(runtime / "app", folder / "baseline", ignore=shutil.ignore_patterns(".wrangler", "runtime-tools", "__pycache__"))
        shutil.copyfile(args.evidence, folder / "candidate.json")
        plan = {**evidence, "status": "prepared", "operationId": args.operation, "maintenanceId": args.maintenance,
            "maintenanceSha256": window_sha, "candidateManifestSha256": args.candidate_sha,
            "candidateEvidenceSha256": args.evidence_sha, "preparedAppId": args.prepared_id,
            "preparedReceiptSha256": args.prepared_receipt_sha}
        publish(folder / "plan.json", plan)
        return {"status": "prepared", "planSha256": common.sha(folder / "plan.json")}
    folder, plan = load_plan(runtime, args.operation)
    if (common.maintenance(runtime, plan["maintenanceId"]) != plan["maintenanceSha256"]
            or args.maintenance and args.maintenance != plan["maintenanceId"]
            or source_delta(root, folder / "baseline") != plan["migrationSha256"]
            or code_digest(root) != plan["codeSha256"] or source_inventory(root) != plan["sourceSha256"]):
        raise ValueError("PiAgent maintenance or exact candidate source changed")
    if args.command == "deployment":
        if (common.sha(root / "deployment.json") != plan["candidateManifestSha256"]
                or common.sha(runtime / "app/deployment.json") != plan["predecessorSha256"]):
            raise ValueError("PiAgent deployment binding changed")
        return plan
    if common.sha(runtime / "app/deployment.json") != plan["candidateManifestSha256"]:
        raise ValueError("Installed application differs from PiAgent plan")
    sys.path.insert(0, str(root / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
    import django
    django.setup()
    from django.db import connection
    from postgres_no_key_backup import verify_receipt_generation
    database_identity(connection)
    base, _ = parent_proof(runtime, folder / "baseline")
    if args.command in {"install", "reconcile"}:
        return install_schema(args.command, connection, runtime, args.operation, folder, plan, base)
    if args.command == "finalize":
        pointer = runtime / ACTIVE
        pointer_sha = common.sha(pointer)
        if (folder / "finalized.json").exists() and common.read(pointer).get("receiptSha256") == common.sha(folder / "finalized.json"):
            result, _, active_folder = verify_active(root, runtime)
            if active_folder != folder:
                raise ValueError("Another PiAgent operation owns finalization")
            check_database(connection, base, empty=True, expected=install_intent(folder)["preservation"])
            return result
        receipt, _, active_folder = verify_active(root, runtime, installed=True)
        if active_folder != folder:
            raise ValueError("Another PiAgent operation owns installation")
        check_database(connection, base, empty=True, expected=install_intent(folder)["preservation"])
        result = {**receipt, "status": "verified", "permissionsVerified": True}
        final = folder / "finalized.json"
        if final.exists():
            if common.read(final) != result:
                raise ValueError("Interrupted PiAgent finalization differs")
        else:
            publish(final, result)
        publish(pointer, {"version": VERSION, "operationId": args.operation, "receiptSha256": common.sha(final),
                          "parentReferenceSha256": plan["parentReferenceSha256"]}, previous=pointer_sha)
        return result
    raise ValueError("Unknown PiAgent schema operation")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["admission", "plan", "deployment", "install", "reconcile", "finalize", "release", "successor"])
    for name in ("root", "runtime", "operation", "maintenance", "evidence", "evidence-sha", "candidate-sha", "prepared-id", "prepared-receipt-sha"):
        parser.add_argument("--" + name, default="")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--schema-only", action="store_true")
    try:
        print(json.dumps({"status": "verified", "result": main(parser.parse_args())}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}, ensure_ascii=True))
        sys.exit(1)
