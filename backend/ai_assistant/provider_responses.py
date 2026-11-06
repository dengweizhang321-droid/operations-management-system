"""Stateless Responses wire adapter. Conversation history and tool ownership stay local."""
from .provider_contract import InvalidProviderResponse
from .policy import AiError


def _invalid(reason):
    return InvalidProviderResponse(reason, protocol="openai_responses")


def _user_content(content):
    if isinstance(content, str):
        return content
    parts = []
    for part in content:
        if part.get("type") == "text":
            parts.append({"type": "input_text", "text": part["text"]})
        elif part.get("type") == "image_url":
            image = part["image_url"]
            parts.append({"type": "input_image", "image_url": image["url"], "detail": image.get("detail", "auto")})
        else:
            raise AiError("Responses 不支持此输入材料")
    return parts


def _replay(item):
    kind = item.get("type") if isinstance(item, dict) else None
    identity = {}
    if isinstance(item, dict) and "id" in item:
        if not isinstance(item["id"], str) or not item["id"]:
            raise _invalid("responses_item_id")
        identity["id"] = item["id"]
    if kind == "reasoning":
        encrypted = item.get("encrypted_content")
        if not isinstance(encrypted, str) or not encrypted:
            raise _invalid("responses_reasoning_encrypted_content")
        summary = item.get("summary", [])
        if not isinstance(summary, list) or any(not isinstance(entry, dict)
                or entry.get("type") != "summary_text" or not isinstance(entry.get("text"), str) for entry in summary):
            raise _invalid("responses_reasoning_summary")
        return {"type": kind, **identity, "summary": summary, "encrypted_content": encrypted}
    if kind == "function_call":
        if item.get("status", "completed") != "completed":
            raise _invalid("responses_unfinished_function_call")
        fields = ("call_id", "name", "arguments")
        if not all(isinstance(item.get(k), str) for k in fields):
            raise _invalid("responses_function_call")
        return {"type": kind, **identity, **{k: item[k] for k in fields}, "status": "completed"}
    if kind == "message" and item.get("role") == "assistant":
        content = item.get("content")
        if not isinstance(content, list):
            raise _invalid("responses_message")
        parts = []
        for p in content:
            if not isinstance(p, dict) or p.get("type") not in {"output_text", "refusal"}:
                raise _invalid("responses_content")
            key = "text" if p["type"] == "output_text" else "refusal"
            if not isinstance(p.get(key), str):
                raise _invalid("responses_content")
            parts.append({"type": p["type"], key: p[key], **({"annotations": []} if key == "text" else {})})
        phase = item.get("phase")
        if phase is not None and phase not in {"commentary", "final_answer"}:
            raise _invalid("responses_message_phase")
        return {"type": kind, **identity, "role": "assistant", "content": parts,
                **({"phase": phase} if phase is not None else {})}
    raise _invalid("responses_unexpected_item")


def request_body(model, cfg, transcript, instructions, tools, extra):
    items = []
    for frame in transcript:
        role = frame["role"]
        if role == "tool":
            items.append({"type": "function_call_output", "call_id": frame["tool_call_id"], "output": frame["content"]})
        elif role == "assistant" and "responses_items" in frame:
            items.extend(_replay(item) for item in frame["responses_items"])
        elif role == "assistant":
            if frame.get("content"):
                items.append({"role": role, "content": frame["content"]})
            for call in frame.get("tool_calls", ()):
                items.append({"type": "function_call", "call_id": call["id"], **call["function"]})
        elif role in {"user", "system", "developer"}:
            items.append({"role": role, "content": _user_content(frame["content"])})
        else:
            raise AiError("Responses 会话帧角色无效")
    body = {"model": model.model_name, "input": items, "instructions": instructions,
            "store": False, "include": ["reasoning.encrypted_content"], "max_output_tokens": model.max_tokens}
    if cfg["temperatureMode"] == "custom":
        body["temperature"] = model.temperature_milli / 1000
    effort = "none" if model.reasoning_mode == "disabled" else cfg["reasoningEffort"]
    if effort != "default":
        body["reasoning"] = {"effort": effort}
    if tools:
        body["tools"] = [{"type": "function", "name": t["name"], "description": t["description"],
                          "parameters": t["inputSchema"], "strict": False} for t in tools]
    if extra:
        body["text"] = {"format": {"type": "json_schema", **extra["response_format"]["json_schema"]}}
    return body


def normalize(response):
    status = response.get("status")
    if status == "incomplete" and (response.get("incomplete_details") or {}).get("reason") == "max_output_tokens":
        finish = "length"
    elif status == "completed":
        finish = "stop"
    else:
        raise _invalid("responses_terminal_status")
    if not isinstance(response.get("output"), list):
        raise _invalid("responses_output")
    items = [_replay(item) for item in response["output"]]
    calls, texts = [], []
    for item in items:
        if item["type"] == "function_call":
            calls.append({"type": "function", "id": item["call_id"],
                          "function": {"name": item["name"], "arguments": item["arguments"]}})
        elif item["type"] == "message":
            texts.extend(p.get("text", p.get("refusal", "")) for p in item["content"])
    if calls and finish == "length":
        raise _invalid("responses_incomplete_tool_call")
    message = {"role": "assistant", "content": "".join(texts), "tool_calls": calls}
    return {"id": response.get("id", ""), "usage": response.get("usage") or {}, "responses_items": items,
            "choices": [{"index": 0, "finish_reason": "tool_calls" if calls else finish, "message": message}]}
