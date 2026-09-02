from __future__ import annotations

import json
from unittest.mock import patch
from urllib.parse import quote

from django.test import TestCase

from sales.tests.factories import TEST_SECRET, signed_headers
from workflow.models import NewProductActivity, NewProductProject, WorkflowWriteAuthority


def body_bytes(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()


def project_payload() -> dict[str, object]:
    return {
        "productName": "大通量商用净水器",
        "supplierName": "供应商甲",
        "brand": "志高",
        "category": "商用净水",
        "erpProductCode": "ERP-NEW-001",
        "skuCode": "SKU-NEW-001",
        "spuCode": "SPU-NEW-001",
        "productImageUrl": "https://example.test/product.jpg",
        "proposedBy": "商品经理",
        "proposedDate": "2026-09-02",
        "owner": "新品负责人",
        "targetLaunchDate": "2026-09-16",
        "lifecycleStatus": "active",
        "priority": "high",
        "recommendedPriceCents": 399_900,
        "approvedPriceCents": None,
        "estimatedGrossMarginBps": 3_200,
        "source": "manual",
        "sourceRef": "",
        "notes": "内部项目说明不应写入活动详情",
        "targets": [
            {
                "platform": "京东",
                "shopName": "志高商用设备旗舰店",
                "channel": "线上",
                "listingSku": "JD-001",
                "listingUrl": "",
                "status": "pending",
            },
            {
                "platform": "天猫",
                "shopName": "志高亿用专卖店",
                "channel": "线上",
                "listingSku": "TM-001",
                "listingUrl": "",
                "status": "ready",
            },
        ],
    }


@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class WorkflowApiContractTests(TestCase):
    def setUp(self) -> None:
        WorkflowWriteAuthority.objects.filter(id=1).update(status="postgres")

    def request_json(
        self,
        method: str,
        url: str,
        payload: dict[str, object],
        request_id: str,
        *,
        role: str = "admin",
    ):
        body = body_bytes(payload)
        return getattr(self.client, method.lower())(
            url,
            data=body,
            content_type="application/json; charset=utf-8",
            headers=signed_headers(
                url,
                method=method,
                body=body,
                request_id=request_id,
                role=role,
            ),
        )

    def create_project(self, request_id: str = "workflow-create-1"):
        return self.request_json("POST", "/api/workflow/launch-projects", project_payload(), request_id)

    def test_project_create_list_filters_and_seven_stage_contract(self) -> None:
        created = self.create_project()
        self.assertEqual(created.status_code, 201, created.content)
        item = created.json()["item"]
        self.assertEqual(item["version"], 1)
        self.assertEqual(item["status"], "not_started")
        self.assertEqual(item["progressPercent"], 0)
        self.assertEqual(len(item["targets"]), 2)
        self.assertEqual(
            [stage["stageKey"] for stage in item["stages"]],
            ["modeling", "pricing", "image", "video", "listing", "stocking", "review"],
        )
        self.assertEqual(item["stages"][-1]["plannedDueDate"], "2026-09-23")
        self.assertTrue(created["X-Workflow-Data-Revision"].startswith("1:"))

        url = (
            "/api/workflow/launch-projects?"
            f"supplier={quote('供应商甲')}&platform={quote('京东')}&shopName={quote('志高商用设备旗舰店')}"
            "&status=not_started&page=1&pageSize=20"
        )
        listed = self.client.get(url, headers=signed_headers(url, request_id="workflow-list-1"))
        self.assertEqual(listed.status_code, 200, listed.content)
        payload = listed.json()
        self.assertEqual(payload["pagination"]["total"], 1)
        self.assertEqual(payload["summary"]["notStarted"], 1)
        self.assertEqual(payload["summary"]["stageSummary"][0]["not_started"], 1)
        self.assertIn("供应商甲", payload["facets"]["suppliers"])

        consumer_url = "/api/workflow/consumers/query"
        consumer = self.request_json(
            "POST",
            consumer_url,
            {"operation": "launch_project_search", "query": "净水器", "offset": 0, "limit": 10},
            "workflow-consumer-1",
            role="viewer",
        )
        self.assertEqual(consumer.status_code, 200, consumer.content)
        result = consumer.json()
        self.assertEqual(result["operation"], "launch_project_search")
        self.assertEqual(result["data"]["total"], 1)
        self.assertEqual(result["data"]["items"][0]["title"], "大通量商用净水器")
        self.assertNotIn("stages", result["data"]["items"][0])

    def test_stage_updates_use_cas_blocker_evidence_and_metadata_only_activity(self) -> None:
        item = self.create_project("workflow-create-stage").json()["item"]
        stage = next(stage for stage in item["stages"] if stage["stageKey"] == "pricing")
        url = f"/api/workflow/launch-projects/{item['id']}/stages/pricing"
        missing_blocker = self.request_json(
            "PATCH",
            url,
            {"status": "blocked", "expectedVersion": stage["version"]},
            "workflow-stage-invalid",
        )
        self.assertEqual(missing_blocker.status_code, 400)
        self.assertIn("阻塞原因", missing_blocker.json()["error"])

        updated = self.request_json(
            "PATCH",
            url,
            {
                "status": "blocked",
                "owner": "定价负责人",
                "plannedDueDate": "2026-09-06",
                "blocker": "等待采购成本确认",
                "notes": "这里包含业务详情",
                "evidenceUrl": "https://example.test/pricing.xlsx",
                "evidenceLabel": "定价测算表",
                "expectedVersion": stage["version"],
            },
            "workflow-stage-update",
        )
        self.assertEqual(updated.status_code, 200, updated.content)
        result = updated.json()["item"]
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["version"], 2)
        pricing = next(value for value in result["stages"] if value["stageKey"] == "pricing")
        self.assertEqual(pricing["version"], 2)
        self.assertEqual(pricing["blocker"], "等待采购成本确认")

        stale = self.request_json(
            "PATCH",
            url,
            {"status": "completed", "expectedVersion": stage["version"]},
            "workflow-stage-stale",
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["code"], "version_conflict")
        activity = NewProductActivity.objects.filter(project_id=item["id"], action="stage.updated").get()
        self.assertIn("notes", activity.changed_fields)
        self.assertNotIn("这里包含业务详情", json.dumps(activity.changed_fields, ensure_ascii=False))
        self.assertNotIn("等待采购成本确认", json.dumps(activity.changed_fields, ensure_ascii=False))

    def test_project_update_replaces_target_set_and_write_replay_is_fenced(self) -> None:
        created_response = self.create_project("workflow-create-replay")
        replay = self.create_project("workflow-create-replay")
        self.assertEqual(replay.status_code, 201)
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
        self.assertEqual(NewProductProject.objects.count(), 1)
        item = created_response.json()["item"]
        url = f"/api/workflow/launch-projects/{item['id']}"
        updated = self.request_json(
            "PATCH",
            url,
            {
                "approvedPriceCents": 379_900,
                "targets": [
                    {
                        "platform": "京东",
                        "shopName": "志高商用设备旗舰店",
                        "channel": "线上",
                        "listingSku": "JD-001",
                        "listingUrl": "https://example.test/jd/1",
                        "status": "listed",
                    }
                ],
                "expectedVersion": item["version"],
            },
            "workflow-project-update",
        )
        self.assertEqual(updated.status_code, 200, updated.content)
        result = updated.json()["item"]
        self.assertEqual(result["approvedPriceCents"], 379_900)
        self.assertEqual(len(result["targets"]), 1)
        self.assertEqual(result["targets"][0]["status"], "listed")

        collision_payload = project_payload()
        collision_payload["productName"] = "另一个项目"
        collision = self.request_json(
            "POST", "/api/workflow/launch-projects", collision_payload, "workflow-create-replay"
        )
        self.assertEqual(collision.status_code, 409)
        self.assertEqual(collision.json()["code"], "version_conflict")

    def test_permissions_scope_dates_and_delete_are_fail_closed(self) -> None:
        integration = project_payload()
        integration["source"] = "integration"
        forbidden = self.request_json(
            "POST", "/api/workflow/launch-projects", integration, "workflow-source-forbidden", role="operator"
        )
        self.assertEqual(forbidden.status_code, 403)

        bad_date = project_payload()
        bad_date["targetLaunchDate"] = "2026-09-01"
        invalid = self.request_json(
            "POST", "/api/workflow/launch-projects", bad_date, "workflow-bad-date"
        )
        self.assertEqual(invalid.status_code, 400)

        scope = {"warehouses": [], "channels": [], "platforms": ["京东"]}
        url = "/api/workflow/launch-projects"
        restricted = self.client.get(
            url,
            headers=signed_headers(url, scope=scope, request_id="workflow-restricted"),
        )
        self.assertEqual(restricted.status_code, 403)
        self.assertEqual(restricted.json()["code"], "access_denied")

        item = self.create_project("workflow-create-delete").json()["item"]
        delete_url = f"/api/workflow/launch-projects/{item['id']}?expectedVersion={item['version']}"
        deleted = self.client.delete(
            delete_url,
            headers=signed_headers(delete_url, method="DELETE", request_id="workflow-delete"),
        )
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertEqual(deleted.json()["ok"], True)
        self.assertEqual(NewProductProject.objects.filter(deleted_at__isnull=True).count(), 0)
