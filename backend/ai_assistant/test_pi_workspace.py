"""Independent-control authority tests; all Runner/network boundaries synthetic."""
import json
import base64
import hashlib
from unittest.mock import patch
from django.test import override_settings
from access_control.models import AppUser
from sales.auth import Principal
from . import test_pi_runtime as runtime_tests
from . import pi_workspace as workspace, pi_service as service, pi_worker as worker
from .pi_models import PiControl, PiSession, PiOperation, PiWorkspace, PiUiRequest
from .policy import AiError, mutation, canonical


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiWorkspaceTests(runtime_tests.PiRuntimeTests):
    # Inherit the fixture helpers without re-running the original suite here.
    def ready(self, *, active=False):
        result = self.prompt()
        operation = worker.claim()
        if not active:
            workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation, status="ready", model_id=self.model.id, model_version=self.model.version)
        return operation

    def send(self, session_id, command, payload=None, key="control-1", actor=None):
        return workspace.control(session_id, {"clientRequestId": key, "command": command, "payload": payload or {}}, actor or self.owner)

    def runner(self, request):
        value = request["payload"]
        if value["action"] == "state":
            return {**request, "workspace": {"terminals": [], "pendingGatewayRequests": [{"capability": "private"}]}}
        if value["action"] in {"activity_begin", "activity_end"}:
            return {**request, "activity": {"activityId": value["activityId"], "activitySeq": value["activitySeq"],
                "kind": "dependency_fetch", "status": "active" if value["action"] == "activity_begin" else "completed", "deadline": 2000000000000}}
        return {**request, "control": {"controlId": value["controlId"], "controlSeq": value["controlSeq"], "status": "completed", "result": {"ok": True}},
            "workspace": {"terminals": [], "pendingUi": []}}

    def test_multiple_controls_share_operation_but_never_receipt_identity(self):
        op = self.ready(active=True)
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner) as send:
            first = self.send(op.session_id, "steer", {"message": "第一条"})
            second = self.send(op.session_id, "steer", {"message": "第二条"}, "control-2")
        self.assertNotEqual(first["control"]["id"], second["control"]["id"])
        self.assertEqual([first["control"]["controlSeq"], second["control"]["controlSeq"]], [1, 2])
        self.assertEqual(PiOperation.objects.count(), 1)
        self.assertEqual(send.call_count, 2)

    def test_response_loss_same_id_does_not_send_again_changed_body_rejects(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command", side_effect=AiError("lost", "pi_runner_unknown", 503)) as send:
            with self.assertRaises(AiError): self.send(op.session_id, "terminal_create")
            replay = self.send(op.session_id, "terminal_create")
            self.assertEqual(replay["control"]["status"], "unknown")
            self.assertTrue(replay["replayed"])
            with self.assertRaises(AiError): self.send(op.session_id, "terminal_create", {"cols": 100})
            self.assertEqual(send.call_count, 1)
        with self.assertRaises(AiError): self.send(op.session_id, "reset", key="bypass")
        with self.assertRaises(AiError): self.prompt(op.session_id, clientRequestId="bypass-prompt")

    def test_workspace_read_strips_private_gateway_and_has_no_control_send(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner) as send:
            result = workspace.detail(op.session_id, {}, self.owner)
        self.assertNotIn("capability", canonical(result))
        self.assertNotIn("pendingGatewayRequests", canonical(result))
        self.assertEqual(send.call_args.args[0]["payload"]["action"], "state")
        self.assertEqual(PiControl.objects.count(), 0)

    def test_browser_private_gateway_commands_and_identity_are_rejected(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command") as send:
            for command, payload in [("gateway_response", {}), ("bash", {"command": "true", "gateway": {}}), ("terminal_create", {"epoch": 1})]:
                with self.assertRaises(AiError): self.send(op.session_id, command, payload)
        self.assertFalse(send.called)

    def test_read_command_cannot_smuggle_write_action_or_unbrokered_resource(self):
        op = self.ready(active=True)
        with patch.object(workspace.pi_transport, "command") as send:
            for command, payload in [("file_list", {"path": "work", "action": "delete"}),
                    ("file_read", {"path": "work/a", "base64": "YQ=="}),
                    ("resource_install", {"bundle": {"packages": []}})]:
                with self.assertRaises(AiError): self.send(op.session_id, command, payload)
        self.assertFalse(send.called)

    def test_owner_scope_and_old_generation_ui_fences(self):
        op = self.ready(active=True)
        with mutation():
            row = PiSession.objects.select_for_update().get(pk=op.session_id)
            ws = PiWorkspace.objects.get(session=row)
            workspace.ingest(row, ws, op, {"workspace": {"pendingUi": [{"requestId": "runner-id", "method": "confirm", "message": "继续?"}]}})
        request = PiUiRequest.objects.get()
        self.assertNotEqual(request.id, "runner-id")
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner) as send:
            for answer in ({}, {"value": "wrong kind"}, {"confirmed": True, "value": "mixed"}, {"cancelled": False}):
                with self.assertRaises(AiError): self.send(op.session_id, "ui_response", {"requestId": request.id, **answer}, key="bad-ui")
            self.assertEqual(PiUiRequest.objects.get(pk=request.pk).status, "pending")
            with self.assertRaises(AiError): self.send(op.session_id, "ui_response", {"requestId": request.id, "confirmed": True}, actor=self.other)
            self.send(op.session_id, "ui_response", {"requestId": request.id, "confirmed": True})
            self.assertEqual(send.call_args.args[0]["payload"]["payload"]["requestId"], "runner-id")
            with self.assertRaises(AiError): self.send(op.session_id, "ui_response", {"requestId": request.id, "confirmed": True}, "second-answer")
        narrow = {"warehouses": [], "channels": [], "platforms": ["京东"]}
        AppUser.objects.filter(email=self.owner.email).update(scope=narrow)
        actor = Principal(self.owner.email, "owner", self.owner.role, narrow)
        with self.assertRaises(AiError): self.send(op.session_id, "terminal_create", actor=actor, key="narrow")
        state = workspace.detail(op.session_id, {}, actor)
        self.assertEqual(state["workspace"]["status"], "frozen")
        self.assertEqual(state["workspace"]["state"], {})

    def test_stop_rejects_new_steering_but_keeps_observation(self):
        op = self.ready(active=True)
        service.abort(op.session_id, {"clientRequestId": "stop"}, self.owner)
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner) as send:
            for command in ("steer", "follow_up"):
                with self.assertRaises(AiError): self.send(op.session_id, command, {"message": "late"}, key=command)
            workspace.detail(op.session_id, {}, self.owner)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceling")

    def test_compact_is_real_new_operation_not_a_fake_success(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command") as send:
            result = self.send(op.session_id, "compact")
        self.assertFalse(send.called)
        self.assertEqual(result["control"]["status"], "queued")
        compact = PiOperation.objects.get(id=result["control"]["operationId"])
        self.assertEqual(compact.kind, "workspace:compact")
        self.assertEqual(compact.seq, op.seq+1)
        self.assertEqual(worker.claim().id, compact.id)

    def test_workspace_operations_keep_single_shop_authority_snapshot(self):
        selection = {"platform": "京东", "shop": "合成单店"}
        sid = self.session(self.other, shopSelection=selection)
        self.prompt(sid, actor=self.other)
        op = worker.claim(); workspace._finish_init(op)
        with mutation(): PiWorkspace.objects.create(session_id=sid, status="ready", model_id=self.model.id, model_version=self.model.version)
        value = self.send(sid, "compact", actor=self.other)
        compact = PiOperation.objects.get(pk=value["control"]["operationId"])
        from .pi_selection import for_operation, bind_arguments
        self.assertEqual(for_operation(compact), selection)
        with self.assertRaises(AiError): bind_arguments("get_sales_summary", {}, for_operation(compact))

    def test_upgrade_never_resets_and_model_thinking_unsupported_fail_before_send(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command") as send:
            for command, payload in [("upgrade", {}), ("thinking_set", {"level": "high"})]:
                with self.assertRaises(AiError): self.send(op.session_id, command, payload)
        self.assertFalse(send.called)
        session = PiSession.objects.get(pk=op.session_id)
        self.assertEqual((session.epoch, session.generation), (1, 1))

    def test_pause_blocks_prompt_without_releasing_unknown_operation(self):
        op = self.ready(active=True)
        with mutation():
            PiOperation.objects.filter(pk=op.pk).update(status="unknown")
            PiSession.objects.filter(pk=op.session_id).update(status="unknown")
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner):
            with self.assertRaises(AiError): self.send(op.session_id, "pause")
        current = PiOperation.objects.get(pk=op.pk)
        self.assertEqual(current.status, "unknown")
        self.assertFalse(current.cancel_requested)
        with self.assertRaises(AiError): self.send(op.session_id, "wake", key="wake")

    def test_signed_control_read_reconciles_without_reexecution(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command", side_effect=AiError("lost", "pi_runner_unknown", 503)):
            with self.assertRaises(AiError): self.send(op.session_id, "file_mkdir", {"path": "work/new"})
        control = PiControl.objects.get()
        with patch.object(workspace.pi_transport, "command", return_value={"workspace": {"controls": [{"controlId": control.id,
                "controlSeq": control.control_seq, "status": "completed", "result": {"created": True}}]}}) as send:
            result = workspace.detail(op.session_id, {}, self.owner)
        self.assertEqual(result["controls"][0]["status"], "completed")
        self.assertEqual(result["workspace"]["status"], "ready")
        self.assertEqual(send.call_count, 1)
        from .pi_models import PiEvent
        history = list(PiEvent.objects.filter(session_id=op.session_id, event_type__in=["workspace_control_unknown", "workspace_control_reconciled"]).values_list("data_json", flat=True))
        self.assertEqual(len(history), 2)
        self.assertIn('"previousStatus":"unknown"', history[-1])

    def test_download_snapshots_create_immutable_domain_attachment(self):
        op = self.ready()
        data = b"snapshot,one\n1,2\n"
        sha = hashlib.sha256(data).hexdigest()
        metadata = {"path": "work/report.csv", "downloadId": "download-fixture", "sha256": sha, "sizeBytes": len(data)}
        def runner(request):
            if request["payload"]["action"] == "download":
                return {**request, "download": {**metadata, "base64": base64.b64encode(data).decode(), "mimeType": "text/csv"}}
            result = self.runner(request)
            result["control"]["result"] = metadata
            return result
        with patch.object(workspace.pi_transport, "command", side_effect=runner) as send:
            result = self.send(op.session_id, "file_download", {"path": "work/report.csv", "expectedSha256": sha})
            replay = self.send(op.session_id, "file_download", {"path": "work/report.csv", "expectedSha256": sha})
        self.assertEqual(send.call_count, 2)
        file_id = result["control"]["result"]["fileId"]
        self.assertEqual(replay["control"]["result"]["fileId"], file_id)
        self.assertEqual(base64.b64decode(service.download(file_id, self.owner, content=True)["base64"]), data)

    def test_pause_before_claim_prevents_container_creation(self):
        result = self.prompt()
        with patch.object(workspace.pi_transport, "command") as send:
            with self.assertRaises(AiError): self.send(result["session"]["id"], "pause")
        self.assertFalse(send.called)
        self.assertEqual(PiOperation.objects.get(pk=result["operation"]["id"]).status, "queued")

    def test_model_confirmation_requires_actual_readback_not_optimistic_label(self):
        op = self.ready()
        with patch.object(workspace, "_create_environment", return_value={"workspace": {}}), patch.object(workspace.pi_transport, "command", side_effect=self.runner):
            with self.assertRaises(AiError) as error: self.send(op.session_id, "model_set", {"modelId": self.model.id})
        self.assertEqual(error.exception.code, "pi_effective_model_unknown")
        self.assertEqual(PiControl.objects.get().status, "unknown")

    def test_dependency_bundle_uses_offline_resource_install(self):
        op = self.ready()
        bundle = {"schemaVersion": 1, "kind": "dependency_bundle", "ecosystem": "pip", "packages": [], "lockDigest": "a"*64}
        from .pi_research import DependencyBroker
        with patch.object(DependencyBroker, "fetch", return_value=bundle), patch.object(workspace.pi_transport, "command", side_effect=self.runner) as send:
            self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": [{"name": "six", "version": "1.17.0"}]})
        installed = next(call.args[0]["payload"] for call in send.call_args_list if call.args[0]["payload"]["action"] == "control")
        self.assertEqual(installed["command"], "resource_install")
        # Every workspace control payload now carries the admission fence
        # (pi_workspace.py's _control attaches it unconditionally) so the
        # Runner can validate it before resource_install executes.
        from . import pi_native
        self.assertEqual(installed["payload"], {"bundle": bundle, "admission": pi_native.admission(op)})

    def test_research_is_explicit_has_no_container_and_read_failure_is_known(self):
        session = self.session()
        from .pi_research import ResearchError
        with patch("ai_assistant.pi_research.execute_public_research", side_effect=ResearchError("network_failed")), patch.object(workspace.pi_transport, "command") as send:
            with self.assertRaises(AiError): self.send(session, "research_search", {"query": "公开资料"})
        self.assertFalse(send.called)
        self.assertEqual(PiControl.objects.get().status, "failed")
        self.assertEqual(PiOperation.objects.count(), 0)

    def test_late_observation_does_not_unpause_or_replace_new_effective_model(self):
        op = self.ready()
        def late(request):
            with mutation():
                ws = PiWorkspace.objects.get(session_id=op.session_id)
                ws.status, ws.control_seq, ws.model_id = "paused", ws.control_seq+1, "new-model-confirmed"
                ws.state_json = canonical({"new": "snapshot"})
                ws.save()
            return {"workspace": {"old": "snapshot"}}
        with patch.object(workspace.pi_transport, "command", side_effect=late):
            result = workspace.detail(op.session_id, {}, self.owner)
        self.assertEqual(result["workspace"]["status"], "paused")
        self.assertEqual(result["workspace"]["effective"]["modelId"], "new-model-confirmed")
        self.assertEqual(result["workspace"]["state"], {"new": "snapshot"})

    def test_pause_completion_between_prompt_reads_blocks_new_admission(self):
        op = self.ready()
        original, count = service.get_session, 0
        def barrier(session_id, principal, **kwargs):
            nonlocal count
            value = original(session_id, principal, **kwargs)
            count += 1
            if count == 1:
                with mutation(): PiWorkspace.objects.filter(session_id=session_id).update(status="paused")
            return value
        with patch.object(service, "get_session", side_effect=barrier), self.assertRaises(AiError):
            self.prompt(op.session_id, clientRequestId="late-prompt")
        self.assertEqual(PiOperation.objects.count(), 1)

    def test_async_control_fences_reset_model_and_new_prompt(self):
        op = self.ready()
        def accepted(request):
            result = self.runner(request)
            result["control"]["status"] = "accepted"
            return result
        with patch.object(workspace.pi_transport, "command", side_effect=accepted):
            self.send(op.session_id, "bash", {"command": "sleep 10"})
            for command, payload in [("reset", {}), ("model_set", {"modelId": self.model.id}), ("session_new", {})]:
                with self.assertRaises(AiError): self.send(op.session_id, command, payload, "new-"+command)
            with self.assertRaises(AiError): self.prompt(op.session_id, clientRequestId="new-prompt")
        self.assertEqual(PiOperation.objects.count(), 1)

    def test_model_set_with_bash_in_flight_rejects_cleanly_and_session_stays_usable(self):
        # Regression for d498852c moving model_set into compatible without
        # accounting for needs_init's "not active" re-create path: when the
        # operation itself is NOT active (e.g. already succeeded) but a bash
        # control still sits accepted, model_set used to slip past the
        # compatible gate, open a second workspace:init operation concurrently
        # with the live bash container, fail there, and leave an unrecoverable
        # workspace:unknown behind. In this specific shape (operation inactive,
        # sibling control accepted) model_set must stay exclusive like reset.
        # This does NOT apply when the operation itself is active/running: see
        # test_model_set_while_operation_active_defers_to_runner_safe_point
        # below for the legitimate d498852c pendingModel concurrency feature,
        # which this fix preserves untouched.
        op = self.ready()
        def accepted(request):
            result = self.runner(request)
            result["control"]["status"] = "accepted"
            return result
        with patch.object(workspace.pi_transport, "command", side_effect=accepted) as send:
            self.send(op.session_id, "bash", {"command": "sleep 10"})
            with self.assertRaises(AiError) as error:
                self.send(op.session_id, "model_set", {"modelId": self.model.id}, "leak-model-set")
        self.assertEqual(error.exception.code, "pi_control_active")
        # No leak: no second operation was created, and nothing was marked unknown.
        self.assertEqual(PiOperation.objects.count(), 1)
        self.assertEqual(PiWorkspace.objects.get(session_id=op.session_id).status, "ready")
        session = PiSession.objects.get(pk=op.session_id)
        self.assertNotEqual(session.status, "unknown")
        self.assertFalse(PiOperation.objects.filter(status="unknown").exists())
        self.assertFalse(PiControl.objects.filter(command="model_set").exists())
        # The session must still be usable afterward: a compatible command that
        # was already reachable while bash is in flight keeps working, proving
        # the rejected model_set left no residual fence (no pi_control_active,
        # no pi_operation_active, no unknown fence).
        with patch.object(workspace.pi_transport, "command", side_effect=accepted):
            recovered = self.send(op.session_id, "stats", {}, "after-leak-stats")
        self.assertEqual(recovered["control"]["status"], "accepted")
        self.assertEqual(PiOperation.objects.count(), 1)

    def test_model_set_while_operation_active_defers_to_runner_safe_point(self):
        # d498852c's real feature: while the operation is genuinely active
        # (queued/running/canceling), model_set must NOT be fenced and must
        # NOT go through needs_init/_create_environment. It is dispatched as
        # a lightweight control; the Pi runner (pi_runner/workspace.py:868-877)
        # queues it as pendingModel and only applies it later at a safe point
        # (pi_runner/workspace.py:558-585, once bash_control is clear). Losing
        # this path by over-fencing model_set would silently kill a working
        # feature, which is why the regression fix above only moves model_set
        # between exclusive/compatible and leaves RUNNING_COMMANDS untouched.
        op = self.ready(active=True)
        from . import pi_native
        create_calls = []
        original_create_environment = workspace._create_environment
        def spy_create_environment(operation):
            create_calls.append(operation.id)
            return original_create_environment(operation)
        def queued(request):
            value = request["payload"]
            if value["action"] == "state":
                return {**request, "workspace": {"terminals": [], "pendingUi": []}}
            # Mirrors the real Pi runner's BUSY-phase model_set branch: it
            # queues pendingModel and defers application, never recreating
            # the environment while bash/another operation is live.
            return {**request, "control": {"controlId": value["controlId"], "controlSeq": value["controlSeq"],
                "status": "queued", "result": {"disposition": "queued", "pendingModel": True}}, "workspace": {"terminals": [], "pendingUi": []}}
        with patch.object(workspace, "_create_environment", side_effect=spy_create_environment), \
                patch.object(workspace.pi_transport, "command", side_effect=queued):
            result = self.send(op.session_id, "model_set", {"modelId": self.model.id}, "pending-model-set")
        self.assertEqual(result["control"]["status"], "queued")
        self.assertFalse(create_calls, "model_set while active must never call _create_environment")
        self.assertEqual(PiOperation.objects.count(), 1)
        row = PiControl.objects.get(client_request_id="pending-model-set")
        self.assertIsNotNone(row.operation_id)
        # The pending model has not been confirmed effective yet.
        self.assertEqual(PiWorkspace.objects.get(session_id=op.session_id).model_id, self.model.id)
        # Now simulate the Pi runner's safety-point completion arriving on a
        # later poll: bash/other work has finished, apply_pending ran, and
        # the control receipt is reconciled as completed with effectiveModel.
        from .pi_native import model_binding
        expected = {k: v for k, v in model_binding(self.model).items()
            if k in {"contextWindow", "maxTokens", "reasoning", "supportedThinkingLevels"}}
        def settled(request):
            value = request["payload"]
            if value["action"] == "state":
                return {**request, "workspace": {"terminals": [], "pendingUi": [], "controls": [
                    {"controlId": row.id, "controlSeq": row.control_seq, "status": "completed",
                        "result": {"effectiveModel": expected}}]}}
            raise AssertionError("no further control dispatch expected")
        with patch.object(workspace, "_create_environment", side_effect=spy_create_environment), \
                patch.object(workspace.pi_transport, "command", side_effect=settled):
            workspace.detail(op.session_id, {}, self.owner)
        self.assertFalse(create_calls, "safe-point reconciliation must also skip _create_environment")
        row.refresh_from_db()
        self.assertEqual(row.status, "completed")
        self.assertEqual(PiWorkspace.objects.get(session_id=op.session_id).model_id, self.model.id)
        self.assertEqual(PiOperation.objects.count(), 1)

    def test_exclusive_install_blocks_terminal_input_until_receipt_known(self):
        op = self.ready()
        from .pi_research import DependencyBroker
        def accepted(request):
            result = self.runner(request)
            if "control" in result: result["control"]["status"] = "accepted"
            return result
        with patch.object(DependencyBroker, "fetch", return_value={"packages": []}), patch.object(workspace.pi_transport, "command", side_effect=accepted) as send:
            self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []})
            with self.assertRaises(AiError): self.send(op.session_id, "terminal_create", key="term")
            with self.assertRaises(AiError): self.send(op.session_id, "terminal_input", {"terminalId": "terminal-existing", "inputId": "input1", "inputSeq": 1, "data": "write"}, "input")
        self.assertEqual(send.call_count, 3)

    def test_dependency_activity_begin_precedes_fetch_end_follows_handoff(self):
        from .pi_research import DependencyBroker
        from .pi_models import PiDispatch
        op = self.ready(); order = []
        def runner(request):
            action = request["payload"]["action"]; order.append(action)
            if action == "activity_begin":
                self.assertEqual(PiDispatch.objects.get(operation=op, kind="activity:begin").status, "sent")
            return self.runner(request)
        def fetch(*args):
            order.append("fetch")
            self.assertEqual(PiDispatch.objects.get(operation=op, kind="activity:begin").status, "completed")
            self.assertFalse(PiDispatch.objects.filter(operation=op, kind="activity:end").exists())
            return {"packages": []}
        with patch.object(DependencyBroker, "fetch", side_effect=fetch), patch.object(workspace.pi_transport, "command", side_effect=runner):
            value = self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []})
        self.assertEqual(order, ["activity_begin", "fetch", "control", "activity_end"])
        self.assertEqual(value["control"]["status"], "completed")
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="activity:end").status, "completed")

    def test_unknown_activity_begin_does_not_fetch_or_install_or_repeat(self):
        from .pi_research import DependencyBroker
        from .pi_models import PiDispatch
        op = self.ready()
        with patch.object(DependencyBroker, "fetch") as fetch, patch.object(workspace.pi_transport, "command", side_effect=AiError("lost", "pi_runner_unknown", 503)) as send:
            with self.assertRaises(AiError): self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []})
            replay = self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []})
        self.assertFalse(fetch.called)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(replay["control"]["status"], "unknown")
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="activity:begin").status, "unknown")
        self.assertFalse(PiDispatch.objects.filter(operation=op, kind="activity:end").exists())

    def test_known_fetch_failure_ends_activity_before_definite_failure(self):
        from .pi_research import DependencyBroker, ResearchError
        from .pi_models import PiDispatch
        op = self.ready()
        with patch.object(DependencyBroker, "fetch", side_effect=ResearchError("source_unavailable")), patch.object(workspace.pi_transport, "command", side_effect=self.runner) as send:
            with self.assertRaises(AiError): self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []})
        self.assertEqual([call.args[0]["payload"]["action"] for call in send.call_args_list], ["activity_begin", "activity_end"])
        self.assertEqual(PiControl.objects.get().status, "failed")
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="activity:end").status, "completed")
        self.assertEqual(PiWorkspace.objects.get(session_id=op.session_id).status, "ready")

    def test_activity_unknown_survives_completed_controls_get_never_renews(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner): self.send(op.session_id, "stats")
        self.assertEqual(PiControl.objects.get().status, "completed")
        activity = {"activityId": PiControl.objects.get().id, "operationId": op.id, "kind": "dependency_fetch", "status": "unknown", "deadline": 2000000000000}
        result = {"workspace": {"activities": [activity], "hasUnresolvedActivities": True}}
        with patch.object(workspace.pi_transport, "command", return_value=result) as send:
            first = workspace.detail(op.session_id, {}, self.owner)
            second = workspace.detail(op.session_id, {}, self.owner)
        self.assertEqual([call.args[0]["payload"]["action"] for call in send.call_args_list], ["state", "state"])
        self.assertEqual((first["workspace"]["status"], second["workspace"]["status"]), ("unknown", "unknown"))
        with self.assertRaises(AiError): self.send(op.session_id, "reset", key="reset-blocked")

    def test_unknown_activity_end_keeps_handoff_and_original_unknown_no_retry(self):
        from .pi_research import DependencyBroker
        from .pi_models import PiDispatch
        op = self.ready()
        def runner(request):
            if request["payload"]["action"] == "activity_end": raise AiError("lost", "pi_runner_unknown", 503)
            result = self.runner(request)
            if "control" in result: result["control"]["status"] = "accepted"
            return result
        with patch.object(DependencyBroker, "fetch", return_value={"packages": []}) as fetch, patch.object(workspace.pi_transport, "command", side_effect=runner) as send:
            with self.assertRaises(AiError): self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []})
            self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []})
        self.assertEqual((fetch.call_count, send.call_count), (1, 3))
        row = PiControl.objects.get()
        self.assertEqual(row.status, "unknown")
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="activity:end").status, "unknown")
        signed = {"workspace": {"activities": [{"activityId": row.id, "operationId": op.id, "kind": "dependency_fetch", "status": "completed", "deadline": 2000000000000}],
            "hasUnresolvedActivities": False, "controls": [{"controlId": row.id, "controlSeq": row.control_seq, "status": "completed", "result": {"installed": True}}]}}
        with patch.object(workspace.pi_transport, "command", return_value=signed): value = workspace.detail(op.session_id, {}, self.owner)
        self.assertEqual(PiControl.objects.get().status, "completed")
        self.assertEqual(value["workspace"]["status"], "unknown")
        with self.assertRaises(AiError): self.send(op.session_id, "dependency_install", {"ecosystem": "pip", "packages": []}, "new-id")

    def test_missing_activity_state_cannot_imply_a_completed_begin_ended(self):
        from .pi_models import PiDispatch
        from .policy import digest
        op = self.ready()
        with mutation(): PiDispatch.objects.create(id="lease-begin", operation=op, kind="activity:begin", request_id="activity1", request_digest=digest({}), status="completed")
        with patch.object(workspace.pi_transport, "command", return_value={"workspace": {"controls": []}}):
            value = workspace.detail(op.session_id, {}, self.owner)
        self.assertEqual(value["workspace"]["status"], "unknown")

    def test_worker_ingests_activity_only_signed_state(self):
        op = self.ready(active=True)
        result = {"events": [], "state": {"activities": [{"activityId": "activity-test", "operationId": op.id,
            "kind": "dependency_fetch", "status": "unknown", "deadline": 2000000000000}], "hasUnresolvedActivities": True}}
        worker.ingest(op, result)
        self.assertEqual(PiWorkspace.objects.get(session_id=op.session_id).status, "unknown")

    def test_large_history_is_bounded_and_preserves_original_evidence(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command", side_effect=self.runner):
            result = self.send(op.session_id, "file_read", {"path": "work/file"})
        row = PiControl.objects.get(id=result["control"]["id"])
        # The DB fixture has no PostgreSQL immutability triggers. Inject a large
        # pre-existing result to exercise projection without editing evidence.
        value = {"path": "work/file", "text": "x"*256000}
        PiControl.objects.filter(pk=row.pk).update(result_json=canonical(value))
        state = workspace.detail(op.session_id, {}, self.owner, poll=False)
        self.assertTrue(state["controls"][0]["result"]["resultOmitted"])
        self.assertLess(len(canonical(state)), 10000)
        self.assertEqual(json.loads(PiControl.objects.get(pk=row.pk).result_json), value)

    def test_usage_is_real_dispatch_measurement_cost_and_missing_are_not_zero(self):
        from .pi_models import PiDispatch
        from .policy import digest
        op = self.ready()
        with mutation():
            PiDispatch.objects.create(id="measured", operation=op, kind="model", request_id="usage", request_digest=digest({}),
                status="completed", usage_json=canonical({"prompt_tokens": 123, "completion_tokens": 45, "secret": "not-public"}))
            PiDispatch.objects.create(id="unknown-measurement", operation=op, kind="model", request_id="missing", request_digest=digest({}), status="unknown")
        value = workspace.detail(op.session_id, {}, self.owner, poll=False)["workspace"]["usage"]
        self.assertEqual(value["knownTokenTotals"]["inputTokens"], 123)
        self.assertEqual(value["knownTokenTotals"]["outputTokens"], 45)
        self.assertEqual(value["missingUsageDispatches"], 1)
        self.assertIsNone(value["cost"])
        self.assertEqual(value["costStatus"], "unknown")
        self.assertNotIn("not-public", canonical(value))

    def test_pi_placeholder_cost_never_becomes_authoritative_stats(self):
        op = self.ready()
        def statistics(request):
            result = self.runner(request)
            result["control"]["result"] = {"totalMessages": 7, "cost": 0, "tokens": {"total": 0}, "model": "operation-model"}
            return result
        with patch.object(workspace.pi_transport, "command", side_effect=statistics):
            value = self.send(op.session_id, "stats")["control"]["result"]
        self.assertEqual(value["piSessionCounts"], {"totalMessages": 7})
        self.assertFalse(value["authoritative"])
        self.assertNotIn("cost", value)


# Base regression cases are run once under PiRuntimeTests, not inherited twice.
for _name in tuple(runtime_tests.PiRuntimeTests.__dict__):
    if _name.startswith("test_") and _name not in PiWorkspaceTests.__dict__:
        setattr(PiWorkspaceTests, _name, None)
