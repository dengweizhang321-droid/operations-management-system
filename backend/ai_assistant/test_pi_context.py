"""Isolated recovery/control evidence checks; no provider or Runner effects."""
import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import pi_context, pi_workspace as workspace, pi_native, pi_service as service, pi_worker as worker
from .pi_models import PiControl, PiDispatch, PiOperation, PiSession, PiWorkspace, PiAgent
from .policy import AiError, canonical, mutation
from . import test_pi_workspace as fixtures


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class RecoveryTests(TestCase):
    setUp = fixtures.PiWorkspaceTests.setUp
    user = fixtures.PiWorkspaceTests.user
    session = fixtures.PiWorkspaceTests.session
    prompt = fixtures.PiWorkspaceTests.prompt
    ready = fixtures.PiWorkspaceTests.ready
    send = fixtures.PiWorkspaceTests.send
    runner = fixtures.PiWorkspaceTests.runner
    call = fixtures.PiWorkspaceTests.call

    def test_normal_detail_is_bounded_evidence_and_does_not_send_or_write(self):
        op = self.ready()
        before = (PiControl.objects.count(), PiOperation.objects.count(), PiDispatch.objects.count())
        with patch.object(workspace.pi_transport, "command") as send:
            first = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
            again = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        self.assertFalse(send.called)
        self.assertEqual(first, again)
        self.assertIsNone(first["goal"])
        self.assertEqual(first["historicalGoal"]["operationId"], op.id)
        self.assertFalse(first["compaction"]["automatic"])
        self.assertIsNone(first["contextBudget"]["currentInputTokens"])
        self.assertEqual(before, (PiControl.objects.count(), PiOperation.objects.count(), PiDispatch.objects.count()))

    def test_compact_freezes_manifest_under_original_receipt_and_duplicate_never_resends(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command") as send:
            result = self.send(op.session_id, "compact", {"customInstructions": "保留中文修正"})
            again = self.send(op.session_id, "compact", {"customInstructions": "保留中文修正"})
        self.assertFalse(send.called)
        self.assertTrue(again["replayed"])
        self.assertEqual(again["control"]["id"], result["control"]["id"])
        control = PiControl.objects.get(pk=result["control"]["id"])
        snapshot = json.loads(control.operation.payload_json)["recovery"]
        self.assertEqual(snapshot["historicalGoal"]["operationId"], op.id)
        self.assertEqual(snapshot["binding"]["throughControlSeq"], 0)
        self.assertNotIn('"historicalGoal"', json.loads(control.payload_json)["customInstructions"])
        self.assertIn("保留中文修正", json.loads(control.payload_json)["customInstructions"])

    def test_original_unknown_dispatch_is_retained_and_blocks_new_compact(self):
        op = self.ready()
        with mutation():
            PiDispatch.objects.create(id="unknown-model", operation=op, kind="model", request_id="original",
                request_digest="synthetic", status="unknown", response_json=canonical({"providerFrame": "private"}))
        with patch.object(workspace.pi_transport, "command") as send:
            state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
            with self.assertRaises(AiError) as caught: self.send(op.session_id, "compact")
        self.assertEqual(caught.exception.code, "pi_compact_unsafe")
        self.assertEqual(state["unresolvedDispatches"]["items"][0]["dispatchId"], "unknown-model")
        self.assertNotIn("providerFrame", canonical(state))
        self.assertFalse(send.called)
        self.assertEqual(PiControl.objects.count(), 0)

    def test_user_decisions_are_verbatim_with_omission_and_original_control_ids(self):
        op = self.ready()
        with mutation():
            for i in range(pi_context.LIMIT+2):
                PiControl.objects.create(id=f"decision-{i}", session_id=op.session_id, operation=op,
                    client_request_id=f"decision-{i}", request_digest="synthetic", epoch=op.epoch,
                    generation=op.generation, control_seq=i+1, command="steer", status="completed",
                    payload_json=canonical({"message": "已确认修正"*1000}))
        state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        decisions = state["userDecisionsAndCorrections"]
        self.assertTrue(decisions["hasMore"])
        self.assertEqual(len(decisions["items"]), pi_context.LIMIT)
        self.assertTrue(decisions["items"][0]["evidence"]["truncated"])
        self.assertEqual(decisions["items"][0]["controlId"], f"decision-{pi_context.LIMIT+1}")
        self.assertLess(len(canonical(state).encode()), 96*1024)
        next_page = workspace.detail(op.session_id, {"recoveryBeforeControlSeq": str(decisions["nextBeforeControlSeq"])}, self.owner, poll=False)["recovery"]
        self.assertEqual(next_page["userDecisionsAndCorrections"]["items"][0]["controlSeq"], 2)
        source = workspace.detail(op.session_id, {"recoveryControlSeq": "1", "recoveryTextOffset": "1200"}, self.owner, poll=False)["recovery"]["sourceControl"]
        self.assertEqual(source["controlId"], "decision-0")
        self.assertEqual(source["offset"], 1200)
        self.assertIsNotNone(source["nextOffset"])

    def test_compaction_blocks_new_writers_until_original_terminal_receipt(self):
        op = self.ready()
        self.send(op.session_id, "compact")
        with patch.object(workspace.pi_transport, "command") as send:
            for command, payload in [("terminal_create", {}), ("export_html", {}), ("plan_save", {"plan": {"goal":"write", "constraints":[], "steps":[], "deliverables":[], "openQuestions":[]}})]:
                with self.assertRaises(AiError): self.send(op.session_id, command, payload, key="new-"+command)
        self.assertFalse(send.called)
        self.assertEqual(PiControl.objects.count(), 1)

    def test_frozen_generation_cannot_reveal_recovery_evidence(self):
        op = self.ready()
        with mutation(): PiSession.objects.filter(pk=op.session_id).update(status="frozen")
        state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        self.assertEqual(state, {"schemaVersion": "pi-recovery-v1", "status": "frozen", "available": False})

    def save_marker_plan(self, session_id, marker="old-plan-secret"):
        return self.send(session_id, "plan_save", {"plan": {"goal": marker, "constraints":[], "steps":[marker],
            "deliverables":[], "openQuestions":[]}}, key="save-plan")

    def http_workspace(self, session_id):
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner):
            response = self.call(f"/api/ai/pi/sessions/{session_id}/workspace", method="GET")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def assert_plan_absent_from_get_and_compact(self, session_id, marker="old-plan-secret"):
        visible = self.http_workspace(session_id)
        self.assertNotIn(marker, canonical(visible))
        compact = self.send(session_id, "compact", key="compact-after-rotation")
        control = PiControl.objects.get(pk=compact["control"]["id"])
        self.assertNotIn(marker, control.payload_json)
        self.assertNotIn(marker, control.operation.payload_json)

    def test_same_scope_reset_keeps_old_plan_out_of_real_get_and_compact(self):
        op = self.ready()
        self.save_marker_plan(op.session_id)
        self.assertIn("old-plan-secret", canonical(self.http_workspace(op.session_id)))
        with patch.object(worker, "dispose_environment"), patch.object(workspace, "_create_environment", return_value={"workspace":{"terminals":[], "pendingUi":[]}}):
            self.send(op.session_id, "reset", key="same-scope-reset")
        self.assert_plan_absent_from_get_and_compact(op.session_id)

    def test_scope_and_shop_rotation_keep_old_plan_out_of_real_get_and_compact(self):
        for changed in [{"scope":{"warehouses":[], "channels":[], "platforms":["京东"]}},
                {"shopSelection":{"platform":"京东", "shop":"新店"}}]:
            with self.subTest(changed=changed):
                if "shopSelection" in changed: self.owner = self.other
                op = self.ready()
                self.save_marker_plan(op.session_id)
                service.prompt(op.session_id, {"clientRequestId":"changed-selection", "message":"new goal", **changed}, self.owner)
                next_op = worker.claim(); workspace._finish_init(next_op)
                with mutation():
                    session = PiSession.objects.get(pk=op.session_id)
                    workspace.ingest(session, workspace._workspace(session), next_op, {"workspace":{"terminals":[], "pendingUi":[]}})
                self.assert_plan_absent_from_get_and_compact(op.session_id)
                workspace._finish_init(worker.claim())

    def test_role_rotation_keeps_old_plan_out_of_real_get_and_compact(self):
        from access_control.models import AppUser
        from sales.auth import Principal
        op = self.ready()
        self.save_marker_plan(op.session_id)
        AppUser.objects.filter(email=self.owner.email).update(role_id="operator")
        self.owner = Principal(self.owner.email, self.owner.email, "operator", self.owner.scope)
        service.prompt(op.session_id, {"clientRequestId":"new-role", "message":"new-role-goal"}, self.owner)
        next_op = worker.claim(); workspace._finish_init(next_op)
        with mutation():
            session = PiSession.objects.get(pk=op.session_id)
            workspace.ingest(session, workspace._workspace(session), next_op, {"workspace":{"terminals":[], "pendingUi":[]}})
        self.assert_plan_absent_from_get_and_compact(op.session_id)

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY":"isolated-context-compaction-rejection-key-123456789"})
    def test_real_worker_closes_exact_prebind_rejection_without_model_or_freeze(self):
        op = self.ready()
        compact = self.send(op.session_id, "compact")
        current = worker.claim()
        control = PiControl.objects.get(pk=compact["control"]["id"])
        commands = []
        def transport(request):
            commands.append(request["command"])
            if request["command"] == "create": return {"status":"idle", "state":{"commands":[]}}
            self.assertEqual(request["command"], "workspace")
            return {"control":{"controlId":control.id,"controlSeq":control.control_seq,"command":"compact","status":"failed",
                "errorCode":"compact_unsafe_point", "result":{"compactPreBindRejection":{"operationId":current.id,
                    "seq":current.seq,"modelBound":False,"code":"compact_unsafe_point"}}}}
        with patch.object(worker, "heartbeat"), patch.object(workspace.pi_transport, "command", side_effect=transport):
            worker.perform(current)
        current.refresh_from_db(); control.refresh_from_db()
        session = PiSession.objects.get(pk=op.session_id)
        self.assertEqual((current.status, control.status, session.status), ("failed", "failed", "idle"))
        self.assertEqual(commands, ["create", "workspace"])
        self.assertFalse(PiDispatch.objects.filter(operation=current, kind="model").exists())

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY":"isolated-context-compaction-rejection-key-123456789"})
    def test_real_worker_reads_delayed_original_control_before_native_state(self):
        previous = self.ready()
        compact = self.send(previous.session_id, "compact")
        current = worker.claim(); control = PiControl.objects.get(pk=compact["control"]["id"])
        commands = []
        def transport(request):
            commands.append((request["command"], request["payload"].get("action")))
            if request["command"] == "create": return {"status":"idle", "state":{"commands":[]}}
            self.assertEqual(request["command"], "workspace", "Native state must not run against the previous operation")
            receipt = {"controlId":control.id,"controlSeq":control.control_seq,"command":"compact"}
            if request["payload"]["action"] == "control":
                return {"control":{**receipt,"status":"accepted","result":{}}}
            return {"workspace":{"activeOperationId":previous.id,"terminals":[],"pendingUi":[],"controls":[{**receipt,
                "status":"failed","errorCode":"compact_unsafe_point","result":{"compactPreBindRejection":{
                    "operationId":current.id,"seq":current.seq,"modelBound":False,"code":"compact_unsafe_point"}}}]}}
        with patch.object(worker, "heartbeat"), patch.object(workspace.pi_transport, "command", side_effect=transport):
            worker.perform(current)
        current.refresh_from_db(); control.refresh_from_db()
        self.assertEqual((current.status,control.status,PiSession.objects.get(pk=current.session_id).status),("failed","failed","idle"))
        self.assertEqual(commands,[("create",None),("workspace","control"),("workspace","state")])

    def test_old_child_root_epoch_does_not_receive_new_root_plan(self):
        op = self.ready()
        child_id = self.session()
        with mutation():
            PiAgent.objects.filter(session_id=child_id).update(root_session_id=op.session_id, parent_session_id=op.session_id,
                settings_json=canonical({"rootEpoch":1,"rootGeneration":1}))
            root = PiSession.objects.get(pk=op.session_id)
            root.epoch += 1; root.generation += 1; root.save()
            pi_native.save_plan(root, {"plan":{"goal":"new-root-secret","constraints":[],"steps":[],"deliverables":[],"openQuestions":[]}})
        self.assertNotIn("new-root-secret", canonical(self.http_workspace(child_id)))
        with self.assertRaises(AiError): self.save_marker_plan(child_id, "stale-child-plan")

    def test_branch_switch_keeps_previous_goal_and_decisions_out_of_compact(self):
        op = self.ready()
        with mutation():
            ws = PiWorkspace.objects.get(session_id=op.session_id)
            ws.state_json = canonical({"piState":{"sessionId":"branch-a"}}); ws.save()
        service.prompt(op.session_id, {"clientRequestId":"branch-bound-prompt", "message":"branch-a-secret"}, self.owner)
        bound = worker.claim(); workspace._finish_init(bound)
        self.assertEqual(json.loads(bound.payload_json)["nativeBranchBinding"]["nativeSessionId"], "branch-a")
        with mutation():
            PiControl.objects.create(id="branch-steer", session_id=op.session_id, operation=bound, client_request_id="branch-steer",
                request_digest="synthetic", epoch=bound.epoch, generation=bound.generation, control_seq=1, command="steer",
                status="completed", payload_json=canonical({"message":"branch-a-decision-secret"}))
        def switched(request):
            return {**self.runner(request), "workspace":{"terminals":[],"pendingUi":[],"piState":{"sessionId":"branch-b"}}}
        with patch.object(workspace.pi_transport, "command", side_effect=switched):
            # Reserve a new control sequence after the synthetic prior steer.
            with mutation(): PiWorkspace.objects.filter(session_id=op.session_id).update(control_seq=1)
            self.send(op.session_id, "session_new", key="new-native-branch")
        current = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        self.assertIsNone(current["goal"])
        self.assertEqual(current["historicalGoal"]["text"], "branch-a-secret")
        compact = self.send(op.session_id, "compact", key="branch-compact")
        instruction = PiControl.objects.get(pk=compact["control"]["id"]).payload_json
        self.assertNotIn("branch-a-secret", instruction)
        self.assertNotIn("branch-a-decision-secret", instruction)
