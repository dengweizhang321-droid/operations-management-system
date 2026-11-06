"""Unit coverage for the generic scheduler mechanics in schedule_core.py.

These exercise the four extracted primitives directly and in isolation from
DingTalk's step()/save() business logic, which is already covered end to
end by test_dingtalk_schedules.py. AiDingTalkSchedule/AiDingTalkScheduleRun
are reused here only as a concrete model with the right shape (an existing
unique constraint over an owner+slot pair); no new tables are introduced.
"""
import time
from datetime import timedelta

from django.db import models
from django.test import TestCase
from django.utils import timezone

from . import models as m
from .policy import AiError, uid
from .schedule_core import (
    IN_PROGRESS_STATUSES,
    LiveRunGuard,
    claim_slot,
    is_missed_window,
    recover_interrupted_runs,
)


class IsMissedWindowTests(TestCase):
    def test_boundary_is_not_missed_and_just_past_is(self):
        now = timezone.now()
        self.assertFalse(is_missed_window(now, now - timedelta(minutes=5), timedelta(minutes=5)))
        self.assertTrue(is_missed_window(now, now - timedelta(minutes=5, seconds=1), timedelta(minutes=5)))

    def test_future_scheduled_at_is_never_missed(self):
        now = timezone.now()
        self.assertFalse(is_missed_window(now, now + timedelta(hours=1), timedelta(minutes=5)))


class ClaimSlotTests(TestCase):
    def setUp(self):
        self.schedule = m.AiDingTalkSchedule.objects.create(id=uid("ding-schedule"), name="t", prompt="p",
            cadence="daily", hour=9, minute=0, target_type="person", target_id="a", sender_id="a",
            owner_email="owner@example.com")

    def test_first_claim_creates_second_is_idempotent(self):
        slot = timezone.now()
        first, created = claim_slot(m.AiDingTalkScheduleRun.objects, owner_field="schedule", owner_value=self.schedule,
            slot_field="scheduled_at", slot_value=slot,
            defaults={"id": uid("ding-run"), "schedule_version": 1, "status": "running"})
        self.assertTrue(created)
        second, created_again = claim_slot(m.AiDingTalkScheduleRun.objects, owner_field="schedule", owner_value=self.schedule,
            slot_field="scheduled_at", slot_value=slot,
            defaults={"id": uid("ding-run"), "schedule_version": 1, "status": "denied"})
        self.assertFalse(created_again)
        self.assertEqual(first.id, second.id)
        # The defaults from the second, losing call must never have applied.
        self.assertEqual(second.status, "running")

    def test_distinct_slots_do_not_collide(self):
        slot_a, slot_b = timezone.now(), timezone.now() + timedelta(minutes=1)
        _, created_a = claim_slot(m.AiDingTalkScheduleRun.objects, owner_field="schedule", owner_value=self.schedule,
            slot_field="scheduled_at", slot_value=slot_a,
            defaults={"id": uid("ding-run"), "schedule_version": 1, "status": "running"})
        _, created_b = claim_slot(m.AiDingTalkScheduleRun.objects, owner_field="schedule", owner_value=self.schedule,
            slot_field="scheduled_at", slot_value=slot_b,
            defaults={"id": uid("ding-run"), "schedule_version": 1, "status": "running"})
        self.assertTrue(created_a)
        self.assertTrue(created_b)


class RecoverInterruptedRunsTests(TestCase):
    def setUp(self):
        self.schedule = m.AiDingTalkSchedule.objects.create(id=uid("ding-schedule"), name="t", prompt="p",
            cadence="daily", hour=9, minute=0, target_type="person", target_id="a", sender_id="a",
            owner_email="owner@example.com")

    def make_run(self, status, data_status="succeeded", analysis_status="running", delivery_status="pending"):
        return m.AiDingTalkScheduleRun.objects.create(id=uid("ding-run"), schedule=self.schedule, schedule_version=1,
            scheduled_at=timezone.now(), status=status,
            data_status=data_status, analysis_status=analysis_status, delivery_status=delivery_status)

    def test_running_phase_becomes_unknown_pending_becomes_not_required(self):
        run = self.make_run("running")
        marks = []
        def mark_phase(run, phase, status, code=""):
            marks.append((phase, status, code))
            setattr(run, phase + "_status", status)
        qs = m.AiDingTalkScheduleRun.objects.filter(status__in=IN_PROGRESS_STATUSES)
        recover_interrupted_runs(qs, mark_phase)
        run.refresh_from_db()
        self.assertEqual(run.status, "unknown")
        self.assertEqual(run.error_code, "interrupted_result_unknown")
        self.assertIsNotNone(run.completed_at)
        self.assertEqual(set(marks), {("analysis", "unknown", "interrupted_result_unknown"),
                                       ("delivery", "not_required", "prior_stage_interrupted")})

    def test_queued_run_is_not_touched(self):
        run = self.make_run("queued", analysis_status="pending")
        qs = m.AiDingTalkScheduleRun.objects.filter(status__in=IN_PROGRESS_STATUSES)
        recover_interrupted_runs(qs, lambda *a: None)
        run.refresh_from_db()
        self.assertEqual(run.status, "queued")

    def test_completed_at_is_taken_fresh_per_run_not_hoisted_before_the_loop(self):
        # Regression for the bug the independent review caught: hoisting
        # `now = timezone.now()` above the for-loop gives every stuck run the
        # exact same completed_at, which can precede a timestamp mark_phase
        # (stage() in production) just wrote onto that same run's own phase a
        # moment earlier within the loop body. Each run's completed_at must
        # be taken after its own mark_phase calls finish, and two runs
        # recovered in the same batch (with a measurable gap between them)
        # must not share a timestamp.
        first = self.make_run("running")
        m.AiDingTalkScheduleRun.objects.filter(pk=first.id).update(scheduled_at=timezone.now() - timedelta(minutes=10))
        second = self.make_run("sending", analysis_status="succeeded", delivery_status="running")
        order = [first.id, second.id]
        phase_timestamps = {}
        def mark_phase(run, phase, status, code=""):
            setattr(run, phase + "_status", status)
            # Simulate stage()'s real DB round trip taking measurable time,
            # and record when this phase mark was observed to land.
            time.sleep(0.05)
            phase_timestamps[run.id] = timezone.now()
        qs = m.AiDingTalkScheduleRun.objects.filter(status__in=IN_PROGRESS_STATUSES).order_by(
            models.Case(*(models.When(pk=pk, then=position) for position, pk in enumerate(order))))
        recover_interrupted_runs(qs, mark_phase)
        first.refresh_from_db()
        second.refresh_from_db()
        # The bug under test makes every run's completed_at identical; two
        # runs recovered half a loop-iteration apart, each with its own
        # >=50ms of simulated mark_phase work, must not collide.
        self.assertNotEqual(first.completed_at, second.completed_at)
        self.assertGreaterEqual(first.completed_at, phase_timestamps[first.id])
        self.assertGreaterEqual(second.completed_at, phase_timestamps[second.id])
        self.assertLess(first.completed_at, second.completed_at)


class LiveRunGuardTests(TestCase):
    def setUp(self):
        self.schedule = m.AiDingTalkSchedule.objects.create(id=uid("ding-schedule"), name="t", prompt="p",
            cadence="daily", hour=9, minute=0, target_type="person", target_id="a", sender_id="a",
            owner_email="owner@example.com")
        self.run = m.AiDingTalkScheduleRun.objects.create(id=uid("ding-run"), schedule=self.schedule,
            schedule_version=1, scheduled_at=timezone.now(), status="running")

    def test_in_progress_status_passes_and_returns_it(self):
        guard = LiveRunGuard(m.AiDingTalkScheduleRun.objects, self.run.id)
        self.assertEqual(guard.check(), "running")

    def test_terminal_status_raises_access_denied(self):
        m.AiDingTalkScheduleRun.objects.filter(pk=self.run.id).update(status="denied")
        guard = LiveRunGuard(m.AiDingTalkScheduleRun.objects, self.run.id)
        with self.assertRaises(AiError) as caught:
            guard.check()
        self.assertEqual(caught.exception.code, "access_denied")
        self.assertEqual(caught.exception.status, 403)

    def test_reads_current_db_state_not_a_stale_snapshot(self):
        guard = LiveRunGuard(m.AiDingTalkScheduleRun.objects, self.run.id)
        guard.check()  # still "running" at construction time
        m.AiDingTalkScheduleRun.objects.filter(pk=self.run.id).update(status="sent")
        with self.assertRaises(AiError):
            guard.check()  # "sent" has left IN_PROGRESS_STATUSES
