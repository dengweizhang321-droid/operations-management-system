"""Prompt accepts exactly the currently deployed reviewed skill bundle."""
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
