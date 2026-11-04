"""Gates ①②③ for the automation projection (B2 pilot + B4-prep chain
dispatch).

Scope: gate① started as the 京准通推广链 pilot (subject
``jd-yiyong-director``, platform 京东, shop 志高商用设备旗舰店, source
``jd_promotion`` / dataset ``ad``) and is extended here to the 京东客服链
(subject ``jd-yiyong-director``, workflow ``JdCustomerService2026``,
dataset ``customer_service``) so B4's one-week read-only observation has a
chain that is actually running in production.

Gate① is not "cross-check two self-reports" — per B0's finding, the n8n
side only ever exposes ``executionStatus``; nothing downstream parses the
business skip/duplicate/not-due semantics the pipelines emit in their HTTP
response bodies. So gate① *is* the first business judgment: it reads
business-domain evidence tables directly (read-only, no new fields, no new
write path in any business domain) and decides the business axis for a
module result on its own, independent of whatever the script claimed.

Business identity is not a single, fixed four-tuple any more. The
promotion chain's evidence lives in ``backend/netshop/`` and is keyed by
``(source, dataset, platform, shop_name)`` with batch-level
``date_min``/``date_max`` coverage. The customer-service chain's evidence
lives in the independent ``backend/customer_service/`` domain, is keyed by
``shop_name`` alone (one scope row per shop — see
``CustomerServiceImportScopeHead.shop_name`` unique constraint), has no
``date_min``/``date_max`` on its batch at all, and its coverage judgment
must instead come from the per-conversation ``consulted_at`` distribution
plus pairing-completeness counts. Forcing that shape through netshop's
batch-range fields would be wrong, so this module dispatches by
``AutomationModule.domain`` (see ``read_business_evidence_for_module``
below) to one reader function per domain. Both readers return the same
``BusinessEvidence`` dataclass; gate①/②/③ only ever touch that dataclass's
domain-agnostic surface (``is_fully_covered`` / ``has_new_batch`` /
``best_covering_batch`` / ``new_batches`` / ``covering_batches``), never a
domain-specific field directly. The promotion chain's existing behavior
(and its 22 gate test cases) is unchanged — ``read_business_evidence`` is
still the exact function those tests call, with its original positional
signature and original semantics.

Gate② (three axes must not override each other) and gate③ (dispatched N,
got 0 files -> hard failed, distinct from the no_new_needed path) are
implemented as small, independent judgment functions here plus
server-side action-authorization checks that mirror the same rules (so a
client cannot bypass the UI and issue a forbidden action directly). They
are already domain-agnostic: they only read ``BusinessEvidence`` and
``AutomationModuleResult``, never a netshop/customer-service model
directly, so extending gate① to a new domain required no change to gate②
or gate③.

Everything here only *reads* business evidence into existing
``AutomationModuleResult`` fields. It does not add fields to any business
domain (``backend/netshop/`` or ``backend/customer_service/``) and does
not write into any business-domain table.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Protocol

from customer_service.models import CustomerServiceConversation, CustomerServiceImportBatch
from netshop.models import NetshopImportBatch

from .automation_models import AutomationModuleResult


# ---------------------------------------------------------------------------
# Gate① data: read-only business evidence for one module's planned business
# date range. Domain-agnostic — populated by one reader function per
# business domain (see "Chain dispatch" section below), never written to by
# gate①/②/③ themselves.
# ---------------------------------------------------------------------------


class _EvidenceItem(Protocol):
    """Minimal shape gate①/②/③ rely on for an evidence item, regardless of
    which business domain produced it. Both ``NetshopImportBatch`` and
    ``CustomerServiceImportBatch`` satisfy this by having an ``id``; the
    "best" tie-break additionally uses ``completed_at``/``created_at`` when
    present (both models have them), falling back to ``""`` otherwise."""

    id: object


@dataclass(frozen=True)
class BusinessEvidence:
    """What gate① found in the business domain for one module's planned
    range. Pure read; never mutates any business-domain state.

    ``is_fully_covered`` and ``has_new_batch`` are plain fields (not
    properties derived from a fixed date-range formula) because each
    business domain computes "fully covered" differently: the promotion
    chain unions batch ``date_min``/``date_max`` ranges, the customer
    service chain checks the ``consulted_at`` distribution on
    ``CustomerServiceConversation`` plus pairing completeness. The reader
    function for each domain is the single place that formula lives;
    gate①/②/③ only ever consume the boolean result.
    """

    chain_key: str
    dataset: str
    subject_key: str
    range_start: str
    range_end: str

    # A. Evidence produced/attributable to "this round" (new batch inside
    # the requested range, or — for domains without a per-round batch
    # concept — any domain-specific proxy a reader chooses to populate
    # this with). Non-empty implies "something new landed".
    new_batches: list[_EvidenceItem] = field(default_factory=list)

    # B. Authoritative "no new data needed" evidence: whatever the domain
    # considers to fully/no longer need new data for the requested range.
    covering_batches: list[_EvidenceItem] = field(default_factory=list)

    # Domain-computed verdicts (see class docstring for why these are
    # plain fields rather than a single shared formula).
    is_fully_covered: bool = False
    has_new_batch: bool = False

    # Domain-specific extras the read API (automation_run_query.py) may
    # want to surface verbatim without gate①/②/③ needing to know about
    # them. Never used for judgment inside this module.
    details: dict[str, object] = field(default_factory=dict)

    @property
    def best_covering_batch(self) -> _EvidenceItem | None:
        if not self.covering_batches:
            return None
        return max(
            self.covering_batches,
            key=lambda b: (getattr(b, "completed_at", None) or "", getattr(b, "created_at", None) or ""),
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
        chain_key=source,
        dataset=dataset,
        subject_key=f"{platform}:{shop_name}",
        range_start=range_start,
        range_end=range_end,
        new_batches=new_batches,
        covering_batches=covering,
        is_fully_covered=_netshop_batches_fully_cover_range(covering, range_start, range_end),
        has_new_batch=bool(new_batches),
    )


def _netshop_batches_fully_cover_range(
    covering_batches: list[NetshopImportBatch], range_start: str, range_end: str
) -> bool:
    """True only if the union of ``covering_batches``' date ranges fully
    spans every single day in ``[range_start, range_end]``, not merely
    that at least one covering batch exists (a batch covering only part of
    the range must not count as full coverage). Unchanged from the
    original ``BusinessEvidence.is_fully_covered`` property's algorithm —
    moved here, not altered, so the 22 existing promotion-chain gate tests
    keep their original pass/fail behavior byte-for-byte."""

    if not covering_batches:
        return False
    start = date.fromisoformat(range_start)
    end = date.fromisoformat(range_end)
    covered_days: set[date] = set()
    for batch in covering_batches:
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


# ---------------------------------------------------------------------------
# 京东客服链 (customer_service domain) evidence reader. Independent reader
# function because the customer-service batch shape has no date_min/
# date_max — see this module's docstring. Read-only against
# ``backend/customer_service/``: no new fields, no write path.
# ---------------------------------------------------------------------------


def read_customer_service_evidence(
    *,
    shop_name: str,
    range_start: str,
    range_end: str,
    since_completed_at: str | None = None,
) -> BusinessEvidence:
    """Read-only query against ``CustomerServiceImportBatch`` (batch side)
    and ``CustomerServiceConversation.consulted_at`` (coverage side).
    Never writes.

    Two differences from the promotion-chain reader, both load-bearing:

    1. There is no ``date_min``/``date_max`` on
       ``CustomerServiceImportBatch`` (see ``backend/customer_service/
       models.py``'s field list — the date range only exists implicitly
       on the conversation rows a batch produced). So "fully covered"
       here is computed from the *conversation* table's ``consulted_at``
       distribution for this shop, not from any field on the batch
       itself: every calendar day in ``[range_start, range_end]`` must
       have at least one ``CustomerServiceConversation`` row whose
       ``last_import_batch_id`` points at a ``status="completed"`` batch
       for this shop.

    2. ``CustomerServiceImportScopeHead.shop_name`` is unique — the lock
       granularity is the whole shop, not "shop + date range" the way
       netshop's per-range batches are. So "new batch this round" is
       judged at the batch level (a completed batch for this shop
       completed at/after ``since_completed_at``), while "covers this
       exact day range" is judged at the conversation level — a
       deliberately asymmetric check that matches how the domain itself
       is structured, not a netshop-shaped batch-range union.

    Pairing-completeness counts (``session_only_count`` /
    ``chat_only_count`` / ``ambiguous_count``) from the most relevant
    batch are surfaced in ``BusinessEvidence.details`` for gate① (and the
    read API) to consult — see ``judge_gate1``'s customer-service branch
    and this module's docstring discussion of why non-zero pairing gaps
    must not be treated as ``verified``/``no_new_needed``.
    """

    completed_batches = CustomerServiceImportBatch.objects.filter(
        shop_name=shop_name,
        status="completed",
    ).order_by("-completed_at", "-created_at")
    completed_batches = list(completed_batches)

    start = date.fromisoformat(range_start)
    end = date.fromisoformat(range_end)
    consulted_rows = (
        CustomerServiceConversation.objects.filter(
            shop_name=shop_name,
            last_import_batch_id__in=[b.id for b in completed_batches],
            consulted_at__gte=f"{range_start} 00:00:00",
            consulted_at__lt=f"{(end + timedelta(days=1)).isoformat()} 00:00:00",
        )
        .values_list("last_import_batch_id", "consulted_at")
    )
    covered_days: set[date] = set()
    days_by_batch: dict[str, set[date]] = {}
    for batch_id, consulted_at in consulted_rows:
        try:
            day_value = date.fromisoformat(consulted_at[:10])
        except ValueError:
            continue
        covered_days.add(day_value)
        days_by_batch.setdefault(batch_id, set()).add(day_value)
    wanted_days: set[date] = set()
    day = start
    while day <= end:
        wanted_days.add(day)
        day += timedelta(days=1)
    is_fully_covered = bool(completed_batches) and wanted_days <= covered_days

    if since_completed_at:
        new_batches = [
            b for b in completed_batches if (b.completed_at and b.completed_at.isoformat() > since_completed_at)
        ]
    else:
        # Without an explicit `since`, the domain has no per-batch date
        # range to fall back on (unlike the promotion chain's batch
        # date_min/date_max), so "new this round" is judged by the one
        # directly observable signal available: the most recently
        # completed batch for this shop is "new" only if it actually
        # contributed at least one conversation inside the requested
        # range (checked against the real ``consulted_at`` rows just
        # queried above, not against the batch's own ``completed_at`` —
        # a rolling-30-day import always completes a day after its data,
        # so gating on completed_at falling inside the window would
        # wrongly report "no new batch" for every legitimate on-time run).
        most_recent = completed_batches[0] if completed_batches else None
        new_batches = (
            [most_recent]
            if most_recent and days_by_batch.get(most_recent.id)
            else []
        )

    best = completed_batches[0] if completed_batches else None
    pairing_gap = bool(
        best and (best.session_only_count or best.chat_only_count or best.ambiguous_count)
    )

    return BusinessEvidence(
        chain_key="jd_customer_service",
        dataset="customer_service",
        subject_key=f"customer_service:{shop_name}",
        range_start=range_start,
        range_end=range_end,
        new_batches=new_batches,
        covering_batches=completed_batches if is_fully_covered else [],
        is_fully_covered=is_fully_covered,
        has_new_batch=bool(new_batches),
        details={
            "sessionOnlyCount": best.session_only_count if best else None,
            "chatOnlyCount": best.chat_only_count if best else None,
            "ambiguousCount": best.ambiguous_count if best else None,
            "matchedCount": best.matched_count if best else None,
            "conversationCount": best.conversation_count if best else None,
            "pairingIncomplete": pairing_gap,
            "coveredDayCount": len(covered_days & wanted_days),
            "wantedDayCount": len(wanted_days),
        },
    )


# ---------------------------------------------------------------------------
# Chain dispatch: one reader function per business domain, selected by
# ``AutomationModule.domain`` — see this module's docstring for why the
# promotion chain and customer-service chain cannot share one query shape.
# ---------------------------------------------------------------------------


def read_business_evidence_for_module(
    *,
    domain: str,
    dataset: str,
    subject_key: str,
    range_start: str,
    range_end: str,
    since_completed_at: str | None = None,
    platform: str = "",
    shop_name: str = "",
) -> BusinessEvidence:
    """Dispatch to the correct domain reader by ``AutomationModule.domain``.

    ``platform``/``shop_name`` are only required (and only meaningful) for
    ``domain="netshop"``; ``shop_name`` alone is required for
    ``domain="customer_service"``. Callers that already know which domain
    they are in may call the domain-specific reader directly
    (``read_business_evidence`` / ``read_customer_service_evidence``) —
    this function exists for callers (e.g. a future scheduler loop) that
    only have a module registry row and must not hardcode a per-chain
    if/elif themselves.
    """

    if domain == "netshop":
        if not platform or not shop_name:
            raise ValueError("domain='netshop' 的证据查询缺少 platform 或 shop_name")
        return read_business_evidence(
            source=dataset_to_netshop_source(dataset),
            dataset=dataset,
            platform=platform,
            shop_name=shop_name,
            range_start=range_start,
            range_end=range_end,
            since_completed_at=since_completed_at,
        )
    if domain == "customer_service":
        if not shop_name:
            raise ValueError("domain='customer_service' 的证据查询缺少 shop_name")
        return read_customer_service_evidence(
            shop_name=shop_name,
            range_start=range_start,
            range_end=range_end,
            since_completed_at=since_completed_at,
        )
    raise ValueError(f"未知的业务域 domain={domain!r}，无法分派证据查询")


def dataset_to_netshop_source(dataset: str) -> str:
    """``NetshopImportBatch.source`` is not always equal to the module's
    ``dataset`` value (the pilot module uses ``source=jd_promotion`` /
    ``dataset=ad`` — see B2 反审 §三, where getting this mapping backwards
    was flagged as the easiest way to silently query zero rows). This
    function is the single place that mapping lives for dispatch callers;
    direct callers of ``read_business_evidence`` continue to pass
    ``source=`` explicitly and do not go through this mapping."""

    if dataset == "ad":
        return "jd_promotion"
    return dataset


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

    if evidence.is_fully_covered and evidence.details.get("pairingIncomplete"):
        # 京东客服链 only: the date range is covered by conversation rows,
        # but the covering batch's session_only/chat_only/ambiguous
        # pairing counts are non-zero — some conversations in this exact
        # range could not be fully reconciled between the two source
        # files. This is deliberately downgraded to `partial`, not
        # `verified`/`no_new_needed`: those two outcomes both assert "the
        # evidence for this range is trustworthy as-is", which a
        # non-trivial unresolved-pairing count directly contradicts (see
        # this module's docstring / the task's mapping discussion for the
        # full reasoning). The batch id is still surfaced via
        # ``new_batches``/``netshop_import_batch_id`` so the read API can
        # show which batch has the gap.
        covering = evidence.best_covering_batch
        assert covering is not None
        return Gate1Judgment(
            business_state=GATE1_PARTIAL,
            execution_state=None,
            reused_batch_id="",
            reused_coverage_revision="",
            netshop_import_batch_id=str(covering.id),
            reason="pairing_incomplete_session_or_chat_only_or_ambiguous",
        )

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
