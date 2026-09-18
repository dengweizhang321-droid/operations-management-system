"""Pure candidate selection/reference contract; no registered runtime authority.

The owning adapter must load context and raw source entries from persisted
roots. Model-supplied digests are constraints, never evidence of authorization.
"""
from business_analysis.contracts import AnalysisContractError, digest, comparison_periods
from business_analysis.evidence_v2 import normalize_sources, _fields, _identifier, _sha
from business_analysis.promotion_keyword_sku import ALGORITHM_VERSION, VIEWS, LIMITS
from business_analysis.promotion_views import _copy

PROFILE = "business-agent-screening-promotion-reference-v1"
SURFACE = "business_agent_screening_promotion_v1"
PACKAGE_TOOL = "get_business_promotion_screening_package_v1"
TABLE_TOOL = "get_business_promotion_screening_analysis_v1"
BUDGET_TOOL = "get_business_promotion_screening_budget_v1"
PROMOTION_TOOL = "get_business_promotion_keyword_sku_v1"
TOOLS = frozenset((PACKAGE_TOOL, TABLE_TOOL, BUDGET_TOOL, PROMOTION_TOOL))
# Four prospective entries retain the three existing responsibilities. This is
# not a catalog implementation or permission to register old tools on a surface.
TOOL_CAPABILITIES = ((PACKAGE_TOOL, ("role_package",)),
    (TABLE_TOOL, ("native", "mapped")), (BUDGET_TOOL, ("budget",)),
    (PROMOTION_TOOL, ("keyword_sku", "keyword_sku_context")))
SCHEMA = "business-promotion-selection-candidate-v1"
REFERENCE_SCHEMA = "business-promotion-row-reference-candidate-v1"
CONTEXT_FIELDS = frozenset(("reportId", "runId", "screeningId", "sealedDigest"))
MONEY_METRICS = frozenset(("spendCents", "reportedGmvCents", "directGmvCents", "indirectGmvCents", "newCustomerGmvCents"))
VALUE_FIELDS = frozenset(("value", "baseline", "difference", "changeRate"))


def _require(condition, message):
    if not condition: raise AnalysisContractError(message)


def selection(sources, context, selector):
    """Validate against the complete supplied directory, never guess a base."""
    sources = _copy(sources, 128 * 1024)
    context, selector = _copy(context, 2048), _copy(selector, 2048)
    _fields(context, CONTEXT_FIELDS, "推广上下文")
    for key in CONTEXT_FIELDS - {"sealedDigest"}: _identifier(context[key], key)
    _sha(context["sealedDigest"], "sealedDigest")
    _require(type(selector) is dict and set(selector) in (
        {"sourceKey", "view"}, {"sourceKey", "view", "baselineKey"}), "推广选择字段无效")
    _identifier(selector["sourceKey"], "sourceKey")
    if "baselineKey" in selector: _identifier(selector["baselineKey"], "baselineKey")
    _require(type(selector["view"]) is str and selector["view"] in VIEWS, "推广视图不支持")
    catalog = normalize_sources(sources)
    by_key = {item["key"]: item for item in catalog}
    def selected(key):
        _require(key in by_key, "来源不在固定目录")
        item = by_key[key]
        _require(item["domain"] == "netshop" and item["query"]["platform"] == "京东"
            and item["query"]["dataset"] == "promotion", "仅支持京东推广来源")
        return item
    current = selected(selector["sourceKey"])
    _require(current["query"]["window"] == "current", "主来源必须是当前期")
    baseline = selected(selector["baselineKey"]) if "baselineKey" in selector else None
    if baseline:
        a, b = current["query"], baseline["query"]
        _require(current["key"] != baseline["key"] and b["window"] in ("previous", "yearAgo")
            and {k:v for k,v in a.items() if k != "window"} == {k:v for k,v in b.items() if k != "window"},
            "基期来源身份、原日期区间或窗口不对应")
    result = {"schemaVersion": SCHEMA, "profile": PROFILE, "algorithmVersion": ALGORITHM_VERSION,
        "context": context, "catalogDigest": digest(catalog), "selector": selector,
        "source": current, "baseline": baseline,
        "periods": comparison_periods(current["query"]["startDate"], current["query"]["endDate"]),
        "authorityVerified": False, "registered": False}
    result["contextDigest"] = digest(result)
    return result


def row_reference(sources, context, selector, reference):
    """Validate a numeric lookup request, without accepting a claimed number.

The returned reference is not a resolved row. Owning read_row must recheck row
identity, table binding, missing identity and comparison availability later.
"""
    fixed = selection(sources, context, selector)
    reference = _copy(reference, 2048)
    _fields(reference, {"contextDigest", "tableBindingDigest", "rowIndex", "rowId", "metric", "field"}, "推广行引用")
    for key in ("contextDigest", "tableBindingDigest", "rowId"): _sha(reference[key], key)
    _require(reference["contextDigest"] == fixed["contextDigest"], "推广引用上下文不一致")
    _require(type(reference["rowIndex"]) is int and 0 <= reference["rowIndex"] < LIMITS["maxGroups"], "推广行位置无效")
    _require(type(reference["metric"]) is str and reference["metric"] in MONEY_METRICS, "推广金额引用指标无效")
    _require(type(reference["field"]) is str and reference["field"] in VALUE_FIELDS, "推广金额引用字段无效")
    _require(reference["field"] == "value" or fixed["baseline"] is not None, "比较金额引用必须固定基期")
    result = {"schemaVersion": REFERENCE_SCHEMA, "selection": fixed, "reference": reference,
              "authorityVerified": False, "resolved": False}
    result["referenceDigest"] = digest(result)
    return result
