"""Network-only regression tests: no database, credentials or live providers."""

import json
import socket
import ssl
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from . import provider, transport
from .policy import AiError

HOST = "model.example.com"
URL = f"https://{HOST}/v1/chat/completions"


def addresses(*ips):
    return [
        (
            socket.AF_INET6 if ":" in ip else socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            (ip, 443),
        )
        for ip in ips
    ]


def dns_answer(kind, *ips):
    return {
        "Status": 0,
        "TC": False,
        "Question": [{"name": HOST, "type": kind}],
        "Answer": [{"name": HOST, "type": kind, "data": ip} for ip in ips],
    }


@override_settings(DJANGO_ENVIRONMENT="production")
class ModelDnsTests(SimpleTestCase):
    def setUp(self):
        self.env = patch.dict(
            "os.environ", {"AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST": f"https://{HOST}"}
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_fake_ip_is_replaced_with_public_pinned_addresses(self):
        with patch.object(
            transport,
            "_bounded_json",
            side_effect=[
                dns_answer(1, "8.8.4.4"),
                dns_answer(28, "2606:4700:4700::1111"),
            ],
        ) as dns:
            result = transport.public_model_addresses(
                URL, addresses("198.18.0.234"), 60
            )
        self.assertEqual(
            [row[4][0] for row in result], ["8.8.4.4", "2606:4700:4700::1111"]
        )
        for call in dns.call_args_list:
            self.assertTrue(call.args[0].startswith("https://1.1.1.1/dns-query?"))
            self.assertIsNone(call.args[1])
            self.assertEqual(call.args[2], {"Accept": "application/dns-json"})
            self.assertEqual(call.kwargs["method"], "GET")
            self.assertEqual(call.kwargs["fixed_addresses"][0][4], ("1.1.1.1", 443))
            self.assertLessEqual(call.kwargs["timeout"], 5)

    def test_public_dns_does_not_use_recovery(self):
        original = addresses("8.8.4.4")
        with patch.object(transport, "_bounded_json") as dns:
            self.assertIs(transport.public_model_addresses(URL, original, 60), original)
        dns.assert_not_called()

    def test_private_mixed_fake_and_unapproved_origins_never_query_doh(self):
        cases = [
            (URL, addresses("198.18.0.1", "127.0.0.1")),
            (URL, addresses("198.18.0.1", "10.0.0.1")),
            ("https://unapproved.example.com/v1", addresses("198.18.0.1")),
            ("https://198.18.0.1/v1", addresses("198.18.0.1")),
        ]
        for url, resolved in cases:
            with self.subTest(url=url, resolved=resolved), patch.object(
                transport, "_bounded_json"
            ) as dns:
                with self.assertRaises(AiError):
                    transport.public_model_addresses(url, resolved, 60)
                dns.assert_not_called()

    def test_private_and_multicast_destinations_never_open_socket(self):
        for ip in (
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "::1",
            "fc00::1",
            "224.0.0.1",
        ):
            with self.subTest(ip=ip), patch.object(
                transport, "resolve_addresses", return_value=addresses(ip)
            ), patch.object(transport.socket, "socket") as sock:
                with self.assertRaises(AiError):
                    transport.bounded_json(URL, {})
                sock.assert_not_called()

    def test_doh_never_accepts_nonpublic_answers(self):
        for ip in (
            "10.0.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "198.18.0.1",
            "224.0.0.1",
            "garbage",
        ):
            with self.subTest(ip=ip), patch.object(
                transport, "_bounded_json", return_value=dns_answer(1, ip)
            ):
                with self.assertRaises(AiError):
                    transport.public_model_addresses(URL, addresses("198.18.0.234"), 60)

    def test_dns_failure_malformed_or_empty_answers_fail_closed(self):
        valid = dns_answer(1, "8.8.4.4")
        for answer in (
            {},
            {**valid, "Status": 2},
            {**valid, "Status": False},
            {**valid, "TC": True},
            {**valid, "Question": []},
            {**valid, "Question": [{"name": "other.example.com", "type": 1}]},
            {**valid, "Answer": [None]},
            {**valid, "Answer": [None] * 33},
        ):
            with self.subTest(answer=answer), patch.object(
                transport, "_bounded_json", return_value=answer
            ):
                with self.assertRaises(AiError):
                    transport.public_model_addresses(URL, addresses("198.18.0.234"), 60)
        with patch.object(
            transport, "_bounded_json", side_effect=[dns_answer(1), dns_answer(28)]
        ):
            with self.assertRaises(AiError):
                transport.public_model_addresses(URL, addresses("198.18.0.234"), 60)

    def test_private_ipv6_poisoning_rejects_public_ipv4_answer(self):
        with patch.object(
            transport,
            "_bounded_json",
            side_effect=[dns_answer(1, "8.8.4.4"), dns_answer(28, "::1")],
        ):
            with self.assertRaises(AiError):
                transport.public_model_addresses(URL, addresses("198.18.0.234"), 60)

    def test_expired_dns_budget_never_queries_or_retries(self):
        with patch.object(transport, "_bounded_json") as dns:
            with self.assertRaises(AiError):
                transport.public_model_addresses(URL, addresses("198.18.0.234"), 0)
        dns.assert_not_called()
        with patch.object(
            transport, "_bounded_json", side_effect=AiError("DNS unavailable")
        ) as dns:
            with self.assertRaises(AiError):
                transport.public_model_addresses(URL, addresses("198.18.0.234"), 60)
        self.assertEqual(dns.call_count, 1)

    def wire(self, *responses):
        sock = MagicMock()
        context = MagicMock()
        context.wrap_socket.return_value = sock
        connections = []
        for value in responses:
            response = MagicMock(status=200)
            response.getheader.return_value = None
            response.read1.side_effect = [json.dumps(value).encode(), b""]
            conn = MagicMock()
            conn.getresponse.return_value = response
            connections.append(conn)
        self.enterContext(patch.object(transport.socket, "socket", return_value=sock))
        self.enterContext(
            patch.object(transport.ssl, "create_default_context", return_value=context)
        )
        self.enterContext(
            patch.object(
                transport.http.client, "HTTPConnection", side_effect=connections
            )
        )
        return sock, context, connections

    def test_full_request_uses_real_ip_original_tls_host_and_one_provider_post(self):
        sock, context, connections = self.wire(
            dns_answer(1, "8.8.4.4"), dns_answer(28), {"choices": []}
        )
        with patch.object(
            transport, "resolve_addresses", return_value=addresses("198.18.0.234")
        ) as system_dns:
            result = transport.bounded_json(
                URL, {"messages": ["test"]}, {"Authorization": "Bearer fixture"}
            )
        self.assertEqual(result, {"choices": []})
        self.assertEqual(system_dns.call_count, 1)
        self.assertEqual(
            [call.args[0] for call in sock.connect.call_args_list],
            [("1.1.1.1", 443), ("1.1.1.1", 443), ("8.8.4.4", 443)],
        )
        self.assertEqual(context.wrap_socket.call_args.kwargs["server_hostname"], HOST)
        for conn in connections[:2]:
            args = conn.request.call_args.args
            self.assertEqual(args[0], "GET")
            self.assertIsNone(args[2])
            self.assertNotIn("Authorization", args[3])
        connections[2].request.assert_called_once()
        self.assertEqual(
            connections[2].request.call_args.args[0:2], ("POST", "/v1/chat/completions")
        )

    def test_redirect_or_oversized_doh_stops_before_provider_post(self):
        for status, length in ((302, None), (200, "16385")):
            with self.subTest(status=status):
                sock, _, connections = self.wire({})
                response = connections[0].getresponse.return_value
                response.status = status
                response.getheader.return_value = length
                with patch.object(
                    transport,
                    "resolve_addresses",
                    return_value=addresses("198.18.0.234"),
                ):
                    with self.assertRaises(AiError):
                        transport.bounded_json(
                            URL, {}, {"Authorization": "Bearer fixture"}
                        )
                self.assertEqual(sock.connect.call_count, 1)
                self.assertEqual(connections[0].request.call_args.args[0], "GET")

    def test_tls_failure_never_posts_or_retries(self):
        sock, context, connections = self.wire({})
        context.wrap_socket.side_effect = ssl.SSLCertVerificationError("fixture")
        with patch.object(
            transport, "resolve_addresses", return_value=addresses("198.18.0.234")
        ):
            with self.assertRaises(AiError):
                transport.bounded_json(URL, {})
        self.assertEqual(sock.connect.call_count, 1)
        connections[0].request.assert_not_called()

    def test_model_turn_returns_reply_after_synthetic_dns_recovery(self):
        self.wire(
            dns_answer(1, "8.8.4.4"),
            dns_answer(28),
            {"choices": [{"message": {"role": "assistant", "content": "连接成功"}}]},
        )
        model = SimpleNamespace(
            base_url=URL.rsplit("/chat/completions", 1)[0],
            api_key_encrypted="fixture",
            protocol="openai_compatible",
            model_name="fixture-model",
            max_tokens=128,
            temperature_milli=100,
            reasoning_mode="disabled",
            timeout_ms=60000,
        )
        with patch.object(
            transport, "resolve_addresses", return_value=addresses("198.18.0.234")
        ), patch.object(provider, "decrypt", return_value="fixture-key"):
            reply = provider.turn(
                model, [{"role": "user", "content": "你好"}], "测试", []
            )
        self.assertEqual(reply["text"], "连接成功")
        self.assertEqual(reply["calls"], [])

    def test_internal_bridge_does_not_query_public_dns(self):
        sock, _, connections = self.wire({"ok": True})
        with patch.object(
            transport, "resolve_addresses", return_value=addresses("127.0.0.1")
        ), patch.object(transport, "public_model_addresses") as recovery:
            result = transport.bounded_json(
                "http://127.0.0.1:3000/api/ai/internal/edge", {}, internal=True
            )
        self.assertEqual(result, {"ok": True})
        recovery.assert_not_called()
        connections[0].request.assert_called_once()
