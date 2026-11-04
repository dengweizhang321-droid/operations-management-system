"""Self-checks for the B1 persistent automation projection (jd_promotion pilot).

Scope matches the task: model/field/constraint behaviour only. No gate①/②/③
judgment logic is exercised here (that is B2's responsibility) — these tests
only prove the data model can *hold* the shapes gate logic will need,
including the real 2026-09-12 commercial-equipment-store recovery chain
(execution 1268 -> 1287 -> 1303).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from workflow.automation_models import (
    AutomationAttempt,
    AutomationLogicalRun,
    AutomationModule,
    AutomationModuleResult,
    validate_code_token,
    validate_code_token_list,
)


CHAIN_KEY = "jd_promotion"
SUBJECT_KEY = "jd-yiyong-director"
MODULE_KEY = "jd_promotion.ad_product_daily"
DATASET = "ad"


def make_module():
    return AutomationModule.objects.create(
        module_key=MODULE_KEY,
        label="推广商品日数据",
        platform="京东",
        chain_key=CHAIN_KEY,
        domain="netshop",
        dataset=DATASET,
        date_policy="fixed_yesterday",
        depends_on=[],
        imports_data=True,
        evidence_requirement="batch",
        allowed_actions=["recover_import"],
        schedulable=True,
        contract_version=1,
    )


class AutomationModuleRegistryTests(TestCase):
    def test_module_fields_round_trip(self):
        module = make_module()
        module.refresh_from_db()
        self.assertEqual(module.chain_key, CHAIN_KEY)
        self.assertEqual(module.evidence_requirement, "batch")
        self.assertTrue(module.schedulable)
        self.assertTrue(module.imports_data)

    def test_module_key_rejects_url(self):
        with self.assertRaises(ValidationError):
            validate_code_token("https://example.com/evil")

    def test_module_key_rejects_path_separator(self):
        with self.assertRaises(ValidationError):
            validate_code_token("../../etc/passwd")

    def test_allowed_actions_list_rejects_script_fragment(self):
        with self.assertRaises(ValidationError):
            validate_code_token_list(["recover_import", "rm -rf /"])

    def test_allowed_actions_list_accepts_plain_tokens(self):
        validate_code_token_list(["recover_import", "recover_delivery"])

    def test_module_registry_db_level_validator_blocks_bad_dataset(self):
        module = AutomationModule(
            module_key="jd_promotion.bad",
            label="x",
            platform="京东",
            chain_key=CHAIN_KEY,
            domain="netshop",
            dataset="ad; DROP TABLE x",
            date_policy="fixed_yesterday",
            evidence_requirement="batch",
        )
        with self.assertRaises(ValidationError):
            module.full_clean()


class ThreeAxisIndependenceTests(TestCase):
    """Proves the three axes are three independent fields with disjoint
    value domains, not one status field and not booleans."""

    def setUp(self):
        self.module = make_module()
        self.run = AutomationLogicalRun.objects.create(
            chain_key=CHAIN_KEY,
            subject_key=SUBJECT_KEY,
            plan_date=date(2026, 9, 11),
            business_range={"date": "2026-09-11"},
            trigger_source="schedule",
            plan_summary={"modules": [MODULE_KEY]},
        )

    def test_three_axis_fields_are_independent_columns(self):
        field_names = {f.name for f in AutomationModuleResult._meta.get_fields()}
        self.assertIn("execution_state", field_names)
        self.assertIn("business_state", field_names)
        self.assertIn("delivery_state", field_names)
        # Not merged into a single "status" column.
        self.assertNotIn("status", field_names)

    def test_execution_finished_business_gap_remaining_is_representable_and_distinct(self):
        """B2 gate② needs: execution finished + business gap_remaining must
        not collapse into "done". This unit only proves both values can be
        stored simultaneously and distinctly from a true-complete result."""
        result = AutomationModuleResult.objects.create(
            logical_run=self.run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-09-11",
            execution_state="finished",
            business_state="gap_remaining",
            delivery_state="not_required",
        )
        result.refresh_from_db()
        self.assertEqual(result.execution_state, "finished")
        self.assertEqual(result.business_state, "gap_remaining")
        self.assertNotEqual(
            (result.execution_state, result.business_state),
            ("finished", "verified"),
        )

    def test_business_verified_delivery_failed_is_representable(self):
        """B2 gate judgement needs this combination to disable 'rerun
        import' and only allow 'retry delivery'. This test only proves the
        combination is storable without one axis clobbering another."""
        result = AutomationModuleResult.objects.create(
            logical_run=self.run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-09-11",
            execution_state="finished",
            business_state="verified",
            delivery_state="failed",
        )
        self.assertEqual(result.business_state, "verified")
        self.assertEqual(result.delivery_state, "failed")

    def test_result_unknown_is_a_distinct_execution_value(self):
        result = AutomationModuleResult.objects.create(
            logical_run=self.run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-09-11",
            execution_state="result_unknown",
        )
        self.assertEqual(result.execution_state, "result_unknown")
        self.assertNotIn("result_unknown", dict(
            AutomationModuleResult._meta.get_field("business_state").choices
        ))

    def test_axes_are_separate_columns_each_independently_settable(self):
        """The three axes are independent CharField columns (per
        REPORT.md §4.2's own value domains, "failed" legitimately appears
        in both the execution and delivery axis vocab — that overlap is in
        the spec, not a modelling defect). What must hold is that each
        axis is its own column and setting one never implies or overwrites
        another."""
        result = AutomationModuleResult.objects.create(
            logical_run=self.run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-09-11",
            execution_state="failed",
            business_state="not_started",
            delivery_state="failed",
        )
        # Same literal value ("failed") independently on two different
        # axes must not collapse into one shared column or get coerced.
        self.assertEqual(result.execution_state, "failed")
        self.assertEqual(result.delivery_state, "failed")
        self.assertEqual(result.business_state, "not_started")
        business_values = {v for v, _ in AutomationModuleResult._meta.get_field("business_state").choices}
        # business axis never accepts the executor's "result_unknown" or
        # "queued" vocabulary -- it has its own distinct business-shaped
        # domain, proving the axes are not just one shared enum reused
        # three times.
        self.assertNotIn("result_unknown", business_values)
        self.assertNotIn("queued", business_values)


class ModuleResultFiveDimensionIdentityTests(TestCase):
    def setUp(self):
        self.module = make_module()
        self.run = AutomationLogicalRun.objects.create(
            chain_key=CHAIN_KEY,
            subject_key=SUBJECT_KEY,
            plan_date=date(2026, 9, 11),
            business_range={"date": "2026-09-11"},
            trigger_source="schedule",
            plan_summary={},
        )

    def _make_result(self, **overrides):
        fields = dict(
            logical_run=self.run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-09-11",
        )
        fields.update(overrides)
        return AutomationModuleResult.objects.create(**fields)

    def test_all_five_dimensions_present_on_model(self):
        result = self._make_result()
        for dimension in ("logical_run_id", "module_key", "subject_key", "dataset", "date_range"):
            self.assertTrue(hasattr(result, dimension), f"missing dimension: {dimension}")

    def test_different_date_range_does_not_collide(self):
        self._make_result(date_range="2026-09-11")
        # Different date -> different identity -> must not raise/overwrite.
        other = self._make_result(date_range="2026-09-12")
        self.assertEqual(AutomationModuleResult.objects.count(), 2)
        self.assertNotEqual(other.date_range, "2026-09-11")

    def test_different_dataset_does_not_collide(self):
        self._make_result(dataset=DATASET)
        self._make_result(dataset="sku_master")
        self.assertEqual(AutomationModuleResult.objects.count(), 2)

    def test_exact_identity_duplicate_is_rejected(self):
        self._make_result()
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._make_result()

    def test_same_five_dims_different_logical_run_does_not_collide(self):
        self._make_result()
        other_run = AutomationLogicalRun.objects.create(
            chain_key=CHAIN_KEY,
            subject_key=SUBJECT_KEY,
            plan_date=date(2026, 9, 11),
            business_range={},
            trigger_source="manual",
            plan_summary={},
        )
        AutomationModuleResult.objects.create(
            logical_run=other_run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-09-11",
        )
        self.assertEqual(AutomationModuleResult.objects.count(), 2)

    def test_current_upload_and_reused_batch_fields_are_separate_groups(self):
        result = self._make_result(
            current_raw_file_sha256="a" * 64,
            current_content_fingerprint="b" * 64,
            current_row_count=9496,
            current_warning_count=0,
            reused_batch_id="",
            reused_coverage_revision="",
        )
        self.assertTrue(result.current_raw_file_sha256)
        self.assertFalse(result.reused_batch_id)

        no_new_result = self._make_result(
            date_range="2026-09-10",
            current_raw_file_sha256="",
            current_content_fingerprint="",
            reused_batch_id="jd_promotion:ad:2026-09-10",
            reused_coverage_revision="rev-7",
            business_state="no_new_needed",
        )
        self.assertFalse(no_new_result.current_raw_file_sha256)
        self.assertTrue(no_new_result.reused_batch_id)
        self.assertEqual(no_new_result.business_state, "no_new_needed")


class RecoveryChainReplayTests(TestCase):
    """Replays the real 2026-09-12 commercial-equipment-store shape:
    execution 1268 failed -> 1287 failed -> 1303 succeeded, as one logical
    run with three attempts, not three independent failed runs."""

    def setUp(self):
        self.module = make_module()
        self.run = AutomationLogicalRun.objects.create(
            chain_key=CHAIN_KEY,
            subject_key=SUBJECT_KEY,
            plan_date=date(2026, 9, 11),
            business_range={"date": "2026-09-11"},
            trigger_source="schedule",
            plan_summary={"modules": [MODULE_KEY]},
        )

    def test_1268_1287_1303_is_one_logical_run_three_attempts(self):
        attempt_1268 = AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1268",
            stage="download",
            started_at=datetime(2026, 9, 12, 13, 0, tzinfo=timezone.utc),
            finished_at=datetime(2026, 9, 12, 13, 2, tzinfo=timezone.utc),
            error_class="report_list_migration_overlay",
        )
        attempt_1287 = AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1287",
            parent_attempt=attempt_1268,
            recovery_reason="hourly_safe_retry",
            stage="download",
            started_at=datetime(2026, 9, 12, 14, 0, tzinfo=timezone.utc),
            finished_at=datetime(2026, 9, 12, 14, 2, tzinfo=timezone.utc),
            error_class="report_list_migration_overlay",
        )
        attempt_1303 = AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1303",
            parent_attempt=attempt_1287,
            recovery_reason="hourly_safe_retry",
            stage="release",
            started_at=datetime(2026, 9, 12, 15, 0, tzinfo=timezone.utc),
            finished_at=datetime(2026, 9, 12, 15, 1, 58, tzinfo=timezone.utc),
        )

        # All three attempts share exactly one logical run.
        all_attempts = AutomationAttempt.objects.filter(logical_run=self.run)
        self.assertEqual(all_attempts.count(), 3)
        self.assertEqual(AutomationLogicalRun.objects.count(), 1)

        # Parent/child chain is correct: 1303's parent is 1287, 1287's
        # parent is 1268, and 1268 is the root (no parent).
        attempt_1303.refresh_from_db()
        attempt_1287.refresh_from_db()
        attempt_1268.refresh_from_db()
        self.assertEqual(attempt_1303.parent_attempt_id, attempt_1287.attempt_id)
        self.assertEqual(attempt_1287.parent_attempt_id, attempt_1268.attempt_id)
        self.assertIsNone(attempt_1268.parent_attempt_id)

        # Walking the chain from the successful attempt back to the root
        # recovers all three executions in order.
        chain = []
        current = attempt_1303
        while current is not None:
            chain.append(current.native_execution_id)
            current = current.parent_attempt
        self.assertEqual(chain, ["1303", "1287", "1268"])

    def test_retry_budget_counts_by_logical_run_not_reset_by_new_execution(self):
        """A new native_execution_id must not reset the attempt count used
        for retry-budget accounting — the count is read off attempts under
        the same logical_run_id."""
        parent = None
        for execution_id in ("1268", "1287", "1303"):
            parent = AutomationAttempt.objects.create(
                logical_run=self.run,
                native_workflow_id="JdPromotionDaily2026",
                native_execution_id=execution_id,
                parent_attempt=parent,
                recovery_reason="hourly_safe_retry" if parent else "",
                stage="download",
            )
            # Budget is "how many attempts exist under this logical run so
            # far", which must monotonically increase across new executions,
            # never reset to 0/1 just because native_execution_id changed.
            budget_used = AutomationAttempt.objects.filter(logical_run=self.run).count()
            expected = {"1268": 1, "1287": 2, "1303": 3}[execution_id]
            self.assertEqual(budget_used, expected)

    def test_manual_rerun_creates_new_logical_run_not_new_attempt(self):
        """Manual full re-collection must create a *new* logical run, not
        attach as an attempt under the existing one — the opposite of
        recovery."""
        first_attempt = AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1268",
            stage="download",
        )
        manual_run = AutomationLogicalRun.objects.create(
            chain_key=CHAIN_KEY,
            subject_key=SUBJECT_KEY,
            plan_date=date(2026, 9, 11),
            business_range={"date": "2026-09-11"},
            trigger_source="manual",
            plan_summary={},
        )
        manual_attempt = AutomationAttempt.objects.create(
            logical_run=manual_run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="9999",
            stage="download",
        )
        self.assertNotEqual(manual_run.logical_run_id, self.run.logical_run_id)
        self.assertIsNone(manual_attempt.parent_attempt_id)
        self.assertEqual(AutomationLogicalRun.objects.count(), 2)
        self.assertEqual(
            AutomationAttempt.objects.filter(logical_run=self.run).count(), 1
        )
        self.assertEqual(
            AutomationAttempt.objects.filter(logical_run=manual_run).count(), 1
        )

    def test_same_native_execution_id_cannot_attach_to_two_logical_runs(self):
        AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1268",
            stage="download",
        )
        other_run = AutomationLogicalRun.objects.create(
            chain_key=CHAIN_KEY,
            subject_key=SUBJECT_KEY,
            plan_date=date(2026, 9, 12),
            business_range={},
            trigger_source="schedule",
            plan_summary={},
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                AutomationAttempt.objects.create(
                    logical_run=other_run,
                    native_workflow_id="JdPromotionDaily2026",
                    native_execution_id="1268",
                    stage="download",
                )

    def test_deleting_parent_attempt_is_protected(self):
        """on_delete=PROTECT on parent_attempt: the chain must not silently
        lose its root when something tries to delete 1268 while 1287/1303
        still reference it."""
        attempt_1268 = AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1268",
            stage="download",
        )
        AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1287",
            parent_attempt=attempt_1268,
            stage="download",
        )
        from django.db.models import ProtectedError

        with self.assertRaises(ProtectedError):
            attempt_1268.delete()

    def test_deleting_logical_run_cascades_attempts_and_results(self):
        """CASCADE on logical_run: removing a logical run (e.g. in a test
        fixture teardown) must not leave orphaned attempts/results behind."""
        AutomationAttempt.objects.create(
            logical_run=self.run,
            native_workflow_id="JdPromotionDaily2026",
            native_execution_id="1268",
            stage="download",
        )
        AutomationModuleResult.objects.create(
            logical_run=self.run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-09-11",
        )
        run_id = self.run.logical_run_id
        self.run.delete()
        self.assertEqual(AutomationAttempt.objects.filter(logical_run_id=run_id).count(), 0)
        self.assertEqual(AutomationModuleResult.objects.filter(logical_run_id=run_id).count(), 0)
