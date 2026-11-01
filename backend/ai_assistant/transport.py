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
from contextlib import contextmanager, nullcontext
from contextvars import ContextVar
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from threading import BoundedSemaphore, Event, Lock, Thread
from urllib.parse import urlencode, urlsplit
from django.conf import settings
from .policy import AiError, canonical, current_principal, uid
from .provider_contract import InvalidProviderResponse, PROVIDER_ADAPTER_VERSION

_deadline = ContextVar("ai_network_deadline", default=None)
_cancel_check = ContextVar("ai_network_cancel_check", default=None)
_cancel_watcher_scope = ContextVar("ai_network_cancel_watcher_scope", default=None)
_dns_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ai-dns")
_dns_slots = BoundedSemaphore(4)
_synthetic_network = ipaddress.ip_network("198.18.0.0/15")
# Pinned public DoH resolvers, tried in order. Each must answer the same
# RFC 8427 JSON shape this module validates; resolvers that return a bare
# Question object instead of a list are not interchangeable here.
_doh_resolvers = (("1.1.1.1", "/dns-query"), ("1.12.12.12", "/dns-query"))
_fallback_resolver_budget = 3


class ProviderTransportError(AiError):
    """Fixed network metadata only; no upstream text, addresses or credentials."""
    def __init__(self, *, stage, reason, request_started=False, resolver_phase=None):
        dns = stage in {"system_dns", "dns_recovery"}
        timeout = reason == "timeout"
        code = ("provider_dns_timeout" if timeout else "provider_dns_unavailable") if dns else (
            "provider_timeout" if timeout else "provider_unavailable")
        message = ("模型或工具域名解析超时，本次请求未自动重试" if timeout else "模型或工具域名解析失败，本次请求未自动重试") if dns else (
            "模型或工具服务等待超时，本次请求未自动重试" if timeout else "模型或工具服务连接失败，本次请求未自动重试")
        super().__init__(message, code, 503)
        self.diagnostics = {"adapterVersion": PROVIDER_ADAPTER_VERSION,
                            "stage": stage, "reason": reason,
                            "requestStarted": request_started}
        if resolver_phase in {"connect", "tls", "request_send", "response_headers", "response_body"}:
            self.diagnostics["resolverPhase"] = resolver_phase


class CancellationCheckError(ProviderTransportError):
    """Content-free failure of the authority check, never a provider diagnosis."""
    def __init__(self, error=None, *, stage="cancel_check", request_started=False, reason=None):
        from django.db import DatabaseError
        sql_state = None
        current = error
        for _ in range(5):
            if current is None:
                break
            value = getattr(current, "sqlstate", None)
            if isinstance(value, str) and len(value) == 5 and value.isalnum():
                sql_state = value
                break
            current = current.__cause__
        reason = reason or ("database_capacity" if sql_state == "53300" else
            "database_unavailable" if isinstance(error, DatabaseError) else "check_failed")
        super().__init__(stage=stage, reason=reason, request_started=request_started)
        self.code = "ai_cancellation_check_unavailable"
        self.args = ("任务取消或权限检查暂不可用，本次请求结果未知且未自动重试",)
        if sql_state is not None:
            self.diagnostics["sqlState"] = sql_state


def _network_budget(timeout, stage, request_started=False):
    try:
        return remaining_budget(timeout)
    except CancellationCheckError as error:
        error.diagnostics["requestStarted"] = request_started
        raise
    except AiError as error:
        if error.code == "provider_timeout":
            raise ProviderTransportError(stage=stage, reason="timeout", request_started=request_started) from error
        raise


class ProviderHttpError(AiError):
    """Keep transport status for audit without disclosing an upstream body."""
    def __init__(self, status, body=b""):
        code = "provider_rate_limited" if status == 429 else "provider_error"
        message = f"模型服务返回 HTTP {status}，请检查 AI 助理中的模型配置与服务状态。"
        # Only a fixed code is interpreted; upstream prose may contain secrets
        # or prompt content and must never reach UI, logs or audit diagnostics.
        if status == 400 and len(body) <= 16384:
            try:
                error = json.loads(body).get("error")
                if isinstance(error, dict) and error.get("code") == "InvalidSubscription":
                    code = "provider_subscription_invalid"
                    message = "当前模型的订阅校验未通过，请在 AI 助理中检查订阅、API 密钥与模型权限，或配置可用模型后重试。"
            except (ValueError, TypeError, AttributeError, RecursionError):
                pass
        super().__init__(message, code, 503)
        self.diagnostics = {"httpStatus": status}


@contextmanager
def request_budget(seconds):
    parent = _deadline.get()
    deadline = time.monotonic() + seconds if seconds is not None else parent
    token = _deadline.set(min(parent, deadline) if parent is not None and deadline is not None else deadline)
    try:
        yield
    finally:
        _deadline.reset(token)


def remaining_budget(default=120):
    check = _cancel_check.get()
    if check:
        try:
            check()
        except AiError:
            raise
        except Exception as error:
            raise CancellationCheckError(error) from error
    deadline = _deadline.get()
    remaining = (
        default if deadline is None else min(default, deadline - time.monotonic())
    )
    if remaining <= 0:
        raise AiError("AI 请求已达到总时间上限", "provider_timeout", 503)
    return remaining


def limit_request_budget(seconds):
    current = _deadline.get()
    desired = time.monotonic() + seconds
    _deadline.set(min(current, desired) if current is not None else desired)


@contextmanager
def request_cancellation(check, *, watcher_scope=None):
    token = _cancel_check.set(check)
    scope_token = _cancel_watcher_scope.set(watcher_scope)
    try:
        yield
    finally:
        _cancel_watcher_scope.reset(scope_token)
        _cancel_check.reset(token)


class _SocketCancellationWatch:
    def __init__(self, current_socket, check, scope, timeout):
        self.current_socket, self.check, self.scope, self.timeout = current_socket, check, scope, timeout
        self.stopped, self.ready, self.finished = Event(), Event(), Event()
        self.lock = Lock()
        self.failure = None
        self.failure_stage = "cancel_preflight"
        self.admitted = False
        self.thread = Thread(target=self._watch, name="ai-http-cancellation", daemon=True) if check else None
        if self.thread:
            self.thread.start()
        else:
            self.admitted = True
            self.ready.set(); self.finished.set()

    def _fail(self, error, stage):
        with self.lock:
            if self.failure is None:
                self.failure, self.failure_stage = error, stage
            self.ready.set()
            # A late DB result must never detach a socket after its caller has
            # stopped the watcher and may have released/reused the OS handle.
            if self.stopped.is_set():
                return
            owned_socket = self.current_socket()
            try:
                owned_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            handle = owned_socket.detach()
            if handle != -1:
                socket.close(handle)

    def _watch(self):
        try:
            with self.scope(self.timeout) if self.scope else nullcontext():
                try:
                    self.check()
                    with self.lock:
                        if not self.stopped.is_set():
                            self.admitted = True
                        self.ready.set()
                    while not self.stopped.wait(.25):
                        self.check()
                except Exception as error:
                    self._fail(error, "cancel_check" if self.admitted else "cancel_preflight")
        except Exception as error:
            self._fail(error, "cancel_check" if self.admitted else "cancel_preflight")
        finally:
            self.finished.set()

    def raise_if_failed(self, *, request_started=False):
        with self.lock:
            error, stage = self.failure, self.failure_stage
        if error is None:
            return
        if isinstance(error, AiError):
            raise error
        raise CancellationCheckError(error, stage=stage, request_started=request_started) from error

    def __call__(self):
        with self.lock:
            self.stopped.set()
        if self.thread:
            self.thread.join(timeout=1)
        return self.finished.is_set()

    def require_finished(self, *, request_started=False):
        if not self.finished.is_set():
            raise CancellationCheckError(stage="cancel_cleanup", request_started=request_started, reason="cleanup_unconfirmed")


def watch_socket_cancellation(current_socket, *, timeout=60):
    """Admit the watcher before HTTP, retain its first failure, and own teardown."""
    handle = _SocketCancellationWatch(current_socket, _cancel_check.get(), _cancel_watcher_scope.get(), timeout)
    if not handle.ready.wait(max(0, timeout)):
        handle._fail(CancellationCheckError(stage="cancel_preflight", reason="check_timeout"), "cancel_preflight")
    try:
        handle.raise_if_failed()
        if not handle.admitted:
            raise CancellationCheckError(stage="cancel_preflight", reason="check_unavailable")
    except Exception as error:
        if not handle() and isinstance(error, CancellationCheckError):
            error.diagnostics["cleanupComplete"] = False
        raise
    return handle


def bounded_sse(url, body, headers, *, timeout, collector):
    from .model_capabilities import MAX_PROVIDER_STREAM_BYTES
    return _bounded_json(url, {**body, "stream": True}, {**headers, "Accept": "text/event-stream"},
                         timeout=timeout, stream_collector=collector, maximum=MAX_PROVIDER_STREAM_BYTES)


def resolve_addresses(host, port, timeout):
    if not _dns_slots.acquire(blocking=False):
        raise ProviderTransportError(stage="system_dns", reason="busy")
    future = _dns_pool.submit(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        return future.result(timeout=min(5, timeout))
    except FutureTimeout as error:
        raise ProviderTransportError(stage="system_dns", reason="timeout") from error
    except OSError as error:
        raise ProviderTransportError(stage="system_dns", reason="unavailable") from error


def bounded_json(
    url, body, headers=None, *, timeout=60, maximum=2 * 1024 * 1024, internal=False
):
    return _bounded_json(
        url, body, headers, timeout=timeout, maximum=maximum, internal=internal
    )


def public_model_addresses(url, addresses, timeout, *, exclude=frozenset()):
    from .configuration import endpoint
    return _public_addresses(url, addresses, timeout, endpoint, exclude=exclude)


def _recovery_answer(host, record_type, started, budget, ceiling, *, skip_resolvers=frozenset()):
    """Query the pinned resolvers in order; keep the first resolver's failure.

    A hijacking local proxy can break TLS to one fixed resolver while leaving
    another reachable, so a single pinned IP turns into a hard dependency.
    The reported diagnostics still describe the first failure so the receipt
    does not change shape when a later resolver also fails.

    `skip_resolvers` names resolvers the caller already asked this round and
    whose answer turned out entirely unusable (every address it returned had
    already failed to connect). They are skipped without being queried
    again, so a caller re-resolving after a connect failure can still reach
    a resolver further down the pinned list within the same budget.

    Returns the resolver's address, the answer, and the extra time a
    fallback resolver was granted beyond the shared budget. The caller must
    add that to its own anchor, otherwise its budget check would discard an
    answer a fallback just won.
    """
    first = None
    granted = 0.0
    for index, (resolver, path) in enumerate(_doh_resolvers):
        if resolver in skip_resolvers:
            continue
        if index == 0:
            remaining = budget - (time.monotonic() - started)
        else:
            # Fallback resolvers draw on their own small window. A resolver whose
            # TLS a local proxy breaks can consume the whole shared record-type
            # budget before any usable answer exists, so reusing that budget
            # would leave the fallback no time to run at all.
            spent = time.monotonic() - started
            remaining = min(
                _fallback_resolver_budget,
                budget + _fallback_resolver_budget - spent,
                # The caller's own deadline still bounds the whole recovery, so
                # a fallback never extends a request past what it was given.
                ceiling - spent,
            )
            # Whatever this attempt may spend past the shared budget is what the
            # caller has to forgive when it re-checks its own anchor.
            granted = max(0.0, min(spent + remaining, ceiling) - budget)
        if remaining <= 0:
            break
        # Fixed public IP avoids the same intercepted OS lookup. TLS verifies
        # this IP's certificate. No provider headers/body are sent to DNS.
        try:
            return resolver, granted, _bounded_json(
                f"https://{resolver}{path}?"
                + urlencode({"name": host, "type": record_type}),
                None,
                {"Accept": "application/dns-json"},
                timeout=remaining,
                maximum=16 * 1024,
                method="GET",
                fixed_addresses=[
                    (
                        socket.AF_INET,
                        socket.SOCK_STREAM,
                        socket.IPPROTO_TCP,
                        "",
                        (resolver, 443),
                    )
                ],
            )
        except AiError as error:
            # Reclassify only fixed transport/protocol failures from this DNS
            # GET. Permission changes and cancellation still propagate intact.
            if error.code not in {"provider_timeout", "provider_unavailable", "provider_error",
                                  "provider_rate_limited", "provider_subscription_invalid", "provider_redirect", "response_too_large",
                                  "invalid_provider_response"}:
                raise
            reason = "timeout" if error.code == "provider_timeout" else (
                "invalid_response" if error.code == "invalid_provider_response" else "unavailable")
            if first is None:
                first = ProviderTransportError(stage="dns_recovery", reason=reason,
                    resolver_phase=getattr(error, "diagnostics", {}).get("stage"))
                first.__cause__ = error
            # Try the next resolver only when this one never produced an
            # answer we could read: the TCP connect failed, or the connection
            # stalled before any response arrived. That is what a hijacking
            # local proxy does — measured here as a TLS handshake that times
            # out against one pinned IP while another answers in 140ms.
            #
            # Deliberately NOT retried: a resolver that did answer (HTTP
            # status, redirect, oversized or malformed body), and a TLS
            # certificate we cannot verify. The latter is a trust failure
            # rather than an unreachable host, and
            # `test_tls_failure_never_posts_or_retries` fixes that contract.
            stage = getattr(error, "diagnostics", {}).get("stage")
            unreachable = (
                error.code == "provider_unavailable" and stage == "connect"
            ) or (
                error.code == "provider_timeout"
                and stage in {"connect", "tls", "request_send", "response_headers"}
            )
            if not unreachable:
                raise first
    raise first or ProviderTransportError(stage="dns_recovery", reason="timeout")


def _public_addresses(url, addresses, timeout, origin_guard, *, exclude=frozenset()):
    """Replace proxy synthetic DNS only; never connect to or allowlist fake IPs.

    `exclude` names addresses a caller already proved unreachable (a resolver
    answered, but the single IP it gave failed to connect or complete TLS).
    This is a distinct retry layer from the resolver-unreachable handling in
    `_recovery_answer`: a resolver here can answer successfully and still be
    skipped, because its *answer* is useless, not because the resolver itself
    is unreachable. Skipping an all-excluded A answer still queries AAAA for
    the same resolver before moving on, matching the non-excluded order.
    """
    ips = [ipaddress.ip_address(addr[4][0]) for addr in addresses]
    if not any(ip in _synthetic_network for ip in ips):
        return addresses
    if any(not ip.is_global and ip not in _synthetic_network for ip in ips):
        raise AiError("请求目标解析到非公网地址", "access_denied", 403)
    # Each caller supplies its own exact origin policy before DNS recovery.
    origin_guard(url)
    parts = urlsplit(url)
    host = parts.hostname
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise AiError("禁止非公网模型地址", "access_denied", 403)
    started = time.monotonic()
    budget = min(5, timeout)
    result = []
    skip_resolvers = set()
    for record_type in (1, 28):
        # All-excluded answers below can make this record type retry across
        # every pinned resolver; `skip_resolvers` only grows within that, so
        # the loop still terminates once every resolver has been asked once.
        while True:
            remaining = budget - (time.monotonic() - started)
            if remaining <= 0:
                raise ProviderTransportError(stage="dns_recovery", reason="timeout")
            resolver, granted, answer = _recovery_answer(
                host, record_type, started, budget, timeout, skip_resolvers=skip_resolvers
            )
            # A fallback resolver ran past the shared budget by design. Without
            # extending the anchor, the checks below would read that as an expired
            # budget and throw away the answer the fallback just won.
            budget += granted
            question = answer.get("Question")
            records = answer.get("Answer", [])
            if (
                type(answer.get("Status")) is not int
                or answer["Status"] != 0
                or answer.get("TC") is not False
                or not isinstance(question, list)
                or len(question) != 1
                or not isinstance(question[0], dict)
                or not isinstance(question[0].get("name"), str)
                or question[0].get("name", "").rstrip(".").lower() != host.lower()
                or type(question[0].get("type")) is not int
                or question[0].get("type") != record_type
                or not isinstance(records, list)
                or len(records) > 32
            ):
                raise ProviderTransportError(stage="dns_recovery", reason="invalid_response")
            batch = []
            for record in records:
                if not isinstance(record, dict):
                    raise ProviderTransportError(stage="dns_recovery", reason="invalid_response")
                if type(record.get("type")) is not int:
                    raise ProviderTransportError(stage="dns_recovery", reason="invalid_response")
                if record["type"] not in (1, 28):
                    continue
                if record["type"] != record_type or not isinstance(record.get("data"), str):
                    raise ProviderTransportError(stage="dns_recovery", reason="invalid_response")
                try:
                    ip = ipaddress.ip_address(record.get("data"))
                except ValueError as error:
                    raise ProviderTransportError(stage="dns_recovery", reason="invalid_response") from error
                if (
                    not ip.is_global
                    or ip.is_multicast
                    or ip.version != (4 if record["type"] == 1 else 6)
                ):
                    raise AiError("请求目标解析到非公网地址", "access_denied", 403)
                family = socket.AF_INET if ip.version == 4 else socket.AF_INET6
                target = (str(ip), parts.port or 443)
                if ip.version == 6:
                    target += (0, 0)
                item = (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", target)
                if item not in batch:
                    batch.append(item)
            if budget - (time.monotonic() - started) <= 0:
                raise ProviderTransportError(stage="dns_recovery", reason="timeout")
            usable = [item for item in batch if item[4][0] not in exclude]
            if batch and not usable and len(skip_resolvers) + 1 < len(_doh_resolvers):
                # This resolver answered, but every address it gave is
                # already known-bad. Ask the next pinned resolver for this
                # same record type instead of accepting a useless answer;
                # the resolver-unreachable handling in `_recovery_answer`
                # stays untouched, since this resolver did answer.
                skip_resolvers.add(resolver)
                continue
            for item in usable:
                if item not in result:
                    result.append(item)
            break
        # A is sufficient for the single pinned connection. Validate the whole
        # A response first; query AAAA only for a valid, empty A response.
        if result:
            break
    if not result or len(result) > 32:
        raise ProviderTransportError(stage="dns_recovery", reason="no_addresses")
    return result


def _bounded_json(
    url,
    body,
    headers=None,
    *,
    timeout=60,
    maximum=2 * 1024 * 1024,
    internal=False,
    method="POST",
    fixed_addresses=None,
    stream_collector=None,
    resolver=None,
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
    timeout = _network_budget(timeout, "connect" if fixed_addresses is not None else "system_dns")
    started = time.monotonic()
    addresses = (
        fixed_addresses
        if fixed_addresses is not None
        else resolve_addresses(host, port, timeout)
    )
    if not addresses or len(addresses) > 32:
        raise ProviderTransportError(stage="system_dns", reason="invalid_response")
    if not internal and fixed_addresses is None and not local:
        addresses = public_model_addresses(
            url, addresses, timeout - (time.monotonic() - started)
        )
        # The model path can always ask the DNS layer for another batch that
        # excludes addresses already proven unreachable; a caller supplying
        # its own fixed_addresses (e.g. DingTalk) must opt in with its own
        # resolver to get the same second chance.
        if resolver is None:
            def resolver(tried):
                return public_model_addresses(
                    url,
                    resolve_addresses(host, port, timeout - (time.monotonic() - started)),
                    timeout - (time.monotonic() - started),
                    exclude=tried,
                )

    def admit(candidates):
        for addr in candidates:
            address = ipaddress.ip_address(addr[4][0])
            if (not address.is_global or address.is_multicast) and not (
                local and permit_local
            ):
                raise AiError("请求目标解析到非公网地址", "access_denied", 403)
        return candidates

    addresses = admit(addresses)
    remaining = timeout - (time.monotonic() - started)
    if remaining <= 0:
        raise ProviderTransportError(stage="system_dns", reason="timeout")
    phase = "connect"
    request_started = False
    stop_watching = None
    connection = None
    sock = None

    def bounded_socket():
        if stop_watching is not None:
            stop_watching.raise_if_failed(request_started=request_started)
        _network_budget(timeout, phase, request_started)
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise ProviderTransportError(stage=phase, reason="timeout", request_started=request_started)
        sock.settimeout(remaining)

    def connect_phase():
        # Tries every address already in hand, then — once, and only while no
        # byte of the request has been sent — asks the resolver for a fresh
        # batch that excludes what just failed. A resolver that answers but
        # whose single address is unreachable (today's DingTalk/cf case) and
        # a response with several addresses where only the first fails
        # (opencode.ai) both resolve here; a TLS certificate we cannot trust
        # is never retried, matching test_tls_failure_never_posts_or_retries.
        nonlocal sock, phase, stop_watching
        tried = set()
        pending = list(addresses)
        reresolved = False
        while True:
            if not pending:
                if reresolved or resolver is None:
                    raise ProviderTransportError(stage=phase, reason="unavailable", request_started=False)
                reresolved = True
                remaining_for_resolver = timeout - (time.monotonic() - started)
                if remaining_for_resolver <= 0:
                    raise ProviderTransportError(stage=phase, reason="timeout", request_started=False)
                pending = [addr for addr in admit(resolver(tried)) if addr[4][0] not in tried]
                if not pending:
                    raise ProviderTransportError(stage=phase, reason="unavailable", request_started=False)
                continue
            family, socktype, proto, _, target = pending.pop(0)
            tried.add(target[0])
            phase = "connect"
            candidate = socket.socket(family, socktype, proto)
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                candidate.close()
                raise ProviderTransportError(stage=phase, reason="timeout", request_started=False)
            candidate.settimeout(remaining)
            sock = candidate
            try:
                stop_watching = watch_socket_cancellation(lambda: sock, timeout=remaining)
                bounded_socket()
                sock.connect(target)
                if parts.scheme == "https":
                    phase = "tls"
                    bounded_socket()
                    sock = ssl.create_default_context().wrap_socket(
                        sock, server_hostname=host, do_handshake_on_connect=False
                    )
                    bounded_socket()
                    sock.do_handshake()
                return
            except (ssl.SSLCertVerificationError, TimeoutError):
                # A certificate we cannot trust is a trust failure, not an
                # unreachable host. A budget timeout must stay a timeout, not
                # be relabelled "unavailable" by this retry loop; both are
                # left for the outer handlers to classify, never retried here.
                raise
            except (OSError, ValueError, http.client.HTTPException):
                if stop_watching is not None:
                    stop_watching()
                try:
                    sock.close()
                except OSError:
                    pass
                if not pending and (reresolved or resolver is None):
                    raise
                # Still have another address, or one unused re-resolution
                # left, to try before giving up on this phase.
                continue

    try:
        connect_phase()
        remaining = timeout - (time.monotonic() - started)
        connection = http.client.HTTPConnection(host, port, timeout=remaining)
        connection.sock = sock
        # Fixed, audited media adapters may supply a bounded multipart body.
        # Model and tool JSON callers retain the canonical serialization path.
        if isinstance(body, bytes) and len(body) > 3 * 1024 * 1024:
            raise AiError("请求正文超过上限", "payload_too_large", 413)
        data = (body if isinstance(body, bytes) else canonical(body).encode()) if method == "POST" else None
        request_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            **(headers or {}),
        }
        phase = "request_send"
        bounded_socket()
        # The request may be partially written even if request() raises. This
        # marks an attempt, never proof of provider receipt or permission to retry.
        request_started = True
        connection.request(
            method,
            parts.path + ("?" + parts.query if parts.query else ""),
            data,
            request_headers,
        )
        phase = "response_headers"
        bounded_socket()
        response = connection.getresponse()
        phase = "response_body"
        if 300 <= response.status < 400:
            raise AiError("拒绝重定向", "provider_redirect", 503)
        if not 200 <= response.status < 300:
            # The same bounded rejection handling applies to JSON and SSE.
            rejected = bytearray()
            while not response.isclosed() and len(rejected) <= 16384:
                _network_budget(timeout, phase, request_started)
                bounded_socket()
                part = response.read1(16385 - len(rejected))
                if not part:
                    break
                rejected.extend(part)
            raise ProviderHttpError(response.status, bytes(rejected))
        length = response.getheader("Content-Length")
        if length and (not length.isdigit() or int(length) > maximum):
            raise AiError("响应超限", "response_too_large", 503)
        if stream_collector is not None:
            if "text/event-stream" not in (response.getheader("Content-Type") or "").lower():
                raise InvalidProviderResponse("sse_content_type", stage="transport", mode="sse")
        chunks = []
        count = 0
        while not response.isclosed():
            _network_budget(timeout, phase, request_started)
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise ProviderTransportError(stage=phase, reason="timeout", request_started=request_started)
            sock.settimeout(remaining)
            part = response.read1(min(65536, maximum - count + 1))
            if not part:
                break
            count += len(part)
            if count > maximum:
                raise AiError("响应超限", "response_too_large", 503)
            if stream_collector is None:
                chunks.append(part)
            else:
                stream_collector.feed(part)
                if stream_collector.done:
                    break
        _network_budget(timeout, phase, request_started)
        value = (stream_collector.finish() if stream_collector is not None
                 else json.loads(b"".join(chunks).decode("utf-8")))
        stop_watching.raise_if_failed(request_started=request_started)
        if not isinstance(value, dict):
            raise InvalidProviderResponse("json_root_shape", stage="transport", mode="json")
        return value
    except TimeoutError as error:
        if stop_watching is not None:
            stop_watching.raise_if_failed(request_started=request_started)
        _network_budget(timeout, phase, request_started)
        raise ProviderTransportError(stage=phase, reason="timeout", request_started=request_started) from error
    except (json.JSONDecodeError, UnicodeDecodeError, RecursionError) as error:
        if stop_watching is not None:
            stop_watching.raise_if_failed(request_started=request_started)
        raise InvalidProviderResponse(
            "utf8_invalid" if isinstance(error, UnicodeDecodeError) else "json_invalid",
            stage="transport", mode="sse" if stream_collector is not None else "json",
        ) from error
    except (OSError, ValueError, http.client.HTTPException) as error:
        if stop_watching is not None:
            stop_watching.raise_if_failed(request_started=request_started)
        _network_budget(timeout, phase, request_started)
        raise ProviderTransportError(stage=phase, reason="unavailable", request_started=request_started) from error
    finally:
        if stop_watching is not None:
            stop_watching()
        try:
            if connection:
                connection.close()
        finally:
            sock.close()
        if stop_watching is not None:
            stop_watching.raise_if_failed(request_started=request_started)
            stop_watching.require_finished(request_started=request_started)


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
    if action not in {"authorize_background", "catalog", "execute", "dataset", "pi_business_domain"}:
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
