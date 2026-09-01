from __future__ import annotations

import json
from unittest.mock import patch

from django.test import TestCase

from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow
from sales.tests.factories import TEST_SECRET, signed_headers


class NetshopConsumerContractTests(TestCase):
    def setUp(self) -> None:
        NetshopDataRevision.objects.update_or_create(
            domain="netshop", defaults={"revision": 3, "source_digest": "a" * 64}
        )
        NetshopImportBatch.objects.create(
            id="master-1", source="jd_product_master", dataset="product_master",
            platform="京东", shop_name="京东一店", file_name="master.xlsx",
            file_size_bytes=10, file_hash="b" * 64, raw_file_hash="c" * 64,
            content_hash="d" * 64, scope_key="e" * 64, published_state_token="f" * 64,
            status="completed", row_count=1, inserted_count=1, created_at="2026-08-30T00:00:00Z",
            completed_at="2026-08-30T00:01:00Z",
        )
        NetshopRow.objects.create(
            source_row_key="master-row", source_row_hash="1" * 64,
            first_import_batch_id="master-1", last_import_batch_id="master-1", source_row_number=2,
            source="jd_product_master", dataset="product_master", platform="京东", shop_name="京东一店",
            snapshot_date="2026-08-30", product_code="SPU-1", product_name="饮水机",
            sku_id="SKU-1", spu_id="SPU-1", metrics_json={}, raw_json={"商家SKU": "ERP-1", "品牌": "志高"},
            brand="志高", created_at="2026-08-30T00:00:00Z", updated_at="2026-08-30T00:00:00Z",
        )
        NetshopImportBatch.objects.create(
            id="daily-1", source="jd_sku_daily", dataset="sku_daily", platform="京东",
            shop_name="京东一店", file_name="daily.xlsx", file_size_bytes=10,
            file_hash="2" * 64, raw_file_hash="3" * 64, content_hash="4" * 64,
            scope_key="5" * 64, published_state_token="6" * 64, status="completed",
            row_count=1, inserted_count=1, date_min="2026-08-30", date_max="2026-08-30",
            created_at="2026-08-30T00:00:00Z", completed_at="2026-08-30T00:01:00Z",
        )
        NetshopRow.objects.create(
            source_row_key="daily-row", source_row_hash="7" * 64,
            first_import_batch_id="daily-1", last_import_batch_id="daily-1", source_row_number=2,
            source="jd_sku_daily", dataset="sku_daily", platform="京东", shop_name="京东一店",
            business_date="2026-08-30", product_code="P-1", product_name="饮水机",
            sku_id="SKU-1", spu_id="SPU-1", metrics_json={"transactionAmountCents": 12345}, raw_json={},
            transaction_amount_cents=12_345, created_at="2026-08-30T00:00:00Z", updated_at="2026-08-30T00:00:00Z",
        )

    def query(self, payload: dict[str, object], *, scope=None, request_id="netshop-consumer"):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        with patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET}):
            return self.client.post(
                "/api/netshop/consumers/query", data=body, content_type="application/json",
                headers=signed_headers(
                    "/api/netshop/consumers/query", method="POST", body=body,
                    scope=scope, request_id=request_id,
                ),
            )

    def test_product_master_lookup_is_bounded_and_scope_aware(self) -> None:
        response = self.query({
            "operation": "product_master_lookup", "lookupCodes": ["ERP-1"],
            "spuIds": [], "limit": 10,
        })
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["data"]["rows"][0]
        self.assertEqual(row["skuId"], "SKU-1")
        self.assertEqual(row["onlineSpecCode"], "ERP-1")
        self.assertEqual(response["X-Netshop-Data-Revision"], "3:aaaaaaaaaaaa")

        denied = self.query(
            {"operation": "product_master_lookup", "lookupCodes": ["ERP-1"], "spuIds": [], "limit": 10},
            scope={"warehouses": [], "channels": [], "platforms": ["天猫"]},
            request_id="netshop-consumer-scoped",
        )
        self.assertEqual(denied.status_code, 200)
        self.assertEqual(denied.json()["data"]["rows"], [])

    def test_market_projection_page_contains_only_minimal_fields(self) -> None:
        response = self.query({
            "operation": "market_projection_page", "offset": 0, "limit": 100,
            "expectedRevision": None,
        })
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()["data"]
        self.assertEqual(data["total"], 4)
        self.assertEqual({row["kind"] for row in data["rows"]}, {"metric", "identity", "brand"})
        metric = next(row for row in data["rows"] if row["kind"] == "metric")
        self.assertEqual(metric["transactionAmountCents"], 12_345)
        self.assertNotIn("raw", metric)
        self.assertNotIn("metrics", metric)

        changed = self.query({
            "operation": "market_projection_page", "offset": 0, "limit": 100,
            "expectedRevision": "2:bbbbbbbbbbbb",
        }, request_id="netshop-market-stale")
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(changed.json()["code"], "version_conflict")
