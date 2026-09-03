from __future__ import annotations

from datetime import date
import json
import uuid

from django.test import TestCase
from django.utils import timezone

from inventory.dingtalk_sync import DingTalkReplenishmentGateway, DwsCli, load_target, sync_replenishment_plan
from inventory.errors import InventoryApiError
from inventory.models import InventoryWriteAuthority, ReplenishmentPlanItem


class FakeDws:
    def __init__(self) -> None:
        self.target = load_target()
        self.created_cells: dict[str, object] | None = None
        self.commands: list[list[str]] = []

    def __call__(self, args: list[str]) -> dict[str, object]:
        self.commands.append(args)
        path = tuple(args[:3])
        if path == ("aitable", "table", "get"):
            return {"data": {"tables": [{
                "tableId": self.target.table_id,
                "tableName": self.target.table_name,
                "fields": [
                    {"fieldId": field["id"], "fieldName": field["name"], "type": field["type"]}
                    for field in self.target.fields.values()
                ],
            }]}}
        if path == ("aitable", "field", "get"):
            names = {
                self.target.fields["brand"]["id"]: ["志高", "特睿思"],
                self.target.fields["warehouse"]["id"]: ["广东仓", "京东自营实物仓"],
                self.target.fields["requiresInspection"]["id"]: ["是", "否"],
            }
            field_id = args[args.index("--field-ids") + 1]
            if field_id not in names or "," in field_id:
                raise AssertionError(f"field get must use one exact field id: {field_id}")
            return {"data": {"fields": [{
                "fieldId": field_id,
                "config": {"options": [{"id": f"opt-{index}", "name": name} for index, name in enumerate(options)]},
            } for field_id, options in [(field_id, names[field_id])]]}}
        if path == ("contact", "user", "search"):
            name = args[args.index("--query") + 1]
            return {"result": [{"name": name, "userId": f"user-{name}"}]}
        if path == ("contact", "dept", "search"):
            name = args[args.index("--query") + 1]
            return {"deptList": [{"deptId": 903638406, "deptName": f"公司-运营部-<red>{name}</red>"}]}
        if path == ("aitable", "record", "create"):
            records = json.loads(args[args.index("--records") + 1])
            self.created_cells = records[0]["cells"]
            return {"success": True, "data": {"recordIds": ["record-1"]}}
        if path == ("aitable", "record", "update"):
            records = json.loads(args[args.index("--records") + 1])
            self.created_cells = records[0]["cells"]
            return {"success": True, "data": {"recordIds": ["record-1"]}}
        if path == ("aitable", "record", "query"):
            if self.created_cells is None:
                return {"data": {"records": []}}
            cells: dict[str, object] = {}
            by_id = {field["id"]: field for field in self.target.fields.values()}
            for field_id, value in self.created_cells.items():
                field_type = by_id[field_id]["type"]
                if field_type == "number":
                    cells[field_id] = str(value)
                elif field_type == "date":
                    cells[field_id] = f"{value}T00:00:00+08:00"
                elif field_type == "singleSelect":
                    cells[field_id] = {"id": f"opt-{value}", "name": value}
                elif field_type == "department":
                    cells[field_id] = [{"departmentId": row["deptId"], "name": "志高项目组"} for row in value]
                else:
                    cells[field_id] = value
            return {"data": {"records": [{"recordId": "record-1", "cells": cells}]}}
        raise AssertionError(f"unexpected DWS command: {args}")


def make_plan(*, status: str = "confirmed") -> ReplenishmentPlanItem:
    return ReplenishmentPlanItem.objects.create(
        id=str(uuid.uuid4()),
        source_batch_id="batch-1",
        product_code="P1",
        product_name="测试货品",
        brand="特睿思",
        category="净水设备",
        supplier="供应商甲",
        warehouse="广东仓",
        buyer="梁家明",
        operator_name="胡博",
        department="志高项目组",
        plan_type="日常备货",
        order_date=date(2026, 9, 3),
        expected_arrival_date=date(2026, 9, 10),
        requires_inspection=True,
        current_stock_quantity=3,
        sales_30d_quantity=1,
        suggested_quantity=3,
        planned_quantity=3,
        coverage_days_tenths=1800,
        notes="测试备注",
        reason="人工创建",
        status=status,
    )


class DingTalkReplenishmentGatewayTests(TestCase):
    def test_maps_and_rechecks_every_written_field(self) -> None:
        plan = make_plan()
        fake = FakeDws()
        gateway = DingTalkReplenishmentGateway(fake.target, DwsCli(fake.target, fake))

        record_id, outcome = gateway.sync(plan)

        self.assertEqual(record_id, "record-1")
        self.assertEqual(outcome, "created")
        assert fake.created_cells is not None
        fields = fake.target.fields
        self.assertEqual(fake.created_cells[fields["plannedQuantity"]["id"]], 3)
        self.assertEqual(fake.created_cells[fields["warehouse"]["id"]], "广东仓")
        self.assertEqual(fake.created_cells[fields["buyer"]["id"]][0]["userId"], "user-梁家明")
        self.assertIn("[TERUISI备货计划ID:", fake.created_cells[fields["notes"]["id"]])
        field_gets = [command for command in fake.commands if command[:3] == ["aitable", "field", "get"]]
        self.assertEqual(len(field_gets), 3)
        self.assertTrue(all("," not in command[command.index("--field-ids") + 1] for command in field_gets))
        self.assertEqual(sum(command[:3] == ["aitable", "record", "query"] for command in fake.commands), 2)


class ReplenishmentSyncStateTests(TestCase):
    def setUp(self) -> None:
        InventoryWriteAuthority.objects.filter(id=1).update(
            status="postgres",
            authority_epoch=uuid.UUID("11111111-1111-4111-8111-111111111111"),
            cutover_id="inventory-test-cutover",
            migration_verify_run_id="inventory-apply-" + "1" * 32,
            activated_at=timezone.now(),
        )

    def test_confirmed_plan_is_synced_once_and_receipt_is_reused(self) -> None:
        plan = make_plan()

        class Gateway:
            target = load_target()

            def __init__(self) -> None:
                self.calls = 0

            def sync(self, _plan: ReplenishmentPlanItem) -> tuple[str, str]:
                self.calls += 1
                return "record-1", "created"

        gateway = Gateway()
        result = sync_replenishment_plan(plan.id, "operator@example.test", gateway=gateway)
        repeated = sync_replenishment_plan(plan.id, "operator@example.test", gateway=gateway)
        plan.refresh_from_db()

        self.assertEqual(result["outcome"], "created")
        self.assertEqual(repeated["outcome"], "already_synced")
        self.assertEqual(gateway.calls, 1)
        self.assertEqual(plan.dingtalk_sync_status, "synced")
        self.assertEqual(plan.dingtalk_record_id, "record-1")
        self.assertEqual(plan.dingtalk_synced_by, "operator@example.test")
        self.assertIsNotNone(plan.dingtalk_synced_at)

    def test_draft_plan_is_rejected_without_external_write(self) -> None:
        plan = make_plan(status="draft")
        with self.assertRaisesMessage(InventoryApiError, "只有已确认"):
            sync_replenishment_plan(plan.id, "operator@example.test")

    def test_external_failure_is_recorded_without_changing_plan_status(self) -> None:
        plan = make_plan()

        class Gateway:
            target = load_target()

            def sync(self, _plan: ReplenishmentPlanItem) -> tuple[str, str]:
                raise InventoryApiError("钉钉测试失败", code="service_unavailable", status=503)

        with self.assertRaisesMessage(InventoryApiError, "钉钉测试失败"):
            sync_replenishment_plan(plan.id, "operator@example.test", gateway=Gateway())
        plan.refresh_from_db()

        self.assertEqual(plan.status, "confirmed")
        self.assertEqual(plan.dingtalk_sync_status, "failed")
        self.assertEqual(plan.dingtalk_sync_error, "钉钉测试失败")
        self.assertEqual(plan.dingtalk_record_id, "")
