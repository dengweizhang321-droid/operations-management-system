"""Regression test: a non-AiError failure clearing the native queue on stop
must not skip abort. See pi_worker.py perform(), the cancel_requested branch
that clears the runner queue before sending abort.

Kept in its own file (not test_pi_runtime.py) to avoid overlapping other
in-flight branches that touch that file.
"""
import hashlib
import secrets
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from . import pi_service as service, pi_worker as worker
from .pi_models import PiOperation
from .policy import mutation
from . import tests as domain


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiWorkerStopClearQueueTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call

    def session(self, actor=None, **kwargs):
        return service.create_session({"clientRequestId": secrets.token_hex(8), **kwargs}, actor or self.owner)["session"]["id"]

    def prompt(self, session_id=None, actor=None, **kwargs):
        return service.prompt(session_id or self.session(actor), {"clientRequestId": "prompt-1", "message": "合成问题", **kwargs}, actor or self.owner)

    def running(self, **kwargs):
        result = self.prompt(**kwargs)
        op = worker.claim()
        token = "isolated-capability-" + "x" * 48
        with mutation():
            op.capability_hash = hashlib.sha256(token.encode()).hexdigest()
            op.capability_expires_at = timezone.now() + timedelta(hours=1)
            op.save()
        return op, token

    def request(self, op, token, **kwargs):
        return {**worker.identity(op), "kind": "model", "requestId": "gateway-1", "capability": token,
            "messages": [{"role": "user", "content": "合成测试"}], "tools": [], **kwargs}

    def _run_with_clear_queue_failure(self, exception):
        """Shared driver: clear_queue raises `exception`, abort must still run."""
        op, token = self.running()
        commands = []

        def runner(operation, command, payload, **kwargs):
            commands.append(command)
            if command == "create":
                return {"status": "idle", "state": {"commands": []}}
            if command == "prompt":
                service.abort(op.session_id, {"clientRequestId": "stop-before-clear-queue"}, self.owner)
                return {"status": "running", "state": {"pendingGatewayRequests": []}}
            if command == "workspace" and payload.get("command") == "clear_queue":
                raise exception
            self.assertEqual(command, "abort")
            return {"status": "aborted", "events": [{**worker.identity(op), "eventSeq": 1, "type": "agent_settled"}],
                "files": [], "filesCollected": True,
                "terminalReceipt": {"operationId": op.id, "status": "aborted", "eventSeq": 1, "files": []}}

        with patch.object(worker, "heartbeat"), \
             patch.object(worker, "runner_dispatch", side_effect=runner), \
             patch.object(worker, "bridge") as bridge, \
             patch("ai_assistant.pi_transport.command", return_value={}) as transport:
            worker.perform(op)
        return op, commands, bridge, transport

    def test_clear_queue_runtime_error_does_not_block_abort(self):
        """A non-AiError (RuntimeError) from the clear_queue dispatch must still
        let abort run, landing the operation in `canceled`, not `unknown`."""
        op, commands, bridge, transport = self._run_with_clear_queue_failure(RuntimeError("synthetic native queue failure"))
        self.assertEqual(commands, ["create", "prompt", "workspace", "abort"])
        self.assertFalse(bridge.called)
        self.assertEqual(transport.call_args.args[0]["command"], "ack")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceled")

    def test_clear_queue_runtime_error_is_logged_not_silent(self):
        """The swallowed failure must leave a trace instead of vanishing."""
        with self.assertLogs("ai_assistant.pi_worker", level="ERROR") as captured:
            op, commands, _, _ = self._run_with_clear_queue_failure(RuntimeError("synthetic native queue failure"))
        self.assertEqual(commands, ["create", "prompt", "workspace", "abort"])
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceled")
        self.assertTrue(any("stop-clear-queue" in message for message in captured.output))

    def test_clear_queue_ai_error_still_does_not_block_abort(self):
        """Pre-existing behavior (AiError) must be unchanged by the widened except."""
        from .policy import AiError
        op, commands, bridge, transport = self._run_with_clear_queue_failure(AiError("合成清空失败", "pi_cleanup_unknown", 503))
        self.assertEqual(commands, ["create", "prompt", "workspace", "abort"])
        self.assertFalse(bridge.called)
        self.assertEqual(transport.call_args.args[0]["command"], "ack")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceled")

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-path-a-stop-clear-queue-test-key-123456789"})
    def test_clear_queue_db_connection_loss_through_real_dispatch_does_not_block_abort(self):
        """Path A, undoubled: the failure is injected into `pi_workspace._workspace`
        itself (inside the `with mutation():` block that precedes the clear_queue
        dispatch), not into `runner_dispatch`. `runner_dispatch` and `freeze` run
        for real here -- only the native transport (`pi_transport.command`) is
        mocked -- so this exercises the actual DB-failure branch the except is
        for, not the `runner_dispatch`-raises branch covered by the other tests
        in this file (which is a different, already-unreachable-by-this-except
        branch; see pi_worker.py's updated comment at the `except Exception:`)."""
        from django.db.utils import OperationalError
        from . import pi_workspace

        op, token = self.running()
        commands = []

        def transport(request, **kwargs):
            command = request["command"]
            commands.append(command)
            if command == "create":
                return {"status": "idle", "state": {"commands": []}}
            if command == "prompt":
                service.abort(op.session_id, {"clientRequestId": "stop-before-clear-queue"}, self.owner)
                return {"status": "running", "state": {"pendingGatewayRequests": []}}
            if command == "ack":
                return {}
            self.assertEqual(command, "abort")
            return {"status": "aborted", "events": [{**worker.identity(op), "eventSeq": 1, "type": "agent_settled"}],
                "files": [], "filesCollected": True,
                "terminalReceipt": {"operationId": op.id, "status": "aborted", "eventSeq": 1, "files": []}}

        with patch.object(worker, "heartbeat"), \
             patch.object(worker, "bridge") as bridge, \
             patch.object(pi_workspace, "_workspace", side_effect=OperationalError("synthetic connection loss")), \
             patch("ai_assistant.pi_transport.command", side_effect=transport) as transport_mock:
            worker.perform(op)

        # The clear_queue "workspace" dispatch never reaches runner_dispatch:
        # _workspace() raises inside the mutation() block that builds its
        # payload, before runner_dispatch("workspace", ...) is called.
        self.assertEqual(commands, ["create", "prompt", "abort", "ack"])
        self.assertFalse(bridge.called)
        self.assertEqual(transport_mock.call_args.args[0]["command"], "ack")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceled")
