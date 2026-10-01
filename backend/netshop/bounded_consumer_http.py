"""Per-request urllib transport with one monotonic deadline for every recv.

No global opener/socket mutation, cache, redirects or proxy destinations. The
caller still owns its fixed operation, configured origin and native signature.
Legacy callers without an explicit deadline do not use this helper.
"""
from contextlib import contextmanager
import http.client
import math
import socket
import time
import urllib.parse
import urllib.request
import urllib.error


class ConsumerDeadlineExceeded(TimeoutError):
    pass


class _Budget:
    def __init__(self, deadline, timeout_cap):
        if type(deadline) not in {int, float} or not math.isfinite(deadline):
            raise ValueError("Consumer deadline must be an explicit finite monotonic time")
        if timeout_cap is not None and (type(timeout_cap) not in {int, float} or not math.isfinite(timeout_cap) or timeout_cap <= 0):
            raise ValueError("Consumer timeout cap must be finite and positive")
        self.deadline, self.timeout_cap = deadline, timeout_cap

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise ConsumerDeadlineExceeded("Consumer whole deadline exhausted")
        return min(remaining, self.timeout_cap) if self.timeout_cap is not None else remaining


class _DeadlineSocket:
    """Keep stdlib SocketIO reference counting, but intercept each real recv."""
    def __init__(self, sock, budget):
        self._socket, self._budget = sock, budget

    def __getattr__(self, name):
        return getattr(self._socket, name)

    def recv_into(self, buffer, nbytes=0, flags=0):
        self._socket.settimeout(self._budget.remaining())
        try:
            value = self._socket.recv_into(buffer, nbytes, flags)
        except OSError:
            self._budget.remaining()
            raise
        self._budget.remaining()
        return value

    def sendall(self, data, flags=0):
        self._socket.settimeout(self._budget.remaining())
        self._socket.sendall(data, flags)
        self._budget.remaining()

    def makefile(self, *args, **kwargs):
        self._budget.remaining()
        stream = self._socket.makefile(*args, **kwargs)
        raw = getattr(stream, "raw", None)
        if not isinstance(raw, socket.SocketIO) or getattr(raw, "_sock", None) is not self._socket:
            stream.close()
            raise OSError("Unsupported consumer response socket stream")
        # makefile already owns the real socket's IO ref. SocketIO.close calls
        # _decref_socketios via delegation, so no extra or lost refs are created.
        raw._sock = self
        return stream


class _DeadlineHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host, *, budget, **kwargs):
        kwargs["timeout"] = budget.remaining()
        super().__init__(host, **kwargs)
        self._budget = budget

    def connect(self):
        self.timeout = self._budget.remaining()
        try:
            super().connect()
            self._budget.remaining()
            self.sock = _DeadlineSocket(self.sock, self._budget)
        except BaseException:
            self.close()
            raise


class _DeadlineHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, *, budget, **kwargs):
        kwargs["timeout"] = budget.remaining()
        super().__init__(host, **kwargs)
        self._budget = budget

    def connect(self):
        self.timeout = self._budget.remaining()
        try:
            super().connect()
            self._budget.remaining()
            self.sock = _DeadlineSocket(self.sock, self._budget)
        except BaseException:
            self.close()
            raise


class _HTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, budget):
        super().__init__()
        self._budget = budget

    def http_open(self, request):
        return self.do_open(lambda host, **options: _DeadlineHTTPConnection(host, budget=self._budget, **options), request)


class _HTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, budget):
        super().__init__()
        self._budget = budget

    def https_open(self, request):
        return self.do_open(lambda host, **options: _DeadlineHTTPSConnection(host, budget=self._budget, **options),
                            request, context=self._context)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


@contextmanager
def open_bounded_consumer_request(request, *, deadline, timeout_cap=None):
    """Yield a normal urllib response; status, headers and body share the budget."""
    if not isinstance(request, urllib.request.Request):
        raise ValueError("Consumer transport requires an already signed fixed Request")
    url = urllib.parse.urlsplit(request.full_url)
    native_post = request.get_method() == "POST" and url.path in {"/api/finance/consumers/query", "/api/sales/consumers/query"} and not url.query
    workflow_get = request.get_method() == "GET" and url.path == "/api/workflow/operations-records" and request.data is None
    if not (native_post or workflow_get) or url.scheme not in {"http", "https"} or not url.netloc or url.username or url.password or url.fragment or url.scheme == "http" and (url.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Consumer transport destination/method is not a fixed native reader")
    budget = _Budget(deadline, timeout_cap)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _HTTPHandler(budget), _HTTPSHandler(budget), _NoRedirect())
    response = None
    try:
        try:
            response = opener.open(request, timeout=budget.remaining())
        except urllib.error.HTTPError as error:
            # Keep authority status, but close its owned stream without reading
            # untrusted body bytes. No redirect destination was opened.
            error.close()
            raise
        budget.remaining()
        yield response
        budget.remaining()
    finally:
        if response is not None:
            response.close()
