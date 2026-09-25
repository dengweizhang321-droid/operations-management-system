"""Isolated synthetic vertical slice; no provider call or numeric authority."""
import hashlib

from business_analysis.contracts import AnalysisContractError, digest
from business_analysis.promotion_views import _copy
from . import business_market_v2_execution_plan_contract as plan_contract
from . import business_market_v2_execution_snapshot_contract as previous


PROFILE = "business-agent-screening-promotion-market-synthetic-v4"
SNAPSHOT = "business-market-v2-synthetic-snapshot-v1"
INPUT = "business-market-v2-synthetic-input-v1"
MODEL_ID = "market-v2-synthetic-only"
PAUSE = "market_v2_synthetic_no_provider_permission"


def _need(ok):
    if not ok:
        raise AnalysisContractError("市场v2合成执行切片身份或边界无效")


def identifier(prefix, plan_id):
    _need(type(plan_id) is str and len(plan_id) == 64
        and all(char in "0123456789abcdef" for char in plan_id))
    return prefix + hashlib.sha256((prefix + "|" + plan_id).encode()).hexdigest()[:48]


def build(plan_id, raw_plan, plan_digest, entries):
    value = _copy(raw_plan, 16384)
    _need(type(value) is dict and value.get("schemaVersion") == plan_contract.SCHEMA
        and value.get("executionProfile") == plan_contract.PROFILE
        and digest(value) == plan_digest)
    root = plan_contract.root(value["executionRoot"])
    _need(value == plan_contract.build(root, entries)["plan"])
    flow_id = identifier("market-synth-flow-", plan_id)
    report_id = identifier("market-synth-report-", plan_id)
    job_id = identifier("market-synth-job-", plan_id)
    anchor = {"planId": plan_id,
        "executionReportId": root["executionReportId"],
        "admittedReportId": root["admittedReportId"],
        "contextProofDigest": root["contextProofDigest"],
        "marketContextDigest": root["marketContextDigest"],
        "ownerEmail": root["ownerEmail"]}
    common = {"executionProfile": PROFILE, "reportId": report_id,
        "syntheticRoot": anchor, "fiveToolCatalogDigest": previous.CATALOG_DIGEST,
        "withBudget": root["withBudget"], "syntheticOnly": True,
        "externalProviderCalled": False, "paidCostCents": 0,
        "agentReadPersisted": False, "numericCitationAllowed": False,
        "humanReviewRequired": True, "marketAndOwnSalesAdditive": False}
    snapshot = {"schemaVersion": SNAPSHOT, **common}
    flow_input = {"schemaVersion": INPUT, **common,
        "graphDigest": previous.GRAPH_DIGESTS[root["withBudget"]],
        "allowedTools": list(previous.TOOL_ORDER)}
    return {"reportId": report_id, "workflowId": flow_id,
        "marketJobId": job_id, "snapshot": snapshot,
        "workflowInput": flow_input,
        "graph": previous.graph(root["withBudget"]),
        "modelId": MODEL_ID, "modelVersion": 1, "dryRun": True,
        "status": "paused", "pauseReason": PAUSE,
        "providerCallsMade": 0, "readReceiptAuthorized": False}
