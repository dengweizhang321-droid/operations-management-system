"""Internal screening over a real fixed report; no API, runtime or cache registration.

An internal VerifiedScreening is not an authorization credential. Every use
reloads the actual report, workflow, sealed catalog and current principal.
The pure scanner's unpublished authority flags deliberately remain unchanged.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import json

from business_analysis import diagnostic_screening, mapping_plan
from business_analysis.contracts import AnalysisContractError
from business_analysis.planning import validate_analysis_request
from business_analysis.results import stream_table
from . import business_evidence, business_integrated, business_mapped_analysis, business_reports, models as m
from .business_sealed import Reader
from .policy import AiError, authorize_owner, canonical, current_principal, digest, identifier

MAX_RESPONSE_BYTES = 38000
PAGE_SIZE = 20
_TOKEN = object()


def _conflict(message="筛查固定报告或封存证据已变化"):
    raise AiError(message, "conflict", 409)


@dataclass(frozen=True, slots=True, init=False)
class VerifiedScreening:
    """Process-local completed result, created only after all contexts exit."""
    _binding_json: str
    _result_json: str

    def __init__(self, token, binding, result):
        if token is not _TOKEN:
            raise AiError("筛查结果只能由内部完整扫描创建")
        object.__setattr__(self, "_binding_json", canonical(binding))
        object.__setattr__(self, "_result_json", canonical(result))

    @property
    def summary(self):
        value = json.loads(self._result_json)
        return {key: value[key] for key in ("schemaVersion", "authority", "bindingDigest", "planDigest", "resultDigest")}


def _load(report_id, principal):
    """Describe trusted fixed records without reading fact pages or budget math."""
    current_principal(principal, admin=True)
    report = m.AiReportRun.objects.select_related("workflow").filter(pk=identifier(report_id)).first()
    if report is None:
        raise AiError("报告不存在", "not_found", 404)
    authorize_owner(report, principal)
    authorize_owner(report.workflow, principal)
    if (report.owner_email, report.scope_json) != (report.workflow.owner_email, report.workflow.scope_json):
        _conflict("报告与工作流身份不一致")
    try:
        snapshot = json.loads(report.snapshot_json)
        if (type(snapshot) is not dict or canonical(snapshot) != report.snapshot_json
                or snapshot.get("schemaVersion") != business_reports.SCHEMA or not business_reports.is_v2_snapshot(snapshot)):
            _conflict("筛查仅支持固定封存v2报告")
        if business_integrated.is_snapshot(snapshot):
            report, snapshot, reference, evidence, _ = business_integrated.bound(report, principal)
        else:
            if any(key in snapshot for key in ("mappingPlan", "mappingPlanDigest")):
                _conflict("非集成报告不能携带临时关联计划")
            if bool(report.budget_plan_id) != business_reports.is_budget_snapshot(snapshot):
                _conflict("固定预算参数缺失或协议不一致")
            reference = business_reports.bound_reference(snapshot, principal)
            evidence = business_evidence.get_run(snapshot["evidenceRunId"], principal)
        if report.workflow.input_json != canonical(reference):
            _conflict("报告工作流输入与固定引用不一致")
        reader = Reader(evidence, principal)
        sources = reader.sources
        infos = {source["key"]: reader.info(source["key"]) for source in sources}
        request = json.loads(evidence.plan_json).get("analysisRequest")
        if request is not None:
            request = validate_analysis_request(request)
        fixed_mapping = snapshot.get("mappingPlan")
        if fixed_mapping is not None:
            fixed_mapping = mapping_plan._checked_plan(fixed_mapping, sources)
            if digest(fixed_mapping) != snapshot.get("mappingPlanDigest"):
                _conflict("固定关联计划摘要变化")
        binding = {"reportId":report.id, "workflowId":report.workflow_id,
            "ownerEmail":report.owner_email, "scope":json.loads(report.scope_json), "role":principal.role,
            "snapshotDigest":digest(report.snapshot_json), "workflowInputDigest":digest(report.workflow.input_json),
            "executionProfile":snapshot["executionProfile"],
            **{key:reference[key] for key in business_integrated.SEAL_KEYS},
            "sourceInfosDigest":digest(infos), "sourcesDigest":digest(sources),
            "analysisRequestDigest":digest(request) if request is not None else None,
            "mappingPlanDigest":digest(fixed_mapping) if fixed_mapping is not None else None,
            "budgetRef":snapshot.get("budgetRef"), "algorithmVersion":diagnostic_screening.ALGORITHM_VERSION}
    except (AnalysisContractError, ValueError, TypeError, KeyError) as error:
        raise AiError("筛查报告固定范围未通过核验", "conflict", 409) from error
    return binding, reader, request, fixed_mapping, sources, infos


def _revalidate(binding, principal):
    actual = _load(binding["reportId"], principal)
    if canonical(actual[0]) != canonical(binding):
        _conflict()
    return actual


def _describe(loaded):
    from business_analysis import screening_plan
    binding, _, request, fixed_mapping, sources, infos = loaded
    if request is None:
        plan = {"schemaVersion":"business-screening-plan-v1", "canScreen":False,
            "reason":"missing_fixed_analysis_request", "analysisRequest":None,
            "requestedCoverage":[], "descriptors":[], "limitations":["证据未固定分析维度和窗口，不推断默认范围"]}
        plan["planDigest"] = digest(plan)
    else:
        try:
            plan = screening_plan.build(request, sources, infos, mapping_plan=fixed_mapping)
        except AnalysisContractError as error:
            raise AiError(str(error), "conflict", 409) from error
    return {"schemaVersion":"business-diagnostic-screening-preview-v1", "previewOnly":True,
        "factsScanned":False, "binding":binding, "bindingDigest":digest(binding), "plan":plan}


def describe_for_report(report_id, principal):
    loaded = _load(report_id, principal)
    value = _describe(loaded)
    _revalidate(loaded[0], principal)
    return value


def prepare_for_report(report_id, principal):
    loaded = _load(report_id, principal)
    binding, reader, _, fixed_mapping, _, infos = loaded
    plan = _describe(loaded)["plan"]
    if not plan["canScreen"]:
        reason = plan.get("reason") or "; ".join(
            f"{item['reason']} ({item['actual']}/{item['limit']})" for item in plan["admissionFailures"])
        raise AiError("完整筛查计划不可执行："+reason, "conflict", 409)

    @contextmanager
    def open_table(descriptor):
        _revalidate(binding, principal)
        if descriptor["mode"] == "mapped":
            mapped = descriptor["mapping"]
            with business_mapped_analysis.table(binding["evidenceRunId"], fixed_mapping,
                    mapped["pairKey"], descriptor["dimension"], principal,
                    baseline_pair_key=mapped["baselinePairKey"]) as table:
                yield table.header(), table.scan()
        else:
            key = descriptor["source"]["key"]
            baseline = descriptor["baseline"]
            kwargs = ({"baseline_pages":reader.pages(baseline["key"]),
                "baseline_expected":infos[baseline["key"]]["expected"]} if baseline else {})
            with stream_table(reader.pages(key), descriptor["dimension"], infos[key]["expected"], **kwargs) as opened:
                yield opened
        _revalidate(binding, principal)

    try:
        result = diagnostic_screening.prepare({key:binding[key] for key in (
            "reportId", "evidenceRunId", "evidenceVersion", "evidencePlanDigest", "catalogDigest", "sealedDigest")},
            plan["descriptors"], open_table, limits=plan["limits"])
    except AnalysisContractError as error:
        raise AiError(str(error), "conflict", 409) from error
    _revalidate(binding, principal)
    coverage_planned = all(item["status"] in {"planned", "dependency", "not_applicable", "outside_fixed_request"}
        for item in plan["requestedCoverage"])
    source_dates_complete = coverage_planned and all(
        table["sourceCoverage"].get("status") == "dates_present"
        and (table["baselineCoverage"] is None or table["baselineCoverage"].get("status") == "dates_present")
        for table in result["coverage"]["tables"])
    authority = {"completeSourceTraversalForExecutedTables":True, "executedTablesComplete":True,
        "requestedCoveragePlanned":coverage_planned, "requestedTablesExecutedComplete":coverage_planned,
        "requestedSourceDateCoverageComplete":source_dates_complete, "entityDailyCoverageVerified":False,
        "binding":binding,
        "reportId":binding["reportId"], "evidenceRunId":binding["evidenceRunId"],
        "selectionPolicy":plan["selectionPolicy"], "selectionPlanDigest":plan["planDigest"],
        "pureResultDigest":result["resultDigest"], "tableCount":result["coverage"]["tableCount"],
        "rowVisits":result["coverage"]["rowVisits"], "partitionCount":len(result["partitions"]),
        "limitations":result["limitations"]}
    value = {"schemaVersion":"business-diagnostic-screening-v1", "authority":authority,
        "bindingDigest":digest(binding), "planDigest":plan["planDigest"], "plan":plan, "prepared":result}
    value["resultDigest"] = digest(value)
    return VerifiedScreening(_TOKEN, binding, value)


def _verified(value, principal):
    if type(value) is not VerifiedScreening:
        raise AiError("只接受本进程内部完整筛查结果")
    binding = json.loads(value._binding_json)
    _revalidate(binding, principal)
    return binding, json.loads(value._result_json)


def _page(base, rows, offset):
    if type(offset) is not int or not 0 <= offset <= len(rows):
        raise AiError("筛查页偏移无效")
    selected = []

    def render():
        end = offset+len(selected)
        value = {**base, "items":selected, "pagination":{"offset":offset, "limit":PAGE_SIZE,
            "returned":len(selected), "total":len(rows), "nextOffset":end if end < len(rows) else None}}
        value["pageDigest"] = digest(value)
        return value

    for row in rows[offset:offset+PAGE_SIZE]:
        selected.append(row)
        if len(canonical(render()).encode("utf-8")) > MAX_RESPONSE_BYTES:
            selected.pop()
            break
    value = render()
    if (offset < len(rows) and not selected) or len(canonical(value).encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise AiError("完整筛查记录超过响应容量", "payload_too_large", 413)
    return value


def _base(value, kind):
    return {"schemaVersion":"business-diagnostic-screening-"+kind+"-v1",
        **{key:value[key] for key in ("bindingDigest", "planDigest", "resultDigest", "authority")}}


def coverage_page(verified, principal, *, offset=0):
    binding, value = _verified(verified, principal)
    plan, result = value["plan"], value["prepared"]
    entries = [{"kind":"family", "value":row} for row in plan.get("families", [])]
    entries += [{"kind":"requested", "value":row} for row in plan["requestedCoverage"]]
    entries += [{"kind":"table", "value":row} for row in result["coverage"]["tables"]]
    entries += [{"kind":"partition", "value":{key:val for key,val in row.items() if key != "candidates"}}
        for row in result["partitions"]]
    response = _page(_base(value, "coverage"), entries, offset)
    _revalidate(binding, principal)
    return response


def candidate_page(verified, principal, partition_key, *, offset=0):
    binding, value = _verified(verified, principal)
    identifier(partition_key, "partitionKey")
    partition = next((row for row in value["prepared"]["partitions"] if row["partitionKey"] == partition_key), None)
    if partition is None:
        raise AiError("筛查候选分区不存在", "not_found", 404)
    base = {**_base(value, "candidates"), "partition":{key:val for key,val in partition.items() if key != "candidates"}}
    response = _page(base, partition["candidates"], offset)
    _revalidate(binding, principal)
    return response
