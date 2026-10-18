"""TS signing/tool handlers -> actual HTTP -> Django authority and receipts.

Run only with a private test database and Node/tsx available. Dataset pages are
synthetic; tool handlers, audits, signatures, views, receipts and files are real.
No model, Runner, production connection or supplier request is used.
"""
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import uuid
from unittest.mock import patch
from wsgiref.simple_server import make_server, WSGIRequestHandler

from django.core.handlers.wsgi import WSGIHandler
from django.db import connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from . import tests as domain, pi_exports, pi_service as service, pi_worker as worker
from .control_models import AiWriteAuthority, AiWriteReceipt
from .models import AiToolAuditLogs
from .pi_models import PiExport, PiSession
from .policy import canonical


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiExportHttpTests(TransactionTestCase):
    user = domain.AiDomainTests.user

    def setUp(self):
        domain.AiDomainTests.setUp(self)
        self.actor = self.user("export-http@example.invalid", "admin", None)
        session = service.create_session({"clientRequestId": "http-session"}, self.actor)["session"]["id"]
        service.prompt(session, {"clientRequestId": "http-prompt", "message": "合成导出"}, self.actor)
        self.op = worker.claim()
        self.server = make_server("127.0.0.1", 0, WSGIHandler(), handler_class=QuietHandler)

        def serve():
            try:
                self.server.serve_forever(poll_interval=0.05)
            finally:
                connections.close_all()

        self.thread = threading.Thread(target=serve, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        root = Path(__file__).resolve().parents[2]
        env = {key: value for key, value in os.environ.items() if key.upper() in {
            "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"}}
        env.update(TERUISI_DJANGO_INTERNAL_SECRET=os.environ["TERUISI_DJANGO_INTERNAL_SECRET"],
            TERUISI_DJANGO_AI_WRITER_BASE_URL=f"http://127.0.0.1:{self.server.server_port}",
            TERUISI_DJANGO_AI_READER_BASE_URL="http://127.0.0.1:1")
        loader = os.getenv("PI_EXPORT_TSX_LOADER", "tsx")
        self.node = subprocess.Popen([shutil.which("node"), "--import", loader, "tests/pi-export-http-client.ts"],
            cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8")
        self.addCleanup(self.stop_node)
        self.answers = queue.Queue()

        def answers():
            for line in self.node.stdout:
                self.answers.put(line)
            self.answers.put(None)

        self.reader = threading.Thread(target=answers, daemon=True)
        self.reader.start()
        self.query = {"platform": "京东", "shop": "合成店", "limit": 20}
        self.epoch = str(uuid.uuid4())
        AiWriteAuthority.objects.filter(pk=1).update(status="postgres", authority_epoch=self.epoch, cutover_id="http-fixture")
        # HTTP uses the actual writer process gate and actual authority row.
        # Fixture creation alone used the usual development test setup.
        self.writer = override_settings(DJANGO_PROCESS_ROLE="ai_writer", AI_WRITE_AUTHORITY_EPOCH=self.epoch,
            AI_WRITE_CUTOVER_ID="http-fixture")
        self.writer.enable()
        self.addCleanup(self.writer.disable)

    def stop_server(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()
        self.assertFalse(self.thread.is_alive())

    def stop_node(self):
        self.node.stdin.close()
        try:
            self.node.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.node.kill()
            self.node.wait(timeout=5)
        self.node.stdout.close()
        self.node.stderr.close()

    def send(self, **command):
        command.setdefault("principal", {"email": self.actor.email, "displayName": self.actor.display_name,
            "role": self.actor.role, "scope": self.actor.scope})
        self.node.stdin.write(json.dumps(command, ensure_ascii=False)+"\n")
        self.node.stdin.flush()
        answer = self.answers.get(timeout=25)
        if answer is None:
            self.fail("Node HTTP fixture exited: "+self.node.stderr.read()[-1000:])
        return json.loads(answer)

    def tool(self, name, args, call_id, **extra):
        return self.send(name=name, arguments=args, operationId=self.op.id, callId=call_id, **extra)

    def start(self, dataset, call_id, **extra):
        return self.tool("start_pi_dataset_export", {"dataset": dataset, "queryJson": canonical(self.query)}, call_id, **extra)

    def status(self, export_id, call_id="observe-export"):
        result = self.tool("get_pi_dataset_export", {"exportId": export_id}, call_id)
        self.assertTrue(result["ok"], result)
        return result["data"]

    def test_two_datasets_keep_parent_and_distinct_stable_write_receipts(self):
        first = self.start("pi_netshop_product_daily", "start-product")
        self.assertTrue(first["ok"], first)
        replay = self.start("pi_netshop_product_daily", "start-product")
        self.assertEqual(replay, first)
        self.assertEqual(PiExport.objects.count(), 1)
        second = self.start("pi_netshop_promotion", "start-promotion")
        self.assertTrue(second["ok"], second)
        self.assertNotEqual(first["data"]["exportId"], second["data"]["exportId"])
        self.assertEqual(set(PiExport.objects.values_list("operation_id", flat=True)), {self.op.id})
        for call_id in ("start-product", "start-promotion"):
            request_id = "pi-tool-"+hashlib.sha256(json.dumps(["pi-export-v1", self.op.id, call_id], separators=(",", ":")).encode()).hexdigest()
            receipt = AiWriteReceipt.objects.get(request_id=request_id)
            self.assertEqual(receipt.status, "completed")
            self.assertEqual(receipt.response_payload["status"], "queued")
        changed = self.start("pi_netshop_promotion", "start-product", mode="handler")
        self.assertEqual(changed, {"ok": False, "status": 409, "code": "conflict"})
        self.assertEqual(PiExport.objects.count(), 2)
        self.assertFalse(AiWriteReceipt.objects.filter(request_id=self.op.id).exists())

    def test_each_export_observes_live_pages_and_file_with_same_status_call_id(self):
        for dataset in ("pi_netshop_product_daily", "pi_netshop_promotion"):
            result = self.start(dataset, "start-"+dataset)
            self.assertTrue(result["ok"], result)
            export_id = result["data"]["exportId"]
            call_id = "observe-"+dataset
            seen = [self.status(export_id, call_id)]
            row = pi_exports.claim()
            self.assertEqual(row.id, export_id)
            seen.append(self.status(export_id, call_id))

            def page(name, body, principal, request_id, **kwargs):
                self.assertEqual(name, dataset)
                seen.append(self.status(export_id, call_id))
                p = body["query"].get("page", 1)
                rows = [{"id": (p-1)*20+i, "amount": i} for i in range(min(20, 21-(p-1)*20))]
                return {"source": {"domain": "netshop"}, "dataCutoffDate": "2026-10-16",
                    "queriedAt": timezone.now().isoformat(), "data": {"items": rows,
                    "pagination": {"page": p, "pageSize": 20, "total": 21, "returned": len(rows), "hasMore": p == 1},
                    "sourceRevision": "synthetic-v1", "units": {"amount": "CNY_cents"},
                    "filtersApplied": {"platforms": ["京东"], "shop": "合成店"}}}

            with patch.object(pi_exports.datasets, "query", side_effect=page):
                pi_exports.perform(row)
            seen.append(self.status(export_id, call_id))
            self.assertEqual([item["status"] for item in seen], ["queued", "running", "running", "running", "succeeded"])
            self.assertEqual(seen[3]["progress"]["pages"], 1)
            self.assertEqual(seen[-1]["manifest"]["pages"], 2)
            self.assertEqual(seen[-1]["manifest"]["rows"], 21)
            self.assertTrue(seen[-1]["manifest"]["complete"])
            self.assertEqual(len(json.loads(bytes(PiExport.objects.get(pk=export_id).file.payload))["rows"]), 21)
            request_id = "pi-tool-"+hashlib.sha256(json.dumps(["pi-export-v1", self.op.id, call_id], separators=(",", ":")).encode()).hexdigest()
            self.assertFalse(AiWriteReceipt.objects.filter(request_id=request_id).exists())
            audit = AiToolAuditLogs.objects.filter(request_id=self.op.id, provider_call_id=call_id)
            self.assertEqual(audit.filter(status="started").count(), 5)
            self.assertEqual(audit.filter(status="succeeded").count(), 5)
            self.assertEqual(set(audit.values_list("actor_email", "surface")), {(self.actor.email, "pi_agent")})

    def test_status_keeps_writer_authority_owner_generation_scope_surface_and_signature_gates(self):
        result = self.start("pi_netshop_promotion", "start-gates")
        self.assertTrue(result["ok"], result)
        export_id = result["data"]["exportId"]
        payload = {"operation": "pi-export-status", "surface": "pi_agent", "exportId": export_id}

        def observe(**extra):
            return self.send(mode="consumer", payload=payload, requestId="old-worker-status", **extra)

        # Old workers omit any new identity fields; the existing wire body stays
        # accepted, and even an existing receipt must never pin the observation.
        AiWriteReceipt.objects.create(request_id="old-worker-status", actor_email=self.actor.email,
            principal_digest="0"*64, method="POST", path="/api/ai/consumer", query_sha256="0"*64,
            body_sha256="0"*64, status="completed", response_payload={"status": "queued"})
        self.assertTrue(observe()["ok"])
        PiExport.objects.filter(pk=export_id).update(status="running")
        self.assertEqual(observe()["data"]["status"], "running")
        self.assertEqual(AiWriteReceipt.objects.get(request_id="old-worker-status").response_payload, {"status": "queued"})
        self.assertEqual(observe(tamperSignature=True)["status"], 403)
        with override_settings(DJANGO_PROCESS_ROLE="ai_reader"):
            self.assertEqual(observe()["status"], 403)
        with override_settings(AI_WRITE_AUTHORITY_EPOCH=str(uuid.uuid4())):
            self.assertEqual(observe()["status"], 503)
        other = {"email": self.other.email, "displayName": "other", "role": self.other.role, "scope": None}
        self.assertEqual(observe(principal=other)["status"], 404)
        payload["surface"] = "ai_chat"
        self.assertEqual(observe()["status"], 403)
        payload["surface"] = "pi_agent"
        PiSession.objects.filter(pk=self.op.session_id).update(generation=self.op.generation+1)
        self.assertEqual(observe()["status"], 404)
        PiSession.objects.filter(pk=self.op.session_id).update(generation=self.op.generation)
        narrow = {"email": self.actor.email, "displayName": "narrow", "role": self.actor.role,
            "scope": {"warehouses": [], "channels": [], "platforms": ["京东"]}}
        self.assertEqual(observe(principal=narrow)["status"], 404)
        self.assertEqual(PiSession.objects.get(pk=self.op.session_id).status, "frozen")
