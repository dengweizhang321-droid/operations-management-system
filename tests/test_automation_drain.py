import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from teruisi_backend.automation_drain import AdmissionClosed, PROTOCOL, protected_activity, read_gate


class DrainTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="optimization4-")
        self.runtime = Path(self.directory.name)
        (self.runtime / "run").mkdir()

    def tearDown(self):
        self.directory.cleanup()

    def gate(self, phase):
        (self.runtime / "run/automation-drain.json").write_text(json.dumps({
            "version": PROTOCOL, "id": "a" * 32, "runtimeRoot": str(self.runtime), "phase": phase,
        }), encoding="utf8")

    def exclusive_available(self, name="automation-activity.lock"):
        code = """
import os,sys
with open(sys.argv[1], 'a+b') as stream:
 try:
  if os.name == 'nt':
   import msvcrt
   msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
  else:
   import fcntl
   fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
 except OSError: sys.exit(12)
"""
        return subprocess.run([sys.executable, "-c", code, str(self.runtime / "run" / name)], check=False).returncode == 0

    def test_shared_requests_drain_across_processes(self):
        with protected_activity(self.runtime), protected_activity(self.runtime):
            self.assertFalse(self.exclusive_available())
            self.gate("requests")
            with self.assertRaises(AdmissionClosed):
                with protected_activity(self.runtime):
                    self.fail("new import admitted")
            self.assertFalse(self.exclusive_available())
        self.assertTrue(self.exclusive_available())

    def test_background_finishes_with_http_dependencies_then_closes(self):
        with protected_activity(self.runtime, background=True):
            self.gate("helpers")
            with protected_activity(self.runtime):
                self.assertFalse(self.exclusive_available("automation-background.lock"))
            with self.assertRaises(AdmissionClosed):
                with protected_activity(self.runtime, background=True):
                    self.fail("new send admitted")
        self.assertTrue(self.exclusive_available("automation-background.lock"))

    def test_exception_releases_lock_without_replay(self):
        effects = []
        with self.assertRaises(RuntimeError):
            with protected_activity(self.runtime):
                effects.append("external_attempt")
                raise RuntimeError("result unknown")
        self.assertEqual(effects, ["external_attempt"])
        self.assertTrue(self.exclusive_available())

    def test_corrupt_and_foreign_gate_fail_closed(self):
        self.gate("requests")
        path = self.runtime / "run/automation-drain.json"
        for content in ["broken", "{}", json.dumps({"version": PROTOCOL, "id": "a" * 32, "phase": "requests", "runtimeRoot": "elsewhere"})]:
            path.write_text(content)
            with self.assertRaises(AdmissionClosed):
                with protected_activity(self.runtime):
                    self.fail("invalid gate admitted")

    def test_cancel_then_resume_does_not_dispatch_itself(self):
        self.gate("requests")
        with self.assertRaises(AdmissionClosed):
            with protected_activity(self.runtime):
                self.fail("admitted")
        (self.runtime / "run/automation-drain.json").unlink()
        with protected_activity(self.runtime):
            self.assertIsNone(read_gate(self.runtime))

    def test_development_has_no_production_fallback(self):
        with patch("teruisi_backend.automation_drain.checked", side_effect=AssertionError("production access")):
            with protected_activity():
                pass

    @unittest.skipUnless(os.name == "nt", "Windows native interoperability")
    def test_powershell_exclusive_lock_waits_for_python_shared_lease(self):
        script = self.runtime / "lock.ps1"
        script.write_text('''param([string]$LockPath)
$stream=[IO.FileStream]::new($LockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
try { $stream.Lock(0,1); $stream.Unlock(0,1) } catch { exit 12 } finally { $stream.Dispose() }
''')
        def attempt():
            return subprocess.run(["powershell", "-NoProfile", "-File", str(script), "-LockPath", str(self.runtime / "run/automation-activity.lock")],
                                  creationflags=subprocess.CREATE_NO_WINDOW, check=False).returncode
        with protected_activity(self.runtime):
            self.assertEqual(attempt(), 12)
        self.assertEqual(attempt(), 0)

    def test_missed_schedule_executes_real_branch_and_records_original_slot(self):
        # Execute the real function body with a synthetic ORM, no database or
        # external sender. PostgreSQL integration remains a separate gate.
        import ast
        from contextlib import nullcontext
        from datetime import datetime, timedelta, timezone
        from types import SimpleNamespace
        source = Path(__file__).resolve().parents[1] / "backend/ai_assistant/dingtalk_schedules.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "step")
        now = datetime(2026, 9, 30, tzinfo=timezone.utc)
        original = now - timedelta(days=1)
        row = SimpleNamespace(next_run_at=original, cadence="daily", hour=9, minute=0, day=None, version=1, save=Mock())
        runs, schedules = Mock(), Mock()
        runs.select_for_update.return_value.filter.return_value.order_by.return_value.first.return_value = None
        schedules.select_for_update.return_value.filter.return_value.order_by.return_value.first.return_value = row
        env = {"mutation": nullcontext, "timezone": SimpleNamespace(now=lambda: now), "timedelta": timedelta,
               "m": SimpleNamespace(AiDingTalkScheduleRun=SimpleNamespace(objects=runs), AiDingTalkSchedule=SimpleNamespace(objects=schedules)),
               "next_slot": lambda *args: now + timedelta(days=1), "uid": lambda _: "synthetic-run"}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), env)
        sender = Mock(side_effect=AssertionError("unexpected send"))
        self.assertTrue(env["step"](lambda: {"enabled": True}, sender))
        saved = runs.get_or_create.call_args.kwargs
        self.assertEqual(saved["scheduled_at"], original)
        self.assertEqual(saved["defaults"]["status"], "denied")
        self.assertEqual(saved["defaults"]["error_code"], "missed_window")
        sender.assert_not_called()


if __name__ == "__main__":
    unittest.main()
