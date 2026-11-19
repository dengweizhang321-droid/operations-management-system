from __future__ import annotations

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from market.annotations import _review, annotation_workspace, execute_annotation_query
from market.models import MarketAnnotationCloudRun, MarketAnnotationItem, MarketPriceSnapshot

from .test_annotation_review import MarketAnnotationReviewTests as _Base

SELECTION_KEYS = {"filteredReviewableCount", "filteredSelectedCount", "scopeSelectedCount", "staleSelectedCount"}


def snapshot_selects(queries):
    return [q["sql"] for q in queries if "market_price_snapshot" in q["sql"].lower() and "select" in q["sql"].lower()[:10]]


class DeferredSelectionTests(_Base):
    def seed(self):
        self.item("ready-selected", status="approved", selected=True)
        self.item("ready-unselected")
        self.item("stale-selected", status="approved", selected=True)
        MarketPriceSnapshot.objects.filter(id="stale-selected").delete()
        self.item("working", status="inferencing")
        self.item("committed", status="committed", selected=True)

    def query(self, view, params):
        return execute_annotation_query({"operation": "annotations", "view": view, "params": params}, self.principal)

    def test_deferred_review_skips_counts_and_marks_deferred(self):
        self.seed()
        params = {"aggregateJobs": True}
        with CaptureQueriesContext(connection) as normal:
            full = _review(params)
        with CaptureQueriesContext(connection) as deferred:
            lazy = _review(params, defer_selection=True)
        self.assertEqual(lazy["selection"], {**{key: None for key in SELECTION_KEYS}, "deferred": True})
        self.assertEqual(lazy["items"], full["items"])
        self.assertEqual(lazy["itemPagination"], full["itemPagination"])
        self.assertEqual(lazy["reviewSummary"], full["reviewSummary"])
        self.assertLess(len(deferred), len(normal))
        # Two aggregate/count statements over the eligibility Exists are gone, plus the stale count.
        self.assertEqual(len(normal) - len(deferred), 3)

    def test_legacy_callers_keep_structure(self):
        self.seed()
        full = _review({"aggregateJobs": True})
        self.assertEqual(set(full["selection"]), SELECTION_KEYS)
        self.assertEqual(set(self.query("review", {"aggregateJobs": True})["selection"]), SELECTION_KEYS)
        self.assertEqual(set(self.query("workspace_fast", {"aggregateJobs": True})["selection"]), SELECTION_KEYS)
        self.assertTrue(self.query("workspace_fast", {"aggregateJobs": True, "deferSelectionCounts": True})["selection"]["deferred"])
        self.assertTrue(self.query("review", {"aggregateJobs": True, "deferSelectionCounts": True})["selection"]["deferred"])
        # Only a literal true defers; truthy strings do not.
        self.assertEqual(set(self.query("review", {"aggregateJobs": True, "deferSelectionCounts": "1"})["selection"]), SELECTION_KEYS)

    def test_counts_view_equals_non_deferred_selection(self):
        self.seed()
        cases = [
            {"jobId": "review-job"},
            {"aggregateJobs": True},
            {"aggregateJobs": True, "itemCategories": ["净水"], "recognitionSources": ["ai"]},
            {"aggregateJobs": True, "storageStatuses": ["pending"], "itemSegments": ["台式"]},
            {"aggregateJobs": True, "storageStatuses": ["committed"]},
            {},
        ]
        seen = set()
        for params in cases:
            expected = _review(params)["selection"]
            got = self.query("review_selection_counts", params)["selection"]
            self.assertEqual(got, {**expected, "deferred": False}, params)
            seen.add(tuple(expected.values()))
        values = self.query("review_selection_counts", {"aggregateJobs": True})["selection"]
        self.assertEqual((values["filteredReviewableCount"], values["filteredSelectedCount"], values["staleSelectedCount"]), (2, 1, 1))
        self.assertGreater(len(seen), 1)

    def test_counts_view_returns_only_selection(self):
        self.seed()
        self.assertEqual(set(self.query("review_selection_counts", {"aggregateJobs": True})), {"selection"})

    def test_cloud_run_lookup_does_not_grow_with_run_count(self):
        def count_for(total):
            for index in range(total):
                job = self.make_job(f"run-job-{total}-{index}")
                MarketAnnotationCloudRun.objects.create(job_id=job.id, state="paused", retry_state_json={})
            with CaptureQueriesContext(connection) as ctx:
                result = annotation_workspace({"aggregateJobs": True}, self.principal, candidate_count=False)
            self.assertGreaterEqual(len(result["cloudRuns"]), total)
            # The job list itself grows with the fixture; only the per-run job lookup is under test.
            return len([q for q in ctx.captured_queries if "FROM \"market_annotation_jobs\"" in q["sql"] and "WHERE" in q["sql"] and "LIMIT 1" in q["sql"]])
        small = count_for(2)
        large = count_for(20)
        self.assertLessEqual(large, small + 2)
