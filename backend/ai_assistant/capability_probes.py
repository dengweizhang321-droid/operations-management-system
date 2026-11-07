"""Synthetic provider probes; no business tool, data or external delivery."""
import json
import uuid
from copy import deepcopy
from django.utils import timezone
from . import output_schemas
from .policy import AiError, canonical, digest, mutation, current_principal
from .provider_contract import PROVIDER_ADAPTER_VERSION, InvalidProviderResponse
from .model_capabilities import options, structured_output_parameters

LABELS = {"connection": "普通连接", "tool_roundtrip_json": "非流式工具闭环",
          "tool_roundtrip_sse": "SSE 工具闭环", "structured_output": "Skill 原生 JSON Schema"}
KINDS = {"connection": "connection", "tool_roundtrip_json": "nonStreaming", "tool_roundtrip_sse": "sse",
         "structured_output": "structuredOutput"}
STRUCTURED_CONTRACT = "skill-candidate-v1"


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
        applicable = current
        if key == "structuredOutput" and isinstance(observation, dict):
            applicable = applicable and observation.get("schemaDigest") == output_schemas.resolve(STRUCTURED_CONTRACT)["schemaDigest"]
        status = observation.get("status") if isinstance(observation, dict) else None
        known = {"passed", "failed", "inconclusive"}
        item = {"status": (status if applicable else "expired") if isinstance(status, str) and status in known else "unverified"}
        if isinstance(observation, dict):
            for field in ("testedAt", "errorCode", "reason"):
                if isinstance(observation.get(field), str) and len(observation[field]) <= 100:
                    item[field] = observation[field]
        result[key] = item
    return result


def summary(model):
    value = record(model)
    labels = {"passed": "通过", "failed": "失败", "inconclusive": "未取得结论", "expired": "已过期，需重测", "unverified": "未验证"}
    return " · ".join(f"{LABELS[mode]}：{labels[value[key]['status']]}" for mode, key in KINDS.items())


def require_structured(model, contract):
    value = stored(model)
    observation = value.get("structuredOutput", {})
    if (value.get("fingerprint") != fingerprint(model)
            or value.get("adapterVersion") != PROVIDER_ADAPTER_VERSION
            or not isinstance(observation, dict) or observation.get("status") != "passed"
            or observation.get("schemaDigest") != contract["schemaDigest"]
            or options(model)["structuredOutputSupport"] != "json_schema"):
        raise AiError("该模型当前配置尚未通过 Skill 原生 JSON Schema 测试，请在 AI 管理中核验",
                      "structured_output_unverified", 409)


def structured_probe(model, contract, before_call):
    from . import provider
    schema = deepcopy(contract["schema"])
    # The randomly generated value exists only in the native schema, not in
    # the prompt or a tool definition. Plain JSON and ignored schemas fail.
    schema["properties"]["goal"]["enum"] = ["SCHEMA_OK_" + uuid.uuid4().hex]
    structured = {"name": contract["name"], "schema": schema}
    structured_output_parameters(model, schema_name=structured["name"], schema=schema)
    with provider.conversation_session("schema-probe-" + uuid.uuid4().hex):
        before_call(1)
        result = provider.turn(model, [{"role": "user", "content": "测试正文格式。"}],
                               "只返回单词 READY。", [], structured_output=structured, preserve_context=True)
    try:
        if (result["calls"] or result["truncated"]
                or not output_schemas.matches(json.loads(result["text"]), schema)):
            raise ValueError
    except (ValueError, TypeError, RecursionError) as error:
        raise InvalidProviderResponse("probe_native_schema_mismatch", stage="capability",
                                      protocol=model.protocol, mode="json") from error


def probe_outcome_known(error):
    from . import provider, transport
    if isinstance(error, provider.ProviderCredentialError):
        return True
    if isinstance(error, transport.ProviderTransportError):
        return not error.diagnostics["requestStarted"]
    if isinstance(error, transport.ProviderHttpError):
        return error.diagnostics["httpStatus"] < 500
    return error.code not in {"provider_timeout", "provider_unavailable", "service_unavailable"}


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
    if not isinstance(mode, str) or mode not in KINDS:
        raise AiError("模型测试模式无效")
    current_principal(principal, write=True, admin=True)
    contract = output_schemas.resolve(STRUCTURED_CONTRACT) if mode == "structured_output" else None
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
            elif contract:
                structured_probe(model, contract, before_call)
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
    if contract:
        observation["schemaDigest"] = contract["schemaDigest"]
        if error and observation.get("reason") != "probe_native_schema_mismatch":
            observation["status"] = "inconclusive"
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
        if contract and (not attempted or probe_outcome_known(error)):
            return {"ok": False, "message": str(error), "capabilityProbe": record(current)}
        raise error
    return {"ok": True, "message": LABELS[mode] + "测试通过", "capabilityProbe": record(current)}
