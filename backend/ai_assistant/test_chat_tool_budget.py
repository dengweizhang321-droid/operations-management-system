"""Chat must finish from available evidence without bypassing tool admission."""
from copy import deepcopy
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import chat, models as m, provider
from .policy import AiError, canonical, digest
from .test_dataset_chat import wire
from . import tests as support


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class ChatToolBudgetTests(TestCase):
    user = support.AiDomainTests.user

    def setUp(self):
        support.AiDomainTests.setUp(self)
        self.entries = deepcopy(support.CATALOG)
        self.entries[0]["execution"]["maxCallsPerRequest"] = 2

    def run_chat(self, responses, execute=None, request="budget"):
        return (
            patch.object(chat.transport, "catalog", return_value=self.entries),
            patch.object(chat.transport, "execute_tool", side_effect=execute or (lambda *args, **kwargs: {"ok": True, "data": {"through": "2026-09-09"}})),
            patch.object(provider, "decrypt", return_value="isolated-fixture-key"),
            patch.object(provider, "bounded_json", side_effect=responses),
        )

    def test_parameter_failure_then_success_then_exhausted_tool_still_answers(self):
        for protocol in ["openai_compatible", "anthropic"]:
            with self.subTest(protocol=protocol):
                self.model.protocol = protocol
                self.model.save(update_fields=["protocol"])
                responses = [wire(protocol, "get_data_freshness", {}) for _ in range(3)]
                responses.append(wire(protocol, answer="已获得数据截止日期；其余范围未查询。"))
                attempts = iter([
                    {"ok": False, "error": {"code": "invalid_tool_arguments"}},
                    {"ok": True, "data": {"through": "2026-09-09"}},
                ])
                patches = self.run_chat(responses, lambda *a, **kw: next(attempts))
                with patches[0], patches[1] as source, patches[2], patches[3] as http:
                    body = {"clientRequestId": protocol, "message": "分析库存"}
                    answer = chat.answer(body, self.owner, protocol)
                    self.assertEqual(answer["outcome"], "answered")
                    self.assertEqual(source.call_count, 2)
                    self.assertEqual(http.call_count, 4)
                    bodies = [call.args[1] for call in http.call_args_list]
                    self.assertIn("剩余最多 2 次", canonical(bodies[0]["tools"]))
                    self.assertIn("剩余最多 1 次", canonical(bodies[1]["tools"]))
                    self.assertNotIn("tools", bodies[2])
                    self.assertNotIn("tools", bodies[3])
                    self.assertIn("tool_limit_exceeded", canonical(bodies[3]["messages"]))
                    self.assertIn("2026-09-09", canonical(bodies[3]["messages"]))
                    self.assertEqual(source.call_args.kwargs["policy_digest"], digest(self.entries))
                    self.assertEqual(chat.answer(body, self.owner, "replay"), answer)
                    self.assertEqual(http.call_count, 4)
                denied = m.AiToolAuditLogs.objects.get(request_id=protocol, status="denied")
                self.assertEqual(denied.error_code, "tool_limit_exceeded")
                self.assertEqual(denied.provider_call_id, "fixture-call")

    def test_total_limit_and_final_round_never_execute_extra_calls(self):
        for reason in ["total", "rounds"]:
            with self.subTest(reason=reason):
                self.model.max_total_tool_calls = 1 if reason == "total" else 12
                self.model.max_tool_rounds = 6 if reason == "total" else 2
                self.model.save()
                responses = [wire("openai_compatible", "get_data_freshness", {}),
                             wire("openai_compatible", answer="按已有数据回答。")]
                patches = self.run_chat(responses)
                with patches[0], patches[1] as source, patches[2], patches[3] as http:
                    answer = chat.answer({"clientRequestId": reason, "message": "查询"}, self.owner, reason)
                    self.assertEqual(answer["outcome"], "answered")
                    self.assertEqual(source.call_count, 1)
                    self.assertNotIn("tools", http.call_args.args[1])
                    self.assertIn("只生成最终回答", canonical(http.call_args.args[1]))

    def test_batch_only_admits_calls_within_total_budget(self):
        self.model.max_total_tool_calls = 1
        self.model.save()
        batch = wire("openai_compatible", "get_data_freshness", {})
        calls = batch["choices"][0]["message"]["tool_calls"]
        calls.append({**deepcopy(calls[0]), "id": "second-call"})
        patches = self.run_chat([batch, wire("openai_compatible", answer="只读取了一次水位。")])
        with patches[0], patches[1] as source, patches[2], patches[3] as http:
            chat.answer({"clientRequestId": "batch", "message": "查询"}, self.owner, "batch")
            self.assertEqual(source.call_count, 1)
            self.assertEqual(sum(frame["role"] == "tool" for frame in http.call_args.args[1]["messages"]), 2)
        self.assertEqual(m.AiToolAuditLogs.objects.get(status="denied").provider_call_id, "second-call")

    def test_unknown_tool_remains_denied_and_is_audited(self):
        patches = self.run_chat([wire("openai_compatible", "unregistered_write", {})])
        with patches[0], patches[1] as source, patches[2], patches[3]:
            with self.assertRaises(AiError) as error:
                chat.answer({"clientRequestId": "denied", "message": "查询"}, self.owner, "denied")
            self.assertEqual(error.exception.code, "access_denied")
            source.assert_not_called()
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())
        self.assertEqual(m.AiToolAuditLogs.objects.get(status="denied").error_code, "access_denied")

    def test_rejection_audit_failure_closes_without_final_provider_call(self):
        self.entries[0]["execution"]["maxCallsPerRequest"] = 1
        patches = self.run_chat([wire("openai_compatible", "get_data_freshness", {})] * 2)
        real_audit = chat.audit
        def broken_audit(*args, **kwargs):
            if args[3] == "denied":
                raise AiError("audit unavailable", "service_unavailable", 503)
            return real_audit(*args, **kwargs)
        with patches[0], patches[1] as source, patches[2], patches[3] as http, patch.object(chat, "audit", side_effect=broken_audit):
            with self.assertRaises(AiError):
                chat.answer({"clientRequestId": "audit-fail", "message": "查询"}, self.owner, "audit-fail")
            self.assertEqual(source.call_count, 1)
            self.assertEqual(http.call_count, 2)
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())

    def test_provider_ignoring_final_answer_instruction_is_bounded(self):
        self.model.max_tool_rounds = 2
        self.model.save()
        patches = self.run_chat([wire("openai_compatible", "get_data_freshness", {})] * 2)
        with patches[0], patches[1] as source, patches[2], patches[3] as http:
            with self.assertRaises(AiError) as error:
                chat.answer({"clientRequestId": "stubborn", "message": "查询"}, self.owner, "stubborn")
            self.assertEqual(error.exception.code, "tool_limit_exceeded")
            self.assertEqual(source.call_count, 1)
            self.assertEqual(http.call_count, 2)
