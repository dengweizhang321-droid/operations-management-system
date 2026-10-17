from __future__ import annotations

import json
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from inventory import tmall_warehouse as service
from inventory.errors import InventoryApiError
from inventory.models import InventoryStockLine, InventoryWriteAuthority
from inventory.jd_logistics_models import JdLogisticsFact
from inventory.tmall_warehouse_models import TmallWarehouseAudit, TmallWarehouseBatch, TmallWarehouseFact, TmallWarehouseScope
from sales.tests.factories import TEST_SECRET, signed_headers


ACTOR = "tmall-fixture@example.invalid"
BASE = "/api/inventory/tmall-warehouse"


def row(goods="001", warehouse="合成华东仓", **updates):
    result = {"goodsId": goods, "goodsCode": "CODE-" + goods, "goodsName": "合成商品" + goods, "warehouse": warehouse,
              "availableQuantity": 5, "onHandQuantity": 9, "purchaseInTransitQuantity": 2, "transferInTransitQuantity": 0,
              "sourceAttributes": {"行业大组": "合成分类"}, "sourceRowNumber": 2}
    result.update(updates)
    return result


def payload(rows=None, **updates):
    result = {"owner": "合成货主A", "snapshotDate": "2026-10-16", "sourceDate": "2026-10-16", "fileName": "synthetic.xlsx", "rawFileHash": "a" * 64, "rows": [row()] if rows is None else rows}
    result.update(updates)
    if "collectedAt" not in updates:
        result["collectedAt"] = result["snapshotDate"] + "T12:00:00+08:00"
    return result


class TmallWarehouseTests(TestCase):
    def setUp(self):
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(), cutover_id="tmall-fixture", migration_verify_run_id="tmall-fixture", activated_at=timezone.now())

    def test_realtime_export_without_owner_column_uses_declared_scope_but_rejects_conflict(self):
        result = service.import_payload(payload([row(owner="")]), ACTOR)
        self.assertEqual(result["rowCount"], 1)
        self.assertEqual(TmallWarehouseFact.objects.get().owner, "合成货主A")
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload([row(owner="另一货主")]), ACTOR)

    def test_atomic_replacement_removes_absent_rows_without_touching_other_owners_dates_or_domains(self):
        service.import_payload(payload([row("001"), row("002")]), ACTOR)
        service.import_payload(payload([row("003")], owner="合成货主B"), ACTOR)
        service.import_payload(payload([row("004")], snapshotDate="2026-10-15", sourceDate="2026-10-15"), ACTOR)
        updated = service.import_payload(payload([row("005")], expectedScopeRevision=2), ACTOR)
        self.assertEqual(updated["status"], "completed")
        self.assertEqual(set(TmallWarehouseFact.objects.filter(owner="合成货主A", snapshot_date="2026-10-16").values_list("goods_id", flat=True)), {"005"})
        self.assertEqual(TmallWarehouseFact.objects.count(), 3)
        self.assertEqual(InventoryStockLine.objects.count(), 0)
        self.assertEqual(JdLogisticsFact.objects.count(), 0)

    def test_content_idempotency_ignores_filename_hash_order_source_position_but_not_business_change(self):
        first = service.import_payload(payload([row("001"), row("002")]), ACTOR)
        second = service.import_payload(payload([row("002", sourceRowNumber=55), row("001", sourceRowNumber=90)], fileName="renamed.xlsx", rawFileHash="b" * 64, expectedScopeRevision=0), ACTOR)
        self.assertEqual(second["status"], "duplicate")
        self.assertEqual(second["referenceBatchId"], first["batchId"])
        self.assertEqual(second["contentHash"], first["contentHash"])
        self.assertEqual(TmallWarehouseScope.objects.get().revision, 1)
        self.assertEqual(TmallWarehouseFact.objects.count(), 2)
        changed = service.import_payload(payload([row("001", availableQuantity=6), row("002")]), ACTOR)
        self.assertEqual(changed["status"], "completed")
        self.assertNotEqual(changed["contentHash"], first["contentHash"])
        # Reverting an old content set must publish again, not use its old batch.
        reverted = service.import_payload(payload([row("001"), row("002")]), ACTOR)
        self.assertEqual(reverted["status"], "completed")
        self.assertNotEqual(reverted["batchId"], first["batchId"])

    def test_invalid_empty_duplicate_cross_owner_and_quantities_only_write_rejection_audit(self):
        cases = [payload([]), payload([row(), row()]), payload([row(owner="其他货主")]), payload([row(availableQuantity=True)]), payload([row(availableQuantity="5")]), payload([row(availableQuantity=float("inf"))]), payload([row(availableQuantity=0.0000001)])]
        for value in cases:
            with self.assertRaises(InventoryApiError):
                service.import_payload(value, ACTOR)
        self.assertEqual(TmallWarehouseAudit.objects.filter(status="rejected").count(), len(cases))
        self.assertEqual(TmallWarehouseScope.objects.count(), 0)
        self.assertEqual(TmallWarehouseBatch.objects.count(), 0)
        self.assertEqual(TmallWarehouseFact.objects.count(), 0)

    def test_warehouse_code_is_identity_and_different_codes_with_same_display_name_stay_separate(self):
        service.import_payload(payload([row(warehouseCode="W01"), row(warehouseCode="W02")]), ACTOR)
        monitor = service.monitor({})
        self.assertEqual(monitor["items"][0]["warehouseCount"], 2)
        self.assertEqual({item["warehouseKey"] for item in monitor["items"][0]["warehouses"]}, {"code:W01", "code:W02"})
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload([row(warehouseCode="W01"), row(warehouse="不同显示名", warehouseCode="W01")]), ACTOR)

    def test_rollback_after_delete_keeps_original_facts_head_and_batches(self):
        first = service.import_payload(payload(), ACTOR)
        with patch.object(TmallWarehouseFact.objects, "bulk_create", side_effect=InventoryApiError("合成失败")):
            with self.assertRaises(InventoryApiError):
                service.import_payload(payload([row("002")]), ACTOR)
        self.assertEqual(TmallWarehouseBatch.objects.count(), 1)
        self.assertEqual(TmallWarehouseFact.objects.get().batch_id, first["batchId"])
        self.assertEqual(TmallWarehouseScope.objects.get().revision, 1)
        self.assertEqual(TmallWarehouseScope.objects.get().owner_token, "")

    def test_failure_of_readback_rolls_back_publication(self):
        service.import_payload(payload(), ACTOR)
        with patch.object(service, "_verify", side_effect=InventoryApiError("合成回查失败")):
            with self.assertRaises(InventoryApiError):
                service.import_payload(payload([row("002")]), ACTOR)
        self.assertEqual(TmallWarehouseFact.objects.get().goods_id, "001")
        self.assertEqual(TmallWarehouseBatch.objects.count(), 1)

    def test_scope_revision_conflict_cannot_replace_current_facts(self):
        service.import_payload(payload(), ACTOR)
        with self.assertRaises(InventoryApiError) as rejected:
            service.import_payload(payload([row("002")], expectedScopeRevision=0), ACTOR)
        self.assertEqual(rejected.exception.code, "version_conflict")
        self.assertEqual(TmallWarehouseFact.objects.get().goods_id, "001")

    def test_latest_date_is_per_owner_and_filter_summary_covers_all_pages(self):
        service.import_payload(payload([row("old")], snapshotDate="2026-10-15", sourceDate="2026-10-15"), ACTOR)
        service.import_payload(payload([row("new1", availableQuantity=3), row("new2", availableQuantity=7)]), ACTOR)
        service.import_payload(payload([row("other", availableQuantity=11)], owner="合成货主B", snapshotDate="2026-10-14", sourceDate="2026-10-14"), ACTOR)
        result = service.monitor({"page": 1, "pageSize": 1})
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["returned"], 1)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["totals"]["availableQuantity"], 21)
        self.assertEqual(result["asOf"], [{"owner": "合成货主A", "snapshotDate": "2026-10-16"}, {"owner": "合成货主B", "snapshotDate": "2026-10-14"}])
        owner_result = service.monitor({"owner": "合成货主A", "q": "new"})
        self.assertEqual(owner_result["totals"]["availableQuantity"], 10)
        self.assertEqual(owner_result["total"], 2)

    def test_null_zero_negative_and_partial_sums_are_distinct(self):
        service.import_payload(payload([row(availableQuantity=0), row(warehouse="华北", availableQuantity=None), row(warehouse="华南", availableQuantity=-2)]), ACTOR)
        result = service.monitor({})
        self.assertIsNone(result["totals"]["availableQuantity"])
        self.assertEqual(result["quantityCoverage"]["availableQuantity"], {"knownRows": 2, "totalRows": 3, "complete": False})
        self.assertIsNone(result["totals"]["salesOccupiedQuantity"])
        self.assertIsNone(result["totals"]["suggestedQuantity"])
        by_warehouse = {item["warehouse"]: item for item in result["items"][0]["warehouses"]}
        self.assertIsNone(by_warehouse["华北"]["availableQuantity"])

    def test_replenishment_is_fixed_thirty_days_and_sums_each_nonnegative_warehouse_gap(self):
        service.import_payload(payload([row(availableQuantity=0, sales30dQuantity=30), row(warehouse="华南", availableQuantity=100, sales30dQuantity=30), row("002", availableQuantity=-2, sales30dQuantity=0)]), ACTOR)
        result = service.monitor({})
        self.assertEqual(result["totals"]["suggestedQuantity"], 28)
        self.assertEqual(result["items"][0]["totals"]["suggestedQuantity"], 28)
        by_warehouse = {item["warehouse"]: item for item in result["items"][0]["warehouses"]}
        self.assertEqual(by_warehouse["合成华东仓"]["turnoverDays"], 0)
        self.assertIsNone(result["items"][1]["warehouses"][0]["turnoverDays"])
        self.assertEqual(result["replenishmentCycleDays"], 30)

    def test_batch_exact_lookup_current_flag_and_historical_warehouse_filter(self):
        old = service.import_payload(payload(), ACTOR)
        new = service.import_payload(payload([row("002", warehouse="新仓")]), ACTOR)
        listed = service.batches({"batchId": old["batchId"], "warehouse": "合成华东仓"})
        self.assertEqual(listed["total"], 1)
        self.assertFalse(listed["items"][0]["isCurrent"])
        self.assertEqual(listed["items"][0]["rawFileHash"], "a" * 64)
        self.assertTrue(service.batches({"batchId": new["batchId"]})["items"][0]["isCurrent"])

    def test_provenance_rejects_undated_backdating_and_accepts_shanghai_collection_day(self):
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload(sourceDate=None, collectedAt=None), ACTOR)
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload(sourceDate="2026-10-15"), ACTOR)
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload(sourceDate=None, collectedAt="2026-10-16T16:00:00Z"), ACTOR)
        accepted = service.import_payload(payload(sourceDate=None, collectedAt="2026-10-15T16:00:00Z", collectorEvidence={"protocolVersion": "fixture-v1"}), ACTOR)
        self.assertEqual(accepted["collectedAt"], "2026-10-15T16:00:00+00:00")
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload(collectorEvidence={"cookie": "forbidden"}), ACTOR)

    def test_older_realtime_collection_and_unfenced_historical_upload_cannot_overwrite(self):
        service.import_payload(payload(sourceDate=None, collectedAt="2026-10-16T14:00:00+08:00"), ACTOR)
        with self.assertRaises(InventoryApiError) as rejected:
            service.import_payload(payload([row(availableQuantity=99)], sourceDate=None, collectedAt="2026-10-16T12:00:00+08:00", expectedScopeRevision=1), ACTOR)
        self.assertEqual(rejected.exception.code, "stale_source_snapshot")
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload([row(availableQuantity=99)], collectedAt=None), ACTOR)
        self.assertEqual(TmallWarehouseFact.objects.get().available_quantity, 5)
        accepted = service.import_payload(payload([row(availableQuantity=8)], collectedAt=None, expectedScopeRevision=1), ACTOR)
        self.assertEqual(accepted["status"], "completed")
        self.assertEqual(service.options({})["scopeRevisions"], {"合成货主A": 2})

    def test_authority_and_read_only_fence_import(self):
        authority = InventoryWriteAuthority.objects.get(id=1)
        InventoryWriteAuthority.objects.filter(id=1).update(status="d1", authority_epoch=None, cutover_id="", activated_at=None)
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload(), ACTOR)
        self.assertEqual(TmallWarehouseFact.objects.count(), 0)
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=authority.authority_epoch, cutover_id=authority.cutover_id, activated_at=authority.activated_at)
        with override_settings(DJANGO_EXPECT_READ_ONLY=True):
            with self.assertRaises(InventoryApiError):
                service.import_payload(payload(), ACTOR)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_signed_http_permissions_write_replay_query_limits_and_exact_batch(self):
        body = json.dumps(payload())
        for role in ("viewer", "analyst", "operator"):
            denied = self.client.post(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, role=role, method="POST", body=body, request_id="tmw-denied-" + role))
            self.assertEqual(denied.status_code, 403)
        headers = signed_headers(BASE, method="POST", body=body, request_id="tmw-import-1")
        response = self.client.post(BASE, data=body, content_type="application/json", headers=headers)
        self.assertEqual(response.status_code, 200, response.content)
        replay = self.client.post(BASE, data=body, content_type="application/json", headers=headers)
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
        self.assertEqual(TmallWarehouseBatch.objects.count(), 1)
        url = BASE + "?operation=batches&batchId=" + response.json()["data"]["batchId"]
        self.assertEqual(self.client.get(url, headers=signed_headers(url)).json()["data"]["total"], 1)
        for role in ("viewer", "analyst", "operator", "admin"):
            self.assertEqual(self.client.get(BASE, headers=signed_headers(BASE, role=role)).status_code, 200)
        scope = {"warehouses": ["合成华东仓"]}
        self.assertEqual(self.client.get(BASE, headers=signed_headers(BASE, scope=scope)).status_code, 403)
        for query in ("?pageSize=101", "?page=0", "?q=x&q=y", "?operation=wrong", "?unknown=x"):
            url = BASE + query
            self.assertEqual(self.client.get(url, headers=signed_headers(url)).status_code, 400)
        self.assertEqual(response["Cache-Control"], "no-store")
        with override_settings(DJANGO_PROCESS_ROLE="inventory_writer"):
            self.assertEqual(self.client.get(BASE, headers=signed_headers(BASE)).status_code, 503)
        with override_settings(DJANGO_PROCESS_ROLE="inventory_reader"):
            denied = self.client.post(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="POST", body=body, request_id="tmw-reader-write"))
            self.assertEqual(denied.status_code, 503)
        self.assertEqual(TmallWarehouseBatch.objects.count(), 1)

    def test_options_and_response_fact_cap(self):
        service.import_payload(payload([row("001"), row("002")]), ACTOR)
        self.assertEqual(service.options({})["owners"], ["合成货主A"])
        with patch.object(service, "MAX_PAGE_FACTS", 1):
            with self.assertRaises(InventoryApiError):
                service.monitor({})
