"""Third-phase behavior, synthetic business inputs and blocked external boundaries."""
from datetime import timedelta
import json
from unittest.mock import patch
from unittest import skipUnless
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.test import TestCase, TransactionTestCase, override_settings
from django.db import connection, connections, close_old_connections
from django.utils import timezone
from access_control.models import AppUser
from . import tests as domain, pi_service as service, pi_worker as worker, pi_business as business
from .pi_models import PiBusinessAction, PiBusinessAudit, PiBusinessIntent, PiOperation, PiSession
from .policy import AiError, canonical, digest, mutation


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiBusinessVerificationTests(TestCase):
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call

    def setUp(self):
        domain.AiDomainTests.setUp(self)
        self.actor = self.user("business@example.invalid", "operator", None)
        # Unexpected outbound traffic fails every test before it can leave.
        self.network = patch("http.client.HTTPConnection.connect", side_effect=AssertionError("Unexpected outbound HTTP"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def seed_domains(self):
        from workflow.models import WorkflowDataRevision, WorkflowOperationsWriteAuthority
        from inventory.models import InventoryDataRevision, InventoryWriteAuthority
        WorkflowDataRevision.objects.get_or_create(domain="workflow")
        WorkflowOperationsWriteAuthority.objects.get_or_create(id=1, defaults={"status": "postgres"})
        InventoryDataRevision.objects.get_or_create(domain="inventory")
        InventoryWriteAuthority.objects.get_or_create(id=1, defaults={"status": "postgres",
            "authority_epoch": "33333333-3333-4333-8333-333333333333", "cutover_id": "isolated-verification",
            "migration_verify_run_id": "isolated-verify", "activated_at": timezone.now()})

    def operation(self, kind):
        sid = service.create_session({"clientRequestId": "session-" + kind}, self.actor)["session"]["id"]
        response = service.prompt(sid, {"clientRequestId": "prompt-1", "message": "明确保存测试计划",
            "businessExecution": {"allowedActions": [kind]}}, self.actor)
        op = worker.claim()
        self.assertIsNotNone(op)
        self.assertEqual(op.id, response["operation"]["id"])
        return op, PiBusinessIntent.objects.get(parent_operation=op)

    def prepared(self, kind="create_work_plan"):
        op, intent = self.operation(kind)
        value = {"parameters": {"title": "测试"}, "preview": {"title": "测试", "source": {"inventoryStale": False}},
            "targetVersion": "fixed-version", "scope": {"domain": "fixture"}}
        tool = next(name for name, action in business.TOOLS.items() if action == kind)
        with patch("ai_assistant.pi_business_domains.prepare", return_value=value):
            result = business.tool_prepare(op, intent.id, tool, {"title": "测试"}, "invoke-1")
        return op, intent, result["action"]

    def confirm(self, action, **extra):
        return business.control(PiBusinessAction.objects.get(pk=action["actionId"]).session_id,
            {"command": "confirm", "actionId": action["actionId"], "clientRequestId": "confirm-1",
                "expectedVersion": action["version"], "previewDigest": action["previewDigest"], **extra}, self.actor)

    def queued(self, kind="deliver_report"):
        op, intent, action = self.prepared(kind)
        self.confirm(action)
        return op, business.claim()

    def test_complete_plan_queues_without_second_confirmation(self):
        _, _, action = self.prepared("create_work_plan")
        self.assertEqual(action["status"], "queued")
        self.assertEqual(PiBusinessAction.objects.get(pk=action["actionId"]).confirmation_digest, action["previewDigest"])
        self.assertIsNotNone(business.claim())

    def test_complete_replenishment_queues_without_second_confirmation(self):
        _, _, action = self.prepared("save_replenishment_draft")
        self.assertEqual(action["status"], "queued")

    def test_stale_inventory_requires_real_preview_confirmation(self):
        op, intent = self.operation("save_replenishment_draft")
        value = {"parameters": {"acknowledgeStale": True}, "preview": {"source": {"inventoryStale": True}},
            "targetVersion": "stale-fixture", "scope": {"domain": "inventory"}}
        with patch("ai_assistant.pi_business_domains.prepare", return_value=value):
            result = business.tool_prepare(op, intent.id, "prepare_pi_replenishment_draft", {"acknowledgeStale": True}, "stale-invoke")
        self.assertEqual(result["action"]["status"], "prepared")
        self.assertIsNone(business.claim())
        self.confirm(result["action"])
        self.assertIsNotNone(business.claim())

    def test_report_and_gap_remain_previews(self):
        for kind in ("deliver_report", "execute_registered_gap"):
            with self.subTest(kind=kind):
                _, _, action = self.prepared(kind)
                self.assertEqual(action["status"], "prepared")
                self.assertIsNone(business.claim())

    def test_tool_replay_new_invocation_does_not_create_second_action(self):
        op, intent, action = self.prepared()
        with patch("ai_assistant.pi_business_domains.prepare", side_effect=AssertionError("Reprepared")):
            result = business.tool_prepare(op, intent.id, "prepare_pi_work_plan", {"title": "测试"}, "invoke-2")
        self.assertTrue(result["replayed"])
        self.assertEqual(result["action"]["actionId"], action["actionId"])
        self.assertEqual(PiBusinessAction.objects.count(), 1)
        with self.assertRaises(AiError):
            business.tool_prepare(op, intent.id, "prepare_pi_work_plan", {"title": "另一内容"}, "invoke-3")

    def test_missing_intent_and_foreign_intent_reject(self):
        op, intent = self.operation("create_work_plan")
        with self.assertRaises(AiError):
            business.tool_prepare(op, "absent", "prepare_pi_work_plan", {}, "invoke-1")
        other, _ = self.operation("deliver_report")
        with self.assertRaises(AiError):
            business.tool_prepare(other, intent.id, "prepare_pi_work_plan", {}, "invoke-1")

    def test_refresh_is_read_only(self):
        op, _, _ = self.prepared()
        counts = (PiBusinessAction.objects.count(), PiBusinessAudit.objects.count())
        for _ in range(3):
            business.listing(op.session_id, {}, self.actor)
        self.assertEqual(counts, (PiBusinessAction.objects.count(), PiBusinessAudit.objects.count()))

    def test_confirmation_content_version_and_expiry_are_bound(self):
        _, intent, action = self.prepared("deliver_report")
        with self.assertRaises(AiError):
            self.confirm(action, previewDigest="tampered")
        PiBusinessIntent.objects.filter(pk=intent.id).update(expires_at=timezone.now()-timedelta(seconds=1))
        with self.assertRaises(AiError):
            self.confirm(action)
        self.assertIsNone(business.claim())

    def test_confirmation_replay_never_requeues(self):
        op, _, action = self.prepared("deliver_report")
        self.confirm(action)
        claimed = business.claim()
        replay = self.confirm(action)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["action"]["status"], "claimed")
        self.assertIsNone(business.claim())
        self.assertEqual(claimed.id, action["actionId"])

    def test_cancel_prevents_dispatch(self):
        op, action = self.queued()
        business.control(op.session_id, {"command": "cancel", "actionId": action.id,
            "clientRequestId": "cancel-1"}, self.actor)
        with patch("ai_assistant.pi_business_domains.execute") as execute:
            business.perform(action)
        execute.assert_not_called()
        action.refresh_from_db()
        self.assertEqual(action.status, "canceled")

    def test_role_revocation_prevents_effect(self):
        _, action = self.queued()
        AppUser.objects.filter(email=self.actor.email).update(status="disabled")
        with patch("ai_assistant.pi_business_domains.execute") as execute:
            business.perform(action)
        execute.assert_not_called()
        action.refresh_from_db()
        self.assertEqual(action.status, "failed")

    def test_unknown_is_not_replayed_and_can_observe_original_receipt(self):
        op, action = self.queued()
        with patch("ai_assistant.pi_business_domains.execute", side_effect=TimeoutError("lost ack")) as execute:
            business.perform(action)
            business.perform(action)
        self.assertEqual(execute.call_count, 1)
        action.refresh_from_db()
        self.assertEqual(action.status, "unknown")
        self.assertIsNone(business.claim())
        with patch("ai_assistant.pi_business_domains.observe", return_value={"status": "succeeded", "objectId": "original"}):
            result = business.control(op.session_id, {"command": "reconcile", "actionId": action.id,
                "clientRequestId": "observe-1"}, self.actor)
        self.assertEqual(result["action"]["status"], "succeeded")
        self.assertEqual(result["action"]["result"]["objectId"], "original")

    def test_no_gap_creates_no_action(self):
        op, intent = self.operation("execute_registered_gap")
        with patch("ai_assistant.pi_business_domains.prepare", return_value={"preview": {"noGap": True, "coverage": {"complete": True}}}):
            result = business.tool_prepare(op, intent.id, "prepare_pi_gap_execution", {}, "invoke-1")
        self.assertEqual(result["status"], "no_gap")
        self.assertEqual(PiBusinessAction.objects.count(), 0)

    def test_worker_lost_never_reclaims_original_action(self):
        _, action = self.queued()
        from django.db.models import F
        PiBusinessAction.objects.filter(pk=action.id).update(lease_expires_at=timezone.now()-timedelta(seconds=1), version=F("version")+1)
        self.assertIsNone(business.claim())
        action.refresh_from_db()
        self.assertEqual(action.status, "unknown")

    def test_malformed_domain_receipt_cannot_be_success(self):
        _, action = self.queued()
        with patch("ai_assistant.pi_business_domains.execute", return_value={}):
            business.perform(action)
        action.refresh_from_db()
        self.assertEqual(action.status, "unknown")

    def test_succeeded_domain_receipt_is_persisted_once(self):
        _, action = self.queued()
        with patch("ai_assistant.pi_business_domains.execute", return_value={"status": "succeeded", "objectId": "formal-1"}) as execute:
            business.perform(action)
            business.perform(action)
        self.assertEqual(execute.call_count, 1)
        action.refresh_from_db()
        self.assertEqual(action.status, "succeeded")

    def test_formal_work_plan_writer_replay_and_observation(self):
        from workflow.pi_business import prepare
        from workflow.models import WorkflowTask
        self.seed_domains()
        args = {"title": "详情优化", "goal": "完成新版", "workContent": "列出问题并改版",
            "owner": "合成负责人", "shopName": "合成店铺", "startDate": "2026-10-20", "due": "2026-10-27"}
        prepared = prepare(args)
        body = {"phase": "execute", "kind": "work_plan.create", "parameters": prepared["parameters"],
            "targetVersion": prepared["targetVersion"], "actionId": "formal-plan", "dispatchToken": "isolated-token"}
        with patch("workflow.pi_business.admit") as admit:
            first = self.call("/api/workflow/pi-business", body, principal=self.actor, request_id="pi-business:formal-plan")
            self.assertEqual(first.status_code, 201, first.content)
            second = self.call("/api/workflow/pi-business", body, principal=self.actor, request_id="pi-business:formal-plan")
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(admit.call_count, 1)
        self.assertEqual(WorkflowTask.objects.count(), 1)
        self.assertIn("目标：完成新版", WorkflowTask.objects.get().work_content)
        self.assertEqual(first.json()["item"]["version"], 1)
        observed = self.call("/api/workflow/pi-business", {"phase": "observe", "kind": "work_plan.create", "actionId": "formal-plan"}, principal=self.actor)
        self.assertEqual(observed.json(), first.json())

    def test_work_plan_missing_fields_dates_and_scoped_writer_reject(self):
        from workflow.pi_business import prepare
        from workflow.errors import WorkflowApiError
        args = {"title": "计划", "goal": "目标", "workContent": "事项", "owner": "负责人",
            "shopName": "店铺", "startDate": "2026-10-20", "due": "2026-10-27"}
        for key in args:
            with self.subTest(missing=key), self.assertRaises(WorkflowApiError):
                prepare({k: v for k, v in args.items() if k != key})
        for invalid in ({"due": "2026-02-30"}, {"due": "2026-10-01"}, {"priority": "critical"}):
            with self.subTest(invalid=invalid), self.assertRaises(WorkflowApiError):
                prepare({**args, **invalid})
        self.seed_domains()
        scoped = self.user("scoped@example.invalid", "operator", {"warehouses": [], "channels": [], "platforms": ["天猫"]})
        response = self.call("/api/workflow/pi-business", {"phase": "prepare", "kind": "work_plan.create", "arguments": args}, principal=scoped)
        self.assertEqual(response.status_code, 403)

    def inventory_result(self):
        return {"controls": {"autoReplenishmentEnabled": True}, "quality": {"recommendationsSuppressed": False},
            "sync": {"inventoryStale": False, "latestInventoryBatchId": "stock-fixture", "inventoryDate": "2026-10-20"},
            "items": [{"key": "合成仓\x1fSKU-1", "warehouse": "合成仓", "productCode": "SKU-1", "productName": "合成货品",
                "brand": "合成", "category": "设备", "supplier": "合成供应商", "suggestedQuantity": 12,
                "sales30d": 20, "productSales30d": 35, "availableQuantity": 5, "sourceInTransitQuantity": 2,
                "plannedInTransitQuantity": 1, "coverageDays": 7.5, "reason": "正式算法合成输出"}]}

    def test_inventory_formal_draft_roundtrip_replay_and_editable(self):
        from inventory.pi_business import prepare
        from inventory.models import ReplenishmentPlanItem
        from inventory.plans import update_plan
        self.seed_domains()
        with patch("inventory.pi_business.inventory_overview", return_value=self.inventory_result()), patch("inventory.pi_business.admit") as admit:
            prepared = prepare({"warehouse": "合成仓", "productCode": "SKU-1"}, self.actor)[0]
            body = {"phase": "execute", "kind": "replenishment_draft.create", "parameters": prepared["parameters"],
                "targetVersion": prepared["targetVersion"], "actionId": "formal-stock", "dispatchToken": "isolated-token"}
            first = self.call("/api/inventory/pi-business", body, principal=self.actor, request_id="pi-business:formal-stock")
            self.assertEqual(first.status_code, 201, first.content)
            second = self.call("/api/inventory/pi-business", body, principal=self.actor, request_id="pi-business:formal-stock")
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(admit.call_count, 1)
        plan = ReplenishmentPlanItem.objects.get()
        self.assertEqual((plan.status, plan.planned_quantity, plan.sales_30d_quantity), ("draft", 12, 35))
        update_plan(plan.id, "draft", 18)
        plan.refresh_from_db()
        self.assertEqual(plan.planned_quantity, 18)

    def test_inventory_quality_missing_sales_stale_and_version_gates(self):
        from inventory.pi_business import prepare
        from inventory.errors import InventoryApiError
        self.seed_domains()
        args = {"warehouse": "合成仓", "productCode": "SKU-1"}
        for variant in ("quality", "stale", "missing_sales", "wrong_object", "disabled"):
            data = self.inventory_result()
            if variant == "quality": data["quality"]["recommendationsSuppressed"] = True
            if variant == "stale": data["sync"]["inventoryStale"] = True
            if variant == "missing_sales": data["items"][0]["sales30d"] = None
            if variant == "wrong_object": data["items"][0]["key"] = "other"
            if variant == "disabled": data["controls"]["autoReplenishmentEnabled"] = False
            with self.subTest(variant=variant), patch("inventory.pi_business.inventory_overview", return_value=data), self.assertRaises(InventoryApiError):
                prepare(args, self.actor)
        with patch("inventory.pi_business.inventory_overview", return_value=self.inventory_result()):
            prepared = prepare(args, self.actor)[0]
            from inventory.models import InventoryDataRevision, ReplenishmentPlanItem
            InventoryDataRevision.objects.filter(domain="inventory").update(revision=10)
            body = {"phase": "execute", "kind": "replenishment_draft.create", "parameters": prepared["parameters"],
                "targetVersion": prepared["targetVersion"], "actionId": "changed-stock", "dispatchToken": "isolated-token"}
            with patch("inventory.pi_business.admit") as admit:
                response = self.call("/api/inventory/pi-business", body, principal=self.actor, request_id="pi-business:changed-stock")
            self.assertEqual(response.status_code, 409, response.content)
            admit.assert_not_called()
            self.assertEqual(ReplenishmentPlanItem.objects.count(), 0)


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
@skipUnless(connection.vendor == "postgresql", "Concurrent row locks require the private PostgreSQL runner")
class PiBusinessConcurrencyTests(TransactionTestCase):
    setUp = PiBusinessVerificationTests.setUp
    user = PiBusinessVerificationTests.user
    operation = PiBusinessVerificationTests.operation

    def test_concurrent_prepare_has_one_action_and_one_replay(self):
        op, intent = self.operation("create_work_plan")
        barrier = Barrier(2, timeout=10)
        def prepare(*args):
            barrier.wait()
            return {"parameters": {"title": "合成计划"}, "preview": {"title": "合成计划"},
                "targetVersion": "fixture", "scope": {"domain": "workflow"}}
        def call(invocation):
            close_old_connections()
            try:
                return business.tool_prepare(PiOperation.objects.get(pk=op.id), intent.id,
                    "prepare_pi_work_plan", {"title": "合成计划"}, invocation)
            finally:
                connections.close_all()
        with patch("ai_assistant.pi_business_domains.prepare", side_effect=prepare), ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(call, "concurrent-invoke-1")
            second = executor.submit(call, "concurrent-invoke-2")
            results = [first.result(timeout=20), second.result(timeout=20)]
        self.assertEqual(PiBusinessAction.objects.count(), 1)
        self.assertEqual(sum(result["replayed"] for result in results), 1)
        self.assertEqual({result["action"]["actionId"] for result in results}, {intent.action_id})
        self.assertEqual(PiBusinessAction.objects.get().status, "queued")
