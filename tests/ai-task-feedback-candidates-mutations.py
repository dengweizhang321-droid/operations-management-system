"""Disable each AI158 reject guard in memory and require its private test to fail.

The source on disk remains byte-for-byte unchanged, so code-digest assertions
cannot kill every mutant accidentally. Only the selected compiled condition
changes. The suite must exercise private fixtures and must never use a real
production CLI, database, runtime, lifecycle or credential.
"""
import argparse
import ast
from contextlib import ExitStack, nullcontext
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULES = tuple("ai_task_feedback_candidates_" + name for name in ("addition", "candidate", "catalog"))


class ProbeCursor:
    def __init__(self, *, one=(True,), rows=()):
        self.one, self.rows = one, rows
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, *args): pass
    def fetchone(self): return self.one
    def fetchall(self): return self.rows


class DirectGuards(unittest.TestCase):
    """Pure function probes for guards that the file lifecycle deliberately mocks."""
    def setUp(self):
        import ai_task_feedback_candidates_addition as gate
        import ai_task_feedback_candidates_catalog as catalog
        self.gate, self.catalog = gate, catalog
        self.base = frozenset("fixture.step" + str(i) for i in range(156))
        self.state = {"rows": 3, "legacyRowsSha256": "a" * 64, "permissionsSha256": "b" * 64}

    def test_parent_and_prepared_guards(self):
        gate = self.gate
        with patch.object(gate.parent, "_verify_active_with_base", return_value=(
                {"migrationCount": 155}, {}, None, self.base - set(gate.parent.STEPS))), \
             patch.object(gate.parent, "steps_for_base", return_value=()), \
             patch.object(gate.common, "sha", return_value="a" * 64):
            with self.assertRaisesRegex(ValueError, "requires its exact verified156 parent"):
                gate.parent_proof(Path("fixture"), Path("baseline"))
        for prepared, candidate, message in (("bad", "a" * 64, "prepared application is required"),
                                              ("a" * 32, "bad", "candidate manifest hash")):
            receipt = {"version": "teruisi-django-prepared-app-v1", "id": prepared,
                       "runtimeRoot": "fixture", "predecessorManifestSha256": "b" * 64,
                       "candidateManifestSha256": candidate}
            with patch.object(gate.common, "read", return_value=receipt):
                with self.assertRaisesRegex(ValueError, message):
                    gate.prepared_binding(Path("fixture"), prepared, "c" * 64, candidate)

    def test_empty_inventory_guard(self):
        import tempfile
        with tempfile.TemporaryDirectory(prefix="ai158-inventory-probe-") as folder:
            root = Path(folder)
            (root / "backend").mkdir()
            with patch.object(self.gate.common, "sha", return_value="a" * 64):
                with self.assertRaisesRegex(ValueError, "Missing .* backend source inventory"):
                    self.gate.source_inventory(root)

    def test_admission_proof_guard(self):
        gate = self.gate
        value = {"version": gate.VERSION, "status": "code-checked", "predecessorSha256": "a" * 64,
                 "parentReferenceSha256": "a" * 64, "migrationSha256": "a" * 64,
                 "codeSha256": "a" * 64, "sourceSha256": "a" * 64, "steps": list(gate.STEPS),
                 "stepFiles": gate.FILES, "validation": "fixture", "validationSha256": "a" * 64,
                 "databasePolicy": gate.POLICY}
        with ExitStack() as stack:
            stack.enter_context(patch.object(gate.common, "read", side_effect=[value, {"version": "wrong"}]))
            for name in ("source_delta", "code_digest", "source_inventory"):
                stack.enter_context(patch.object(gate, name, return_value="a" * 64))
            stack.enter_context(patch.object(gate.common, "sha", return_value="a" * 64))
            stack.enter_context(patch.object(gate, "parent_proof", return_value=(self.base, "a" * 64)))
            with self.assertRaisesRegex(ValueError, "mandatory code-check record is incomplete"):
                gate.admission(Path("root"), Path("runtime"), "evidence", "a" * 64)

    def test_plan_prepared_predecessor_guard(self):
        import tempfile
        gate = self.gate
        with tempfile.TemporaryDirectory(prefix="ai158-plan-probe-") as folder:
            plan = {"version": gate.VERSION, "operationId": "a" * 32, "steps": list(gate.STEPS),
                    "databasePolicy": gate.POLICY, "parentReferenceSha256": "a" * 64,
                    "predecessorSha256": "a" * 64, "candidateEvidenceSha256": "a" * 64,
                    "preparedAppId": "b" * 32, "preparedReceiptSha256": "a" * 64,
                    "candidateManifestSha256": "a" * 64}
            with patch.object(gate, "directory", return_value=Path(folder)), \
                 patch.object(gate, "parent_proof", return_value=(self.base, "a" * 64)), \
                 patch.object(gate.common, "read", side_effect=[plan, {}]), \
                 patch.object(gate.common, "sha", return_value="a" * 64), \
                 patch.object(gate, "prepared_binding", return_value={"predecessorManifestSha256": "b" * 64}):
                with self.assertRaisesRegex(ValueError, "prepared predecessor differs from plan"):
                    gate._load_plan_with_base(Path(folder), "a" * 32)

    def test_apply_steps_guards(self):
        import postgres_no_key_backup as backup
        from django.db import transaction
        import django.db.migrations.executor as executors
        import django.db.migrations.recorder as recorders
        gate = self.gate
        fields = ("lock", "beforeGeneration", "beforePreservation", "beforeRecorder", "pending",
                  "afterRecorder", "afterGeneration", "afterPreservation")
        messages = ("Another .* migration owner", "requires exact156", "changed after intent",
                    "parent migration catalogue changed", "finite forward migration chain",
                    "Unexpected .* migration result", "result is not exact158", "changed existing rows")
        for bad, message in zip(fields, messages):
            with self.subTest(guard=bad), ExitStack() as stack:
                cursor = ProbeCursor(one=(bad != "lock",))
                connection = types.SimpleNamespace(alias="private-ai158", cursor=lambda: cursor)
                pending = [(types.SimpleNamespace(app_label=step.split(".", 1)[0], name=step.split(".", 1)[1]), False)
                           for step in gate.STEPS]
                if bad == "pending": pending = pending[:1]
                loader = types.SimpleNamespace(graph=types.SimpleNamespace(leaf_nodes=lambda: []),
                                               project_state=lambda _: types.SimpleNamespace(apps=object()))
                executor = types.SimpleNamespace(loader=loader, migration_plan=lambda _: pending, migrate=lambda _: None)
                before = self.base - {next(iter(self.base))} if bad == "beforeRecorder" else self.base
                after = self.base | set(gate.STEPS[:1] if bad == "afterRecorder" else gate.STEPS)
                recorder = types.SimpleNamespace(applied_migrations=unittest.mock.Mock(
                    side_effect=[[tuple(x.split(".", 1)) for x in before], [tuple(x.split(".", 1)) for x in after]]))
                stack.enter_context(patch.object(transaction, "atomic", side_effect=lambda **kw: nullcontext()))
                stack.enter_context(patch.object(executors, "MigrationExecutor", return_value=executor))
                stack.enter_context(patch.object(recorders, "MigrationRecorder", return_value=recorder))
                stack.enter_context(patch.object(backup, "verify_receipt_generation", side_effect=[
                    155 if bad == "beforeGeneration" else 156, 157 if bad == "afterGeneration" else 158]))
                stack.enter_context(patch.object(gate, "preservation", side_effect=[
                    {} if bad == "beforePreservation" else self.state, {} if bad == "afterPreservation" else self.state]))
                for name in ("verify_catalog", "verify_defaults", "verify_initial_values"):
                    stack.enter_context(patch.object(gate, name))
                with self.assertRaisesRegex(ValueError, message):
                    gate.apply_steps(connection, self.base, self.state)

    def test_check_database_guards(self):
        import postgres_no_key_backup as backup
        import django.db.migrations.executor as executors
        import django.db.migrations.recorder as recorders
        gate = self.gate
        for bad, message in (("generation", "catalogue is incomplete"),
                             ("preservation", "differ from original intent"),
                             ("pending", "Pending or unknown migrations")):
            with self.subTest(guard=bad), ExitStack() as stack:
                connection = types.SimpleNamespace(cursor=lambda: ProbeCursor())
                loader = types.SimpleNamespace(graph=types.SimpleNamespace(leaf_nodes=lambda: []),
                                               project_state=lambda _: types.SimpleNamespace(apps=object()))
                executor = types.SimpleNamespace(loader=loader, migration_plan=lambda _: [object()] if bad == "pending" else [])
                recorder = types.SimpleNamespace(applied_migrations=lambda: [
                    tuple(x.split(".", 1)) for x in self.base | set(gate.STEPS)])
                stack.enter_context(patch.object(executors, "MigrationExecutor", return_value=executor))
                stack.enter_context(patch.object(recorders, "MigrationRecorder", return_value=recorder))
                stack.enter_context(patch.object(backup, "verify_receipt_generation", return_value=157 if bad == "generation" else 158))
                stack.enter_context(patch.object(gate, "preservation", return_value={} if bad == "preservation" else self.state))
                for name in ("verify_catalog", "verify_defaults"):
                    stack.enter_context(patch.object(gate, name))
                with self.assertRaisesRegex(ValueError, message):
                    gate.check_database(connection, self.base, expected=self.state)

    def test_catalog_guards(self):
        catalog = self.catalog
        reference = {"version": catalog.VERSION, "migrationFiles": catalog.FILES,
                     "tables": {name: {"acl": [["OWNER", "SELECT", False]]} for name in catalog.TABLES}, "functions": {}}
        for rows, functions, actual, installed, message in (([], {}, reference, True, "absent, partial"),
                ([], {"stray": {}}, reference, False, "absent, partial"),
                ([(x,) for x in catalog.TABLES], {}, {}, True, "exact table/function")):
            with self.subTest(message=message), patch.object(catalog, "inspect_functions", return_value=functions), \
                 patch.object(catalog, "capture", return_value=actual), patch.object(catalog, "expected", return_value=reference):
                with self.assertRaisesRegex(ValueError, message):
                    catalog.verify_tables(ProbeCursor(rows=rows), installed=installed)
        with self.assertRaisesRegex(ValueError, "cannot seed or import"):
            catalog.verify_initial_values(ProbeCursor(one=(True,)))
        import workflow_automation_catalog as parent
        defaults = types.SimpleNamespace(old_value_json="null", applies_to="this_report", source="user",
            status="confirmed", version=2, feedback_ids_json="[]", unverified_count=0,
            reviewed_by="", reviewed_at=None, review_note="")
        apps = types.SimpleNamespace(get_model=lambda *args: lambda: defaults)
        with patch.object(parent, "verify_defaults"):
            with self.assertRaisesRegex(ValueError, "migration-state defaults differ"):
                catalog.verify_defaults(apps)

    def test_preservation_bounds(self):
        import workflow_automation_catalog as parent
        catalog = self.catalog
        objects = {name: {"acl": [], "columnAcl": []} for name in parent.TABLES}
        models = {name: types.SimpleNamespace(_meta=types.SimpleNamespace(pk=types.SimpleNamespace(column="key")))
                  for name in parent.TABLES}
        for original_count, rows in ((500000, [({},)]), (0, [({},)] * 100001)):
            original = {**self.state, "rows": original_count}
            with self.subTest(rows=original_count), patch.object(parent, "preservation", return_value=original), \
                 patch.object(parent, "inspect_tables", return_value=objects), \
                 patch.object(parent, "models_at_revision", return_value=models):
                with self.assertRaisesRegex(ValueError, "preservation exceeded bound"):
                    catalog.preservation(ProbeCursor(rows=rows))

    def test_install_and_installed_publication_guards(self):
        import tempfile
        import postgres_no_key_backup as backup
        gate = self.gate
        with tempfile.TemporaryDirectory(prefix="ai158-publication-probe-") as folder:
            root = Path(folder)
            plan = {"steps": list(gate.STEPS), "migrationSha256": "a" * 64,
                    "parentReferenceSha256": "a" * 64}
            with ExitStack() as stack:
                stack.enter_context(patch.object(backup, "verify_receipt_generation", return_value=155))
                stack.enter_context(patch.object(gate, "preservation", return_value=self.state))
                stack.enter_context(patch.object(gate, "publish"))
                stack.enter_context(patch.object(gate, "apply_steps"))
                stack.enter_context(patch.object(gate, "publish_installed", return_value={}))
                stack.enter_context(patch.object(gate.common, "sha", return_value="a" * 64))
                with self.assertRaisesRegex(ValueError, "install intent/result exists"):
                    gate.install_schema("install", types.SimpleNamespace(cursor=lambda: ProbeCursor()),
                                        root, "a" * 32, root, plan, self.base)
            (root / "installed.json").write_text("{}", encoding="utf8")
            with patch.object(gate, "install_intent", return_value={"preservation": self.state}), \
                 patch.object(gate.common, "read", return_value={"changed": True}), \
                 patch.object(gate.common, "sha", return_value="a" * 64), patch.object(gate, "publish"):
                with self.assertRaisesRegex(ValueError, "original installed receipt differs"):
                    gate.publish_installed(root, "a" * 32, root, plan)

    def test_binder_early_guards(self):
        import ai_task_feedback_candidates_candidate as binder
        value = {key: None for key in binder.FIELDS}
        value.update(version=binder.gate.VERSION, status="code-checked", databasePolicy=binder.gate.POLICY)
        for evidence_sha, changes, message in (("bad", {}, "Exact evidence SHA is required"),
                                               ("a" * 64, {"version": "wrong"}, "evidence identity is invalid")):
            record = value | changes
            with self.subTest(message=message), patch.object(binder.gate.common, "read", return_value=record), \
                 patch.object(binder.gate.common, "sha", return_value="a" * 64), \
                 patch.object(binder, "candidate", return_value=record):
                with self.assertRaisesRegex(ValueError, message):
                    binder.bind(Path("private"), Path("runtime"), Path("recipe"), Path("output"), True, evidence_sha)

    def main_fixture(self, stack, root, command):
        """All file/DB/lifecycle effects are private or inert before calling main."""
        import django
        import django.db
        gate = self.gate
        runtime = root / "runtime"
        runtime.mkdir()
        folder = root / "operation"
        folder.mkdir()
        original_path = Path
        def private_path(value, *args):
            if str(value) == r"D:\teruisi-runtime\django-sales": return runtime
            return original_path(value, *args)
        stack.enter_context(patch.object(gate, "Path", private_path))
        plan = {"maintenanceId": "a" * 32, "maintenanceSha256": "a" * 64,
                "migrationSha256": "a" * 64, "codeSha256": "a" * 64,
                "sourceSha256": "a" * 64, "candidateManifestSha256": "a" * 64,
                "parentReferenceSha256": "a" * 64}
        for name in ("source_delta", "code_digest", "source_inventory"):
            stack.enter_context(patch.object(gate, name, return_value="a" * 64))
        for name in ("sha", "maintenance"):
            stack.enter_context(patch.object(gate.common, name, return_value="a" * 64))
        stack.enter_context(patch.object(gate, "load_plan", return_value=(folder, plan)))
        stack.enter_context(patch.object(gate, "parent_proof", return_value=(self.base, "a" * 64)))
        for name in ("publish", "database_identity", "check_database"):
            stack.enter_context(patch.object(gate, name))
        stack.enter_context(patch.object(gate, "install_intent", return_value={"preservation": self.state}))
        stack.enter_context(patch.object(django, "setup"))
        stack.enter_context(patch.object(django.db, "connection", object()))
        args = types.SimpleNamespace(root=str(root), runtime=str(runtime), command=command,
            operation="b" * 32, maintenance="a" * 32, execute=True, schema_only=True,
            evidence="fixture", evidence_sha="a" * 64, prepared_id="c" * 32,
            prepared_receipt_sha="a" * 64, candidate_sha="a" * 64)
        return args, runtime, folder

    def test_main_plan_guards(self):
        import tempfile
        gate = self.gate
        for bad, message in (("predecessor", "prepared predecessor differs from evidence"),
                             ("operation", "schema operation already exists")):
            with self.subTest(guard=bad), tempfile.TemporaryDirectory(prefix="ai158-main-plan-") as folder, ExitStack() as stack:
                args, runtime, operation = self.main_fixture(stack, Path(folder), "plan")
                stack.enter_context(patch.object(gate, "admission", return_value={"predecessorSha256": "a" * 64}))
                stack.enter_context(patch.object(gate, "prepared_binding", return_value={
                    "predecessorManifestSha256": ("b" if bad == "predecessor" else "a") * 64}))
                target = unittest.mock.MagicMock()
                target.exists.return_value = bad == "operation"
                target.__truediv__.side_effect = lambda name: operation / name
                stack.enter_context(patch.object(gate, "directory", return_value=target))
                stack.enter_context(patch.object(gate.shutil, "copytree"))
                stack.enter_context(patch.object(gate.shutil, "copyfile"))
                with self.assertRaisesRegex(ValueError, message):
                    gate.main(args)

    def test_main_finalize_guards(self):
        import tempfile
        gate = self.gate
        for bad, message in (("final-owner", "operation owns finalization"),
                             ("install-owner", "operation owns installation"),
                             ("interrupted", "Interrupted .* finalization differs")):
            with self.subTest(guard=bad), tempfile.TemporaryDirectory(prefix="ai158-main-final-") as folder, ExitStack() as stack:
                root = Path(folder)
                args, runtime, operation = self.main_fixture(stack, root, "finalize")
                if bad != "install-owner": (operation / "finalized.json").write_text("{}", encoding="utf8")
                def read(path, *unused):
                    if Path(path).name == gate.ACTIVE:
                        return {"receiptSha256": ("a" if bad == "final-owner" else "b") * 64}
                    return {"changed": True}
                stack.enter_context(patch.object(gate.common, "read", side_effect=read))
                stack.enter_context(patch.object(gate, "verify_active", return_value=(
                    {"version": gate.VERSION, "status": "schema_installed"}, {},
                    operation if bad == "interrupted" else root / "other-operation")))
                with self.assertRaisesRegex(ValueError, message):
                    gate.main(args)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def guards(root=ROOT):
    """Stable function/message IDs; line numbers remain diagnostic only."""
    result = []
    for module in MODULES:
        path = root / "tools" / (module + ".py")
        tree = ast.parse(path.read_bytes(), filename=str(path))
        parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
        seen = {}
        for node in ast.walk(tree):
            if not isinstance(node, ast.If) or len(node.body) != 1 or not isinstance(node.body[0], ast.Raise):
                continue
            error = node.body[0].exc
            message = (error.args[0].value if isinstance(error, ast.Call) and error.args
                       and isinstance(error.args[0], ast.Constant) else ast.unparse(error))
            owner = parents.get(node)
            while owner is not None and not isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef)):
                owner = parents.get(owner)
            function = owner.name if owner is not None else "__main__"
            label = module + ":" + function + ":" + str(message)
            seen[label] = seen.get(label, 0) + 1
            identity = label + (":" + str(seen[label]) if seen[label] != 1 else "")
            result.append({"id": identity, "module": module, "function": function,
                           "line": node.lineno, "message": message, "condition": ast.unparse(node.test)})
    return sorted(result, key=lambda item: (item["module"], item["line"]))


def install_mutant(root, identity):
    """Load one changed implementation, keeping __file__ and all raw inputs real."""
    selected = next(item for item in guards(root) if item["id"] == identity)
    name = selected["module"]
    path = root / "tools" / (name + ".py")
    original = path.read_bytes()
    tree = ast.parse(original, filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and node.lineno == selected["line"]:
            node.test = ast.copy_location(ast.Constant(False), node.test)
            break
    ast.fix_missing_locations(tree)
    module = types.ModuleType(name)
    module.__file__ = str(path)
    sys.modules[name] = module
    sys.path.insert(0, str(root / "tools"))
    exec(compile(tree, str(path), "exec"), module.__dict__)
    return selected, sha(original)


def cases_for(item):
    function, module = item["function"], item["module"].rsplit("_", 1)[-1]
    message = str(item["message"])
    if module == "addition" and function == "main":
        if "prepared predecessor" in message or "operation already exists" in message:
            return ["DirectGuards.test_main_plan_guards"]
        if "owns finalization" in message or "owns installation" in message or "Interrupted" in message:
            return ["DirectGuards.test_main_finalize_guards"]
    if module == "addition" and (function == "install_schema" or
            function == "publish_installed" and "original installed" in message):
        return ["DirectGuards.test_install_and_installed_publication_guards"]
    if module == "candidate" and function == "bind" and (
            "Exact evidence SHA" in message or "identity is invalid" in message):
        return ["DirectGuards.test_binder_early_guards"]
    direct = {"apply_steps": "test_apply_steps_guards", "check_database": "test_check_database_guards",
              "parent_proof": "test_parent_and_prepared_guards"}
    if module == "catalog":
        return ["DirectGuards." + ("test_preservation_bounds" if function == "preservation" else "test_catalog_guards")]
    if module == "addition" and function in direct:
        return ["DirectGuards." + direct[function]]
    mapping = {
        "directory": ["test_operation_generation_and_source_delta_guards"],
        "steps_files": ["test_operation_generation_and_source_delta_guards"],
        "steps_for_base": ["test_operation_generation_and_source_delta_guards"],
        "source_delta": ["test_operation_generation_and_source_delta_guards"],
        "source_inventory": ["test_inventory_rejects_links_and_empty_scan"],
        "admission": ["test_candidate_bind_and_admission_tampering"],
        "prepared_binding": ["test_prepared_plan_deployment_and_unknown_guards"],
        "_load_plan_with_base": ["test_prepared_plan_deployment_and_unknown_guards"],
        "_verify_active_with_base": ["test_receipt_fields_are_rejected_even_when_hashes_are_resigned"],
        "database_identity": ["test_production_runtime_identity_is_not_relaxed"],
        "install_intent": ["test_intent_publish_and_no_replay"],
        "publish_installed": ["test_intent_publish_and_no_replay"],
        "install_schema": ["test_intent_publish_and_no_replay"],
        "relative": ["test_recipe_and_proof_guards"],
        "candidate": ["test_recipe_and_proof_guards"],
        "bind": ["test_candidate_bind_and_admission_tampering"],
    }
    if function == "main":
        names = (["test_candidate_cli_fixed_paths"] if module == "candidate" else
                 ["test_complete_file_lifecycle_and_provision_failure", "test_prepared_plan_deployment_and_unknown_guards",
                  "test_production_runtime_identity_is_not_relaxed"])
    else:
        names = mapping[function]
    result = ["FileGates." + name for name in names]
    if function == "source_inventory": result.append("DirectGuards.test_empty_inventory_guard")
    if function == "admission": result.append("DirectGuards.test_admission_proof_guard")
    if function == "prepared_binding": result.append("DirectGuards.test_parent_and_prepared_guards")
    if function == "_load_plan_with_base": result.append("DirectGuards.test_plan_prepared_predecessor_guard")
    return result


def run_suite(path, selected=None):
    import runpy
    namespace = runpy.run_path(str(path), run_name="ai158_private_fixture")
    namespace["DirectGuards"] = DirectGuards
    suite = unittest.TestSuite()
    loader = unittest.defaultTestLoader
    if selected is not None:
        for case in cases_for(selected):
            class_name, method = case.split(".", 1)
            suite.addTest(namespace[class_name](method))
    else:
        for value in namespace.values():
            if isinstance(value, type) and issubclass(value, unittest.TestCase):
                suite.addTests(loader.loadTestsFromTestCase(value))
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)


def child(args):
    before = {name: sha((ROOT / "tools" / (name + ".py")).read_bytes()) for name in MODULES}
    selected = None
    if args.child != "baseline":
        selected, _ = install_mutant(ROOT, args.child)
    try:
        run_suite(args.suite, selected)
    finally:
        after = {name: sha((ROOT / "tools" / (name + ".py")).read_bytes()) for name in MODULES}
        if after != before:
            raise RuntimeError("Mutation suite changed source bytes")


def main(args):
    inventory = guards()
    if args.inventory:
        return {"status": "inventory", "guards": inventory}
    if args.child:
        child(args)
        return None
    if not args.suite or not args.suite.is_file():
        raise ValueError("An existing private fixture suite is required")
    suite = args.suite.resolve()
    before = {name: sha((ROOT / "tools" / (name + ".py")).read_bytes()) for name in MODULES}
    # Deliberately discard ambient production database/application inputs.
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith(("TERUISI", "PG", "DATABASE_"))}
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    baseline = subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()), "--child", "baseline", "--suite", str(suite)], cwd=ROOT, env=environment,
                              capture_output=True, text=True, timeout=args.timeout)
    if baseline.returncode != 0:
        raise RuntimeError("Unmodified private suite failed: " + (baseline.stdout + baseline.stderr)[-4000:])
    results = []
    for item in inventory:
        if args.only and args.only not in item["id"]:
            continue
        command = [sys.executable, "-B", str(Path(__file__).resolve()), "--child", item["id"], "--suite", str(suite)]
        result = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True,
                                text=True, timeout=args.timeout)
        output = result.stdout + result.stderr
        summary = re.search(r"FAILED \(([^)]*)\)", output)
        # A syntax/import/setup error is no evidence that a test detected a
        # removed assertion. Require an actual unittest assertion failure;
        # additional runtime errors remain visible in the original summary.
        killed = bool(result.returncode and summary and re.search(r"failures=[1-9]", summary[1])
                      and re.search(r"^FAIL: test_", output, re.MULTILINE) and "in setUp" not in output)
        results.append({**item, "killed": killed, "exitCode": result.returncode,
                        "testSummary": summary[0] if summary else None, "outputTail": output[-4000:]})
        print(json.dumps({"id": item["id"], "killed": killed}), flush=True)
    after = {name: sha((ROOT / "tools" / (name + ".py")).read_bytes()) for name in MODULES}
    if before != after:
        raise RuntimeError("Source bytes changed during the mutation run")
    report = {"status": "passed" if results and all(item["killed"] for item in results) else "incomplete",
              "method": "single-guard-in-memory-AST-disable-original-file-bytes-preserved",
              "suiteSha256": sha(suite.read_bytes()), "runnerSha256": sha(Path(__file__).read_bytes()),
              "sourceSha256Before": before, "sourceSha256After": after,
              "guards": len(inventory), "executed": len(results),
              "killed": sum(item["killed"] for item in results), "results": results}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--suite", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--only", default="")
    parser.add_argument("--child", default="")
    parser.add_argument("--timeout", type=int, default=120)
    options = parser.parse_args()
    result = main(options)
    if result is not None:
        if options.inventory:
            print(json.dumps(result, ensure_ascii=True))
        else:
            print(json.dumps({key: value for key, value in result.items() if key != "results"}, ensure_ascii=True))
        if result["status"] == "incomplete":
            sys.exit(1)
