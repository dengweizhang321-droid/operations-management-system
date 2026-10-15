from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import uuid

from django.test import TestCase
from django.utils import timezone

from inventory import jd_logistics as source
from inventory import jd_logistics_notifications as notify
from inventory.errors import InventoryApiError
from inventory.jd_logistics_models import JdLogisticsBatch, JdLogisticsDelivery, JdLogisticsFact, JdLogisticsScope
from inventory.models import InventoryWriteAuthority
from sales.tests.factories import TEST_SECRET, signed_headers

ACTOR = "jd-notify-fixture@example.invalid"
BASE = "/api/inventory/jd-logistics"
ENABLED = {"implemented": True, "enabled": True, "configured": True, "groupName": notify.GROUP_NAME, "robotName": notify.ROBOT_NAME, "configDigest": "e" * 64, "reason": "requires_dynamic_preflight"}


def receipt(group="fixture-group"):
    # Exact v1.0.57 batch_write.go success shape, not the legacy test fixture.
    return {"contractVersion": "im.batch-write.v1", "ok": True, "partial": False, "requestedCount": 1, "succeededCount": 1, "failedCount": 0, "succeeded": [{"target": group, "result": {"fixture": True}}], "failures": []}


class FakeGateway:
    def __init__(self, *, outcome=None, on_preflight=None, on_send=None):
        self.preflights = 0
        self.sends = []
        self.outcome = outcome
        self.on_preflight = on_preflight
        self.on_send = on_send

    def preflight(self, group, robot, users):
        self.preflights += 1
        if self.on_preflight:
            self.on_preflight(self.preflights)
        return "fixture-group", "fixture-robot", []

    def send(self, **kwargs):
        self.sends.append(kwargs)
        if self.on_send:
            self.on_send()
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return deepcopy(self.outcome if self.outcome is not None else receipt())


def seed_department(identifier="notify-dept", business_unit="NOTIFY-BU", *, extra_zero=False, missing_post=False):
    source.mutate({"operation": "settings", "departmentId": identifier, "businessUnitCode": business_unit, "name": identifier, "expectedRevision": 0}, ACTOR)
    source.mutate({"operation": "settings", "departmentId": identifier, "storeKeys": ["fixture-store"], "capabilities": {"realtime_inventory": True, "inventory_snapshot": True}, "logisticsEnabled": True, "monitorEnabled": True, "pushEnabled": True, "stockoutThresholdDays": 15, "expectedRevision": 1}, ACTOR)
    today = timezone.localdate(timezone=source.SHANGHAI)
    yesterday = today - timedelta(days=1)
    live = {"businessUnitCode": business_unit, "goodsCode": "RISK-1", "goodsName": "合成缺货商品", "warehouseCode": "", "warehouseName": "合成来源仓", "snapshotDate": today.isoformat(), "onHandQuantity": 10, "availableQuantity": 8, "purchaseInTransitQuantity": None if missing_post else 2, "transferInTransitQuantity": 0}
    snapshot = {**live, "snapshotDate": yesterday.isoformat(), "sales7dQuantity": 7, "sales30dQuantity": 60}
    live_rows, snapshot_rows = [live], [snapshot]
    if extra_zero:
        live_rows.append({**live, "goodsCode": "ZERO-SALES", "goodsName": "零销量合成商品"})
        snapshot_rows.append({**snapshot, "goodsCode": "ZERO-SALES", "goodsName": "零销量合成商品", "sales30dQuantity": 0})
    refs = []
    for kind, rows in (("realtime_inventory", live_rows), ("inventory_snapshot", snapshot_rows)):
        result = source.import_payload({"operation": "import", "sourceKind": kind, "departmentId": identifier, "businessUnitCode": business_unit, "rangeStart": yesterday.isoformat(), "rangeEnd": (today + timedelta(days=1)).isoformat(), "rawFileHash": "a" * 64, "fileName": "synthetic-notify.xlsx", "complete": True, "expectedScopeRevision": 0, "origin": "manual", "collectedAt": timezone.now().isoformat(), "rows": rows}, ACTOR)
        refs.append({key: result[key] for key in ("departmentId", "sourceKind", "batchId", "scopeRevision", "contentHash", "rawFileHash")})
    return refs


class NotificationTests(TestCase):
    def setUp(self):
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(), cutover_id="notify-fixture", migration_verify_run_id="notify-fixture", activated_at=timezone.now())
        self.refs = seed_department()
        self.body = {"operation": "notify", "departmentIds": ["notify-dept"]}

    def enabled(self):
        return patch.object(notify, "notification_policy", return_value=deepcopy(ENABLED))

    def test_config_is_independent_default_off_and_invalid_config_is_not_ready(self):
        self.assertFalse(notify.notification_policy()["enabled"])
        gateway = FakeGateway()
        self.assertEqual(notify.notify(self.body, ACTOR, gateway=gateway)["status"], "disabled")
        self.assertEqual((gateway.preflights, gateway.sends), (0, []))
        self.assertEqual(JdLogisticsDelivery.objects.count(), 0)
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "notification.json"
            config.write_text(json.dumps({"version": 1, "enabled": True, "groupName": "任意群", "robotName": notify.ROBOT_NAME}), encoding="utf-8")
            with patch.object(notify, "_configuration_path", return_value=config):
                result = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual(result["status"], "not_configured")

    def test_sent_duplicate_and_independent_exact_receipt_read(self):
        gateway = FakeGateway(on_send=lambda: self.assertEqual(JdLogisticsDelivery.objects.get().status, "sending"))
        with self.enabled():
            first = notify.notify(self.body, ACTOR, gateway=gateway)
            second = notify.notify(self.body, ACTOR, gateway=gateway)
            policy = source.options()["notification"]
        self.assertEqual((first["status"], second["status"]), ("sent", "duplicate"))
        self.assertEqual(len(gateway.sends), 1)
        stored = notify.read_deliveries(first["deliveryId"])["items"][0]
        self.assertEqual(stored["status"], "sent")
        self.assertEqual(stored["receiptHash"], first["receiptHash"])
        self.assertEqual(stored["departmentIds"], ["notify-dept"])
        self.assertNotIn("fixture-group", json.dumps(stored))
        self.assertTrue(policy["implemented"])
        self.assertTrue(policy["enabled"])

    def test_same_business_content_new_raw_and_display_revision_stays_duplicate(self):
        gateway = FakeGateway()
        with self.enabled():
            first = notify.notify(self.body, ACTOR, gateway=gateway)
            source.mutate({"operation": "settings", "departmentId": "notify-dept", "name": "仅展示名称变化", "expectedRevision": 2}, ACTOR)
            for ref in self.refs:
                batch = JdLogisticsBatch.objects.get(id=ref["batchId"])
                rows = list(JdLogisticsFact.objects.filter(batch=batch).values_list("data", flat=True))
                repeated = source.import_payload({"operation": "import", "sourceKind": ref["sourceKind"], "departmentId": "notify-dept", "businessUnitCode": "NOTIFY-BU", "rangeStart": batch.range_start.isoformat(), "rangeEnd": batch.range_end.isoformat(), "rawFileHash": "b" * 64, "fileName": "new-raw.xlsx", "rows": rows, "complete": True, "expectedScopeRevision": 1, "origin": "manual", "collectedAt": timezone.now().isoformat()}, ACTOR)
                self.assertEqual(repeated["status"], "duplicate")
            second = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual((first["status"], second["status"]), ("sent", "duplicate"))
        self.assertEqual(first["deliveryId"], second["deliveryId"])
        self.assertEqual(len(gateway.sends), 1)

    def test_unknown_receipts_and_errors_are_durable_and_never_resent(self):
        for outcome in ({"ok": True}, {**receipt(), "dry_run": True}, {**receipt(), "executed": False}, {**receipt(), "partial": True}, {**receipt(), "unknownCount": 1}, receipt("other-group"), {**receipt(), "succeeded": [{"target": "fixture-group", "result": {"success": False}}]}, {**receipt(), "succeededCount": True}, RuntimeError("synthetic timeout with secret sentinel")):
            with self.subTest(outcome=type(outcome).__name__):
                gateway = FakeGateway(outcome=outcome)
                with self.enabled():
                    first = notify.notify(self.body, ACTOR, gateway=gateway)
                    self.assertEqual(first["status"], "unknown")
                    self.assertEqual(JdLogisticsDelivery.objects.get().status, "unknown")
                    replay = notify.notify(self.body, ACTOR, gateway=gateway)
                    self.assertEqual(replay["status"], "unknown")
                self.assertEqual(len(gateway.sends), 1)
                self.assertNotIn("secret sentinel", json.dumps(first))
                # Isolated test cleanup only; production writer has no DELETE.
                JdLogisticsDelivery.objects.all().delete()

    def test_business_day_unknown_fence_survives_new_raw_files_settings_and_source(self):
        gateway = FakeGateway(outcome=RuntimeError("synthetic unknown"))
        with self.enabled():
            first = notify.notify(self.body, ACTOR, gateway=gateway)
            source.mutate({"operation": "settings", "departmentId": "notify-dept", "name": "只改显示名", "expectedRevision": 2}, ACTOR)
            fact = JdLogisticsFact.objects.get(source_kind="realtime_inventory")
            fact.data["onHandQuantity"] = 9
            fact.save(update_fields=["data"])
            again = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual((first["status"], again["status"]), ("unknown", "unknown"))
        self.assertEqual(first["deliveryId"], again["deliveryId"])
        self.assertEqual(len(gateway.sends), 1)

    def test_change_during_final_preflight_denies_before_external_send(self):
        def change(attempt):
            if attempt == 2:
                source.mutate({"operation": "settings", "departmentId": "notify-dept", "pushEnabled": False, "expectedRevision": 2}, ACTOR)
        gateway = FakeGateway(on_preflight=change)
        with self.enabled():
            result = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual(result["status"], "not_configured")
        self.assertEqual(JdLogisticsDelivery.objects.get().status, "denied")
        self.assertEqual(gateway.sends, [])

    def test_change_before_claim_or_inactive_authority_never_reserves_or_sends(self):
        def change(attempt):
            if attempt == 1:
                source.mutate({"operation": "settings", "departmentId": "notify-dept", "pushEnabled": False, "expectedRevision": 2}, ACTOR)
        gateway = FakeGateway(on_preflight=change)
        with self.enabled():
            result = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual(result["status"], "not_configured")
        self.assertEqual(JdLogisticsDelivery.objects.count(), 0)
        self.assertEqual(gateway.sends, [])
        InventoryWriteAuthority.objects.filter(id=1).update(status="d1", authority_epoch=None, cutover_id="", migration_verify_run_id="", activated_at=None)
        disabled = FakeGateway()
        with self.enabled(), self.assertRaises(InventoryApiError):
            notify.notify(self.body, ACTOR, gateway=disabled)
        self.assertEqual(disabled.preflights, 0)
        self.assertEqual(disabled.sends, [])

    def test_owner_loss_never_sends_or_finishes_a_new_owner_record(self):
        def take_over(attempt):
            if attempt == 2:
                JdLogisticsDelivery.objects.update(owner_token="new-owner-token")
        gateway = FakeGateway(on_preflight=take_over)
        with self.enabled():
            result = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual(result["status"], "unknown")
        stored = JdLogisticsDelivery.objects.get()
        self.assertEqual((stored.status, stored.owner_token), ("sending", "new-owner-token"))
        self.assertEqual(gateway.sends, [])

    def test_authority_revocation_in_final_preflight_never_reaches_send(self):
        def revoke(attempt):
            if attempt == 2:
                InventoryWriteAuthority.objects.filter(id=1).update(status="d1", authority_epoch=None, cutover_id="", migration_verify_run_id="", activated_at=None)
        gateway = FakeGateway(on_preflight=revoke)
        with self.enabled():
            result = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(gateway.sends, [])
        self.assertEqual(JdLogisticsDelivery.objects.get().status, "unknown")

    def test_requested_business_unit_is_isolated_from_other_unit_risks(self):
        seed_department("other-dept", "OTHER-BU")
        gateway = FakeGateway()
        with self.enabled():
            result = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual(result["riskCount"], 1)
        delivery = JdLogisticsDelivery.objects.get()
        self.assertNotIn("OTHER-BU", delivery.message_text)
        self.assertEqual({row["departmentId"] for row in delivery.risk_snapshot}, {"notify-dept"})

    def test_zero_sales_and_missing_post_do_not_suppress_known_turnover_risk(self):
        seed_department("mixed-dept", "MIXED-BU", extra_zero=True, missing_post=True)
        gateway = FakeGateway()
        with self.enabled():
            result = notify.notify({"operation": "notify", "departmentIds": ["mixed-dept"]}, ACTOR, gateway=gateway)
        self.assertEqual((result["status"], result["riskCount"], result["unknownCount"]), ("sent", 1, 1))
        self.assertIn("另有 1 条指标待核实", JdLogisticsDelivery.objects.get().message_text)

    def test_no_known_risk_with_unknown_is_not_a_false_empty(self):
        snapshot = JdLogisticsFact.objects.get(source_kind="inventory_snapshot")
        snapshot.data["sales30dQuantity"] = 0
        snapshot.save(update_fields=["data"])
        with self.enabled():
            result = notify.notify(self.body, ACTOR, gateway=FakeGateway())
        self.assertEqual(result["status"], "not_configured")
        self.assertEqual(result["unknownCount"], 1)
        self.assertEqual(JdLogisticsDelivery.objects.count(), 0)

    def test_fully_known_no_risk_is_empty_without_preflight_or_delivery(self):
        snapshot = JdLogisticsFact.objects.get(source_kind="inventory_snapshot")
        snapshot.data["sales30dQuantity"] = 1
        snapshot.save(update_fields=["data"])
        gateway = FakeGateway()
        with self.enabled():
            result = notify.notify(self.body, ACTOR, gateway=gateway)
        self.assertEqual((result["status"], result["riskCount"], result["unknownCount"]), ("empty", 0, 0))
        self.assertEqual(result["coverage"]["knownCount"], 1)
        self.assertEqual(gateway.preflights, 0)
        self.assertEqual(gateway.sends, [])
        self.assertEqual(JdLogisticsDelivery.objects.count(), 0)

    def test_workflow_metadata_complete_bindings_and_no_arbitrary_message(self):
        workflow = {**self.body, "runId": "synthetic-run", "executionId": "synthetic-execution", "protocol": "jd-notify-test", "planHash": "b" * 64, "verifiedBatches": self.refs}
        with self.enabled():
            with self.assertRaises(InventoryApiError):
                notify.notify({**self.body, "verifiedBatches": self.refs}, ACTOR, gateway=FakeGateway())
            with self.assertRaises(InventoryApiError):
                notify.notify({**self.body, "message": "arbitrary"}, ACTOR, gateway=FakeGateway())
            changed = deepcopy(workflow)
            changed["verifiedBatches"][0]["rawFileHash"] = "f" * 64
            with self.assertRaises(InventoryApiError):
                notify.notify(changed, ACTOR, gateway=FakeGateway())
            result = notify.notify(workflow, ACTOR, gateway=FakeGateway())
        self.assertEqual(result["status"], "sent")
        self.assertEqual(JdLogisticsDelivery.objects.get().run_metadata["runId"], "synthetic-run")

    def test_real_gateway_pagination_and_robot_fields_fail_closed(self):
        class Cli:
            def __init__(self, bot=None, more=False):
                self.bot, self.more, self.calls = bot, more, 0
            def run(self, *args):
                self.calls += 1
                if args[:2] == ("chat", "search"):
                    return {"success": True, "result": {"groups": [{"title": notify.GROUP_NAME, "openConversationId": "fixture-group"}], "hasMore": self.more, "nextCursor": str(self.calls)}}
                return {"success": True, "result": {"bots": self.bot}}
        gateway = notify.JdNotificationGateway(Cli(bot=[{"name": notify.ROBOT_NAME, "robotCode": "fixture-robot", "status": 1}]))
        self.assertEqual(gateway.preflight(notify.GROUP_NAME, notify.ROBOT_NAME, []), ("fixture-group", "fixture-robot", []))
        for bots in ([{"name": notify.ROBOT_NAME, "status": 1}], [{"name": notify.ROBOT_NAME, "robotCode": "x", "status": True}], [{"name": notify.ROBOT_NAME, "robotCode": "x", "manageable": True}], [{"name": notify.ROBOT_NAME, "robotCode": "x", "status": 1}, {"name": notify.ROBOT_NAME, "robotCode": "y", "status": 0}]):
            gateway.cli = Cli(bot=bots)
            with self.assertRaises(InventoryApiError):
                gateway.preflight(notify.GROUP_NAME, notify.ROBOT_NAME, [])
        gateway.cli = Cli(more=True)
        with self.assertRaises(InventoryApiError):
            gateway.preflight(notify.GROUP_NAME, notify.ROBOT_NAME, [])
        self.assertEqual(gateway.cli.calls, 5)

    def test_metadata_objects_or_failed_envelopes_cannot_impersonate_real_targets(self):
        class Cli:
            def __init__(self, search, bots):
                self.search, self.bots = search, bots
            def run(self, *args):
                return self.search if args[:2] == ("chat", "search") else self.bots
        real_search = {"success": True, "result": {"groups": [{"title": notify.GROUP_NAME, "openConversationId": "fixture-group"}], "hasMore": False}}
        real_bots = {"success": True, "result": {"bots": [{"name": notify.ROBOT_NAME, "robotCode": "fixture-robot", "status": 1}]}}
        for search, bots in (({"success": False, "result": real_search["result"]}, real_bots), ({"success": True, "result": {"groups": [], "hasMore": False}, "metadata": real_search["result"]}, real_bots), (real_search, {"success": True, "result": {"bots": []}, "metadata": real_bots["result"]}), (real_search, {"success": False, "result": real_bots["result"]})):
            gateway = notify.JdNotificationGateway(Cli(search, bots))
            with self.assertRaises(InventoryApiError):
                gateway.preflight(notify.GROUP_NAME, notify.ROBOT_NAME, [])

    def test_jd_controlled_profile_does_not_require_replenishment_enable_or_table(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "controlled-profile.json"
            path.write_text(json.dumps({"profile": "dingfixturecorp123:fixture-user", "enabled": False}), encoding="utf-8")
            with patch.object(notify, "_controlled_profile_path", return_value=path):
                gateway = notify.JdNotificationGateway()
                self.assertEqual(gateway.profile, "dingfixturecorp123:fixture-user")
                self.assertEqual(gateway.cli.target.profile, gateway.profile)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_http_notifications_are_admin_only_and_receipt_is_exact(self):
        body = json.dumps(self.body)
        for role in ("viewer", "analyst", "operator"):
            result = self.client.post(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, role=role, method="POST", body=body, request_id="notify-deny-" + role))
            self.assertEqual(result.status_code, 403)
            url = BASE + "?operation=notifications&deliveryId=missing"
            self.assertEqual(self.client.get(url, headers=signed_headers(url, role=role)).status_code, 403)
        gateway = FakeGateway()
        with self.enabled(), patch.object(notify, "JdNotificationGateway", return_value=gateway):
            result = self.client.post(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="POST", body=body, request_id="notify-http-fixture"))
        self.assertEqual(result.status_code, 200, result.content)
        delivery_id = result.json()["data"]["deliveryId"]
        url = BASE + "?operation=notifications&deliveryId=" + delivery_id
        checked = self.client.get(url, headers=signed_headers(url)).json()["data"]["items"][0]
        self.assertEqual(checked["receiptHash"], result.json()["data"]["receiptHash"])
        result = self.client.patch(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="PATCH", body=body, role="operator", request_id="notify-patch-denied"))
        self.assertEqual(result.status_code, 400)
