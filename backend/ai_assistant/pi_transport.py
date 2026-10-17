"""The single, non-retrying transport to the loopback PiRunner."""
import hashlib
import hmac
import http.client
import json
import os
import re
import time
import uuid
from pathlib import Path
from django.conf import settings

from .policy import AiError, canonical

PATH = "/v1/command"
PORT = 8123
MAX_RESPONSE = 13 * 1024 * 1024


def secret():
    path = os.getenv("PI_RUNNER_HMAC_KEY_FILE", "")
    if path:
        from pandas_runner.key_file import read_key
        try:
            if not Path(path).is_absolute():
                raise ValueError("absolute_key_path_required")
            key = read_key(path)
            if not 32 <= len(key) <= 128:
                raise ValueError("key_size")
            return key
        except (OSError, ValueError, TypeError) as error:
            raise AiError("PiRunner 独立密钥文件无效", "service_unavailable", 503) from error
    if settings.DJANGO_ENVIRONMENT == "production":
        raise AiError("生产 PiRunner 必须使用独立 DPAPI 密钥文件", "service_unavailable", 503)
    value = os.getenv("PI_RUNNER_HMAC_SECRET", "")
    if not 32 <= len(value.encode()) <= 512:
        raise AiError("PiRunner 独立签名未配置", "service_unavailable", 503)
    return value.encode()


def signature(key, stamp, nonce, raw, direction="request"):
    message = "\n".join(("pi-runner-v1", direction, "POST", PATH, stamp, nonce, hashlib.sha256(raw).hexdigest()))
    return hmac.new(key, message.encode(), hashlib.sha256).hexdigest()


def command(value):
    # HTTPConnection has no proxy/redirect/retry facility. Exact loopback only.
    raw = canonical(value).encode()
    if len(raw) > 12 * 1024 * 1024:
        raise AiError("PiRunner 输入超过传输限额", "payload_too_large", 413)
    stamp, nonce, key = str(int(time.time())), uuid.uuid4().hex, secret()
    timeout = {"create": 60, "prompt": 45, "abort": 45, "dispose": 30, "skills": 45}.get(value.get("command"), 15)
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=timeout)
    try:
        conn.request("POST", PATH, raw, {"Content-Type": "application/json", "X-Timestamp": stamp,
            "X-Nonce": nonce, "X-Signature": signature(key, stamp, nonce, raw)})
        reply = conn.getresponse()
        body = reply.read(MAX_RESPONSE + 1)
        if (reply.status != 200 or len(body) > MAX_RESPONSE
                or reply.getheader("Content-Type", "").split(";")[0] != "application/json"
                or not hmac.compare_digest(reply.getheader("X-Signature", ""), signature(key, stamp, nonce, body, "response"))):
            raise AiError("PiRunner 响应未知，禁止重发", "pi_runner_unknown", 503)
        result = json.loads(body)
        for field in ("operationId", "ownerId", "conversationId", "epoch", "generation", "seq"):
            if result.get(field) != value[field]:
                raise AiError("PiRunner 响应身份不匹配", "pi_runner_unknown", 503)
        return result
    except (OSError, ValueError, TypeError, http.client.HTTPException) as error:
        raise AiError("PiRunner 响应未知，禁止重发", "pi_runner_unknown", 503) from error
    finally:
        conn.close()


def verify_gateway(request):
    if request.method != "POST" or request.path != "/api/ai/pi/gateway" or request.content_type != "application/json":
        raise AiError("Pi 网关路径或方法无效", "access_denied", 403)
    stamp, nonce = request.headers.get("X-Pi-Timestamp", ""), request.headers.get("X-Pi-Nonce", "")
    if not re.fullmatch(r"[0-9]{1,12}", stamp) or abs(time.time() - int(stamp)) > 60 or not re.fullmatch(r"[a-f0-9]{32}", nonce):
        raise AiError("Pi 网关签名已过期或无效", "access_denied", 403)
    raw = request.body
    if len(raw) > 8 * 1024 * 1024:
        raise AiError("Pi 网关输入超限", "payload_too_large", 413)
    message = "\n".join(("pi-gateway-v1", "runner-to-django", "POST", request.path, stamp, nonce, hashlib.sha256(raw).hexdigest()))
    expected = hmac.new(secret(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("X-Pi-Signature", "")):
        raise AiError("Pi 网关签名无效", "access_denied", 403)
    return nonce
