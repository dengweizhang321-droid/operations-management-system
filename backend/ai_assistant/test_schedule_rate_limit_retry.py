"""Fixed monitor analysis retries transient provider 429 with bounded backoff; nothing else does."""
import json
from unittest.mock import MagicMock, patch

from django.test import TransactionTestCase, override_settings

from . import chat, models as m, provider, transport, tests as support
from .policy import AiError


def ok(text="确认本轮事实。"):
    return {"text": text, "calls": [], "frame": {"role": "assistant", "content": text}, "usage": {}, "truncated": False}


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class ScheduledRateLimitRetryTests(TransactionTestCase):
    setUp = support.AiDomainTests.setUp
    user = support.AiDomainTests.user

    def run_case(self, outcomes, *, scheduled=True, client_id="rl", guard=None, sleep=None):
        self.slept = []
        self.http = self.enterContext(patch.object(provider, "turn", side_effect=outcomes))
        self.enterContext(patch.object(chat, "_rate_limit_sleep", side_effect=sleep or self.slept.append))
        self.enterContext(patch.object(transport, "catalog", return_value=[]))
        body = {"clientRequestId": client_id, "modelId": self.model.id, "conversationId": None,
                "workspaceModule": "ai", "message": "解读监控事实"}
        if not scheduled:
            return chat.answer(body, self.owner, client_id)
        session = m.AiDingTalkSession.objects.create(id="session-" + client_id, config_digest="a" * 64,
            corp_id="fixture", robot_code="fixture", sender_id="fixture", conversation_type="1",
            external_conversation_id="fixture", owner_email=self.owner.email)
        analysis = {"facts": {"businessDate": "2026-10-15", "count": 2}, "systemPrompt": "仅解释库存事实。"}
        return chat.answer(body, self.owner, client_id, dingtalk_session=session,
                           channel_guard=guard or MagicMock(), scheduled_analysis=analysis)

    def failed(self, client_id):
        return m.AiToolAuditLogs.objects.filter(request_id=client_id, status="failed", tool_name="ai_chat_provider")

    def test_two_429_then_success_waits_30_then_60(self):
        result = self.run_case([transport.ProviderHttpError(429), transport.ProviderHttpError(429), ok()])
        self.assertEqual(result["reply"], "确认本轮事实。")
        self.assertEqual(self.http.call_count, 3)
        self.assertEqual(sum(self.slept), 90)
        self.assertEqual(self.slept[:30], [1.0] * 30)
        self.assertEqual(self.failed("rl").count(), 2)
        self.assertEqual({row.error_code for row in self.failed("rl")}, {"provider_rate_limited"})
        self.assertEqual(m.AiChatProviderDispatches.objects.count(), 3)
        message = m.AiConversationMessages.objects.filter(role="assistant").get()
        self.assertEqual(json.loads(message.execution_json)["rateLimitRetries"], 2)

    def test_backoff_schedule_is_30_60_90(self):
        calls = []
        with patch.object(chat, "_rate_limit_wait", side_effect=lambda seconds, *a: calls.append(seconds)):
            self.run_case([transport.ProviderHttpError(429)] * 3 + [ok()], client_id="sched")
        self.assertEqual(calls, [30, 60, 90])

    def test_four_429_stops_after_three_retries(self):
        with self.assertRaises(AiError) as caught:
            self.run_case([transport.ProviderHttpError(429)] * 4, client_id="four")
        self.assertEqual(caught.exception.code, "provider_rate_limited")
        self.assertEqual(self.http.call_count, 4)
        self.assertEqual(sum(self.slept), 180)
        self.assertEqual(self.failed("four").count(), 4)

    def test_ordinary_chat_does_not_retry_429(self):
        with self.assertRaises(AiError) as caught:
            self.run_case([transport.ProviderHttpError(429), ok()], scheduled=False, client_id="plain")
        self.assertEqual(caught.exception.code, "provider_rate_limited")
        self.assertEqual(self.http.call_count, 1)
        self.assertEqual(self.slept, [])

    def test_scheduled_non_429_error_does_not_retry(self):
        with self.assertRaises(AiError) as caught:
            self.run_case([transport.ProviderHttpError(500), ok()], client_id="http500")
        self.assertEqual(caught.exception.code, "provider_error")
        self.assertEqual(self.http.call_count, 1)
        self.assertEqual(self.slept, [])

    def test_insufficient_budget_raises_without_waiting(self):
        with patch.object(transport, "remaining_budget", return_value=40):
            with self.assertRaises(AiError):
                self.run_case([transport.ProviderHttpError(429), ok()], client_id="budget")
        self.assertEqual(self.http.call_count, 1)
        self.assertEqual(self.slept, [])

    def test_revocation_during_backoff_stops_waiting(self):
        guard = MagicMock()
        slept = []

        def sleep(seconds):
            slept.append(seconds)
            if len(slept) == 3:  # the guard is only armed once we are inside the wait
                guard.side_effect = AiError("任务或执行槽已变化", "access_denied", 403)

        with self.assertRaises(AiError) as caught:
            self.run_case([transport.ProviderHttpError(429), ok()], client_id="revoked", guard=guard, sleep=sleep)
        self.assertEqual(caught.exception.code, "access_denied")
        self.assertEqual(self.http.call_count, 1)
        self.assertEqual(len(slept), 3)
        self.assertLess(sum(slept), 30)
