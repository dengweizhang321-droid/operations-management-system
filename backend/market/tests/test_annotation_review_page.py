from __future__ import annotations

from datetime import timedelta

from django.db.models import Exists
from django.utils import timezone

from market.annotations import _matching_snapshot, _recognition_items, _review, _review_eligibility, _review_scope, _filter_review_items
from market.models import MarketAnnotationItem, MarketMasterAuditLog, MarketPriceSnapshot

from .test_annotation_review import MarketAnnotationReviewTests as _Base


class MarketAnnotationReviewPageTwoStepTests(_Base):
    """The two-step page query must equal the former single-step annotated slice."""

    def reference_rows(self, params, page, size):
        query = _filter_review_items(_review_scope(params), params)
        return list(_recognition_items(query).annotate(snapshot_valid=Exists(_matching_snapshot())).order_by("-created_at", "id")[(page - 1) * size : page * size])

    def seed(self):
        other = self.make_job("review-job-2")
        base = timezone.now()
        for index in range(25):
            job = self.job if index % 2 == 0 else other
            item = self.item(f"page-{index:02d}", job=job, ai_segment="台式" if index % 3 else "", status="approved" if index % 4 == 0 else "review_pending")
            # Two groups share created_at to exercise the id tie-break.
            MarketAnnotationItem.objects.filter(id=item.id).update(created_at=base + timedelta(minutes=index // 2))
            if index % 5 == 0:
                MarketPriceSnapshot.objects.filter(id=item.id).delete()  # snapshot_valid False
            if index % 3 == 0:
                MarketMasterAuditLog.objects.create(
                    actor_email="a@example.test", actor_role="admin", action="market_annotation_recognition_mode",
                    entity_type="market_annotation_mode", entity_id=item.id,
                    after_json={"recognitionMode": "price_only", "fixedSegment": "台式"},
                )

    def test_pages_match_reference_across_filters_and_aggregate(self):
        self.seed()
        cases = [
            {"jobId": "review-job"},
            {"aggregateJobs": True},
            {"aggregateJobs": True, "itemCategories": ["净水"], "recognitionSources": ["ai"]},
            {"aggregateJobs": True, "storageStatuses": ["pending"], "itemSegments": ["台式"]},
        ]
        seen_modes, seen_valid = set(), set()
        for params in cases:
            expected_all = []
            for page in range(1, 5):
                result = _review({**params, "itemPage": page, "itemPageSize": 10})
                ref = self.reference_rows(params, page, 10)
                self.assertEqual([i["id"] for i in result["items"]], [r.id for r in ref], (params, page))
                self.assertEqual([i["snapshotValid"] for i in result["items"]], [r.snapshot_valid for r in ref])
                seen_valid.update(i["snapshotValid"] for i in result["items"])
                seen_modes.update(r.recognition_mode for r in ref)
                expected_all += [r.id for r in ref]
                query = _filter_review_items(_review_scope(params), params)
                self.assertEqual(result["itemPagination"]["total"], query.count())
            self.assertEqual(len(expected_all), len(set(expected_all)))
        self.assertEqual(seen_valid, {True, False})
        self.assertEqual(seen_modes, {"", "price_only"})

    def test_item_fields_identical_to_reference(self):
        self.seed()
        from market.annotations import _item_value
        params = {"aggregateJobs": True}
        result = _review({**params, "itemPage": 2, "itemPageSize": 10})
        ref = self.reference_rows(params, 2, 10)
        for got, row in zip(result["items"], ref):
            expected = {**_item_value(row, got["reviewSegments"]), "reviewJobReady": got["reviewJobReady"],
                        "reviewSegments": got["reviewSegments"], "snapshotValid": row.snapshot_valid}
            self.assertEqual(got, expected)

    def test_empty_scope_and_out_of_range_page(self):
        self.assertEqual(_review({})["items"], [])
        self.seed()
        self.assertEqual(_review({"aggregateJobs": True, "itemPage": 50, "itemPageSize": 10})["items"], [])


class MarketAnnotationReviewCountsTests(_Base):
    def reference_counts(self, params):
        scope = _review_scope(params)
        query = _filter_review_items(scope, params)
        eligibility, _ = _review_eligibility(scope)
        selectable = query.filter(eligibility)
        return selectable.count(), selectable.filter(selected=True).count()

    def check(self, params, expected):
        selection = _review(params)["selection"]
        got = (selection["filteredReviewableCount"], selection["filteredSelectedCount"])
        self.assertEqual(got, self.reference_counts(params))
        self.assertEqual(got, expected)
        self.assertIsInstance(got[0], int)
        self.assertIsInstance(got[1], int)

    def test_aggregate_counts_match_two_query_form(self):
        params = {"aggregateJobs": True}
        self.check(params, (0, 0))  # empty set
        self.item("c-sel", selected=True)
        self.item("c-unsel-1")
        self.item("c-unsel-2", ai_segment="")
        self.item("c-working", status="inferencing", selected=True)
        self.check(params, (3, 1))
        self.check({"aggregateJobs": True, "recognitionSources": ["non_ai"]}, (1, 0))  # reviewable, none selected
        self.check({"jobId": "no-such-job"}, (0, 0))
