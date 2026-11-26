"""Finite schema-only sales subdivision edits child of the unchanged verified162 generation.

One sales migration (0014) creates the label overlay table and the manual
assignment table in one transaction. It creates no role, grant or business row.
The reader/writer ACL is provisioned by the ordinary Django start
(analysis_options_permissions.provision_subdivisions), so installation and
finalization accept the owner-only ACL and every later check accepts either that
or the exact reviewed grants. Production lifecycle/mutex/credentials stay with
bi-app-adopt.ps1; reconcile only proves an already committed163 and never replays.
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
import ops_query_index_addition as parent
from jackyun_audit_addition import publish
from sales_subdivision_edits_catalog import (FILES, STEPS, verify_catalog, verify_defaults,
    preservation, verify_initial_values)

VERSION = "teruisi-sales-subdivision-edits-schema-addition-v1"
POLICY = "schema-only-no-full-backup-or-restore-v1"
ACTIVE = "sales-subdivision-edits-addition-active.json"
CHECKS = {"python-syntax", "node-syntax", "powershell-syntax", "migration-closure"}
CODE_FILES = tuple(dict.fromkeys((*parent.CODE_FILES,
    "tools/sales_subdivision_edits_addition.py", "tools/sales_subdivision_edits_catalog.py",
    "tools/sales_subdivision_edits_candidate.py",
    "backend/sales/migrations/0014_product_subdivision_edits.py",
    "backend/sales/models.py", "backend/sales/analysis_options_permissions.py")))


def directory(runtime, operation):
    if not isinstance(operation, str) or not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise ValueError("Invalid SalesSubdivisionEdits schema operation")
    return Path(runtime) / "sales-subdivision-edits-additions" / operation


def steps_files(generation):
    if type(generation) is not int or generation != 162:
        raise ValueError("Only the exact verified162 parent is supported")
    return STEPS, FILES


def steps_for_base(base):
    if len(base) != 162 or set(base) & set(STEPS):
        raise ValueError("SalesSubdivisionEdits parent migration membership differs")
    return STEPS


def source_delta(root, baseline):
    before, after = common.migrations(baseline), common.migrations(root)
    if (set(before) & set(FILES) or set(after) != set(before) | set(FILES)
            or any(after[p] != value for p, value in before.items())
            or any(after.get(p) != value for p, value in FILES.items())):
        raise ValueError("Only the exact reviewed162-to163 delta is supported")
    return common.digest(after)


def parent_proof(runtime, baseline):
    """Prove finalized162 against this generation's frozen162-era baseline.

    Pass baseline, never the new root: the parent's source_delta must see only its
    original159-to162 index change, without this generation's sales 0014 migration.
    """
    receipt, _, folder, previous = parent._verify_active_with_base(baseline, runtime)
    catalogue = previous | set(parent.steps_for_base(previous))
    if len(catalogue) != 162 or receipt["migrationCount"] != 162:
        raise ValueError("SalesSubdivisionEdits requires its exact verified162 parent")
    steps_for_base(catalogue)
    return catalogue, common.sha(Path(runtime) / parent.ACTIVE)


def code_digest(root):
    return common.digest({name: common.sha(Path(root) / name) for name in CODE_FILES})


REHEARSAL_PATH = "docs/subdivision-category-edit-20261126/rehearsal-result.json"
REHEARSAL_VERSION = "teruisi-sales-subdivision-edits-pg-rehearsal-v1"
REHEARSAL_CHECKS = {
    "exact162-parent", "step-applied-by-real-gate", "exact163-catalog-owner-only", "exact163-catalog-provisioned-acl",
    "old-rows-and-ACL-preserved", "new-tables-empty", "reader-writer-privileges-enforced",
    "missing-table-rejected-and-rolled-back", "excess-grant-rejected", "committed163-not-replayed",
}


def catalog_digest():
    import sales_subdivision_edits_catalog as catalog
    return common.digest({
        "columns": catalog.COLUMNS, "constraints": catalog.CONSTRAINTS, "indexes": catalog.INDEXES,
        "grants": {t: {r: sorted(p) for r, p in g.items()} for t, g in catalog.GRANTS.items()},
        "sequenceGrants": {r: sorted(p) for r, p in catalog.SEQUENCE_GRANTS.items()},
    })


def verify_rehearsal_evidence(root, validation):
    """Merge-time binding only: a committed real PG17 rehearsal must still describe these exact sources.

    Called by check_schema_code_digest, never by admission or any release path, so a release does not
    depend on the repository's rehearsal file. Editing the migration or this catalogue's expectations
    invalidates it and forces a new rehearsal.
    """
    root = Path(root)
    ref = validation.get("rehearsalEvidence")
    if (type(ref) is not dict or set(ref) != {"path", "sha256"} or ref["path"] != REHEARSAL_PATH
            or not isinstance(ref["sha256"], str) or not common.HEX.fullmatch(ref["sha256"])):
        raise ValueError("SalesSubdivisionEdits requires its SHA-bound real PostgreSQL rehearsal result")
    result = common.read(root / REHEARSAL_PATH, ref["sha256"])
    cleanup = result.get("cleanup") if type(result) is dict else None
    database = result.get("database") if type(result) is dict else None
    if (type(result) is not dict or result.get("version") != REHEARSAL_VERSION or result.get("status") != "passed"
            or result.get("generations") != [162, 163] or result.get("productionTouched") is not False
            or result.get("fullBackupOrRestorePerformed") is not False
            or type(result.get("checks")) is not list or len(result["checks"]) != len(REHEARSAL_CHECKS)
            or set(result["checks"]) != REHEARSAL_CHECKS
            or type(cleanup) is not dict
            or set(cleanup) != {"started", "stopped", "privateDataRemoved", "passwordFileRemoved", "childExitZero"}
            or any(value is not True for value in cleanup.values())
            or type(database) is not dict or set(database) != {"name", "user", "port", "serverVersionNumber"}
            or database["name"] != "teruisi_sales_subdivision_edits_rehearsal" or database["user"] != "sub163_fixture"
            or type(database["port"]) is not int or not 55542 <= database["port"] < 55552
            or type(database["serverVersionNumber"]) is not int or not 170000 <= database["serverVersionNumber"] < 180000):
        raise ValueError("SalesSubdivisionEdits PostgreSQL rehearsal result, checks or cleanup is incomplete")
    if result.get("migrationSha256") != common.digest(common.migrations(root)):
        raise ValueError("SalesSubdivisionEdits migrations changed since the PostgreSQL rehearsal; rehearse again")
    if result.get("catalogSha256") != catalog_digest():
        raise ValueError("SalesSubdivisionEdits catalogue expectations changed since the PostgreSQL rehearsal; rehearse again")
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
            raise ValueError("Unsafe SalesSubdivisionEdits source inventory")
        result[relative.as_posix()] = common.sha(path)
    if not result:
        raise ValueError("Missing SalesSubdivisionEdits backend source inventory")
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
        raise ValueError("Exact code-checked SalesSubdivisionEdits schema-only candidate is required")
    if (value["predecessorSha256"] != common.sha(Path(runtime) / "app/deployment.json")
            or value["parentReferenceSha256"] != parent_sha
            or value["migrationSha256"] != source_delta(root, Path(runtime) / "app")
            or value["codeSha256"] != code_digest(root) or value["sourceSha256"] != source_inventory(root)):
        raise ValueError("SalesSubdivisionEdits candidate, exact predecessor or reviewed source changed")
    proof = common.read(value["validation"], value["validationSha256"])
    if (proof.get("version") != "sales-subdivision-edits-mandatory-code-checks-v1" or proof.get("status") != "code-checked"
            or proof.get("productionTouched") is not False or proof.get("functionalValidationPerformed") is not False or proof.get("steps") != list(STEPS)
            or proof.get("generations") != [162, 163]
            or proof.get("parentVariants") != [[162, 163]]
            or proof.get("fullBackupOrRestorePerformed") is not False
            or proof.get("codeSha256") != value["codeSha256"]
            or proof.get("migrationSha256") != value["migrationSha256"]
            or set(proof.get("checks", [])) != CHECKS):
        raise ValueError("Bound SalesSubdivisionEdits mandatory code-check record is incomplete")
    return value


def prepared_binding(runtime, prepared_id, receipt_sha, candidate_sha):
    if not re.fullmatch(r"[0-9a-f]{32}", prepared_id or ""):
        raise ValueError("Exact SalesSubdivisionEdits prepared application is required")
    receipt = common.read(Path(runtime) / ("app.prepare-" + prepared_id + ".json"), receipt_sha)
    expected = {"version", "id", "runtimeRoot", "predecessorManifestSha256", "candidateManifestSha256"}
    if (type(receipt) is not dict or set(receipt) != expected
            or receipt["version"] != "teruisi-django-prepared-app-v1" or receipt["id"] != prepared_id
            or Path(receipt["runtimeRoot"]) != Path(runtime)
            or receipt["candidateManifestSha256"] != candidate_sha
            or not common.HEX.fullmatch(receipt["predecessorManifestSha256"])):
        raise ValueError("SalesSubdivisionEdits prepared receipt identity changed")
    if not common.HEX.fullmatch(candidate_sha or ""):
        raise ValueError("Invalid SalesSubdivisionEdits candidate manifest hash")
    return receipt


def load_plan(runtime, operation):
    return _load_plan_with_base(runtime, operation)[:2]


def _load_plan_with_base(runtime, operation):
    folder = directory(runtime, operation)
    if any(folder.glob("*.tmp")) or any(Path(runtime).glob(ACTIVE + ".*.tmp")):
        raise ValueError("Uncertain SalesSubdivisionEdits evidence publication; preserve temporary files")
    plan = common.read(folder / "plan.json")
    base, parent_sha = parent_proof(runtime, folder / "baseline")
    if (plan.get("version") != VERSION or plan.get("operationId") != operation
            or plan.get("steps") != list(steps_for_base(base)) or plan.get("databasePolicy") != POLICY):
        raise ValueError("SalesSubdivisionEdits plan identity changed")
    evidence = common.read(folder / "candidate.json", plan["candidateEvidenceSha256"])
    if (parent_sha != plan["parentReferenceSha256"]
            or any(plan.get(key) != value for key, value in evidence.items() if key != "status")
            or common.sha(folder / "baseline/deployment.json") != plan["predecessorSha256"]):
        raise ValueError("SalesSubdivisionEdits plan no longer matches exact parent or review")
    prepared = prepared_binding(runtime, plan["preparedAppId"], plan["preparedReceiptSha256"], plan["candidateManifestSha256"])
    if prepared["predecessorManifestSha256"] != plan["predecessorSha256"]:
        raise ValueError("SalesSubdivisionEdits prepared predecessor differs from plan")
    return folder, plan, frozenset(base)


def verify_active(root, runtime, *, installed=False):
    return _verify_active_with_base(root, runtime, installed=installed)[:3]


def _verify_active_with_base(root, runtime, *, installed=False):
    pointer = common.read(Path(runtime) / ACTIVE)
    if (type(pointer) is not dict or set(pointer) != {"version", "operationId", "receiptSha256", "parentReferenceSha256"}
            or pointer["version"] != VERSION):
        raise ValueError("Invalid SalesSubdivisionEdits schema active reference")
    folder, plan, base = _load_plan_with_base(runtime, pointer["operationId"])
    receipt = common.read(folder / ("installed.json" if installed else "finalized.json"), pointer["receiptSha256"])
    intent = install_intent(folder)
    if (pointer["parentReferenceSha256"] != plan["parentReferenceSha256"]
            or receipt.get("version") != VERSION or receipt.get("status") != ("schema_installed" if installed else "verified")
            or receipt.get("planSha256") != common.sha(folder / "plan.json")
            or receipt.get("steps") != plan["steps"] or receipt.get("migrationCount") != 163
            or receipt.get("migrationSha256") != source_delta(root, folder / "baseline")
            or receipt["migrationSha256"] != plan["migrationSha256"]
            or receipt.get("legacyDataPreserved") is not True
            or receipt.get("preservation") != intent["preservation"]
            or receipt.get("installIntentSha256") != common.sha(folder / "install-intent.json")
            or receipt.get("databasePolicy") != POLICY or not installed and receipt.get("permissionsVerified") is not True):
        raise ValueError("SalesSubdivisionEdits schema receipt is incomplete or changed")
    return receipt, plan, folder, base


def database_identity(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", "127.0.0.1", 5432):
            raise ValueError("SalesSubdivisionEdits schema database identity changed")


def apply_steps(connection, base, expected):
    from django.db import transaction
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    steps = steps_for_base(base)
    targets = [tuple(step.split(".", 1)) for step in STEPS]
    with transaction.atomic(using=connection.alias):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(163,20261126)")
            if cursor.fetchone() != (True,):
                raise ValueError("Another SalesSubdivisionEdits schema migration owner is active")
            if verify_receipt_generation(cursor) != len(base):
                raise ValueError("SalesSubdivisionEdits schema requires exact162; never replay")
            if preservation(cursor) != expected:
                raise ValueError("SalesSubdivisionEdits legacy rows or permissions changed after intent")
            verify_catalog(cursor, installed=False)
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base):
            raise ValueError("SalesSubdivisionEdits parent migration catalogue changed")
        executor = MigrationExecutor(connection)
        pending = [(".".join((step.app_label, step.name)), reverse) for step, reverse in executor.migration_plan(targets)]
        if pending != [(step, False) for step in steps]:
            raise ValueError("Only the exact reviewed finite forward migration chain may execute")
        # The full leaf-node state, not just this generation's targets: the
        # inherited contract covers other apps' models (the 162 indexes among
        # them), and a targets-only state would not contain them. This is the
        # same post-migration state check_database verifies afterwards.
        verify_defaults(executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps)
        for target in [tuple(step.split(".", 1)) for step in steps]:
            MigrationExecutor(connection).migrate([target])
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base)):
            raise ValueError("Unexpected SalesSubdivisionEdits schema migration result")
        with connection.cursor() as cursor:
            # The migration issues no GRANT: right after it the ACL must be owner-only.
            if verify_receipt_generation(cursor, subdivision_permissions=False) != 163:
                raise ValueError("SalesSubdivisionEdits schema result is not exact163")
            verify_catalog(cursor, permissions=False)
            verify_initial_values(cursor)
            if preservation(cursor) != expected:
                raise ValueError("SalesSubdivisionEdits changed existing rows or permissions")


def install_intent(folder):
    value = common.read(Path(folder) / "install-intent.json")
    state = value.get("preservation")
    if (type(value) is not dict or set(value) != {"version", "planSha256", "at", "preservation"}
            or value["version"] != VERSION or value["planSha256"] != common.sha(Path(folder) / "plan.json")
            or type(state) is not dict or set(state) != {"rows", "legacyRowsSha256", "permissionsSha256"}
            or type(state["rows"]) is not int or not 0 <= state["rows"] <= 500000
            or any(not isinstance(state[key], str) or not common.HEX.fullmatch(state[key])
                   for key in ("legacyRowsSha256", "permissionsSha256"))):
        raise ValueError("SalesSubdivisionEdits unknown intent binding changed; no replay")
    return value


def publish_installed(runtime, operation, folder, plan):
    intent = install_intent(folder)
    value = {"version": VERSION, "status": "schema_installed", "steps": plan["steps"], "migrationCount": 163,
        "migrationSha256": plan["migrationSha256"], "planSha256": common.sha(folder / "plan.json"),
        "legacyDataPreserved": True, "preservation": intent["preservation"],
        "installIntentSha256": common.sha(folder / "install-intent.json"),
        "databasePolicy": POLICY}
    file = folder / "installed.json"
    if file.exists():
        if common.read(file) != value:
            raise ValueError("SalesSubdivisionEdits original installed receipt differs")
    else:
        publish(file, value)
    pointer = {"version": VERSION, "operationId": operation, "receiptSha256": common.sha(file),
               "parentReferenceSha256": plan["parentReferenceSha256"]}
    active = Path(runtime) / ACTIVE
    if active.exists():
        if common.read(active) != pointer:
            raise ValueError("Another SalesSubdivisionEdits schema operation owns active reference")
    else:
        publish(active, pointer)
    return value


def check_database(connection, base, *, permissions="either", empty=False, expected=None):
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    from postgres_no_key_backup import verify_receipt_generation
    with connection.cursor() as cursor:
        if verify_receipt_generation(cursor, subdivision_permissions=permissions) != 163:
            raise ValueError("SalesSubdivisionEdits schema catalogue is incomplete")
        verify_catalog(cursor, permissions=permissions)
        if empty:
            verify_initial_values(cursor)
        if expected is not None and preservation(cursor) != expected:
            raise ValueError("SalesSubdivisionEdits legacy data or permissions differ from original intent")
    executor = MigrationExecutor(connection)
    if ({".".join(x) for x in MigrationRecorder(connection).applied_migrations()} != set(base) | set(steps_for_base(base))
            or executor.migration_plan(executor.loader.graph.leaf_nodes())):
        raise ValueError("Pending or unknown migrations; ordinary SalesSubdivisionEdits startup cannot migrate")
    verify_defaults(executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps)


def complete_database(root, runtime):
    receipt, _, folder, base = _verify_active_with_base(root, runtime)
    from django.db import connection
    database_identity(connection)
    check_database(connection, base)
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
        raise ValueError("SalesSubdivisionEdits install intent/result exists; reconcile without replay")
    with connection.cursor() as cursor:
        state = preservation(cursor)
    publish(intent_file, {"version": VERSION, "planSha256": common.sha(folder / "plan.json"),
                          "at": datetime.now(timezone.utc).isoformat(), "preservation": state})
    apply_steps(connection, base, state)
    return publish_installed(runtime, operation, folder, plan)


def main(args):
    root, runtime = Path(args.root).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed SalesSubdivisionEdits schema runtime is required")
    if args.command == "admission":
        return admission(root, runtime, args.evidence, args.evidence_sha)
    if args.command in {"release", "successor"}:
        return verify_active(root, runtime)[0]
    if args.command != "deployment" and (not args.execute or not args.schema_only):
        raise ValueError("Explicit schema-only SalesSubdivisionEdits adoption execution required")
    if args.command == "plan":
        evidence = admission(root, runtime, args.evidence, args.evidence_sha)
        window_sha = common.maintenance(runtime, args.maintenance)
        prepared = prepared_binding(runtime, args.prepared_id, args.prepared_receipt_sha, args.candidate_sha)
        if prepared["predecessorManifestSha256"] != evidence["predecessorSha256"]:
            raise ValueError("SalesSubdivisionEdits prepared predecessor differs from evidence")
        folder = directory(runtime, args.operation)
        if folder.exists() or (runtime / ACTIVE).exists():
            raise ValueError("SalesSubdivisionEdits schema operation already exists")
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
        raise ValueError("SalesSubdivisionEdits maintenance or exact candidate source changed")
    if args.command == "deployment":
        if (common.sha(root / "deployment.json") != plan["candidateManifestSha256"]
                or common.sha(runtime / "app/deployment.json") != plan["predecessorSha256"]):
            raise ValueError("SalesSubdivisionEdits deployment binding changed")
        return plan
    if common.sha(runtime / "app/deployment.json") != plan["candidateManifestSha256"]:
        raise ValueError("Installed application differs from SalesSubdivisionEdits plan")
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
                raise ValueError("Another SalesSubdivisionEdits operation owns finalization")
            check_database(connection, base, empty=True, expected=install_intent(folder)["preservation"])
            return result
        receipt, _, active_folder = verify_active(root, runtime, installed=True)
        if active_folder != folder:
            raise ValueError("Another SalesSubdivisionEdits operation owns installation")
        check_database(connection, base, empty=True, expected=install_intent(folder)["preservation"])
        result = {**receipt, "status": "verified", "permissionsVerified": True}
        final = folder / "finalized.json"
        if final.exists():
            if common.read(final) != result:
                raise ValueError("Interrupted SalesSubdivisionEdits finalization differs")
        else:
            publish(final, result)
        publish(pointer, {"version": VERSION, "operationId": args.operation, "receiptSha256": common.sha(final),
                          "parentReferenceSha256": plan["parentReferenceSha256"]}, previous=pointer_sha)
        return result
    raise ValueError("Unknown SalesSubdivisionEdits schema operation")


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
