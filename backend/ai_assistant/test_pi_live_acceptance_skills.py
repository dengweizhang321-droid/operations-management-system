"""Prompt accepts exactly the currently deployed reviewed skill bundle."""
import json
from unittest.mock import patch
from django.test import TestCase
from . import tests as domain, pi_service as service
from .pi_models import PiOperation
from .policy import AiError


class ReviewedSkillAdmissionTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user

    def prompt(self, skills):
        actor = self.owner
        session = service.create_session({'clientRequestId':'skill-admission'}, actor)['session']['id']
        return service.prompt(session, {'clientRequestId':'skill-prompt','message':'synthetic skill admission only',
            'skillIds':skills}, actor)

    @patch.dict('os.environ', {'PI_SKILL_VERSION':'1.3.0'})
    def test_available_native_planning_is_accepted_from_reviewed_manifest(self):
        available = {s['id'] for s in service.skills()}
        self.assertIn('native-planning', available)
        response = self.prompt(['native-planning'])
        self.assertEqual([s['id'] for s in response['operation']['skills']], ['native-planning'])

    @patch.dict('os.environ', {'PI_SKILL_VERSION':'1.2.0'})
    def test_new_skill_is_not_admitted_by_an_older_deployed_bundle(self):
        self.assertNotIn('native-planning', {s['id'] for s in service.skills()})
        with self.assertRaises(AiError):
            self.prompt(['native-planning'])
        self.assertFalse(PiOperation.objects.exists())

    @patch.dict('os.environ', {'PI_SKILL_VERSION':'1.3.0'})
    def test_unreviewed_name_and_non_string_fail_without_an_operation(self):
        for skills in (['workspace-custom-skill'], [{'id':'native-planning'}]):
            with self.subTest(skills=skills), self.assertRaises(AiError):
                self.prompt(skills)
        self.assertFalse(PiOperation.objects.exists())

    def test_exact_skill_version_is_frozen_and_same_request_replays_after_retirement(self):
        session = service.create_session({"clientRequestId": "managed-admission"}, self.owner)["session"]["id"]
        with patch.dict("os.environ", {"PI_SKILL_VERSION": "1.3.0"}):
            item = next(skill for skill in service.skills() if skill["id"] == "excel-report")
            ref = {key: item[key] for key in ("id", "packageVersion", "sha256")}
            request = {"clientRequestId": "managed-prompt", "message": "合成包验证", "skillRefs": [ref]}
            first = service.prompt(session, request, self.owner)["operation"]
            self.assertEqual(first["skills"], [item])

        with patch.dict("os.environ", {"PI_SKILL_VERSION": "1.2.0"}):
            replay = service.prompt(session, request, self.owner)
            self.assertTrue(replay["replayed"])
            self.assertEqual(replay["operation"]["id"], first["id"])
            self.assertEqual(json.loads(PiOperation.objects.get(pk=first["id"]).skills_json), [item])
            other = service.create_session({"clientRequestId": "other-managed-admission"}, self.owner)["session"]["id"]
            with self.assertRaises(AiError) as stale:
                service.prompt(other, request, self.owner)
            self.assertEqual(stale.exception.code, "pi_skill_version_changed")
        self.assertEqual(PiOperation.objects.count(), 1)

    @patch.dict("os.environ", {"PI_SKILL_VERSION": "1.3.0"})
    def test_exact_selection_rejects_unknown_hash_mixed_forms_and_duplicates(self):
        session = service.create_session({"clientRequestId": "bad-managed-admission"}, self.owner)["session"]["id"]
        item = next(skill for skill in service.skills() if skill["id"] == "excel-report")
        ref = {key: item[key] for key in ("id", "packageVersion", "sha256")}
        for invalid in (
            {"skillRefs": [{**ref, "sha256": "0" * 64}]},
            {"skillRefs": [{**ref, "path": "/workspace/skill"}]},
            {"skillRefs": [ref, ref]},
            {"skillRefs": [ref], "skillIds": [ref["id"]]},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(AiError):
                service.prompt(session, {"clientRequestId": "bad-managed-prompt", "message": "合成验证", **invalid}, self.owner)
        self.assertFalse(PiOperation.objects.exists())
