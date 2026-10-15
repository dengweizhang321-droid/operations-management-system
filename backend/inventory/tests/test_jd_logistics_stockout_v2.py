"""Only the available-stock warning v2 business delta; no old-suite reruns."""
from datetime import timedelta
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
from unittest.mock import patch
import uuid

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from inventory import jd_logistics as source
from inventory import jd_logistics_notifications as notification
from inventory.jd_logistics_models import JdLogisticsDelivery
from inventory.models import InventoryWriteAuthority
from inventory.tests.test_jd_logistics_notifications import ACTOR, FakeGateway


def pair(*, on_hand=5, available=0, sales30=2, sales7=14):
    current = timezone.now()
    today = current.astimezone(source.SHANGHAI).date()
    yesterday = today - timedelta(days=1)
    live = SimpleNamespace(data={"onHandQuantity": on_hand, "availableQuantity": available, "lockedQuantity": 0, "purchaseInTransitQuantity": 0, "transferInTransitQuantity": 5}, business_date=today, batch=SimpleNamespace(collected_at=current))
    snapshot = SimpleNamespace(data={"sales7dQuantity": sales7, "sales30dQuantity": sales30, "sourceAttributes": {"30天周转": "75"}}, business_date=yesterday, batch=SimpleNamespace(collected_at=current, source_as_of=yesterday.isoformat()))
    return live, snapshot


def metrics(live, snapshot, window):
    date_qualifications, _pairing, _lag = source._inventory_date_pair(live, snapshot)
    return source._warehouse_metrics(live, snapshot, date_qualifications, window)


class StockoutV2MetricTests(SimpleTestCase):
    def test_zero_available_with_in_transit_is_risk_without_redefining_turnover(self):
        live, snapshot = pair()
        result = metrics(live, snapshot, 30)
        self.assertEqual(result["turnoverDays"], 75)
        self.assertEqual(result["nativeTurnover30d"], 75)
        self.assertEqual(result["postReplenishmentQuantity"], 5)
        self.assertEqual(result["stockoutAvailableDays30d"], 0)
        self.assertEqual(source._monitor_warning(result["stockoutAvailableDays30d"], 15, True), "stockout_risk")

    def test_missing_on_hand_does_not_block_available_stock_risk(self):
        live, snapshot = pair(on_hand=None)
        result = metrics(live, snapshot, 30)
        self.assertIsNone(result["turnoverDays"])
        self.assertEqual(result["stockoutAvailableDays30d"], 0)
        self.assertEqual(result["metricQualifications"]["stockoutAvailableDays30d"], [])
        self.assertEqual(source._monitor_warning(result["stockoutAvailableDays30d"], 15, True), "stockout_risk")
        for available, sales in ((None, 2), (0, None), (0, 0), (0, -1)):
            live, snapshot = pair(available=available, sales30=sales)
            unknown = metrics(live, snapshot, 30)
            self.assertIsNone(unknown["stockoutAvailableDays30d"])
            self.assertTrue(unknown["metricQualifications"]["stockoutAvailableDays30d"])
            self.assertEqual(source._monitor_warning(unknown["stockoutAvailableDays30d"], 15, True), "insufficient_evidence")
        live, snapshot = pair()
        snapshot.business_date -= timedelta(days=2)
        snapshot.batch.source_as_of = snapshot.business_date.isoformat()
        stale = metrics(live, snapshot, 30)
        self.assertIsNone(stale["stockoutAvailableDays30d"])
        self.assertIn("source_date_mismatch", stale["metricQualifications"]["stockoutAvailableDays30d"])

    def test_window_switch_does_not_change_fixed_thirty_day_warning(self):
        live, snapshot = pair(available=1, sales30=2, sales7=14)
        seven, thirty = metrics(live, snapshot, 7), metrics(live, snapshot, 30)
        self.assertEqual((seven["availableDays"], thirty["availableDays"]), (0.5, 15))
        self.assertEqual((seven["stockoutAvailableDays30d"], thirty["stockoutAvailableDays30d"]), (15, 15))
        self.assertEqual(source._monitor_warning(seven["stockoutAvailableDays30d"], 20, True), source._monitor_warning(thirty["stockoutAvailableDays30d"], 20, True))

    def test_matrix_warning_sums_quantity_and_demand_before_ratio(self):
        rows = []
        for available, sales in ((0, 2), (4, 8), (0, 0)):
            live, snapshot = pair(available=available, sales30=sales)
            rows.append({**metrics(live, snapshot, 7), "stockoutThresholdDays": 15, "monitorEnabled": True, "qualifications": [], "realtimeDate": live.business_date.isoformat(), "snapshotDate": snapshot.business_date.isoformat()})
        result = source._aggregate_metrics(rows, 7)
        self.assertEqual(result["stockoutAvailableDays30d"], 12)  # 4 / 10 * 30, not the mean of warehouse days.
        self.assertEqual(result["warningState"], "stockout_risk")
        self.assertIsNone(result["nativeTurnover30d"])
        rows[1]["availableQuantity"] = None
        rows[1]["metricQualifications"]["availableQuantity"] = ["missing_availableQuantity"]
        rows[1]["metricQualifications"]["stockoutAvailableDays30d"] = ["missing_availableQuantity"]
        unknown = source._aggregate_metrics(rows, 30)
        self.assertIsNone(unknown["stockoutAvailableDays30d"])
        self.assertEqual(unknown["warningState"], "insufficient_evidence")

    def test_notification_configuration_digest_freezes_rule_semantics(self):
        current = notification.notification_policy()
        with patch.object(notification, "RULE_VERSION", "jd-stockout-notification-v1"):
            old = notification.notification_policy()
        self.assertTrue(current["configured"])
        self.assertNotEqual(current["configDigest"], old["configDigest"])


class StockoutV2NotificationTest(TestCase):
    def test_new_warning_reaches_fixed_target_and_source_snapshot_message(self):
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(), cutover_id="stockout-v2-fixture", migration_verify_run_id="stockout-v2-fixture", activated_at=timezone.now())
        source.mutate({"operation": "settings", "departmentId": "v2-dept", "businessUnitCode": "V2-BU", "name": "V2合成事业部", "expectedRevision": 0}, ACTOR)
        source.mutate({"operation": "settings", "departmentId": "v2-dept", "storeKeys": ["fixture-store"], "capabilities": {"realtime_inventory": True, "inventory_snapshot": True}, "logisticsEnabled": True, "monitorEnabled": True, "pushEnabled": True, "stockoutThresholdDays": 15, "expectedRevision": 1}, ACTOR)
        now = timezone.now()
        today = now.astimezone(source.SHANGHAI).date()
        yesterday = today - timedelta(days=1)
        live = {"businessUnitCode": "V2-BU", "goodsCode": "V2-SKU", "goodsName": "合成可用零库存商品", "warehouseCode": "", "warehouseName": "合成V2仓", "snapshotDate": today.isoformat(), "onHandQuantity": None, "availableQuantity": 0, "purchaseInTransitQuantity": 0, "transferInTransitQuantity": 5}
        snapshot = {**live, "snapshotDate": yesterday.isoformat(), "sales7dQuantity": 14, "sales30dQuantity": 2, "sourceAttributes": {"30天周转": "75"}}
        for kind, row in (("realtime_inventory", live), ("inventory_snapshot", snapshot)):
            source.import_payload({"operation": "import", "sourceKind": kind, "departmentId": "v2-dept", "businessUnitCode": "V2-BU", "rangeStart": yesterday.isoformat(), "rangeEnd": (today + timedelta(days=1)).isoformat(), "rawFileHash": "c" * 64, "fileName": "synthetic-v2.xlsx", "complete": True, "expectedScopeRevision": 0, "origin": "manual", "collectedAt": now.isoformat(), "rows": [row]}, ACTOR)
        monitor = source.inventory_monitor({"departmentId": "v2-dept", "page": 1, "pageSize": 50, "layout": "product", "salesWindow": 7})
        self.assertEqual(monitor["items"][0]["summary"]["stockoutAvailableDays30d"], 0)
        self.assertEqual(monitor["items"][0]["summary"]["warningState"], "stockout_risk")
        gateway = FakeGateway()
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "v2-notification.json"
            config.write_text(json.dumps({"version": 1, "enabled": True, "groupName": notification.GROUP_NAME, "robotName": notification.ROBOT_NAME}), encoding="utf-8")
            with patch.object(notification, "_configuration_path", return_value=config):
                response = notification.notify({"operation": "notify", "departmentIds": ["v2-dept"]}, ACTOR, gateway=gateway)
                expected_digest = notification.notification_policy()["configDigest"]
        self.assertEqual(response["status"], "sent")
        self.assertEqual((response["riskCount"], response["unknownCount"]), (1, 0))
        self.assertEqual(gateway.sends[0]["group_id"], "fixture-group")
        self.assertEqual(gateway.sends[0]["robot_code"], "fixture-robot")
        self.assertIn("30日可用可售 0", gateway.sends[0]["message"])
        self.assertNotIn("周转 75", gateway.sends[0]["message"])
        self.assertNotIn("None", gateway.sends[0]["message"])
        ledger = JdLogisticsDelivery.objects.get()
        self.assertEqual(ledger.risk_snapshot[0]["stockoutAvailableDays30d"], 0)
        self.assertIsNone(ledger.risk_snapshot[0]["onHandQuantity"])
        self.assertEqual(ledger.scope_snapshot["ruleVersion"], "jd-stockout-notification-v2")
        self.assertEqual(ledger.config_digest, expected_digest)
