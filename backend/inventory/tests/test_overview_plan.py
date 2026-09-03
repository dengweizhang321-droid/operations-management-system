from __future__ import annotations

from datetime import date
import uuid
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils import timezone

from inventory.models import InventoryWriteAuthority
from inventory.plans import plan_payload, upsert_plan
from inventory.query import _filtered_overview, _mapping_samples
from inventory.views import replenishment
from sales.auth import Principal


def overview_item(
    warehouse: str,
    *,
    available: int,
    sales: int | None,
    in_transit: int = 0,
) -> dict[str, object]:
    return {
        "key": f"{warehouse}\x1fP1",
        "productCode": "P1",
        "productName": "测试货品",
        "brand": "品牌甲",
        "category": "净水设备",
        "supplier": "供应商甲",
        "specification": "",
        "warehouse": warehouse,
        "warehouseType": "jd_rdc" if "京东" in warehouse else "owned",
        "availableQuantity": available,
        "totalInTransitQuantity": in_transit,
        "knownStockValueCents": available * 500,
        "sales30d": sales,
        "coverageDays": available / (sales / 30) if sales else None,
        "suggestedQuantity": 4 if sales else None,
        "status": "replenish" if sales else "no_sales",
        "statusLabel": "建议补货" if sales else "无销量数据",
        "reason": "测试原因",
        "inDraftPlan": False,
    }


class InventoryMappingWorkbenchTests(SimpleTestCase):
    def test_mapping_workbench_uses_filtered_scope_and_fixed_warehouse_groups(self) -> None:
        items = [
            overview_item("广东仓", available=10, sales=None, in_transit=2),
            overview_item("京东北京仓", available=20, sales=30, in_transit=3),
        ]
        filtered = _filtered_overview(items, {"warehouses": ["广东仓"]})
        samples = _mapping_samples(filtered, 30, False)

        self.assertEqual(len(samples), 1)
        self.assertEqual(samples[0]["totalInventoryQuantity"], 10)
        self.assertEqual(samples[0]["warehouses"]["guangdong"]["inventoryQuantity"], 10)
        self.assertEqual(samples[0]["warehouses"]["jd"]["inventoryQuantity"], 0)
        self.assertIsNone(samples[0]["totalSalesQuantity"])
        self.assertEqual(samples[0]["warehouseOptions"][0]["warehouse"], "广东仓")

    def test_manual_plan_can_be_saved_without_fabricating_a_system_suggestion(self) -> None:
        request = RequestFactory().post(
            "/api/inventory/replenishment",
            data={
                "key": "广东仓\x1fP1",
                "plannedQuantity": 12,
                "manual": True,
                "buyer": "采购甲",
                "orderDate": "2026-09-03",
            },
            content_type="application/json",
        )
        principal = Principal("operator@example.test", "运营", "operator", None)
        overview = {
            "controls": {"autoReplenishmentEnabled": False},
            "quality": {"recommendationsSuppressed": True},
            "sync": {"inventoryStale": False, "latestInventoryBatchId": "batch-1"},
            "items": [{
                "productCode": "P1", "productName": "测试货品", "brand": "品牌甲",
                "category": "净水设备", "supplier": "供应商甲", "warehouse": "广东仓",
                "suggestedQuantity": None, "coverageDays": None, "availableQuantity": 25,
                "sales30d": None, "reason": "未匹配销量",
            }],
        }
        captured: dict[str, object] = {}

        def save(data: dict[str, object], _actor: str) -> dict[str, object]:
            captured.update(data)
            return data

        with (
            patch("inventory.views._principal", return_value=principal),
            patch("inventory.views._replay_write", side_effect=lambda _request, _principal, callback: callback()),
            patch("inventory.views.inventory_overview", return_value=overview),
            patch("inventory.views.upsert_plan", side_effect=save),
            patch("inventory.views.plan_payload", side_effect=lambda plan: plan),
        ):
            payload, status = replenishment(request)

        self.assertEqual(status, 201)
        self.assertTrue(payload["ok"])
        self.assertEqual(captured["suggestedQuantity"], 0)
        self.assertEqual(captured["plannedQuantity"], 12)
        self.assertEqual(captured["buyer"], "采购甲")
        self.assertIn("人工创建", captured["reason"])


class ReplenishmentPlanDetailsTests(TestCase):
    def setUp(self) -> None:
        InventoryWriteAuthority.objects.filter(id=1).update(
            status="postgres",
            authority_epoch=uuid.UUID("11111111-1111-4111-8111-111111111111"),
            cutover_id="inventory-test-cutover",
            migration_verify_run_id="inventory-apply-" + "1" * 32,
            activated_at=timezone.now(),
        )

    def test_manual_plan_persists_procurement_and_arrival_details(self) -> None:
        plan = upsert_plan(
            {
                "sourceBatchId": "batch-1",
                "productCode": "P1",
                "productName": "测试货品",
                "brand": "品牌甲",
                "category": "净水设备",
                "supplier": "供应商甲",
                "warehouse": "广东仓",
                "buyer": "采购甲",
                "operatorName": "运营甲",
                "department": "电商部",
                "planType": "常规",
                "orderDate": date(2026, 9, 3),
                "expectedArrivalDate": date(2026, 9, 10),
                "requiresInspection": True,
                "currentStockQuantity": 25,
                "sales30dQuantity": 37,
                "suggestedQuantity": 0,
                "plannedQuantity": 12,
                "coverageDays": 20.3,
                "reason": "人工创建",
                "notes": "优先安排",
                "status": "draft",
            },
            "operator@example.test",
        )
        payload = plan_payload(plan)

        self.assertEqual(payload["buyer"], "采购甲")
        self.assertEqual(payload["operatorName"], "运营甲")
        self.assertEqual(payload["orderDate"], "2026-09-03")
        self.assertEqual(payload["expectedArrivalDate"], "2026-09-10")
        self.assertTrue(payload["requiresInspection"])
        self.assertEqual(payload["sales30dQuantity"], 37)
        self.assertEqual(payload["notes"], "优先安排")
