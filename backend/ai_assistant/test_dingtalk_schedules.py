from datetime import datetime, timedelta, timezone as utc
import copy
import json
from urllib.parse import urlsplit
from unittest.mock import Mock, patch
from types import SimpleNamespace
from django.test import TestCase, override_settings

from . import dingtalk_schedules as schedules, dingtalk_settings, dingtalk_transport as platform, models as m
from .policy import AiError
from . import tests
from .test_dingtalk_transport import fake_dingtalk_wire
from .tests import ADMIN


def background(*args, **kwargs):
    return {"ok": True, "principal": {"role": "admin"}}


def accepted_delivery(*args, before_send):
    before_send()
    return platform.validate_receipt({"processQueryKey": "synthetic-accepted-receipt"})


def lost_delivery(*args, before_send):
    before_send()
    raise TimeoutError()


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class DingTalkScheduleTests(TestCase):
    user = tests.AiDomainTests.user

    def setUp(self):
        tests.AiDomainTests.setUp(self)
        self.config = {"version": 1, "enabled": True, "profile": "corp:operator", "corpId": "corp",
            "unifiedAppId": "app", "robotCode": "robot", "robotName": "志高助手",
            "groups": [{"id": "group", "name": "测试群聊"}],
            "bindings": [{"senderId": "staff", "ownerEmail": self.owner.email, "role": self.owner.role, "scope": self.owner.scope}]}
        dingtalk_settings.initialize(self.config)
        self.payload = {"name": "日报", "prompt": "查询昨日经营概览", "cadence": "daily", "hour": 9, "minute": 0,
            "day": 1, "targetType": "person", "targetId": "staff", "senderId": "staff", "enabled": True}

    def test_shanghai_next_slot_and_month_boundary(self):
        at = datetime(2026, 1, 31, 1, 0, tzinfo=utc.utc)
        self.assertEqual(schedules.next_slot("daily", 9, 0, 1, at).isoformat(), "2026-02-01T01:00:00+00:00")
        self.assertEqual(schedules.next_slot("monthly", 9, 0, 28, at).isoformat(), "2026-02-28T01:00:00+00:00")
        self.assertEqual(schedules.next_slot("weekly", 9, 0, 1, at).weekday(), 0)

    def test_subscription_failure_is_recorded_without_send_or_automatic_replay(self):
        from .transport import ProviderHttpError
        item = schedules.save({**self.payload, "enabled": True}, ADMIN)["item"]
        queued = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        sender = Mock()
        failure = ProviderHttpError(400, b'{"error":{"code":"InvalidSubscription","message":"private"}}')
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.chat, "answer", side_effect=failure) as answer:
            self.assertTrue(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
            self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
        sender.assert_not_called()
        answer.assert_called_once()
        run = m.AiDingTalkScheduleRun.objects.get(pk=queued["id"])
        self.assertEqual((run.status, run.error_code), ("failed", "provider_subscription_invalid"))

    def test_text_schedule_explicitly_resolves_default_instead_of_old_session_model(self):
        item = schedules.save({**self.payload, "enabled": True}, ADMIN)["item"]
        schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        sender = Mock()
        new_default = copy.copy(self.model)
        new_default.id = "new-default"
        with patch("ai_assistant.transport.edge", side_effect=background), \
                patch.object(schedules, "resolve_model", return_value=new_default), \
                patch.object(schedules.chat, "answer", return_value={"reply": "合成结果"}) as answer:
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
        self.assertEqual(answer.call_args.args[0]["modelId"], "new-default")
        sender.assert_called_once()

    def test_denies_unbound_person_target_bad_group_scope_and_conflict(self):
        for invalid in ({"targetId": "other"}, {"targetType": "group", "targetId": "unknown"}, {"day": 29}, {"hour": 24}):
            with self.assertRaises(AiError):
                schedules.save({**self.payload, **invalid}, ADMIN)
        with self.assertRaises(AiError):
            schedules.save(self.payload, self.owner)
        item = schedules.save(self.payload, ADMIN)["item"]
        with self.assertRaises(AiError):
            schedules.save({**self.payload, "id": item["id"], "expectedVersion": 9}, ADMIN)
        self.assertEqual(m.AiDingTalkSchedule.objects.get(pk=item["id"]).version, 1)

    def test_public_api_admin_gate_and_request_receipt(self):
        self.assertEqual(tests.AiDomainTests.call(self, "/api/ai/dingtalk-schedules", principal=self.owner, method="GET").status_code, 403)
        forbidden = tests.AiDomainTests.call(self, "/api/ai/dingtalk-schedules", self.payload, self.owner, request_id="ding-schedule-forbidden")
        self.assertEqual(forbidden.status_code, 403)
        created = tests.AiDomainTests.call(self, "/api/ai/dingtalk-schedules", self.payload, ADMIN, request_id="ding-schedule-create")
        self.assertEqual(created.status_code, 200, created.content)
        replayed = tests.AiDomainTests.call(self, "/api/ai/dingtalk-schedules", self.payload, ADMIN, request_id="ding-schedule-create")
        self.assertEqual(replayed.status_code, 200)
        self.assertEqual(m.AiDingTalkSchedule.objects.count(), 1)
        self.assertEqual(tests.AiDomainTests.call(self, "/api/ai/dingtalk-schedules", principal=ADMIN, method="GET").json()["items"][0]["id"], created.json()["item"]["id"])

    def test_manual_run_is_single_queued_slot_then_sends_once(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        queued = schedules.run_now({"id": item["id"], "expectedVersion": item["version"]}, ADMIN)
        with self.assertRaises(AiError):
            schedules.run_now({"id": item["id"], "expectedVersion": item["version"]}, ADMIN)
        sender = Mock(side_effect=accepted_delivery)
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.chat, "answer", return_value={"reply": "经营结论"}) as answer:
            self.assertTrue(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=queued["id"]).status, "sent")
        self.assertEqual(sender.call_count, 1)
        self.assertEqual(sender.call_args.args[0].sender_id, "staff")
        self.assertEqual(sender.call_args.args[1], "经营结论")
        self.assertEqual(answer.call_count, 1)

    def test_manual_runs_on_same_clock_tick_get_distinct_slots(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        instant = datetime(2026, 9, 14, 1, 0, tzinfo=utc.utc)
        with patch.object(schedules.timezone, "now", return_value=instant):
            first = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
            m.AiDingTalkScheduleRun.objects.filter(pk=first["id"]).update(status="denied")
            second = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        first_at = m.AiDingTalkScheduleRun.objects.get(pk=first["id"]).scheduled_at
        second_at = m.AiDingTalkScheduleRun.objects.get(pk=second["id"]).scheduled_at
        self.assertEqual(second_at - first_at, timedelta(microseconds=1))

    def test_independent_command_holds_real_postgres_lock_while_dispatching(self):
        import io
        from django.db import connection
        from .management.commands import dingtalk_schedule as worker
        if connection.vendor != "postgresql":
            self.skipTest("Requires the isolated PostgreSQL rehearsal")
        item = schedules.save(self.payload, ADMIN)["item"]
        queued = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        delivered = []
        def send(reader, session, content, *, before_send):
            with connection.Database.connect(**connection.get_connection_params()) as contender:
                self.assertEqual(contender.execute("SELECT pg_try_advisory_lock(841327,1909)").fetchone(), (False,))
                # Chat reception is independent of the schedule lease.
                self.assertEqual(contender.execute("SELECT pg_try_advisory_lock(841327,1910)").fetchone(), (True,))
            before_send()
            delivered.append(content)
            return platform.validate_receipt({"processQueryKey": "synthetic-accepted-receipt"})
        with patch("ai_assistant.transport.edge", side_effect=background), \
                patch.object(schedules.chat, "answer", return_value={"reply": "结果"}), \
                patch.object(worker.dingtalk, "load_config", return_value=self.config), \
                patch.object(worker.platform, "credentials", return_value=("fixture", "fixture")), \
                patch.object(worker.platform, "send", side_effect=send), \
                patch.object(worker.platform, "open_stream", side_effect=AssertionError("Stream must not run")) as stream, \
                patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            worker.Command(stdout=io.StringIO()).handle(config="fixture", bot_credentials="fixture", screenshot_profile="")
        stream.assert_not_called()
        self.assertEqual(delivered, ["结果"])
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=queued["id"]).status, "sent")
        with connection.Database.connect(**connection.get_connection_params()) as contender:
            self.assertEqual(contender.execute("SELECT pg_try_advisory_lock(841327,1909)").fetchone(), (True,))

    def test_text_version_revoked_during_channel_preparation_is_checked_before_send(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        queued = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        actual_send = Mock()
        def prepare_sender(session, content, *, before_send):
            schedules.save({**self.payload, "id": item["id"], "expectedVersion": 1, "enabled": False}, ADMIN)
            before_send()
            actual_send(session, content)
        with patch("ai_assistant.transport.edge", side_effect=background), \
                patch.object(schedules.chat, "answer", return_value={"reply": "结果"}):
            schedules.step(lambda: dingtalk_settings.effective(self.config), prepare_sender)
        actual_send.assert_not_called()
        run = m.AiDingTalkScheduleRun.objects.get(pk=queued["id"])
        self.assertEqual((run.status, run.analysis_status, run.delivery_status), ("denied", "succeeded", "failed"))
        self.assertEqual(run.error_code, "access_denied")
        self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), actual_send))

    def test_delivery_ledger_separates_token_rejection_lost_receipt_and_acceptance(self):
        reader = lambda: dingtalk_settings.effective(self.config)
        token_path = urlsplit(platform.TOKEN_API).path
        recipient_path = urlsplit(platform.PERSON_MEDIA_API).path
        for case, terminal, code, stage_name, outcome in (
            ("credentials", "failed", "bot_credentials_unavailable", "credentials", "not_sent"),
            ("token", "failed", "dingtalk_token_unavailable", "token", "not_sent"),
            ("rejected", "failed", "dingtalk_send_rejected", "send_request", "rejected"),
            ("gateway", "unknown", "delivery_unknown", "send_request", "unknown"),
            ("lost", "unknown", "delivery_unknown", "send_request", "unknown"),
            ("accepted", "sent", "", "receipt", "accepted"),
        ):
            with self.subTest(case=case):
                item = schedules.save(self.payload, ADMIN)["item"]
                queued = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
                synthetic_accepts = []

                def route(host, path, body):
                    status = m.AiDingTalkScheduleRun.objects.get(pk=queued["id"]).status
                    if path == token_path:
                        self.assertEqual(status, "ready")
                        if case == "token":
                            return 401, {"code": "InvalidAccessToken", "requestId": "private-correlation-id"}
                        return 200, {"accessToken": "synthetic-access-token"}
                    self.assertEqual((path, status), (recipient_path, "sending"))
                    self.assertEqual(json.loads(body)["userIds"], ["staff"])
                    if case == "rejected":
                        return 403, {"code": "Forbidden.AccessDenied", "requestId": "private-correlation-id", "message": "private-provider-error"}
                    if case == "gateway":
                        return 503, {"code": "private-unknown-code", "requestId": "private-correlation-id"}
                    synthetic_accepts.append(path)
                    if case == "lost":
                        raise TimeoutError("lost after synthetic acceptance")
                    return 200, {"processQueryKey": "private-platform-receipt", "requestId": "private-correlation-id"}

                def credentials(config):
                    if case == "credentials":
                        raise AiError("private-credential-detail", "bot_credentials_unavailable", 503)
                    return "synthetic-key", "synthetic-secret"

                with patch("ai_assistant.transport.edge", side_effect=background), \
                        patch.object(schedules.chat, "answer", return_value={"reply": "合成结果"}) as answer, \
                        patch.object(platform, "credentials", side_effect=credentials), fake_dingtalk_wire(route) as posted:
                    sender = lambda *args, **kw: platform.send(reader, *args, **kw)
                    self.assertTrue(schedules.step(reader, sender))
                    self.assertFalse(schedules.step(reader, sender))
                answer.assert_called_once()
                run = m.AiDingTalkScheduleRun.objects.get(pk=queued["id"])
                self.assertEqual((run.status, run.error_code, run.analysis_status), (terminal, code, "succeeded"))
                expected_paths = [] if case == "credentials" else [token_path] if case == "token" else [token_path, recipient_path]
                self.assertEqual([path for _, path, _ in posted], expected_paths)
                self.assertEqual(len(synthetic_accepts), int(case in ("lost", "accepted")))
                self.assertLess(len(run.stage_details_json.encode()), 8000)
                observation = json.loads(run.stage_details_json)["delivery"]["observation"]
                self.assertEqual((observation["stage"], observation["outcome"]), (stage_name, outcome))
                self.assertGreaterEqual(observation["elapsedMs"], 0)
                for private in ("private-", "synthetic-key", "synthetic-secret", "synthetic-access-token"):
                    self.assertNotIn(private, run.stage_details_json)
                if case in ("token", "rejected", "gateway"):
                    self.assertEqual(observation["transport"]["httpStatus"], {"token": 401, "rejected": 403, "gateway": 503}[case])
                    self.assertEqual(len(observation["requestIdSha256"]), 64)
                if case == "gateway":
                    self.assertEqual(len(observation["platformCodeSha256"]), 64)
                if case == "accepted":
                    self.assertEqual(observation["recipientObservation"], "unavailable")
                    self.assertEqual(len(observation["receiptSha256"]), 64)
                else:
                    self.assertNotIn("receiptSha256", observation)

    def test_stop_before_wire_blocks_send_and_late_receipt_survives_stop(self):
        reader = lambda: dingtalk_settings.effective(self.config)
        for stop_before_wire in (True, False):
            with self.subTest(stop_before_wire=stop_before_wire):
                item = schedules.save(self.payload, ADMIN)["item"]
                queued = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
                connections = []

                def stop():
                    saved = schedules.save({**self.payload, "id": item["id"], "expectedVersion": 1, "enabled": False}, ADMIN)
                    self.assertIsNone(saved["item"]["nextRunAt"])

                def connect(address):
                    connections.append(address)
                    if len(connections) == 2 and stop_before_wire:
                        stop()

                def route(host, path, body):
                    if path.endswith("/accessToken"):
                        return 200, {"accessToken": "fixture-token"}
                    self.assertFalse(stop_before_wire)
                    stop()
                    return 200, {"processQueryKey": "fixture-receipt"}

                with patch("ai_assistant.transport.edge", side_effect=background), \
                        patch.object(schedules.chat, "answer", return_value={"reply": "合成结果"}), \
                        patch.object(platform, "credentials", return_value=("fixture", "fixture")), \
                        fake_dingtalk_wire(route, on_connect=connect) as posted:
                    sender = lambda *args, **kw: platform.send(reader, *args, **kw)
                    self.assertTrue(schedules.step(reader, sender))
                    self.assertFalse(schedules.step(reader, sender))
                run = m.AiDingTalkScheduleRun.objects.get(pk=queued["id"])
                self.assertEqual((run.status, run.analysis_status), ("denied" if stop_before_wire else "sent", "succeeded"))
                self.assertEqual(len(posted), 1 if stop_before_wire else 2)
                self.assertFalse(run.schedule.enabled)
                self.assertIsNone(run.schedule.next_run_at)

    def test_stopping_revoked_group_does_not_require_reapproval(self):
        payload = {**self.payload, "targetType": "group", "targetId": "group"}
        item = schedules.save(payload, ADMIN)["item"]
        dingtalk_settings.save({"enabled": True, "groups": [{"id": "group", "name": "测试群聊", "enabled": False}], "expectedVersion": 1}, ADMIN)
        stopped = schedules.save({**payload, "id": item["id"], "expectedVersion": 1, "enabled": False}, ADMIN)["item"]
        self.assertEqual((stopped["enabled"], stopped["nextRunAt"]), (False, None))

    def test_recovery_distinguishes_preparation_without_rewriting_legacy_unknown(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        first = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)["id"]
        m.AiDingTalkScheduleRun.objects.filter(pk=first).update(status="unknown", error_code="provider_unavailable")
        old = m.AiDingTalkScheduleRun.objects.filter(pk=first).values().get()
        second = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)["id"]
        m.AiDingTalkScheduleRun.objects.filter(pk=second).update(status="ready", analysis_status="succeeded", delivery_status="running",
            stage_details_json='{"delivery":{"observation":{"stage":"preparation","outcome":"preparing"}}}')
        schedules.recover_interrupted()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.filter(pk=first).values().get(), old)
        run = m.AiDingTalkScheduleRun.objects.get(pk=second)
        self.assertEqual((run.status, run.error_code, run.analysis_status), ("failed", "dingtalk_preparation_interrupted", "succeeded"))
        sender = Mock()
        self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
        sender.assert_not_called()

    def test_revocation_before_dispatch_and_unknown_send_do_not_retry(self):
        item = schedules.save({**self.payload, "targetType": "group", "targetId": "group"}, ADMIN)["item"]
        run = schedules.run_now({"id": item["id"], "expectedVersion": item["version"]}, ADMIN)
        dingtalk_settings.save({"enabled": True, "groups": [{"id": "group", "name": "测试群聊", "enabled": False}], "expectedVersion": 1}, ADMIN)
        sender = Mock()
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.chat, "answer") as answer:
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
        answer.assert_not_called(); sender.assert_not_called()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "denied")
        dingtalk_settings.save({"enabled": True, "groups": [{"id": "group", "name": "测试群聊", "enabled": True}], "expectedVersion": 2}, ADMIN)
        run2 = schedules.run_now({"id": item["id"], "expectedVersion": item["version"]}, ADMIN)
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.chat, "answer", return_value={"reply": "经营结论"}):
            schedules.step(lambda: dingtalk_settings.effective(self.config), Mock(side_effect=lost_delivery))
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run2["id"]).status, "unknown")
        self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
        sender.assert_not_called()

    def test_edit_fences_queued_run_and_restart_marks_unknown(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        run = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        schedules.save({**self.payload, "id": item["id"], "expectedVersion": 1, "prompt": "更新后的任务"}, ADMIN)
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.chat, "answer") as answer:
            schedules.step(lambda: dingtalk_settings.effective(self.config), Mock())
        answer.assert_not_called()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "denied")
        another = schedules.run_now({"id": item["id"], "expectedVersion": 2}, ADMIN)
        m.AiDingTalkScheduleRun.objects.filter(pk=another["id"]).update(status="sending")
        schedules.recover_interrupted()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=another["id"]).status, "unknown")

    def test_missed_automatic_slot_is_skipped_without_model_or_send(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        old = datetime.now(utc.utc) - timedelta(days=2)
        m.AiDingTalkSchedule.objects.filter(pk=item["id"]).update(next_run_at=old)
        # The sender must not be reached at all: a skipped slot is observable
        # but never a delivery. Asserting on the mock (rather than passing a
        # bare Mock() that silently absorbs a call) is what pins the
        # no-backlog policy itself, not just the recorded status.
        sender = Mock()
        with patch.object(schedules.chat, "answer") as answer:
            self.assertTrue(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
        answer.assert_not_called()
        sender.assert_not_called()
        skipped = m.AiDingTalkScheduleRun.objects.get(schedule_id=item["id"], scheduled_at=old)
        self.assertEqual((skipped.status, skipped.error_code), ("denied", "missed_window"))
        for phase in ("data", "analysis", "delivery"):
            self.assertEqual(getattr(skipped, phase + "_status"), "not_required")
        self.assertGreater(m.AiDingTalkSchedule.objects.get(pk=item["id"]).next_run_at, datetime.now(utc.utc))

    def test_admin_revocation_after_queue_prevents_ai_and_delivery(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        run = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        with patch("ai_assistant.transport.edge", side_effect=AiError("权限失效", "access_denied", 403)), patch.object(schedules.chat, "answer") as answer:
            sender = Mock()
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
        answer.assert_not_called(); sender.assert_not_called()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "denied")

    def test_stale_binding_and_inflight_edit_cannot_send(self):
        item = schedules.save(self.payload, ADMIN)["item"]
        run = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        altered = {**self.config, "bindings": [{**self.config["bindings"][0], "senderId": "different"}]}
        sender = Mock()
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.chat, "answer") as answer:
            schedules.step(lambda: dingtalk_settings.effective(altered), sender)
        answer.assert_not_called(); sender.assert_not_called()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "denied")
        run2 = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        def edit_while_running(*args, **kwargs):
            m.AiDingTalkSchedule.objects.filter(pk=item["id"]).update(version=2, enabled=False)
            return {"reply": "不应外发"}
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.chat, "answer", side_effect=edit_while_running):
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
        sender.assert_not_called()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run2["id"]).status, "denied")

    def test_screenshot_is_bounded_to_allowlisted_page_and_bot_media_sender(self):
        for source in ("settings:permissions", "https://example.com", "../inventory"):
            with self.assertRaises(AiError):
                schedules.save({**self.payload, "contentType": "screenshot", "sourceRef": source, "prompt": ""}, ADMIN)
        with self.assertRaises(AiError):
            schedules.save({**self.payload, "contentType": "screenshot", "sourceRef": [], "prompt": ""}, ADMIN)
        self.config["bindings"] = [{**self.config["bindings"][0], "ownerEmail": ADMIN.email, "role": "admin", "scope": None}]
        item = schedules.save({**self.payload, "contentType": "screenshot", "sourceRef": "dashboard:overview", "prompt": ""}, ADMIN)["item"]
        run = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        image = b"\x89PNG\r\n\x1a\nfixture"
        media_sender, text_sender = Mock(side_effect=accepted_delivery), Mock()
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.scheduled_page_capture, "capture", return_value=image) as capture, patch.object(schedules.chat, "answer") as answer:
            self.assertTrue(schedules.step(lambda: dingtalk_settings.effective(self.config), text_sender, media_sender))
        capture.assert_called_once_with("dashboard:overview", ADMIN.email)
        answer.assert_not_called(); text_sender.assert_not_called()
        self.assertEqual(media_sender.call_args.args[1:], (image, "系统页面-dashboard-overview.png", "image"))
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "sent")

    def test_report_file_requires_completed_review_and_unknown_media_is_not_retried(self):
        with patch.object(schedules.reports, "get", return_value=SimpleNamespace(workflow=SimpleNamespace(status="waiting_review", dry_run=False))):
            with self.assertRaises(AiError):
                schedules.save({**self.payload, "contentType": "report_file", "sourceRef": "report-1", "prompt": ""}, ADMIN)
        self.config["bindings"] = [{**self.config["bindings"][0], "ownerEmail": ADMIN.email, "role": "admin", "scope": None}]
        with patch.object(schedules.reports, "get", return_value=SimpleNamespace(workflow=SimpleNamespace(status="completed", dry_run=False))):
            item = schedules.save({**self.payload, "contentType": "report_file", "sourceRef": "report-1", "prompt": ""}, ADMIN)["item"]
        run = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        sender = Mock(side_effect=lost_delivery)
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.reports, "download", return_value={"base64": "UEsDBA=="}), patch.object(schedules.chat, "answer") as answer:
            schedules.step(lambda: dingtalk_settings.effective(self.config), Mock(), sender)
        answer.assert_not_called()
        self.assertEqual(sender.call_count, 1)
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "unknown")
        self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), Mock(), sender))
        self.assertEqual(sender.call_count, 1)

    def test_media_sender_scope_mismatch_denies_before_capture_or_upload(self):
        item = schedules.save({**self.payload, "contentType": "screenshot", "sourceRef": "dashboard:overview", "prompt": ""}, ADMIN)["item"]
        run = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.scheduled_page_capture, "capture") as capture:
            sender = Mock()
            schedules.step(lambda: dingtalk_settings.effective(self.config), Mock(), sender)
        capture.assert_not_called(); sender.assert_not_called()
        self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "denied")

    def test_caption_is_saved_edited_and_bounded_without_ai(self):
        payload = {**self.payload, "contentType": "screenshot", "sourceRef": "workflow:launch-followup", "prompt": "新品周销量趋势数据"}
        item = schedules.save(payload, ADMIN)["item"]
        self.assertEqual(item["prompt"], payload["prompt"])
        edited = schedules.save({**payload, "id": item["id"], "expectedVersion": 1, "prompt": "更新文案"}, ADMIN)["item"]
        self.assertEqual((edited["version"], edited["prompt"]), (2, "更新文案"))
        for invalid in (None, [], "长" * 4001):
            with self.assertRaises(AiError):
                schedules.save({**payload, "prompt": invalid}, ADMIN)

    def test_caption_and_image_use_one_delivery_without_text_or_replay(self):
        self.config["bindings"] = [{**self.config["bindings"][0], "ownerEmail": ADMIN.email, "role": "admin", "scope": None}]
        for scenario in ("success", "delivery_unknown", "edit_during_capture", "capture_failed"):
            with self.subTest(scenario=scenario):
                item = schedules.save({**self.payload, "contentType": "screenshot", "sourceRef": "workflow:launch-followup", "prompt": "新品周销量趋势数据"}, ADMIN)["item"]
                run = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
                image = b"fixture"
                def capture(*args):
                    if scenario == "capture_failed":
                        raise AiError("截图失败", "channel_unavailable", 503)
                    if scenario == "edit_during_capture":
                        m.AiDingTalkSchedule.objects.filter(pk=item["id"]).update(version=2)
                    return image
                def deliver(*args, **kwargs):
                    self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status, "ready")
                    if scenario == "delivery_unknown":
                        return lost_delivery(*args, **kwargs)
                    return accepted_delivery(*args, **kwargs)
                media, sender = Mock(side_effect=deliver), Mock()
                with patch("ai_assistant.transport.edge", side_effect=background), patch.object(schedules.scheduled_page_capture, "capture", side_effect=capture), patch.object(schedules.chat, "answer") as answer:
                    schedules.step(lambda: dingtalk_settings.effective(self.config), sender, media)
                    self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), sender, media))
                answer.assert_not_called(); sender.assert_not_called()
                if scenario in ("success", "delivery_unknown"):
                    media.assert_called_once()
                    self.assertEqual(media.call_args.args[1:], (image, "系统页面-workflow-launch-followup.png", "image", "新品周销量趋势数据"))
                else:
                    media.assert_not_called()
                self.assertEqual(m.AiDingTalkScheduleRun.objects.get(pk=run["id"]).status,
                    {"success":"sent", "delivery_unknown":"unknown", "edit_during_capture":"denied", "capture_failed":"failed"}[scenario])
