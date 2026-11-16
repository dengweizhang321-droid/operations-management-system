from __future__ import annotations

import copy
import hashlib
import json
from datetime import timedelta
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from customer_service.import_service import _batch_payload, _warnings
from customer_service.models import CustomerServiceConversation, CustomerServiceDataRevision, CustomerServiceImportBatch, CustomerServiceWriteAuthority
from sales.tests.factories import TEST_SECRET, signed_headers


def body_for(*, raw_hash: str = "a" * 64) -> dict[str, object]:
    return {
        "action": "import", "shopName": "志高商用设备", "sessionFileName": "session.xlsx", "chatFileName": "chat.log",
        "rawFileHash": raw_hash, "fileSizeBytes": 2048,
        "summary": {"sessionCount": 1, "chatSessionCount": 1, "matchedCount": 1, "timeOnlyMatchedCount": 0, "sessionOnlyCount": 0, "chatOnlyCount": 0, "ambiguousCount": 0},
        "warnings": [], "warningTotalCount": 0,
        "conversations": [{
            "sourceRowNumber": 2, "consultedAt": "2026-09-01 10:00:00", "customerId": "customer-1", "customerAlias": "顾客1",
            "consultationType": "商品咨询", "agent": "客服A", "transferredAgent": "", "skillGroup": "在线客服",
            "productSku": "SKU-1", "productName": "饮水机", "firstResponseAt": "2026-09-01 10:00:02", "responseSeconds": 2,
            "durationMinutes": 3.5, "customerMessageCount": 1, "agentMessageCount": 1, "satisfaction": "满意", "resolved": "已解决",
            "conversationId": "chat-1", "conversationKey": "conversation-1", "matchStatus": "matched", "matchConfidence": "exact",
            "chatStartedAt": "2026-09-01 10:00:00", "chatEndedAt": "2026-09-01 10:03:30", "chatCustomerAlias": "顾客1",
            "messages": [{"sender": "顾客", "sentAt": "2026-09-01 10:00:00", "content": "请问价格？"}],
        }],
    }


class CustomerServiceWarningSummaryTests(SimpleTestCase):
    def test_late_message_count_warning_survives_write_and_historical_batch_read(self) -> None:
        warnings = [f"聊天会话 2026-10-05 10:00:00（合成{index}）在两分钟内对应 2 条会话记录，未自动拼接。" for index in range(829)]
        count_warning = "第 829 条客服会话含 223 条消息，超过 200 条警告阈值，已保留全部消息。"
        warnings.append(count_warning)
        summary = _warnings(warnings, 830)
        self.assertEqual(summary, {"items": [count_warning, *warnings[:49]], "totalCount": 830, "truncated": True})
        # Legacy items must be prioritized before the read path applies its cap.
        for stored in ({"items": warnings, "totalCount": 830}, summary):
            with self.subTest(stored_item_count=len(stored["items"])):
                batch = CustomerServiceImportBatch(warnings_json=stored, created_at=timezone.now())
                public = _batch_payload(batch)
                self.assertEqual(public["warnings"], summary["items"])
                self.assertEqual(public["warningTotalCount"], 830)
                self.assertTrue(public["warningsTruncated"])

    def test_warning_priority_keeps_content_and_byte_budgets(self) -> None:
        first = "第 1 条客服会话含 201 条消息，超过 200 条警告阈值，已保留全部消息。"
        second = "第 2 条客服会话含 223 条消息，超过 200 条警告阈值，已保留全部消息。"
        warnings = ["中" * 600, *["文" * 500 for _ in range(49)], first, second]
        summary = _warnings(warnings, 52)
        self.assertEqual(summary["items"][:3], [first, second, "中" * 500])
        self.assertTrue(all(len(item) <= 500 for item in summary["items"]))
        self.assertLessEqual(len(json.dumps(summary["items"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")), 32 * 1024)
        self.assertLess(len(summary["items"]), 50)
        self.assertEqual(summary["totalCount"], 52)
        self.assertTrue(summary["truncated"])


class CustomerServiceApiTests(TestCase):
    def setUp(self) -> None:
        CustomerServiceWriteAuthority.objects.filter(id=1).update(status="postgres")
        CustomerServiceDataRevision.objects.filter(domain="customer-service").update(revision=1, source_digest="a" * 64)

    def post(self, payload: dict[str, object], request_id: str):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return self.client.post(
            "/api/customer-service/imports", data=body, content_type="application/json; charset=utf-8",
            headers=signed_headers("/api/customer-service/imports", method="POST", body=body, request_id=request_id),
        )

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_message_count_warning_preserves_all_messages_and_warning_summary(self) -> None:
        payload = body_for()
        row = payload["conversations"][0]
        row["messages"] = [dict(row["messages"][0], content=f"合成消息{index}") for index in range(201)]
        payload["warnings"] = ["第 1 条客服会话含 201 条消息，超过 200 条警告阈值，已保留全部消息。"]
        payload["warningTotalCount"] = 1
        response = self.post(payload, "customer-message-count-warning")
        self.assertEqual(response.status_code, 201, response.content)
        result = response.json()
        self.assertEqual(result["warnings"], payload["warnings"])
        self.assertEqual(result["warningTotalCount"], 1)
        self.assertEqual(result["batch"]["warningTotalCount"], 1)
        self.assertEqual(CustomerServiceConversation.objects.get().messages, row["messages"])
        self.assertEqual(result["batch"]["conversationCount"], 1)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_high_message_count_still_rejects_content_and_byte_overflow(self) -> None:
        for content in ["x" * 4_001, "x" * 1_000]:
            with self.subTest(content_length=len(content)):
                payload = body_for()
                row = payload["conversations"][0]
                row["messages"] = [dict(row["messages"][0], content=content) for _ in range(201)]
                response = self.post(payload, f"customer-message-budget-{len(content)}")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(CustomerServiceConversation.objects.count(), 0)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_import_is_atomic_idempotent_and_replay_fenced(self) -> None:
        payload = body_for()
        first = self.post(payload, "customer-import-1")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(first.json()["status"], "imported")
        self.assertEqual(CustomerServiceConversation.objects.count(), 1)

        replay = self.post(payload, "customer-import-1")
        self.assertEqual(replay.status_code, 201, replay.content)
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
        self.assertEqual(CustomerServiceConversation.objects.count(), 1)

        duplicate_payload = copy.deepcopy(payload)
        duplicate_payload["rawFileHash"] = hashlib.sha256(b"another-raw-file").hexdigest()
        duplicate = self.post(duplicate_payload, "customer-import-2")
        self.assertEqual(duplicate.status_code, 200, duplicate.content)
        self.assertEqual(duplicate.json()["status"], "duplicate")
        self.assertEqual(CustomerServiceImportCount(), 1)

        collision_payload = copy.deepcopy(payload)
        collision_payload["rawFileHash"] = hashlib.sha256(b"collision").hexdigest()
        collision = self.post(collision_payload, "customer-import-1")
        self.assertEqual(collision.status_code, 409, collision.content)
        self.assertEqual(collision.json()["code"], "version_conflict")

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_four_shop_import_scopes_and_duplicates_remain_isolated(self) -> None:
        # Identical source identities and shared agents must still belong to
        # separate shop scopes, including when raw bytes change on a retry.
        shops = ("志高商用设备旗舰店", "志高切肉机旗舰店", "志高商用厨电旗舰店", "志高商用洗碗机旗舰店")
        for index, shop in enumerate(shops):
            payload = body_for()
            payload["shopName"] = shop
            payload["conversations"][0]["agent"] = "志高厨电-共用合成客服"
            first = self.post(payload, f"four-shop-{index}")
            self.assertEqual(first.status_code, 201, first.content)
            self.assertEqual(first.json()["batch"]["shopName"], shop)
            payload["rawFileHash"] = hashlib.sha256(f"new-raw-{index}".encode()).hexdigest()
            duplicate = self.post(payload, f"four-shop-duplicate-{index}")
            self.assertEqual(duplicate.status_code, 200, duplicate.content)
            self.assertEqual(duplicate.json()["status"], "duplicate")
            self.assertEqual(duplicate.json()["batch"]["id"], first.json()["batch"]["id"])
            self.assertEqual(CustomerServiceConversation.objects.filter(shop_name=shop).count(), 1)
        self.assertEqual(CustomerServiceConversation.objects.count(), 4)
        self.assertEqual(CustomerServiceImportCount(), 4)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_query_uses_left_closed_right_open_dates_and_scope_denial(self) -> None:
        response = self.post(body_for(), "customer-import-query")
        self.assertEqual(response.status_code, 201, response.content)
        url = "/api/customer-service/conversations?startDate=2026-09-01&endDate=2026-09-01"
        listed = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual(listed.json()["summary"]["total"], 1)
        self.assertTrue(listed["X-Customer-Service-Data-Revision"].startswith("2:"))
        ambiguous_history = self.client.get(
            "/api/customer-service/imports?pageSize=2&limit=3",
            headers=signed_headers("/api/customer-service/imports?pageSize=2&limit=3"),
        )
        self.assertEqual(ambiguous_history.status_code, 400)
        denied = self.client.get(
            "/api/customer-service/conversations",
            headers=signed_headers("/api/customer-service/conversations", scope={"warehouses": ["主仓"], "channels": [], "platforms": []}),
        )
        self.assertEqual(denied.status_code, 403)


@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class CustomerServiceAutoAnalysisTests(TestCase):
    URL = "/api/customer-service/conversations/auto-analysis"

    def setUp(self) -> None:
        CustomerServiceWriteAuthority.objects.filter(id=1).update(status="postgres")
        CustomerServiceDataRevision.objects.filter(domain="customer-service").update(revision=1, source_digest="a" * 64)
        now = timezone.now()
        self.batch("fresh", "completed", now - timedelta(hours=1))
        self.batch("old", "completed", now - timedelta(hours=73))
        self.batch("processing", "processing", now - timedelta(hours=1))

    def batch(self, batch_id: str, status: str, completed_at) -> None:
        CustomerServiceImportBatch.objects.create(
            id=batch_id, shop_name="店", session_file_name="s", chat_file_name="c", raw_file_hash="a" * 64,
            import_hash=batch_id.ljust(64, "0"), content_hash="b" * 64, identity_set_hash="c" * 64, scope_key="d" * 64,
            status=status, completed_at=completed_at,
        )

    def conversation(self, key: str, batch_id: str, *, source: str = "", analyzed_at=None) -> CustomerServiceConversation:
        return CustomerServiceConversation.objects.create(
            conversation_key=key, first_import_batch_id=batch_id, last_import_batch_id=batch_id, shop_name="店",
            consulted_at="2026-11-16 10:00:00", match_status="matched", match_confidence="exact",
            analysis_source=source, analyzed_at=analyzed_at,
        )

    def get(self, query: str = "", **kwargs):
        url = self.URL + query
        return self.client.get(url, headers=signed_headers(url, **kwargs))

    def test_candidates_exclude_manual_ai_old_and_unfinished_batches(self) -> None:
        wanted = [self.conversation(f"k{index}", "fresh").id for index in range(3)]
        self.conversation("manual", "fresh", source="manual")
        self.conversation("ai", "fresh", source="ai", analyzed_at=timezone.now())
        self.conversation("old", "old")
        self.conversation("processing", "processing")
        self.conversation("nobatch", "missing")
        response = self.get()
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(sorted(data["ids"]), sorted(wanted))
        self.assertEqual(data["pendingCount"], 3)
        self.assertEqual(data["windowHours"], 72)
        self.assertTrue(response["X-Customer-Service-Data-Revision"])

    def test_limit_bounds_and_unknown_parameters(self) -> None:
        for index in range(10):
            self.conversation(f"k{index}", "fresh")
        self.assertEqual(len(self.get("?limit=3").json()["ids"]), 3)
        self.assertEqual(len(self.get().json()["ids"]), 8)
        self.assertEqual(self.get().json()["pendingCount"], 10)
        for query in ("?limit=0", "?limit=9", "?limit=abc", "?limit=1&limit=2", "?foo=1"):
            with self.subTest(query=query):
                self.assertEqual(self.get(query).status_code, 400)

    def test_analyzed_today_counts_only_ai_since_shanghai_midnight(self) -> None:
        now = timezone.now()
        self.conversation("today", "fresh", source="ai", analyzed_at=now)
        self.conversation("manual", "fresh", source="manual", analyzed_at=now)
        self.conversation("yesterday", "fresh", source="ai", analyzed_at=now - timedelta(days=2))
        self.assertEqual(self.get().json()["analyzedToday"], 1)

    def test_roles_and_scope(self) -> None:
        self.assertEqual(self.get(role="operator").status_code, 200)
        for role in ("viewer", "analyst"):
            with self.subTest(role=role):
                self.assertEqual(self.get(role=role).status_code, 403)
        self.assertEqual(self.get(scope={"warehouses": ["主仓"], "channels": [], "platforms": []}).status_code, 403)


def CustomerServiceImportCount() -> int:
    from customer_service.models import CustomerServiceImportBatch

    return CustomerServiceImportBatch.objects.count()
