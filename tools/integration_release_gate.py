"""Bind integration release admission to source and independently restored backup evidence.

No credentials, database writes or lifecycle operations live in this module.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

from integration_migration_plan import (canonical, digest, load_policy, python_source_sha256, PlanBlocked,
    DELTA_VERSION, DELTA_STEP, LEGACY_CATALOGUE_SHA256)
from integration_migration_journal import validate_baseline_witness

VERSION = "teruisi-integration-release-v1"
POLICY = "config/integration-migration-policy-v3.json"
DELTA_POLICY = "config/integration-migration-policy-v4-netshop-presence.json"
DELTA_RELEASE = "teruisi-netshop-presence-release-v1"
DELTA_ACTIVE = "teruisi-netshop-presence-active-v1"
CONTROLS = ("tools/django-local-service.ps1", "tools/django-postgres-maintenance.ps1",
    "tools/django-integration-install.ps1")
HEX = re.compile(r"[0-9a-f]{64}\Z")


def read_json(path, approved=None):
    path = Path(path).absolute()
    for item in (path, *path.parents):
        if item.is_symlink() or getattr(item, "is_junction", lambda: False)():
            raise PlanBlocked("integration evidence path is redirected")
    if not path.is_file() or path.stat().st_nlink != 1 or path.stat().st_size > 4*1024*1024:
        raise PlanBlocked("integration evidence file is missing or unsafe")
    raw = path.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if approved is not None and (not HEX.fullmatch(approved) or approved != actual):
        raise PlanBlocked("integration evidence digest changed")
    def unique(items):
        value = {}
        for key, item in items:
            if key in value:
                raise PlanBlocked("integration evidence repeats a key")
            value[key] = item
        return value
    try:
        return json.loads(raw, object_pairs_hook=unique), actual
    except (UnicodeError, ValueError):
        raise PlanBlocked("integration evidence JSON is invalid") from None


def migration_digest(root):
    root = Path(root).absolute()
    files = {}
    for path in sorted((root / "backend").glob("*/migrations/*.py")):
        if not path.is_file():
            continue
        for parent in (path, *path.parents):
            if parent.is_symlink() or getattr(parent, "is_junction", lambda: False)():
                raise PlanBlocked("integration backend path is redirected")
            if parent == root:
                break
        if not path.is_file() or path.stat().st_nlink != 1:
            raise PlanBlocked("integration backend source is unsafe")
        files[path.relative_to(root).as_posix()] = python_source_sha256(path.read_bytes())
    if not 100 <= len(files) <= 4096:
        raise PlanBlocked("integration migration inventory invalid")
    return digest(files)


def verify_candidate(root, evidence_path, approved):
    if not isinstance(approved, str) or not HEX.fullmatch(approved):
        raise PlanBlocked("candidate requires an exact approved evidence digest")
    root = Path(root)
    evidence, evidence_sha = read_json(evidence_path, approved)
    delta = evidence.get("generation") == DELTA_VERSION
    if evidence.get("generation") not in (None, DELTA_VERSION):
        raise PlanBlocked("unknown integration candidate generation")
    policy = load_policy(root / (DELTA_POLICY if delta else POLICY))
    source = policy.verify_source(root)
    controls = {name: python_source_sha256((root / name).read_bytes()) for name in CONTROLS}
    if evidence.get("controlsSha256") != controls:
        raise PlanBlocked("integration lifecycle controller differs from the reviewed candidate")
    migration, restored = evidence.get("migration", {}), evidence.get("restore", {})
    if (evidence.get("sourcePolicySha256") != policy.sha256
            or evidence.get("productionWrites") is not False
            or evidence.get("productionInstalled") is not False
            or migration.get("status") != ("delta_completed" if delta else "mixed_completed")
            or migration.get("baselineReceiptCount") != (138 if delta else 62)
            or migration.get("finalReceiptCount") != (139 if delta else 138)
            or migration.get("journalCommittedSteps") != (1 if delta else 76)
            or migration.get("productionInstallerEngineVerified") is not True
            or migration.get("pinnedBaselineRuntimeGrants") is not True
            or migration.get("ordinaryRoleStillUnprivileged") is not True
            or migration.get("modelBudgetAndVersionsVerified") is not True
            or not HEX.fullmatch(str(migration.get("journalSha256", "")))
            or migration.get("reviewedPolicySha256") != policy.sha256
            or restored.get("status") != "passed"
            or restored.get("restoredRuntimeReady") != {"ai_reader": True, "ai_writer": True}
            or restored.get("runtimePrivilegeNegativeChecks", 0) < 25
            or restored.get("maintenancePythonBackupRestoreVerified") is not True
            or restored.get("maintenancePowerShellPayloadVerified") is not True
            or restored.get("privateKeyRows") != 0
            or restored.get("newRecoveryKeyGenerated") is not False
            or restored.get("nonemptyPrivateKeyTableRejectedBeforeBackup") is not True
            or restored.get("ownerAclAndRowsPreserved") is not True):
        raise PlanBlocked("integration candidate lacks the reviewed upgrade and recovery proof")
    result = {"policySha256": policy.sha256, "sourceSha256": source,
        "migrationSha256": migration_digest(root), "candidateEvidenceSha256": evidence_sha}
    if delta:
        witness = validate_baseline_witness(evidence.get("baselineWitness"))
        if (policy.version != DELTA_VERSION or evidence.get("baselineWitnessScope") != "isolated"
                or migration.get("steps") != [DELTA_STEP]
                or evidence.get("baselineReceiptChainVerified") is not True
                or evidence.get("before138BackupRestoreVerified") is not True
                or evidence.get("after139BackupRestoreVerified") is not True
                or evidence.get("cacheSchemaAndInvalidatorVerified") is not True
                or evidence.get("protectedAiCatalogueUnchanged") is not True):
            raise PlanBlocked("delta candidate lacks exact baseline/schema/recovery proof")
        result.update(generation=DELTA_VERSION, baselineWitnessSha256=digest(witness))
    return result


def delta_directory(runtime, operation_id):
    if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{32}", operation_id):
        raise PlanBlocked("delta operation identity invalid")
    return Path(runtime) / "integration-deltas" / operation_id


def verify_parent_138(runtime, witness):
    witness = validate_baseline_witness(witness)
    parent, parent_sha = read_json(Path(runtime) / "integration-release.json")
    if parent_sha != witness["parentReceiptSha256"]:
        raise PlanBlocked("delta parent release changed")
    operation = str(parent.get("operationId", ""))
    if not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise PlanBlocked("delta parent operation invalid")
    original = Path(runtime) / "integration-installs" / operation / "source"
    return verify_release(original, runtime, allow_delta=False)


def operation_witness(runtime, candidate, backup_path, backup_sha, restore_path, restore_sha):
    """Bind the actual operation's fresh backup, never reuse private digests."""
    offline = validate_baseline_witness(candidate.get("baselineWitness"))
    verify_parent_138(runtime, offline)
    manifest = verify_backup_restore(backup_path, backup_sha, restore_path, restore_sha, protected=True)
    from postgres_no_key_backup import validate_evidence
    profile = manifest.get("profileEvidence", {})
    validate_evidence(profile)
    if profile.get("tables", {}).get("django_migrations", {}).get("rows") != 138:
        raise PlanBlocked("delta operation pre-backup is not the exact baseline generation")
    authority = profile.get("tables", {}).get("netshop_write_authority", {}).get("sha256")
    if not HEX.fullmatch(str(authority)):
        raise PlanBlocked("delta pre-backup lacks authority witness")
    return validate_baseline_witness({"baselineCatalogueSha256": LEGACY_CATALOGUE_SHA256,
        "parentReceiptSha256": offline["parentReceiptSha256"], "beforeBackupSha256": backup_sha,
        "beforeRestoreSha256": restore_sha, "rolesSha256": digest(profile["roles"]),
        "authoritySha256": authority, "protectedCatalogueSha256": digest(profile["catalog"])})


def require_delta_after_backup(manifest, candidate_manifest_sha):
    from postgres_no_key_backup import validate_evidence
    profile = manifest.get("profileEvidence", {})
    validate_evidence(profile)
    if (profile.get("tables", {}).get("django_migrations", {}).get("rows") != 139
            or manifest.get("software", {}).get("deploymentManifestSha256") != candidate_manifest_sha):
        raise PlanBlocked("delta after-backup must bind exact 139 and candidate manifest")
    return profile


def verify_delta_deployment(root, runtime, operation_id, *, after_deployment=False):
    directory = delta_directory(runtime, operation_id)
    plan, _ = read_json(directory / "plan.json")
    if (plan.get("version") != DELTA_RELEASE or plan.get("generation") != DELTA_VERSION
            or plan.get("status") != "prepared" or plan.get("operationId") != operation_id
            or plan.get("migrationSha256") != migration_digest(root)):
        raise PlanBlocked("delta plan/generation/source mismatch")
    maintenance, maintenance_sha = read_json(Path(runtime) / "run/system-maintenance.json")
    if (maintenance.get("version") != "teruisi-system-maintenance-v1" or maintenance.get("keepPostgres") is not True
            or maintenance.get("id") != plan.get("maintenanceId") or maintenance_sha != plan.get("maintenanceSha256")):
        raise PlanBlocked("delta maintenance binding changed")
    evidence, _ = read_json(directory / "evidence/candidate.json", plan.get("candidateEvidenceSha256"))
    witness = validate_baseline_witness(evidence.get("baselineWitness"))
    if plan.get("baselineWitnessSha256") != digest(witness):
        raise PlanBlocked("delta baseline witness changed")
    verify_parent_138(runtime, witness)
    candidate = verify_candidate(directory / "source", directory / "evidence/candidate.json", plan.get("candidateEvidenceSha256"))
    if any(plan.get(key) != value for key, value in candidate.items()):
        raise PlanBlocked("delta source approval changed")
    backup_sha, restore_sha = plan.get("beforeBackupSha256"), plan.get("beforeRestoreSha256")
    actual = operation_witness(runtime, evidence, directory / "evidence/before-backup.json", backup_sha,
                               directory / "evidence/before-restore.json", restore_sha)
    if plan.get("operationWitness") != actual or plan.get("operationWitnessSha256") != digest(actual):
        raise PlanBlocked("delta actual operation witness mismatch")
    _, installed_manifest = read_json(Path(runtime) / "app/deployment.json")
    _, candidate_manifest = read_json(Path(root) / "deployment.json")
    if (candidate_manifest != plan.get("candidateManifestSha256") or installed_manifest !=
            plan.get("candidateManifestSha256" if after_deployment else "predecessorSha256")):
        raise PlanBlocked("delta predecessor/candidate manifest changed")
    return plan


def active_delta(runtime):
    path = Path(runtime) / "integration-active-generation.json"
    if not path.exists():
        return None
    reference, _ = read_json(path)
    if (set(reference) != {"version", "generation", "operationId", "installedSha256", "candidateManifestSha256"}
            or reference.get("version") != DELTA_ACTIVE or reference.get("generation") != DELTA_VERSION
            or not HEX.fullmatch(str(reference.get("installedSha256", "")))
            or not HEX.fullmatch(str(reference.get("candidateManifestSha256", "")))):
        raise PlanBlocked("active delta reference invalid")
    delta_directory(runtime, reference.get("operationId"))
    return reference


def verify_delta_release(root, runtime, reference, *, allow_installed=False):
    directory = delta_directory(runtime, reference["operationId"])
    plan, _ = read_json(directory / "plan.json")
    candidate, _ = read_json(directory / "evidence/candidate.json", plan.get("candidateEvidenceSha256"))
    witness = validate_baseline_witness(candidate.get("baselineWitness"))
    verify_parent_138(runtime, witness)
    actual = operation_witness(runtime, candidate, directory / "evidence/before-backup.json", plan.get("beforeBackupSha256"),
                               directory / "evidence/before-restore.json", plan.get("beforeRestoreSha256"))
    if plan.get("operationWitness") != actual or plan.get("operationWitnessSha256") != digest(actual):
        raise PlanBlocked("active delta actual baseline witness changed")
    approved = verify_candidate(directory / "source", directory / "evidence/candidate.json", plan.get("candidateEvidenceSha256"))
    if (any(plan.get(key) != value for key, value in approved.items()) or plan.get("operationId") != reference["operationId"]
            or reference["candidateManifestSha256"] != plan.get("candidateManifestSha256")
            or migration_digest(root) != plan.get("migrationSha256")
            or load_policy(Path(root) / DELTA_POLICY).sha256 != plan.get("policySha256")):
        raise PlanBlocked("active delta source/policy/manifest binding mismatch")
    installed, installed_sha = read_json(directory / "evidence/installed.json", reference["installedSha256"])
    if (installed.get("version") != DELTA_RELEASE or installed.get("generation") != DELTA_VERSION
            or installed.get("status") != "schema_installed" or installed.get("journalCommittedSteps") != 1
            or installed.get("baselineWitnessSha256") != digest(witness)
            or installed.get("operationWitnessSha256") != plan.get("operationWitnessSha256")
            or installed.get("migrationSha256") != plan.get("migrationSha256")
            or installed.get("policySha256") != plan.get("policySha256")
            or not HEX.fullmatch(str(installed.get("journalSha256", "")))):
        raise PlanBlocked("delta installation record invalid")
    from dataclasses import replace
    from integration_migration_journal import Journal
    journal = Journal(directory / "migration-journal", reference["operationId"], generation=DELTA_VERSION,
                      baseline_witness=actual)
    initial = journal._initial()
    final = replace(initial, completed=(DELTA_STEP,), remaining=())
    if (initial.remaining != (DELTA_STEP,) or initial.policy_sha256 != plan.get("policySha256")
            or initial.source_sha256 != plan.get("sourceSha256")
            or initial.binding_sha256 != installed.get("bindingSha256")
            or journal.complete_digest(final) != installed.get("journalSha256")):
        raise PlanBlocked("delta actual journal/identity binding changed")
    release_path = directory / "release.json"
    if not release_path.exists():
        if not allow_installed:
            raise PlanBlocked("delta has no finalized release")
        verify_delta_deployment(root, runtime, reference["operationId"], after_deployment=True)
        return installed
    receipt, _ = read_json(release_path)
    if (receipt.get("version") != DELTA_RELEASE or receipt.get("generation") != DELTA_VERSION
            or receipt.get("status") != "verified" or receipt.get("operationId") != reference["operationId"]
            or receipt.get("installedSha256") != installed_sha
            or receipt.get("baselineWitnessSha256") != digest(witness)
            or receipt.get("operationWitnessSha256") != plan.get("operationWitnessSha256")
            or receipt.get("policySha256") != plan.get("policySha256")
            or receipt.get("migrationSha256") != plan.get("migrationSha256")):
        raise PlanBlocked("delta finalized receipt invalid")
    manifest = verify_backup_restore(directory / "evidence/after-backup.json", receipt.get("afterBackupSha256"),
                                     directory / "evidence/after-restore.json", receipt.get("afterRestoreSha256"), protected=True)
    require_delta_after_backup(manifest, plan["candidateManifestSha256"])
    return receipt


def verify_backup_restore(manifest_path, manifest_sha, restore_path, restore_sha, *, protected):
    manifest, _ = read_json(manifest_path, manifest_sha)
    restored, _ = read_json(restore_path, restore_sha)
    expected_version = "teruisi-postgres-daily-backup-v2-no-keys" if protected else "teruisi-postgres-daily-backup-v1"
    if (manifest.get("version") != expected_version or manifest.get("status") != "completed"
            or manifest.get("database", {}).get("name") != "teruisi_sales"
            or manifest.get("database", {}).get("host") != "127.0.0.1"
            or manifest.get("database", {}).get("port") != 5432
            or restored.get("version") != "teruisi-postgres-restore-rehearsal-v1"
            or restored.get("status") != "completed"
            or restored.get("backupManifestSha256") != manifest_sha
            or restored.get("dumpSha256") != manifest.get("dump", {}).get("sha256")
            or restored.get("expectedContentSha256") != manifest.get("evidence", {}).get("contentSha256")
            or restored.get("restoredContentSha256") != restored.get("expectedContentSha256")
            or restored.get("productionDatabaseTouched") is not False
            or restored.get("cleanupStatus") != "isolated_data_removed"):
        raise PlanBlocked("production backup and independent restore proof do not match")
    if protected:
        profile = manifest.get("profileEvidence", {})
        if (profile.get("profile") != "teruisi-postgres-no-new-keys-v1"
                or profile.get("privateKeyRows") != 0 or profile.get("newRecoveryKeyGenerated") is not False
                or restored.get("profileRestoreVerified") is not True
                or restored.get("profileContentSha256") != profile.get("contentSha256")):
            raise PlanBlocked("protected backup lacks full rows and owner/ACL recovery proof")
    return manifest


def verify_deployment(root, runtime, *, after_deployment=False):
    root, runtime = Path(root), Path(runtime)
    plan, _ = read_json(runtime / "integration-install-plan.json")
    operation = str(plan.get("operationId", ""))
    if (plan.get("version") != VERSION or plan.get("status") != "prepared"
            or not re.fullmatch(r"[0-9a-f]{32}", operation)
            or plan.get("migrationSha256") != migration_digest(root)):
        raise PlanBlocked("integration deployment has no matching installation plan")
    maintenance, maintenance_sha = read_json(runtime / "run/system-maintenance.json")
    if (maintenance.get("version") != "teruisi-system-maintenance-v1"
            or maintenance.get("id") != plan.get("maintenanceId")
            or maintenance.get("keepPostgres") is not True
            or maintenance_sha != plan.get("maintenanceSha256")):
        raise PlanBlocked("integration maintenance identity changed")
    _, predecessor = read_json(runtime / "app/deployment.json")
    _, prepared = read_json(root / "deployment.json")
    expected_predecessor = plan.get("candidateManifestSha256") if after_deployment else plan.get("predecessorSha256")
    if predecessor != expected_predecessor or prepared != plan.get("candidateManifestSha256"):
        raise PlanBlocked("integration predecessor or prepared application changed")
    operation_root = runtime / "integration-installs" / operation
    candidate = verify_candidate(operation_root / "source", operation_root / "evidence/candidate.json",
        plan.get("candidateEvidenceSha256"))
    if any(candidate.get(key) != plan.get(key) for key in candidate):
        raise PlanBlocked("integration source snapshot no longer matches plan")
    verify_backup_restore(operation_root / "evidence/before-backup.json", plan["beforeBackupSha256"],
        operation_root / "evidence/before-restore.json", plan["beforeRestoreSha256"], protected=False)
    return plan


def verify_release(root, runtime, *, allow_delta=True, allow_addition=True):
    if allow_addition and (Path(runtime) / "bi-app-addition-active.json").exists():
        from bi_app_addition import verify_active
        return verify_active(root, runtime)[0]
    reference = active_delta(runtime) if allow_delta else None
    if reference:
        return verify_delta_release(root, runtime, reference)
    root, runtime = Path(root), Path(runtime)
    receipt, _ = read_json(runtime / "integration-release.json")
    if (receipt.get("version") != VERSION or receipt.get("status") != "verified"
            or not re.fullmatch(r"[0-9a-f]{32}", str(receipt.get("operationId", "")))
            or receipt.get("migrationSha256") != migration_digest(root)
            or receipt.get("policySha256") != load_policy(root / POLICY).sha256):
        raise PlanBlocked("integration release is not verified for this exact migration tree")
    evidence_root = runtime / "integration-installs" / receipt["operationId"] / "evidence"
    verify_backup_restore(evidence_root / "after-backup.json", receipt["afterBackupSha256"],
        evidence_root / "after-restore.json", receipt["afterRestoreSha256"], protected=True)
    installed, _ = read_json(evidence_root / "installed.json", receipt["installedSha256"])
    if (installed.get("status") != "schema_installed" or installed.get("policySha256") != receipt["policySha256"]
            or installed.get("migrationSha256") != receipt["migrationSha256"]
            or installed.get("journalCommittedSteps") != 76
            or not HEX.fullmatch(str(installed.get("journalSha256", "")))):
        raise PlanBlocked("integration installation record is incomplete")
    return receipt


def verify_successor(root, runtime):
    # Maintenance code can evolve without reinstalling an unchanged migration
    # generation. Its original policy/journal must still verify in the runtime.
    receipt = verify_release(Path(runtime) / "app", runtime)
    if migration_digest(Path(root)) != receipt["migrationSha256"]:
        raise PlanBlocked("successor changes the installed migration generation")
    return receipt


def verify_database_complete(root, runtime=None):
    import sys
    sys.path.insert(0, str(Path(root) / "backend"))
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    if runtime is not None and (Path(runtime) / "bi-app-addition-active.json").exists():
        from bi_app_addition import complete_database
        return complete_database(root, runtime)
    reference = active_delta(runtime) if runtime is not None else None
    if reference:
        verify_delta_release(root, runtime, reference, allow_installed=True)
    policy = load_policy(Path(root) / (DELTA_POLICY if reference else POLICY))
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", 5432):
            raise PlanBlocked("integration migration identity changed")
    receipts = {".".join(row) for row in MigrationRecorder(connection).applied_migrations()}
    if reference:
        with connection.cursor() as cursor:
            from postgres_no_key_backup import verify_receipt_generation
            if verify_receipt_generation(cursor) != 139:
                raise PlanBlocked("active delta requires exact live 139 catalogue/schema")
    executor = MigrationExecutor(connection)
    if receipts != set(policy.baseline + policy.steps) or executor.migration_plan(executor.loader.graph.leaf_nodes()):
        raise PlanBlocked("ordinary startup must not install pending protected migrations")
    return {"status": "complete", "migrationCount": len(receipts)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("candidate", "deployment", "release", "successor", "database", "delta-admission", "delta-witness"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--approved-sha256")
    parser.add_argument("--operation-id")
    parser.add_argument("--backup-manifest", type=Path)
    parser.add_argument("--backup-sha256")
    parser.add_argument("--restore-result", type=Path)
    parser.add_argument("--restore-sha256")
    args = parser.parse_args()
    try:
        if args.command == "candidate":
            result = verify_candidate(args.root, args.evidence, args.approved_sha256)
        elif args.command in ("delta-admission", "delta-witness"):
            result = verify_candidate(args.root, args.evidence, args.approved_sha256)
            if result.get("generation") != DELTA_VERSION:
                raise PlanBlocked("explicit delta evidence is required")
            candidate, _ = read_json(args.evidence, args.approved_sha256)
            verify_parent_138(args.runtime, candidate.get("baselineWitness"))
            if args.command == "delta-witness":
                actual = operation_witness(args.runtime, candidate, args.backup_manifest, args.backup_sha256,
                                           args.restore_result, args.restore_sha256)
                result.update(operationWitness=actual, operationWitnessSha256=digest(actual))
        elif args.command == "successor":
            result = verify_successor(args.root, args.runtime)
        elif args.command == "release":
            result = verify_release(args.root, args.runtime)
        elif args.command == "deployment":
            result = verify_delta_deployment(args.root, args.runtime, args.operation_id) if args.operation_id else verify_deployment(args.root, args.runtime)
        else:
            result = verify_database_complete(args.root, args.runtime)
        print(json.dumps({"status": "verified", "result": result}, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"status": "blocked", "errorType": type(error).__name__,
            "errorSha256": hashlib.sha256(str(error).encode()).hexdigest()}, separators=(",", ":")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
