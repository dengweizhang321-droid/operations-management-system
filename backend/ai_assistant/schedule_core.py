"""Generic scheduled-task-run mechanics shared by any AI-domain scheduler.

Nothing here knows about DingTalk. Each function takes the model, queryset or
field names it needs as explicit arguments so a future non-DingTalk scheduler
(e.g. a unified task_dispatch runner) can reuse these without depending on
AiDingTalkSchedule / AiDingTalkScheduleRun.

Four mechanics live here, lifted out of dingtalk_schedules.py:

1. claim_slot() - idempotent (owner, slot) claim via get_or_create. Relies on
   the caller's model having a UniqueConstraint over the same field pair (for
   AiDingTalkScheduleRun that is ai_ding_schedule_slot_uq on
   (schedule, scheduled_at)); this module does not declare or assume any
   specific constraint name, only that one exists so the get_or_create race
   is safe under concurrent callers.
2. is_missed_window() - pure judgement of whether a slot's age exceeds the
   allowed dispatch window.
3. recover_interrupted_runs() - crash recovery: finds runs stuck in an
   in-progress status after an unclean shutdown and marks them (and their
   still-pending phases) as unknown/not_required.
4. LiveRunGuard - the re-check-before-each-external-step primitive pulled out
   of the old channel_guard closure. It only answers "is this run row still
   in an in-progress status". Anything about whether the *destination* (chat
   session, group membership, model binding) has drifted is domain-specific
   and stays in dingtalk_schedules.py, composed around this primitive.
"""
from django.utils import timezone

from .policy import AiError

#: Statuses a run occupies while work on it may still happen. Shared by the
#: "slot already has pending work" conflict check, crash recovery and the
#: live-run guard so all three agree on what "still in flight" means.
IN_PROGRESS_STATUSES = frozenset({"running", "ready", "sending"})

#: Phases executed in order for a single run. A scheduler with different
#: phases can pass its own tuple to recover_interrupted_runs() instead.
DEFAULT_PHASES = ("data", "analysis", "delivery")


def is_missed_window(now, scheduled_at, window):
    """True when a slot is older than `window` and must not be dispatched."""
    return now - scheduled_at > window


def claim_slot(manager, *, owner_field, owner_value, slot_field, slot_value, defaults):
    """Idempotently claim a (owner, slot) run row.

    `manager` is the run model's manager (or a queryset on it, e.g. for
    select_for_update chains). The model must declare a UniqueConstraint over
    (owner_field, slot_field) so concurrent callers racing to claim the same
    slot resolve to the same row instead of raising IntegrityError.

    Returns (row, created) exactly like Django's get_or_create.
    """
    return manager.get_or_create(**{owner_field: owner_value, slot_field: slot_value}, defaults=defaults)


def recover_interrupted_runs(queryset, mark_phase):
    """Mark runs left in an in-progress status by an unclean shutdown.

    `queryset` must already be filtered to the stuck rows (e.g.
    `.select_for_update().filter(status__in=IN_PROGRESS_STATUSES)`) so this
    function stays agnostic of the concrete model and any locking strategy
    the caller wants around it. Phases are DEFAULT_PHASES and field names are
    fixed to match AiDingTalkScheduleRun's shape (status/error_code/
    completed_at, data_status/analysis_status/delivery_status); there is no
    second caller yet to prove a different shape is needed, so this stays
    unparameterized rather than growing options no one calls with a
    non-default value (AGENTS.md 开发约定 3: 只做本需求所需).

    For each run: any phase whose status is "running" becomes "unknown"
    (its outcome is genuinely unknown - the process died mid-phase and may
    or may not have completed an external effect). Any phase still "pending"
    becomes "not_required" (it never started, so nothing to reconcile). The
    run itself is marked "unknown" / "interrupted_result_unknown", with its
    own completed_at taken fresh per run (not hoisted before the loop) so a
    run's completed_at never precedes the timestamp stage() just wrote onto
    one of its own phases.

    `mark_phase(run, phase, status, code)` persists just that phase's status
    (callers already have a `stage()`-shaped helper for this). It saves
    disjoint fields from the run's own status/error_code/completed_at save
    below, so the two never race over the same update_fields set.
    """
    for run in queryset:
        for phase in DEFAULT_PHASES:
            current = getattr(run, phase + "_status")
            if current == "running":
                mark_phase(run, phase, "unknown", "interrupted_result_unknown")
            elif current == "pending":
                mark_phase(run, phase, "not_required", "prior_stage_interrupted")
        run.status, run.error_code, run.completed_at = "unknown", "interrupted_result_unknown", timezone.now()
        run.save(update_fields=["status", "error_code", "completed_at"])


class LiveRunGuard:
    """Re-checks a single run's status is still in-progress, by primary key.

    This is the part of the old dingtalk_schedules.step() `channel_guard`
    closure that had nothing to do with DingTalk: a fresh read of the run
    row's status, raising if it has left IN_PROGRESS_STATUSES (edited,
    cancelled, or finished by a concurrent caller).

    It deliberately does *not* check whether the destination channel, model
    binding or any other domain fact has drifted - callers compose this with
    their own extra checks (as dingtalk_schedules.step() does) and call the
    combined guard before every external side effect. Keeping those domain
    checks out of here means a non-DingTalk scheduler can reuse this class
    without inheriting DingTalk's notion of what "live" means.
    """

    def __init__(self, manager, run_id):
        self._manager = manager
        self._run_id = run_id

    def check(self):
        status = self._manager.filter(pk=self._run_id).values_list("status", flat=True).get()
        if status not in IN_PROGRESS_STATUSES:
            raise AiError("执行槽已终止", "access_denied", 403)
        return status
