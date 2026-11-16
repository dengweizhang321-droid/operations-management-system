from __future__ import annotations

import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from market import annotations
from market.errors import MarketApiError
from market.images import _fill_snapshot_images, execute_image_command
from market.models import (
    MarketAnnotationItem,
    MarketDataRevision,
    MarketImageCache,
    MarketImageCacheJob,
    MarketImageCacheJobItem,
    MarketMasterAuditLog,
    MarketMasterIdentity,
    MarketPriceSnapshot,
    MarketRankingEntry,
    MarketWriteAuthority,
)
from market.revisions import canonical_json, revision_value
from market.test_annotation_planning_round2 import PRINCIPAL as PLANNING_PRINCIPAL, PlanningFixtures
from sales.auth import Principal
from sales.tests.factories import TEST_SECRET, signed_headers

from .factories import body_bytes
from .test_api import AUTHORITY_EPOCH, CUTOVER_ID

ADMIN = Principal(email="sync-admin@example.test", display_name="Sync admin", role="admin", scope=None)
URL = "https://img10.360buyimg.com/n5/jfs/sync-%s.jpg"
PRICE_FIELDS = (
    "source_price_cents", "ai_image_price_cents", "ai_price_type", "ai_confidence_bps", "ai_reason",
    "confirmed_market_price_cents", "average_transaction_price_cents", "price_low_cents", "price_high_cents",
    "confirmation_status", "confirmed_by", "confirmed_at", "source_job_item_id", "prompt_version_id",
    "source_import_batch_id", "created_at", "migration_generation",
)


class SnapshotImageFixtures:
    def setUp(self):
        MarketDataRevision.objects.get_or_create(domain="market", defaults={"revision": 1, "source_digest": "a" * 64})

    def entry(self, code, month="2026-10", *, url="", scope="全部", dimension="SKU", day="28", **values):
        values = {
            "natural_key": f"nk-{MarketRankingEntry.objects.count()}", "source_row_number": 1,
            "period_start": f"{month}-01", "period_end": f"{month}-{day}", "category": "净水",
            "scope": scope, "sku_code": code, "ranking_dimension": dimension, "rank": 1,
            "image_url": url, "last_import_batch_id": "fixture", **values,
        }
        return MarketRankingEntry.objects.create(**values)

    def snapshot(self, code, month="2026-10", *, url="", sha="", scope="全部", dimension="SKU", **values):
        values = {
            "source_price_cents": 111, "ai_image_price_cents": 222, "ai_price_type": "到手价",
            "ai_confidence_bps": 9000, "ai_reason": "r", "confirmed_market_price_cents": 333,
            "confirmation_status": "confirmed", "confirmed_by": "u@example.test",
            "confirmed_at": timezone.now(), "source_job_item_id": "item-1", "prompt_version_id": "prompt-1",
            "price_low_cents": 100, "price_high_cents": 400, "average_transaction_price_cents": 250, **values,
        }
        return MarketPriceSnapshot.objects.create(
            id=f"snap-{code}-{scope}-{dimension}-{month}", category="净水", scope=scope, sku_code=code,
            ranking_dimension=dimension, month=month, image_url=url, image_content_sha256=sha, **values)

    def cache(self, url, status="ready", sha="c" * 64):
        return MarketImageCache.objects.create(
            source_url=url, status=status, content_sha256=sha if status == "ready" else "", object_key="k")

    def sync(self, **values):
        return execute_image_command(
            {"action": "sync_snapshot_images_from_ranking", "months": ["2026-10"], **values}, ADMIN)

    @staticmethod
    def frozen(snapshot):
        snapshot.refresh_from_db()
        return {field: getattr(snapshot, field) for field in PRICE_FIELDS}


class SnapshotImageSyncTests(SnapshotImageFixtures, TestCase):
    def test_fills_empty_url_and_hash_for_same_identity_and_month_without_touching_other_fields(self):
        a_url, b_url, c_url = URL % "a", URL % "b", URL % "c"
        self.entry("a", url=a_url)
        self.entry("b", url=b_url)
        self.entry("c", url=c_url)
        self.entry("a", "2026-11", url=URL % "other-month")
        empty = self.snapshot("a")
        hash_only = self.snapshot("b", url=b_url)
        untouched_month = self.snapshot("a", "2026-11")
        other_identity = self.snapshot("a", scope="其他")
        self.cache(a_url)
        self.cache(b_url, sha="d" * 64)
        self.snapshot("c", url=c_url, sha="e" * 64)
        before = {row.id: self.frozen(row) for row in (empty, hash_only, untouched_month, other_identity)}
        result = self.sync()
        self.assertEqual((result["filled"], result["hashed"], result["conflicts"], result["remaining"]), (1, 1, 0, 0))
        empty.refresh_from_db()
        hash_only.refresh_from_db()
        self.assertEqual((empty.image_url, empty.image_content_sha256), (a_url, "c" * 64))
        self.assertEqual((hash_only.image_url, hash_only.image_content_sha256), (b_url, "d" * 64))
        for row in (empty, hash_only, untouched_month, other_identity):
            self.assertEqual(self.frozen(row), before[row.id])
        for row in (untouched_month, other_identity):
            self.assertEqual((row.image_url, row.image_content_sha256), ("", ""))
        self.assertEqual(MarketPriceSnapshot.objects.get(sku_code="c").image_content_sha256, "e" * 64)
        self.assertEqual(result["jobId"], "")

    def test_different_non_empty_url_is_a_conflict_and_left_alone(self):
        self.entry("a", url=URL % "ranking")
        kept = self.snapshot("a", url=URL % "snapshot", sha="f" * 64)
        before = self.frozen(kept)
        result = self.sync()
        self.assertEqual((result["conflicts"], result["filled"], result["hashed"]), (1, 0, 0))
        kept.refresh_from_db()
        self.assertEqual((kept.image_url, kept.image_content_sha256), (URL % "snapshot", "f" * 64))
        self.assertEqual(self.frozen(kept), before)
        self.assertFalse(MarketMasterAuditLog.objects.filter(action="sync_market_snapshot_images").exists())

    def test_rows_of_one_identity_and_month_with_different_urls_are_a_conflict(self):
        self.entry("a", url=URL % "new", day="28")
        self.entry("a", url=URL % "old", day="14", period_start="2026-10-08")
        snapshot = self.snapshot("a")
        result = self.sync()
        self.assertEqual((result["conflicts"], result["filled"]), (1, 0))
        snapshot.refresh_from_db()
        self.assertEqual(snapshot.image_url, "")

    def test_newest_row_wins_when_urls_agree_and_spu_dimension_is_matched_separately(self):
        self.entry("a", url=URL % "a", day="28")
        self.entry("a", url=URL % "a", day="14", period_start="2026-10-08")
        self.entry("a", url=URL % "spu", dimension="SPU")
        sku = self.snapshot("a")
        spu = self.snapshot("a", dimension="SPU")
        result = self.sync()
        self.assertEqual(result["filled"], 2)
        sku.refresh_from_db()
        spu.refresh_from_db()
        self.assertEqual((sku.image_url, spu.image_url), (URL % "a", URL % "spu"))

    def test_not_ready_urls_seed_a_cache_job_and_never_get_a_hash(self):
        pending, failed = URL % "pending", URL % "failed"
        self.entry("p", url=pending)
        self.entry("f", url=failed)
        self.entry("n", url=URL % "none")
        self.cache(failed, status="failed")
        snapshots = [self.snapshot(code) for code in ("p", "f", "n")]
        result = self.sync()
        self.assertEqual((result["filled"], result["notReadyUrls"]), (3, 3))
        for row in snapshots:
            row.refresh_from_db()
            self.assertEqual(row.image_content_sha256, "")
            self.assertTrue(row.image_url)
        job = MarketImageCacheJob.objects.get(id=result["jobId"])
        self.assertTrue(job.discovery_complete)
        self.assertEqual(job.status, "queued")
        self.assertEqual(
            sorted(MarketImageCacheJobItem.objects.filter(job_id=job.id).values_list("source_url", flat=True)),
            sorted([pending, failed, URL % "none"]))

    def test_dry_run_writes_nothing_and_leaves_the_revision_alone(self):
        self.entry("a", url=URL % "a")
        self.snapshot("a")
        revision = revision_value()
        result = self.sync(dryRun=True)
        self.assertEqual((result["dryRun"], result["candidates"], result["processed"], result["filled"]), (True, 1, 1, 0))
        self.assertEqual(result["samples"][0]["skuCode"], "a")
        self.assertEqual(MarketPriceSnapshot.objects.get(sku_code="a").image_url, "")
        self.assertEqual(MarketImageCacheJob.objects.count(), 0)
        self.assertFalse(MarketMasterAuditLog.objects.filter(action="sync_market_snapshot_images").exists())
        self.assertEqual(revision_value(), revision)

    def test_second_run_writes_nothing_and_does_not_bump_the_revision(self):
        self.entry("a", url=URL % "a")
        self.entry("b", url=URL % "b")
        self.snapshot("a")
        self.snapshot("b")
        self.cache(URL % "a")
        first = self.sync()
        self.assertEqual((first["filled"], first["hashed"]), (2, 0))
        revision = revision_value()
        jobs, audits = MarketImageCacheJob.objects.count(), MarketMasterAuditLog.objects.count()
        again = self.sync()
        self.assertEqual((again["filled"], again["hashed"], again["candidates"], again["remaining"], again["jobId"]), (0, 0, 0, 0, ""))
        self.assertEqual(again["hashPending"], 1)
        self.assertEqual(revision_value(), revision)
        self.assertEqual((MarketImageCacheJob.objects.count(), MarketMasterAuditLog.objects.count()), (jobs, audits))

    def test_audit_records_original_values_and_the_revision_moves_once(self):
        self.entry("a", url=URL % "a")
        original = self.snapshot("a")
        revision = revision_value()
        result = self.sync()
        audit = MarketMasterAuditLog.objects.get(action="sync_market_snapshot_images")
        self.assertEqual(audit.before_json["snapshots"], [{"id": original.id, "imageUrl": "", "imageContentSha256": ""}])
        self.assertEqual(audit.after_json["filled"], 1)
        self.assertEqual(audit.entity_id, result["jobId"])
        self.assertNotEqual(revision_value(), revision)

    def test_limit_and_remaining_loop_until_everything_is_synced(self):
        for index in range(5):
            self.entry(f"s{index}", url=URL % index)
            self.snapshot(f"s{index}")
        seen = []
        remaining = None
        for _ in range(5):
            result = self.sync(limit=2)
            seen.append((result["processed"], result["remaining"]))
            remaining = result["remaining"]
            if not remaining:
                break
        self.assertEqual(seen, [(2, 3), (2, 1), (1, 0)])
        self.assertFalse(MarketPriceSnapshot.objects.filter(image_url="").exists())

    def test_parameter_validation(self):
        bad = [
            {"months": []}, {"months": "2026-10"}, {"months": ["2026-13"]}, {"months": ["2026-1"]},
            {"months": ["2026-10-01"]}, {"months": [202610]}, {"months": ["2026-10", "2026-10"]},
            {"months": [f"2026-0{n}" for n in range(1, 8)]}, {"limit": 0}, {"limit": 5001},
            {"limit": "5"}, {"limit": True}, {"dryRun": "yes"},
        ]
        for values in bad:
            with self.subTest(values=values):
                with self.assertRaises(MarketApiError):
                    execute_image_command(
                        {"action": "sync_snapshot_images_from_ranking", "months": ["2026-10"], **values}, ADMIN)

    def test_shared_helper_never_creates_snapshots_or_ranking_rows(self):
        self.entry("a", url=URL % "a")
        result = self.sync()
        self.assertEqual((result["candidates"], MarketPriceSnapshot.objects.count()), (0, 0))

    def test_helper_month_none_covers_every_month_of_the_identity(self):
        self.snapshot("a", "2026-09")
        self.snapshot("a", "2026-10", url=URL % "keep")
        result = _fill_snapshot_images([("净水", "全部", "SKU", "a", None, URL % "a")])
        self.assertEqual((result["filled"], result["conflicts"]), (1, 1))


class SnapshotImageSyncFillMissingTests(SnapshotImageFixtures, TestCase):
    def test_fill_missing_images_writes_the_hash_when_the_cache_is_already_ready(self):
        url = URL % "ready"
        self.entry("a", url="")
        snapshot = self.snapshot("a")
        before = self.frozen(snapshot)
        self.cache(url, sha="9" * 64)
        result = execute_image_command({"action": "fill_missing_images", "fills": [
            {"category": "净水", "scope": "全部", "rankingDimension": "SKU", "skuCode": "a", "imageUrl": url}]}, ADMIN)
        self.assertEqual((result["entriesFilled"], result["snapshotsFilled"], result["skipped"]), (1, 1, 0))
        snapshot.refresh_from_db()
        self.assertEqual((snapshot.image_url, snapshot.image_content_sha256), (url, "9" * 64))
        self.assertEqual(self.frozen(snapshot), before)

    def test_fill_missing_images_without_ready_cache_still_leaves_the_hash_empty(self):
        url = URL % "cold"
        self.entry("a", url="")
        snapshot = self.snapshot("a")
        execute_image_command({"action": "fill_missing_images", "fills": [
            {"category": "净水", "scope": "全部", "rankingDimension": "SKU", "skuCode": "a", "imageUrl": url}]}, ADMIN)
        snapshot.refresh_from_db()
        self.assertEqual((snapshot.image_url, snapshot.image_content_sha256), (url, ""))


@override_settings(MARKET_WRITE_AUTHORITY_EPOCH=AUTHORITY_EPOCH, MARKET_WRITE_CUTOVER_ID=CUTOVER_ID)
class SnapshotImageSyncCommandRouteTests(SnapshotImageFixtures, TestCase):
    def setUp(self):
        super().setUp()
        MarketWriteAuthority.objects.filter(id=1).update(
            status="postgres", authority_epoch=uuid.UUID(AUTHORITY_EPOCH), cutover_id=CUTOVER_ID,
            migration_verify_run_id="market-test-migration", activated_at=timezone.now())

    def post(self, command, request_id, role):
        payload = {"contractVersion": "market-command-v1", "domain": "images", "command": command}
        body = body_bytes(payload)
        path = "/api/market/commands"
        return self.client.post(
            path, data=body, content_type="application/json; charset=utf-8",
            headers=signed_headers(path, method="POST", body=body, request_id=request_id, role=role))

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_only_admin_may_run_the_sync_command(self):
        self.entry("a", url=URL % "a")
        self.snapshot("a")
        command = {"action": "sync_snapshot_images_from_ranking", "months": ["2026-10"]}
        denied = self.post(command, "snapshot-sync-operator", "operator")
        self.assertEqual(denied.status_code, 403, denied.content)
        self.assertEqual(MarketPriceSnapshot.objects.get(sku_code="a").image_url, "")
        allowed = self.post(command, "snapshot-sync-admin", "admin")
        self.assertEqual(allowed.status_code, 200, allowed.content)
        self.assertEqual(allowed.json()["result"]["filled"], 1)
        self.assertEqual(MarketPriceSnapshot.objects.get(sku_code="a").image_url, URL % "a")


class MonthScopedAnnotationJobTests(PlanningFixtures, TestCase):
    def two_months(self, sku="s"):
        october = self.candidate(sku, "2026-10")
        november = self.candidate(sku, "2026-11")
        return october, november

    def test_month_job_plans_the_older_month_that_the_latest_row_rule_never_reaches(self):
        self.two_months()
        plain = annotations._create_job(self.payload, PLANNING_PRINCIPAL)
        self.assertEqual(
            list(MarketAnnotationItem.objects.filter(job_id=plain["id"]).values_list("month", flat=True)), ["2026-11"])
        scoped = annotations._create_job({**self.payload, "month": "2026-10"}, PLANNING_PRINCIPAL)
        self.assertNotEqual(scoped["id"], plain["id"])
        self.assertFalse(scoped["reused"])
        self.assertEqual(
            list(MarketAnnotationItem.objects.filter(job_id=scoped["id"]).values_list("month", flat=True)), ["2026-10"])

    def test_one_row_per_identity_in_candidate_order_and_other_dimensions_excluded(self):
        for sku, rank in (("late", 9), ("early", 1)):
            row = self.candidate(sku, "2026-10")
            MarketRankingEntry.objects.filter(pk=row.pk).update(rank=rank)
        MarketRankingEntry.objects.create(
            natural_key="second-late", category=self.prompt.category, scope="全部", ranking_dimension="SKU",
            sku_code="late", period_start="2026-10-01", period_end="2026-10-15", source_row_number=1,
            last_import_batch_id="synthetic", rank=1)
        self.candidate("spu-only", "2026-10", dimension="SPU")
        self.candidate("other-month", "2026-09")
        rows = list(annotations._month_candidate_rows(self.prompt.category, "2026-10"))
        self.assertEqual([(row.sku_code, row.period_end) for row in rows], [("early", "2026-10-30"), ("late", "2026-10-30")])
        expected = list(annotations._candidate_rows(self.prompt.category).filter(
            period_end__startswith="2026-10").values_list("sku_code", flat=True))
        self.assertEqual([row.sku_code for row in rows], expected)

    def test_confirmed_same_image_history_goes_to_review_pending_for_the_scoped_month(self):
        october, _ = self.two_months()
        self.history(october, human=True, price_type="标准售价", price=12900)
        job = annotations._create_job({**self.payload, "month": "2026-10"}, PLANNING_PRINCIPAL)
        item = MarketAnnotationItem.objects.get(job_id=job["id"])
        self.assertEqual((item.month, item.status, item.reviewed_by), ("2026-10", "review_pending", "history_same_image"))
        self.assertEqual(item.reviewed_image_price_cents, 12900)

    def test_work_key_without_month_is_byte_identical_to_the_legacy_key(self):
        self.two_months()
        job = annotations._create_job(self.payload, PLANNING_PRINCIPAL)
        legacy = annotations._digest(canonical_json({
            "category": self.prompt.category, "promptVersionId": self.prompt.id, "executor": "cloud",
            "modelId": "synthetic-model", "localModelName": ""}))
        from market.models import MarketAnnotationJob
        self.assertEqual(MarketAnnotationJob.objects.get(id=job["id"]).work_key, legacy)
        again = annotations._create_job({**self.payload, "month": None}, PLANNING_PRINCIPAL)
        self.assertEqual((again["id"], again["reused"]), (job["id"], True))
        scoped = annotations._create_job({**self.payload, "month": "2026-10"}, PLANNING_PRINCIPAL)
        self.assertNotEqual(MarketAnnotationJob.objects.get(id=scoped["id"]).work_key, legacy)
        reused = annotations._create_job({**self.payload, "month": "2026-10"}, PLANNING_PRINCIPAL)
        self.assertEqual((reused["id"], reused["reused"]), (scoped["id"], True))

    def test_invalid_month_is_rejected(self):
        self.two_months()
        for month in ("2026-1", "2026-13", "2026-10-01", "202610", 202610):
            with self.subTest(month=month), self.assertRaises(MarketApiError):
                annotations._create_job({**self.payload, "month": month}, PLANNING_PRINCIPAL)
