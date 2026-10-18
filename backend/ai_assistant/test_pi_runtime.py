"""Synthetic Pi authority tests; no model, production or Docker calls."""
import base64
from datetime import timedelta
import hashlib
import json
import secrets
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from sales.auth import Principal
from access_control.models import AppUser
from . import pi_service as service, pi_gateway as gateway, pi_worker as worker, pi_exports
from .pi_models import PiSession, PiOperation, PiDispatch, PiEvent, PiFile, PiExport
from .policy import AiError, canonical, mutation
from . import tests as domain


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiRuntimeTests(TestCase):
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
        token = "isolated-capability-"+"x"*48
        with mutation():
            op.capability_hash = hashlib.sha256(token.encode()).hexdigest()
            op.capability_expires_at = timezone.now()+timedelta(hours=1)
            op.save()
        return op, token

    def request(self, op, token, **kwargs):
        return {**worker.identity(op), "kind": "model", "requestId": "gateway-1", "capability": token,
            "messages": [{"role": "user", "content": "合成测试"}], "tools": [], **kwargs}

    def test_public_queue_is_independent_and_refresh_is_read_only(self):
        session = self.session()
        result = self.prompt(session)
        self.assertEqual(result["operation"]["status"], "queued")
        self.assertEqual(result["operation"]["executionType"], "pi_rpc")
        self.assertEqual(result["operation"]["modelId"], self.model.id)
        before = (PiOperation.objects.count(), PiDispatch.objects.count(), PiEvent.objects.count())
        for _ in range(3):
            self.assertEqual(service.detail(session, self.owner)["session"]["activeOperationId"], result["operation"]["id"])
            service.events(session, {}, self.owner)
        self.assertEqual(before, (PiOperation.objects.count(), PiDispatch.objects.count(), PiEvent.objects.count()))
        self.assertEqual(domain.m.AiAgentJobs.objects.count(), 0)
        self.assertEqual(domain.m.AiWorkflowRuns.objects.count(), 0)

    def test_session_list_uses_latest_task_status_and_first_prompt_title(self):
        session = self.session()
        first = self.prompt(session, message="销售推广库存联合分析")
        result = service.listing({}, self.owner)["items"][0]
        self.assertEqual(result["title"], "销售推广库存联合分析")
        self.assertEqual(result["latestOperationStatus"], "queued")
        self.prompt(session, message="销售推广库存联合分析")
        with mutation():
            PiOperation.objects.filter(id=first["operation"]["id"]).update(status="succeeded")
            PiSession.objects.filter(pk=session).update(status="idle", active_operation_id="")
        self.assertEqual(service.listing({}, self.owner)["items"][0]["latestOperationStatus"], "succeeded")
        self.prompt(session, message="新范围的新任务", clientRequestId="new-scope-title", scope={"warehouses": [], "channels": [], "platforms": ["京东"]})
        self.assertEqual(service.detail(session, self.owner)["session"]["title"], "新范围的新任务")

    def test_pi_system_defaults_to_chinese_progress_and_downloadable_results(self):
        _, system = gateway.transcript({"messages": [{"role": "user", "content": "测试"}]}, self.model)
        self.assertIn("默认使用简体中文", system)
        self.assertIn("数据来源与截止日", system)
        self.assertIn("不把容器内部路径", system)

    def test_client_key_binds_body_and_active_operation_blocks_new_id(self):
        session = self.session()
        a = self.prompt(session)
        b = self.prompt(session)
        self.assertTrue(b["replayed"])
        self.assertEqual(a["operation"]["id"], b["operation"]["id"])
        for kwargs in ({"message": "不同正文"}, {"clientRequestId": "new-id"}):
            with self.assertRaises(AiError): self.prompt(session, **kwargs)
        self.assertEqual(PiOperation.objects.count(), 1)

    def test_owner_viewer_and_reader_reject(self):
        session = self.session()
        with self.assertRaises(AiError): service.detail(session, self.other)
        with self.assertRaises(AiError): self.session(self.viewer)
        with override_settings(DJANGO_PROCESS_ROLE="ai_reader"):
            response = self.call("/api/ai/pi/sessions", method="GET")
            self.assertEqual(response.status_code, 403)

    def test_actual_skill_resources_are_bound_to_run(self):
        values = service.skills()
        self.assertEqual(len(values), 3)
        result = self.prompt(skillIds=[values[0]["id"]])
        op = PiOperation.objects.get(id=result["operation"]["id"])
        self.assertEqual(json.loads(op.skills_json)[0]["sha256"], values[0]["sha256"])
        self.assertTrue(all("sizeBytes" in item for item in values[0]["resources"]))

    def test_file_passive_bytes_owner_hash_and_changed_scope_quarantine(self):
        session = self.session()
        data = base64.b64encode(b"safe,bytes\n1,2\n").decode()
        value = service.upload(session, {"clientRequestId": "f-1", "fileName": "合成.csv", "mimeType": "text/csv", "base64": data}, self.owner)["file"]
        self.assertEqual(value["clientRequestId"], "f-1")
        self.assertEqual(service.download(value["id"], self.owner, content=True)["base64"], data)
        with self.assertRaises(AiError): service.download(value["id"], self.other, content=True)
        narrower = {"warehouses": [], "channels": [], "platforms": ["京东"]}
        AppUser.objects.filter(email=self.owner.email).update(scope=narrower)
        actor = Principal(self.owner.email, "owner", self.owner.role, narrower)
        with self.assertRaises(AiError): service.download(value["id"], actor, content=True)
        self.assertEqual(PiSession.objects.get(pk=session).status, "frozen")

    def test_file_traversal_and_body_rebinding_reject(self):
        session = self.session()
        payload = {"clientRequestId": "f-1", "fileName": "a.txt", "mimeType": "text/plain", "base64": base64.b64encode(b"data").decode()}
        a = service.upload(session, payload, self.owner)
        self.assertEqual(service.upload(session, payload, self.owner), a)
        for change in ({"fileName": "../secret.txt"}, {"base64": base64.b64encode(b"changed").decode()}):
            with self.assertRaises(AiError): service.upload(session, {**payload, **change}, self.owner)
        with self.assertRaises(AiError): service.upload(session, {**payload, "fileName": " a.txt "}, self.owner)

    def test_event_byte_pages_keep_full_large_text_and_never_skip_cursor(self):
        session = self.session()
        value = "合成"*150000
        with mutation():
            row = PiSession.objects.select_for_update().get(pk=session)
            for index in range(3): service.event(row, "assistant_message", {"text": value, "part": index})
        seen, cursor = [], 0
        for _ in range(10):
            page = service.events(session, {"after": str(cursor)}, self.owner)
            seen.extend(page["items"])
            self.assertGreaterEqual(page["after"], cursor)
            cursor = page["after"]
            if not page["hasMore"]: break
        self.assertEqual([item["eventSeq"] for item in seen], [1, 2, 3, 4])
        self.assertEqual([len(item["data"]["text"]) for item in seen if item["type"] == "assistant_message"], [300000]*3)

    def test_abort_recovery_receipt_is_visible_in_get(self):
        session = self.session()
        self.prompt(session)
        result = service.abort(session, {"clientRequestId": "stop-1"}, self.owner)
        self.assertEqual(result["operation"]["status"], "canceled")
        self.assertEqual(service.detail(session, self.owner)["controlRequests"][0]["clientRequestId"], "stop-1")
        self.assertTrue(service.abort(session, {"clientRequestId": "stop-1"}, self.owner)["replayed"])

    def test_acknowledged_stop_rejects_each_new_gateway_kind_without_freezing_controls(self):
        op, token = self.running()
        service.abort(op.session_id, {"clientRequestId": "stop-new-work"}, self.owner)
        with patch.object(gateway, "_tool") as tool, patch.object(gateway, "_file") as file, patch.object(gateway, "_model") as model:
            for kind in ("tool", "file", "model"):
                with self.assertRaises(service.PiWorkCanceled):
                    gateway.execute(self.request(op, token, kind=kind, requestId="after-stop-"+kind), secrets.token_hex(16))
            self.assertFalse(tool.called or file.called or model.called)
        self.assertFalse(PiDispatch.objects.filter(operation=op, kind__in=["tool", "file", "model"]).exists())
        current = PiOperation.objects.get(pk=op.pk)
        service.principal_for(current)  # Abort and terminal observation remain authorized.
        self.assertEqual((current.status, PiSession.objects.get(pk=op.session_id).status), ("canceling", "canceling"))

    def test_stop_while_catalog_blocks_prevents_business_send_and_keeps_known_receipt(self):
        op, token = self.running()
        entry = {"name": "synthetic_read", "risk": "read_only"}
        def catalog(*args):
            self.assertEqual(PiDispatch.objects.get(operation=op, kind="tool").status, "sent")
            service.abort(op.session_id, {"clientRequestId": "stop-in-catalog"}, self.owner)
            return [entry], [entry]
        payload = self.request(op, token, kind="tool", name=entry["name"], args={})
        with patch.object(gateway, "catalog", side_effect=catalog), patch.object(gateway.transport, "execute_tool") as execute:
            with self.assertRaises(service.PiWorkCanceled): gateway.execute(payload, secrets.token_hex(16))
        self.assertFalse(execute.called)
        dispatch = PiDispatch.objects.get(operation=op, kind="tool")
        self.assertEqual((dispatch.status, dispatch.error_code), ("completed", "pi_operation_canceled"))
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceling")
        self.assertFalse(PiDispatch.objects.filter(operation=op, kind="control:freeze").exists())

    def test_known_tool_response_after_stop_is_saved_and_replayed_without_new_read(self):
        op, token = self.running()
        entry = {"name": "synthetic_read", "risk": "read_only"}
        def execute(*args, **kwargs):
            service.abort(op.session_id, {"clientRequestId": "stop-in-read"}, self.owner)
            return {"data": {"rows": ["already-admitted"]}, "auditStatus": "recorded"}
        payload = self.request(op, token, kind="tool", name=entry["name"], args={})
        with patch.object(gateway, "catalog", return_value=([entry], [entry])), patch.object(gateway.transport, "execute_tool", side_effect=execute) as read:
            result = gateway.execute(payload, secrets.token_hex(16))
            self.assertEqual(gateway.execute(payload, secrets.token_hex(16)), result)
        self.assertEqual(read.call_count, 1)
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="tool").status, "completed")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceling")

    def test_stop_during_model_catalog_prevents_provider_call_without_unknown(self):
        op, token = self.running()
        def catalog(*args):
            service.abort(op.session_id, {"clientRequestId": "stop-before-provider"}, self.owner)
            return [], []
        with patch.object(gateway, "catalog", side_effect=catalog), patch.object(gateway.provider, "turn") as post:
            with self.assertRaises(service.PiWorkCanceled): gateway.execute(self.request(op, token), secrets.token_hex(16))
            with self.assertRaises(service.PiWorkCanceled): gateway.execute(self.request(op, token), secrets.token_hex(16))
        self.assertFalse(post.called)
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="model").status, "completed")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceling")

    def test_stop_before_file_reader_does_not_fetch_new_bytes(self):
        op, token = self.running()
        real_file = gateway._file
        def before_reader(*args):
            service.abort(op.session_id, {"clientRequestId": "stop-before-file-reader"}, self.owner)
            return real_file(*args)
        with patch.object(gateway, "_file", side_effect=before_reader), patch.object(service, "download") as read:
            with self.assertRaises(service.PiWorkCanceled):
                gateway.execute(self.request(op, token, kind="file", fileId="file-not-read"), secrets.token_hex(16))
        self.assertFalse(read.called)
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="file").status, "completed")

    def test_new_work_rechecks_stop_after_background_authorization(self):
        op, _ = self.running()
        authorize = service.current_principal
        def background_check(*args, **kwargs):
            if kwargs.get("background"):
                service.abort(op.session_id, {"clientRequestId": "stop-during-authorization"}, self.owner)
            return authorize(*args, **kwargs)
        with patch.object(service, "current_principal", side_effect=background_check):
            with self.assertRaises(service.PiWorkCanceled): service.principal_for_work(op)
        self.assertEqual(PiSession.objects.get(pk=op.session_id).status, "canceling")

    def test_bridge_stop_between_requests_does_not_admit_remaining_list(self):
        op, token = self.running()
        entry = {"name": "synthetic_read", "risk": "read_only"}
        pending = [self.request(op, token, kind="tool", requestId=f"bridge-{index}", name=entry["name"], args={}) for index in range(2)]
        def execute(*args, **kwargs):
            service.abort(op.session_id, {"clientRequestId": "stop-in-bridge-first-call"}, self.owner)
            return {"data": {"rows": []}, "auditStatus": "recorded"}
        with patch.object(gateway, "catalog", return_value=([entry], [entry])), patch.object(gateway.transport, "execute_tool", side_effect=execute) as read, patch.object(worker, "runner_dispatch", return_value={}) as response:
            worker.bridge(op, {"pendingGatewayRequests": pending})
        self.assertEqual((read.call_count, response.call_count), (1, 1))
        self.assertEqual(list(PiDispatch.objects.filter(operation=op, kind="tool").values_list("request_id", flat=True)), ["bridge-0"])
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceling")

    def test_worker_prioritizes_abort_over_pending_bridge_and_continues_same_environment(self):
        op, token = self.running()
        commands = []
        def runner(operation, command, payload, **kwargs):
            commands.append(command)
            if command == "create": return {"status": "idle", "state": {"commands": []}}
            if command == "prompt":
                service.abort(op.session_id, {"clientRequestId": "stop-before-bridge"}, self.owner)
                return {"status": "running", "state": {"pendingGatewayRequests": [self.request(op, token, kind="tool")]}}
            self.assertEqual(command, "abort")
            return {"status": "aborted", "events": [{**worker.identity(op), "eventSeq": 1, "type": "agent_settled"}],
                "files": [], "filesCollected": True,
                "terminalReceipt": {"operationId": op.id, "status": "aborted", "eventSeq": 1, "files": []}}
        with patch.object(worker, "heartbeat"), patch.object(worker, "runner_dispatch", side_effect=runner), patch.object(worker, "bridge") as bridge, patch("ai_assistant.pi_transport.command", return_value={}) as transport:
            worker.perform(op)
        self.assertEqual(commands, ["create", "prompt", "abort"])
        self.assertFalse(bridge.called)
        self.assertEqual(transport.call_args.args[0]["command"], "ack")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceled")
        result = self.prompt(op.session_id, clientRequestId="continue-after-known-stop")
        self.assertEqual((result["operation"]["epoch"], result["operation"]["generation"]), (op.epoch, op.generation))

    def test_canceled_terminal_receipt_does_not_publish_new_runner_files_or_wait_for_exports(self):
        op, _ = self.running()
        with mutation():
            session = PiSession.objects.select_for_update().get(pk=op.session_id)
            prior = service.save_file(session, op, "before-stop", "existing.txt", "text/plain", b"keep", direction="output")
        export = PiExport.objects.create(id="cancel-queued-export", operation=op, request_digest="a"*64, query_json="{}")
        service.abort(op.session_id, {"clientRequestId": "stop-files"}, self.owner)
        worker.ingest(op, {"events": [{**worker.identity(op), "eventSeq": 1, "type": "agent_settled"}]})
        raw = b"late output"
        sha = hashlib.sha256(raw).hexdigest()
        self.assertTrue(worker.complete(op, {"status": "aborted", "filesCollected": True,
            "files": [{"fileName": "late.txt", "mimeType": "text/plain", "sha256": sha, "base64": base64.b64encode(raw).decode()}],
            "terminalReceipt": {"operationId": op.id, "status": "aborted", "eventSeq": 1, "files": [sha]}}))
        self.assertEqual(list(PiFile.objects.filter(operation=op).values_list("id", flat=True)), [prior.id])
        export.refresh_from_db()
        self.assertEqual((export.status, export.error_code), ("failed", "pi_operation_canceled"))
        self.assertEqual(PiSession.objects.get(pk=op.session_id).status, "idle")

    def test_cancel_during_startup_cannot_reserve_first_prompt(self):
        op, _ = self.running()
        with mutation():
            PiOperation.objects.filter(pk=op.pk).update(status="canceling", cancel_requested=True)
        with patch("ai_assistant.pi_transport.command") as send:
            with self.assertRaises(AiError) as failure: worker.runner_dispatch(op, "prompt", {"message": "must not dispatch"})
        self.assertEqual(failure.exception.code, "pi_canceled_before_prompt")
        self.assertFalse(send.called)
        self.assertFalse(PiDispatch.objects.filter(operation=op, kind="runner:prompt").exists())

    def test_unknown_cannot_be_bypassed_by_new_client_or_scope(self):
        op, _ = self.running()
        gateway.freeze(op, "synthetic_unknown")
        with self.assertRaises(AiError): self.prompt(op.session_id, clientRequestId="bypass")
        with self.assertRaises(AiError): self.prompt(op.session_id, clientRequestId="bypass2", scope={"warehouses": [], "channels": [], "platforms": []})
        self.assertEqual(PiOperation.objects.count(), 1)
        self.assertTrue(PiDispatch.objects.filter(operation=op, kind="control:freeze", status="prepared").exists())

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-private-model-cache-key-123456789"})
    def test_model_dispatch_precedes_post_and_completed_round_replays_private_cache(self):
        op, token = self.running()
        calls = []
        def model(*args):
            calls.append(PiDispatch.objects.get(operation=op, kind="model").status)
            return ({"message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "private-reasoning"}, {"type": "text", "text": "ok"}]}}, {"prompt_tokens": 7}, "provider-real-request-1")
        payload = self.request(op, token)
        with patch.object(gateway, "_model", side_effect=model):
            a = gateway.execute(payload, "a"*32)
            b = gateway.execute(payload, "b"*32)
        self.assertEqual(a, b)
        self.assertEqual(calls, ["sent"])
        dispatch = PiDispatch.objects.get(operation=op, kind="model")
        self.assertEqual(dispatch.provider_request_id, "provider-real-request-1")
        self.assertEqual(json.loads(dispatch.usage_json), {"prompt_tokens": 7})
        self.assertNotIn("private-reasoning", dispatch.response_json)

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-private-runner-cache-key-123456789"})
    def test_runner_snapshot_capability_and_thinking_are_not_plain_receipts(self):
        op, token = self.running()
        result = {**worker.identity(op), "status": "running", "pendingGatewayRequests": [{"capability": "synthetic-sensitive-capability"}],
            "events": [{"type": "thinking_delta", "delta": "synthetic-private-thinking"}]}
        with patch("ai_assistant.pi_transport.command", return_value=result) as post:
            first = worker.runner_dispatch(op, "create", {})
            second = worker.runner_dispatch(op, "create", {})
        self.assertEqual(first, second)
        self.assertEqual(post.call_count, 1)
        raw = PiDispatch.objects.get(operation=op, kind="runner:create").response_json
        self.assertNotIn("synthetic-sensitive-capability", raw)
        self.assertNotIn("synthetic-private-thinking", raw)

    def test_model_unknown_post_is_not_repeated(self):
        op, token = self.running()
        payload = self.request(op, token)
        with patch.object(gateway, "_model", side_effect=OSError("synthetic")) as model:
            with self.assertRaises(AiError): gateway.execute(payload, "c"*32)
            with self.assertRaises(AiError): gateway.execute({**payload, "requestId": "new-id"}, "d"*32)
        self.assertEqual(model.call_count, 1)
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "unknown")

    @patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "isolated-script-response-cache-key-123456789"})
    def test_real_provider_adapter_accepts_large_pi_code_for_both_protocols(self):
        from .test_dataset_chat import wire
        from .provider_contract import InvalidProviderResponse
        for protocol in ("openai_compatible", "anthropic"):
            self.model.protocol = protocol
            self.model.save(update_fields=["protocol"])
            op, token = self.running(clientRequestId="large-code-"+protocol)
            for index, name in enumerate(("write", "bash", "edit")):
                args = {"content" if name == "write" else "command" if name == "bash" else "newText": "print('合成脚本')\n"*1800}
                offered = [{"name": name, "description": "synthetic", "inputSchema": {"type": "object"}}]
                response = wire(protocol, name, args)
                with patch.object(gateway, "catalog", return_value=([], [])), patch.object(gateway.provider, "decrypt", return_value="synthetic"), patch.object(gateway.provider, "bounded_json", return_value=response) as post:
                    # The old, ordinary-tool path reproduces the same failure
                    # class seen in production; it must remain bounded.
                    with self.assertRaises(InvalidProviderResponse) as failure:
                        gateway.provider.turn(self.model, [], "fixture", offered)
                    self.assertEqual(failure.exception.diagnostics["reason"], "tool_arguments_bounds")
                    result = gateway.execute(self.request(op, token, requestId=f"code-{index}", tools=offered), secrets.token_hex(16))
                    self.assertEqual(result["message"]["content"][0]["arguments"], args)
                    self.assertEqual(post.call_count, 2)  # No automatic POST retry.
            with mutation():
                PiOperation.objects.filter(pk=op.pk).update(status="succeeded")
                PiSession.objects.filter(pk=op.session_id).update(status="idle", active_operation_id="")

    def test_pi_large_code_budget_cannot_widen_business_or_unoffered_tools(self):
        from .test_dataset_chat import wire
        from .provider_contract import InvalidProviderResponse
        for protocol in ("openai_compatible", "anthropic"):
            self.model.protocol = protocol
            for name, offered, limits, args in (
                ("query_system_dataset", [{"name": "query_system_dataset", "description": "synthetic", "inputSchema": {"type": "object"}}], {"write": gateway.LOCAL_ARGUMENT_BYTES}, {"query": "x"*9000}),
                ("write", [], {"write": gateway.LOCAL_ARGUMENT_BYTES}, {"content": "x"*9000}),
                ("write", [{"name": "write", "description": "synthetic", "inputSchema": {"type": "object", "maxLength": 99999999}}], {}, {"content": "x"*9000}),
                ("write", [{"name": "write", "description": "synthetic", "inputSchema": {"type": "object"}}], {"write": gateway.LOCAL_ARGUMENT_BYTES}, {"content": "x"*gateway.LOCAL_ARGUMENT_BYTES}),
                ("write", [{"name": "write", "description": "synthetic", "inputSchema": {"type": "object"}}], {"write": gateway.LOCAL_ARGUMENT_BYTES}, {"__proto__": "x"}),
            ):
                with patch.object(gateway.provider, "decrypt", return_value="synthetic"), patch.object(gateway.provider, "bounded_json", return_value=wire(protocol, name, args)), self.assertRaises(InvalidProviderResponse):
                    gateway.provider.turn(self.model, [], "fixture", offered, tool_argument_limits=limits)

    def test_provider_diagnostics_survive_duplicate_freeze_and_refresh_without_replay(self):
        from .provider_contract import InvalidProviderResponse
        op, token = self.running()
        payload = self.request(op, token)
        error = InvalidProviderResponse("tool_arguments_bounds", stage="tool_calls", protocol="openai_compatible", mode="json")
        error.diagnostics["privatePayload"] = "synthetic-secret-never-persist"
        with patch.object(gateway, "_model", side_effect=error) as model:
            with self.assertRaises(AiError): gateway.execute(payload, secrets.token_hex(16))
            gateway.freeze(op, "pi_worker_unknown")  # The worker catches the same error.
            with self.assertRaises(AiError): gateway.execute(payload, secrets.token_hex(16))
            self.assertEqual(model.call_count, 1)
        row = PiOperation.objects.get(pk=op.pk)
        self.assertEqual((row.status, row.error_code), ("unknown", "invalid_provider_response"))
        record = PiDispatch.objects.get(operation=op, kind="model")
        self.assertNotIn("synthetic-secret", record.response_json)
        self.assertEqual(json.loads(record.response_json)["responseDiagnostics"]["reason"], "tool_arguments_bounds")
        errors = [item for item in service.events(op.session_id, {}, self.owner)["items"] if item["type"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["data"]["responseDiagnostics"]["reason"], "tool_arguments_bounds")
        self.assertNotIn("privatePayload", errors[0]["data"]["responseDiagnostics"])
        self.assertEqual(service.detail(op.session_id, self.owner)["operations"][0]["errorCode"], "invalid_provider_response")

    def test_model_transport_cancel_guard_reads_user_abort_while_in_flight(self):
        op, token = self.running()
        def active_round(*args, **kwargs):
            PiOperation.objects.filter(pk=op.pk).update(cancel_requested=True, status="canceling")
            check = gateway.transport._cancel_check.get()
            self.assertIsNotNone(check)
            check()
        with patch.object(gateway, "catalog", return_value=([], [])), patch.object(gateway.provider, "turn", side_effect=active_round) as turn:
            with self.assertRaises(AiError) as failure: gateway.execute(self.request(op, token), "2"*32)
        self.assertEqual(failure.exception.code, "pi_canceled_during_dispatch")
        self.assertEqual(turn.call_count, 1)
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "unknown")

    def test_deadline_is_persistent_and_not_reset_for_new_gateway_request(self):
        op, token = self.running()
        record = PiDispatch.objects.get(operation=op, kind="control:deadline")
        original = json.loads(record.response_json)
        future = timezone.now()+timedelta(milliseconds=original["taskTimeoutMs"]+1)
        with patch.object(gateway.timezone, "now", return_value=future), patch.object(gateway, "_model") as model:
            with self.assertRaises(AiError): gateway.execute(self.request(op, token, requestId="late-new-round"), "1"*32)
        self.assertFalse(model.called)
        self.assertEqual(PiDispatch.objects.get(pk=record.pk).response_json, record.response_json)

    def test_export_tool_cannot_read_another_operation_manifest(self):
        op_a, _ = self.running()
        row = PiExport.objects.create(id="other-op-export", operation=op_a, request_digest="a"*64, query_json="{}")
        op_b, token = self.running(session_id=self.session())
        with patch.object(gateway.transport, "execute_tool") as execute:
            with self.assertRaises(AiError): gateway._tool({"name": "get_pi_dataset_export", "args": {"exportId": row.id}}, op_b, self.owner)
        self.assertFalse(execute.called)

    def test_different_model_id_cannot_bypass_an_in_flight_dispatch(self):
        op, token = self.running()
        with mutation():
            PiDispatch.objects.create(id="model-in-flight", operation=op, kind="model", request_id="original-round", request_digest="a"*64, status="sent")
        with patch.object(gateway, "_model") as model:
            with self.assertRaises(AiError): gateway.execute(self.request(op, token, requestId="bypass-in-flight"), "0"*32)
        self.assertFalse(model.called)

    def test_capability_rejects_foreign_identity_and_revoked_principal(self):
        op, token = self.running()
        with self.assertRaises(AiError): gateway.execute(self.request(op, token, generation=op.generation+1), "e"*32)
        AppUser.objects.filter(email=self.owner.email).update(status="disabled")
        with self.assertRaises(AiError): gateway.execute(self.request(op, token), "f"*32)
        self.assertEqual(PiSession.objects.get(pk=op.session_id).status, "frozen")
        self.assertFalse(PiDispatch.objects.filter(operation=op, kind="model").exists())

    def test_agent_end_does_not_finish_and_settled_does(self):
        op, token = self.running()
        self.assertFalse(worker.ingest(op, {"events": [{**worker.identity(op), "eventSeq": 1, "type": "agent_end"}]}))
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "running")
        self.assertTrue(worker.ingest(op, {"events": [{**worker.identity(op), "eventSeq": 2, "type": "agent_settled"}]}))
        self.assertFalse(worker.complete(op, {"status": "settling", "files": []}))
        self.assertTrue(worker.complete(op, {"status": "settled", "files": [], "filesCollected": True,
            "terminalReceipt": {"operationId": op.id, "status": "settled", "eventSeq": 2, "files": []}}))
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "succeeded")

    def test_late_old_owner_check_or_freeze_cannot_quarantine_finished_session(self):
        op, _ = self.running()
        worker.ingest(op, {"events": [{**worker.identity(op), "eventSeq": 1, "type": "agent_settled"}]})
        self.assertTrue(worker.complete(op, {"status": "settled", "files": [], "filesCollected": True,
            "terminalReceipt": {"operationId": op.id, "status": "settled", "eventSeq": 1, "files": []}}))
        with self.assertRaises(AiError): service.principal_for(op)  # Heartbeat's stale in-memory op.
        gateway.freeze(op, "late-observer")
        self.assertEqual(PiSession.objects.get(pk=op.session_id).status, "idle")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "succeeded")
        result = self.prompt(op.session_id, clientRequestId="next-same-environment")
        self.assertEqual(result["operation"]["generation"], op.generation)

    def test_expired_worker_is_frozen_instead_of_reclaimed(self):
        op, _ = self.running()
        PiOperation.objects.filter(pk=op.pk).update(lease_expires_at=timezone.now()-timedelta(seconds=1))
        self.assertIsNone(worker.claim())
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "unknown")

    def test_pi_export_accepts_over_2000_with_full_manifest(self):
        actor = self.user("pi-admin@example.invalid", "admin", None)
        op, _ = self.running(actor=actor)
        row = pi_exports.consumer({"operation": "pi-export-start", "sessionId": op.session_id, "dataset": "pi_netshop_promotion", "queryJson": canonical({"platform": "京东", "shop": "合成店", "limit": 20})}, actor, "export-1")
        def page(dataset, body, principal, request_id, **kwargs):
            query = body["query"]
            p = query.get("page", 1)
            rows = [{"id": (p-1)*20+i, "amount": i} for i in range(min(20, 2005-(p-1)*20))]
            return {"source": {"domain": "netshop"}, "dataCutoffDate": "2026-10-16", "queriedAt": timezone.now().isoformat(), "data": {
                "items": rows, "pagination": {"page": p, "pageSize": 20, "total": 2005, "returned": len(rows), "hasMore": p*20<2005},
                "sourceRevision": "fixture-v1", "units": {"amount": "CNY_cents"}, "filtersApplied": {"platforms": ["京东"], "shop": "合成店"}}}
        with patch.object(pi_exports.datasets, "query", side_effect=page):
            pi_exports.perform(PiExport.objects.get(pk=row["id"]))
        result = PiExport.objects.get(pk=row["id"])
        self.assertEqual(result.status, "succeeded")
        manifest = json.loads(result.manifest_json)
        self.assertEqual(manifest["rows"], 2005)
        self.assertTrue(manifest["complete"])
        self.assertEqual(manifest["domainRevisions"], ["fixture-v1"])
        self.assertEqual(len(json.loads(bytes(result.file.payload))["rows"]), 2005)

    def test_pi_export_rejects_top_and_changing_revision(self):
        op, _ = self.running()
        with self.assertRaises(AiError): pi_exports.consumer({"operation": "pi-export-start", "sessionId": op.session_id, "dataset": "market_overview", "queryJson": "{}"}, self.owner, "top")
        data = {"pagination": {"page": 2, "pageSize": 20, "total": 21, "returned": 1, "hasMore": False}, "sourceRevision": "v2"}
        with self.assertRaises(AiError): pi_exports.pi_page(data, [{"id": 21}], {"page": 2, "limit": 20}, 21, "v1")

    def test_export_stop_during_first_page_blocks_future_reads_and_final_file(self):
        actor = self.user("export-cancel@example.invalid", "admin", None)
        op, _ = self.running(actor=actor)
        row = pi_exports.consumer({"operation": "pi-export-start", "sessionId": op.session_id, "dataset": "pi_netshop_promotion",
            "queryJson": canonical({"platform": "京东", "shop": "合成店", "limit": 20})}, actor, "cancel-paged-export")
        reads = []
        def page(dataset, body, principal, request_id, **kwargs):
            p = body["query"].get("page", 1)
            reads.append(p)
            service.abort(op.session_id, {"clientRequestId": "stop-in-first-page"}, actor)
            return {"source": {"domain": "netshop"}, "dataCutoffDate": "2026-10-16", "data": {
                "items": [{"id": i} for i in range(20)], "sourceRevision": "fixture-v1",
                "pagination": {"page": p, "pageSize": 20, "total": 41, "returned": 20, "hasMore": True},
                "filtersApplied": {"platforms": ["京东"], "shop": "合成店"}}}
        with patch.object(pi_exports.datasets, "query", side_effect=page):
            pi_exports.perform(PiExport.objects.get(pk=row["id"]))
        result = PiExport.objects.get(pk=row["id"])
        self.assertEqual(reads, [1])
        self.assertEqual((result.status, result.error_code, result.file_id), ("failed", "pi_operation_canceled", None))
        self.assertFalse(PiFile.objects.filter(operation=op).exists())
        self.assertEqual(PiDispatch.objects.get(operation=op, kind="export:page").status, "completed")
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceling")

    def test_export_stop_after_last_page_prevents_manifest_publication(self):
        actor = self.user("export-finalize-cancel@example.invalid", "admin", None)
        op, _ = self.running(actor=actor)
        row = pi_exports.consumer({"operation": "pi-export-start", "sessionId": op.session_id, "dataset": "pi_netshop_promotion",
            "queryJson": canonical({"platform": "京东", "shop": "合成店", "limit": 20})}, actor, "cancel-final-export")
        result = {"source": {"domain": "netshop"}, "dataCutoffDate": "2026-10-16", "data": {
            "items": [{"id": 1}], "sourceRevision": "fixture-v1", "units": {"id": "identifier"},
            "pagination": {"page": 1, "pageSize": 20, "total": 1, "returned": 1, "hasMore": False},
            "filtersApplied": {"platforms": ["京东"], "shop": "合成店"}}}
        original_digest = pi_exports.digest
        def before_manifest(value):
            if isinstance(value, list):
                from .pi_models import PiExportPage
                self.assertEqual(PiExportPage.objects.filter(export_id=row["id"]).count(), 1)
                service.abort(op.session_id, {"clientRequestId": "stop-before-manifest"}, actor)
            return original_digest(value)
        with patch.object(pi_exports.datasets, "query", return_value=result), patch.object(pi_exports, "digest", side_effect=before_manifest):
            pi_exports.perform(PiExport.objects.get(pk=row["id"]))
        export = PiExport.objects.get(pk=row["id"])
        self.assertEqual((export.status, export.error_code, export.file_id, export.manifest_json), ("failed", "pi_operation_canceled", None, "{}"))
        self.assertFalse(PiFile.objects.filter(operation=op).exists())

    def test_late_export_failure_cannot_replace_acknowledged_cancel_reason(self):
        actor = self.user("export-late-failure@example.invalid", "admin", None)
        op, _ = self.running(actor=actor)
        row = pi_exports.consumer({"operation": "pi-export-start", "sessionId": op.session_id, "dataset": "pi_netshop_promotion",
            "queryJson": canonical({"platform": "京东", "shop": "合成店", "limit": 20})}, actor, "late-export-failure")
        def page(*args, **kwargs):
            service.abort(op.session_id, {"clientRequestId": "stop-before-late-error"}, actor)
            raise AiError("合成迟到错误", "synthetic_late_error", 503)
        with patch.object(pi_exports.datasets, "query", side_effect=page): pi_exports.perform(PiExport.objects.get(pk=row["id"]))
        export = PiExport.objects.get(pk=row["id"])
        self.assertEqual((export.status, export.error_code), ("failed", "pi_operation_canceled"))
        self.assertEqual(PiOperation.objects.get(pk=op.pk).status, "canceling")

    def test_database_unique_active_fence(self):
        op, _ = self.running()
        with self.assertRaises(IntegrityError), transaction.atomic():
            PiOperation.objects.create(id="duplicate-active", session_id=op.session_id, client_request_id="other", request_digest="a"*64,
                epoch=op.epoch, generation=op.generation, seq=op.seq+1, actor_role=op.actor_role, scope_json=op.scope_json)

    def test_pi_context_is_not_silently_shortened_and_legacy_default_stays(self):
        from . import provider
        self.model.generation_options_json = canonical({"contextWindowTokens": 10000})
        self.model.max_tokens = 1000
        history = [{"role": "user", "content": "x"*18000}, {"role": "assistant", "content": "old"}, {"role": "user", "content": "new"}]
        result = {"id": "synthetic-provider-id", "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}], "usage": {}}
        with patch.object(provider, "decrypt", return_value="synthetic"), patch.object(provider, "bounded_json", return_value=result) as post:
            legacy = provider.turn(self.model, history, "system", [])
            self.assertEqual(legacy["context"]["droppedMessages"], 2)
            self.assertEqual(post.call_count, 1)
            with self.assertRaises(AiError): provider.turn(self.model, history, "system", [], preserve_context=True)
            self.assertEqual(post.call_count, 1)

    def test_cross_protocol_or_model_frames_rebuild_public_history(self):
        from types import SimpleNamespace
        anthropic = SimpleNamespace(id="anthropic-config", version=1, protocol="anthropic")
        original = {"role": "assistant", "content": [{"type": "thinking", "thinking": "private", "signature": "opaque"}, {"type": "text", "text": "visible"}]}
        envelope = {"version": 1, "protocol": "anthropic", "modelConfigId": anthropic.id, "modelVersion": 1, "frame": original}
        payload = {"messages": [{"role": "assistant", "content": "visible", "reasoning_content": "do-not-carry", "providerFrame": envelope}]}
        matching, _ = gateway.transcript(payload, anthropic)
        self.assertEqual(matching[0], original)
        switched, _ = gateway.transcript(payload, self.model)
        self.assertEqual(switched[0], {"role": "assistant", "content": "visible"})
        openai = {"version": 1, "protocol": self.model.protocol, "modelConfigId": self.model.id, "modelVersion": self.model.version,
            "frame": {"role": "assistant", "content": "visible", "reasoning_content": "private"}}
        payload["messages"][0]["providerFrame"] = openai
        switched, _ = gateway.transcript(payload, anthropic)
        self.assertEqual(switched[0]["content"], [{"type": "text", "text": "visible"}])

    def test_bad_queued_model_does_not_poison_other_sessions(self):
        first = self.prompt()
        self.model.status = "disabled"
        self.model.save(update_fields=["status"])
        self.assertIsNone(worker.claim())
        self.assertEqual(PiOperation.objects.get(pk=first["operation"]["id"]).status, "failed")
        self.model.status = "enabled"
        self.model.save(update_fields=["status"])
        second = self.prompt()
        self.assertEqual(worker.claim().id, second["operation"]["id"])

    def test_large_configured_deadline_does_not_overflow_datetime(self):
        self.model.generation_options_json = canonical({"taskTimeoutMs": 2**53-1})
        self.model.save(update_fields=["generation_options_json"])
        self.prompt()
        op = worker.claim()
        self.assertGreater(gateway.remaining_seconds(op), 1000000000)

    def test_generic_passive_files_and_nested_outputs_keep_identity(self):
        session = self.session()
        result = service.upload(session, {"clientRequestId": "js-input", "fileName": "data.js", "mimeType": "application/javascript",
            "base64": base64.b64encode(b"synthetic passive bytes").decode()}, self.owner)
        self.assertEqual(result["file"]["mimeType"], "application/octet-stream")
        op, _ = self.running(session_id=session)
        with mutation():
            locked = PiSession.objects.select_for_update().get(pk=session)
            file = service.save_file(locked, op, "nested-js", "nested/data.js", "application/javascript", b"passive", direction="output")
        self.assertTrue(file.file_name.endswith("-data.js"))
        self.assertEqual(json.loads(file.manifest_json)["sourcePath"], "nested/data.js")
        with mutation():
            second = service.save_file(locked, op, "nested-js-other", "other/data.js", "application/javascript", b"passive", direction="output")
        self.assertNotEqual(file.file_name, second.file_name)
