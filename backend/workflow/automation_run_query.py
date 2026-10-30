"""Read-only, server-side-paginated projection over the automation run
tables (B1 models + B2 gates) for the B3 read API.

Scope (see docs/autoimport-workflow-unification-20261029/REPORT.md §4.3,
B2-闸与三轴-反审.md §五 and the B3 task prompt): four-level drill-down —
logical run -> execution attempt -> module result -> batch/coverage
evidence — with server-side filtering, pagination and a hard cap. This
module never writes to any table (automation or netshop) and never
implements an action endpoint; gate② predicates are only ever *read* here,
never re-derived.

Three axes stay independently filterable (``execution_state`` /
``business_state`` / ``delivery_state``) because B1/B2 explicitly design
against collapsing them into one status — see automation_models.py's
module docstring and REPORT.md §4.2.

Known, disclosed limits this module must not paper over (B2 反审 §五):
1. "未到期" has no independent business signal. ``business_state ==
   "no_new_needed"`` already merges "no gap" and "not due" into one
   evidence shape; this module exposes that merge as-is via
   ``coverage.note`` rather than inventing an unsupported sub-category.
2. Coverage evidence is batch-level (``date_min``/``date_max``), not a
   per-day existence check. Every exposed evidence block says
   ``granularity: "batch"`` and the human-readable note says "批次级覆盖"
   rather than "逐日已核验".
3. Gate② server-side rejection exists only at the predicate layer
   (``automation_gates.py``); there is no action API yet (P2). The
   ``availableActions`` block below calls those existing predicates
   read-only to tell the frontend what *would* be allowed, but this unit
   implements no endpoint that performs any of them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from django.core.exceptions import ValidationError
from django.db.models import Count, Max, Q, QuerySet

from customer_service.models import CustomerServiceImportBatch

from .automation_gates import (
    is_failure_for_alerting,
    is_verified_for_display,
    may_display_as_completed,
    may_normal_retry,
    may_rerun_import,
    may_retry_delivery,
    requires_verifiable_recovery_entry,
)
from .automation_models import (
    BUSINESS_AXIS_CHOICES,
    DELIVERY_AXIS_CHOICES,
    EXECUTION_AXIS_CHOICES,
    AutomationAttempt,
    AutomationLogicalRun,
    AutomationModule,
    AutomationModuleResult,
)
from .errors import WorkflowApiError

# Hard upper bounds. Any request asking for more is rejected outright
# (never silently clamped) so a caller cannot be fooled into thinking a
# smaller number was the true size of a larger result.
MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50
MAX_OFFSET = 50_000

EXECUTION_VALUES = {value for value, _ in EXECUTION_AXIS_CHOICES}
BUSINESS_VALUES = {value for value, _ in BUSINESS_AXIS_CHOICES}
DELIVERY_VALUES = {value for value, _ in DELIVERY_AXIS_CHOICES}

# Gate② item 3: result_unknown disables normal retry and must be
# recovered through a verifiable-lookup path, never a plain retry button.
STUCK_CONSECUTIVE_ATTEMPTS = 3
STUCK_MINUTES = 30


def _unavailable(message: str = "暂时无法读取自动化运行投影，不能据此判断运行是否完成。") -> WorkflowApiError:
    return WorkflowApiError(message, code="automation_projection_unavailable", status=503)


@dataclass(frozen=True)
class RunListOptions:
    subject_key: str | None
    chain_key: str | None
    plan_date_from: date | None
    plan_date_to: date | None
    execution_states: tuple[str, ...]
    business_states: tuple[str, ...]
    delivery_states: tuple[str, ...]
    exception_category: str | None  # needs_human | result_unknown | stuck
    page: int
    page_size: int


def parse_run_list_options(params: dict[str, str | None], *, page: int, page_size: int) -> RunListOptions:
    if not (1 <= page_size <= MAX_PAGE_SIZE):
        raise _bad_request(f"pageSize 必须在 1-{MAX_PAGE_SIZE} 之间")
    if page < 1:
        raise _bad_request("page 必须为正整数")
    if (page - 1) * page_size > MAX_OFFSET:
        raise _bad_request(f"分页偏移不能超过 {MAX_OFFSET}")

    def _states(value: str | None, allowed: set[str], label: str) -> tuple[str, ...]:
        if not value:
            return ()
        values = tuple(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
        if len(values) > 20 or any(item not in allowed for item in values):
            raise _bad_request(f"{label}筛选无效")
        return values

    def _plan_date(value: str | None, label: str) -> date | None:
        if not value:
            return None
        try:
            parsed = date.fromisoformat(value)
        except ValueError as error:
            raise _bad_request(f"{label}必须为真实的 YYYY-MM-DD 日期") from error
        if parsed.isoformat() != value:
            raise _bad_request(f"{label}必须为真实的 YYYY-MM-DD 日期")
        return parsed

    plan_date_from = _plan_date(params.get("planDateFrom"), "计划开始日期")
    plan_date_to = _plan_date(params.get("planDateTo"), "计划结束日期")
    if plan_date_from and plan_date_to and plan_date_from > plan_date_to:
        raise _bad_request("计划日期范围必须满足开始日期不晚于结束日期")

    exception_category = params.get("exceptionCategory") or None
    if exception_category is not None and exception_category not in ("needs_human", "result_unknown", "stuck"):
        raise _bad_request("exceptionCategory 必须是 needs_human、result_unknown 或 stuck")

    subject_key = (params.get("subjectKey") or "").strip() or None
    if subject_key is not None and len(subject_key) > 120:
        raise _bad_request("subjectKey 过长")
    chain_key = (params.get("chainKey") or "").strip() or None
    if chain_key is not None and len(chain_key) > 80:
        raise _bad_request("chainKey 过长")

    return RunListOptions(
        subject_key=subject_key,
        chain_key=chain_key,
        plan_date_from=plan_date_from,
        plan_date_to=plan_date_to,
        execution_states=_states(params.get("executionState"), EXECUTION_VALUES, "执行状态"),
        business_states=_states(params.get("businessState"), BUSINESS_VALUES, "业务状态"),
        delivery_states=_states(params.get("deliveryState"), DELIVERY_VALUES, "投递状态"),
        exception_category=exception_category,
        page=page,
        page_size=page_size,
    )


def _bad_request(message: str) -> WorkflowApiError:
    return WorkflowApiError(message, code="invalid_request", status=400)


def _pagination(total: int, returned: int, offset: int, page: int, page_size: int) -> dict[str, object]:
    truncated = offset + returned < total
    return {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "returned": returned,
        "truncated": truncated,
        # Explicit, hard-to-miss guard against reading a truncated page as
        # the complete set — in particular against inferring "no failures"
        # from a truncated slice (B3 task hard requirement).
        "completeness": "complete" if not truncated else "truncated_do_not_infer_absence",
    }


def _result_filters(options: RunListOptions) -> Q:
    query = Q()
    if options.subject_key:
        query &= Q(subject_key=options.subject_key)
    if options.execution_states:
        query &= Q(execution_state__in=options.execution_states)
    if options.business_states:
        query &= Q(business_state__in=options.business_states)
    if options.delivery_states:
        query &= Q(delivery_state__in=options.delivery_states)
    if options.exception_category == "needs_human":
        query &= Q(execution_state="needs_human")
    elif options.exception_category == "result_unknown":
        query &= Q(execution_state="result_unknown")
    return query


def _run_filters(options: RunListOptions) -> Q:
    query = Q()
    if options.chain_key:
        query &= Q(chain_key=options.chain_key)
    if options.subject_key:
        query &= Q(subject_key=options.subject_key)
    if options.plan_date_from:
        query &= Q(plan_date__gte=options.plan_date_from)
    if options.plan_date_to:
        query &= Q(plan_date__lte=options.plan_date_to)
    return query


def _stuck_run_ids(base_runs: QuerySet[AutomationLogicalRun], *, now: datetime) -> set:
    """同一卡点连续 3 次检查没有实质进展，或持续 30 分钟没有实质进展
    （docs/自动化/通用/workflow-dingtalk-notifications.md）。这里把"检查"
    对应到同一 logical_run 下同一 stage 的连续 attempt，"没有实质进展"
    对应到该 attempt 没有产出新的 finished_at 推进（即持续 failed/未结束）。
    只读 AutomationAttempt，不新增字段、不写回。
    """
    stuck_ids: set = set()
    attempts = (
        AutomationAttempt.objects.filter(logical_run__in=base_runs)
        .order_by("logical_run_id", "stage", "created_at")
        .values("logical_run_id", "stage", "created_at", "started_at", "finished_at", "error_class")
    )
    grouped: dict[tuple, list[dict]] = {}
    for attempt in attempts:
        grouped.setdefault((attempt["logical_run_id"], attempt["stage"]), []).append(attempt)
    for (run_id, _stage), rows in grouped.items():
        # Only attempts that never produced a clean finish (still erroring
        # or still open) count toward "no substantive progress".
        blocked = [row for row in rows if row["error_class"] or row["finished_at"] is None]
        if len(blocked) >= STUCK_CONSECUTIVE_ATTEMPTS:
            stuck_ids.add(run_id)
            continue
        if blocked:
            earliest = min(row["started_at"] or row["created_at"] for row in blocked)
            if earliest and (now - earliest) >= timedelta(minutes=STUCK_MINUTES):
                stuck_ids.add(run_id)
    return stuck_ids


def list_logical_runs(options: RunListOptions, *, now: datetime | None = None) -> dict[str, object]:
    """Level 1: logical runs. Filterable by subject/chain/plan_date; the
    three axes are filtered against each run's module results (a run
    matches if *any* of its results matches), since ``overall_status``
    only carries the execution axis.
    """

    if not (1 <= options.page_size <= MAX_PAGE_SIZE):
        raise _bad_request(f"pageSize 必须在 1-{MAX_PAGE_SIZE} 之间")
    if options.page < 1:
        raise _bad_request("page 必须为正整数")
    now = now or datetime.now(timezone.utc)
    try:
        base = AutomationLogicalRun.objects.filter(_run_filters(options))
        result_filter = _result_filters(options)
        has_axis_filter = bool(
            options.execution_states or options.business_states or options.delivery_states or options.exception_category
        )
        if has_axis_filter:
            matching_run_ids = set(
                AutomationModuleResult.objects.filter(result_filter, logical_run__in=base)
                .values_list("logical_run_id", flat=True)
                .distinct()
            )
            if options.exception_category == "stuck":
                stuck_ids = _stuck_run_ids(base, now=now)
                matching_run_ids = matching_run_ids | stuck_ids if (
                    options.execution_states or options.business_states or options.delivery_states
                ) else stuck_ids
            base = base.filter(logical_run_id__in=matching_run_ids)
        elif options.exception_category == "stuck":
            stuck_ids = _stuck_run_ids(base, now=now)
            base = base.filter(logical_run_id__in=stuck_ids)

        total = base.count()
        offset = (options.page - 1) * options.page_size
        ordered = base.order_by("-plan_date", "-created_at", "-logical_run_id")
        page_rows = list(ordered[offset : offset + options.page_size])

        run_ids = [row.logical_run_id for row in page_rows]
        result_counts = {
            run_id: {"moduleResultCount": count}
            for run_id, count in AutomationModuleResult.objects.filter(logical_run_id__in=run_ids)
            .values_list("logical_run_id")
            .annotate(count=Count("id"))
        }
        attempt_counts = dict(
            AutomationAttempt.objects.filter(logical_run_id__in=run_ids)
            .values_list("logical_run_id")
            .annotate(count=Count("attempt_id"))
        )

        items = []
        for row in page_rows:
            items.append(
                {
                    "logicalRunId": str(row.logical_run_id),
                    "chainKey": row.chain_key,
                    "subjectKey": row.subject_key,
                    "planDate": row.plan_date.isoformat(),
                    "triggerSource": row.trigger_source,
                    "overallStatus": row.overall_status,
                    "moduleResultCount": result_counts.get(row.logical_run_id, {}).get("moduleResultCount", 0),
                    "attemptCount": attempt_counts.get(row.logical_run_id, 0),
                    "createdAt": row.created_at.isoformat(),
                    "updatedAt": row.updated_at.isoformat(),
                }
            )
        return {"items": items, "pagination": _pagination(total, len(items), offset, options.page, options.page_size)}
    except (ValidationError, ValueError, TypeError) as error:
        raise _unavailable() from error


def list_attempts(logical_run_id: str, *, page: int, page_size: int) -> dict[str, object]:
    """Level 2: execution attempts under one logical run, oldest parent
    first via ``created_at`` (the recovery chain 1268 -> 1287 -> 1303
    shape)."""

    if not (1 <= page_size <= MAX_PAGE_SIZE):
        raise _bad_request(f"pageSize 必须在 1-{MAX_PAGE_SIZE} 之间")
    if page < 1:
        raise _bad_request("page 必须为正整数")
    try:
        base = AutomationAttempt.objects.filter(logical_run_id=logical_run_id).order_by("created_at")
        total = base.count()
        offset = (page - 1) * page_size
        rows = list(base[offset : offset + page_size])
        items = [
            {
                "attemptId": str(row.attempt_id),
                "nativeWorkflowId": row.native_workflow_id,
                "nativeExecutionId": row.native_execution_id,
                "parentAttemptId": str(row.parent_attempt_id) if row.parent_attempt_id else None,
                "recoveryReason": row.recovery_reason,
                "stage": row.stage,
                "startedAt": row.started_at.isoformat() if row.started_at else None,
                "finishedAt": row.finished_at.isoformat() if row.finished_at else None,
                "errorClass": row.error_class,
                "createdAt": row.created_at.isoformat(),
            }
            for row in rows
        ]
        return {"items": items, "pagination": _pagination(total, len(items), offset, page, page_size)}
    except (ValidationError, ValueError, TypeError) as error:
        raise _unavailable() from error


def list_module_results(logical_run_id: str, *, page: int, page_size: int) -> dict[str, object]:
    """Level 3: per-module results under one logical run, with gate②
    predicates read (never re-derived) alongside each row so the frontend
    does not need its own copy of the override rules."""

    if not (1 <= page_size <= MAX_PAGE_SIZE):
        raise _bad_request(f"pageSize 必须在 1-{MAX_PAGE_SIZE} 之间")
    if page < 1:
        raise _bad_request("page 必须为正整数")
    try:
        base = AutomationModuleResult.objects.filter(logical_run_id=logical_run_id).order_by("module_key", "date_range")
        total = base.count()
        offset = (page - 1) * page_size
        rows = list(base[offset : offset + page_size])
        # Batch-fetch each row's module domain once per page (not once per
        # row) so the read surface can pick the right evidence field shape
        # (netshop batch vs. customer-service pairing) without an N+1
        # query. A module_key missing from the registry (should not
        # happen once B4's three customer-service modules are seeded, but
        # defensive here) falls back to the netshop shape, matching this
        # unit's original pre-dispatch behavior.
        domain_by_module_key = dict(
            AutomationModule.objects.filter(
                module_key__in={row.module_key for row in rows}
            ).values_list("module_key", "domain")
        )
        items = [_module_result_item(row, domain_by_module_key.get(row.module_key, "netshop")) for row in rows]
        return {"items": items, "pagination": _pagination(total, len(items), offset, page, page_size)}
    except (ValidationError, ValueError, TypeError) as error:
        raise _unavailable() from error


def _module_result_item(row: AutomationModuleResult, domain: str = "netshop") -> dict[str, object]:
    return {
        "id": row.id,
        "logicalRunId": str(row.logical_run_id),
        "moduleKey": row.module_key,
        "subjectKey": row.subject_key,
        "dataset": row.dataset,
        "dateRange": row.date_range,
        "phaseStatus": {
            "download": row.download_status,
            "validate": row.validate_status,
            "import": row.import_status,
            "verify": row.verify_status,
            "release": row.release_status,
        },
        "axes": {
            "executionState": row.execution_state,
            "businessState": row.business_state,
            "deliveryState": row.delivery_state,
        },
        # Read-only gate② predicates — never re-derived, never re-written.
        # P2 (action API) will call the exact same functions server-side;
        # this read surface only reports what they currently say.
        "availableActions": {
            "mayDisplayAsCompleted": may_display_as_completed(row),
            "mayRerunImport": may_rerun_import(row),
            "mayRetryDelivery": may_retry_delivery(row),
            "mayNormalRetry": may_normal_retry(row),
            "requiresVerifiableRecoveryEntry": requires_verifiable_recovery_entry(row),
            "isFailureForAlerting": is_failure_for_alerting(row),
            "isVerifiedForDisplay": is_verified_for_display(row),
        },
        "evidence": _coverage_evidence(row, domain),
        "updatedAt": row.updated_at.isoformat(),
    }


def _coverage_evidence(row: AutomationModuleResult, domain: str = "netshop") -> dict[str, object]:
    """Batch/coverage evidence for one module result, shaped by business
    domain (``AutomationModule.domain`` — see ``list_module_results``'s
    batch domain lookup). The two domains this unit supports have
    genuinely different evidence shapes and must not be forced through
    one field set:

    * ``netshop`` (promotion chain): batch-level ``date_min``/``date_max``
      coverage. Deliberately labeled ``granularity: "batch"`` — the
      underlying judgment (automation_gates.BusinessEvidence.
      is_fully_covered for this domain) only compares a batch's own
      date_min/date_max against the requested range, so a hole in the
      middle of a batch's own range is not detectable here. See B2 反审
      §五·局限一; this field exists specifically so a caller cannot read
      this response and believe every day was individually checked.
    * ``customer_service`` (customer service chain): no date_min/date_max
      exists on the batch at all (see automation_gates.
      read_customer_service_evidence's docstring), so this domain's
      shape instead reports the double-file pairing counts
      (session_only/chat_only/ambiguous) alongside the same
      granularity/evidence-state fields, under ``pairing`` rather than
      inventing new top-level field names that would collide with the
      netshop shape's semantics.
    """

    if domain == "customer_service":
        return _customer_service_coverage_evidence(row)
    return _netshop_coverage_evidence(row)


def _netshop_coverage_evidence(row: AutomationModuleResult) -> dict[str, object]:
    has_reused = bool(row.reused_batch_id)
    has_current = bool(row.netshop_import_batch_id) and not has_reused
    note = "批次级覆盖证据：仅表示该批次的 date_min/date_max 覆盖了请求范围，不代表区间内逐日已核验数据存在。"
    if row.business_state == "no_new_needed":
        note += " no_new_needed 合并了「无缺口」与「未到期」两种情形——本系统对未到期没有独立的业务信号，不在此处拆分子类。"
    return {
        "granularity": "batch",
        "evidenceState": row.evidence_state,
        "evidenceSource": row.evidence_source,
        "evidenceObservedAt": row.evidence_observed_at.isoformat() if row.evidence_observed_at else None,
        "netshopImportBatchId": row.netshop_import_batch_id or None,
        "reusedBatchId": row.reused_batch_id or None,
        "reusedCoverageRevision": row.reused_coverage_revision or None,
        "currentRawFileSha256": row.current_raw_file_sha256 or None,
        "currentContentFingerprint": row.current_content_fingerprint or None,
        "currentRowCount": row.current_row_count,
        "currentWarningCount": row.current_warning_count,
        "isReusedEvidence": has_reused,
        "isCurrentUploadEvidence": has_current,
        "note": note,
    }


def _customer_service_coverage_evidence(row: AutomationModuleResult) -> dict[str, object]:
    """客服链证据形态：没有 date_min/date_max，覆盖判据来自
    ``CustomerServiceConversation.consulted_at`` 分布（见
    automation_gates.read_customer_service_evidence）；本函数只读取该
    判据已经写入 ``AutomationModuleResult`` 的批次 id 引用，再反查对应
    ``CustomerServiceImportBatch`` 的配对计数作展示，不重新做覆盖判断。"""

    has_reused = bool(row.reused_batch_id)
    batch_id = row.reused_batch_id or row.netshop_import_batch_id
    pairing: dict[str, object] = {
        "sessionOnlyCount": None,
        "chatOnlyCount": None,
        "ambiguousCount": None,
        "matchedCount": None,
        "conversationCount": None,
        "incomplete": None,
    }
    if batch_id:
        batch = (
            CustomerServiceImportBatch.objects.filter(id=batch_id)
            .values(
                "session_only_count",
                "chat_only_count",
                "ambiguous_count",
                "matched_count",
                "conversation_count",
            )
            .first()
        )
        if batch:
            pairing = {
                "sessionOnlyCount": batch["session_only_count"],
                "chatOnlyCount": batch["chat_only_count"],
                "ambiguousCount": batch["ambiguous_count"],
                "matchedCount": batch["matched_count"],
                "conversationCount": batch["conversation_count"],
                "incomplete": bool(
                    batch["session_only_count"] or batch["chat_only_count"] or batch["ambiguous_count"]
                ),
            }
    note = (
        "客服链覆盖证据：覆盖判据来自 CustomerServiceConversation.consulted_at 的逐日分布，"
        "该批次本身没有 date_min/date_max 字段。business_state=partial 且 pairing.incomplete=true "
        "时表示该批次 session_only/chat_only/ambiguous 非零，部分会话未能在双文件间完整配对，"
        "不代表数据缺失，而是配对结果需要人工复核。"
    )
    if row.business_state == "no_new_needed":
        note += " no_new_needed 合并了「无缺口」与「未到期」两种情形——本系统对未到期没有独立的业务信号，不在此处拆分子类。"
    return {
        "granularity": "pairing",
        "evidenceState": row.evidence_state,
        "evidenceSource": row.evidence_source,
        "evidenceObservedAt": row.evidence_observed_at.isoformat() if row.evidence_observed_at else None,
        "customerServiceImportBatchId": batch_id or None,
        "reusedBatchId": row.reused_batch_id or None,
        "reusedCoverageRevision": row.reused_coverage_revision or None,
        "isReusedEvidence": has_reused,
        "pairing": pairing,
        "note": note,
    }


def exception_summary(options: RunListOptions, *, now: datetime | None = None) -> dict[str, object]:
    """"待人工 / 持续阻塞 / 无法核实" 三类及各自数量.

    Mapping (per task prompt): needs_human -> 待人工; result_unknown ->
    无法核实; 持续阻塞 uses the same consecutive-attempt/30-minute judge as
    ``docs/自动化/通用/workflow-dingtalk-notifications.md``. Categories are
    not mutually exclusive by construction (a run could in principle be
    both needs_human and stuck); counts below are per-category, each
    computed from the same filtered base-run set.
    """

    now = now or datetime.now(timezone.utc)
    try:
        base_runs = AutomationLogicalRun.objects.filter(_run_filters(options))
        needs_human_run_ids = set(
            AutomationModuleResult.objects.filter(execution_state="needs_human", logical_run__in=base_runs)
            .values_list("logical_run_id", flat=True)
            .distinct()
        )
        result_unknown_run_ids = set(
            AutomationModuleResult.objects.filter(execution_state="result_unknown", logical_run__in=base_runs)
            .values_list("logical_run_id", flat=True)
            .distinct()
        )
        stuck_run_ids = _stuck_run_ids(base_runs, now=now)
        return {
            "needsHuman": {"count": len(needs_human_run_ids), "label": "待人工"},
            "stuck": {"count": len(stuck_run_ids), "label": "持续阻塞"},
            "resultUnknown": {"count": len(result_unknown_run_ids), "label": "无法核实"},
            "basis": {
                "stuckJudgment": f"同一卡点连续 {STUCK_CONSECUTIVE_ATTEMPTS} 次检查无实质进展，或持续 {STUCK_MINUTES} 分钟无实质进展",
                "countedRunsAreDistinct": False,
            },
        }
    except (ValidationError, ValueError, TypeError) as error:
        raise _unavailable() from error
