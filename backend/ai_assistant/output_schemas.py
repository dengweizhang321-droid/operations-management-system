"""Registered JSON Schemas for structured model output.

A caller names a schema from this catalog; the model never supplies one. That
is the whole point of a registry: a schema is part of the application's
contract, reviewed like any other code, not something a prompt can negotiate.

Each entry is bounded on purpose — object depth, array lengths and string
lengths are all capped — because a schema that admits unbounded output moves
the limit to whatever the provider happens to return.
"""
from .policy import AiError, canonical, digest

MAX_DEPTH = 8


def _string(maximum, description=""):
    return {"type": "string", "maxLength": maximum, "description": description}


#: What a distilled Skill candidate must look like. Fields follow the plan's
#: own list: goal, parameters, steps, required tools, template references,
#: source evidence, unverified recommendations and open questions.
#:
#: `body` is capped at the report library's own 2000-character limit for a
#: skill's method text, so an approved candidate can become a library entry
#: without truncation at that boundary.
SKILL_CANDIDATE_V1 = {
    "type": "object",
    "additionalProperties": False,
    # Strict mode requires every property to be listed, so an absent value is
    # an empty string or empty array rather than a missing key. Union-form
    # types are not an option: strict mode rejects them.
    "required": ["goal", "body", "parameters", "steps", "requiredTools",
                 "templateRefs", "sourceEvidenceRefs",
                 "unverifiedRecommendations", "openQuestions"],
    "properties": {
        "goal": _string(240, "这个方法要回答的问题，不含本次具体数值。"),
        "body": _string(2000, "可复用的方法正文，对应资源库技能的方法正文上限。"),
        "parameters": {
            "type": "array", "maxItems": 12,
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["name", "kind", "required", "meaning", "defaultRule"],
                "properties": {
                    "name": _string(40),
                    "kind": {"type": "string",
                             "enum": ["shop", "platform", "businessDate", "compareWindow",
                                      "threshold", "warehouse", "replenishmentDays", "other"]},
                    "required": {"type": "boolean"},
                    "meaning": _string(200, "口径来源与缺省含义；没有依据就写待填。"),
                    "defaultRule": _string(200, "如“调用时解析的上海昨天”，不是固定某一天。"),
                },
            },
        },
        "steps": {
            "type": "array", "maxItems": 20,
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["order", "action", "toolName", "missingDataBranch"],
                "properties": {
                    "order": {"type": "integer", "minimum": 1, "maximum": 20},
                    "action": _string(300),
                    "toolName": _string(80, "必须是中央注册表中的工具名称。"),
                    "missingDataBranch": _string(200, "缺数时怎么办，不要留空等于默认成功。"),
                },
            },
        },
        "requiredTools": {
            "type": "array", "maxItems": 16,
            "items": _string(80, "中央注册表工具名称；不写本地 allowed-tools 名称。"),
        },
        "templateRefs": {
            "type": "array", "maxItems": 4,
            "items": _string(64, "资源库模板 id。"),
        },
        "sourceEvidenceRefs": {
            "type": "array", "maxItems": 20,
            "items": _string(120, "来源 exportId 或产物 fileId，用于回溯提炼依据。"),
        },
        "unverifiedRecommendations": {
            "type": "array", "maxItems": 10,
            "items": _string(300, "报告里尚未执行的建议；保留为未验证，不要写成结论。"),
        },
        "openQuestions": {
            "type": "array", "maxItems": 10,
            "items": _string(200, "阈值或口径缺依据的待确认项。"),
        },
    },
}

CATALOG = {"skill-candidate-v1": SKILL_CANDIDATE_V1}


def _depth(node, level=0):
    if level > MAX_DEPTH:
        raise AiError("登记 schema 嵌套超限")
    if isinstance(node, dict):
        for value in node.values():
            _depth(value, level + 1)
    elif isinstance(node, list):
        for value in node:
            _depth(value, level + 1)


for _name, _schema in CATALOG.items():
    # Fail at import rather than at the first call: a registered schema that
    # cannot be used with strict mode is a code defect, not a runtime input.
    _depth(_schema)
    if _schema.get("additionalProperties") is not False:
        raise AiError(f"登记 schema 必须禁止额外字段：{_name}")
    if set(_schema.get("required", ())) - set(_schema.get("properties", {})):
        raise AiError(f"登记 schema 的 required 超出 properties：{_name}")


def resolve(reference):
    """The schema plus the digest a dispatch records, by registered name."""
    schema = CATALOG.get(reference)
    if schema is None:
        raise AiError("未登记的结构化输出 schema", "invalid_request", 400)
    return {"name": reference.replace(".", "-"), "schema": schema,
            "schemaDigest": digest(canonical(schema))}


def matches(value, schema):
    """Validate the bounded keyword set used by the registered output contract."""
    kind = schema["type"]
    if kind == "object":
        return (isinstance(value, dict) and set(value) == set(schema["required"])
                and all(matches(v, schema["properties"][k]) for k, v in value.items()))
    if kind == "array":
        return (isinstance(value, list) and len(value) <= schema["maxItems"]
                and all(matches(v, schema["items"]) for v in value))
    if kind == "string":
        return (isinstance(value, str) and len(value) <= schema.get("maxLength", len(value))
                and ("enum" not in schema or value in schema["enum"]))
    if kind == "integer":
        return type(value) is int and schema["minimum"] <= value <= schema["maximum"]
    return kind == "boolean" and type(value) is bool
