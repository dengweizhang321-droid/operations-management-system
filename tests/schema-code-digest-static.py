"""Private static fixtures: real inherited gates, no DB/lifecycle invocation.

The synthetic proof declares only fixture inputs; it is not execution evidence
and is never written back into the checkout. All mutations stay in TemporaryDirectory.
"""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("schema_digest_checker", SOURCE / "tools/check_schema_code_digest.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class SchemaDigestStaticTests(unittest.TestCase):
    kind = "SalesPreflightIndex"
    recipe_file = "config/main-schema-releases/sales-0012.json"
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="teruisi-schema-digest-static-")
        cls.root = Path(cls.temp.name)
        (cls.root / "tools").mkdir()
        # Import the actual module bytes, including the original inherited gates.
        for path in (SOURCE / "tools").glob("*.py"):
            shutil.copyfile(path, cls.root / "tools" / path.name)
        cls.candidate = checker.load_candidate(cls.root, cls.kind)
        cls.gate = cls.candidate.gate
        for name in cls.gate.CODE_FILES:
            target = cls.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / name, target)
        for path in (SOURCE / "backend").glob("*/migrations/*.py"):
            target = cls.root / path.relative_to(SOURCE)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        cls.supplemental_name = "backend/teruisi_backend/settings.py"
        supplemental_path = cls.root / cls.supplemental_name
        supplemental_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SOURCE / cls.supplemental_name, supplemental_path)
        cls.recipe_name = cls.recipe_file
        cls.validation_name = "fixtures/mandatory-checks.json"
        cls.evidence_name = "fixtures/synthetic-execution-material.json"
        cls.recipe = cls.gate.common.read(SOURCE / cls.recipe_name)
        cls.proof = cls.gate.common.read(SOURCE / cls.recipe["validation"])
        if cls.kind == "AiTaskFeedbackCandidates":
            cls.proof.update(version="ai-task-feedback-candidates-mandatory-code-checks-v1",
                status="code-checked", productionTouched=False, functionalValidationPerformed=False,
                fullBackupOrRestorePerformed=False, generations=[156, 158], parentVariants=[[156, 158]],
                steps=list(cls.gate.STEPS), checks=sorted(cls.gate.CHECKS))
        cls.recipe["validation"] = cls.validation_name
        # The positive fixture uses the real digest over the real copied source.
        cls.recipe["codeSha256"] = cls.gate.code_digest(cls.root)
        cls.proof["codeSha256"] = cls.recipe["codeSha256"]
        cls.proof["migrationSha256"] = cls.gate.common.digest(cls.gate.common.migrations(cls.root))
        cls.evidence = {"version": "teruisi-schema-mandatory-code-execution-v1",
                        "fixtureOnly": True, "codeSha256": cls.recipe["codeSha256"],
                        "migrationSha256": cls.proof["migrationSha256"],
                        "sourceFiles": {name: cls.gate.common.sha(cls.root / name) for name in cls.gate.CODE_FILES},
                        "productionTouched": False, "functionalValidationPerformed": False,
                        "fullBackupOrRestorePerformed": False, "checks": sorted(cls.gate.CHECKS),
                        "syntax": {name: {"status": "passed", "fixtureOnly": True}
                                   for name in ("python", "node", "powershell")},
                        "migrationClosure": {"status": "passed", "fixtureOnly": True},
                        "supplementalSourceFiles": {cls.supplemental_name: cls.gate.common.sha(supplemental_path)}}
        cls.proof["evidence"] = {"path": cls.evidence_name, "sha256": ""}

    @classmethod
    def tearDownClass(cls):
        # Each recipe class owns an independent private import tree.
        for name, module in list(sys.modules.items()):
            file = getattr(module, "__file__", None)
            if file and Path(file).resolve().is_relative_to(cls.root.resolve()):
                del sys.modules[name]
        try:
            sys.path.remove(str(cls.root / "tools"))
        except ValueError:
            pass
        cls.temp.cleanup()

    def setUp(self):
        self.recipe = copy.deepcopy(self.__class__.recipe)
        self.proof = copy.deepcopy(self.__class__.proof)
        self.evidence = copy.deepcopy(self.__class__.evidence)

    def write(self, *, rebind_validation=True, rebind_evidence=True):
        evidence_path = self.root / self.evidence_name
        evidence_path.parent.mkdir(parents=True, exist_ok=True)
        evidence_path.write_text(json.dumps(self.evidence, indent=2) + "\n", encoding="utf-8")
        if rebind_evidence:
            self.proof["evidence"]["sha256"] = self.gate.common.sha(evidence_path)
        for name, value in ((self.validation_name, self.proof), (self.recipe_name, self.recipe)):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
            if name == self.validation_name and rebind_validation:
                self.recipe["validationSha256"] = self.gate.common.sha(target)

    def check(self):
        return checker.check_recipe(self.root, self.recipe_name)

    def assert_fails(self, fragment):
        result = self.check()
        self.assertEqual(result["status"], "failed", result)
        self.assertTrue(any(fragment in error for error in result["errors"]), result)

    def test_real_gate_positive_and_no_runtime_calls(self):
        self.write()
        # These are forbidden even when their real implementations are importable.
        with patch.object(self.candidate, "candidate", side_effect=AssertionError("binder called")), \
                patch.object(self.candidate, "bind", side_effect=AssertionError("binder called")), \
                patch.object(self.gate, "parent_proof", side_effect=AssertionError("parent called")), \
                patch.object(self.gate, "admission", side_effect=AssertionError("admission called")), \
                patch.object(self.gate, "source_delta", side_effect=AssertionError("runtime delta called")):
            import psycopg
            with patch.object(psycopg, "connect", side_effect=AssertionError("DB called")):
                result = self.check()
        self.assertEqual(result["status"], "passed", result)
        self.assertEqual(result["actualCodeSha256"], self.gate.code_digest(self.root))
        self.assertEqual(result["codeFileCount"], len(self.gate.CODE_FILES))
        self.assertFalse(result["parentVerified"])
        self.assertFalse(result["declaredChecksExecuted"])
        self.assertFalse(list(self.root.rglob("*.pyc")))

    def test_inherited_continuation_byte_drift(self):
        self.write()
        name = "tools/manual-maintenance-continuation.mjs"
        self.assertIn(name, self.gate.CODE_FILES)
        target = self.root / name
        old = target.read_bytes()
        try:
            target.write_bytes(old + b"\n// private drift fixture\n")
            self.assert_fails("Recipe codeSha256 differs")
        finally:
            target.write_bytes(old)

    def test_missing_code_member_fails_closed(self):
        self.write()
        target = self.root / "tools/manual-maintenance-continuation.mjs"
        old = target.read_bytes()
        try:
            target.unlink()
            self.assert_fails("FileNotFoundError")
        finally:
            target.write_bytes(old)

    def test_validation_raw_bytes_hash(self):
        self.write()
        target = self.root / self.validation_name
        target.write_bytes(target.read_bytes() + b" \n")
        self.assert_fails("validationSha256 differs")

    def test_proof_code_mismatch_even_with_rebound_validation(self):
        self.proof["codeSha256"] = "0" * 64
        self.write()
        self.assert_fails("Validation codeSha256 differs")

    def test_mandatory_declarations(self):
        cases = {"version": "obsolete", "status": "passed", "productionTouched": True,
                 "functionalValidationPerformed": True, "fullBackupOrRestorePerformed": True,
                 "generations": [152, 154], "parentVariants": [[152, 154]], "steps": [],
                 "checks": list(self.gate.CHECKS) + [next(iter(self.gate.CHECKS))]}
        for field, value in cases.items():
            with self.subTest(field=field):
                self.proof = copy.deepcopy(self.__class__.proof)
                self.proof[field] = value
                self.write()
                self.assert_fails("Mandatory proof " + field)

    def test_migration_source_drift(self):
        self.write()
        target = self.root / next(iter(self.gate.FILES))
        old = target.read_bytes()
        try:
            target.write_bytes(old + b"\n# private migration drift\n")
            self.assert_fails("migrationSha256 differs")
        finally:
            target.write_bytes(old)

    def test_recipe_schema_and_steps(self):
        cases = (("version", "v2", "Recipe version"),
                 ("toGeneration", 155, "toGeneration"),
                 ("steps", [], "Recipe steps"), ("stepFiles", {}, "Recipe stepFiles"),
                 ("extra", True, "Recipe fields"),
                 ("validation", "../outside.json", "Unsafe repository-relative"))
        for field, value, message in cases:
            with self.subTest(field=field):
                self.recipe = copy.deepcopy(self.__class__.recipe)
                self.recipe[field] = value
                self.write()
                self.assert_fails(message)

    def test_unsafe_recipe_reference(self):
        result = checker.check_recipe(self.root, "../outside.json")
        self.assertEqual(result["status"], "failed")
        self.assertIn("Unsafe repository-relative", result["errors"][0])

    def test_sales_execution_material_bytes_and_path(self):
        self.write()
        target = self.root / self.evidence_name
        target.write_bytes(target.read_bytes() + b" \n")
        self.assert_fails("Sales evidence sha256 differs")
        self.proof["evidence"]["path"] = "../outside.json"
        self.write()
        self.assert_fails("Unsafe repository-relative")

    def test_sales_stale_source_map_even_after_all_reference_hashes_rebound(self):
        name = "tools/manual-maintenance-continuation.mjs"
        self.evidence["sourceFiles"][name] = "0" * 64
        self.write()
        self.assert_fails("Sales evidence sourceFiles differ")

    def test_sales_execution_material_declarations(self):
        cases = {"version": "obsolete", "codeSha256": "0" * 64, "migrationSha256": "0" * 64,
                 "productionTouched": True, "functionalValidationPerformed": True,
                 "fullBackupOrRestorePerformed": True, "checks": [], "syntax": {}}
        for field, value in cases.items():
            with self.subTest(field=field):
                self.evidence = copy.deepcopy(self.__class__.evidence)
                self.evidence[field] = value
                self.write()
                self.assert_fails("Sales evidence " + field)

    def test_sales_missing_or_failed_migration_closure(self):
        for value in (None, {"status": "failed"}, {}):
            with self.subTest(value=value):
                self.evidence = copy.deepcopy(self.__class__.evidence)
                if value is None:
                    del self.evidence["migrationClosure"]
                else:
                    self.evidence["migrationClosure"] = value
                self.write()
                self.assert_fails("Sales evidence migrationClosure status")

    def test_sales_supplemental_source_drift_with_rebound_reference_hashes(self):
        target = self.root / self.supplemental_name
        old = target.read_bytes()
        try:
            target.write_bytes(old + b"\n# private supplemental source drift\n")
            self.write()
            self.assertEqual(self.gate.code_digest(self.root), self.recipe["codeSha256"])
            self.assert_fails("Sales evidence supplementalSourceFiles differs")
        finally:
            target.write_bytes(old)

    def test_sales_supplemental_map_schema_paths_and_hashes(self):
        cases = (None, [], {}, {"../outside.py": "0" * 64},
                 {self.supplemental_name: "0" * 64}, {self.supplemental_name: "z" * 64})
        for value in cases:
            with self.subTest(value=value):
                self.evidence = copy.deepcopy(self.__class__.evidence)
                if value is None:
                    del self.evidence["supplementalSourceFiles"]
                else:
                    self.evidence["supplementalSourceFiles"] = value
                self.write()
                result = self.check()
                self.assertEqual(result["status"], "failed", result)
                self.assertTrue(any("supplementalSourceFiles" in error or "Unsafe repository-relative" in error
                                    for error in result["errors"]), result)


class Ai158SchemaDigestStaticTests(SchemaDigestStaticTests):
    kind = "AiTaskFeedbackCandidates"
    recipe_file = "config/main-schema-releases/ai-0088-0089.json"


if __name__ == "__main__":
    unittest.main()
