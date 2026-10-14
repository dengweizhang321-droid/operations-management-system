from datetime import timedelta
from unittest.mock import patch

from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from market.annotations import _create_job, _set_cloud_run, execute_annotation_query
from market.errors import MarketApiError
from market.models import MarketAnnotationItem, MarketAnnotationJob, MarketAnnotationPromptVersion, MarketMasterAuditLog, MarketImageCache, MarketPriceSnapshot, MarketRankingEntry, MarketSkuAnnotation
from market.tests.test_annotation_queue import PRINCIPAL, QueueFixtures, RESULT


class AnnotationPriorityTests(QueueFixtures, TestCase):
    def progress(self, job):
        return execute_annotation_query({"operation": "annotations", "view": "progress", "params": {"jobId": job.id}}, PRINCIPAL)

    def test_three_inflight_a_allow_nine_b_and_new_a_gets_next_slot(self):
        job = self.job("mixed", concurrency=12)
        for n in range(3):
            self.item(job, f"z-a-{n}")
        for n in range(20):
            self.item(job, f"a-b-{n:02}", reviewed_segment="测试细分", reviewed_by="history_same_sku_segment")
        tasks = [self.claim(job)["task"] for _ in range(12)]
        self.assertEqual([t["recognitionMode"] for t in tasks], ["full"] * 3 + ["price_only"] * 9)
        self.assertIsNone(self.claim(job)["task"])
        progress = self.progress(job)
        self.assertEqual(progress["queues"]["A"]["processing"], 3)
        self.assertEqual(progress["queues"]["B"]["processing"], 9)
        self.assertEqual(progress["activeClaims"], 12)
        self.item(job, "new-a")
        self.complete(tasks[-1])
        self.assertEqual(self.claim(job)["task"]["itemId"], "new-a")

    def test_b_rejects_model_classification_change_and_completion_metrics_are_idempotent(self):
        job = self.job("fixed")
        prompt = MarketAnnotationPromptVersion.objects.get(pk=job.prompt_version_id)
        prompt.segments_json = ["测试细分", "另一个分类"]
        prompt.save()
        self.item(job, "b", reviewed_segment="测试细分")
        task = self.claim(job)["task"]
        with self.assertRaises(MarketApiError):
            self.complete(task, result={**RESULT, "segment": "另一个分类"})
        self.complete(task)
        self.complete(task)
        progress = self.progress(job)
        self.assertEqual(progress["modelCompletedUnits"], 1)
        self.assertEqual(progress["newCompletedLastMinute"], 1)
        self.assertEqual(progress["queues"]["B"]["completed"], 1)
        self.assertEqual(MarketAnnotationItem.objects.get(pk="b").reviewed_segment, "测试细分")

    def test_resume_quarantines_expired_before_running_and_keeps_old_unknown_rows(self):
        job = self.job("resume")
        self.item(job, "expired")
        self.item(job, "remaining")
        self.item(job, "old-unknown", status="failed", attempt_count=3, error_message="unknown")
        task = self.claim(job)["task"]
        MarketAnnotationItem.objects.filter(pk=task["itemId"]).update(lease_expires_at=timezone.now() - timedelta(seconds=1))
        result = _set_cloud_run({"jobId": job.id, "state": "running"}, PRINCIPAL)
        self.assertTrue(result["resumeAccepted"])
        self.assertTrue(result["quarantinedExpiredClaims"])
        self.assertEqual(result["state"], "running")
        self.assertEqual(self.claim(job)["task"]["itemId"], "remaining")
        self.assertEqual(MarketAnnotationItem.objects.get(pk="old-unknown").attempt_count, 3)
        self.assertEqual(MarketAnnotationItem.objects.get(pk="expired").attempt_count, 3)

    def test_resume_with_only_expired_returns_actual_paused_state_and_persists_quarantine(self):
        job = self.job("only-expired")
        self.item(job, "one")
        task = self.claim(job)["task"]
        MarketAnnotationItem.objects.filter(pk=task["itemId"]).update(lease_expires_at=timezone.now() - timedelta(seconds=1))
        result = _set_cloud_run({"jobId": job.id, "state": "running"}, PRINCIPAL)
        self.assertFalse(result["resumeAccepted"])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(MarketAnnotationItem.objects.get(pk="one").attempt_count, 3)

    def test_price_states_do_not_make_b_classification_pending(self):
        job = self.job("states")
        self.item(job, "b", reviewed_segment="测试细分")
        task = self.claim(job)["task"]
        with self.assertRaises(MarketApiError):
            self.complete(task, result={**RESULT, "priceType": "明确无标价"})
        self.complete(task, result={**RESULT, "imagePriceCents": None, "priceType": "明确无标价", "reason": "图片完整清晰，没有任何商品标价"})
        row = MarketAnnotationItem.objects.get(pk="b")
        self.assertIsNone(row.reviewed_image_price_cents)
        self.assertEqual(row.reviewed_price_type, "明确无标价")

    def test_claim_exposes_only_matching_cache_and_rollbacks_preserve_mode_audits(self):
        job = self.job("cache")
        url = "https://img1.360buyimg.com/imgzone/test.jpg"
        self.item(job, "one", source_image_url=url)
        MarketImageCache.objects.create(source_url=url, status="ready", content_sha256="b" * 64)
        with transaction.atomic():
            task = self.claim(job)["task"]
            self.assertIsNone(task["imageCache"])
            transaction.set_rollback(True)
        self.assertFalse(MarketMasterAuditLog.objects.filter(entity_type="market_annotation_mode").exists())
        MarketImageCache.objects.filter(source_url=url).update(content_sha256="a" * 64)
        self.assertEqual(self.claim(job)["task"]["imageCache"]["contentSha256"], "a" * 64)

    def test_clear_no_price_reuse_requires_same_prompt_and_never_promotes_uncertain(self):
        job = self.job("history")
        MarketAnnotationJob.objects.filter(pk=job.id).update(status="committed")
        identity = dict(category=job.category, scope="全部", sku_code="sku", ranking_dimension="SKU")
        self.item(job, "history-result", sku="sku", status="committed", reviewed_segment="测试细分",
                  reviewed_price_type="明确无标价", ai_price_type="明确无标价", ai_confidence_bps=9500, ai_reason="主图清晰完整无标价", reviewed_at=timezone.now())
        ranking = MarketRankingEntry.objects.create(natural_key="ranking", **identity, period_start="2026-09-01", period_end="2026-09-30", source_row_number=1, last_import_batch_id="fixture")
        MarketPriceSnapshot.objects.create(id="snapshot", **identity, month="2026-09", image_content_sha256="a" * 64)
        payload = {"category": job.category, "promptVersionId": job.prompt_version_id, "executor": "cloud", "modelId": "vision-test"}
        with patch("market.annotations._candidate_rows", return_value=[ranking]):
            created = _create_job(payload, PRINCIPAL)
        self.assertEqual(MarketAnnotationItem.objects.get(job_id=created["id"]).status, "review_pending")
        self.assertEqual(self.progress(MarketAnnotationJob.objects.get(pk=created["id"]))["historyReusedUnits"], 1)
        MarketAnnotationJob.objects.filter(pk=created["id"]).update(status="committed")
        MarketAnnotationItem.objects.filter(pk="history-result").update(reviewed_price_type="无法判断")
        with patch("market.annotations._candidate_rows", return_value=[ranking]):
            created = _create_job(payload, PRINCIPAL)
        self.assertEqual(MarketAnnotationItem.objects.get(job_id=created["id"]).status, "queued")

    def test_storage_failure_retains_activity_and_successful_receipt_releases_it(self):
        job = self.job("activity-receipt")
        self.item(job, "one")
        task = self.claim(job)["task"]
        with patch("market.annotation_activity.release") as released:
            with patch("market.annotations._refresh_job", side_effect=RuntimeError("storage failure")):
                with self.assertRaises(RuntimeError):
                    self.complete(task)
            released.assert_not_called()
            with self.captureOnCommitCallbacks(execute=True):
                self.complete(task)
            self.assertEqual(released.call_count, 1)

    def test_helper_drain_stops_claims_without_consuming_attempts(self):
        job = self.job("drain-claim")
        self.item(job, "one")
        with patch("market.annotations.deployed_runtime", return_value="synthetic"), patch("market.annotations.read_gate", return_value={"phase": "helpers"}):
            self.assertTrue(self.claim(job)["stopped"])
        self.assertEqual(MarketAnnotationItem.objects.get(pk="one").attempt_count, 0)

    def test_unknown_zero_model_price_stays_null(self):
        job = self.job("unknown-zero")
        self.item(job, "one")
        task = self.claim(job)["task"]
        self.complete(task, result={**RESULT, "imagePriceCents": 0, "priceLowCents": 0, "priceHighCents": 0, "priceType": "无法判断"})
        row = MarketAnnotationItem.objects.get(pk="one")
        self.assertEqual((row.ai_image_price_cents, row.reviewed_image_price_cents, row.ai_price_low_cents, row.ai_price_high_cents), (None, None, None, None))

    def test_duplicate_receipt_with_other_lease_token_cannot_release_active_barrier(self):
        job = self.job("foreign-duplicate")
        self.item(job, "one")
        self.item(job, "two")
        first = self.claim(job)["task"]
        second = self.claim(job)["task"]
        self.complete(first)
        with patch("market.annotation_activity.release") as released, self.captureOnCommitCallbacks(execute=True):
            self.assertTrue(self.complete({**first, "leaseToken": second["leaseToken"]})["duplicate"])
        released.assert_not_called()

    def test_changed_image_reuses_only_classification_within_business_identity(self):
        job = self.job("changed-image")
        MarketAnnotationJob.objects.filter(pk=job.id).update(status="committed")
        identity = dict(category=job.category, scope="全部", sku_code="sku", ranking_dimension="SKU")
        MarketSkuAnnotation.objects.create(id="old-image", **identity, image_content_sha256="b" * 64,
            segment="测试细分", image_price_cents=12300, reviewed_by=PRINCIPAL.email, reviewed_at=timezone.now(),
            source_job_item_id="old", prompt_version_id=job.prompt_version_id)
        ranking = MarketRankingEntry.objects.create(natural_key="changed-ranking", **identity, period_start="2026-09-01", period_end="2026-09-30", source_row_number=1, last_import_batch_id="fixture")
        MarketPriceSnapshot.objects.create(id="new-snapshot", **identity, month="2026-09", image_content_sha256="a" * 64)
        with patch("market.annotations._candidate_rows", return_value=[ranking]):
            created = _create_job({"category": job.category, "promptVersionId": job.prompt_version_id, "executor": "cloud", "modelId": "vision-test"}, PRINCIPAL)
        candidate = MarketAnnotationItem.objects.get(job_id=created["id"])
        self.assertEqual(candidate.reviewed_segment, "测试细分")
        self.assertIsNone(candidate.reviewed_image_price_cents)

    def test_ten_thousand_mixed_units_claim_and_progress_share_complete_scope(self):
        from time import perf_counter
        job = self.job("scale", concurrency=12)
        items = [MarketAnnotationItem(id=f"scale-{n:05}", job_id=job.id, category=job.category, scope="全部",
                    sku_code=str(n), month="2026-09", image_content_sha256="a" * 64,
                    reviewed_segment="测试细分" if n < 9600 else "") for n in range(10000)]
        MarketAnnotationItem.objects.bulk_create(items, batch_size=500)
        started = perf_counter()
        tasks = [self.claim(job)["task"] for _ in range(12)]
        claim_ms = (perf_counter() - started) * 1000
        self.assertTrue(all(t["recognitionMode"] == "full" for t in tasks))
        started = perf_counter()
        progress = self.progress(job)
        progress_ms = (perf_counter() - started) * 1000
        self.assertEqual(progress["queues"]["A"]["processing"], 12)
        self.assertEqual(progress["queues"]["A"]["pending"], 388)
        self.assertEqual(progress["queues"]["B"]["pending"], 9600)
        print(f"SYNTHETIC_SCALE claim12Ms={claim_ms:.1f} progress10000Ms={progress_ms:.1f}")
