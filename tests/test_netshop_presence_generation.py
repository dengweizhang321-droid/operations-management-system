"""Exact generation/source/journal boundaries; no service or database access."""
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import integration_migration_plan as plans
import integration_migration_journal as journals
import integration_release_gate as gate
import postgres_no_key_backup as backup


class ReceiptCursor:
    def __init__(self, receipts, *, columns=0, invalidator=False):
        self.receipts = receipts
        self.columns = columns
        self.invalidator = invalidator
    def execute(self, sql, params=None):
        if "SELECT app,name" in sql:
            self.rows = [tuple(item.split(".", 1)) for item in sorted(self.receipts)]
        elif "FROM pg_attribute" in sql:
            self.rows = [(self.columns,)]
        elif "FROM pg_trigger" in sql:
            self.rows = [(self.invalidator, self.invalidator)]
        else:
            raise AssertionError(sql)
    def fetchone(self):
        return self.rows[0]
    def fetchall(self):
        return self.rows


class NetshopPresenceGenerationTests(unittest.TestCase):
    def setUp(self):
        self.policy = plans.load_policy(ROOT / gate.DELTA_POLICY)
        self.baseline = list(self.policy.baseline)
        self.witness = {key: "a" * 64 for key in (
            "parentReceiptSha256", "beforeBackupSha256", "beforeRestoreSha256",
            "rolesSha256", "authoritySha256", "protectedCatalogueSha256")}
        self.witness["baselineCatalogueSha256"] = plans.LEGACY_CATALOGUE_SHA256

    def test_exact_138_and_exact_139_plus_real_schema_validation_required(self):
        self.assertEqual(backup.verify_receipt_generation(ReceiptCursor(self.baseline)), 138)
        with patch("netshop.promotion_presence.verify_cache_catalog") as verify:
            self.assertEqual(backup.verify_receipt_generation(ReceiptCursor([*self.baseline, plans.DELTA_STEP])), 139)
            verify.assert_called_once()
            verify.side_effect = RuntimeError("missing actual schema")
            with self.assertRaises(RuntimeError):
                backup.verify_receipt_generation(ReceiptCursor([*self.baseline, plans.DELTA_STEP]))

    def test_unknown_missing_duplicate_and_mixed_legacy_schema_are_rejected(self):
        bad = [self.baseline[:-1], [*self.baseline, "netshop.0005_unknown"],
               [*self.baseline, self.baseline[0]], [*self.baseline[:-1], plans.DELTA_STEP],
               [*self.baseline, plans.DELTA_STEP, "netshop.0005_unknown"]]
        for receipts in bad:
            with self.subTest(receipts=len(receipts)), self.assertRaises(RuntimeError):
                backup.verify_receipt_generation(ReceiptCursor(receipts))
        for cursor in [ReceiptCursor(self.baseline, columns=1), ReceiptCursor(self.baseline, invalidator=True)]:
            with self.assertRaises(RuntimeError):
                backup.verify_receipt_generation(cursor)

    def test_exact_policy_rejects_changed_baseline_extra_step_and_bootstrap(self):
        for change in [{"baseline": self.policy.baseline[:-1]},
                       {"steps": (plans.DELTA_STEP, "netshop.0005_extra")},
                       {"bootstrap_roles": ("teruisi_ai_new",)},
                       {"baseline": (*self.policy.baseline[:-1], "sales.9999_unknown")}]:
            with self.assertRaises(plans.PlanBlocked):
                replace(self.policy, **change)
        files = dict(self.policy.files)
        files.pop("backend/netshop/migrations/0004_promotion_presence_cache.py")
        with self.assertRaises(plans.PlanBlocked):
            replace(self.policy, files=tuple(files.items()))
        with self.assertRaises(plans.PlanBlocked):
            replace(self.policy, django_version="5.2.18")
        with self.assertRaises(plans.PlanBlocked):
            replace(self.policy, builtin_files=(("contenttypes.0003_unknown", "a" * 64),))
        corrupt = replace(self.policy, builtin_files=tuple((key, "0" * 64) for key, _ in self.policy.builtin_files))
        with self.assertRaises(plans.PlanBlocked):
            corrupt.verify_source(ROOT)

    def test_actual_source_inventory_and_one_exact_pending_step(self):
        self.policy.verify_source(ROOT)
        applied = [tuple(key.split(".", 1)) for key in self.baseline]
        before = plans.build_plan(self.policy, ROOT, applied, [("netshop", "0004_promotion_presence_cache", False)], "b" * 64)
        after = plans.build_plan(self.policy, ROOT, [*applied, ("netshop", "0004_promotion_presence_cache")], [], "b" * 64)
        self.assertTrue(plans.confirm_single_step(before, after))
        for pending in [[], [("netshop", "0004_promotion_presence_cache", True)],
                        [("netshop", "0004_promotion_presence_cache", False), ("netshop", "0005_extra", False)]]:
            with self.assertRaises(plans.PlanBlocked):
                plans.build_plan(self.policy, ROOT, applied, pending, "b" * 64)

    def test_independent_delta_journal_cannot_borrow_legacy_operation_or_change_witness(self):
        before = plans.Plan(self.policy.sha256, "a" * 64, "b" * 64, (), (plans.DELTA_STEP,), plans.DELTA_VERSION)
        after = replace(before, completed=(plans.DELTA_STEP,), remaining=())
        with tempfile.TemporaryDirectory() as directory:
            legacy = journals.Journal(directory, "c" * 32)
            with self.assertRaises(plans.PlanBlocked):
                legacy.initialize(before)
            journal = journals.Journal(directory, "c" * 32, generation=plans.DELTA_VERSION, baseline_witness=self.witness)
            journal.initialize(before)
            intent = journal.reserve(before)
            journal.complete(before, after, intent)
            self.assertRegex(journal.complete_digest(after), r"^[0-9a-f]{64}$")
            changed = {**self.witness, "authoritySha256": "d" * 64}
            other = journals.Journal(directory, "c" * 32, generation=plans.DELTA_VERSION, baseline_witness=changed)
            with self.assertRaises(plans.PlanBlocked):
                other.complete_digest(after)
            with self.assertRaises(plans.PlanBlocked):
                legacy.complete_digest(after)

    def test_legacy_serialized_plan_bytes_remain_unchanged(self):
        legacy = plans.Plan("a" * 64, "b" * 64, "c" * 64, (), ("netshop.0003_netshop_source_revision_guard",))
        self.assertNotIn("generation", journals.plan_fields(legacy))
        expected = plans.digest({"version": plans.VERSION, "policy": "a" * 64, "source": "b" * 64,
                                 "databaseBinding": "c" * 64, "completed": (), "remaining": legacy.remaining})
        self.assertEqual(legacy.sha256, expected)

    def test_unknown_active_generation_or_missing_installation_cannot_admit(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            self.assertIsNone(gate.active_delta(runtime))
            (runtime / "integration-active-generation.json").write_text(json.dumps({"generation": "unknown"}))
            with self.assertRaises(plans.PlanBlocked):
                gate.active_delta(runtime)

    def candidate_evidence(self):
        # Unit metadata fixture, not an executed migration/restore attestation.
        return {"generation": plans.DELTA_VERSION, "baselineWitnessScope": "isolated",
            "baselineWitness": self.witness, "baselineReceiptChainVerified": True,
            "before138BackupRestoreVerified": True, "after139BackupRestoreVerified": True,
            "cacheSchemaAndInvalidatorVerified": True, "protectedAiCatalogueUnchanged": True,
            "productionWrites": False, "productionInstalled": False,
            "sourcePolicySha256": self.policy.sha256,
            "controlsSha256": {name: plans.python_source_sha256((ROOT / name).read_bytes()) for name in gate.CONTROLS},
            "migration": {"status": "delta_completed", "baselineReceiptCount": 138, "finalReceiptCount": 139,
                "journalCommittedSteps": 1, "steps": [plans.DELTA_STEP], "journalSha256": "a" * 64,
                "productionInstallerEngineVerified": True, "pinnedBaselineRuntimeGrants": True,
                "ordinaryRoleStillUnprivileged": True, "modelBudgetAndVersionsVerified": True,
                "reviewedPolicySha256": self.policy.sha256},
            "restore": {"status": "passed", "restoredRuntimeReady": {"ai_reader": True, "ai_writer": True},
                "runtimePrivilegeNegativeChecks": 25, "maintenancePythonBackupRestoreVerified": True,
                "maintenancePowerShellPayloadVerified": True, "privateKeyRows": 0,
                "newRecoveryKeyGenerated": False, "nonemptyPrivateKeyTableRejectedBeforeBackup": True,
                "ownerAclAndRowsPreserved": True}}

    def test_candidate_header_rejects_wrong_generation_scope_step_and_new_key_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate.json"
            def verify(value):
                raw = json.dumps(value).encode()
                path.write_bytes(raw)
                return gate.verify_candidate(ROOT, path, hashlib.sha256(raw).hexdigest())
            self.assertEqual(verify(self.candidate_evidence())["generation"], plans.DELTA_VERSION)
            cases = [dict(self.candidate_evidence(), generation="unknown"),
                     dict(self.candidate_evidence(), baselineWitnessScope="production"),
                     dict(self.candidate_evidence(), protectedAiCatalogueUnchanged=False)]
            for key, value in [("finalReceiptCount", 140), ("baselineReceiptCount", 137),
                               ("journalCommittedSteps", 76), ("steps", ["netshop.0005_other"])]:
                evidence = self.candidate_evidence()
                evidence["migration"][key] = value
                cases.append(evidence)
            evidence = self.candidate_evidence()
            evidence["restore"]["privateKeyRows"] = 1
            cases.append(evidence)
            for evidence in cases:
                with self.subTest(evidence=evidence["migration"]), self.assertRaises(plans.PlanBlocked):
                    verify(evidence)

    def test_operation_witness_uses_fresh_backup_profile_not_isolated_candidate_digests(self):
        profile = {"profile": backup.PROFILE,
            "roles": {"roles": [["teruisi_sales_owner", True, False, False, False, False, False, False, -1]], "settings": []},
            "tables": {"django_migrations": {"rows": 138, "sha256": "b" * 64},
                       "netshop_write_authority": {"rows": 1, "sha256": "c" * 64}},
            "catalog": {"relations": "d" * 64}}
        profile.update(contentSha256=backup.digest(profile), sequenceLowerBounds={},
                       archiveEncrypted=False, newRecoveryKeyGenerated=False, privateKeyRows=0)
        with patch.object(gate, "verify_parent_138"), patch.object(gate, "verify_backup_restore", return_value={"profileEvidence": profile}):
            actual = gate.operation_witness(ROOT, {"baselineWitness": self.witness}, "backup", "e" * 64, "restore", "f" * 64)
            self.assertEqual(actual["beforeBackupSha256"], "e" * 64)
            self.assertEqual(actual["beforeRestoreSha256"], "f" * 64)
            self.assertEqual(actual["authoritySha256"], "c" * 64)
            self.assertNotEqual(actual, self.witness)
            profile["tables"]["django_migrations"]["rows"] = 139
            profile["contentSha256"] = backup.digest({key:profile[key] for key in ("profile","roles","tables","catalog")})
            with self.assertRaises(plans.PlanBlocked):
                gate.operation_witness(ROOT, {"baselineWitness": self.witness}, "backup", "e" * 64, "restore", "f" * 64)


if __name__ == "__main__":
    unittest.main()
