"""I-owned actual old reader plus new full-set predicates; only sales RPC is fake."""
from datetime import date
from unittest.mock import patch
from urllib.parse import urlencode
from django.test import TestCase, override_settings
from django.urls import include, path
from sales.tests.factories import TEST_SECRET, signed_headers
from . import test_product_insights_detail as detail_fixtures

urlpatterns = [path("api/netshop/", include("netshop.urls"))]

@override_settings(ROOT_URLCONF=__name__)
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class CatalogFilterWiringTests(TestCase):
    setUp = detail_fixtures.ProductDetailTests.setUp
    tearDown = detail_fixtures.ProductDetailTests.tearDown
    fact = detail_fixtures.ProductDetailTests.fact
    master = detail_fixtures.ProductDetailTests.master
    asset = detail_fixtures.ProductDetailTests.asset

    def read(self, **values):
        url = "/api/netshop/products?" + urlencode({"platform": "京东", "pageSize": 1, **values})
        with patch("netshop.query.read_sales_consumer", return_value=({}, "1:1")), patch("netshop.query.sales_product_metrics", return_value=({}, {}, "1:1")), patch("netshop.query.timezone.localdate", return_value=date(2026, 10, 1)):
            return self.client.get(url, headers=signed_headers(url, email=self.user.email, role="viewer"))

    def seed(self):
        self.master(product="P1", shop="A", product_status="上架", total_inventory=0)
        self.master(product="P2", shop="B", product_status="上架", total_inventory=3)
        self.master(product="P3", shop="C", product_status="下架", total_inventory=900)

    def test_actual_status_filter_before_pagination_and_original_summary_unchanged(self):
        self.seed()
        first = self.read(status="on_sale")
        self.assertEqual(first.status_code, 200, first.content)
        payload = first.json()
        self.assertEqual(payload["pagination"]["total"], 2)
        self.assertEqual(payload["summary"]["totalSkus"], 3)
        self.assertEqual(payload["catalogFilters"]["staleAfterDays"], 30)
        second = self.read(status="on_sale", view="page", page=2, snapshotToken=payload["snapshotToken"])
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()["items"][0]["shopName"], "B")
        self.assertEqual(second.json()["catalogFilters"]["filteredRows"], 2)
        changed = self.read(status="off_sale", view="page", snapshotToken=payload["snapshotToken"])
        self.assertEqual(changed.status_code, 503)
        off = self.read(status="off_sale")
        self.assertEqual(off.status_code, 200, off.content)
        self.assertEqual(off.json()["items"][0]["shopName"], "C")

    def test_unsupported_mapping_or_jd_image_quality_and_duplicate_filters_refuse(self):
        self.seed()
        for values in ({"mapping": "unmapped"}, {"quality": "unverified_mapping"}, {"quality": "missing_image"}):
            response = self.read(**values)
            self.assertEqual(response.status_code, 422, response.content)
        response = self.read(status="unknown")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["pagination"]["total"], 0)
        url = "/api/netshop/products?" + urlencode({"platform": "京东", "status": ["all", "on_sale"]}, doseq=True)
        self.assertEqual(self.client.get(url, headers=signed_headers(url, email=self.user.email, role="viewer")).status_code, 400)

    def test_no_new_parameters_keep_the_original_payload_and_snapshot(self):
        self.seed()
        legacy = self.read().json()
        self.assertNotIn("catalogFilters", legacy)
        self.assertNotIn("catalogFilterCapabilities", legacy)
        self.assertNotIn("catalogSnapshotDates", legacy["items"][0])
        self.assertEqual(legacy["snapshotToken"], self.read().json()["snapshotToken"])
        self.assertNotEqual(legacy["snapshotToken"], self.read(status="all").json()["snapshotToken"])

    def test_opt_in_current_snapshot_dates_keep_independent_image_date_or_unknown(self):
        self.master(product="P1", shop="A", platform="天猫", snapshot="2026-10-01")
        self.asset(product="P1", shop="A", platform="天猫", snapshot="2026-09-30")
        response = self.read(platform="天猫", status="all")
        self.assertEqual(response.status_code, 200, response.content)
        dates = response.json()["items"][0]["catalogSnapshotDates"]
        self.assertEqual(dates, {"master": "2026-10-01", "price": "2026-10-01", "inventory": "2026-10-01", "image": "2026-09-30"})
