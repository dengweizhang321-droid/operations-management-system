"""OpenCode Go configuration regression; synthetic DB and no provider traffic."""
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from . import configuration, model_capabilities, models as m, provider, tests as support
from .policy import AiError, mutation


@override_settings(DJANGO_ENVIRONMENT="production")
class OpenCodeEndpointTests(SimpleTestCase):
    @patch.dict("os.environ", {"AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST": ""})
    def test_subscription_root_and_api_base_are_equivalent(self):
        for value in ("https://opencode.ai/zen/go", "https://opencode.ai/zen/go/",
                      "https://opencode.ai/zen/go/v1", "https://opencode.ai/zen/go/v1/"):
            with self.subTest(value=value):
                self.assertEqual(configuration.endpoint(value), "https://opencode.ai/zen/go/v1")
        self.assertEqual(configuration.endpoint("https://api.openai.com/v1"), "https://api.openai.com/v1")

    @patch.dict("os.environ", {"AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST": "https://models.example.com"})
    def test_exact_origin_and_existing_security_rules_remain(self):
        for value in ("http://opencode.ai/zen/go", "https://opencode.ai:8443/zen/go",
                      "https://sub.opencode.ai/zen/go", "https://opencode.ai.evil.example/zen/go",
                      "https://opencode.ai@evil.example/zen/go", "https://127.0.0.1/zen/go",
                      "https://opencode.ai/zen/go?api_key=fixture", "https://opencode.ai/zen/go#fragment"):
            with self.subTest(value=value), self.assertRaises(AiError):
                configuration.endpoint(value)
        self.assertEqual(configuration.endpoint("https://models.example.com/zen/go"), "https://models.example.com/zen/go")
        self.assertEqual(configuration.endpoint("https://opencode.ai/zen/v1"), "https://opencode.ai/zen/v1")


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="production")
class OpenCodeModelSaveTests(TestCase):
    setUp = support.AiDomainTests.setUp
    user = support.AiDomainTests.user
    call = support.AiDomainTests.call

    def body(self, **extra):
        return {"name": "OpenCode Go", "modelName": "deepseek-v4.1-flash",
                "baseUrl": "https://opencode.ai/zen/go", "apiKey": "fixture-key-1234",
                "protocol": "openai_compatible", "modelType": "text", **extra}

    def save(self, body, principal=None):
        with patch.dict("os.environ", {"AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST": ""}), \
             patch.object(configuration, "encrypt", return_value="encrypted-fixture") as encrypt, \
             mutation(principal or support.ADMIN):
            result = configuration.save_model(body, principal or support.ADMIN)
        return result, encrypt

    def test_create_then_edit_without_replacing_key_and_dispatch(self):
        saved, encrypt = self.save(self.body())
        encrypt.assert_called_once_with("fixture-key-1234")
        self.assertEqual(saved["baseUrl"], "https://opencode.ai/zen/go/v1")
        self.assertNotIn("apiKeyEncrypted", saved)
        edited, encrypt = self.save(self.body(id=saved["id"], expectedVersion=saved["version"],
                                             name="Edited Go", apiKey=""))
        encrypt.assert_not_called()
        row = m.AiModels.objects.get(id=saved["id"])
        self.assertEqual(row.name, "Edited Go")
        self.assertEqual(row.api_key_encrypted, "encrypted-fixture")
        self.assertEqual(edited["version"], saved["version"] + 1)
        with patch.object(provider, "decrypt", return_value="fixture-key-1234"), \
             patch.object(provider, "bounded_json", return_value={"choices": [{"message": {"content": "ok"}}]}) as http:
            provider.turn(row, [{"role": "user", "content": "hello"}], "system", [])
        self.assertEqual(http.call_args.args[0], "https://opencode.ai/zen/go/v1/chat/completions")
        self.assertEqual(http.call_args.args[1]["model"], "deepseek-v4.1-flash")

    def test_legacy_root_edit_without_base_url_preserves_key(self):
        self.model.base_url = "https://opencode.ai/zen/go"
        self.model.save()
        body = self.body(id=self.model.id, expectedVersion=self.model.version, apiKey="")
        del body["baseUrl"]
        saved, encrypt = self.save(body)
        self.assertEqual(saved["baseUrl"], "https://opencode.ai/zen/go/v1")
        encrypt.assert_not_called()

    def test_changed_origin_or_protocol_still_requires_new_key(self):
        for extra in ({"baseUrl": "https://opencode.ai/zen/go"},
                      {"baseUrl": self.model.base_url, "protocol": "anthropic"}):
            with self.subTest(extra=extra), self.assertRaisesRegex(AiError, "新 API Key"):
                self.save(self.body(id=self.model.id, expectedVersion=self.model.version, apiKey="", **extra))
        self.model.refresh_from_db()
        self.assertEqual(self.model.base_url, "https://api.openai.com/v1")

    def test_permissions_missing_key_and_stale_version_remain_rejected(self):
        with self.assertRaises(AiError):
            self.save(self.body(), self.owner)
        with self.assertRaisesRegex(AiError, "必须提供 API Key"):
            self.save(self.body(apiKey=""))
        saved, _ = self.save(self.body())
        with self.assertRaises(AiError):
            self.save(self.body(id=saved["id"], expectedVersion=0))

    def test_signed_model_api_create_and_edit_roundtrip(self):
        with patch.object(configuration, "encrypt", return_value="encrypted-fixture"):
            created = self.call("/api/ai/models", self.body(), principal=support.ADMIN)
        self.assertEqual(created.status_code, 200, created.content)
        item = created.json()["item"]
        self.assertIs(item["generationOptions"]["includeStreamUsage"], False)
        edited = self.call("/api/ai/models", self.body(id=item["id"], expectedVersion=item["version"],
                           apiKey="", generationOptions=item["generationOptions"]), principal=support.ADMIN)
        self.assertEqual(edited.status_code, 200, edited.content)

    def test_legacy_numeric_flags_are_returned_as_booleans_and_resaved(self):
        for stored in (0, 1):
            self.model.generation_options_json = '{"includeStreamUsage":%d}' % stored
            self.model.save()
            options = configuration.model_record(self.model)["generationOptions"]
            self.assertIs(options["includeStreamUsage"], bool(stored))
            saved, _ = self.save(self.body(id=self.model.id, expectedVersion=self.model.version,
                                          baseUrl=self.model.base_url, apiKey="", generationOptions=options))
            self.assertIs(saved["generationOptions"]["includeStreamUsage"], bool(stored))
            self.model.refresh_from_db()
            self.assertIs(model_capabilities.options(self.model)["includeStreamUsage"], bool(stored))
