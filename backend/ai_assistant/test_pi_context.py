"""Isolated recovery/control evidence checks; no provider or Runner effects."""
import json
from unittest.mock import patch, Mock
from pathlib import Path
from types import SimpleNamespace
import threading

from django.test import TestCase, override_settings

from . import pi_context, pi_workspace as workspace, pi_native, pi_service as service, pi_worker as worker
from .pi_models import PiControl, PiDispatch, PiOperation, PiSession, PiWorkspace, PiAgent, PiAgentMessage
from .policy import AiError, canonical, mutation, digest, uid
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
                request_digest=digest({"fixture":"unknown-model"}), status="unknown", response_json=canonical({"providerFrame": "private"}))
        with patch.object(workspace.pi_transport, "command") as send:
            state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
            with self.assertRaises(AiError) as caught: self.send(op.session_id, "compact")
        self.assertEqual(caught.exception.code, "pi_compact_unsafe")
        self.assertEqual(state["unresolvedDispatches"]["items"][0]["dispatchId"], "unknown-model")
        self.assertNotIn("providerFrame", canonical(state))
        self.assertFalse(send.called)
        self.assertEqual(PiControl.objects.count(), 0)

    def test_user_decisions_are_verbatim_with_omission_and_original_control_ids(self):
        op = self.ready(active=True)
        original_ids = []
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner):
            for i in range(pi_context.LIMIT+2):
                original_ids.append(self.send(op.session_id,"steer",{"message":"已确认修正"*1000},key=f"decision-{i}")["control"]["id"])
        state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        decisions = state["userDecisionsAndCorrections"]
        self.assertTrue(decisions["hasMore"])
        self.assertEqual(len(decisions["items"]), pi_context.LIMIT)
        self.assertTrue(decisions["items"][0]["evidence"]["truncated"])
        self.assertEqual(decisions["items"][0]["controlId"], original_ids[-1])
        self.assertLess(len(canonical(state).encode()), 96*1024)
        next_page = workspace.detail(op.session_id, {"recoveryBeforeControlSeq": str(decisions["nextBeforeControlSeq"])}, self.owner, poll=False)["recovery"]
        self.assertEqual(next_page["userDecisionsAndCorrections"]["items"][0]["controlSeq"], 2)
        source = workspace.detail(op.session_id, {"recoveryControlSeq": "1", "recoveryTextOffset": "1200"}, self.owner, poll=False)["recovery"]["sourceControl"]
        self.assertEqual(source["controlId"], original_ids[0])
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
        child_id = self.send(op.session_id,"agent_spawn",{"task":"old-child"},key="create-old-child")["control"]["result"]["sessionId"]
        workspace._finish_init(worker.claim())
        with mutation():
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
        bound = worker.claim()
        self.assertEqual(json.loads(bound.payload_json)["nativeBranchBinding"]["nativeSessionId"], "branch-a")
        with patch.object(workspace.pi_transport,"command",side_effect=self.runner):
            self.send(op.session_id,"steer",{"message":"branch-a-decision-secret"},key="branch-steer")
        workspace._finish_init(bound)
        def switched(request):
            return {**self.runner(request), "workspace":{"terminals":[],"pendingUi":[],"piState":{"sessionId":"branch-b"}}}
        with patch.object(workspace.pi_transport, "command", side_effect=switched):
            self.send(op.session_id, "session_new", key="new-native-branch")
        current = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        self.assertIsNone(current["goal"])
        self.assertEqual(current["historicalGoal"]["text"], "branch-a-secret")
        compact = self.send(op.session_id, "compact", key="branch-compact")
        instruction = PiControl.objects.get(pk=compact["control"]["id"]).payload_json
        self.assertNotIn("branch-a-secret", instruction)
        self.assertNotIn("branch-a-decision-secret", instruction)

    def test_real_get_hides_old_agent_message_after_same_scope_reset(self):
        op=self.ready()
        self.send(op.session_id,"agent_send",{"agentId":op.session_id,"message":"old-agent-message-secret"},key="old-send")
        self.assertIn("old-agent-message-secret",canonical(self.http_workspace(op.session_id)))
        with patch.object(worker,"dispose_environment"), patch.object(workspace,"_create_environment",return_value={"workspace":{"terminals":[],"pendingUi":[]}}):
            self.send(op.session_id,"reset",key="message-reset")
        self.assertNotIn("old-agent-message-secret",canonical(self.http_workspace(op.session_id)))

    def test_real_get_does_not_fabricate_evidence_for_legacy_message(self):
        op=self.ready()
        with mutation():
            session=PiSession.objects.get(pk=op.session_id);state=pi_native.state_for(session,lock=True)
            state.message_seq+=1;state.save(update_fields=["message_seq"])
            row=PiAgentMessage.objects.create(id=uid("pi-message"),root_session=session,from_session=session,
                to_session=session,seq=state.message_seq,kind="send",message="unbound-legacy-secret")
            service.event(session,"agent_message",{"messageId":row.id,"fromSessionId":session.id,"kind":"send","seq":row.seq})
        result=self.http_workspace(op.session_id)
        self.assertNotIn("unbound-legacy-secret",canonical(result))
        self.assertTrue(result["native"]["messageHistoryMayBeOmitted"])

    def test_real_get_child_only_sees_exact_messages_and_never_new_root_after_reset(self):
        op=self.ready()
        child=self.send(op.session_id,"agent_spawn",{"task":"child"},key="message-child")["control"]["result"]["sessionId"]
        workspace._finish_init(worker.claim())
        self.send(op.session_id,"agent_send",{"agentId":child,"message":"explicit-child-message"},key="to-child")
        self.send(op.session_id,"agent_send",{"agentId":op.session_id,"message":"root-only-message"},key="to-root")
        view=canonical(self.http_workspace(child))
        self.assertIn("explicit-child-message",view); self.assertNotIn("root-only-message",view)
        with patch.object(worker,"dispose_environment"), patch.object(workspace,"_create_environment",return_value={"workspace":{"terminals":[],"pendingUi":[]}}):
            self.send(op.session_id,"reset",key="new-root-generation")
        self.send(op.session_id,"agent_send",{"agentId":op.session_id,"message":"new-root-message-secret"},key="new-root-send")
        self.assertNotIn("new-root-message-secret",canonical(self.http_workspace(child)))

    def test_real_get_rechecks_generation_and_permissions_after_runner_gap(self):
        from access_control.models import AppUser
        for mode in ("generation", "scope", "error_generation"):
            with self.subTest(mode=mode):
                op=self.ready(active=True)
                with patch.object(workspace.pi_transport,"command",side_effect=self.runner):
                    self.send(op.session_id,"steer",{"message":"old-control-secret"},key="gap-steer")
                workspace._finish_init(op)
                def transport(request):
                    if mode == "scope": AppUser.objects.filter(email=self.owner.email).update(scope={"warehouses":[],"channels":[],"platforms":[]})
                    else:
                        with mutation():
                            row=PiSession.objects.get(pk=op.session_id);row.epoch+=1;row.generation+=1;row.save()
                    if mode == "error_generation": raise AiError("synthetic gap", "pi_runner_unknown",503)
                    return self.runner(request)
                with patch.object(workspace.pi_transport,"command",side_effect=transport):
                    response=self.call(f"/api/ai/pi/sessions/{op.session_id}/workspace",method="GET")
                self.assertIn(response.status_code,(403,409)); self.assertNotIn("old-control-secret",response.content.decode())
                if mode == "scope": AppUser.objects.filter(email=self.owner.email).update(scope=self.owner.scope)

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY":"isolated-context-compaction-rejection-key-123456789"})
    def test_real_worker_keeps_skills_through_real_broker_create_with_background_process(self):
        from pi_runner.server import Broker
        from pi_runner.skills import build
        from pi_runner.protocol import workspace_key
        selected=next(item for item in service.skills() if item["id"]=="excel-report")
        result=self.prompt(skillIds=["excel-report"]); previous=worker.claim();workspace._finish_init(previous)
        with mutation(): PiWorkspace.objects.create(session_id=previous.session_id,status="ready",model_id=self.model.id,model_version=self.model.version)
        compact=self.send(previous.session_id,"compact");current=worker.claim()
        manifest=build(Path(__file__).resolve().parents[1]/"pi_runner"/"bundled_skills"/selected["version"])
        native=SimpleNamespace(phase="settled",active={"operationId":previous.id},skills=[s for s in manifest["skills"] if s["id"]=="excel-report"],
            skill_version=selected["version"],bind=Mock(),baseline_processes={"pi"},metadata_lock=threading.RLock())
        broker=SimpleNamespace(lock=threading.RLock(),sessions={workspace_key(worker.identity(current)):native},skill_bundles={selected["version"]:manifest},
            transfer=Mock(return_value=manifest),workspace_active=Mock(return_value=True),process_inventory=Mock(return_value=["pi","background"]))
        broker.update_skills=lambda *args: Broker.update_skills(broker,*args)
        broker._update_skills=lambda *args: Broker._update_skills(broker,*args)
        control=PiControl.objects.get(pk=compact["control"]["id"])
        failures=[]
        def transport(request):
            if request["command"]=="create":
                self.assertEqual(request["payload"]["skillIds"],["excel-report"])
                try: Broker.create(broker,request)
                except Exception as error:
                    failures.append(type(error).__name__+":"+str(error)); raise
                return {"skills":native.skills,"state":{"commands":[{"name":"skill:excel-report","source":"skill"}]}}
            return {"control":{"controlId":control.id,"controlSeq":control.control_seq,"status":"failed","errorCode":"compact_background_writers",
                "result":{"compactPreBindRejection":{"operationId":current.id,"seq":current.seq,"modelBound":False,"code":"compact_background_writers"}}}}
        with patch.object(worker,"heartbeat"), patch.object(workspace.pi_transport,"command",side_effect=transport): worker.perform(current)
        current.refresh_from_db();control.refresh_from_db()
        self.assertEqual((current.status,control.status),("failed","failed"),(current.error_code,failures,list(PiDispatch.objects.filter(operation=current).values_list("kind","error_code"))))
        broker.process_inventory.assert_not_called()

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY":"isolated-context-compaction-rejection-key-123456789"})
    def test_real_worker_known_create_rejection_closes_but_transport_unknown_stays_unknown(self):
        from .pi_transport import CompactCreateRejected
        for rejection, status in [(CompactCreateRejected(),"failed"),(AiError("lost","pi_runner_unknown",503),"unknown")]:
            with self.subTest(status=status):
                op=self.ready(); compact=self.send(op.session_id,"compact");current=worker.claim()
                with patch.object(worker,"heartbeat"),patch.object(workspace.pi_transport,"command",side_effect=rejection):worker.perform(current)
                current.refresh_from_db();control=PiControl.objects.get(pk=compact["control"]["id"])
                self.assertEqual(current.status,status); self.assertEqual(control.status,status)

    def test_transport_only_accepts_exact_signed_compact_create_rejection(self):
        from . import pi_transport
        for valid, marked in [(True,True),(False,True),(True,False)]:
            with self.subTest(valid=valid,marked=marked):
                key=b"synthetic-signing-key-12345678901234567890"
                body=canonical({"error":"skill_update_while_busy"}).encode()
                value={"operationId":"compact","ownerId":"synthetic","conversationId":"isolated","epoch":1,"generation":1,"seq":2,
                    "command":"create","payload":{"compactControlId":"control"} if marked else {}}
                headers={};reply=Mock(status=400);reply.read.return_value=body
                reply.getheader.side_effect=lambda name,default="": "application/json" if name=="Content-Type" else (
                    pi_transport.signature(key,headers["X-Timestamp"],headers["X-Nonce"],body,"response") if valid else "invalid")
                with patch.object(pi_transport,"secret",return_value=key),patch.object(pi_transport.http.client,"HTTPConnection") as connection:
                    connection.return_value.request.side_effect=lambda method,path,raw,supplied: headers.update(supplied)
                    connection.return_value.getresponse.return_value=reply
                    with self.assertRaises(AiError) as caught: pi_transport.command(value)
                self.assertEqual(caught.exception.code,"pi_compact_create_rejected" if valid and marked else "pi_runner_unknown")

    def legacy_agent_message(self, session_id, kind, message):
        # The former durable schema: no invented generation/permission proof.
        with mutation():
            session=PiSession.objects.get(pk=session_id);state=pi_native.state_for(session,lock=True)
            state.message_seq+=1;state.save(update_fields=["message_seq"])
            row=PiAgentMessage.objects.create(id=uid("pi-message"),root_session=session,from_session=session,
                to_session=session,seq=state.message_seq,kind=kind,message=message)
            service.event(session,"agent_message",{"messageId":row.id,"fromSessionId":session.id,"kind":kind,"seq":row.seq})
            return row

    def bound_follow_up(self, session_id, message):
        with mutation():
            session=PiSession.objects.get(pk=session_id);state=pi_native.state_for(session,lock=True)
            return pi_native._message(state,session,session,"follow_up",message)

    def test_real_tick_never_turns_unproved_followup_into_new_prompt_or_view(self):
        op=self.ready()
        self.legacy_agent_message(op.session_id,"follow_up","unproved-scheduler-secret")
        before=PiOperation.objects.count()
        pi_native.scheduler_tick();pi_native.scheduler_tick()
        self.assertEqual(PiOperation.objects.count(),before)
        self.assertNotIn("unproved-scheduler-secret",canonical(self.http_workspace(op.session_id)))
        self.assertNotIn("unproved-scheduler-secret",canonical(service.events(op.session_id,{},self.owner)))

    def test_unproved_prefix_and_clear_do_not_starve_proved_followups(self):
        op=self.ready(active=True)
        for _ in range(105): self.legacy_agent_message(op.session_id,"follow_up","unproved-prefix-secret")
        first=self.bound_follow_up(op.session_id,"proved-first")
        self.legacy_agent_message(op.session_id,"queue_cleared","legacy-clear")
        last=self.bound_follow_up(op.session_id,"proved-second")
        workspace._finish_init(op)
        pi_native.scheduler_tick()
        queued=PiOperation.objects.get(session_id=op.session_id,status="queued")
        payload=json.loads(queued.payload_json)
        self.assertEqual(payload["message"],"proved-first\n\nproved-second")
        self.assertEqual(payload["messageCursor"],last.seq)
        view=canonical(self.http_workspace(op.session_id))
        self.assertIn("proved-first",view);self.assertNotIn("unproved-prefix-secret",view)
        pi_native.scheduler_tick()
        self.assertEqual(PiOperation.objects.filter(session_id=op.session_id).count(),2)
        workspace._finish_init(worker.claim());pi_native.scheduler_tick()
        self.assertEqual(PiOperation.objects.filter(session_id=op.session_id).count(),2)

    def test_real_tick_honors_proved_queue_clear_and_consumed_cursor(self):
        op=self.ready(active=True)
        self.bound_follow_up(op.session_id,"cleared-message")
        with patch.object(workspace.pi_transport,"command",side_effect=self.runner): self.send(op.session_id,"clear_queue",key="clear-proved-queue")
        kept=self.bound_follow_up(op.session_id,"kept-message")
        workspace._finish_init(op);pi_native.scheduler_tick()
        queued=PiOperation.objects.get(session_id=op.session_id,status="queued")
        self.assertEqual(json.loads(queued.payload_json)["message"],"kept-message")
        self.assertEqual(json.loads(queued.payload_json)["messageCursor"],kept.seq)
        workspace._finish_init(worker.claim());pi_native.scheduler_tick()
        self.assertEqual(PiOperation.objects.filter(session_id=op.session_id).count(),2)

    def test_real_tick_preserves_remaining_proved_batch_order_without_replay(self):
        op=self.ready(active=True)
        rows=[self.bound_follow_up(op.session_id,f"ordered-{i:03}") for i in range(102)]
        workspace._finish_init(op);pi_native.scheduler_tick()
        first=worker.claim();first_payload=json.loads(first.payload_json)
        self.assertEqual(first_payload["message"],"\n\n".join(row.message for row in rows[:100]))
        self.assertEqual(first_payload["messageCursor"],rows[99].seq)
        workspace._finish_init(first);pi_native.scheduler_tick()
        second=worker.claim();second_payload=json.loads(second.payload_json)
        self.assertEqual(second_payload["message"],"ordered-100\n\nordered-101")
        self.assertEqual(second_payload["messageCursor"],rows[-1].seq)
        workspace._finish_init(second);pi_native.scheduler_tick()
        self.assertEqual(PiOperation.objects.filter(session_id=op.session_id).count(),3)
