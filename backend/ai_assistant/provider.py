from __future__ import annotations
import json
import base64
import struct
import zlib
import re
from .configuration import endpoint
from .policy import AiError, passive
from .secrets import decrypt
from .transport import bounded_json


def turn(model, transcript, system, tools):
    base = endpoint(model.base_url)
    key = decrypt(model.api_key_encrypted)
    if model.protocol == "anthropic":
        body = {
            "model": model.model_name,
            "max_tokens": model.max_tokens,
            "system": system,
            "messages": transcript,
            "temperature": model.temperature_milli / 1000,
        }
        if tools:
            body["tools"] = [
                {
                    "name": t["name"],
                    "description": t["description"],
                    "input_schema": t["inputSchema"],
                }
                for t in tools
            ]
        result = bounded_json(
            base + "/messages",
            body,
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
            timeout=model.timeout_ms / 1000,
        )
        blocks = result.get("content")
        if not isinstance(blocks, list):
            raise AiError("模型返回格式无效", "invalid_provider_response", 503)
        calls = []
        texts = []
        for b in blocks:
            if not isinstance(b, dict):
                raise AiError("模型返回块无效", "invalid_provider_response", 503)
            if b.get("type") == "text" and isinstance(b.get("text"), str):
                texts.append(b["text"])
            elif b.get("type") == "tool_use":
                calls.append(
                    {
                        "id": b.get("id"),
                        "name": b.get("name"),
                        "arguments": b.get("input"),
                    }
                )
        frame = {"role": "assistant", "content": blocks}
    else:
        body = {
            "model": model.model_name,
            "max_tokens": model.max_tokens,
            "messages": [{"role": "system", "content": system}, *transcript],
            "temperature": model.temperature_milli / 1000,
        }
        if model.reasoning_mode == "disabled":
            body["thinking"] = {"type": "disabled"}
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["inputSchema"],
                    },
                }
                for t in tools
            ]
        result = bounded_json(
            base + "/chat/completions",
            body,
            {"Authorization": "Bearer " + key},
            timeout=model.timeout_ms / 1000,
        )
        choices = result.get("choices")
        if (
            not isinstance(choices, list)
            or len(choices) != 1
            or not isinstance(choices[0], dict)
            or not isinstance(choices[0].get("message"), dict)
        ):
            raise AiError("模型返回格式无效", "invalid_provider_response", 503)
        message = choices[0]["message"]
        frame = {"role": "assistant", "content": message.get("content")}
        raw_calls = message.get("tool_calls", [])
        if not isinstance(raw_calls, list):
            raise AiError("工具调用格式无效", "invalid_provider_response", 503)
        if raw_calls:
            frame["tool_calls"] = raw_calls
        texts = [message["content"]] if isinstance(message.get("content"), str) else []
        calls = []
        for call in raw_calls:
            try:
                args = json.loads(call["function"]["arguments"])
                calls.append(
                    {
                        "id": call["id"],
                        "name": call["function"]["name"],
                        "arguments": args,
                    }
                )
            except (KeyError, TypeError, ValueError) as e:
                raise AiError(
                    "工具调用参数无效", "invalid_provider_response", 503
                ) from e
    if (
        len(calls) > 8
        or any(
            not isinstance(c["id"], str)
            or not c["id"]
            or len(c["id"]) > 200
            or not isinstance(c["name"], str)
            or not isinstance(c["arguments"], dict)
            for c in calls
        )
        or len({c["id"] for c in calls}) != len(calls)
    ):
        raise AiError("模型工具调用越界", "invalid_provider_response", 503)
    for c in calls:
        passive(c["arguments"], 8000)
    answer = "\n".join(texts)
    if not answer and not calls:
        raise AiError("模型没有返回正文", "invalid_provider_response", 503)
    return {
        "text": answer,
        "calls": calls,
        "frame": frame,
        "usage": result.get("usage", {}),
        "providerRequestId": str(result.get("id", ""))[:200],
    }


def probe(model):
    if model.model_type != "vision":
        turn(model, [{"role": "user", "content": "请回复连接成功"}], "连接测试", [])
        return "文本连接成功"

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\0\0" * 2) * 2))
        + chunk(b"IEND", b"")
    )
    encoded = base64.b64encode(png).decode()
    prompt = "只回答图片中的主要颜色，不要猜测未看到的内容。"
    content = (
        [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": encoded,
                },
            },
            {"type": "text", "text": prompt},
        ]
        if model.protocol == "anthropic"
        else [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64," + encoded},
            },
        ]
    )
    result = turn(model, [{"role": "user", "content": content}], "图片能力测试", [])
    if not re.search(r"红|\bred\b", result["text"], re.I):
        raise AiError("模型未通过真实图片识别测试", "invalid_provider_response", 503)
    return "图片识别连接成功"


def tool_frames(model, calls, results):
    if model.protocol == "anthropic":
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": call["id"],
                        "content": json.dumps(result, ensure_ascii=False),
                    }
                    for call, result in zip(calls, results)
                ],
            }
        ]
    return [
        {
            "role": "tool",
            "tool_call_id": call["id"],
            "content": json.dumps(result, ensure_ascii=False),
        }
        for call, result in zip(calls, results)
    ]
