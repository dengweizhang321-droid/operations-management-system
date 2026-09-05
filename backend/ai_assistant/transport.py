"""Bounded HTTPS, exact origins, fixed DNS result, no redirects or automatic retries."""

from __future__ import annotations
import base64
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import socket
import ssl
import time
from contextlib import contextmanager
from contextvars import ContextVar
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from threading import BoundedSemaphore
from urllib.parse import urlsplit
from django.conf import settings
from .policy import AiError, canonical, current_principal, uid

_deadline = ContextVar("ai_network_deadline", default=None)
_dns_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ai-dns")
_dns_slots = BoundedSemaphore(4)


@contextmanager
def request_budget(seconds):
    token = _deadline.set(time.monotonic() + seconds)
    try:
        yield
    finally:
        _deadline.reset(token)


def remaining_budget(default=120):
    deadline = _deadline.get()
    remaining = (
        default if deadline is None else min(default, deadline - time.monotonic())
    )
    if remaining <= 0:
        raise AiError("AI 请求已达到总时间上限", "provider_timeout", 503)
    return remaining


def resolve_addresses(host, port, timeout):
    if not _dns_slots.acquire(blocking=False):
        raise AiError("DNS 请求繁忙", "service_unavailable", 503)
    future = _dns_pool.submit(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        return future.result(timeout=min(5, timeout))
    except (OSError, FutureTimeout) as error:
        raise AiError("DNS 查询失败或超时", "service_unavailable", 503) from error


def bounded_json(
    url, body, headers=None, *, timeout=60, maximum=2 * 1024 * 1024, internal=False
):
    parts = urlsplit(url)
    if (
        parts.scheme not in {"https", "http"}
        or parts.username
        or parts.password
        or parts.fragment
    ):
        raise AiError("请求目标无效")
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == "https" else 80)
    local = host in {"127.0.0.1", "localhost", "::1"}
    permit_local = (
        internal
        or settings.DJANGO_ENVIRONMENT == "development"
        and os.getenv("AI_ALLOW_LOCAL_MODEL_ENDPOINTS") == "true"
    )
    if internal and not local:
        raise AiError("内部执行桥必须使用回环地址", "service_unavailable", 503)
    if parts.scheme == "http" and not (local and permit_local):
        raise AiError("请求必须使用 HTTPS")
    timeout = remaining_budget(timeout)
    started = time.monotonic()
    addresses = resolve_addresses(host, port, timeout)
    if not addresses or len(addresses) > 32:
        raise AiError("DNS 结果异常", "service_unavailable", 503)
    for addr in addresses:
        if not ipaddress.ip_address(addr[4][0]).is_global and not (
            local and permit_local
        ):
            raise AiError("请求目标解析到非公网地址", "access_denied", 403)
    family, socktype, proto, _, target = addresses[0]
    remaining = timeout - (time.monotonic() - started)
    if remaining <= 0:
        raise AiError("请求超时", "provider_timeout", 503)
    sock = socket.socket(family, socktype, proto)
    sock.settimeout(remaining)
    connection = None

    def bounded_socket():
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise AiError("请求超时", "provider_timeout", 503)
        sock.settimeout(remaining)

    try:
        sock.connect(target)
        if parts.scheme == "https":
            bounded_socket()
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
        connection = http.client.HTTPConnection(host, port, timeout=remaining)
        connection.sock = sock
        data = canonical(body).encode()
        request_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            **(headers or {}),
        }
        bounded_socket()
        connection.request(
            "POST",
            parts.path + ("?" + parts.query if parts.query else ""),
            data,
            request_headers,
        )
        bounded_socket()
        response = connection.getresponse()
        if 300 <= response.status < 400:
            raise AiError("拒绝重定向", "provider_redirect", 503)
        length = response.getheader("Content-Length")
        if length and (not length.isdigit() or int(length) > maximum):
            raise AiError("响应超限", "response_too_large", 503)
        chunks = []
        count = 0
        while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise AiError("请求超时", "provider_timeout", 503)
            sock.settimeout(remaining)
            part = response.read1(min(65536, maximum - count + 1))
            if not part:
                break
            count += len(part)
            if count > maximum:
                raise AiError("响应超限", "response_too_large", 503)
            chunks.append(part)
        if not 200 <= response.status < 300:
            raise AiError(
                f"服务返回 HTTP {response.status}",
                "provider_rate_limited" if response.status == 429 else "provider_error",
                503,
            )
        value = json.loads(b"".join(chunks).decode("utf-8"))
        if not isinstance(value, dict):
            raise AiError("响应 JSON 无效", "invalid_provider_response", 503)
        return value
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise AiError(
            "服务请求失败或响应格式无效", "provider_unavailable", 503
        ) from error
    finally:
        if connection:
            connection.close()
        sock.close()


def signed_headers(path, body, principal, request_id=None):
    secret = os.getenv("TERUISI_DJANGO_INTERNAL_SECRET", "")
    if len(secret.encode()) < 32:
        raise AiError("内部签名服务未配置", "service_unavailable", 503)
    request_id = request_id or uid("ai-edge")
    stamp = str(int(time.time()))
    encoded = (
        base64.urlsafe_b64encode(
            canonical(
                {
                    "email": principal.email,
                    "displayName": principal.display_name,
                    "role": principal.role,
                    "scope": principal.scope,
                }
            ).encode()
        )
        .decode()
        .rstrip("=")
    )
    sha = hashlib.sha256(canonical(body).encode()).hexdigest()
    message = "\n".join(["v1", stamp, request_id, "POST", path, "", sha, encoded])
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {
        "X-Teruisi-Principal": encoded,
        "X-Teruisi-Timestamp": stamp,
        "X-Teruisi-Request-Id": request_id,
        "X-Teruisi-Content-SHA256": sha,
        "X-Teruisi-Signature": "v1=" + signature,
    }


def edge(action, payload, principal):
    if action not in {"authorize_background", "catalog", "execute", "dataset"}:
        raise AiError("AI 内部动作不受支持", "access_denied", 403)
    if action != "authorize_background":
        current_principal(principal)
    base = os.getenv("TERUISI_DJANGO_AI_EDGE_BASE_URL", "").rstrip("/")
    if not base:
        raise AiError("AI 工具执行桥未配置", "service_unavailable", 503)
    path = "/api/ai/internal/edge"
    body = {"action": action, **payload}
    return bounded_json(
        base + path,
        body,
        signed_headers(path, body, principal),
        timeout=35,
        maximum=10 * 1024 * 1024,
        internal=True,
    )


def catalog(principal, surface):
    result = edge("catalog", {"surface": surface}, principal)
    entries = result.get("entries")
    if (
        not isinstance(entries, list)
        or len(entries) > 100
        or len({v.get("name") for v in entries}) != len(entries)
    ):
        raise AiError("中央工具目录无效", "service_unavailable", 503)
    return entries


def execute_tool(
    name, args, principal, *, surface, request_id, provider_call_id="", policy_digest=""
):
    return edge(
        "execute",
        {
            "name": name,
            "arguments": args,
            "surface": surface,
            "requestId": request_id,
            "providerCallId": provider_call_id,
            "policyDigest": policy_digest,
        },
        principal,
    )
