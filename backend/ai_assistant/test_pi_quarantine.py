"""pi_quarantine_session: observe-only inspection plus one-shot irreversible
freeze+dispose-queue for one idle, independent Pi session. All Runner/Docker
boundaries are synthetic; dispose_environment is only driven through a mocked
pi_transport.command.
"""
from unittest.mock import patch

from django.test import override_settings

from . import test_pi_runtime as runtime_tests
from . import pi_native, pi_service as service, pi_worker as worker, pi_workspace as workspace
from .pi_models import (PiAgent, PiControl, PiDispatch, PiEvent, PiExport, PiOperation,
    PiSession, PiUiRequest, PiWorkspace)
from .policy import AiError, mutation


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiQuarantineTests(runtime_tests.PiRuntimeTests):

    def idle(self, **kwargs):
        """One session with exactly one terminal (succeeded) operation, idle."""
        result = self.prompt(**kwargs)
        session_id = result["session"]["id"]
        op_id = result["operation"]["id"]
        with mutation():
            PiOperation.objects.filter(id=op_id).update(status="succeeded")
            PiSession.objects.filter(pk=session_id).update(status="idle", active_operation_id="")
        return session_id, op_id

    def row_counts(self):
        from .pi_models import PI_MODELS
        return {m.__name__: m.objects.count() for m in PI_MODELS}

    # -- observation never writes -------------------------------------------------

    def test_observation_never_writes_any_row_even_for_uninitialized_workspace(self):
        session_id, _ = self.idle()
        self.assertFalse(PiWorkspace.objects.filter(session_id=session_id).exists())
        before = self.row_counts()
        result = workspace.quarantine_observation(session_id, self.owner)
        after = self.row_counts()
        self.assertEqual(before, after)
        self.assertFalse(PiWorkspace.objects.filter(session_id=session_id).exists())
        self.assertTrue(result["eligible"])
        self.assertIsNone(result["blockReason"])
        self.assertEqual(result["status"], "idle")
        # prompt() already materializes this session as the (childless) root
        # of its own agent tree via pi_native.state_for(); that alone does not
        # block quarantine -- only a *child* agent or a tree with other
        # members does (see the dedicated child/tree-not-alone tests below).
        self.assertTrue(result["isAgentTreeMember"])
        self.assertFalse(result["isChildAgent"])
        self.assertEqual(result["agentTreeMemberCount"], 1)
        self.assertIsNone(result["freezeDispatch"])

    def test_observation_on_non_idle_session_is_read_only_and_ineligible(self):
        session_id = self.session()
        self.prompt(session_id)
        before = self.row_counts()
        result = workspace.quarantine_observation(session_id, self.owner)
        after = self.row_counts()
        self.assertEqual(before, after)
        self.assertFalse(result["eligible"])
        self.assertEqual(result["blockReason"], "pi_quarantine_not_idle")

    # -- happy path ----------------------------------------------------------------

    def test_idle_independent_session_quarantine_freezes_and_queues_one_freeze_dispatch(self):
        session_id, op_id = self.idle()
        result = workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertFalse(result["replayed"])
        self.assertEqual(result["session"]["status"], "frozen")
        self.assertEqual(result["session"]["title"], "已隔离会话")
        self.assertEqual(result["freezeDispatch"]["status"], "prepared")
        session = PiSession.objects.get(pk=session_id)
        self.assertEqual(session.status, "frozen")
        dispatches = PiDispatch.objects.filter(operation_id=op_id, kind="control:freeze")
        self.assertEqual(dispatches.count(), 1)
        self.assertEqual(dispatches.first().status, "prepared")
        events = PiEvent.objects.filter(session=session, event_type="environment_frozen")
        self.assertEqual(events.count(), 1)
        import json
        data = json.loads(events.first().data_json)
        self.assertEqual(data["reason"], "maintenance_quarantine")
        self.assertEqual(data["requestId"], "maint-1")

    def test_queued_freeze_dispatch_is_then_disposed_by_the_existing_worker_path(self):
        session_id, op_id = self.idle()
        workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        operation = PiOperation.objects.get(pk=op_id)
        from . import pi_transport
        with patch.object(pi_transport, "command", return_value={"status": "disposed"}) as mocked:
            worker.dispose_environment(operation)
        self.assertEqual(mocked.call_count, 1)
        self.assertEqual(mocked.call_args[0][0]["command"], "dispose")
        dispatch = PiDispatch.objects.get(operation_id=op_id, kind="control:freeze")
        self.assertEqual(dispatch.status, "completed")

    # -- idempotency -----------------------------------------------------------

    def test_same_request_id_replays_without_a_second_event_or_dispatch(self):
        session_id, op_id = self.idle()
        first = workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        second = workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertFalse(first["replayed"])
        self.assertTrue(second["replayed"])
        self.assertEqual(first["session"], second["session"])
        self.assertEqual(PiEvent.objects.filter(session_id=session_id, event_type="environment_frozen").count(), 1)
        self.assertEqual(PiDispatch.objects.filter(operation_id=op_id, kind="control:freeze").count(), 1)

    def test_different_request_id_on_already_frozen_session_is_audited_but_not_reapplied(self):
        session_id, op_id = self.idle()
        workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        result = workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-2")
        self.assertFalse(result["replayed"])
        self.assertEqual(result["session"]["status"], "frozen")
        self.assertEqual(PiEvent.objects.filter(session_id=session_id, event_type="environment_frozen").count(), 2)
        self.assertEqual(PiDispatch.objects.filter(operation_id=op_id, kind="control:freeze").count(), 1)

    # -- rejections (each must not mutate anything) -----------------------------

    def test_non_idle_session_is_rejected_without_mutation(self):
        session_id = self.session()
        self.prompt(session_id)
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_not_idle")
        self.assertEqual(before, self.row_counts())

    def test_active_operation_id_set_is_rejected_even_if_session_status_is_idle(self):
        session_id, op_id = self.idle()
        with mutation():
            PiSession.objects.filter(pk=session_id).update(active_operation_id=op_id)
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_active_operation")
        self.assertEqual(before, self.row_counts())

    def test_non_terminal_operation_in_current_generation_is_rejected(self):
        session_id, op_id = self.idle()
        with mutation():
            PiOperation.objects.filter(id=op_id).update(status="unknown")
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_operation_not_terminal")
        self.assertEqual(before, self.row_counts())

    def test_pending_control_blocks_quarantine(self):
        session_id, op_id = self.idle()
        session = PiSession.objects.get(pk=session_id)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation, status="ready")
            PiControl.objects.create(id="pi-control-pending", session=session, operation_id=op_id,
                client_request_id="ctl-1", request_digest="d", epoch=session.epoch, generation=session.generation,
                control_seq=1, command="tree", status="sent")
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_control_unresolved")
        self.assertEqual(before, self.row_counts())

    def test_pending_export_blocks_quarantine(self):
        session_id, op_id = self.idle()
        with mutation():
            PiExport.objects.create(id="pi-export-pending", operation_id=op_id, request_digest="d",
                status="running", query_json="{}")
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_export_active")
        self.assertEqual(before, self.row_counts())

    def test_pending_ui_request_blocks_quarantine(self):
        session_id, op_id = self.idle()
        with mutation():
            PiUiRequest.objects.create(id="pi-ui-pending", session_id=session_id, operation_id=op_id,
                generation=1, runner_request_id="r1", request_json="{}", status="pending")
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_ui_pending")
        self.assertEqual(before, self.row_counts())

    def test_child_agent_cannot_be_individually_quarantined(self):
        # self.idle() already made session_id the (childless) root of its own
        # tree via prompt()'s state_for() call; re-point its PiAgent row at a
        # different root/parent to simulate it being a genuine child instead.
        session_id, op_id = self.idle()
        root_id, _ = self.idle()
        with mutation():
            PiAgent.objects.filter(session_id=session_id).update(root_session_id=root_id, parent_session_id=root_id, parent_operation_id=op_id)
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_child_agent")
        self.assertEqual(before, self.row_counts())

    def test_root_session_with_other_tree_members_cannot_be_individually_quarantined(self):
        session_id, op_id = self.idle()
        child_id, child_op_id = self.idle()
        with mutation():
            PiAgent.objects.filter(session_id=child_id).update(root_session_id=session_id, parent_session_id=session_id, parent_operation_id=op_id)
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_tree_not_alone")
        self.assertEqual(before, self.row_counts())

    def test_unknown_freeze_dispatch_blocks_and_is_never_resent(self):
        session_id, op_id = self.idle()
        with mutation():
            PiDispatch.objects.create(id="pi-freeze-unknown", operation_id=op_id, kind="control:freeze",
                request_id="dispose", request_digest="d", status="unknown")
        before = self.row_counts()
        with self.assertRaises(AiError) as failure:
            workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertEqual(failure.exception.code, "pi_quarantine_freeze_unknown")
        self.assertEqual(before, self.row_counts())

    def test_completed_freeze_dispatch_on_latest_operation_is_not_requeued(self):
        session_id, op_id = self.idle()
        with mutation():
            PiDispatch.objects.create(id="pi-freeze-done", operation_id=op_id, kind="control:freeze",
                request_id="dispose", request_digest="d", status="completed")
        result = workspace.pi_quarantine_session(session_id, self.owner, request_id="maint-1")
        self.assertFalse(result["replayed"])
        self.assertEqual(result["session"]["status"], "frozen")
        self.assertEqual(PiDispatch.objects.filter(operation_id=op_id, kind="control:freeze").count(), 1)
        self.assertEqual(PiDispatch.objects.get(operation_id=op_id, kind="control:freeze").status, "completed")

    # -- _freeze's original permission-change caller keeps its own reason -------

    def test_permission_change_freeze_path_still_records_permission_changed_reason(self):
        # _freeze's original caller: a stored session.actor_role that no
        # longer matches the principal's current role (get_session's own
        # role/scope mismatch branch, not the earlier current_principal
        # AppUser lookup, which is a different, unrelated 403).
        session_id, _ = self.idle()
        with mutation():
            PiSession.objects.filter(pk=session_id).update(actor_role="operator")
        session = service.get_session(session_id, self.owner)
        self.assertEqual(session.status, "frozen")
        import json
        event = PiEvent.objects.get(session_id=session_id, event_type="environment_frozen")
        data = json.loads(event.data_json)
        self.assertEqual(data["reason"], "permission_changed")
        self.assertNotIn("requestId", data)
