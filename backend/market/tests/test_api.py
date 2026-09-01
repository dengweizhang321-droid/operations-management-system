from __future__ import annotations

import copy
import hashlib
import uuid
from datetime import date, timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from market.annotations import candidate_counts
from market.models import (
    MarketDataRevision,
    MarketImportAttempt,
    MarketImportBatch,
    MarketImportScopeHead,
    MarketMasterIdentity,
    MarketPriceBandItem,
    MarketPriceBandVersion,
    MarketPriceSnapshot,
    MarketRankingEntry,
    MarketSkuAnnotation,
    MarketWriteAuthority,
)
from sales.tests.factories import TEST_SECRET, signed_headers

from .factories import body_bytes, market_row, prepared_payload


AUTHORITY_EPOCH = "11111111-1111-4111-8111-111111111111"
CUTOVER_ID = "market-test-cutover"


@override_settings(
    MARKET_WRITE_AUTHORITY_EPOCH=AUTHORITY_EPOCH,
    MARKET_WRITE_CUTOVER_ID=CUTOVER_ID,
)
class MarketApiContractTests(TestCase):
    def setUp(self) -> None:
        MarketWriteAuthority.objects.filter(id=1).update(
            status="postgres",
            authority_epoch=uuid.UUID(AUTHORITY_EPOCH),
            cutover_id=CUTOVER_ID,
            migration_verify_run_id="market-test-migration",
            activated_at=timezone.now(),
        )

    def post_import(self, payload: dict[str, object], request_id: str):
        body = body_bytes(payload)
        return self.client.post(
            "/api/market/imports",
            data=body,
            content_type="application/json; charset=utf-8",
            headers=signed_headers(
                "/api/market/imports",
                method="POST",
                body=body,
                request_id=request_id,
            ),
        )

    def post_query(
        self,
        payload: dict[str, object],
        request_id: str,
        *,
        role: str = "admin",
        scope=None,
    ):
        body = body_bytes(payload)
        return self.client.post(
            "/api/market/queries",
            data=body,
            content_type="application/json; charset=utf-8",
            headers=signed_headers(
                "/api/market/queries",
                method="POST",
                body=body,
                request_id=request_id,
                role=role,
                scope=scope,
            ),
        )

    def test_candidate_counts_is_set_based_and_keeps_exact_image_identity(self) -> None:
        rows = []
        for index, (category, sku_code) in enumerate(
            (("净水", "SKU-A"), ("净水", "SKU-B"), ("制冰", "SKU-C")),
            start=1,
        ):
            row = MarketRankingEntry.objects.create(
                natural_key=f"candidate-count-{index}",
                source_row_number=index,
                period_start="2026-08-01",
                period_end="2026-08-31",
                category=category,
                scope="热销商品榜",
                ranking_dimension="SKU",
                sku_code=sku_code,
                last_import_batch_id="candidate-count-batch",
            )
            MarketMasterIdentity.objects.create(
                category=category,
                scope="热销商品榜",
                ranking_dimension="SKU",
                sku_code=sku_code,
                latest_entry_id=row.id,
            )
            rows.append(row)
        for row, image_hash in zip(rows[:2], ("a" * 64, "b" * 64), strict=True):
            MarketPriceSnapshot.objects.create(
                id=f"snapshot-{row.sku_code}",
                category=row.category,
                scope=row.scope,
                sku_code=row.sku_code,
                ranking_dimension=row.ranking_dimension,
                month="2026-08",
                image_content_sha256=image_hash,
            )
        MarketSkuAnnotation.objects.create(
            id="annotation-sku-a",
            category="净水",
            scope="热销商品榜",
            ranking_dimension="SKU",
            sku_code="SKU-A",
            image_content_sha256="a" * 64,
            segment="商用直饮机",
            source_job_item_id="annotation-item-a",
            prompt_version_id="prompt-a",
            reviewed_by="admin@example.test",
            reviewed_at=timezone.now(),
        )
        with self.assertNumQueries(2):
            result = candidate_counts()
        self.assertEqual(
            result,
            {
                "categories": [
                    {"value": "净水", "candidateCount": 1},
                    {"value": "制冰", "candidateCount": 0},
                ]
            },
        )

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_import_is_atomic_business_idempotent_and_replay_fenced(self) -> None:
        payload = prepared_payload(market_row())
        first = self.post_import(payload, "market-import-1")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(first.json()["status"], "imported")
        self.assertEqual(first["X-Market-Data-Revision"].split(":")[0], "1")
        self.assertEqual(MarketRankingEntry.objects.get().natural_key, payload["rows"][0]["naturalKey"])
        self.assertEqual(MarketMasterIdentity.objects.count(), 1)

        replay = self.post_import(payload, "market-import-1")
        self.assertEqual(replay.status_code, 201, replay.content)
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
        self.assertEqual(MarketImportBatch.objects.count(), 1)

        resaved = copy.deepcopy(payload)
        resaved["rawFileHash"] = hashlib.sha256(b"resaved").hexdigest()
        resaved["fileName"] = "重新保存.xlsx"
        duplicate = self.post_import(resaved, "market-import-2")
        self.assertEqual(duplicate.status_code, 200, duplicate.content)
        self.assertEqual(duplicate.json()["status"], "duplicate")
        self.assertEqual(MarketImportAttempt.objects.filter(outcome="duplicate").count(), 1)

        collision = copy.deepcopy(payload)
        collision["rawFileHash"] = hashlib.sha256(b"collision").hexdigest()
        collision_response = self.post_import(collision, "market-import-1")
        self.assertEqual(collision_response.status_code, 409)
        self.assertEqual(collision_response.json()["code"], "version_conflict")

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_changed_exact_scope_replaces_complete_fact_set_and_prunes_derived_rows(self) -> None:
        first = prepared_payload(
            market_row(),
            market_row(sourceRowNumber=3, skuCode="SKU-REMOVED", rank=2, productName="将被删除"),
        )
        self.assertEqual(self.post_import(first, "market-replace-1").status_code, 201)
        self.assertEqual(MarketRankingEntry.objects.count(), 2)

        replacement = prepared_payload(
            market_row(gmvCents=8_800_000, quantity=80),
            raw_seed="replacement",
        )
        response = self.post_import(replacement, "market-replace-2")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(MarketRankingEntry.objects.count(), 1)
        self.assertEqual(MarketRankingEntry.objects.get().gmv_cents, 8_800_000)
        self.assertFalse(MarketMasterIdentity.objects.filter(sku_code="SKU-REMOVED").exists())
        self.assertFalse(MarketPriceSnapshot.objects.filter(sku_code="SKU-REMOVED").exists())
        head = MarketImportScopeHead.objects.get()
        self.assertEqual(head.status, "ready")
        self.assertEqual(head.owner_token, "")
        self.assertEqual(MarketDataRevision.objects.get(domain="market").revision, 2)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_exact_scope_duplicate_survives_another_date_in_the_same_lock_month(self) -> None:
        first = prepared_payload(
            market_row(periodStart="2026-08-01", periodEnd="2026-08-01"),
            raw_seed="day-one",
        )
        second = prepared_payload(
            market_row(
                sourceRowNumber=3,
                periodStart="2026-08-02",
                periodEnd="2026-08-02",
                gmvCents=6_000_000,
            ),
            raw_seed="day-two",
        )
        self.assertEqual(self.post_import(first, "market-day-one").status_code, 201)
        self.assertEqual(self.post_import(second, "market-day-two").status_code, 201)
        retry = copy.deepcopy(first)
        retry["fileName"] = "第一天重新保存.xlsx"
        retry["rawFileHash"] = hashlib.sha256(b"day-one-resaved").hexdigest()
        response = self.post_import(retry, "market-day-one-retry")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "duplicate")
        self.assertEqual(MarketRankingEntry.objects.count(), 2)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_prevalidation_failure_is_audited_without_claiming_scope(self) -> None:
        payload = prepared_payload(market_row())
        payload["rows"][0]["naturalKey"] = "tampered"
        response = self.post_import(payload, "market-rejected-1")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(MarketImportBatch.objects.count(), 0)
        self.assertEqual(MarketImportScopeHead.objects.count(), 0)
        attempt = MarketImportAttempt.objects.get()
        self.assertEqual(attempt.outcome, "rejected")

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_writer_fails_closed_without_exact_authority(self) -> None:
        MarketWriteAuthority.objects.filter(id=1).update(status="d1", authority_epoch=None)
        response = self.post_import(prepared_payload(market_row()), "market-authority-off")
        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(response.json()["code"], "service_unavailable")
        self.assertEqual(MarketRankingEntry.objects.count(), 0)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    @patch("market.query.read_sales_consumer")
    def test_overview_is_revisioned_and_keeps_formal_price_separate(self, sales_reader) -> None:
        self.assertEqual(self.post_import(prepared_payload(market_row()), "market-overview-import").status_code, 201)
        snapshot = MarketPriceSnapshot.objects.get()
        snapshot.confirmed_market_price_cents = 188_800
        snapshot.ai_price_type = "标准售价"
        snapshot.confirmation_status = "confirmed"
        snapshot.image_content_sha256 = "a" * 64
        snapshot.save()
        sales_reader.return_value = (
            {"rows": [{"productCode": "SKU-001", "owned": True, "ownSalesCents": 99_900}]},
            "7:abcdefabcdef",
        )
        response = self.post_query(
            {
                "operation": "overview",
                "view": "full",
                "page": 1,
                "pageSize": 20,
                "filters": None,
            },
            "market-overview-1",
            role="analyst",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertRegex(response["X-Market-Data-Revision"], r"^1:[a-f0-9]{12}$")
        item = response.json()["items"][0]
        self.assertEqual(item["marketPriceCents"], 188_800)
        self.assertEqual(item["averageTransactionPriceCents"], 188_800)
        self.assertEqual(item["ownSalesCents"], 99_900)
        self.assertTrue(item["isOwn"])
        self.assertEqual(response.json()["industryReport"]["definition"]["metricScope"], "当前 TOP 榜单覆盖市场")

    def create_industry_fixture(self, *, missing_month: str = "", invalid_price_month: str = "") -> None:
        MarketPriceBandVersion.objects.create(
            id="market-price-band-v1",
            category="商用净饮水设备",
            version=1,
            status="published",
            effective_from="2025-01-01",
            created_by="admin@example.test",
            published_by="admin@example.test",
            published_at=timezone.now(),
        )
        MarketPriceBandItem.objects.create(
            id="market-price-band-v1-item",
            version_id="market-price-band-v1",
            label="1000-3000",
            min_cents=100_000,
            max_cents=300_000,
            sort_order=1,
        )
        for offset in range(13):
            absolute = 2025 * 12 + 7 + offset
            year = absolute // 12
            month = absolute % 12 + 1
            period = f"{year:04d}-{month:02d}"
            if period == missing_month:
                continue
            next_month = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
            period_end = (next_month - timedelta(days=1)).isoformat()
            MarketRankingEntry.objects.create(
                natural_key=f"industry|{period}",
                source_row_number=offset + 1,
                period_start=f"{period}-01",
                period_end=period_end,
                category="商用净饮水设备",
                scope="热销商品榜",
                price_band_filter="全部",
                ranking_dimension="SKU",
                operation_mode="POP",
                subcategory="校园饮水机",
                rank=1,
                sku_code="SKU-INDUSTRY",
                product_name="校园RO反渗透商用直饮机 100人 包安装",
                brand="志高",
                price_cents=188_800,
                gmv_cents=1_000_000 + offset * 100_000,
                quantity=10 + offset,
                visitors=100 + offset * 10,
                last_import_batch_id="industry-fixture",
            )
            MarketPriceSnapshot.objects.create(
                id=f"price|{period}",
                category="商用净饮水设备",
                scope="热销商品榜",
                sku_code="SKU-INDUSTRY",
                ranking_dimension="SKU",
                month=period,
                confirmed_market_price_cents=188_800,
                ai_price_type="起售价" if period == invalid_price_month else "标准售价",
                image_content_sha256="b" * 64,
                confirmation_status="confirmed",
                confirmed_by="admin@example.test",
                confirmed_at=timezone.now(),
            )

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    @patch("market.query.read_sales_consumer")
    def test_industry_report_requires_continuous_coverage_and_image_fenced_formal_prices(self, sales_reader) -> None:
        self.create_industry_fixture()
        sales_reader.return_value = (
            {"rows": [{"productCode": "SKU-INDUSTRY", "owned": False, "ownSalesCents": 0}]},
            "8:abcdefabcdef",
        )
        response = self.post_query(
            {"operation": "overview", "view": "full", "page": 1, "pageSize": 20, "filters": None},
            "market-industry-ready",
            role="analyst",
        )
        self.assertEqual(response.status_code, 200, response.content)
        report = response.json()["industryReport"]
        self.assertTrue(report["dataQuality"]["identityReady"])
        self.assertTrue(report["dataQuality"]["coverageReady"])
        self.assertTrue(report["dataQuality"]["comparisonReady"])
        self.assertEqual(report["dataQuality"]["pendingPriceSkuCount"], 0)
        self.assertEqual(report["period"]["coverageMonths"], 13)
        self.assertTrue(report["lifecycle"])
        self.assertTrue(report["brandConcentrationTrend"])
        self.assertTrue(report["trafficQuadrants"])
        self.assertGreater(report["productSignals"]["sampleSize"], 0)
        self.assertTrue(report["opportunities"][0]["decisionReady"])

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    @patch("market.query.read_sales_consumer")
    def test_industry_report_rejects_gap_and_non_formal_starting_price(self, sales_reader) -> None:
        self.create_industry_fixture(missing_month="2026-02", invalid_price_month="2026-08")
        sales_reader.return_value = (
            {"rows": [{"productCode": "SKU-INDUSTRY", "owned": False, "ownSalesCents": 0}]},
            "9:abcdefabcdef",
        )
        response = self.post_query(
            {"operation": "overview", "view": "full", "page": 1, "pageSize": 20, "filters": None},
            "market-industry-not-ready",
            role="analyst",
        )
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        report = result["industryReport"]
        self.assertFalse(report["dataQuality"]["coverageReady"])
        self.assertEqual(report["dataQuality"]["pendingPriceSkuCount"], 1)
        self.assertIsNone(next(item for item in result["items"] if item["periodEnd"].startswith("2026-08"))["marketPriceCents"])
        self.assertTrue(all(item["recommendation"] == "持续观察" for item in report["opportunities"]))
        self.assertTrue(all(not item["decisionReady"] for item in report["opportunities"]))

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_market_reader_rejects_scoped_principal_and_duplicate_json_keys(self) -> None:
        scoped = self.post_query(
            {"operation": "master", "view": "settings_status", "params": {}},
            "market-scoped",
            role="analyst",
            scope={"warehouses": [], "channels": [], "platforms": ["京东"]},
        )
        self.assertEqual(scoped.status_code, 403)
        body = b'{"operation":"image_metadata","contentHash":"' + b"a" * 64 + b'","contentHash":"' + b"b" * 64 + b'"}'
        duplicate = self.client.post(
            "/api/market/queries",
            data=body,
            content_type="application/json",
            headers=signed_headers(
                "/api/market/queries",
                method="POST",
                body=body,
                request_id="market-duplicate-json",
            ),
        )
        self.assertEqual(duplicate.status_code, 400)
