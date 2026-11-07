"""The private W12 cycle uses owning PostgreSQL facts and the original ledgers."""
import json
import os
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from django.db import DatabaseError, transaction
from django.test import TestCase, override_settings

from inventory.import_service import SCOPE_KEYS
from inventory.models import InventoryImportBatch, InventoryImportFingerprint, InventoryOperatingSettings, InventoryStockLine
from inventory.revisions import bump_revision
from netshop.sales_client import sales_alias
from sales.models import SalesDataRevision, SalesImportBatch, SalesImportFingerprint, SalesImportScopeHead
from sales.tests.factories import make_line
from sales.write_service import SALES_IMPORT_SOURCE, _scope_key

from . import dingtalk, dingtalk_transport, pi_gateway, pi_native, pi_service, pi_worker, task_definitions, task_dispatch, transport
from . import tests as domain
from .dingtalk_models import AiDingTalkReceipt, AiDingTalkScheduleRun
from .pi_models import PiDispatch, PiOperation
from .policy import AiError, digest
from .secrets import encrypt
from .task_daily_cycle import approve, require_isolated
from .task_daily_sources import INVENTORY, SALES, SHOP
from .task_models import TaskDefinition, TaskGrant, TaskRun


class UnifiedTaskDailyCycle(TestCase):
    user = domain.AiDomainTests.user
    now = datetime(2026, 11, 8, 1, 5, tzinfo=UTC)
    day = date(2026, 11, 7)
    text = "ERP 本店净销量和全部计入库存的仓可用量请分别解读。"

    def setUp(self):
        try:
            require_isolated()
        except AiError:
            self.skipTest("requires disposable rehearsal PostgreSQL")
        domain.AiDomainTests.setUp(self)
        self.owner = self.user("w12-owner@example.invalid", "admin", None)
        self.other = self.user("w12-other@example.invalid", "admin", None)
        self.model.api_key_encrypted = encrypt("isolated-synthetic-model-key")
        self.model.save(update_fields=["api_key_encrypted"])
        for target in ("socket.create_connection", "socket.getaddrinfo", "urllib.request.urlopen", "ai_assistant.transport.edge"):
            guard = patch(target, side_effect=AssertionError("real network is forbidden"))
            guard.start()
            self.addCleanup(guard.stop)
        clock = patch("django.utils.timezone.now", return_value=self.now)
        clock.start()
        self.addCleanup(clock.stop)
        self.sender = "w12-isolated-owner"
        self.config = {"version": 1, "enabled": True, "profile": "w12-isolated-corp:fixture", "corpId": "w12-isolated-corp",
            "unifiedAppId": "w12-isolated-app", "robotCode": "w12-isolated-robot", "robotName": "志高助手", "groups": [],
            "bindings": [{"senderId": self.sender, "ownerEmail": self.owner.email, "role": "admin", "scope": None}]}
        key = dingtalk.accept(self.config, {"robotCode": self.config["robotCode"], "senderCorpId": self.config["corpId"],
            "senderStaffId": self.sender, "conversationType": "1", "conversationId": "w12-isolated-conversation", "msgtype": "text",
            "msgId": "w12-isolated-ingress", "text": {"content": "仅供隔离本人绑定"}, "createAt": int(self.now.timestamp() * 1000)})
        self.channel = AiDingTalkReceipt.objects.select_related("session").get(pk=key).session
        skill = pi_service.skills()[0]
        self.spec = {"skill": {"kind": "bundled", "id": skill["id"], "version": skill["version"], "digest": skill["sha256"]},
            "prompt": "请用固定任务上下文里的冻结 ERP 与库存事实撰写经营日报，两种来源分开说明。",
            "shopSelection": SHOP, "modelId": self.model.id, "modelVersion": self.model.version,
            "trigger": {"kind": "time", "timezone": "Asia/Shanghai", "cadence": "daily", "hour": 9, "minute": 0, "day": 1, "windowSeconds": 3600},
            "dataDependencies": [{"dataset": SALES, "dayOffset": 1, "requiredFields": ["sales_amount_cents", "quantity"]},
                                 {"dataset": INVENTORY, "dayOffset": 1, "requiredFields": ["included_warehouse_quantity"]}],
            "deliveryTargets": [{"connector": "dingtalk", "targetType": "person", "targetId": self.sender, "senderId": self.sender}],
            "missedPolicy": "wait_for_data_until_deadline", "parameters": {}}
        self.task = self.save_task(self.spec)
        for kind in ("sales", "erp"):
            SalesDataRevision.objects.update_or_create(domain=kind, defaults={"revision": 1, "source_digest": "a" * 64})
        InventoryOperatingSettings.objects.get_or_create(id=1)
        self.model_calls, self.delivery_calls = [], []

    def save_task(self, spec, key="w12-only-daily"):
        return task_definitions.save({"clientRequestId": key, "name": "隔离经营日报", "spec": spec}, self.owner)["item"]

    def approve(self):
        return approve(self.task["id"], self.task["version"], self.owner, self.channel, self.config)

    def publish_sales(self, *, mixed_identity=False):
        alias = sales_alias(SHOP["platform"], SHOP["shop"])
        channel, raw_shop = alias["rawChannel"], alias["rawShopName"]
        batch = SalesImportBatch.objects.create(id="w12-erp-batch", source=SALES_IMPORT_SOURCE, file_name="synthetic.xlsx",
            file_size_bytes=1, file_hash="b" * 64, sheet_name="synthetic", status="completed", row_count=5,
            created_at=self.now.isoformat(), completed_at=self.now.isoformat(), scope_key=_scope_key(), published_state_token="c" * 64,
            content_hash="a" * 64, raw_file_hash="b" * 64,
            scope_json={"source": "sales_ledger", "startDate": self.day.isoformat(), "endDate": (self.day + timedelta(days=1)).isoformat()})
        SalesImportFingerprint.objects.create(domain="sales", batch_id=batch.id, scope_key=batch.scope_key, scope_json=batch.scope_json,
            import_hash=batch.file_hash, raw_file_hash=batch.raw_file_hash, content_hash=batch.content_hash, row_count=batch.row_count,
            status="completed", publication_sequence=1)
        SalesImportScopeHead.objects.update_or_create(pk=_scope_key(), defaults={"status": "ready", "current_batch_id": batch.id,
            "state_token": batch.published_state_token, "generation": 1})
        for number, amount, quantity, shop, row_channel, warehouse, ship in [
            (201, 20000, 5, raw_shop, channel, "广东仓", "2026-11-07 10:00:00"),
            (202, -3000, -1, raw_shop, channel, "广东仓", "2026-11-07 11:00:00"),
            (203, 90000, 90, "其他店铺", channel if mixed_identity else "其他渠道", "广东仓", "2026-11-07 12:00:00"),
            (204, 99000, 99, raw_shop, channel, "刷刷仓", "2026-11-07 13:00:00"),
            (205, 98000, 98, raw_shop, channel, "广东仓", "2026-11-08 00:00:00")]:
            make_line(number, "w12-" + str(number), shop_name=shop, channel=row_channel, warehouse=warehouse,
                ship_time=ship, line_ship_time=ship, allocated_amount_cents=amount, quantity=quantity,
                last_import_batch_id=batch.id, first_import_batch_id=batch.id).save()
        SalesDataRevision.objects.filter(domain="sales").update(revision=2)

    def publish_inventory(self, *, day=None):
        snapshot = day or self.day
        batch = InventoryImportBatch.objects.create(id="w12-stock-batch", dataset="stock", source="synthetic", file_name="synthetic.xlsx",
            file_size_bytes=1, file_hash="d" * 64, raw_file_hash="e" * 64, content_hash="f" * 64, scope_key=SCOPE_KEYS["stock"],
            sheet_name="synthetic", snapshot_date=snapshot, row_count=4, status="completed", completed_at=self.now, published_state_token="c" * 64)
        InventoryImportFingerprint.objects.create(dataset="stock", batch_id=batch.id, scope_key=batch.scope_key,
            scope_json={"dataset": "stock", "snapshotDate": snapshot.isoformat()}, raw_file_hash=batch.raw_file_hash,
            import_hash=batch.file_hash, content_hash=batch.content_hash, row_count=batch.row_count, published_state_token=batch.published_state_token)
        for number, warehouse, qty in [(1, "广东仓", 30), (2, "合成自营仓", 25), (3, "刷刷仓", 500), (4, "一个小太阳仓", 700)]:
            InventoryStockLine.objects.create(batch_id=batch.id, row_key=str(number), source_row_number=number,
                snapshot_date=snapshot, warehouse=warehouse, product_code="fixture-product", available_quantity=qty)
        bump_revision({"fixture": "w12-stock-batch"})

    def run_model(self, cycle, run):
        op = pi_worker.claim()
        self.assertEqual(op.id, run.operation_id)

        def provider_wire(url, body, headers, **kwargs):
            self.model_calls.append(url)
            self.assertEqual(body["model"], "fixture")
            self.assertIn('"sales_amount_cents":17000', body["messages"][-1]["content"])
            self.assertIn('"included_warehouse_quantity":55', body["messages"][-1]["content"])
            return {"id": "w12-synthetic-model-receipt", "choices": [{"finish_reason": "stop", "message": {"content": self.text}}],
                "usage": {"prompt_tokens": 80, "completion_tokens": 22, "total_tokens": 102}}

        def submit(original, model_request_id):
            self.assertEqual(original.id, op.id)
            token = pi_worker.gateway_capability(original)["capability"]
            request = {**pi_worker.identity(original), "kind": "model", "requestId": model_request_id, "capability": token,
                "messages": [{"role": "user", "content": json.loads(original.payload_json)["message"]}], "tools": [],
                "admission": pi_native.admission(original)}
            result = pi_gateway.execute(request, "w12-synthetic-nonce-one")
            self.assertEqual(pi_gateway.execute(request, "w12-synthetic-nonce-two"), result)
            return result

        with patch("ai_assistant.transport.catalog", return_value=[]), patch("ai_assistant.provider.bounded_json", side_effect=provider_wire):
            result = cycle.generate(run.id, submit)
            with self.assertRaises(AiError):
                cycle.generate(run.id, lambda *args: self.fail("original model reservation must not be replayed"))
        answer = result["message"]["content"][0]["text"]
        self.assertTrue(pi_worker.ingest(op, {"events": [
            {"eventSeq": 1, "operationId": op.id, "seq": op.seq, "type": "assistant_message", "data": {"text": answer}},
            {"eventSeq": 2, "operationId": op.id, "seq": op.seq, "type": "agent_settled", "data": {}}]}))
        self.assertTrue(pi_worker.complete(op, {"status": "settled", "filesCollected": True, "files": [],
            "terminalReceipt": {"operationId": op.id, "status": "settled", "eventSeq": 2, "files": []}}))
        return cycle.preview(run.id, self.owner)

    def send(self, cycle, run, preview, *, lost=False, rejected=False, disable_before=False, disable_after=False):
        def connector_wire(url, body, **kwargs):
            if url == dingtalk_transport.TOKEN_API:
                if disable_before:
                    task_definitions.control(self.task["id"], {"expectedVersion": self.task["version"]}, self.owner, "disable")
                return {"accessToken": "isolated-token"}
            self.assertEqual(url, dingtalk_transport.PERSON_MEDIA_API)
            self.assertEqual(body["userIds"], [self.sender])
            if hasattr(transport, "commit_provider_send"):
                transport.commit_provider_send()
            self.assertTrue(TaskRun.objects.get(pk=run.id).execution_ref)
            self.delivery_calls.append(digest(body))
            if disable_after:
                task_definitions.control(self.task["id"], {"expectedVersion": self.task["version"]}, self.owner, "disable")
            if lost:
                raise OSError("synthetic lost response after write boundary")
            if rejected:
                return {"invalidStaffIdList": [self.sender]}
            return {"processQueryKey": "isolated-accepted-receipt", "invalidStaffIdList": []}

        with patch("ai_assistant.dingtalk_transport.credentials", return_value=("isolated-app", "isolated-secret")), patch(
            "ai_assistant.dingtalk_transport.media_addresses", return_value=["192.0.2.1"]), patch(
            "ai_assistant.transport._bounded_json", side_effect=connector_wire):
            return cycle.deliver_once(run.id, self.owner, preview["approvalDigest"], self.channel, lambda: self.config, dingtalk_transport.send)

    def test_one_cycle_freezes_sources_then_delivers_once_and_stops(self):
        cycle = self.approve()
        self.assertEqual(cycle, self.approve())
        self.assertEqual(cycle.tick("w12-worker").status, "waiting_data")
        self.assertEqual(PiOperation.objects.count(), 0)
        self.publish_sales()
        self.publish_inventory()
        run = cycle.tick("w12-worker")
        self.assertEqual(cycle.tick("w12-other-worker").operation_id, run.operation_id)
        self.assertEqual(PiOperation.objects.count(), 1)
        preview = self.run_model(cycle, run)
        self.assertIn("净销售额 17000 分，净销量 4", preview["text"])
        with self.assertRaises(AiError):
            cycle.preview(run.id, self.other)
        with self.assertRaises(AiError):
            cycle.deliver_once(run.id, self.owner, "invalid-confirmation", self.channel, lambda: self.config,
                lambda *a, **k: self.fail("must not send unapproved text"))
        result = self.send(cycle, run, preview, disable_after=True)
        self.assertEqual((result.status, result.report_status, result.delivery_status), ("succeeded", "ready", "sent"))
        with self.assertRaises(AiError):
            cycle.tick("w12-worker")
        with self.assertRaises(AiError):
            replace(cycle, slot=cycle.slot + timedelta(days=1)).tick("w12-worker")
        self.assertFalse(TaskDefinition.objects.get(pk=self.task["id"]).enabled)
        self.assertIsNone(TaskDefinition.objects.get(pk=self.task["id"]).next_run_at)
        self.assertIsNotNone(TaskGrant.objects.get(pk=cycle.grant_id).revoked_at)
        self.assertEqual((TaskRun.objects.count(), len(self.model_calls), len(self.delivery_calls), AiDingTalkScheduleRun.objects.count()), (1, 1, 1, 0))
        evidence = {"sourceBindings": preview["sourceBindings"], "runId": result.id, "revisionId": result.revision_id,
            "operationId": result.operation_id, "grantId": result.grant_id, "modelDispatchId": preview["dispatchId"],
            "delivery": json.loads(result.delivery_receipts_json), "modelCalls": 1, "recipientPostCalls": 1,
            "legacyScheduleRuns": 0, "newTicksAfterDisable": 0, "externalCalls": 0,
            "w8SendFenceExecuted": hasattr(transport, "commit_provider_send")}
        if os.getenv("W12_EVIDENCE_DIR"):
            (Path(os.environ["W12_EVIDENCE_DIR"]) / "CYCLE.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def test_lost_response_is_unknown_and_never_resent(self):
        self.publish_sales()
        self.publish_inventory()
        cycle = self.approve()
        run = cycle.tick("w12-worker")
        preview = self.run_model(cycle, run)
        result = self.send(cycle, run, preview, lost=True)
        self.assertEqual((result.status, result.delivery_status), ("unknown", "unknown"))
        self.assertEqual(cycle.tick("w12-worker").delivery_receipts_json, result.delivery_receipts_json)
        with self.assertRaises(AiError):
            self.send(cycle, run, preview)
        self.assertEqual((len(self.model_calls), len(self.delivery_calls), PiDispatch.objects.filter(kind="model").count()), (1, 1, 1))

    def test_disable_before_send_blocks_original_recipient_post(self):
        self.publish_sales()
        self.publish_inventory()
        cycle = self.approve()
        run = cycle.tick("w12-worker")
        preview = self.run_model(cycle, run)
        with self.assertRaises(AiError):
            self.send(cycle, run, preview, disable_before=True)
        self.assertEqual(len(self.delivery_calls), 0)
        self.assertFalse(TaskRun.objects.get(pk=run.id).execution_ref)
        self.assertEqual(task_dispatch.observe(run.id).report_status, "ready")

    def test_disable_after_queue_blocks_a_new_model_reservation(self):
        self.publish_sales()
        self.publish_inventory()
        cycle = self.approve()
        run = cycle.tick("w12-worker")
        self.assertEqual(pi_worker.claim().id, run.operation_id)
        task_definitions.control(self.task["id"], {"expectedVersion": self.task["version"]}, self.owner, "disable")
        with self.assertRaises(AiError):
            cycle.generate(run.id, lambda *args: self.fail("revoked grant cannot authorize model"))
        self.assertFalse(PiDispatch.objects.filter(kind="model").exists())

    def test_revision_cannot_replace_the_original_grant(self):
        cycle = self.approve()
        revised = task_definitions.save({"id": self.task["id"], "expectedVersion": self.task["version"], "name": "新版本",
            "spec": self.spec}, self.owner)["item"]
        with self.assertRaises(AiError):
            cycle.tick("w12-worker")
        with self.assertRaises(AiError):
            approve(self.task["id"], revised["version"], self.owner, self.channel, self.config)
        self.assertEqual((TaskRun.objects.count(), TaskGrant.objects.count()), (0, 1))

    def test_explicit_platform_rejection_uses_only_the_w8_receipt_class(self):
        self.publish_sales()
        self.publish_inventory()
        cycle = self.approve()
        run = cycle.tick("w12-worker")
        preview = self.run_model(cycle, run)
        result = self.send(cycle, run, preview, rejected=True)
        expected = "failed" if hasattr(dingtalk_transport, "DingTalkDeliveryError") else "unknown"
        self.assertEqual((result.status, result.delivery_status, len(self.delivery_calls)), (expected, expected, 1))

    def test_mixed_erp_identity_and_wrong_inventory_date_wait(self):
        self.publish_sales(mixed_identity=True)
        self.publish_inventory(day=self.day + timedelta(days=1))
        run = self.approve().tick("w12-worker")
        self.assertEqual(run.status, "waiting_data")
        self.assertEqual({gap["dataset"] for gap in json.loads(run.evidence_json)["gaps"]}, {SALES, INVENTORY})
        self.assertEqual(PiOperation.objects.count(), 0)

    def test_published_gate_and_public_enable_stay_closed(self):
        with self.assertRaises(AiError):
            task_definitions.control(self.task["id"], {"expectedVersion": self.task["version"]}, self.owner, "enable")
        with self.assertRaises(DatabaseError), transaction.atomic():
            TaskDefinition.objects.filter(pk=self.task["id"]).update(enabled=True, version=2)
        cycle = self.approve()
        with override_settings(DJANGO_ENVIRONMENT="production"), self.assertRaises(AiError):
            cycle.tick("w12-worker")
        with self.assertRaises(AiError):
            task_dispatch.accept_occurrence(self.task["id"], trigger_kind="time", occurrence_key=cycle.slot.isoformat(), scheduled_at=cycle.slot)
        self.assertEqual(TaskRun.objects.count(), 0)
