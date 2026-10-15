"""Content-free diagnostics and complete tool roundtrips on synthetic transports."""
import json
import socket
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from . import capability_probes as probes, chat, configuration, models as m, provider, transport, tests as support
from .policy import AiError, canonical, mutation
from .provider_contract import InvalidProviderResponse, PROVIDER_ADAPTER_VERSION


def fixture_model(protocol="openai_compatible"):
    return SimpleNamespace(id="fixture", version=1, protocol=protocol, model_type="text", model_name="fixture",
        base_url="https://opencode.ai/zen/go/v1", api_key_encrypted="fixture", max_tokens=65536,
        temperature_milli=200, reasoning_mode="auto", timeout_ms=1800000, max_tool_rounds=60,
        max_total_tool_calls=120, generation_options_json="{}", last_test_result=None)


class Wire:
    """Only socket/TLS/HTTP seams are synthetic; real JSON/SSE parsers run."""
    def __init__(self, case, model, streaming=False, reject_second=None):
        self.model, self.streaming, self.bodies, self.headers = model, streaming, [], []
        self.reject_second = reject_second
        self.connection = MagicMock()
        self.connection.request.side_effect = self.request
        sock, context = MagicMock(), MagicMock()
        context.wrap_socket.return_value = sock
        case.enterContext(patch.object(transport, "resolve_addresses", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.4.4", 443))]))
        case.enterContext(patch.object(transport.socket, "socket", return_value=sock))
        case.enterContext(patch.object(transport.ssl, "create_default_context", return_value=context))
        case.enterContext(patch.object(transport.http.client, "HTTPConnection", return_value=self.connection))
        case.enterContext(patch.object(provider, "decrypt", return_value="SYNTHETIC_KEY_NOT_LOGGED"))

    def request(self, method, path, body, headers):
        body = json.loads(body)
        self.bodies.append(body)
        self.headers.append(headers)
        is_first = bool(body.get("tools"))
        anthropic = self.model.protocol == "anthropic"
        if is_first:
            if anthropic:
                result = {"content": [{"type": "thinking", "thinking": "PRIVATE_REASONING", "signature": "fixture-signature"},
                    {"type": "tool_use", "id": "call-1", "name": "provider_roundtrip_check", "input": {"probe": "ready"}}], "stop_reason": "tool_use"}
            else:
                result = {"choices": [{"message": {"content": None, "reasoning_content": "PRIVATE_REASONING",
                    "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "provider_roundtrip_check", "arguments": '{"probe":"ready"}'}}]}, "finish_reason": "tool_calls"}]}
        else:
            frames = body["messages"]
            if anthropic:
                answer = json.loads(frames[-1]["content"][0]["content"])["answer"]
                assert frames[-2]["content"][0]["thinking"] == "PRIVATE_REASONING"
                result = {"content": [{"type": "text", "text": answer}], "stop_reason": "end_turn"}
            else:
                answer = json.loads(frames[-1]["content"])["answer"]
                assert frames[-2]["reasoning_content"] == "PRIVATE_REASONING"
                assert frames[-1]["tool_call_id"] == frames[-2]["tool_calls"][0]["id"]
                result = {"choices": [{"message": {"content": answer, "tool_calls": None, "reasoning_content": None}, "finish_reason": "stop"}]}
        response = MagicMock(status=200)
        response.isclosed.return_value = False
        response.getheader.side_effect = lambda name, *args: "text/event-stream" if name == "Content-Type" and self.streaming else None
        if not is_first and self.reject_second is not None:
            wire = self.reject_second
        elif not self.streaming:
            wire = canonical(result).encode()
        else:
            if anthropic:
                events = [{"type": "message_start", "message": {"id": "fixture", "content": []}}]
                for index, block in enumerate(result["content"]):
                    events += [{"type": "content_block_start", "index": index, "content_block": block}, {"type": "content_block_stop", "index": index}]
                events += [{"type": "message_delta", "delta": {"stop_reason": result["stop_reason"]}}, {"type": "message_stop"}]
            else:
                message = result["choices"][0]["message"]
                delta = {**message}
                if delta.get("tool_calls"):
                    delta["tool_calls"] = [{"index": i, **call} for i, call in enumerate(delta["tool_calls"])]
                events = [{"choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                    {"choices": [{"index": 0, "delta": {}, "finish_reason": result["choices"][0]["finish_reason"]}]}, "[DONE]"]
            wire = "".join("data: " + (event if isinstance(event, str) else canonical(event)) + "\n\n" for event in events).encode()
        response.read1.side_effect = [wire, b""]
        self.connection.getresponse.return_value = response


@override_settings(DJANGO_ENVIRONMENT="production")
class ProviderRoundtripWireTests(SimpleTestCase):
    def test_nonstreaming_complete_roundtrip_each_protocol(self):
        self.roundtrip(False)

    def test_sse_complete_roundtrip_each_protocol(self):
        self.roundtrip(True)

    def roundtrip(self, streaming):
        for protocol in ("openai_compatible", "anthropic"):
            with self.subTest(protocol=protocol):
                model = fixture_model(protocol)
                wire = Wire(self, model, streaming)
                calls = []
                probes.tool_roundtrip(model, streaming=streaming, before_call=calls.append)
                self.assertEqual(calls, [1, 2])
                self.assertEqual(wire.connection.request.call_count, 2)
                self.assertEqual(wire.headers[0]["x-opencode-session"], wire.headers[1]["x-opencode-session"])
                self.assertEqual(wire.headers[0]["User-Agent"], "xiaote/1.0")
                self.assertTrue(all(body["max_tokens"] == 65536 for body in wire.bodies))
                self.assertTrue(all("thinking" not in body for body in wire.bodies))
                self.assertEqual("stream" in wire.bodies[0], streaming)

    def test_second_turn_invalid_json_is_safe_detailed_and_never_replayed(self):
        model = fixture_model()
        wire = Wire(self, model, reject_second=b'{"SECRET_BODY":broken')
        with self.assertRaises(InvalidProviderResponse) as caught:
            probes.tool_roundtrip(model, streaming=False, before_call=lambda _: None)
        self.assertEqual(caught.exception.diagnostics["reason"], "json_invalid")
        self.assertEqual(caught.exception.diagnostics["responseMode"], "json")
        self.assertNotIn("SECRET_BODY", canonical(caught.exception.diagnostics))
        self.assertEqual(wire.connection.request.call_count, 2)

    def test_only_optional_null_is_tolerated_and_bad_shapes_keep_fixed_reasons(self):
        cases = [({"choices": {}}, "choices_shape"), ({"choices": [{"message": []}]}, "message_shape"),
            ({"choices": [{"message": {"content": {}, "tool_calls": None}}]}, "content_text_shape"),
            ({"choices": [{"message": {"content": "ok", "tool_calls": {"PRIVATE": "SECRET"}}}]}, "tool_calls_shape"),
            ({"choices": [{"message": {"tool_calls": [None]}}]}, "tool_call_shape"),
            ({"choices": [{"message": {"tool_calls": [{"function": {"arguments": "PRIVATE_SECRET"}}]}}]}, "tool_arguments_json")]
        with patch.object(provider, "decrypt", return_value="key"):
            for result, reason in cases:
                with self.subTest(reason=reason), patch.object(provider, "bounded_json", return_value=result), self.assertRaises(InvalidProviderResponse) as caught:
                    provider.turn(fixture_model(), [{"role": "user", "content": "hi"}], "system", [])
                self.assertEqual(caught.exception.diagnostics["reason"], reason)
                self.assertNotIn("SECRET", canonical(caught.exception.diagnostics))

    def test_json_tool_terminal_requires_calls_while_null_stop_remains_valid(self):
        for optional_field in ({}, {"tool_calls": None}, {"tool_calls": []}):
            message = {"content": "PRIVATE_RESPONSE_TEXT", **optional_field}
            for finish_reason in ("tool_calls", "stop"):
                response = {"choices": [{"message": message, "finish_reason": finish_reason}]}
                with self.subTest(optional_field=optional_field, finish_reason=finish_reason), \
                        patch.object(provider, "decrypt", return_value="key"), \
                        patch.object(provider, "bounded_json", return_value=response) as http:
                    if finish_reason == "tool_calls":
                        with self.assertRaises(InvalidProviderResponse) as caught:
                            provider.turn(fixture_model(), [{"role": "user", "content": "hi"}], "system", [])
                        self.assertEqual(caught.exception.diagnostics["reason"], "missing_tool_calls")
                        self.assertEqual(caught.exception.diagnostics["responseMode"], "json")
                        self.assertNotIn("PRIVATE_RESPONSE_TEXT", canonical(caught.exception.diagnostics))
                    else:
                        result = provider.turn(fixture_model(), [{"role": "user", "content": "hi"}], "system", [])
                        self.assertEqual(result["text"], "PRIVATE_RESPONSE_TEXT")
                        self.assertEqual(result["calls"], [])
                    http.assert_called_once()

    def test_sse_null_delta_and_incomplete_terminal_diagnostics(self):
        from .provider_stream import ProviderStream
        stream = ProviderStream("openai_compatible", lambda _: None)
        stream.feed(b'data: {"choices":[{"delta":{"content":"ok","tool_calls":null},"finish_reason":"stop"}]}\n\n')
        with self.assertRaises(InvalidProviderResponse) as caught:
            stream.finish()
        self.assertEqual(caught.exception.diagnostics["reason"], "sse_incomplete")
        stream.feed(b"data: [DONE]\n\n")
        self.assertEqual(stream.finish()["choices"][0]["message"]["content"], "ok")

    def test_unsafe_tool_argument_values_keep_policy_and_gain_safe_diagnostics(self):
        nested = {"value": "PRIVATE_ARGUMENT"}
        for _ in range(18):
            nested = {"child": nested}
        for arguments in ['{"value":NaN}', canonical(nested), '{"__proto__":"PRIVATE_ARGUMENT"}']:
            result = {"choices": [{"message": {"tool_calls": [{"id": "call-1", "type": "function",
                "function": {"name": "fixture_tool", "arguments": arguments}}]}}]}
            with self.subTest(arguments=arguments[:20]), patch.object(provider, "decrypt", return_value="key"), \
                    patch.object(provider, "bounded_json", return_value=result), self.assertRaises(InvalidProviderResponse) as caught:
                provider.turn(fixture_model(), [{"role": "user", "content": "hi"}], "system", [])
            self.assertEqual(caught.exception.diagnostics["reason"], "tool_arguments_bounds")
            self.assertEqual(caught.exception.diagnostics["stage"], "tool_calls")
            self.assertNotIn("PRIVATE_ARGUMENT", canonical(caught.exception.diagnostics))


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class CapabilityProbeApiTests(TestCase):
    setUp = support.AiDomainTests.setUp
    user = support.AiDomainTests.user
    call = support.AiDomainTests.call

    def test_connection_does_not_certify_tools_and_modes_are_independent(self):
        with patch.object(provider, "probe", return_value="文本连接成功"):
            response = self.call("/api/ai/models", {"action": "test", "id": self.model.id}, principal=support.ADMIN)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["capabilityProbe"]["nonStreaming"]["status"], "unverified")
        for mode, key, streaming in [("tool_roundtrip_json", "nonStreaming", False), ("tool_roundtrip_sse", "sse", True)]:
            wire = Wire(self, self.model, streaming)
            response = self.call("/api/ai/models", {"action": "test", "id": self.model.id, "testMode": mode}, principal=support.ADMIN)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()["capabilityProbe"][key]["status"], "passed")
            self.assertEqual(wire.connection.request.call_count, 2)
        self.model.refresh_from_db()
        record = configuration.model_record(self.model)
        self.assertEqual(record["capabilityProbe"]["nonStreaming"]["status"], "passed")
        self.assertEqual(record["capabilityProbe"]["sse"]["status"], "passed")
        self.assertNotIn("PRIVATE_REASONING", self.model.last_test_result)
        self.assertEqual(m.AiToolAuditLogs.objects.filter(tool_name="model_probe", status="started").count(), 5)

    def test_failure_persisted_and_configuration_or_adapter_edits_expire_evidence(self):
        with patch.object(provider, "probe", return_value="ok"):
            probes.run(self.model, support.ADMIN, "probe-current", "connection")
        self.model.refresh_from_db()
        self.model.version += 1
        self.assertEqual(probes.record(self.model)["connection"]["status"], "expired")
        self.model.refresh_from_db()
        with patch.object(probes, "PROVIDER_ADAPTER_VERSION", "next-version"):
            self.assertEqual(probes.record(self.model)["connection"]["status"], "expired")
        wire = Wire(self, self.model, reject_second=b"PRIVATE_BODY_NOT_JSON")
        with self.assertRaises(InvalidProviderResponse):
            probes.run(self.model, support.ADMIN, "probe-failed", "tool_roundtrip_json")
        self.model.refresh_from_db()
        self.assertEqual(probes.record(self.model)["nonStreaming"]["status"], "failed")
        self.assertNotIn("PRIVATE_BODY", self.model.last_test_result)
        self.assertEqual(wire.connection.request.call_count, 2)

    def test_plain_text_cannot_pass_tool_probe_and_nonadmin_cannot_dispatch(self):
        with patch.object(provider, "decrypt", return_value="key"), patch.object(provider, "bounded_json", return_value={"choices": [{"message": {"content": "connected"}}]}) as http:
            response = self.call("/api/ai/models", {"action": "test", "id": self.model.id, "testMode": "tool_roundtrip_json"}, principal=support.ADMIN)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(http.call_count, 1)
            response = self.call("/api/ai/models", {"action": "test", "id": self.model.id, "testMode": "tool_roundtrip_sse"})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(http.call_count, 1)

    def test_configuration_change_between_turns_stops_second_call_and_cannot_certify_new_config(self):
        def change_configuration(*args, **kwargs):
            m.AiModels.objects.filter(id=self.model.id).update(version=self.model.version + 1)
            return {"choices": [{"message": {"content": None, "tool_calls": [{"id": "call-1", "type": "function",
                "function": {"name": "provider_roundtrip_check", "arguments": '{"probe":"ready"}'}}]}}]}
        with patch.object(provider, "decrypt", return_value="key"), patch.object(provider, "bounded_json", side_effect=change_configuration) as http:
            with self.assertRaises(AiError) as caught:
                probes.run(self.model, support.ADMIN, "probe-config-change", "tool_roundtrip_json")
            self.assertEqual(caught.exception.code, "model_version_changed")
            self.assertEqual(http.call_count, 1)
        self.model.refresh_from_db()
        self.assertEqual(probes.record(self.model)["nonStreaming"]["status"], "unverified")

    def test_disabled_schedule_reference_protects_model_deletion(self):
        m.AiDingTalkSchedule.objects.create(id="schedule-ref", model_id=self.model.id, enabled=False,
            name="fixture", prompt="fixture", cadence="daily", hour=9, minute=0, target_type="person",
            target_id="fixture-target", sender_id="fixture-sender", owner_email=self.owner.email)
        with mutation(support.ADMIN), self.assertRaisesRegex(AiError, "定时任务引用"):
            configuration.delete_model({"id": self.model.id, "expectedVersion": self.model.version}, support.ADMIN)

    def test_ready_legacy_run_snapshot_protects_its_resolved_model(self):
        schedule = m.AiDingTalkSchedule.objects.create(id="legacy-ref", model_id="", enabled=False,
            name="fixture", prompt="fixture", cadence="daily", hour=9, minute=0, target_type="person",
            target_id="fixture-target", sender_id="fixture-sender", owner_email=self.owner.email)
        run = m.AiDingTalkScheduleRun.objects.create(id="ready-legacy", schedule=schedule, schedule_version=1,
            scheduled_at=timezone.now(), status="ready", model_snapshot_json=canonical({"id": self.model.id}))
        self.assertTrue(configuration.model_has_active_execution(m.AiModels.objects.filter(id=self.model.id).values_list("id", flat=True)))
        with mutation(support.ADMIN), self.assertRaisesRegex(AiError, "活动任务"):
            configuration.delete_model({"id": self.model.id, "expectedVersion": self.model.version}, support.ADMIN)
        run.status = "sent"
        run.save(update_fields=["status"])
        with mutation(support.ADMIN):
            result = configuration.delete_model({"id": self.model.id, "expectedVersion": self.model.version}, support.ADMIN)
        self.assertTrue(result["deleted"])


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class ScheduledAnalysisSeamTests(TransactionTestCase):
    setUp = support.AiDomainTests.setUp
    user = support.AiDomainTests.user

    def invoke(self, *, reply="确认本轮事实。", calls=None, truncated=False, analysis=None, client_id="fixed-monitor", provider_error=None):
        self.session = m.AiDingTalkSession.objects.create(id="session-" + client_id, config_digest="a" * 64,
            corp_id="fixture", robot_code="fixture", sender_id="fixture", conversation_type="1",
            external_conversation_id="fixture", owner_email=self.owner.email)
        self.guard = MagicMock(side_effect=getattr(self, "guard_check", None))
        self.analysis = analysis or {"facts": {"businessDate": "2026-10-15", "count": 2}, "systemPrompt": "仅解释库存事实。"}
        self.body = {"clientRequestId": client_id, "modelId": self.model.id, "conversationId": None,
                     "workspaceModule": "ai", "message": "解读监控事实"}
        def respond(*args, **kwargs):
            self.sent_frames = deepcopy(args[1])
            if provider_error:
                raise provider_error
            return {"text": reply, "calls": calls or [], "frame": {"role": "assistant", "content": reply}, "usage": {}, "truncated": truncated}
        self.http = self.enterContext(patch.object(provider, "turn", side_effect=respond))
        self.catalog = self.enterContext(patch.object(transport, "catalog", side_effect=AssertionError("catalog must not run")))
        self.execute = self.enterContext(patch.object(transport, "execute_tool", side_effect=AssertionError("tools must not run")))
        return chat.answer(self.body, self.owner, client_id, dingtalk_session=self.session,
                           channel_guard=self.guard, scheduled_analysis=self.analysis)

    def test_fixed_analysis_retains_receipt_guards_and_has_no_autonomous_tools(self):
        result = self.invoke()
        self.assertEqual(result["reply"], "确认本轮事实。")
        self.catalog.assert_not_called()
        self.execute.assert_not_called()
        args = self.http.call_args.args
        self.assertEqual(args[3], [])
        self.assertEqual(len(self.sent_frames), 1)
        self.assertIn("verified_monitor_facts", self.sent_frames[0]["content"])
        self.assertNotIn("先调用 get_data_freshness", args[2])
        self.assertGreaterEqual(self.guard.call_count, 3)
        self.assertEqual(m.AiChatProviderDispatches.objects.count(), 1)
        replay = chat.answer(self.body, self.owner, "fixed-replay", dingtalk_session=self.session,
                            channel_guard=self.guard, scheduled_analysis=self.analysis)
        self.assertEqual(replay["reply"], result["reply"])
        self.assertEqual(self.http.call_count, 1)
        with self.assertRaisesRegex(AiError, "绑定其他消息"):
            chat.answer(self.body, self.owner, "fixed-changed", dingtalk_session=self.session, channel_guard=self.guard,
                        scheduled_analysis={**self.analysis, "facts": {"count": 999}})
        self.assertEqual(self.http.call_count, 1)

    def test_incomplete_or_tool_calling_analysis_is_never_ready(self):
        for index, extra in enumerate([{"truncated": True}, {"calls": [{"id": "x", "name": "bad", "arguments": {}}]}, {"reply": "x" * 48001}]):
            with self.subTest(extra=list(extra)), self.assertRaises(AiError) as caught:
                self.invoke(client_id="incomplete-" + str(index), **extra)
            self.assertEqual(caught.exception.code, "scheduled_analysis_incomplete")
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())

    def test_public_body_and_non_dingtalk_kw_cannot_inject_trusted_facts(self):
        with self.assertRaises(AiError):
            chat.answer({"clientRequestId": "public", "message": "fixture", "scheduled_analysis": {"facts": {}}}, self.owner, "public")
        with self.assertRaises(AiError):
            chat.answer({"clientRequestId": "kw", "message": "fixture"}, self.owner, "kw", scheduled_analysis={"facts": {}, "systemPrompt": "fixture"})
        self.assertEqual(m.AiChatProviderDispatches.objects.count(), 0)

    def test_revocation_after_reservation_prevents_actual_provider_call(self):
        revoked = [False]
        def guard():
            if revoked[0]:
                raise AiError("任务已撤销", "access_denied", 403)
        self.guard_check = guard
        original_audit = chat.audit
        def audit(*args, **kwargs):
            result = original_audit(*args, **kwargs)
            if args[2:4] == ("ai_chat_provider", "started"):
                revoked[0] = True
            return result
        with patch.object(chat, "audit", side_effect=audit), self.assertRaises(AiError):
            self.invoke(client_id="revoked-after-reservation")
        self.http.assert_not_called()
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())

    def test_fixed_empty_response_is_not_paid_finalized_and_diagnostics_are_audited(self):
        empty = provider.EmptyProviderResponse(truncated=False, finish_reason="stop", has_reasoning=True, usage={})
        with self.assertRaises(provider.EmptyProviderResponse):
            self.invoke(provider_error=empty, client_id="empty-fixed")
        self.assertEqual(self.http.call_count, 1)
        with self.assertRaises(InvalidProviderResponse):
            self.invoke(provider_error=InvalidProviderResponse("message_shape", protocol="openai_compatible", mode="json"), client_id="invalid-fixed")
        failure = m.AiToolAuditLogs.objects.get(request_id="invalid-fixed", status="failed", tool_name="ai_chat_provider")
        self.assertIn('"reason":"message_shape"', failure.arguments_json)
        self.assertIn(PROVIDER_ADAPTER_VERSION, failure.arguments_json)
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())

    def test_network_phase_is_audited_without_replaying_unknown_dispatch(self):
        for index, (stage, started) in enumerate((("dns_recovery", False), ("response_body", True))):
            error = transport.ProviderTransportError(stage=stage, reason="timeout", request_started=started)
            request_id = "network-phase-" + str(index)
            with self.subTest(stage=stage), self.assertRaises(transport.ProviderTransportError):
                self.invoke(provider_error=error, client_id=request_id)
            self.http.assert_called_once()
            failure = m.AiToolAuditLogs.objects.get(request_id=request_id, status="failed", tool_name="ai_chat_provider")
            self.assertEqual(failure.error_code, "provider_dns_timeout" if not started else "provider_timeout")
            diagnostics = json.loads(failure.arguments_json)["responseDiagnostics"]
            self.assertEqual(diagnostics, error.diagnostics)
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())
