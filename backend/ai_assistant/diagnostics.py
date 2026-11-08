"""Content-free timings and error projection for AI execution and delivery."""

from contextlib import contextmanager
from contextvars import ContextVar
import re
import time

from .policy import AiError


_timing_sink = ContextVar("ai_diagnostic_timing_sink", default=None)
_stages = {
    "admission", "system_dns", "dns_recovery", "connect", "tls", "request_send", "stream",
    "response_headers", "response_body", "provider_http", "transport", "response",
    "response_parse", "tool_calls", "provider", "tool", "finalize", "cancel_check",
    "cancel_preflight", "cancel_cleanup",
}
_ident = re.compile(r"[A-Za-z0-9_.-]{1,80}\Z")


def elapsed_ms(started):
    return max(0, int((time.monotonic() - started) * 1000))


@contextmanager
def phase_timing(timings, stage):
    started = time.monotonic()
    try:
        yield
    finally:
        timings[stage] = timings.get(stage, 0) + elapsed_ms(started)


class PhaseTimer:
    """Track sequential stages, including repeated pre-send address attempts."""

    def __init__(self, stage):
        self.stage = stage
        self.timings = {}
        self.started = time.monotonic()

    def advance(self, stage):
        self.finish()
        self.stage = stage
        self.started = time.monotonic()

    def finish(self):
        if self.started is not None:
            self.timings[self.stage] = self.timings.get(self.stage, 0) + elapsed_ms(self.started)
            self.started = None
        return self.timings


@contextmanager
def capture_timings():
    timings = {}
    token = _timing_sink.set(timings)
    try:
        yield timings
    finally:
        _timing_sink.reset(token)


def publish_timings(timings):
    sink = _timing_sink.get()
    if sink is not None:
        for stage, value in timings.items():
            sink[stage] = sink.get(stage, 0) + value


def error_summary(error):
    """Read only the typed adapter diagnostics and fixed application fields."""
    from .provider_contract import InvalidProviderResponse
    from .transport import ProviderHttpError, ProviderTransportError
    from .provider import EmptyProviderResponse, ProviderCredentialError

    if not isinstance(error, AiError):
        return {"code": "execution_failed"}
    result = {"code": error.code if isinstance(error.code, str) and _ident.fullmatch(error.code)
              else "execution_failed", "appStatus": error.status}
    if not isinstance(error, (InvalidProviderResponse, ProviderHttpError, ProviderTransportError,
                              EmptyProviderResponse, ProviderCredentialError)):
        return result
    data = getattr(error, "diagnostics", {})
    for name in ("adapterVersion", "reason", "protocol", "responseMode", "finishReason", "sqlState"):
        value = data.get(name)
        if isinstance(value, str) and _ident.fullmatch(value):
            result[name] = value
    for name in ("stage", "resolverPhase"):
        value = data.get(name)
        if isinstance(value, str) and value in _stages:
            result[name] = value
    if isinstance(error, InvalidProviderResponse) and result.get("stage") in {"transport", "response", "stream"}:
        result["phase"] = "admission" if data.get("requestStarted") is False else "response_parse"
    for name in ("httpStatus", "completionUnits", "outputUnits"):
        value = data.get(name)
        if type(value) is int and 0 <= value <= 10_000_000:
            result[name] = value
    for name in ("requestStarted", "hasReasoning", "cleanupComplete"):
        if type(data.get(name)) is bool:
            result[name] = data[name]
    timings = data.get("timingsMs")
    if isinstance(timings, dict):
        result["timingsMs"] = {stage: value for stage, value in timings.items()
                               if stage in _stages and type(value) is int and value >= 0}
    return result
