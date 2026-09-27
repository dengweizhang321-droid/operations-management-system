import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import postgres_no_key_backup as backup


class NoKeyEvidenceTests(unittest.TestCase):
    def evidence(self):
        core = {"profile": backup.PROFILE,
            "roles": {"roles": [["teruisi_sales_owner", True, False, False, False,
                False, False, False, -1]], "settings": []},
            "tables": {"example": {"rows": 2, "sha256": "a" * 64}},
            "catalog": {"relations": "b" * 64}}
        return {**core, "contentSha256": backup.digest(core), "sequenceLowerBounds": {
            "example_id_seq": {"minimumLastValue": 2, "isCalled": True}},
            "archiveEncrypted": False, "newRecoveryKeyGenerated": False, "privateKeyRows": 0}

    def test_online_sequence_can_advance_but_must_not_go_backwards(self):
        before = self.evidence()
        after = copy.deepcopy(before)
        after["sequenceLowerBounds"]["example_id_seq"]["minimumLastValue"] = 3
        backup.verify_restored(before, after)
        for change in ({"minimumLastValue": 1}, {"isCalled": False}):
            after = copy.deepcopy(before)
            after["sequenceLowerBounds"]["example_id_seq"].update(change)
            with self.assertRaisesRegex(RuntimeError, "sequence is behind"):
                backup.verify_restored(before, after)

    def test_row_or_acl_change_cannot_be_hidden_by_rehashing_manifest(self):
        before = self.evidence()
        for section in ("tables", "catalog"):
            after = copy.deepcopy(before)
            if section == "tables":
                after[section]["example"]["rows"] += 1
            else:
                after[section]["relations"] = "c" * 64
            after["contentSha256"] = backup.digest({key: after[key]
                for key in ("profile", "roles", "tables", "catalog")})
            with self.assertRaisesRegex(RuntimeError, "differ from backup"):
                backup.verify_restored(before, after)

    def test_private_key_claim_or_new_key_scheme_is_rejected(self):
        for key, value in (("privateKeyRows", 1), ("newRecoveryKeyGenerated", True),
                ("archiveEncrypted", True), ("privateKeyRows", False)):
            evidence = self.evidence()
            evidence[key] = value
            with self.assertRaises(RuntimeError):
                backup.validate_evidence(evidence)

    def test_role_restore_does_not_accept_privilege_escalation_or_unreviewed_gucs(self):
        roles = self.evidence()["roles"]
        backup.validate_roles(roles, "teruisi_sales")
        for index in range(3, 8):
            changed = copy.deepcopy(roles)
            changed["roles"][0][index] = True
            with self.assertRaisesRegex(RuntimeError, "privileged or invalid"):
                backup.validate_roles(changed, "teruisi_sales")
        for setting in ("search_path=public", "session_preload_libraries=unsafe",
                "statement_timeout=0; SELECT 1"):
            changed = copy.deepcopy(roles)
            changed["settings"] = [["teruisi_sales_owner", "", [setting]]]
            with self.assertRaisesRegex(RuntimeError, "unreviewed role setting"):
                backup.validate_roles(changed, "teruisi_sales")

    def test_role_scope_duplicates_and_sql_names_are_rejected(self):
        for name in ("postgres", 'teruisi_x;DROP ROLE y', "teruisi_" + "x" * 90):
            changed = self.evidence()["roles"]
            changed["roles"][0][0] = name
            with self.assertRaises(RuntimeError):
                backup.validate_roles(changed, "teruisi_sales")
        changed = self.evidence()["roles"]
        changed["roles"] *= 2
        with self.assertRaises(RuntimeError):
            backup.validate_roles(changed, "teruisi_sales")

    def test_manifest_approval_and_archive_bytes_are_bound_before_restore(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "archive.dump"
            archive.write_bytes(b"synthetic archive fixture")
            manifest = root / "manifest.json"
            value = {"version": "teruisi-postgres-daily-backup-v2-no-keys", "status": "completed",
                "database": {"name": "teruisi_sales"},
                "dump": {"sha256": hashlib.sha256(archive.read_bytes()).hexdigest()},
                "profileEvidence": self.evidence()}
            manifest.write_bytes(backup.canonical(value))
            approved = hashlib.sha256(manifest.read_bytes()).hexdigest()
            self.assertEqual(backup.read_manifest(manifest, approved, archive, "teruisi_sales"),
                self.evidence())
            with self.assertRaisesRegex(RuntimeError, "manifest changed"):
                backup.read_manifest(manifest, "a" * 64, archive, "teruisi_sales")
            with self.assertRaisesRegex(RuntimeError, "unreviewed backup manifest"):
                backup.read_manifest(manifest, approved, archive, "different_database")
            archive.write_bytes(b"changed archive fixture")
            with self.assertRaisesRegex(RuntimeError, "archive changed"):
                backup.read_manifest(manifest, approved, archive, "teruisi_sales")
            raw = manifest.read_text(encoding="utf-8").replace('"status":"completed"',
                '"status":"completed","status":"completed"')
            manifest.write_text(raw, encoding="utf-8")
            approved = hashlib.sha256(manifest.read_bytes()).hexdigest()
            with self.assertRaisesRegex(RuntimeError, "duplicate backup manifest key"):
                backup.read_manifest(manifest, approved, archive, "teruisi_sales")


if __name__ == "__main__":
    unittest.main()
