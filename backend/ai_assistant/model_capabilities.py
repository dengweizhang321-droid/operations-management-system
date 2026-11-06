"""Explicit endpoint options; never infer capabilities from a model name."""
import json
import math
import re
from .policy import AiError, canonical, fields, integer, text, choice, boolean

MAX_REPLY_CHARACTERS = 524288
MAX_PROVIDER_BYTES = 8 * 1024 * 1024
MAX_PROVIDER_STREAM_BYTES = 64 * 1024 * 1024  # SSE repeats protocol metadata per delta.
MAX_CHAT_SECONDS = 1_000_000
MAX_CONFIG_INTEGER = 2**53 - 1  # Lossless JSON/JavaScript numeric representation.
STRUCTURED_OUTPUT_MAX_DEPTH = 8  # Bounded schema walk; not a provider limit.
DEFAULTS = {
    "contextWindowTokens": 128000, "taskTimeoutMs": MAX_CHAT_SECONDS * 1000,
    "outputTokenParameter": "max_tokens", "temperatureMode": "custom",
    "reasoningFormat": "default", "reasoningEffort": "default",
    "thinkingBudgetTokens": 4096, "includeStreamUsage": False, "systemPrompt": "",
    "structuredOutputSupport": "none",
}


def options(model):
    try:
        value = json.loads(getattr(model, "generation_options_json", "{}"))
        if not isinstance(value, dict) or set(value) - (set(DEFAULTS) | {"openaiApiMode"}): raise ValueError()
        # Older saves used the database boolean helper and persisted JSON 0/1.
        # Normalize only that stored legacy representation, not request input.
        if type(value.get("includeStreamUsage")) is int and value["includeStreamUsage"] in (0, 1):
            value["includeStreamUsage"] = bool(value["includeStreamUsage"])
        return {**DEFAULTS, "taskTimeoutMs": 260000, **value}  # Preserve pre-option configurations.
    except (ValueError, TypeError) as error:
        raise AiError("模型生成参数损坏，请重新保存配置", "invalid_request", 400) from error


def validate(value, *, protocol, max_tokens, reasoning_mode):
    if not isinstance(value, dict):
        raise AiError("生成参数必须为对象")
    fields(value, set(DEFAULTS) | {"openaiApiMode"})
    result = {**DEFAULTS, **value}
    api_mode = choice(value.get("openaiApiMode", "chat_completions"), ["chat_completions", "responses"], "OpenAI 请求协议")
    if api_mode == "responses" and protocol != "openai_compatible":
        raise AiError("Responses 仅适用于 OpenAI 协议")
    if api_mode == "chat_completions":
        result.pop("openaiApiMode", None)
    if api_mode == "responses" and result["reasoningFormat"] not in {"default", "reasoning_effort"}:
        raise AiError("Responses 推理格式需选择供应商默认或 reasoning_effort")
    result["contextWindowTokens"] = integer(result["contextWindowTokens"], "上下文窗口")
    result["taskTimeoutMs"] = integer(result["taskTimeoutMs"], "任务总时限")
    result["outputTokenParameter"] = choice(result["outputTokenParameter"], ["max_tokens", "max_completion_tokens"], "输出参数格式")
    result["temperatureMode"] = choice(result["temperatureMode"], ["default", "custom"], "温度模式")
    result["reasoningFormat"] = choice(result["reasoningFormat"], ["default", "thinking", "reasoning_effort", "anthropic_budget", "anthropic_adaptive"], "推理参数格式")
    result["reasoningEffort"] = choice(result["reasoningEffort"], ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"], "推理强度")
    result["thinkingBudgetTokens"] = integer(result["thinkingBudgetTokens"], "思考预算")
    result["includeStreamUsage"] = bool(boolean(result["includeStreamUsage"], "流式用量统计"))
    result["systemPrompt"] = text(result["systemPrompt"], "附加系统提示词", 8000, empty=True)
    result["structuredOutputSupport"] = choice(result["structuredOutputSupport"], ["none", "json_schema"], "正文结构化输出支持")
    reserve = max(2048, math.ceil(result["contextWindowTokens"] * .05))
    if max_tokens + reserve + 1024 > result["contextWindowTokens"]:
        raise AiError("上下文窗口须容纳最大输出、安全余量及至少 1024 Token 输入空间")
    mode = result["reasoningFormat"]
    if protocol == "anthropic":
        if result["outputTokenParameter"] != "max_tokens" or mode in {"thinking", "reasoning_effort"} or result["includeStreamUsage"]:
            raise AiError("所选参数格式不适用于 Anthropic 协议")
    elif mode.startswith("anthropic_"):
        raise AiError("Anthropic 推理格式不能用于 OpenAI 兼容协议")
    if mode in {"anthropic_budget", "anthropic_adaptive"} and (reasoning_mode == "disabled" or result["temperatureMode"] != "default"):
        raise AiError("启用 Anthropic 思考时请跟随默认温度，且不能同时关闭推理")
    if mode == "anthropic_budget" and result["thinkingBudgetTokens"] >= max_tokens:
        raise AiError("思考预算必须小于最大输出 Token，给正文保留空间")
    if mode not in {"reasoning_effort", "thinking", "anthropic_adaptive"} and result["reasoningEffort"] != "default":
        raise AiError("当前推理格式不支持强度参数")
    if mode == "anthropic_adaptive" and result["reasoningEffort"] not in {"default", "low", "medium", "high", "max"}:
        raise AiError("自适应思考请使用默认、低、中、高或最大强度")
    if reasoning_mode == "disabled" and result["reasoningEffort"] not in {"default", "none"}:
        raise AiError("关闭推理时不能设置更高推理强度")
    return result


def provider_parameters(model):
    cfg = options(model)
    values = {cfg["outputTokenParameter"]: model.max_tokens}
    if cfg["temperatureMode"] == "custom":
        values["temperature"] = model.temperature_milli / 1000
    mode, effort = cfg["reasoningFormat"], cfg["reasoningEffort"]
    if mode == "default":
        if model.protocol == "openai_compatible" and model.reasoning_mode == "disabled":
            values["thinking"] = {"type": "disabled"}  # Preserve existing endpoint contract.
    elif mode == "thinking":
        values["thinking"] = {"type": "disabled" if model.reasoning_mode == "disabled" else "enabled"}
        if effort != "default": values["reasoning_effort"] = effort
    elif mode == "reasoning_effort":
        if model.reasoning_mode == "disabled": values["reasoning_effort"] = "none"
        elif effort != "default": values["reasoning_effort"] = effort
    elif mode == "anthropic_budget":
        values["thinking"] = {"type": "enabled", "budget_tokens": cfg["thinkingBudgetTokens"]}
    elif mode == "anthropic_adaptive":
        values["thinking"] = {"type": "adaptive"}
        if effort != "default": values["output_config"] = {"effort": effort}
    return values


def strict_schema_violations(schema, *, path="schema", depth=0):
    """Why this schema cannot be sent with OpenAI strict mode, as explicit reasons.

    Checked locally so a non-conforming schema fails before any paid request,
    instead of surfacing as a provider 400 after dispatch. Returns reasons for
    the caller to report; it does not rewrite or relax the caller's schema.
    """
    if depth > STRUCTURED_OUTPUT_MAX_DEPTH:
        return [f"{path} 嵌套超过 {STRUCTURED_OUTPUT_MAX_DEPTH} 层"]
    if not isinstance(schema, dict) or not schema:
        return [f"{path} 不是非空对象"]
    reasons = []
    kind = schema.get("type")
    if kind is not None and type(kind) is not str:
        # A union type (list form) is not accepted by strict mode, and letting it
        # through here would skip every object/array check below.
        return [f"{path} 的 type 必须是字符串，不支持联合类型"]
    if kind == "object":
        properties = schema.get("properties")
        if not isinstance(properties, dict) or not properties:
            reasons.append(f"{path} 缺少 properties")
            return reasons
        if schema.get("additionalProperties") is not False:
            reasons.append(f"{path} 必须显式声明 additionalProperties 为 false")
        required = schema.get("required")
        required = set(required) if isinstance(required, list) else set()
        missing = set(properties) - required
        if missing:
            reasons.append(f"{path} 的 required 未覆盖全部属性：{'、'.join(sorted(missing))}")
        for key, value in properties.items():
            reasons += strict_schema_violations(value, path=f"{path}.{key}", depth=depth+1)
    elif kind == "array":
        items = schema.get("items")
        if items is None:
            reasons.append(f"{path} 缺少 items")
        else:
            reasons += strict_schema_violations(items, path=f"{path}.items", depth=depth+1)
    elif kind is None:
        reasons.append(f"{path} 缺少 type")
    return reasons


def structured_output_parameters(model, *, schema_name, schema, strict=None):
    """Body-level JSON Schema constraint for one call; distinct from tool-argument strict.

    Declaration only: the endpoint's configured capability decides whether this is sent.
    Never probed, never inferred from base_url or model_name, never silently dropped.

    `strict` is the caller's explicit declaration for the OpenAI-compatible
    protocol. Left unset, it follows whether the schema actually satisfies
    strict mode's prerequisites. Passing True on a schema that does not satisfy
    them is refused here rather than sent and rejected by the provider.
    """
    cfg = options(model)
    if cfg["structuredOutputSupport"] != "json_schema":
        raise AiError("该模型端点未声明支持正文结构化输出（JSON Schema），请先在模型配置中声明",
                       "structured_output_unsupported", 400)
    if not isinstance(schema_name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", schema_name):
        raise AiError("结构化输出名称格式无效")
    if not isinstance(schema, dict) or not schema:
        raise AiError("结构化输出 Schema 无效")
    if strict is not None and type(strict) is not bool:
        raise AiError("结构化输出 strict 声明无效")
    if model.protocol == "anthropic":
        # This protocol's output_config.format carries no `strict` field, so a
        # caller declaration has nowhere to go: refuse it rather than accept the
        # argument and silently drop it. Whether the protocol enforces the same
        # schema prerequisites is not stated in the vendor guide verified here
        # (its examples do carry additionalProperties:false and full required),
        # so no prerequisite is asserted for it either way.
        if strict is not None:
            raise AiError("该协议的正文结构化输出不接受 strict 声明，请改由 Schema 自身约束",
                           "structured_output_strict_unsupported", 400)
        return {"output_config": {"format": {"type": "json_schema", "schema": schema}}}
    violations = strict_schema_violations(schema)
    if strict is True and violations:
        raise AiError("结构化输出 Schema 不满足 strict 模式要求：" + "；".join(violations[:3]),
                       "structured_output_schema_not_strict", 400)
    return {"response_format": {"type": "json_schema", "json_schema": {
        "name": schema_name, "schema": schema,
        "strict": not violations if strict is None else strict}}}


def estimate_tokens(value):
    # Conservative UTF-8 heuristic, not a provider tokenizer or actual billing.
    return math.ceil(len(canonical(value).encode("utf-8")) / 2) + 16


def fit_context(model, transcript, system, tools):
    cfg = options(model)
    window = cfg["contextWindowTokens"]
    reserve = max(2048, math.ceil(window * .05))
    budget = window - model.max_tokens - reserve
    frames = list(transcript)
    # Discard complete old user turns only. Never split live tool calls/results.
    starts = [i for i, f in enumerate(frames) if f.get("role") == "user" and isinstance(f.get("content"), str)]
    dropped = 0
    if starts and starts[0] > 0:
        dropped = starts[0]
        frames = frames[dropped:]
        starts = [i - dropped for i in starts]
    def estimate(): return estimate_tokens({"system": system, "messages": frames, "tools": tools})
    while estimate() > budget and len(starts) > 1:
        count = starts[1]
        frames = frames[count:]; dropped += count
        starts = [i - count for i in starts[1:]]
    used = estimate()
    if used > budget or len(canonical(frames).encode()) > 4 * 1024 * 1024:
        raise AiError("当前问题与工具结果超过上下文预算，请增大上下文窗口、减小输出额度或缩小查询范围", "ai_context_budget_exceeded", 400)
    return frames, {"estimatedInputTokens": used, "contextWindowTokens": window, "reservedOutputTokens": model.max_tokens,
                    "droppedMessages": dropped, "tokenCountMethod": "utf8-estimate"}


def usage_numbers(usage):
    usage = usage if isinstance(usage, dict) else {}
    def number(value): return value if type(value) is int and 0 <= value <= 100000000 else None
    detail = usage.get("completion_tokens_details") or usage.get("output_tokens_details") or {}
    return {"inputTokens": number(usage.get("prompt_tokens", usage.get("input_tokens"))),
            "outputTokens": number(usage.get("completion_tokens", usage.get("output_tokens"))),
            "reasoningTokens": number(detail.get("reasoning_tokens", detail.get("thinking_tokens"))) if isinstance(detail, dict) else None}
