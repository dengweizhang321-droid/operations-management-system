import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from django.conf import settings
settings.configure(DEFAULT_CHARSET="utf-8")
from django.http import HttpResponse, StreamingHttpResponse
from django.test import RequestFactory
from teruisi_backend.automation_drain import AutomationDrainMiddleware, PROTOCOL, protected_activity


class MiddlewareTests(unittest.TestCase):
    def test_requests_and_sse_keep_protection_until_completion(self):
        with tempfile.TemporaryDirectory(prefix="optimization4-http-") as directory:
            runtime = Path(directory)
            (runtime / "run").mkdir()
            events = []
            from contextlib import contextmanager
            @contextmanager
            def lease():
                with protected_activity(runtime):
                    events.append("enter")
                    try:
                        yield
                    finally:
                        events.append("exit")
            with patch("teruisi_backend.automation_drain.protected_activity", lease):
                request = RequestFactory().post("/api/import")
                response = AutomationDrainMiddleware(lambda _: HttpResponse("committed"))(request)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(events, ["enter", "exit"])
                stream = AutomationDrainMiddleware(lambda _: StreamingHttpResponse(iter([b"one", b"two"])))(request)
                self.assertEqual(events, ["enter", "exit", "enter"])
                self.assertEqual(b"".join(stream.streaming_content), b"onetwo")
                stream.close()
                stream.close()
                self.assertEqual(events, ["enter", "exit", "enter", "exit"])

    def test_maintenance_rejects_before_handler_and_keeps_health_live(self):
        with tempfile.TemporaryDirectory(prefix="optimization4-http-") as directory:
            runtime = Path(directory)
            (runtime / "run").mkdir()
            (runtime / "run/automation-drain.json").write_text(json.dumps({"version": PROTOCOL, "id": "a" * 32, "phase": "requests", "runtimeRoot": str(runtime)}))
            calls = []
            def handler(request):
                calls.append(request.path)
                return HttpResponse("ok")
            middleware = AutomationDrainMiddleware(handler)
            with patch("teruisi_backend.automation_drain.deployed_runtime", lambda: runtime):
                reply = middleware(RequestFactory().post("/api/import"))
                self.assertEqual(reply.status_code, 503)
                self.assertFalse(json.loads(reply.content)["accepted"])
                self.assertEqual(calls, [])
                self.assertEqual(middleware(RequestFactory().get("/health/live")).status_code, 200)


if __name__ == "__main__":
    unittest.main()
