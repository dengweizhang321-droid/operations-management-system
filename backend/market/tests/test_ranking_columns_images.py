from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from market.errors import MarketApiError
from market.images import execute_image_command, execute_image_query
from market.models import (
    MarketImageCache,
    MarketImageCacheJob,
    MarketImageCacheJobItem,
    MarketMasterAuditLog,
    MarketMasterIdentity,
    MarketNetshopProjection,
    MarketNetshopProjectionControl,
    MarketPriceSnapshot,
    MarketRankingEntry,
)
from market.query import _conversion, overview, parse_order_count
from sales.auth import Principal

from .test_query import PRINCIPAL


ADMIN = Principal(email="fill-admin@example.test", display_name="Fill admin", role="admin", scope=None)


def sales(_principal, request):
    return {"rows": [{"productCode": code, "owned": False, "ownSalesCents": 0}
                     for code in request["productCodes"]]}, "11:7"


class OrderCountParsingTests(SimpleTestCase):
    def test_parses_like_the_typescript_importer(self):
        cases = {
            "10 ~ 50": 30,
            "￥2万 ~ ￥4万": 30_000,
            "1,000 ~ 2,000": 1_500,
            "0  ": 0,
            "0": 0,
            "53": 53,
            "53件": 53,
            "1.5万": 15_000,
            "-": None,
            "": None,
            "   ": None,
            "暂无": None,
            None: None,
            12: 12,
            12.4: 12,
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(parse_order_count(raw), expected)

    def test_reversed_range_uses_midpoint_and_midpoint_rounds_half_up(self):
        self.assertEqual(parse_order_count("50 ~ 10"), 30)
        self.assertEqual(parse_order_count("1 ~ 2"), 2)

    def test_conversion_fallback_and_over_one_hundred_percent_rule(self):
        self.assertEqual(_conversion(500, 10, 100), (500, False))
        self.assertEqual(_conversion(None, 53, 1_000), (530, True))
        self.assertEqual(_conversion(None, 0, 1_000), (0, True))
        self.assertEqual(_conversion(None, None, 1_000), (None, False))
        self.assertEqual(_conversion(None, 5, 0), (None, False))
        self.assertEqual(_conversion(None, 100, 100), (10_000, True))
        self.assertEqual(_conversion(None, 101, 100), (None, False))


class RankingColumnsTests(TestCase):
    def entry(self, code="sku", **values):
        values = {"natural_key": f"nk-{MarketRankingEntry.objects.count()}", "source_row_number": 1,
                  "period_start": "2026-08-01", "period_end": "2026-08-31", "category": "净水",
                  "scope": "全部", "sku_code": code, "ranking_dimension": "SKU", "rank": 1,
                  "gmv_cents": 405_000_00, "quantity": 60, "visitors": 1_000,
                  "last_import_batch_id": "fixture", **values}
        return MarketRankingEntry.objects.create(**values)

    def items(self, **filters):
        result = overview(PRINCIPAL, {"operation": "overview", "view": "ranking", "page": 1,
                                      "pageSize": 10, "filters": filters or None,
                                      "includeFilterOptions": False}, sales_loader=sales)
        return {item["skuCode"]: item for item in result["items"]}

    def test_order_count_average_order_value_and_estimated_conversion(self):
        self.entry("a", raw_json={"成交单量": "10 ~ 50"}, gmv_cents=900_000)
        self.entry("zero", rank=2, raw_json={"成交单量": "0  "})
        self.entry("dash", rank=3, raw_json={"成交单量": "-"})
        self.entry("missing", rank=4, raw_json={"gmv": 1})
        self.entry("stored", rank=5, conversion_bps=777, raw_json={"成交单量": "10"})
        self.entry("over", rank=6, visitors=10, raw_json={"成交单量": "50"})
        items = self.items()
        a = items["a"]
        self.assertEqual(a["orderCount"], 30)
        self.assertEqual(a["averageOrderValueCents"], 30_000)
        self.assertEqual(a["conversionBps"], 300)
        self.assertTrue(a["conversionEstimated"])
        self.assertFalse(a["gmvIsReal"])
        self.assertEqual(items["zero"]["orderCount"], 0)
        self.assertIsNone(items["zero"]["averageOrderValueCents"])
        self.assertEqual(items["zero"]["conversionBps"], 0)
        self.assertIsNone(items["dash"]["orderCount"])
        self.assertIsNone(items["dash"]["conversionBps"])
        self.assertFalse(items["dash"]["conversionEstimated"])
        self.assertIsNone(items["missing"]["orderCount"])
        self.assertIsNone(items["missing"]["averageOrderValueCents"])
        self.assertEqual(items["stored"]["conversionBps"], 777)
        self.assertFalse(items["stored"]["conversionEstimated"])
        self.assertEqual(items["stored"]["orderCount"], 10)
        self.assertIsNone(items["over"]["conversionBps"])
        self.assertFalse(items["over"]["conversionEstimated"])

    def test_reference_example_average_order_value(self):
        self.entry("ref", gmv_cents=4_050_000_00 // 100, raw_json={"成交单量": "53"})
        item = self.items()["ref"]
        self.assertEqual(item["orderCount"], 53)
        self.assertEqual(item["averageOrderValueCents"], round(item["gmvCents"] / 53))

    def test_average_order_value_uses_effective_gmv_and_flags_real_sales(self):
        row = self.entry("own", gmv_cents=100, raw_json={"成交单量": "4"})
        self.entry("est", rank=2, gmv_cents=100, raw_json={"成交单量": "4"})
        MarketNetshopProjectionControl.objects.update_or_create(id=1, defaults={"active_revision": "r"})
        MarketNetshopProjection.objects.create(
            projection_revision="r", projection_key="m", kind="metric", dataset="sku_daily",
            source="jd_sku_daily", sku_id=row.sku_code, business_date="2026-08-10",
            transaction_amount_cents=40_000)
        items = self.items()
        self.assertTrue(items["own"]["gmvIsReal"])
        self.assertEqual(items["own"]["gmvCents"], 40_000)
        self.assertEqual(items["own"]["averageOrderValueCents"], 10_000)
        self.assertFalse(items["est"]["gmvIsReal"])
        self.assertEqual(items["est"]["averageOrderValueCents"], 25)

    def test_raw_json_stays_deferred_for_the_ranking_rows(self):
        self.entry("a", raw_json={"成交单量": "3", "padding": "x" * 100})
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as queries:
            self.items()
        full_row_selects = [q["sql"] for q in queries.captured_queries
                            if "market_ranking_entries" in q["sql"] and "raw_json" in q["sql"].split(" FROM ")[0]
                            and "JSON_EXTRACT" not in q["sql"].upper() and "->" not in q["sql"]]
        self.assertEqual(full_row_selects, [])


class ImageFallbackTests(TestCase):
    def entry(self, code="sku", **values):
        values = {"natural_key": f"nk-{MarketRankingEntry.objects.count()}", "source_row_number": 1,
                  "period_start": "2026-08-01", "period_end": "2026-08-31", "category": "净水",
                  "scope": "全部", "sku_code": code, "ranking_dimension": "SKU", "rank": 1,
                  "gmv_cents": 100, "quantity": 1, "last_import_batch_id": "fixture", **values}
        return MarketRankingEntry.objects.create(**values)

    def page(self, **filters):
        result = overview(PRINCIPAL, {"operation": "overview", "view": "ranking", "page": 1,
                                      "pageSize": 10, "filters": filters or None,
                                      "includeFilterOptions": False}, sales_loader=sales)
        return result["items"]

    def test_same_identity_latest_image_then_same_sku_then_nothing(self):
        self.entry("a", period_start="2026-06-01", period_end="2026-06-30", image_url="https://img10.360buyimg.com/n5/old.jpg")
        self.entry("a", period_start="2026-07-01", period_end="2026-07-31", image_url="https://img10.360buyimg.com/n5/new.jpg")
        self.entry("a", scope="其他榜单", period_start="2026-09-01", period_end="2026-09-30",
                   image_url="https://img10.360buyimg.com/n5/other-scope.jpg")
        self.entry("a", rank=1, image_url="")
        self.entry("b", scope="其他榜单", period_start="2026-05-01", period_end="2026-05-31",
                   image_url="https://img10.360buyimg.com/n5/b-other.jpg")
        self.entry("b", rank=2, image_url="")
        self.entry("c", rank=3, image_url="")
        items = {item["skuCode"]: item for item in self.page(startDate="2026-08-01", endDate="2026-08-31")}
        self.assertEqual(items["a"]["imageUrl"], "https://img10.360buyimg.com/n5/new.jpg")
        self.assertEqual(items["a"]["sourceImageUrl"], "")
        self.assertEqual(items["a"]["imageCacheStatus"], "pending")
        self.assertEqual(items["b"]["imageUrl"], "https://img10.360buyimg.com/n5/b-other.jpg")
        self.assertEqual(items["b"]["sourceImageUrl"], "")
        self.assertEqual(items["c"]["imageUrl"], "")
        self.assertEqual(items["c"]["imageCacheStatus"], "missing")

    def test_spu_never_borrows_across_identities(self):
        self.entry("s", ranking_dimension="SPU", scope="其他榜单", period_start="2026-05-01",
                   period_end="2026-05-31", image_url="https://img10.360buyimg.com/n5/spu.jpg")
        self.entry("s", ranking_dimension="SPU", image_url="")
        items = self.page(rankingDimensions=["SPU"], startDate="2026-08-01", endDate="2026-08-31")
        self.assertEqual(items[0]["imageUrl"], "")

    def test_own_image_is_kept_and_ready_cache_maps_the_fallback_url(self):
        self.entry("own", image_url="https://img10.360buyimg.com/n5/own.jpg")
        self.entry("fb", period_start="2026-07-01", period_end="2026-07-31", image_url="https://img10.360buyimg.com/n5/fb.jpg")
        self.entry("fb", rank=2, image_url="")
        MarketImageCache.objects.create(source_url="https://img10.360buyimg.com/n5/fb.jpg", status="ready",
                                        content_sha256="f" * 64, object_key="k")
        items = {item["skuCode"]: item for item in self.page(startDate="2026-08-01", endDate="2026-08-31")}
        self.assertEqual(items["own"]["imageUrl"], "https://img10.360buyimg.com/n5/own.jpg")
        self.assertEqual(items["fb"]["imageUrl"], "/api/market/images/" + "f" * 64)
        self.assertEqual(items["fb"]["sourceImageUrl"], "")
        self.assertEqual(items["fb"]["imageCacheStatus"], "ready")
        self.assertEqual(MarketRankingEntry.objects.filter(image_url="").count(), 1)


class FillMissingImagesTests(TestCase):
    URL = "https://img10.360buyimg.com/n5/jfs/filled.jpg"

    def entry(self, code="sku", **values):
        values = {"natural_key": f"nk-{MarketRankingEntry.objects.count()}", "source_row_number": 1,
                  "period_start": "2026-08-01", "period_end": "2026-08-31", "category": "净水",
                  "scope": "全部", "sku_code": code, "ranking_dimension": "SKU", "rank": 1,
                  "gmv_cents": 100, "quantity": 1, "last_import_batch_id": "fixture", **values}
        return MarketRankingEntry.objects.create(**values)

    def fill(self, *fills):
        return execute_image_command({"action": "fill_missing_images", "fills": list(fills)}, ADMIN)

    @staticmethod
    def spec(code="sku", url=URL, **values):
        return {"category": "净水", "scope": "全部", "rankingDimension": "SKU", "skuCode": code,
                "imageUrl": url, **values}

    def test_fills_only_empty_urls_and_never_touches_prices(self):
        empty = self.entry("a", period_start="2026-07-01", period_end="2026-07-31")
        also_empty = self.entry("a")
        kept = self.entry("a", period_start="2026-06-01", period_end="2026-06-30",
                          image_url="https://img10.360buyimg.com/n5/keep.jpg")
        other_scope = self.entry("a", scope="其他")
        other_sku = self.entry("b")
        snapshot_values = dict(
            category="净水", scope="全部", sku_code="a", ranking_dimension="SKU", month="2026-08",
            source_price_cents=111, ai_image_price_cents=222, ai_price_type="到手价", ai_confidence_bps=9000,
            ai_reason="r", confirmed_market_price_cents=333, confirmation_status="confirmed",
            confirmed_by="u@example.test", image_content_sha256="a" * 64)
        MarketPriceSnapshot.objects.create(id="s-empty", image_url="", **snapshot_values)
        MarketPriceSnapshot.objects.create(id="s-kept", **{**snapshot_values, "month": "2026-07"},
                                           image_url="https://img10.360buyimg.com/n5/keep.jpg")
        before = {field: getattr(MarketPriceSnapshot.objects.get(id="s-empty"), field)
                  for field in snapshot_values if field != "image_content_sha256"}
        result = self.fill(self.spec("a"))
        self.assertEqual(result["entriesFilled"], 2)
        self.assertEqual(result["snapshotsFilled"], 1)
        self.assertEqual(result["skipped"], 0)
        for row in (empty, also_empty):
            row.refresh_from_db()
            self.assertEqual(row.image_url, self.URL)
        kept.refresh_from_db()
        self.assertEqual(kept.image_url, "https://img10.360buyimg.com/n5/keep.jpg")
        other_scope.refresh_from_db()
        other_sku.refresh_from_db()
        self.assertEqual((other_scope.image_url, other_sku.image_url), ("", ""))
        filled = MarketPriceSnapshot.objects.get(id="s-empty")
        self.assertEqual(filled.image_url, self.URL)
        self.assertEqual({field: getattr(filled, field) for field in before}, before)
        self.assertEqual(filled.image_content_sha256, "a" * 64)
        self.assertEqual(MarketPriceSnapshot.objects.get(id="s-kept").image_url,
                         "https://img10.360buyimg.com/n5/keep.jpg")

    def test_second_fill_with_another_url_changes_nothing_and_creates_no_job(self):
        self.entry("a")
        first = self.fill(self.spec("a"))
        self.assertTrue(first["jobId"])
        again = self.fill(self.spec("a", url="https://img11.360buyimg.com/n5/other.jpg"))
        self.assertEqual((again["entriesFilled"], again["snapshotsFilled"], again["skipped"], again["jobId"]), (0, 0, 1, ""))
        self.assertEqual(MarketRankingEntry.objects.get(sku_code="a").image_url, self.URL)
        self.assertEqual(MarketImageCacheJob.objects.count(), 1)

    def test_creates_one_queued_cache_job_for_exactly_the_filled_urls_with_audit(self):
        self.entry("a")
        self.entry("b")
        self.entry("c", image_url="https://img10.360buyimg.com/n5/had.jpg")
        other = "https://img10.360buyimg.com/n5/jfs/b.jpg"
        result = self.fill(self.spec("a"), self.spec("b", url=other), self.spec("c", url="https://img10.360buyimg.com/n5/x.jpg"))
        self.assertEqual((result["entriesFilled"], result["skipped"]), (2, 1))
        job = MarketImageCacheJob.objects.get(id=result["jobId"])
        self.assertTrue(job.scope_key.startswith("fill:"))
        self.assertEqual((job.status, job.batch_id, job.discovery_complete), ("queued", "", True))
        self.assertEqual(set(MarketImageCacheJobItem.objects.filter(job_id=job.id).values_list("source_url", flat=True)),
                         {self.URL, other})
        self.assertEqual(MarketMasterAuditLog.objects.filter(action="fill_market_missing_images").count(), 1)

    def test_validation_rejects_bad_input_atomically(self):
        self.entry("a")
        bad = (
            {"action": "fill_missing_images", "fills": []},
            {"action": "fill_missing_images"},
            {"action": "fill_missing_images", "fills": [self.spec("a", url="http://img10.360buyimg.com/n5/a.jpg")]},
            {"action": "fill_missing_images", "fills": [self.spec("a", rankingDimension="XX")]},
            {"action": "fill_missing_images", "fills": [self.spec("a"), self.spec("a")]},
            {"action": "fill_missing_images", "fills": [self.spec("a"), "x"]},
            {"action": "fill_missing_images", "fills": [self.spec(f"s{i}") for i in range(1_001)]},
        )
        for command in bad:
            with self.subTest(command=str(command)[:60]), self.assertRaises(MarketApiError):
                execute_image_command(command, ADMIN)
        self.assertEqual(MarketRankingEntry.objects.get(sku_code="a").image_url, "")
        self.assertEqual(MarketImageCacheJob.objects.count(), 0)

    def test_apply_image_repairs_is_unchanged_and_still_resets_prices(self):
        self.entry("a", image_url="https://img10.360buyimg.com/n5/old.jpg")
        MarketPriceSnapshot.objects.create(
            id="s", category="净水", scope="全部", sku_code="a", ranking_dimension="SKU", month="2026-08",
            confirmed_market_price_cents=333, confirmation_status="confirmed",
            image_url="https://img10.360buyimg.com/n5/old.jpg")
        result = execute_image_command({"action": "apply_image_repairs", "repairs": [self.spec("a", url="https://img10.360buyimg.com/n5/old.jpg")]}, ADMIN)
        self.assertEqual(result["updated"], 1)
        self.assertIsNone(MarketPriceSnapshot.objects.get(id="s").confirmed_market_price_cents)


class FillCandidatesTests(TestCase):
    def entry(self, code, **values):
        values = {"natural_key": f"nk-{MarketRankingEntry.objects.count()}", "source_row_number": 1,
                  "period_start": "2026-08-01", "period_end": "2026-08-31", "category": "净水",
                  "scope": "全部", "sku_code": code, "ranking_dimension": "SKU", "rank": 1,
                  "gmv_cents": 100, "quantity": 1, "last_import_batch_id": "fixture", **values}
        row = MarketRankingEntry.objects.create(**values)
        MarketMasterIdentity.objects.update_or_create(
            category=row.category, scope=row.scope, ranking_dimension=row.ranking_dimension,
            sku_code=row.sku_code, defaults={"latest_entry_id": row.id})
        return row

    def test_fill_candidates_exclude_skus_that_have_an_image_anywhere(self):
        self.entry("never")
        self.entry("elsewhere")
        MarketRankingEntry.objects.create(
            natural_key="old", source_row_number=1, period_start="2026-01-01", period_end="2026-01-31",
            category="其他类目", scope="POP", sku_code="elsewhere", ranking_dimension="SKU",
            image_url="https://img10.360buyimg.com/n5/e.jpg", last_import_batch_id="fixture")
        self.entry("spu-code", ranking_dimension="SPU")
        params = {"page": 1, "pageSize": 50}
        fill = execute_image_query({"operation": "image_fill_candidates", "params": params})
        self.assertEqual([item["skuCode"] for item in fill["items"]], ["never"])
        self.assertEqual(fill["pagination"]["total"], 1)
        legacy = execute_image_query({"operation": "image_repair_candidates", "params": params})
        self.assertEqual(sorted(item["skuCode"] for item in legacy["items"]), ["elsewhere", "never", "spu-code"])


class FillJobFlowTests(TestCase):
    def test_fill_job_is_claimable_and_drains_through_the_existing_cache_pipeline(self):
        MarketRankingEntry.objects.create(
            natural_key="nk-flow", source_row_number=1, period_start="2026-08-01", period_end="2026-08-31",
            category="净水", scope="全部", sku_code="flow", ranking_dimension="SKU", rank=1,
            last_import_batch_id="fixture")
        url = "https://img10.360buyimg.com/n5/jfs/flow.jpg"
        result = execute_image_command({"action": "fill_missing_images", "fills": [
            {"category": "净水", "scope": "全部", "rankingDimension": "SKU", "skuCode": "flow", "imageUrl": url}]}, ADMIN)
        claimed = execute_image_command({"action": "claim_image_cache", "jobId": result["jobId"], "limit": 4}, ADMIN)
        self.assertEqual([claim["sourceUrl"] for claim in claimed["claims"]], [url])
        self.assertEqual(claimed["job"]["total"], 1)
        digest = "e" * 64
        execute_image_command({
            "action": "complete_image_cache_claim", "jobId": result["jobId"], "sourceUrl": url,
            "jobLeaseToken": claimed["job"]["leaseToken"], "claimToken": claimed["claims"][0]["claimToken"],
            "jobEpoch": claimed["job"]["leaseEpoch"], "contentSha256": digest,
            "objectKey": f"market-images/v1/{digest}.jpg", "mimeType": "image/jpeg", "sizeBytes": 10,
            "imageSource": "remote", "errorCode": "", "errorMessage": ""}, ADMIN)
        finished = execute_image_command({
            "action": "finish_image_cache_job", "jobId": result["jobId"],
            "jobLeaseToken": claimed["job"]["leaseToken"], "jobEpoch": claimed["job"]["leaseEpoch"]}, ADMIN)
        self.assertEqual(finished["job"]["status"], "completed")
        self.assertEqual(MarketImageCache.objects.get(source_url=url).status, "ready")


class FillCandidatesCostTests(TestCase):
    def bulk(self, count):
        rows = [
            MarketRankingEntry(
                natural_key=f"bulk-{index}", source_row_number=1, period_start="2026-08-01",
                period_end="2026-08-31", category="净水", scope="全部", sku_code=f"bulk-{index:05d}",
                ranking_dimension="SKU", rank=1, last_import_batch_id="fixture",
                image_url="https://img10.360buyimg.com/n5/x.jpg" if index % 3 == 0 else "")
            for index in range(count)
        ]
        MarketRankingEntry.objects.bulk_create(rows)
        MarketMasterIdentity.objects.bulk_create([
            MarketMasterIdentity(category=row.category, scope=row.scope, ranking_dimension="SKU",
                                 sku_code=row.sku_code, latest_entry_id=row.id)
            for row in MarketRankingEntry.objects.filter(natural_key__startswith="bulk-")])

    def test_query_count_is_bounded_and_independent_of_the_number_of_identities(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        self.bulk(2_500)
        with CaptureQueriesContext(connection) as queries:
            first = execute_image_query({"operation": "image_fill_candidates", "params": {"page": 1, "pageSize": 1_000}})
        # one narrow identity read + one IN chunk per 1000 candidate sku codes (1666 empties -> 2 chunks)
        self.assertLessEqual(len(queries), 3, [q["sql"][:80] for q in queries])
        self.assertEqual(first["pagination"], {"page": 1, "pageSize": 1_000, "total": 1_666, "pageCount": 2})
        self.assertEqual(len(first["items"]), 1_000)
        second = execute_image_query({"operation": "image_fill_candidates", "params": {"page": 2, "pageSize": 1_000}})
        self.assertEqual(len(second["items"]), 666)
        codes = [item["skuCode"] for item in first["items"] + second["items"]]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertTrue(all(int(code.split("-")[1]) % 3 != 0 for code in codes))
        for item in first["items"][:1]:
            self.assertEqual(set(item), {"category", "scope", "rankingDimension", "skuCode", "productName", "brand", "productUrl", "periodEnd"})

    def test_fill_page_size_may_reach_1000_but_repair_candidates_stay_capped_at_200(self):
        self.bulk(3)
        ok = execute_image_query({"operation": "image_fill_candidates", "params": {"page": 1, "pageSize": 1_000}})
        self.assertEqual(ok["pagination"]["pageSize"], 1_000)
        with self.assertRaises(MarketApiError):
            execute_image_query({"operation": "image_fill_candidates", "params": {"page": 1, "pageSize": 1_001}})
        with self.assertRaises(MarketApiError):
            execute_image_query({"operation": "image_repair_candidates", "params": {"page": 1, "pageSize": 201}})
        self.assertEqual(
            execute_image_query({"operation": "image_repair_candidates", "params": {"page": 1, "pageSize": 200}})["pagination"]["pageSize"], 200)

    def test_sku_imaged_only_in_another_scope_or_older_month_is_not_a_candidate_and_spu_never_is(self):
        def row(key, **values):
            fields = dict(natural_key=key, source_row_number=1, period_start="2026-08-01", period_end="2026-08-31",
                          category="净水", scope="全部", ranking_dimension="SKU", rank=1, last_import_batch_id="fixture")
            fields.update(values)
            return MarketRankingEntry.objects.create(**fields)
        latest = row("l", sku_code="x", image_url="")
        other = row("o", sku_code="x", scope="其他", period_start="2026-01-01", period_end="2026-01-31",
                    image_url="https://img10.360buyimg.com/n5/o.jpg")
        for entry in (latest, other):
            MarketMasterIdentity.objects.create(category=entry.category, scope=entry.scope, ranking_dimension="SKU",
                                                sku_code=entry.sku_code, latest_entry_id=entry.id)
        spu = row("s", sku_code="spu1", ranking_dimension="SPU", image_url="")
        MarketMasterIdentity.objects.create(category="净水", scope="全部", ranking_dimension="SPU", sku_code="spu1", latest_entry_id=spu.id)
        result = execute_image_query({"operation": "image_fill_candidates", "params": {"page": 1, "pageSize": 100}})
        self.assertEqual(result["items"], [])
