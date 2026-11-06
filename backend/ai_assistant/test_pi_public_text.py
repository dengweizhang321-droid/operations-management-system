from unittest.mock import patch

from django.test import TestCase, override_settings

from . import pi_service, pi_worker, test_skill_candidates as fixtures
from .pi_models import PiEvent, PiOperation
from .pi_public_text import PublicText
from .policy import AiError, mutation


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiPublicTextTests(TestCase):
    user = fixtures.SkillCandidateTests.user
    setUp = fixtures.SkillCandidateTests.setUp

    def test_chunks_are_bound_to_dispatch_and_cancellation_stops_further_writes(self):
        session = pi_service.create_session({"clientRequestId": "stream-test"}, self.owner)["session"]["id"]
        pi_service.prompt(session, {"clientRequestId": "stream-1", "message": "报告"}, self.owner)
        op = pi_worker.claim()
        writer = PublicText(op, "dispatch-1")
        with patch("ai_assistant.pi_public_text.monotonic", return_value=100):
            writer.append("甲😀")
            writer.append("乙")
            writer.flush(finished=True)
        items = pi_service.events(session, {"after": "0"}, self.owner)["items"]
        chunks = [e["data"] for e in items if e["type"] == "provider_text_delta"]
        self.assertEqual([(c["offset"], c["text"]) for c in chunks], [(0, "甲😀"), (3, "乙")])
        self.assertEqual([c["messageId"] for c in chunks], ["dispatch-1"] * 2)
        self.assertEqual(items[-1]["type"], "provider_text_end")
        with mutation():
            PiOperation.objects.filter(pk=op.pk).update(cancel_requested=True)
        with self.assertRaises(AiError):
            writer.append("不再显示")
        self.assertEqual(PiEvent.objects.filter(operation=op, event_type="provider_text_delta").count(), 2)
