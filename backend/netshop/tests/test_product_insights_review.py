"""Independent Q adversarial checks, distinct from the product authors' tests."""
from unittest.mock import patch

from django.test import TestCase

from netshop.errors import NetshopApiError
from netshop.insights_common import read_context
from netshop.product_insights import read_product_detail
from .test_product_insights import ProductInsightsTests
from .test_product_insights_detail import ProductDetailTests


class ProductIndependentReviewTests(TestCase):
    # Reuse only published synthetic seed helpers; none of their test methods.
    setUp = ProductInsightsTests.setUp
    tearDown = ProductInsightsTests.tearDown
    fact = ProductInsightsTests.fact
    spec = ProductInsightsTests.spec
    read = ProductInsightsTests.read
    detail_spec = ProductDetailTests.detail_spec

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
