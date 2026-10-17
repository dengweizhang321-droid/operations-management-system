import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import integration_release_gate as gate
from integration_migration_plan import PlanBlocked


class ReleaseProofTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backup = {"version": "teruisi-postgres-daily-backup-v2-no-keys", "status": "completed",
            "database": {"name": "teruisi_sales", "host": "127.0.0.1", "port": 5432},
            "dump": {"sha256": "1" * 64}, "evidence": {"contentSha256": "2" * 64},
            "profileEvidence": {"profile": "teruisi-postgres-no-new-keys-v1", "privateKeyRows": 0,
                "newRecoveryKeyGenerated": False, "contentSha256": "3" * 64}}
        self.backup_sha = self.write("backup.json", self.backup)
        self.restored = {"version": "teruisi-postgres-restore-rehearsal-v1", "status": "completed",
            "backupManifestSha256": self.backup_sha, "dumpSha256": "1" * 64,
            "expectedContentSha256": "2" * 64, "restoredContentSha256": "2" * 64,
            "productionDatabaseTouched": False, "cleanupStatus": "isolated_data_removed",
            "profileRestoreVerified": True, "profileContentSha256": "3" * 64}

    def write(self, name, value):
        data = json.dumps(value).encode()
        (self.root / name).write_bytes(data)
        return hashlib.sha256(data).hexdigest()

    def verify(self, result=None):
        sha = self.write("restore.json", result or self.restored)
        return gate.verify_backup_restore(self.root / "backup.json", self.backup_sha,
            self.root / "restore.json", sha, protected=True)

    def test_exact_success_and_reject_unverified_protected_recovery(self):
        self.assertEqual(self.verify(), self.backup)
        for key, value in (("profileRestoreVerified", False), ("profileContentSha256", "4" * 64),
                ("backupManifestSha256", "4" * 64), ("dumpSha256", "4" * 64),
                ("restoredContentSha256", "4" * 64), ("productionDatabaseTouched", True),
                ("cleanupStatus", "incomplete"), ("status", "failed")):
            with self.subTest(key=key):
                changed = {**self.restored, key: value}
                with self.assertRaises(PlanBlocked):
                    self.verify(changed)

    def test_wrong_backup_generation_or_database_is_rejected(self):
        for changed in ({**self.backup, "version": "teruisi-postgres-daily-backup-v1"},
                {**self.backup, "database": {"name": "other", "host": "127.0.0.1", "port": 5432}}):
            self.backup_sha = self.write("backup.json", changed)
            self.restored["backupManifestSha256"] = self.backup_sha
            with self.assertRaises(PlanBlocked):
                self.verify()

    def test_changed_proof_or_duplicate_json_key_is_rejected(self):
        with self.assertRaises(PlanBlocked):
            gate.read_json(self.root / "backup.json", "9" * 64)
        (self.root / "bad.json").write_bytes(b'{"status":"failed","status":"completed"}')
        with self.assertRaises(PlanBlocked):
            gate.read_json(self.root / "bad.json")

    def test_candidate_requires_explicit_digest_before_source_access(self):
        for value in (None, "", "0" * 63):
            with self.assertRaises(PlanBlocked):
                gate.verify_candidate(self.root, self.root / "missing.json", value)

    def test_incomplete_release_never_reaches_backup_acceptance(self):
        self.write("integration-release.json", {"version": gate.VERSION, "status": "prepared"})
        with patch.object(gate, "verify_backup_restore") as verify:
            with self.assertRaises(PlanBlocked):
                gate.verify_release(self.root, self.root)
            verify.assert_not_called()

    def test_successor_requires_verified_original_generation_and_same_migrations(self):
        receipt = {"migrationSha256": "a" * 64}
        with patch.object(gate, "verify_release", return_value=receipt) as verify, \
                patch.object(gate, "migration_digest", return_value="a" * 64) as migration:
            self.assertEqual(gate.verify_successor(self.root / "candidate", self.root), receipt)
            verify.assert_called_with(self.root / "app", self.root)
            migration.return_value = "b" * 64
            with self.assertRaises(PlanBlocked):
                gate.verify_successor(self.root / "candidate", self.root)
            verify.side_effect = PlanBlocked("invalid installed generation")
            with self.assertRaises(PlanBlocked):
                gate.verify_successor(self.root / "candidate", self.root)

    def test_deployment_binds_maintenance_predecessor_and_prepared_app(self):
        runtime = self.root / "runtime"
        stage = self.root / "stage"
        operation = "a" * 32
        evidence = runtime / "integration-installs" / operation / "evidence"
        for path in (runtime / "app", runtime / "run", stage, evidence):
            path.mkdir(parents=True, exist_ok=True)
        def put(path, value):
            raw = json.dumps(value).encode()
            path.write_bytes(raw)
            return hashlib.sha256(raw).hexdigest()
        predecessor = put(runtime / "app/deployment.json", {"app": "predecessor"})
        candidate = put(stage / "deployment.json", {"app": "candidate"})
        maintenance = {"version": "teruisi-system-maintenance-v1", "id": "b" * 32, "keepPostgres": True}
        maintenance_sha = put(runtime / "run/system-maintenance.json", maintenance)
        backup = {**self.backup, "version": "teruisi-postgres-daily-backup-v1"}
        backup_sha = put(evidence / "before-backup.json", backup)
        restored = {**self.restored, "backupManifestSha256": backup_sha}
        restore_sha = put(evidence / "before-restore.json", restored)
        binding = {"migrationSha256": "c" * 64, "policySha256": "d" * 64,
            "sourceSha256": "e" * 64, "candidateEvidenceSha256": "f" * 64}
        plan = {"version": gate.VERSION, "status": "prepared", "operationId": operation,
            "maintenanceId": "b" * 32, "maintenanceSha256": maintenance_sha,
            "predecessorSha256": predecessor, "candidateManifestSha256": candidate,
            "beforeBackupSha256": backup_sha, "beforeRestoreSha256": restore_sha, **binding}
        put(runtime / "integration-install-plan.json", plan)
        with patch.object(gate,"migration_digest",return_value=binding["migrationSha256"]), \
                patch.object(gate,"verify_candidate",return_value=binding):
            self.assertEqual(gate.verify_deployment(stage,runtime),plan)
            for field,value in (("predecessorSha256","0"*64),("candidateManifestSha256","0"*64),
                    ("maintenanceSha256","0"*64),("maintenanceId","0"*32),("migrationSha256","0"*64)):
                put(runtime / "integration-install-plan.json",{**plan,field:value})
                with self.subTest(field=field),self.assertRaises(PlanBlocked):
                    gate.verify_deployment(stage,runtime)
            put(runtime / "integration-install-plan.json",plan)
            put(runtime / "app/deployment.json",{"app":"candidate"})
            self.assertEqual(gate.verify_deployment(stage,runtime,after_deployment=True),plan)
            with self.assertRaises(PlanBlocked):
                gate.verify_deployment(stage,runtime)

    def test_pi_release_precedes_retained_parent_and_rejection_never_falls_back(self):
        self.write("pi-agent-addition-active.json", {})
        self.write("tmall-warehouse-addition-active.json", {})
        receipt = {"status": "verified", "migrationCount": 150}
        with patch("pi_agent_addition.verify_active", return_value=(receipt, {}, self.root)) as pi, \
                patch("tmall_warehouse_addition.verify_active") as parent:
            self.assertEqual(gate.verify_release(self.root, self.root), receipt)
            pi.assert_called_once_with(self.root, self.root)
            parent.assert_not_called()
            pi.side_effect = ValueError("invalid Pi receipt")
            with self.assertRaisesRegex(ValueError, "invalid Pi receipt"):
                gate.verify_release(self.root, self.root)
            parent.assert_not_called()
            with self.assertRaises(PlanBlocked):
                gate.verify_release(self.root, self.root, allow_addition=False)
            self.assertEqual(pi.call_count, 2)

    def test_pi_database_startup_uses_complete_check_and_never_parent_on_failure(self):
        self.write("pi-agent-addition-active.json", {})
        self.write("tmall-warehouse-addition-active.json", {})
        complete = {"status": "complete", "migrationCount": 150}
        with patch("django.setup"), \
                patch("pi_agent_addition.complete_database", return_value=complete) as pi, \
                patch("tmall_warehouse_addition.complete_database") as parent:
            self.assertEqual(gate.verify_database_complete(self.root, self.root), complete)
            pi.assert_called_once_with(self.root, self.root)
            parent.assert_not_called()
            pi.side_effect = ValueError("pending or unknown migrations")
            with self.assertRaisesRegex(ValueError, "pending or unknown"):
                gate.verify_database_complete(self.root, self.root)
            parent.assert_not_called()

    def test_parent_database_and_release_dispatch_remain_available_without_pi(self):
        self.write("tmall-warehouse-addition-active.json", {})
        receipt = {"status": "verified", "migrationCount": 149}
        with patch("tmall_warehouse_addition.verify_active", return_value=(receipt, {}, self.root)) as parent, \
                patch("pi_agent_addition.verify_active") as pi:
            self.assertEqual(gate.verify_release(self.root, self.root), receipt)
            parent.assert_called_once_with(self.root, self.root)
            pi.assert_not_called()
        with patch("django.setup"), \
                patch("tmall_warehouse_addition.complete_database", return_value={"migrationCount": 149}) as parent, \
                patch("pi_agent_addition.complete_database") as pi:
            self.assertEqual(gate.verify_database_complete(self.root, self.root), {"migrationCount": 149})
            parent.assert_called_once_with(self.root, self.root)
            pi.assert_not_called()


if __name__ == "__main__":
    unittest.main()
