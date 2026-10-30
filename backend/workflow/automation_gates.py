"""Gates ①②③ for the automation projection (B2).

Scope for this unit (see docs/autoimport-workflow-unification-20261029/
REPORT.md §5, §4.2 and 京东单店试点.md §三): the 京准通推广链 pilot,
subject ``jd-yiyong-director`` (platform 京东, shop 志高商用设备旗舰店),
source ``jd_promotion`` / dataset ``ad``.

Gate① is not "cross-check two self-reports" — per B0's finding, the n8n
side only ever exposes ``executionStatus``; nothing downstream parses the
business skip/duplicate/not-due semantics the pipelines emit in their HTTP
response bodies. So gate① *is* the first business judgment: it reads
``backend/netshop/`` evidence tables directly (read-only, no new fields,
no new netshop write path) and decides the business axis for a module
result on its own, independent of whatever the script claimed.

Gate② (three axes must not override each other) and gate③ (dispatched N,
got 0 files -> hard failed, distinct from the no_new_needed path) are
implemented as small, independent judgment functions here plus
server-side action-authorization checks that mirror the same rules (so a
client cannot bypass the UI and issue a forbidden action directly).

Everything here only *reads* netshop evidence into existing
``AutomationModuleResult`` fields. It does not add fields to
``backend/netshop/`` and does not write into any netshop table.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from django.db.models import Max, Min

from netshop.models import NetshopImportBatch

from .automation_models import AutomationModuleResult


# ---------------------------------------------------------------------------
# Gate① data: read-only netshop business evidence for one module's planned
# business date range.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BusinessEvidence:
    """What gate① found in the business domain for one module's planned
    range. Pure read; never mutates netshop state."""

    source: str
    dataset: str
    platform: str
    shop_name: str
    range_start: str
    range_end: str

    # A. A newly completed batch (status="completed") whose own date_min/
    # date_max falls inside the requested range and was completed at or
    # after ``since`` (so an old, unrelated historical batch cannot be
    # mistaken for "this round's" evidence).
    new_batches: list[NetshopImportBatch] = field(default_factory=list)

    # B. Authoritative "no new data needed" evidence: any completed batch
    # (old or new) whose date_min/date_max fully covers the requested
    # range. If this is non-empty, every day in the requested range is
    # already backed by a completed batch.
    covering_batches: list[NetshopImportBatch] = field(default_factory=list)

    @property
    def has_new_batch(self) -> bool:
        return bool(self.new_batches)

    @property
    def is_fully_covered(self) -> bool:
        """True only if the union of covering_batches' date ranges fully
        spans every single day in [range_start, range_end], not merely
        that at least one covering batch exists (a batch covering only
        part of the range must not count as full coverage)."""
        if not self.covering_batches:
            return False
        start = date.fromisoformat(self.range_start)
        end = date.fromisoformat(self.range_end)
        covered_days: set[date] = set()
        for batch in self.covering_batches:
            if not batch.date_min or not batch.date_max:
                continue
            b_start = max(date.fromisoformat(batch.date_min), start)
            b_end = min(date.fromisoformat(batch.date_max), end)
            day = b_start
            while day <= b_end:
                covered_days.add(day)
                day += timedelta(days=1)
        wanted = set()
        day = start
        while day <= end:
            wanted.add(day)
            day += timedelta(days=1)
        return wanted <= covered_days

    @property
    def best_covering_batch(self) -> NetshopImportBatch | None:
        if not self.covering_batches:
            return None
        return max(
            self.covering_batches,
            key=lambda b: (b.completed_at or "", b.created_at or ""),
        )


def read_business_evidence(
    *,
    source: str,
    dataset: str,
    platform: str,
    shop_name: str,
    range_start: str,
    range_end: str,
    since_completed_at: str | None = None,
) -> BusinessEvidence:
    """Read-only query against ``NetshopImportBatch``. Never writes.

    ``since_completed_at`` (ISO datetime string, exclusive lower bound) is
    used to distinguish "a batch this round actually produced" (new) from
    "an old batch happens to exist" (reused/no_new_needed evidence) when a
    caller wants that distinction; when omitted, ``new_batches`` only
    reflects batches whose own date range sits inside the requested range
    (a weaker signal, still business-domain only).
    """

    completed = NetshopImportBatch.objects.filter(
        source=source,
        dataset=dataset,
        platform=platform,
        shop_name=shop_name,
        status="completed",
    )

    # B: batches covering (fully or partially) the requested range.
    covering = list(
        completed.filter(
            date_min__isnull=False,
            date_max__isnull=False,
            date_min__lte=range_end,
            date_max__gte=range_start,
        ).order_by("-completed_at", "-created_at")
    )

    # A: among those, ones completed after `since_completed_at` are "new
    # this round". Without a `since`, fall back to batches whose own range
    # sits entirely inside the requested window (still a legitimate "new
    # batch" signal for a single-day plan where range == batch range).
    if since_completed_at:
        new_batches = [
            b for b in covering if (b.completed_at or "") > since_completed_at
        ]
    else:
        new_batches = [
            b
            for b in covering
            if b.date_min
            and b.date_max
            and b.date_min >= range_start
            and b.date_max <= range_end
        ]

    return BusinessEvidence(
        source=source,
        dataset=dataset,
        platform=platform,
        shop_name=shop_name,
        range_start=range_start,
        range_end=range_end,
        new_batches=new_batches,
        covering_batches=covering,
    )


# ---------------------------------------------------------------------------
# Gate①: judge a module result's business axis from evidence alone — never
# from any script/pipeline self-reported "ok"/"skip"/"duplicate" field.
# ---------------------------------------------------------------------------

GATE1_VERIFIED = "verified"
GATE1_PARTIAL = "partial"
GATE1_NO_NEW_NEEDED = "no_new_needed"
GATE1_GAP_REMAINING = "gap_remaining"
GATE1_FAILED_EXECUTION = "failed"  # written to execution_state, not business_state


@dataclass(frozen=True)
class Gate1Judgment:
    business_state: str
    execution_state: str | None  # None means "do not override the caller's execution_state"
    reused_batch_id: str
    reused_coverage_revision: str
    netshop_import_batch_id: str
    reason: str


def judge_gate1(
    evidence: BusinessEvidence,
    *,
    script_reported_ok: bool,
    files_obtained: int,
    modules_dispatched: int = 1,
) -> Gate1Judgment:
    """The core of gate①.

    ``script_reported_ok`` and ``files_obtained`` describe what the n8n
    side *claimed*/produced — they are inputs this function is allowed to
    see (a module did run, and how many files it says it fetched) but they
    are never, by themselves, sufficient to mark business success. The
    business_state this function returns is derived only from
    ``evidence`` (the business-domain query result). If the script claims
    ok but evidence shows neither a new batch nor full coverage, that is
    gate①'s core catch: judged ``failed``, not ``finished``/``done``.
    """

    if evidence.is_fully_covered:
        covering = evidence.best_covering_batch
        assert covering is not None
        if evidence.has_new_batch:
            # A new batch exists AND it (plus siblings) fully covers the
            # range -> genuine new import, verified.
            return Gate1Judgment(
                business_state=GATE1_VERIFIED,
                execution_state=None,
                reused_batch_id="",
                reused_coverage_revision="",
                netshop_import_batch_id=str(covering.id),
                reason="new_batch_full_coverage",
            )
        # Fully covered but no batch from this round: this is the
        # authoritative "no new data needed" path (no_gap / not_due /
        # duplicate content all land here because they all mean "the
        # existing completed batch already covers this exact range").
        return Gate1Judgment(
            business_state=GATE1_NO_NEW_NEEDED,
            execution_state=None,
            reused_batch_id=str(covering.id),
            reused_coverage_revision=covering.published_state_token or covering.content_hash,
            netshop_import_batch_id=str(covering.id),
            reason="no_gap_or_not_due_or_duplicate_content",
        )

    if evidence.has_new_batch:
        # Partial progress: at least one new batch landed but the full
        # requested range is not yet covered.
        return Gate1Judgment(
            business_state=GATE1_PARTIAL,
            execution_state=None,
            reused_batch_id="",
            reused_coverage_revision="",
            netshop_import_batch_id=str(evidence.new_batches[0].id),
            reason="new_batch_partial_coverage",
        )

    # Neither a new batch nor full coverage exists. Gate③: if the round
    # dispatched modules expecting files and got zero files, that is a
    # hard failure regardless of what the script claimed.
    if modules_dispatched > 0 and files_obtained == 0:
        return Gate1Judgment(
            business_state=GATE1_GAP_REMAINING,
            execution_state="failed",
            reused_batch_id="",
            reused_coverage_revision="",
            netshop_import_batch_id="",
            reason="zero_files_obtained_no_evidence",
        )

    # The catch-all false-green case: script said ok, but the business
    # domain shows no new batch and no authoritative no-new-needed
    # evidence. Judged failed, never finished/done.
    if script_reported_ok:
        return Gate1Judgment(
            business_state=GATE1_GAP_REMAINING,
            execution_state="failed",
            reused_batch_id="",
            reused_coverage_revision="",
            netshop_import_batch_id="",
            reason="script_ok_but_no_business_evidence",
        )

    return Gate1Judgment(
        business_state=GATE1_GAP_REMAINING,
        execution_state=None,
        reused_batch_id="",
        reused_coverage_revision="",
        netshop_import_batch_id="",
        reason="script_reported_failure_and_no_evidence",
    )


def apply_gate1(
    result: AutomationModuleResult,
    evidence: BusinessEvidence,
    *,
    script_reported_ok: bool,
    files_obtained: int,
    modules_dispatched: int = 1,
) -> Gate1Judgment:
    """Apply gate① to a persisted ``AutomationModuleResult`` row in place
    (caller is responsible for ``.save()``). Never writes to netshop."""

    judgment = judge_gate1(
        evidence,
        script_reported_ok=script_reported_ok,
        files_obtained=files_obtained,
        modules_dispatched=modules_dispatched,
    )
    result.business_state = judgment.business_state
    if judgment.execution_state is not None:
        result.execution_state = judgment.execution_state
    result.reused_batch_id = judgment.reused_batch_id
    result.reused_coverage_revision = judgment.reused_coverage_revision
    result.netshop_import_batch_id = judgment.netshop_import_batch_id
    result.evidence_state = "verified"
    result.evidence_source = "netshop_import_batch"
    return judgment


# ---------------------------------------------------------------------------
# Gate②: three axes must not override each other. These are read-only
# predicate functions used by both the (future) presentation layer and by
# server-side action authorization — the latter is the hard requirement
# (「不能只在前端隐藏，服务端也要拒」).
# ---------------------------------------------------------------------------


def may_display_as_completed(result: AutomationModuleResult) -> bool:
    """Execution finished + business gap_remaining must not display as
    "completed"."""

    if result.business_state == "gap_remaining":
        return False
    if result.business_state == "submitted_unverified":
        return False
    return result.execution_state == "finished" and result.business_state in (
        "verified",
        "no_new_needed",
    )


def may_rerun_import(result: AutomationModuleResult) -> bool:
    """Business verified + delivery failed must not offer "rerun import" —
    only delivery recovery is allowed. Also false whenever business_state
    already verified/no_new_needed (nothing to re-import), or execution is
    in a state where a normal retry is disallowed (gate② items 3/4)."""

    if result.business_state in ("verified", "no_new_needed"):
        return False
    if result.execution_state in ("result_unknown", "needs_human"):
        return False
    return True


def may_retry_delivery(result: AutomationModuleResult) -> bool:
    """The only recovery action allowed when business is verified but
    delivery failed."""

    return result.delivery_state in ("failed", "unknown") and result.business_state in (
        "verified",
        "no_new_needed",
    )


def may_normal_retry(result: AutomationModuleResult) -> bool:
    """Gate② items 3 & 4: result_unknown disables normal retry (must use
    a verifiable-recovery entry instead); needs_human disables automatic
    retry entirely."""

    return result.execution_state not in ("result_unknown", "needs_human")


def requires_verifiable_recovery_entry(result: AutomationModuleResult) -> bool:
    """execution_state == result_unknown must surface a verifiable-lookup
    entry point instead of a plain retry button."""

    return result.execution_state == "result_unknown"


def is_failure_for_alerting(result: AutomationModuleResult) -> bool:
    """Gate② item 5: no_new_needed must never display as a failure (and
    must never be reported as a fresh import, either — callers checking
    ``business_state == "no_new_needed"`` directly already get that; this
    helper is for alert/failure-count surfaces)."""

    if result.business_state == "no_new_needed":
        return False
    return result.execution_state == "failed" or result.business_state == "gap_remaining"


def is_verified_for_display(result: AutomationModuleResult) -> bool:
    """Gate② item 6: submitted_unverified must never be treated as
    verified."""

    return result.business_state == "verified"


# ---------------------------------------------------------------------------
# Gate③: dispatched N modules, got 0 files -> hard failed. Not partial, not
# finished. Distinct code path from gate①'s no_new_needed (the two must not
# be able to produce the same outcome from different reasons).
# ---------------------------------------------------------------------------


def judge_gate3(*, modules_dispatched: int, files_obtained: int, evidence: BusinessEvidence) -> str | None:
    """Returns the forced execution_state when gate③ fires, or None when
    gate③ does not apply (either files were obtained, or the zero-files
    outcome is legitimately explained by no_new_needed evidence).

    This function is the single place both gate① and any direct caller
    must route through for the "0 files" question, so gate③ and
    no_new_needed cannot independently reach contradictory conclusions
    about the same round.
    """

    if files_obtained > 0:
        return None
    if modules_dispatched <= 0:
        return None
    if evidence.is_fully_covered:
        # Zero files is the *correct* outcome here (no gap / not due /
        # duplicate content) — gate③ must not fire.
        return None
    return "failed"
