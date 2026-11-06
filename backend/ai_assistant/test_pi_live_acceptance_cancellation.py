"""No-provider counterexamples for watcher admission, ownership and error identity."""
from contextlib import contextmanager
import json
import socket
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import OperationalError, connection, connections
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from psycopg.errors import TooManyConnections

from . import transport, provider, pi_gateway, pi_worker, pi_service, pi_native
from . import tests as domain
from .pi_cancellation import model_checks
from .pi_models import PiDispatch, PiEvent, PiOperation
from .policy import AiError
from . import test_transport_dns_phase
from .test_transport import HOST, URL, addresses


def capacity_failure():
    error = OperationalError("PRIVATE_DB_CONNECTION_TEXT")
    error.__cause__ = TooManyConnections("PRIVATE_DB_CONNECTION_TEXT")
    return error


@override_settings(DJANGO_ENVIRONMENT="production")
class CancellationTransportTests(SimpleTestCase):
    wire = test_transport_dns_phase.DnsPhaseTests.wire

    def setUp(self):
        self.enterContext(patch.dict("os.environ", {"AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST": "https://"+HOST}))
        self.enterContext(patch.object(transport, "resolve_addresses", return_value=addresses("8.8.4.4")))

    def test_capacity_during_first_check_sends_no_http(self):
        sock, client, _ = self.wire()
        sock.detach.return_value = -1
        owner=threading.get_ident()
        def check():
            if threading.get_ident()!=owner:raise capacity_failure()
        with transport.request_cancellation(check):
            with self.assertRaises(transport.CancellationCheckError) as caught:
                transport.bounded_json(URL, {}, timeout=1)
        self.assertEqual(caught.exception.code, "ai_cancellation_check_unavailable")
        self.assertEqual(caught.exception.diagnostics, {"adapterVersion":transport.PROVIDER_ADAPTER_VERSION,
            "stage":"cancel_preflight", "reason":"database_capacity", "requestStarted":False,"sqlState":"53300"})
        self.assertNotIn("PRIVATE", str(caught.exception))
        client.request.assert_not_called();sock.connect.assert_not_called();sock.close.assert_called()

    def test_pending_preflight_times_out_without_http_and_late_failure_does_not_detach(self):
        sock, client, _ = self.wire()
        release = threading.Event()
        owner=threading.get_ident()
        def check():
            if threading.get_ident()!=owner:
                release.wait(2)
                raise capacity_failure()
        with patch.object(transport.socket,"close"):
            try:
                with transport.request_cancellation(check), self.assertRaises(transport.CancellationCheckError):
                    transport.bounded_json(URL, {}, timeout=.01)
                cuts = sock.detach.call_count
                client.request.assert_not_called();sock.connect.assert_not_called()
            finally:
                release.set()
                time.sleep(.05)
        self.assertEqual(sock.detach.call_count,cuts)

    def test_inflight_first_error_survives_owner_success_and_http_or_json_failure(self):
        for lower in (socket.error("PRIVATE_SOCKET"), b"not-json"):
            with self.subTest(lower=type(lower).__name__):
                sock, client, response = self.wire()
                sock.detach.return_value = -1
                watching = threading.Event();failed = threading.Event()
                owner = threading.get_ident()
                def check():
                    if threading.get_ident()!=owner and watching.is_set():
                        failed.set();raise capacity_failure()
                def headers():
                    watching.set();self.assertTrue(failed.wait(1))
                    if isinstance(lower,Exception):raise lower
                    response.read1.side_effect=[lower,b""]
                    return response
                client.getresponse.side_effect=headers
                with transport.request_cancellation(check), self.assertRaises(transport.CancellationCheckError) as caught:
                    transport.bounded_json(URL,{},timeout=2)
                self.assertEqual(caught.exception.diagnostics["reason"],"database_capacity")
                self.assertTrue(caught.exception.diagnostics["requestStarted"])
                client.request.assert_called_once()

    def test_late_cancel_at_success_exit_still_fails_closed(self):
        sock, client, response = self.wire();sock.detach.return_value=-1
        release=threading.Event();checked=threading.Event();owner=threading.get_ident()
        def check():
            if threading.get_ident()!=owner and release.is_set():
                checked.set();raise AiError("stopped","ai_request_cancelled",499)
        def payload(*args):
            release.set();self.assertTrue(checked.wait(1));return b"{}"
        response.read1.side_effect=payload
        with transport.request_cancellation(check),self.assertRaises(AiError) as caught:
            transport.bounded_json(URL,{},timeout=2)
        self.assertEqual(caught.exception.code,"ai_request_cancelled")

    def test_no_scope_chat_style_cancellation_preserves_explicit_revoke_code(self):
        for code in ("ai_request_cancelled","access_denied"):
            with self.subTest(code=code):
                sock,client,_=self.wire();sock.detach.return_value=-1
                def check():raise AiError("fixed",code,403)
                with transport.request_cancellation(check),self.assertRaises(AiError) as caught:
                    transport.bounded_json(URL,{},timeout=1)
                self.assertEqual(caught.exception.code,code);client.request.assert_not_called()

    def test_stop_api_without_scope_is_callable_and_does_not_cut_late_result(self):
        sock=MagicMock();sock.detach.return_value=-1
        release=threading.Event();entered=threading.Event()
        def check():entered.set();release.wait(3);raise capacity_failure()
        handle=transport._SocketCancellationWatch(lambda:sock,check,None,2)
        self.assertTrue(entered.wait(1))
        try:
            self.assertFalse(handle())
            with self.assertRaises(transport.CancellationCheckError) as caught:handle.require_finished()
            self.assertEqual(caught.exception.diagnostics["reason"],"cleanup_unconfirmed")
        finally:
            release.set();self.assertTrue(handle.finished.wait(1));handle()
        sock.detach.assert_not_called()


@override_settings(DJANGO_PROCESS_ROLE="development",DJANGO_ENVIRONMENT="test")
class CancellationGatewayTests(TestCase):
    setUp=domain.AiDomainTests.setUp
    user=domain.AiDomainTests.user
    wire=test_transport_dns_phase.DnsPhaseTests.wire

    def test_fixed_error_survives_provider_gateway_and_original_unknown_never_replays(self):
        actor=self.user("capacity-case@example.invalid","admin",None)
        sid=pi_service.create_session({"clientRequestId":"capacity-session"},actor)["session"]["id"]
        pi_service.prompt(sid,{"clientRequestId":"capacity-prompt","message":"synthetic"},actor)
        op=pi_worker.claim();token=pi_worker.gateway_capability(op)["capability"]
        payload={**pi_worker.identity(op),"kind":"model","requestId":"model-once","capability":token,
            "messages":[{"role":"user","content":"synthetic"}],"tools":[],"admission":pi_native.admission(op)}
        sock,client,_=self.wire();sock.detach.return_value=-1
        @contextmanager
        def scope(seconds):
            raise capacity_failure();yield
        with patch.object(pi_gateway,"catalog",return_value=([],[])),patch("ai_assistant.pi_cancellation.model_checks",return_value=(lambda:None,scope)),patch.object(provider,"decrypt",return_value="fixture"),patch.object(transport,"resolve_addresses",return_value=addresses("8.8.4.4")):
            with self.assertRaises(transport.CancellationCheckError):pi_gateway.execute(payload,"a"*32)
            op.refresh_from_db()
            self.assertEqual((op.status,op.error_code),("unknown","ai_cancellation_check_unavailable"))
            dispatch=PiDispatch.objects.get(operation=op,kind="model")
            self.assertEqual(dispatch.status,"unknown")
            event=PiEvent.objects.get(operation=op,event_type="error")
            public=json.loads(event.data_json)
            self.assertEqual(public["code"],"ai_cancellation_check_unavailable")
            self.assertEqual(public["responseDiagnostics"]["sqlState"],"53300")
            self.assertFalse(public["responseDiagnostics"]["requestStarted"])
            self.assertNotIn("PRIVATE",event.data_json)
            with self.assertRaises(AiError):pi_gateway.execute(payload,"b"*32)
            self.assertEqual(PiDispatch.objects.filter(operation=op,kind="model").count(),1)
        client.request.assert_not_called()


@override_settings(DJANGO_PROCESS_ROLE="development",DJANGO_ENVIRONMENT="test")
class CancellationConnectionTests(TransactionTestCase):
    setUp=domain.AiDomainTests.setUp
    user=domain.AiDomainTests.user

    def test_watcher_reuses_its_own_pg_connection_closes_it_and_owner_aging_does_not_reconnect(self):
        if connection.vendor!="postgresql":self.skipTest("private PostgreSQL only")
        actor=self.user("watcher-pg@example.invalid","admin",None)
        sid=pi_service.create_session({"clientRequestId":"watcher-pg-session"},actor)["session"]["id"]
        pi_service.prompt(sid,{"clientRequestId":"watcher-pg-prompt","message":"synthetic"},actor)
        op=pi_worker.claim()
        check,scope=model_checks(op,None)
        # The single preflight ageing boundary may replace an old connection.
        # The invariant starts after that boundary, during the live transport.
        with connection.cursor() as c:c.execute("SELECT pg_backend_pid()");owner_pid=c.fetchone()[0]
        original=connection.close_at;seen=[];third=threading.Event();owner=threading.get_ident()
        def observed():
            check()
            if threading.get_ident()!=owner:
                with connections["default"].cursor() as c:c.execute("SELECT pg_backend_pid()");seen.append(c.fetchone()[0])
                if len(seen)>=3:third.set()
        left,right=socket.socketpair()
        try:
            with transport.request_cancellation(observed,watcher_scope=scope):
                handle=transport.watch_socket_cancellation(lambda:left,timeout=3)
                try:
                    self.assertTrue(third.wait(2))
                    connection.close_at=time.monotonic()-61
                    check();check()
                    with connection.cursor() as c:c.execute("SELECT pg_backend_pid()");self.assertEqual(c.fetchone()[0],owner_pid)
                    PiOperation.objects.filter(pk=op.pk).update(cancel_requested=True)
                    self.assertTrue(handle.finished.wait(2))
                    with self.assertRaises(AiError) as caught:handle.raise_if_failed(request_started=True)
                    self.assertEqual(caught.exception.code,"pi_canceled_during_dispatch")
                finally:self.assertTrue(handle())
            self.assertEqual(len(set(seen)),1);self.assertNotEqual(seen[0],owner_pid)
            with connection.cursor() as c:
                c.execute("SELECT count(*) FROM pg_stat_activity WHERE pid=%s",[seen[0]])
                self.assertEqual(c.fetchone()[0],0)
        finally:
            connection.close_at=original;left.close();right.close()
