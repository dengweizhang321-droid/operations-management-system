"""Disposable PostgreSQL controls: no provider, image origin or production writes."""
import hashlib
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections, connection, connections, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from market import annotations, views
from market.errors import MarketApiError
from market.models import MarketAnnotationCloudRun, MarketAnnotationItem, MarketAnnotationJob, MarketDataRevision, MarketMasterAuditLog, MarketWriteAuthority, MarketWriteRequestReceipt
from market.tests.test_annotation_queue import QueueFixtures, PRINCIPAL
from market.tests.test_api import AUTHORITY_EPOCH, CUTOVER_ID
from sales.tests.factories import TEST_SECRET, signed_headers


def body(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


@override_settings(MARKET_WRITE_AUTHORITY_EPOCH=AUTHORITY_EPOCH, MARKET_WRITE_CUTOVER_ID=CUTOVER_ID)
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class ResumeReceiptTests(QueueFixtures, TransactionTestCase):
    available_apps = ["market"]
    def setUp(self):
        MarketWriteAuthority.objects.update_or_create(pk=1, defaults={"status": "postgres", "authority_epoch": uuid.UUID(AUTHORITY_EPOCH), "cutover_id": CUTOVER_ID})
        MarketDataRevision.objects.get_or_create(domain="market", defaults={"revision": 1, "source_digest": "a"*64})
        self.target = self.job("resume-round2")
        self.item(self.target, "remaining")
        MarketAnnotationCloudRun.objects.filter(job_id=self.target.id).update(state="paused")

    def command(self, state="running"):
        return {"action": "set_cloud_run_state", "jobId": self.target.id, "state": state,
                "expectedControlVersion": annotations._control_version(MarketAnnotationCloudRun.objects.get(job_id=self.target.id)),
                "operationId": str(uuid.uuid4())}

    def post(self, command, *, query=False, email=PRINCIPAL.email, role="operator", scope=None):
        payload = {"contractVersion": "market-annotation-control-query-v1", "command": command} if query else {
            "contractVersion": "market-command-v1", "domain": "annotations", "command": command}
        raw = body(payload)
        request_id = str(uuid.uuid4()) if query else "annotation-control-" + command["operationId"]
        return self.client.post("/api/market/commands", data=raw, content_type="application/json", headers=signed_headers(
            "/api/market/commands", method="POST", body=raw, request_id=request_id, email=email, role=role, scope=scope))

    def test_success_exact_replay_and_read_only_query(self):
        command = self.command()
        first = self.post(command)
        self.assertEqual(first.status_code, 200, first.content)
        result = first.json()["result"]
        self.assertNotEqual(result["beforeControlVersion"], result["afterControlVersion"])
        self.assertEqual(self.post(command).json()["result"], result)
        before = list(MarketWriteRequestReceipt.objects.values())
        audit_before = list(MarketMasterAuditLog.objects.values())
        query = self.post(command, query=True)
        self.assertEqual(query.json()["outcome"], "succeeded", query.content)
        self.assertEqual(query.json()["result"]["auditId"], result["auditId"])
        self.assertEqual(list(MarketWriteRequestReceipt.objects.values()), before)
        self.assertEqual(list(MarketMasterAuditLog.objects.values()), audit_before)
        with connection.cursor() as cursor:
            cursor.execute("SHOW transaction_read_only")
            self.assertEqual(cursor.fetchone()[0], "off")
        self.assertEqual(MarketMasterAuditLog.objects.filter(action="set_market_annotation_cloud_run_state").count(), 1)

    def test_commit_then_response_loss_is_confirmed_without_second_post(self):
        command = self.command()
        original = views._replay_fenced_write
        def lose_response(*args, **kwargs):
            original(*args, **kwargs)
            raise OSError("isolated response delivery seam")
        with patch.object(views, "_replay_fenced_write", lose_response):
            response = self.post(command)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.post(command, query=True).json()["outcome"], "succeeded")
        self.assertEqual(MarketWriteRequestReceipt.objects.count(), 1)
        self.assertEqual(MarketMasterAuditLog.objects.filter(action="set_market_annotation_cloud_run_state").count(), 1)

    def test_precommit_version_rejection_is_durable_and_has_zero_control_effect(self):
        command = self.command(); command["expectedControlVersion"] = "f" * 64
        self.assertEqual(self.post(command).status_code, 409)
        self.assertEqual(self.post(command, query=True).json()["outcome"], "rejected")
        self.assertEqual(MarketMasterAuditLog.objects.count(), 0)
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=self.target.id).state, "paused")

    def test_missing_processing_wrong_tuple_and_actor_are_not_false_success(self):
        command = self.command()
        self.assertEqual(self.post(command, query=True).json()["outcome"], "unknown")
        raw = body({"contractVersion": "market-command-v1", "domain": "annotations", "command": command})
        MarketWriteRequestReceipt.objects.create(request_id="annotation-control-"+command["operationId"],
            body_sha256=hashlib.sha256(raw).hexdigest(), query_sha256=hashlib.sha256(b"").hexdigest(),
            method="POST", path="/api/market/commands", actor_email=PRINCIPAL.email)
        self.assertEqual(self.post(command, query=True).json()["outcome"], "processing")
        self.assertEqual(self.post({**command, "jobId": "other"}, query=True).json()["outcome"], "unknown")
        self.assertEqual(self.post(command, query=True, email="other@example.test").status_code, 403)
        self.assertEqual(self.post(command, query=True, role="viewer").status_code, 403)
        self.assertEqual(self.post(command, query=True, scope={"platforms": ["京东"]}).status_code, 403)

    def test_same_id_changed_command_and_completed_invalid_audit_are_unknown(self):
        command = self.command(); self.post(command)
        changed = {**command, "state": "paused"}
        self.assertEqual(self.post(changed).status_code, 409)
        self.assertEqual(self.post(changed, query=True).json()["outcome"], "unknown")
        receipt = MarketWriteRequestReceipt.objects.get()
        receipt.response_payload["result"]["auditId"] = str(uuid.uuid4()); receipt.save()
        self.assertEqual(self.post(command, query=True).json()["outcome"], "unknown")

    def test_expired_quarantine_commits_even_when_no_resume_is_possible(self):
        MarketAnnotationItem.objects.filter(pk="remaining").update(status="claimed", attempt_count=2,
            lease_expires_at=timezone.now()-timedelta(seconds=1), lease_token_hash="old")
        command = self.command(); response = self.post(command)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["result"]["resumeAccepted"])
        self.assertTrue(response.json()["result"]["quarantinedExpiredClaims"])
        self.assertEqual(MarketAnnotationItem.objects.get(pk="remaining").attempt_count, 3)
        self.assertEqual(self.post(command, query=True).json()["outcome"], "succeeded")
        self.assertIsNone(self.claim(self.target)["task"])

    def test_heartbeat_preserves_token_pause_and_completion_advance_it(self):
        self.item(self.target, "remaining-second")
        command = self.command(); self.post(command)
        token = MarketAnnotationCloudRun.objects.get(job_id=self.target.id).retry_state_json["controlVersion"]
        task = self.claim(self.target)["task"]
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=self.target.id).retry_state_json["controlVersion"], token)
        self.complete(task)
        run = MarketAnnotationCloudRun.objects.get(job_id=self.target.id)
        self.assertEqual(run.state, "running")
        self.assertEqual(annotations._control_version(run), token)
        second = self.claim(self.target)["task"]
        self.complete(second)
        run = MarketAnnotationCloudRun.objects.get(job_id=self.target.id)
        self.assertEqual(run.state, "completed")
        self.assertNotEqual(annotations._control_version(run), token)
        # Later state changes do not retract proof of the original command.
        self.assertEqual(self.post(command, query=True).json()["outcome"], "succeeded")

    def test_configuration_pause_preserves_other_retry_metadata_and_fences_aba(self):
        other = self.job("same-model")
        self.item(other, "other")
        run = MarketAnnotationCloudRun.objects.get(job_id=other.id)
        run.retry_state_json = {"controlVersion": "a"*64, "globalRateLimitUntil": 123}; run.save()
        self.post(self.command())
        task = self.claim(self.target)["task"]
        self.complete(task, error="model unavailable", failureCode="model_configuration")
        run.refresh_from_db()
        self.assertEqual(run.state, "paused")
        self.assertEqual(run.retry_state_json["globalRateLimitUntil"], 123)
        self.assertNotEqual(annotations._control_version(run), "a"*64)
        with self.assertRaises(MarketApiError):
            annotations._set_cloud_run({"jobId": other.id, "state": "running", "operationId": str(uuid.uuid4()), "expectedControlVersion": "a"*64}, PRINCIPAL)

    def test_same_version_opposite_controls_only_one_commits(self):
        first = self.command(); second = {**first, "state": "paused", "operationId": str(uuid.uuid4())}
        barrier = Barrier(2)
        def control(command):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                with transaction.atomic():
                    annotations._set_cloud_run(command, PRINCIPAL)
                return "committed"
            except MarketApiError:
                return "rejected"
            finally: connections.close_all()
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(control, [first, second]))
        self.assertEqual(sorted(results), ["committed", "rejected"])

    def test_terminal_before_late_resume_is_rejected(self):
        for terminal in ("cancelled", "review_ready", "committed", "deleted"):
            for state in ("running", "paused"):
                command = self.command(state)
                MarketAnnotationJob.objects.filter(pk=self.target.id).update(status=terminal)
                self.assertEqual(self.post(command).status_code, 409)
                self.assertEqual(self.post(command, query=True).json()["outcome"], "rejected")

    def test_malformed_control_token_fails_closed(self):
        run = MarketAnnotationCloudRun.objects.get(job_id=self.target.id)
        for raw in ({"controlVersion": "bad"}, {"controlVersion": None}, [], "bad"):
            run.retry_state_json = raw; run.save()
            with self.assertRaises(MarketApiError): annotations._control_version(run)
