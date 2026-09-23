"""Read-only proposal for a future promotion screening execution profile.

An existing report and its published screening remain in their original
profile. This adapter only binds a proposed selector to their current sealed
roots; it cannot create, authorize, or dispatch the proposed profile.
"""
import json

from business_analysis.contracts import AnalysisContractError
from business_analysis import screening_storage
from . import business_diagnostic_screening as report_binding
from . import business_promotion_runtime_contract as contract
from . import business_screening_store as screening_store
from . import models as m
from .policy import AiError, canonical, current_principal, digest, identifier

SCHEMA = "business-promotion-runtime-candidate-v1"


def _roots(report_id, screening_id, principal):
    """Reload all three owning roots; request values supply IDs only."""
    current_principal(principal, admin=True)
    if principal.scope is not None:
        raise AiError("推广运行候选仅允许无范围管理员", "access_denied", 403)
    report_id, screening_id = identifier(report_id), identifier(screening_id)
    loaded = report_binding._load(report_id, principal)
    binding, sources = loaded[0], loaded[4]
    row, screening_binding, manifest = screening_store._loaded(screening_id, principal)
    if (row.report_id != report_id or canonical(screening_binding) != canonical(binding)
            or row.owner_email != binding["ownerEmail"]
            or row.scope_json != canonical(binding["scope"])):
        raise AiError("筛查结果不属于当前固定报告", "conflict", 409)
    try:
        # _loaded checks the published manifest and plan. Validate all stored
        # pages too, so a candidate cannot cite an incomplete screening root.
        if canonical(screening_storage.validate(screening_store._all(row))) != canonical(manifest):
            raise AnalysisContractError("筛查根清单不一致")
    except (AnalysisContractError, ValueError, TypeError, KeyError, UnicodeError, RecursionError) as error:
        raise AiError("固定筛查页未通过完整核验", "conflict", 409) from error
    report = m.AiReportRun.objects.filter(pk=report_id).only("snapshot_json", "budget_plan_id").first()
    if report is None or digest(report.snapshot_json) != binding["snapshotDigest"]:
        raise AiError("报告快照已变化", "conflict", 409)
    snapshot = json.loads(report.snapshot_json)
    # Existing reports are evidence roots, never silently promoted in place.
    if snapshot["executionProfile"] == contract.PROFILE:
        raise AiError("新推广协议尚未注册为持久报告", "conflict", 409)
    context = {"reportId":report_id, "runId":binding["evidenceRunId"],
        "screeningId":screening_id, "sealedDigest":binding["sealedDigest"]}
    origins = {"reportId":report_id, "reportProfile":snapshot["executionProfile"],
        "reportSnapshotDigest":binding["snapshotDigest"], "workflowInputDigest":binding["workflowInputDigest"],
        "screeningId":screening_id, "screeningBindingDigest":row.binding_digest,
        "screeningManifestDigest":row.manifest_digest, "screeningContentRootDigest":row.content_root_digest}
    return sources, context, origins, bool(report.budget_plan_id), binding


def prepare_candidate(report_id, screening_id, selector, principal):
    """Return a copyable proposal, never an executable snapshot or grant."""
    sources, context, origins, with_budget, binding = _roots(report_id, screening_id, principal)
    try:
        snapshot = contract.freeze_snapshot(sources, context, selector)
        contract.checked_snapshot(sources, context, snapshot)
        graph = contract.graph(with_budget)
    except (AnalysisContractError, ValueError, TypeError, KeyError, UnicodeError, RecursionError) as error:
        raise AiError("推广来源、比较期或候选协议未通过固定根核验", "conflict", 409) from error
    value = {"schemaVersion":SCHEMA, "origins":origins, "proposedSnapshot":snapshot,
        "proposedGraph":graph, "authorityVerified":False, "registered":False,
        "readiness":"requires_new_persistent_profile"}
    value["candidateDigest"] = digest(value)
    # Repeat the complete owning checks after construction. A changed actor,
    # seal, report, screening or version must not return a stale candidate.
    fresh = _roots(report_id, screening_id, principal)
    if (canonical((fresh[1], fresh[2], fresh[3])) != canonical((context, origins, with_budget))
            or canonical(fresh[0]) != canonical(sources)):
        raise AiError("推广候选的固定来源或身份已变化", "conflict", 409)
    report_binding._revalidate(binding, principal)
    return json.loads(canonical(value))


def checked_candidate(report_id, screening_id, selector, candidate, principal):
    """Check caller-supplied candidate against fresh persisted roots."""
    actual = prepare_candidate(report_id, screening_id, selector, principal)
    if type(candidate) is not dict or canonical(candidate) != canonical(actual):
        raise AiError("推广候选与当前封存根不一致", "conflict", 409)
    return actual
