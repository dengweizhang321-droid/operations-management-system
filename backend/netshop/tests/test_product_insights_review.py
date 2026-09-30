"""Independent Q adversarial checks, distinct from the product authors' tests."""
from unittest.mock import patch

from django.test import TestCase
from django.db import connection

from netshop.errors import NetshopApiError
from netshop.insights_common import read_context
from netshop.product_insights import read_product_detail
from . import test_product_insights as product_seeds
from . import test_product_insights_detail as detail_seeds
from . import test_catalog_filter_wiring as catalog_seeds


class ProductIndependentReviewTests(TestCase):
    # Reuse only published synthetic seed helpers; none of their test methods.
    setUp = product_seeds.ProductInsightsTests.setUp
    tearDown = product_seeds.ProductInsightsTests.tearDown
    fact = product_seeds.ProductInsightsTests.fact
    spec = product_seeds.ProductInsightsTests.spec
    read = product_seeds.ProductInsightsTests.read
    detail_spec = detail_seeds.ProductDetailTests.detail_spec
    master = detail_seeds.ProductDetailTests.master

    def seed_pair(self):
        self.fact(product="REVIEW-A")
        self.fact(product="REVIEW-A", day="2026-08-31")
        self.fact(product="REVIEW-B")
        self.fact(product="REVIEW-B", day="2026-08-31")

    def test_review_section_token_allows_page_but_binds_page_size(self):
        self.seed_pair()
        first = self.read(pageSize=1)
        token = first["sectionToken"]
        second = self.read(page=2, pageSize=1, sectionToken=token)
        self.assertEqual(second["sectionToken"], token)
        self.assertNotEqual(first["sections"]["items"][0]["identity"], second["sections"]["items"][0]["identity"])
        with self.assertRaises(NetshopApiError) as failure:
            self.read(pageSize=2, sectionToken=token)
        self.assertEqual(failure.exception.status, 409)

    def test_review_list_and_detail_pass_one_outer_deadline_to_context(self):
        self.seed_pair()
        from netshop.product_insights import actor_fence
        for detail in (False, True):
            clock = [0.0]
            calls = [0]

            def entry_actor(principal):
                calls[0] += 1
                result = actor_fence(principal)
                if calls[0] == 1:
                    clock[0] = 64.0
                return result

            with self.subTest(detail=detail), patch("netshop.product_insights.time.monotonic", side_effect=lambda: clock[0]), patch("netshop.product_insights.actor_fence", side_effect=entry_actor), patch("netshop.product_insights.read_context", wraps=read_context) as nested:
                if detail:
                    read_product_detail(self.principal, self.detail_spec(product="REVIEW-A"))
                else:
                    self.read()
                self.assertEqual(nested.call_count, 1)
                self.assertEqual(nested.call_args.kwargs.get("deadline"), 65.0, "Nested shared read must inherit the original budget after 64s of entry actor work")

    def test_review_expired_final_summary_cannot_start_next_fact_phase(self):
        """A slow successful SQL must not permit fresh SQL after the deadline."""
        self.seed_pair()
        from netshop.product_insights import _aggregate, _list_rows
        clock = [0.0]

        def slow_final_summary(rows, *args, **kwargs):
            result = _aggregate(rows, *args, **kwargs)
            if "2025-09-01" in str(rows.query):
                clock[0] = 66.0
            return result

        with patch("netshop.product_insights.time.monotonic", side_effect=lambda: clock[0]), patch("netshop.product_insights._aggregate", side_effect=slow_final_summary), patch("netshop.product_insights._list_rows", wraps=_list_rows) as next_phase:
            with self.assertRaises(NetshopApiError) as failure:
                self.read()
            self.assertEqual(failure.exception.status, 503)
            self.assertEqual(next_phase.call_count, 0, "No new fact phase may start after the final baseline SQL has consumed the whole request budget")

    def test_review_catalog_nested_sql_stops_after_a_successful_read_expires(self):
        """The shared deadline also bounds SQL inside a catalogue loader."""
        self.seed_pair()
        self.master(product="REVIEW-A", total_inventory=4, available_inventory=3, price_cents=100)
        clock = [0.0]
        observations = {"triggered": False, "followingSelects": 0}

        def expire_after_catalog_count(execute, sql, params, many, context):
            read = sql.lstrip().upper().startswith(("SELECT", "WITH"))
            if read and clock[0] > 65:
                observations["followingSelects"] += 1
            result = execute(sql, params, many, context)
            if not observations["triggered"] and sql.lstrip().upper().startswith("SELECT COUNT(") and '"netshop_rows"' in sql and "jd_product_master" in (params or ()):
                observations["triggered"] = True
                clock[0] = 66.0
            return result

        with patch("netshop.product_insights.time.monotonic", side_effect=lambda: clock[0]), connection.execute_wrapper(expire_after_catalog_count):
            with self.assertRaises(NetshopApiError) as failure:
                read_product_detail(self.principal, self.detail_spec(product="REVIEW-A"))
            self.assertEqual(failure.exception.status, 503)
        self.assertTrue(observations["triggered"], "The independent PG scenario must actually reach the catalogue SQL")
        self.assertEqual(observations["followingSelects"], 0, "An exhausted loader may unwind its transaction, but must not run more SELECTs")


@catalog_seeds.override_settings(ROOT_URLCONF="netshop.tests.test_catalog_filter_wiring")
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": catalog_seeds.TEST_SECRET})
class ProductCatalogHeaderIndependentReviewTests(TestCase):
    """Actual signed old directory reader supplies the new UI owning header."""
    setUp = detail_seeds.ProductDetailTests.setUp
    tearDown = detail_seeds.ProductDetailTests.tearDown
    fact = detail_seeds.ProductDetailTests.fact
    master = detail_seeds.ProductDetailTests.master
    read = catalog_seeds.CatalogFilterWiringTests.read
    seed = catalog_seeds.CatalogFilterWiringTests.seed

    def test_review_actual_catalog_full_and_page_share_the_owning_revision(self):
        import json
        import os
        from pathlib import Path
        from urllib.parse import urlencode

        self.seed()
        for index in range(4, 7):
            self.master(product=f"P{index}", shop=f"Review-{index}", product_status="上架", total_inventory=1)
        values = {"status": "all", "quality": "all", "mapping": "all", "page": 1, "pageSize": 5, "q": "", "startDate": "2026-09-01", "endDate": "2026-09-01"}
        response = self.read(**values)
        self.assertEqual(response.status_code, 200, response.content)
        full = response.json()
        revision = response.headers["X-Netshop-Data-Revision"]
        self.assertRegex(revision, r"^\d+:[a-f0-9]{12}$")
        self.assertEqual(full["catalogFilters"]["sourceVersion"], revision)
        self.assertNotEqual(full["snapshotToken"], revision)
        page_values = {**values, "page": 2, "view": "page", "snapshotToken": full["snapshotToken"]}
        page_response = self.read(**page_values)
        self.assertEqual(page_response.status_code, 200, page_response.content)
        page = page_response.json()
        self.assertEqual(page_response.headers["X-Netshop-Data-Revision"], revision)
        self.assertEqual(page["catalogFilters"]["sourceVersion"], revision)
        self.assertEqual(page["snapshotToken"], full["snapshotToken"])
        self.assertEqual(len(page["items"]), 1)
        evidence = os.environ.get("TERUISI_PRODUCTS_QUERY_EVIDENCE_DIR")
        if evidence:
            path = Path(evidence).resolve()
            self.assertIn("products\\review\\", str(path))
            with (path / "wire-catalog-review.json").open("x", encoding="utf-8") as handle:
                json.dump({"full": {"query": urlencode({"platform": "京东", **values}), "payload": full, "revision": revision}, "page": {"query": urlencode({"platform": "京东", **page_values}), "payload": page, "revision": page_response.headers["X-Netshop-Data-Revision"]}}, handle, ensure_ascii=False, indent=2)
