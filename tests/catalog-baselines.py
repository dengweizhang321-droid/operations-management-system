"""Adversarial, offline tests for the finite catalogue admission gate itself."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("catalog_baseline_checker", ROOT / "tools/check_catalog_baselines.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class CatalogueAdmission(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="teruisi-catalog-gate-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "tools").mkdir()
        for name in gate.JSON_CATALOGS + gate.OTHER_CATALOGS:
            shutil.copyfile(ROOT / "tools" / (name + ".py"), self.root / "tools" / (name + ".py"))
        for name in gate.JSON_CATALOGS:
            shutil.copyfile(ROOT / "tools" / (name + ".json"), self.root / "tools" / (name + ".json"))
        shutil.copyfile(ROOT / "tools/check_catalog_baselines.py", self.root / "tools/check_catalog_baselines.py")

    def path(self, name):
        return self.root / "tools" / name

    def document(self, name):
        return json.loads(self.path(name + ".json").read_text(encoding="utf8"))

    def write(self, name, value):
        self.path(name + ".json").write_text(json.dumps(value), encoding="utf8")

    def mutate_source(self, name, old, new):
        path = self.path(name + ".py")
        original = path.read_text(encoding="utf8")
        self.assertIn(old, original)
        path.write_text(original.replace(old, new, 1), encoding="utf8")

    def fails(self, report=None, code=None, contains=None):
        report = report if report is not None else gate.check_catalog_baselines(self.root)
        self.assertEqual(report["status"], "failed", report)
        self.assertFalse(report["databaseContacted"])
        self.assertTrue(report["diagnostics"])
        if code:
            self.assertIn(code, [d["code"] for d in report["diagnostics"]])
        if contains:
            self.assertIn(contains, json.dumps(report["diagnostics"]))
        return report

    def test_current_fixed_baselines_and_independent_raw_counts(self):
        report = gate.require_catalog_baselines(self.root)
        self.assertEqual(report["scope"], "catalog-baseline")
        self.assertEqual(report["diagnostics"], [])
        table_rows = [r for r in report["results"] if r["kind"] == "table"]
        seq_rows = [r for r in report["results"] if r["kind"] == "sequence"]
        self.assertEqual(len(table_rows), 47)  # Observation of this fixture, never an admission predicate.
        self.assertEqual(len(seq_rows), 2)
        for row in table_rows + seq_rows:
            expected = gate.TABLE_PRIVILEGES if row["kind"] == "table" else gate.SEQUENCE_PRIVILEGES
            self.assertEqual(set(row["actualOwnerPrivileges"]), expected)
            self.assertEqual(row["rawOwnerPrivilegeCounts"], dict.fromkeys(sorted(expected), 1))
        self.assertEqual(report["summary"]["ownerPrivilegeMemberships"], sum(r["ownerPrivilegeCount"] for r in table_rows + seq_rows))
        self.assertEqual(report["summary"]["rawOwnerRows"], sum(r["rawOwnerRows"] for r in table_rows + seq_rows))
        self.assertEqual(len(report["sourceFiles"]), 19)
        for path, digest in report["sourceFiles"].items():
            self.assertEqual(digest, hashlib.sha256(self.path(Path(path).name).read_bytes()).hexdigest())
        self.assertEqual({r["catalog"] for r in report["results"]},
                         {n + ".json" for n in gate.JSON_CATALOGS} | {n + ".py" for n in gate.OTHER_CATALOGS})

    def test_exact_historical_workflow_sequence_missing_select_update(self):
        fixture = json.loads((ROOT / "tests/fixtures/catalog-baselines/workflow-sequence-20261031.json").read_text())
        self.assertEqual(fixture["sourceRevision"], "03f6e474^")
        # Extracted once with git show 03f6e474^:tools/workflow_automation_catalog.json.
        # Keep the original blob/byte hash, without requiring CI's shallow checkout
        # to contain historical Git objects or a database/client dependency.
        self.assertEqual(fixture["sourceBlob"], "6518e6c169bb1781a851b2ce45908f83af3d8c86")
        self.assertEqual(fixture["sourceSha256"], "6bf7b89ecb0903b19e1197d3e0508e9a47293a0540a736963b544dd47d99faf3")
        self.assertEqual(fixture["sequence"], {"name": "public.automation_module_results_id_seq",
                         "acl": [[gate.OWNER, "S", "p", "USAGE", False, "OWNER"]]})
        name = "workflow_automation_catalog"
        value = self.document(name)
        value["sequence"] = fixture["sequence"]
        report = self.fails(gate.check_captured_catalog(self.root, name, value))
        row = next(r for r in report["results"] if r["kind"] == "sequence" and r["catalog"] == name + ".json")
        self.assertEqual(row["missingOwnerPrivileges"], ["SELECT", "UPDATE"])
        self.assertEqual(row["actualOwnerPrivileges"], ["USAGE"])
        self.assertEqual(row["rawOwnerPrivilegeCounts"], {"SELECT": 0, "UPDATE": 0, "USAGE": 1})

    def test_usage_only_tmall_candidate_cannot_pass(self):
        name = "tmall_warehouse_catalog"
        value = self.document(name)
        value["sequence"]["acl"] = [r for r in value["sequence"]["acl"] if r[3] == "USAGE"]
        report = self.fails(gate.check_captured_catalog(self.root, name + ".json", value))
        row = next(r for r in report["results"] if r["kind"] == "sequence" and r["catalog"] == name + ".json")
        self.assertEqual(row["missingOwnerPrivileges"], ["SELECT", "UPDATE"])

    def test_old_uppercase_s_sql_fails_despite_good_json(self):
        for name in gate.SEQUENCES:
            with self.subTest(name=name):
                path = self.path(name + ".py")
                original = path.read_text(encoding="utf8")
                self.mutate_source(name, "acldefault('s',c.relowner)", "acldefault('S',c.relowner)")
                self.fails(code="collection-contract", contains="requires acldefault('s'")
                path.write_text(original, encoding="utf8")

    def test_correct_unused_sql_decoy_does_not_mask_bad_execute(self):
        name = "workflow_automation_catalog"
        self.mutate_source(name, "acldefault('s',c.relowner)", "acldefault('S',c.relowner)")
        with self.path(name + ".py").open("a", encoding="utf8") as stream:
            stream.write('\nUNUSED_CORRECT_SQL = "SELECT acldefault(\'s\',c.relowner)"\n')
        self.fails(contains="requires acldefault('s'")

    def test_table_query_requires_r_in_actual_inspector(self):
        self.mutate_source("pi_agent_catalog", "acldefault('r',c.relowner)", "acldefault('s',c.relowner)")
        self.fails(contains="requires acldefault('r'")

    def test_table_collector_empty_loop_and_disconnected_return_are_rejected(self):
        name = "tmall_warehouse_catalog"
        path = self.path(name + ".py")
        original = path.read_text(encoding="utf8")
        self.mutate_source(name, "for table in TABLES:", "for table in ():")
        self.fails(contains="table loop target/iterator differs")
        path.write_text(original, encoding="utf8")
        self.mutate_source(name, "return result", "return {}")
        self.fails(contains="collector return bypasses")

    def test_unknown_sql_and_second_acl_query_fail_closed(self):
        name = "tmall_warehouse_catalog"
        original = self.path(name + ".py").read_text(encoding="utf8")
        self.mutate_source(name, 'cursor.execute("SELECT pg_get_serial_sequence', 'cursor.execute(SQL_PREFIX + "SELECT pg_get_serial_sequence')
        self.fails(contains="nonliteral cursor.execute")
        self.path(name + ".py").write_text(original.replace('return {"name": sequence, "acl": cursor.fetchall()}',
            'cursor.execute("SELECT aclexplode(c.relacl),acldefault(\'s\',c.relowner) FROM pg_class c")\n    return {"name": sequence, "acl": cursor.fetchall()}'), encoding="utf8")
        self.fails(contains="missing/ambiguous")

    def test_serial_lookup_must_match_inventory(self):
        self.mutate_source("tmall_warehouse_catalog", "'public.inventory_tmall_warehouse_facts','id'", "'public.inventory_tmall_warehouse_batches','id'")
        self.fails(contains="serial lookup differs")

    def test_json_duplicate_key_is_rejected_before_decode_overwrites(self):
        name = "pi_workspace_catalog"
        text = self.path(name + ".json").read_text(encoding="utf8")
        self.path(name + ".json").write_text(text.replace('"identity":', '"acl": [], "identity":', 1), encoding="utf8")
        self.fails(code="json-format", contains="duplicate JSON key")

    def test_duplicate_rows_cannot_pad_missing_privileges(self):
        name = "workflow_automation_catalog"
        value = self.document(name)
        usage = next(r for r in value["sequence"]["acl"] if r[3] == "USAGE")
        value["sequence"]["acl"] = [usage, usage, usage]
        self.write(name, value)
        self.fails(contains="duplicate ACL row")

    def test_non_owner_cannot_fill_missing_owner_privileges(self):
        name = "workflow_automation_catalog"
        value = self.document(name)
        for row in value["sequence"]["acl"]:
            if row[3] in {"SELECT", "UPDATE"}:
                row[5] = "teruisi_workflow_writer"
        self.write(name, value)
        self.fails(contains="['SELECT', 'UPDATE']")

    def test_missing_table_and_missing_sequence_are_mandatory(self):
        name = "workflow_automation_catalog"
        original = self.document(name)
        for key in ("sequence", "automation_modules"):
            with self.subTest(key=key):
                value = copy.deepcopy(original)
                del value[key]
                self.write(name, value)
                self.fails(code="table-membership")

    def test_extra_identity_and_nextval_forms_are_explicit_failures(self):
        name = "workflow_automation_catalog"
        original = self.document(name)
        for default, identity in ((None, "d"), ("nextval(('other_seq'::text)::regclass)", ""), ("nextval('public.other_seq'::regclass)", "")):
            with self.subTest(default=default, identity=identity):
                value = copy.deepcopy(original)
                column = value["automation_modules"]["columns"][0]
                column[3], column[5] = default, identity
                self.write(name, value)
                self.fails(code="sequence-inventory")

    def test_unregistered_sequence_on_catalogue_without_sequence_fails(self):
        name = "pi_workspace_catalog"
        value = self.document(name)
        table = next(iter(value))
        value[table]["columns"][0][5] = "d"
        self.write(name, value)
        self.fails(contains="inventory differs")

    def test_required_format_and_identity_constraints(self):
        name = "workflow_automation_catalog"
        original = self.document(name)
        table = "automation_attempts"
        variants = [
            lambda v: v[table].pop("acl"),
            lambda v: v[table].__setitem__("acl", None),
            lambda v: v[table]["identity"].__setitem__(0, "another_owner"),
            lambda v: v[table]["acl"][0].__setitem__(0, ""),
            lambda v: v[table]["acl"][0].__setitem__(2, True),
            lambda v: v[table]["acl"][0].__setitem__(2, 0),
            lambda v: v[table]["acl"][0].__setitem__(1, "USAGE"),
            lambda v: v[table]["acl"].append(v[table]["acl"][0][:]),
            lambda v: v["sequence"]["acl"][0].__setitem__(1, "s"),
            lambda v: v["sequence"]["acl"][0].__setitem__(0, "another_owner"),
            lambda v: v["sequence"].__setitem__("name", "public.wrong_id_seq"),
            lambda v: v[table].__setitem__("columns", []),
        ]
        for i, mutation in enumerate(variants):
            with self.subTest(variant=i):
                value = copy.deepcopy(original)
                mutation(value)
                self.write(name, value)
                self.fails()

    def test_invalid_json_top_level_and_nonfinite_constant_fail(self):
        name = "pi_agent_catalog"
        for text in ("[]", "null", "{}", "{bad", '{"value": NaN}'):
            with self.subTest(text=text):
                self.path(name + ".json").write_text(text, encoding="utf8")
                self.fails()

    def test_registry_membership_not_total_count_is_the_gate(self):
        self.path("pi_agent_catalog.json").rename(self.path("unknown_catalog.json"))
        self.fails(contains="unregistered")

    def test_unknown_python_catalogue_and_missing_registered_python_fail(self):
        self.path("new_unknown_catalog.py").write_text("TABLES = ()\n", encoding="utf8")
        self.fails(contains="unregistered")
        self.path("new_unknown_catalog.py").unlink()
        self.path("jd_logistics_catalog.py").unlink()
        self.fails(contains="missing=")

    def test_finite_tables_generator_import_alias_and_unknown_shape(self):
        name = "jd_monitor_preferences_catalog"
        self.mutate_source(name, "from jd_logistics_catalog import TABLES, inspect_tables",
                           "from jd_logistics_catalog import TABLES as parent_tables, inspect_tables\nTABLES = parent_tables")
        self.assertEqual(gate.require_catalog_baselines(self.root)["status"], "passed")
        self.mutate_source("pi_workspace_catalog", 'TABLES = ("ai_pi_controls", "ai_pi_ui_requests", "ai_pi_workspaces")',
                           'TABLES = tuple(compute_tables())')
        self.fails(contains="unsupported finite string sequence AST")

    def test_literal_reference_owner_set_is_checked(self):
        self.mutate_source("ai_schedule_addition_catalog", "['OWNER', 'MAINTAIN', False],", "['some_writer', 'MAINTAIN', False],")
        self.fails(contains="['MAINTAIN']")

    def test_literal_identity_flags_require_boolean_not_integer_zero(self):
        self.mutate_source("ai_schedule_addition_catalog", "['teruisi_sales_owner', 'r', 'p', False, False]",
                           "['teruisi_sales_owner', 'r', 'p', 0, 0]")
        self.fails(code="literal-catalogue", contains="literal owner/identity differs")

    def test_pi_owner_literal_missing_privilege_is_not_totalled_away(self):
        name = "pi_business_catalog"
        self.mutate_source(name, '("DELETE","INSERT","MAINTAIN","REFERENCES","SELECT","TRIGGER","TRUNCATE","UPDATE")',
                           '("DELETE","INSERT","REFERENCES","SELECT","TRIGGER","TRUNCATE","UPDATE")')
        report = self.fails(contains="['MAINTAIN']")
        rows = [r for r in report["results"] if r["catalog"] == name + ".py"]
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r["missingOwnerPrivileges"] == ["MAINTAIN"] for r in rows))

    def test_unused_correct_owner_and_wrong_final_expected_are_rejected(self):
        for name, old, new in (
            ("pi_business_catalog", 'wanted_acl = owner |', 'wanted_acl = set() |'),
            ("pi_native_catalog", 'expected_acl = owner |', 'expected_acl = set() |'),
            ("pi_business_catalog", 'if actual_acl != (wanted_acl if permissions else owner):', 'if actual_acl != owner:'),
            ("pi_native_catalog", 'if set(cursor.fetchall()) != expected_acl:', 'if set(cursor.fetchall()) != owner:'),
        ):
            with self.subTest(name=name, old=old):
                path = self.path(name + ".py")
                original = path.read_text(encoding="utf8")
                self.mutate_source(name, old, new)
                self.fails(code="derived-catalogue")
                path.write_text(original, encoding="utf8")

    def test_owner_reassignment_and_identity_bypass_are_rejected(self):
        self.mutate_source("pi_native_catalog", 'expected_acl = owner |', 'owner = set()\n        expected_acl = owner |')
        self.fails(contains="owner assignment missing/reassigned")
        self.mutate_source("pi_business_catalog", '("teruisi_sales_owner", "r", "p", False, False)', '("wrong_owner", "r", "p", False, False)')
        self.fails(contains="owner/identity rejection")

    def test_pi_acl_loop_cannot_iterate_an_empty_or_unrelated_source(self):
        for name, old in (("pi_business_catalog", "for table, definition in definitions().items():"),
                          ("pi_native_catalog", "for table, model in models.items():")):
            with self.subTest(name=name):
                path = self.path(name + ".py")
                original = path.read_text(encoding="utf8")
                self.mutate_source(name, old, old.split(" in ")[0] + " in {}.items():")
                self.fails(code="derived-catalogue", contains="table loop target/iterator differs")
                path.write_text(original, encoding="utf8")

    def test_pi_early_return_cannot_bypass_a_correct_acl_literal(self):
        self.mutate_source("pi_business_catalog", 'for table, definition in definitions().items():',
                           'return\n    for table, definition in definitions().items():')
        self.fails(contains="unknown return")

    def test_inheritance_and_not_applicable_are_explicit(self):
        report = gate.require_catalog_baselines(self.root)
        inherited = [r for r in report["results"] if r["kind"] == "inherited-table"]
        self.assertEqual(len(inherited), 8)
        self.assertTrue(all(r["inherits"] == "jd_monitor_preferences_catalog.json" for r in inherited))
        for name in ("jackyun_audit_catalog.py", "sales_preflight_catalog.py"):
            rows = [r for r in report["results"] if r["catalog"] == name]
            self.assertTrue(rows)
            self.assertTrue(all(r["status"] == "not-applicable" and r["reason"] for r in rows))
        self.mutate_source("jd_product_monitoring_catalog", 'reference[TABLE]["columns"].append', 'reference[TABLE]["acl"].append')
        self.fails(contains="unknown inherited catalogue projection")

    def test_capture_preflight_defers_only_registered_json_payload(self):
        name = "workflow_automation_catalog"
        good = self.document(name)
        self.path(name + ".json").unlink()
        self.fails()  # Ordinary admission has no skip.
        report = gate.require_catalog_baselines(self.root, capture_target=name)
        self.assertEqual(report["scope"], "capture-preflight")
        self.assertEqual(report["deferredCatalogs"], [name + ".json"])
        self.assertFalse(any(r["kind"] == "sequence" and r["catalog"] == name + ".json" for r in report["results"]))
        checked = gate.require_catalog_baselines(self.root, replacement={name: good})
        self.assertEqual(checked["scope"], "catalog-baseline")
        self.assertEqual(checked["deferredCatalogs"], [])
        self.mutate_source(name, "acldefault('s',c.relowner)", "acldefault('S',c.relowner)")
        self.fails(gate.check_catalog_baselines(self.root, capture_target=name), code="collection-contract")

    def test_capture_can_replace_corrupt_target_but_other_ancestors_stay_required(self):
        name = "jd_monitor_preferences_catalog"
        good = self.document(name)
        self.path(name + ".json").write_text("corrupt", encoding="utf8")
        self.assertEqual(gate.require_catalog_baselines(self.root, capture_target=name)["scope"], "capture-preflight")
        self.assertEqual(gate.require_catalog_baselines(self.root, replacement=(name, good))["scope"], "catalog-baseline")
        self.path("jd_logistics_catalog.json").write_text("corrupt", encoding="utf8")
        self.fails(gate.check_catalog_baselines(self.root, capture_target=name), code="json-format")

    def test_invalid_capture_options_fail_closed(self):
        for kwargs in ({"capture_target": "unknown_catalog"}, {"capture_target": "../pi_agent_catalog"},
                       {"capture_target": "pi_business_catalog"},
                       {"replacement": {}}, {"replacement": {"pi_agent_catalog": {}, "pi_workspace_catalog": {}}},
                       {"capture_target": "pi_agent_catalog", "replacement": {"pi_agent_catalog": {}}}):
            with self.subTest(kwargs=kwargs):
                self.fails(gate.check_catalog_baselines(self.root, **kwargs))

    def test_source_is_read_only_and_project_modules_never_imported(self):
        def snapshot():
            return {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in self.root.rglob("*") if p.is_file()}
        before = snapshot()
        original_import = __import__
        def guarded_import(name, *args, **kwargs):
            if name.startswith(("psycopg", "django", "ai_assistant", "postgres_restore_semantics")) or name.endswith("_catalog"):
                raise AssertionError("project/database module imported: " + name)
            return original_import(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=guarded_import), patch("socket.socket.connect", side_effect=AssertionError("network contacted")):
            gate.require_catalog_baselines(self.root)
        self.assertEqual(snapshot(), before)
        self.assertFalse(list(self.root.rglob("__pycache__")))

    def test_require_error_and_cli_exit_match_full_report(self):
        def cli(*args):
            completed = subprocess.run([sys.executable, "-B", str(ROOT / "tools/check_catalog_baselines.py"), "--root", str(self.root), *args], capture_output=True, text=True)
            self.assertEqual(completed.stderr, "")
            self.assertEqual(len(completed.stdout.splitlines()), 1)
            return completed, json.loads(completed.stdout)
        completed, full = cli()
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(full, gate.check_catalog_baselines(self.root))
        completed, compact = cli("--compact")
        self.assertEqual(completed.returncode, 0)
        self.assertLess(len(completed.stdout), 4096)
        self.assertEqual(compact, gate.compact_report(full))
        value = self.document("workflow_automation_catalog")
        value["sequence"]["acl"] = [r for r in value["sequence"]["acl"] if r[3] == "USAGE"]
        self.write("workflow_automation_catalog", value)
        with self.assertRaisesRegex(ValueError, "catalogue baseline admission failed"):
            gate.require_catalog_baselines(self.root)
        completed, full = cli()
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(full["status"], "failed")
        completed, compact = cli("--compact")
        self.assertEqual(completed.returncode, 1)
        self.assertLess(len(completed.stdout), 4096)
        self.assertEqual(compact, gate.compact_report(full))


if __name__ == "__main__":
    unittest.main(verbosity=2)
