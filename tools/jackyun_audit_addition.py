"""Finite 140 -> 142 successor, retaining the unchanged BI/139 parent proofs.

Preparation is read-only. Plan/install/reconcile/finalize require the original
maintenance operator, exact application and backup/restore bindings. Neither
old migration history nor the BI/integration active pointers are rewritten.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid

import bi_app_addition as parent
from jackyun_audit_catalog import FILES, STEPS, original_rows, verify_catalog

VERSION = "teruisi-jackyun-audit-addition-v1"
NO_BACKUP_VERSION = "teruisi-jackyun-audit-addition-no-new-backup-v1"
NO_BACKUP_POLICY = "user-directed-no-new-backup-or-rehearsal"
ACTIVE = "jackyun-audit-addition-active.json"
CODE_FILES = ("tools/jackyun_audit_addition.py", "tools/jackyun_audit_catalog.py",
              "tools/postgres_no_key_backup.py", "tools/integration_release_gate.py",
              "tools/django-local-service.ps1", "tools/bi-app-adopt.ps1",
              "tools/release-batch.mjs", "tools/release-lifecycle-step.ps1",
              "tools/test-jackyun-recovery-postgres.py", "tools/jackyun_audit_private_rehearsal.py",
              "tools/test_jackyun_audit_addition.py", "backend/erp_reference/tests/test_audit_adoption.py",
              "tests/jackyun-audit-adoption.test.mjs", "tests/test_netshop_presence_generation.py",
              "tests/release-first-adoption-targeted.test.mjs")


def directory(runtime, operation):
    if not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise ValueError("Invalid Jackyun addition operation")
    return Path(runtime) / "jackyun-audit-additions" / operation


def publish(path, value, *, previous=None):
    """Flush then same-directory atomic publication; preserve ambiguous temp files."""
    path = Path(path).absolute()
    for entry in (path.parent, *path.parent.parents):
        if entry.is_symlink() or getattr(entry, "is_junction", lambda: False)():
            raise ValueError("Unsafe Jackyun evidence directory")
    if previous is not None and parent.sha(path) != previous:
        raise ValueError("Jackyun evidence pointer changed")
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with temp.open("xb") as stream:
        stream.write(parent.canonical(value)); stream.flush(); os.fsync(stream.fileno())
    if os.name == "nt":
        import ctypes
        move = ctypes.WinDLL("kernel32", use_last_error=True).MoveFileExW
        move.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
        move.restype = ctypes.c_int
        if not move(str(temp), str(path), 8 | (1 if previous else 0)):
            raise OSError(ctypes.get_last_error(), "Atomic evidence publication unconfirmed")
    elif previous:
        os.replace(temp, path)
    else:
        os.link(temp, path); temp.unlink()


def source_delta(root, baseline):
    before, after = parent.migrations(baseline), parent.migrations(root)
    if set(after) != set(before) | set(FILES) or set(before) & set(FILES) \
            or any(after[p] != value for p, value in before.items()) \
            or any(after.get(p) != value for p, value in FILES.items()):
        raise ValueError("Jackyun append requires exactly the two reviewed migrations and unchanged parent files")
    return parent.digest(after)


def parent_proof(runtime, baseline):
    receipt, _, folder = parent.verify_active(baseline, runtime)
    _, base = parent.original_parent(runtime, folder / "baseline")
    catalogue = base | {parent.STEP}
    if len(catalogue) != 140 or receipt["migrationCount"] != 140:
        raise ValueError("Jackyun append requires the verified 140 parent")
    return catalogue, parent.sha(Path(runtime) / parent.ACTIVE)


def code_digest(root):
    return parent.digest({name: parent.sha(Path(root) / name) for name in CODE_FILES})


def no_backup(value):
    return value.get("version") == NO_BACKUP_VERSION


def verify_direction(value):
    direction = parent.read(value["authorization"], value["authorizationSha256"])
    if direction != {"version": "jackyun-publication-direction-v1", "policy": NO_BACKUP_POLICY,
                     "backup": False, "rehearsal": False, "publish": True,
                     "steps": list(STEPS), "predecessorSha256": value["predecessorSha256"]}:
        raise ValueError("Exact user-directed publication scope is required")


def verify_code_review(root, value, proof):
    import ast
    review = parent.read(value["codeReview"], value["codeReviewSha256"])
    before, after = review["before"], review["after"]
    current = {name: parent.sha(Path(root) / name) for name in CODE_FILES}
    if review.get("version") != "jackyun-audit-static-review-v1" or review.get("status") != "reviewed" \
            or set(before) != set(CODE_FILES) or after != current \
            or parent.digest(before) != proof["codeSha256"] or parent.digest(after) != value["codeSha256"] \
            or {p for p in before if before[p] != after[p]} != {
                "tools/jackyun_audit_addition.py", "tools/bi-app-adopt.ps1", "tools/release-batch.mjs", "tools/django-local-service.ps1"}:
        raise ValueError("Exact static review delta does not match the prior tested code")
    baseline = Path(review["baselineRoot"])
    if any(parent.sha(baseline / name) != digest for name, digest in before.items()):
        raise ValueError("Prior tested source changed")
    # Reuse the original database/identity/transaction tests only for identical functions.
    protected = {"publish", "source_delta", "parent_proof", "valid_rows", "complete_database", "apply_steps", "copy_proof"}
    def functions(path):
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        return {n.name: ast.dump(n, include_attributes=False) for n in tree.body
                if isinstance(n, ast.FunctionDef) and n.name in protected}
    if functions(baseline / "tools/jackyun_audit_addition.py") != functions(Path(root) / "tools/jackyun_audit_addition.py"):
        raise ValueError("Previously tested migration safety functions changed")


def admission(root, runtime, evidence, evidence_sha):
    value = parent.read(evidence, evidence_sha)
    required = {"version", "status", "predecessorSha256", "parentReferenceSha256", "migrationSha256",
                "steps", "stepFiles", "validation", "validationSha256", "codeSha256"}
    if no_backup(value):
        required |= {"recoveryPolicy", "authorization", "authorizationSha256", "codeReview", "codeReviewSha256"}
        if value.get("recoveryPolicy") != NO_BACKUP_POLICY:
            raise ValueError("Unknown explicit recovery policy")
        verify_direction(value)
    if set(value) != required or value["version"] not in {VERSION, NO_BACKUP_VERSION} or value["status"] != "reviewed" \
            or value["steps"] != list(STEPS) or value["stepFiles"] != FILES:
        raise ValueError("Exact Jackyun addition review is required")
    _, parent_sha = parent_proof(runtime, Path(runtime) / "app")
    if value["predecessorSha256"] != parent.sha(Path(runtime) / "app/deployment.json") \
            or value["parentReferenceSha256"] != parent_sha \
            or value["migrationSha256"] != source_delta(root, Path(runtime) / "app") \
            or value["codeSha256"] != code_digest(root):
        raise ValueError("Jackyun candidate, parent, or reviewed operator changed")
    proof = parent.read(value["validation"], value["validationSha256"])
    if no_backup(value):
        verify_code_review(root, value, proof)
    if proof.get("version") != "jackyun-audit-private-postgres-v1" or proof.get("status") != "passed" \
            or (not no_backup(value) and proof.get("codeSha256") != value["codeSha256"]) or proof.get("migrationSha256") != value["migrationSha256"] \
            or proof.get("productionTouched") is not False or proof.get("steps") != list(STEPS) \
            or set(proof.get("checks", [])) != {"atomic-upgrade", "preserved-rows", "negative-catalogues", "legacy-140", "dump-restore-142", "rollback", "permissions"}:
        raise ValueError("Bound isolated PostgreSQL upgrade/restore evidence is incomplete")
    return value


def load_plan(runtime, operation):
    folder = directory(runtime, operation)
    if any(folder.glob("*.tmp")) or any(Path(runtime).glob(ACTIVE + ".*.tmp")):
        raise ValueError("Unresolved evidence publication; preserve temporary files")
    plan = parent.read(folder / "plan.json")
    if plan.get("version") not in {VERSION, NO_BACKUP_VERSION} or plan.get("operationId") != operation or plan.get("steps") != list(STEPS):
        raise ValueError("Jackyun plan identity changed")
    _, parent_sha = parent_proof(runtime, folder / "baseline")
    if parent_sha != plan["parentReferenceSha256"]:
        raise ValueError("BI parent reference changed")
    evidence = parent.read(folder / "candidate.json", plan["candidateEvidenceSha256"])
    if any(plan.get(key) != value for key, value in evidence.items() if key != "status"):
        raise ValueError("Plan no longer matches its reviewed candidate")
    if no_backup(plan):
        verify_direction(plan)
        if plan.get("recoveryPolicy") != NO_BACKUP_POLICY or any(k in plan for k in ("beforeBackupSha256", "beforeRestoreSha256")):
            raise ValueError("No-new-backup plan cannot contain backup claims")
    else:
        parent.checked_backup(folder / "before-backup.json", plan["beforeBackupSha256"],
                              folder / "before-restore.json", plan["beforeRestoreSha256"], 140)
    return folder, plan


def valid_rows(value):
    from jackyun_audit_catalog import COLUMNS
    return isinstance(value, dict) and set(value) == set(COLUMNS) and all(
        isinstance(row, dict) and set(row) == {"columns", "rows", "sha256"}
        and type(row["rows"]) is int and 0 <= row["rows"] <= 10_000_000
        and isinstance(row["sha256"], str) and parent.HEX.fullmatch(row["sha256"])
        and isinstance(row["columns"], list) and all(isinstance(c, str) for c in row["columns"]) and "id" in row["columns"]
        and len(row["columns"]) == len(set(row["columns"]))
        and not set(row["columns"]) & set(COLUMNS[table])
        for table, row in value.items())


def verify_active(root, runtime, *, installed=False):
    pointer = parent.read(Path(runtime) / ACTIVE)
    if set(pointer) != {"version", "operationId", "receiptSha256"} or pointer["version"] not in {VERSION, NO_BACKUP_VERSION}:
        raise ValueError("Invalid Jackyun active reference")
    folder, plan = load_plan(runtime, pointer["operationId"])
    receipt = parent.read(folder / ("installed.json" if installed else "finalized.json"), pointer["receiptSha256"])
    if pointer["version"] != plan["version"] or receipt.get("version") != plan["version"] or receipt.get("status") != ("schema_installed" if installed else "verified") \
            or receipt.get("planSha256") != parent.sha(folder / "plan.json") or receipt.get("steps") != list(STEPS) \
            or receipt.get("migrationCount") != 142 or receipt.get("migrationSha256") != source_delta(root, folder / "baseline") \
            or receipt["migrationSha256"] != plan["migrationSha256"] or not valid_rows(receipt.get("beforeRows")) \
            or receipt.get("beforeRows") != receipt.get("afterRows"):
        raise ValueError("Jackyun migration receipt is incomplete or changed")
    if no_backup(plan):
        if receipt.get("backupPerformed") is not False or receipt.get("rehearsalPerformed") is not False \
                or receipt.get("recoveryPolicy") != NO_BACKUP_POLICY or any(k in receipt for k in ("afterBackupSha256", "afterRestoreSha256")):
            raise ValueError("No-new-backup receipt must honestly record omitted operations")
    elif not installed:
        parent.checked_backup(folder / "after-backup.json", receipt["afterBackupSha256"], folder / "after-restore.json", receipt["afterRestoreSha256"], 142)
    return receipt, plan, folder


def complete_database(root, runtime):
    receipt, _, folder = verify_active(root, runtime)
    base, _ = parent_proof(runtime, folder / "baseline")
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", 5432):
            raise ValueError("Jackyun migration database identity changed")
        from postgres_no_key_backup import verify_receipt_generation
        if verify_receipt_generation(cursor) != 142:
            raise ValueError("Jackyun catalogue is incomplete")
    executor = MigrationExecutor(connection)
    if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != base | set(STEPS) \
            or executor.migration_plan(executor.loader.graph.leaf_nodes()):
        raise ValueError("Pending or unknown migration; ordinary startup cannot migrate")
    return {"status": "complete", "migrationCount": receipt["migrationCount"]}


def apply_steps(connection, base, *, expected_before=None):
    from django.db import transaction
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    targets = [tuple(step.split(".", 1)) for step in STEPS]
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(142,20261013)")
            if cursor.fetchone() != (True,):
                raise ValueError("Another audit migration owner is active")
            verify_catalog(cursor, installed=False)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != base:
            raise ValueError("Original migration catalogue changed; no replay")
        executor = MigrationExecutor(connection)
        pending = [(".".join((step.app_label, step.name)), reverse) for step, reverse in executor.migration_plan(targets)]
        if pending != [(step, False) for step in STEPS]:
            raise ValueError("Only the two reviewed audit migrations may execute")
        before = original_rows(connection)
        if expected_before is not None and before != expected_before:
            raise ValueError("Audit data changed after the original install intent")
        executor.migrate(targets)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != base | set(STEPS):
            raise ValueError("Unexpected audit migration result")
        with connection.cursor() as cursor:
            verify_catalog(cursor, installed=True)
        after = original_rows(connection)
        if before != after:
            raise ValueError("Original audit rows changed")
    return before, after


def publish_installed(runtime, operation, folder, plan, before, after):
    result = {"version": plan["version"], "status": "schema_installed", "steps": list(STEPS), "migrationCount": 142,
              "migrationSha256": plan["migrationSha256"], "planSha256": parent.sha(folder / "plan.json"),
              "beforeRows": before, "afterRows": after}
    if no_backup(plan):
        result.update(recoveryPolicy=NO_BACKUP_POLICY, backupPerformed=False, rehearsalPerformed=False)
    file = folder / "installed.json"
    if file.exists():
        if parent.read(file) != result:
            raise ValueError("Existing installed receipt differs")
    else:
        publish(file, result)
    pointer = {"version": plan["version"], "operationId": operation, "receiptSha256": parent.sha(file)}
    active = Path(runtime) / ACTIVE
    if active.exists():
        if parent.read(active) != pointer:
            raise ValueError("Another addition owns the active reference")
    else:
        publish(active, pointer)
    return result


def copy_proof(source, target, digest):
    """Resume only exact prior copies; never overwrite evidence of interruption."""
    parent.read(source, digest)
    if Path(target).exists():
        parent.read(target, digest)
    else:
        with Path(target).open("xb") as output:
            output.write(Path(source).read_bytes()); output.flush(); os.fsync(output.fileno())
        parent.read(target, digest)


def main(args):
    root, runtime = Path(args.root).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed production runtime is required")
    if args.command == "admission":
        return admission(root, runtime, args.evidence, args.evidence_sha)
    if args.command in {"release", "successor"}:
        return verify_active(root, runtime)[0]
    if args.command != "deployment" and not args.execute:
        raise ValueError("Explicit migration adoption execution required")
    folder = directory(runtime, args.operation)
    if args.command == "plan":
        evidence = admission(root, runtime, args.evidence, args.evidence_sha)
        window_sha = parent.maintenance(runtime, args.maintenance)
        if getattr(args, "without_new_backup", False) != no_backup(evidence):
            raise ValueError("Operator recovery policy differs from reviewed direction")
        if not no_backup(evidence):
            backup = parent.checked_backup(args.backup, args.backup_sha, args.restore, args.restore_sha, 140)
            window = parent.read(runtime / "run/system-maintenance.json")
            if backup["software"]["deploymentManifestSha256"] != evidence["predecessorSha256"] \
                    or datetime.fromisoformat(backup["createdAt"].replace("Z", "+00:00")) < datetime.fromisoformat(window["createdAt"].replace("Z", "+00:00")):
                raise ValueError("Fresh backup within the exact maintenance window is required")
        if folder.exists() or (runtime / ACTIVE).exists() or not parent.HEX.fullmatch(args.candidate_sha):
            raise ValueError("Addition exists or candidate manifest is invalid")
        folder.mkdir(parents=True)
        shutil.copytree(runtime / "app", folder / "baseline", ignore=shutil.ignore_patterns(".wrangler", "runtime-tools", "__pycache__"))
        copies = [("candidate.json", args.evidence)]
        if not no_backup(evidence):
            copies += [("before-backup.json", args.backup), ("before-restore.json", args.restore)]
        for name, file in copies:
            shutil.copyfile(file, folder / name)
        plan = {**evidence, "status": "prepared", "operationId": args.operation, "maintenanceId": args.maintenance,
                "maintenanceSha256": window_sha, "candidateManifestSha256": args.candidate_sha,
                "candidateEvidenceSha256": args.evidence_sha}
        if not no_backup(evidence):
            plan.update(beforeBackupSha256=args.backup_sha, beforeRestoreSha256=args.restore_sha)
        publish(folder / "plan.json", plan)
        return {"status": "prepared", "planSha256": parent.sha(folder / "plan.json")}
    folder, plan = load_plan(runtime, args.operation)
    if args.command != "deployment" and getattr(args, "without_new_backup", False) != no_backup(plan):
        raise ValueError("Operator recovery policy differs from sealed plan")
    if parent.maintenance(runtime, plan["maintenanceId"]) != plan["maintenanceSha256"] \
            or source_delta(root, folder / "baseline") != plan["migrationSha256"]:
        raise ValueError("Maintenance or exact migration source changed")
    if args.command == "deployment":
        if parent.sha(root / "deployment.json") != plan["candidateManifestSha256"] \
                or parent.sha(runtime / "app/deployment.json") != plan["predecessorSha256"]:
            raise ValueError("Deployment binding changed")
        if not no_backup(plan):
            parent.checked_backup(folder / "before-backup.json", plan["beforeBackupSha256"], folder / "before-restore.json", plan["beforeRestoreSha256"], 140)
        return plan
    if parent.sha(runtime / "app/deployment.json") != plan["candidateManifestSha256"]:
        raise ValueError("Installed application does not match the migration plan")
    if args.command in {"install", "reconcile"}:
        sys.path.insert(0, str(root / "backend")); os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
        import django
        django.setup()
        from django.db import connection
        from postgres_no_key_backup import verify_receipt_generation
        base, _ = parent_proof(runtime, folder / "baseline")
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_user,inet_server_port()")
            if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", 5432):
                raise ValueError("Migration owner or database identity changed")
            generation = verify_receipt_generation(cursor)
        intent_file = folder / "install-intent.json"
        if args.command == "reconcile":
            intent = parent.read(intent_file)
            if intent.get("version") != plan["version"] or not valid_rows(intent.get("beforeRows")) or intent["planSha256"] != parent.sha(folder / "plan.json") or original_rows(connection) != intent["beforeRows"]:
                raise ValueError("Uncertain result no longer matches the original intent")
            if generation != 142:
                raise ValueError("Migration not committed; preserve intent and review before another install")
            return publish_installed(runtime, args.operation, folder, plan, intent["beforeRows"], original_rows(connection))
        if intent_file.exists() or (runtime / ACTIVE).exists() or generation != 140:
            raise ValueError("An install intent or result already exists; reconcile, never blindly replay")
        before = original_rows(connection)
        publish(intent_file, {"version": plan["version"], "planSha256": parent.sha(folder / "plan.json"), "beforeRows": before, "at": datetime.now(timezone.utc).isoformat()})
        actual_before, after = apply_steps(connection, base, expected_before=before)
        if before != actual_before:
            raise ValueError("Audit data changed after the install intent")
        return publish_installed(runtime, args.operation, folder, plan, before, after)
    if args.command == "finalize":
        pointer = runtime / ACTIVE
        pointer_sha = parent.sha(pointer)
        if (folder / "finalized.json").exists() and parent.read(pointer).get("receiptSha256") == parent.sha(folder / "finalized.json"):
            done, _, done_folder = verify_active(root, runtime)
            if done_folder != folder or (not no_backup(plan) and (done["afterBackupSha256"] != args.backup_sha or done["afterRestoreSha256"] != args.restore_sha)):
                raise ValueError("Completed adoption differs from requested finalization")
            return done
        receipt, _, active_folder = verify_active(root, runtime, installed=True)
        if active_folder != folder:
            raise ValueError("Different addition owns the installation")
        if no_backup(plan):
            # Inspect the committed result while maintenance still excludes business writes.
            sys.path.insert(0, str(root / "backend")); os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
            import django
            django.setup()
            from django.db import connection
            from django.db.migrations.executor import MigrationExecutor
            from django.db.migrations.recorder import MigrationRecorder
            from postgres_no_key_backup import verify_receipt_generation
            base, _ = parent_proof(runtime, folder / "baseline")
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database(),current_user,inet_server_port()")
                if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", 5432) or verify_receipt_generation(cursor) != 142:
                    raise ValueError("Committed migration database identity or catalogue changed")
            if original_rows(connection) != receipt["afterRows"] \
                    or {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != base | set(STEPS) \
                    or MigrationExecutor(connection).migration_plan(MigrationExecutor(connection).loader.graph.leaf_nodes()):
                raise ValueError("Committed migration or preserved data differs")
            result = {**receipt, "status": "verified"}
        else:
            backup = parent.checked_backup(args.backup, args.backup_sha, args.restore, args.restore_sha, 142)
            if backup["software"]["deploymentManifestSha256"] != plan["candidateManifestSha256"]:
                raise ValueError("Post-migration backup belongs to another application")
            for name, file, digest in [("after-backup.json", args.backup, args.backup_sha), ("after-restore.json", args.restore, args.restore_sha)]:
                copy_proof(file, folder / name, digest)
            result = {**receipt, "status": "verified", "afterBackupSha256": args.backup_sha, "afterRestoreSha256": args.restore_sha}
        final = folder / "finalized.json"
        if final.exists():
            if parent.read(final) != result:
                raise ValueError("Interrupted finalization differs")
        else:
            publish(final, result)
        publish(pointer, {"version": plan["version"], "operationId": args.operation, "receiptSha256": parent.sha(final)}, previous=pointer_sha)
        return result
    raise ValueError("Unknown audit addition operation")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["admission", "plan", "deployment", "install", "reconcile", "finalize", "release", "successor"])
    for name in ["root", "runtime", "operation", "maintenance", "evidence", "evidence-sha", "candidate-sha", "backup", "backup-sha", "restore", "restore-sha"]:
        parser.add_argument("--" + name, default="")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--without-new-backup", action="store_true")
    try:
        print(json.dumps({"status": "verified", "result": main(parser.parse_args())}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}, ensure_ascii=True)); sys.exit(1)
