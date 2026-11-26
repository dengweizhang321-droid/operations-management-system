"""Source-only checks for the SalesSubdivisionEdits 163 generation; no database, no runtime, no PostgreSQL binary.

The PostgreSQL side (table DDL, real ACL and sequence privileges) is only exercised through a scripted
cursor here. Real PostgreSQL behaviour needs the separate isolated rehearsal.
"""
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import sales_subdivision_edits_addition as gate
import sales_subdivision_edits_catalog as catalog

ALL = frozenset(catalog.OWNER_PRIVILEGES)
USAGE = frozenset({"USAGE", "SELECT", "UPDATE"})


class ScriptedCursor:
    """Answers verify_tables' statements from a fixed catalogue; any other statement is a failure."""

    def __init__(self, tables=None, acl=None, sequence_acl=None, sequence="public.sales_subdivision_labels_id_seq", mutate=None):
        self.tables = list(catalog.TABLES if tables is None else tables)
        self.acl = acl
        self.sequence_acl = sequence_acl
        self.sequence = sequence
        self.mutate = mutate or {}
        self.rows = []
        self.table = None

    def execute(self, statement, params=None):
        self.params = params
        if "FROM pg_class c JOIN pg_namespace n" in statement:
            self.rows = [(name,) for name in self.tables]
            return
        if "pg_get_serial_sequence" in statement:
            self.rows = [(self.sequence,)]
            return
        target = params[0] if params else None
        table = target.split(".", 1)[1] if isinstance(target, str) and target.startswith("public.") else None
        if table is not None:
            self.table = table
        if "pg_get_userbyid(relowner),relkind" in statement:
            self.rows = [self.mutate.get("identity", (catalog.OWNER, "r", "p", False, False, False))]
        elif "format_type(a.atttypid" in statement:
            self.rows = [tuple(row) for row in self.mutate.get("columns", catalog.COLUMNS[table])]
        elif "FROM pg_constraint" in statement:
            self.rows = self.mutate.get("constraints", [(*row, True, False, False) for row in catalog.CONSTRAINTS[table]])
        elif "FROM pg_index i" in statement:
            self.rows = self.mutate.get("indexes", [(n, u, m, c, o, True, True, None, None) for n, u, m, c, o in catalog.INDEXES[table]])
        elif "FROM pg_trigger" in statement or "FROM pg_policy" in statement or "attacl IS NOT NULL" in statement:
            self.rows = [(self.mutate.get(statement.split("FROM ")[1].split()[0], 0),)]
        elif "acldefault('s'" in statement:
            self.rows = self._acl_rows(self.sequence_acl)
        elif "acldefault('r'" in statement:
            self.rows = self._acl_rows(self.acl[table])
        else:
            raise AssertionError("Unexpected statement: " + statement[:80])

    @staticmethod
    def _acl_rows(acl):
        return [(role, privilege, False) for role, privileges in acl.items() for privilege in sorted(privileges)]

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0]


def owner_only():
    return {table: {"OWNER": ALL} for table in catalog.TABLES}, {"OWNER": USAGE}


def provisioned():
    acl = {table: {"OWNER": ALL, **grants} for table, grants in catalog.GRANTS.items()}
    return acl, {"OWNER": USAGE, **catalog.SEQUENCE_GRANTS}


class CatalogTests(unittest.TestCase):
    def test_step_file_is_the_reviewed_migration(self):
        migrations = gate.common.migrations(ROOT)
        self.assertEqual(set(gate.FILES), set(catalog.FILES))
        for name, expected in gate.FILES.items():
            self.assertEqual(migrations[name], expected, name)
        self.assertEqual(gate.STEPS, ("sales.0014_product_subdivision_edits",))
        for step, name in zip(gate.STEPS, gate.FILES):
            app, migration = step.split(".", 1)
            self.assertEqual(name, "backend/%s/migrations/%s.py" % (app, migration))

    def test_code_files_exist_and_include_every_new_input(self):
        for name in gate.CODE_FILES:
            self.assertTrue((ROOT / name).is_file(), name)
        for name in ("tools/sales_subdivision_edits_addition.py", "tools/sales_subdivision_edits_catalog.py",
                     "tools/sales_subdivision_edits_candidate.py", "backend/sales/models.py",
                     "backend/sales/analysis_options_permissions.py", *gate.FILES):
            self.assertIn(name, gate.CODE_FILES)

    def test_parent_generations_are_exact(self):
        self.assertEqual(gate.steps_files(162), (gate.STEPS, gate.FILES))
        for bad in (159, 161, 163, "162", True):
            with self.assertRaises(ValueError):
                gate.steps_files(bad)
        with self.assertRaises(ValueError):
            gate.steps_for_base(set(range(161)))
        with self.assertRaises(ValueError):
            gate.steps_for_base(set(range(161)) | set(gate.STEPS) | {"x"})
        self.assertEqual(gate.steps_for_base({str(i) for i in range(162)}), gate.STEPS)

    def test_verify_tables_accepts_each_exact_state_and_nothing_else(self):
        for permissions, state in ((False, owner_only()), (True, provisioned()), ("either", owner_only()), ("either", provisioned())):
            catalog.verify_tables(ScriptedCursor(acl=state[0], sequence_acl=state[1]), installed=True, permissions=permissions)
        owner, owner_seq = owner_only()
        grants, grants_seq = provisioned()
        for permissions, state in ((True, (owner, owner_seq)), (False, (grants, grants_seq))):
            with self.assertRaises(ValueError):
                catalog.verify_tables(ScriptedCursor(acl=state[0], sequence_acl=state[1]), installed=True, permissions=permissions)
        catalog.verify_tables(ScriptedCursor(tables=[]), installed=False)

    def test_presence_is_all_or_nothing(self):
        acl, seq = owner_only()
        with self.assertRaises(ValueError):
            catalog.verify_tables(ScriptedCursor(acl=acl, sequence_acl=seq), installed=False)
        with self.assertRaises(ValueError):
            catalog.verify_tables(ScriptedCursor(tables=[]), installed=True)
        with self.assertRaises(ValueError):
            catalog.verify_tables(ScriptedCursor(tables=[catalog.TABLES[0]], acl=acl, sequence_acl=seq), installed=True)

    def test_every_acl_deviation_is_refused(self):
        def run(edit_tables=None, edit_sequence=None):
            acl, seq = provisioned()
            acl = {t: {r: set(p) for r, p in g.items()} for t, g in acl.items()}
            seq = {r: set(p) for r, p in seq.items()}
            if edit_tables:
                edit_tables(acl)
            if edit_sequence:
                edit_sequence(seq)
            catalog.verify_tables(ScriptedCursor(acl=acl, sequence_acl=seq), installed=True, permissions=True)
        run()
        cases = {
            "writer deletes labels": lambda a: a["sales_subdivision_labels"][catalog.WRITER].add("DELETE"),
            "reader writes overrides": lambda a: a["sales_product_subdivision_overrides"][catalog.READER].add("INSERT"),
            "writer loses delete on overrides": lambda a: a["sales_product_subdivision_overrides"][catalog.WRITER].discard("DELETE"),
            "reader loses select": lambda a: a["sales_subdivision_labels"].pop(catalog.READER),
            "public select": lambda a: a["sales_subdivision_labels"].__setitem__("PUBLIC", {"SELECT"}),
            "foreign role": lambda a: a["sales_subdivision_labels"].__setitem__("teruisi_ai_reader", {"SELECT"}),
            "owner truncated": lambda a: a["sales_subdivision_labels"]["OWNER"].discard("TRUNCATE"),
        }
        for label, edit in cases.items():
            with self.assertRaises(ValueError, msg=label):
                run(edit_tables=edit)
        for label, edit in {
            "writer loses sequence": lambda s: s.pop(catalog.WRITER),
            "reader on sequence": lambda s: s.__setitem__(catalog.READER, {"USAGE"}),
        }.items():
            with self.assertRaises(ValueError, msg=label):
                run(edit_sequence=edit)

    def test_shape_deviations_are_refused(self):
        acl, seq = provisioned()
        base_columns = list(catalog.COLUMNS["sales_product_subdivision_overrides"])
        edits = {
            "owner": {"identity": ("postgres", "r", "p", False, False, False)},
            "unlogged": {"identity": (catalog.OWNER, "r", "u", False, False, False)},
            "rls": {"identity": (catalog.OWNER, "r", "p", True, False, False)},
            "extra column": {"columns": [*[tuple(r) for r in base_columns], ("x", "text", True, None, "", "")]},
            "nullable column": {"columns": [("product_code", "text", False, None, "", ""), *[tuple(r) for r in base_columns[1:]]]},
            "default added": {"columns": [*[tuple(r) for r in base_columns[:-1]], ("updated_by", "text", True, "''::text", "", "")]},
            "constraint not valid": {"constraints": [("sales_product_subdivision_overrides_pkey", "p", "PRIMARY KEY (product_code)", False, False, False)]},
            "extra constraint": {"constraints": [("sales_product_subdivision_overrides_pkey", "p", "PRIMARY KEY (product_code)", True, False, False),
                                                 ("x", "c", "CHECK (true)", True, False, False)]},
            "trigger": {"pg_trigger": 1}, "policy": {"pg_policy": 1}, "column acl": {"pg_attribute": 1},
        }
        for label, mutate in edits.items():
            with self.assertRaises(ValueError, msg=label):
                catalog.verify_tables(ScriptedCursor(acl=acl, sequence_acl=seq, mutate=mutate), installed=True, permissions=True)
        with self.assertRaises(ValueError):
            catalog.verify_tables(ScriptedCursor(acl=acl, sequence_acl=seq, sequence="public.other_seq"), installed=True, permissions=True)

    def test_source_delta_requires_exactly_the_one_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, baseline = self._roots(tmp)
            self.assertEqual(len(gate.common.migrations(baseline)) + 1, len(gate.common.migrations(root)))
            self.assertEqual(gate.source_delta(root, baseline), gate.common.digest(gate.common.migrations(root)))
            extra = root / "backend/inventory/migrations/0099_unreviewed.py"
            extra.write_text("# extra\n", encoding="utf8")
            with self.assertRaises(ValueError):
                gate.source_delta(root, baseline)
            extra.unlink()
            name = next(iter(gate.FILES))
            saved = (root / name).read_bytes()
            (root / name).unlink()
            with self.assertRaises(ValueError):
                gate.source_delta(root, baseline)
            (root / name).write_bytes(saved + b"\n# changed\n")
            with self.assertRaises(ValueError):
                gate.source_delta(root, baseline)
            (root / name).write_bytes(saved)
            victim = root / "backend/sales/migrations/0001_initial.py"
            victim.write_bytes(victim.read_bytes() + b"\n# rewritten\n")
            with self.assertRaises(ValueError):
                gate.source_delta(root, baseline)
            victim.write_bytes(victim.read_bytes()[: -len(b"\n# rewritten\n")])
            shutil.copyfile(root / name, baseline / name)
            with self.assertRaises(ValueError):
                gate.source_delta(root, baseline)

    def _roots(self, tmp):
        baseline, root = Path(tmp) / "baseline", Path(tmp) / "root"
        for path in (ROOT / "backend").glob("*/migrations/*.py"):
            relative = path.relative_to(ROOT).as_posix()
            for base in (root, baseline):
                if base is baseline and relative in gate.FILES:
                    continue
                target = base / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
        return root, baseline


class RehearsalEvidenceTests(unittest.TestCase):
    """verify_rehearsal_evidence on a temporary root; each tamper is rehashed so only its own rule can refuse it."""

    def setUp(self):
        import json
        self.json = json
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for path in (ROOT / "backend").glob("*/migrations/*.py"):
            target = self.root / path.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        self.file = self.root / gate.REHEARSAL_PATH
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.original = json.loads((ROOT / gate.REHEARSAL_PATH).read_text(encoding="utf8"))

    def put(self, value):
        self.file.write_text(self.json.dumps(value, indent=2) + "\n", encoding="utf8", newline="\n")
        return {"rehearsalEvidence": {"path": gate.REHEARSAL_PATH, "sha256": gate.common.sha(self.file)}}

    def tampered(self, edit):
        value = self.json.loads(self.json.dumps(self.original))
        edit(value)
        return self.put(value)

    def test_committed_result_passes_and_is_bound_to_the_real_sources(self):
        self.assertEqual(self.original["migrationSha256"], gate.common.digest(gate.common.migrations(ROOT)))
        self.assertEqual(self.original["catalogSha256"], gate.catalog_digest())
        gate.verify_rehearsal_evidence(self.root, self.put(self.original))

    def test_each_tamper_is_refused(self):
        cases = {
            "migrationSha256": lambda v: v.__setitem__("migrationSha256", "0" * 64),
            "catalogSha256": lambda v: v.__setitem__("catalogSha256", "0" * 64),
            "dropped check": lambda v: v["checks"].pop(),
            "productionTouched": lambda v: v.__setitem__("productionTouched", True),
            "status": lambda v: v.__setitem__("status", "failed"),
            "cleanup": lambda v: v["cleanup"].__setitem__("stopped", False),
            "extra check": lambda v: v["checks"].append("something-else"),
            "renamed check": lambda v: v["checks"].__setitem__(0, "something-else"),
            "wrong generations": lambda v: v.__setitem__("generations", [159, 162]),
            "wrong database": lambda v: v["database"].__setitem__("name", "teruisi_sales"),
            "production port": lambda v: v["database"].__setitem__("port", 5432),
        }
        for label, edit in cases.items():
            with self.assertRaises(ValueError, msg=label):
                gate.verify_rehearsal_evidence(self.root, self.tampered(edit))

    def test_binding_and_migration_drift_are_refused(self):
        ref = self.put(self.original)
        with self.assertRaises(ValueError):
            gate.verify_rehearsal_evidence(self.root, {})
        with self.assertRaises(ValueError):
            gate.verify_rehearsal_evidence(self.root, {"rehearsalEvidence": {**ref["rehearsalEvidence"], "sha256": "1" * 64}})
        changed = self.root / sorted(gate.FILES)[0]
        changed.write_bytes(changed.read_bytes() + b"\n# drift\n")
        with self.assertRaises(ValueError):
            gate.verify_rehearsal_evidence(self.root, ref)

    def test_only_the_merge_time_digest_gate_calls_it(self):
        hits = sorted(str(p.relative_to(ROOT)).replace("\\", "/") for folder in ("tools", "backend", "docs")
                      for p in (ROOT / folder).rglob("*.py")
                      if "sales_subdivision_edits" in p.read_text(encoding="utf8", errors="ignore")
                      and "verify_rehearsal_evidence" in p.read_text(encoding="utf8", errors="ignore"))
        self.assertEqual(hits, ["docs/subdivision-category-edit-20261126/run-mandatory-checks.py",
                                "tools/check_schema_code_digest.py", "tools/sales_subdivision_edits_addition.py"])
        import ast
        tree = ast.parse((ROOT / "tools/sales_subdivision_edits_addition.py").read_text(encoding="utf8"))
        admission = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "admission")
        self.assertNotIn("verify_rehearsal_evidence", ast.unparse(admission))
        for ps in ("tools/django-local-service.ps1", "tools/bi-app-adopt.ps1", "tools/publish-prepared-main.mjs", "tools/integration_release_gate.py"):
            self.assertNotIn("verify_rehearsal_evidence", (ROOT / ps).read_text(encoding="utf-8-sig"))


class MigrationStateTests(unittest.TestCase):
    def test_models_match_migrations_and_state_definitions_are_exact(self):
        sys.path.insert(0, str(ROOT / "backend"))
        from django.conf import settings
        if not settings.configured:
            settings.configure(INSTALLED_APPS=_installed_apps(),
                               DATABASES={"default": {"ENGINE": "django.db.backends.dummy"}},
                               DEFAULT_AUTO_FIELD="django.db.models.BigAutoField", USE_TZ=True, SECRET_KEY="private-source-graph")
        from django.db.backends.base.base import BaseDatabaseWrapper
        from unittest.mock import patch

        def no_connection(*unused, **kwargs):
            raise AssertionError("Database connection forbidden in source checks")
        with patch.object(BaseDatabaseWrapper, "ensure_connection", no_connection):
            import django
            django.setup()
            from django.apps import apps
            from django.db.migrations.autodetector import MigrationAutodetector
            from django.db.migrations.loader import MigrationLoader
            from django.db.migrations.state import ProjectState
            loader = MigrationLoader(None)
            state = loader.project_state(loader.graph.leaf_nodes())
            catalog.verify_defaults(state.apps)
            self.assertFalse(MigrationAutodetector(loader.project_state(), ProjectState.from_apps(apps)).changes(graph=loader.graph))
            operations = [type(op).__name__ for op in loader.disk_migrations[("sales", "0014_product_subdivision_edits")].operations]
            self.assertEqual(operations, ["CreateModel", "CreateModel"])
            # The state check is not vacuous: a wrong unique constraint is refused.
            model = state.apps.get_model("sales", "SalesSubdivisionLabel")
            model._meta.constraints = []
            with self.assertRaises(ValueError):
                catalog.verify_defaults(state.apps)


def _installed_apps():
    import ast
    tree = ast.parse((ROOT / "backend/teruisi_backend/settings.py").read_bytes())
    return next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == "INSTALLED_APPS" for t in n.targets))


if __name__ == "__main__":
    unittest.main()
