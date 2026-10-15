"""Synthetic proof that the delivery composition excludes deferred Agnes opt-in."""
import json
import os
from pathlib import Path
import sys

source = Path("D:/codex-isolated/ai-schedules-release-20261015/source")
os.environ.update(DJANGO_SETTINGS_MODULE="teruisi_backend.settings",
    TERUISI_DJANGO_DATABASE_URL="", TERUISI_DJANGO_ENVIRONMENT="test",
    TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_SQLITE_PATH=":memory:")
sys.path.insert(0, str(source / "backend"))
import django
django.setup()
from ai_assistant.provider_stream import ProviderStream
from ai_assistant.provider_contract import InvalidProviderResponse

stream = ProviderStream("openai_compatible", lambda _: None)
stream.openai({"choices": [{"index": 0, "delta": {"content": "fixture"}, "finish_reason": "stop"}]})
try:
    stream.openai({"choices": [{"index": 0, "delta": {}, "finish_reason": None}], "usage": {"completion_tokens": 1}})
except InvalidProviderResponse as error:
    assert error.diagnostics["reason"] == "sse_payload_after_terminal"
else:
    raise AssertionError("Unadopted Agnes single-choice usage frame was accidentally enabled")
# Original empty-choices usage reporting remains valid.
stream.openai({"choices": [], "usage": {"completion_tokens": 1}})
print(json.dumps({"status": "passed", "deferredAgnesStillRejected": True,
                  "originalEmptyChoicesUsagePreserved": True, "productionWrites": False}))
