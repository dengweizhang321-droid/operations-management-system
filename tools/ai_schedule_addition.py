"""Finite 142 -> 143 AI schedule append; old generation proofs stay immutable."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sys

import bi_app_addition as common
import jackyun_audit_addition as parent
from ai_schedule_addition_catalog import FILES, STEPS, COLUMNS, original_rows, verify_catalog, verify_defaults

VERSION = "teruisi-ai-schedule-addition-v1"
ACTIVE = "ai-schedule-addition-active.json"
CHECKS = {"atomic-upgrade", "preserved-rows", "defaults", "negative-catalogues", "legacy-generations",
          "dump-restore-142", "dump-restore-143", "rollback", "permissions", "unknown-no-replay", "closed-keys"}
CODE_FILES = ("tools/ai_schedule_addition.py", "tools/ai_schedule_addition_catalog.py",
    "tools/ai_schedule_addition_rehearsal.py", "tools/ai_schedule_addition_private.py",
    "tools/postgres_no_key_backup.py", "tools/integration_release_gate.py", "tools/bi-app-adopt.ps1",
    "tools/django-local-service.ps1", "tools/django-postgres-maintenance.ps1",
    "tools/jackyun_audit_addition.py", "tools/jackyun_audit_catalog.py", "tools/bi_app_addition.py",
    "tools/postgres_restore_semantics.py")
publish, copy_proof = parent.publish, parent.copy_proof


def directory(runtime, operation):
    if not isinstance(operation, str) or not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise ValueError("Invalid AI schedule addition operation")
    return Path(runtime) / "ai-schedule-additions" / operation


def source_delta(root, baseline):
    before, after = common.migrations(baseline), common.migrations(root)
    if (set(before) & set(FILES) or set(after) != set(before) | set(FILES)
            or any(after[p] != value for p, value in before.items())
            or any(after.get(p) != value for p, value in FILES.items())):
        raise ValueError("AI schedule append requires exactly the reviewed 0083 and unchanged parent migrations")
    return common.digest(after)


def parent_proof(runtime, baseline):
    # Call the original 142 verifier with its fixed baseline, never child
    # dispatch or the current 143 source tree.
    receipt, _, folder = parent.verify_active(baseline, runtime)
    base140, _ = parent.parent_proof(runtime, folder / "baseline")
    catalogue = base140 | set(parent.STEPS)
    if len(catalogue) != 142 or receipt["migrationCount"] != 142:
        raise ValueError("AI schedule append requires the verified exact 142 parent")
    return catalogue, common.sha(Path(runtime) / parent.ACTIVE)


def code_digest(root):
    return common.digest({name: common.sha(Path(root) / name) for name in CODE_FILES})


def admission(root, runtime, evidence, evidence_sha):
    value = common.read(evidence, evidence_sha)
    required = {"version", "status", "predecessorSha256", "parentReferenceSha256", "migrationSha256",
                "steps", "stepFiles", "validation", "validationSha256", "codeSha256"}
    if (type(value) is not dict or set(value) != required or value["version"] != VERSION
            or value["status"] != "reviewed" or value["steps"] != list(STEPS) or value["stepFiles"] != FILES):
        raise ValueError("Exact AI schedule addition review is required; no backup exemption exists")
    _, parent_sha = parent_proof(runtime, Path(runtime) / "app")
    if (value["predecessorSha256"] != common.sha(Path(runtime) / "app/deployment.json")
            or value["parentReferenceSha256"] != parent_sha
            or value["migrationSha256"] != source_delta(root, Path(runtime) / "app")
            or value["codeSha256"] != code_digest(root)):
        raise ValueError("AI schedule candidate, exact predecessor or reviewed tools changed")
    proof = common.read(value["validation"], value["validationSha256"])
    if (proof.get("version") != "ai-schedule-private-postgres-v1" or proof.get("status") != "passed"
            or proof.get("productionTouched") is not False or proof.get("steps") != list(STEPS)
            or proof.get("codeSha256") != value["codeSha256"] or proof.get("migrationSha256") != value["migrationSha256"]
            or set(proof.get("checks", [])) != CHECKS):
        raise ValueError("Bound AI schedule upgrade, permission and two-generation recovery proof is incomplete")
    return value


def valid_rows(value):
    return type(value) is dict and set(value) == set(COLUMNS) and all(
        type(row) is dict and set(row) == {"columns", "rows", "sha256"}
        and type(row["rows"]) is int and 0 <= row["rows"] <= 10_000_000
        and isinstance(row["sha256"], str) and common.HEX.fullmatch(row["sha256"])
        and type(row["columns"]) is list and all(type(c) is str for c in row["columns"])
        and "id" in row["columns"] and len(row["columns"]) == len(set(row["columns"]))
        and not set(row["columns"]) & set(COLUMNS[table]) for table, row in value.items())


def load_plan(runtime, operation):
    folder = directory(runtime, operation)
    if any(folder.glob("*.tmp")) or any(Path(runtime).glob(ACTIVE + ".*.tmp")):
        raise ValueError("Uncertain AI schedule evidence publication; preserve original temporary files")
    plan = common.read(folder / "plan.json")
    if (plan.get("version") != VERSION or plan.get("operationId") != operation or plan.get("steps") != list(STEPS)):
        raise ValueError("AI schedule plan identity changed")
    _, parent_sha = parent_proof(runtime, folder / "baseline")
    evidence = common.read(folder / "candidate.json", plan["candidateEvidenceSha256"])
    if parent_sha != plan["parentReferenceSha256"] or any(plan.get(key) != value for key, value in evidence.items() if key != "status"):
        raise ValueError("AI schedule plan no longer matches exact parent or review")
    backup = common.checked_backup(folder / "before-backup.json", plan["beforeBackupSha256"],
                                   folder / "before-restore.json", plan["beforeRestoreSha256"], 142)
    bind_prepared_backup(backup, plan["candidateEvidenceSha256"], plan["candidateManifestSha256"],
                         plan["preparedAppId"], plan["preparedReceiptSha256"], plan["maintenanceId"])
    return folder, plan


def bind_prepared_backup(backup, evidence_sha, candidate_sha, prepared_id, prepared_receipt_sha, maintenance):
    expected = {"version": "teruisi-ai-schedule-prepared-backup-v1", "preparedAppId": prepared_id,
        "preparedReceiptSha256": prepared_receipt_sha, "preparedManifestSha256": candidate_sha,
        "candidateEvidenceSha256": evidence_sha, "maintenanceId": maintenance}
    if (not re.fullmatch(r"[0-9a-f]{32}", prepared_id) or not re.fullmatch(r"[0-9a-f]{32}", maintenance)
            or any(not common.HEX.fullmatch(value) for value in (evidence_sha, candidate_sha, prepared_receipt_sha))
            or backup.get("preparedAiScheduleTools") != expected):
        raise ValueError("142 backup is not bound to this exact prepared AI schedule candidate")


def verify_active(root, runtime, *, installed=False):
    pointer = common.read(Path(runtime) / ACTIVE)
    if type(pointer) is not dict or set(pointer) != {"version", "operationId", "receiptSha256"} or pointer["version"] != VERSION:
        raise ValueError("Invalid AI schedule active reference")
    folder, plan = load_plan(runtime, pointer["operationId"])
    receipt = common.read(folder / ("installed.json" if installed else "finalized.json"), pointer["receiptSha256"])
    if (receipt.get("version") != VERSION or receipt.get("status") != ("schema_installed" if installed else "verified")
            or receipt.get("planSha256") != common.sha(folder / "plan.json") or receipt.get("steps") != list(STEPS)
            or receipt.get("migrationCount") != 143 or receipt.get("migrationSha256") != source_delta(root, folder / "baseline")
            or receipt["migrationSha256"] != plan["migrationSha256"] or not valid_rows(receipt.get("beforeRows"))
            or receipt.get("beforeRows") != receipt.get("afterRows") or receipt.get("defaultsVerified") is not True):
        raise ValueError("AI schedule migration receipt is incomplete or changed")
    if not installed:
        common.checked_backup(folder / "after-backup.json", receipt["afterBackupSha256"],
                              folder / "after-restore.json", receipt["afterRestoreSha256"], 143)
    return receipt, plan, folder


def apply_steps(connection, base, *, expected_before=None):
    from django.db import transaction
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    if len(base) != 142 or set(base) & set(STEPS):
        raise ValueError("AI schedule installation requires the exact old 142 catalogue")
    targets = [tuple(step.split(".", 1)) for step in STEPS]
    with transaction.atomic(using=connection.alias):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(143,20261015)")
            if cursor.fetchone() != (True,):
                raise ValueError("Another AI schedule migration owner is active")
            verify_catalog(cursor, installed=False)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base):
            raise ValueError("Original AI schedule migration catalogue changed; no replay")
        executor = MigrationExecutor(connection)
        pending = [(".".join((step.app_label, step.name)), reverse) for step, reverse in executor.migration_plan(targets)]
        if pending != [(STEPS[0], False)]:
            raise ValueError("Only the reviewed AI 0083 migration may execute")
        before = original_rows(connection)
        if expected_before is not None and before != expected_before:
            raise ValueError("AI schedule data changed after the original install intent")
        executor.migrate(targets)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(STEPS):
            raise ValueError("Unexpected AI schedule migration result")
        with connection.cursor() as cursor:
            verify_catalog(cursor, installed=True)
            verify_defaults(cursor)
        after = original_rows(connection)
        if before != after:
            raise ValueError("Original AI schedule rows changed")
    return before, after


def publish_installed(runtime, operation, folder, plan, before, after):
    if not valid_rows(before) or before != after:
        raise ValueError("AI schedule original-row preservation is not proved")
    value = {"version": VERSION, "status": "schema_installed", "steps": list(STEPS), "migrationCount": 143,
        "migrationSha256": plan["migrationSha256"], "planSha256": common.sha(folder / "plan.json"),
        "beforeRows": before, "afterRows": after, "defaultsVerified": True}
    file = folder / "installed.json"
    if file.exists():
        if common.read(file) != value:
            raise ValueError("Original AI schedule installed receipt differs")
    else:
        publish(file, value)
    pointer = {"version": VERSION, "operationId": operation, "receiptSha256": common.sha(file)}
    active = Path(runtime) / ACTIVE
    if active.exists():
        if common.read(active) != pointer:
            raise ValueError("Another AI schedule addition owns the active reference")
    else:
        publish(active, pointer)
    return value


def database_identity(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", 5432):
            raise ValueError("AI schedule migration database identity changed")


def complete_database(root, runtime):
    receipt, _, folder = verify_active(root, runtime)
    base, _ = parent_proof(runtime, folder / "baseline")
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    database_identity(connection)
    from postgres_no_key_backup import verify_receipt_generation
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor) != 143:
            raise ValueError("AI schedule catalogue is incomplete")
    executor = MigrationExecutor(connection)
    if ({".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != base | set(STEPS)
            or executor.migration_plan(executor.loader.graph.leaf_nodes())):
        raise ValueError("Pending or unknown migration; ordinary startup cannot migrate")
    return {"status": "complete", "migrationCount": receipt["migrationCount"]}


def backup_admission(root, runtime, evidence, evidence_sha, maintenance):
    value = admission(root, runtime, evidence, evidence_sha)
    common.maintenance(runtime, maintenance)
    return {"status": "verified", "predecessorSha256": value["predecessorSha256"],
            "maintenanceId": maintenance, "migrationCount": 142}


def backup_database():
    """Privileged read-only precheck for this exact prepared 142 backup."""
    import psycopg
    from postgres_no_key_backup import verify_receipt_generation, verify_closed_profile
    with psycopg.connect() as db:
        db.execute("SET TRANSACTION READ ONLY")
        if db.execute("SELECT current_database(),current_user,inet_server_port()").fetchone() != ("teruisi_sales", "postgres", 5432):
            raise ValueError("Prepared backup database identity changed")
        verify_closed_profile(db, lock=False)
        with db.cursor() as cursor:
            if verify_receipt_generation(cursor) != 142:
                raise ValueError("Prepared AI schedule backup only accepts the exact 142 predecessor")
    return {"migrationCount": 142, "readOnly": True}


def main(args):
    root, runtime = Path(args.root).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed AI schedule runtime is required")
    if args.command == "admission":
        return admission(root, runtime, args.evidence, args.evidence_sha)
    if args.command == "backup-admission":
        return backup_admission(root, runtime, args.evidence, args.evidence_sha, args.maintenance)
    if args.command == "backup-database":
        backup_admission(root, runtime, args.evidence, args.evidence_sha, args.maintenance)
        return backup_database()
    if args.command in {"release", "successor"}:
        return verify_active(root, runtime)[0]
    if args.command != "deployment" and not args.execute:
        raise ValueError("Explicit AI schedule adoption execution required")
    if args.command == "plan":
        evidence = admission(root, runtime, args.evidence, args.evidence_sha)
        window_sha = common.maintenance(runtime, args.maintenance)
        backup = common.checked_backup(args.backup, args.backup_sha, args.restore, args.restore_sha, 142)
        bind_prepared_backup(backup, args.evidence_sha, args.candidate_sha, args.prepared_id,
                             args.prepared_receipt_sha, args.maintenance)
        window = common.read(runtime / "run/system-maintenance.json")
        if (backup["software"]["deploymentManifestSha256"] != evidence["predecessorSha256"]
                or datetime.fromisoformat(backup["createdAt"].replace("Z", "+00:00")) < datetime.fromisoformat(window["createdAt"].replace("Z", "+00:00"))):
            raise ValueError("Fresh 142 backup within exact maintenance is required")
        folder = directory(runtime, args.operation)
        if folder.exists() or (runtime / ACTIVE).exists() or not common.HEX.fullmatch(args.candidate_sha):
            raise ValueError("AI schedule addition exists or candidate manifest is invalid")
        folder.mkdir(parents=True)
        shutil.copytree(runtime / "app", folder / "baseline", ignore=shutil.ignore_patterns(".wrangler", "runtime-tools", "__pycache__"))
        for name, file in (("candidate.json", args.evidence), ("before-backup.json", args.backup), ("before-restore.json", args.restore)):
            shutil.copyfile(file, folder / name)
        plan = {**evidence, "status": "prepared", "operationId": args.operation, "maintenanceId": args.maintenance,
            "maintenanceSha256": window_sha, "candidateManifestSha256": args.candidate_sha,
            "candidateEvidenceSha256": args.evidence_sha, "beforeBackupSha256": args.backup_sha, "beforeRestoreSha256": args.restore_sha,
            "preparedAppId": args.prepared_id, "preparedReceiptSha256": args.prepared_receipt_sha}
        publish(folder / "plan.json", plan)
        return {"status": "prepared", "planSha256": common.sha(folder / "plan.json")}
    folder, plan = load_plan(runtime, args.operation)
    if (common.maintenance(runtime, plan["maintenanceId"]) != plan["maintenanceSha256"]
            or source_delta(root, folder / "baseline") != plan["migrationSha256"]):
        raise ValueError("AI schedule maintenance or exact migration source changed")
    if args.command == "deployment":
        if (common.sha(root / "deployment.json") != plan["candidateManifestSha256"]
                or common.sha(runtime / "app/deployment.json") != plan["predecessorSha256"]):
            raise ValueError("AI schedule deployment binding changed")
        return plan
    if common.sha(runtime / "app/deployment.json") != plan["candidateManifestSha256"]:
        raise ValueError("Installed application differs from AI schedule plan")
    if args.command in {"install", "reconcile"}:
        sys.path.insert(0, str(root / "backend")); os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
        import django
        django.setup()
        from django.db import connection
        from postgres_no_key_backup import verify_receipt_generation
        database_identity(connection)
        base, _ = parent_proof(runtime, folder / "baseline")
        with connection.cursor() as cursor:
            generation = verify_receipt_generation(cursor)
        intent_file = folder / "install-intent.json"
        if args.command == "reconcile":
            intent = common.read(intent_file)
            if (generation != 143 or intent.get("version") != VERSION or not valid_rows(intent.get("beforeRows"))
                    or intent.get("planSha256") != common.sha(folder / "plan.json") or original_rows(connection) != intent["beforeRows"]):
                raise ValueError("Unknown install cannot reconcile; preserve original intent and never replay")
            with connection.cursor() as cursor:
                verify_defaults(cursor)
            return publish_installed(runtime, args.operation, folder, plan, intent["beforeRows"], original_rows(connection))
        if intent_file.exists() or (runtime / ACTIVE).exists() or generation != 142:
            raise ValueError("An install intent/result exists; reconcile instead of replaying")
        before = original_rows(connection)
        publish(intent_file, {"version": VERSION, "planSha256": common.sha(folder / "plan.json"),
                             "beforeRows": before, "at": datetime.now(timezone.utc).isoformat()})
        actual_before, after = apply_steps(connection, base, expected_before=before)
        if before != actual_before:
            raise ValueError("AI schedule data changed after original intent")
        return publish_installed(runtime, args.operation, folder, plan, before, after)
    if args.command == "finalize":
        pointer = runtime / ACTIVE
        pointer_sha = common.sha(pointer)
        if (folder / "finalized.json").exists() and common.read(pointer).get("receiptSha256") == common.sha(folder / "finalized.json"):
            receipt, _, final_folder = verify_active(root, runtime)
            if final_folder != folder or receipt["afterBackupSha256"] != args.backup_sha or receipt["afterRestoreSha256"] != args.restore_sha:
                raise ValueError("AI schedule finalization differs from original result")
            return receipt
        receipt, _, active_folder = verify_active(root, runtime, installed=True)
        if active_folder != folder:
            raise ValueError("Another AI schedule operation owns installation")
        backup = common.checked_backup(args.backup, args.backup_sha, args.restore, args.restore_sha, 143)
        if backup["software"]["deploymentManifestSha256"] != plan["candidateManifestSha256"]:
            raise ValueError("143 backup belongs to another application")
        for name, file, expected in (("after-backup.json", args.backup, args.backup_sha), ("after-restore.json", args.restore, args.restore_sha)):
            copy_proof(file, folder / name, expected)
        result = {**receipt, "status": "verified", "afterBackupSha256": args.backup_sha, "afterRestoreSha256": args.restore_sha}
        final = folder / "finalized.json"
        if final.exists():
            if common.read(final) != result:
                raise ValueError("Interrupted AI schedule finalization differs")
        else:
            publish(final, result)
        publish(pointer, {"version": VERSION, "operationId": args.operation, "receiptSha256": common.sha(final)}, previous=pointer_sha)
        return result
    raise ValueError("Unknown AI schedule addition operation")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["admission", "backup-admission", "backup-database", "plan", "deployment", "install", "reconcile", "finalize", "release", "successor"])
    for name in ("root", "runtime", "operation", "maintenance", "evidence", "evidence-sha", "candidate-sha", "prepared-id", "prepared-receipt-sha", "backup", "backup-sha", "restore", "restore-sha"):
        parser.add_argument("--" + name, default="")
    parser.add_argument("--execute", action="store_true")
    try:
        print(json.dumps({"status": "verified", "result": main(parser.parse_args())}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}, ensure_ascii=True)); sys.exit(1)
