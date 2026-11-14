from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from market import annotations
from market.admin import _apply_mappings, _mapping_items, _upsert_mapping
from market.annotation_runtime import (
    UNKNOWN_EXPIRATION_PAUSE_THRESHOLD, record_failure, record_success, record_unknown_expirations, retry_snapshot,
)
from market.annotations import (
    INTERNAL_ANNOTATION_RUNNER_EMAIL, _claim_job_item, _complete_job_item, _dispatch, _ensure_auto_annotation,
    _set_auto_annotation, _set_cloud_run, _start_category_recognition, annotation_workspace, execute_annotation_command,
    execute_annotation_query,
)
from market.errors import MarketApiError
from market.models import (
    AUTO_ANNOTATION_RULE_KIND, MarketAnnotationCloudRun, MarketAnnotationConcurrencySetting, MarketAnnotationItem,
    MarketAnnotationJob, MarketAnnotationPromptVersion, MarketDataRevision, MarketImageCacheJob, MarketMasterAuditLog,
    MarketMasterIdentity, MarketMasterMappingRule, MarketPriceSnapshot, MarketRankingEntry, MarketSubcategoryTaxonomy,
)
from market.tests.test_annotation_queue import PRINCIPAL, QueueFixtures
from sales.auth import Principal

ADMIN = Principal("auto-admin@example.test", "Admin", "admin", None)
RUNNER = Principal(INTERNAL_ANNOTATION_RUNNER_EMAIL, "Runner", "operator", None)
CATEGORY = "自动识别类目"
SEGMENT = "细分甲"


class AutoRecognitionFixtures(QueueFixtures):
    def seed_category(self, category=CATEGORY, *, skus=2, batch="batch-1", prompt=True):
        MarketDataRevision.objects.get_or_create(domain="market", defaults={"revision": 1, "source_digest": "a" * 64})
        MarketSubcategoryTaxonomy.objects.get_or_create(id="taxonomy-" + category, defaults={"category": category, "subcategory": SEGMENT})
        if prompt:
            MarketAnnotationPromptVersion.objects.create(
                id="prompt-" + category, category=category, version=1, source="manual", status="active",
                segments_json=[SEGMENT], prompt_body="严格 JSON", created_by=ADMIN.email)
        for number in range(skus):
            sku = f"{category}-sku-{number}"
            identity = dict(category=category, scope="热销商品榜", ranking_dimension="SKU", sku_code=sku)
            row = MarketRankingEntry.objects.create(
                natural_key=f"{category}|{sku}", **identity, period_start="2026-10-01", period_end="2026-10-31",
                source_row_number=number + 1, last_import_batch_id=batch, rank=number + 1)
            MarketMasterIdentity.objects.update_or_create(**identity, defaults={"latest_entry_id": row.id})
            MarketPriceSnapshot.objects.create(
                id=f"snapshot|{category}|{sku}", **identity, month="2026-10", image_content_sha256=f"{number + 1:064x}",
                image_url=f"https://synthetic.invalid/{category}/{sku}")

    def finish_image_job(self, batch="batch-1", *, completed_at=None):
        return MarketImageCacheJob.objects.create(
            id="image-job-" + batch, scope_key="batch:" + batch, batch_id=batch, status="completed",
            completed_at=completed_at or timezone.now())

    def enable(self, category=CATEGORY, model="vision-a", principal=ADMIN):
        return _set_auto_annotation({"category": category, "enabled": True, "modelId": model}, principal)

    def jobs(self, category=CATEGORY):
        return MarketAnnotationJob.objects.filter(category=category)

    def ensure(self):
        return _ensure_auto_annotation({"action": "ensure_auto_annotation"}, RUNNER)


class StartCategoryRecognitionTests(AutoRecognitionFixtures, TestCase):
    def test_creates_job_on_active_prompt_and_starts_cloud_run(self):
        self.seed_category()
        result = _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        self.assertTrue(result["started"])
        self.assertEqual(result["totalCount"], 2)
        job = MarketAnnotationJob.objects.get(id=result["jobId"])
        self.assertEqual((job.executor, job.model_id, job.created_by, job.prompt_version_id), ("cloud", "vision-a", ADMIN.email, "prompt-" + CATEGORY))
        run = MarketAnnotationCloudRun.objects.get(job_id=job.id)
        self.assertEqual(run.state, "running")
        self.assertEqual(MarketAnnotationItem.objects.filter(job_id=job.id).count(), 2)

    def test_command_is_routed_and_repeating_it_reuses_the_job(self):
        self.seed_category()
        first = execute_annotation_command({"action": "start_category_recognition", "category": CATEGORY, "modelId": "vision-a"}, PRINCIPAL)
        second = execute_annotation_command({"action": "start_category_recognition", "category": CATEGORY, "modelId": "vision-a"}, PRINCIPAL)
        self.assertFalse(first["reused"])
        self.assertTrue(second["reused"])
        self.assertEqual(first["jobId"], second["jobId"])
        self.assertEqual(self.jobs().count(), 1)

    def test_different_model_while_unfinished_job_exists_is_rejected_without_new_job(self):
        self.seed_category()
        _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        with self.assertRaises(MarketApiError) as raised:
            _start_category_recognition({"category": CATEGORY, "modelId": "vision-b"}, ADMIN)
        self.assertEqual((raised.exception.status, raised.exception.code), (409, "version_conflict"))
        self.assertEqual(self.jobs().count(), 1)
        self.assertEqual(self.jobs().filter(model_id="vision-b").count(), 0)

    def test_finished_job_on_another_model_does_not_block(self):
        self.seed_category()
        first = _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        MarketAnnotationItem.objects.filter(job_id=first["jobId"]).update(status="review_pending")
        second = _start_category_recognition({"category": CATEGORY, "modelId": "vision-b"}, ADMIN)
        self.assertNotEqual(first["jobId"], second["jobId"])

    def test_category_without_active_prompt_is_rejected(self):
        self.seed_category(prompt=False)
        with self.assertRaises(MarketApiError) as raised:
            _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(self.jobs().count(), 0)

    def test_model_id_is_required(self):
        self.seed_category()
        with self.assertRaises(MarketApiError):
            _start_category_recognition({"category": CATEGORY, "modelId": "  "}, ADMIN)

    def test_nothing_to_recognize_creates_settled_job_that_is_not_started(self):
        self.seed_category(skus=0)
        result = _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        self.assertFalse(result["started"])
        self.assertEqual(result["totalCount"], 0)


class PerModelBudgetTests(QueueFixtures, TestCase):
    def test_jobs_sharing_a_model_split_one_budget_fairly(self):
        first = self.job("budget-a", model="shared", concurrency=12)
        second = self.job("budget-b", model="shared", concurrency=12)
        for job in (first, second):
            for number in range(30):
                self.item(job, f"{job.id}-{number}")
        offered = {row["jobId"]: row["availableSlots"] for row in _dispatch({})["jobs"]}
        self.assertEqual(offered, {first.id: 6, second.id: 6})

    def test_budget_is_the_largest_configured_concurrency_among_the_jobs(self):
        first = self.job("budget-small", model="shared", concurrency=4)
        second = self.job("budget-large", model="shared", concurrency=10)
        for job in (first, second):
            for number in range(30):
                self.item(job, f"{job.id}-{number}")
        rows = _dispatch({})["jobs"]
        self.assertEqual(sum(row["availableSlots"] for row in rows), 10)
        self.assertTrue(all(row["modelBudget"] == 10 for row in rows))
        by_job = {row["jobId"]: row["availableSlots"] for row in rows}
        self.assertEqual(by_job[first.id], 4)
        self.assertEqual(by_job[second.id], 6)

    def test_active_claims_of_another_job_on_the_model_count_against_the_budget(self):
        first = self.job("claims-a", model="shared", concurrency=6)
        second = self.job("claims-b", model="shared", concurrency=6)
        for job in (first, second):
            for number in range(20):
                self.item(job, f"{job.id}-{number}")
        for _ in range(4):
            self.assertIsNotNone(_claim_job_item({"jobId": first.id}, PRINCIPAL)["task"])
        rows = {row["jobId"]: row for row in _dispatch({})["jobs"]}
        # Budget 6, 4 already in flight: only 2 more slots exist, shared one each by the two jobs.
        self.assertEqual({job_id: row["availableSlots"] for job_id, row in rows.items()}, {first.id: 1, second.id: 1})
        self.assertEqual({row["modelInFlight"] for row in rows.values()}, {4})

    def test_jobs_on_different_models_do_not_share_a_budget(self):
        first = self.job("model-a", model="vision-a", concurrency=5)
        second = self.job("model-b", model="vision-b", concurrency=5)
        for job in (first, second):
            for number in range(20):
                self.item(job, f"{job.id}-{number}")
        offered = {row["jobId"]: row["availableSlots"] for row in _dispatch({})["jobs"]}
        self.assertEqual(offered, {first.id: 5, second.id: 5})

    def test_a_single_job_keeps_its_own_configured_concurrency(self):
        job = self.job("solo", model="solo-model", concurrency=7)
        for number in range(20):
            self.item(job, f"solo-{number}")
        self.assertEqual([row["availableSlots"] for row in _dispatch({})["jobs"]], [7])


class UnknownResultThresholdTests(QueueFixtures, TestCase):
    def expire(self, ids):
        MarketAnnotationItem.objects.filter(id__in=ids).update(lease_expires_at=timezone.now() - timedelta(seconds=1))

    def test_threshold_is_three(self):
        self.assertEqual(UNKNOWN_EXPIRATION_PAUSE_THRESHOLD, 3)
        retry = retry_snapshot({}, 10)
        self.assertFalse(record_unknown_expirations(retry, 1))
        self.assertFalse(record_unknown_expirations(retry, 1))
        self.assertTrue(record_unknown_expirations(retry, 1))

    def test_success_resets_the_counter_and_it_is_sanitized(self):
        retry = retry_snapshot({}, 10)
        record_unknown_expirations(retry, 2)
        record_success(retry)
        self.assertEqual(retry["unknownExpiredCount"], 0)
        self.assertEqual(retry_snapshot({"unknownExpiredCount": "evil"}, 10)["unknownExpiredCount"], 0)
        self.assertEqual(retry_snapshot({"unknownExpiredCount": 10 ** 9}, 10)["unknownExpiredCount"], 1000)
        self.assertEqual(retry_snapshot({"unknownExpiredCount": -4}, 10)["unknownExpiredCount"], 0)

    def test_explicit_unknown_failure_follows_the_same_streak_rule(self):
        retry = retry_snapshot({}, 10)
        self.assertFalse(record_failure(retry, "inference_result_unknown", 0, 1))
        self.assertFalse(record_failure(retry, "inference_result_unknown", 0, 1))
        self.assertTrue(record_failure(retry, "inference_result_unknown", 0, 1))

    def test_first_and_second_expiry_continue_the_third_pauses(self):
        job = self.job("threshold", concurrency=8)
        for number in range(6):
            self.item(job, f"item-{number}")
        tasks = [_claim_job_item({"jobId": job.id}, PRINCIPAL)["task"] for _ in range(3)]
        for index, task in enumerate(tasks[:2]):
            self.expire([task["itemId"]])
            self.assertIsNotNone(_claim_job_item({"jobId": job.id}, PRINCIPAL)["task"])
            run = MarketAnnotationCloudRun.objects.get(job_id=job.id)
            self.assertEqual((run.state, run.retry_state_json["unknownExpiredCount"]), ("running", index + 1))
        self.expire([tasks[2]["itemId"]])
        self.assertIsNone(_claim_job_item({"jobId": job.id}, PRINCIPAL)["task"])
        run = MarketAnnotationCloudRun.objects.get(job_id=job.id)
        self.assertEqual((run.state, run.last_failure_code), ("paused", "inference_result_unknown"))
        quarantined = MarketAnnotationItem.objects.filter(id__in=[task["itemId"] for task in tasks])
        self.assertEqual(set(quarantined.values_list("status", "attempt_count")), {("failed", 3)})

    def test_a_success_between_expiries_resets_the_streak(self):
        job = self.job("streak", concurrency=8)
        for number in range(10):
            self.item(job, f"item-{number}")
        tasks = [_claim_job_item({"jobId": job.id}, PRINCIPAL)["task"] for _ in range(4)]
        self.expire([tasks[0]["itemId"], tasks[1]["itemId"]])
        survivor = _claim_job_item({"jobId": job.id}, PRINCIPAL)["task"]
        self.assertIsNotNone(survivor)
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=job.id).retry_state_json["unknownExpiredCount"], 2)
        self.complete(tasks[2])
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=job.id).retry_state_json["unknownExpiredCount"], 0)
        self.expire([tasks[3]["itemId"]])
        self.assertIsNotNone(_claim_job_item({"jobId": job.id}, PRINCIPAL)["task"])
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=job.id).state, "running")

    def test_explicit_resume_resets_the_counter(self):
        job = self.job("resume-counter", concurrency=8)
        for number in range(8):
            self.item(job, f"item-{number}")
        tasks = [_claim_job_item({"jobId": job.id}, PRINCIPAL)["task"] for _ in range(3)]
        self.expire([task["itemId"] for task in tasks])
        self.assertIsNone(_claim_job_item({"jobId": job.id}, PRINCIPAL)["task"])
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=job.id).state, "paused")
        _set_cloud_run({"jobId": job.id, "state": "running"}, PRINCIPAL)
        run = MarketAnnotationCloudRun.objects.get(job_id=job.id)
        self.assertEqual((run.state, run.retry_state_json["unknownExpiredCount"]), ("running", 0))


class SetAutoAnnotationTests(AutoRecognitionFixtures, TestCase):
    def test_enable_stores_a_rule_audits_and_exposes_it_in_the_workspace(self):
        self.seed_category()
        result = self.enable()
        self.assertEqual((result["enabled"], result["modelId"], result["updatedBy"]), (True, "vision-a", ADMIN.email))
        rule = MarketMasterMappingRule.objects.get(kind=AUTO_ANNOTATION_RULE_KIND)
        self.assertEqual((rule.category, rule.source_value, rule.target_value, rule.status, rule.created_by),
                         (CATEGORY, "cloud", "vision-a", "published", ADMIN.email))
        self.assertEqual(MarketMasterAuditLog.objects.filter(action="set_market_auto_annotation").count(), 1)
        workspace = execute_annotation_query({"operation": "annotations", "view": "workspace_fast", "params": {}}, PRINCIPAL)
        self.assertEqual(workspace["autoAnnotation"], [
            {"category": CATEGORY, "enabled": True, "modelId": "vision-a", "updatedBy": ADMIN.email, "updatedAt": result["updatedAt"]}])

    def test_disable_keeps_the_row_and_reenable_updates_owner_and_model(self):
        self.seed_category()
        self.enable()
        disabled = _set_auto_annotation({"category": CATEGORY, "enabled": False}, ADMIN)
        self.assertFalse(disabled["enabled"])
        self.assertEqual(MarketMasterMappingRule.objects.filter(kind=AUTO_ANNOTATION_RULE_KIND).count(), 1)
        other = Principal("other-admin@example.test", "Other", "admin", None)
        self.enable(model="vision-b", principal=other)
        rule = MarketMasterMappingRule.objects.get(kind=AUTO_ANNOTATION_RULE_KIND)
        self.assertEqual((rule.status, rule.target_value, rule.created_by, rule.version), ("published", "vision-b", other.email, 3))

    def test_validation(self):
        self.seed_category()
        for payload in (
            {"category": CATEGORY, "enabled": True, "modelId": ""},
            {"category": CATEGORY, "enabled": "yes", "modelId": "vision-a"},
            {"category": "", "enabled": True, "modelId": "vision-a"},
        ):
            with self.assertRaises(MarketApiError):
                _set_auto_annotation(payload, ADMIN)
        with self.assertRaises(MarketApiError) as raised:
            _set_auto_annotation({"category": "不存在的类目", "enabled": True, "modelId": "vision-a"}, ADMIN)
        self.assertEqual(raised.exception.status, 404)
        self.assertEqual(MarketMasterMappingRule.objects.count(), 0)

    def test_disabling_a_category_that_was_never_enabled_writes_nothing(self):
        self.seed_category()
        _set_auto_annotation({"category": CATEGORY, "enabled": False}, ADMIN)
        self.assertEqual(MarketMasterMappingRule.objects.count(), 0)

    def test_set_auto_annotation_is_admin_only_at_the_http_boundary(self):
        from market.views import ADMIN_ANNOTATION_ACTIONS
        self.assertIn("set_auto_annotation", ADMIN_ANNOTATION_ACTIONS)
        self.assertNotIn("ensure_auto_annotation", ADMIN_ANNOTATION_ACTIONS)


class MappingRuleExclusionTests(AutoRecognitionFixtures, TestCase):
    def test_auto_rule_is_hidden_from_listing_and_cannot_be_edited_or_applied(self):
        self.seed_category()
        self.enable()
        MarketMasterMappingRule.objects.create(
            id="brand-rule", kind="brand_alias", category=CATEGORY, source_value="旧牌", target_value="新牌", status="published")
        self.assertEqual([item["kind"] for item in _mapping_items()], ["brand_alias"])
        rule = MarketMasterMappingRule.objects.get(kind=AUTO_ANNOTATION_RULE_KIND)
        with self.assertRaises(MarketApiError) as raised:
            _upsert_mapping({"id": rule.id, "kind": "brand_alias", "sourceValue": "x", "targetValue": "y", "status": "published"}, ADMIN)
        self.assertEqual(raised.exception.status, 409)
        rule.refresh_from_db()
        self.assertEqual((rule.kind, rule.target_value), (AUTO_ANNOTATION_RULE_KIND, "vision-a"))
        MarketRankingEntry.objects.filter(category=CATEGORY).update(brand="旧牌", subcategory="vision-a")
        self.assertEqual(_apply_mappings({}, ADMIN)["changed"], MarketRankingEntry.objects.filter(category=CATEGORY).count())
        self.assertFalse(MarketRankingEntry.objects.filter(category=CATEGORY, subcategory="cloud").exists())

    def test_auto_kind_is_not_a_creatable_mapping_kind(self):
        with self.assertRaises(MarketApiError):
            _upsert_mapping({"kind": AUTO_ANNOTATION_RULE_KIND, "sourceValue": "cloud", "targetValue": "m", "status": "published"}, ADMIN)

    def test_every_other_reader_of_mapping_rules_is_known(self):
        import pathlib
        root = pathlib.Path(__file__).resolve().parents[1]
        readers = sorted(path.name for path in root.glob("*.py")
                         if "MarketMasterMappingRule.objects" in path.read_text(encoding="utf-8"))
        self.assertEqual(readers, ["admin.py", "annotations.py"])


class EnsureAutoAnnotationTests(AutoRecognitionFixtures, TestCase):
    def test_import_then_finished_image_cache_creates_and_starts_one_job_owned_by_the_rule_admin(self):
        self.seed_category()
        self.enable()
        self.finish_image_job()
        summary = self.ensure()
        self.assertEqual(len(summary["created"]), 1)
        self.assertEqual(summary["errors"], [])
        job = self.jobs().get()
        self.assertEqual((job.model_id, job.created_by, job.total_count), ("vision-a", ADMIN.email, 2))
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=job.id).state, "running")
        self.assertEqual(MarketMasterAuditLog.objects.filter(action="ensure_market_auto_annotation").count(), 1)

    def test_no_trigger_without_rule_or_while_rule_is_disabled(self):
        self.seed_category()
        self.finish_image_job()
        self.assertEqual(self.ensure()["created"], [])
        self.enable()
        _set_auto_annotation({"category": CATEGORY, "enabled": False}, ADMIN)
        self.assertEqual(self.ensure()["created"], [])
        self.assertEqual(self.jobs().count(), 0)

    def test_no_trigger_before_image_cache_completes(self):
        self.seed_category()
        self.enable()
        MarketImageCacheJob.objects.create(id="running", scope_key="batch:batch-1", batch_id="batch-1", status="queued")
        self.assertEqual(self.ensure()["created"], [])
        self.assertEqual(self.jobs().count(), 0)

    def test_no_trigger_for_an_image_job_of_a_batch_that_never_touched_the_category(self):
        self.seed_category()
        self.enable()
        self.finish_image_job("unrelated-batch")
        self.assertEqual(self.ensure()["created"], [])

    def test_no_trigger_when_the_image_job_finished_before_the_latest_annotation_job(self):
        self.seed_category()
        self.enable()
        self.finish_image_job(completed_at=timezone.now() - timedelta(hours=2))
        MarketAnnotationJob.objects.create(
            id="old-job", category=CATEGORY, prompt_version_id="prompt-" + CATEGORY, executor="cloud", model_id="vision-a",
            status="review_ready", created_by=ADMIN.email)
        self.assertEqual(self.ensure()["created"], [])
        self.assertEqual(self.jobs().count(), 1)

    def test_a_later_import_triggers_again_once_the_previous_job_is_finished(self):
        self.seed_category()
        self.enable()
        self.finish_image_job()
        first = self.ensure()["created"][0]["jobId"]
        MarketAnnotationItem.objects.filter(job_id=first).update(status="review_pending")
        self.assertEqual(self.ensure()["created"], [])
        self.seed_category_batch("batch-2")
        self.finish_image_job("batch-2", completed_at=timezone.now() + timedelta(minutes=1))
        second = self.ensure()
        self.assertEqual(len(second["created"]), 1)
        self.assertNotEqual(second["created"][0]["jobId"], first)

    def seed_category_batch(self, batch):
        MarketRankingEntry.objects.filter(category=CATEGORY).update(last_import_batch_id=batch)

    def test_second_call_does_not_create_another_job_while_one_is_active(self):
        self.seed_category()
        self.enable()
        self.finish_image_job()
        self.ensure()
        self.assertEqual(self.ensure()["created"], [])
        self.assertEqual(self.jobs().count(), 1)

    def test_at_most_one_job_is_created_per_call(self):
        other = "自动识别类目二"
        for category, batch in ((CATEGORY, "batch-1"), (other, "batch-2")):
            self.seed_category(category, batch=batch)
            self.enable(category)
            self.finish_image_job(batch)
        first = self.ensure()
        self.assertEqual(len(first["created"]), 1)
        second = self.ensure()
        self.assertEqual(len(second["created"]), 1)
        self.assertEqual({first["created"][0]["category"], second["created"][0]["category"]}, {CATEGORY, other})
        self.assertEqual(self.ensure()["created"], [])

    def test_unfinished_job_on_another_model_blocks_creation_without_error_noise(self):
        self.seed_category()
        self.enable(model="vision-b")
        first = _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        self.finish_image_job(completed_at=timezone.now() + timedelta(minutes=1))
        summary = self.ensure()
        self.assertEqual(summary["created"], [])
        self.assertEqual(self.jobs().get().id, first["jobId"])

    def test_resumes_a_job_paused_for_a_recoverable_reason_after_the_cooldown(self):
        self.seed_category()
        self.enable()
        started = _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        MarketAnnotationCloudRun.objects.filter(job_id=started["jobId"]).update(
            state="paused", last_failure_code="inference_result_unknown", last_failure_message="x")
        MarketAnnotationCloudRun.objects.filter(job_id=started["jobId"]).update(updated_at=timezone.now() - timedelta(hours=1))
        summary = self.ensure()
        self.assertEqual(summary["resumed"], [started["jobId"]])
        self.assertEqual(summary["created"], [])
        run = MarketAnnotationCloudRun.objects.get(job_id=started["jobId"])
        self.assertEqual((run.state, run.last_failure_code), ("running", ""))

    def test_does_not_resume_permanent_manual_fresh_or_exhausted_pauses(self):
        self.seed_category(skus=4)
        self.enable()
        started = _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        job_id = started["jobId"]
        old = timezone.now() - timedelta(hours=1)

        def pause(**fields):
            MarketAnnotationCloudRun.objects.filter(job_id=job_id).update(state="paused", **fields)
            MarketAnnotationCloudRun.objects.filter(job_id=job_id).update(updated_at=fields.pop("updated_at", old))

        for code in ("model_configuration", "authorization_revoked"):
            pause(last_failure_code=code)
            self.assertEqual(self.ensure()["resumed"], [], code)
        pause(last_failure_code="")
        self.assertEqual(self.ensure()["resumed"], [], "a pause without a reason is never lifted")
        pause(last_failure_code="inference_result_unknown", retry_state_json={"manualPause": True})
        self.assertEqual(self.ensure()["resumed"], [], "manual pause")
        MarketAnnotationCloudRun.objects.filter(job_id=job_id).update(state="paused", last_failure_code="inference_result_unknown",
                                                                      retry_state_json={}, updated_at=timezone.now())
        self.assertEqual(self.ensure()["resumed"], [], "inside the cooldown")
        MarketAnnotationItem.objects.filter(job_id=job_id).update(status="failed", attempt_count=3)
        MarketAnnotationCloudRun.objects.filter(job_id=job_id).update(updated_at=old)
        self.assertEqual(self.ensure()["resumed"], [], "nothing left to retry")

    def test_a_human_pause_through_the_control_command_is_remembered(self):
        self.seed_category()
        self.enable()
        started = _start_category_recognition({"category": CATEGORY, "modelId": "vision-a"}, ADMIN)
        _set_cloud_run({"jobId": started["jobId"], "state": "paused"}, ADMIN)
        MarketAnnotationCloudRun.objects.filter(job_id=started["jobId"]).update(
            last_failure_code="inference_result_unknown", updated_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(self.ensure()["resumed"], [])
        _set_cloud_run({"jobId": started["jobId"], "state": "running"}, ADMIN)
        self.assertNotIn("manualPause", MarketAnnotationCloudRun.objects.get(job_id=started["jobId"]).retry_state_json)

    def test_only_the_internal_runner_may_call_it_and_no_parameters_are_accepted(self):
        with self.assertRaises(MarketApiError) as raised:
            _ensure_auto_annotation({"action": "ensure_auto_annotation"}, ADMIN)
        self.assertEqual(raised.exception.status, 403)
        with self.assertRaises(MarketApiError):
            _ensure_auto_annotation({"action": "ensure_auto_annotation", "category": CATEGORY}, RUNNER)
        self.assertEqual(execute_annotation_command({"action": "ensure_auto_annotation"}, RUNNER)["rules"], 0)

    def test_nothing_to_do_is_cheap_and_writes_nothing(self):
        self.seed_category()
        self.enable()
        audits = MarketMasterAuditLog.objects.count()
        self.assertEqual(self.ensure(), {"rules": 1, "resumed": [], "created": [], "errors": []})
        self.assertEqual(MarketMasterAuditLog.objects.count(), audits)
        due = execute_annotation_query({"operation": "annotations", "view": "auto_annotation_due", "params": {}}, RUNNER)
        self.assertEqual(due, {"due": False, "rules": 1, "resumeCount": 0, "createCount": 0})

    def test_due_check_reports_pending_work_without_writing(self):
        self.seed_category()
        self.enable()
        self.finish_image_job()
        before = (self.jobs().count(), MarketMasterAuditLog.objects.count())
        due = execute_annotation_query({"operation": "annotations", "view": "auto_annotation_due", "params": {}}, RUNNER)
        self.assertEqual(due, {"due": True, "rules": 1, "resumeCount": 0, "createCount": 1})
        self.assertEqual((self.jobs().count(), MarketMasterAuditLog.objects.count()), before)

    def test_job_is_dispatchable_with_the_rule_owner_after_creation(self):
        self.seed_category()
        self.enable()
        self.finish_image_job()
        self.ensure()
        rows = _dispatch({})["jobs"]
        self.assertEqual([(row["category"], row["ownerEmail"], row["modelId"]) for row in rows], [(CATEGORY, ADMIN.email, "vision-a")])

    def test_empty_category_leaves_an_archived_marker_so_the_scan_is_not_repeated(self):
        # Rows exist for the batch, but none has a cached image yet, so there is nothing to recognize.
        self.seed_category(skus=2)
        MarketPriceSnapshot.objects.filter(category=CATEGORY).update(image_content_sha256="")
        self.enable()
        self.finish_image_job()
        first = self.ensure()
        self.assertEqual([(row["totalCount"], row["started"]) for row in first["created"]], [(0, False)])
        self.assertEqual(self.jobs().get().status, "deleted")
        self.assertEqual(self.ensure()["created"], [])
        self.assertEqual(MarketAnnotationConcurrencySetting.objects.count(), 0)
