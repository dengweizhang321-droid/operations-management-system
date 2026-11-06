"""Live-owner compact admission, without Docker, network or native Pi."""
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from .workspace import execute_control, Rejected


class CompactSafePointTests(unittest.TestCase):
    def test_live_writers_and_local_tools_block_before_model_bind(self):
        for field, value in [("ui_pending", {"question": {}}), ("local_calls", {"tool": {}}),
                ("bash_control", "bash"), ("resource_installing", "install"),
                ("terminals", {"t": SimpleNamespace(status="running")})]:
            with self.subTest(field=field):
                session = SimpleNamespace(phase="idle", last_seq=1, ui_pending={}, local_calls={},
                    bash_control=None, resource_installing=None, terminals={}, workspace_version="2", bind=Mock())
                setattr(session, field, value)
                with patch("pi_runner.admission.check"), patch("pi_runner.workspace.activities", return_value=[]):
                    with self.assertRaises(Rejected) as caught:
                        execute_control(session, {"seq": 2}, "compact-control", "compact", {})
                self.assertEqual(str(caught.exception), "workspace_busy" if field == "resource_installing" else "compact_unsafe_point")
                session.bind.assert_not_called()

    def test_background_child_blocks_before_binding_model(self):
        session = SimpleNamespace(phase="idle", last_seq=1, ui_pending={}, local_calls={},
            bash_control=None, resource_installing=None, terminals={}, workspace_version="2", bind=Mock(),
            baseline_processes={"pi-baseline"}, broker=SimpleNamespace(process_inventory=Mock(return_value=["pi-baseline", "child-writer"])))
        with patch("pi_runner.admission.check"), patch("pi_runner.workspace.activities", return_value=[]):
            with self.assertRaises(Rejected) as caught:
                execute_control(session, {"seq": 2}, "compact-control", "compact", {})
        self.assertEqual(str(caught.exception), "compact_background_writers")
        session.bind.assert_not_called()
