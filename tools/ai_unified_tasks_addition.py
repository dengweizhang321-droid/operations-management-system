"""Finite schema-only AI0090 child of the unchanged verified158 generation.

One schema-only DDL migration executes in one transaction.
The migration creates no business rows and issues no grants. ProvisionRoles
runs after install and finalization requires its exact restricted writer
ACL, while AI reader has none. Production lifecycle/mutex/credentials stay with
bi-app-adopt.ps1; reconcile only proves already committed159 and never replays.
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
import ai_task_feedback_candidates_addition as parent
from jackyun_audit_addition import publish
from ai_unified_tasks_catalog import (FILES, STEPS, verify_catalog, verify_defaults,
    preservation, verify_initial_values)

VERSION = "teruisi-ai-unified-tasks-schema-addition-v1"
POLICY = "schema-only-no-full-backup-or-restore-v1"
ACTIVE = "ai-unified-tasks-addition-active.json"
CHECKS = {"python-syntax", "node-syntax", "powershell-syntax", "migration-closure"}
STRUCTURE_PROOF_VERSION = "teruisi-ai-unified-tasks-pg-structure-v1"
STRUCTURE_CHECKS = {
    "exact158-parent", "exact159-catalog", "new-tables-empty", "old-rows-and-ACL-preserved",
    "restricted-writer-zero-reader-grants", "disabled-native-FK-rejected-and-rolled-back",
    "committed159-not-replayed", "snapshot-backup-inventory158", "snapshot-backup-inventory159",
    "snapshot-backup-unreceipted0090-tables-rejected", "disabled-FK-ALTER-failure-propagates",
    "disabled-FK-SET-ROLE-failure-propagates", "unrelated-catalog-error-propagates",
}
CODE_FILES = tuple(dict.fromkeys((*parent.CODE_FILES,
    "tools/ai_unified_tasks_addition.py", "tools/ai_unified_tasks_catalog.py",
    "tools/ai_unified_tasks_catalog.json", "tools/ai_unified_tasks_candidate.py",
    "backend/ai_assistant/migrations/0090_unified_tasks.py",
    "backend/ai_assistant/task_models.py")))



def directory(runtime, operation):
    if not isinstance(operation, str) or not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise ValueError("Invalid AiUnifiedTasks schema operation")
    return Path(runtime) / "ai-unified-tasks-additions" / operation


def steps_files(generation):
    if type(generation) is not int or generation != 158:
        raise ValueError("Only the exact verified158 parent is supported")
    return STEPS, FILES


def steps_for_base(base):
    if len(base) != 158 or set(base) & set(STEPS):
        raise ValueError("AI159 parent migration membership differs")
    return STEPS


def source_delta(root, baseline):
    before, after = common.migrations(baseline), common.migrations(root)
    if (set(before) & set(FILES) or set(after) != set(before) | set(FILES)
            or any(after[p] != value for p, value in before.items())
            or any(after.get(p) != value for p, value in FILES.items())):
        raise ValueError("Only the exact reviewed158-to159 delta is supported")
    return common.digest(after)


def parent_proof(runtime, baseline):
    """Prove finalized158 against this generation's frozen158-era baseline.

    Pass baseline, never the new root: parent source_delta must see only its
    original156-to158 AI changes, without the new0090 migration.
    """
    receipt, _, folder, previous = parent._verify_active_with_base(baseline, runtime)
    catalogue = previous | set(parent.steps_for_base(previous))
    if len(catalogue) != 158 or receipt["migrationCount"] != 158:
        raise ValueError("AI159 requires its exact verified158 parent")
    steps_for_base(catalogue)
    return catalogue, common.sha(Path(runtime) / parent.ACTIVE)


def code_digest(root):
    return common.digest({name: common.sha(Path(root) / name) for name in CODE_FILES})


def verify_structure_evidence(root, validation):
    """G05: a real PG result and its exact structure inputs, separate from code checks."""
    root = Path(root)
    ref = validation.get("structureEvidence")
    expected_path = "docs/ai-p2-20261107/structure-result.json"
    if (type(ref) is not dict or set(ref) != {"path", "sha256"} or ref["path"] != expected_path
            or not isinstance(ref["sha256"], str) or not common.HEX.fullmatch(ref["sha256"])):
        raise ValueError("AI159 requires its SHA-bound real PostgreSQL structure proof")
    result = common.read(root / expected_path, ref["sha256"])
    if type(result) is not dict:
        raise ValueError("AI159 PostgreSQL structure proof must be an object")
    database = result.get("database")
    cleanup = result.get("cleanup")
    if (result.get("version") != STRUCTURE_PROOF_VERSION or result.get("status") != "passed"
            or result.get("generations") != [158, 159] or set(result.get("checks", [])) != STRUCTURE_CHECKS
            or result.get("productionTouched") is not False or result.get("fullBackupOrRestorePerformed") is not False
            or type(database) is not dict or set(database) != {"name", "user", "port", "serverVersionNumber"}
            or database["name"] != "teruisi_ai_unified_tasks_rehearsal" or database["user"] != "ai159_fixture"
            or type(database["port"]) is not int or not 55522 <= database["port"] < 55532
            or type(database["serverVersionNumber"]) is not int or not 170000 <= database["serverVersionNumber"] < 180000
            or type(cleanup) is not dict or set(cleanup) != {"started", "stopped", "privateDataRemoved", "passwordFileRemoved", "childExitZero"}
            or any(value is not True for value in cleanup.values())):
        raise ValueError("AI159 PostgreSQL result, generation, checks or cleanup is incomplete")
    files = result.get("sourceFiles")
    required = {"tools/ai_unified_tasks_rehearsal.py", "tools/ai_unified_tasks_addition.py",
        "tools/ai_unified_tasks_catalog.py", "tools/ai_unified_tasks_catalog.json", "tools/postgres-consistent-backup.py",
        "backend/ai_assistant/migrations/0090_unified_tasks.py", "backend/ai_assistant/task_models.py",
        "backend/ai_assistant/table_manifest.py", "backend/ai_assistant/database_contract.py", "backend/requirements.txt"}
    if (type(files) is not dict or not required <= set(files) or not len(required) <= len(files) <= 1024
            or result.get("sourceFilesSha256") != common.digest(files)):
        raise ValueError("AI159 PostgreSQL structure input set is incomplete")
    for name, expected in files.items():
        if (not isinstance(name, str) or "\\" in name or ":" in name or name.startswith("/")
                or any(part in {"", ".", ".."} for part in name.split("/"))
                or name.split("/", 1)[0] not in {"backend", "tools", "config"}
                or not isinstance(expected, str) or not common.HEX.fullmatch(expected)):
            raise ValueError("AI159 PostgreSQL structure input reference is invalid")
        source = root / name
        if (any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (source, *source.parents))
                or not source.is_file() or source.stat().st_nlink != 1 or source.stat().st_size > 16*1024*1024
                or common.sha(source) != expected):
            raise ValueError("AI159 PostgreSQL structure input changed; isolated PG rehearsal required: " + name)
    migrations = common.migrations(root)
    nodes = {Path(name).parts[1] + "." + Path(name).stem for name in migrations if Path(name).stem != "__init__"}
    nodes |= {"contenttypes.0001_initial", "contenttypes.0002_remove_content_type_name"}
    parent_nodes = nodes - set(STEPS)
    expected_receipts = {"158": {"count": 158, "sha256": common.digest(sorted(parent_nodes))},
                         "159": {"count": 159, "sha256": common.digest(sorted(nodes))}}
    if (len(nodes) != 159 or len(parent_nodes) != 158 or result.get("receiptGenerations") != expected_receipts
            or result.get("migrationSha256") != common.digest(migrations)):
        raise ValueError("AI159 PostgreSQL receipt catalogue or migration source differs")
    pins = dict(re.findall(r"^(Django|psycopg\[binary\])==([^\r\n]+)$", (root / "backend/requirements.txt").read_text(encoding="utf8"), re.M | re.I))
    pins = {key.lower(): value for key, value in pins.items()}
    versions = result.get("toolchain")
    if (type(versions) is not dict or set(versions) != {"django", "psycopg", "python"}
            or versions["django"] != pins.get("django") or versions["psycopg"] != pins.get("psycopg[binary]")
            or not isinstance(versions["python"], str) or not versions["python"]):
        raise ValueError("AI159 PostgreSQL rehearsal dependency versions differ from pinned source")
    return result


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
            raise ValueError("Unsafe AiUnifiedTasks source inventory")
        result[relative.as_posix()] = common.sha(path)
    if not result:
        raise ValueError("Missing AiUnifiedTasks backend source inventory")
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
        raise ValueError("Exact code-checked AiUnifiedTasks schema-only candidate is required")
    if (value["predecessorSha256"] != common.sha(Path(runtime) / "app/deployment.json")
            or value["parentReferenceSha256"] != parent_sha
            or value["migrationSha256"] != source_delta(root, Path(runtime) / "app")
            or value["codeSha256"] != code_digest(root) or value["sourceSha256"] != source_inventory(root)):
        raise ValueError("AiUnifiedTasks candidate, exact predecessor or reviewed source changed")
    proof = common.read(value["validation"], value["validationSha256"])
    if (proof.get("version") != "ai-unified-tasks-mandatory-code-checks-v1" or proof.get("status") != "code-checked"
            or proof.get("productionTouched") is not False or proof.get("functionalValidationPerformed") is not False or proof.get("steps") != list(STEPS)
            or proof.get("generations") != [158, 159]
            or proof.get("parentVariants") != [[158, 159]]
            or proof.get("fullBackupOrRestorePerformed") is not False
            or proof.get("codeSha256") != value["codeSha256"]
            or proof.get("migrationSha256") != value["migrationSha256"]
            or set(proof.get("checks", [])) != CHECKS):
        raise ValueError("Bound AiUnifiedTasks mandatory code-check record is incomplete")
    verify_structure_evidence(root, proof)
    return value


def prepared_binding(runtime, prepared_id, receipt_sha, candidate_sha):
    if not re.fullmatch(r"[0-9a-f]{32}", prepared_id or ""):
        raise ValueError("Exact AiUnifiedTasks prepared application is required")
    receipt = common.read(Path(runtime) / ("app.prepare-" + prepared_id + ".json"), receipt_sha)
    expected = {"version", "id", "runtimeRoot", "predecessorManifestSha256", "candidateManifestSha256"}
    if (type(receipt) is not dict or set(receipt) != expected
            or receipt["version"] != "teruisi-django-prepared-app-v1" or receipt["id"] != prepared_id
            or Path(receipt["runtimeRoot"]) != Path(runtime)
            or receipt["candidateManifestSha256"] != candidate_sha
            or not common.HEX.fullmatch(receipt["predecessorManifestSha256"])):
        raise ValueError("AiUnifiedTasks prepared receipt identity changed")
    if not common.HEX.fullmatch(candidate_sha or ""):
        raise ValueError("Invalid AiUnifiedTasks candidate manifest hash")
    return receipt


def load_plan(runtime, operation):
    return _load_plan_with_base(runtime, operation)[:2]


def _load_plan_with_base(runtime, operation):
    folder = directory(runtime, operation)
    if any(folder.glob("*.tmp")) or any(Path(runtime).glob(ACTIVE + ".*.tmp")):
        raise ValueError("Uncertain AiUnifiedTasks evidence publication; preserve temporary files")
    plan = common.read(folder / "plan.json")
    base, parent_sha = parent_proof(runtime, folder / "baseline")
    if (plan.get("version") != VERSION or plan.get("operationId") != operation
            or plan.get("steps") != list(steps_for_base(base)) or plan.get("databasePolicy") != POLICY):
        raise ValueError("AiUnifiedTasks plan identity changed")
    evidence = common.read(folder / "candidate.json", plan["candidateEvidenceSha256"])
    if (parent_sha != plan["parentReferenceSha256"]
            or any(plan.get(key) != value for key, value in evidence.items() if key != "status")
            or common.sha(folder / "baseline/deployment.json") != plan["predecessorSha256"]):
        raise ValueError("AiUnifiedTasks plan no longer matches exact parent or review")
    prepared = prepared_binding(runtime, plan["preparedAppId"], plan["preparedReceiptSha256"], plan["candidateManifestSha256"])
    if prepared["predecessorManifestSha256"] != plan["predecessorSha256"]:
        raise ValueError("AiUnifiedTasks prepared predecessor differs from plan")
    return folder, plan, frozenset(base)


def verify_active(root, runtime, *, installed=False):
    return _verify_active_with_base(root, runtime, installed=installed)[:3]


def _verify_active_with_base(root, runtime, *, installed=False):
    pointer = common.read(Path(runtime) / ACTIVE)
    if (type(pointer) is not dict or set(pointer) != {"version", "operationId", "receiptSha256", "parentReferenceSha256"}
            or pointer["version"] != VERSION):
        raise ValueError("Invalid AiUnifiedTasks schema active reference")
    folder, plan, base = _load_plan_with_base(runtime, pointer["operationId"])
    receipt = common.read(folder / ("installed.json" if installed else "finalized.json"), pointer["receiptSha256"])
    intent = install_intent(folder)
    if (pointer["parentReferenceSha256"] != plan["parentReferenceSha256"]
            or receipt.get("version") != VERSION or receipt.get("status") != ("schema_installed" if installed else "verified")
            or receipt.get("planSha256") != common.sha(folder / "plan.json")
            or receipt.get("steps") != plan["steps"] or receipt.get("migrationCount") != 159
            or receipt.get("migrationSha256") != source_delta(root, folder / "baseline")
            or receipt["migrationSha256"] != plan["migrationSha256"]
            or receipt.get("legacyDataPreserved") is not True
            or receipt.get("preservation") != intent["preservation"]
            or receipt.get("installIntentSha256") != common.sha(folder / "install-intent.json")
            or receipt.get("databasePolicy") != POLICY or not installed and receipt.get("permissionsVerified") is not True):
        raise ValueError("AiUnifiedTasks schema receipt is incomplete or changed")
    return receipt, plan, folder, base


def database_identity(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", "127.0.0.1", 5432):
            raise ValueError("AiUnifiedTasks schema database identity changed")


def apply_steps(connection, base, expected):
    from django.db import transaction
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    steps = steps_for_base(base)
    targets = [tuple(step.split(".", 1)) for step in STEPS]
    with transaction.atomic(using=connection.alias):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(159,20261107)")
            if cursor.fetchone() != (True,):
                raise ValueError("Another AiUnifiedTasks schema migration owner is active")
            if verify_receipt_generation(cursor) != len(base):
                raise ValueError("AiUnifiedTasks schema requires exact158; never replay")
            if preservation(cursor) != expected:
                raise ValueError("AI159 legacy rows or permissions changed after intent")
            verify_catalog(cursor, installed=False)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base):
            raise ValueError("AiUnifiedTasks parent migration catalogue changed")
        executor = MigrationExecutor(connection)
        pending = [(".".join((step.app_label, step.name)), reverse) for step, reverse in executor.migration_plan(targets)]
        if pending != [(step, False) for step in steps]:
            raise ValueError("Only the exact reviewed finite forward migration chain may execute")
        # The full leaf-node state, not just this generation's targets: the
        # inherited contract covers other apps' models (sales154's index among
        # them), and a targets-only state would not contain them. This step
        # is AI's own leaf, so this is the same post-migration
        # state check_database verifies afterwards.
        verify_defaults(executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps)
        for target in [tuple(step.split(".", 1)) for step in steps]:
            MigrationExecutor(connection).migrate([target])
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base)):
            raise ValueError("Unexpected AiUnifiedTasks schema migration result")
        with connection.cursor() as cursor:
            if verify_receipt_generation(cursor, unified_task_permissions=False) != 159:
                raise ValueError("AiUnifiedTasks schema result is not exact159")
            verify_catalog(cursor, permissions=False)
            verify_initial_values(cursor)
            if preservation(cursor) != expected:
                raise ValueError("AI159 changed existing rows or permissions")


def install_intent(folder):
    value = common.read(Path(folder) / "install-intent.json")
    state = value.get("preservation")
    if (type(value) is not dict or set(value) != {"version", "planSha256", "at", "preservation"}
            or value["version"] != VERSION or value["planSha256"] != common.sha(Path(folder) / "plan.json")
            or type(state) is not dict or set(state) != {"rows", "legacyRowsSha256", "permissionsSha256"}
            or type(state["rows"]) is not int or not 0 <= state["rows"] <= 500000
            or any(not isinstance(state[key], str) or not common.HEX.fullmatch(state[key])
                   for key in ("legacyRowsSha256", "permissionsSha256"))):
        raise ValueError("AI159 unknown intent binding changed; no replay")
    return value


def publish_installed(runtime, operation, folder, plan):
    intent = install_intent(folder)
    value = {"version": VERSION, "status": "schema_installed", "steps": plan["steps"], "migrationCount": 159,
        "migrationSha256": plan["migrationSha256"], "planSha256": common.sha(folder / "plan.json"),
        "legacyDataPreserved": True, "preservation": intent["preservation"],
        "installIntentSha256": common.sha(folder / "install-intent.json"),
        "databasePolicy": POLICY}
    file = folder / "installed.json"
    if file.exists():
        if common.read(file) != value:
            raise ValueError("AiUnifiedTasks original installed receipt differs")
    else:
        publish(file, value)
    pointer = {"version": VERSION, "operationId": operation, "receiptSha256": common.sha(file),
               "parentReferenceSha256": plan["parentReferenceSha256"]}
    active = Path(runtime) / ACTIVE
    if active.exists():
        if common.read(active) != pointer:
            raise ValueError("Another AiUnifiedTasks schema operation owns active reference")
    else:
        publish(active, pointer)
    return value


def check_database(connection, base, *, permissions=True, empty=False, expected=None):
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor, unified_task_permissions=permissions) != 159:
            raise ValueError("AiUnifiedTasks schema catalogue is incomplete")
        verify_catalog(cursor, permissions=permissions)
        if empty:
            verify_initial_values(cursor)
        if expected is not None and preservation(cursor) != expected:
            raise ValueError("AI159 legacy data or permissions differ from original intent")
    executor = MigrationExecutor(connection)
    if ({".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base))
            or executor.migration_plan(executor.loader.graph.leaf_nodes())):
        raise ValueError("Pending or unknown migrations; ordinary AiUnifiedTasks startup cannot migrate")
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
        check_database(connection, base, permissions=False, empty=True, expected=intent["preservation"])
        return publish_installed(runtime, operation, folder, plan)
    with connection.cursor() as cursor:
        generation = verify_receipt_generation(cursor)
    if intent_file.exists() or (runtime / ACTIVE).exists() or generation != len(base):
        raise ValueError("AiUnifiedTasks install intent/result exists; reconcile without replay")
    with connection.cursor() as cursor:
        state = preservation(cursor)
    publish(intent_file, {"version": VERSION, "planSha256": common.sha(folder / "plan.json"),
                          "at": datetime.now(timezone.utc).isoformat(), "preservation": state})
    apply_steps(connection, base, state)
    return publish_installed(runtime, operation, folder, plan)


def main(args):
    root, runtime = Path(args.root).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed AiUnifiedTasks schema runtime is required")
    if args.command == "admission":
        return admission(root, runtime, args.evidence, args.evidence_sha)
    if args.command in {"release", "successor"}:
        return verify_active(root, runtime)[0]
    if args.command != "deployment" and (not args.execute or not args.schema_only):
        raise ValueError("Explicit schema-only AiUnifiedTasks adoption execution required")
    if args.command == "plan":
        evidence = admission(root, runtime, args.evidence, args.evidence_sha)
        window_sha = common.maintenance(runtime, args.maintenance)
        prepared = prepared_binding(runtime, args.prepared_id, args.prepared_receipt_sha, args.candidate_sha)
        if prepared["predecessorManifestSha256"] != evidence["predecessorSha256"]:
            raise ValueError("AiUnifiedTasks prepared predecessor differs from evidence")
        folder = directory(runtime, args.operation)
        if folder.exists() or (runtime / ACTIVE).exists():
            raise ValueError("AiUnifiedTasks schema operation already exists")
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
        raise ValueError("AiUnifiedTasks maintenance or exact candidate source changed")
    if args.command == "deployment":
        if (common.sha(root / "deployment.json") != plan["candidateManifestSha256"]
                or common.sha(runtime / "app/deployment.json") != plan["predecessorSha256"]):
            raise ValueError("AiUnifiedTasks deployment binding changed")
        return plan
    if common.sha(runtime / "app/deployment.json") != plan["candidateManifestSha256"]:
        raise ValueError("Installed application differs from AiUnifiedTasks plan")
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
                raise ValueError("Another AiUnifiedTasks operation owns finalization")
            check_database(connection, base, empty=True, expected=install_intent(folder)["preservation"])
            return result
        receipt, _, active_folder = verify_active(root, runtime, installed=True)
        if active_folder != folder:
            raise ValueError("Another AiUnifiedTasks operation owns installation")
        check_database(connection, base, empty=True, expected=install_intent(folder)["preservation"])
        result = {**receipt, "status": "verified", "permissionsVerified": True}
        final = folder / "finalized.json"
        if final.exists():
            if common.read(final) != result:
                raise ValueError("Interrupted AiUnifiedTasks finalization differs")
        else:
            publish(final, result)
        publish(pointer, {"version": VERSION, "operationId": args.operation, "receiptSha256": common.sha(final),
                          "parentReferenceSha256": plan["parentReferenceSha256"]}, previous=pointer_sha)
        return result
    raise ValueError("Unknown AiUnifiedTasks schema operation")


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
