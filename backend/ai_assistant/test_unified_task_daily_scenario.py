"""First P2 scenario, synthetic-only: JD ZHIGAO commercial equipment daily report.

This is an offline executor rehearsal against a disposable PostgreSQL cluster.
The production dispatcher stays closed. Only the source/model/delivery seams
are synthetic; definitions, Pi queue bindings, run/incident SQL and CAS are real.
"""
from datetime import timedelta
import json
from pathlib import Path
from unittest.mock import patch
from django.conf import settings
from django.db import connection
from django.test import TestCase
from django.utils import timezone
from . import tests as domain, task_definitions as definitions, task_dispatch as dispatch, task_dependencies, pi_service
from .dingtalk_schedules import next_slot
from .policy import AiError, canonical, digest, mutation
from .task_models import TaskDefinition, TaskRevision, TaskGrant, TaskRun
from .pi_models import PiOperation, PiSession


class SyntheticDailyReportScenario(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user

    def test_daily_report_wait_resume_fencing_delivery_unknown_and_duplicate_tick(self):
        db = connection.settings_dict
        if (connection.vendor != "postgresql" or db["HOST"] != "127.0.0.1"
                or not 55440 <= int(db["PORT"]) <= 55999 or not str(db["NAME"]).startswith("test_teruisi_ai_rehearsal")
                or settings.DJANGO_ENVIRONMENT != "test"):
            self.skipTest("requires disposable rehearsal PostgreSQL identity")
        # An accidental model HTTP request, channel send or edge call stops the
        # rehearsal. No production account, credential or delivery target exists.
        with patch("ai_assistant.transport.edge", side_effect=AssertionError("real edge forbidden")), patch(
                "ai_assistant.channels.send", side_effect=AssertionError("real delivery forbidden")), patch(
                "ai_assistant.provider.turn", side_effect=AssertionError("real model forbidden")):
            result = self.rehearse()
        out = Path(__file__).resolve().parents[2] / "docs/ai-p2-20261107/daily-scenario-result.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf8", newline="\n")

    def test_daily_report_success_requires_a_persisted_sent_receipt(self):
        db = connection.settings_dict
        if connection.vendor != "postgresql" or db["HOST"] != "127.0.0.1" or not 55440 <= int(db["PORT"]) <= 55999:
            self.skipTest("requires disposable rehearsal PostgreSQL identity")
        with patch("ai_assistant.transport.edge", side_effect=AssertionError("real edge forbidden")), patch(
                "ai_assistant.channels.send", side_effect=AssertionError("real delivery forbidden")), patch(
                "ai_assistant.provider.turn", side_effect=AssertionError("real model forbidden")):
            result = self.rehearse("sent")
        self.assertEqual((result["reportStatus"], result["deliveryStatus"], result["runStatus"]), ("ready", "sent", "succeeded"))

    def rehearse(self, outcome="unknown"):
        actor = self.user("p2-synthetic-owner@example.invalid", "admin", None)
        skill = pi_service.skills()[0]
        slot = next_slot("daily", 9, 0, 1, timezone.now()+timedelta(days=1))
        spec = {"skill": {"kind": "bundled", "id": skill["id"], "version": skill["version"], "digest": skill["sha256"]},
            "prompt": "京东志高商用设备旗舰店经营日报；ERP销售按本店，库存另列全部计入库存的仓；缺源或缺数等待，不以网店榜单替代ERP销售，不发真实消息。",
            "shopSelection": {"platform": "京东", "shop": "志高商用设备旗舰店"},
            "modelId": self.model.id, "modelVersion": self.model.version,
            "trigger": {"kind": "time", "timezone": "Asia/Shanghai", "cadence": "daily", "hour": 9, "minute": 0, "day": 1, "windowSeconds": 3600},
            "dataDependencies": [
                {"dataset": "erp_shop_sales", "dayOffset": 1, "requiredFields": ["sales_amount_cents", "quantity"]},
                {"dataset": "inventory_included_warehouses", "dayOffset": 1, "requiredFields": ["included_warehouse_quantity"]}],
            "deliveryTargets": [{"connector": "dingtalk", "targetType": "person", "targetId": "synthetic-sink", "senderId": "synthetic-sink"}],
            "missedPolicy": "wait_for_data_until_deadline", "parameters": {"fixtureOnly": True}}
        task = definitions.save({"clientRequestId": "jd-zhigao-daily-synthetic", "name": "隔离合成：京东志高商用设备旗舰店经营日报", "spec": spec}, actor)["item"]
        definition = TaskDefinition.objects.get(pk=task["id"])
        revision = TaskRevision.objects.get(pk=task["revisionId"])
        key = slot.isoformat()  # original UTC instant, never recovery time
        with mutation():
            grant = TaskGrant.objects.create(id="synthetic-only-grant", revision=revision, owner_email=actor.email,
                authorization_ref="synthetic_fixture_only_not_a_production_authorization", expires_at=slot+timedelta(days=1))
            run = TaskRun.objects.create(id="synthetic-jd-zhigao-daily-run", task=definition, revision=revision, grant=grant,
                trigger_kind="time", occurrence_key=key, scheduled_at=slot, deadline_at=slot+timedelta(hours=1),
                rule_version=dispatch.TRIAGE_VERSION)
        fixture_day = (slot.astimezone(__import__('zoneinfo').ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat()
        source = {
            "erpSales": {"dataset": "erp_shop_sales", "scope": {"platform": "京东", "shop": "志高商用设备旗舰店"},
                "date": fixture_day, "revision": "synthetic-erp-v1", "complete": False, "fields": ["quantity"], "quantity": 7},
            "inventory": {"dataset": "inventory_included_warehouses", "scope": {"warehousePolicy": "全部计入库存的仓"},
                "date": fixture_day, "revision": "synthetic-inventory-v1", "complete": True,
                "fields": ["included_warehouse_quantity"], "included_warehouse_quantity": 55,
                "warehouses": [{"name": "合成计入仓A", "included": True, "quantity": 30}, {"name": "合成计入仓B", "included": True, "quantity": 25}]}}
        model_calls, delivery_calls = [], []
        snapshots = {"erp_shop_sales": source["erpSales"], "inventory_included_warehouses": source["inventory"]}
        dependencies = task_dependencies.evaluate(spec, slot, snapshots)
        self.assertFalse(dependencies["ready"])
        self.assertEqual(dependencies["gaps"][0]["missingFields"], ["sales_amount_cents"])
        with mutation():
            run.status, run.version = "waiting_data", 2
            run.save()
            incident = dispatch.incident(run, "waiting_data", {"reason": "synthetic_required_field_missing"})
        self.assertEqual((len(model_calls), len(delivery_calls)), (0, 0))
        # A later complete revision satisfies the same day/scope/field contract.
        source["erpSales"].update(revision="synthetic-erp-v2", complete=True, fields=["quantity", "sales_amount_cents"], sales_amount_cents=123400)
        self.assertEqual(source["erpSales"]["scope"], {"platform": "京东", "shop": "志高商用设备旗舰店"})
        self.assertEqual(source["erpSales"]["date"], fixture_day)
        self.assertNotIn("shop", source["inventory"]["scope"])
        self.assertEqual(source["inventory"]["scope"]["warehousePolicy"], "全部计入库存的仓")
        self.assertTrue(task_dependencies.evaluate(spec, slot, snapshots)["ready"])
        self.assertFalse(task_dependencies.evaluate(spec, slot, {})["ready"])
        from copy import deepcopy
        wrong_inventory = deepcopy(snapshots)
        wrong_inventory["inventory_included_warehouses"]["scope"] = spec["shopSelection"]
        self.assertFalse(task_dependencies.evaluate(spec, slot, wrong_inventory)["ready"])
        source_digest = digest(source)
        dispatch.incident_control(incident.id, {"expectedVersion": 1}, actor, "claim")
        dispatch.incident_control(incident.id, {"expectedVersion": 2, "resolutionNote": "仅合成源v2已核精确店铺、日期、覆盖和两个必需字段；进入隔离执行。"}, actor, "close")
        with mutation():
            run.status, run.lease_owner, run.fence, run.version = "leased", "synthetic-old-worker", 1, 3
            run.lease_until = slot+timedelta(seconds=10)
            run.save()
            # Reclaim only pre-delegation work. No provider/delivery occurred.
            run.lease_owner, run.fence, run.version = "synthetic-current-worker", 2, 4
            run.lease_until = slot+timedelta(minutes=2)
            run.save()
        with self.assertRaises(AiError):
            dispatch.check_lease_identity(run, "synthetic-old-worker", 1, slot+timedelta(seconds=20))
        dispatch.check_lease_identity(run, "synthetic-current-worker", 2, slot+timedelta(seconds=20))
        # Real Pi session/prompt queue, no worker or provider is started. Bind
        # the original request to the exact frozen task contract before the
        # synthetic model boundary produces a report.
        request = dispatch.operation_payload(run)
        with mutation(actor):
            session = pi_service.create_session({"clientRequestId": "task-session-"+run.id,
                "scope": actor.scope, "shopSelection": spec["shopSelection"]}, actor)["session"]
            op_id = pi_service.prompt(session["id"], request, actor)["operation"]["id"]
            operation = PiOperation.objects.select_related("session").get(pk=op_id)
            dispatch.check_operation_binding(run, operation)
            from copy import copy
            foreign_branch = copy(operation)
            foreign_branch.payload_json = canonical({**json.loads(operation.payload_json),
                "nativeBranchBinding": {"nativeSessionId": "other-branch", "historyControlSeq": 1}})
            with self.assertRaises(AiError):
                dispatch.check_operation_binding(run, foreign_branch)
            run.status, run.operation_id, run.version = "delegated", op_id, 5
            run.save()
        model_calls.append({"operationId": op_id, "sourceDigest": source_digest})
        report = {"title": "合成经营日报", "platform": "京东", "shop": "志高商用设备旗舰店", "date": fixture_day,
            "sections": [
                {"name": "ERP 本店销售", "scope": source["erpSales"]["scope"], "quantity": 7, "sales_amount_cents": 123400},
                {"name": "库存：全部计入库存的仓", "scope": source["inventory"]["scope"], "included_warehouse_quantity": 55}],
            "sourceDigest": source_digest, "synthetic": True}
        with mutation():
            operation.status = "succeeded"
            operation.save(update_fields=["status"])
            sess = PiSession.objects.get(pk=session["id"])
            sess.status, sess.active_operation_id = "idle", ""
            sess.save(update_fields=["status", "active_operation_id"])
        # Observe the model's real persisted terminal state first. A ready
        # report with a target is still an in-flight task, not final success.
        run = dispatch.observe(run.id)
        self.assertEqual((run.status, run.report_status, run.delivery_status), ("delegated", "ready", "pending"))
        # A stable delivery identity returns unknown. Rehearsal deliberately
        # retains that result and never sends to a new identity or recipient.
        original_delivery_ledger = {}
        intents = json.loads(run.delivery_receipts_json)
        delivery_id = next(iter(intents))
        def synthetic_send_once(intent):
            if intent["deliveryId"] not in original_delivery_ledger:
                delivery_calls.append(intent["deliveryId"])
                original_delivery_ledger[intent["deliveryId"]] = {**intent, "status": outcome, "receiptRef": "synthetic-original-send-receipt"}
            return original_delivery_ledger[intent["deliveryId"]]
        synthetic_send_once(intents[delivery_id])
        run = dispatch.observe(run.id, delivery_receipt_reader=lambda original_run, key, target: original_delivery_ledger.get(key))
        self.assertEqual((run.status, run.report_status, run.delivery_status), ("unknown" if outcome == "unknown" else "succeeded", "ready", outcome))
        from .task_models import TaskIncident
        unknown = TaskIncident.objects.filter(run=run, error_class="dispatch_unknown").first()
        self.assertEqual(unknown is not None, outcome == "unknown")
        # Re-observing an unknown run never calls a send seam or replaces its
        # original receipt. This is the same production observer as above.
        dispatch.observe(run.id, delivery_receipt_reader=lambda *args: self.fail("unknown must retain its original receipt"))
        duplicate, created = dispatch.accept_occurrence(definition.id, trigger_kind="time", occurrence_key=key, scheduled_at=slot)
        self.assertFalse(created)
        self.assertEqual(duplicate.id, run.id)
        self.assertIsNone(dispatch.claim(run.id, "retry-worker"))
        self.assertEqual((len(model_calls), len(delivery_calls)), (1, 1))
        self.assertFalse(TaskDefinition.objects.get(pk=definition.id).enabled)
        evidence = definitions.detail(definition.id, {}, actor, "incidents", unknown.id)["item"]["evidence"] if unknown else definitions.detail(definition.id, {}, actor, "runs", run.id)["item"]["evidence"]
        self.assertEqual(evidence["sourceRefs"][0]["id"], op_id)
        self.assertEqual(PiOperation.objects.get(pk=op_id).status, "succeeded")
        return {"status": "passed", "mode": "synthetic_isolated_executor", "shop": spec["shopSelection"],
            "scheduledAt": key, "dataDate": fixture_day, "source": source, "report": report,
            "modelCalls": len(model_calls), "deliveryCalls": len(delivery_calls), "deliveryId": delivery_id,
            "reportStatus": run.report_status, "deliveryStatus": run.delivery_status, "runStatus": run.status,
            "deliveryReceipts": json.loads(run.delivery_receipts_json),
            "checks": ["deterministic-original-slot", "ERP-shop-sales-and-included-warehouse-inventory-separate", "missing-field-waits-with-no-side-effects", "same-day-versioned-dependency-resume",
                "stale-fence-rejected", "exact-Pi-operation-binding", "single-synthetic-model-call", "single-synthetic-delivery",
                "duplicate-tick-returns-original", "delivery-unknown-never-replayed", "evidence-visible-to-owner"],
            "productionTaskEnabled": False, "realProviderCalled": False, "realDeliveryPerformed": False,
            "productionAuthorizationCreated": False, "productionTouched": False}
