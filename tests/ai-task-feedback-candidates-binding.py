"""A layer: real AI158 file gates with a private runtime and explicit DB seams.

The Workflow156 receipt, source delta, prepared binding and active verification
are real. Only Workflow156's older parent proof is a synthetic154 file seam;
no production evidence/credentials are copied. Database effects are covered by
the separate real PostgreSQL B layer, not claimed by this fixture.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import shutil
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / "tools"))
import ai_task_feedback_candidates_addition as gate
import ai_task_feedback_candidates_candidate as binder
import workflow_automation_addition as workflow
import postgres_no_key_backup as backup


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gate.common.canonical(value))


def migration_set(root):
    result = {Path(p).parts[1] + "." + Path(p).stem for p in gate.common.migrations(root)
              if Path(p).stem != "__init__"}
    # These two built-in nodes are recorded by the actual PG156 predecessor.
    return result | {"contenttypes.0001_initial", "contenttypes.0002_remove_content_type_name"}


class Cursor:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, *args): raise AssertionError("A layer must not execute SQL")


class Connection:
    alias = "fixture"
    def cursor(self): return Cursor()


class FileGates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="ai158-file-gates-")
        cls.packet = Path(cls.temp.name)
        cls.root = cls.packet / "source"
        # A uses the complete migration closure plus exact gate code members.
        # Full deployed backend semantics are independently exercised by B.
        for original in (SOURCE / "backend").glob("*/migrations/*.py"):
            target = cls.root / original.relative_to(SOURCE)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
        for name in gate.CODE_FILES:
            target = cls.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists(): shutil.copyfile(SOURCE / name, target)
        path = "config/jd-logistics-notifications.json"
        (cls.root / "config").mkdir(exist_ok=True)
        shutil.copyfile(SOURCE / path, cls.root / path)
        put(cls.root / "deployment.json", {"fixture": "candidate158"})
        cls.code_sha = gate.code_digest(cls.root)
        cls.actual_migrations = staticmethod(gate.common.migrations)
        cls.migration_map = cls.actual_migrations(cls.root)
        cls.migration_sha = gate.common.digest(cls.migration_map)
        cls.actual_inventory = staticmethod(gate.source_inventory)
        cls.inventory_sha = cls.actual_inventory(cls.root)
        cls.proof_name = "fixtures/checks.json"
        cls.proof = {"version": "ai-task-feedback-candidates-mandatory-code-checks-v1",
                     "status": "code-checked", "fixtureOnly": True,
                     "productionTouched": False, "functionalValidationPerformed": False,
                     "fullBackupOrRestorePerformed": False, "generations": [156, 158],
                     "parentVariants": [[156, 158]], "steps": list(gate.STEPS),
                     "checks": sorted(gate.CHECKS), "codeSha256": cls.code_sha,
                     "migrationSha256": cls.migration_sha}
        put(cls.root / cls.proof_name, cls.proof)
        cls.recipe_path = cls.root / "config/main-schema-releases/ai-0088-0089.json"
        cls.recipe = {"version": "teruisi-main-schema-recipe-v1", "additionKind": "AiTaskFeedbackCandidates",
                      "fromGeneration": 156, "toGeneration": 158, "steps": list(gate.STEPS),
                      "stepFiles": gate.FILES, "validation": cls.proof_name,
                      "validationSha256": gate.common.sha(cls.root / cls.proof_name), "codeSha256": cls.code_sha}
        put(cls.recipe_path, cls.recipe)

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def setUp(self):
        self.rt_temp = tempfile.TemporaryDirectory(prefix="ai158-runtime-")
        self.addCleanup(self.rt_temp.cleanup)
        self.runtime = Path(self.rt_temp.name)
        self.app = self.runtime / "app"
        for name in self.migration_map:
            if name in gate.FILES: continue
            target = self.app / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.root / name, target)
        put(self.app / "deployment.json", {"fixture": "deployed156"})
        self.base156 = {Path(p).parts[1] + "." + Path(p).stem for p in self.migration_map
                        if p not in gate.FILES and Path(p).stem != "__init__"} | {
                        "contenttypes.0001_initial", "contenttypes.0002_remove_content_type_name"}
        self.assertEqual(len(self.base156), 156)
        self.base154 = self.base156 - set(workflow.STEPS)
        self.parent_reference = self.runtime / "synthetic-sales154-active.json"
        put(self.parent_reference, {"fixture": "older-parent154"})
        self.parent_sha = gate.common.sha(self.parent_reference)
        self.workflow_folder = self.runtime / "workflow-automation-additions" / ("b" * 32)
        self.workflow_folder.mkdir(parents=True)
        shutil.copytree(self.app, self.workflow_folder / "baseline")
        for name in workflow.FILES: (self.workflow_folder / "baseline" / name).unlink()
        self.parent_baselines = []
        self.maps = {self.root: self.migration_map,
                     self.app: {p: v for p, v in self.migration_map.items() if p not in gate.FILES},
                     self.workflow_folder / "baseline": {p: v for p, v in self.migration_map.items()
                         if p not in gate.FILES and p not in workflow.FILES}}
        self.maps[gate.directory(self.runtime, "c" * 32) / "baseline"] = dict(self.maps[self.app])
        def private_migrations(root):
            root = Path(root)
            if root not in self.maps: self.maps[root] = self.actual_migrations(root)
            return dict(self.maps[root])
        cache = patch.object(gate.common, "migrations", private_migrations)
        cache.start(); self.addCleanup(cache.stop)
        inventory = patch.object(gate, "source_inventory", lambda root: self.inventory_sha)
        inventory.start(); self.addCleanup(inventory.stop)

        def older_parent(runtime, baseline):
            self.assertEqual(runtime, self.runtime)
            self.assertEqual(migration_set(baseline), self.base154)
            self.parent_baselines.append(Path(baseline))
            return self.base154, self.parent_sha

        self.parent_patch = patch.object(workflow, "parent_proof", older_parent)
        self.parent_patch.start()
        self.addCleanup(self.parent_patch.stop)
        self.build_workflow_receipts()
        self.evidence = self.runtime / "candidate158.json"
        self.evidence_sha = binder.bind(self.root, self.runtime, self.recipe_path, self.evidence)["evidenceSha256"]
        self.operation, self.maintenance, self.prepared = "c" * 32, "d" * 32, "e" * 32
        self.candidate_sha = gate.common.sha(self.root / "deployment.json")
        put(self.runtime / ("app.prepare-" + self.prepared + ".json"), {
            "version": "teruisi-django-prepared-app-v1", "id": self.prepared,
            "runtimeRoot": str(self.runtime), "predecessorManifestSha256": gate.common.sha(self.app / "deployment.json"),
            "candidateManifestSha256": self.candidate_sha})
        self.prepared_sha = gate.common.sha(self.runtime / ("app.prepare-" + self.prepared + ".json"))
        put(self.runtime / "run/system-maintenance.json", {
            "version": "teruisi-system-maintenance-v1", "id": self.maintenance,
            "keepPostgres": True, "createdAt": "2026-11-04T00:00:00Z"})
        self.state = {"rows": 3, "legacyRowsSha256": "a" * 64, "permissionsSha256": "b" * 64}
        self.db = Connection()
        self.generation, self.provisioned = 156, False
        self.checked = []

    def build_workflow_receipts(self):
        folder = self.workflow_folder
        predecessor = gate.common.sha(folder / "baseline/deployment.json")
        evidence = {"version": workflow.VERSION, "status": "code-checked", "steps": list(workflow.STEPS),
                    "stepFiles": workflow.FILES, "databasePolicy": workflow.POLICY,
                    "parentReferenceSha256": self.parent_sha, "predecessorSha256": predecessor,
                    "migrationSha256": workflow.source_delta(self.app, folder / "baseline")}
        put(folder / "candidate.json", evidence)
        prepared_id = "f" * 32
        prepared_file = self.runtime / ("app.prepare-" + prepared_id + ".json")
        put(prepared_file, {"version": "teruisi-django-prepared-app-v1", "id": prepared_id,
                           "runtimeRoot": str(self.runtime), "predecessorManifestSha256": predecessor,
                           "candidateManifestSha256": "a" * 64})
        plan = {**evidence, "status": "prepared", "operationId": "b" * 32,
                "candidateEvidenceSha256": gate.common.sha(folder / "candidate.json"),
                "preparedAppId": prepared_id, "preparedReceiptSha256": gate.common.sha(prepared_file),
                "candidateManifestSha256": "a" * 64}
        put(folder / "plan.json", plan)
        state = {"rows": 0, "legacyRowsSha256": "0" * 64, "permissionsSha256": "1" * 64}
        put(folder / "install-intent.json", {"version": workflow.VERSION,
            "planSha256": gate.common.sha(folder / "plan.json"), "at": "fixture", "preservation": state})
        receipt = {"version": workflow.VERSION, "status": "verified", "steps": list(workflow.STEPS),
                   "migrationCount": 156, "migrationSha256": plan["migrationSha256"],
                   "planSha256": gate.common.sha(folder / "plan.json"), "legacyDataPreserved": True,
                   "registrySeeded": True, "permissionsVerified": True, "preservation": state,
                   "installIntentSha256": gate.common.sha(folder / "install-intent.json"),
                   "databasePolicy": workflow.POLICY}
        put(folder / "finalized.json", receipt)
        put(self.runtime / workflow.ACTIVE, {"version": workflow.VERSION, "operationId": "b" * 32,
            "receiptSha256": gate.common.sha(folder / "finalized.json"), "parentReferenceSha256": self.parent_sha})

    def args(self, command, **overrides):
        data = dict(root=str(self.root), runtime=str(self.runtime), command=command, operation=self.operation,
                    maintenance=self.maintenance, prepared_id=self.prepared, prepared_receipt_sha=self.prepared_sha,
                    candidate_sha=self.candidate_sha, evidence=str(self.evidence), evidence_sha=self.evidence_sha,
                    execute=True, schema_only=True)
        return SimpleNamespace(**(data | overrides))

    def invoke(self, command, **overrides):
        import django
        from django.conf import settings
        if not settings.configured:
            settings.configure(INSTALLED_APPS=[], SECRET_KEY="fixture", DATABASES={"default": {
                "ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}})
            django.setup()
        import django.db
        original_path = Path

        def private_path(value, *args):
            if str(value) == r"D:\teruisi-runtime\django-sales": return self.runtime
            return original_path(value, *args)

        def apply(connection, base, expected):
            self.assertIs(connection, self.db)
            self.assertEqual(set(base), self.base156)
            self.assertEqual(expected, self.state)
            self.assertEqual(self.generation, 156)
            self.generation = 158

        def check(connection, base, **kwargs):
            self.assertIs(connection, self.db)
            self.checked.append(kwargs)
            if self.generation != 158 or kwargs.get("permissions", True) and not self.provisioned:
                raise ValueError("fixture database final ACL refused")
            if kwargs.get("expected") != self.state: raise ValueError("fixture preservation changed")

        with patch.object(gate, "Path", private_path), patch.object(django.db, "connection", self.db), \
             patch.object(gate, "database_identity", lambda c: self.assertIs(c, self.db)), \
             patch.object(gate, "apply_steps", apply), patch.object(gate, "check_database", check), \
             patch.object(gate, "preservation", lambda c: dict(self.state)), \
             patch.object(backup, "verify_receipt_generation", lambda c, **kw: self.generation):
            return gate.main(self.args(command, **overrides))

    @property
    def folder(self): return gate.directory(self.runtime, self.operation)

    def install(self):
        self.invoke("plan")
        self.invoke("deployment")
        shutil.copyfile(self.root / "deployment.json", self.app / "deployment.json")
        return self.invoke("install")

    def test_complete_file_lifecycle_and_provision_failure(self):
        self.assertEqual(self.install()["migrationCount"], 158)
        installed = (self.runtime / gate.ACTIVE).read_bytes()
        with self.assertRaises(ValueError): self.invoke("finalize")
        self.assertFalse((self.folder / "finalized.json").exists())
        self.assertEqual((self.runtime / gate.ACTIVE).read_bytes(), installed)
        self.provisioned = True
        self.assertEqual(self.invoke("finalize")["status"], "verified")
        self.assertEqual(self.invoke("finalize")["migrationCount"], 158)
        for command in ("release", "successor"):
            self.assertEqual(self.invoke(command)["migrationCount"], 158)
        self.assertTrue(self.parent_baselines)
        self.assertTrue(all(p == self.workflow_folder / "baseline" for p in self.parent_baselines))
        with self.assertRaises(ValueError): gate.parent_proof(self.runtime, self.root)

    def test_operation_generation_and_source_delta_guards(self):
        for operation in (None, "../bad", "A" * 32, "a" * 31):
            with self.subTest(operation=operation), self.assertRaises(ValueError): gate.directory(self.runtime, operation)
        for generation in (True, 155, 157, 158, "156"):
            with self.assertRaises(ValueError): gate.steps_files(generation)
        for base in (set(), self.base156 | {gate.STEPS[0]}, self.base156 - {next(iter(self.base156))}):
            with self.assertRaises(ValueError): gate.steps_for_base(base)
        self.assertEqual(gate.source_delta(self.root, self.app), self.migration_sha)
        with self.assertRaises(ValueError): gate.source_delta(self.root, self.root)
        first = self.root / next(iter(gate.FILES))
        before = first.read_bytes()
        try:
            first.write_bytes(before + b"\n# mutation\n")
            self.maps.pop(self.root, None)
            with self.assertRaises(ValueError): gate.source_delta(self.root, self.app)
        finally:
            first.write_bytes(before)
            self.maps[self.root] = self.migration_map

    def test_recipe_and_proof_guards(self):
        for key, bad in {"additionKind": "WorkflowAutomation", "toGeneration": 157,
                         "steps": list(reversed(gate.STEPS)), "stepFiles": {}, "extra": True}.items():
            try:
                put(self.recipe_path, self.recipe | {key: bad})
                with self.assertRaises(ValueError): binder.candidate(self.root, self.runtime, self.recipe_path)
            finally: put(self.recipe_path, self.recipe)
        proof_path = self.root / self.proof_name
        for key, bad in {"version": "wrong", "status": "passed", "productionTouched": True,
                         "functionalValidationPerformed": True, "fullBackupOrRestorePerformed": True,
                         "generations": [156, 157], "parentVariants": [], "checks": [],
                         "migrationSha256": "0" * 64, "codeSha256": "0" * 64}.items():
            try:
                put(proof_path, self.proof | {key: bad})
                put(self.recipe_path, self.recipe | {"validationSha256": gate.common.sha(proof_path)})
                with self.assertRaises(ValueError): binder.candidate(self.root, self.runtime, self.recipe_path)
            finally:
                put(proof_path, self.proof); put(self.recipe_path, self.recipe)
        for name in ("../bad", "D:/bad", "/bad", "bad\\name", "./bad", ""):
            with self.assertRaises(ValueError): binder.relative(self.root, name)

    def test_candidate_bind_and_admission_tampering(self):
        self.assertEqual(binder.bind(self.root, self.runtime, self.recipe_path, self.evidence,
                                   True, self.evidence_sha)["generation"], 158)
        with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.evidence, True, "bad")
        for key, bad in {"version": "bad", "status": "passed", "steps": [], "stepFiles": {},
                         "databasePolicy": "bad", "extra": True,
                         "parentReferenceSha256": "0" * 64, "codeSha256": "0" * 64,
                         "sourceSha256": "0" * 64, "predecessorSha256": "0" * 64}.items():
            old = self.evidence.read_bytes()
            try:
                put(self.evidence, json.loads(old) | {key: bad})
                digest = gate.common.sha(self.evidence)
                with self.assertRaises(ValueError): gate.admission(self.root, self.runtime, self.evidence, digest)
                with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.evidence, True, digest)
                with self.assertRaises(ValueError): binder.bind(self.root, self.runtime, self.recipe_path, self.evidence)
            finally: self.evidence.write_bytes(old)

    def test_prepared_plan_deployment_and_unknown_guards(self):
        with self.assertRaises(ValueError): gate.prepared_binding(self.runtime, "bad", "0" * 64, self.candidate_sha)
        receipt = self.runtime / ("app.prepare-" + self.prepared + ".json")
        old = receipt.read_bytes()
        try:
            put(receipt, json.loads(old) | {"runtimeRoot": str(self.root)})
            with self.assertRaises(ValueError): gate.prepared_binding(self.runtime, self.prepared, gate.common.sha(receipt), self.candidate_sha)
        finally: receipt.write_bytes(old)
        with self.assertRaises(ValueError): self.invoke("plan", execute=False)
        with self.assertRaises(ValueError): self.invoke("plan", schema_only=False)
        self.invoke("plan")
        with self.assertRaises(ValueError): self.invoke("plan")
        pending = self.folder / "uncertain.tmp"
        pending.write_text("fixture", encoding="utf8")
        try:
            with self.assertRaises(ValueError): gate.load_plan(self.runtime, self.operation)
        finally: pending.unlink()
        plan_file = self.folder / "plan.json"
        original = plan_file.read_bytes()
        for key, bad in {"version": "bad", "operationId": "a" * 32, "steps": [], "databasePolicy": "bad",
                         "parentReferenceSha256": "0" * 64}.items():
            try:
                put(plan_file, json.loads(original) | {key: bad})
                with self.assertRaises(ValueError): gate.load_plan(self.runtime, self.operation)
            finally: plan_file.write_bytes(original)
        with self.assertRaises(ValueError): self.invoke("deployment", maintenance="a" * 32)
        original_candidate = (self.root / "deployment.json").read_bytes()
        try:
            put(self.root / "deployment.json", {"fixture": "changed"})
            with self.assertRaises(ValueError): self.invoke("deployment")
        finally: (self.root / "deployment.json").write_bytes(original_candidate)
        with self.assertRaises(ValueError): self.invoke("install")

    def test_receipt_fields_are_rejected_even_when_hashes_are_resigned(self):
        self.install(); self.provisioned = True; self.invoke("finalize")
        final, marker = self.folder / "finalized.json", self.runtime / gate.ACTIVE
        original, pointer = final.read_bytes(), marker.read_bytes()
        for key, bad in {"version": "bad", "status": "schema_installed", "migrationCount": 157,
                         "steps": [], "migrationSha256": "0" * 64, "planSha256": "0" * 64,
                         "legacyDataPreserved": False, "preservation": {}, "installIntentSha256": "0" * 64,
                         "databasePolicy": "bad", "permissionsVerified": False}.items():
            try:
                put(final, json.loads(original) | {key: bad})
                put(marker, json.loads(pointer) | {"receiptSha256": gate.common.sha(final)})
                with self.assertRaises(ValueError): gate.verify_active(self.root, self.runtime)
            finally: final.write_bytes(original); marker.write_bytes(pointer)
        try:
            put(marker, json.loads(pointer) | {"version": "bad"})
            with self.assertRaises(ValueError): gate.verify_active(self.root, self.runtime)
        finally: marker.write_bytes(pointer)

    def test_intent_publish_and_no_replay(self):
        self.install()
        with self.assertRaises(ValueError): self.invoke("install")
        self.assertEqual(self.invoke("reconcile")["status"], "schema_installed")
        intent = self.folder / "install-intent.json"
        original = intent.read_bytes()
        for key, bad in {"version": "bad", "planSha256": "0" * 64,
                         "preservation": {"rows": -1, "legacyRowsSha256": "0" * 64, "permissionsSha256": "0" * 64}}.items():
            try:
                put(intent, json.loads(original) | {key: bad})
                with self.assertRaises(ValueError): gate.install_intent(self.folder)
            finally: intent.write_bytes(original)
        installed = self.folder / "installed.json"
        before = installed.read_bytes()
        try:
            put(installed, json.loads(before) | {"migrationCount": 157})
            with self.assertRaises(ValueError): gate.publish_installed(self.runtime, self.operation, self.folder, gate.load_plan(self.runtime, self.operation)[1])
        finally: installed.write_bytes(before)
        marker = self.runtime / gate.ACTIVE; before = marker.read_bytes()
        try:
            put(marker, json.loads(before) | {"operationId": "a" * 32})
            with self.assertRaises(ValueError): gate.publish_installed(self.runtime, self.operation, self.folder, gate.load_plan(self.runtime, self.operation)[1])
        finally: marker.write_bytes(before)

    def test_inventory_rejects_links_and_empty_scan(self):
        import os
        target = self.root / "backend/fixture-hardlink.py"
        original = self.root / "backend/fixture-original.py"
        original.write_text("# private fixture", encoding="utf8")
        try:
            os.link(original, target)
            with self.assertRaises(ValueError): self.actual_inventory(self.root)
        finally:
            target.unlink(missing_ok=True); original.unlink(missing_ok=True)
        with patch.object(Path, "rglob", lambda path, pattern: iter(())):
            with self.assertRaises(ValueError): self.actual_inventory(self.root)

    def test_candidate_cli_fixed_paths(self):
        output = self.root.parent / "schema/ai-0088-0089-evidence.json"
        args = SimpleNamespace(source=str(self.root), runtime=r"D:\teruisi-runtime\django-sales",
                               recipe=str(self.recipe_path), output=str(output), check="", evidence_sha="")
        def path_alias(value, *extra):
            if str(value) == r"D:\teruisi-runtime\django-sales": return self.runtime
            return Path(value, *extra)
        with patch.object(binder, "Path", path_alias), patch.object(binder, "bind", return_value={"fixture": True}):
            self.assertEqual(binder.main(args), {"fixture": True})
            for key, bad in {"runtime": str(self.root), "recipe": str(self.root / "wrong.json"),
                             "output": str(self.root / "wrong.json")}.items():
                original = getattr(args, key)
                try:
                    setattr(args, key, bad)
                    with self.assertRaises(ValueError): binder.main(args)
                finally: setattr(args, key, original)

    def test_production_runtime_identity_is_not_relaxed(self):
        with self.assertRaises(ValueError): gate.main(self.args("admission"))
        class IdentityCursor(Cursor):
            value = ("wrong", "teruisi_sales_owner", "127.0.0.1", 5432)
            def execute(self, *args): pass
            def fetchone(self): return self.value
        cursor = IdentityCursor()
        connection = SimpleNamespace(cursor=lambda: cursor)
        with self.assertRaises(ValueError): gate.database_identity(connection)
        cursor.value = ("teruisi_sales", "teruisi_sales_owner", "127.0.0.1", 5432)
        gate.database_identity(connection)


if __name__ == "__main__":
    unittest.main()
