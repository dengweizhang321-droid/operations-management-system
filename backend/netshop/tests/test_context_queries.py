"""Actual PostgreSQL metadata helpers, exact historical semantics and fallback."""
import hashlib
from unittest import skipUnless

from django.db import connection
from django.db.models import F, Max
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from netshop.context_queries import discover_shop_names, source_latest_date
from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow


@skipUnless(connection.vendor == "postgresql", "PostgreSQL metadata SQL behavior")
class ContextQueriesPostgresTests(TestCase):
    def setUp(self):
        # The standalone rehearsal reuses a wholly synthetic cluster; ordinary
        # Django test databases start empty. Every case rolls its fixtures back.
        NetshopRow.objects.all().delete()
        NetshopImportBatch.objects.all().delete()
        NetshopDataRevision.objects.update_or_create(
            domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64}
        )
        self.counter = 0
        self.completed = self.batch()
        self.pending = self.batch(status="running")

    def tearDown(self):
        # Match the existing deferred source/revision test-fixture contract.
        NetshopDataRevision.objects.filter(domain="netshop").update(
            revision=F("revision") + 1,
            source_digest=hashlib.sha256(self.id().encode()).hexdigest(),
        )

    def batch(self, status="completed", platform="京东"):
        self.counter += 1
        return NetshopImportBatch.objects.create(
            id=f"context-batch-{self.counter}", source="different-source",
            dataset="different-dataset", platform=platform, shop_name="different-shop",
            file_size_bytes=0, file_hash=f"{self.counter:064x}",
            raw_file_hash="a" * 64, content_hash="b" * 64, scope_key="c" * 64,
            status=status,
        )

    def row(self, shop, day, batch=None, platform="京东", source="jd_sku_daily", dataset="sku_daily"):
        self.counter += 1
        batch = batch or self.completed
        return NetshopRow.objects.create(
            source_row_key=f"context-row-{self.counter}", source_row_hash="d" * 64,
            first_import_batch_id=batch.id, last_import_batch_id=batch.id,
            source_row_number=self.counter, source=source, dataset=dataset,
            platform=platform, shop_name=shop, business_date=day,
            metrics_json={"transactionAmountCents": 0},
        )

    def base(self, names, source="jd_sku_daily", dataset="sku_daily"):
        completed = NetshopImportBatch.objects.filter(status="completed", platform="京东").values("id")
        return NetshopRow.objects.filter(
            platform="京东", source=source, dataset=dataset,
            shop_name__in=names, last_import_batch_id__in=completed,
        )

    def assert_latest(self, names, queries, source="jd_sku_daily", dataset="sku_daily"):
        base = self.base(names, source, dataset)
        original = base.aggregate(day=Max("business_date"))["day"]
        with CaptureQueriesContext(connection) as captured:
            actual = source_latest_date(base, "京东", names, source, dataset)
        self.assertEqual(actual, original)
        self.assertEqual(len(captured), queries)
        return actual, [q["sql"] for q in captured.captured_queries]

    def test_all_history_and_completed_platform_membership_not_batch_source_shop(self):
        self.row("historical-only", "1999-01-01")
        self.row("current", "2026-09-01")
        self.row("current", "2099-01-01", self.pending)
        wrong_platform = self.batch(platform="天猫")
        self.row("current", "2099-02-01", wrong_platform)
        actual, _ = self.assert_latest(["historical-only", "current"], 1)
        self.assertEqual(actual, "2026-09-01")
        self.assertEqual(self.assert_latest(["historical-only"], 1)[0], "1999-01-01")

    def test_null_empty_and_legacy_text_keep_original_max_and_db_collation(self):
        self.row("null", None)
        self.row("empty", "")
        self.row("legacy", "not-a-date")
        self.row("legacy", "2026-09-01")
        self.assertIsNone(self.assert_latest(["null"], 1)[0])
        self.assertEqual(self.assert_latest(["empty"], 1)[0], "")
        self.assertEqual(self.assert_latest(["legacy", "empty", "null"], 1)[0], "not-a-date")

    def test_no_shops_does_not_issue_sql_and_missing_shop_is_null(self):
        self.assertIsNone(self.assert_latest([], 0)[0])
        self.assertIsNone(self.assert_latest(["absent"], 1)[0])

    def test_source_and_dataset_scope_exclude_other_row_sources(self):
        self.row("same", "2026-09-01")
        self.row("same", "2099-01-01", source="jd_promotion", dataset="ad")
        self.row("same", "2099-02-01", dataset="spu_daily")
        self.assertEqual(self.assert_latest(["same"], 1)[0], "2026-09-01")
        self.assertEqual(self.assert_latest(["same"], 1, "jd_promotion", "ad")[0], "2099-01-01")

    def test_63_unfinished_rows_prove_no_qualified_date_without_fallback(self):
        for _ in range(63):
            self.row("short", "2099-01-01", self.pending)
        self.assertIsNone(self.assert_latest(["short"], 1)[0])

    def test_exactly_64_unfinished_rows_must_fallback_not_claim_absence(self):
        for _ in range(64):
            self.row("threshold", "2099-01-01", self.pending)
        self.assertIsNone(self.assert_latest(["threshold"], 2)[0])

    def test_completed_row_beyond_64_newer_unfinished_rows_is_found_by_fallback(self):
        self.row("tail", "1999-01-01")
        for _ in range(64):
            self.row("tail", "2099-01-01", self.pending)
        self.assertEqual(self.assert_latest(["tail"], 2)[0], "1999-01-01")

    def test_equal_date_ties_with_completed_rows_remain_exact(self):
        for _ in range(64):
            self.row("ties", "2026-09-01", self.pending)
        self.row("ties", "2026-09-01")
        base = self.base(["ties"])
        with CaptureQueriesContext(connection) as captured:
            actual = source_latest_date(base, "京东", ["ties"], "jd_sku_daily", "sku_daily")
        self.assertEqual(actual, base.aggregate(day=Max("business_date"))["day"])
        # Either tied prefix contains the completed row or it correctly falls
        # back. Do not invent a tie order the original SQL never promised.
        self.assertIn(len(captured), (1, 2))

    def test_mixed_fast_and_multiple_fallback_shops_use_one_fallback_sql(self):
        self.row("fast", "2026-09-01")
        for name, old in (("slow-a", "1999-01-01"), ("slow-b", "2026-08-01")):
            self.row(name, old)
            for _ in range(64):
                self.row(name, "2099-01-01", self.pending)
        actual, sql = self.assert_latest(["fast", "slow-a", "slow-b"], 2)
        self.assertEqual(actual, "2026-09-01")
        self.assertIn("GREATEST", sql[1])

    def test_quoted_unicode_and_backslash_shop_scope_is_parameterized(self):
        names = ["汉字'店", "反\\斜线", "x'); SELECT 1; --"]
        for i, name in enumerate(names):
            self.row(name, f"2026-09-0{i + 1}")
        self.row("outside", "2099-01-01")
        self.assertEqual(self.assert_latest(names, 1)[0], "2026-09-03")

    def original_names(self, platform, limit=51):
        return list(NetshopRow.objects.filter(platform=platform).exclude(shop_name="")
                    .values_list("shop_name", flat=True).distinct().order_by("shop_name")[:limit])

    def test_directory_keeps_all_history_sources_statuses_and_exact_raw_names(self):
        names = ["历史店", "a'b", "back\\slash", "  padded  ", "汉字", "same"]
        for name in names:
            self.row(name, "1999-01-01", self.pending, source="other", dataset="other")
            self.row(name, None)
        self.row("", "2026-09-01")
        self.row("foreign-only", "2026-09-01", platform="天猫")
        self.row("same", "2026-09-01", platform="天猫")
        with self.assertNumQueries(1):
            actual = discover_shop_names("京东", 51)
        self.assertEqual(actual, self.original_names("京东"))
        self.assertEqual(set(actual), set(names))
        self.assertEqual(discover_shop_names("天猫", 51), self.original_names("天猫"))

    def test_directory_50_then_51_retains_existing_capacity_rejection_witness(self):
        for i in range(50):
            self.row(f"shop-{i:02}", "1999-01-01", self.pending)
        self.assertEqual(len(discover_shop_names("京东", 51)), 50)
        self.row("shop-50", "1999-01-01")
        self.row("shop-51", "1999-01-01")
        actual = discover_shop_names("京东", 51)
        self.assertEqual(actual, self.original_names("京东"))
        self.assertEqual(len(actual), 51)
        # The caller's existing >50 guard must receive the 51st member.
        self.assertGreater(len(actual), 50)

    def test_empty_platform_directory_is_empty_even_when_other_platform_has_rows(self):
        self.row("only-foreign", "2026-09-01", platform="天猫")
        self.assertEqual(discover_shop_names("京东", 51), self.original_names("京东"))
        self.assertEqual(discover_shop_names("京东", 51), [])
