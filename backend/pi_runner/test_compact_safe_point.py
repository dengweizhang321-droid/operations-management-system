"""Live-owner compact admission, without Docker, network or native Pi."""
from types import SimpleNamespace
import unittest
import tempfile
import threading
from pathlib import Path
from unittest.mock import Mock, patch

from .workspace import execute_control, Rejected, dispatch, init_ledger
from .server import Ledger


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

    def synthetic_session(self, folder):
        ledger = Ledger(Path(folder)/"ledger.sqlite3"); init_ledger(ledger)
        return SimpleNamespace(key="isolated", phase="idle", last_seq=1, active=None, lock=threading.RLock(),
            ui_pending={}, local_calls={}, bash_control=None, resource_installing=None, terminals={},
            workspace_version="2", bind=Mock(), fail=Mock(), queued_controls={},
            baseline_processes={"pi"}, broker=SimpleNamespace(ledger=ledger,process_inventory=Mock(return_value=["pi"])))

    def job(self, command, control_id, seq=1):
        return {"operationId":"compact-operation", "ownerId":"synthetic", "conversationId":"synthetic",
            "epoch":1,"generation":1,"seq":2,"payload":{"action":"control","controlId":control_id,
                "controlSeq":seq,"command":command,"payload":{}}}

    def test_dispatch_prebind_rejection_has_exact_original_identity(self):
        class InlineThread:
            def __init__(self, target, **kwargs): self.target=target
            def start(self): self.target()
        with tempfile.TemporaryDirectory() as folder:
            session = self.synthetic_session(folder); session.local_calls={"pending":{}}
            with patch("pi_runner.admission.check"), patch("pi_runner.workspace.activities", return_value=[]), \
                    patch("pi_runner.workspace.public_state", return_value={}), patch("pi_runner.workspace.threading.Thread", InlineThread):
                result=dispatch(session,self.job("compact","original-compact"))
            self.assertEqual(result["control"]["status"],"failed")
            self.assertEqual(result["control"]["result"]["compactPreBindRejection"],
                {"operationId":"compact-operation","seq":2,"modelBound":False,"code":"compact_unsafe_point"})
            session.bind.assert_not_called(); session.fail.assert_not_called()
            session.broker.ledger.db.close()

    def test_later_export_cannot_race_active_compact_registration(self):
        with tempfile.TemporaryDirectory() as folder:
            session=self.synthetic_session(folder)
            started=threading.Event(); release=threading.Event()
            def execute(owner, job, control_id, command, args):
                self.assertEqual(command,"compact")
                started.set(); release.wait(5)
                return {"disposition":"handled"}
            with patch("pi_runner.workspace.public_state", return_value={}), \
                    patch("pi_runner.workspace.execute_control", side_effect=execute) as effect:
                dispatch(session,self.job("compact","compact-first"))
                self.assertTrue(started.wait(2))
                exported=dispatch(session,self.job("export_html","export-later",2))
                self.assertEqual(exported["control"]["status"],"failed")
                self.assertEqual(exported["control"]["errorCode"],"compact_in_progress")
                self.assertEqual(effect.call_count,1)
                release.set()
                with session.lock: pass
            # The asynchronous control has returned before closing its ledger.
            for _ in range(100):
                if not getattr(session,"compact_control",None):break
                threading.Event().wait(.01)
            self.assertIsNone(session.compact_control)
            session.broker.ledger.db.close()
