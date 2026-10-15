"""Versioned provider contract and fixed, content-free response diagnostics."""
from .policy import AiError


PROVIDER_ADAPTER_VERSION = "2026-10-15-dns-phase-v2"


class InvalidProviderResponse(AiError):
    def __init__(self, reason, *, stage="response", protocol=None, mode=None):
        super().__init__("模型响应协议校验失败，本次请求未自动重试", "invalid_provider_response", 503)
        # Callers supply code literals only, never upstream values or keys.
        self.diagnostics = {"adapterVersion": PROVIDER_ADAPTER_VERSION,
                            "stage": stage, "reason": reason}
        if protocol in {"openai_compatible", "anthropic"}:
            self.diagnostics["protocol"] = protocol
        if mode in {"json", "sse"}:
            self.diagnostics["responseMode"] = mode
