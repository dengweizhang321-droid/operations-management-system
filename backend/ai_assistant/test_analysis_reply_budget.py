"""analysis-reply gets a longer request budget than the generic 120 s; other consumer calls keep 120 s."""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from . import views


class AnalysisReplyBudgetTests(SimpleTestCase):
    def budget_for(self, body, path="consumer"):
        seen = []

        @contextmanager
        def fake_budget(seconds):
            seen.append(seconds)
            yield

        request = RequestFactory().post("/api/ai/" + path, data=json.dumps(body), content_type="application/json")
        with patch.object(views.transport, "request_budget", fake_budget):
            with patch.object(views, "_dispatch", return_value=JsonResponse({"ok": True})):
                with patch.object(views, "revision", return_value="1"):
                    views.dispatch(request, path)
        self.assertEqual(len(seen), 1)
        return seen[0]

    def test_analysis_reply_uses_extended_budget_below_channel_timeout(self):
        self.assertEqual(self.budget_for({"operation": "analysis-reply"}), views.ANALYSIS_REPLY_BUDGET_SECONDS)
        self.assertEqual(views.ANALYSIS_REPLY_BUDGET_SECONDS, 240)
        self.assertLess(views.ANALYSIS_REPLY_BUDGET_SECONDS, 320)  # writer waitress channel-timeout

    def test_other_consumer_operations_keep_the_generic_budget(self):
        for operation in ("analysis-plan", "pandas-analysis", "model-list", "knowledge"):
            with self.subTest(operation=operation):
                self.assertEqual(self.budget_for({"operation": operation}), 120)
