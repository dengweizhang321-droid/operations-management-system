"""Small source-only regressions for the 2026-10-31 OWNER baseline omission."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("catalog_check", ROOT / "tools/check_catalog_baselines.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class Baselines(unittest.TestCase):
    def test_current_data_and_cli(self):
        self.assertEqual(gate.check(ROOT)["errors"], [])
        process = subprocess.run([sys.executable, "-B", str(ROOT / "tools/check_catalog_baselines.py")],
                                 capture_output=True, text=True, check=True, timeout=10)
        self.assertEqual(json.loads(process.stdout)["status"], "passed")

    def test_exact_historical_sequence(self):
        fixture = json.loads((ROOT / "tests/fixtures/catalog-baselines/workflow-sequence-20261031.json").read_bytes())
        original = Path.read_text

        def historical(path, *args, **kwargs):
            text = original(path, *args, **kwargs)
            if path.name == "workflow_automation_catalog.json":
                data = json.loads(text)
                data["sequence"] = fixture["sequence"]
                return json.dumps(data)
            return text

        with patch.object(Path, "read_text", historical):
            result = gate.check(ROOT)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["errors"], [{"file": "tools/workflow_automation_catalog.json",
                                           "object": "sequence", "missing": ["SELECT", "UPDATE"]}])

    def test_table_missing_maintain_and_other_role_cannot_fill_it(self):
        acl = [["OWNER", privilege, False] for privilege in gate.TABLE - {"MAINTAIN"}]
        acl.append(["writer", "MAINTAIN", False])
        self.assertEqual(gate.missing_owner(acl), ["MAINTAIN"])

    def test_python_literal_missing_privilege(self):
        original = Path.read_text

        def missing(path, *args, **kwargs):
            text = original(path, *args, **kwargs)
            if path.name == "pi_business_catalog.py":
                return text.replace('"MAINTAIN",', '')
            return text

        with patch.object(Path, "read_text", missing):
            result = gate.check(ROOT)
        self.assertIn({"file": "tools/pi_business_catalog.py", "object": "owner", "missing": ["MAINTAIN"]}, result["errors"])

    def test_unreadable_input_fails_cli_and_bad_acl_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            process = subprocess.run([sys.executable, "-B", str(ROOT / "tools/check_catalog_baselines.py"), "--root", directory],
                                     capture_output=True, text=True, timeout=10)
            self.assertEqual(process.returncode, 1)
            self.assertEqual(json.loads(process.stdout)["status"], "failed")
        for acl in (None, [["OWNER", "SELECT", "false"]]):
            with self.assertRaises(ValueError):
                gate.missing_owner(acl)
        with self.assertRaises(ValueError):
            json.loads('{"acl":[],"acl":[]}', object_pairs_hook=gate.unique_keys)


if __name__ == "__main__":
    unittest.main()
