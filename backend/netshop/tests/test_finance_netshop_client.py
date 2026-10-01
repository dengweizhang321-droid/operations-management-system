"""Fixed transport, native signing and authority-first failure tests; no network."""
import io
import json
import os
from pathlib import Path
import urllib.error
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase
from sales.auth import Principal, PrincipalEnvelopeError, verify_principal
from sales.tests.factories import TEST_SECRET
from netshop import finance_netshop_client as client
from netshop.errors import NetshopApiError


class Response:
    status = 200
    def __init__(self, body, revision):
        self.body = json.dumps(body, ensure_ascii=False).encode()
        self.headers = {"Content-Type": "application/json", "X-Finance-Data-Revision": revision}
    def __enter__(self): return self
    def __exit__(self, *_args): return False
    def read(self, limit): return self.body[:limit]


class FinanceNetshopClientTests(SimpleTestCase):
    def setUp(self):
        self.principal = Principal("finance-netshop@example.test", "Synthetic", "viewer", None)
        self.request = {"operation": client.OPERATION, "shopKeys": ['["京东","同名店"]'],
                        "months": ["2026-01", "2026-03"], "year": "2026"}
        self.env = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET,
            "TERUISI_DJANGO_FINANCE_READER_BASE_URL": "http://127.0.0.1:18888"})
        self.env.start(); self.addCleanup(self.env.stop)

    def fixture(self):
        root = os.environ.get("TERUISI_FINANCE_NETSHOP_CAPACITY")
        if not root:
            self.skipTest("Requires actual same-run private finance DTO export")
        return json.loads((Path(root) / "finance-response.json").read_text(encoding="utf-8"))

    def test_actual_pg_response_native_signed_request_and_scope_header(self):
        fixture = self.fixture()
        def exchange(request, timeout):
            self.assertEqual(request.full_url, "http://127.0.0.1:18888" + client.PATH)
            self.assertGreater(timeout, 0); self.assertLessEqual(timeout, 65)
            incoming = RequestFactory().post(client.PATH, data=request.data,
                content_type="application/json", headers=dict(request.header_items()))
            actor = verify_principal(incoming)
            self.assertEqual(actor, self.principal)
            signed_body = json.loads(request.data)
            self.assertIs(type(signed_body["expiresAtEpochMs"]), int)
            self.assertEqual(signed_body["shopKeys"], self.request["shopKeys"])
            # This is the actual owning DTO exported by the private PG tests.
            return Response(fixture["response"], fixture["owningRevision"])
        with patch.object(client.urllib.request, "urlopen", side_effect=exchange):
            data, revision = client.read_finance_netshop(self.principal, self.request)
        self.assertEqual(data, fixture["response"]["data"])
        self.assertEqual(revision, fixture["owningRevision"])

    def test_401_403_409_error_body_is_never_read_or_echoed(self):
        for status, code in ((401, "access_denied"), (403, "access_denied"), (409, "insights_revision_changed")):
            error = urllib.error.HTTPError("http://127.0.0.1", status, "untrusted", {}, io.BytesIO(b"never expose upstream body"))
            with patch.object(error, "read", side_effect=AssertionError("Must not read authority error body")), \
                 patch.object(client.urllib.request, "urlopen", side_effect=error), self.assertRaises(NetshopApiError) as failure:
                client.read_finance_netshop(self.principal, self.request)
            self.assertEqual((failure.exception.status, failure.exception.code), (status, code))
            self.assertNotIn("upstream", str(failure.exception))

    def test_unknown_source_sql_writer_paths_and_bad_typed_tokens_refused(self):
        for change in ({"sourceUrl": "http://127.0.0.1:5432"}, {"sql": "SELECT"}, {"operation": "target_write"},
                       {"months": []}, {"year": 2026}, {"expiresAtEpochMs": True}, {"expectedRevision": "1:erp"},
                       {"snapshotToken": 1}, {"shopKeys": ['["京东", "同名店"]']}):
            with patch.object(client.urllib.request, "urlopen", side_effect=AssertionError("no HTTP")), self.assertRaises(NetshopApiError):
                client.read_finance_netshop(self.principal, {**self.request, **change})

    def test_native_signature_refuses_body_and_principal_tampering(self):
        fixture = self.fixture()
        def exchange(request, timeout):
            for headers, body in ((dict(request.header_items()), request.data+b" "),
                                  ({**dict(request.header_items()), "X-teruisi-principal": "tampered"}, request.data)):
                incoming = RequestFactory().post(client.PATH, data=body, content_type="application/json", headers=headers)
                with self.assertRaises(PrincipalEnvelopeError):
                    verify_principal(incoming)
            return Response(fixture["response"], fixture["owningRevision"])
        with patch.object(client.urllib.request, "urlopen", side_effect=exchange):
            client.read_finance_netshop(self.principal, self.request)

    def test_response_header_scope_and_budget_fail_closed(self):
        fixture = self.fixture()
        for mutation in ("header", "scope", "overflow", "nonjson"):
            response = Response(fixture["response"], fixture["owningRevision"])
            if mutation == "header": response.headers["X-Finance-Data-Revision"] = "1:not-a-finance-digest"
            if mutation == "scope":
                data = json.loads(response.body); data["data"]["requestedScope"]["year"] = "2025"
                response.body = json.dumps(data).encode()
            if mutation == "overflow": response.body = b"x"*(client.MAX_BYTES+1)
            if mutation == "nonjson": response.headers["Content-Type"] = "text/html"
            with patch.object(client.urllib.request, "urlopen", return_value=response), self.assertRaises(NetshopApiError):
                client.read_finance_netshop(self.principal, self.request)
        with patch.object(client.urllib.request, "urlopen", side_effect=AssertionError("expired no request")), self.assertRaises(NetshopApiError) as expired:
            client.read_finance_netshop(self.principal, {**self.request, "expiresAtEpochMs": 0})
        self.assertEqual(expired.exception.code, "source_not_ready")

    def test_malformed_native_units_field_scope_duplicate_json_and_basis_refused(self):
        fixture = self.fixture()
        for mutation in ("bool_amount", "missing_carrier", "field_scope", "field_bool", "daily_basis", "duplicate"):
            response = Response(fixture["response"], fixture["owningRevision"])
            value = json.loads(response.body)
            if mutation == "bool_amount": value["data"]["monthly"]["data"]["current"]["netSalesCents"] = True
            if mutation == "missing_carrier": del value["data"]["monthly"]["data"]
            if mutation == "field_scope": value["data"]["monthly"]["fieldEvidence"][0]["shopKey"] = '["天猫","同名店"]'
            if mutation == "field_bool": value["data"]["monthly"]["fieldEvidence"][0]["fields"]["net_sales"]["rows"] = True
            if mutation == "daily_basis": value["data"]["metricSemantics"]["dailyAllocation"] = 0
            response.body = json.dumps(value).encode()
            if mutation == "duplicate": response.body = response.body[:-1] + b',"operation":"netshop_finance_read_v1"}'
            with patch.object(client.urllib.request, "urlopen", return_value=response), self.assertRaises(NetshopApiError) as bad:
                client.read_finance_netshop(self.principal, self.request)
            self.assertEqual(bad.exception.status, 503)
