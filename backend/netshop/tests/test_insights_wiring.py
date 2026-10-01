"""I-owned public registration tests against actual product handlers."""
from unittest.mock import patch
from urllib.parse import urlencode

from django.test import TestCase, override_settings
from django.urls import include, path

from sales.tests.factories import TEST_SECRET, signed_headers
from .test_product_insights import ProductInsightsTests

urlpatterns = [path("api/netshop/", include("netshop.urls"))]


@override_settings(ROOT_URLCONF=__name__)
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class ProductPublicWiringTests(TestCase):
    setUp = ProductInsightsTests.setUp
    tearDown = ProductInsightsTests.tearDown
    fact = ProductInsightsTests.fact

    def request_url(self, **extra):
        return "/api/netshop/product-insights?" + urlencode({"platform": "京东", "outlet": "京东\x1fA", "startDate": "2026-09-01", "endDate": "2026-09-01", **extra})

    def test_actual_signed_list_is_revisioned_and_post_is_not_registered(self):
        self.fact()
        url = self.request_url()
        self.assertEqual(self.client.get(url).status_code, 401)
        response = self.client.get(url, headers=signed_headers(url, email=self.user.email, role="viewer"))
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["context"]["sourceRevisions"][0]["revision"], response["X-Netshop-Data-Revision"])
        self.assertEqual(data["sections"]["items"][0]["identity"]["id"], "P1")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(self.client.post(url, data={}, content_type="application/json").status_code, 405)

    def test_cross_platform_scope_and_unknown_duplicate_params_fail_closed(self):
        self.fact()
        url = self.request_url()
        scope = {"warehouses": [], "channels": [], "platforms": ["天猫"]}
        response = self.client.get(url, headers=signed_headers(url, email=self.user.email, role="viewer", scope=scope))
        self.assertEqual(response.status_code, 403)
        for suffix in ("&path=unsafe", "&page=1&page=2"):
            bad = url + suffix
            self.assertEqual(self.client.get(bad, headers=signed_headers(bad, email=self.user.email, role="viewer")).status_code, 400)

    def test_actual_exact_detail_and_wrong_section_version_fail_closed(self):
        self.fact()
        import json
        url = self.request_url(productIdentity=json.dumps(["京东", "A", "spu", "P1"])) .replace("product-insights?", "product-insights/detail?")
        response = self.client.get(url, headers=signed_headers(url, email=self.user.email, role="viewer"))
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["identity"]["id"], "P1")
        self.assertEqual(data["sections"]["performance"]["metrics"]["payment"]["value"], 1000)
        self.assertEqual(data["context"]["sourceRevisions"][0]["revision"], response["X-Netshop-Data-Revision"])
        wrong = url + "&sectionToken=" + "f" * 64
        failure = self.client.get(wrong, headers=signed_headers(wrong, email=self.user.email, role="viewer"))
        self.assertEqual(failure.status_code, 409, failure.content)
        self.assertNotIn("sections", failure.json())
