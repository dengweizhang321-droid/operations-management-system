"""Synthetic provider probes; no business tool, data or external delivery."""
import json
import uuid
from django.utils import timezone
from .policy import AiError, canonical, digest, mutation, current_principal
from .provider_contract import PROVIDER_ADAPTER_VERSION, InvalidProviderResponse
from .model_capabilities import options

MODES = {"connection", "tool_roundtrip_json", "tool_roundtrip_sse"}
LABELS = {"connection": "普通连接", "tool_roundtrip_json": "非流式工具闭环",
          "tool_roundtrip_sse": "SSE 工具闭环"}
KINDS = {"connection": "connection", "tool_roundtrip_json": "nonStreaming", "tool_roundtrip_sse": "sse"}


def fingerprint(model):
    # Version changes on every configuration save, including credential edits.
    # No credential bytes or credential digest enter the stored evidence.
    return digest(canonical({"modelId": model.id, "modelVersion": model.version,
        "adapterVersion": PROVIDER_ADAPTER_VERSION, "protocol": model.protocol,
        "modelType": model.model_type, "modelName": model.model_name,
        "baseUrl": model.base_url, "maxTokens": model.max_tokens,
        "timeoutMs": model.timeout_ms, "reasoningMode": model.reasoning_mode,
        "temperatureMilli": model.temperature_milli, "maxToolRounds": model.max_tool_rounds,
        "maxTotalToolCalls": model.max_total_tool_calls, "options": options(model)}))


def stored(model):
    try:
        value = json.loads(model.last_test_result or "")
        return value if isinstance(value, dict) and value.get("kind") == "provider-capabilities-v1" else {}
    except (ValueError, TypeError):
        return {}


def record(model):
    value = stored(model)
    current = value.get("fingerprint") == fingerprint(model) and value.get("adapterVersion") == PROVIDER_ADAPTER_VERSION
    result = {"adapterVersion": PROVIDER_ADAPTER_VERSION}
    for key in KINDS.values():
        observation = value.get(key, {})
        status = observation.get("status") if isinstance(observation, dict) else None
        item = {"status": status if current and status in {"passed", "failed"} else "expired" if status in {"passed", "failed"} else "unverified"}
        if isinstance(observation, dict):
            for field in ("testedAt", "errorCode", "reason"):
                if isinstance(observation.get(field), str) and len(observation[field]) <= 100:
                    item[field] = observation[field]
        result[key] = item
    return result


def summary(model):
    value = record(model)
    labels = {"passed": "通过", "failed": "失败", "expired": "已过期，需重测", "unverified": "未验证"}
    return " · ".join(f"{LABELS[mode]}：{labels[value[key]['status']]}" for mode, key in KINDS.items())


def tool_roundtrip(model, *, streaming, before_call):
    from . import provider
    tool = {"name": "provider_roundtrip_check", "description": "仅供模型能力测试的合成工具，无业务数据。",
            "inputSchema": {"type": "object", "properties": {"probe": {"type": "string", "enum": ["ready"]}},
                            "required": ["probe"], "additionalProperties": False}}
    system = "这是合成工具闭环测试。必须先调用 provider_roundtrip_check，参数 probe=ready；取得工具结果后，只原样回答工具结果的 answer 字段，不加其他文字。"
    frames = [{"role": "user", "content": "请执行工具闭环测试。"}]
    kw = {"on_text": lambda _: None} if streaming else {}
    mode = "sse" if streaming else "json"
    with provider.conversation_session("capability-probe-" + uuid.uuid4().hex):
        before_call(1)
        first = provider.turn(model, frames, system, [tool], retain_reasoning=True, **kw)
        if (first["truncated"] or len(first["calls"]) != 1
                or first["calls"][0]["name"] != tool["name"]
                or first["calls"][0]["arguments"] != {"probe": "ready"}):
            raise InvalidProviderResponse("probe_tool_request", stage="capability", protocol=model.protocol, mode=mode)
        # Generated after turn one, so ordinary text connectivity cannot pass.
        answer = "CAPABILITY_OK_" + uuid.uuid4().hex
        frames += [first["frame"], *provider.tool_frames(model, first["calls"], [{"answer": answer}])]
        before_call(2)
        second = provider.turn(model, frames, system, [], retain_reasoning=True, **kw)
        if second["calls"] or second["truncated"] or second["text"] != answer:
            raise InvalidProviderResponse("probe_final_answer", stage="capability", protocol=model.protocol, mode=mode)


def run(model, principal, request_id, mode):
    from . import chat, configuration, models as m, provider, transport
    if not isinstance(mode, str) or mode not in MODES:
        raise AiError("模型测试模式无效")
    current_principal(principal, write=True, admin=True)
    attempted = []
    def before_call(ordinal):
        with mutation(principal):
            current_principal(principal, write=True, admin=True)
            current = configuration.resolve_model(model.id)
            if current.version != model.version:
                raise AiError("模型配置已变化，请重新测试", "model_version_changed", 409)
            chat.dispatch_budget(principal.email.lower(), model.id)
            chat.audit(principal, request_id, "model_probe", "started",
                       arguments={"modelId": model.id, "mode": mode, "ordinal": ordinal,
                                  "adapterVersion": PROVIDER_ADAPTER_VERSION})
            attempted.append(ordinal)
    error = None
    try:
        with transport.request_budget(options(model)["taskTimeoutMs"] / 1000):
            if mode == "connection":
                before_call(1)
                provider.probe(model)
            else:
                if model.max_tool_rounds < 2 or model.max_total_tool_calls < 1:
                    raise InvalidProviderResponse("probe_budget_insufficient", stage="capability", protocol=model.protocol,
                                                  mode="sse" if mode == "tool_roundtrip_sse" else "json")
                tool_roundtrip(model, streaming=mode == "tool_roundtrip_sse", before_call=before_call)
    except AiError as caught:
        error = caught
    observation = {"status": "failed" if error else "passed", "testedAt": timezone.now().isoformat()}
    if error:
        observation["errorCode"] = error.code
        if isinstance(error, InvalidProviderResponse):
            observation["reason"] = error.diagnostics["reason"]
    with mutation(principal):
        # Preserve the other mode's result, but never bind this observation to
        # a configuration edited during a paid call.
        current = m.AiModels.objects.filter(id=model.id, version=model.version).first()
        if not current:
            raise AiError("模型配置已变化，本次测试不适用于当前配置", "model_version_changed", 409)
        value = stored(current)
        if value.get("fingerprint") != fingerprint(model):
            value = {}
        value.update(kind="provider-capabilities-v1", fingerprint=fingerprint(model), adapterVersion=PROVIDER_ADAPTER_VERSION)
        value[KINDS[mode]] = observation
        current.last_test_result = canonical(value)
        current.last_tested_at = timezone.now()
        current.save(update_fields=["last_test_result", "last_tested_at"])
        chat.audit(principal, request_id, "model_probe", "failed" if error else "succeeded",
                   arguments={"modelId": model.id, "mode": mode, "providerCalls": len(attempted)},
                   result={"status": observation["status"], "reason": observation.get("reason")},
                   error_code=error.code if error else None)
    if error:
        raise error
    return {"ok": True, "message": LABELS[mode] + "测试通过", "capabilityProbe": record(current)}
