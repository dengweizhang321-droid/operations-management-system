"""B3: server-side filtered/paginated read projection over the automation
run tables.

Scope: query-layer behaviour only (automation_run_query.py). HTTP-layer
auth/param parsing is covered by test_automation_run_views.py. No action
endpoint exists; gate② predicates are only ever read here, never
re-derived — see automation_run_query.py's module docstring.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from django.test import TestCase

from netshop.models import NetshopImportBatch
from workflow.automation_models import AutomationAttempt, AutomationLogicalRun, AutomationModuleResult
from workflow.automation_run_query import (
    MAX_PAGE_SIZE,
    exception_summary,
    list_attempts,
    list_logical_runs,
    list_module_results,
    parse_run_list_options,
)
from workflow.errors import WorkflowApiError


CHAIN_KEY = "jd_promotion"
SUBJECT_KEY = "jd-yiyong-director"
MODULE_KEY = "jd_promotion.ad_product_daily"
DATASET = "ad"


def make_run(*, plan_date: date, chain_key: str = CHAIN_KEY, subject_key: str = SUBJECT_KEY, trigger_source: str = "schedule") -> AutomationLogicalRun:
    return AutomationLogicalRun.objects.create(
        chain_key=chain_key,
        subject_key=subject_key,
        plan_date=plan_date,
        business_range={"date": plan_date.isoformat()},
        trigger_source=trigger_source,
        plan_summary={"modules": [MODULE_KEY]},
    )


def make_result(run: AutomationLogicalRun, **overrides) -> AutomationModuleResult:
    fields = dict(
        logical_run=run,
        module_key=MODULE_KEY,
        subject_key=run.subject_key,
        dataset=DATASET,
        date_range=run.plan_date.isoformat(),
    )
    fields.update(overrides)
    return AutomationModuleResult.objects.create(**fields)


def default_options(**overrides):
    base = dict(
        subject_key=None, chain_key=None, plan_date_from=None, plan_date_to=None,
        execution_states=(), business_states=(), delivery_states=(), exception_category=None,
        page=1, page_size=50,
    )
    base.update(overrides)
    from workflow.automation_run_query import RunListOptions

    return RunListOptions(**base)


class ParseOptionsTests(TestCase):
    def test_page_size_above_hard_cap_is_rejected(self):
        with self.assertRaises(WorkflowApiError):
            parse_run_list_options({}, page=1, page_size=MAX_PAGE_SIZE + 1)

    def test_offset_beyond_max_offset_is_rejected(self):
        with self.assertRaises(WorkflowApiError):
            parse_run_list_options({}, page=100_000, page_size=MAX_PAGE_SIZE)

    def test_unknown_axis_value_is_rejected_not_silently_dropped(self):
        with self.assertRaises(WorkflowApiError):
            parse_run_list_options({"executionState": "not_a_real_state"}, page=1, page_size=10)

    def test_unknown_exception_category_is_rejected(self):
        with self.assertRaises(WorkflowApiError):
            parse_run_list_options({"exceptionCategory": "bogus"}, page=1, page_size=10)

    def test_plan_date_from_after_to_is_rejected(self):
        with self.assertRaises(WorkflowApiError):
            parse_run_list_options(
                {"planDateFrom": "2026-09-20", "planDateTo": "2026-09-10"}, page=1, page_size=10
            )

    def test_three_axes_parse_independently_not_merged(self):
        options = parse_run_list_options(
            {
                "executionState": "needs_human,failed",
                "businessState": "gap_remaining",
                "deliveryState": "failed,unknown",
            },
            page=1,
            page_size=10,
        )
        self.assertEqual(set(options.execution_states), {"needs_human", "failed"})
        self.assertEqual(set(options.business_states), {"gap_remaining"})
        self.assertEqual(set(options.delivery_states), {"failed", "unknown"})


class PaginationTests(TestCase):
    def setUp(self):
        for day in range(1, 6):
            make_run(plan_date=date(2026, 9, day))

    def test_total_returned_truncated_are_consistent_on_a_partial_page(self):
        result = list_logical_runs(default_options(page=1, page_size=2))
        self.assertEqual(result["pagination"]["total"], 5)
        self.assertEqual(result["pagination"]["returned"], 2)
        self.assertTrue(result["pagination"]["truncated"])
        self.assertEqual(result["pagination"]["completeness"], "truncated_do_not_infer_absence")

    def test_truncated_is_false_and_completeness_is_complete_on_full_page(self):
        result = list_logical_runs(default_options(page=1, page_size=50))
        self.assertEqual(result["pagination"]["total"], 5)
        self.assertEqual(result["pagination"]["returned"], 5)
        self.assertFalse(result["pagination"]["truncated"])
        self.assertEqual(result["pagination"]["completeness"], "complete")

    def test_hard_cap_rejects_a_too_large_page_size_rather_than_clamping(self):
        with self.assertRaises(WorkflowApiError):
            list_logical_runs(default_options(page_size=MAX_PAGE_SIZE + 1))


class FilterTests(TestCase):
    def setUp(self):
        self.run_a = make_run(plan_date=date(2026, 9, 10), subject_key="subject-a", chain_key="jd_promotion")
        self.run_b = make_run(plan_date=date(2026, 9, 11), subject_key="subject-b", chain_key="jd_customer_service")
        make_result(self.run_a, execution_state="finished", business_state="verified", delivery_state="sent")
        make_result(self.run_b, execution_state="needs_human", business_state="gap_remaining", delivery_state="failed")

    def test_subject_key_filters_independently(self):
        result = list_logical_runs(default_options(subject_key="subject-a"))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(self.run_a.logical_run_id)])

    def test_chain_key_filters_independently(self):
        result = list_logical_runs(default_options(chain_key="jd_customer_service"))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(self.run_b.logical_run_id)])

    def test_plan_date_range_filters_independently(self):
        result = list_logical_runs(default_options(plan_date_from=date(2026, 9, 11), plan_date_to=date(2026, 9, 11)))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(self.run_b.logical_run_id)])

    def test_execution_state_filter_does_not_require_business_or_delivery_filter(self):
        result = list_logical_runs(default_options(execution_states=("needs_human",)))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(self.run_b.logical_run_id)])

    def test_business_state_filter_is_independent_of_execution_state(self):
        result = list_logical_runs(default_options(business_states=("verified",)))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(self.run_a.logical_run_id)])

    def test_delivery_state_filter_is_independent_of_the_other_two_axes(self):
        result = list_logical_runs(default_options(delivery_states=("failed",)))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(self.run_b.logical_run_id)])

    def test_combining_two_axes_at_once_still_filters_each_independently(self):
        # execution=finished AND business=gap_remaining should match neither
        # run (run_a is finished/verified, run_b is needs_human/gap_remaining).
        result = list_logical_runs(default_options(execution_states=("finished",), business_states=("gap_remaining",)))
        self.assertEqual(result["items"], [])


class ExceptionCategoryTests(TestCase):
    def test_needs_human_category_matches_only_needs_human_results(self):
        run = make_run(plan_date=date(2026, 9, 12))
        make_result(run, execution_state="needs_human")
        other_run = make_run(plan_date=date(2026, 9, 13), subject_key="other")
        make_result(other_run, execution_state="finished")

        result = list_logical_runs(default_options(exception_category="needs_human"))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(run.logical_run_id)])

    def test_result_unknown_category_matches_only_result_unknown_results(self):
        run = make_run(plan_date=date(2026, 9, 14))
        make_result(run, execution_state="result_unknown")
        other_run = make_run(plan_date=date(2026, 9, 15), subject_key="other-2")
        make_result(other_run, execution_state="needs_human")

        result = list_logical_runs(default_options(exception_category="result_unknown"))
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(run.logical_run_id)])

    def test_stuck_category_matches_three_consecutive_blocked_attempts_same_stage(self):
        run = make_run(plan_date=date(2026, 9, 16))
        clean_run = make_run(plan_date=date(2026, 9, 17), subject_key="clean")
        now = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
        parent = None
        for index in range(3):
            parent = AutomationAttempt.objects.create(
                logical_run=run,
                native_workflow_id="JdPromotionDaily2026",
                native_execution_id=f"attempt-{index}",
                parent_attempt=parent,
                recovery_reason="hourly_safe_retry" if parent else "",
                stage="download",
                started_at=now,
                error_class="report_list_migration_overlay",  # never finished cleanly
            )
        AutomationAttempt.objects.create(
            logical_run=clean_run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="clean-1",
            stage="download",
            started_at=now,
            finished_at=now + timedelta(minutes=1),
        )
        result = list_logical_runs(default_options(exception_category="stuck"), now=now)
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(run.logical_run_id)])

    def test_stuck_category_matches_single_blocked_attempt_past_30_minutes(self):
        run = make_run(plan_date=date(2026, 9, 18))
        started = datetime(2026, 9, 18, 10, 0, tzinfo=timezone.utc)
        AutomationAttempt.objects.create(
            logical_run=run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="only-attempt",
            stage="download",
            started_at=started,
            error_class="timeout",
        )
        now_past_30_minutes = started + timedelta(minutes=31)
        result = list_logical_runs(default_options(exception_category="stuck"), now=now_past_30_minutes)
        self.assertEqual([item["logicalRunId"] for item in result["items"]], [str(run.logical_run_id)])

    def test_stuck_category_does_not_misfire_on_a_single_recent_blocked_attempt(self):
        run = make_run(plan_date=date(2026, 9, 19))
        started = datetime(2026, 9, 19, 10, 0, tzinfo=timezone.utc)
        AutomationAttempt.objects.create(
            logical_run=run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="only-attempt",
            stage="download",
            started_at=started,
            error_class="transient",
        )
        now_within_30_minutes = started + timedelta(minutes=5)
        result = list_logical_runs(default_options(exception_category="stuck"), now=now_within_30_minutes)
        self.assertEqual(result["items"], [])

    def test_exception_summary_reports_three_distinct_categories_with_counts(self):
        run_a = make_run(plan_date=date(2026, 9, 20), subject_key="a")
        make_result(run_a, execution_state="needs_human")
        run_b = make_run(plan_date=date(2026, 9, 21), subject_key="b")
        make_result(run_b, execution_state="result_unknown")
        run_c = make_run(plan_date=date(2026, 9, 22), subject_key="c")
        started = datetime(2026, 9, 22, 9, 0, tzinfo=timezone.utc)
        for index in range(3):
            AutomationAttempt.objects.create(
                logical_run=run_c,
                native_workflow_id="JdPromotionDaily2026",
                native_execution_id=f"c-{index}",
                stage="download",
                started_at=started,
                error_class="x",
            )
        now = started
        summary = exception_summary(default_options(), now=now)
        self.assertEqual(summary["needsHuman"]["count"], 1)
        self.assertEqual(summary["needsHuman"]["label"], "待人工")
        self.assertEqual(summary["resultUnknown"]["count"], 1)
        self.assertEqual(summary["resultUnknown"]["label"], "无法核实")
        self.assertEqual(summary["stuck"]["count"], 1)
        self.assertEqual(summary["stuck"]["label"], "持续阻塞")


class AttemptsAndModuleResultsDrillDownTests(TestCase):
    def test_list_attempts_returns_recovery_chain_in_creation_order(self):
        run = make_run(plan_date=date(2026, 9, 23))
        AutomationAttempt.objects.create(
            logical_run=run, native_workflow_id="JdPromotionDaily2026", native_execution_id="1268", stage="download",
        )
        AutomationAttempt.objects.create(
            logical_run=run, native_workflow_id="JdPromotionDaily2026", native_execution_id="1287", stage="download",
        )
        result = list_attempts(str(run.logical_run_id), page=1, page_size=50)
        self.assertEqual([item["nativeExecutionId"] for item in result["items"]], ["1268", "1287"])
        self.assertEqual(result["pagination"]["total"], 2)

    def test_list_module_results_exposes_gate2_predicates_read_only(self):
        run = make_run(plan_date=date(2026, 9, 24))
        make_result(
            run,
            execution_state="finished",
            business_state="verified",
            delivery_state="failed",
        )
        result = list_module_results(str(run.logical_run_id), page=1, page_size=50)
        self.assertEqual(len(result["items"]), 1)
        actions = result["items"][0]["availableActions"]
        # Mirrors automation_gates test_2: verified business + failed
        # delivery => no rerun import, delivery retry allowed.
        self.assertFalse(actions["mayRerunImport"])
        self.assertTrue(actions["mayRetryDelivery"])

    def test_evidence_block_is_labeled_batch_granularity_not_per_day(self):
        batch = NetshopImportBatch.objects.create(
            id="b-evidence", source=CHAIN_KEY, dataset=DATASET, platform="京东", shop_name="志高商用设备旗舰店",
            file_name="x.xlsx", file_size_bytes=1, file_hash="a" * 64, raw_file_hash="a" * 64, content_hash="b" * 64,
            scope_key="k", status="completed", row_count=1, date_min="2026-09-01", date_max="2026-09-30",
            created_at="2026-09-30T00:00:00+00:00", completed_at="2026-09-30T00:00:00+00:00",
        )
        run = make_run(plan_date=date(2026, 9, 25))
        make_result(run, business_state="no_new_needed", reused_batch_id=batch.id, evidence_state="verified", evidence_source="netshop_import_batch")
        result = list_module_results(str(run.logical_run_id), page=1, page_size=50)
        evidence = result["items"][0]["evidence"]
        self.assertEqual(evidence["granularity"], "batch")
        self.assertIn("批次级覆盖", evidence["note"])
        # The note must explicitly disclaim day-level verification rather
        # than assert it.
        self.assertIn("不代表区间内逐日已核验数据存在", evidence["note"])
        # no_new_needed must disclose the not_due/no_gap merge rather than
        # inventing an unsupported "未到期" sub-category.
        self.assertIn("未到期", evidence["note"])

    def test_module_results_pagination_cap_rejects_oversized_page_size(self):
        run = make_run(plan_date=date(2026, 9, 26))
        with self.assertRaises(WorkflowApiError):
            list_module_results(str(run.logical_run_id), page=1, page_size=MAX_PAGE_SIZE + 1)
