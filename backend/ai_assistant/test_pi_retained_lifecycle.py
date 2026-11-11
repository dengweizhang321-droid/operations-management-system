"""Isolated Django authority + real signed HTTP transport; fake Docker boundary."""
from contextlib import contextmanager
import http.server
import json
from pathlib import Path
import secrets
import tempfile
import threading
from unittest.mock import patch

from datetime import timedelta

from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
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


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiAutoReclaimTests(TestCase):
    """Periodic sweep (pi_workspace.auto_reclaim_idle) and the on-demand
    reclaim-then-retry-once path in pi_worker._create_with_reclaim_retry.
    """
    setUp = PiRuntimeTests.setUp
    user = PiRuntimeTests.user
    session = PiRuntimeTests.session
    prompt = PiRuntimeTests.prompt

    def stopped_shell(self, *, idle_hours=48, require_local_restore=False):
        """One idle session whose current-generation workspace holds a stopped,
        reclaimable shell, plus the fixed Runner state/receipt bodies for it.
        """
        sid = self.session()
        self.prompt(sid)
        operation = pi_worker.claim()
        pi_workspace._finish_init(operation)
        session = PiSession.objects.get(pk=sid)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation,
                status="paused" if require_local_restore else "ready")
        PiSession.objects.filter(pk=sid).update(updated_at=timezone.now() - timedelta(hours=idle_hours))
        admission = pi_native.admission(operation)
        expected = {"containerId": secrets.token_hex(32), "image": "sha256:" + secrets.token_hex(32),
            "volume": "pi-test-vol-" + secrets.token_hex(6), "lastSeq": operation.seq}
        shell = {**expected, "workspaceId": workspace_key(pi_worker.identity(operation))}
        state = {**shell, "environmentStatus": "stopped", "generation": session.generation,
            "admission": admission, "retainedWorkspace": False}
        return session, operation, admission, expected, shell, state

    def uninitialized_stopped_shell(self, *, idle_hours=48):
        """One idle session that only ever went through prompt/claim/perform --
        never the workspace panel/control path -- so Django's PiWorkspace row
        is still at the model default "uninitialized". Production shape of
        the bug this test file covers: ingest() is the only thing that ever
        moves workspace.status off "uninitialized", and it only runs when the
        Runner's create/prompt/state response happens to carry a "workspace"
        key or one of the specific "state" keys it checks for
        (pi_worker.ingest, ~line 264); a lean create/prompt/settle exchange
        that never touches those keys leaves the row exactly as
        PiWorkspace._workspace()'s get_or_create default left it, with
        state_json still "{}".

        Returns the same shape as stopped_shell(): (session, operation,
        admission, expected, shell, state) -- the Runner-side observation and
        receipt bodies reclaim_runner() needs -- so every reclaim test below
        can use either fixture interchangeably.
        """
        sid = self.session()
        self.prompt(sid)
        operation = pi_worker.claim()

        def runner(request):
            command = request["command"]
            if command == "create":
                return {"status": "idle", "state": {"commands": []}}
            self.assertEqual(command, "prompt")
            return {"status": "settled", "filesCollected": True, "files": [],
                "events": [{**pi_worker.identity(operation), "eventSeq": 1, "type": "agent_settled"}],
                "terminalReceipt": {"operationId": operation.id, "status": "settled", "eventSeq": 1, "files": []}}
        # runner_dispatch encrypts each completed dispatch's response at rest
        # (ai_assistant/secrets.py); perform() is not otherwise exercised with
        # a real create+prompt round trip anywhere else in this file, so this
        # fixture is the first call site here that needs the key configured.
        with patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "uninitialized-fixture-cache-key-0123456789"}), \
                patch.object(pi_worker, "heartbeat"), patch.object(pi_transport, "command", side_effect=runner):
            pi_worker.perform(operation)
        operation.refresh_from_db()
        self.assertEqual(operation.status, "succeeded")
        session = PiSession.objects.get(pk=sid)
        self.assertEqual(session.status, "idle")
        # A plain prompt/claim/perform cycle that never carries a "workspace"
        # or relevant "state" key (pi_worker.ingest's own condition) never
        # calls pi_workspace._workspace(session) at all, so no PiWorkspace row
        # exists yet here -- this session genuinely has none, not merely one
        # at the default status. Production's 8 stuck sessions did have a row
        # (confirmed via GET .../workspace, i.e. pi_workspace.detail()), which
        # is itself what calls _workspace()'s get_or_create; detail() then
        # skips ingest()'s poll whenever workspace.status == "uninitialized"
        # (line ~374 of pi_workspace.py), so that same read never advances it
        # past "uninitialized" either. Call _workspace() directly here to
        # reproduce exactly that row-creation step without a full HTTP round
        # trip through detail().
        workspace = pi_workspace._workspace(session)
        self.assertEqual(workspace.status, "uninitialized")
        self.assertEqual(workspace.state_json, "{}")
        PiSession.objects.filter(pk=sid).update(updated_at=timezone.now() - timedelta(hours=idle_hours))
        admission = pi_native.admission(operation)
        expected = {"containerId": secrets.token_hex(32), "image": "sha256:" + secrets.token_hex(32),
            "volume": "pi-test-vol-" + secrets.token_hex(6), "lastSeq": operation.seq}
        shell = {**expected, "workspaceId": workspace_key(pi_worker.identity(operation))}
        state = {**shell, "environmentStatus": "stopped", "generation": session.generation,
            "admission": admission, "retainedWorkspace": False}
        return session, operation, admission, expected, shell, state

    def reclaim_runner(self, fixtures, *, on_reclaim_result=None):
        """fixtures: {session_id: (operation, admission, expected, shell, state)}.
        Serves 'state' observation and 'reclaim_stopped' control for each
        fixture's own session only; anything else is a test bug (assert).
        """
        def runner(request):
            sid = request["conversationId"]
            self.assertIn(sid, fixtures, "unexpected session in reclaim runner")
            operation, admission, expected, shell, state = fixtures[sid]
            args = request["payload"]
            if args["action"] == "state":
                return {"workspace": state}
            self.assertEqual(args["command"], "reclaim_stopped")
            self.assertEqual(args["payload"]["expected"], shell)
            result = (on_reclaim_result or (lambda sid: "completed"))(sid)
            if result == "completed":
                return {"workspace": {**state, "containerId": None, "retainedWorkspace": True},
                    "control": {"controlId": args["controlId"], "controlSeq": args["controlSeq"], "status": "completed",
                        "command": args["command"], "result": {**shell, "containerRemoved": True, "volumePreserved": True}}}
            return {"workspace": state, "control": {"controlId": args["controlId"], "controlSeq": args["controlSeq"],
                "status": "failed", "command": args["command"], "errorCode": result}}
        return runner

    def test_sweep_reclaims_only_sessions_idle_past_threshold_oldest_first(self):
        old_a, op_a, adm_a, exp_a, shell_a, state_a = self.stopped_shell(idle_hours=72)
        old_b, op_b, adm_b, exp_b, shell_b, state_b = self.stopped_shell(idle_hours=48)
        fresh, op_c, adm_c, exp_c, shell_c, state_c = self.stopped_shell(idle_hours=1)
        # Make the 72h session the oldest by activity (lowest updated_at).
        from django.utils import timezone
        from datetime import timedelta
        PiSession.objects.filter(pk=old_a.id).update(updated_at=timezone.now() - timedelta(hours=96))
        PiSession.objects.filter(pk=old_b.id).update(updated_at=timezone.now() - timedelta(hours=48))
        order = []
        fixtures = {old_a.id: (op_a, adm_a, exp_a, shell_a, state_a), old_b.id: (op_b, adm_b, exp_b, shell_b, state_b),
            fresh.id: (op_c, adm_c, exp_c, shell_c, state_c)}

        def recorder(sid):
            order.append(sid)
            return "completed"
        with patch.object(pi_transport, "command", side_effect=self.reclaim_runner(fixtures, on_reclaim_result=recorder)):
            reclaimed = pi_workspace.auto_reclaim_idle(idle_seconds=24 * 3600, limit=4)
        self.assertEqual(reclaimed, 2)
        self.assertEqual(order, [old_a.id, old_b.id])
        self.assertNotIn(fresh.id, order)
        self.assertEqual(PiWorkspace.objects.get(session=old_a).status, "ready")
        self.assertEqual(PiWorkspace.objects.get(session=old_b).status, "ready")

    def test_sweep_skips_unreclaimable_candidate_without_affecting_the_next_one(self):
        blocked, op_a, adm_a, exp_a, shell_a, state_a = self.stopped_shell(idle_hours=72, require_local_restore=True)
        ok, op_b, adm_b, exp_b, shell_b, state_b = self.stopped_shell(idle_hours=48)
        from django.utils import timezone
        from datetime import timedelta
        PiSession.objects.filter(pk=blocked.id).update(updated_at=timezone.now() - timedelta(hours=96))
        fixtures = {blocked.id: (op_a, adm_a, exp_a, shell_a, state_a), ok.id: (op_b, adm_b, exp_b, shell_b, state_b)}

        def outcome(sid):
            return "workspace_native_image_upgrade_required" if sid == blocked.id else "completed"
        with patch.object(pi_transport, "command", side_effect=self.reclaim_runner(fixtures, on_reclaim_result=outcome)):
            reclaimed = pi_workspace.auto_reclaim_idle(idle_seconds=24 * 3600, limit=4)
        self.assertEqual(reclaimed, 1)
        self.assertEqual(PiWorkspace.objects.get(session=blocked).status, "paused")
        self.assertEqual(PiWorkspace.objects.get(session=ok).status, "ready")

    def test_sweep_does_not_starve_on_a_block_of_old_unreclaimable_shells(self):
        """Production shape: the 5 oldest stopped shells are on a retired image
        (Runner deterministically rejects every one with
        workspace_native_image_upgrade_required); only the 3 newest are on the
        current image and reclaimable. limit=4 must still reclaim all 3 --
        "limit" bounds successes, not how many old rejects get scanned past.
        """
        from django.utils import timezone
        from datetime import timedelta
        old_image_ages = [100, 99, 98, 97, 96]  # oldest first, all unreclaimable
        new_image_ages = [10, 9, 8]              # oldest first, all reclaimable
        fixtures = {}
        blocked_ids, reclaimable_ids = [], []
        for hours in old_image_ages:
            session, op, adm, exp, shell, state = self.stopped_shell(idle_hours=hours)
            PiSession.objects.filter(pk=session.id).update(updated_at=timezone.now() - timedelta(hours=hours))
            fixtures[session.id] = (op, adm, exp, shell, state)
            blocked_ids.append(session.id)
        for hours in new_image_ages:
            session, op, adm, exp, shell, state = self.stopped_shell(idle_hours=hours)
            PiSession.objects.filter(pk=session.id).update(updated_at=timezone.now() - timedelta(hours=hours))
            fixtures[session.id] = (op, adm, exp, shell, state)
            reclaimable_ids.append(session.id)

        def outcome(sid):
            return "workspace_native_image_upgrade_required" if sid in blocked_ids else "completed"
        with patch.object(pi_transport, "command", side_effect=self.reclaim_runner(fixtures, on_reclaim_result=outcome)):
            # Threshold below the youngest fixture's idle time (8h) so every
            # fixture here qualifies as idle; the point under test is scan
            # depth past rejections, not the idle-threshold filter itself
            # (already covered by test_sweep_reclaims_only_sessions_idle_past_threshold_oldest_first).
            reclaimed = pi_workspace.auto_reclaim_idle(idle_seconds=3600, limit=4)
        self.assertEqual(reclaimed, 3)
        for sid in blocked_ids:
            self.assertEqual(PiWorkspace.objects.get(session_id=sid).status, "ready")
        for sid in reclaimable_ids:
            self.assertEqual(PiWorkspace.objects.get(session_id=sid).status, "ready")
        # The 3 reclaimable shells really were removed (not just left "ready"
        # by coincidence): each one hit the completed reclaim_stopped control.
        for sid in reclaimable_ids:
            self.assertEqual(PiControl.objects.get(session_id=sid, command="reclaim_stopped").status, "completed")
        for sid in blocked_ids:
            self.assertEqual(PiControl.objects.get(session_id=sid, command="reclaim_stopped").status, "failed")

    def test_sweep_does_not_let_an_already_reclaimed_session_block_younger_candidates(self):
        """A session whose shell was already removed (reclaim_stopped completed,
        no later successful create) stays idle with workspace status "ready"
        or "paused" and would otherwise occupy a candidate slot forever.
        """
        from django.utils import timezone
        from datetime import timedelta
        already, op_a, adm_a, exp_a, shell_a, state_a = self.stopped_shell(idle_hours=96)
        younger, op_b, adm_b, exp_b, shell_b, state_b = self.stopped_shell(idle_hours=48)
        PiSession.objects.filter(pk=already.id).update(updated_at=timezone.now() - timedelta(hours=96))
        # Perform the already-reclaimed session's real reclaim up front, same
        # as a prior sweep round would have, leaving its own PiControl trail.
        fixtures = {already.id: (op_a, adm_a, exp_a, shell_a, state_a), younger.id: (op_b, adm_b, exp_b, shell_b, state_b)}
        with patch.object(pi_transport, "command", side_effect=self.reclaim_runner(fixtures)):
            self.assertTrue(pi_workspace.reclaim_one_idle_session(already.id))
        self.assertEqual(PiWorkspace.objects.get(session=already).status, "ready")
        # reclaim_stopped's own event() bumped updated_at to now; push it back
        # out past the idle threshold so this test actually exercises
        # _already_reclaimed rather than the ordinary idle_since filter.
        PiSession.objects.filter(pk=already.id).update(updated_at=timezone.now() - timedelta(hours=96))

        candidates = pi_workspace.idle_reclaim_candidates(
            idle_since=timezone.now() - timedelta(hours=1), scan_limit=4)
        self.assertNotIn(already.id, [c.id for c in candidates])
        self.assertIn(younger.id, [c.id for c in candidates])

        calls = []

        def runner(request):
            calls.append(request["conversationId"])
            return self.reclaim_runner(fixtures)(request)
        with patch.object(pi_transport, "command", side_effect=runner):
            reclaimed = pi_workspace.auto_reclaim_idle(idle_seconds=24 * 3600, limit=4)
        self.assertEqual(reclaimed, 1)
        self.assertNotIn(already.id, calls)

    def test_unknown_result_stops_sweep_and_is_never_replayed(self):
        first, op_a, adm_a, exp_a, shell_a, state_a = self.stopped_shell(idle_hours=72)
        second, op_b, adm_b, exp_b, shell_b, state_b = self.stopped_shell(idle_hours=48)
        from django.utils import timezone
        from datetime import timedelta
        PiSession.objects.filter(pk=first.id).update(updated_at=timezone.now() - timedelta(hours=96))
        fixtures = {first.id: (op_a, adm_a, exp_a, shell_a, state_a), second.id: (op_b, adm_b, exp_b, shell_b, state_b)}
        calls = []

        def runner(request):
            sid = request["conversationId"]
            calls.append(sid)
            args = request["payload"]
            operation, admission, expected, shell, state = fixtures[sid]
            if args["action"] == "state":
                return {"workspace": state}
            if sid == first.id:
                raise ConnectionError("synthetic transport failure")
            return {"workspace": {**state, "containerId": None, "retainedWorkspace": True},
                "control": {"controlId": args["controlId"], "controlSeq": args["controlSeq"], "status": "completed",
                    "command": args["command"], "result": {**shell, "containerRemoved": True, "volumePreserved": True}}}
        with patch.object(pi_transport, "command", side_effect=runner):
            reclaimed = pi_workspace.auto_reclaim_idle(idle_seconds=24 * 3600, limit=4)
        self.assertEqual(reclaimed, 0)
        self.assertNotIn(second.id, calls)
        self.assertEqual(PiControl.objects.filter(session=first, command="reclaim_stopped").count(), 1)
        control = PiControl.objects.get(session=first, command="reclaim_stopped")
        self.assertEqual(control.status, "unknown")
        self.assertEqual(control.error_code, "pi_reclaim_unknown")
        self.assertEqual(PiWorkspace.objects.get(session=first).status, "unknown")
        # A second sweep must never resend the same uncertain request for
        # `first` -- its own workspace status ("unknown") already excludes it
        # as a fresh candidate, so this also exercises that exclusion holds.
        # `second` is untouched by the first sweep (the scan stopped on
        # `first` before reaching it) and is free to reclaim normally here.
        # Assert on the recorded call log outside the mock, not by raising
        # inside it: auto_reclaim_idle's own broad except would otherwise
        # swallow a raised AssertionError and this would pass even if the
        # uncertain request were replayed.
        second_sweep_calls = []

        def second_sweep(request):
            second_sweep_calls.append(request["conversationId"])
            return runner(request)
        with patch.object(pi_transport, "command", side_effect=second_sweep):
            reclaimed_again = pi_workspace.auto_reclaim_idle(idle_seconds=24 * 3600, limit=4)
        self.assertNotIn(first.id, second_sweep_calls)
        self.assertIn(second.id, second_sweep_calls)
        self.assertEqual(reclaimed_again, 1)
        self.assertEqual(PiControl.objects.filter(session=first, command="reclaim_stopped").count(), 1)
        control.refresh_from_db()
        self.assertEqual(control.status, "unknown")

    def test_current_session_is_never_selected_as_its_own_reclaim_target(self):
        session, operation, admission, expected, shell, state = self.stopped_shell(idle_hours=96)
        # Without exclusion this session is a perfectly ordinary candidate --
        # the fixture matches idle_reclaim_candidates' own filter exactly.
        without_exclusion = pi_workspace.idle_reclaim_candidates(
            idle_since=timezone.now() - timedelta(hours=1), scan_limit=4)
        self.assertIn(session.id, [c.id for c in without_exclusion])
        with_exclusion = pi_workspace.idle_reclaim_candidates(
            idle_since=timezone.now() - timedelta(hours=1), scan_limit=4, exclude_session_id=session.id)
        self.assertNotIn(session.id, [c.id for c in with_exclusion])

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-create-retry-cache-key-123456789"})
    def test_session_limit_on_create_reclaims_one_idle_shell_and_retries_once(self):
        donor, donor_op, donor_adm, donor_exp, donor_shell, donor_state = self.stopped_shell(idle_hours=48)
        new_session_id = self.session()
        self.prompt(new_session_id, clientRequestId="prompt-needs-capacity")
        new_op = pi_worker.claim()
        fixtures = {donor.id: (donor_op, donor_adm, donor_exp, donor_shell, donor_state)}
        create_calls = []

        def runner(request):
            if request["conversationId"] == donor.id:
                return self.reclaim_runner(fixtures)(request)
            self.assertEqual(request["conversationId"], new_session_id)
            self.assertEqual(request["command"], "create")
            create_calls.append(request)
            if len(create_calls) == 1:
                raise pi_transport.SessionLimitRejected()
            return {**pi_worker.identity(new_op), "status": "accepted", "state": {}}
        with patch.object(pi_transport, "command", side_effect=runner):
            result = pi_worker._create_with_reclaim_retry(new_op, {"admission": pi_native.admission(new_op)})
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(len(create_calls), 2)
        dispatches = list(PiDispatch.objects.filter(operation=new_op, kind="runner:create").order_by("created_at").values_list("request_id", "status", "error_code"))
        self.assertEqual(dispatches, [("create", "completed", "pi_session_limit"), ("create:after-reclaim", "completed", "")])
        self.assertEqual(PiWorkspace.objects.get(session=donor).status, "ready")
        self.assertTrue(pi_worker.fail_before_prompt is not None)  # sanity: capacity judgment helper still importable

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-create-retry-scan-key-123456789"})
    def test_session_limit_on_create_skips_oldest_rejected_donor_and_reclaims_the_next(self):
        """Production shape for the create-retry path: the oldest idle
        candidate is on a retired image and Runner rejects its reclaim; the
        retry must move on to the next-oldest candidate instead of giving up.
        """
        blocked, op_a, adm_a, exp_a, shell_a, state_a = self.stopped_shell(idle_hours=96)
        donor, op_b, adm_b, exp_b, shell_b, state_b = self.stopped_shell(idle_hours=48)
        new_session_id = self.session()
        self.prompt(new_session_id, clientRequestId="prompt-needs-capacity-scan")
        new_op = pi_worker.claim()
        fixtures = {blocked.id: (op_a, adm_a, exp_a, shell_a, state_a), donor.id: (op_b, adm_b, exp_b, shell_b, state_b)}
        create_calls = []

        def reclaim_outcome(sid):
            return "workspace_native_image_upgrade_required" if sid == blocked.id else "completed"

        def runner(request):
            if request["conversationId"] in fixtures:
                return self.reclaim_runner(fixtures, on_reclaim_result=reclaim_outcome)(request)
            self.assertEqual(request["conversationId"], new_session_id)
            self.assertEqual(request["command"], "create")
            create_calls.append(request)
            if len(create_calls) == 1:
                raise pi_transport.SessionLimitRejected()
            return {**pi_worker.identity(new_op), "status": "accepted", "state": {}}
        with patch.object(pi_transport, "command", side_effect=runner):
            result = pi_worker._create_with_reclaim_retry(new_op, {"admission": pi_native.admission(new_op)})
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(len(create_calls), 2)
        self.assertEqual(PiWorkspace.objects.get(session=blocked).status, "ready")
        self.assertEqual(PiWorkspace.objects.get(session=donor).status, "ready")
        self.assertEqual(PiControl.objects.get(session=blocked, command="reclaim_stopped").status, "failed")
        self.assertEqual(PiControl.objects.get(session=donor, command="reclaim_stopped").status, "completed")

    def test_session_limit_on_create_stops_candidate_scan_on_unknown_and_never_touches_the_next_one(self):
        """The oldest candidate's reclaim apply gets an uncertain transport
        result (pi_reclaim_unknown). create-retry must not route around that
        by moving on to the second, genuinely reclaimable candidate: it
        propagates the original SessionLimitRejected untouched, and the
        second candidate's session is never contacted at all.
        """
        unknown_candidate, op_a, adm_a, exp_a, shell_a, state_a = self.stopped_shell(idle_hours=96)
        second_candidate, op_b, adm_b, exp_b, shell_b, state_b = self.stopped_shell(idle_hours=48)
        new_session_id = self.session()
        self.prompt(new_session_id, clientRequestId="prompt-needs-capacity-unknown")
        new_op = pi_worker.claim()
        fixtures = {unknown_candidate.id: (op_a, adm_a, exp_a, shell_a, state_a),
            second_candidate.id: (op_b, adm_b, exp_b, shell_b, state_b)}
        create_calls = []
        reclaim_calls = []

        def runner(request):
            sid = request["conversationId"]
            if sid in fixtures:
                reclaim_calls.append(sid)
                if sid == unknown_candidate.id:
                    operation, admission, expected, shell, state = fixtures[sid]
                    args = request["payload"]
                    if args["action"] == "state":
                        return {"workspace": state}
                    # The control (apply) step fails with a non-AiError, raw
                    # transport exception -- exactly what makes
                    # reclaim_stopped mark this pi_reclaim_unknown.
                    raise ConnectionError("synthetic transport failure")
                return self.reclaim_runner(fixtures)(request)
            self.assertEqual(sid, new_session_id)
            self.assertEqual(request["command"], "create")
            create_calls.append(request)
            raise pi_transport.SessionLimitRejected()
        with patch.object(pi_transport, "command", side_effect=runner):
            with self.assertRaises(pi_transport.SessionLimitRejected):
                pi_worker._create_with_reclaim_retry(new_op, {"admission": pi_native.admission(new_op)})
        self.assertNotIn(second_candidate.id, reclaim_calls)
        self.assertEqual(len(create_calls), 1)
        dispatches = list(PiDispatch.objects.filter(operation=new_op, kind="runner:create").values_list("request_id", "status", "error_code"))
        self.assertEqual(dispatches, [("create", "completed", "pi_session_limit")])
        control = PiControl.objects.get(session=unknown_candidate, command="reclaim_stopped")
        self.assertEqual((control.status, control.error_code), ("unknown", "pi_reclaim_unknown"))
        self.assertFalse(PiControl.objects.filter(session=second_candidate, command="reclaim_stopped").exists())

    def test_session_limit_on_create_with_no_candidate_fails_original_way_with_one_dispatch(self):
        new_session_id = self.session()
        self.prompt(new_session_id, clientRequestId="prompt-no-capacity")
        new_op = pi_worker.claim()
        create_calls = []

        def runner(request):
            create_calls.append(request)
            raise pi_transport.SessionLimitRejected()
        with patch.object(pi_transport, "command", side_effect=runner):
            with self.assertRaises(pi_transport.SessionLimitRejected):
                pi_worker._create_with_reclaim_retry(new_op, {"admission": pi_native.admission(new_op)})
        self.assertEqual(len(create_calls), 1)
        dispatches = list(PiDispatch.objects.filter(operation=new_op, kind="runner:create").values_list("request_id", "status", "error_code"))
        self.assertEqual(dispatches, [("create", "completed", "pi_session_limit")])
        self.assertTrue(pi_worker.fail_before_prompt(new_op, pi_transport.SessionLimitRejected()))
        new_op.refresh_from_db()
        self.assertEqual((new_op.status, new_op.error_code), ("failed", "pi_session_limit"))

    def test_retry_still_at_capacity_fails_with_exactly_two_create_dispatches(self):
        donor, donor_op, donor_adm, donor_exp, donor_shell, donor_state = self.stopped_shell(idle_hours=48)
        new_session_id = self.session()
        self.prompt(new_session_id, clientRequestId="prompt-still-full")
        new_op = pi_worker.claim()
        fixtures = {donor.id: (donor_op, donor_adm, donor_exp, donor_shell, donor_state)}
        create_calls = []

        def runner(request):
            if request["conversationId"] == donor.id:
                return self.reclaim_runner(fixtures)(request)
            create_calls.append(request)
            raise pi_transport.SessionLimitRejected()
        with patch.object(pi_transport, "command", side_effect=runner):
            with self.assertRaises(pi_transport.SessionLimitRejected):
                pi_worker._create_with_reclaim_retry(new_op, {"admission": pi_native.admission(new_op)})
        self.assertEqual(len(create_calls), 2)
        dispatches = list(PiDispatch.objects.filter(operation=new_op, kind="runner:create").order_by("created_at").values_list("request_id", "status", "error_code"))
        self.assertEqual(dispatches, [("create", "completed", "pi_session_limit"), ("create:after-reclaim", "completed", "pi_session_limit")])
        self.assertTrue(pi_worker.fail_before_prompt(new_op, pi_transport.SessionLimitRejected()))
        new_op.refresh_from_db()
        self.assertEqual((new_op.status, new_op.error_code), ("failed", "pi_session_limit"))
        self.assertEqual(PiWorkspace.objects.get(session=donor).status, "ready")

    def test_uninitialized_workspace_fixture_is_a_real_candidate(self):
        """Sanity check on the fixture itself: a chat-only session (never
        touched the workspace panel/control path) is picked up by the sweep's
        pre-filter and successfully reclaimed through the real eligible()
        checks, exactly like a "ready" one. Covers requirement 4's first
        bullet (uninitialized session selected by the sweep and reclaimed).
        """
        session, operation, admission, expected, shell, state = self.uninitialized_stopped_shell(idle_hours=72)
        candidates = pi_workspace.idle_reclaim_candidates(
            idle_since=timezone.now() - timedelta(hours=1), scan_limit=4)
        self.assertIn(session.id, [c.id for c in candidates])
        fixtures = {session.id: (operation, admission, expected, shell, state)}
        with patch.object(pi_transport, "command", side_effect=self.reclaim_runner(fixtures)):
            reclaimed = pi_workspace.auto_reclaim_idle(idle_seconds=24 * 3600, limit=4)
        self.assertEqual(reclaimed, 1)
        self.assertEqual(PiWorkspace.objects.get(session=session).status, "ready")
        self.assertEqual(PiControl.objects.get(session=session, command="reclaim_stopped").status, "completed")

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-uninitialized-donor-cache-key-0123456"})
    def test_full_capacity_reclaims_uninitialized_donor_and_retries_create(self):
        """The on-demand create-retry path (_create_with_reclaim_retry) must
        treat an "uninitialized" donor exactly like a "ready" one: reclaim it
        and retry create exactly once. Covers requirement 4's second bullet.
        """
        donor, donor_op, donor_adm, donor_exp, donor_shell, donor_state = self.uninitialized_stopped_shell(idle_hours=48)
        new_session_id = self.session()
        self.prompt(new_session_id, clientRequestId="prompt-needs-capacity-uninitialized-donor")
        new_op = pi_worker.claim()
        fixtures = {donor.id: (donor_op, donor_adm, donor_exp, donor_shell, donor_state)}
        create_calls = []

        def runner(request):
            if request["conversationId"] == donor.id:
                return self.reclaim_runner(fixtures)(request)
            self.assertEqual(request["conversationId"], new_session_id)
            self.assertEqual(request["command"], "create")
            create_calls.append(request)
            if len(create_calls) == 1:
                raise pi_transport.SessionLimitRejected()
            return {**pi_worker.identity(new_op), "status": "accepted", "state": {}}
        with patch.object(pi_transport, "command", side_effect=runner):
            result = pi_worker._create_with_reclaim_retry(new_op, {"admission": pi_native.admission(new_op)})
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(len(create_calls), 2)
        dispatches = list(PiDispatch.objects.filter(operation=new_op, kind="runner:create").order_by("created_at").values_list("request_id", "status", "error_code"))
        self.assertEqual(dispatches, [("create", "completed", "pi_session_limit"), ("create:after-reclaim", "completed", "")])
        self.assertEqual(PiWorkspace.objects.get(session=donor).status, "ready")

    def test_frozen_or_unknown_workspace_still_rejected_even_when_otherwise_idle(self):
        """"frozen" and "unknown" must stay excluded by eligible() regardless
        of the "uninitialized" relaxation -- they are not in the relaxed set
        and eligible() must still raise pi_reclaim_workspace_unverified for
        both. Uses a "ready" fixture (stopped_shell) and overwrites
        workspace.status after the fact so the Runner-side shell truly is an
        ordinary stopped one; the rejection must come from Django's own
        eligible() check, not from the Runner observation step.
        """
        for status in ("frozen", "unknown"):
            with self.subTest(status=status):
                session, operation, admission, expected, shell, state = self.stopped_shell(idle_hours=72)
                PiWorkspace.objects.filter(session=session).update(status=status)
                principal = pi_workspace._reclaim_principal(PiSession.objects.get(pk=session.id))
                with patch.object(pi_transport, "command", side_effect=self.reclaim_runner({session.id: (operation, admission, expected, shell, state)})):
                    with self.assertRaises(AiError) as caught:
                        pi_workspace.reclaim_stopped(session.id, principal)
                self.assertEqual(caught.exception.code, "pi_reclaim_workspace_unverified")

    def test_uninitialized_with_nonterminal_operation_still_rejected(self):
        """An "uninitialized" session with a non-terminal (still "running")
        operation in its current generation must still be rejected by
        eligible()'s own operations.exclude(...).exists() check -- the
        "uninitialized" relaxation only widens the workspace.status test, it
        must not bypass every other condition eligible() already enforces.
        """
        session, operation, admission, expected, shell, state = self.uninitialized_stopped_shell(idle_hours=72)
        with mutation():
            PiOperation.objects.filter(pk=operation.pk).update(status="running")
            PiSession.objects.filter(pk=session.id).update(status="idle", active_operation_id="")
        principal = pi_workspace._reclaim_principal(PiSession.objects.get(pk=session.id))
        with patch.object(pi_transport, "command", side_effect=self.reclaim_runner({session.id: (operation, admission, expected, shell, state)})):
            with self.assertRaises(AiError) as caught:
                pi_workspace.reclaim_stopped(session.id, principal)
        self.assertEqual(caught.exception.code, "pi_reclaim_workspace_unverified")

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-next-prompt-after-reclaim-key-012345"})
    def test_reclaimed_uninitialized_session_sends_next_prompt_through_runner_create(self):
        """After a successful reclaim of a chat-only ("uninitialized") donor,
        the session must not be left in a stuck "needs init but no container"
        state. The next prompt on that same session must reach perform() and
        dispatch a real "create" request to the Runner (which reconstructs
        on the retained volume via its own ledger -- pi_runner/server.py's
        create()/start_stopped -- independent of Django's workspace.status),
        and the operation must complete normally, not get stuck in "queued"
        or "running".
        """
        session, operation, admission, expected, shell, state = self.uninitialized_stopped_shell(idle_hours=48)
        fixtures = {session.id: (operation, admission, expected, shell, state)}
        with patch.object(pi_transport, "command", side_effect=self.reclaim_runner(fixtures)):
            self.assertTrue(pi_workspace.reclaim_one_idle_session(session.id))
        self.assertEqual(PiWorkspace.objects.get(session=session).status, "ready")

        self.prompt(session.id, clientRequestId="after-reclaim-prompt")
        next_op = pi_worker.claim()
        self.assertEqual(next_op.session_id, session.id)
        create_requests = []

        # runner_event_seq is a per-session counter, not per-operation: the
        # chat-only fixture above already advanced it to 1 with its own
        # eventSeq=1 settle event, so this run's own terminal event must use
        # the next sequence number or ingest() silently drops it as already
        # seen (pi_worker.ingest, "seq <= session.runner_event_seq: continue")
        # and settled never becomes True.
        next_event_seq = PiSession.objects.get(pk=session.id).runner_event_seq + 1

        def runner(request):
            if request["command"] == "create":
                create_requests.append(request)
                return {"status": "idle", "state": {"commands": []}}
            self.assertEqual(request["command"], "prompt")
            return {"status": "settled", "filesCollected": True, "files": [],
                "events": [{**pi_worker.identity(next_op), "eventSeq": next_event_seq, "type": "agent_settled"}],
                "terminalReceipt": {"operationId": next_op.id, "status": "settled", "eventSeq": next_event_seq, "files": []}}
        with patch.object(pi_worker, "heartbeat"), patch.object(pi_transport, "command", side_effect=runner):
            pi_worker.perform(next_op)
        self.assertEqual(len(create_requests), 1)
        next_op.refresh_from_db()
        self.assertEqual(next_op.status, "succeeded")
        self.assertEqual(PiSession.objects.get(pk=session.id).status, "idle")

