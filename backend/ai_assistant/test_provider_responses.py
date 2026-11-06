import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from . import provider
from .model_capabilities import validate
from .policy import AiError, canonical
from .provider_contract import InvalidProviderResponse
from .provider_stream import ProviderStream


def model(**options):
    return SimpleNamespace(protocol="openai_compatible", model_name="fixture", max_tokens=4096,
        generation_options_json=canonical({"openaiApiMode": "responses", **options}),
        reasoning_mode="auto", temperature_milli=0, api_key_encrypted="fixture",
        base_url="https://api.openai.com/v1")


def reply(items, **fields):
    return {"id": "resp_fixture", "status": "completed", "output": items, "usage": {"output_tokens": 8}, **fields}


def message(text):
    return {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}


class ResponsesTests(TestCase):
    def turn(self, responses, frames, tools=(), **kw):
        with patch.object(provider, "decrypt", return_value="test-only"), patch.object(
                provider, "bounded_json", return_value=responses) as send:
            value = provider.turn(model(structuredOutputSupport="json_schema"), frames,
                                  "instruction", tools, **kw)
        self.assertEqual(send.call_args.args[0], "https://api.openai.com/v1/responses")
        body = send.call_args.args[1]
        self.assertIs(body["store"], False)
        self.assertNotIn("previous_response_id", body)
        self.assertNotIn("conversation", body)
        self.assertNotIn("background", body)
        return value, body

    def test_tools_and_encrypted_reasoning_replay_locally_by_call_id(self):
        history = [{"role": "user", "content": "read a report"}]
        reasoning = {"type": "reasoning", "id": "remote-only", "encrypted_content": "opaque", "summary": []}
        call = {"type": "function_call", "id": "not-the-call-id", "call_id": "call-1", "name": "read", "arguments": "{}"}
        tools = [{"name": "read", "description": "read", "inputSchema": {"type": "object"}}]
        first, body = self.turn(reply([reasoning, call]), history, tools)
        self.assertEqual(first["calls"], [{"id": "call-1", "name": "read", "arguments": {}}])
        self.assertEqual(body["tools"][0]["parameters"], tools[0]["inputSchema"])
        history += [first["frame"], *provider.tool_frames(model(), first["calls"], [{"value": 3}])]
        last, body = self.turn(reply([message("done")]), history)
        self.assertEqual(last["text"], "done")
        self.assertEqual(body["input"][1]["encrypted_content"], "opaque")
        self.assertEqual(body["input"][1]["id"], "remote-only")
        self.assertEqual(body["input"][-1]["call_id"], "call-1")
        self.assertEqual(body["input"][-1]["type"], "function_call_output")

    def test_intermediate_message_keeps_phase_when_replayed(self):
        frame, _ = self.turn(reply([{**message("checking"), "id": "msg_local", "status": "completed", "phase": "commentary"}]), [], retain_reasoning=True)
        _, body = self.turn(reply([message("done")]), [frame["frame"]])
        item = body["input"][0]
        self.assertEqual((item["id"], item["status"], item["phase"]), ("msg_local", "completed", "commentary"))

    def test_schema_and_visual_input(self):
        frames = [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}}]}]
        schema = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
        _, body = self.turn(reply([message("{}")]), frames, structured_output={"name": "fixture", "schema": schema})
        self.assertEqual(body["text"]["format"]["schema"], schema)
        self.assertEqual(body["input"][0]["content"][0]["type"], "input_image")
        self.assertEqual(body["max_output_tokens"], 4096)
        self.assertNotIn("response_format", body)

    def test_validated_public_deltas_only_and_complete_terminal(self):
        texts = []
        stream = ProviderStream("openai_responses", texts.append)
        for event in ({"type": "response.reasoning_summary_text.delta", "delta": "private"},
                      {"type": "response.output_text.delta", "delta": "中"},
                      {"type": "response.completed", "response": reply([message("中")])}):
            stream.feed(("data: " + json.dumps(event) + "\r\n\r\n").encode())
        self.assertEqual(stream.finish()["status"], "completed")
        self.assertEqual(texts, ["中"])
        stream = ProviderStream("openai_responses", texts.append)
        with self.assertRaises(InvalidProviderResponse):
            stream.feed(b'data: [DONE]\n\n')
        with self.assertRaises(InvalidProviderResponse):
            stream.finish()

    def test_full_sse_terminal_can_span_many_transport_reads(self):
        text = "a" * 400_000
        stream = ProviderStream("openai_responses", lambda _: None)
        payload = ("data: " + json.dumps({"type": "response.completed",
                    "response": reply([message(text)])}) + "\n\n").encode()
        for offset in range(0, len(payload), 64 * 1024):
            stream.feed(payload[offset:offset + 64 * 1024])
        self.assertEqual(stream.finish()["output"][0]["content"][0]["text"], text)

    def test_reject_unexpected_hosted_tools_and_truncated_tool_calls(self):
        for status in ("in_progress", "incomplete"):
            with self.subTest(status=status), self.assertRaises(InvalidProviderResponse):
                self.turn(reply([{"type": "function_call", "status": status, "call_id": "c",
                                  "name": "tool", "arguments": "{}"}]), [])
        with self.assertRaises(InvalidProviderResponse):
            self.turn(reply([{"type": "web_search_call", "status": "completed"}]), [])
        with self.assertRaises(InvalidProviderResponse):
            self.turn(reply([{"type": "function_call", "call_id": "c1", "name": "test", "arguments": "{"}],
                status="incomplete", incomplete_details={"reason": "max_output_tokens"}), [])

    def test_mode_is_explicit_and_protocol_specific(self):
        self.assertNotIn("openaiApiMode", validate({}, protocol="openai_compatible", max_tokens=4096, reasoning_mode="auto"))
        with self.assertRaises(AiError):
            validate({"openaiApiMode": "responses"}, protocol="anthropic", max_tokens=4096, reasoning_mode="auto")
