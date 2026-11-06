"""Private file-gate fixtures using the real isolated PG proof; no database.

Only the older finalized-parent seam is synthetic. Both candidate/admission
execute their real code and must reject a deleted or modified PG proof. The
fixture code-check JSON is not a release validation record.
"""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import ai_unified_tasks_addition as gate
import ai_unified_tasks_candidate as candidate


class StructureEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ai159-proof-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.runtime = Path(self.temp.name) / "runtime"
        self.result_name = "docs/ai-p2-20261107/structure-result.json"
        self.original = (ROOT / self.result_name).read_bytes()
        self.structure = json.loads(self.original)
        names = set(self.structure["sourceFiles"]) | set(gate.CODE_FILES) | {"config/jd-logistics-notifications.json"}
        for name in names:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, path)
        self.result = self.root / self.result_name
        self.result.parent.mkdir(parents=True, exist_ok=True)
        self.result.write_bytes(self.original)
        self.ref = {"path": self.result_name, "sha256": gate.common.sha(self.result)}
        self.baseline = self.runtime / "app"
        for name in gate.common.migrations(self.root):
            if name in gate.FILES:
                continue
            target = self.baseline / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.root / name, target)
        (self.baseline / "deployment.json").write_text('{"fixtureOnly":true}', encoding="utf8")
        (self.runtime / gate.parent.ACTIVE).write_text('{"fixtureOnly":true}', encoding="utf8")
        self.code_sha = gate.code_digest(self.root)
        self.migration_sha = gate.source_delta(self.root, self.baseline)
        self.validation = self.root / "docs/ai-p2-20261107/file-fixture-checks.json"
        self.validation.write_text(json.dumps({"version": "ai-unified-tasks-mandatory-code-checks-v1", "status": "code-checked",
            "productionTouched": False, "functionalValidationPerformed": False, "fullBackupOrRestorePerformed": False,
            "generations": [158,159], "parentVariants": [[158,159]], "steps": list(gate.STEPS), "checks": sorted(gate.CHECKS),
            "codeSha256": self.code_sha, "migrationSha256": self.migration_sha, "structureEvidence": self.ref}), encoding="utf8")
        self.recipe = self.root / "recipe.json"
        self.recipe.write_text(json.dumps({"version": "teruisi-main-schema-recipe-v1", "additionKind": "AiUnifiedTasks",
            "fromGeneration": 158, "toGeneration": 159, "steps": list(gate.STEPS), "stepFiles": gate.FILES,
            "validation": self.validation.relative_to(self.root).as_posix(), "validationSha256": gate.common.sha(self.validation),
            "codeSha256": self.code_sha}), encoding="utf8")
        self.value = candidate.candidate(self.root, self.runtime, self.recipe, full_parent=False)
        self.evidence = self.root / "fixture-evidence.json"
        self.evidence.write_text(json.dumps(self.value), encoding="utf8")
        files = gate.common.migrations(self.baseline)
        self.base = {Path(p).parts[1]+"."+Path(p).stem for p in files if Path(p).stem != "__init__"}
        self.base |= {"contenttypes.0001_initial", "contenttypes.0002_remove_content_type_name"}

    def admission(self):
        with patch.object(gate, "parent_proof", return_value=(self.base, gate.common.sha(self.runtime / gate.parent.ACTIVE))):
            return gate.admission(self.root, self.runtime, self.evidence, gate.common.sha(self.evidence))

    def test_candidate_and_admission_reject_deleted_or_changed_pg_proof(self):
        self.assertEqual(self.admission()["status"], "code-checked")
        for mutation in ("deleted", "changed"):
            with self.subTest(mutation=mutation):
                if mutation == "deleted":
                    self.result.unlink()
                else:
                    self.result.write_bytes(self.original + b" ")
                for call in (lambda: candidate.candidate(self.root, self.runtime, self.recipe, full_parent=False), self.admission):
                    with self.assertRaises((OSError, ValueError)):
                        call()
                self.result.write_bytes(self.original)

    def test_structure_input_change_requires_pg_rehearsal(self):
        path = self.root / "backend/ai_assistant/migrations/0090_unified_tasks.py"
        path.write_bytes(path.read_bytes()+b"\n# changed structure input\n")
        with self.assertRaisesRegex(ValueError, "structure input changed"):
            gate.verify_structure_evidence(self.root, {"structureEvidence": self.ref})

    def test_unrelated_app_change_can_reuse_pg_proof(self):
        name = "backend/ai_assistant/task_definitions.py"
        self.assertNotIn(name, self.structure["sourceFiles"])
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# unrelated app-only code fixture\n", encoding="utf8")
        self.assertEqual(gate.verify_structure_evidence(self.root, {"structureEvidence": self.ref})["status"], "passed")

    def test_rehashed_invalid_status_cleanup_or_receipts_are_rejected(self):
        import copy
        for field, value in (("status", "failed"), ("cleanup", {**self.structure["cleanup"], "stopped": False}),
                ("receiptGenerations", {**self.structure["receiptGenerations"], "159": {"count":159,"sha256":"0"*64}})):
            changed = copy.deepcopy(self.structure)
            changed[field] = value
            self.result.write_text(json.dumps(changed), encoding="utf8")
            ref = {"path": self.result_name, "sha256": gate.common.sha(self.result)}
            with self.subTest(field=field), self.assertRaises(ValueError):
                gate.verify_structure_evidence(self.root, {"structureEvidence": ref})
        self.result.write_bytes(self.original)


if __name__ == "__main__":
    unittest.main()
