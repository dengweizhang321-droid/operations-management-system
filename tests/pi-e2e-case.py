"""Opt-in browser-to-real-Pi acceptance, synthetic provider and business edges."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import zipfile
from unittest.mock import patch
from wsgiref.simple_server import make_server, WSGIServer, WSGIRequestHandler
from socketserver import ThreadingMixIn

from django.db import connections
from django.test import TransactionTestCase, override_settings
from django.core.wsgi import get_wsgi_application
from ai_assistant import tests as domain, pi_worker as worker, pi_service as service, provider, transport, pi_transport
from ai_assistant.pi_models import PiOperation, PiDispatch, PiFile, PiSession
from ai_assistant.test_pi_real_stack import PiRealStackTests
from ai_assistant.policy import canonical, AiError


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class BrowserStackTests(TransactionTestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user
    edge = PiRealStackTests.edge
    _fixture_teardown = PiRealStackTests._fixture_teardown

    def model_post(self, url, body, headers, **kwargs):
        current = PiOperation.objects.get(status="running")
        if getattr(self, "current_op", None) is None or self.current_op.id != current.id:
            self.current_op = current
            self.stage = 0
            self.phase = json.loads(current.payload_json)["message"].split(":", 1)[0]
        if self.phase == "unknown":
            self.provider_rounds += 1
            raise AiError("Synthetic provider response lost", "invalid_provider_response", 503)
        if self.phase == "continue":
            self.provider_rounds += 1
            if self.stage == 0:
                script = "import pathlib,hashlib,zipfile,json; p=pathlib.Path('/workspace/outputs/report.xlsx'); z=zipfile.ZipFile(p); assert z.testzip() is None; print(json.dumps({'continuedWorkbookSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'sizeBytes':p.stat().st_size,'marker':pathlib.Path('/workspace/outputs/context-marker.txt').read_text()}))"
                message = {"role": "assistant", "content": None, "tool_calls": [{"id": f"synthetic-continue-{self.provider_rounds}", "type": "function", "function": {"name": "bash", "arguments": canonical({"command": "python3 -c " + __import__("shlex").quote(script)})}}]}
                self.stage = 1
            else:
                last = next(item["content"] for item in reversed(body["messages"]) if item["role"] == "tool")
                expected = PiFile.objects.get(file_name="report.xlsx", direction="output")
                self.assertIn(expected.sha256, str(last))
                self.assertIn("synthetic-persistent-context", str(last))
                self.continued_reads.append({"operationId": current.id, "sha256": expected.sha256, "actualPiToolOutput": str(last)})
                message = {"role": "assistant", "content": "已接着同一 Pi 会话读取上一轮文件。合成验收。"}
            return {"id": f"synthetic-continue-{self.provider_rounds}", "choices": [{"message": message, "finish_reason": "tool_calls" if "tool_calls" in message else "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}
        if self.phase == "stop":
            self.provider_rounds += 1
            self.stop_started.set()
            message = {"role": "assistant", "content": None, "tool_calls": [{"id": "synthetic-stop", "type": "function", "function": {"name": "bash", "arguments": canonical({"command": "sleep 30"})}}]}
            return {"id": "synthetic-stop", "choices": [{"message": message, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}
        return PiRealStackTests.model_post(self, url, body, headers, **kwargs)

    def snapshot(self):
        result = {"stopStarted": self.stop_started.is_set(),
            "operations": list(PiOperation.objects.order_by("created_at").values("id", "session_id", "epoch", "generation", "seq", "status", "error_code", "client_request_id")),
            "dispatches": list(PiDispatch.objects.values("operation_id", "kind", "status", "request_id")),
            "files": list(PiFile.objects.values("id", "operation_id", "file_name", "size_bytes", "sha256")),
            "sessions": list(PiSession.objects.values("id", "epoch", "generation", "status"))}
        # Read the in-memory call counter after terminal rows; never bind a new
        # terminal status to a counter sampled before its provider call.
        result["providerPosts"] = self.provider_rounds
        return result

    def test_browser_real_stack(self):
        self.actor = self.user("pi-e2e@example.invalid", "admin", None)
        self.edge_reads, self.history, self.operations, self.continued_reads = [], [], [], []
        self.provider_rounds, self.phase, self.stage = 0, "first", 0
        self.stop_started = threading.Event()
        self.model.generation_options_json = canonical({"contextWindowTokens": 128000, "taskTimeoutMs": 180000})
        self.model.save()
        pi_transport.PORT = int(os.environ["PI_E2E_RUNNER_PORT"])
        stopped = threading.Event()
        def queue():
            try:
                while not stopped.is_set():
                    operation = worker.claim()
                    if operation:
                        self.operations.append(operation)
                        worker.perform(operation)
                    else:
                        stopped.wait(.1)
            finally:
                connections.close_all()
        application = get_wsgi_application()
        def app(environ, start_response):
            if environ["PATH_INFO"] == "/__fixture":
                try:
                    data = canonical(self.snapshot()).encode()
                    start_response("200 OK", [("Content-Type", "application/json"), ("Content-Length", str(len(data)))])
                    return [data]
                finally:
                    connections.close_all()
            try:
                return list(application(environ, start_response))
            finally:
                connections.close_all()
        class Server(ThreadingMixIn, WSGIServer):
            daemon_threads = True
        class Quiet(WSGIRequestHandler):
            def log_message(self, *args):
                pass
        server = make_server("127.0.0.1", int(os.environ["PI_E2E_DJANGO_PORT"]), app, Server, Quiet)
        threads = [threading.Thread(target=server.serve_forever, daemon=True), threading.Thread(target=queue, daemon=True), threading.Thread(target=worker.export_loop, args=(stopped,), daemon=True)]
        out = Path(os.environ["PI_E2E_OUT"])
        try:
            with patch.object(provider, "decrypt", return_value="synthetic-never-sent"), patch.object(provider, "bounded_json", side_effect=self.model_post), patch.object(transport, "bounded_json", side_effect=self.edge):
                for thread in threads:
                    thread.start()
                result = subprocess.run(["node", "tests/pi-e2e-browser.mjs"], cwd=os.environ["PI_E2E_ROOT"], env=os.environ.copy(), timeout=300, capture_output=True)
                (out / "browser.log").write_bytes(result.stdout + result.stderr)
                self.assertEqual(result.returncode, 0, (result.stdout + result.stderr).decode(errors="replace")[-10000:])
                data = (out / "download.xlsx").read_bytes()
                report = PiFile.objects.get(file_name="report.xlsx")
                self.assertEqual(hashlib.sha256(data).hexdigest(), report.sha256)
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    self.assertIsNone(archive.testzip())
                    table = archive.read("xl/worksheets/sheet1.xml").decode()
                    for source in ("sales_summary", "inventory_age", "pi_netshop_promotion"):
                        self.assertIn(source, table)
                    self.assertEqual(table.count("<row>"), 4)
                self.assertEqual(len(self.continued_reads), 2)
                (out / "backend-evidence.json").write_text(json.dumps({**self.snapshot(), "businessReads": self.edge_reads, "continuedReads": self.continued_reads, "downloadSha256": report.sha256, "syntheticProvider": True, "syntheticBusinessSources": True, "productionTouched": False}, ensure_ascii=False, indent=2), encoding="utf8")
        finally:
            (out / "last-snapshot.json").write_text(json.dumps(self.snapshot(), indent=2), encoding="utf8")
            stopped.set()
            server.shutdown()
            for thread in threads:
                thread.join(timeout=10)
            cleanup_errors = []
            for operation in self.operations:
                try:
                    worker.dispose_environment(operation)
                except Exception as error:
                    cleanup_errors.append({"operationId": operation.id, "code": getattr(error, "code", type(error).__name__)})
            # The outer launcher separately inspects the exact private Docker
            # namespace and proves zero containers/volumes and closed ports.
            (out / "dispose-attempts.json").write_text(json.dumps(cleanup_errors, indent=2), encoding="utf8")
            server.server_close()
            connections.close_all()
