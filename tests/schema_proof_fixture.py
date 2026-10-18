"""Synthetic, hash-bound historical evidence; no database or production reads.

All original verifiers, policy checks, backup/restore evidence validation and
journal readers execute. These JSON fixtures prove verifier behavior, not that
an actual backup or restore occurred. Migration bytes come from the candidate.
"""
from dataclasses import replace
import importlib
import json
from pathlib import Path
import shutil

import bi_app_addition as common
import integration_release_gate as integration
from integration_migration_journal import Journal
from integration_migration_plan import (load_policy, Plan, DELTA_STEP, DELTA_VERSION,
    LEGACY_CATALOGUE_SHA256, python_source_sha256)


def put(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    common.write(path, value)
    return common.sha(path)


def backup(folder, label, generation, *, software=None, prepared=None):
    profile = {"profile": "teruisi-postgres-no-new-keys-v1", "roles": {"roles": [], "settings": []},
        "tables": {"django_migrations": {"rows": generation, "sha256": "1" * 64},
                   "netshop_write_authority": {"rows": 1, "sha256": "2" * 64}},
        "catalog": {"synthetic": "3" * 64}, "sequenceLowerBounds": {},
        "archiveEncrypted": False, "newRecoveryKeyGenerated": False, "privateKeyRows": 0}
    profile["contentSha256"] = common.digest({k: profile[k] for k in ("profile", "roles", "tables", "catalog")})
    manifest = {"version": "teruisi-postgres-daily-backup-v2-no-keys", "status": "completed",
        "database": {"name": "teruisi_sales", "host": "127.0.0.1", "port": 5432},
        "dump": {"sha256": "4" * 64}, "evidence": {"contentSha256": "5" * 64},
        "profileEvidence": profile}
    if software:
        manifest["software"] = {"deploymentManifestSha256": software}
    if prepared:
        manifest["preparedAiScheduleTools"] = prepared
    manifest_sha = put(folder / (label + "-backup.json"), manifest)
    restored = {"version": "teruisi-postgres-restore-rehearsal-v1", "status": "completed",
        "backupManifestSha256": manifest_sha, "dumpSha256": "4" * 64,
        "expectedContentSha256": "5" * 64, "restoredContentSha256": "5" * 64,
        "productionDatabaseTouched": False, "cleanupStatus": "isolated_data_removed",
        "profileRestoreVerified": True, "profileContentSha256": profile["contentSha256"]}
    restore_sha = put(folder / (label + "-restore.json"), restored)
    return manifest_sha, restore_sha, profile


class ProofChain:
    def __init__(self, source, directory, *, monitoring=True):
        self.source, self.directory = Path(source), Path(directory)
        self.runtime = self.directory / "runtime"
        self.roots, self.folders, self.modules = {}, {}, []
        self.directory.mkdir(parents=True, exist_ok=True)
        self._integration()
        names = ["bi_app_addition", "jackyun_audit_addition", "ai_schedule_addition",
                 "jd_logistics_addition", "jd_monitor_preferences_addition"]
        if monitoring:
            names.append("jd_product_monitoring_addition")
        names += ["tmall_warehouse_addition", "pi_agent_addition"]
        previous = 139
        for name in names:
            module = importlib.import_module(name)
            generation = {"bi_app_addition": 140, "jackyun_audit_addition": 142,
                "ai_schedule_addition": 143, "jd_logistics_addition": 146,
                "jd_monitor_preferences_addition": 147, "jd_product_monitoring_addition": 148,
                "tmall_warehouse_addition": 149, "pi_agent_addition": 150}[name]
            self._addition(module, previous, generation)
            previous = generation
        self.root = self.roots[150]

    def copy(self, relative, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.source / relative, target)

    def _root(self, generation, members):
        root = self.directory / ("source" + str(generation))
        root.mkdir()
        for key in members:
            if key.startswith("contenttypes."):
                continue
            app, migration = key.split(".", 1)
            relative = f"backend/{app}/migrations/{migration}.py"
            self.copy(relative, root / relative)
        put(root / "deployment.json", {"syntheticGeneration": generation})
        self.roots[generation] = root
        return root

    def _integration(self):
        raw = json.loads((self.source / integration.DELTA_POLICY).read_text(encoding="utf8"))
        members = set(raw["baseline"])
        root138 = self._root(138, members)
        root139 = self._root(139, members | set(raw["steps"]))
        self.copy(integration.POLICY, root138 / integration.POLICY)
        policy138 = load_policy(root138 / integration.POLICY)
        op138, op139 = "1" * 32, "2" * 32
        old = self.runtime / "integration-installs" / op138
        shutil.copytree(root138, old / "source")
        old_evidence = old / "evidence"
        before, restored, _ = backup(old_evidence, "after", 138)
        installed = {"status": "schema_installed", "policySha256": policy138.sha256,
            "migrationSha256": integration.migration_digest(root138), "journalCommittedSteps": 76,
            "journalSha256": "6" * 64}
        installed_sha = put(old_evidence / "installed.json", installed)
        parent_sha = put(self.runtime / "integration-release.json", {"version": integration.VERSION,
            "status": "verified", "operationId": op138, "policySha256": policy138.sha256,
            "migrationSha256": installed["migrationSha256"], "installedSha256": installed_sha,
            "afterBackupSha256": before, "afterRestoreSha256": restored})
        for name in integration.CONTROLS:
            self.copy(name, root139 / name)
        raw["files"] = {p.relative_to(root139).as_posix(): python_source_sha256(p.read_bytes())
                        for p in (root139 / "backend").rglob("*.py")}
        put(root139 / integration.DELTA_POLICY, raw)
        policy139 = load_policy(root139 / integration.DELTA_POLICY)
        delta = self.runtime / "integration-deltas" / op139
        shutil.copytree(root139, delta / "source")
        before, restored, profile = backup(delta / "evidence", "before", 138)
        witness = {"baselineCatalogueSha256": LEGACY_CATALOGUE_SHA256, "parentReceiptSha256": parent_sha,
            "beforeBackupSha256": before, "beforeRestoreSha256": restored,
            "rolesSha256": common.digest(profile["roles"]), "authoritySha256": "2" * 64,
            "protectedCatalogueSha256": common.digest(profile["catalog"])}
        migration = {"status": "delta_completed", "baselineReceiptCount": 138, "finalReceiptCount": 139,
            "journalCommittedSteps": 1, "journalSha256": "7" * 64, "reviewedPolicySha256": policy139.sha256,
            "steps": [DELTA_STEP]}
        migration.update({k: True for k in ("productionInstallerEngineVerified", "pinnedBaselineRuntimeGrants",
            "ordinaryRoleStillUnprivileged", "modelBudgetAndVersionsVerified")})
        restore = {"status": "passed", "restoredRuntimeReady": {"ai_reader": True, "ai_writer": True},
            "runtimePrivilegeNegativeChecks": 25, "privateKeyRows": 0, "newRecoveryKeyGenerated": False}
        restore.update({k: True for k in ("maintenancePythonBackupRestoreVerified", "maintenancePowerShellPayloadVerified",
            "nonemptyPrivateKeyTableRejectedBeforeBackup", "ownerAclAndRowsPreserved")})
        candidate = {"generation": DELTA_VERSION, "baselineWitness": witness, "baselineWitnessScope": "isolated",
            "sourcePolicySha256": policy139.sha256, "controlsSha256": {p: python_source_sha256((root139 / p).read_bytes()) for p in integration.CONTROLS},
            "productionWrites": False, "productionInstalled": False, "migration": migration, "restore": restore}
        candidate.update({k: True for k in ("baselineReceiptChainVerified", "before138BackupRestoreVerified",
            "after139BackupRestoreVerified", "cacheSchemaAndInvalidatorVerified", "protectedAiCatalogueUnchanged")})
        candidate_sha = put(delta / "evidence/candidate.json", candidate)
        approved = integration.verify_candidate(root139, delta / "evidence/candidate.json", candidate_sha)
        manifest_sha = common.sha(root139 / "deployment.json")
        plan = {**approved, "version": integration.DELTA_RELEASE, "operationId": op139,
            "candidateManifestSha256": manifest_sha, "beforeBackupSha256": before, "beforeRestoreSha256": restored,
            "operationWitness": witness, "operationWitnessSha256": common.digest(witness)}
        put(delta / "plan.json", plan)
        journal_dir = delta / "migration-journal"
        journal_dir.mkdir()
        journal = Journal(journal_dir, op139, generation=DELTA_VERSION, baseline_witness=witness)
        initial = Plan(policy139.sha256, approved["sourceSha256"], "8" * 64, (), (DELTA_STEP,), DELTA_VERSION)
        journal.initialize(initial)
        intent = journal.reserve(initial)
        final = replace(initial, completed=(DELTA_STEP,), remaining=())
        journal.complete(initial, final, intent)
        installed = {"version": integration.DELTA_RELEASE, "generation": DELTA_VERSION, "status": "schema_installed",
            "journalCommittedSteps": 1, "baselineWitnessSha256": common.digest(witness),
            "operationWitnessSha256": common.digest(witness), "migrationSha256": plan["migrationSha256"],
            "policySha256": policy139.sha256, "journalSha256": journal.complete_digest(final), "bindingSha256": initial.binding_sha256}
        installed_sha = put(delta / "evidence/installed.json", installed)
        after, after_restore, _ = backup(delta / "evidence", "after", 139, software=manifest_sha)
        put(delta / "release.json", {**installed, "status": "verified", "operationId": op139,
            "installedSha256": installed_sha, "afterBackupSha256": after, "afterRestoreSha256": after_restore})
        put(self.runtime / "integration-active-generation.json", {"version": integration.DELTA_ACTIVE,
            "generation": DELTA_VERSION, "operationId": op139, "installedSha256": installed_sha,
            "candidateManifestSha256": manifest_sha})
        common.original_parent(self.runtime, root139)
        self.members = members | set(raw["steps"])

    def _addition(self, module, previous, generation):
        operation = f"{generation:032x}"
        folder = module.directory(self.runtime, operation)
        baseline = folder / "baseline"
        shutil.copytree(self.roots[previous], baseline)
        if generation == 140:
            steps = [module.STEP]
        elif generation in (149, 150):
            steps = list(module.steps_for_base(self.members))
        else:
            steps = list(module.STEPS)
        self.members |= set(steps)
        root = self._root(generation, self.members)
        parent = self.runtime / ("integration-active-generation.json" if generation == 140 else self.modules[-1].ACTIVE)
        plan = {"version": module.VERSION, "operationId": operation, "steps": steps,
            "migrationSha256": module.source_delta(root, baseline), "parentReferenceSha256": common.sha(parent),
            "predecessorSha256": common.sha(baseline / "deployment.json"),
            "candidateManifestSha256": common.sha(root / "deployment.json")}
        if hasattr(module, "POLICY"):
            plan["databasePolicy"] = module.POLICY
        evidence_sha = put(folder / "candidate.json", {"status": "reviewed", **plan})
        plan["candidateEvidenceSha256"] = evidence_sha
        if generation >= 143:
            plan.update(preparedAppId=operation, maintenanceId="a" * 32)
            plan["preparedReceiptSha256"] = put(self.runtime / ("app.prepare-" + operation + ".json"), {
                "version": "teruisi-django-prepared-app-v1", "id": operation, "runtimeRoot": str(self.runtime),
                "predecessorManifestSha256": plan["predecessorSha256"], "candidateManifestSha256": plan["candidateManifestSha256"]})
        prepared = None
        if generation == 143:
            prepared = {"version": "teruisi-ai-schedule-prepared-backup-v1", "preparedAppId": operation,
                "preparedReceiptSha256": plan["preparedReceiptSha256"], "preparedManifestSha256": plan["candidateManifestSha256"],
                "candidateEvidenceSha256": evidence_sha, "maintenanceId": plan["maintenanceId"]}
        if generation in (142, 143):
            b, r, _ = backup(folder, "before", previous, prepared=prepared)
            plan.update(beforeBackupSha256=b, beforeRestoreSha256=r)
        plan_sha = put(folder / "plan.json", plan)
        receipt = {**plan, "status": "verified", "planSha256": plan_sha, "migrationCount": generation,
            "permissionsVerified": True, "emptyAtInstallation": True, "defaultsDisabled": True,
            "defaultsVerified": True, "legacyDataPreserved": True, "defaultsEmpty": True}
        if generation in (140, 142, 143):
            b, r, _ = backup(folder, "after", generation)
            receipt.update(afterBackupSha256=b, afterRestoreSha256=r)
        if generation == 140:
            receipt["step"] = module.STEP
        if generation in (142, 143):
            columns = importlib.import_module("jackyun_audit_catalog" if generation == 142 else "ai_schedule_addition_catalog").COLUMNS
            rows = {table: {"columns": ["id"], "rows": 0, "sha256": "9" * 64} for table in columns}
            receipt.update(beforeRows=rows, afterRows=rows)
        if generation >= 147:
            state = {"rows": 0, "legacyRowsSha256": "b" * 64, "permissionsSha256": "c" * 64}
            receipt["preservation"] = state
            receipt["installIntentSha256"] = put(folder / "install-intent.json", {"version": module.VERSION,
                "planSha256": plan_sha, "at": "synthetic", "preservation": state})
        finalized_sha = put(folder / "finalized.json", receipt)
        put(folder / "installed.json", {**receipt, "status": "schema_installed"})
        pointer = {"version": module.VERSION, "operationId": operation, "receiptSha256": finalized_sha}
        if generation >= 146:
            pointer["parentReferenceSha256"] = plan["parentReferenceSha256"]
        put(self.runtime / module.ACTIVE, pointer)
        self.folders[generation] = folder
        self.modules.append(module)
