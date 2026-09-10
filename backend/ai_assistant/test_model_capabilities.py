import json
from unittest.mock import patch
from django.test import TestCase, SimpleTestCase, override_settings
from . import model_capabilities as c, provider, chat, transport, tests as support, models as m
from .policy import AiError, canonical, mutation
from .configuration import save_model, model_record


class CapabilityValidationTests(SimpleTestCase):
    def validate(self, value, **kw):
        return c.validate(value, **{"protocol":"openai_compatible", "max_tokens":65536, "timeout_ms":120000, "reasoning_mode":"auto", **kw})

    def test_high_output_context_and_long_budget_are_explicit(self):
        self.assertEqual(self.validate({"contextWindowTokens":128000, "taskTimeoutMs":600000})["taskTimeoutMs"], 600000)
        for value in [{"contextWindowTokens":65536}, {"taskTimeoutMs":120000}, {"contextWindowTokens":2000001}, {"taskTimeoutMs":900001}, {"unknown":1}, {"includeStreamUsage":1}]:
            with self.subTest(value=value), self.assertRaises(AiError): self.validate(value)

    def test_protocol_mismatch_and_incompatible_thinking_are_rejected(self):
        for value, kw in [({"reasoningFormat":"anthropic_budget"}, {}), ({"reasoningFormat":"reasoning_effort"}, {"protocol":"anthropic"}), ({"reasoningFormat":"anthropic_budget", "temperatureMode":"default", "thinkingBudgetTokens":65536}, {"protocol":"anthropic"}), ({"reasoningFormat":"anthropic_adaptive"}, {"protocol":"anthropic"})]:
            with self.subTest(value=value), self.assertRaises(AiError): self.validate(value, **kw)

    def test_nested_budget_never_extends_the_channel_deadline(self):
        with transport.request_budget(30):
            before = transport.remaining_budget(1000)
            with transport.request_budget(900):
                transport.limit_request_budget(600)
                self.assertLessEqual(transport.remaining_budget(1000), before)

    def test_usage_absence_is_not_zero_and_only_bounded_numbers_are_exposed(self):
        self.assertEqual(c.usage_numbers({}), {"inputTokens":None,"outputTokens":None,"reasoningTokens":None})
        self.assertEqual(c.usage_numbers({"prompt_tokens":3,"completion_tokens":8,"completion_tokens_details":{"reasoning_tokens":5},"secret":"x"}), {"inputTokens":3,"outputTokens":8,"reasoningTokens":5})
        self.assertIsNone(c.usage_numbers({"input_tokens":True})["inputTokens"])


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class CapabilityChatTests(TestCase):
    user = support.AiDomainTests.user
    call = support.AiDomainTests.call
    setUp = support.AiDomainTests.setUp

    def test_save_high_limits_cas_and_readback_preserve_options_without_touching_old_defaults(self):
        admin = self.user("capability-admin@example.invalid", "admin", None)
        body = {"id":self.model.id,"expectedVersion":1,"name":"测试模型","modelName":"fixture","protocol":"openai_compatible","modelType":"vision","maxTokens":65536,"timeoutMs":300000,"generationOptions":{"contextWindowTokens":256000,"taskTimeoutMs":600000,"temperatureMode":"default"}}
        with mutation(admin): save_model(body, admin)
        self.model.refresh_from_db()
        self.assertEqual(self.model.max_tokens,65536)
        self.assertEqual(model_record(self.model)["generationOptions"]["taskTimeoutMs"],600000)
        with self.assertRaises(AiError), mutation(admin): save_model(body, admin)
        with self.assertRaises(AiError), mutation(self.owner): save_model({**body,"expectedVersion":2},self.owner)

    def test_request_parameters_and_stream_usage_follow_explicit_format(self):
        self.model.max_tokens=65536
        self.model.generation_options_json=canonical({"contextWindowTokens":256000,"temperatureMode":"default","reasoningFormat":"reasoning_effort","reasoningEffort":"high","outputTokenParameter":"max_completion_tokens","includeStreamUsage":True})
        seen=[]
        def request(url, body, headers, **kw):
            seen.append(body)
            return {"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20}}
        with patch.object(provider,"decrypt",return_value="fixture"),patch.object(provider,"bounded_sse",side_effect=request):
            result=provider.turn(self.model,[{"role":"user","content":"问题"}],"system",[],on_text=lambda _:None)
        self.assertEqual(seen[0]["max_completion_tokens"],65536)
        self.assertNotIn("max_tokens",seen[0]); self.assertNotIn("temperature",seen[0]); self.assertNotIn("thinking",seen[0])
        self.assertEqual(seen[0]["reasoning_effort"],"high")
        self.assertEqual(seen[0]["stream_options"],{"include_usage":True})
        self.assertEqual(result["stopReason"],"stop")

    def test_anthropic_budget_and_adaptive_send_only_the_chosen_contract(self):
        self.model.protocol="anthropic";self.model.max_tokens=16000
        for mode in ["anthropic_budget","anthropic_adaptive"]:
            self.model.generation_options_json=canonical({"reasoningFormat":mode,"temperatureMode":"default","thinkingBudgetTokens":8000})
            values=c.provider_parameters(self.model)
            self.assertNotIn("temperature",values)
            self.assertEqual(values["thinking"],{"type":"enabled","budget_tokens":8000} if mode=="anthropic_budget" else {"type":"adaptive"})

    def test_context_discards_complete_old_turns_and_refuses_oversized_live_tools(self):
        self.model.generation_options_json=canonical({"contextWindowTokens":8192})
        self.model.max_tokens=1024
        transcript=[{"role":"user","content":"旧"*8000},{"role":"assistant","content":"旧回答"},{"role":"user","content":"当前问题"}]
        kept,info=c.fit_context(self.model,transcript,"system",[])
        self.assertEqual(kept,[transcript[-1]]);self.assertEqual(info["droppedMessages"],2)
        with self.assertRaises(AiError): c.fit_context(self.model,[transcript[-1],{"role":"tool","content":"大"*10000}],"system",[])

    def test_long_answer_survives_storage_readback_and_has_real_usage(self):
        answer="回答"*30000
        result={"text":answer,"calls":[],"frame":{"role":"assistant","content":answer},"usage":{"prompt_tokens":12,"completion_tokens":30000},"stopReason":"length","truncated":True}
        with patch.object(chat.transport,"catalog",return_value=[]),patch.object(provider,"turn",return_value=result) as dispatch:
            body={"clientRequestId":"long-capability","message":"请给详细分析"}
            reply=chat.answer(body,self.owner,"capability")
            self.assertEqual(reply["reply"],answer)
            self.assertEqual(reply["execution"]["outputTokens"],30000)
            self.assertTrue(reply["execution"]["outputTruncated"])
            self.assertEqual(chat.answer(body,self.owner,"replay"),reply)
            self.assertEqual(dispatch.call_count,1)
        listed=chat.messages({"conversationId":reply["conversationId"]},self.owner)
        self.assertTrue(listed["items"][-1]["contentTruncated"])
        full=chat.messages({"conversationId":reply["conversationId"],"messageId":reply["assistantMessageId"]},self.owner)
        self.assertEqual(full["items"][0]["content"],answer)
        self.assertFalse(full["items"][0]["contentTruncated"])
        self.assertEqual(full["items"][0]["execution"],reply["execution"])
        with self.assertRaises(AiError): chat.messages({"conversationId":reply["conversationId"],"messageId":reply["assistantMessageId"]},self.other)

    def test_more_than_twenty_history_messages_are_available_before_budgeting(self):
        conv=m.AiConversations.objects.create(id="history-budget",title="历史",created_by=self.owner.email)
        for i in range(30): chat.append(conv.id,"user" if i%2==0 else "assistant",str(i))
        self.assertEqual(len(chat._context(conv,self.owner,"问题",private_context=False)),30)
