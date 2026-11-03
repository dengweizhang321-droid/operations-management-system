"""Isolated scheduler checks; all message transport is a local fake."""
import copy
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
sys.path.insert(0, str(ROOT / "tools"))
import n8n_schedule_watch as watch
import n8n_schedule_watch_incidents as incidents
import n8n_schedule_watch_task as task

spec = importlib.util.spec_from_file_location("original_watch_tests", Path(__file__).with_name("test_n8n_schedule_watch.py"))
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)


def report(day=3, reasons=None, healthy=False):
    findings = [] if healthy else [{"workflowId": "daily", "code": "schedule_not_ready",
        "reasons": reasons or ["missing_execution"], "payload": {"version": 2, "kind": "schedule_watch",
        "workflowId": "daily", "code": "schedule_not_ready", "anchorEpoch": 1793635800, "executionId": ""}}]
    return {"status": "healthy" if healthy else "anomalies", "readOnly": True,
            "observationCoverage": {"schedule_not_ready": ["daily"], "error_workflow_missing": [], "error_workflow_failed": []},
            "checkedAt": f"2026-11-{day:02}T12:17:00Z", "findings": findings}


class ContinuousTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "state"

    def call(self, value, execute=True):
        args = ["--continuous-incidents", "--state-root", str(self.root)]
        if execute:
            args.append("--execute")
        with patch.object(watch, "inspect", return_value=copy.deepcopy(value)), patch("builtins.print"):
            return watch.main(args)

    @unittest.skipUnless(shutil.which("pwsh"), "PowerShell 7 required")
    def test_cross_day_dedup_and_recovered_recurrence_use_original_sender(self):
        sender = original.SenderTests()
        sender.setUp()
        self.addCleanup(sender.doCleanups)
        def send(payload, **kwargs):
            code, result = sender.call(payload, execute=True)
            return {**result, "exitCode": code}
        with patch.object(watch, "alert", side_effect=send):
            self.assertEqual(self.call(report()), 1)
            self.assertEqual(self.call(report(4)), 1)
            self.assertEqual((sender.root / "send.txt").read_text().count("sent"), 1)
            self.assertEqual(self.call(report(4, healthy=True)), 0)
            self.assertEqual(self.call(report(4)), 1)
            self.assertEqual((sender.root / "send.txt").read_text().count("sent"), 2)

    @unittest.skipUnless(shutil.which("pwsh"), "PowerShell 7 required")
    def test_unknown_stays_unknown_next_day_no_send_replay(self):
        sender = original.SenderTests()
        sender.setUp()
        self.addCleanup(sender.doCleanups)
        (sender.root / "unknown").touch()
        def send(payload, **kwargs):
            code, result = sender.call(payload, execute=True)
            return {**result, "exitCode": code}
        with patch.object(watch, "alert", side_effect=send):
            self.assertEqual(self.call(report()), 2)
            self.assertEqual(self.call(report(4)), 2)
            self.assertEqual((sender.root / "send.txt").read_text().count("sent"), 1)

    def test_state_reserved_before_sender_crash_and_corruption_fails_closed(self):
        seen = []
        def send(payload, **kwargs):
            seen.append(payload["anchorEpoch"])
            self.assertTrue(incidents.read_state(self.root)["active"])
            raise subprocess.TimeoutExpired("fake", 1)
        with patch.object(watch, "alert", side_effect=send):
            self.assertEqual(self.call(report()), 2)
            self.assertEqual(self.call(report(4)), 2)
        self.assertEqual(seen[0], seen[1])
        (self.root / "schedule-watch-incidents.json").write_text("broken")
        with patch.object(watch, "alert") as send:
            self.assertEqual(self.call(report(4)), 2)
            send.assert_not_called()

    def test_incomplete_inspection_and_lock_busy_do_not_clear_or_send(self):
        with patch.object(watch, "alert", return_value={"status": "sent", "exitCode": 0}):
            self.call(report())
        before = (self.root / "schedule-watch-incidents.json").read_bytes()
        with patch.object(watch, "inspect", side_effect=watch.InspectionUnavailable()), patch.object(watch, "alert") as send, patch("builtins.print"):
            self.assertEqual(watch.main(["--execute", "--continuous-incidents", "--state-root", str(self.root)]), 2)
            send.assert_not_called()
        with incidents.observation_lock(self.root), patch.object(watch, "alert") as send:
            self.assertEqual(self.call(report(healthy=True)), 2)
            send.assert_not_called()
        self.assertEqual((self.root / "schedule-watch-incidents.json").read_bytes(), before)

    def test_dry_run_writes_nothing_and_reason_changes_allocate_new_anchor(self):
        with patch.object(watch, "alert", return_value={"status": "local_preview", "exitCode": 0}):
            self.assertEqual(self.call(report(), execute=False), 1)
        self.assertFalse(self.root.exists())
        first = report()
        state = incidents.bind_observations(first, incidents.read_state(self.root))
        changed = report(reasons=["inactive", "missing_execution"])
        incidents.bind_observations(changed, state)
        self.assertGreater(changed["findings"][0]["payload"]["anchorEpoch"], first["findings"][0]["payload"]["anchorEpoch"])

    def test_runner_failed_attempt_replaces_old_success_and_never_retries(self):
        self.root.mkdir()
        incidents.atomic_json(self.root / "schedule-watch-latest.json", {"status": "completed", "exitCode": 0})
        def timeout(*args, **kwargs):
            running = json.loads((self.root / "schedule-watch-latest.json").read_text())
            self.assertEqual(running["status"], "running")
            self.assertIsNone(running["finishedAt"])
            raise subprocess.TimeoutExpired("fake", 1)
        with patch.object(task.subprocess, "run", side_effect=timeout) as run:
            self.assertEqual(task.run(self.root, execute=True), 2)
            run.assert_called_once()
        latest = json.loads((self.root / "schedule-watch-latest.json").read_text())
        self.assertEqual(latest["status"], "unconfirmed")
        self.assertEqual(latest["exitCode"], 2)
        self.assertTrue(latest["finishedAt"])

    def test_removed_catalog_workflow_does_not_fabricate_recovery(self):
        first = report()
        state = incidents.bind_observations(first, incidents.read_state(self.root))
        removed = report(4, healthy=True)
        removed["observationCoverage"]["schedule_not_ready"] = []
        retained = incidents.bind_observations(removed, state)
        self.assertEqual(retained, state)
        returns = report(5)
        incidents.bind_observations(returns, retained)
        self.assertEqual(first["findings"][0]["payload"]["anchorEpoch"], returns["findings"][0]["payload"]["anchorEpoch"])

    def test_execute_locks_before_reading_snapshot_not_only_before_commit(self):
        def inspect(*args, **kwargs):
            with self.assertRaises(OSError):
                with incidents.observation_lock(self.root):
                    self.fail("inspection started without exclusive observation ownership")
            return report()
        with patch.object(watch, "inspect", side_effect=inspect), patch.object(watch, "alert", return_value={"status": "sent", "exitCode": 0}), patch("builtins.print"):
            self.assertEqual(watch.main(["--execute", "--continuous-incidents", "--state-root", str(self.root)]), 1)


if __name__ == "__main__":
    unittest.main()
