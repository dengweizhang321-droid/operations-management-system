"""dispatch_budget reads its three daily ceilings from Django settings."""
from django.conf import settings
from django.test import TestCase, override_settings

from . import chat
from .policy import AiError


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class DispatchBudgetSettingsTests(TestCase):
    def test_default_ceilings(self):
        self.assertEqual(settings.AI_DISPATCH_DAILY_LIMIT_GLOBAL, 2500)
        self.assertEqual(settings.AI_DISPATCH_DAILY_LIMIT_PER_OWNER, 1000)
        self.assertEqual(settings.AI_DISPATCH_DAILY_LIMIT_PER_MODEL, 2000)

    def test_empty_day_is_admitted_under_positive_ceilings(self):
        with override_settings(
            AI_DISPATCH_DAILY_LIMIT_GLOBAL=1, AI_DISPATCH_DAILY_LIMIT_PER_OWNER=1, AI_DISPATCH_DAILY_LIMIT_PER_MODEL=1
        ):
            chat.dispatch_budget("owner@example.test", "model-1")

    def test_each_ceiling_triggers_quota_error_independently(self):
        ceilings = {
            "AI_DISPATCH_DAILY_LIMIT_GLOBAL": 1,
            "AI_DISPATCH_DAILY_LIMIT_PER_OWNER": 1,
            "AI_DISPATCH_DAILY_LIMIT_PER_MODEL": 1,
        }
        for name in ceilings:
            with self.subTest(name=name), override_settings(**{**ceilings, name: 0}):
                with self.assertRaises(AiError) as caught:
                    chat.dispatch_budget("owner@example.test", "model-1")
                self.assertEqual(caught.exception.code, "ai_chat_quota_exceeded")
                self.assertEqual(caught.exception.status, 429)
