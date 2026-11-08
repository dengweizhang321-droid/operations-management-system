"""Isolated Django authority + real signed HTTP transport; fake Docker boundary."""
from contextlib import contextmanager
import http.server
import json
from pathlib import Path
import secrets
import tempfile
import threading
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from pi_runner.protocol import encode, signature, workspace_key
from . import pi_native, pi_transport, pi_worker, pi_workspace
from .pi_models import PiControl, PiDispatch, PiOperation, PiSession, PiWorkspace
from .policy import AiError, mutation
from .test_pi_runtime import PiRuntimeTests


@contextmanager
def signed_reply(body=b'{"error":"session_limit"}', *, status=400, wrong_nonce=False):
    key = secrets.token_bytes(32)
    seen = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(request["command"])
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Signature", signature(key, self.headers["X-Timestamp"],
                "0" * 32 if wrong_nonce else self.headers["X-Nonce"], body, direction="response"))
            self.end_headers()
            self.wfile.write(body)

    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.object(pi_transport, "secret", return_value=key), patch.object(pi_transport, "PORT", server.server_port):
                yield seen
        finally:
            server.shutdown()
            worker.join(timeout=2)


@contextmanager
def signed_broker(broker):
    from pi_runner.server import Handler
    broker.key = secrets.token_bytes(32)
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        server.broker = broker
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.object(pi_transport, "secret", return_value=broker.key), patch.object(pi_transport, "PORT", server.server_port):
                yield
        finally:
            server.shutdown()
            worker.join(timeout=2)


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiRetainedLifecycleTests(TestCase):
    setUp = PiRuntimeTests.setUp
    user = PiRuntimeTests.user
    session = PiRuntimeTests.session
    prompt = PiRuntimeTests.prompt

    def test_signed_capacity_closes_worker_and_never_dispatches_prompt(self):
        self.prompt()
        operation = pi_worker.claim()
        with signed_reply() as seen:
            pi_worker.perform(operation)
        operation.refresh_from_db()
        session = PiSession.objects.get(pk=operation.session_id)
        dispatch = PiDispatch.objects.get(operation=operation, kind="runner:create")
        self.assertEqual(seen, ["create"])
        self.assertEqual((dispatch.status, dispatch.error_code), ("completed", "pi_session_limit"))
        self.assertEqual((operation.status, operation.error_code, operation.capability_hash, operation.lease_token),
            ("failed", "pi_session_limit", "", ""))
        self.assertEqual((session.status, session.active_operation_id), ("idle", ""))

    def test_signed_capacity_closes_workspace_init_and_original_receipt_is_reused(self):
        sid = self.session()
        request = {"clientRequestId": "init-bash", "command": "bash", "payload": {"command": "echo isolated"}}
        with signed_reply() as seen:
            with self.assertRaises(pi_transport.SessionLimitRejected):
                pi_workspace.control(sid, request, self.owner)
            replay = pi_workspace.control(sid, request, self.owner)
        self.assertEqual(seen, ["create"])
        self.assertTrue(replay["replayed"])
        self.assertEqual((replay["control"]["status"], replay["control"]["errorCode"]), ("failed", "pi_session_limit"))
        operation = PiOperation.objects.get(session_id=sid)
        self.assertEqual((operation.status, operation.session.status), ("failed", "idle"))
        self.assertEqual(PiWorkspace.objects.get(session_id=sid).status, "uninitialized")

    def test_wrong_nonce_status_or_body_never_becomes_a_known_rejection(self):
        job = {"operationId": "pi-op-fixture", "ownerId": "fixture@example.invalid", "conversationId": "pi-fixture",
            "epoch": 1, "generation": 1, "seq": 1, "command": "create", "payload": {}}
        for kwargs in ({"wrong_nonce": True}, {"status": 503}, {"body": encode({"error": "session_limit", "effect": "uncertain"})},
                {"body": b'{"error":"unknown","error":"session_limit"}'}):
            with self.subTest(kwargs=kwargs), signed_reply(**kwargs) as seen:
                with self.assertRaises(AiError) as failure:
                    pi_transport.command(job)
                self.assertEqual(failure.exception.code, "pi_runner_unknown")
                self.assertEqual(seen, ["create"])
        self.prompt()
        operation = pi_worker.claim()
        with signed_reply(wrong_nonce=True) as seen:
            pi_worker.perform(operation)
        self.assertEqual(seen, ["create"])
        dispatch = PiDispatch.objects.get(operation=operation, kind="runner:create")
        self.assertEqual(dispatch.status, "unknown")
        self.assertNotEqual(PiOperation.objects.get(pk=operation.pk).status, "failed")

    def test_maintenance_reuses_exact_receipt_and_never_accepts_browser_command(self):
        from pi_runner.protocol import workspace_key
        self.prompt()
        operation = pi_worker.claim()
        pi_workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation, status="paused")
        admission = pi_native.admission(operation)
        expected = {"containerId": "a" * 64, "image": "sha256:" + "b" * 64, "volume": "pi-test-original-workspace", "lastSeq": 1}
        shell = {**expected, "workspaceId": workspace_key(pi_worker.identity(operation))}
        state = {**shell, "environmentStatus": "stopped", "generation": 1, "admission": admission, "retainedWorkspace": False}

        def runner(request):
            args = request["payload"]
            if args["action"] == "state":
                return {"workspace": state}
            self.assertEqual(args["command"], "reclaim_stopped")
            self.assertEqual(args["payload"], {"expected": shell, "admission": admission, "requireLocalRestore": True})
            return {"workspace": {**state, "containerId": None, "retainedWorkspace": True},
                "control": {"controlId": args["controlId"], "controlSeq": args["controlSeq"], "status": "completed", "command": args["command"],
                    "result": {**shell, "containerRemoved": True, "volumePreserved": True}}}

        with patch.object(pi_transport, "command", side_effect=runner) as send:
            with self.assertRaises(AiError):
                pi_workspace.control(session.id, {"clientRequestId": "browser", "command": "reclaim_stopped", "payload": {}}, self.owner)
            first = pi_workspace.reclaim_stopped(session.id, self.owner, request_id="exact-removal", expected=expected)
            again = pi_workspace.reclaim_stopped(session.id, self.owner, request_id="exact-removal", expected=expected)
        self.assertEqual(send.call_count, 2)
        self.assertEqual(first["control"], again["control"])
        self.assertEqual(PiControl.objects.get(session=session).status, "completed")
        self.assertEqual(PiWorkspace.objects.get(session=session).status, "paused")

    def test_wake_without_operation_grant_requires_current_local_binding_proof(self):
        self.prompt()
        operation = pi_worker.claim()
        pi_workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation, status="paused")

        def runner(request):
            args = request["payload"]
            self.assertEqual(args["command"], "wake")
            admission = pi_native.admission(operation)
            self.assertEqual(args["payload"], {"admission": admission})
            result = {"localRestoreVersion": 1, "generation": session.generation, "containerId": "a" * 64, "admission": admission}
            return {"workspace": {"environmentStatus": "idle"}, "control": {"controlId": args["controlId"],
                "controlSeq": args["controlSeq"], "status": "completed", "result": result}}

        with patch.object(pi_transport, "command", side_effect=runner) as send, patch.object(pi_worker, "gateway_capability") as mint:
            answer = pi_workspace.control(session.id, {"clientRequestId": "wake-only", "command": "wake", "payload": {}}, self.owner)
        self.assertEqual(answer["workspace"]["status"], "ready")
        self.assertEqual(send.call_count, 1)
        mint.assert_not_called()
        operation.refresh_from_db()
        self.assertEqual((operation.status, operation.capability_hash, operation.lease_token), ("succeeded", "", ""))

    def test_historical_model_snapshot_requires_frozen_version_and_passive_settings(self):
        self.prompt()
        operation = pi_worker.claim()
        pi_workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        fields = ("contextWindow", "maxTokens", "reasoning", "supportedThinkingLevels")
        model = pi_native.model_binding(self.model, "off")
        projection = {key: model[key] for key in fields}
        with mutation():
            workspace = PiWorkspace.objects.create(session=session, generation=session.generation, status="paused",
                model_id=self.model.id, model_version=self.model.version, state_json=json.dumps({
                    "effectiveModel": projection, "thinking": {"effective": "off"}}))
        self.assertEqual(pi_workspace._historical_local_model(operation, workspace), {**projection, "thinkingLevel": "off"})
        workspace.model_version += 1
        self.assertIsNone(pi_workspace._historical_local_model(operation, workspace))

    def test_rebuilt_runner_poll_preserves_local_model_for_actual_controls(self):
        from pi_runner import upgrade_linux
        from pi_runner.server import Broker, Ledger, Session
        from pi_runner.workspace import Rejected, init_ledger, value_get, value_set

        self.prompt()
        operation = pi_worker.claim()
        pi_workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        admission = pi_native.admission(operation)
        fields = ("contextWindow", "maxTokens", "reasoning", "supportedThinkingLevels")
        binding = pi_native.model_binding(self.model, "off")
        projection = {key: binding[key] for key in fields}
        expected = {**projection, "thinkingLevel": "off"}
        with mutation():
            workspace = PiWorkspace.objects.create(session=session, generation=session.generation, status="paused",
                model_id=self.model.id, model_version=self.model.version, state_json=json.dumps({
                    "effectiveModel": projection, "thinking": {"effective": "off"}}))

        temporary = tempfile.TemporaryDirectory(prefix="pi-local-restart-")
        self.addCleanup(temporary.cleanup)
        broker = object.__new__(Broker)
        broker.lock = threading.RLock()
        broker.state = Path(temporary.name)
        broker.ledger = Ledger(broker.state / "ledger.sqlite3")
        init_ledger(broker.ledger)
        broker.namespace = "pi-test-django"
        broker.image = "sha256:" + "b" * 64
        broker.skill_bundles = {"1.3.0": {"skills": []}}
        identity = pi_worker.identity(operation)
        key = workspace_key(identity)
        name = broker.namespace + "-" + key[:32]
        previous = Session(broker, identity, name, name + "-workspace", [])
        previous.phase = "stopped"
        previous.skill_version = "1.3.0"
        previous.container_id = "a" * 64
        previous.last_seq = operation.seq
        broker.save_session(previous)
        value_set(previous, "admission", admission)
        broker.ledger.db.close()

        broker.ledger = Ledger(broker.state / "ledger.sqlite3")
        self.addCleanup(broker.ledger.db.close)
        init_ledger(broker.ledger)
        broker.sessions = {}
        broker.managed_containers = lambda: [previous.container_id]
        container = {"Id": previous.container_id, "Name": "/" + name, "State": {"Running": False}}
        broker.docker_command = lambda *args, **kwargs: encode([container])
        broker.inspect = lambda runner: container
        broker.rebuild_unknown_references()
        runner = broker.sessions[key]
        self.assertIsNone(value_get(runner, "localModel"))
        plan = {"planId": "upgrade-fixture", "fromImage": broker.image, "toImage": "sha256:" + "c" * 64,
            "sourceSha256": "d" * 64, "protocolVersion": "pi-runner-v1"}
        sent_models = []

        def finish_upgrade(native, plan_id, *, control_id, admission, local_model):
            self.assertEqual((native.phase, plan_id), ("stopped", plan["planId"]))
            sent_models.append(local_model)
            if local_model is None:
                try:
                    native.local_restore_model(local_model)
                except ValueError as error:
                    raise Rejected(str(error)) from error
                self.fail("the old Runner did not have local model metadata")
            self.assertEqual(native.local_restore_model(local_model), expected)
            value_set(native, "localModel", local_model)
            native.image = plan["toImage"]
            native.phase = "idle"
            return {**plan, "generation": session.generation, "preservedWorkspace": True}

        def restore_local(fence, fallback_model=None):
            self.assertEqual(fence, admission)
            self.assertEqual(runner.local_restore_model(fallback_model), expected)
            self.assertIsNone(runner.gateway)

        with (
            signed_broker(broker),
            patch.object(upgrade_linux, "plans", return_value=[plan]),
            patch.object(upgrade_linux, "apply", side_effect=finish_upgrade),
            patch.object(runner, "restore_local", side_effect=restore_local),
            patch.object(pi_worker, "gateway_capability") as mint,
        ):
            for _ in range(2):
                observed = pi_workspace.detail(session.id, {}, self.owner)["workspace"]["state"]
                self.assertIsNone(observed["effectiveModel"])
                self.assertIsNone(observed["thinking"]["effective"])
                self.assertEqual(observed["upgradePlans"], [plan])
                self.assertNotIn(pi_workspace.LOCAL_MODEL_SNAPSHOT, observed)
            workspace.refresh_from_db()
            self.assertEqual(pi_workspace._historical_local_model(operation, workspace), expected)
            for field, replacement in (("epoch", session.epoch + 1), ("generation", session.generation + 1),
                    ("scope_json", "null"), ("actor_role", "operator"), ("status", "frozen")):
                with patch.object(session, field, replacement):
                    self.assertIsNone(pi_workspace._historical_local_model(operation, workspace, session=session))

            prior_state, version = workspace.state_json, workspace.model_version
            with mutation():
                workspace.model_version += 1
                workspace.save(update_fields=["model_version"])
            stale = pi_workspace.control(session.id, {"clientRequestId": "upgrade-stale-model", "command": "upgrade",
                "payload": {"planId": plan["planId"]}}, self.owner)
            for _ in range(10):
                if stale["control"]["status"] == "failed":
                    break
                details = pi_workspace.detail(session.id, {}, self.owner)
                stale = {"control": details["controls"][0]}
            self.assertEqual(stale["control"]["errorCode"], "workspace_local_model_unavailable")
            self.assertEqual(runner.phase, "stopped")
            with mutation():
                workspace.model_version, workspace.state_json = version, prior_state
                workspace.save(update_fields=["model_version", "state_json"])

            upgraded = pi_workspace.control(session.id, {"clientRequestId": "upgrade-restarted", "command": "upgrade",
                "payload": {"planId": plan["planId"]}}, self.owner)
            self.assertIn(upgraded["control"]["status"], {"accepted", "completed"})
            for _ in range(10):
                state = pi_workspace.detail(session.id, {}, self.owner)
                if state["controls"][0]["status"] == "completed":
                    break
            self.assertEqual(state["controls"][0]["status"], "completed")
            woke = pi_workspace.control(session.id, {"clientRequestId": "wake-restarted", "command": "wake", "payload": {}}, self.owner)
            self.assertEqual(woke["workspace"]["status"], "ready")
            mint.assert_not_called()
        self.assertEqual(sent_models, [None, expected])


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiReclaimRaceTests(TransactionTestCase):
    setUp = PiRuntimeTests.setUp
    user = PiRuntimeTests.user
    session = PiRuntimeTests.session
    prompt = PiRuntimeTests.prompt

    def test_reclaim_pending_fences_new_prompt_and_second_maintenance_request(self):
        if connection.vendor != "postgresql":
            self.skipTest("isolated PostgreSQL concurrency contract")
        from pi_runner.protocol import workspace_key
        self.prompt()
        operation = pi_worker.claim()
        pi_workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation, status="ready")
        admission = pi_native.admission(operation)
        expected = {"containerId": "a" * 64, "image": "sha256:" + "b" * 64, "volume": "pi-test-original-workspace", "lastSeq": 1}
        shell = {**expected, "workspaceId": workspace_key(pi_worker.identity(operation))}
        state = {**shell, "environmentStatus": "stopped", "generation": 1, "admission": admission, "retainedWorkspace": False}
        reserved, release = threading.Event(), threading.Event()
        sent, outcomes = [], []

        def runner(request):
            args = request["payload"]
            if args["action"] == "state":
                return {"workspace": state}
            sent.append(args["controlId"])
            reserved.set()
            if not release.wait(10):
                raise RuntimeError("synthetic observation timed out")
            return {"workspace": {**state, "containerId": None, "retainedWorkspace": True},
                "control": {"controlId": args["controlId"], "controlSeq": args["controlSeq"], "status": "completed", "command": args["command"],
                    "result": {**shell, "containerRemoved": True, "volumePreserved": True}}}

        def first():
            close_old_connections()
            try:
                outcomes.append(pi_workspace.reclaim_stopped(session.id, self.owner, request_id="first-removal", expected=expected))
            except Exception as error:
                outcomes.append(error)
            finally:
                close_old_connections()

        with patch.object(pi_transport, "command", side_effect=runner):
            thread = threading.Thread(target=first, daemon=True)
            thread.start()
            try:
                self.assertTrue(reserved.wait(10), outcomes)
                with self.assertRaises(AiError) as prompt:
                    self.prompt(session.id, clientRequestId="concurrent-prompt")
                self.assertEqual(prompt.exception.code, "pi_control_unknown")
                with self.assertRaises(AiError) as maintenance:
                    pi_workspace.reclaim_stopped(session.id, self.owner, request_id="second-removal", expected=expected)
                self.assertEqual(maintenance.exception.code, "pi_reclaim_workspace_unverified")
            finally:
                release.set()
                thread.join(12)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(sent), 1)
        self.assertIsInstance(outcomes[0], dict, outcomes)
        self.assertEqual(outcomes[0]["control"]["status"], "completed")
        self.assertEqual(PiWorkspace.objects.get(session=session).status, "ready")
        self.prompt(session.id, clientRequestId="authorized-resume")
