"""dispatch_budget reads its three daily ceilings from the environment (not Django settings)."""
import os
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import chat, dispatch_limits
from .policy import AiError

G, O, M = (
    "TERUISI_AI_DISPATCH_DAILY_LIMIT_GLOBAL",
    "TERUISI_AI_DISPATCH_DAILY_LIMIT_PER_OWNER",
    "TERUISI_AI_DISPATCH_DAILY_LIMIT_PER_MODEL",
)


def clean_env(**values):
    env = {k: v for k, v in os.environ.items() if k not in (G, O, M)}
    env.update(values)
    return patch.dict(os.environ, env, clear=True)


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class DispatchBudgetEnvTests(TestCase):
    def setUp(self):
        dispatch_limits._warned.clear()

    def test_default_ceilings(self):
        with clean_env():
            self.assertEqual([dispatch_limits.limit(n) for n in (G, O, M)], [4000, 2500, 4000])

    def test_valid_override(self):
        with clean_env(**{G: "7", O: " 8 ", M: "100000"}):
            self.assertEqual([dispatch_limits.limit(n) for n in (G, O, M)], [7, 8, 100000])

    def test_invalid_values_fall_back_to_default(self):
        for bad in ("0", "-3", "abc", "1.5", "100001"):
            dispatch_limits._warned.clear()
            with self.subTest(bad=bad), clean_env(**{G: bad}):
                with self.assertLogs(dispatch_limits.logger, "WARNING"):
                    self.assertEqual(dispatch_limits.limit(G), 4000)

    def test_invalid_value_warns_only_once(self):
        with clean_env(**{G: "abc"}):
            with self.assertLogs(dispatch_limits.logger, "WARNING") as logs:
                dispatch_limits.limit(G)
                dispatch_limits.limit(G)
            self.assertEqual(len(logs.records), 1)

    def test_blank_value_means_unset_and_is_silent(self):
        with clean_env(**{G: "  "}), self.assertNoLogs(dispatch_limits.logger, "WARNING"):
            self.assertEqual(dispatch_limits.limit(G), 4000)

    def test_empty_day_is_admitted_under_positive_ceilings(self):
        with clean_env(**{G: "1", O: "1", M: "1"}):
            chat.dispatch_budget("owner@example.test", "model-1")

    def test_each_env_ceiling_triggers_quota_error_independently(self):
        # 0 is invalid for the reader, so patch the reader to force a zero ceiling on one dimension.
        for name in (G, O, M):
            with self.subTest(name=name), patch.object(dispatch_limits, "limit", side_effect=lambda n, name=name: 0 if n == name else 10):
                with self.assertRaises(AiError) as caught:
                    chat.dispatch_budget("owner@example.test", "model-1")
                self.assertEqual((caught.exception.code, caught.exception.status), ("ai_chat_quota_exceeded", 429))
