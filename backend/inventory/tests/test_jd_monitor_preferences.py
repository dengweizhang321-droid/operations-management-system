"""Isolated settings, warehouse visibility and stable product ordering."""
from datetime import timedelta
import json
from unittest.mock import patch
import uuid

from django.test import TestCase
from django.utils import timezone

from inventory import jd_logistics as service
from inventory.errors import InventoryApiError
from inventory.jd_logistics_models import JdLogisticsDepartment, JdLogisticsAudit
from inventory.models import InventoryWriteAuthority
from sales.tests.factories import TEST_SECRET, signed_headers

ACTOR = "monitor-fixture@example.invalid"
BASE = "/api/inventory/jd-logistics"


class MonitorPreferencesTests(TestCase):
    def setUp(self):
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(), cutover_id="monitor-fixture", migration_verify_run_id="monitor-fixture", activated_at=timezone.now())
        self.now = timezone.now()
        today = self.now.astimezone(service.SHANGHAI).date()
        for department in ("ONE", "TWO"):
            service.mutate({"operation": "settings", "departmentId": department, "businessUnitCode": department, "name": department, "expectedRevision": 0}, ACTOR)
            rows = [{"businessUnitCode": department, "goodsCode": goods, "goodsName": f"合成商品{goods}", "warehouseCode": code, "warehouseName": f"来源仓{code}", "snapshotDate": today.isoformat(), "availableQuantity": available, "onHandQuantity": available, "lockedQuantity": 0, "purchaseInTransitQuantity": 0, "transferInTransitQuantity": 0} for goods in ("A", "B", "C", "D") for code, available in (("W1", 0), ("W2", 50), ("W3", 10))]
            for kind in ("realtime_inventory", "inventory_snapshot"):
                data = rows if kind == "realtime_inventory" else [{**row, "snapshotDate": (today - timedelta(days=1)).isoformat(), "sales7dQuantity": 7, "sales30dQuantity": 30, "sourceProvinceCity": "同一城市"} for row in rows]
                service.import_payload({"operation": "import", "sourceKind": kind, "departmentId": department, "businessUnitCode": department, "rangeStart": (today - timedelta(days=1)).isoformat(), "rangeEnd": (today + timedelta(days=1)).isoformat(), "rawFileHash": "f" * 64, "fileName": "synthetic.xlsx", "complete": True, "expectedScopeRevision": 0, "origin": "manual", "collectedAt": self.now.isoformat(), "rows": data}, ACTOR)
        self.filters = {"departmentId": "ONE", "layout": "product", "page": 1, "pageSize": 2}

    def save(self, **values):
        row = JdLogisticsDepartment.objects.get(id="ONE")
        return service.mutate({"operation": "settings", "departmentId": row.id, "expectedRevision": row.revision, **values}, ACTOR)

    def test_warehouse_order_alias_hidden_totals_health_and_department_isolation(self):
        first = service.inventory_monitor(self.filters)
        self.assertEqual(len(first["columns"]), 3)  # Same city, three independent warehouses.
        preferences = [{"warehouseKey": "code:W3", "displayName": "优先仓", "enabled": True}, {"warehouseKey": "code:W1", "displayName": "隐藏风险仓", "enabled": False}, {"warehouseKey": "code:W2", "displayName": "", "enabled": True}]
        self.save(warehousePreferences=preferences)
        data = service.inventory_monitor(self.filters)
        self.assertEqual([column["label"] for column in data["columns"]], ["优先仓", "来源仓W2"])
        self.assertEqual(data["totals"]["availableQuantity"], 240)
        self.assertEqual(data["healthFilterCounts"]["stockout"], 0)
        self.assertEqual([row["warehouseKey"] for row in data["items"][0]["details"]], ["code:W3", "code:W2"])
        self.assertEqual(data["items"][0]["details"][0]["warehouseName"], "来源仓W3")
        self.assertEqual(data["items"][0]["details"][0]["warehouseDisplayName"], "优先仓")
        self.assertEqual(service.inventory_monitor({**self.filters, "warehouseKey": "code:W1"})["total"], 0)
        other = service.inventory_monitor({**self.filters, "departmentId": "TWO"})
        self.assertEqual(len(other["columns"]), 3)
        self.assertEqual(other["healthFilterCounts"]["stockout"], 4)
        # Internal notification recomputation keeps its preexisting independent scope.
        self.assertEqual(service.inventory_monitor({**self.filters, "applyWarehousePreferences": False})["healthFilterCounts"]["stockout"], 4)
        self.assertEqual(next(row for row in service.options()["departments"] if row["id"] == "ONE")["warehousePreferences"], preferences)
        self.save(warehousePreferences=[{**row, "enabled": False} for row in preferences])
        empty = service.inventory_monitor(self.filters)
        self.assertEqual((empty["total"], empty["columns"], empty["items"]), (0, [], []))
        self.save(warehousePreferences=[{**row, "enabled": True} for row in preferences])
        self.assertEqual(service.inventory_monitor(self.filters)["total"], 4)

    def test_product_move_is_global_before_filter_and_pagination_preserving_hidden_codes(self):
        self.save(productMove={"goodsCode": "D", "targetGoodsCode": "C"})
        self.assertEqual([row["goodsCode"] for row in service.inventory_monitor(self.filters)["items"]], ["A", "B"])
        self.assertEqual([row["goodsCode"] for row in service.inventory_monitor({**self.filters, "page": 2})["items"]], ["D", "C"])
        self.save(productMove={"goodsCode": "D", "targetGoodsCode": "A"})
        self.assertEqual([row["goodsCode"] for row in service.inventory_monitor(self.filters)["items"]], ["D", "A"])
        self.assertEqual(JdLogisticsDepartment.objects.get(id="ONE").product_order, ["D", "A", "B", "C"])
        self.assertEqual(JdLogisticsDepartment.objects.get(id="TWO").product_order, [])
        self.save(productMove={"goodsCode": "A", "targetGoodsCode": "C", "placement": "after"})
        self.assertEqual(JdLogisticsDepartment.objects.get(id="ONE").product_order, ["D", "B", "C", "A"])
        self.save(name="仅改名称")
        self.assertEqual(JdLogisticsDepartment.objects.get(id="ONE").product_order, ["D", "B", "C", "A"])

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_validation_permissions_cas_and_audit(self):
        body = json.dumps({"operation": "settings", "departmentId": "ONE", "expectedRevision": 1, "warehousePreferences": [{"warehouseKey": "code:W1", "displayName": "别名", "enabled": False}]})
        for role in ("viewer", "operator"):
            result = self.client.patch(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="PATCH", role=role, body=body, request_id=f"denied-{role}"))
            self.assertEqual(result.status_code, 403)
        allowed = self.client.patch(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="PATCH", body=body, request_id="allowed-monitor"))
        self.assertEqual(allowed.status_code, 200, allowed.content)
        stale = self.client.patch(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="PATCH", body=body, request_id="stale-monitor"))
        self.assertEqual(stale.status_code, 409)
        before = JdLogisticsDepartment.objects.get(id="ONE").revision
        good = {"warehouseKey": "code:W1", "displayName": "", "enabled": True}
        for values in (None, [good, good], [{**good, "warehouseKey": "code:UNKNOWN"}], [{**good, "enabled": "false"}], [{**good, "displayName": "x" * 81}]):
            with self.subTest(values=values), self.assertRaises(InventoryApiError):
                self.save(warehousePreferences=values)
        with self.assertRaises(InventoryApiError):
            self.save(productMove={"goodsCode": "UNKNOWN", "targetGoodsCode": "A"})
        for placement in ([], {}, True, "sideways"):
            with self.subTest(placement=placement), self.assertRaises(InventoryApiError):
                self.save(productMove={"goodsCode": "A", "targetGoodsCode": "B", "placement": placement})
        self.assertEqual(JdLogisticsDepartment.objects.get(id="ONE").revision, before)
        audit = JdLogisticsAudit.objects.filter(department_id="ONE", operation="settings").order_by("-created_at").first()
        self.assertEqual(audit.after["warehousePreferences"][0]["displayName"], "别名")
