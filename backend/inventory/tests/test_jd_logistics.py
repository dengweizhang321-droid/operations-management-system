from __future__ import annotations

from copy import deepcopy
from datetime import date
import json
import uuid
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone

from inventory import jd_logistics as service
from inventory.errors import InventoryApiError
from inventory.jd_logistics_models import JdLogisticsAudit, JdLogisticsBatch, JdLogisticsDepartment, JdLogisticsFact, JdLogisticsProductMapping, JdLogisticsScope, JdLogisticsTransferManual
from inventory.models import InventoryWriteAuthority
from sales.tests.factories import TEST_SECRET, signed_headers


ACTOR = "jd-test@example.invalid"
BASE = "/api/inventory/jd-logistics"


def flow(goods="00001", document="JD-001", day="2026-10-01", change=-10, **updates):
    row = {"businessUnitCode": "BU-01", "goodsCode": goods, "goodsName": "合成商品", "businessTime": day + "T10:20:30+08:00", "documentNo": document, "warehouseCode": "W01", "warehouseName": "合成仓", "businessType": "仓间调拨内配出库回传" if change < 0 else "仓间调拨入库回传", "actualBegin": 20, "actualChange": change, "actualEnd": 20 + change, "availableBegin": 20, "availableChange": change, "availableEnd": 20 + change, "inventoryStatus": "良品", "inventoryType": "内配出锁定" if change < 0 else "可销售", "channel": "POP", "unit": "台", "merchantDocumentNo": "M-1", "relatedDocumentNo": "", "merchantGoodsCode": "merchant-01", "merchantMark": "mark-01"}
    row.update(updates)
    return row


def payload(rows=None, **updates):
    value = {"operation": "import", "sourceKind": "flow", "departmentId": "dept-one", "businessUnitCode": "BU-01", "rangeStart": "2026-10-01", "rangeEnd": "2026-10-04", "warehouseCode": "", "rawFileHash": "a" * 64, "fileName": "synthetic.xlsx", "complete": True, "expectedScopeRevision": 0, "origin": "manual", "rows": rows if rows is not None else [flow()]}
    value.update(updates)
    return value


class JdLogisticsTests(TestCase):
    def setUp(self):
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(), cutover_id="jd-synthetic", migration_verify_run_id="jd-synthetic", activated_at=timezone.now())
        service.mutate({"operation": "settings", "departmentId": "dept-one", "name": "合成事业部", "businessUnitCode": "BU-01", "expectedRevision": 0}, ACTOR)
        self.filters = {"page": 1, "pageSize": 50, "departmentId": "dept-one"}

    def test_new_department_defaults_off_and_business_unit_is_shared(self):
        department = service.options()["departments"][0]
        self.assertFalse(any(department["capabilities"].values()))
        self.assertFalse(department["logisticsEnabled"])
        self.assertFalse(department["monitorEnabled"])
        self.assertFalse(department["pushEnabled"])
        with self.assertRaises(InventoryApiError):
            service.mutate({"operation": "settings", "departmentId": "dept-two", "name": "另一个账号", "businessUnitCode": "BU-01", "expectedRevision": 0}, ACTOR)
        self.assertEqual(JdLogisticsDepartment.objects.count(), 1)

    def test_new_department_cannot_inherit_enabled_flags(self):
        with self.assertRaises(InventoryApiError):
            service.mutate({"operation": "settings", "departmentId": "dept-two", "name": "新店", "businessUnitCode": "BU-02", "capabilities": {"flow": True}, "expectedRevision": 0}, ACTOR)
        self.assertFalse(JdLogisticsDepartment.objects.filter(id="dept-two").exists())

    def test_multiset_duplicate_preserves_raw_hash_and_occurrences(self):
        first = service.import_payload(payload([flow(), flow()]), ACTOR)
        second_rows = [dict(flow(), sourceRowNumber=20), dict(flow(), sourceRowNumber=5)]
        second = service.import_payload(payload(second_rows, rawFileHash="b" * 64, expectedScopeRevision=1), ACTOR)
        self.assertEqual(second["status"], "duplicate")
        self.assertEqual(second["referenceBatchId"], first["batchId"])
        self.assertEqual(second["rawFileHash"], "b" * 64)
        self.assertEqual(JdLogisticsFact.objects.count(), 2)
        self.assertEqual(list(JdLogisticsFact.objects.order_by("occurrence").values_list("occurrence", flat=True)), [1, 2])
        third = service.import_payload(payload([flow()], expectedScopeRevision=1), ACTOR)
        self.assertEqual(third["status"], "imported")
        self.assertNotEqual(third["contentHash"], first["contentHash"])
        self.assertEqual(JdLogisticsFact.objects.count(), 1)

    def test_lost_response_retry_reconciles_identical_scope_without_republishing(self):
        first = service.import_payload(payload(), ACTOR)
        retry = service.import_payload(payload(rawFileHash="b" * 64), ACTOR)
        self.assertEqual(retry["status"], "duplicate")
        self.assertEqual(retry["referenceBatchId"], first["batchId"])
        self.assertEqual(retry["scopeRevision"], 1)
        self.assertEqual(JdLogisticsFact.objects.count(), 1)

    def test_complete_business_components_affect_fingerprint(self):
        first = service.import_payload(payload(), ACTOR)
        for index, field in enumerate(sorted(service.FLOW_NUMBERS | {"channel", "merchantGoodsCode", "merchantMark", "inventoryStatus", "relatedDocumentNo"}), 1):
            row = flow(**{field: 99 if field in service.FLOW_NUMBERS else "changed"})
            result = service.import_payload(payload([row], expectedScopeRevision=index), ACTOR)
            self.assertEqual(result["status"], "imported")
            self.assertNotEqual(result["contentHash"], first["contentHash"])

    def test_overlap_replaces_removed_rows_and_keeps_outside_boundary(self):
        service.import_payload(payload([flow("A", day="2026-10-01"), flow("B", day="2026-10-02"), flow("C", day="2026-10-03")]), ACTOR)
        service.import_payload(payload([flow("D", day="2026-10-02")], rangeStart="2026-10-02", rangeEnd="2026-10-04", expectedScopeRevision=1), ACTOR)
        self.assertEqual(set(JdLogisticsFact.objects.values_list("goods_code", flat=True)), {"A", "D"})

    def test_same_content_different_range_is_new_scope_import(self):
        service.import_payload(payload(), ACTOR)
        second = service.import_payload(payload(rangeEnd="2026-10-05", expectedScopeRevision=1), ACTOR)
        self.assertEqual(second["status"], "imported")
        self.assertEqual(JdLogisticsFact.objects.count(), 1)

    def test_overlapping_scopes_are_fenced_and_stale_import_does_not_clear(self):
        service.import_payload(payload(), ACTOR)
        with self.assertRaises(InventoryApiError) as rejected:
            service.import_payload(payload([flow("B")], warehouseCode="W01"), ACTOR)
        self.assertEqual(rejected.exception.code, "version_conflict")
        self.assertEqual(JdLogisticsFact.objects.get().goods_code, "00001")
        scope = JdLogisticsScope.objects.get()
        self.assertEqual((scope.revision, scope.owner_token), (1, ""))

    def test_prevalidation_rejections_create_no_scopes_or_fingerprints(self):
        cases = [payload([]), payload(complete=False), payload(businessUnitCode="OTHER"), payload([flow(businessUnitCode="OTHER")]), payload([flow(actualChange=True)]), payload([flow(day="2026-10-04")]), payload(rawFileHash="not-a-sha"), payload([dict(flow(), unknown="x")])]
        for candidate in cases:
            with self.assertRaises(InventoryApiError):
                service.import_payload(candidate, ACTOR)
        self.assertEqual(JdLogisticsScope.objects.count(), 0)
        self.assertEqual(JdLogisticsBatch.objects.count(), 0)
        self.assertEqual(JdLogisticsFact.objects.count(), 0)
        self.assertEqual(JdLogisticsAudit.objects.filter(operation="import_rejected").count(), len(cases))

    def test_failure_after_delete_rolls_back_old_facts_and_scope(self):
        first = service.import_payload(payload(), ACTOR)
        with patch.object(service.JdLogisticsFact.objects, "bulk_create", side_effect=RuntimeError("synthetic insertion failure")):
            with self.assertRaises(RuntimeError):
                service.import_payload(payload([flow("B")], expectedScopeRevision=1), ACTOR)
        self.assertEqual(JdLogisticsFact.objects.get().batch_id, first["batchId"])
        self.assertEqual(JdLogisticsBatch.objects.count(), 1)
        self.assertEqual(JdLogisticsScope.objects.get().revision, 1)

    def test_mapping_stable_key_stale_cas_and_reimport_retains_manual_values(self):
        service.import_payload(payload([flow(), flow("A")]), ACTOR)
        update = {"operation": "mapping", "departmentId": "dept-one", "goodsCode": "00001", "erpGoodsCode": "ERP-01", "erpGoodsName": "人工ERP名", "status": "confirmed", "note": "人工核对", "expectedRevision": 0}
        result = service.mutate(update, ACTOR)
        self.assertEqual(result["revision"], 1)
        with self.assertRaises(InventoryApiError):
            service.mutate(update, ACTOR)
        service.import_payload(payload([flow("A"), flow()], expectedScopeRevision=1), ACTOR)
        item = next(row for row in service.read("mappings", self.filters)["items"] if row["goodsCode"] == "00001")
        self.assertEqual((item["erpGoodsCode"], item["erpGoodsName"]), ("ERP-01", "人工ERP名"))
        self.assertEqual(JdLogisticsProductMapping.objects.count(), 1)

    def test_manual_state_uses_document_plus_goods_and_flow_cas(self):
        service.import_payload(payload([flow(), flow("A")]), ACTOR)
        first = next(row for row in service.read("transfers", self.filters)["items"] if row["goodsCode"] == "00001")
        update = {"operation": "manual", "departmentId": "dept-one", "documentNo": "JD-001", "goodsCode": "00001", "transferStatus": "completed", "erpDocumentNo": "ERP-DOC", "expectedRevision": 0, "expectedFlowRevision": first["flowRevision"]}
        result = service.mutate(update, ACTOR)
        self.assertFalse(result["erpVerified"])
        with self.assertRaises(InventoryApiError):
            service.mutate(update, ACTOR)
        service.import_payload(payload([flow(actualChange=-11), flow("A")], expectedScopeRevision=1), ACTOR)
        rows = service.read("transfers", self.filters)["items"]
        changed = next(row for row in rows if row["goodsCode"] == "00001")
        untouched = next(row for row in rows if row["goodsCode"] == "A")
        self.assertTrue(changed["needsReview"])
        self.assertEqual(changed["transferStatus"], "completed")
        self.assertEqual(untouched["transferStatus"], "pending")
        with self.assertRaises(InventoryApiError):
            service.mutate({**update, "expectedRevision": 1}, ACTOR)

    def test_manual_confirmation_needs_review_when_erp_mapping_changes(self):
        service.import_payload(payload(), ACTOR)
        before = service.read("transfers", self.filters)["items"][0]
        service.mutate({"operation": "manual", "departmentId": "dept-one", "documentNo": "JD-001", "goodsCode": "00001", "transferStatus": "completed", "expectedRevision": 0, "expectedFlowRevision": before["flowRevision"]}, ACTOR)
        service.mutate({"operation": "mapping", "departmentId": "dept-one", "goodsCode": "00001", "erpGoodsCode": "ERP-NEW", "expectedRevision": 0}, ACTOR)
        after = service.read("transfers", self.filters)["items"][0]
        self.assertTrue(after["needsReview"])
        self.assertEqual(after["transferStatus"], "completed")
        self.assertFalse(after["erpVerified"])

    def test_incoming_over_outgoing_and_multiwarehouse_are_anomalies(self):
        service.import_payload(payload([flow(), flow(change=15, warehouseCode="W02", warehouseName="收货仓")]), ACTOR)
        item = service.read("transfers", self.filters)["items"][0]
        self.assertEqual((item["outQuantity"], item["inQuantity"], item["jdStatus"]), (10, 15, "quantity_anomaly"))
        self.assertFalse(item["coverageComplete"])

    def test_same_goods_other_business_unit_is_isolated(self):
        service.import_payload(payload(), ACTOR)
        service.mutate({"operation": "settings", "departmentId": "dept-two", "name": "合成二部", "businessUnitCode": "BU-02", "expectedRevision": 0}, ACTOR)
        service.import_payload(payload([flow(businessUnitCode="BU-02")], departmentId="dept-two", businessUnitCode="BU-02"), ACTOR)
        self.assertEqual(service.read("flows", self.filters)["total"], 1)
        self.assertEqual(JdLogisticsFact.objects.count(), 2)

    def test_shop_relationships_preserve_one_to_many_without_copying_flow(self):
        service.import_payload(payload(), ACTOR)
        row = {"businessUnitCode": "BU-01", "goodsCode": "00001", "goodsName": "商品", "platform": "京东", "shopName": "一店", "shopProductCode": "ESG01", "platformSku": "SKU1", "isvCode": "ISV1", "merchantMark": "M", "merchantGoodsCode": "M1", "unit": "台", "isCombo": False, "productStatus": "启用"}
        result = service.import_payload(payload([row, {**row, "shopName": "二店", "shopProductCode": "ESG02"}], sourceKind="shop_products"), ACTOR)
        self.assertEqual(result["rowCount"], 2)
        mapping = service.read("mappings", self.filters)["items"][0]
        self.assertEqual(mapping["shopLinkCount"], 2)
        self.assertEqual(service.read("overview", self.filters)["summary"]["flowCount"], 1)

    def test_official_product_csv_missing_department_product_and_platform_stays_unlinked(self):
        row = {"businessUnitCode": "BU-01", "goodsCode": "", "goodsName": "未关联商品", "shopName": "来源店铺", "shopProductCode": "ESG01", "platformSku": "SKU1", "productStatus": "启用"}
        result = service.import_payload(payload([row, {**row, "shopProductCode": "ESG02"}], sourceKind="shop_products"), ACTOR)
        self.assertEqual(result["rowCount"], 2)
        items = service.read("mappings", self.filters)["items"]
        self.assertEqual(len(items), 2)
        self.assertTrue(all(not item["mappingAllowed"] for item in items))
        self.assertEqual(len({item["sourceRelationKey"] for item in items}), 2)
        self.assertTrue(all(item["shopLinks"][0]["platform"] == "" for item in items))
        with self.assertRaises(InventoryApiError):
            service.mutate({"operation": "mapping", "departmentId": "dept-one", "goodsCode": "", "goodsCodeKind": "department_product", "erpGoodsCode": "ERP", "expectedRevision": 0}, ACTOR)

    def test_enabled_product_collection_rejects_mixed_or_unspecified_status(self):
        row = {"businessUnitCode": "BU-01", "goodsCode": "G1", "goodsName": "商品", "shopName": "来源店铺", "shopProductCode": "ESG01"}
        for status in ("", "停用"):
            with self.assertRaises(InventoryApiError):
                service.import_payload(payload([{**row, "productStatus": status}], sourceKind="shop_products"), ACTOR)
        self.assertEqual(JdLogisticsFact.objects.count(), 0)

    def test_current_cwarehouse_cap_excludes_unrelated_flow_history_in_sql(self):
        self._cwarehouse_sources(snapshot_day="2026-10-02", live_day="2026-10-02")
        service.import_payload(payload([flow(str(i)) for i in range(8)]), ACTOR)
        with patch.object(service, "MAX_READ_ROWS", 2):
            result = service.read("inventory_monitor", self.filters)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["onHandQuantity"], 20)

    def test_both_inventory_sources_keep_null_components_separate_from_zero(self):
        row = {"businessUnitCode": "BU-01", "goodsCode": "00001", "goodsName": "商品", "warehouseCode": "C01", "warehouseName": "C明细仓", "snapshotDate": "2026-10-01", "inventoryStatus": "良品", "inventoryType": "正常", "unit": "台", "onHandQuantity": 0, "availableQuantity": None, "lockedQuantity": 0, "inTransitQuantity": None}
        for kind in ("realtime_inventory", "inventory_snapshot"):
            result = service.import_payload(payload([row], sourceKind=kind), ACTOR)
            self.assertEqual(result["status"], "imported")
            stored = JdLogisticsFact.objects.get(source_kind=kind).data
            self.assertIsNone(stored["availableQuantity"])
            self.assertEqual(stored["onHandQuantity"], 0)

    def test_workflow_requires_enabled_binding_and_matching_observation(self):
        workflow = payload(origin="workflow", storeKey="synthetic-store", identityEvidence={"observedBusinessUnitCode": "BU-01", "observedAt": timezone.now().isoformat(), "sourceUrl": service.SOURCE_URLS["flow"], "storeKey": "synthetic-store"})
        with self.assertRaises(InventoryApiError):
            service.import_payload(workflow, ACTOR)
        service.mutate({"operation": "settings", "departmentId": "dept-one", "storeKeys": ["synthetic-store"], "capabilities": {"flow": True}, "logisticsEnabled": True, "expectedRevision": 1}, ACTOR)
        wrong = deepcopy(workflow)
        wrong["identityEvidence"]["observedBusinessUnitCode"] = "OTHER"
        with self.assertRaises(InventoryApiError):
            service.import_payload(wrong, ACTOR)
        result = service.import_payload(workflow, ACTOR)
        self.assertEqual(result["status"], "imported")
        self.assertFalse(result["sourceBindingVerified"])

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_signed_http_import_read_replay_and_exact_batch(self):
        body = json.dumps(payload())
        headers = signed_headers(BASE, method="POST", body=body, request_id="jdl-import-1")
        response = self.client.post(BASE, data=body, content_type="application/json", headers=headers)
        self.assertEqual(response.status_code, 200, response.content)
        batch = response.json()["data"]
        replay = self.client.post(BASE, data=body, content_type="application/json", headers=headers)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
        self.assertEqual(JdLogisticsBatch.objects.count(), 1)
        url = BASE + "?operation=batches&batchId=" + batch["batchId"]
        result = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(result.json()["data"]["items"][0]["rawFileHash"], "a" * 64)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_signed_http_import_and_reloaded_batch_keep_exact_utc_collect_time(self):
        cases = (
            ("2026-10-02T13:58:27.116123+08:00", "2026-10-02T05:58:27.116123+00:00"),
            ("2026-10-02T13:58:27+08:00", "2026-10-02T05:58:27+00:00"),
            ("2026-10-02T00:00:00.000001+08:00", "2026-10-01T16:00:00.000001+00:00"),
            ("2026-10-01T22:30:00.654321-05:30", "2026-10-02T04:00:00.654321+00:00"),
            ("2026-10-02T05:58:27.116123Z", "2026-10-02T05:58:27.116123+00:00"),
        )
        previous_id = None
        for index, (collected_at, expected) in enumerate(cases):
            with self.subTest(collectedAt=collected_at):
                body = json.dumps(payload([flow(goods=f"offset-{index}")], collectedAt=collected_at, sourceAsOf="2026-10-01", expectedScopeRevision=index))
                response = self.client.post(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="POST", body=body, request_id=f"jdl-offset-{index}"))
                self.assertEqual(response.status_code, 200, response.content)
                batch = response.json()["data"]
                self.assertEqual(batch["status"], "imported")
                self.assertEqual(batch["scopeRevision"], index + 1)
                self.assertEqual(batch["collectedAt"], expected)
                stored = JdLogisticsBatch.objects.get(id=batch["batchId"])
                self.assertEqual(stored.collected_at.isoformat(), expected)
                url = BASE + "?operation=batches&batchId=" + batch["batchId"]
                result = self.client.get(url, headers=signed_headers(url))
                self.assertEqual(result.status_code, 200, result.content)
                readback = result.json()["data"]["items"][0]
                selection = readback.pop("currentSelection")
                self.assertEqual(readback, {key: batch[key] for key in readback})
                self.assertEqual(selection, {"current": True, "verifiedRowCount": 1, "contentHash": batch["contentHash"], "scopeRevision": index + 1})
                if previous_id:
                    previous = service.read("batches", {**self.filters, "batchId": previous_id})["items"][0]
                    self.assertFalse(previous["currentSelection"]["current"])
                previous_id = batch["batchId"]

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_permissions_signatures_roles_scope_and_query_strictness(self):
        self.assertEqual(self.client.get(BASE).status_code, 401)
        body = json.dumps(payload())
        for role in ("viewer", "analyst", "operator"):
            result = self.client.post(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="POST", body=body, role=role))
            self.assertEqual(result.status_code, 403, result.content)
        scope = {"warehouses": ["W01"], "channels": [], "platforms": []}
        result = self.client.get(BASE, headers=signed_headers(BASE, scope=scope))
        self.assertEqual(result.status_code, 403)
        for query in ("?operation=flows&page=1&page=2", "?operation=flows&unknown=x", "?operation=inventory_monitor&layout=unknown", "?operation=inventory_monitor&salesWindow=14", "?operation=flows&startDate=2026-10-04&endDate=2026-10-01"):
            url = BASE + query
            self.assertEqual(self.client.get(url, headers=signed_headers(url)).status_code, 400)
        with override_settings(DJANGO_PROCESS_ROLE="inventory_reader"):
            result = self.client.post(BASE, data=body, content_type="application/json", headers=signed_headers(BASE, method="POST", body=body))
            self.assertEqual(result.status_code, 503)

    def test_schema_readiness_contains_new_tables_indexes_and_role_privileges(self):
        from teruisi_backend.health import REQUIRED_INVENTORY_COLUMNS, REQUIRED_INVENTORY_READER_INDEXES, INVENTORY_WRITER_TABLE_PRIVILEGES
        for model in (JdLogisticsDepartment, JdLogisticsScope, JdLogisticsBatch, JdLogisticsFact, JdLogisticsProductMapping, JdLogisticsTransferManual):
            self.assertIn(model._meta.db_table, REQUIRED_INVENTORY_COLUMNS)
        self.assertNotIn(JdLogisticsAudit._meta.db_table, REQUIRED_INVENTORY_COLUMNS)
        self.assertEqual(INVENTORY_WRITER_TABLE_PRIVILEGES[JdLogisticsFact._meta.db_table], ("SELECT", "INSERT", "DELETE"))
        with connection.cursor() as cursor:
            indexes = connection.introspection.get_constraints(cursor, JdLogisticsFact._meta.db_table)
        self.assertTrue({"inv_jdl_fact_scope_idx", "inv_jdl_fact_doc_idx"}.issubset(indexes))
        self.assertIn("inv_jdl_fact_doc_idx", REQUIRED_INVENTORY_READER_INDEXES)

    def test_new_source_models_are_explicitly_excluded_from_generic_ai_table_access(self):
        from system_datasets.catalog import MANIFEST
        excluded = {item["model"] for item in MANIFEST["excludedModels"]}
        for model in (JdLogisticsDepartment, JdLogisticsScope, JdLogisticsBatch, JdLogisticsFact, JdLogisticsProductMapping, JdLogisticsTransferManual, JdLogisticsAudit):
            self.assertIn(f"inventory.{model.__name__}", excluded)

    def test_exact_batch_recheck_detects_replaced_facts_and_preserves_collect_metadata(self):
        first = service.import_payload(payload(collectedAt="2026-10-02T12:00:00+08:00", sourceAsOf="2026-10-01"), ACTOR)
        before = service.read("batches", {**self.filters, "batchId": first["batchId"]})["items"][0]
        self.assertTrue(before["currentSelection"]["current"])
        self.assertEqual(before["currentSelection"]["verifiedRowCount"], 1)
        self.assertEqual(before["sourceAsOf"], "2026-10-01")
        service.import_payload(payload([flow("B")], expectedScopeRevision=1), ACTOR)
        old = service.read("batches", {**self.filters, "batchId": first["batchId"]})["items"][0]
        self.assertFalse(old["currentSelection"]["current"])
        self.assertEqual(old["currentSelection"]["scopeRevision"], 2)

    def test_transfer_components_are_not_counted_twice_and_unknown_types_are_reviewed(self):
        service.import_payload(payload([flow(), flow(change=10, businessType="仓间调拨内配出库回传", inventoryType="在途库存", warehouseCode="W02"), flow(change=10, warehouseCode="W02"), flow(change=-10, businessType="仓间调拨入库回传", inventoryType="在途库存", warehouseCode="W02")]), ACTOR)
        item = service.read("transfers", self.filters)["items"][0]
        self.assertEqual((item["outQuantity"], item["inQuantity"], item["jdStatus"]), (10, 10, "completed"))
        service.import_payload(payload([flow(businessType="未知调拨冲销")], expectedScopeRevision=1), ACTOR)
        self.assertEqual(service.read("transfers", self.filters)["items"][0]["jdStatus"], "review")

    def _cwarehouse_sources(self, snapshot_day="2026-10-01", missing=None, live_day="2026-10-01"):
        row = {"businessUnitCode": "BU-01", "goodsCode": "00001", "goodsName": "商品", "warehouseCode": "C01", "warehouseName": "来源C仓", "snapshotDate": live_day, "inventoryStatus": "良品", "inventoryType": "可销售", "unit": "台", "onHandQuantity": 20, "availableQuantity": 15, "purchaseInTransitQuantity": 4, "transferInTransitQuantity": 3, "sales7dQuantity": None, "sales30dQuantity": None, "regionCode": "", "regionName": ""}
        if missing:
            row[missing] = None
        service.import_payload(payload([row], sourceKind="realtime_inventory", collectedAt=live_day + "T00:30:00+08:00"), ACTOR)
        snapshot = {**row, "snapshotDate": snapshot_day, "sales7dQuantity": 10, "sales30dQuantity": 60}
        if missing:
            snapshot[missing] = None
        service.import_payload(payload([snapshot], sourceKind="inventory_snapshot", rangeStart=min("2026-10-01", snapshot_day), collectedAt=max(live_day, snapshot_day) + "T00:30:00+08:00"), ACTOR)
        service.mutate({"operation": "mapping", "departmentId": "dept-one", "goodsCode": "00001", "goodsCodeKind": "jd_sku", "erpGoodsCode": "ERP", "erpGoodsName": "人工ERP", "status": "confirmed", "expectedRevision": 0}, ACTOR)

    def test_cwarehouse_monitor_uses_source_formula_and_unknown_region_is_disclosed(self):
        self._cwarehouse_sources()
        service.mutate({"operation": "settings", "departmentId": "dept-one", "monitorEnabled": True, "stockoutThresholdDays": 15, "expectedRevision": 1}, ACTOR)
        result = service.read("inventory_monitor", self.filters)
        item = result["items"][0]
        self.assertEqual(item["turnoverDays"], 10)
        self.assertEqual(item["postReplenishmentQuantity"], 22)
        self.assertEqual(item["warningState"], "stockout_risk")
        self.assertIsNone(item["regionCode"])
        self.assertIn("region_unmapped", item["qualifications"])
        self.assertFalse(result["notificationAvailable"])

    def test_cwarehouse_date_mismatch_and_missing_quantity_are_not_zero(self):
        self._cwarehouse_sources(snapshot_day="2026-10-02", missing="purchaseInTransitQuantity")
        item = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertFalse(item["qualified"])
        self.assertIn("source_date_mismatch", item["qualifications"])
        self.assertIsNone(item["purchaseInTransitQuantity"])
        self.assertIsNone(item["turnoverDays"])
        self.assertIsNone(item["postReplenishmentQuantity"])

    def test_cwarehouse_regular_T_live_with_T_minus_one_sales_is_qualified(self):
        self._cwarehouse_sources(live_day="2026-10-02", snapshot_day="2026-10-01")
        item = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertTrue(item["qualified"])
        self.assertEqual(item["turnoverDays"], 10)
        self.assertEqual(item["postReplenishmentQuantity"], 22)
        self.assertEqual(item["datePairing"], "previous_day")
        self.assertEqual(item["sourceDateLagDays"], 1)
        self.assertEqual((item["realtimeDate"], item["salesAsOfDate"]), ("2026-10-02", "2026-10-01"))
        self.assertNotIn("source_date_mismatch", item["qualifications"])

    def test_cwarehouse_stale_snapshot_and_missing_source_do_not_produce_metrics(self):
        self._cwarehouse_sources(live_day="2026-10-02", snapshot_day="2026-09-30")
        item = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertEqual(item["sourceDateLagDays"], 2)
        self.assertIn("source_date_mismatch", item["qualifications"])
        self.assertIsNone(item["turnoverDays"])
        self.assertEqual(item["postReplenishmentQuantity"], 22)
        JdLogisticsFact.objects.filter(source_kind="inventory_snapshot").delete()
        missing = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertIn("missing_snapshot_source", missing["qualifications"])
        self.assertIsNone(missing["turnoverDays"])

    def test_cwarehouse_collection_and_source_as_of_dates_must_match_evidence(self):
        self._cwarehouse_sources()
        JdLogisticsBatch.objects.filter(source_kind="realtime_inventory").update(collected_at=service.datetime.fromisoformat("2026-10-02T00:30:00+08:00"))
        item = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertIn("realtime_collection_date_mismatch", item["qualifications"])
        self.assertIsNone(item["turnoverDays"])
        JdLogisticsBatch.objects.filter(source_kind="realtime_inventory").update(collected_at=service.datetime.fromisoformat("2026-10-01T00:30:00+08:00"))
        JdLogisticsBatch.objects.filter(source_kind="inventory_snapshot").update(source_as_of="2026-09-30")
        item = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertIn("snapshot_source_as_of_mismatch", item["qualifications"])
        self.assertEqual(item["postReplenishmentQuantity"], 22)

    def test_each_cwarehouse_formula_uses_only_its_actual_dependencies(self):
        self._cwarehouse_sources(missing="sales7dQuantity")
        JdLogisticsProductMapping.objects.all().delete()
        service.mutate({"operation": "settings", "departmentId": "dept-one", "monitorEnabled": True, "stockoutThresholdDays": 15, "expectedRevision": 1}, ACTOR)
        thirty = service.read("inventory_monitor", {**self.filters, "salesWindow": 30})["items"][0]
        self.assertIn("unconfirmed_product_mapping", thirty["qualifications"])
        self.assertEqual((thirty["turnoverDays"], thirty["postReplenishmentQuantity"], thirty["availableDays"]), (10, 22, 7.5))
        seven = service.read("inventory_monitor", {**self.filters, "salesWindow": 7})["items"][0]
        self.assertEqual((seven["turnoverDays"], seven["postReplenishmentQuantity"], seven["warningState"]), (10, 22, "stockout_risk"))
        self.assertIsNone(seven["availableDays"])
        live = JdLogisticsFact.objects.get(source_kind="realtime_inventory")
        live.data["purchaseInTransitQuantity"] = None
        live.save(update_fields=["data"])
        missing_transit = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertIsNone(missing_transit["postReplenishmentQuantity"])
        self.assertEqual(missing_transit["turnoverDays"], 10)
        self.assertEqual(missing_transit["warningState"], "stockout_risk")
        live.data["purchaseInTransitQuantity"] = 4
        live.save(update_fields=["data"])
        snap = JdLogisticsFact.objects.get(source_kind="inventory_snapshot")
        snap.data["sales30dQuantity"] = 0
        snap.save(update_fields=["data"])
        zero_demand = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertIsNone(zero_demand["turnoverDays"])
        self.assertEqual(zero_demand["postReplenishmentQuantity"], 22)
        snap.delete()
        missing_snapshot = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertEqual(missing_snapshot["postReplenishmentQuantity"], 22)
        self.assertIsNone(missing_snapshot["turnoverDays"])

    def _matrix_sources(self):
        live_rows, snapshot_rows = [], []
        for goods, warehouse, province, on_hand, available, locked, purchase, transfer, sales7, sales30, native in (("P-A", "W-A1", "广东省", 20, 10, 1, 2, 3, 7, 30, "20"), ("P-A", "W-A2", "广东省", 80, 30, 2, 4, 1, 14, 90, "100"), ("P-B", "W-B1", "浙江省", 10, 5, 1, 0, 0, 0, 0, "0")):
            live_rows.append({"businessUnitCode": "BU-01", "goodsCode": goods, "goodsName": goods + "合成商品", "warehouseCode": warehouse, "warehouseName": warehouse + "来源仓", "snapshotDate": "2026-10-02", "onHandQuantity": on_hand, "availableQuantity": available, "lockedQuantity": locked, "purchaseInTransitQuantity": purchase, "transferInTransitQuantity": transfer})
            snapshot_rows.append({**live_rows[-1], "snapshotDate": "2026-10-01", "sales7dQuantity": sales7, "sales30dQuantity": sales30, "sourceProvinceCity": province, "sourceAttributes": {"30天周转": native}})
        service.import_payload(payload(live_rows, sourceKind="realtime_inventory", collectedAt="2026-10-02T08:00:00+08:00"), ACTOR)
        service.import_payload(payload(snapshot_rows, sourceKind="inventory_snapshot", collectedAt="2026-10-02T08:00:00+08:00"), ACTOR)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_product_matrix_groups_before_paging_and_columns_cover_complete_scope(self):
        self._matrix_sources()
        first = service.read("inventory_monitor", {**self.filters, "layout": "product", "salesWindow": 7, "pageSize": 1})
        second = service.read("inventory_monitor", {**self.filters, "layout": "product", "salesWindow": 7, "pageSize": 1, "page": 2})
        self.assertEqual((first["total"], len(first["items"]), first["items"][0]["goodsCode"]), (2, 1, "P-A"))
        self.assertEqual(first["columns"], second["columns"])
        self.assertEqual({column["label"] for column in first["columns"]}, {"W-A1来源仓", "W-A2来源仓", "W-B1来源仓"})
        self.assertTrue(all(column["kind"] == "warehouse" for column in first["columns"]))
        product = first["items"][0]
        self.assertEqual((product["detailCount"], len(product["details"]), product["detailsComplete"]), (2, 2, True))
        self.assertEqual(product["summary"]["onHandQuantity"], 100)
        self.assertEqual(product["summary"]["turnoverDays"], 25)
        self.assertEqual(product["summary"]["availableDays"], 13.33)
        self.assertEqual(product["summary"]["availableWithTransitDays"], 16.67)
        self.assertEqual(product["summary"]["lockedQuantity"], 3)
        self.assertEqual(first["totals"]["onHandQuantity"], 110)
        self.assertEqual(first["totals"]["sales30dQuantity"], 120)
        self.assertEqual(first["totals"]["turnoverDays"], 27.5)  # Known zero warehouse demand stays zero.
        self.assertEqual(first["totals"], second["totals"])
        url = BASE + "?operation=inventory_monitor&layout=product&salesWindow=7&pageSize=1&departmentId=dept-one"
        response = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["data"]["items"][0]["summary"], product["summary"])
        self.assertEqual(response.json()["data"]["salesWindow"], 7)
        self.assertIsNone(product["imageUrl"])
        self.assertIsNone(product["price"])
        with patch.object(service, "MAX_PRODUCT_DETAILS", 1):
            capped = service.read("inventory_monitor", {**self.filters, "layout": "product"})["items"][0]
        self.assertEqual((capped["detailCount"], len(capped["details"]), capped["detailsComplete"], capped["detailsTruncated"]), (2, 1, False, True))
        self.assertEqual(capped["summary"]["onHandQuantity"], 100)

    def test_product_matrix_unknown_component_does_not_become_partial_scope_total(self):
        self._matrix_sources()
        live = JdLogisticsFact.objects.get(source_kind="realtime_inventory", warehouse_code="W-A2")
        live.data["availableQuantity"] = None
        live.save(update_fields=["data"])
        data = service.read("inventory_monitor", {**self.filters, "layout": "product", "salesWindow": 30})
        self.assertEqual(data["totals"]["onHandQuantity"], 110)
        self.assertEqual(data["totals"]["turnoverDays"], 27.5)
        for metric in ("availableQuantity", "postReplenishmentQuantity", "availableDays", "availableWithTransitDays"):
            self.assertIsNone(data["totals"][metric])
            self.assertTrue(data["totals"]["metricQualifications"][metric])
        product = data["items"][0]
        self.assertIsNone(product["summary"]["availableQuantity"])
        self.assertEqual(product["summary"]["onHandQuantity"], 100)

    def test_product_matrix_keeps_source_dates_and_never_averages_native_days(self):
        self._matrix_sources()
        service.mutate({"operation": "settings", "departmentId": "dept-two", "name": "第二合成事业部", "businessUnitCode": "BU-02", "expectedRevision": 0}, ACTOR)
        live = {"businessUnitCode": "BU-02", "goodsCode": "P-A", "goodsName": "另一来源同码商品", "warehouseCode": "W-X", "warehouseName": "无省市来源仓", "snapshotDate": "2026-10-03", "onHandQuantity": 50, "availableQuantity": 25, "lockedQuantity": 0, "purchaseInTransitQuantity": 0, "transferInTransitQuantity": 0}
        service.import_payload(payload([live], departmentId="dept-two", businessUnitCode="BU-02", sourceKind="realtime_inventory", collectedAt="2026-10-03T08:00:00+08:00"), ACTOR)
        snapshot = {**live, "snapshotDate": "2026-10-02", "sales7dQuantity": 7, "sales30dQuantity": 30, "sourceAttributes": {"30天周转": "not-finite"}}
        service.import_payload(payload([snapshot], departmentId="dept-two", businessUnitCode="BU-02", sourceKind="inventory_snapshot", collectedAt="2026-10-03T08:00:00+08:00"), ACTOR)
        data = service.read("inventory_monitor", {"page": 1, "pageSize": 50, "layout": "product", "salesWindow": 30})
        self.assertEqual(data["total"], 3)
        self.assertEqual(data["totals"]["onHandQuantity"], 160)
        self.assertEqual(data["totals"]["realtimeDates"], ["2026-10-02", "2026-10-03"])
        self.assertEqual(data["totals"]["snapshotDates"], ["2026-10-01", "2026-10-02"])
        self.assertIsNone(data["totals"]["availableDays"])
        self.assertIn("period_mismatch", data["totals"]["metricQualifications"]["availableDays"])
        self.assertTrue(any(column["kind"] == "warehouse" and column["label"] == "无省市来源仓" for column in data["columns"]))
        product = next(item for item in data["items"] if item["departmentId"] == "dept-one" and item["goodsCode"] == "P-A")
        self.assertEqual(product["summary"]["turnoverDays"], 25)
        self.assertIsNone(product["summary"]["nativeTurnover30d"])
        self.assertIn("native_turnover_not_additive", product["summary"]["metricQualifications"]["nativeTurnover30d"])
        self.assertEqual([row["nativeTurnover30d"] for row in product["details"]], [20, 100])
        self.assertEqual({row["datePairing"] for row in product["details"]}, {"previous_day"})
        invalid_native = next(item for item in data["items"] if item["departmentId"] == "dept-two")["details"][0]
        self.assertIsNone(invalid_native["nativeTurnover30d"])
        self.assertIn("invalid_native_turnover", invalid_native["metricQualifications"]["nativeTurnover30d"])

    def test_complete_unmapped_business_columns_participate_in_content_hash(self):
        attributes = {"商品等级编码": "G1", "商品等级名称": "一级", "商家等级编码": "MG1", "款号": "K1", "颜色": "白", "尺码": "L"}
        first = service.import_payload(payload([flow(sourceAttributes=attributes)]), ACTOR)
        reordered = dict(reversed(list(attributes.items())))
        reordered["序号"] = "123"
        duplicate = service.import_payload(payload([flow(sourceAttributes=reordered)], expectedScopeRevision=1, rawFileHash="b" * 64), ACTOR)
        self.assertEqual(duplicate["status"], "duplicate")
        self.assertEqual(duplicate["contentHash"], first["contentHash"])
        for index, field in enumerate(attributes, 1):
            changed = {**attributes, field: "真实业务值变化"}
            result = service.import_payload(payload([flow(sourceAttributes=changed)], expectedScopeRevision=index), ACTOR)
            self.assertEqual(result["status"], "imported")
            self.assertNotEqual(result["contentHash"], first["contentHash"])

    def test_inventory_source_columns_and_province_text_are_preserved_without_region_inference(self):
        self._cwarehouse_sources()
        row = deepcopy(JdLogisticsFact.objects.get(source_kind="inventory_snapshot").data)
        row["sourceAttributes"] = {"在库件数-良品": "20", "在库件数-残品": "0", "体积": "0.0000001", "重量": "1.250", "销售出库件数": "2", "近15天销售出库件数": "30", "30天周转": "9.750"}
        row["sourceProvinceCity"] = "广东省佛山市"
        result = service.import_payload(payload([row], sourceKind="inventory_snapshot", expectedScopeRevision=1), ACTOR)
        stored = JdLogisticsFact.objects.get(source_kind="inventory_snapshot").data
        self.assertEqual(stored["sourceAttributes"], row["sourceAttributes"])
        item = service.read("inventory_monitor", self.filters)["items"][0]
        self.assertEqual(item["sourceProvinceCity"], "广东省佛山市")
        self.assertIsNone(item["regionCode"])
        row["sourceAttributes"]["30天周转"] = "9.751"
        changed = service.import_payload(payload([row], sourceKind="inventory_snapshot", expectedScopeRevision=2), ACTOR)
        self.assertNotEqual(changed["contentHash"], result["contentHash"])
        self.assertEqual(changed["status"], "imported")
        live = deepcopy(JdLogisticsFact.objects.get(source_kind="realtime_inventory").data)
        live["sourceAttributes"] = {"一级品类": "电器", "二级品类": "厨房", "三级品类": "合成品类"}
        first = service.import_payload(payload([live], sourceKind="realtime_inventory", expectedScopeRevision=1), ACTOR)
        live["sourceAttributes"]["三级品类"] = "其他合成品类"
        second = service.import_payload(payload([live], sourceKind="realtime_inventory", expectedScopeRevision=2), ACTOR)
        self.assertNotEqual(first["contentHash"], second["contentHash"])

    def test_source_attribute_bounds_and_excess_time_precision_fail_closed(self):
        for attributes in ({"体积": 0.5}, {"嵌套": {"key": "value"}}, {"x": "a" * 1001}, {str(index): "x" for index in range(101)}, {"a": "1", " a ": "2"}):
            with self.assertRaises(InventoryApiError):
                service.import_payload(payload([flow(sourceAttributes=attributes)]), ACTOR)
        with self.assertRaises(InventoryApiError):
            service.import_payload(payload([flow(businessTime="2026-10-01T10:20:30.1234567+08:00")]), ACTOR)

    def test_immutable_mapping_unit_and_workflow_live_date_identity(self):
        with self.assertRaises(InventoryApiError):
            service.mutate({"operation": "settings", "departmentId": "dept-one", "businessUnitCode": "DIFFERENT", "expectedRevision": 1}, ACTOR)
        service.mutate({"operation": "settings", "departmentId": "dept-one", "storeKeys": ["synthetic-store"], "capabilities": {"realtime_inventory": True}, "logisticsEnabled": True, "expectedRevision": 1}, ACTOR)
        row = {"businessUnitCode": "BU-01", "goodsCode": "00001", "goodsName": "商品", "warehouseCode": "C01", "snapshotDate": "2026-10-01", "onHandQuantity": 1}
        source = payload([row], sourceKind="realtime_inventory", origin="workflow", storeKey="synthetic-store", collectedAt=timezone.now().isoformat(), collectorEvidence={"runId": "synthetic-run", "executionId": "synthetic-exec", "protocol": "jdl-test-v1"}, identityEvidence={"observedBusinessUnitCode": "BU-01", "observedAt": timezone.now().isoformat(), "sourceUrl": service.SOURCE_URLS["realtime_inventory"], "storeKey": "synthetic-store"})
        with self.assertRaises(InventoryApiError) as rejected:
            service.import_payload(source, ACTOR)
        self.assertEqual(rejected.exception.code, "range_mismatch")

    def test_name_only_warehouse_identities_and_sku_namespaces_do_not_collide(self):
        service.import_payload(payload(), ACTOR)
        row = {"businessUnitCode": "BU-01", "goodsCode": "00001", "goodsName": "同码JD SKU", "merchantGoodsCode": "M01", "merchantMark": "MARK01", "warehouseCode": "", "warehouseName": "源一号仓", "warehouseIdentityKind": "name", "snapshotDate": "2026-10-01", "onHandQuantity": 10}
        service.import_payload(payload([row, {**row, "warehouseName": "源二号仓"}], sourceKind="realtime_inventory"), ACTOR)
        rows = service.read("inventory_monitor", self.filters)["items"]
        self.assertEqual(len(rows), 2)
        self.assertEqual({item["warehouseKey"] for item in rows}, {"name:源一号仓", "name:源二号仓"})
        self.assertTrue(all(item["warehouseCode"] == "" for item in rows))
        service.mutate({"operation": "mapping", "departmentId": "dept-one", "goodsCode": "00001", "goodsCodeKind": "jd_sku", "erpGoodsCode": "C-ERP", "expectedRevision": 0}, ACTOR)
        service.mutate({"operation": "mapping", "departmentId": "dept-one", "goodsCode": "00001", "goodsCodeKind": "department_product", "erpGoodsCode": "POP-ERP", "expectedRevision": 0}, ACTOR)
        self.assertEqual(JdLogisticsProductMapping.objects.count(), 2)
        pop_mapping = service.read("flows", self.filters)["items"][0]["mapping"]
        self.assertEqual(pop_mapping["erpGoodsCode"], "POP-ERP")
        filtered = service.read("inventory_monitor", {**self.filters, "warehouseKey": "name:源二号仓"})
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(filtered["items"][0]["erpGoodsCode"], "C-ERP")
