"""Bind integration release admission to source and independently restored backup evidence.

No credentials, database writes or lifecycle operations live in this module.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

from integration_migration_plan import canonical, digest, load_policy, python_source_sha256, PlanBlocked

VERSION = "teruisi-integration-release-v1"
POLICY = "config/integration-migration-policy-v3.json"
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
    policy = load_policy(root / POLICY)
    source = policy.verify_source(root)
    evidence, evidence_sha = read_json(evidence_path, approved)
    controls = {name: python_source_sha256((root / name).read_bytes()) for name in CONTROLS}
    if evidence.get("controlsSha256") != controls:
        raise PlanBlocked("integration lifecycle controller differs from the reviewed candidate")
    migration, restored = evidence.get("migration", {}), evidence.get("restore", {})
    if (evidence.get("sourcePolicySha256") != policy.sha256
            or evidence.get("productionWrites") is not False
            or evidence.get("productionInstalled") is not False
            or migration.get("status") != "mixed_completed"
            or migration.get("baselineReceiptCount") != 62 or migration.get("finalReceiptCount") != 138
            or migration.get("journalCommittedSteps") != 76
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
    return {"policySha256": policy.sha256, "sourceSha256": source,
        "migrationSha256": migration_digest(root), "candidateEvidenceSha256": evidence_sha}


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


def verify_release(root, runtime):
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


def verify_database_complete(root):
    import sys
    sys.path.insert(0, str(Path(root) / "backend"))
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    policy = load_policy(Path(root) / POLICY)
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,inet_server_port()")
        if cursor.fetchone() != ("teruisi_sales", "teruisi_sales_owner", 5432):
            raise PlanBlocked("integration migration identity changed")
    receipts = {".".join(row) for row in MigrationRecorder(connection).applied_migrations()}
    executor = MigrationExecutor(connection)
    if receipts != set(policy.baseline + policy.steps) or executor.migration_plan(executor.loader.graph.leaf_nodes()):
        raise PlanBlocked("ordinary startup must not install pending protected migrations")
    return {"status": "complete", "migrationCount": len(receipts)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("candidate", "deployment", "release", "database"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--approved-sha256")
    args = parser.parse_args()
    try:
        if args.command == "candidate":
            result = verify_candidate(args.root, args.evidence, args.approved_sha256)
        elif args.command == "release":
            result = verify_release(args.root, args.runtime)
        elif args.command == "deployment":
            result = verify_deployment(args.root, args.runtime)
        else:
            result = verify_database_complete(args.root)
        print(json.dumps({"status": "verified", "result": result}, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"status": "blocked", "errorType": type(error).__name__,
            "errorSha256": hashlib.sha256(str(error).encode()).hexdigest()}, separators=(",", ":")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
