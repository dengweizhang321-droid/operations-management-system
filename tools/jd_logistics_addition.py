"""Finite schema-only JD child of the unchanged verified 143 generation.

The production lifecycle/mutex/credentials stay with bi-app-adopt.ps1. An
uncertain installation is never retried; reconcile only proves a committed146.
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
import ai_schedule_addition as parent
from jackyun_audit_addition import publish
from jd_logistics_catalog import FILES, STEPS, TABLES, verify_catalog, verify_empty, verify_defaults

VERSION = "teruisi-jd-logistics-schema-addition-v1"
POLICY = "schema-only-no-full-backup-or-restore-v1"
ACTIVE = "jd-logistics-addition-active.json"
CHECKS = {"atomic-upgrade", "rollback", "exact-143-146", "negative-catalogues",
          "defaults-disabled", "permissions", "unknown-no-replay", "parent-source-binding"}
CODE_FILES = ("tools/jd_logistics_addition.py", "tools/jd_logistics_catalog.py",
    "tools/jd_logistics_catalog.json", "tools/postgres_no_key_backup.py",
    "tools/integration_release_gate.py", "tools/bi-app-adopt.ps1",
    "tools/django-local-service.ps1", "tools/django-postgres-maintenance.ps1",
    "tools/django-inventory-service.ps1", "tools/ai_schedule_addition.py",
    "tools/ai_schedule_addition_catalog.py", "tools/jackyun_audit_addition.py",
    "tools/jackyun_audit_catalog.py", "tools/bi_app_addition.py",
    "tools/postgres_restore_semantics.py")


def directory(runtime, operation):
    if not isinstance(operation, str) or not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise ValueError("Invalid JD schema operation")
    return Path(runtime) / "jd-logistics-additions" / operation


def source_delta(root, baseline):
    before, after = common.migrations(baseline), common.migrations(root)
    if (set(before) & set(FILES) or set(after) != set(before) | set(FILES)
            or any(after[p] != value for p, value in before.items())
            or any(after.get(p) != value for p, value in FILES.items())):
        raise ValueError("JD schema requires exactly reviewed0012/0013/0014 and unchanged parent migrations")
    return common.digest(after)


def parent_proof(runtime, baseline):
    # Never hand a146 source to the original143 verifier or change its proofs.
    receipt, _, folder = parent.verify_active(baseline, runtime)
    base142, _ = parent.parent_proof(runtime, folder / "baseline")
    catalogue = base142 | set(parent.STEPS)
    if len(catalogue) != 143 or receipt["migrationCount"] != 143:
        raise ValueError("JD schema requires the exact verified143 parent")
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
            raise ValueError("Unsafe JD source inventory")
        result[relative.as_posix()] = common.sha(path)
    if not result:
        raise ValueError("Missing JD backend source inventory")
    result["config/jd-logistics-notifications.json"] = common.sha(root / "config/jd-logistics-notifications.json")
    result.update({name: common.sha(root / name) for name in CODE_FILES})
    return common.digest(result)


def admission(root, runtime, evidence, evidence_sha):
    value = common.read(evidence, evidence_sha)
    required = {"version", "status", "predecessorSha256", "parentReferenceSha256", "migrationSha256",
                "steps", "stepFiles", "validation", "validationSha256", "codeSha256", "sourceSha256", "databasePolicy"}
    if (type(value) is not dict or set(value) != required or value["version"] != VERSION
            or value["status"] != "reviewed" or value["steps"] != list(STEPS)
            or value["stepFiles"] != FILES or value["databasePolicy"] != POLICY):
        raise ValueError("Exact reviewed JD schema-only candidate is required")
    _, parent_sha = parent_proof(runtime, Path(runtime) / "app")
    if (value["predecessorSha256"] != common.sha(Path(runtime) / "app/deployment.json")
            or value["parentReferenceSha256"] != parent_sha
            or value["migrationSha256"] != source_delta(root, Path(runtime) / "app")
            or value["codeSha256"] != code_digest(root) or value["sourceSha256"] != source_inventory(root)):
        raise ValueError("JD candidate, exact predecessor or reviewed source changed")
    proof = common.read(value["validation"], value["validationSha256"])
    if (proof.get("version") != "jd-schema-private-postgres-v1" or proof.get("status") != "passed"
            or proof.get("productionTouched") is not False or proof.get("steps") != list(STEPS)
            or proof.get("codeSha256") != value["codeSha256"]
            or proof.get("migrationSha256") != value["migrationSha256"]
            or set(proof.get("checks", [])) != CHECKS):
        raise ValueError("Bound JD isolated structure, permission and negative proof is incomplete")
    return value


def prepared_binding(runtime, prepared_id, receipt_sha, candidate_sha):
    if not re.fullmatch(r"[0-9a-f]{32}", prepared_id or ""):
        raise ValueError("Exact JD prepared application is required")
    receipt = common.read(Path(runtime) / ("app.prepare-" + prepared_id + ".json"), receipt_sha)
    expected = {"version", "id", "runtimeRoot", "predecessorManifestSha256", "candidateManifestSha256"}
    if (type(receipt) is not dict or set(receipt) != expected
            or receipt["version"] != "teruisi-django-prepared-app-v1" or receipt["id"] != prepared_id
            or Path(receipt["runtimeRoot"]) != Path(runtime)
            or receipt["candidateManifestSha256"] != candidate_sha
            or not common.HEX.fullmatch(receipt["predecessorManifestSha256"])):
        raise ValueError("JD prepared receipt identity changed")
    if not common.HEX.fullmatch(candidate_sha or ""):
        raise ValueError("Invalid JD candidate manifest hash")
    return receipt


def load_plan(runtime, operation):
    folder = directory(runtime, operation)
    if any(folder.glob("*.tmp")) or any(Path(runtime).glob(ACTIVE + ".*.tmp")):
        raise ValueError("Uncertain JD evidence publication; preserve temporary files")
    plan = common.read(folder / "plan.json")
    if (plan.get("version") != VERSION or plan.get("operationId") != operation
            or plan.get("steps") != list(STEPS) or plan.get("databasePolicy") != POLICY):
        raise ValueError("JD plan identity changed")
    _, parent_sha = parent_proof(runtime, folder / "baseline")
    evidence = common.read(folder / "candidate.json", plan["candidateEvidenceSha256"])
    if (parent_sha != plan["parentReferenceSha256"]
            or any(plan.get(key) != value for key, value in evidence.items() if key != "status")
            or common.sha(folder / "baseline/deployment.json") != plan["predecessorSha256"]):
        raise ValueError("JD plan no longer matches exact parent or review")
    prepared = prepared_binding(runtime, plan["preparedAppId"], plan["preparedReceiptSha256"], plan["candidateManifestSha256"])
    if prepared["predecessorManifestSha256"] != plan["predecessorSha256"]:
        raise ValueError("JD prepared predecessor differs from plan")
    return folder, plan


def verify_active(root, runtime, *, installed=False):
    pointer = common.read(Path(runtime) / ACTIVE)
    if (type(pointer) is not dict or set(pointer) != {"version", "operationId", "receiptSha256", "parentReferenceSha256"}
            or pointer["version"] != VERSION):
        raise ValueError("Invalid JD schema active reference")
    folder, plan = load_plan(runtime, pointer["operationId"])
    receipt = common.read(folder / ("installed.json" if installed else "finalized.json"), pointer["receiptSha256"])
    if (pointer["parentReferenceSha256"] != plan["parentReferenceSha256"]
            or receipt.get("version") != VERSION or receipt.get("status") != ("schema_installed" if installed else "verified")
            or receipt.get("planSha256") != common.sha(folder / "plan.json")
            or receipt.get("steps") != list(STEPS) or receipt.get("migrationCount") != 146
            or receipt.get("migrationSha256") != source_delta(root, folder / "baseline")
            or receipt["migrationSha256"] != plan["migrationSha256"]
            or receipt.get("emptyAtInstallation") is not True or receipt.get("defaultsDisabled") is not True
            or receipt.get("databasePolicy") != POLICY or not installed and receipt.get("permissionsVerified") is not True):
        raise ValueError("JD schema receipt is incomplete or changed")
    return receipt, plan, folder


def database_identity(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,inet_server_addr()::text,inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", "127.0.0.1", 5432):
            raise ValueError("JD schema database identity changed")


def apply_steps(connection, base):
    from django.db import transaction
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    if len(base) != 143 or set(base) & set(STEPS):
        raise ValueError("JD installation requires exact143 parent catalogue")
    targets = [tuple(STEPS[-1].split(".", 1))]
    with transaction.atomic(using=connection.alias):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(146,20261015)")
            if cursor.fetchone() != (True,):
                raise ValueError("Another JD schema migration owner is active")
            if verify_receipt_generation(cursor) != 143:
                raise ValueError("JD schema requires exact143; never replay")
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base):
            raise ValueError("JD parent migration catalogue changed")
        executor = MigrationExecutor(connection)
        pending = [(".".join((step.app_label, step.name)), reverse) for step, reverse in executor.migration_plan(targets)]
        if pending != [(step, False) for step in STEPS]:
            raise ValueError("Only exact three reviewed JD forward migrations may execute")
        verify_defaults(executor.loader.project_state(targets).apps)
        executor.migrate(targets)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(STEPS):
            raise ValueError("Unexpected JD schema migration result")
        with connection.cursor() as cursor:
            if verify_receipt_generation(cursor, jd_permissions=False) != 146:
                raise ValueError("JD schema result is not exact146")
            verify_empty(cursor)


def publish_installed(runtime, operation, folder, plan):
    value = {"version": VERSION, "status": "schema_installed", "steps": list(STEPS), "migrationCount": 146,
        "migrationSha256": plan["migrationSha256"], "planSha256": common.sha(folder / "plan.json"),
        "emptyAtInstallation": True, "defaultsDisabled": True, "databasePolicy": POLICY}
    file = folder / "installed.json"
    if file.exists():
        if common.read(file) != value:
            raise ValueError("JD original installed receipt differs")
    else:
        publish(file, value)
    pointer = {"version": VERSION, "operationId": operation, "receiptSha256": common.sha(file),
               "parentReferenceSha256": plan["parentReferenceSha256"]}
    active = Path(runtime) / ACTIVE
    if active.exists():
        if common.read(active) != pointer:
            raise ValueError("Another JD schema operation owns active reference")
    else:
        publish(active, pointer)
    return value


def check_database(connection, base, *, permissions=False, empty=False):
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor, jd_permissions=permissions) != 146:
            raise ValueError("JD schema catalogue is incomplete")
        verify_catalog(cursor, installed=True, permissions=permissions)
        if empty:
            verify_empty(cursor)
    executor = MigrationExecutor(connection)
    if ({".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(STEPS)
            or executor.migration_plan(executor.loader.graph.leaf_nodes())):
        raise ValueError("Pending or unknown migrations; ordinary JD startup cannot migrate")
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
        intent = common.read(intent_file)
        if intent.get("version") != VERSION or intent.get("planSha256") != common.sha(folder / "plan.json"):
            raise ValueError("JD unknown install binding changed; no replay")
        check_database(connection, base, empty=True)
        return publish_installed(runtime, operation, folder, plan)
    with connection.cursor() as cursor:
        generation = verify_receipt_generation(cursor)
    if intent_file.exists() or (runtime / ACTIVE).exists() or generation != 143:
        raise ValueError("JD install intent/result exists; reconcile without replay")
    publish(intent_file, {"version": VERSION, "planSha256": common.sha(folder / "plan.json"),
                          "at": datetime.now(timezone.utc).isoformat()})
    apply_steps(connection, base)
    return publish_installed(runtime, operation, folder, plan)


def main(args):
    root, runtime = Path(args.root).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed JD schema runtime is required")
    if args.command == "admission":
        return admission(root, runtime, args.evidence, args.evidence_sha)
    if args.command in {"release", "successor"}:
        return verify_active(root, runtime)[0]
    if args.command != "deployment" and (not args.execute or not args.schema_only):
        raise ValueError("Explicit schema-only JD adoption execution required")
    if args.command == "plan":
        evidence = admission(root, runtime, args.evidence, args.evidence_sha)
        window_sha = common.maintenance(runtime, args.maintenance)
        prepared = prepared_binding(runtime, args.prepared_id, args.prepared_receipt_sha, args.candidate_sha)
        if prepared["predecessorManifestSha256"] != evidence["predecessorSha256"]:
            raise ValueError("JD prepared predecessor differs from evidence")
        folder = directory(runtime, args.operation)
        if folder.exists() or (runtime / ACTIVE).exists():
            raise ValueError("JD schema operation already exists")
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
        raise ValueError("JD maintenance or exact candidate source changed")
    if args.command == "deployment":
        if (common.sha(root / "deployment.json") != plan["candidateManifestSha256"]
                or common.sha(runtime / "app/deployment.json") != plan["predecessorSha256"]):
            raise ValueError("JD deployment binding changed")
        return plan
    if common.sha(runtime / "app/deployment.json") != plan["candidateManifestSha256"]:
        raise ValueError("Installed application differs from JD plan")
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
                raise ValueError("Another JD operation owns finalization")
            check_database(connection, base, permissions=True, empty=True)
            return result
        receipt, _, active_folder = verify_active(root, runtime, installed=True)
        if active_folder != folder:
            raise ValueError("Another JD operation owns installation")
        check_database(connection, base, permissions=True, empty=True)
        result = {**receipt, "status": "verified", "permissionsVerified": True}
        final = folder / "finalized.json"
        if final.exists():
            if common.read(final) != result:
                raise ValueError("Interrupted JD finalization differs")
        else:
            publish(final, result)
        publish(pointer, {"version": VERSION, "operationId": args.operation, "receiptSha256": common.sha(final),
                          "parentReferenceSha256": plan["parentReferenceSha256"]}, previous=pointer_sha)
        return result
    raise ValueError("Unknown JD schema operation")


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
