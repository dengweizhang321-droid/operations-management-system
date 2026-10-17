"""File-only binder boundaries; every parent/database action is a private seam."""
import copy
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import jd_product_monitoring_candidate as binder
gate = binder.gate


class MainSchemaCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.runtime = Path(self.temp.name) / "runtime"
        self.root.mkdir(); (self.runtime / "app").mkdir(parents=True)
        (self.runtime / "app/deployment.json").write_text('{"old":147}', encoding="utf8")
        self.parent_file = self.runtime / gate.parent.ACTIVE
        self.parent_file.write_text('{"parent":147}', encoding="utf8")
        self.proof = {"version": "jd-product-monitoring-private-postgres-v1", "status": "passed",
            "productionTouched": False, "generations": [147, 148], "fullBackupOrRestorePerformed": False,
            "steps": list(gate.STEPS), "codeSha256": "a" * 64, "migrationSha256": "b" * 64,
            "checks": sorted(gate.CHECKS)}
        self.proof_path = self.root / "validation.json"
        gate.common.write(self.proof_path, self.proof)
        self.recipe = {"version": "teruisi-main-schema-recipe-v1", "additionKind": "JdProductMonitoring",
            "fromGeneration": 147, "toGeneration": 148, "steps": list(gate.STEPS), "stepFiles": gate.FILES,
            "validation": "validation.json", "validationSha256": gate.common.sha(self.proof_path), "codeSha256": "a" * 64}
        self.recipe_path = self.root / "recipe.json"
        gate.common.write(self.recipe_path, self.recipe)
        self.output = self.root / "evidence.json"
        for name, value in (("code_digest", "a" * 64), ("source_delta", "b" * 64),
                ("parent_proof", ({"parent"}, gate.common.sha(self.parent_file))), ("source_inventory", "d" * 64)):
            seam = patch.object(gate, name, return_value=value); mock = seam.start(); self.addCleanup(seam.stop)
            if name == "parent_proof": self.parent = mock
        admission = patch.object(gate, "admission", return_value={}); self.admission = admission.start(); self.addCleanup(admission.stop)

    def test_create_only_and_check_use_same_exact_files_without_any_network(self):
        with patch.object(socket.socket, "connect", side_effect=AssertionError("binder cannot connect")):
            result = binder.bind(self.root, self.runtime, self.recipe_path, self.output)
            original = self.output.read_bytes()
            self.assertEqual(binder.bind(self.root, self.runtime, self.recipe_path, self.output), result)
            checked = binder.bind(self.root, self.runtime, self.recipe_path, self.output, True, result["evidenceSha256"])
            self.assertEqual(checked["evidenceSha256"], result["evidenceSha256"])
            self.assertEqual(checked["check"], "frozen-inputs-unchanged")
            self.assertEqual(self.output.read_bytes(), original)
            self.assertEqual(self.parent.call_count, 2, "each creation checks its parent once; check never repeats history")
            self.admission.assert_not_called()

    def test_wrong_proof_code_or_generation_never_creates_evidence(self):
        for key, value in (("codeSha256", "f" * 64), ("migrationSha256", "f" * 64), ("productionTouched", True),
                ("generations", [146, 147]), ("fullBackupOrRestorePerformed", True), ("checks", [])):
            proof = self.proof | {key: value}
            self.proof_path.write_bytes(gate.common.canonical(proof))
            recipe = self.recipe | {"validationSha256": gate.common.sha(self.proof_path)}
            self.recipe_path.write_bytes(gate.common.canonical(recipe))
            with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.output)
            self.assertFalse(self.output.exists())

    def test_changed_predecessor_or_evidence_does_not_overwrite_original(self):
        result = binder.bind(self.root, self.runtime, self.recipe_path, self.output)
        original = self.output.read_bytes()
        (self.runtime / "app/deployment.json").write_text('{"old":"changed"}', encoding="utf8")
        with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.output)
        with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.output, True, result["evidenceSha256"])
        self.assertEqual(self.output.read_bytes(), original)

    def test_recipe_is_finite_typed_and_cannot_read_outside_source(self):
        for mutation in ({"fromGeneration": True}, {"toGeneration": 147}, {"steps": ["inventory.0015_jd_monitor_preferences"]},
                {"validation": "../outside.json"}, {"validation": "D:/outside.json"}, {"extra": True}):
            self.recipe_path.write_bytes(gate.common.canonical(self.recipe | mutation))
            with self.assertRaises((ValueError, FileNotFoundError)): binder.candidate(self.root, self.runtime, self.recipe_path)

    def test_parent_reference_drift_and_wrong_check_hash_reject_original_evidence(self):
        result = binder.bind(self.root, self.runtime, self.recipe_path, self.output)
        with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.output, True, "0" * 64)
        self.parent_file.write_text('{"parent":"changed"}', encoding="utf8")
        with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.output, True, result["evidenceSha256"])
        self.output.write_bytes(self.output.read_bytes() + b" ")
        with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.output, True, result["evidenceSha256"])


if __name__ == "__main__":
    unittest.main()
