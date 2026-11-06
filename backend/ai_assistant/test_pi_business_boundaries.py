"""Synthetic native n8n metadata and report transport boundary acceptance."""
from copy import deepcopy
from contextlib import closing
from datetime import datetime, timedelta, timezone as dtz
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from workflow import pi_business_n8n as native
from workflow.errors import WorkflowApiError
from workflow.models import WorkflowWriteRequestReceipt
from . import pi_business as business, pi_business_report as report
from .pi_models import PiFile, PiBusinessAction
from .policy import AiError, canonical
from .test_pi_business_verification import PiBusinessVerificationTests as Fixture


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiBusinessBoundaryTests(TestCase):
    setUp = Fixture.setUp
    user = Fixture.user
    operation = Fixture.operation
    confirm = Fixture.confirm

    def bot_config(self):
        return {"enabled": True, "corpId": "synthetic-corp", "robotCode": "synthetic-bot", "robotName": "合成机器人",
            "policyVersion": "fixture-v1", "groups": [{"id": "synthetic-group", "name": "合成接收群"}],
            "bindings": [{"senderId": "synthetic-staff", "ownerEmail": self.actor.email, "role": self.actor.role, "scope": None}]}

    def report_file(self, op, **changes):
        raw = b"%PDF-1.7\nsynthetic report\n%%EOF"
        values = dict(id="report-file", session_id=op.session_id, operation=op, owner_email=self.actor.email,
            client_request_id="collected-report", request_digest="0"*64, generation=op.generation,
            scope_json="null", file_name="合成报告.pdf", mime_type="application/pdf", size_bytes=len(raw),
            sha256=hashlib.sha256(raw).hexdigest(), direction="output", payload=raw)
        return PiFile.objects.create(**{**values, **changes})

    def prepare_report(self, caption="完整正文"):
        op, intent = self.operation("deliver_report")
        file = self.report_file(op)
        recipient = report.recipients(self.actor)["items"][0]
        result = business.tool_prepare(op, intent.id, "prepare_pi_report_delivery",
            {"fileId": file.id, "recipientId": recipient["recipientId"], "caption": caption}, "report-invoke")
        return op, result["action"]

    def test_report_directory_preview_confirm_and_two_receipts(self):
        def accepted(*args, before_send=None, **kwargs):
            if before_send: before_send()
            return {"platform": "dingtalk", "state": "accepted", "receiptSha256": "f"*64}
        with patch.object(report, "_config", return_value=self.bot_config()), patch.object(report.dingtalk_transport, "send", side_effect=accepted) as body, patch.object(report.dingtalk_transport, "send_media", side_effect=accepted) as media:
            op, action = self.prepare_report()
            self.assertEqual(action["status"], "prepared")
            self.assertNotIn("target", report.recipients(self.actor)["items"][0])
            body.assert_not_called(); media.assert_not_called()
            self.confirm(action)
            claimed = business.claim()
            business.perform(claimed)
            business.perform(claimed)
            claimed.refresh_from_db()
            self.assertEqual(claimed.status, "succeeded")
            self.assertEqual((body.call_count, media.call_count), (1, 1))
            result = json.loads(claimed.result_json)
            self.assertEqual(result["receipt"]["state"], "accepted_by_platform")
            self.assertIn("body", result["receipt"])
            self.assertIn("attachment", result["receipt"])
            self.assertNotIn("delivered", canonical(result))

    def test_report_partial_unknown_does_not_resend(self):
        accepted = {"platform": "dingtalk", "state": "accepted", "receiptSha256": "f"*64}
        with patch.object(report, "_config", return_value=self.bot_config()), patch.object(report.dingtalk_transport, "send", return_value=accepted) as body, patch.object(report.dingtalk_transport, "send_media", side_effect=TimeoutError("lost ack")) as media:
            op, action = self.prepare_report()
            self.confirm(action)
            claimed = business.claim()
            business.perform(claimed)
            business.perform(claimed)
            claimed.refresh_from_db()
            self.assertEqual(claimed.status, "unknown")
            original = report.observe(claimed, self.actor)
            self.assertEqual(original["receipt"]["body"], accepted)
            self.assertIsNone(original["receipt"]["attachment"])
            self.assertEqual((body.call_count, media.call_count), (1, 1))

    def test_report_changed_recipient_policy_prevents_send(self):
        config = self.bot_config()
        with patch.object(report, "_config", side_effect=lambda: config), patch.object(report.dingtalk_transport, "send") as body, patch.object(report.dingtalk_transport, "send_media") as media:
            _, action = self.prepare_report()
            self.confirm(action)
            config["policyVersion"] = "revoked-version"
            claimed = business.claim()
            business.perform(claimed)
            body.assert_not_called(); media.assert_not_called()
            claimed.refresh_from_db()
            self.assertNotEqual(claimed.status, "succeeded")

    def test_report_file_format_size_owner_and_binding_reject(self):
        op, _ = self.operation("deliver_report")
        file = self.report_file(op)
        with patch.object(report, "_config", return_value=self.bot_config()):
            recipient = report.recipients(self.actor)["items"][0]["recipientId"]
            for field, value in (("direction", "input"), ("size_bytes", 2097153), ("file_name", "report.txt"), ("sha256", "0"*64)):
                old = getattr(file, field)
                setattr(file, field, value); file.save(update_fields=[field])
                with self.subTest(field=field), self.assertRaises(AiError):
                    report.prepare(self.actor, {"fileId": file.id, "recipientId": recipient})
                setattr(file, field, old); file.save(update_fields=[field])
            with self.assertRaises(AiError):
                report.prepare(self.other, {"fileId": file.id, "recipientId": recipient})
            with self.assertRaises(AiError):
                report.prepare(self.actor, {"fileId": file.id, "recipientId": "not-in-directory"})

    def native_database(self):
        directory = tempfile.TemporaryDirectory(prefix="pi-business-native-")
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "native.sqlite3"
        db = sqlite3.connect(path)
        db.executescript('CREATE TABLE workflow_entity(id TEXT, active INTEGER, versionId TEXT, activeVersionId TEXT, nodes TEXT, connections TEXT, settings TEXT, isArchived INTEGER);'
            'CREATE TABLE execution_entity(id INTEGER, workflowId TEXT, status TEXT, mode TEXT, startedAt TEXT, stoppedAt TEXT, deletedAt TEXT, createdAt TEXT);'
            'CREATE TABLE execution_data(executionId INTEGER, data TEXT, workflowData TEXT);')
        definition, store = native._template("tmall-yijiu")
        db.execute('INSERT INTO workflow_entity VALUES(?,?,?,?,?,?,?,?)', [definition["id"], 1, "fixture-version", "fixture-version",
            *[json.dumps(definition[key], ensure_ascii=False) for key in ("nodes", "connections", "settings")], 0])
        db.commit(); db.close()
        setting = override_settings(N8N_STATUS_DATABASE_PATH=str(path))
        setting.enable(); self.addCleanup(setting.disable)
        return path, definition, store

    def native_args(self):
        yesterday = datetime.now().astimezone().date()-timedelta(days=1)
        return {"capabilityId": native.CAPABILITY, "storeKey": "tmall-yijiu", "dataset": "product_and_promotion",
            "startDate": (yesterday-timedelta(days=6)).isoformat(), "endDate": yesterday.isoformat()}

    def coverage(self, args, missing=True):
        days = [(datetime.fromisoformat(args["startDate"]).date()+timedelta(days=i)).isoformat() for i in range(7)]
        _, store = native._template(args["storeKey"])
        return {"shopName": store["shopName"], "startDate": args["startDate"], "endDate": args["endDate"], "revision": "fixture",
            "productDailyDates": days[1:] if missing else days, "promotionDates": days[1:] if missing else days,
            "productMissingDates": days[:1] if missing else [], "promotionMissingDates": days[:1] if missing else [], "truncated": False}

    def test_native_exact_graph_active_version_and_seven_day_scope(self):
        path, definition, _ = self.native_database()
        args = self.native_args()
        with patch.object(native, "_coverage", return_value=self.coverage(args)):
            prepared = native.prepare(args, self.actor)[0]
            self.assertEqual(prepared["parameters"]["registeredVersion"], "fixture-version")
            self.assertFalse(prepared["preview"]["noGap"])
            with self.assertRaises(WorkflowApiError):
                native.prepare({**args, "startDate": "2020-01-01"}, self.actor)
            with self.assertRaises(WorkflowApiError):
                native.prepare({**args, "dataset": "arbitrary"}, self.actor)
            for sql in ('UPDATE workflow_entity SET active=0', 'UPDATE workflow_entity SET active=1,activeVersionId=\'changed\'', 'UPDATE workflow_entity SET activeVersionId=versionId,nodes=\'[]\''):
                with closing(sqlite3.connect(path, isolation_level=None)) as db: db.execute(sql)
                with self.subTest(sql=sql), self.assertRaises(WorkflowApiError):
                    native.prepare(args, self.actor)

    def test_native_complete_coverage_is_no_gap(self):
        self.native_database()
        args = self.native_args()
        with patch.object(native, "_coverage", return_value=self.coverage(args, missing=False)):
            self.assertTrue(native.prepare(args, self.actor)[0]["preview"]["noGap"])

    def add_native_execution(self, path, template, prepared, *, execution_id=41, imports=True, action_id="native-action", dispatch_token="native-token"):
        params = prepared["parameters"]
        marker = {"actionId": action_id, "dispatchToken": dispatch_token, "targetVersion": prepared["targetVersion"],
            **{k: params[k] for k in ("startDate", "endDate", "scheduledAt")}}
        day = params["startDate"]
        outputs = {"Pi业务执行入口": {"body": {"piBusiness": marker}}}
        for prefix in ("B·", "C·", "P·", "N·", "M·"):
            name = next(n["name"] for n in template["nodes"] if n["name"].startswith(prefix))
            value = {"ok": True, "coverageConfirmed": True}
            if prefix == "C·" and imports:
                value["batches"] = [{"batchId": "product-batch", "businessDate": day, "rowCount": 3,
                    "status": "imported", "storeKey": params["storeKey"]}]
            if prefix == "P·" and imports:
                value.update(batchId="promotion-batch", startDate=day, endDate=day, rowCount=2, status="imported", storeKey=params["storeKey"])
            if prefix == "M·":
                value.update(browserClosure={"ok": True, "status": "closed"}, dailyBackfill={"status": "completed", "remainingDates": [],
                    "storeKey": params["storeKey"], "executionId": str(execution_id)})
            outputs[name] = value
        run = {name: [{"executionStatus": "success", "data": {"main": [[{"json": value}]]}}] for name, value in outputs.items()}
        pool = []
        def encode(value):
            if isinstance(value, (dict, list, str)):
                index = len(pool); pool.append(None)
                pool[index] = ({key: encode(v) for key, v in value.items()} if isinstance(value, dict) else
                    [encode(v) for v in value] if isinstance(value, list) else value)
                return str(index)
            return value
        encode({"resultData": {"runData": run}})
        document = {**template, "versionId": "fixture-version"}
        stamp = datetime.now(dtz.utc).strftime("%Y-%m-%d %H:%M:%S")
        with closing(sqlite3.connect(path, isolation_level=None)) as db:
            db.execute('INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?,?)', [execution_id, template["id"], "success", "webhook", stamp, stamp, None, stamp])
            db.execute('INSERT INTO execution_data VALUES(?,?,?)', [execution_id, json.dumps(pool, ensure_ascii=False), json.dumps(document, ensure_ascii=False)])

    def test_native_success_requires_original_execution_batches_and_coverage(self):
        path, template, _ = self.native_database()
        args = self.native_args()
        with patch.object(native, "_coverage", return_value=self.coverage(args)):
            prepared = native.prepare(args, self.actor)[0]
        WorkflowWriteRequestReceipt.objects.create(request_id="pi-business:native-action", actor_email=self.actor.email,
            method="POST", path=native.PATH, body_sha256="0"*64, query_sha256="0"*64, claim_token="fixture",
            expires_at=timezone.now()+timedelta(days=1), response_payload={"initialGaps": {
                "productMissingDates": [args["startDate"]], "promotionMissingDates": [args["startDate"]]}})
        body = {"actionId": "native-action", "dispatchToken": "native-token", "targetVersion": prepared["targetVersion"], "parameters": prepared["parameters"]}
        with patch.object(native, "_coverage", return_value=self.coverage(args, missing=False)):
            self.assertEqual(native.observe(body, self.actor)["status"], "unknown")
            self.add_native_execution(path, template, prepared, imports=False)
            self.assertEqual(native.observe(body, self.actor)["status"], "unknown")
            with closing(sqlite3.connect(path, isolation_level=None)) as db:
                db.execute('DELETE FROM execution_entity'); db.execute('DELETE FROM execution_data')
            self.add_native_execution(path, template, prepared)
            result = native.observe(body, self.actor)
            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(result["receipt"]["batchIds"], ["product-batch", "promotion-batch"])
            self.assertEqual(result["executionId"], "41")
            self.add_native_execution(path, template, prepared, execution_id=42)
            with self.assertRaises(WorkflowApiError):
                native.observe(body, self.actor)

    def test_native_node_admission_exact_execution_token_version_and_cancel(self):
        from django.test import RequestFactory
        from . import pi_business_n8n as admission
        path, template, _ = self.native_database()
        args = self.native_args()
        with patch.object(native, "_coverage", return_value=self.coverage(args)):
            prepared = native.prepare(args, self.actor)[0]
        op, intent = self.operation("execute_registered_gap")
        with patch("ai_assistant.pi_business_domains.prepare", return_value=prepared):
            action = business.tool_prepare(op, intent.id, "prepare_pi_gap_execution", args, "native-prepare")["action"]
        self.confirm(action)
        claimed = business.claim()
        with patch("ai_assistant.pi_business_domains.execute", return_value={"status": "accepted"}):
            business.perform(claimed)
        claimed.refresh_from_db()
        self.add_native_execution(path, template, prepared, action_id=claimed.id, dispatch_token=claimed.lease_token)
        with closing(sqlite3.connect(path, isolation_level=None)) as db:
            db.execute("UPDATE execution_entity SET status='running',stoppedAt=NULL")
        def call(**changes):
            payload = {"actionId": claimed.id, "dispatchToken": claimed.lease_token, "executionId": "41", **changes}
            request = RequestFactory().post("/api/ai/pi/n8n-admission", canonical(payload), content_type="application/json")
            return admission.admission(request)
        self.assertEqual(call().status_code, 200)
        claimed.refresh_from_db()
        self.assertEqual(json.loads(claimed.result_json)["executionId"], "41")
        for changes in ({"dispatchToken": "wrong-token"}, {"executionId": "42"}):
            with self.subTest(changes=changes), self.assertRaises(AiError): call(**changes)
        with closing(sqlite3.connect(path, isolation_level=None)) as db:
            document = json.loads(db.execute('SELECT workflowData FROM execution_data').fetchone()[0])
            document["versionId"] = "different-native-version"
            db.execute('UPDATE execution_data SET workflowData=?', [json.dumps(document)])
        with self.assertRaises(AiError): call()
        with closing(sqlite3.connect(path, isolation_level=None)) as db:
            document["versionId"] = "fixture-version"
            db.execute('UPDATE execution_data SET workflowData=?', [json.dumps(document)])
        business.control(op.session_id, {"command": "cancel", "actionId": claimed.id, "clientRequestId": "native-cancel"}, self.actor)
        with self.assertRaises(AiError): call()
