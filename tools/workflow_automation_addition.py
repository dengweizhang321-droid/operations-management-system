"""Finite schema-only WorkflowAutomation child of the unchanged verified 154 generation.

This generation adopts two migrations already merged to main
(workflow.0009/0010, from the 京准通 B1 and 京东客服链 B4 feature work) into the
structure release chain. It is the first addition whose steps include a
RunPython: 0010 seeds three code-token registry rows into the table 0009
creates. The database policy is otherwise unchanged -- no full backup/restore,
no role grant, no business data.

The production lifecycle/mutex/credentials stay with bi-app-adopt.ps1. An
uncertain installation is never retried; reconcile only proves a committed156.
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
import sales_preflight_addition as parent
from jackyun_audit_addition import publish
from workflow_automation_catalog import (FILES, STEPS, verify_catalog, verify_defaults,
    preservation, verify_initial_values, verify_registry_rows)

VERSION = "teruisi-workflow-automation-schema-addition-v1"
POLICY = "schema-only-no-full-backup-or-restore-v1"
ACTIVE = "workflow-automation-addition-active.json"
CHECKS = {"python-syntax", "node-syntax", "powershell-syntax", "migration-closure"}
CODE_FILES = tuple(dict.fromkeys((*parent.CODE_FILES,
    "tools/workflow_automation_addition.py", "tools/workflow_automation_catalog.py",
    "tools/workflow_automation_catalog.json", "tools/workflow_automation_candidate.py",
    "backend/workflow/migrations/0009_automation_projection_b1.py",
    "backend/workflow/migrations/0010_customer_service_chain_modules.py",
    "backend/workflow/automation_models.py", "backend/workflow/automation_gates.py",
    "backend/workflow/automation_run_query.py", "backend/workflow/automation_run_views.py")))



def directory(runtime, operation):
    if not isinstance(operation, str) or not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise ValueError("Invalid WorkflowAutomation schema operation")
    return Path(runtime) / "workflow-automation-additions" / operation


def steps_files(generation):
    if type(generation) is not int or generation != 154:
        raise ValueError("Only the exact verified154 parent is supported")
    return STEPS, FILES


def steps_for_base(base):
    if len(base) != 154 or set(base) & set(STEPS):
        raise ValueError("Workflow156 parent migration membership differs")
    return STEPS


def source_delta(root, baseline):
    before, after = common.migrations(baseline), common.migrations(root)
    if (set(before) & set(FILES) or set(after) != set(before) | set(FILES)
            or any(after[p] != value for p, value in before.items())
            or any(after.get(p) != value for p, value in FILES.items())):
        raise ValueError("Only the exact reviewed154-to156 delta is supported")
    return common.digest(after)


def parent_proof(runtime, baseline):
    """Prove the exact verified154 parent against THIS generation's baseline.

    The baseline is a 154-era copy of the installed app, so the parent compares
    it with its own 153 baseline and sees exactly sales.0012 -- the repository's
    two adopted workflow migrations never enter the parent's delta.
    """
    receipt, _, folder, previous = parent._verify_active_with_base(baseline, runtime)
    catalogue = previous | set(parent.steps_for_base(previous))
    if len(catalogue) != 154 or receipt["migrationCount"] != 154:
        raise ValueError("Workflow156 requires its exact verified154 parent")
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
            raise ValueError("Unsafe WorkflowAutomation source inventory")
        result[relative.as_posix()] = common.sha(path)
    if not result:
        raise ValueError("Missing WorkflowAutomation backend source inventory")
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
            or value["status"] != "code-checked" or value["steps"] != list(steps)
            or value["stepFiles"] != files or value["databasePolicy"] != POLICY):
        raise ValueError("Exact code-checked WorkflowAutomation schema-only candidate is required")
    if (value["predecessorSha256"] != common.sha(Path(runtime) / "app/deployment.json")
            or value["parentReferenceSha256"] != parent_sha
            or value["migrationSha256"] != source_delta(root, Path(runtime) / "app")
            or value["codeSha256"] != code_digest(root) or value["sourceSha256"] != source_inventory(root)):
        raise ValueError("WorkflowAutomation candidate, exact predecessor or reviewed source changed")
    proof = common.read(value["validation"], value["validationSha256"])
    if (proof.get("version") != "workflow-automation-mandatory-code-checks-v1" or proof.get("status") != "code-checked"
            or proof.get("productionTouched") is not False or proof.get("functionalValidationPerformed") is not False or proof.get("steps") != list(STEPS)
            or proof.get("generations") != [154, 156]
            or proof.get("parentVariants") != [[154, 156]]
            or proof.get("fullBackupOrRestorePerformed") is not False
            or proof.get("codeSha256") != value["codeSha256"]
            or proof.get("migrationSha256") != value["migrationSha256"]
            or set(proof.get("checks", [])) != CHECKS):
        raise ValueError("Bound WorkflowAutomation mandatory code-check record is incomplete")
    return value


def prepared_binding(runtime, prepared_id, receipt_sha, candidate_sha):
    if not re.fullmatch(r"[0-9a-f]{32}", prepared_id or ""):
        raise ValueError("Exact WorkflowAutomation prepared application is required")
    receipt = common.read(Path(runtime) / ("app.prepare-" + prepared_id + ".json"), receipt_sha)
    expected = {"version", "id", "runtimeRoot", "predecessorManifestSha256", "candidateManifestSha256"}
    if (type(receipt) is not dict or set(receipt) != expected
            or receipt["version"] != "teruisi-django-prepared-app-v1" or receipt["id"] != prepared_id
            or Path(receipt["runtimeRoot"]) != Path(runtime)
            or receipt["candidateManifestSha256"] != candidate_sha
            or not common.HEX.fullmatch(receipt["predecessorManifestSha256"])):
        raise ValueError("WorkflowAutomation prepared receipt identity changed")
    if not common.HEX.fullmatch(candidate_sha or ""):
        raise ValueError("Invalid WorkflowAutomation candidate manifest hash")
    return receipt


def load_plan(runtime, operation):
    return _load_plan_with_base(runtime, operation)[:2]


def _load_plan_with_base(runtime, operation):
    folder = directory(runtime, operation)
    if any(folder.glob("*.tmp")) or any(Path(runtime).glob(ACTIVE + ".*.tmp")):
        raise ValueError("Uncertain WorkflowAutomation evidence publication; preserve temporary files")
    plan = common.read(folder / "plan.json")
    base, parent_sha = parent_proof(runtime, folder / "baseline")
    if (plan.get("version") != VERSION or plan.get("operationId") != operation
            or plan.get("steps") != list(steps_for_base(base)) or plan.get("databasePolicy") != POLICY):
        raise ValueError("WorkflowAutomation plan identity changed")
    evidence = common.read(folder / "candidate.json", plan["candidateEvidenceSha256"])
    if (parent_sha != plan["parentReferenceSha256"]
            or any(plan.get(key) != value for key, value in evidence.items() if key != "status")
            or common.sha(folder / "baseline/deployment.json") != plan["predecessorSha256"]):
        raise ValueError("WorkflowAutomation plan no longer matches exact parent or review")
    prepared = prepared_binding(runtime, plan["preparedAppId"], plan["preparedReceiptSha256"], plan["candidateManifestSha256"])
    if prepared["predecessorManifestSha256"] != plan["predecessorSha256"]:
        raise ValueError("WorkflowAutomation prepared predecessor differs from plan")
    return folder, plan, frozenset(base)


def verify_active(root, runtime, *, installed=False):
    return _verify_active_with_base(root, runtime, installed=installed)[:3]


def _verify_active_with_base(root, runtime, *, installed=False):
    pointer = common.read(Path(runtime) / ACTIVE)
    if (type(pointer) is not dict or set(pointer) != {"version", "operationId", "receiptSha256", "parentReferenceSha256"}
            or pointer["version"] != VERSION):
        raise ValueError("Invalid WorkflowAutomation schema active reference")
    folder, plan, base = _load_plan_with_base(runtime, pointer["operationId"])
    receipt = common.read(folder / ("installed.json" if installed else "finalized.json"), pointer["receiptSha256"])
    intent = install_intent(folder)
    if (pointer["parentReferenceSha256"] != plan["parentReferenceSha256"]
            or receipt.get("version") != VERSION or receipt.get("status") != ("schema_installed" if installed else "verified")
            or receipt.get("planSha256") != common.sha(folder / "plan.json")
            or receipt.get("steps") != plan["steps"] or receipt.get("migrationCount") != 156
            or receipt.get("migrationSha256") != source_delta(root, folder / "baseline")
            or receipt["migrationSha256"] != plan["migrationSha256"]
            or receipt.get("legacyDataPreserved") is not True or receipt.get("registrySeeded") is not True
            or receipt.get("preservation") != intent["preservation"]
            or receipt.get("installIntentSha256") != common.sha(folder / "install-intent.json")
            or receipt.get("databasePolicy") != POLICY or not installed and receipt.get("permissionsVerified") is not True):
        raise ValueError("WorkflowAutomation schema receipt is incomplete or changed")
    return receipt, plan, folder, base


def database_identity(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", "127.0.0.1", 5432):
            raise ValueError("WorkflowAutomation schema database identity changed")


def apply_steps(connection, base, expected):
    from django.db import transaction
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    steps = steps_for_base(base)
    targets = [tuple(step.split(".", 1)) for step in STEPS]
    with transaction.atomic(using=connection.alias):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(156,20261031)")
            if cursor.fetchone() != (True,):
                raise ValueError("Another WorkflowAutomation schema migration owner is active")
            if verify_receipt_generation(cursor) != len(base):
                raise ValueError("WorkflowAutomation schema requires exact154; never replay")
            if preservation(cursor) != expected:
                raise ValueError("Workflow156 legacy rows or permissions changed after intent")
            verify_catalog(cursor, installed=False)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base):
            raise ValueError("WorkflowAutomation parent migration catalogue changed")
        executor = MigrationExecutor(connection)
        pending = [(".".join((step.app_label, step.name)), reverse) for step, reverse in executor.migration_plan(targets)]
        if pending != [(step, False) for step in steps]:
            raise ValueError("Only the exact reviewed finite forward migration chain may execute")
        # The full leaf-node state, not just this generation's targets: the
        # inherited contract covers other apps' models (sales154's index among
        # them), and a targets-only state would not contain them. These two
        # steps are workflow's own leaves, so this is the same post-migration
        # state check_database verifies afterwards.
        verify_defaults(executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps)
        for target in [tuple(step.split(".", 1)) for step in steps]:
            MigrationExecutor(connection).migrate([target])
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base)):
            raise ValueError("Unexpected WorkflowAutomation schema migration result")
        with connection.cursor() as cursor:
            if verify_receipt_generation(cursor) != 156:
                raise ValueError("WorkflowAutomation schema result is not exact156")
            verify_catalog(cursor)
            verify_initial_values(cursor)
            verify_registry_rows(cursor)
            if preservation(cursor) != expected:
                raise ValueError("Workflow156 changed existing rows or permissions")


def install_intent(folder):
    value = common.read(Path(folder) / "install-intent.json")
    state = value.get("preservation")
    if (type(value) is not dict or set(value) != {"version", "planSha256", "at", "preservation"}
            or value["version"] != VERSION or value["planSha256"] != common.sha(Path(folder) / "plan.json")
            or type(state) is not dict or set(state) != {"rows", "legacyRowsSha256", "permissionsSha256"}
            or type(state["rows"]) is not int or not 0 <= state["rows"] <= 500000
            or any(not isinstance(state[key], str) or not common.HEX.fullmatch(state[key])
                   for key in ("legacyRowsSha256", "permissionsSha256"))):
        raise ValueError("Workflow156 unknown intent binding changed; no replay")
    return value


def publish_installed(runtime, operation, folder, plan):
    intent = install_intent(folder)
    value = {"version": VERSION, "status": "schema_installed", "steps": plan["steps"], "migrationCount": 156,
        "migrationSha256": plan["migrationSha256"], "planSha256": common.sha(folder / "plan.json"),
        "legacyDataPreserved": True, "preservation": intent["preservation"],
        "installIntentSha256": common.sha(folder / "install-intent.json"),
        "registrySeeded": True, "databasePolicy": POLICY}
    file = folder / "installed.json"
    if file.exists():
        if common.read(file) != value:
            raise ValueError("WorkflowAutomation original installed receipt differs")
    else:
        publish(file, value)
    pointer = {"version": VERSION, "operationId": operation, "receiptSha256": common.sha(file),
               "parentReferenceSha256": plan["parentReferenceSha256"]}
    active = Path(runtime) / ACTIVE
    if active.exists():
        if common.read(active) != pointer:
            raise ValueError("Another WorkflowAutomation schema operation owns active reference")
    else:
        publish(active, pointer)
    return value


def check_database(connection, base, *, permissions=True, seeded=False, expected=None):
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor, jd_permissions=permissions) != 156:
            raise ValueError("WorkflowAutomation schema catalogue is incomplete")
        verify_catalog(cursor, permissions=permissions)
        if seeded:
            verify_initial_values(cursor)
            verify_registry_rows(cursor)
        if expected is not None and preservation(cursor) != expected:
            raise ValueError("Workflow156 legacy data or permissions differ from original intent")
    executor = MigrationExecutor(connection)
    if ({".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base))
            or executor.migration_plan(executor.loader.graph.leaf_nodes())):
        raise ValueError("Pending or unknown migrations; ordinary WorkflowAutomation startup cannot migrate")
    verify_defaults(executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps)


def complete_database(root, runtime):
    receipt, _, folder, base = _verify_active_with_base(root, runtime)
    from django.db import connection
    database_identity(connection)
    check_database(connection, base, permissions=True)
    return {"status": "complete", "migrationCount": receipt["migrationCount"]}


def install_schema(command, connection, runtime, operation, folder, plan, base):
    from postgres_no_key_backup import verify_receipt_generation
    intent_file = folder / "install-intent.json"
    if command == "reconcile":
        intent = install_intent(folder)
        check_database(connection, base, seeded=True, expected=intent["preservation"])
        return publish_installed(runtime, operation, folder, plan)
    with connection.cursor() as cursor:
        generation = verify_receipt_generation(cursor)
    if intent_file.exists() or (runtime / ACTIVE).exists() or generation != len(base):
        raise ValueError("WorkflowAutomation install intent/result exists; reconcile without replay")
    with connection.cursor() as cursor:
        state = preservation(cursor)
    publish(intent_file, {"version": VERSION, "planSha256": common.sha(folder / "plan.json"),
                          "at": datetime.now(timezone.utc).isoformat(), "preservation": state})
    apply_steps(connection, base, state)
    return publish_installed(runtime, operation, folder, plan)


def main(args):
    root, runtime = Path(args.root).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed WorkflowAutomation schema runtime is required")
    if args.command == "admission":
        return admission(root, runtime, args.evidence, args.evidence_sha)
    if args.command in {"release", "successor"}:
        return verify_active(root, runtime)[0]
    if args.command != "deployment" and (not args.execute or not args.schema_only):
        raise ValueError("Explicit schema-only WorkflowAutomation adoption execution required")
    if args.command == "plan":
        evidence = admission(root, runtime, args.evidence, args.evidence_sha)
        window_sha = common.maintenance(runtime, args.maintenance)
        prepared = prepared_binding(runtime, args.prepared_id, args.prepared_receipt_sha, args.candidate_sha)
        if prepared["predecessorManifestSha256"] != evidence["predecessorSha256"]:
            raise ValueError("WorkflowAutomation prepared predecessor differs from evidence")
        folder = directory(runtime, args.operation)
        if folder.exists() or (runtime / ACTIVE).exists():
            raise ValueError("WorkflowAutomation schema operation already exists")
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
        raise ValueError("WorkflowAutomation maintenance or exact candidate source changed")
    if args.command == "deployment":
        if (common.sha(root / "deployment.json") != plan["candidateManifestSha256"]
                or common.sha(runtime / "app/deployment.json") != plan["predecessorSha256"]):
            raise ValueError("WorkflowAutomation deployment binding changed")
        return plan
    if common.sha(runtime / "app/deployment.json") != plan["candidateManifestSha256"]:
        raise ValueError("Installed application differs from WorkflowAutomation plan")
    sys.path.insert(0, str(root / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
    import django
    django.setup()
    from django.db import connection
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
                raise ValueError("Another WorkflowAutomation operation owns finalization")
            check_database(connection, base, seeded=True, expected=install_intent(folder)["preservation"])
            return result
        receipt, _, active_folder = verify_active(root, runtime, installed=True)
        if active_folder != folder:
            raise ValueError("Another WorkflowAutomation operation owns installation")
        check_database(connection, base, seeded=True, expected=install_intent(folder)["preservation"])
        result = {**receipt, "status": "verified", "permissionsVerified": True}
        final = folder / "finalized.json"
        if final.exists():
            if common.read(final) != result:
                raise ValueError("Interrupted WorkflowAutomation finalization differs")
        else:
            publish(final, result)
        publish(pointer, {"version": VERSION, "operationId": args.operation, "receiptSha256": common.sha(final),
                          "parentReferenceSha256": plan["parentReferenceSha256"]}, previous=pointer_sha)
        return result
    raise ValueError("Unknown WorkflowAutomation schema operation")


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
