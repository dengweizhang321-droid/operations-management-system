from __future__ import annotations

import uuid
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from inventory.dingtalk_group_message import (
    build_group_preview,
    preview_group_message,
    send_group_message,
)
from inventory.errors import InventoryApiError
from inventory.models import (
    InventoryWriteAuthority,
    ReplenishmentGroupDelivery,
    ReplenishmentPlanItem,
)


class FakeGroupGateway:
    def __init__(self, *, fail_send: bool = False) -> None:
        self.fail_send = fail_send
        self.preflights: list[tuple[str, str, list[str]]] = []
        self.sends: list[dict[str, object]] = []

    def preflight(self, group_name: str, robot_name: str, buyers: list[str]):
        self.preflights.append((group_name, robot_name, buyers))
        return "group-1", "robot-1", [f"user-{buyer}" for buyer in buyers]

    def send(self, **kwargs):
        self.sends.append(kwargs)
        if self.fail_send:
            raise InventoryApiError("模拟发送结果不明确", code="service_unavailable", status=503)
        return {"ok": True, "result": {"success": True, "messageId": "message-1"}}


def make_plan(code: str, name: str, buyer: str, supplier: str, quantity: int) -> ReplenishmentPlanItem:
    return ReplenishmentPlanItem.objects.create(
        id=str(uuid.uuid4()),
        source_batch_id="batch-1",
        product_code=code,
        product_name=name,
        supplier=supplier,
        warehouse="广东仓",
        buyer=buyer,
        current_stock_quantity=1,
        suggested_quantity=quantity,
        planned_quantity=quantity,
        status="confirmed",
    )


class DingTalkGroupMessageTests(TestCase):
    def setUp(self) -> None:
        InventoryWriteAuthority.objects.filter(id=1).update(
            status="postgres",
            authority_epoch=uuid.UUID("11111111-1111-4111-8111-111111111111"),
            cutover_id="inventory-test-cutover",
            migration_verify_run_id="inventory-apply-" + "1" * 32,
            activated_at=timezone.now(),
        )

    def test_preview_groups_by_buyer_and_supplier_with_exact_wording(self) -> None:
        first = make_plan("TRS-ZK-60-033", "特睿思ZK-60水尺款开水器70L(JP)220v-316发热管", "梁家明", "羽骏", 30)
        second = make_plan("TRS-ZK-60-041", "特睿思ZK-60水尺款开水器70L（JP）380v-316发热管", "梁家明", "羽骏", 20)
        third = make_plan("TRS-ZK-30-097", "特睿思ZK-30一开一常温吧台机三级过滤（黑钢60L/h）", "梁家明", "羽骏", 3)
        gateway = FakeGroupGateway()

        preview = preview_group_message(
            [third.id, first.id, second.id], "测试群聊", "志高助手", gateway=gateway,
        )

        self.assertEqual(preview["targetGroupName"], "测试群聊")
        self.assertEqual(preview["buyerNames"], ["梁家明"])
        self.assertEqual(preview["message"], "\n".join([
            "@梁家明",
            "▸ 对应工厂：羽骏（3 条）",
            "TRS-ZK-30-097 特睿思ZK-30一开一常温吧台机三级过滤（黑钢60L/h），× 3台",
            "TRS-ZK-60-033 特睿思ZK-60水尺款开水器70L(JP)220v-316发热管，× 30台",
            "TRS-ZK-60-041 特睿思ZK-60水尺款开水器70L（JP）380v-316发热管，× 20台",
        ]))
        self.assertRegex(str(preview["previewToken"]), r"^[0-9a-f]{64}$")
        self.assertNotIn("_groupId", preview)
        self.assertEqual(gateway.preflights, [("测试群聊", "志高助手", ["梁家明"])])

    @patch("inventory.dingtalk_group_message.sync_replenishment_plan")
    def test_send_mentions_resolved_buyers_and_prevents_duplicate_delivery(self, sync_plan) -> None:
        plan = make_plan("P-001", "测试货品", "采购甲", "工厂甲", 8)
        gateway = FakeGroupGateway()
        preview = build_group_preview([plan.id], "测试群聊", "志高助手", gateway=gateway)

        first = send_group_message(
            [plan.id], "测试群聊", "志高助手", preview["previewToken"],
            "operator@example.test", gateway=gateway,
        )
        repeated = send_group_message(
            [plan.id], "测试群聊", "志高助手", preview["previewToken"],
            "operator@example.test", gateway=gateway,
        )

        self.assertEqual(first["status"], "delivered")
        self.assertEqual(repeated["status"], "already_delivered")
        self.assertEqual(len(gateway.sends), 1)
        self.assertEqual(gateway.sends[0]["user_ids"], ["user-采购甲"])
        self.assertEqual(sync_plan.call_count, 2)
        delivery = ReplenishmentGroupDelivery.objects.get()
        self.assertEqual(delivery.status, "delivered")
        self.assertTrue(delivery.provider_receipt.startswith("dws-sha256:"))

    @patch("inventory.dingtalk_group_message.sync_replenishment_plan")
    def test_ambiguous_external_failure_is_fenced_as_uncertain(self, _sync_plan) -> None:
        plan = make_plan("P-002", "测试货品二", "采购乙", "工厂乙", 5)
        gateway = FakeGroupGateway(fail_send=True)
        preview = build_group_preview([plan.id], "测试群聊", "志高助手", gateway=gateway)

        with self.assertRaisesMessage(InventoryApiError, "模拟发送结果不明确"):
            send_group_message(
                [plan.id], "测试群聊", "志高助手", preview["previewToken"],
                "operator@example.test", gateway=gateway,
            )

        delivery = ReplenishmentGroupDelivery.objects.get()
        self.assertEqual(delivery.status, "uncertain")

    def test_draft_or_missing_business_identity_is_rejected_before_preflight(self) -> None:
        plan = make_plan("P-003", "测试货品三", "", "工厂丙", 2)
        gateway = FakeGroupGateway()

        with self.assertRaisesMessage(InventoryApiError, "对应采购"):
            preview_group_message([plan.id], "测试群聊", "志高助手", gateway=gateway)
        self.assertEqual(gateway.preflights, [])
