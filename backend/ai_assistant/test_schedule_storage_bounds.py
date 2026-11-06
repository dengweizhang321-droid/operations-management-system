"""Exercise schedule writers against the real PostgreSQL byte CHECKs.

Run with tools/ai-postgres-rehearsal.py --tests-only. No provider, browser or
external DingTalk call is made; only their boundary responses are synthetic.
"""
import json
from datetime import datetime, timezone as utc
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import connection, IntegrityError, transaction
from django.test import TestCase, override_settings

from . import configuration, dingtalk_settings, dingtalk_schedules as schedules
from . import models as m, schedule_monitor as monitor
from . import test_dingtalk_schedules as fixture, test_schedule_monitor as monitor_fixture
from .policy import AiError, canonical
from .provider_contract import InvalidProviderResponse
from .transport import ProviderHttpError, ProviderTransportError, CancellationCheckError
from .tests import ADMIN


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class ScheduleStorageBoundsTests(TestCase):
    user = fixture.DingTalkScheduleTests.user

    def setUp(self):
        cfg = connection.settings_dict
        if connection.vendor != "postgresql":
            self.skipTest("byte CHECK proof requires isolated PostgreSQL")
        self.assertEqual(cfg["HOST"], "127.0.0.1")
        self.assertTrue(55440 <= int(cfg["PORT"]) <= 55999)
        self.assertIn("teruisi_ai_rehearsal", cfg["NAME"])
        fixture.DingTalkScheduleTests.setUp(self)
        self.config["bindings"] = [{**self.config["bindings"][0],
            "ownerEmail": ADMIN.email, "scope": None, "role": "admin"}]

    def prepare(self, **changes):
        item = schedules.save({**self.payload, **changes}, ADMIN)["item"]
        result = schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
        return m.AiDingTalkScheduleRun.objects.get(pk=result["id"])

    def assert_stored_bounds(self, run):
        run.refresh_from_db()
        with connection.cursor() as cursor:
            cursor.execute("""SELECT octet_length(model_snapshot_json), octet_length(facts_json),
                octet_length(stage_details_json), octet_length(content_text), char_length(error_code)
                FROM ai_dingtalk_schedule_runs WHERE id=%s""", [run.id])
            sizes = cursor.fetchone()
        for actual, maximum in zip(sizes, (8000, 160000, 8000, 16000, 64)):
            self.assertLessEqual(actual, maximum)
        for field in ("model_snapshot_json", "facts_json", "stage_details_json"):
            self.assertIsInstance(json.loads(getattr(run, field)), dict)
        return sizes

    def test_prompt_and_screenshot_content_reach_exact_16000_bytes(self):
        prompt = "\U0001f600" * 4000
        run = self.prepare(contentType="screenshot", sourceRef="inventory:overview", prompt=prompt)
        sender = Mock()
        media = Mock(side_effect=lambda *a, before_send: before_send())
        with patch("ai_assistant.transport.edge", side_effect=fixture.background), \
                patch.object(schedules.scheduled_page_capture, "capture", return_value=b"synthetic-image"):
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender, media)
        self.assertEqual(self.assert_stored_bounds(run)[3], 16000)
        self.assertEqual((run.status, run.content_text), ("sent", prompt))
        media.assert_called_once()
        sender.assert_not_called()
        with self.assertRaises(AiError) as rejected:
            schedules.save({**self.payload, "prompt": prompt + "x"}, ADMIN)
        self.assertEqual(rejected.exception.code, "payload_too_large")

    def test_model_snapshot_counts_json_escaping_and_open_reply_normalization(self):
        maximum = 2**53 - 1
        configuration.save_model({"id": self.model.id, "expectedVersion": 1,
            "name": "A" + "\x01" * 99, "modelName": "B" + "\x02" * 119,
            "baseUrl": self.model.base_url, "protocol": "openai_compatible", "modelType": "text",
            "isDefaultTextModel": True, "maxTokens": maximum // 2,
            "maxToolRounds": maximum, "maxTotalToolCalls": maximum,
            "generationOptions": {"contextWindowTokens": maximum, "taskTimeoutMs": maximum}}, ADMIN)
        self.model.refresh_from_db()
        run = self.prepare(modelId=self.model.id, prompt="\U0001f600" * 4000)
        # '<' and '@' expand from one to three UTF-8 bytes during sanitization;
        # the final length cap, rather than the provider's input size, applies.
        sender = Mock(side_effect=lambda *a, before_send: before_send())
        with patch("ai_assistant.transport.edge", side_effect=fixture.background), \
                patch.object(schedules.chat, "answer", return_value={"reply": "<@\U0001f600" * 1000}):
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
        sizes = self.assert_stored_bounds(run)
        self.assertEqual(run.status, "sent")
        self.assertGreater(sizes[0], 1600)  # Escaped controls really reached storage.
        self.assertEqual(json.loads(run.model_snapshot_json), schedules.model_snapshot(self.model))
        self.assertEqual(run.content_text, "＜＠\U0001f600" * 1000)
        self.assertEqual(sizes[3], 10000)

    def test_fact_character_limit_includes_serialization_before_digest_and_pg_write(self):
        fresh, data = monitor_fixture.sample(count=60)
        # 20-row pages, each text field <= the central adapter's 500 character
        # scalar cap. Use four-byte Unicode, not an impossible giant field.
        for row in data["items"]:
            row["productName"] = ""
            row["specification"] = ""
        def edge(action, payload, principal):
            if action == "authorize_background":
                return fixture.background()
            if action == "catalog":
                return {"entries": [{"name": "get_data_freshness"}, {"name": "get_inventory_page_data"}]}
            return monitor_fixture.bridge(fresh, data)(payload["name"], payload["arguments"])
        with patch("ai_assistant.transport.edge", side_effect=edge):
            baseline = monitor.collect(ADMIN, "measure", fresh["currentBusinessDate"], Mock())
            del baseline["factsDigest"]
            remaining = 40000 - len(canonical(baseline))
            self.assertGreater(remaining, 0)
            for row in data["items"]:
                length = min(500, remaining)
                row["productName"] = "\U0001f600" * length
                remaining -= length
            self.assertEqual(remaining, 0)
            facts = monitor.collect(ADMIN, "measure", fresh["currentBusinessDate"], Mock())
            undigested = {key: value for key, value in facts.items() if key != "factsDigest"}
            self.assertEqual(len(canonical(undigested)), 40000)
            self.assertEqual(len(canonical(facts)), 40081)
            run = self.prepare(executionMode="guangdong_monitor")
            # The fact write precedes rendering. A genuine validation error then
            # exercises the failure stages without inventing a long AiError code.
            with patch.object(schedules.chat, "answer", return_value={"reply": "{}"}):
                schedules.step(lambda: dingtalk_settings.effective(self.config), Mock())
            self.assertEqual(self.assert_stored_bounds(run)[1], len(canonical(facts).encode()))
            self.assertEqual(run.error_code, "schedule_analysis_invalid")
            data["items"][-1]["specification"] = "x"
            with self.assertRaises(AiError) as rejected:
                monitor.collect(ADMIN, "measure", fresh["currentBusinessDate"], Mock())
            self.assertEqual(rejected.exception.code, "schedule_data_invalid")

    def test_upstream_error_codes_are_fixed_before_stage_and_run_writes(self):
        body = canonical({"error": {"code": "\U0001f600" * 3000, "message": "private"}}).encode()
        failures = [(ProviderHttpError(400, body), "provider_error"),
            (ProviderHttpError(429, body), "provider_rate_limited"),
            (ProviderHttpError(400, b'{"error":{"code":"InvalidSubscription"}}'), "provider_subscription_invalid"),
            (InvalidProviderResponse("\U0001f600" * 3000), "invalid_provider_response"),
            (ProviderTransportError(stage="system_dns", reason="timeout"), "provider_dns_timeout"),
            (CancellationCheckError(), "ai_cancellation_check_unavailable")]
        for failure, code in failures:
            with self.subTest(code=code):
                run = self.prepare()
                sender = Mock()
                with patch("ai_assistant.transport.edge", side_effect=fixture.background), \
                        patch.object(schedules.chat, "answer", side_effect=failure):
                    schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
                self.assert_stored_bounds(run)
                self.assertEqual(run.error_code, code)
                self.assertEqual(json.loads(run.stage_details_json)["analysis"]["errorCode"], code)
                self.assertEqual(set(json.loads(run.stage_details_json)), {"data", "analysis", "delivery"})
                sender.assert_not_called()

    def test_recovery_overwrites_fixed_phase_fields_instead_of_appending_history(self):
        run = self.prepare(executionMode="guangdong_monitor")
        fresh, data = monitor_fixture.sample()
        def edge(action, payload, principal):
            if action == "authorize_background":
                return fixture.background()
            if action == "catalog":
                return {"entries": [{"name": "get_data_freshness"}, {"name": "get_inventory_page_data"}]}
            return monitor_fixture.bridge(fresh, data)(payload["name"], payload["arguments"])
        stamp = datetime.now(utc.utc).replace(microsecond=999999)
        # Simulate process exit after the actual send reservation, bypassing
        # Exception handling exactly as a killed process would.
        with patch.object(schedules.timezone, "now", return_value=stamp), \
                patch("ai_assistant.transport.edge", side_effect=edge), \
                patch.object(schedules.chat, "answer", side_effect=lambda *a, **kw:
                    {"reply": monitor_fixture.analysis(kw["scheduled_analysis"]["facts"])}):
            with self.assertRaises(SystemExit):
                schedules.step(lambda: dingtalk_settings.effective(self.config), Mock(side_effect=SystemExit))
            schedules.recover_interrupted()
            run.refresh_from_db()
            before = run.stage_details_json
            schedules.recover_interrupted()
            self.assert_stored_bounds(run)
        self.assertEqual(run.stage_details_json, before)
        self.assertEqual(run.error_code, "interrupted_result_unknown")
        details = json.loads(before)
        self.assertEqual(set(details), {"data", "analysis", "delivery"})
        for value in details.values():
            self.assertEqual(set(value), {"startedAt", "completedAt", "errorCode"})
        self.assertEqual(details["delivery"]["errorCode"], "interrupted_result_unknown")
        self.assertEqual(len(before.encode()), 395)

    def test_report_file_stores_no_attachment_bytes_or_unbounded_source_text(self):
        with patch.object(schedules.reports, "get", return_value=SimpleNamespace(
                workflow=SimpleNamespace(status="completed", dry_run=False))):
            run = self.prepare(contentType="report_file", sourceRef="report-" + "a" * 153, prompt="")
        media = Mock(side_effect=lambda *a, before_send: before_send())
        with patch("ai_assistant.transport.edge", side_effect=fixture.background), \
                patch.object(schedules.reports, "download", return_value={"base64": "UEsDBA=="}):
            schedules.step(lambda: dingtalk_settings.effective(self.config), Mock(), media)
        self.assert_stored_bounds(run)
        self.assertEqual((run.status, run.content_text), ("sent", ""))
        self.assertEqual(run.schedule.source_ref, "report-" + "a" * 153)
        media.assert_called_once()

    def test_installed_checks_reject_oversize_bytes_without_relying_on_char_count(self):
        run = self.prepare()
        # A negative control proves these are real PG CHECK tests; it is not a
        # claim that public callers may directly update schedule artifacts.
        for field, maximum in (("model_snapshot_json", 8000), ("facts_json", 160000),
                               ("stage_details_json", 8000), ("content_text", 16000)):
            value = "\U0001f600" * (maximum // 4 + 1)
            if field.endswith("_json"):
                value = canonical({"value": value})
            with self.subTest(field=field), self.assertRaises(IntegrityError), transaction.atomic():
                m.AiDingTalkScheduleRun.objects.filter(pk=run.id).update(**{field: value})
        self.assert_stored_bounds(run)
