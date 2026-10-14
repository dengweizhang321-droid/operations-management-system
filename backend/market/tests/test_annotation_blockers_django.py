"""Targeted blocker regressions; all data and PostgreSQL tuning are disposable."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
from threading import Barrier, Event
import time
from unittest import skipUnless
from unittest.mock import patch

from django.db import close_old_connections, connection, connections, transaction
from django.db.models import Exists, OuterRef
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from market import annotations
from market.annotations import _claim_candidates, _dispatch_lease, _locked_job, _set_cloud_run
from market.models import MarketAnnotationItem, MarketAnnotationCloudRun, MarketAnnotationPromptVersion, MarketMasterAuditLog
from market.tests.test_annotation_queue import PRINCIPAL, QueueFixtures, RESULT


TIMING = {"imageLoadMs": 11, "imagePrepareMs": 12, "modelCallMs": 13, "totalMs": 40, "inputBytes": 4096}


def evidence(name, value):
    target = os.environ.get("MARKET_BLOCKERS_A_EVIDENCE")
    if target:
        directory = Path(target).resolve()
        if not directory.is_relative_to(Path("D:/codex-artifacts")):
            raise RuntimeError("Evidence must stay outside Git")
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (name + ".json")).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


class AnnotationBlockerTests(QueueFixtures, TestCase):
    def test_configuration_failure_preserves_prior_failure_budget_and_timing(self):
        job = self.job("config")
        self.item(job, "one", attempt_count=2)
        task = self.claim(job)["task"]
        self.complete(task, error="OpenCode missing x-opencode-session; Bearer private-key https://private.invalid?a=secret", failureCode="model_configuration",
                      failureKind="permanent", timing=TIMING)
        item = MarketAnnotationItem.objects.get(pk="one")
        self.assertEqual(item.attempt_count, 2)
        self.assertEqual((item.image_load_ms, item.image_prepare_ms, item.model_call_ms, item.total_inference_ms, item.model_input_bytes),
                         (11, 12, 13, 40, 4096))
        run = MarketAnnotationCloudRun.objects.get(job_id=job.id)
        self.assertEqual((run.state, run.last_failure_code), ("paused", "model_configuration"))
        audit = MarketMasterAuditLog.objects.get(entity_type="market_annotation_execution_failure")
        self.assertEqual(audit.after_json["timing"], TIMING)
        self.assertEqual(audit.after_json["failureCode"], "model_configuration")
        self.assertEqual(audit.after_json["failureKind"], "permanent")
        self.assertIn("x-opencode-session", audit.after_json["error"])
        self.assertEqual(audit.after_json["attemptCount"], 3)
        self.assertEqual(len(audit.after_json["attemptId"]), 64)
        self.assertNotIn("private", json.dumps(audit.after_json))
        self.assertIsNone(self.claim(job)["task"])

    def test_result_unknown_is_quarantined_and_never_automatically_replayed(self):
        job = self.job("explicit-unknown", concurrency=2)
        self.item(job, "one", sku="same", attempt_count=2)
        self.item(job, "sibling", sku="same", month="2026-08", attempt_count=2)
        self.item(job, "untouched", attempt_count=1)
        task = self.claim(job)["task"]
        self.complete(task, error="POST ended with unknown result", failureCode="inference_result_unknown", timing=TIMING)
        self.assertEqual(set(MarketAnnotationItem.objects.filter(sku_code="same").values_list("status", "attempt_count")), {("failed", 3)})
        run = MarketAnnotationCloudRun.objects.get(job_id=job.id)
        self.assertEqual((run.state, run.last_failure_code), ("paused", "inference_result_unknown"))
        self.assertIsNone(self.claim(job)["task"])
        _set_cloud_run({"jobId": job.id, "state": "running"}, PRINCIPAL)
        self.assertEqual(self.claim(job)["task"]["itemId"], "untouched")

    def test_configuration_pauses_same_model_plans_without_touching_existing_results_or_budgets(self):
        failed = self.job("blocked-model", model="shared", concurrency=12)
        same = self.job("same-model", model="shared", concurrency=12)
        other = self.job("other-model", model="unaffected", concurrency=12)
        self.item(failed, "bad", attempt_count=2)
        self.item(same, "inflight", attempt_count=1)
        self.item(same, "waiting", attempt_count=2)
        self.item(other, "ready", attempt_count=1)
        same_task = self.claim(same)["task"]
        failure_task = self.claim(failed)["task"]
        before = MarketAnnotationItem.objects.filter(job_id=same.id).values("id", "status", "attempt_count", "lease_token_hash")
        before = list(before.order_by("id"))
        self.complete(failure_task, error="HTTP 400 x-opencode-session", failureCode="model_configuration", failureKind="permanent")
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=same.id).state, "paused")
        self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=other.id).state, "running")
        self.assertIsNone(self.claim(same)["task"])
        self.assertEqual(before, list(MarketAnnotationItem.objects.filter(job_id=same.id).values(
            "id", "status", "attempt_count", "lease_token_hash").order_by("id")))
        self.assertEqual(MarketAnnotationItem.objects.get(pk="bad").attempt_count, 2)
        self.assertIsNotNone(self.claim(other)["task"])
        self.complete(same_task)
        self.assertEqual(MarketAnnotationItem.objects.get(pk=same_task["itemId"]).status, "review_pending")
        self.assertEqual(MarketAnnotationItem.objects.get(pk="waiting").attempt_count, 2)

    def test_authorization_pause_remains_scoped_to_affected_job(self):
        failed = self.job("auth-failed", model="shared")
        same = self.job("auth-unaffected", model="shared")
        self.item(failed,"one")
        self.item(same,"two")
        self.complete(self.claim(failed)["task"], error="account revoked", failureCode="authorization_revoked")
        self.assertIsNotNone(self.claim(same)["task"])

    def test_unknown_quarantine_never_lowers_historical_failure_count(self):
        job = self.job("expired-history")
        self.item(job, "old", status="claimed", lease_expires_at=timezone.now()-timedelta(seconds=1), attempt_count=7)
        self.assertIsNone(self.claim(job)["task"])
        self.assertEqual(MarketAnnotationItem.objects.get(pk="old").attempt_count, 7)

    def test_lock_wait_and_slow_selection_cannot_issue_expired_dispatch(self):
        job = self.job("clock")
        self.item(job, "one")
        lease = _dispatch_lease({"jobId": job.id}, release=False)
        late = timezone.now() + timedelta(seconds=120)
        original = annotations._claim_candidates
        def delayed(*args, **kwargs):
            selected = original(*args, **kwargs)
            # The actual task must check the dispatch deadline after selection.
            clock.return_value = late
            return selected
        with patch("market.annotations.timezone.now", return_value=timezone.now()) as clock, patch(
            "market.annotations._claim_candidates", side_effect=delayed,
        ):
            self.assertIsNone(self.claim(job, coordinatorToken=lease["coordinatorToken"])["task"])
        self.assertEqual(MarketAnnotationItem.objects.get(pk="one").attempt_count, 0)

    def test_lock_wait_renews_item_lease_at_actual_admission(self):
        job = self.job("after-wait")
        self.item(job, "one")
        original = annotations._locked_job
        late = timezone.now() + timedelta(seconds=100)
        def waited(*args, **kwargs):
            row = original(*args, **kwargs)
            clock.return_value = late
            return row
        with patch("market.annotations.timezone.now", return_value=timezone.now()) as clock, patch(
            "market.annotations._locked_job", side_effect=waited,
        ):
            self.assertIsNotNone(self.claim(job)["task"])
        self.assertEqual(MarketAnnotationItem.objects.get(pk="one").lease_expires_at, late + timedelta(minutes=3))

    def test_over_capacity_historical_active_rows_block_without_unbounded_or(self):
        job = self.job("over-capacity", concurrency=12)
        for n in range(55):
            self.item(job, f"active-{n}", status="claimed", lease_agent_id=f"cloud:{n}", lease_expires_at=timezone.now()+timedelta(minutes=2))
        self.item(job, "next")
        self.assertIsNone(self.claim(job)["task"])
        prompt = MarketAnnotationPromptVersion.objects.get(pk=job.prompt_version_id)
        self.assertIsNone(_claim_candidates(job.id, prompt, timezone.now(), capacity=12).first())
        self.assertEqual(MarketAnnotationItem.objects.get(pk="next").attempt_count, 0)

    def test_stalled_final_write_rolls_back_claim_instead_of_issuing_short_budget(self):
        job = self.job("late-admission")
        self.item(job, "one")
        now = timezone.now()
        original = annotations._audit
        def delayed(*args, **kwargs):
            value = original(*args, **kwargs)
            if args[1] == "market_annotation_task_claimed":
                clock.return_value = now + timedelta(seconds=30)
            return value
        with patch("market.annotations.timezone.now", return_value=now) as clock, patch(
            "market.annotations._audit", side_effect=delayed,
        ), patch("market.annotations.annotation_activity.release") as released:
            with self.assertRaises(annotations.MarketApiError):
                self.claim(job)
        item = MarketAnnotationItem.objects.get(pk="one")
        self.assertEqual((item.status, item.attempt_count, item.lease_token_hash), ("queued", 0, ""))
        self.assertEqual(MarketMasterAuditLog.objects.filter(entity_type="market_annotation_dispatch").count(), 0)
        released.assert_called_once()

    def test_write_failure_rolls_back_result_and_replays_same_original_result(self):
        job = self.job("write-fail")
        self.item(job, "one")
        task = self.claim(job)["task"]
        with patch("market.annotations._audit", side_effect=RuntimeError("isolated storage failure")):
            with self.assertRaises(RuntimeError):
                self.complete(task, result={**RESULT, "timing": TIMING})
        item = MarketAnnotationItem.objects.get(pk="one")
        self.assertEqual((item.status, item.attempt_count), ("claimed", 1))
        self.assertEqual(item.lease_token_hash, hashlib.sha256(task["leaseToken"].encode()).hexdigest())
        self.complete(task, result={**RESULT, "timing": TIMING})
        self.assertTrue(self.complete(task)["duplicate"])
        self.assertEqual(MarketMasterAuditLog.objects.filter(entity_type="market_annotation_execution").count(), 1)
        self.assertEqual(MarketAnnotationItem.objects.get(pk="one").attempt_count, 1)

    def test_success_does_not_take_shared_model_lock_but_failure_does(self):
        job = self.job("model-lock")
        self.item(job, "one")
        task = self.claim(job)["task"]
        with patch("market.annotations._lock_model", side_effect=AssertionError("success must not wait on model")):
            self.complete(task)
        job2 = self.job("failure-lock")
        self.item(job2, "two")
        task2 = self.claim(job2)["task"]
        with patch("market.annotations._lock_model", wraps=annotations._lock_model) as lock:
            self.complete(task2, error="429", failureCode="provider_rate_limit")
        self.assertEqual(lock.call_count, 1)


@skipUnless(connection.vendor == "postgresql", "Real PG plans and contention required")
class AnnotationBlockerPostgresTests(QueueFixtures, TransactionTestCase):
    available_apps = ["market"]

    def test_stale_and_fresh_statistics_and_actual_8558_row_claim(self):
        from market.annotations import _recognition_items, _retryable_items, _mode_expression
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE market_annotation_items SET (autovacuum_enabled=false)")
        try:
            old = [MarketAnnotationItem(id=f"history-{j}-{n}", job_id=f"history-job-{j}", category="synthetic",
                scope="test", sku_code=f"old-{n}", month="2026-10", image_content_sha256="a"*64)
                for j in range(54) for n in range(500)]
            MarketAnnotationItem.objects.bulk_create(old, batch_size=500)
            with connection.cursor() as cursor:
                cursor.execute("ANALYZE market_annotation_items")
            job = self.job("new-skewed-job", concurrency=12)
            now = timezone.now()
            rows = [MarketAnnotationItem(id=f"current-{n:05}", job_id=job.id, category=job.category, scope="test",
                sku_code=f"new-{n}", month="2026-10", image_content_sha256="b"*64,
                reviewed_segment="测试细分" if n<8109 else "", status="claimed" if n<3 else "queued",
                lease_agent_id=f"cloud:{n}" if n<3 else "", lease_expires_at=now+timedelta(minutes=3) if n<3 else None)
                for n in range(8558)]
            MarketAnnotationItem.objects.bulk_create(rows, batch_size=500)
            prompt = MarketAnnotationPromptVersion.objects.get(pk=job.prompt_version_id)
            inflight = MarketAnnotationItem.objects.filter(**{f: OuterRef(f) for f in ("job_id", *annotations.INFERENCE_FIELDS)},
                status__in=["claimed", "inferencing"], lease_expires_at__gt=now)
            original = _recognition_items(MarketAnnotationItem.objects.filter(job_id=job.id)).filter(_retryable_items()).filter(
                ~Exists(inflight)).annotate(queue_mode=_mode_expression(prompt.segments_json)).order_by("queue_mode", "updated_at", "id")[:1]
            repaired = _claim_candidates(job.id, prompt, now, capacity=12)[:1]
            report = {"historicalRows":27000,"newJobRows":8558,"activeClaims":3,"productionWrites":0,"externalModelCalls":0,
                      "sourceSha256":hashlib.sha256(Path(annotations.__file__).read_bytes()).hexdigest()}
            def measure(query):
                sql, params = query.query.sql_with_params()
                with connection.cursor() as cursor:
                    cursor.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params)
                    plan = cursor.fetchone()[0][0]
                    cursor.execute(sql, params)
                    selected = cursor.fetchone()[0]
                return {"selectedId":selected,"durationMs":plan["Execution Time"],"plan":plan}
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                    cursor.execute("SET LOCAL statement_timeout='45s'")
                report["oldQueryStaleStats"] = measure(original)
                report["fixedQueryStaleStats"] = measure(repaired)
            with connection.cursor() as cursor:
                cursor.execute("ANALYZE market_annotation_items")
            report["oldQueryAccurateStats"] = measure(original)
            report["fixedQueryAccurateStats"] = measure(_claim_candidates(job.id, prompt, now, capacity=12)[:1])
            selected = {report[key]["selectedId"] for key in ("oldQueryStaleStats", "fixedQueryStaleStats", "oldQueryAccurateStats", "fixedQueryAccurateStats")}
            self.assertEqual(len(selected), 1)
            self.assertLess(report["fixedQueryStaleStats"]["durationMs"], 1000)
            start = time.perf_counter()
            task = self.claim(job)["task"]
            report["actualClaimMs"] = round((time.perf_counter()-start)*1000,3)
            self.assertEqual(task["recognitionMode"], "full")
            report["actualClaimTaskMode"] = task["recognitionMode"]
            evidence("skewed-query-plan", report)
            print("BLOCKER_PLAN " + json.dumps({key:report[key]["durationMs"] for key in ("oldQueryStaleStats", "fixedQueryStaleStats", "oldQueryAccurateStats", "fixedQueryAccurateStats")}), flush=True)
        finally:
            with connection.cursor() as cursor:
                cursor.execute("ALTER TABLE market_annotation_items RESET (autovacuum_enabled)")

    def test_twelve_parallel_claims_and_completions_under_continuous_admission(self):
        job = self.job("twelve", concurrency=12)
        MarketAnnotationItem.objects.bulk_create([MarketAnnotationItem(id=f"mixed-{n:05}",job_id=job.id,
            category=job.category,sku_code=f"sku-{n}",month="2026-10",image_content_sha256="a"*64,
            reviewed_segment="测试细分" if n>=6 else "") for n in range(8558)], batch_size=500)
        barrier = Barrier(12)
        records = []
        def claim_one(n):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                start = time.perf_counter()
                result = self.claim(job)
                return result["task"], round((time.perf_counter()-start)*1000,3)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=12) as pool:
            initial = list(pool.map(claim_one, range(12)))
        tasks = [task for task, _ in initial]
        self.assertEqual(len({task["itemId"] for task in tasks}), 12)
        self.assertEqual([task["recognitionMode"] for task in tasks].count("full"), 6)
        self.assertIsNone(self.claim(job)["task"])
        barrier = Barrier(24)
        def contender(number):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                start = time.perf_counter()
                if number<12:
                    value = self.complete(tasks[number], result={**RESULT, "timing":TIMING})
                    kind = "complete"
                else:
                    value = self.claim(job)
                    kind = "claim"
                return {"kind":kind,"durationMs":round((time.perf_counter()-start)*1000,3),"value":value}
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=24) as pool:
            records = list(pool.map(contender, range(24)))
        self.assertEqual(MarketAnnotationItem.objects.filter(job_id=job.id,status="review_pending").count(),12)
        self.assertLessEqual(MarketAnnotationItem.objects.filter(job_id=job.id,status="claimed").count(),12)
        self.assertLess(max(row["durationMs"] for row in records if row["kind"]=="complete"),5000)
        evidence("concurrent-claims-completions", {"rows":8558,"configuredConcurrency":12,"initialClaimMs":[ms for _,ms in initial],
            "contenders":[{"kind":row["kind"],"durationMs":row["durationMs"],"status":"ok"} for row in records],
            "newCompleted":12,"activeAfter":MarketAnnotationItem.objects.filter(job_id=job.id,status="claimed").count(),
            "externalModelCalls":0,"productionWrites":0})

    def test_successful_write_is_not_blocked_by_another_jobs_model_lock(self):
        job = self.job("complete-independent")
        self.item(job,"one")
        task = self.claim(job)["task"]
        lock_held, release = Event(), Event()
        def holder():
            close_old_connections()
            try:
                with transaction.atomic():
                    annotations._lock_model(job)
                    lock_held.set()
                    if not release.wait(timeout=10):
                        raise RuntimeError("Isolated lock wait timed out")
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(holder)
            self.assertTrue(lock_held.wait(timeout=10))
            try:
                start = time.perf_counter()
                self.complete(task)
                self.assertLess(time.perf_counter()-start,2)
            finally:
                release.set()
                future.result(timeout=10)
