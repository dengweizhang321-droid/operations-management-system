"""Narrow replenishment-cycle/settings/math delta, with no external effects."""
from datetime import timedelta
import json
from unittest.mock import patch
import uuid

from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from inventory import jd_logistics as source
from inventory.errors import InventoryApiError
from inventory.jd_logistics_models import JdLogisticsDepartment
from inventory.models import InventoryWriteAuthority
from inventory.tests.test_jd_logistics_stockout_v2 import pair
from sales.tests.factories import TEST_SECRET, signed_headers

ACTOR = "replenishment-fixture@example.invalid"
BASE = "/api/inventory/jd-logistics"


def warehouse(*, demand=30, cycle=30, available=0, purchase=0, transfer=0, window=30, on_hand=None, date_reasons=None):
    live, snapshot = pair(on_hand=on_hand, available=available, sales30=demand)
    live.data.update(purchaseInTransitQuantity=purchase, transferInTransitQuantity=transfer)
    result = source._warehouse_metrics(live, snapshot, date_reasons or [], window, cycle)
    return {**result, "realtimeDate": live.business_date.isoformat(), "snapshotDate": snapshot.business_date.isoformat(), "qualifications": [], "stockoutThresholdDays": None, "monitorEnabled": False}


class ReplenishmentMathTests(SimpleTestCase):
    def test_fractional_daily_demand_uses_exact_ceiling_and_cycle(self):
        self.assertEqual(warehouse(demand=1, cycle=1)["suggestedReplenishmentQuantity"], 1)
        self.assertEqual(warehouse(demand=3, cycle=10)["suggestedReplenishmentQuantity"], 1)
        self.assertEqual(warehouse(demand=30, cycle=30, available=1, purchase=2, transfer=3)["suggestedReplenishmentQuantity"], 24)
        self.assertEqual(warehouse(demand=1_000_000_000, cycle=3650)["suggestedReplenishmentQuantity"], 121_666_666_667)
        self.assertEqual(warehouse(demand=30, cycle=30, available=100)["suggestedReplenishmentQuantity"], 0)

    def test_window_on_hand_threshold_and_monitor_do_not_change_recommendation(self):
        seven, thirty = warehouse(window=7), warehouse(window=30)
        self.assertIsNone(seven["onHandQuantity"])
        self.assertIsNone(seven["stockoutThresholdDays"])
        self.assertFalse(seven["monitorEnabled"])
        self.assertEqual((seven["suggestedReplenishmentQuantity"], thirty["suggestedReplenishmentQuantity"]), (30, 30))

    def test_missing_required_components_or_negative_demand_are_unknown(self):
        for args in ({"available": None}, {"purchase": None}, {"transfer": None}, {"demand": None}, {"demand": -1}, {"date_reasons": ["source_date_mismatch"]}):
            with self.subTest(args=args):
                row = warehouse(**args)
                self.assertIsNone(row["suggestedReplenishmentQuantity"])
                self.assertTrue(row["metricQualifications"]["suggestedReplenishmentQuantity"])
        self.assertEqual(warehouse(demand=0)["suggestedReplenishmentQuantity"], 0)
        self.assertEqual(warehouse(demand=0, available=-3)["suggestedReplenishmentQuantity"], 3)
        self.assertEqual(warehouse(demand=0, available=3)["suggestedReplenishmentQuantity"], 0)
        self.assertIsNone(warehouse(demand=0, available=None)["suggestedReplenishmentQuantity"])

    def test_group_sums_warehouse_shortages_without_surplus_cancelling_another_warehouse(self):
        excess, shortage = warehouse(available=100), warehouse(available=0)
        result = source._aggregate_metrics([excess, shortage], 30)
        self.assertEqual((excess["suggestedReplenishmentQuantity"], shortage["suggestedReplenishmentQuantity"]), (0, 30))
        self.assertEqual(result["suggestedReplenishmentQuantity"], 30)
        self.assertEqual(result["replenishmentCycleDays"], 30)
        self.assertEqual(result["replenishmentCycleDaysValues"], [30])
        unknown = source._aggregate_metrics([shortage, warehouse(purchase=None)], 30)
        self.assertIsNone(unknown["suggestedReplenishmentQuantity"])

    def test_mixed_cycles_disclose_each_cycle_without_recomputing_one_cycle(self):
        result = source._aggregate_metrics([warehouse(cycle=30), warehouse(cycle=60)], 7)
        self.assertEqual(result["suggestedReplenishmentQuantity"], 90)
        self.assertIsNone(result["replenishmentCycleDays"])
        self.assertEqual(result["replenishmentCycleDaysValues"], [30, 60])
        self.assertIn("mixed_replenishment_cycles", result["metricQualifications"]["suggestedReplenishmentQuantity"])
        self.assertIn("mixed_replenishment_cycles", result["qualifications"])


class ReplenishmentCycleSettingsTests(TestCase):
    def setUp(self):
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(), cutover_id="cycle-ram-fixture", migration_verify_run_id="cycle-ram-fixture", activated_at=timezone.now())
        source.mutate({"operation": "settings", "departmentId": "cycle-fixture", "businessUnitCode": "CYCLE-BU", "name": "合成周期事业部", "expectedRevision": 0}, ACTOR)

    def patch_settings(self, **values):
        row = JdLogisticsDepartment.objects.get(id="cycle-fixture")
        return source.mutate({"operation": "settings", "departmentId": row.id, "expectedRevision": row.revision, **values}, ACTOR)

    def test_default_bounds_omission_and_stale_cas(self):
        row = next(row for row in source.options()["departments"] if row["id"] == "cycle-fixture")
        self.assertEqual(row["replenishmentCycleDays"], 30)
        first = self.patch_settings(replenishmentCycleDays=1)
        self.assertEqual(first["replenishmentCycleDays"], 1)
        second = self.patch_settings(replenishmentCycleDays=3650)
        self.assertEqual(second["replenishmentCycleDays"], 3650)
        preserved = self.patch_settings(name="只改显示名称")
        self.assertEqual(preserved["replenishmentCycleDays"], 3650)
        with self.assertRaises(InventoryApiError) as error:
            source.mutate({"operation": "settings", "departmentId": "cycle-fixture", "expectedRevision": first["revision"], "replenishmentCycleDays": 30}, ACTOR)
        self.assertEqual(error.exception.code, "version_conflict")
        self.assertEqual(JdLogisticsDepartment.objects.get(id="cycle-fixture").replenishment_cycle_days, 3650)

    def test_invalid_cycle_rolls_back_and_database_bounds_are_structural(self):
        before = JdLogisticsDepartment.objects.get(id="cycle-fixture")
        for value in (True, False, None, 0, -1, 3651, 1.5, "30"):
            with self.subTest(value=value), self.assertRaises(InventoryApiError):
                self.patch_settings(replenishmentCycleDays=value)
        current = JdLogisticsDepartment.objects.get(id=before.id)
        self.assertEqual((current.revision, current.replenishment_cycle_days), (before.revision, 30))
        with self.assertRaises(IntegrityError), transaction.atomic():
            JdLogisticsDepartment.objects.filter(id=before.id).update(replenishment_cycle_days=0)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_admin_setting_and_inventory_projection_are_server_computed_when_monitor_is_off(self):
        now = timezone.now()
        today = now.astimezone(source.SHANGHAI).date()
        yesterday = today - timedelta(days=1)
        live = {"businessUnitCode": "CYCLE-BU", "goodsCode": "CYCLE-SKU", "goodsName": "合成周期商品", "warehouseCode": "", "warehouseName": "合成来源仓", "snapshotDate": today.isoformat(), "onHandQuantity": None, "availableQuantity": 0, "purchaseInTransitQuantity": 0, "transferInTransitQuantity": 0}
        snapshot = {**live, "snapshotDate": yesterday.isoformat(), "sales7dQuantity": 1, "sales30dQuantity": 30}
        for kind, row in (("realtime_inventory", live), ("inventory_snapshot", snapshot)):
            source.import_payload({"operation": "import", "sourceKind": kind, "departmentId": "cycle-fixture", "businessUnitCode": "CYCLE-BU", "rangeStart": yesterday.isoformat(), "rangeEnd": (today + timedelta(days=1)).isoformat(), "rawFileHash": "f" * 64, "fileName": "synthetic-cycle.xlsx", "complete": True, "expectedScopeRevision": 0, "origin": "manual", "collectedAt": now.isoformat(), "rows": [row]}, ACTOR)
        filters = {"departmentId": "cycle-fixture", "page": 1, "pageSize": 50, "layout": "product", "salesWindow": 7}
        first = source.inventory_monitor(filters)["items"][0]
        self.assertEqual(first["summary"]["suggestedReplenishmentQuantity"], 30)
        self.assertEqual(first["summary"]["warningState"], "unconfigured")
        body = json.dumps({"operation": "settings", "departmentId": "cycle-fixture", "expectedRevision": 1, "replenishmentCycleDays": 45})
        forbidden = self.client.patch(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="PATCH", role="operator", body=body, request_id="cycle-operator-denied"))
        self.assertEqual(forbidden.status_code, 403)
        allowed = self.client.patch(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="PATCH", body=body, request_id="cycle-admin-fixture"))
        self.assertEqual(allowed.status_code, 200, allowed.content)
        self.assertEqual(allowed.json()["data"]["replenishmentCycleDays"], 45)
        second = source.inventory_monitor({**filters, "salesWindow": 30})["items"][0]
        self.assertEqual(second["summary"]["suggestedReplenishmentQuantity"], 45)
        self.assertEqual(second["details"][0]["replenishmentCycleDays"], 45)
