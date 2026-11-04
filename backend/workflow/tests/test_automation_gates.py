"""Gate①②③ tests (B2).

Scope: 京准通推广链 pilot, subject ``jd-yiyong-director`` (platform 京东,
shop 志高商用设备旗舰店), source ``jd_promotion`` / dataset ``ad`` — see
``docs/autoimport-workflow-unification-20261029/京东单店试点.md`` §二.

These tests build business evidence directly against
``NetshopImportBatch`` (the real model backing the real 2026-09-12
production shape) and never read any pipeline/n8n self-reported field —
that is the point of gate① per B0's finding (消费侧只读 n8n 的
``executionStatus``, 业务跳过语义键没有任何自动化消费者).

Every gate① test is written as an explicit pair: a positive case proving
the gate catches a false green, and a negative case proving the same gate
does not misfire on a legitimately correct "no new data needed" result.
The cross-counterexample test (``test_cross_contamination_...``) is the
one required to actually go red when "no_new_needed" is miscoded as "0
files succeeded" — see its docstring.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from django.test import TestCase

from netshop.models import NetshopImportBatch
from workflow.automation_gates import (
    GATE1_GAP_REMAINING,
    GATE1_NO_NEW_NEEDED,
    GATE1_PARTIAL,
    GATE1_VERIFIED,
    apply_gate1,
    is_failure_for_alerting,
    is_verified_for_display,
    judge_gate1,
    judge_gate3,
    may_display_as_completed,
    may_normal_retry,
    may_rerun_import,
    may_retry_delivery,
    read_business_evidence,
    requires_verifiable_recovery_entry,
)
from workflow.automation_models import AutomationLogicalRun, AutomationModuleResult


SOURCE = "jd_promotion"
DATASET = "ad"
PLATFORM = "京东"
SHOP_NAME = "志高商用设备旗舰店"
CHAIN_KEY = "jd_promotion"
SUBJECT_KEY = "jd-yiyong-director"
MODULE_KEY = "jd_promotion.ad_product_daily"


def make_batch(
    *,
    batch_id: str,
    date_min: str,
    date_max: str,
    status: str = "completed",
    row_count: int = 9496,
    duplicate_count: int = 0,
    warning_count: int = 0,
    completed_at: str = "2026-09-12T15:01:58+00:00",
) -> NetshopImportBatch:
    return NetshopImportBatch.objects.create(
        id=batch_id,
        source=SOURCE,
        dataset=DATASET,
        platform=PLATFORM,
        shop_name=SHOP_NAME,
        file_name="jd-promotion-2026-09-11.xlsx",
        file_size_bytes=123456,
        file_hash="a" * 64,
        raw_file_hash="a" * 64,
        content_hash="b" * 64,
        scope_key="jd_promotion:ad:" + SHOP_NAME,
        status=status,
        row_count=row_count,
        inserted_count=row_count - duplicate_count,
        duplicate_count=duplicate_count,
        warning_count=warning_count,
        date_min=date_min,
        date_max=date_max,
        created_at="2026-09-12T15:01:00+00:00",
        completed_at=completed_at,
    )


def make_logical_run(plan_date: date = date(2026, 9, 11)) -> AutomationLogicalRun:
    return AutomationLogicalRun.objects.create(
        chain_key=CHAIN_KEY,
        subject_key=SUBJECT_KEY,
        plan_date=plan_date,
        business_range={"date": plan_date.isoformat()},
        trigger_source="schedule",
        plan_summary={"modules": [MODULE_KEY]},
    )


def make_result(run: AutomationLogicalRun, date_range: str = "2026-09-11", **overrides) -> AutomationModuleResult:
    fields = dict(
        logical_run=run,
        module_key=MODULE_KEY,
        subject_key=SUBJECT_KEY,
        dataset=DATASET,
        date_range=date_range,
    )
    fields.update(overrides)
    return AutomationModuleResult.objects.create(**fields)


# ---------------------------------------------------------------------------
# Gate① — forward direction: catch the false green.
# ---------------------------------------------------------------------------


class Gate1FalseGreenTests(TestCase):
    """脚本回报 ok、业务域无新批次、无权威证据 → 必须判 failed，不判 done。"""

    def test_script_ok_but_no_batch_at_all_is_judged_failed(self):
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        judgment = judge_gate1(
            evidence,
            script_reported_ok=True,
            files_obtained=1,
            modules_dispatched=1,
        )
        self.assertEqual(judgment.business_state, GATE1_GAP_REMAINING)
        self.assertEqual(judgment.execution_state, "failed")
        self.assertEqual(judgment.reason, "script_ok_but_no_business_evidence")

    def test_script_ok_but_only_partial_prior_batch_outside_range_is_judged_failed(self):
        # A batch exists but for an unrelated day — must not be mistaken
        # for coverage of the requested day.
        make_batch(batch_id="b-unrelated", date_min="2026-08-01", date_max="2026-08-01")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        judgment = judge_gate1(
            evidence,
            script_reported_ok=True,
            files_obtained=1,
            modules_dispatched=1,
        )
        self.assertEqual(judgment.business_state, GATE1_GAP_REMAINING)
        self.assertEqual(judgment.execution_state, "failed")

    def test_apply_gate1_writes_failed_execution_state_on_result_row(self):
        run = make_logical_run()
        result = make_result(run, execution_state="finished")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        judgment = apply_gate1(
            result, evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1
        )
        self.assertEqual(judgment.execution_state, "failed")
        self.assertEqual(result.execution_state, "failed")
        self.assertEqual(result.business_state, GATE1_GAP_REMAINING)
        self.assertFalse(may_display_as_completed(result))


# ---------------------------------------------------------------------------
# Gate① — reverse direction: do not misjudge the three legitimate outcomes.
# ---------------------------------------------------------------------------


class Gate1DoesNotMisjudgeCorrectOutcomesTests(TestCase):
    """无缺口 / 未到期 / 内容重复 三种正确结果必须判 no_new_needed，
    带原批次 id 或覆盖证据，不得判 failed。"""

    def test_no_gap_existing_batch_fully_covers_requested_day(self):
        """场景1：无缺口——该日期范围已被既有批次完整覆盖。"""
        batch = make_batch(batch_id="b-2026-09-11", date_min="2026-09-11", date_max="2026-09-11")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
            since_completed_at="2026-09-13T00:00:00+00:00",  # batch predates "this round"
        )
        judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=1
        )
        self.assertEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)
        self.assertEqual(judgment.reused_batch_id, batch.id)
        self.assertIsNone(judgment.execution_state)  # does not force a failed execution

    def test_not_due_policy_means_same_shape_as_no_gap_with_prior_batch_evidence(self):
        """场景2：未到期——本轮按政策不该产生新批次。本系统对 not_due
        没有单独的业务域字段（B0：not_due 只在便签文字里），所以"未到期"
        在业务域层面呈现为与"无缺口"相同的证据形态：既有批次已覆盖，本轮
        不需要新批次。"""
        batch = make_batch(batch_id="b-not-due", date_min="2026-09-11", date_max="2026-09-11")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
            since_completed_at="2026-09-13T00:00:00+00:00",
        )
        judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=0
        )
        self.assertEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)
        self.assertEqual(judgment.reused_batch_id, batch.id)

    def test_duplicate_content_batch_still_covers_and_is_no_new_needed(self):
        """场景3：内容重复——文件内容指纹与既有批次一致（``NetshopImportAttempt
        .outcome == "duplicate"`` 的落地结果就是：没有新批次产生，既有批次
        依然是本范围的权威覆盖）。"""
        batch = make_batch(batch_id="b-dup", date_min="2026-09-11", date_max="2026-09-11")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
            since_completed_at="2026-09-13T00:00:00+00:00",
        )
        judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1
        )
        self.assertEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)
        self.assertEqual(judgment.reused_batch_id, batch.id)
        self.assertNotEqual(judgment.business_state, GATE1_GAP_REMAINING)

    def test_genuine_new_batch_within_range_is_verified_not_no_new_needed(self):
        """正面对照：真的有新批次落在范围内且完整覆盖 → verified，不是
        no_new_needed（避免把两条路反过来混）。"""
        batch = make_batch(batch_id="b-genuine", date_min="2026-09-11", date_max="2026-09-11")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1
        )
        self.assertEqual(judgment.business_state, GATE1_VERIFIED)
        self.assertEqual(judgment.netshop_import_batch_id, batch.id)

    def test_partial_coverage_is_partial_not_no_new_needed_nor_verified(self):
        """多日范围只有部分日期有批次 -> partial，不得升级为 verified 或
        no_new_needed。"""
        make_batch(batch_id="b-day1", date_min="2026-09-10", date_max="2026-09-10")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-10",
            range_end="2026-09-11",
        )
        judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1
        )
        self.assertEqual(judgment.business_state, GATE1_PARTIAL)


# ---------------------------------------------------------------------------
# Cross counterexample: must actually go red when no_new_needed is
# miscoded as "0 files succeeded".
# ---------------------------------------------------------------------------


class CrossContaminationMustFailTests(TestCase):
    """这组用例存在的唯一意义：证明"把 no_new_needed 错配成 0 文件成功"
    真的会被挡住，不是空话。"""

    def test_miscoding_no_new_needed_as_plain_zero_files_success_is_rejected(self):
        """如果有人把"无缺口/未到期"写成"下发 1 个模块、0 文件、但标记
        execution=finished、business=verified"（即把两条路混成一条：既
        不走 gate①的 no_new_needed 分支也不提供覆盖证据，只是裸称
        "0 文件也算成功"），断言必须失败——用来证明"两条路混在一起"会被
        当场抓到，而不是被模型默默接受。"""
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        # No batch exists anywhere -> evidence is empty. A buggy caller
        # tries to claim this is the "no_new_needed" outcome merely
        # because files_obtained == 0, without any covering batch.
        judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=1
        )
        # The gate refuses to call this no_new_needed or verified: with no
        # covering evidence it is gap_remaining/failed, exactly the
        # opposite of what the miscoding attempted.
        self.assertNotEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)
        self.assertNotEqual(judgment.business_state, GATE1_VERIFIED)
        self.assertEqual(judgment.business_state, GATE1_GAP_REMAINING)
        self.assertEqual(judgment.execution_state, "failed")

    def test_miscoding_demonstration_without_the_gate_would_have_passed(self):
        """对照：不经过 gate①、只用"files_obtained == 0 => success"这条
        （错误的）规则会得出相反结论——证明上一条测试确实抓住了这个错误，
        不是碰巧同样的答案。"""
        files_obtained = 0
        naive_would_be_success = files_obtained == 0  # the bug being tested against
        self.assertTrue(naive_would_be_success)  # the naive rule says "success"

        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=1
        )
        # The gate's answer disagrees with the naive rule — that
        # disagreement is exactly the catch this unit must provide.
        self.assertNotEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)


# ---------------------------------------------------------------------------
# Gate③: dispatched N, got 0 files -> hard failed. Must not collide with
# no_new_needed.
# ---------------------------------------------------------------------------


class Gate3ZeroFilesTests(TestCase):
    def test_dispatched_one_zero_files_no_evidence_is_hard_failed(self):
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        forced = judge_gate3(modules_dispatched=1, files_obtained=0, evidence=evidence)
        self.assertEqual(forced, "failed")

    def test_dispatched_many_zero_files_no_evidence_is_hard_failed_not_partial(self):
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-05",
            range_end="2026-09-11",
        )
        forced = judge_gate3(modules_dispatched=7, files_obtained=0, evidence=evidence)
        self.assertEqual(forced, "failed")

    def test_zero_files_with_full_coverage_evidence_is_not_gate3_failure(self):
        """"无缺口所以 0 文件"是正确结果，gate③不得对它开火——这是与
        no_new_needed 不串路的直接证明。"""
        make_batch(batch_id="b-cover", date_min="2026-09-11", date_max="2026-09-11")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        forced = judge_gate3(modules_dispatched=1, files_obtained=0, evidence=evidence)
        self.assertIsNone(forced)

    def test_gate3_and_gate1_agree_on_the_hard_failure_case(self):
        """gate③与gate①对同一个"下发N个、0文件、无证据"场景必须得到同一
        个失败结论，不能一个说failed一个说partial/done。"""
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        gate3_forced = judge_gate3(modules_dispatched=3, files_obtained=0, evidence=evidence)
        gate1_judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=3
        )
        self.assertEqual(gate3_forced, "failed")
        self.assertEqual(gate1_judgment.execution_state, "failed")
        self.assertNotIn(gate1_judgment.business_state, (GATE1_VERIFIED, GATE1_NO_NEW_NEEDED))

    def test_gate3_and_gate1_agree_on_the_legitimate_no_gap_case(self):
        """同一个"下发N个、0文件、但有完整覆盖证据"场景，gate③不开火，
        gate①判 no_new_needed —— 两者一致认为这是正确结果，不是失败。"""
        make_batch(batch_id="b-cover2", date_min="2026-09-11", date_max="2026-09-11")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
            since_completed_at="2026-09-13T00:00:00+00:00",
        )
        gate3_forced = judge_gate3(modules_dispatched=1, files_obtained=0, evidence=evidence)
        gate1_judgment = judge_gate1(
            evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=1
        )
        self.assertIsNone(gate3_forced)
        self.assertEqual(gate1_judgment.business_state, GATE1_NO_NEW_NEEDED)


# ---------------------------------------------------------------------------
# Gate②: three axes must not override each other. Six required cases.
# ---------------------------------------------------------------------------


class Gate2AxisOverrideTests(TestCase):
    def setUp(self):
        self.run = make_logical_run()

    def test_1_execution_finished_business_gap_remaining_not_shown_completed(self):
        result = make_result(
            self.run,
            execution_state="finished",
            business_state="gap_remaining",
        )
        self.assertFalse(may_display_as_completed(result))

    def test_2_business_verified_delivery_failed_no_rerun_import_only_delivery_recovery(self):
        result = make_result(
            self.run,
            execution_state="finished",
            business_state="verified",
            delivery_state="failed",
        )
        # Front-end-equivalent check:
        self.assertFalse(may_rerun_import(result))
        # Server-side check must independently agree (not merely hidden in UI).
        self.assertTrue(may_retry_delivery(result))

    def test_3_execution_result_unknown_disables_normal_retry_offers_verifiable_entry(self):
        result = make_result(self.run, execution_state="result_unknown")
        self.assertFalse(may_normal_retry(result))
        self.assertTrue(requires_verifiable_recovery_entry(result))

    def test_4_execution_needs_human_no_automatic_retry(self):
        result = make_result(self.run, execution_state="needs_human")
        self.assertFalse(may_normal_retry(result))

    def test_5_business_no_new_needed_not_shown_failed_not_shown_new_import(self):
        result = make_result(
            self.run,
            execution_state="finished",
            business_state="no_new_needed",
            reused_batch_id="b-2026-09-11",
        )
        self.assertFalse(is_failure_for_alerting(result))
        # "no_new_needed" with a reused_batch_id must not be confused with
        # a fresh import (verified) — it is its own distinct outcome.
        self.assertNotEqual(result.business_state, "verified")
        self.assertTrue(may_display_as_completed(result))  # it's a legitimate done state

    def test_6_business_submitted_unverified_not_treated_as_verified(self):
        result = make_result(
            self.run,
            execution_state="finished",
            business_state="submitted_unverified",
        )
        self.assertFalse(is_verified_for_display(result))
        self.assertFalse(may_display_as_completed(result))


# ---------------------------------------------------------------------------
# 2026-09-12 real-shape replay: 1268 failed -> 1287 failed -> 1303
# succeeded, importing 9,496 rows for 2026-09-11, batch completed, 0
# warnings, 0 duplicates, zero-gap coverage.
#
# This replay uses a SYNTHETIC NetshopImportBatch fixture that mirrors the
# narrated real production shape (row_count=9496, warning_count=0,
# duplicate_count=0, date 2026-09-11) from
# docs/自动化/通用/n8n-hourly-safe-retry.md line 70. The three n8n
# execution ids (1268/1287/1303) and their stage-level detail live only in
# n8n's own sqlite database (C:/Users/86137/.n8n/database.sqlite), which
# this test suite does not read. So this is NOT a replay against the real
# n8n execution records — it is a synthetic fixture shaped to match the
# narrated outcome, used only to prove gate① correctly classifies that
# shape as `verified` with the right batch evidence.
# ---------------------------------------------------------------------------


class RealShapeReplayTests(TestCase):
    def test_20260912_commercial_equipment_store_shape_is_judged_verified(self):
        batch = make_batch(
            batch_id="jd_promotion:ad:志高商用设备旗舰店:2026-09-11",
            date_min="2026-09-11",
            date_max="2026-09-11",
            row_count=9496,
            duplicate_count=0,
            warning_count=0,
            completed_at="2026-09-12T15:01:58+00:00",
        )
        run = make_logical_run(plan_date=date(2026, 9, 11))

        from workflow.automation_models import AutomationAttempt

        attempt_1268 = AutomationAttempt.objects.create(
            logical_run=run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1268",
            stage="download",
            started_at=datetime(2026, 9, 12, 13, 0, tzinfo=timezone.utc),
            finished_at=datetime(2026, 9, 12, 13, 2, tzinfo=timezone.utc),
            error_class="report_list_migration_overlay",
        )
        attempt_1287 = AutomationAttempt.objects.create(
            logical_run=run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1287",
            parent_attempt=attempt_1268,
            recovery_reason="hourly_safe_retry",
            stage="download",
            started_at=datetime(2026, 9, 12, 14, 0, tzinfo=timezone.utc),
            finished_at=datetime(2026, 9, 12, 14, 2, tzinfo=timezone.utc),
            error_class="report_list_migration_overlay",
        )
        AutomationAttempt.objects.create(
            logical_run=run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1303",
            parent_attempt=attempt_1287,
            recovery_reason="hourly_safe_retry",
            stage="release",
            started_at=datetime(2026, 9, 12, 15, 0, tzinfo=timezone.utc),
            finished_at=datetime(2026, 9, 12, 15, 1, 58, tzinfo=timezone.utc),
        )

        result = make_result(run, date_range="2026-09-11", execution_state="finished")
        evidence = read_business_evidence(
            source=SOURCE,
            dataset=DATASET,
            platform=PLATFORM,
            shop_name=SHOP_NAME,
            range_start="2026-09-11",
            range_end="2026-09-11",
        )
        judgment = apply_gate1(
            result, evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1
        )

        self.assertEqual(judgment.business_state, GATE1_VERIFIED)
        self.assertEqual(result.netshop_import_batch_id, batch.id)
        self.assertEqual(AutomationAttempt.objects.filter(logical_run=run).count(), 3)
        self.assertTrue(may_display_as_completed(result))
