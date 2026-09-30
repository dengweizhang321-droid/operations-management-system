"""Lead-owned actual signed GET wrappers on the private product PG fixture."""
import json
import os
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from django.db.models import F
from django.test import TestCase, override_settings
from django.urls import include, path

from access_control.models import AppUser
from netshop.errors import NetshopApiError
from netshop.models import NetshopDataRevision
from sales.tests.factories import TEST_SECRET, signed_headers
from . import test_product_insights as fixtures

urlpatterns = [path("api/netshop/", include("netshop.urls"))]


@override_settings(ROOT_URLCONF=__name__)
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class ProductSignedHttpTests(TestCase):
    setUp = fixtures.ProductInsightsTests.setUp
    tearDown = fixtures.ProductInsightsTests.tearDown
    fact = fixtures.ProductInsightsTests.fact

    def url(self, *, detail=False, **values):
        params = {"platform": "京东", "outlet": "京东\x1fA", "dimension": "spu", "startDate": "2026-09-01", "endDate": "2026-09-01"}
        if detail:
            params["productIdentity"] = json.dumps(["京东", "A", "spu", "P1"], ensure_ascii=False)
        params.update(values)
        return "/api/netshop/product-insights" + ("/detail" if detail else "") + "?" + urlencode(params, doseq=True)

    def get(self, url, **identity):
        return self.client.get(url, headers=signed_headers(url, role="viewer", email=self.user.email, **identity))

    def test_real_list_detail_signed_envelopes_and_owning_headers(self):
        self.fact()
        self.fact(day="2026-08-31", values={"transactionAmountCents": 400, "transactionQuantity": 1, "visitors": 20, "transactionCustomers": 2, "addCartCustomers": 3, "refundAmountCents": 0})
        evidence = []
        for detail in (False, True):
            url = self.url(detail=detail)
            response = self.get(url)
            self.assertEqual(response.status_code, 200, response.content)
            body = response.json()
            self.assertEqual(body["context"]["periods"]["previous"]["startDate"], "2026-08-31")
            self.assertEqual(response["Cache-Control"], "no-store")
            self.assertEqual(response["X-Netshop-Data-Revision"], body["context"]["sourceRevisions"][0]["revision"])
            performance = body["sections"]["performance"] if detail else body["sections"]["items"][0]
            self.assertEqual(performance["metrics"]["payment"]["value"], 1000)
            self.assertEqual(performance["baselineMetrics"]["previous"]["payment"]["value"], 400)
            self.assertEqual(performance["comparisons"]["payment"]["previous"]["value"], 1.5)
            evidence.append({"detail": detail, "query": url.split("?", 1)[1], "status": response.status_code, "revision": response["X-Netshop-Data-Revision"], "payload": body})
        directory = os.environ.get("TERUISI_PRODUCTS_QUERY_EVIDENCE_DIR")
        if directory:
            with (Path(directory) / "signed-http-wire.json").open("x", encoding="utf-8") as output:
                json.dump({"fixture": "products-synthetic-v1", "signedWrappers": True, "results": evidence}, output, ensure_ascii=False, indent=2)

    def test_auth_scope_method_and_unknown_request_fail_without_business_payload(self):
        self.fact()
        url = self.url()
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.post(url).status_code, 405)
        self.assertEqual(self.get(self.url(sql="SELECT 1")).status_code, 400)
        self.assertEqual(self.get(self.url(page=["1", "2"])).status_code, 400)
        scope = {"platforms": ["天猫"], "channels": [], "warehouses": []}
        AppUser.objects.filter(pk=self.user.pk).update(scope=scope)
        denied = self.get(url, scope=scope)
        self.assertEqual(denied.status_code, 403, denied.content)
        self.assertNotIn("sections", denied.json())
        AppUser.objects.filter(pk=self.user.pk).update(scope=None, status="disabled")
        self.assertEqual(self.get(url).status_code, 403)

    def test_page_token_allows_next_page_but_rejects_page_size_and_source_change(self):
        self.fact()
        self.fact(product="P2")
        first = self.get(self.url(pageSize="1"))
        self.assertEqual(first.status_code, 200, first.content)
        token = first.json()["sectionToken"]
        following = self.get(self.url(page="2", pageSize="1", sectionToken=token))
        self.assertEqual(following.status_code, 200, following.content)
        self.assertNotEqual(first.json()["sections"]["items"][0]["identity"], following.json()["sections"]["items"][0]["identity"])
        changed_size = self.get(self.url(pageSize="2", sectionToken=token))
        self.assertEqual(changed_size.status_code, 409, changed_size.content)
        self.assertNotIn("sections", changed_size.json())
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1, source_digest="b" * 64)
        changed_source = self.get(self.url(page="2", pageSize="1", sectionToken=token))
        self.assertEqual(changed_source.status_code, 409, changed_source.content)
        self.assertNotIn("sections", changed_source.json())

    def test_baseline_service_failure_preserves_real_current_and_clears_rows(self):
        self.fact()
        from netshop.product_insights import _aggregate
        calls = [0]
        def fail_previous(*args, **kwargs):
            calls[0] += 1
            if calls[0] == 2:
                raise NetshopApiError("synthetic baseline failure", status=503, code="service_unavailable")
            return _aggregate(*args, **kwargs)
        with patch("netshop.product_insights._aggregate", side_effect=fail_previous):
            response = self.get(self.url())
        self.assertEqual(response.status_code, 200, response.content)
        sections = response.json()["sections"]
        self.assertEqual(sections["summary"]["payment"]["value"], 1000)
        self.assertEqual(sections["baselineReads"]["previous"]["state"], "error")
        item = sections["items"][0]
        self.assertIsNone(item["baselineMetrics"]["previous"]["payment"]["value"])
        self.assertEqual(item["comparisons"]["payment"]["previous"]["status"], "unavailable")
