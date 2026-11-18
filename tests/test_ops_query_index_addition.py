"""Source-only checks for the OpsQueryIndex 162 generation; no database, no runtime, no PostgreSQL binary.

The PostgreSQL side (CREATE INDEX, catalogue comparison) is only exercised through a
scripted cursor here. Real PostgreSQL behaviour needs the separate isolated rehearsal.
"""
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import ops_query_index_addition as gate
import ops_query_index_catalog as catalog


class ScriptedCursor:
    """Answers the two statements verify_indexes issues, from a fixed catalogue."""

    def __init__(self, rows):
        self.rows, self.last = rows, None

    def execute(self, statement, params=None):
        self.statement, self.params = statement, params
        if "to_regclass(%s),to_regclass(%s),to_regclass(%s)" in statement:
            self.last = tuple(("public." + n) if n in self.rows else None for n in self.params_names(params))
        else:
            self.last = self.rows.get(params[0].split(".", 1)[1])

    @staticmethod
    def params_names(params):
        return [p.split(".", 1)[1] for p in params]

    def fetchone(self):
        return self.last


def good_rows():
    return {
        "sales_cs_online_spec_idx": ("sales_order_lines", "i", "p", "teruisi_sales_owner", "btree", False, True, True, 1, 1,
                                     "(is_business_row AND (NOT (online_spec_code = ''::text)))", None,
                                     ["online_spec_code"], ["text_ops"]),
        "net_projection_page_idx": ("netshop_rows", "i", "p", "teruisi_sales_owner", "btree", False, True, True, 2, 2,
                                    "((dataset)::text = ANY ((ARRAY['sku_daily'::character varying, "
                                    "'spu_daily'::character varying])::text[]))", None,
                                    ["source", "source_row_key"], ["text_ops", "text_ops"]),
        "cs_conv_ai_analyzed_idx": ("customer_service_conversations", "i", "p", "teruisi_sales_owner", "btree", False, True, True, 1, 1,
                                    "((analysis_source)::text = 'ai'::text)", None, ["analyzed_at"], ["timestamptz_ops"]),
    }


class CatalogTests(unittest.TestCase):
    def test_step_files_are_the_three_reviewed_migrations(self):
        migrations = gate.common.migrations(ROOT)
        self.assertEqual(set(gate.FILES), set(catalog.FILES))
        for name, expected in gate.FILES.items():
            self.assertEqual(migrations[name], expected, name)
        self.assertEqual([s.split(".")[0] for s in gate.STEPS], ["sales", "netshop", "customer_service"])
        for step, name in zip(gate.STEPS, gate.FILES):
            app, migration = step.split(".", 1)
            self.assertEqual(name, "backend/%s/migrations/%s.py" % (app, migration))

    def test_code_files_exist_and_include_every_new_input(self):
        for name in gate.CODE_FILES:
            self.assertTrue((ROOT / name).is_file(), name)
        for name in ("tools/ops_query_index_addition.py", "tools/ops_query_index_catalog.py",
                     "tools/ops_query_index_candidate.py", "backend/sales/models.py",
                     "backend/netshop/models.py", "backend/customer_service/models.py", *gate.FILES):
            self.assertIn(name, gate.CODE_FILES)

    def test_parent_generations_are_exact(self):
        self.assertEqual(gate.steps_files(159), (gate.STEPS, gate.FILES))
        for bad in (158, 160, 162, "159", True):
            with self.assertRaises(ValueError):
                gate.steps_files(bad)
        with self.assertRaises(ValueError):
            gate.steps_for_base(set(range(158)))
        with self.assertRaises(ValueError):
            gate.steps_for_base(set(range(158)) | set(gate.STEPS) | {"x"})
        self.assertEqual(gate.steps_for_base({str(i) for i in range(159)}), gate.STEPS)

    def test_predicate_renderings_are_equivalent_and_closed(self):
        n = catalog.normalize_predicate
        accepted = catalog.INDEXES["sales_cs_online_spec_idx"][5]
        self.assertIn(n("(is_business_row AND (NOT (online_spec_code = ''::text)))"), accepted)
        self.assertIn(n("(is_business_row AND (online_spec_code <> ''::text))"), accepted)
        self.assertNotIn(n("(is_business_row)"), accepted)
        self.assertNotIn(n("(online_spec_code <> ''::text)"), accepted)
        self.assertEqual(n("((dataset)::text = ANY ((ARRAY['sku_daily'::character varying, 'spu_daily'::character varying])::text[]))"),
                         n("((dataset)::text = ANY (ARRAY['sku_daily'::text, 'spu_daily'::text]))"))
        self.assertNotEqual(n("((dataset)::text = ANY (ARRAY['sku_daily'::text]))"),
                            n("((dataset)::text = ANY (ARRAY['sku_daily'::text, 'spu_daily'::text]))"))

    def test_verify_indexes_accepts_exact_and_rejects_every_deviation(self):
        catalog.verify_indexes(ScriptedCursor({}), installed=False)
        catalog.verify_indexes(ScriptedCursor(good_rows()), installed=True)
        with self.assertRaises(ValueError):
            catalog.verify_indexes(ScriptedCursor(good_rows()), installed=False)
        with self.assertRaises(ValueError):
            catalog.verify_indexes(ScriptedCursor({}), installed=True)
        partial = good_rows(); partial.pop("net_projection_page_idx")
        for installed in (True, False):
            with self.assertRaises(ValueError):
                catalog.verify_indexes(ScriptedCursor(partial), installed=installed)
        edits = {
            "table": (0, "other_table"), "unique": (5, True), "invalid": (6, False), "not ready": (7, False),
            "key count": (8, 2), "method": (4, "hash"), "owner": (3, "postgres"), "persistence": (2, "u"),
            "expression": (11, "lower(x)"), "predicate": (10, "(is_business_row)"),
            "columns": (12, ["online_spec_code", "extra"]), "opclass": (13, ["varchar_pattern_ops"]),
        }
        for label, (index, value) in edits.items():
            rows = good_rows()
            row = list(rows["sales_cs_online_spec_idx"]); row[index] = value
            rows["sales_cs_online_spec_idx"] = tuple(row)
            with self.assertRaises(ValueError, msg=label):
                catalog.verify_indexes(ScriptedCursor(rows), installed=True)

    def test_source_delta_requires_exactly_the_three_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            baseline = Path(tmp) / "baseline"
            for path in (ROOT / "backend").glob("*/migrations/*.py"):
                relative = path.relative_to(ROOT).as_posix()
                if relative in gate.FILES:
                    continue
                target = baseline / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
            self.assertEqual(len(gate.common.migrations(baseline)) + 3, len(gate.common.migrations(ROOT)))
            self.assertEqual(gate.source_delta(ROOT, baseline), gate.common.digest(gate.common.migrations(ROOT)))
            # A baseline that already contains one step, or lacks an unrelated migration, is refused.
            first = sorted(gate.FILES)[0]
            shutil.copyfile(ROOT / first, baseline / first)
            with self.assertRaises(ValueError):
                gate.source_delta(ROOT, baseline)
            (baseline / first).unlink()
            victim = baseline / "backend/sales/migrations/0001_initial.py"
            victim.write_bytes(victim.read_bytes() + b"\n# drift\n")
            with self.assertRaises(ValueError):
                gate.source_delta(ROOT, baseline)

    def _roots(self, tmp):
        """A baseline without the three steps, and a root that is the real repository migrations."""
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

    def test_source_delta_five_exact_cases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, baseline = self._roots(tmp)
            # 5. exactly the three reviewed files: accepted.
            self.assertEqual(gate.source_delta(root, baseline), gate.common.digest(gate.common.migrations(root)))
            # 1. one extra migration in an unrelated app: refused.
            extra = root / "backend/inventory/migrations/0099_unreviewed.py"
            extra.write_text("# extra\n", encoding="utf8")
            with self.assertRaises(ValueError):
                gate.source_delta(root, baseline)
            extra.unlink()
            # 2. one of the three missing from root: refused (each in turn).
            for name in gate.FILES:
                saved = (root / name).read_bytes()
                (root / name).unlink()
                with self.assertRaises(ValueError, msg=name):
                    gate.source_delta(root, baseline)
                (root / name).write_bytes(saved)
            # 3. a migration already in the baseline is rewritten in root: refused.
            victim = root / "backend/sales/migrations/0001_initial.py"
            saved = victim.read_bytes()
            victim.write_bytes(saved + b"\n# rewritten\n")
            with self.assertRaises(ValueError):
                gate.source_delta(root, baseline)
            victim.write_bytes(saved)
            # 4. any of the three differs from its FILES digest: refused (each in turn).
            for name in gate.FILES:
                saved = (root / name).read_bytes()
                (root / name).write_bytes(saved + b"\n# changed\n")
                with self.assertRaises(ValueError, msg=name):
                    gate.source_delta(root, baseline)
                (root / name).write_bytes(saved)
            self.assertEqual(gate.source_delta(root, baseline), gate.common.digest(gate.common.migrations(root)))


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

    def test_committed_result_passes_and_is_bound_to_the_real_migrations(self):
        self.assertEqual(self.original["migrationSha256"], gate.common.digest(gate.common.migrations(ROOT)))
        gate.verify_rehearsal_evidence(self.root, self.put(self.original))

    def test_each_tamper_is_refused(self):
        cases = {
            "migrationSha256": lambda v: v.__setitem__("migrationSha256", "0" * 64),
            "dropped check": lambda v: v["checks"].pop(),
            "productionTouched": lambda v: v.__setitem__("productionTouched", True),
            "predicate rendering": lambda v: v["renderedIndexes"][2].update(predicate="(is_business_row)", normalized="is_business_row"),
            "normalized lies": lambda v: v["renderedIndexes"][0].__setitem__("normalized", "x"),
            "opclass": lambda v: v["renderedIndexes"][1].__setitem__("opclasses", ["varchar_pattern_ops", "text_ops"]),
            "status": lambda v: v.__setitem__("status", "failed"),
            "cleanup": lambda v: v["cleanup"].__setitem__("stopped", False),
            "plan without index": lambda v: v["plans"].__setitem__("customer-service-ai-count", "Seq Scan on customer_service_conversations"),
            "extra check": lambda v: v["checks"].append("something-else"),
            "renamed check": lambda v: v["checks"].__setitem__(0, "something-else"),
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
                      for p in (ROOT / folder).rglob("*.py") if "verify_rehearsal_evidence" in p.read_text(encoding="utf8", errors="ignore"))
        self.assertEqual(hits, ["docs/ops-query-index-20261118/run-mandatory-checks.py", "tools/check_schema_code_digest.py",
                                "tools/ops_query_index_addition.py"])
        import ast
        tree = ast.parse((ROOT / "tools/ops_query_index_addition.py").read_text(encoding="utf8"))
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
            for step in gate.STEPS:
                self.assertEqual([type(op).__name__ for op in loader.disk_migrations[tuple(step.split(".", 1))].operations], ["AddIndex"])
            # The state check is not vacuous: a wrong condition is refused.
            model = state.apps.get_model("customer_service", "CustomerServiceConversation")
            index = next(i for i in model._meta.indexes if i.name == "cs_conv_ai_analyzed_idx")
            from django.db import models
            index.condition = models.Q(analysis_source="manual")
            with self.assertRaises(ValueError):
                catalog.verify_defaults(state.apps)


def _installed_apps():
    import ast
    tree = ast.parse((ROOT / "backend/teruisi_backend/settings.py").read_bytes())
    return next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == "INSTALLED_APPS" for t in n.targets))


if __name__ == "__main__":
    unittest.main()
