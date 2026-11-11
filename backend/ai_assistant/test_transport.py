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
            [row[4][0] for row in result], ["8.8.4.4"]
        )
        dns.assert_called_once()
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

    def test_complete_a_answer_is_validated_before_returning_any_public_address(self):
        with patch.object(
            transport,
            "_bounded_json",
            return_value=dns_answer(1, "8.8.4.4", "127.0.0.1"),
        ) as dns:
            with self.assertRaises(AiError):
                transport.public_model_addresses(URL, addresses("198.18.0.234"), 60)
        dns.assert_called_once()

    def test_empty_a_falls_back_to_aaaa_but_private_ipv6_is_rejected(self):
        with patch.object(transport, "_bounded_json", side_effect=[dns_answer(1), dns_answer(28, "::1")]) as dns:
            with self.assertRaises(AiError):
                transport.public_model_addresses(URL, addresses("198.18.0.234"), 60)
        self.assertEqual(dns.call_count, 2)

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
            response.isclosed.return_value = False
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
            dns_answer(1, "8.8.4.4"), {"choices": []}
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
            [("1.1.1.1", 443), ("8.8.4.4", 443)],
        )
        self.assertEqual(context.wrap_socket.call_args.kwargs["server_hostname"], HOST)
        for conn in connections[:1]:
            args = conn.request.call_args.args
            self.assertEqual(args[0], "GET")
            self.assertIsNone(args[2])
            self.assertNotIn("Authorization", args[3])
        connections[1].request.assert_called_once()
        self.assertEqual(
            connections[1].request.call_args.args[0:2], ("POST", "/v1/chat/completions")
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

    def test_http_rejection_retains_only_status_without_retry_or_response_body(self):
        for status in (400, 429, 503):
            with self.subTest(status=status):
                _, _, connections = self.wire({"error": {"message": "private-provider-body-fixture"}})
                connections[0].getresponse.return_value.status = status
                with patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
                    with self.assertRaises(transport.ProviderHttpError) as caught:
                        transport.bounded_json(URL, {}, {"Authorization": "Bearer private-key-fixture"})
                self.assertEqual(caught.exception.diagnostics["httpStatus"], status)
                self.assertEqual(caught.exception.diagnostics["appStatus"], 503)
                self.assertEqual(caught.exception.diagnostics["stage"], "provider_http")
                self.assertEqual(caught.exception.diagnostics["requestStarted"], True)
                self.assertIn("provider_http", caught.exception.diagnostics["timingsMs"])
                self.assertEqual(caught.exception.code, "provider_rate_limited" if status == 429 else "provider_error")
                self.assertNotIn("private-", str(caught.exception))
                connections[0].request.assert_called_once()

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

    def wire_sockets(self, *socks, value=None):
        """Like wire(), but each connect attempt gets its own socket mock, so a
        failed first attempt and a successful retry can be driven independently.
        """
        context = MagicMock()
        context.wrap_socket.side_effect = lambda sock, **kwargs: sock
        response = MagicMock(status=200)
        response.isclosed.return_value = False
        response.getheader.return_value = None
        response.read1.side_effect = [json.dumps(value or {}).encode(), b""]
        connection = MagicMock()
        connection.getresponse.return_value = response
        self.enterContext(patch.object(transport.socket, "socket", side_effect=socks))
        self.enterContext(patch.object(transport.ssl, "create_default_context", return_value=context))
        self.enterContext(patch.object(transport.http.client, "HTTPConnection", return_value=connection))
        return connection, response

    def json_connection(self, value):
        response = MagicMock(status=200)
        response.isclosed.return_value = False
        response.getheader.return_value = None
        response.read1.side_effect = [json.dumps(value).encode(), b""]
        connection = MagicMock()
        connection.getresponse.return_value = response
        return connection

    def reresolve_wiring(self, sockets, connections):
        context = MagicMock()
        context.wrap_socket.side_effect = lambda sock, **kwargs: sock
        self.enterContext(patch.object(transport.socket, "socket", side_effect=sockets))
        self.enterContext(patch.object(transport.ssl, "create_default_context", return_value=context))
        self.enterContext(patch.object(
            transport.http.client, "HTTPConnection", side_effect=connections,
        ))

    def test_single_address_tls_eof_falls_back_to_next_resolvers_address(self):
        # Real failure: cf answers with exactly one A record for
        # api.dingtalk.com, 161.117.70.119, whose TLS handshake fails with
        # SSLEOFError in 0.15-0.70s. tx (1.12.12.12) answers 106.11.23.24,
        # which completes the handshake in ~0.13s. public_model_addresses
        # must re-resolve, excluding the proven-bad cf answer. cf rotates its
        # single answer between equally unreachable nodes, so the
        # re-resolution asks tx FIRST and never cf again. Every phase (DoH to
        # cf, model connect to cf's bad IP, DoH to tx, model connect to tx's
        # good IP) runs through real socket-level mocks.
        doh_cf_sock, model_cf_sock, doh_tx_sock, model_tx_sock = (
            MagicMock(), MagicMock(), MagicMock(), MagicMock()
        )
        model_cf_sock.do_handshake.side_effect = ssl.SSLEOFError("fixture-cf-eof")
        cf_answer = self.json_connection(dns_answer(1, "161.117.70.119"))
        tx_answer = self.json_connection(dns_answer(1, "106.11.23.24"))
        model_connection = self.json_connection({"accessToken": "fixture"})
        # connect_phase() retries entirely at the socket layer before any
        # HTTPConnection exists; the failed model-cf attempt never reaches
        # the constructor. Three calls: DoH to cf, DoH to tx, the model POST.
        self.reresolve_wiring(
            [doh_cf_sock, model_cf_sock, doh_tx_sock, model_tx_sock],
            [cf_answer, tx_answer, model_connection],
        )
        with patch.object(transport, "resolve_addresses", return_value=addresses("198.18.0.9")):
            result = transport.bounded_json(URL, {"appKey": "k"})
        self.assertEqual(result, {"accessToken": "fixture"})
        self.assertEqual(
            [doh_cf_sock.connect.call_args, model_cf_sock.connect.call_args,
             doh_tx_sock.connect.call_args, model_tx_sock.connect.call_args],
            [((("1.1.1.1", 443),),), ((("161.117.70.119", 443),),),
             ((("1.12.12.12", 443),),), ((("106.11.23.24", 443),),)],
        )
        model_connection.request.assert_called_once()

    def test_reresolution_after_rotating_primary_goes_to_secondary_without_asking_primary_again(self):
        # 2026-11-11 production failure: cf answered 161.117.107.66 (TLS
        # SSLEOFError through the proxy). cf rotates among overseas nodes, so
        # asking it again could return another unreachable node that is not in
        # `exclude` and would be accepted. The re-resolution must go straight
        # to tx, which answers a domestic node that completes TLS. The socket
        # list has exactly four entries, so a second cf query would exhaust it
        # (StopIteration) instead of silently passing.
        doh_cf_sock, model_cf_sock, doh_tx_sock, model_tx_sock = (
            MagicMock(), MagicMock(), MagicMock(), MagicMock()
        )
        model_cf_sock.do_handshake.side_effect = ssl.SSLEOFError("fixture-cf-eof")
        cf_answer = self.json_connection(dns_answer(1, "161.117.107.66"))
        tx_answer = self.json_connection(dns_answer(1, "106.11.23.24"))
        model_connection = self.json_connection({"accessToken": "fixture"})
        self.reresolve_wiring(
            [doh_cf_sock, model_cf_sock, doh_tx_sock, model_tx_sock],
            [cf_answer, tx_answer, model_connection],
        )
        with patch.object(transport, "resolve_addresses", return_value=addresses("198.18.0.9")):
            result = transport.bounded_json(URL, {"appKey": "k"})
        self.assertEqual(result, {"accessToken": "fixture"})
        self.assertEqual(
            [sock.connect.call_args for sock in
             (doh_cf_sock, model_cf_sock, doh_tx_sock, model_tx_sock)],
            [((("1.1.1.1", 443),),), ((("161.117.107.66", 443),),),
             ((("1.12.12.12", 443),),), ((("106.11.23.24", 443),),)],
        )
        model_connection.request.assert_called_once()

    def test_reresolution_asks_primary_as_last_resort_when_secondary_is_unreachable(self):
        # The primary stays a fallback: when tx cannot be connected to during
        # the re-resolution, cf is asked last and its NEW (not excluded)
        # address is used and succeeds.
        doh_cf_sock_1, model_bad_sock, doh_tx_sock, doh_cf_sock_2, model_good_sock = (
            MagicMock(), MagicMock(), MagicMock(), MagicMock(), MagicMock()
        )
        model_bad_sock.do_handshake.side_effect = ssl.SSLEOFError("fixture-cf-eof")
        doh_tx_sock.connect.side_effect = ConnectionRefusedError("fixture-tx-down")
        cf_answer_1 = self.json_connection(dns_answer(1, "161.117.107.66"))
        cf_answer_2 = self.json_connection(dns_answer(1, "47.246.137.199"))
        model_connection = self.json_connection({"accessToken": "fixture"})
        self.reresolve_wiring(
            [doh_cf_sock_1, model_bad_sock, doh_tx_sock, doh_cf_sock_2, model_good_sock],
            [cf_answer_1, cf_answer_2, model_connection],
        )
        with patch.object(transport, "resolve_addresses", return_value=addresses("198.18.0.9")):
            result = transport.bounded_json(URL, {"appKey": "k"})
        self.assertEqual(result, {"accessToken": "fixture"})
        self.assertEqual(
            [sock.connect.call_args for sock in
             (doh_cf_sock_1, model_bad_sock, doh_tx_sock, doh_cf_sock_2, model_good_sock)],
            [((("1.1.1.1", 443),),), ((("161.117.107.66", 443),),),
             ((("1.12.12.12", 443),),), ((("1.1.1.1", 443),),),
             ((("47.246.137.199", 443),),)],
        )

    def test_reresolution_budget_goes_to_first_asked_resolver_and_bounded_window_to_last_resort(self):
        # The re-resolution's first-asked resolver (tx) draws on the shared
        # budget min(5, timeout); the last-resort primary only gets the
        # bounded fallback window, and the caller's anchor is extended so the
        # primary's late answer is not discarded. Without `exclude` the order
        # and the budget split are the original ones (cf shared, tx bounded).
        clock = [100.0]
        timeouts = []
        urls = []

        def query(url, *args, **kwargs):
            urls.append(url)
            timeouts.append(kwargs["timeout"])
            if ("1.12.12.12" if exclude else "1.1.1.1") in url:
                clock[0] += 5.0
                raise transport.ProviderTransportError(stage="connect", reason="unavailable")
            return dns_answer(1, "47.246.137.199" if exclude else "106.11.23.24")

        for exclude in (frozenset({"161.117.107.66"}), frozenset()):
            urls.clear()
            timeouts.clear()
            clock[0] = 100.0
            with self.subTest(exclude=bool(exclude)), patch.object(
                transport.time, "monotonic", side_effect=lambda: clock[0]
            ), patch.object(transport, "_bounded_json", side_effect=query):
                result = transport.public_model_addresses(
                    URL, addresses("198.18.0.9"), 60, exclude=exclude
                )
            self.assertEqual(
                [row[4][0] for row in result],
                ["47.246.137.199" if exclude else "106.11.23.24"],
            )
            first, second = ("1.12.12.12", "1.1.1.1") if exclude else ("1.1.1.1", "1.12.12.12")
            self.assertTrue(urls[0].startswith(f"https://{first}/dns-query?"))
            self.assertTrue(urls[1].startswith(f"https://{second}/dns-query?"))
            self.assertEqual(timeouts, [5, 3])

    def test_reresolution_slow_all_excluded_answer_leaves_last_resort_the_bounded_window(self):
        # Re-resolution: tx is asked first with the shared budget and answers
        # slowly (4.5s) with only an address that is already excluded, so it
        # lands in skip_resolvers and _recovery_answer runs again. cf, asked
        # last, must get the bounded fallback window min(3, 5 + 3 - 4.5, ...)
        # = 3, not the 0.5s left of the shared budget. Pins the
        # `not skip_resolvers` half of the shared-budget condition.
        clock = [100.0]
        timeouts = []
        urls = []

        def query(url, *args, **kwargs):
            urls.append(url)
            timeouts.append(kwargs["timeout"])
            if "1.12.12.12" in url:
                clock[0] += 4.5
                return dns_answer(1, "161.117.107.66")
            return dns_answer(1, "47.246.137.199")

        with patch.object(
            transport.time, "monotonic", side_effect=lambda: clock[0]
        ), patch.object(transport, "_bounded_json", side_effect=query):
            result = transport.public_model_addresses(
                URL, addresses("198.18.0.9"), 60, exclude=frozenset({"161.117.107.66"})
            )
        self.assertEqual([row[4][0] for row in result], ["47.246.137.199"])
        self.assertEqual(len(urls), 2)
        self.assertTrue(urls[0].startswith("https://1.12.12.12/dns-query?"))
        self.assertTrue(urls[1].startswith("https://1.1.1.1/dns-query?"))
        self.assertEqual(timeouts, [5, 3])

    def test_multiple_addresses_first_fails_second_succeeds(self):
        # opencode.ai answers 4 IPs for one A query; only the first is
        # unreachable here, so the fix must move to the second address in
        # the same list without any extra DNS query. None of these
        # addresses are synthetic, so _public_addresses/DoH never runs.
        first_sock, second_sock = MagicMock(), MagicMock()
        first_sock.connect.side_effect = ConnectionRefusedError("fixture-refused")
        second_sock.connect = MagicMock()
        second_sock.do_handshake = MagicMock()
        connection, response = self.wire_sockets(first_sock, second_sock, value={"ok": True})
        resolved = addresses("104.21.1.1", "172.67.2.2", "104.21.3.3", "172.67.4.4")
        with patch.object(transport, "resolve_addresses", return_value=resolved):
            result = transport.bounded_json(URL, {})
        self.assertEqual(result, {"ok": True})
        first_sock.connect.assert_called_once_with(("104.21.1.1", 443))
        second_sock.connect.assert_called_once_with(("172.67.2.2", 443))
        connection.request.assert_called_once()

    def test_cert_failure_still_connects_only_once_with_multiple_addresses_available(self):
        # Regression for the retry path itself: even with a second address
        # ready to try and a resolver able to supply more, a certificate we
        # cannot verify must never be retried on any address.
        first_sock, second_sock = MagicMock(), MagicMock()
        first_sock.do_handshake.side_effect = ssl.SSLCertVerificationError("fixture")
        connection, response = self.wire_sockets(first_sock, second_sock, value={})
        resolved = addresses("104.21.1.1", "172.67.2.2")
        with patch.object(transport, "resolve_addresses", return_value=resolved):
            with self.assertRaises(AiError) as caught:
                transport.bounded_json(URL, {})
        self.assertEqual(caught.exception.code, "provider_unavailable")
        first_sock.connect.assert_called_once()
        second_sock.connect.assert_not_called()
        connection.request.assert_not_called()

    def test_request_already_sent_is_never_retried_even_with_addresses_left(self):
        # The second address and the resolver callback both exist, but the
        # failure happens after request_started=True (response_headers phase
        # here), which must never trigger a retry: AGENTS.md's "no misfires".
        first_sock, second_sock = MagicMock(), MagicMock()
        first_sock.do_handshake = MagicMock()
        connection, response = self.wire_sockets(first_sock, second_sock, value={})
        connection.getresponse.side_effect = ConnectionResetError("fixture-reset")
        resolved = addresses("104.21.1.1", "172.67.2.2")
        with patch.object(transport, "resolve_addresses", return_value=resolved):
            with self.assertRaises(AiError) as caught:
                transport.bounded_json(URL, {})
        self.assertEqual(caught.exception.diagnostics["stage"], "response_headers")
        self.assertTrue(caught.exception.diagnostics["requestStarted"])
        first_sock.connect.assert_called_once()
        second_sock.connect.assert_not_called()
        connection.request.assert_called_once()

    def test_retry_stops_once_budget_is_exhausted(self):
        # A second address and a resolver are both available, but the shared
        # deadline is gone by the time the first address fails: the retry
        # loop must stop and raise instead of spending time past the budget.
        clock = [100.0]
        first_sock, second_sock = MagicMock(), MagicMock()
        def expire(*args, **kwargs):
            clock[0] += 5
            raise ConnectionRefusedError("fixture-refused")
        first_sock.connect.side_effect = expire
        connection, response = self.wire_sockets(first_sock, second_sock, value={})
        resolved = addresses("104.21.1.1", "172.67.2.2")
        with patch.object(transport.time, "monotonic", side_effect=lambda: clock[0]), patch.object(
            transport, "resolve_addresses", return_value=resolved
        ), transport.request_budget(5):
            with self.assertRaises(transport.ProviderTransportError) as caught:
                transport.bounded_json(URL, {}, timeout=1_000_000)
        self.assertEqual(caught.exception.diagnostics["stage"], "connect")
        self.assertEqual(caught.exception.diagnostics["reason"], "timeout")
        first_sock.connect.assert_called_once()
        second_sock.connect.assert_not_called()
        connection.request.assert_not_called()

    def test_subscription_rejection_is_actionable_for_json_and_stream_without_disclosing_body(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming):
                _, _, connections = self.wire({"error": {"code": "InvalidSubscription", "message": "private-key-and-prompt"}})
                response = connections[0].getresponse.return_value
                response.status = 400
                collector = MagicMock() if streaming else None
                with patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
                    with self.assertRaises(transport.ProviderHttpError) as caught:
                        transport._bounded_json(URL, {}, {}, stream_collector=collector)
                self.assertEqual(caught.exception.code, "provider_subscription_invalid")
                self.assertIn("订阅", str(caught.exception))
                self.assertNotIn("private-", str(caught.exception))
                self.assertEqual(caught.exception.diagnostics["httpStatus"], 400)
                connections[0].request.assert_called_once()
                if streaming:
                    collector.feed.assert_not_called()

    def test_only_exact_bounded_subscription_code_is_classified(self):
        for body in (b'not json', b'[]', b'{"error":"InvalidSubscription"}',
                     b'{"error":{"message":"InvalidSubscription"}}',
                     b'{"error":{"code":"InvalidSubscription.private"}}',
                     b'{"error":{"code":"InvalidSubscription"},"padding":"' + b'x' * 16384 + b'"}'):
            error = transport.ProviderHttpError(400, body)
            self.assertEqual(error.code, "provider_error")
            self.assertNotIn("private", str(error))
        error = transport.ProviderHttpError(429, b'{"error":{"code":"InvalidSubscription"}}')
        self.assertEqual(error.code, "provider_rate_limited")

    def test_http_429_never_reads_rejection_body_or_retries(self):
        _, _, connections = self.wire({})
        response = connections[0].getresponse.return_value
        response.status = 429
        response.read1.side_effect = TimeoutError("private-synthetic-body")
        with patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
            with self.assertRaises(transport.ProviderHttpError) as caught:
                transport.bounded_json(URL, {}, {})
        self.assertEqual(caught.exception.code, "provider_rate_limited")
        response.read1.assert_not_called()
        connections[0].request.assert_called_once()

    def test_complete_json_prefix_is_rejected_when_content_length_is_incomplete(self):
        _, _, connections = self.wire({"ok": True})
        response = connections[0].getresponse.return_value
        response.length = 20
        with patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
            with self.assertRaises(transport.InvalidProviderResponse) as caught:
                transport.bounded_json(URL, {}, {})
        self.assertEqual(caught.exception.diagnostics["reason"], "response_truncated")
        self.assertTrue(caught.exception.diagnostics["requestStarted"])
        connections[0].request.assert_called_once()

    def test_rejection_projection_only_receives_complete_bounded_body(self):
        for failure in ("partial", "oversized", "timeout", None):
            with self.subTest(failure=failure):
                _, _, connections = self.wire({})
                response = connections[0].getresponse.return_value
                response.status = 403
                private = b'{"requestId":"private-fixture"}'
                response.read1.side_effect = (
                    [TimeoutError("private-body")] if failure == "timeout"
                    else [b"x" * 16385] if failure == "oversized" else [private, b""]
                )
                response.length = 1 if failure == "partial" else 0
                projection = MagicMock(return_value={
                    "platformCode": "Forbidden",
                    "platformCodeSha256": "a" * 64,
                    "requestIdSha256": "private-fixture",
                    "body": private,
                })
                with patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
                    with self.assertRaises(transport.ProviderHttpError) as caught:
                        transport._bounded_json(URL, {}, rejection_summary=projection)
                self.assertEqual(caught.exception.diagnostics["httpStatus"], 403)
                self.assertNotIn("private", repr(vars(caught.exception)))
                if failure:
                    projection.assert_not_called()
                else:
                    projection.assert_called_once_with(private)
                    self.assertEqual(caught.exception.rejection_summary, {
                        "platformCode": "Forbidden", "platformCodeSha256": "a" * 64,
                    })
                connections[0].request.assert_called_once()

    def test_oversized_error_body_stops_at_the_diagnostic_bound_without_retry(self):
        _, _, connections = self.wire({})
        response = connections[0].getresponse.return_value
        response.status = 400
        response.read1.side_effect = [b'x' * 16385]
        with patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
            with self.assertRaises(transport.ProviderHttpError) as caught:
                transport.bounded_json(URL, {}, {})
        response.read1.assert_called_once_with(16385)
        self.assertEqual(caught.exception.code, "provider_error")
        connections[0].request.assert_called_once()

    def test_model_turn_returns_reply_after_synthetic_dns_recovery(self):
        self.wire(
            dns_answer(1, "8.8.4.4"),
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

    def test_provider_marks_output_limit_without_replaying_paid_request(self):
        model = SimpleNamespace(base_url=URL.rsplit("/chat/completions", 1)[0],
            api_key_encrypted="fixture", protocol="openai_compatible", model_name="fixture",
            max_tokens=128, temperature_milli=200, reasoning_mode="auto", timeout_ms=120000)
        for protocol in ("openai_compatible", "anthropic"):
            model.protocol = protocol
            value = ({"choices": [{"finish_reason": "length", "message": {"content": "部分分析"}}]}
                     if protocol == "openai_compatible" else {"stop_reason": "max_tokens", "content": [{"type": "text", "text": "部分分析"}]})
            with self.subTest(protocol=protocol), patch.object(provider, "decrypt", return_value="fixture"), patch.object(provider, "bounded_json", return_value=value) as send:
                result = provider.turn(model, [{"role": "user", "content": "市场分析"}], "测试", [])
                self.assertTrue(result["truncated"])
                self.assertIn("尚未完整生成", result["text"])
                self.assertTrue(result["text"].startswith("部分分析"))
                send.assert_called_once()
                self.assertEqual(send.call_args.kwargs["timeout"], 260)

    def test_timeout_is_distinct_from_invalid_json_and_never_retried(self):
        for failure, expected in ((TimeoutError("sensitive fixture"), "provider_timeout"),
                                  (b"not-json", "invalid_provider_response")):
            with self.subTest(expected=expected):
                _, _, connections = self.wire({})
                response = connections[0].getresponse.return_value
                response.read1.side_effect = [failure] if isinstance(failure, Exception) else [failure, b""]
                with patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")):
                    with self.assertRaises(AiError) as caught:
                        transport.bounded_json(URL, {})
                self.assertEqual(caught.exception.code, expected)
                self.assertNotIn("sensitive fixture", str(caught.exception))
                connections[0].request.assert_called_once()

    def test_real_http_response_can_close_socket_after_last_body_chunk(self):
        # HTTPConnection transfers a Connection: close socket to HTTPResponse.
        # read1() may close its last file reference after the full body arrives.
        # A second settimeout() then fails on Windows with WinError 10038.
        payload = b'{"reply":"ok"}'
        responses = [
            b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: "
            + str(len(payload)).encode()
            + b"\r\n\r\n"
            + payload,
            b"HTTP/1.1 200 OK\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n"
            + format(len(payload), "x").encode()
            + b"\r\n"
            + payload
            + b"\r\n0\r\n\r\n",
            b"HTTP/1.0 200 OK\r\n\r\n" + payload,
        ]
        for wire in responses:
            with self.subTest(wire=wire):
                client, server = socket.socketpair()
                try:
                    server.sendall(wire)
                    server.shutdown(socket.SHUT_WR)
                    wrapped = MagicMock(wraps=client)
                    wrapped.connect = MagicMock()
                    wrapped.do_handshake = MagicMock()
                    context = MagicMock()
                    context.wrap_socket.return_value = wrapped
                    with patch.object(
                        transport,
                        "resolve_addresses",
                        return_value=addresses("8.8.4.4"),
                    ), patch.object(
                        transport.socket, "socket", return_value=wrapped
                    ), patch.object(
                        transport.ssl, "create_default_context", return_value=context
                    ):
                        self.assertEqual(
                            transport.bounded_json(URL, {}), {"reply": "ok"}
                        )
                finally:
                    client.close()
                    server.close()
