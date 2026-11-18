"""Checks of the rehearsal script's non-PostgreSQL parts. Never starts PostgreSQL or touches a database."""
import ast
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import ops_query_index_rehearsal as rehearsal


class RehearsalGuardTests(unittest.TestCase):
    def test_source_isolation_rejects_production_checkout_and_runtime(self):
        for forbidden in ("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf", "D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf/sub/dir",
                          "D:/teruisi-runtime", "D:/teruisi-runtime/django-sales/app"):
            with self.assertRaises(RuntimeError, msg=forbidden):
                rehearsal.assert_isolated_source(forbidden)
        rehearsal.assert_isolated_source("D:/codex-worktrees/ops-index-gen160-20261118")

    def test_private_identity_is_hard_coded(self):
        good = {"HOST": "127.0.0.1", "PORT": "55532", "NAME": rehearsal.DATABASE, "USER": rehearsal.FIXTURE_USER}
        rehearsal.assert_private_identity(good)
        for key, bad in (("HOST", "localhost"), ("PORT", "5432"), ("PORT", "55531"), ("PORT", "55542"),
                         ("NAME", "teruisi_sales"), ("USER", "teruisi_sales_owner")):
            with self.assertRaises(RuntimeError, msg=key + bad):
                rehearsal.assert_private_identity({**good, key: bad})

    def test_write_paths_and_ports_are_hard_rejected(self):
        for bad in ("D:/teruisi-runtime/django-sales/postgres-data", "D:/teruisi-runtime/x", "D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf/tmp",
                    "D:/codex-worktrees/ops-index-gen160-20261118/.codex-tmp/x", "E:/anything/postgres-data/q"):
            with self.assertRaises(RuntimeError, msg=bad):
                rehearsal.assert_private_path(bad)
        import tempfile
        rehearsal.assert_private_path(tempfile.gettempdir())
        for port in (5432, 5433, 55531, 55542, 0):
            with self.assertRaises(RuntimeError, msg=str(port)):
                rehearsal.assert_private_port(port)
        for port in rehearsal.PORTS:
            rehearsal.assert_private_port(port)

    def test_production_port_never_in_rehearsal_range(self):
        self.assertNotIn(5432, rehearsal.PORTS)
        self.assertTrue(all(55440 <= port <= 55999 for port in rehearsal.PORTS))

    def test_plan_assertion_requires_the_named_index(self):
        self.assertTrue(rehearsal.assert_plan_uses("Index Scan using net_projection_page_idx on netshop_rows", "net_projection_page_idx"))
        for text in ("Seq Scan on netshop_rows", "Index Scan using net_source_date_idx on netshop_rows"):
            with self.assertRaises(RuntimeError):
                rehearsal.assert_plan_uses(text, "net_projection_page_idx")

    def test_every_query_maps_to_a_catalog_index_and_checks_are_complete(self):
        import ops_query_index_catalog as catalog
        self.assertEqual(set(rehearsal.INDEX_FOR_QUERY.values()), set(catalog.INDEXES))
        self.assertEqual(len(rehearsal.CHECKS), 7)

    def test_launch_refuses_the_production_checkout(self):
        with patch.object(rehearsal, "ROOT", Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf")), \
                patch.object(rehearsal.subprocess, "run", side_effect=AssertionError("must not execute anything")):
            with self.assertRaises(RuntimeError):
                rehearsal.assert_isolated_source(rehearsal.ROOT)

    def test_no_production_connection_or_runtime_write_in_source(self):
        tree = ast.parse((ROOT / "tools/ops_query_index_rehearsal.py").read_text(encoding="utf8"))
        literals = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        self.assertFalse({"teruisi_sales", "teruisi_sales_writer"} & literals)
        self.assertFalse(any("5432" in v and "55" not in v for v in literals))


class SyntheticDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import os
        sys.path.insert(0, str(ROOT / "backend"))
        os.environ.setdefault("TERUISI_DJANGO_SQLITE_PATH", str(Path(__file__).resolve().parent / "zz-never-created.sqlite3"))
        # Importing the models needs only the app registry, never a connection.
        from django.conf import settings
        if not settings.configured:
            tree = ast.parse((ROOT / "backend/teruisi_backend/settings.py").read_bytes())
            apps = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                        and any(getattr(t, "id", None) == "INSTALLED_APPS" for t in n.targets))
            settings.configure(INSTALLED_APPS=apps, DATABASES={"default": {"ENGINE": "django.db.backends.dummy"}},
                               DEFAULT_AUTO_FIELD="django.db.models.BigAutoField", USE_TZ=True, SECRET_KEY="private")
        import django
        django.setup()

    def test_synthetic_rows_instantiate_for_all_three_models(self):
        from django.apps import apps
        for app, name in (("sales", "SalesOrderLine"), ("netshop", "NetshopRow"), ("customer_service", "CustomerServiceConversation")):
            model = apps.get_model(app, name)
            values = rehearsal.synthetic_values(model)
            model(**values)
            for field in model._meta.concrete_fields:
                if not field.primary_key and not field.null:
                    self.assertIsNotNone(values[field.name], name + "." + field.name)

    def test_parent156_targets_hold_back_exactly_the_three_steps(self):
        from django.db.migrations.loader import MigrationLoader
        import ops_query_index_catalog as catalog
        graph = MigrationLoader(None).graph
        targets, expected = rehearsal.parent156_targets(graph)
        self.assertEqual(len(expected), 156)
        for step in catalog.STEPS:
            self.assertNotIn(step, expected)
        self.assertIn("sales.0012_excluded_business_date_index", expected)

    def test_script_parses_and_child_only_runs_behind_the_flag(self):
        compile((ROOT / "tools/ops_query_index_rehearsal.py").read_bytes(), "rehearsal", "exec")
        source = (ROOT / "tools/ops_query_index_rehearsal.py").read_text(encoding="utf8")
        self.assertIn('child() if "--child" in sys.argv else launch()', source)


if __name__ == "__main__":
    unittest.main()
