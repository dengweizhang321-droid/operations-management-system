"""Diagnosability of pi_workspace.control's wide `except Exception`.

The wide catch is intentional: `unknown` is a resend fence, so anything
unexpected after the request leaves must keep blocking an automatic resend.
These tests pin the logging that tells a programming error apart from a
genuine "result unknown", and -- more importantly -- pin that the fence
itself still fires for real unknowns.
"""
from unittest.mock import patch

from django.test import override_settings

import secrets

from django.test import TestCase

from . import pi_native, pi_service as service, pi_workspace as workspace, pi_worker as worker
from .pi_models import PiControl, PiSession, PiWorkspace
from .policy import AiError, mutation
from . import tests as domain


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiWorkspaceControlDiagnosticsTests(TestCase):
    """Fixtures are copied, not inherited: subclassing PiRuntimeTests would
    re-run its whole suite inside this file (test_pi_worker_stop_clear_queue.py
    uses the same pattern for the same reason)."""

    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call

    def session(self, actor=None, **kwargs):
        return service.create_session({"clientRequestId": secrets.token_hex(8), **kwargs},
            actor or self.owner)["session"]["id"]

    def prompt(self, session_id=None, actor=None, **kwargs):
        return service.prompt(session_id or self.session(actor),
            {"clientRequestId": "prompt-1", "message": "合成问题", **kwargs}, actor or self.owner)

    def ready(self, *, active=False):
        result = self.prompt()
        operation = worker.claim()
        if not active:
            workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation, status="ready",
                model_id=self.model.id, model_version=self.model.version)
        return operation

    def send(self, session_id, command, payload=None, key="control-1", actor=None):
        return workspace.control(session_id, {"clientRequestId": key, "command": command,
            "payload": payload or {}}, actor or self.owner)

    def good_receipt(self, request):
        value = request["payload"]
        return {**request, "control": {"controlId": value["controlId"], "controlSeq": value["controlSeq"],
            "status": "completed", "result": {"ok": True}}, "workspace": {"terminals": [], "pendingUi": []}}

    # --- the programming-error half: it must now be diagnosable -------------

    def test_internal_key_error_is_logged_with_traceback_and_control_identity(self):
        """A KeyError against our own structures must leave a traceback behind.

        Without the logging this surfaces only as 503 pi_control_unknown with
        no indication that the real fault was a missing dict key in our code.
        """
        op = self.ready(active=True)
        with patch.object(workspace.pi_transport, "command", side_effect=KeyError("action")):
            with self.assertLogs("ai_assistant.pi_workspace", level="ERROR") as logs:
                with self.assertRaises(AiError) as failure:
                    self.send(op.session_id, "steer", {"message": "触发内部错误"})
        self.assertEqual(failure.exception.code, "pi_control_unknown")
        self.assertEqual(len(logs.records), 1)
        record = logs.records[0]
        # logger.exception, not warning: level and traceback both matter.
        self.assertEqual(record.levelname, "ERROR")
        self.assertIsNotNone(record.exc_info)
        self.assertIs(record.exc_info[0], KeyError)
        message = record.getMessage()
        self.assertIn("errorType=KeyError", message)
        self.assertIn("command=steer", message)
        self.assertIn(op.session_id, message)
        self.assertIn(PiControl.objects.get(command="steer").id, message)
        self.assertIn("runnerSent=True", message)

    def test_internal_type_error_before_send_is_logged_and_marked_failed_not_unknown(self):
        """A local TypeError before the request leaves is logged and fenced as `failed`.

        pi_native.model_binding (pi_workspace.py:651) runs inside the try but
        before runner_sent is set, so this is the pre-send half: the log must
        appear, and `runnerSent=False` must keep the row out of `unknown` so
        the workspace stays usable rather than needing a manual reset.
        """
        op = self.ready(active=True)
        with patch.object(pi_native, "model_binding", side_effect=TypeError("bad binding")):
            with patch.object(workspace.pi_transport, "command", side_effect=self.good_receipt) as sent:
                with self.assertLogs("ai_assistant.pi_workspace", level="ERROR") as logs:
                    with self.assertRaises(AiError):
                        self.send(op.session_id, "model_set", {"modelId": self.model.id})
        self.assertEqual(sent.call_count, 0)
        record = logs.records[0]
        self.assertEqual(record.levelname, "ERROR")
        self.assertIs(record.exc_info[0], TypeError)
        self.assertIn("errorType=TypeError", record.getMessage())
        self.assertIn("runnerSent=False", record.getMessage())
        row = PiControl.objects.get(command="model_set")
        self.assertEqual(row.status, "failed")
        self.assertEqual(PiWorkspace.objects.get(session_id=op.session_id).status, "ready")

    # --- the safety-fence half: this is the regression that matters ---------

    def test_genuine_runner_unknown_still_fences_as_unknown_and_503(self):
        """REGRESSION: a real "result unknown" must keep the resend fence.

        pi_transport converts transport failure into AiError pi_runner_unknown
        (pi_transport.py:79-80). The request may have reached the Runner, so
        the control must go `unknown`, the workspace must go `unknown`, and a
        later control must be refused -- no automatic resend. If a fix ever
        narrows the catch so this escapes, this test is what breaks.
        """
        op = self.ready(active=True)
        with patch.object(workspace.pi_transport, "command",
                side_effect=AiError("PiRunner 响应未知，禁止重发", "pi_runner_unknown", 503)):
            with self.assertRaises(AiError) as failure:
                self.send(op.session_id, "steer", {"message": "结果不明"})
        self.assertEqual(failure.exception.status, 503)
        row = PiControl.objects.get(command="steer")
        self.assertEqual(row.status, "unknown")
        self.assertEqual(row.error_code, "pi_runner_unknown")
        self.assertEqual(PiWorkspace.objects.get(session_id=op.session_id).status, "unknown")
        # The fence is observable: the next control is refused, not resent.
        with patch.object(workspace.pi_transport, "command", side_effect=self.good_receipt) as resend:
            with self.assertRaises(AiError) as blocked:
                self.send(op.session_id, "steer", {"message": "不得重发"}, key="control-2")
        self.assertEqual(blocked.exception.code, "pi_control_unknown")
        self.assertEqual(resend.call_count, 0)

    def test_genuine_unknown_emits_no_programming_error_log(self):
        """An AiError unknown is an expected outcome, not a code fault.

        Keeps the new logging from turning every transport blip into an
        ERROR-with-traceback, which would bury the real programming errors.
        """
        op = self.ready(active=True)
        with patch.object(workspace.pi_transport, "command",
                side_effect=AiError("PiRunner 响应未知，禁止重发", "pi_runner_unknown", 503)):
            with patch.object(workspace.logger, "exception") as logged:
                with self.assertRaises(AiError):
                    self.send(op.session_id, "steer", {"message": "结果不明"})
        self.assertEqual(logged.call_count, 0)
        self.assertEqual(PiControl.objects.get(command="steer").status, "unknown")

    def test_coded_non_ai_error_is_a_deliberate_failure_and_is_not_logged(self):
        """A coded non-AiError is deliberate too, so it must stay quiet.

        pi_research.ResearchError is a ValueError carrying `.code`
        (pi_research.py:36-39), and the fence below reads that code. Keying the
        log on `not isinstance(error, AiError)` would make every research
        network failure an ERROR-with-traceback; the predicate is a missing
        `code`, which only programming errors have.
        """
        session = self.session()
        from .pi_research import ResearchError
        with patch("ai_assistant.pi_research.execute_public_research",
                side_effect=ResearchError("network_failed")):
            with patch.object(workspace.logger, "exception") as logged:
                with self.assertRaises(AiError):
                    self.send(session, "research_search", {"query": "公开资料"})
        self.assertEqual(logged.call_count, 0)
        self.assertEqual(PiControl.objects.get().status, "failed")
