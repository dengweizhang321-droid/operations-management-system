"""Product monitoring preferences and source-native extra sales windows."""
import json
from unittest.mock import patch

from django.test import TestCase

from inventory import jd_logistics as service
from inventory.errors import InventoryApiError
from inventory.jd_logistics_models import JdLogisticsAudit, JdLogisticsDepartment, JdLogisticsFact
from inventory.tests import test_jd_monitor_preferences as preferences
from sales.tests.factories import TEST_SECRET, signed_headers


class ProductMonitoringTests(TestCase):
    setUp = preferences.MonitorPreferencesTests.setUp
    save = preferences.MonitorPreferencesTests.save

    def test_cancel_moves_product_out_of_active_statistics_into_inactive_pages_and_restore(self):
        self.save(productMonitoring={"goodsCode": "A", "enabled": False})
        active = service.inventory_monitor(self.filters)
        self.assertEqual((active["total"], active["inactiveTotal"], active["healthFilterCounts"]["all"]), (3, 1, 3))
        self.assertEqual([row["goodsCode"] for row in active["items"]], ["B", "C"])
        self.assertEqual(active["totals"]["availableQuantity"], 180)
        inactive = service.inventory_monitor({**self.filters, "monitoringState": "inactive"})
        self.assertEqual((inactive["total"], inactive["items"][0]["goodsCode"], inactive["items"][0]["detailCount"]), (1, "A", 3))
        self.assertEqual(inactive["monitoringState"], "inactive")
        self.assertEqual(service.inventory_monitor({**self.filters, "applyWarehousePreferences": False})["total"], 3)
        self.assertEqual(service.inventory_monitor({**self.filters, "departmentId": "TWO"})["total"], 4)
        self.assertEqual(JdLogisticsFact.objects.filter(department_id="ONE", goods_code="A").count(), 6)
        self.save(productMonitoring={"goodsCode": "A", "enabled": True})
        self.assertEqual(service.inventory_monitor(self.filters)["total"], 4)
        self.assertEqual(service.inventory_monitor({**self.filters, "monitoringState": "inactive"})["total"], 0)

    def test_monitoring_validation_is_bounded_isolated_and_other_settings_preserve_state(self):
        self.save(productMonitoring={"goodsCode": "A", "enabled": False})
        self.save(name="仅改名称")
        self.save(productMonitoring={"goodsCode": "A", "enabled": False})
        self.assertEqual(JdLogisticsDepartment.objects.get(id="ONE").unmonitored_product_codes, ["A"])
        row = JdLogisticsDepartment.objects.get(id="ONE")
        for value in (None, [], {"goodsCode": "UNKNOWN", "enabled": False}, {"goodsCode": "A", "enabled": "false"}, {"goodsCode": "A", "enabled": False, "departmentId": "TWO"}):
            with self.subTest(value=value), self.assertRaises(InventoryApiError):
                self.save(productMonitoring=value)
        self.assertEqual(JdLogisticsDepartment.objects.get(id="ONE").revision, row.revision)
        audit = JdLogisticsAudit.objects.filter(department_id="ONE", operation="settings").order_by("-created_at").first()
        self.assertEqual(audit.after["unmonitoredProductCodes"], ["A"])
        for state in ("all", "", True, []):
            with self.subTest(state=state), self.assertRaises(InventoryApiError):
                service.inventory_monitor({**self.filters, "monitoringState": state})

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_signed_monitoring_write_permissions_and_revision_conflict(self):
        path = "/api/inventory/jd-logistics"
        body = json.dumps({"operation": "settings", "departmentId": "ONE", "expectedRevision": 1, "productMonitoring": {"goodsCode": "A", "enabled": False}})
        for role in ("viewer", "operator"):
            response = self.client.patch(path, data=body, content_type="application/json", headers=signed_headers(path, method="PATCH", role=role, body=body, request_id=f"monitor-{role}"))
            self.assertEqual(response.status_code, 403)
        response = self.client.patch(path, data=body, content_type="application/json", headers=signed_headers(path, method="PATCH", body=body, request_id="monitor-admin"))
        self.assertEqual(response.status_code, 200, response.content)
        stale = self.client.patch(path, data=body, content_type="application/json", headers=signed_headers(path, method="PATCH", body=body, request_id="monitor-stale"))
        self.assertEqual(stale.status_code, 409)
        for state, expected in (("inactive", 200), ("other", 400), ("", 400)):
            url = path + f"?operation=inventory_monitor&departmentId=ONE&layout=product&monitoringState={state}"
            self.assertEqual(self.client.get(url, headers=signed_headers(url)).status_code, expected)

    def test_three_and_fifteen_day_sales_use_source_columns_without_changing_health_or_hashes(self):
        before = service.inventory_monitor(self.filters)
        facts = JdLogisticsFact.objects.filter(department_id="ONE", source_kind="inventory_snapshot")
        original_hashes = list(facts.order_by("id").values_list("id", "row_hash"))
        for row in facts:
            row.data = {**row.data, "sourceAttributes": {"近3天销售出库件数": "0" if row.warehouse_code == "W1" else "3", "近15天销售出库件数": "-2" if row.warehouse_code == "W1" else "15"}}
            row.save(update_fields=["data"])
        data = service.inventory_monitor(self.filters)
        product = data["items"][0]
        self.assertEqual((product["summary"]["sales3dQuantity"], product["summary"]["sales15dQuantity"]), (6, 28))
        self.assertEqual((product["details"][0]["sales3dQuantity"], product["details"][0]["sales15dQuantity"]), (0, -2))
        self.assertEqual(data["healthFilterCounts"], before["healthFilterCounts"])
        self.assertEqual(product["summary"]["suggestedReplenishmentQuantity"], before["items"][0]["summary"]["suggestedReplenishmentQuantity"])
        self.assertEqual(list(facts.order_by("id").values_list("id", "row_hash")), original_hashes)
        for raw in (None, "", "not-a-number", "1.5", "9007199254740992"):
            quantity, reasons = service._extra_source_sales({"sourceAttributes": {"近3天销售出库件数": raw}}, 3)
            self.assertIsNone(quantity)
            self.assertTrue(reasons)
