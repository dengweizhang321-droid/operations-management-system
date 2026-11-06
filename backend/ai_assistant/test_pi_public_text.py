from unittest.mock import patch

from django.test import TestCase, override_settings

from . import pi_service, pi_worker, test_pi_runtime as runtime_fixture, test_skill_candidates as fixtures
from .pi_models import PiEvent, PiOperation
from .pi_public_text import PublicText, record_runner_answer
from .policy import AiError, mutation


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiPublicTextTests(TestCase):
    user = fixtures.SkillCandidateTests.user
    setUp = fixtures.SkillCandidateTests.setUp

    def test_delayed_json_answer_cannot_consume_an_identical_sse_answer(self):
        session = pi_service.create_session({"clientRequestId": "delayed-json"}, self.owner)["session"]["id"]
        pi_service.prompt(session, {"clientRequestId": "same-text", "message": "日报"}, self.owner)
        op = pi_worker.claim()
        PublicText(op, "first-json").flush(finished=True, final="同文")
        streamed = PublicText(op, "next-sse")
        streamed.append("同文")
        streamed.flush(finished=True, final="同文")
        with mutation():
            op.session.refresh_from_db()
            record_runner_answer(op.session, op, "同文")
            record_runner_answer(op.session, op, "同文")
        events = pi_service.events(session, {"after": "0"}, self.owner)["items"]
        self.assertEqual([item["data"]["messageId"] for item in events if item["type"] == "assistant_message"],
                         ["first-json", "next-sse"])

    def test_chunks_are_bound_to_dispatch_and_cancellation_stops_further_writes(self):
        session = pi_service.create_session({"clientRequestId": "stream-test"}, self.owner)["session"]["id"]
        pi_service.prompt(session, {"clientRequestId": "stream-1", "message": "报告"}, self.owner)
        op = pi_worker.claim()
        writer = PublicText(op, "dispatch-1")
        with patch("ai_assistant.pi_public_text.monotonic", return_value=100):
            writer.append("甲😀")
            writer.append("乙")
            writer.flush(finished=True, final="甲😀乙")
        items = pi_service.events(session, {"after": "0"}, self.owner)["items"]
        chunks = [e["data"] for e in items if e["type"] == "provider_text_delta"]
        self.assertEqual([(c["offset"], c["text"]) for c in chunks], [(0, "甲😀"), (3, "乙")])
        self.assertEqual([c["messageId"] for c in chunks], ["dispatch-1"] * 2)
        self.assertEqual(items[-1]["type"], "provider_text_end")
        with mutation():
            op.session.refresh_from_db()
            record_runner_answer(op.session, op, "甲😀乙")
            record_runner_answer(op.session, op, "甲😀乙")
            PiOperation.objects.filter(pk=op.pk).update(cancel_requested=True)
        finals = pi_service.events(session, {"after": str(items[-1]["eventSeq"])}, self.owner)["items"]
        self.assertEqual(finals[0]["data"]["messageId"], "dispatch-1")
        self.assertNotIn("messageId", finals[1]["data"])
        with self.assertRaises(AiError) as caught:
            writer.append("不再显示")
        self.assertEqual(caught.exception.code, "pi_canceled_during_dispatch")
        with self.assertRaises(AiError) as finished:
            writer.flush(finished=True, final="不再显示")
        self.assertEqual(finished.exception.code, "pi_canceled_during_dispatch")
        self.assertEqual(PiEvent.objects.filter(operation=op, event_type="provider_text_delta").count(), 2)


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiModelHistoryTests(TestCase):
    setUp = runtime_fixture.PiRuntimeTests.setUp
    user = runtime_fixture.PiRuntimeTests.user
    session = runtime_fixture.PiRuntimeTests.session
    prompt = runtime_fixture.PiRuntimeTests.prompt
    running = runtime_fixture.PiRuntimeTests.running
    request = runtime_fixture.PiRuntimeTests.request

    def test_unproven_agent_message_never_enters_model_prompt(self):
        from . import pi_gateway, pi_native
        from .pi_models import PiAgentMessage
        import secrets
        op, token = self.running()
        state = pi_native.state_for(op.session)
        with mutation():
            state.message_seq += 1
            state.save(update_fields=["message_seq"])
            PiAgentMessage.objects.create(id="old-agent-message", root_session=op.session,
                from_session=op.session, to_session=op.session, seq=state.message_seq, kind="send", message="旧权限原文")
            pi_native._message(state, op.session, op.session, "send", "本代已绑定原文")
        result = {"text": "正常", "calls": [], "usage": {}, "frame": {}, "providerRequestId": "fixture"}
        with patch.object(pi_gateway, "catalog", return_value=([], [])), patch.object(
                pi_gateway.provider, "turn", return_value=result) as model, patch(
                "ai_assistant.secrets.encrypt", return_value="synthetic"):
            pi_gateway.execute(self.request(op, token), secrets.token_hex(16))
        system = model.call_args.args[2]
        self.assertNotIn("旧权限原文", system)
        self.assertIn("本代已绑定原文", system)
