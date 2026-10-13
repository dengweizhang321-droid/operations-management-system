import copy
from datetime import timedelta
from urllib.parse import urlencode

from django.http import QueryDict
from django.test import TestCase
from django.utils import timezone

from inventory.errors import InventoryApiError
from inventory.import_service import import_inventory_payload
from inventory.models import InventoryImportAttempt, InventoryImportBatch, InventoryImportScopeHead, InventoryRawUploadSession
from inventory.recovery import read_recovery
from inventory.tests import test_imports as fixtures
from inventory.tests.test_imports import age_payload, stock_payload, stock_row


class InventoryRecoveryTests(TestCase):
    setUp = fixtures.InventoryImportTests.setUp

    def guarded(self, payload, token):
        module = "inventory" if payload["dataset"] == "stock" else "inventory_age"
        session = InventoryRawUploadSession.objects.create(actor_email="admin@example.test", dataset=payload["dataset"],
            snapshot_date=payload["snapshotDate"], fingerprint=f'inventory:{payload["dataset"]}:{payload["snapshotDate"]}:jky-recovery-v1:n8n-export-first-8548:{module}:{payload["file"]["rawFileHash"]}:{token}',
            file_name=payload["file"]["name"], file_size_bytes=payload["file"]["sizeBytes"], chunk_size_bytes=1048576, chunk_count=1,
            status="processing", owner_token="a" * 43, owner_generation=1, expires_at=timezone.now() + timedelta(hours=1))
        guarded = copy.deepcopy(payload)
        guarded["publicationGuard"] = {"uploadId": str(session.id), "ownerToken": session.owner_token, "ownerGeneration": 1}
        return guarded, session

    def query(self, payload, session):
        return QueryDict(urlencode({"recovery": "result", "dataset": payload["dataset"], "snapshotDate": payload["snapshotDate"],
            "rawFileHash": payload["file"]["rawFileHash"], "fileName": payload["file"]["name"], "fileSizeBytes": payload["file"]["sizeBytes"],
            "fingerprint": session.fingerprint, "uploadId": str(session.id)}), mutable=True)

    def test_stock_and_age_results_survive_missing_sessions_but_never_claim_another_actor_or_file(self):
        for payload in (stock_payload(stock_row("P1", 2)), age_payload("华东仓")):
            with self.subTest(dataset=payload["dataset"]):
                token = InventoryImportScopeHead.objects.get(dataset=payload["dataset"]).state_token
                guarded, session = self.guarded(payload, token)
                imported = import_inventory_payload(guarded, "admin@example.test")
                query = self.query(payload, session)
                session.delete()
                before = InventoryImportAttempt.objects.count()
                result = read_recovery(query, "admin@example.test")
                self.assertEqual(result["status"], "committed_current")
                self.assertEqual(result["batch"]["id"], imported["batch"]["id"])
                self.assertEqual(read_recovery(query, "another@example.test")["status"], "unknown")
                query["rawFileHash"] = "e" * 64
                self.assertEqual(read_recovery(query, "admin@example.test")["status"], "unknown")
                self.assertEqual(InventoryImportAttempt.objects.count(), before, "read-only query never claims or imports")

    def test_stock_and_age_old_baselines_cannot_overwrite_new_content(self):
        for payload in (stock_payload(stock_row("P1", 2)), age_payload("华东仓")):
            with self.subTest(dataset=payload["dataset"]):
                token = InventoryImportScopeHead.objects.get(dataset=payload["dataset"]).state_token
                guarded, _ = self.guarded(payload, token)
                newer = copy.deepcopy(payload)
                newer["rows"][0]["productName"] = "新资料"
                newer["file"]["rawFileHash"] = "e" * 64
                current = import_inventory_payload(newer, "admin@example.test")
                with self.assertRaisesMessage(InventoryApiError, "原采集范围版本"):
                    import_inventory_payload(guarded, "admin@example.test")
                self.assertEqual(InventoryImportScopeHead.objects.get(dataset=payload["dataset"]).current_batch_id, current["batch"]["id"])
                self.assertEqual(InventoryImportBatch.objects.filter(dataset=payload["dataset"]).count(), 1)

    def test_stock_and_age_superseded_results_and_late_upload_owners_remain_fenced(self):
        for payload in (stock_payload(stock_row("P1", 2)), age_payload("华东仓")):
            with self.subTest(dataset=payload["dataset"]):
                token = InventoryImportScopeHead.objects.get(dataset=payload["dataset"]).state_token
                guarded, session = self.guarded(payload, token)
                original = import_inventory_payload(guarded, "admin@example.test")
                session.owner_generation = 2
                session.save(update_fields=["owner_generation"])
                with self.assertRaisesMessage(InventoryApiError, "所有权已变化"):
                    import_inventory_payload(guarded, "admin@example.test")
                newer = copy.deepcopy(payload)
                newer["rows"][0]["productName"] = "新资料"
                newer["file"]["rawFileHash"] = "e" * 64
                import_inventory_payload(newer, "admin@example.test")
                result = read_recovery(self.query(payload, session), "admin@example.test")
                self.assertEqual(result["status"], "committed_superseded")
                self.assertEqual(result["batch"]["id"], original["batch"]["id"])
