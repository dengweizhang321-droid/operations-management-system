"""Checks of the 163 rehearsal script's non-PostgreSQL parts. Never starts PostgreSQL or touches a database."""
import ast
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import sales_subdivision_edits_rehearsal as rehearsal


class RehearsalGuardTests(unittest.TestCase):
    def test_private_identity_is_hard_coded(self):
        good = {"HOST": "127.0.0.1", "PORT": "55542", "NAME": rehearsal.DATABASE, "USER": rehearsal.FIXTURE_USER}
        rehearsal.assert_private_identity(good)
        for key, bad in (("HOST", "localhost"), ("PORT", "5432"), ("PORT", "55532"), ("PORT", "55552"),
                         ("NAME", "teruisi_sales"), ("USER", "teruisi_sales_owner")):
            with self.assertRaises(RuntimeError, msg=key + bad):
                rehearsal.assert_private_identity({**good, key: bad})

    def test_ports_never_include_production_or_the_other_rehearsal_range(self):
        for port in (5432, 5433, 55532, 55541, 55552, 0):
            with self.assertRaises(RuntimeError, msg=str(port)):
                rehearsal.assert_private_port(port)
        for port in rehearsal.PORTS:
            rehearsal.assert_private_port(port)
        self.assertNotIn(5432, rehearsal.PORTS)
        self.assertEqual((rehearsal.PORTS.start, rehearsal.PORTS.stop), (55542, 55552))

    def test_write_paths_are_hard_rejected(self):
        for bad in ("D:/teruisi-runtime/django-sales/postgres-data", "D:/teruisi-runtime/x", "D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf/tmp"):
            with self.assertRaises(RuntimeError, msg=bad):
                rehearsal.parent_rehearsal.assert_private_path(bad)
        rehearsal.parent_rehearsal.assert_private_path(tempfile.gettempdir())

    def test_launch_refuses_the_production_checkout(self):
        production = Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf")
        with patch.object(rehearsal.parent_rehearsal, "ROOT", production), \
                patch.object(rehearsal.parent_rehearsal.subprocess, "run", side_effect=AssertionError("must not execute anything")):
            with self.assertRaises(RuntimeError):
                rehearsal.parent_rehearsal.assert_isolated_source(production)

    def test_check_set_matches_the_gate_and_roles_cover_reader_and_writer(self):
        import sales_subdivision_edits_addition as gate
        self.assertEqual(rehearsal.CHECKS, gate.REHEARSAL_CHECKS)
        self.assertEqual(rehearsal.VERSION, gate.REHEARSAL_VERSION)
        self.assertEqual(str(rehearsal.RESULT.relative_to(ROOT)).replace("\\", "/"), gate.REHEARSAL_PATH)
        self.assertIn("teruisi_sales_reader", rehearsal.ROLES)
        self.assertIn("teruisi_sales_writer", rehearsal.ROLES)

    def test_no_production_connection_or_runtime_write_in_source(self):
        tree = ast.parse((ROOT / "tools/sales_subdivision_edits_rehearsal.py").read_text(encoding="utf8"))
        literals = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        self.assertFalse({"teruisi_sales", "teruisi_sales_owner:"} & literals)
        self.assertFalse(any("5432" in v and "55" not in v for v in literals))

    def test_script_parses_and_child_only_runs_behind_the_flag(self):
        source = (ROOT / "tools/sales_subdivision_edits_rehearsal.py").read_text(encoding="utf8")
        compile(source.encode("utf8"), "rehearsal", "exec")
        self.assertIn('child() if "--child" in sys.argv else launch()', source)


if __name__ == "__main__":
    unittest.main()
