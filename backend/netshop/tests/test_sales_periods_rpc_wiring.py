"""Cross-domain transport limits with a streaming test response; no network."""
import io
import json
import urllib.error
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from netshop.errors import NetshopApiError
from netshop.sales_client import read_sales_consumer
from sales.auth import Principal


class StreamResponse:
    def __init__(self, operation, on_read=None):
        self.headers = {"Content-Type": "application/json", "X-Sales-Data-Revision": "7:3"}
        self.stream = io.BytesIO(json.dumps({"operation": operation, "data": {"value": 0}}).encode())
        self.on_read = on_read

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, size):
        return self.stream.read(size)

    def read1(self, size):
        if self.on_read:
            self.on_read()
        return self.stream.read(size)


@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": "synthetic-rpc-deadline-secret-at-least-32", "TERUISI_DJANGO_SALES_READER_BASE_URL": "http://127.0.0.1:18998"})
class SalesRpcDeadlineTests(SimpleTestCase):
    principal = Principal("synthetic@example.test", "Synthetic", "viewer", None)

    def test_default_timeout_is_8_and_remaining_budget_can_only_shrink_it(self):
        for supplied, expected in [(None, 8), (105.0, 5.0), (200.0, 8)]:
            with patch("netshop.sales_client.time.monotonic", return_value=100.0), patch("netshop.sales_client.urllib.request.urlopen", return_value=StreamResponse("freshness")) as opening:
                value, revision = read_sales_consumer(self.principal, {"operation": "freshness"}, deadline=supplied)
                self.assertEqual(opening.call_args.kwargs["timeout"], expected)
                self.assertEqual(value, {"value": 0})
                self.assertEqual(revision, "7:3")

    def test_expiry_before_signing_or_during_stream_cannot_return_old_success(self):
        with patch("netshop.sales_client.time.monotonic", return_value=100.0), patch("netshop.sales_client.urllib.request.urlopen") as opening:
            with self.assertRaises(NetshopApiError):
                read_sales_consumer(self.principal, {"operation": "freshness"}, deadline=99.0)
            opening.assert_not_called()
        clock = [100.0]
        def spend_budget():
            clock[0] = 106.0
        with patch("netshop.sales_client.time.monotonic", side_effect=lambda: clock[0]), patch("netshop.sales_client.urllib.request.urlopen", return_value=StreamResponse("freshness", spend_budget)):
            with self.assertRaises(NetshopApiError) as failure:
                read_sales_consumer(self.principal, {"operation": "freshness"}, deadline=105.0)
        self.assertEqual(failure.exception.code, "source_not_ready")

    def test_http_authority_body_is_not_read_and_only_new_operation_preserves_409(self):
        for operation in ["freshness", "netshop_periods_v1"]:
            for status in [401, 403, 409]:
                error_body = Mock()
                error_body.read.side_effect = AssertionError("Authority must not depend on an optional body")
                error = urllib.error.HTTPError("http://127.0.0.1:18998", status, "synthetic", {}, error_body)
                with patch("netshop.sales_client.urllib.request.urlopen", side_effect=error), self.assertRaises(NetshopApiError) as failure:
                    read_sales_consumer(self.principal, {"operation": operation})
                self.assertEqual(failure.exception.status, status if status in [401, 403] or operation == "netshop_periods_v1" else 503)
                error_body.read.assert_not_called()
