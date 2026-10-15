"""Synthetic DNS/HTTP phase regressions; no DB, keys or provider traffic."""
import json
import socket
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from . import provider, transport
from .policy import AiError, canonical
from .provider_contract import PROVIDER_ADAPTER_VERSION
from .test_transport import HOST, URL, addresses, dns_answer


@override_settings(DJANGO_ENVIRONMENT="production")
class DnsPhaseTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch.dict("os.environ", {"AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST": f"https://{HOST}"}))

    def wire(self, value=None):
        sock, context, connection = MagicMock(), MagicMock(), MagicMock()
        context.wrap_socket.return_value = sock
        response = MagicMock(status=200)
        response.isclosed.return_value = False
        response.getheader.return_value = None
        response.read1.side_effect = [json.dumps(value or {}).encode(), b""]
        connection.getresponse.return_value = response
        self.enterContext(patch.object(transport.socket, "socket", return_value=sock))
        self.enterContext(patch.object(transport.ssl, "create_default_context", return_value=context))
        self.enterContext(patch.object(transport.http.client, "HTTPConnection", return_value=connection))
        return sock, connection, response

    def test_valid_a_does_not_wait_for_unused_aaaa_timeout(self):
        with patch.object(transport, "_bounded_json", side_effect=[dns_answer(1, "8.8.4.4"), TimeoutError("PRIVATE")]) as query:
            result = transport.public_model_addresses(URL, addresses("198.18.0.1"), 1_000_000)
        self.assertEqual(result, addresses("8.8.4.4"))
        query.assert_called_once()

    def test_a_response_must_be_completely_valid_before_short_circuit(self):
        for tail in (None, {"type": 1, "data": "10.0.0.1"}, {"type": 28, "data": "::1"}):
            value = dns_answer(1, "8.8.4.4")
            value["Answer"].append(tail)
            with self.subTest(tail=tail), patch.object(transport, "_bounded_json", return_value=value) as query:
                with self.assertRaises(AiError):
                    transport.public_model_addresses(URL, addresses("198.18.0.1"), 60)
            query.assert_called_once()

    def test_empty_a_then_aaaa_uses_remaining_shared_dns_budget(self):
        clock = [100.0]
        def query(*args, **kwargs):
            if "type=1" in args[0]:
                self.assertEqual(kwargs["timeout"], 5)
                clock[0] += 3
                return dns_answer(1)
            self.assertEqual(kwargs["timeout"], 2)
            clock[0] += 1.5
            return dns_answer(28, "2606:4700:4700::1111")
        with patch.object(transport.time, "monotonic", side_effect=lambda: clock[0]), patch.object(transport, "_bounded_json", side_effect=query) as send:
            result = transport.public_model_addresses(URL, addresses("198.18.0.1"), 60)
        self.assertEqual(send.call_count, 2)
        self.assertEqual(result[0][4], ("2606:4700:4700::1111", 443, 0, 0))

    def test_late_a_never_starts_aaaa_or_model_connection(self):
        clock = [100.0]
        for value in (dns_answer(1), dns_answer(1, "8.8.4.4")):
            clock[0] = 100.0
            def query(*args, **kwargs):
                clock[0] += kwargs["timeout"]
                return value
            with self.subTest(value=value), patch.object(transport.time, "monotonic", side_effect=lambda: clock[0]), patch.object(transport, "_bounded_json", side_effect=query) as send:
                with self.assertRaises(transport.ProviderTransportError) as caught:
                    transport.public_model_addresses(URL, addresses("198.18.0.1"), 3)
            self.assertEqual(caught.exception.code, "provider_dns_timeout")
            self.assertFalse(caught.exception.diagnostics["requestStarted"])
            send.assert_called_once()

    def test_os_dns_timeout_failure_and_busy_have_safe_distinct_metadata(self):
        cases = [(transport.FutureTimeout("PRIVATE"), "provider_dns_timeout", "timeout"),
                 (socket.gaierror("PRIVATE"), "provider_dns_unavailable", "unavailable")]
        for error, code, reason in cases:
            future, pool, slots = MagicMock(), MagicMock(), MagicMock()
            future.result.side_effect = error
            pool.submit.return_value = future
            with self.subTest(code=code), patch.object(transport, "_dns_pool", pool), patch.object(transport, "_dns_slots", slots):
                with self.assertRaises(transport.ProviderTransportError) as caught:
                    transport.resolve_addresses(HOST, 443, 60)
            self.assertEqual(caught.exception.code, code)
            self.assertEqual(caught.exception.diagnostics["stage"], "system_dns")
            self.assertEqual(caught.exception.diagnostics["reason"], reason)
            self.assertNotIn("PRIVATE", canonical(caught.exception.diagnostics))
        with patch.object(transport, "_dns_slots") as slots, patch.object(transport, "_dns_pool") as pool:
            slots.acquire.return_value = False
            with self.assertRaises(transport.ProviderTransportError) as caught:
                transport.resolve_addresses(HOST, 443, 60)
        self.assertEqual(caught.exception.diagnostics["reason"], "busy")
        pool.submit.assert_not_called()

    def test_real_doh_timeout_is_dns_failure_with_zero_model_posts(self):
        for phase in ("tls", "response_body"):
            sock, connection, response = self.wire()
            if phase == "tls":
                sock.do_handshake.side_effect = TimeoutError("PRIVATE_NETWORK_DETAILS")
            else:
                response.read1.side_effect = TimeoutError("PRIVATE_NETWORK_DETAILS")
            with self.subTest(phase=phase), patch.object(transport, "resolve_addresses", return_value=addresses("198.18.0.1")):
                with self.assertRaises(transport.ProviderTransportError) as caught:
                    transport.bounded_json(URL, {"messages": ["PRIVATE_PROMPT"]}, {"Authorization": "Bearer PRIVATE_KEY"}, timeout=1_000_000)
            self.assertEqual(caught.exception.code, "provider_dns_timeout")
            self.assertEqual(caught.exception.diagnostics["stage"], "dns_recovery")
            self.assertEqual(caught.exception.diagnostics["resolverPhase"], phase)
            self.assertFalse(caught.exception.diagnostics["requestStarted"])
            self.assertNotIn("PRIVATE", str(caught.exception) + canonical(caught.exception.diagnostics))
            self.assertTrue(all(call.args[0] == "GET" and call.args[2] is None and "Authorization" not in call.args[3]
                                for call in connection.request.call_args_list))
            self.assertLessEqual(connection.request.call_count, 1)
            self.assertEqual(sock.connect.call_count, 1)

    def test_dns_protocol_failure_is_not_a_model_protocol_failure(self):
        _, connection, response = self.wire()
        response.read1.side_effect = [b"PRIVATE_NON_JSON", b""]
        with patch.object(transport, "resolve_addresses", return_value=addresses("198.18.0.1")):
            with self.assertRaises(transport.ProviderTransportError) as caught:
                transport.bounded_json(URL, {})
        self.assertEqual(caught.exception.code, "provider_dns_unavailable")
        self.assertEqual(caught.exception.diagnostics["reason"], "invalid_response")
        self.assertFalse(caught.exception.diagnostics["requestStarted"])
        connection.request.assert_called_once()
        self.assertEqual(connection.request.call_args.args[0], "GET")

    def test_dns_recovery_preserves_permission_and_cancellation_failures(self):
        for code in ("access_denied", "cancelled"):
            original = AiError("fixture", code, 403)
            with self.subTest(code=code), patch.object(transport, "_bounded_json", side_effect=original) as query:
                with self.assertRaises(AiError) as caught:
                    transport.public_model_addresses(URL, addresses("198.18.0.1"), 60)
            self.assertIs(caught.exception, original)
            query.assert_called_once()

    def test_model_phase_timeouts_remain_unknown_after_request_attempt_without_replay(self):
        for phase in ("connect", "tls", "request_send", "response_headers", "response_body"):
            sock, connection, response = self.wire()
            target = {"connect": sock.connect, "tls": sock.do_handshake, "request_send": connection.request,
                      "response_headers": connection.getresponse, "response_body": response.read1}[phase]
            target.side_effect = TimeoutError("PRIVATE")
            with self.subTest(phase=phase), patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
                with self.assertRaises(transport.ProviderTransportError) as caught:
                    transport.bounded_json(URL, {}, timeout=1_000_000)
            self.assertEqual(caught.exception.code, "provider_timeout")
            self.assertEqual(caught.exception.diagnostics["stage"], phase)
            self.assertEqual(caught.exception.diagnostics["requestStarted"], phase not in {"connect", "tls"})
            self.assertEqual(connection.request.call_count, 0 if phase in {"connect", "tls"} else 1)
            self.assertNotIn("PRIVATE", str(caught.exception) + canonical(caught.exception.diagnostics))

    def test_common_deadline_stops_tls_or_post_after_expired_stage(self):
        for phase in ("connect", "tls"):
            clock = [100.0]
            sock, connection, _ = self.wire()
            def expire(*args, **kwargs):
                clock[0] += 2
            (sock.connect if phase == "connect" else sock.do_handshake).side_effect = expire
            with self.subTest(phase=phase), patch.object(transport.time, "monotonic", side_effect=lambda: clock[0]), patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")), transport.request_budget(1):
                with self.assertRaises(transport.ProviderTransportError):
                    transport.bounded_json(URL, {}, timeout=1_000_000)
            connection.request.assert_not_called()
            if phase == "connect":
                sock.do_handshake.assert_not_called()

    def test_deadline_is_rechecked_immediately_before_tcp_connect(self):
        clock = [100.0]
        sock, connection, _ = self.wire()
        stop = MagicMock()
        def prepare(*args):
            clock[0] += 2
            return stop
        with patch.object(transport.time, "monotonic", side_effect=lambda: clock[0]), patch.object(transport, "watch_socket_cancellation", side_effect=prepare), patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")), transport.request_budget(1):
            with self.assertRaises(transport.ProviderTransportError) as caught:
                transport.bounded_json(URL, {}, timeout=1_000_000)
        self.assertEqual(caught.exception.diagnostics["stage"], "connect")
        self.assertFalse(caught.exception.diagnostics["requestStarted"])
        sock.connect.assert_not_called()
        connection.request.assert_not_called()
        stop.assert_called_once()

    def test_provider_adds_json_and_sse_metadata_without_shrinking_large_parameters(self):
        model = SimpleNamespace(base_url="https://opencode.ai/zen/go/v1", api_key_encrypted="fixture",
            protocol="openai_compatible", model_name="fixture", max_tokens=65536, temperature_milli=200,
            reasoning_mode="auto", timeout_ms=60_000,
            generation_options_json=canonical({"contextWindowTokens":1_000_000,"taskTimeoutMs":1_000_000_000}))
        for streaming in (False, True):
            original = transport.ProviderTransportError(stage="dns_recovery", reason="timeout")
            with self.subTest(streaming=streaming), patch.object(provider, "decrypt", return_value="PRIVATE"), patch.object(provider, "bounded_sse" if streaming else "bounded_json", side_effect=original) as send:
                with self.assertRaises(transport.ProviderTransportError) as caught:
                    provider.turn(model, [{"role":"user","content":"fixture"}], "fixture", [], on_text=(lambda _: None) if streaming else None)
            self.assertIs(caught.exception, original)
            self.assertEqual(original.diagnostics["adapterVersion"], PROVIDER_ADAPTER_VERSION)
            self.assertEqual(original.diagnostics["protocol"], "openai_compatible")
            self.assertEqual(original.diagnostics["responseMode"], "sse" if streaming else "json")
            send.assert_called_once()
            self.assertEqual(send.call_args.kwargs["timeout"], 1_000_000)
            self.assertEqual(send.call_args.args[1]["max_tokens"], 65536)
