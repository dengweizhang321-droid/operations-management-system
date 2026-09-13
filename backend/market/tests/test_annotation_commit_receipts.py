from __future__ import annotations

import uuid
from datetime import datetime, timezone as datetime_timezone
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from market.models import (
    MarketAnnotationCommitReceipt, MarketAnnotationItem, MarketAnnotationJob,
    MarketAnnotationPromptVersion, MarketDataRevision, MarketMasterAuditLog,
    MarketPriceSnapshot, MarketRankingEntry, MarketSkuAnnotation,
    MarketSubcategoryTaxonomy, MarketWriteAuthority, MarketWriteRequestReceipt,
)
from sales.tests.factories import TEST_SECRET, signed_headers

from .factories import body_bytes
from .test_api import AUTHORITY_EPOCH, CUTOVER_ID


@override_settings(MARKET_WRITE_AUTHORITY_EPOCH=AUTHORITY_EPOCH, MARKET_WRITE_CUTOVER_ID=CUTOVER_ID)
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class MarketAnnotationCommitReceiptTests(TestCase):
    def setUp(self):
        MarketWriteAuthority.objects.filter(id=1).update(
            status="postgres", authority_epoch=uuid.UUID(AUTHORITY_EPOCH), cutover_id=CUTOVER_ID,
            migration_verify_run_id="market-test-migration", activated_at=timezone.now(),
        )
        MarketSubcategoryTaxonomy.objects.create(id="receipt-taxonomy", category="净水", subcategory="台式")
        MarketAnnotationPromptVersion.objects.create(
            id="receipt-prompt", category="净水", version=1, source="manual", status="active",
            segments_json=["台式"], prompt_body="fixture", created_by="admin@example.test",
        )
        MarketAnnotationJob.objects.create(
            id="receipt-job", category="净水", prompt_version_id="receipt-prompt", executor="cloud",
            status="running", created_by="admin@example.test",
        )
        self.identity = dict(category="净水", scope="全部", sku_code="receipt-sku", ranking_dimension="SKU", image_content_sha256="a" * 64)
        self.old_time = datetime(2026, 8, 1, 2, 3, 4, 123456, tzinfo=datetime_timezone.utc)
        self.annotation = MarketSkuAnnotation.objects.create(
            id="existing-annotation", **self.identity, segment="旧分类", image_price_cents=None,
            source_job_item_id="historical-item", prompt_version_id="historical-prompt",
            reviewed_by="historical@example.test", reviewed_at=self.old_time, version=4,
        )
        MarketSkuAnnotation.objects.filter(pk=self.annotation.pk).update(created_at=self.old_time, updated_at=self.old_time)
        self.before = MarketSkuAnnotation.objects.values().get(pk=self.annotation.pk)
        # Different monthly candidates update the same formal image annotation.
        for month in ("2026-08", "2026-09"):
            MarketPriceSnapshot.objects.create(id=month, **self.identity, month=month)
            MarketRankingEntry.objects.create(
                natural_key=month, category="净水", scope="全部", sku_code="receipt-sku",
                period_start=month + "-01", period_end=month + "-12", source_row_number=1,
                subcategory="旧分类", last_import_batch_id="fixture",
            )
            MarketAnnotationItem.objects.create(
                id=month, job_id="receipt-job", **self.identity, month=month,
                status="approved", selected=True, version=1, reviewed_segment="台式",
                reviewed_image_price_cents=19900, reviewed_price_type="标准售价",
            )

    def commit(self, request_id="receipt-request", *, key="receipt-batch", role="admin"):
        path = "/api/market/commands"
        body = body_bytes({"contractVersion": "market-command-v1", "domain": "annotations", "command": {
            "action": "commit_selected", "aggregateJobs": True, "idempotencyKey": key,
        }})
        return self.client.post(path, data=body, content_type="application/json", headers=signed_headers(
            path, method="POST", body=body, request_id=request_id, role=role,
        ))

    def test_existing_annotation_dates_are_preserved_and_commit_replays_without_updates(self):
        response = self.commit()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["result"]["committed"], 2)
        first = MarketAnnotationCommitReceipt.objects.get(job_item_id="2026-08")
        expected = {key: value.isoformat().replace("+00:00", "Z") if isinstance(value, datetime) else value for key, value in self.before.items()}
        self.assertEqual(first.before_json, expected)
        self.assertIsNone(first.before_json["image_price_cents"])
        self.assertEqual(first.before_json["version"], 4)
        second = MarketAnnotationCommitReceipt.objects.get(job_item_id="2026-09")
        self.assertEqual(second.before_json["version"], 5)
        self.assertEqual(second.before_json["image_price_cents"], 19900)
        self.assertEqual(second.before_json["created_at"], expected["created_at"])
        self.assertTrue(second.before_json["reviewed_at"].endswith("Z"))
        self.annotation.refresh_from_db()
        self.assertEqual(self.annotation.version, 6)
        revision = MarketDataRevision.objects.values().get(domain="market")
        replay = self.commit()
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
        duplicate = self.commit("receipt-business-replay")
        self.assertEqual(duplicate.status_code, 200, duplicate.content)
        self.assertTrue(duplicate.json()["result"]["duplicate"])
        self.annotation.refresh_from_db()
        self.assertEqual(self.annotation.version, 6)
        self.assertEqual(MarketDataRevision.objects.values().get(domain="market"), revision)
        self.assertEqual(MarketAnnotationCommitReceipt.objects.count(), 3)
        self.assertEqual(MarketAnnotationItem.objects.filter(status="committed", selected=False).count(), 2)
        self.assertEqual(MarketPriceSnapshot.objects.filter(confirmed_market_price_cents=19900).count(), 2)

    def test_receipt_failure_rolls_back_entire_batch_and_same_request_can_retry(self):
        revision = MarketDataRevision.objects.values().get(domain="market")
        create = MarketAnnotationCommitReceipt.objects.create

        def fail_second(**kwargs):
            if kwargs["job_item_id"] == "2026-09":
                raise RuntimeError("synthetic receipt write failure")
            return create(**kwargs)

        with patch("market.annotations.MarketAnnotationCommitReceipt.objects.create", side_effect=fail_second):
            response = self.commit()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(MarketSkuAnnotation.objects.values().get(pk=self.annotation.pk), self.before)
        self.assertEqual(MarketAnnotationItem.objects.filter(status="approved", selected=True, version=1).count(), 2)
        self.assertEqual(MarketPriceSnapshot.objects.filter(confirmed_market_price_cents__isnull=True).count(), 2)
        self.assertEqual(MarketRankingEntry.objects.filter(subcategory="旧分类").count(), 2)
        self.assertFalse(MarketAnnotationCommitReceipt.objects.exists())
        self.assertFalse(MarketWriteRequestReceipt.objects.filter(request_id="receipt-request").exists())
        self.assertFalse(MarketMasterAuditLog.objects.exists())
        self.assertEqual(MarketDataRevision.objects.values().get(domain="market"), revision)
        retry = self.commit()
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json()["result"]["committed"], 2)

    def test_operator_cannot_commit_existing_annotation(self):
        response = self.commit(role="operator")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(MarketSkuAnnotation.objects.values().get(pk=self.annotation.pk), self.before)
        self.assertFalse(MarketAnnotationCommitReceipt.objects.exists())
