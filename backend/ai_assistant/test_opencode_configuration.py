"""OpenCode Go configuration regression; synthetic DB and no provider traffic."""
import json
import socket
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase, override_settings

from . import configuration, model_capabilities, models as m, provider, transport, tests as support
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


@override_settings(DJANGO_ENVIRONMENT="production")
class OpenCodeRequestHeaderTests(SimpleTestCase):
    def model(self, base_url="https://opencode.ai/zen/go", protocol="openai_compatible"):
        return SimpleNamespace(base_url=base_url, protocol=protocol, model_type="text",
                               model_name="fixture", api_key_encrypted="fixture",
                               max_tokens=1024, temperature_milli=700, reasoning_mode="auto")

    def wire(self, protocol, streaming):
        if protocol == "anthropic":
            result = {"content": [{"type": "text", "text": "连接成功"}], "stop_reason": "end_turn"}
            events = [
                {"type": "message_start", "message": {"id": "fixture", "content": []}},
                {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": "连接成功"}},
                {"type": "content_block_stop", "index": 0},
                {"type": "message_delta", "delta": {"stop_reason": "end_turn"}},
                {"type": "message_stop"},
            ]
        else:
            result = {"choices": [{"message": {"content": "连接成功"}, "finish_reason": "stop"}]}
            events = [
                {"choices": [{"index": 0, "delta": {"content": "连接成功"}, "finish_reason": None}]},
                {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                "[DONE]",
            ]
        wire = ("".join("data: " + (value if isinstance(value, str) else json.dumps(value)) + "\n\n"
                        for value in events).encode() if streaming else json.dumps(result).encode())
        response = MagicMock(status=200)
        response.isclosed.return_value = False
        response.getheader.side_effect = lambda name, *args: "text/event-stream" if name == "Content-Type" and streaming else None
        response.read1.side_effect = [wire, b""]
        connection = MagicMock()
        connection.getresponse.return_value = response
        sock = MagicMock()
        context = MagicMock()
        context.wrap_socket.return_value = sock
        self.enterContext(patch.object(transport, "resolve_addresses", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.4.4", 443))]))
        self.enterContext(patch.object(transport.socket, "socket", return_value=sock))
        self.enterContext(patch.object(transport.ssl, "create_default_context", return_value=context))
        self.enterContext(patch.object(transport.http.client, "HTTPConnection", return_value=connection))
        self.enterContext(patch.object(provider, "decrypt", return_value="fixture-key"))
        return connection

    def test_go_probe_and_json_turn_send_header_through_transport(self):
        for protocol in ("openai_compatible", "anthropic"):
            for base in ("https://opencode.ai/zen/go", "https://opencode.ai/zen/go/v1/",
                         "https://OPENCODE.AI/zen/go"):
                with self.subTest(protocol=protocol, base=base):
                    connection = self.wire(protocol, False)
                    self.assertEqual(provider.probe(self.model(base, protocol)), "文本连接成功")
                    connection.request.assert_called_once()
                    method, path, body, headers = connection.request.call_args.args
                    self.assertEqual(method, "POST")
                    self.assertEqual(path, "/zen/go/v1/" + ("messages" if protocol == "anthropic" else "chat/completions"))
                    self.assertEqual(headers["User-Agent"], "xiaote/1.0")
                    self.assertTrue(headers["x-opencode-session"])
                    self.assertEqual(headers["Accept"], "application/json")
                    self.assertEqual(headers.get("x-api-key") if protocol == "anthropic" else headers.get("Authorization"),
                                     "fixture-key" if protocol == "anthropic" else "Bearer fixture-key")
                    self.assertEqual(json.loads(body)["model"], "fixture")

    def test_go_stream_sends_header_and_preserves_stream_contract(self):
        for protocol in ("openai_compatible", "anthropic"):
            with self.subTest(protocol=protocol):
                connection = self.wire(protocol, True)
                received = []
                result = provider.turn(self.model(protocol=protocol), [{"role": "user", "content": "hello"}],
                                       "system", [], on_text=received.append)
                self.assertEqual(result["text"], "连接成功")
                self.assertEqual(received, ["连接成功"])
                connection.request.assert_called_once()
                headers = connection.request.call_args.args[3]
                self.assertEqual(headers["User-Agent"], "xiaote/1.0")
                self.assertTrue(headers["x-opencode-session"])
                self.assertEqual(headers["Accept"], "text/event-stream")
                self.assertIs(json.loads(connection.request.call_args.args[2])["stream"], True)

    def test_go_http_failure_does_not_retry_provider_post(self):
        connection = self.wire("openai_compatible", False)
        connection.getresponse.return_value.status = 400
        with self.assertRaises(AiError):
            provider.probe(self.model())
        connection.request.assert_called_once()
        self.assertEqual(connection.request.call_args.args[3]["User-Agent"], "xiaote/1.0")

    @patch.dict("os.environ", {"AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST": "https://models.example.com"})
    def test_other_provider_and_opencode_paths_keep_existing_headers(self):
        for base in ("https://api.openai.com/v1", "https://opencode.ai/zen/v1",
                     "https://opencode.ai/zen/go/v10", "https://models.example.com/zen/go/v1"):
            with self.subTest(base=base):
                connection = self.wire("openai_compatible", False)
                provider.probe(self.model(base))
                self.assertNotIn("User-Agent", connection.request.call_args.args[3])
                self.assertNotIn("x-opencode-session", connection.request.call_args.args[3])

    def test_conversation_session_is_stable_distinct_and_restored(self):
        connection = self.wire("openai_compatible", False)
        def dispatch():
            response = connection.getresponse.return_value
            response.read1.side_effect = [json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode(), b""]
            provider.probe(self.model())
            return connection.request.call_args.args[3]["x-opencode-session"]
        with provider.conversation_session("conversation-a"):
            first = dispatch()
            self.assertEqual(dispatch(), first)
            with provider.conversation_session("conversation-b"):
                self.assertNotEqual(dispatch(), first)
            self.assertEqual(dispatch(), first)
        with provider.conversation_session("conversation-a"):
            self.assertEqual(dispatch(), first)
        self.assertNotEqual(dispatch(), first)
        self.assertNotEqual(dispatch(), dispatch())
        self.assertNotIn("conversation-a", first)

    def test_conversation_session_resets_after_failure_and_rejects_invalid_identity(self):
        with self.assertRaises(RuntimeError):
            with provider.conversation_session("failed-conversation"):
                raise RuntimeError("fixture")
        self.assertIsNone(provider._conversation_session.get())
        for value in (None, 123, "", "a" * 201):
            with self.subTest(value=value), self.assertRaises(AiError):
                with provider.conversation_session(value):
                    self.fail("invalid session accepted")


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

    def test_large_custom_reasoning_values_survive_save_edit_and_provider_parameters(self):
        body = self.body(maxTokens=384000, maxToolRounds=1000, maxTotalToolCalls=10000,
                         timeoutMs=3_000_000_000, temperatureMilli=3500,
                         generationOptions={"contextWindowTokens":4_000_000,
                                            "taskTimeoutMs":3_000_000_000,
                                            "reasoningFormat":"thinking", "reasoningEffort":"max"})
        saved, _ = self.save(body)
        edited, _ = self.save({**body, "id":saved["id"], "expectedVersion":saved["version"], "apiKey":""})
        for key in ("maxTokens", "maxToolRounds", "maxTotalToolCalls", "timeoutMs", "temperatureMilli"):
            self.assertEqual(edited[key], body[key])
        row = m.AiModels.objects.get(id=saved["id"])
        self.assertEqual(model_capabilities.options(row)["taskTimeoutMs"],3_000_000_000)
        params = model_capabilities.provider_parameters(row)
        self.assertEqual(params["max_tokens"],384000)
        self.assertEqual(params["reasoning_effort"],"max")
        self.assertEqual(params["thinking"],{"type":"enabled"})
        self.assertEqual(params["temperature"],3.5)
        with transport.request_budget(None):
            transport.limit_request_budget(3_000_000)
            self.assertGreater(transport.remaining_budget(3_000_000),model_capabilities.MAX_CHAT_SECONDS)

    def test_existing_high_reasoning_configuration_is_preserved_on_edit(self):
        body = self.body(maxTokens=65536,generationOptions={"contextWindowTokens":1_000_000,
                                                         "taskTimeoutMs":1_800_000,"temperatureMode":"default"})
        saved, _ = self.save(body)
        edited, _ = self.save({**body,"id":saved["id"],"expectedVersion":saved["version"],"apiKey":""})
        self.assertEqual(edited["maxTokens"],65536)
        self.assertEqual(edited["generationOptions"]["contextWindowTokens"],1_000_000)
        self.assertEqual(edited["generationOptions"]["taskTimeoutMs"],1_800_000)
        self.assertNotIn("thinking",model_capabilities.provider_parameters(m.AiModels.objects.get(id=saved["id"])))
