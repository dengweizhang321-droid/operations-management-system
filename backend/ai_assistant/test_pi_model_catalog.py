"""Public per-model thinking discovery never reads or returns credential columns."""
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from . import tests as domain
from .policy import canonical


class PiModelCatalogTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call

    def test_each_model_exposes_its_own_valid_thinking_levels_without_credentials(self):
        self.model.reasoning_mode = "disabled"
        self.model.save(update_fields=["reasoning_mode"])
        from .models import AiModels
        AiModels.objects.create(id="adjustable-model", name="Adjustable fixture", model_name="fixture-2",
            protocol="openai_compatible", model_type="text", status="enabled", base_url="https://api.openai.com/v1",
            api_key_encrypted="never-read-private-credential", api_key_suffix="hide", reasoning_mode="auto",
            max_tokens=8192, generation_options_json=canonical({"reasoningFormat": "reasoning_effort", "reasoningEffort": "high"}))
        with CaptureQueriesContext(connection) as queries:
            response = self.call("/api/ai/pi/skills", method="GET")
        self.assertEqual(response.status_code, 200, response.content)
        models = {item["id"]: item for item in response.json()["models"]}
        self.assertEqual(models[self.model.id]["supportedThinkingLevels"], ["off"])
        self.assertIn("high", models["adjustable-model"]["supportedThinkingLevels"])
        self.assertIn("max", models["adjustable-model"]["supportedThinkingLevels"])
        self.assertNotIn("never-read-private-credential", response.content.decode())
        self.assertNotIn("apiKey", response.content.decode())
        for query in queries:
            if 'FROM "ai_models"' in query["sql"]:
                self.assertNotIn('"api_key_encrypted"', query["sql"])
                self.assertNotIn('"api_key_suffix"', query["sql"])
