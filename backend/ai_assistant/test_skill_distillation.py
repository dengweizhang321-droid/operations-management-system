import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import skill_candidates, task_feedback, test_skill_candidates as fixtures
from .pi_models import PiDispatch
from .pi_service import event
from .policy import AiError, canonical, mutation


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class DistillationTests(TestCase):
    user = fixtures.SkillCandidateTests.user
    call = fixtures.SkillCandidateTests.call
    settled = fixtures.SkillCandidateTests.settled
    content = fixtures.SkillCandidateTests.content
    export = fixtures.SkillCandidateTests.export

    def setUp(self):
        fixtures.SkillCandidateTests.setUp(self)
        self.model.generation_options_json = canonical({"structuredOutputSupport": "json_schema"})
        self.model.save()
        self.op = self.settled()
        self.export(self.op)
        with mutation():
            self.op.session.refresh_from_db()
            event(self.op.session, "assistant_message", {"text": "来源显示缺少库存，需复核"}, self.op)
        self.correction = self.correct("先核实 ERP 日期")
        self.version = skill_candidates.request_schema(self.op.id, self.owner)["reportVersionDigest"]
        self.reply = {"text": canonical(self.content()), "calls": [], "truncated": False,
                      "usage": {"completion_tokens": 200}, "providerRequestId": "p1"}
        entries = [{"name": name} for name in fixtures.TOOLS]
        self.enterContext(patch("ai_assistant.pi_gateway.catalog", return_value=(entries, entries)))
        self.turn = self.enterContext(patch("ai_assistant.provider.turn", return_value=self.reply))

    def correct(self, value):
        return task_feedback.save(self.op.id, {"targetKind": "section", "targetRef": value,
            "newValue": value, "confirmed": True}, self.owner)["item"]

    def submit(self, key="request1", principal=None, version=None):
        path = f"/api/ai/pi/operations/{self.op.id}/skill-candidates/distill"
        return self.call(path, {"clientRequestId": key, "reportVersionDigest": version or self.version},
                         principal or self.owner)

    def test_finished_report_becomes_one_traceable_draft(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.content)
        candidate = response.json()["item"]
        self.assertEqual(candidate["status"], "draft")
        self.assertEqual(candidate["feedbackIds"], [self.correction["id"]])
        self.assertEqual(candidate["reportVersionDigest"], self.version)
        prompt = json.loads(self.turn.call_args.args[1][0]["content"])
        self.assertEqual(prompt["corrections"][0]["value"], "先核实 ERP 日期")
        self.assertIn("缺少库存", prompt["report"])
        self.assertTrue(prompt["sources"])
        self.assertEqual(self.turn.call_args.args[3], [])
        self.assertEqual(self.turn.call_args.kwargs["structured_output"]["name"], "skill-candidate-v1")
        self.assertEqual(self.submit().json()["item"]["id"], candidate["id"])
        self.assertEqual(self.submit("another").status_code, 409)
        self.turn.assert_called_once()

    def test_bad_output_is_terminal_without_writing_a_candidate(self):
        self.reply["text"] = canonical(self.content(steps=[{"action": "missing keys"}]))
        self.assertEqual(self.submit().status_code, 422)
        self.assertEqual(self.submit().status_code, 422)
        self.assertFalse(skill_candidates.m.AiSkillCandidate.objects.exists())
        self.turn.assert_called_once()

    def test_evidence_change_during_provider_turn_refuses_the_candidate(self):
        def change(*args, **kwargs):
            self.correct("期间发生变化")
            return self.reply
        self.turn.side_effect = change
        self.assertEqual(self.submit().status_code, 409)
        self.assertFalse(skill_candidates.m.AiSkillCandidate.objects.exists())

    def test_lost_reply_cannot_be_dispatched_under_another_key(self):
        self.turn.side_effect = AiError("运输失败", "provider_timeout", 503)
        self.assertEqual(self.submit().status_code, 503)
        self.assertEqual(self.submit("another").status_code, 409)
        self.turn.assert_called_once()
        self.assertEqual(PiDispatch.objects.get(kind="skill_distillation").status, "unknown")

    def test_foreign_owner_and_stale_report_cannot_start_paid_turn(self):
        self.assertEqual(self.submit(principal=self.other).status_code, 404)
        self.assertEqual(self.submit(version="a" * 64).status_code, 409)
        self.turn.assert_not_called()
