"""Gate① extended to the 京东客服链 (customer_service domain).

Scope: subject ``jd-yiyong-director``, shop 志高商用设备旗舰店, workflow
``JdCustomerService2026``, chain_key ``jd_customer_service``, dataset
``customer_service`` — see docs/autoimport-workflow-unification-20261029/
and the task prompt's "已核实的客服域事实" section for the authoritative
field list this file tests against.

Mirrors ``test_automation_gates.py``'s structure (forward false-green
case, reverse no-misjudge cases, cross-counterexample, gate③ agreement)
but against ``read_customer_service_evidence`` /
``CustomerServiceImportBatch`` / ``CustomerServiceConversation`` instead
of the promotion chain's ``NetshopImportBatch``. The promotion chain's own
test file and its 22 cases are untouched — this file only adds new
coverage for the new domain reader.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from django.test import TestCase

from customer_service.models import CustomerServiceConversation, CustomerServiceImportBatch
from workflow.automation_gates import (
    GATE1_GAP_REMAINING,
    GATE1_NO_NEW_NEEDED,
    GATE1_PARTIAL,
    GATE1_VERIFIED,
    judge_gate1,
    judge_gate3,
    read_business_evidence_for_module,
    read_customer_service_evidence,
)

SHOP_NAME = "志高商用设备旗舰店"
CHAIN_KEY = "jd_customer_service"
SUBJECT_KEY = "jd-yiyong-director"


def make_batch(
    *,
    batch_id: str,
    status: str = "completed",
    conversation_count: int = 100,
    matched_count: int = 100,
    session_only_count: int = 0,
    chat_only_count: int = 0,
    ambiguous_count: int = 0,
    completed_at: datetime | None = None,
) -> CustomerServiceImportBatch:
    return CustomerServiceImportBatch.objects.create(
        id=batch_id,
        shop_name=SHOP_NAME,
        session_file_name="session.xlsx",
        chat_file_name="chat.log",
        raw_file_hash="a" * 64,
        import_hash=f"import-{batch_id}",
        content_hash="b" * 64,
        identity_set_hash="c" * 64,
        scope_key=f"customer-service:{SHOP_NAME}",
        status=status,
        conversation_count=conversation_count,
        matched_count=matched_count,
        session_only_count=session_only_count,
        chat_only_count=chat_only_count,
        ambiguous_count=ambiguous_count,
        completed_at=completed_at or datetime(2026, 10, 31, 1, 0, tzinfo=timezone.utc),
    )


def make_conversation(*, batch_id: str, consulted_at: str, key: str) -> CustomerServiceConversation:
    return CustomerServiceConversation.objects.create(
        conversation_key=key,
        first_import_batch_id=batch_id,
        last_import_batch_id=batch_id,
        shop_name=SHOP_NAME,
        consulted_at=consulted_at,
        match_status="matched",
        match_confidence="high",
    )


def seed_full_range(batch_id: str, start: date, end: date, *, prefix: str = "conv") -> None:
    day = start
    index = 0
    while day <= end:
        make_conversation(
            batch_id=batch_id,
            consulted_at=f"{day.isoformat()} 09:00:00",
            key=f"{prefix}-{day.isoformat()}-{index}",
        )
        index += 1
        day += timedelta(days=1)


# ---------------------------------------------------------------------------
# Forward direction: false green must still be caught for the customer
# service chain.
# ---------------------------------------------------------------------------


class CustomerServiceGate1FalseGreenTests(TestCase):
    def test_script_ok_but_no_batch_at_all_is_judged_failed(self):
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_GAP_REMAINING)
        self.assertEqual(judgment.execution_state, "failed")

    def test_script_ok_but_batch_exists_for_unrelated_days_only_is_judged_failed(self):
        batch = make_batch(batch_id="cs-unrelated")
        seed_full_range(batch.id, date(2026, 8, 1), date(2026, 8, 5))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_GAP_REMAINING)
        self.assertEqual(judgment.execution_state, "failed")


# ---------------------------------------------------------------------------
# Reverse direction: the correct "no gap" outcome must not be misjudged.
# ---------------------------------------------------------------------------


class CustomerServiceGate1DoesNotMisjudgeCorrectOutcomesTests(TestCase):
    def test_no_gap_rolling_30d_window_fully_covered_by_conversations(self):
        """30 天滚动窗口全部有会话、配对完整 -> no_new_needed（既有批次
        已覆盖，本轮不需要新批次）。"""
        batch = make_batch(batch_id="cs-2026-10-30", completed_at=datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc))
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
            since_completed_at="2026-10-31T00:00:00+00:00",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)
        self.assertEqual(judgment.reused_batch_id, batch.id)

    def test_genuine_new_batch_with_full_coverage_and_clean_pairing_is_verified(self):
        batch = make_batch(batch_id="cs-genuine")
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=2, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_VERIFIED)
        self.assertEqual(judgment.netshop_import_batch_id, batch.id)

    def test_partial_date_coverage_is_partial_not_verified_nor_no_new_needed(self):
        """只补了一部分日期 -> partial，不升级为 verified 或 no_new_needed。"""
        batch = make_batch(batch_id="cs-partial-days")
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 15))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=1, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_PARTIAL)


# ---------------------------------------------------------------------------
# The双文件配对不完整 mapping: session_only/chat_only/ambiguous non-zero
# must downgrade to `partial`, never `verified`/`no_new_needed`, even when
# every calendar day in range has at least one conversation.
# ---------------------------------------------------------------------------


class CustomerServicePairingIncompleteTests(TestCase):
    def test_full_day_coverage_but_session_only_nonzero_is_partial_not_verified(self):
        batch = make_batch(batch_id="cs-session-only-gap", session_only_count=12)
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=2, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_PARTIAL)
        self.assertNotEqual(judgment.business_state, GATE1_VERIFIED)

    def test_full_day_coverage_but_chat_only_nonzero_is_partial(self):
        batch = make_batch(batch_id="cs-chat-only-gap", chat_only_count=3)
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME, range_start="2026-10-01", range_end="2026-10-30"
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=2, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_PARTIAL)

    def test_full_day_coverage_but_ambiguous_nonzero_is_partial_not_no_new_needed(self):
        """即使本轮没有新批次（"无缺口"形态），歧义计数非零仍不得判
        no_new_needed——配对缺口比"沿用旧批次"更需要暴露。"""
        batch = make_batch(
            batch_id="cs-ambiguous-gap",
            ambiguous_count=5,
            completed_at=datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc),
        )
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
            since_completed_at="2026-10-31T00:00:00+00:00",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_PARTIAL)
        self.assertNotEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)

    def test_full_day_coverage_zero_pairing_gap_is_eligible_for_verified(self):
        """对照：配对计数全零时不受本规则影响，仍可判 verified——证明
        partial 降级只在配对确实不完整时触发。"""
        batch = make_batch(batch_id="cs-clean-pairing")
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME, range_start="2026-10-01", range_end="2026-10-30"
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=2, modules_dispatched=1)
        self.assertEqual(judgment.business_state, GATE1_VERIFIED)


# ---------------------------------------------------------------------------
# Cross counterexample: must actually go red for the customer service
# chain too, not just the promotion chain.
# ---------------------------------------------------------------------------


class CustomerServiceCrossContaminationMustFailTests(TestCase):
    def test_miscoding_no_new_needed_as_plain_zero_files_success_is_rejected(self):
        """造错规则：把"0 文件也算成功"直接当 no_new_needed，没有任何
        覆盖证据支撑——gate① 必须拒绝，判 gap_remaining/failed。"""
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
        )
        judgment = judge_gate1(evidence, script_reported_ok=True, files_obtained=0, modules_dispatched=1)
        self.assertNotEqual(judgment.business_state, GATE1_NO_NEW_NEEDED)
        self.assertNotEqual(judgment.business_state, GATE1_VERIFIED)
        self.assertEqual(judgment.business_state, GATE1_GAP_REMAINING)
        self.assertEqual(judgment.execution_state, "failed")


# ---------------------------------------------------------------------------
# Gate③ agreement for the customer-service chain's own evidence shape.
# ---------------------------------------------------------------------------


class CustomerServiceGate3Tests(TestCase):
    def test_dispatched_one_zero_files_no_evidence_is_hard_failed(self):
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME, range_start="2026-10-01", range_end="2026-10-30"
        )
        forced = judge_gate3(modules_dispatched=1, files_obtained=0, evidence=evidence)
        self.assertEqual(forced, "failed")

    def test_zero_files_with_full_coverage_is_not_gate3_failure(self):
        batch = make_batch(batch_id="cs-cover", completed_at=datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc))
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_customer_service_evidence(
            shop_name=SHOP_NAME,
            range_start="2026-10-01",
            range_end="2026-10-30",
            since_completed_at="2026-10-31T00:00:00+00:00",
        )
        forced = judge_gate3(modules_dispatched=1, files_obtained=0, evidence=evidence)
        self.assertIsNone(forced)


# ---------------------------------------------------------------------------
# Dispatch: AutomationModule.domain routes to the right reader.
# ---------------------------------------------------------------------------


class ChainDispatchTests(TestCase):
    def test_domain_customer_service_dispatches_to_customer_service_reader(self):
        batch = make_batch(batch_id="cs-dispatch")
        seed_full_range(batch.id, date(2026, 10, 1), date(2026, 10, 30))
        evidence = read_business_evidence_for_module(
            domain="customer_service",
            dataset="customer_service",
            subject_key=SUBJECT_KEY,
            range_start="2026-10-01",
            range_end="2026-10-30",
            shop_name=SHOP_NAME,
        )
        self.assertTrue(evidence.is_fully_covered)
        self.assertEqual(evidence.chain_key, CHAIN_KEY)

    def test_domain_netshop_dispatches_to_netshop_reader_unaffected(self):
        from netshop.models import NetshopImportBatch

        NetshopImportBatch.objects.create(
            id="net-dispatch",
            source="jd_promotion",
            dataset="ad",
            platform="京东",
            shop_name="志高商用设备旗舰店",
            file_name="x.xlsx",
            file_size_bytes=1,
            file_hash="a" * 64,
            raw_file_hash="a" * 64,
            content_hash="b" * 64,
            scope_key="jd_promotion:ad:志高商用设备旗舰店",
            status="completed",
            date_min="2026-09-11",
            date_max="2026-09-11",
            created_at="2026-09-12T15:01:00+00:00",
            completed_at="2026-09-12T15:01:58+00:00",
        )
        evidence = read_business_evidence_for_module(
            domain="netshop",
            dataset="ad",
            subject_key="jd-yiyong-director",
            range_start="2026-09-11",
            range_end="2026-09-11",
            platform="京东",
            shop_name="志高商用设备旗舰店",
        )
        self.assertTrue(evidence.is_fully_covered)

    def test_unknown_domain_raises(self):
        with self.assertRaises(ValueError):
            read_business_evidence_for_module(
                domain="finance",
                dataset="x",
                subject_key="x",
                range_start="2026-10-01",
                range_end="2026-10-01",
            )
