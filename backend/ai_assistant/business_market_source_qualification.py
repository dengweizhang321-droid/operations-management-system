"""Owner-bound source qualification, without creating or activating a report.

The existing material owner replays all selected sealed pages and constructs
three typed tables. Its final fence must finish before a result can escape.
This receipt is human inspection, never SQL admission or an Agent read proof.
"""
import json

from . import business_evidence, business_evidence_store as store
from . import business_market_report_material as materials
from . import business_promotion_market_admission as admission
from . import business_promotion_runtime_contract as promotion
from .business_market_v2_paid_gate import REQUIRED_AUTHORITIES
from .policy import AiError, canonical, digest, fields, identifier, integer


SCHEMA = "business-market-source-qualification-v1"
REQUEST_SCHEMA = "business-market-source-qualification-request-v1"
MAX_RESULT_BYTES = 48 * 1024


def inspect(report_id, body, principal):
    """Inspect an explicit report/selector; never search or restart reports."""
    request_fields = {"schemaVersion", "marketSelector", "evidenceRunId",
        "evidenceVersion", "catalogDigest"}
    fields(body, request_fields, request_fields)
    if body["schemaVersion"] != REQUEST_SCHEMA:
        raise AiError("市场来源资格请求协议无效", "invalid_request", 400)
    report_id = identifier(report_id, "reportId")
    evidence_id = identifier(body["evidenceRunId"], "evidenceRunId")
    evidence_version = integer(body["evidenceVersion"], "evidenceVersion")
    evidence = business_evidence.get_run(evidence_id, principal)
    catalog_digest = json.loads(evidence.plan_json).get("catalogDigest")
    if (not store.is_v2(evidence) or evidence.status != "sealed"
            or evidence.version != evidence_version
            or type(body["catalogDigest"]) is not str
            or catalog_digest != body["catalogDigest"]):
        raise AiError("当前封存任务版本或来源目录已变化", "conflict", 409)
    selection = admission.describe(report_id, body["marketSelector"], principal)
    binding = selection["binding"]
    if (binding["evidenceRunId"] != evidence_id
            or binding["evidenceVersion"] != evidence_version):
        raise AiError("词货报告不属于当前封存任务及版本", "conflict", 409)
    material = None
    if selection["candidateEligible"]:
        # Exiting this context rechecks the source root and current principal.
        # Do not return from inside it, or bypass its closing fence.
        with materials.prepare(report_id, body["marketSelector"], principal) as prepared:
            manifest, summary = prepared.manifest, prepared.summary
            if (summary["admissionDigest"] != selection["bindingDigest"]
                    or summary["selectedSealedSourcesFullyReplayed"] is not True
                    or summary["typedMarketRowsVerified"] is not True):
                raise AiError("市场来源资格与完整重放不一致", "conflict", 409)
            material = {"manifestDigest": manifest["manifestDigest"],
                "summaryDigest": summary["summaryDigest"],
                "rowCount": manifest["rowCount"],
                "pageCount": manifest["pageCount"],
                "tables": [{"view": spec["view"], "rowCount": spec["rowCount"],
                    "bindingDigest": spec["bindingDigest"],
                    "sourceTableDigest": spec["sourceTableDigest"]}
                    for spec in manifest["tables"]]}
    # Cover the no-material/missing-date branch as well as the closing replay.
    if admission.describe(report_id, body["marketSelector"], principal) != selection:
        raise AiError("市场来源资格核验期间账号或封存来源变化", "conflict", 409)
    store.assert_current(evidence)
    result = {"schemaVersion": SCHEMA, "sourceReportId": report_id,
        "evidenceRunId": evidence_id, "evidenceVersion": evidence_version,
        "catalogDigest": catalog_digest,
        "sourceProfile": promotion.PROFILE, "binding": binding,
        "selector": selection["candidate"]["selector"],
        "observationStatus": selection["observationStatus"],
        "observationCoverage": selection["candidate"]["observationCoverage"],
        "sourceDescriptors": selection["candidate"]["sources"],
        "selectedProofDigests": selection["candidate"]["coverageProofDigests"],
        "reusableSourceMaterialAvailable": material is not None,
        "material": material,
        "sourceGaps": [] if material is not None else ["selected_observation_date_not_covered"],
        "remainingRuntimeRequirements": [*REQUIRED_AUTHORITIES,
            "sql_revalidated_new_runnable_profile",
            "same_job_provider_tool_and_owning_read_attestation",
            "independent_exact_cell_numeric_attestation"],
        "newReportCreated": False, "providerCallsAllowed": False,
        "fundsReserved": False, "agentReadPersisted": False,
        "numericCitationAllowed": False, "publicationAllowed": False,
        "wholeMarketCoverageVerified": False,
        "marketAndOwnSalesAdditive": False,
        "limitations": list(selection["limitations"])}
    result["resultDigest"] = digest(result)
    if len(canonical(result).encode("utf-8")) > MAX_RESULT_BYTES:
        raise AiError("市场来源资格摘要超过容量", "payload_too_large", 413)
    return result
