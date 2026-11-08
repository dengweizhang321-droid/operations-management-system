"""Signed chat controls with real PostgreSQL transactions and a loopback fake provider."""
import hashlib
import hmac
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from unittest.mock import patch
from urllib.parse import urlencode
from uuid import uuid4

from django.db import connection, connections
from django.test import Client, TransactionTestCase, override_settings
from django.utils import timezone

from . import chat, models as m, provider, tests as support, transport
from .control_models import AiWriteAuthority
from .database_contract import provision
from .policy import canonical, uid
from .test_dataset_chat import wire


SECRET = "synthetic-chat-stop-fixture-secret-with-no-external-access"
CHAT = "/api/ai/chat"
STOP = CHAT + "/cancel"


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="development",
                   DJANGO_INTERNAL_SECRET=SECRET)
class ChatStopPostgresTests(TransactionTestCase):
    user = support.AiDomainTests.user

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("Requires PostgreSQL transaction and append-only trigger semantics")
        support.AiDomainTests.setUp(self)
        self.enterContext(patch.dict("os.environ", {
            "TERUISI_DJANGO_INTERNAL_SECRET": SECRET,
            "AI_ALLOW_LOCAL_MODEL_ENDPOINTS": "true",
        }))
        self.enterContext(patch.object(transport, "catalog", return_value=[]))
        self.enterContext(patch.object(provider, "decrypt", return_value="fixture-only"))

    def client_id(self, when=None):
        return uid(f"web-chat-v1-{int((when or timezone.now()).timestamp() * 1000)}")

    def payload(self, client_id, *, module="sales", message="查询"):
        return {"clientRequestId": client_id, "workspaceModule": module, "message": message}

    def post(self, path, body, *, principal=None, accept=None, request_id=None):
        headers = transport.signed_headers(path, body, principal or self.owner, request_id)
        if accept:
            headers["Accept"] = accept
        return Client().post(path, canonical(body), content_type="application/json", headers=headers)

    def stop(self, client_id, *, module="sales", principal=None, request_id=None):
        return self.post(STOP, {"clientRequestId": client_id, "workspaceModule": module},
                         principal=principal, request_id=request_id)

    def status(self, client_id, *, module="sales", principal=None):
        query = urlencode({"clientRequestId": client_id, "workspaceModule": module})
        headers = transport.signed_headers(CHAT, {}, principal or self.owner)
        headers["X-Teruisi-Content-SHA256"] = hashlib.sha256(b"").hexdigest()
        signed = "\n".join(["v1", headers["X-Teruisi-Timestamp"], headers["X-Teruisi-Request-Id"],
                            "GET", CHAT, query, headers["X-Teruisi-Content-SHA256"], headers["X-Teruisi-Principal"]])
        headers["X-Teruisi-Signature"] = "v1=" + hmac.new(SECRET.encode(), signed.encode(), hashlib.sha256).hexdigest()
        return Client().get(f"{CHAT}?{query}", headers=headers)

    @contextmanager
    def fake_provider(self, *, held=False):
        posts, received, release = [], Event(), Event()
        if not held:
            release.set()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                posts.append(self.path)
                received.set()
                if not release.wait(8):
                    return
                data = canonical(wire("openai_compatible", answer="测试回复")).encode()
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except OSError:
                    pass  # A closed stream may tear down this loopback socket.

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.model.base_url = f"http://127.0.0.1:{server.server_port}/v1"
        self.model.save(update_fields=["base_url"])
        try:
            yield posts, received, release
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(4)

    @contextmanager
    def waiting_request(self, payload, reached, release):
        def send():
            try:
                return self.post(CHAT, payload)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(send)
            try:
                self.assertTrue(reached.wait(6), "request did not reach the expected boundary")
                yield future
            finally:
                release.set()

    def test_early_stop_is_durable_idempotent_and_isolated_without_a_conversation(self):
        client_id = self.client_id()
        first = self.stop(client_id, request_id="early-stop-fixture")
        self.assertEqual(first.status_code, 200, first.content)
        expected = {"status": "cancelled", "dispatchState": "not_sent", "cancelRequested": True,
                    "conversationId": None, "assistantMessageId": None}
        self.assertEqual(first.json()["request"], expected)
        self.assertEqual(self.stop(client_id, request_id="early-stop-fixture").json(), first.json())
        self.assertEqual(self.stop(client_id).json(), first.json())
        self.assertEqual(self.status(client_id).json()["request"], expected)
        self.assertEqual(self.status(client_id, principal=self.other).status_code, 404)
        self.assertEqual(self.status(client_id, module="inventory").status_code, 404)
        self.assertEqual(self.stop(client_id, principal=self.viewer).status_code, 403)
        self.assertEqual(self.post(CHAT, self.payload(client_id)).status_code, 499)
        self.assertFalse(m.AiConversations.objects.exists())
        self.assertEqual(self.post(CHAT, self.payload(client_id, module="inventory", message="帮助")).status_code, 200)
        self.assertEqual(self.status(client_id, module="inventory").json()["request"]["status"], "succeeded")
        self.assertEqual(self.status(client_id).json()["request"], expected)
        self.assertFalse(m.AiChatProviderDispatches.objects.exists())

    def test_pruning_a_tombstone_cannot_admit_an_expired_or_future_id(self):
        past = timezone.now() - timedelta(days=4)
        client_id = self.client_id(past)
        with patch.object(chat.timezone, "now", return_value=past):
            self.assertEqual(self.stop(client_id).status_code, 200)
        self.assertEqual(self.stop(self.client_id()).status_code, 200)  # Bounded pruning path.
        self.assertEqual(self.status(client_id).status_code, 404)
        for invalid in (client_id, self.client_id(timezone.now() + timedelta(minutes=10))):
            response = self.post(CHAT, self.payload(invalid))
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["code"], "ai_chat_not_dispatched")
        self.assertFalse(m.AiConversations.objects.exists())

    def test_production_role_contract_allows_scoped_read_and_expiry_without_chat_delete(self):
        connection.ensure_connection()
        provision(connection.connection, "reader-password-private-role-fixture-1",
                  "writer-password-private-role-fixture-2")
        epoch, cutover = uuid4(), "private-chat-stop-fixture"
        AiWriteAuthority.objects.filter(pk=1).update(
            status="postgres", authority_epoch=epoch, cutover_id=cutover,
            migration_verify_run_id="chat-stop-test-verify", activated_at=timezone.now(),
        )
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT has_table_privilege('teruisi_ai_writer', 'ai_chat_request_receipts', 'DELETE'),
                       has_table_privilege('teruisi_ai_writer', 'ai_write_request_receipts', 'DELETE'),
                       has_table_privilege('teruisi_ai_reader', 'ai_write_request_receipts', 'SELECT')
            """)
            self.assertEqual(cursor.fetchone(), (False, True, False))
            cursor.execute("SET ROLE teruisi_ai_writer")
        try:
            with override_settings(DJANGO_PROCESS_ROLE="ai_writer", AI_WRITE_AUTHORITY_EPOCH=str(epoch),
                                   AI_WRITE_CUTOVER_ID=cutover):
                past = timezone.now() - timedelta(days=4)
                client_id = self.client_id(past)
                with patch.object(chat.timezone, "now", return_value=past):
                    created = self.stop(client_id)
                self.assertEqual(created.status_code, 200, created.content)
                self.assertEqual(self.status(client_id).json()["request"]["status"], "cancelled")
                self.assertEqual(self.stop(self.client_id()).status_code, 200)
                self.assertEqual(self.status(client_id).status_code, 404)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT current_user")
                    self.assertEqual(cursor.fetchone()[0], "teruisi_ai_writer")
            with override_settings(DJANGO_PROCESS_ROLE="ai_reader", AI_WRITE_AUTHORITY_EPOCH=str(epoch),
                                   AI_WRITE_CUTOVER_ID=cutover):
                self.assertEqual(self.status(self.client_id()).status_code, 403)
        finally:
            with connection.cursor() as cursor:
                cursor.execute("RESET ROLE")

    def test_stop_after_reservation_but_before_send_fence_prevents_actual_post(self):
        client_id = self.client_id()
        entered, release = Event(), Event()
        resolve = transport.resolve_addresses

        def wait_for_stop(*args):
            entered.set()
            if not release.wait(8):
                raise TimeoutError
            return resolve(*args)

        with self.fake_provider() as (posts, _, _), patch.object(transport, "resolve_addresses", side_effect=wait_for_stop):
            with self.waiting_request(self.payload(client_id), entered, release) as future:
                self.assertEqual(self.status(client_id).json()["request"]["dispatchState"], "reserved")
                stop = self.stop(client_id)
                self.assertEqual(stop.json()["request"]["status"], "cancelled")
                release.set()
                self.assertEqual(future.result(8).status_code, 499)
            self.assertEqual(posts, [])
        self.assertFalse(m.AiChatProviderDispatches.objects.exists())
        self.assertEqual(self.status(client_id).json()["request"]["status"], "cancelled")

    def test_stop_after_send_fence_but_before_http_failure_is_unknown_without_replay(self):
        client_id = self.client_id()
        entered, release = Event(), Event()

        def unresolved_send(*args, **kwargs):
            entered.set()
            if not release.wait(8):
                raise TimeoutError
            raise OSError("fixture drops connection at the HTTP write boundary")

        with self.fake_provider() as (posts, _, _), patch.object(HTTPConnection, "request", new=unresolved_send):
            with self.waiting_request(self.payload(client_id), entered, release) as future:
                self.assertEqual(self.status(client_id).json()["request"]["dispatchState"], "unconfirmed")
                self.assertEqual(self.stop(client_id).json()["request"]["status"], "stopping")
                release.set()
                self.assertEqual(future.result(8).json()["code"], "ai_chat_result_unknown")
            self.assertEqual(self.post(CHAT, self.payload(client_id)).json()["code"], "ai_chat_result_unknown")
            self.assertEqual(posts, [])
        receipt = self.status(client_id).json()["request"]
        self.assertEqual((receipt["status"], receipt["cancelRequested"]), ("unknown", True))
        self.assertEqual(self.stop(client_id).json()["request"], receipt)
        self.assertEqual(m.AiChatProviderDispatches.objects.count(), 1)

    def test_already_received_provider_response_stops_followup_and_keeps_attempt(self):
        client_id = self.client_id()
        with self.fake_provider(held=True) as (posts, received, release):
            with self.waiting_request(self.payload(client_id), received, release) as future:
                self.assertEqual(self.stop(client_id).json()["request"]["status"], "stopping")
                release.set()
                self.assertEqual(future.result(8).json()["code"], "ai_chat_stopped_after_dispatch")
            self.assertEqual(posts, ["/v1/chat/completions"])
        self.assertEqual(self.status(client_id).json()["request"]["status"], "stopped")
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())
        self.assertEqual(m.AiChatProviderDispatches.objects.count(), 1)

    def test_completed_reply_wins_over_late_stop_and_legacy_ids_remain_queryable(self):
        client_id = "legacy-completed-fixture"
        with self.fake_provider() as (posts, _, _):
            result = self.post(CHAT, self.payload(client_id))
            self.assertEqual(result.status_code, 200, result.content)
            before = self.status(client_id).json()["request"]
            self.assertEqual(self.stop(client_id, module="inventory").status_code, 404)
            self.assertEqual(self.stop(client_id).json()["request"], before)
            self.assertEqual(self.status(client_id).json()["request"], before)
            self.assertEqual(self.post(CHAT, self.payload(client_id)).json(), result.json())
            self.assertEqual(posts, ["/v1/chat/completions"])
        self.assertEqual(before["assistantMessageId"], result.json()["assistantMessageId"])
        self.assertEqual((before["status"], before["cancelRequested"]), ("succeeded", False))

    def test_stream_disconnect_closes_waiting_without_saving_an_explicit_stop(self):
        client_id = self.client_id()
        with self.fake_provider(held=True) as (posts, received, release):
            response = self.post(CHAT, self.payload(client_id), accept="text/event-stream")
            try:
                self.assertEqual(response.status_code, 200)
                chunks = iter(response.streaming_content)
                self.assertIn(b"event: status", next(chunks))
                self.assertTrue(received.wait(6))
            finally:
                response.close()
            response.ai_stream.thread.join(6)
            release.set()
            self.assertFalse(response.ai_stream.thread.is_alive())
            self.assertEqual(posts, ["/v1/chat/completions"])
        receipt = self.status(client_id).json()["request"]
        self.assertEqual((receipt["status"], receipt["cancelRequested"]), ("unknown", False))
        self.assertEqual(self.post(CHAT, self.payload(client_id)).json()["code"], "ai_chat_result_unknown")
