"""Background analysis-reply slots, signature-gated marker, streaming call and failed audit row."""
import os
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from django.http import JsonResponse
from django.test import TestCase, override_settings
from django.utils import timezone

from sales.auth import Principal
from . import chat, dispatch_limits, models as m, provider, views
from .control_models import AiDataRevision, AiWriteAuthority
from .policy import AiError
from . import tests as support

ADMIN = support.ADMIN
REPLY = {"operation": "analysis-reply", "prompt": "p", "systemPrompt": "s"}
BACKGROUND = {**REPLY, "background": True}


def hold(semaphore, count):
    for _ in range(count):
        assert semaphore.acquire(blocking=False)


def release(semaphore, count):
    for _ in range(count):
        semaphore.release()


class SlotIsolationTests(TestCase):
    call = support.AiDomainTests.call

    def setUp(self):
        AiDataRevision.objects.get_or_create(domain="ai-assistant")
        AiWriteAuthority.objects.update_or_create(id=1, defaults={
            "status": "postgres", "authority_epoch": "ab3213bd-2e10-4da1-b7a9-b0127eb76aaf", "cutover_id": "slot-fixture",
            "migration_verify_run_id": "slot-fixture-verify", "activated_at": timezone.now()})
        self.owner = ADMIN
        self.used = []

        def fake_dispatch(request, path=""):
            self.used.append((views._consumer_slots._value, views._background_slots._value))
            return JsonResponse({"ok": True})

        for patcher in (patch.object(views, "_dispatch", side_effect=fake_dispatch),
                        patch.object(views, "revision", return_value="1")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_background_pool_has_three_slots_and_interactive_two(self):
        self.assertEqual(views.BACKGROUND_ANALYSIS_SLOTS, 3)
        self.assertEqual(views._background_slots._value, 3)
        self.assertEqual(views._consumer_slots._value, 2)

    def test_signed_background_request_uses_background_slot_not_interactive(self):
        response = self.call("/api/ai/consumer", BACKGROUND)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.used, [(2, 2)])  # interactive untouched, one background slot held

    def test_interactive_request_uses_interactive_slot(self):
        self.assertEqual(self.call("/api/ai/consumer", REPLY).status_code, 200)
        self.assertEqual(self.used, [(1, 3)])

    def test_full_background_pool_does_not_block_interactive(self):
        hold(views._background_slots, 3)
        try:
            self.assertEqual(self.call("/api/ai/consumer", BACKGROUND).status_code, 429)
            self.assertEqual(self.call("/api/ai/consumer", REPLY).status_code, 200)
        finally:
            release(views._background_slots, 3)

    def test_full_interactive_pool_does_not_block_background(self):
        hold(views._consumer_slots, 2)
        try:
            self.assertEqual(self.call("/api/ai/consumer", REPLY).status_code, 429)
            self.assertEqual(self.call("/api/ai/consumer", BACKGROUND).status_code, 200)
        finally:
            release(views._consumer_slots, 2)

    def test_marker_without_a_valid_signature_falls_back_to_interactive_slots(self):
        secret = {"TERUISI_DJANGO_INTERNAL_SECRET": "A-valid-isolated-signing-secret-13579-abcdefghijklmnopqrstuvwxyz"}
        with patch.dict(os.environ, secret):
            unsigned = self.client.post("/api/ai/consumer", data=BACKGROUND, content_type="application/json")
            forged = self.client.post(
                "/api/ai/consumer", data=BACKGROUND, content_type="application/json",
                headers={"X-Teruisi-Principal": "e30", "X-Teruisi-Timestamp": str(int(timezone.now().timestamp())),
                         "X-Teruisi-Request-Id": "forged-1", "X-Teruisi-Content-SHA256": "0" * 64,
                         "X-Teruisi-Signature": "v1=" + "0" * 64})
        self.assertEqual(unsigned.status_code, 200)  # _dispatch is stubbed: only the slot choice matters here
        self.assertEqual(forged.status_code, 200)
        self.assertEqual(self.used, [(1, 3), (1, 3)])

    def test_forged_marker_cannot_drain_the_background_pool_and_hits_interactive_limit(self):
        hold(views._consumer_slots, 2)
        try:
            response = self.client.post("/api/ai/consumer", data=BACKGROUND, content_type="application/json")
            self.assertEqual(response.status_code, 429)
        finally:
            release(views._consumer_slots, 2)

    def test_scoped_or_low_role_principal_never_gets_background_slots(self):
        scoped = Principal("scoped@teruisi.local", "范围受限", "operator", {"warehouses": ["主仓"], "channels": [], "platforms": []})
        viewer = Principal("viewer@teruisi.local", "查看", "viewer", None)
        for principal in (scoped, viewer):
            with self.subTest(role=principal.role):
                self.used.clear()
                self.call("/api/ai/consumer", BACKGROUND, principal)
                self.assertEqual(self.used, [(1, 3)])

    def test_non_boolean_marker_is_not_honoured(self):
        self.call("/api/ai/consumer", {**REPLY, "background": "true"})
        self.assertEqual(self.used, [(1, 3)])

    def test_background_marker_only_applies_to_analysis_reply(self):
        self.call("/api/ai/consumer", {**REPLY, "operation": "analysis-plan", "background": True})
        self.assertEqual(self.used, [(1, 3)])


@contextmanager
def no_mutation(_principal):
    yield


class AnalysisReplyHandlerTests(TestCase):
    def setUp(self):
        self.model = MagicMock(id="model-1")
        self.audits = []
        for patcher in (
            patch.object(views.configuration, "resolve_model", return_value=self.model),
            patch.object(views, "mutation", no_mutation),
            patch.object(chat, "dispatch_budget"),
            patch.object(chat, "audit", side_effect=lambda *args, **kwargs: self.audits.append((args[2:4], kwargs))),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_reply(self, payload=REPLY):
        return views.consumer(dict(payload), ADMIN, "request-1")

    def test_model_is_called_through_the_streaming_path(self):
        with patch.object(provider, "turn", return_value={"text": "答"}) as turn:
            self.assertEqual(self.run_reply(), {"reply": "答"})
        self.assertTrue(callable(turn.call_args.kwargs["on_text"]))
        turn.call_args.kwargs["on_text"]("chunk")  # a no-op sink, must not raise
        self.assertEqual([entry[0] for entry in self.audits], [("configured_analysis", "started"), ("configured_analysis", "succeeded")])

    def test_provider_failure_writes_failed_audit_and_reraises(self):
        with patch.object(provider, "turn", side_effect=AiError("慢", "provider_timeout", 503)):
            with self.assertRaises(AiError) as caught:
                self.run_reply()
        self.assertEqual(caught.exception.code, "provider_timeout")
        statuses = [entry[0] for entry in self.audits]
        self.assertEqual(statuses, [("configured_analysis", "started"), ("configured_analysis", "failed")])
        failed = self.audits[-1][1]
        self.assertEqual(failed["error_code"], "provider_timeout")
        self.assertGreaterEqual(failed["duration"], 0)

    def test_unexpected_error_is_audited_and_original_error_preserved_even_if_audit_fails(self):
        calls = {"n": 0}

        def audit(*args, **kwargs):
            calls["n"] += 1
            if args[3] == "failed":
                raise RuntimeError("audit down")

        with patch.object(chat, "audit", side_effect=audit), patch.object(provider, "turn", side_effect=ValueError("bad")):
            with self.assertRaises(ValueError):
                self.run_reply()
        self.assertEqual(calls["n"], 2)

    def test_background_field_must_be_boolean(self):
        with patch.object(provider, "turn", return_value={"text": "x"}):
            with self.assertRaises(AiError):
                self.run_reply({**REPLY, "background": "yes"})
            self.assertEqual(self.run_reply(BACKGROUND), {"reply": "x"})


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class FailedAuditNotCountedTests(TestCase):
    def test_failed_rows_do_not_count_against_the_dispatch_budget(self):
        chat.audit(ADMIN, "r1", "configured_analysis", "started", arguments={"modelId": "model-1"})
        chat.audit(ADMIN, "r1", "configured_analysis", "failed", error_code="provider_timeout", duration=5)
        self.assertEqual(m.AiToolAuditLogs.objects.filter(tool_name="configured_analysis").count(), 2)
        env = {"TERUISI_AI_DISPATCH_DAILY_LIMIT_GLOBAL": "2", "TERUISI_AI_DISPATCH_DAILY_LIMIT_PER_OWNER": "2",
               "TERUISI_AI_DISPATCH_DAILY_LIMIT_PER_MODEL": "2"}
        with patch.dict(os.environ, env):
            chat.dispatch_budget(ADMIN.email.lower(), "model-1")  # one started row, two allowed
        with patch.dict(os.environ, {**env, "TERUISI_AI_DISPATCH_DAILY_LIMIT_GLOBAL": "1"}):
            with self.assertRaises(AiError):
                chat.dispatch_budget(ADMIN.email.lower(), "model-1")
