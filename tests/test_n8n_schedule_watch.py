import base64
import hashlib
import importlib.util
import json
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("schedule_watch", ROOT / "tools/n8n_schedule_watch.py")
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / "n8n.sqlite"
        self.catalog = self.root / "catalog.json"
        self.catalog.write_text(json.dumps({"rules": [{"workflowId": "daily", "timezone": "Asia/Shanghai",
                                                      "schedules": ["10 0 * * *"]}]}), encoding="utf-8")
        with closing(sqlite3.connect(self.db)) as db:
            db.executescript('''
                CREATE TABLE workflow_entity(id TEXT PRIMARY KEY,active INTEGER,activeVersionId TEXT,settings TEXT,isArchived INTEGER);
                CREATE TABLE execution_entity(id INTEGER PRIMARY KEY,workflowId TEXT,status TEXT,mode TEXT,
                    startedAt TEXT,stoppedAt TEXT,createdAt TEXT,deletedAt TEXT);
                INSERT INTO workflow_entity VALUES ('daily',1,'v1','{"errorWorkflow":"TeruisiHourlyRetry2026"}',0);
                INSERT INTO workflow_entity VALUES ('TeruisiHourlyRetry2026',1,'v2','{}',0);
            ''')
            db.commit()

    def execute(self, sql, values=()):
        with closing(sqlite3.connect(self.db)) as db:
            db.execute(sql, values)
            db.commit()

    def run_at(self, now="2026-11-02T16:16:00Z", **kwargs):
        return watch.inspect(self.db, self.catalog, now=now, **kwargs)

    def run_record(self, start, mode="trigger", status="success", workflow="daily", stop=None, deleted=None, execution_id=None):
        self.execute('''INSERT INTO execution_entity(id,workflowId,status,mode,startedAt,stoppedAt,createdAt,deletedAt)
                        VALUES (?,?,?,?,?,?,?,?)''', (execution_id, workflow, status, mode, start, stop, start, deleted))

    def codes(self, report, workflow="daily"):
        return {f["code"] for f in report["findings"] if f["workflowId"] == workflow}

    def reasons(self, report):
        return next(r["reasons"] for r in report["scheduled"] if r["workflowId"] == "daily")

    def test_utc_previous_date_is_shanghai_today(self):
        self.run_record("2026-11-02 16:10:00.500")
        report = self.run_at()
        self.assertEqual(report["scheduled"][0]["periodStartLocal"], watch.instant("2026-11-03T00:10:00+08:00").astimezone().isoformat())
        self.assertNotIn("missing_execution", self.reasons(report))

    def test_before_today_schedule_keeps_previous_window(self):
        self.run_record("2026-11-01T16:10:00Z")
        for now in ("2026-11-02T15:59:59Z", "2026-11-02T16:00:00Z", "2026-11-02T16:09:59Z"):
            with self.subTest(now=now):
                self.assertNotIn("missing_execution", self.reasons(self.run_at(now)))
        self.assertIn("missing_execution", self.reasons(self.run_at("2026-11-02T16:10:00Z")))

    def test_midnight_schedule_and_offsets(self):
        self.catalog.write_text(json.dumps({"rules": [{"workflowId": "daily", "timezone": "Asia/Shanghai",
                                                      "schedules": ["0 0 * * *"]}]}), encoding="utf-8")
        self.run_record("2026-11-03T00:00:00+08:00")
        self.assertNotIn("missing_execution", self.reasons(self.run_at("2026-11-02T16:00:00Z")))

    def test_deleted_future_and_early_runs_do_not_mask_missing_execution(self):
        self.run_record("2026-11-02T16:10:00Z", deleted="2026-11-02T16:11:00Z")
        self.run_record("2026-11-02T16:20:00Z")
        self.run_record("2026-11-02T16:09:59.999Z")
        self.assertIn("missing_execution", self.reasons(self.run_at()))
        self.run_record("2026-11-02T16:10:00Z", status="error")
        self.assertNotIn("missing_execution", self.reasons(self.run_at()))

    def test_existence_check_counts_manual_webhook_and_running_without_claiming_success(self):
        for mode in ("manual", "webhook", "trigger"):
            with self.subTest(mode=mode):
                self.execute("DELETE FROM execution_entity")
                self.run_record("2026-11-02T16:10:00Z", mode=mode, status="running")
                self.assertNotIn("missing_execution", self.reasons(self.run_at()))

    def test_multiple_daily_schedules_do_not_use_morning_run_for_evening(self):
        self.catalog.write_text(json.dumps({"rules": [{"workflowId": "daily", "timezone": "Asia/Shanghai",
                                                      "schedules": ["10 0 * * *", "10 12 * * *"]}]}), encoding="utf-8")
        self.run_record("2026-11-02T16:10:00Z")
        self.assertIn("missing_execution", self.reasons(self.run_at("2026-11-03T04:16:00Z")))

    def test_three_schedule_requirements_are_independent(self):
        self.execute("UPDATE workflow_entity SET active=0,activeVersionId='' WHERE id='daily'")
        self.assertEqual(set(self.reasons(self.run_at())), {"inactive", "unpublished", "missing_execution"})
        self.run_record("2026-11-02T16:10:00Z")
        self.assertEqual(set(self.reasons(self.run_at())), {"inactive", "unpublished"})
        self.execute("DELETE FROM workflow_entity WHERE id='daily'")
        self.assertIn("workflow_missing", self.reasons(self.run_at()))

    def test_active_missing_error_binding_excludes_shared_error_flow(self):
        report = self.run_at()
        self.assertNotIn("error_workflow_missing", self.codes(report, watch.RETRY_WORKFLOW))
        self.execute("INSERT INTO workflow_entity VALUES ('other_active',1,'v3','{}',0)")
        self.assertIn("error_workflow_missing", self.codes(self.run_at(), "other_active"))
        self.execute("UPDATE workflow_entity SET active=0 WHERE id='other_active'")
        self.assertNotIn("error_workflow_missing", self.codes(self.run_at(), "other_active"))

    def test_error_last_24h_uses_finish_in_utc_and_excludes_future_deleted(self):
        self.run_record("2026-10-30T00:00:00Z", workflow=watch.RETRY_WORKFLOW, status="error", stop="2026-11-01T16:15:59Z")
        self.run_record("2026-11-02T16:17:00Z", workflow=watch.RETRY_WORKFLOW, status="error")
        self.run_record("2026-11-02T16:10:00Z", workflow=watch.RETRY_WORKFLOW, status="error", deleted="2026-11-02T16:11:00Z")
        self.assertNotIn("error_workflow_failed", self.codes(self.run_at(), watch.RETRY_WORKFLOW))
        self.run_record("2026-10-30T00:00:00Z", workflow=watch.RETRY_WORKFLOW, status="error", stop="2026-11-01T16:16:00Z")
        found = [f for f in self.run_at()["findings"] if f["code"] == "error_workflow_failed"]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["failedAt"], "2026-11-01T16:16:00Z")

    def test_unknown_cron_fails_visibly_not_healthy(self):
        self.catalog.write_text(json.dumps({"rules": [{"workflowId": "daily", "timezone": "Asia/Shanghai",
                                                      "schedules": ["0 0 * * MON"]}]}), encoding="utf-8")
        with self.assertRaises(watch.InspectionUnavailable):
            self.run_at()

    def test_check3_aggregates_zero_one_three_and_latest_by_failure_time(self):
        def third(report):
            return [f for f in report["findings"] if f["check"] == 3]
        baseline = self.run_at()
        self.assertEqual(third(baseline), [])
        self.run_record("2026-11-02T02:06:35.288Z", workflow=watch.RETRY_WORKFLOW, status="error", execution_id=11078)
        one = third(self.run_at())
        self.assertEqual(len(one), 1)
        self.assertEqual(one[0]["payload"]["failureCount"], 1)
        self.assertEqual(one[0]["payload"]["executionId"], "11078")
        message = watch.alert(one[0]["payload"])["message"]
        self.assertIn("发生 1 次失败", message)
        self.assertIn("11078", message)
        self.run_record("2026-11-02T03:00:42.369Z", workflow=watch.RETRY_WORKFLOW, status="error", execution_id=11082)
        self.run_record("2026-11-02T02:31:15.839Z", workflow=watch.RETRY_WORKFLOW, status="error", execution_id=11080)
        report = self.run_at()
        three = third(report)
        self.assertEqual(len(three), 1)
        self.assertEqual(three[0]["failureCount"], 3)
        self.assertEqual(three[0]["payload"]["executionId"], "11082")
        message = watch.alert(three[0]["payload"])["message"]
        self.assertIn("3 次", message)
        self.assertIn("11082", message)
        self.assertEqual([f for f in report["findings"] if f["check"] < 3], baseline["findings"])
        # A higher ID with an earlier failure is not the latest failure.
        self.run_record("2026-11-02T01:00:00Z", workflow=watch.RETRY_WORKFLOW, status="error", execution_id=11090)
        self.assertEqual(third(self.run_at())[0]["payload"]["executionId"], "11082")

    def test_check3_hour_anchor_stable_with_rolling_query_and_changes_next_hour(self):
        self.run_record("2026-11-02T03:00:00Z", workflow=watch.RETRY_WORKFLOW, status="error")
        first = next(f for f in self.run_at()["findings"] if f["check"] == 3)
        same = next(f for f in self.run_at("2026-11-02T16:59:59Z")["findings"] if f["check"] == 3)
        next_hour = next(f for f in self.run_at("2026-11-02T17:00:00Z")["findings"] if f["check"] == 3)
        self.assertEqual(first["payload"]["anchorEpoch"], same["payload"]["anchorEpoch"])
        self.assertEqual(next_hour["payload"]["anchorEpoch"] - first["payload"]["anchorEpoch"], 3600)

    def test_check3_error_limit_still_fails_closed(self):
        for i in range(3):
            self.run_record("2026-11-02T03:00:00Z", workflow=watch.RETRY_WORKFLOW, status="error")
        with patch.object(watch, "MAX_ERRORS", 2):
            with self.assertRaisesRegex(watch.InspectionUnavailable, "error_limit_exceeded"):
                self.run_at()

    def test_catalog_all_current_schedules_supported(self):
        for rule in watch.load_rules(watch.CATALOG):
            self.assertEqual(rule["timezone"], "local")
            watch.schedule_start(rule, watch.instant("2026-11-02T16:16:00Z"))

    def test_readonly_query_only_and_no_file_creation(self):
        before = hashlib.sha256(self.db.read_bytes()).hexdigest()
        connection = watch.open_metadata(self.db)
        try:
            self.assertEqual(connection.execute("PRAGMA query_only").fetchone()[0], 1)
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("DELETE FROM workflow_entity")
        finally:
            connection.rollback()
            connection.close()
        self.run_at()
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(), before)
        missing = self.root / "does-not-exist.sqlite"
        with self.assertRaises(watch.InspectionUnavailable):
            watch.inspect(missing, self.catalog)
        self.assertFalse(missing.exists())

    def test_reader_rolls_back_and_never_reads_execution_data(self):
        connections = []
        original = sqlite3.connect

        class Tracked(sqlite3.Connection):
            rolled_back = False
            statements = []

            def execute(self, sql, *args):
                self.statements.append(sql)
                return super().execute(sql, *args)

            def rollback(self):
                self.rolled_back = True
                return super().rollback()

        def connect(*args, **kwargs):
            self.assertTrue(args[0].endswith("?mode=ro"))
            self.assertTrue(kwargs["uri"])
            result = original(*args, factory=Tracked, **kwargs)
            connections.append(result)
            return result

        with patch.object(watch.sqlite3, "connect", connect):
            self.run_at()
        self.assertTrue(connections[0].rolled_back)
        self.assertFalse(any("execution_data" in sql for sql in connections[0].statements))

    def test_bad_settings_and_missing_tables_are_unavailable(self):
        self.execute("UPDATE workflow_entity SET settings='not json' WHERE id='daily'")
        with self.assertRaises(ValueError):
            self.run_at()
        self.execute("DROP TABLE execution_entity")
        with self.assertRaises(sqlite3.Error):
            self.run_at()

    def test_notify_uses_pwsh_existing_sender_and_opt_in(self):
        report = self.run_at()
        report["findings"] = report["findings"][:1]
        with patch.object(watch.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"status":"local_preview","executed":false}')) as run:
            watch.alert(report["findings"][0]["payload"])
            args = run.call_args.args[0]
            self.assertEqual(args[0], "pwsh")
            self.assertTrue(args[5].endswith("n8n-manual-action-alert.ps1"))
            self.assertNotIn("-Execute", args)
            watch.alert(report["findings"][0]["payload"], execute=True)
            self.assertIn("-Execute", run.call_args.args[0])
        with patch.object(watch.subprocess, "run", side_effect=subprocess.TimeoutExpired("pwsh", 180)) as run, patch("builtins.print"):
            result = watch.main(["--database", str(self.db), "--catalog", str(self.catalog)])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(result, 2)

    def test_default_cli_previews_and_never_executes_notification(self):
        with patch.object(watch, "alert", return_value={"status": "local_preview", "exitCode": 0}) as alert, patch("builtins.print"):
            self.assertEqual(watch.main(["--database", str(self.db), "--catalog", str(self.catalog)]), 1)
            self.assertTrue(alert.call_count)
            self.assertTrue(all(call.kwargs["execute"] is False for call in alert.call_args_list))

    def test_prior_unknown_receipt_does_not_starve_later_findings(self):
        self.execute("INSERT INTO workflow_entity VALUES ('other_active',1,'v3','{}',0)")
        with patch.object(watch, "alert", side_effect=[
            {"status": "unknown", "suppressed": True, "exitCode": 3},
            {"status": "local_preview", "executed": False, "exitCode": 0},
        ]) as alert, patch("builtins.print"):
            self.assertEqual(watch.main(["--database", str(self.db), "--catalog", str(self.catalog)]), 2)
            self.assertEqual(alert.call_count, 2)

    def test_report_payloads_preview_through_real_sender(self):
        # Only preview: real sender exits before identity lookup, ledger or transport.
        self.execute("INSERT INTO workflow_entity VALUES ('other_active',1,'v3','{}',0)")
        self.run_record("2026-11-02T16:10:00Z", workflow=watch.RETRY_WORKFLOW, status="error")
        for item in self.run_at()["findings"]:
            result = watch.alert(item["payload"])
            self.assertEqual(result["exitCode"], 0)
            self.assertEqual(result["status"], "local_preview")
            self.assertFalse(result["executed"])


class SenderTests(unittest.TestCase):
    """Execute the actual sender with a local fake watchdog transport, never DWS."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.script = self.root / "n8n-manual-action-alert.ps1"
        self.script.write_bytes((ROOT / "tools/n8n-manual-action-alert.ps1").read_bytes())
        (self.root / "operations-system-watchdog.ps1").write_text(r'''
param([switch]$FunctionsOnly,[string]$Action)
$WatchdogRoot=Join-Path $PSScriptRoot 'watchdog'
function Get-WatchTextHash([string]$Text){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant()}
function Write-WatchJson($Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Compress))}
function Get-WatchRecipient {
  [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'identity.txt'),"checked`n")
  if(Test-Path (Join-Path $PSScriptRoot 'deny')){throw 'owner_mismatch'}
  return @{profile='fixture';bot='fixture-bot';user='fixture-user'}
}
function Invoke-WatchDws([string[]]$Arguments){
  if($Arguments -notcontains '--users' -or $Arguments -contains '--conversation-id'){throw 'not_single_user'}
  [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'send.txt'),"sent`n")
  if(Test-Path (Join-Path $PSScriptRoot 'unknown')){throw 'delivery_unconfirmed'}
  return @{ok=$true;result=@{success=$true;errorCode=0;result=@{processQueryKey='fixture-key';invalidStaffIdList=@();flowControlledStaffIdList=@()}}}
}
''', encoding="utf-8")
        self.payload = {"version": 2, "kind": "schedule_watch", "workflowId": "daily", "code": "schedule_missing_execution",
                        "anchorEpoch": 1793635800, "executionId": ""}

    def call(self, payload=None, execute=False):
        encoded = base64.b64encode(json.dumps(self.payload if payload is None else payload, ensure_ascii=False).encode()).decode()
        args = ["pwsh", "-NoProfile", "-NonInteractive", "-File", str(self.script), "-PayloadBase64", encoded,
                "-StateRoot", str(self.root / "state")]
        if execute:
            args.append("-Execute")
        result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=20,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return result.returncode, json.loads(result.stdout)

    def test_preview_no_identity_network_or_ledger_and_v1_preserved(self):
        code, result = self.call()
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "local_preview")
        self.assertIn("最近一个已到期调度窗口", result["message"])
        old = {"version": 1, "workflowId": "JdLogisticsDaily2026", "logicalExecutionId": "123",
               "failedExecutionId": "123", "code": "terminal_manual_action"}
        self.assertEqual(self.call(old)[1]["status"], "local_preview")
        for path in ("state", "identity.txt", "send.txt"):
            self.assertFalse((self.root / path).exists())

    def test_send_deduplicates_using_existing_ledger(self):
        self.assertEqual(self.call(execute=True)[1]["status"], "sent")
        self.assertTrue(self.call(execute=True)[1]["suppressed"])
        self.assertEqual((self.root / "send.txt").read_text().splitlines(), ["sent"])

    def test_aggregate_repeated_inspections_deduplicate_even_if_count_and_latest_change(self):
        # Run the inspector against an isolated DB, then the actual sender with fake DWS.
        fixture = InspectionTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.run_record("2026-11-02T03:00:00Z", workflow=watch.RETRY_WORKFLOW, status="error", execution_id=11082)
        def payload(now):
            return next(f["payload"] for f in fixture.run_at(now)["findings"] if f["check"] == 3)
        first = payload("2026-11-02T16:16:00Z")
        self.assertEqual(self.call(first, execute=True)[1]["status"], "sent")
        fixture.run_record("2026-11-02T16:20:00Z", workflow=watch.RETRY_WORKFLOW, status="error", execution_id=11083)
        same = payload("2026-11-02T16:30:00Z")
        self.assertNotEqual(first["failureCount"], same["failureCount"])
        self.assertNotEqual(first["executionId"], same["executionId"])
        self.assertTrue(self.call(same, execute=True)[1]["suppressed"])
        self.assertEqual((self.root / "send.txt").read_text().splitlines(), ["sent"])
        self.assertEqual(self.call(payload("2026-11-02T17:00:00Z"), execute=True)[1]["status"], "sent")
        self.assertEqual((self.root / "send.txt").read_text().splitlines(), ["sent", "sent"])

    def test_aggregate_schema_requires_bounded_integer_count_and_latest_execution(self):
        base = {**self.payload, "workflowId": watch.RETRY_WORKFLOW, "code": "error_workflow_failed", "executionId": "11082", "failureCount": 3}
        invalid = [{k: v for k, v in base.items() if k != "failureCount"}, {**base, "executionId": ""},
                   {**base, "unexpected": True}, {**self.payload, "failureCount": 3}]
        invalid += [{**base, "failureCount": value} for value in (0, -1, 1001, "3", 3.5, True)]
        for payload in invalid:
            with self.subTest(payload=payload):
                self.assertEqual(self.call(payload)[0], 2)

    def test_v1_local_clock_baseline_preserves_delivery_behavior(self):
        source = (ROOT / "tools/n8n-manual-action-alert.ps1").read_bytes()
        prefix = source[:source.index(b'  if($payload.version -eq 2){')]
        tail = source[source.index(b'  }else{\n  if($payload.version -ne 1'):]
        self.assertEqual(hashlib.sha256(prefix).hexdigest(), 'acee54356cb93abc3c4925bd5045fc019989e1537f9d482b7704c76db7ea08ca')
        self.assertEqual(hashlib.sha256(tail).hexdigest(), '62913670e8b79a11d27f239b67a0b85a83c72f94e118cc5791814e3bd1cf14cc')
        old = {"version": 1, "workflowId": "JdLogisticsDaily2026", "logicalExecutionId": "123", "failedExecutionId": "123", "code": "terminal_manual_action"}
        self.assertEqual(self.call(old, execute=True)[1]["status"], "sent")
        self.assertTrue(self.call(old, execute=True)[1]["suppressed"])
        self.assertEqual(self.call({**old, "failureCount": 3})[0], 2)
        # v2 on the same workflow must not be suppressed by the v1 ledger entry.
        self.assertEqual(self.call({**self.payload, "workflowId": old["workflowId"]}, execute=True)[1]["status"], "sent")

    def test_unknown_send_not_replayed(self):
        (self.root / "unknown").touch()
        self.assertEqual(self.call(execute=True)[1]["status"], "unknown")
        self.assertTrue(self.call(execute=True)[1]["suppressed"])
        self.assertEqual((self.root / "send.txt").read_text().splitlines(), ["sent"])

    def test_identity_mismatch_never_sends(self):
        (self.root / "deny").touch()
        self.assertEqual(self.call(execute=True)[1]["status"], "identity_failed")
        self.assertFalse((self.root / "send.txt").exists())

    def test_payload_cannot_inject_text_or_recipient(self):
        for payload in ({**self.payload, "workflowId": 'bad"; injected'}, {**self.payload, "users": "other"},
                        {**self.payload, "code": "arbitrary message"}, {**self.payload, "anchorEpoch": "yesterday"}):
            with self.subTest(payload=payload):
                self.assertEqual(self.call(payload, execute=True)[0], 2)
        self.assertFalse((self.root / "send.txt").exists())


if __name__ == "__main__":
    unittest.main()
