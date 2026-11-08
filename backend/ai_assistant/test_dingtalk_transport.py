import json
from contextlib import contextmanager
from unittest.mock import Mock, patch
from django.test import SimpleTestCase
from types import SimpleNamespace
from . import dingtalk_transport as platform
from .policy import AiError
from . import transport
from .test_transport import addresses as doh_addresses


def endpoint_replies(replies):
    responses = iter(replies)

    def request(*args, **kwargs):
        transport.commit_provider_send()
        return next(responses)

    return request


@contextmanager
def fake_dingtalk_wire(route, *, on_connect=None):
    """Keep the real bounded transport, replacing only network I/O."""
    posted = []
    tls_socket = Mock()
    tls_socket.connect.side_effect = on_connect

    def connection(host, port, timeout):
        client = Mock()
        request = []

        def send(method, path, body, headers):
            request.extend((host, path, body))
            posted.append(tuple(request))

        def response():
            status, reply = route(*request)
            payload = json.dumps(reply).encode()
            return Mock(status=status, getheader=Mock(return_value=None),
                        isclosed=Mock(side_effect=(False, True)), read1=Mock(return_value=payload))

        client.request.side_effect = send
        client.getresponse.side_effect = response
        return client

    with patch.object(platform, "media_addresses", return_value=doh_addresses("8.8.8.8")), \
            patch.object(transport.socket, "socket", return_value=tls_socket), \
            patch.object(transport.ssl, "create_default_context", return_value=Mock(wrap_socket=Mock(return_value=tls_socket))), \
            patch.object(transport.http.client, "HTTPConnection", side_effect=connection):
        yield posted


class DingTalkTransportTests(SimpleTestCase):
    def test_media_urls_are_fixed_and_private_dns_is_rejected(self):
        with patch.object(transport, "resolve_addresses") as lookup:
            for url in ("https://example.com/media/upload", "http://api.dingtalk.com/v1.0/oauth2/accessToken", "https://api.dingtalk.com/v1.0/robot/other"):
                with self.assertRaises(AiError):
                    platform.media_addresses(url)
            lookup.assert_not_called()
        private = [(2, 1, 6, "", ("127.0.0.1", 443))]
        with patch.object(transport, "resolve_addresses", return_value=private), patch.object(transport, "_public_addresses", return_value=private), self.assertRaises(AiError):
            platform.media_addresses(platform.TOKEN_API)

    def test_stream_dns_does_not_extend_model_or_arbitrary_origins(self):
        with patch.object(transport, "resolve_addresses") as lookup:
            for url in ("https://example.com/connect", "https://api.dingtalk.com/other", "http://api.dingtalk.com/v1.0/gateway/connections/open"):
                with self.assertRaises(AiError):
                    platform.stream_addresses(url)
            lookup.assert_not_called()

    def test_stream_rejects_private_and_synthetic_addresses_after_resolution(self):
        for ip in ("127.0.0.1", "198.18.1.31", "10.0.0.1"):
            addresses = [(2, 1, 6, "", (ip, 443))]
            with patch.object(transport, "resolve_addresses", return_value=addresses), patch.object(transport, "_public_addresses", return_value=addresses), self.assertRaises(AiError):
                platform.stream_addresses(platform.STREAM_API)

    def test_open_stream_pins_verified_addresses_without_model_allowlist_change(self):
        addresses = [(2, 1, 6, "", ("8.8.8.8", 443))]
        with patch.object(platform, "stream_addresses", return_value=addresses), patch.object(transport, "_bounded_json", return_value={"ticket": "fixture"}) as request:
            platform.open_stream("fixture-key", "fixture-secret")
        self.assertEqual(request.call_args.args[0], platform.STREAM_API)
        self.assertEqual(request.call_args.kwargs["fixed_addresses"], addresses)
        self.assertEqual(request.call_args.kwargs["maximum"], 16384)

    config = {"profile": "corp:operator", "corpId": "corp", "unifiedAppId": "app", "robotCode": "bot",
              "robotName": "志高助手", "groups": [{"id": "group", "name": "测试群聊"}]}

    def test_real_transport_distinguishes_pre_wire_abort_and_recipient_receipts(self):
        session = SimpleNamespace(sender_id="fixture-staff", conversation_type="1", external_conversation_id="fixture-staff")
        for reply, code, outcome in (
            ({"invalidStaffIdList": ["fixture-staff"]}, "dingtalk_send_rejected", "rejected"),
            ({"processQueryKey": "fixture-receipt", "invalidStaffIdList": ["fixture-staff"]}, "delivery_unknown", "unknown"),
            ({"flowControlledStaffIdList": ["some-other-staff"]}, "delivery_unknown", "unknown"),
        ):
            def route(host, path, body):
                if path.endswith("/accessToken"):
                    return 200, {"accessToken": "synthetic-token"}
                return 200, reply
            with self.subTest(code=code), patch.object(platform, "guard"), \
                    patch.object(platform, "credentials", return_value=("fixture", "fixture")), \
                    fake_dingtalk_wire(route) as posted, self.assertRaises(platform.DingTalkDeliveryError) as raised:
                platform.send(lambda: self.config, session, "fixture-text")
            self.assertEqual((raised.exception.code, raised.exception.delivery["outcome"]), (code, outcome))
            self.assertEqual(len(posted), 2)
            self.assertNotIn("fixture-staff", json.dumps(raised.exception.delivery))

    def test_dns_or_tls_failure_before_message_fence_is_not_sent(self):
        session = SimpleNamespace(sender_id="fixture-staff", conversation_type="1", external_conversation_id="fixture-staff")
        fence = Mock()
        failure = transport.ProviderTransportError(stage="tls", reason="unavailable")
        with patch.object(platform, "guard"), patch.object(platform, "credentials", return_value=("fixture", "fixture")), \
                patch.object(platform, "media_addresses", return_value=[]), \
                patch.object(transport, "_bounded_json", side_effect=[{"accessToken": "synthetic-token"}, failure]), \
                self.assertRaises(platform.DingTalkDeliveryError) as raised:
            platform.send(lambda: self.config, session, "fixture-text", before_send=fence)
        fence.assert_not_called()
        self.assertEqual((raised.exception.code, raised.exception.delivery["outcome"]), ("dingtalk_send_unavailable", "not_sent"))
        self.assertEqual(raised.exception.delivery["transport"]["stage"], "tls")

    def test_bot_media_upload_and_send_are_separate_bounded_official_calls(self):
        session = SimpleNamespace(sender_id="bound-staff", conversation_type="2", external_conversation_id="group")
        image = b"\x89PNG\r\n\x1a\nfixture"
        replies = [{"accessToken": "opaque-token"}, {"errcode": 0, "media_id": "@media"}, {"processQueryKey": "receipt"}]
        with patch.object(platform, "guard"), patch.object(platform, "credentials", return_value=("key", "secret")), patch.object(platform, "robot"), patch.object(platform, "verify_group"), patch.object(platform, "media_addresses", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]), patch.object(transport, "_bounded_json", side_effect=endpoint_replies(replies)) as calls:
            platform.send_media(lambda: self.config, session, image, "系统页面.png", "image")
        self.assertEqual(calls.call_count, 3)
        self.assertEqual(calls.call_args_list[0].args[0], platform.TOKEN_API)
        self.assertIn("&type=image", calls.call_args_list[1].args[0])
        self.assertEqual(calls.call_args_list[2].args[1]["msgKey"], "sampleImageMsg")
        self.assertEqual(calls.call_args_list[2].args[1]["openConversationId"], "group")

    def test_media_rejects_bad_format_before_credentials_or_upload(self):
        session = SimpleNamespace(sender_id="bound-staff", conversation_type="1", external_conversation_id="dm")
        with patch.object(platform, "credentials") as credentials:
            for raw, name, kind in ((b"bad", "screenshot.png", "image"), (b"PK", "report.html", "file"), (b"PK", "../report.xlsx", "file")):
                with self.assertRaises(AiError):
                    platform.send_media(lambda: self.config, session, raw, name, kind)
        credentials.assert_not_called()

    def test_caption_image_is_one_markdown_send_for_person_and_group(self):
        for conversation_type in ("1", "2"):
            session = SimpleNamespace(sender_id="bound-staff", conversation_type=conversation_type, external_conversation_id="group")
            replies = [{"accessToken":"opaque-token"}, {"errcode":0,"media_id":"@media"}, {"processQueryKey":"receipt"}]
            guard = Mock()
            with patch.object(platform,"guard"), patch.object(platform,"credentials",return_value=("key","secret")), patch.object(platform,"robot"), patch.object(platform,"verify_group"), patch.object(platform,"media_addresses",return_value=[]), patch.object(transport,"_bounded_json",side_effect=endpoint_replies(replies)) as calls:
                platform.send_media(lambda:self.config,session,b"\x89PNG\r\n\x1a\nfixture","页面.png","image","新品周销量趋势数据",before_send=guard)
            guard.assert_called_once()
            self.assertEqual(calls.call_count,3)
            endpoint,body=calls.call_args_list[-1].args
            self.assertEqual(endpoint,platform.GROUP_MEDIA_API if conversation_type=="2" else platform.PERSON_MEDIA_API)
            self.assertEqual(body["msgKey"],"sampleMarkdown")
            params=json.loads(body["msgParam"])
            self.assertEqual(params,{"title":"新品周销量趋势数据","text":"新品周销量趋势数据\n\n![完整截图](@media)"})

    def test_markdown_caption_is_literal_and_bad_media_or_oversize_denied(self):
        result=platform.image_markdown("标题\n![外部图](https://example.invalid) <img>","@media")
        self.assertIn("\\!\\[外部图\\]\\(https://example",result["text"])
        self.assertIn("&lt;img&gt;",result["text"])
        self.assertTrue(result["text"].endswith("![完整截图](@media)"))
        for media in ("@media)\n![injected](https://example.invalid)","https://example.invalid","@bad space"):
            with self.assertRaises(AiError): platform.image_markdown("标题",media)
        with patch.object(platform,"credentials") as credentials:
            for caption in ([],"长"*4001,"*"*4000):
                with self.assertRaises(AiError):
                    platform.send_media(lambda:self.config,SimpleNamespace(),b"\x89PNG\r\n\x1a\nfixture","页面.png","image",caption)
        credentials.assert_not_called()

    def test_media_ceiling_leaves_room_for_fallback_resolver_after_first_fails(self):
        # Regression for the 2026-11-01 fix: media_addresses must pass a ceiling
        # of 5 + _fallback_resolver_budget (not the bare system-DNS timeout of 5)
        # into _public_addresses. With ceiling=5, a first resolver that stalls
        # for the full shared budget (spent=5.0s here, mirroring the verified
        # worked example) leaves `ceiling - spent` at exactly 0, so the fallback
        # resolver is skipped and the first resolver's failure is raised
        # instead. The clock is advanced only while the first resolver call is
        # in flight, so the elapsed time the ceiling check sees matches a real
        # stall.
        host = "api.dingtalk.com"

        def dns_answer(kind, *ips):
            return {
                "Status": 0,
                "TC": False,
                "Question": [{"name": host, "type": kind}],
                "Answer": [{"name": host, "type": kind, "data": ip} for ip in ips],
            }

        clock = [100.0]
        first_failure = transport.ProviderTransportError(stage="connect", reason="unavailable")

        def query(url, *args, **kwargs):
            if "1.1.1.1" in url:
                clock[0] += 5.0
                raise first_failure
            return dns_answer(1, "8.8.4.4")

        with patch.object(
            transport.time, "monotonic", side_effect=lambda: clock[0]
        ), patch.object(
            transport, "resolve_addresses", return_value=doh_addresses("198.18.0.9")
        ), patch.object(
            transport, "_bounded_json", side_effect=query
        ) as dns:
            result = platform.media_addresses(platform.TOKEN_API)
        self.assertEqual([row[4][0] for row in result], ["8.8.4.4"])
        self.assertEqual(dns.call_count, 2)
        # The first attempt must go to the primary pinned resolver and the
        # second (fallback) attempt to the next one in order; a bug that
        # starves the fallback window would never reach this second call.
        self.assertTrue(dns.call_args_list[0].args[0].startswith("https://1.1.1.1/dns-query?"))
        self.assertTrue(dns.call_args_list[1].args[0].startswith("https://1.12.12.12/dns-query?"))

    def test_post_upload_revocation_and_bad_receipt_never_fall_back_to_separate_messages(self):
        session=SimpleNamespace(sender_id="bound-staff",conversation_type="1",external_conversation_id="group")
        for revoked in (True,False):
            replies=[{"accessToken":"opaque-token"},{"errcode":0,"media_id":"@media"},{"processQueryKey":"receipt","invalidStaffIdList":["bound-staff"]}]
            before=Mock(side_effect=AiError("配置已变化","access_denied",403) if revoked else None)
            with patch.object(platform,"guard"), patch.object(platform,"credentials",return_value=("key","secret")), patch.object(platform,"robot"), patch.object(platform,"media_addresses",return_value=[]), patch.object(transport,"_bounded_json",side_effect=endpoint_replies(replies)) as calls, self.assertRaises(AiError):
                platform.send_media(lambda:self.config,session,b"\x89PNG\r\n\x1a\nfixture","页面.png","image","标题",before_send=before)
            self.assertEqual(calls.call_count,3)  # The final adapter is entered, but the fence may abort its POST.
            before.assert_called_once()
