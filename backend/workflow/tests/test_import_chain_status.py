from contextlib import closing
import hashlib
import json
import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from sales.tests.factories import TEST_SECRET, signed_headers
from workflow.import_chain_status import CATALOG, MAX_ROWS, read_today_status
from workflow.import_chain_views import today_status
from workflow.errors import WorkflowApiError


class ImportChainStatusTests(SimpleTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "n8n.sqlite3"
        self.ids = json.loads(CATALOG.read_text())["workflowIds"]
        self.now = datetime(2026, 9, 10, 2, 0, tzinfo=timezone.utc)
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute('CREATE TABLE workflow_entity(id TEXT, active INTEGER, isArchived INTEGER)')
            conn.execute('CREATE TABLE execution_entity(id INTEGER PRIMARY KEY, workflowId TEXT, status TEXT, startedAt TEXT, stoppedAt TEXT, createdAt TEXT, deletedAt TEXT, mode TEXT)')
            conn.execute('CREATE TABLE execution_data(executionId INTEGER PRIMARY KEY, workflowData TEXT, data TEXT)')
            conn.executemany('INSERT INTO workflow_entity VALUES (?,1,0)', [(i,) for i in self.ids])
        self.setting = override_settings(N8N_STATUS_DATABASE_PATH=str(self.path))
        self.setting.enable()
        self.addCleanup(self.setting.disable)

    def add(self, status="success", start="2026-09-10T00:00:00Z", stop="2026-09-10T01:00:00Z", workflow=None, mode="trigger", deleted=None):
        with closing(sqlite3.connect(self.path)) as conn, conn:
            cursor = conn.execute('INSERT INTO execution_entity(workflowId,status,startedAt,stoppedAt,createdAt,deletedAt,mode) VALUES (?,?,?,?,?,?,?)',
                         [workflow or self.ids[0], status, start, stop, start or "2026-09-10T01:00:00Z", deleted, mode])
            return cursor.lastrowid

    def manual(self, *, mutate=None, workflow=None, **kwargs):
        workflow = workflow or self.ids[0]
        execution_id = self.add(mode="manual", workflow=workflow, **kwargs)
        contract = json.loads(CATALOG.read_text(encoding="utf8"))["manualCompletion"][workflow]
        definition = {"id": workflow, "nodes": contract, "pinData": {}}
        stamp = datetime.fromisoformat(kwargs.get("start", "2026-09-10T00:00:00Z").replace("Z", "+00:00")).timestamp() * 1000
        root = {"startData": {}, "resultData": {"pinData": {}, "runData": {
            n["name"]: [{"startTime": stamp + index * 1000, "executionIndex": index,
                         "executionTime": 10, "executionStatus": "success", "data": {"secret": "never-project-this"}}]
            for index, n in enumerate(contract)}}}
        if mutate:
            mutate(root, definition)
        # Real n8n flatted representation, including references for scalar strings.
        values = []
        def encode(value):
            if not isinstance(value, (dict, list, str)):
                return value
            index = len(values)
            values.append(None)
            values[index] = ({k: encode(v) for k, v in value.items()} if isinstance(value, dict)
                             else [encode(v) for v in value] if isinstance(value, list) else value)
            return str(index)
        encode(root)
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute('INSERT INTO execution_data VALUES (?,?,?)', [execution_id, json.dumps(definition), json.dumps(values)])
        return execution_id

    def read(self):
        return read_today_status(now=self.now)

    def test_shanghai_midnight_cross_day_and_read_only_bytes(self):
        self.add(start="2026-09-09T15:00:00Z", stop="2026-09-09T16:00:00Z")
        self.add(stop="2026-09-09T15:59:59Z", workflow=self.ids[1])
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        result = self.read()
        self.assertEqual(result["date"], "2026-09-10")
        self.assertEqual(result["items"][0]["state"], "completed")
        self.assertEqual(result["items"][1]["state"], "no_record")
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)

    def test_failure_after_success_and_new_run_do_not_hide_later_outcome(self):
        self.add(stop="2026-09-10T00:01:00Z")
        self.add(status="error", stop="2026-09-10T00:02:00Z")
        item = self.read()["items"][0]
        self.assertEqual(item["state"], "failed")
        self.assertTrue(item["completedToday"])
        self.assertEqual(item["completedMode"], "trigger")
        self.assertEqual(item["executionMode"], "trigger")
        self.add(status="running", start="2026-09-10T00:03:00Z", stop=None)
        item = self.read()["items"][0]
        self.assertEqual(item["state"], "running")
        self.assertEqual(item["executionMode"], "trigger")

    def test_manual_deleted_future_and_unregistered_runs_do_not_mark_success(self):
        self.add(mode="manual")
        self.add(deleted="2026-09-10T01:30:00Z")
        self.add(stop="2026-09-11T01:00:00Z")
        self.add(workflow="not-in-catalog")
        self.assertEqual(self.read()["items"][0]["state"], "no_record")

    def test_pending_null_start_and_missing_workflow_are_distinct(self):
        self.add(status="new", start=None, stop=None)
        self.assertEqual(self.read()["items"][0]["state"], "pending")
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute('DELETE FROM workflow_entity WHERE id=?', [self.ids[1]])
        self.assertEqual(self.read()["items"][1]["state"], "unavailable")

    def test_disabled_workflow_can_still_have_today_completion(self):
        self.add(stop="2026-09-10 01:00:00.123")
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute('UPDATE workflow_entity SET active=0 WHERE id=?', [self.ids[0]])
        item = self.read()["items"][0]
        self.assertFalse(item["active"])
        self.assertTrue(item["completedToday"])
        self.assertEqual(item["completedAt"], "2026-09-10T01:00:00.123000+00:00")
        self.assertEqual(item["completedMode"], "trigger")

    def test_webhook_completion_is_identified_as_automatic_retry(self):
        self.add(status="error", stop="2026-09-10T00:01:00Z", mode="trigger")
        self.add(start="2026-09-10T01:00:00Z", stop="2026-09-10T01:07:00Z", mode="webhook")
        item = self.read()["items"][0]
        self.assertEqual(item["state"], "completed")
        self.assertTrue(item["completedToday"])
        self.assertEqual(item["completedAt"], "2026-09-10T01:07:00+00:00")
        self.assertEqual(item["completedMode"], "webhook")
        self.assertEqual(item["executionMode"], "webhook")

    def test_complete_manual_success_supersedes_automatic_failure_for_all_workflows(self):
        for workflow in self.ids:
            self.add(status="error", stop="2026-09-10T00:00:00Z", workflow=workflow)
            self.manual(workflow=workflow)
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        response = self.read()
        for item in response["items"]:
            self.assertEqual(item["state"], "completed")
            self.assertEqual(item["completedMode"], "manual")
            self.assertEqual(item["executionMode"], "manual")
        self.assertNotIn("never-project-this", json.dumps(response))
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)

    def test_partial_pinned_cached_wrong_identity_and_failed_stage_are_excluded(self):
        def stage(root):
            return list(root["resultData"]["runData"].values())[-1][0]
        mutations = [
            lambda r, d: r["resultData"]["runData"].pop(next(iter(r["resultData"]["runData"]))),
            lambda r, d: r["startData"].update(destinationNode="test"),
            lambda r, d: r["startData"].update(runNodeFilter=["test"]),
            lambda r, d: r["resultData"]["pinData"].update(test=[{}]),
            lambda r, d: d["pinData"].update(test=[{}]),
            lambda r, d: d.update(id="wrong-workflow"),
            lambda r, d: d["nodes"][-1].update(disabled=True),
            lambda r, d: d["nodes"][-1].update(continueOnFail=True),
            lambda r, d: d["nodes"][-1].update(type="n8n-nodes-base.code"),
            lambda r, d: stage(r).update(executionStatus="error"),
            lambda r, d: stage(r).update(startTime=1),
            lambda r, d: stage(r).update(executionIndex=0),
            lambda r, d: stage(r).update(executionTime=100000000),
            lambda r, d: stage(r).update(executionTime=float("nan")),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.manual(mutate=mutate)
                self.assertEqual(self.read()["items"][0]["state"], "no_record")

    def test_manual_failure_inflight_and_test_after_success_do_not_replace_completion(self):
        accepted = self.manual()
        self.add(mode="manual", status="error", stop="2026-09-10T01:10:00Z")
        self.add(mode="manual", status="running", stop=None)
        self.add(mode="manual", stop="2026-09-10T01:20:00Z")  # no full-run evidence
        item = self.read()["items"][0]
        self.assertEqual(item["executionId"], str(accepted))
        self.assertEqual(item["state"], "completed")
        self.add(status="error", stop="2026-09-10T01:30:00Z")
        item = self.read()["items"][0]
        self.assertEqual(item["state"], "failed")
        self.assertEqual(item["completedMode"], "manual")

    def test_manual_completion_uses_shanghai_finish_day_and_excludes_deleted_future(self):
        self.manual(start="2026-09-09T15:00:00Z", stop="2026-09-09T16:00:00Z")
        self.manual(start="2026-09-09T14:00:00Z", stop="2026-09-09T15:59:59Z", workflow=self.ids[1])
        self.manual(workflow=self.ids[1], deleted="2026-09-10T01:30:00Z")
        self.manual(workflow=self.ids[1], stop="2026-09-11T01:00:00Z")
        self.assertEqual(self.read()["items"][0]["completedMode"], "manual")
        self.assertEqual(self.read()["items"][1]["state"], "no_record")

    def test_manual_evidence_bounds_and_malformed_data(self):
        execution_id = self.manual()
        with patch("workflow.import_chain_status.MAX_MANUAL_RUNS", 0):
            with self.assertRaises(WorkflowApiError):
                self.read()
        with patch("workflow.import_chain_status.MAX_TOTAL_EVIDENCE_BYTES", 0):
            with self.assertRaises(WorkflowApiError):
                self.read()
        with patch("workflow.import_chain_status.MAX_EVIDENCE_BYTES", 1):
            self.assertEqual(self.read()["items"][0]["state"], "no_record")
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute('UPDATE execution_data SET data=? WHERE executionId=?', ['["0"]', execution_id])
        self.assertEqual(self.read()["items"][0]["state"], "no_record")

    def test_truncation_and_missing_database_fail_closed_without_creating_files(self):
        self.add()
        with patch("workflow.import_chain_status.MAX_ROWS", 0):
            with self.assertRaises(WorkflowApiError):
                self.read()
        missing = self.path.with_name("missing.sqlite3")
        with override_settings(N8N_STATUS_DATABASE_PATH=str(missing)):
            with self.assertRaises(WorkflowApiError):
                self.read()
        self.assertFalse(missing.exists())
        with override_settings(N8N_STATUS_DATABASE_PATH=""):
            with self.assertRaises(WorkflowApiError):
                self.read()

    def test_real_principal_scope_and_method_checked_before_source_access(self):
        route = "/api/workflow/import-chain-status"
        factory = RequestFactory()
        with patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET}), patch("workflow.import_chain_views.read_today_status") as reader:
            self.assertEqual(today_status(factory.get(route)).status_code, 401)
            request = factory.get(route, headers=signed_headers(route, scope={"brands": ["test"]}))
            self.assertEqual(today_status(request).status_code, 403)
            self.assertEqual(today_status(factory.post(route)).status_code, 405)
            self.assertEqual(today_status(factory.get(route + "?path=arbitrary", headers=signed_headers(route + "?path=arbitrary"))).status_code, 400)
            reader.assert_not_called()
            reader.return_value = {"date": "2026-09-10", "items": []}
            with patch("workflow.import_chain_views.revision_value", return_value="1:abcdef123456"):
                response = today_status(factory.get(route, headers=signed_headers(route)))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Cache-Control"], "no-store")
