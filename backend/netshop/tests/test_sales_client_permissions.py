"""Mocked cross-domain permission boundaries; no database or HTTP connection."""
import base64
import hashlib
import hmac
import json
import urllib.error
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from netshop.errors import NetshopApiError
from netshop.sales_client import SALES_CONSUMER_PATH, read_sales_consumer
from sales.auth import Principal


TEST_SECRET = "synthetic-sales-consumer-permission-secret"
TEST_BASE = "http://127.0.0.1:18998"


class Response:
    def __init__(self, body, revision="12:34", content_type="application/json"):
        self.headers = {"Content-Type": content_type, "X-Sales-Data-Revision": revision}
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, _limit):
        return self.body


@patch.dict("os.environ", {
    "TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET,
    "TERUISI_DJANGO_SALES_READER_BASE_URL": TEST_BASE,
})
class SalesClientPermissionsTests(SimpleTestCase):
    principal = Principal("synthetic@example.test", "Synthetic", "viewer", None)
    payload = {"operation": "freshness"}

    def test_real_http_auth_errors_preserve_status_without_reading_body_or_reason(self):
        for status in (401, 403):
            with self.subTest(status=status):
                body = Mock()
                body.read.side_effect = AssertionError("untrusted error body must not be read")
                error = urllib.error.HTTPError(TEST_BASE, status, "UNTRUSTED-UPSTREAM-REASON", {}, body)
                with patch("netshop.sales_client.urllib.request.urlopen", side_effect=error):
                    with self.assertRaises(NetshopApiError) as raised:
                        read_sales_consumer(self.principal, self.payload)
                self.assertEqual(raised.exception.status, status)
                self.assertEqual(raised.exception.code, "access_denied")
                self.assertEqual(str(raised.exception), "当前账号无权读取销售数据")
                self.assertNotIn("UNTRUSTED", str(raised.exception))
                body.read.assert_not_called()

    def test_other_http_statuses_keep_the_existing_unavailable_classification(self):
        for status in (400, 409, 503):
            with self.subTest(status=status):
                body = Mock()
                body.read.side_effect = AssertionError("untrusted error body must not be read")
                error = urllib.error.HTTPError(TEST_BASE, status, "UNTRUSTED-UPSTREAM-REASON", {}, body)
                with patch("netshop.sales_client.urllib.request.urlopen", side_effect=error):
                    with self.assertRaises(NetshopApiError) as raised:
                        read_sales_consumer(self.principal, self.payload)
                self.assertEqual(raised.exception.status, 503)
                self.assertEqual(raised.exception.code, "service_unavailable")
                body.read.assert_not_called()

    def test_transport_failure_keeps_503(self):
        with patch("netshop.sales_client.urllib.request.urlopen", side_effect=urllib.error.URLError("offline")):
            with self.assertRaises(NetshopApiError) as raised:
                read_sales_consumer(self.principal, self.payload)
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(raised.exception.code, "service_unavailable")

    def test_malformed_success_still_fails_closed(self):
        responses = (
            Response(b"not-json"),
            Response(b'{"operation":"freshness","data":{}}', revision="12:abcdefabcdef"),
            Response(b'{"operation":"other","data":{}}'),
            Response(b'{"operation":"freshness","data":[]}'),
            Response(b'{"operation":"freshness","data":{}}', content_type="text/html"),
        )
        for response in responses:
            with self.subTest(body=response.body, headers=response.headers):
                with patch("netshop.sales_client.urllib.request.urlopen", return_value=response):
                    with self.assertRaises(NetshopApiError) as raised:
                        read_sales_consumer(self.principal, self.payload)
                self.assertEqual(raised.exception.status, 503)
                self.assertEqual(raised.exception.code, "service_unavailable")

    def test_normal_revision_pair_request_headers_signing_and_timeout_are_unchanged(self):
        payload = {"operation": "freshness", "label": "合成"}
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        envelope = base64.urlsafe_b64encode(json.dumps({
            "email": self.principal.email, "displayName": self.principal.display_name,
            "role": self.principal.role, "scope": None,
        }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).rstrip(b"=").decode("ascii")
        digest = hashlib.sha256(body).hexdigest()
        canonical = "\n".join(("v1", "1700000000", "synthetic-request", "POST",
                               SALES_CONSUMER_PATH, "", digest, envelope))
        signature = "v1=" + hmac.new(TEST_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
        response = Response(b'{"operation":"freshness","data":{"value":0}}')
        with patch("netshop.sales_client.time.time", return_value=1700000000), \
             patch("netshop.sales_client.uuid.uuid4", return_value="synthetic-request"), \
             patch("netshop.sales_client.urllib.request.urlopen", return_value=response) as urlopen:
            data, revision = read_sales_consumer(self.principal, payload)
        self.assertEqual((data, revision), ({"value": 0}, "12:34"))
        request = urlopen.call_args.args[0]
        self.assertEqual(urlopen.call_args.kwargs, {"timeout": 8})
        self.assertEqual(request.full_url, TEST_BASE + SALES_CONSUMER_PATH)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.data, body)
        self.assertEqual(request.get_header("X-teruisi-principal"), envelope)
        self.assertEqual(request.get_header("X-teruisi-signature"), signature)
        self.assertEqual(request.get_header("X-teruisi-content-sha256"), digest)
