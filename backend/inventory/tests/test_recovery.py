import copy
from datetime import timedelta
from urllib.parse import urlencode

from django.http import QueryDict
from django.test import TestCase
from django.utils import timezone
from django.db import transaction
from types import SimpleNamespace

from common.import_recovery import lock_upload_guard, reconcile

from inventory.errors import InventoryApiError
from inventory.import_service import import_inventory_payload
from inventory.models import InventoryImportAttempt, InventoryImportBatch, InventoryImportScopeHead, InventoryRawUploadSession
from inventory.recovery import read_recovery
from inventory.tests import test_imports as fixtures
from inventory.tests.test_imports import age_payload, stock_payload, stock_row
from inventory.uploads import release_upload


class InventoryRecoveryTests(TestCase):
    setUp = fixtures.InventoryImportTests.setUp

    def test_released_upload_rejects_old_claim(self):
        payload = stock_payload(stock_row("P1", 2))
        token = InventoryImportScopeHead.objects.get(dataset="stock").state_token
        guarded, session = self.guarded(payload, token)
        release_upload({"action": "release", "uploadId": str(session.id), "ownerToken": session.owner_token}, "admin@example.test")
        session.refresh_from_db()
        self.assertEqual(session.status, "ready")
        self.assertEqual(session.owner_token, "")
        self.assertEqual(read_recovery(self.query(payload, session), "admin@example.test")["uploadStatus"], "ready")
        with transaction.atomic(), self.assertRaisesMessage(ValueError, "所有权已变化"):
            lock_upload_guard(guarded["publicationGuard"], InventoryRawUploadSession, "admin@example.test", "inventory", payload["file"]["rawFileHash"])
        with self.assertRaisesMessage(InventoryApiError, "所有权已变化"):
            import_inventory_payload(guarded, "admin@example.test")
        self.assertEqual(InventoryImportBatch.objects.count(), 0)

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

    def test_completed_session_with_recorded_rejection_is_reported_as_rejected_upload(self):
        payload = stock_payload(stock_row("P1", 2))
        token = InventoryImportScopeHead.objects.get(dataset="stock").state_token
        _, session = self.guarded(payload, token)
        rejected = {"ok": False, "status": "rejected", "message": "库存数据质量门禁未通过，未写入任何库存数据",
                    "warnings": [], "errors": [{"code": "IMPLAUSIBLE_INVENTORY_QUANTITY", "message": "x"}], "errorCount": 1}
        InventoryRawUploadSession.objects.filter(id=session.id).update(status="completed", owner_token="", result_payload=rejected, result_batch_id="")
        result = read_recovery(self.query(payload, session), "admin@example.test")
        self.assertEqual((result["status"], result["uploadId"], result["uploadStatus"]), ("rejected_upload", str(session.id), "completed"))
        # Any attempt bound to this upload (whatever its outcome) withdraws the proof.
        InventoryImportAttempt.objects.create(id="f" * 32, dataset="stock", scope_json={"dataset": "stock", "snapshotDate": payload["snapshotDate"]},
            scope_key=InventoryImportScopeHead.objects.get(dataset="stock").scope_key, raw_file_hash=payload["file"]["rawFileHash"],
            outcome="rejected", actor_email="admin@example.test", completed_at=timezone.now(),
            metadata={"fileName": payload["file"]["name"], "fileSizeBytes": payload["file"]["sizeBytes"], "rawUploadId": str(session.id), "uploadFingerprint": session.fingerprint})
        self.assertEqual(read_recovery(self.query(payload, session), "admin@example.test")["status"], "unknown")
        self.assertEqual(InventoryImportBatch.objects.count(), 0)

    def test_rejected_upload_requires_an_explicit_owner_recorded_rejection(self):
        rejected = {"ok": False, "status": "rejected"}
        def session(**overrides):
            return SimpleNamespace(**{"id": "u1", "status": "completed", "result_batch_id": "", "result_payload": rejected, **overrides})
        def status(*, attempts=(), **overrides):
            return reconcile(attempts=list(attempts), sessions=[session(**overrides)], batch_reader=lambda _: None)["status"]
        self.assertEqual(status(), "rejected_upload")
        for overrides in ({"result_batch_id": "stock:abc"}, {"status": "failed"}, {"result_payload": {}},
                          {"result_payload": {"ok": True, "status": "imported"}}, {"result_payload": {"ok": False, "status": "error"}},
                          {"result_payload": {"ok": False, "status": "rejected", "batch": {"id": "stock:abc"}}},
                          {"result_payload": {"ok": "false", "status": "rejected"}}, {"result_payload": None}):
            with self.subTest(overrides=overrides):
                self.assertEqual(status(**overrides), "unknown")
        # Domains without result_batch_id (e.g. ERP reference sessions) never qualify.
        erp = SimpleNamespace(id="u1", status="completed", result_payload=rejected)
        self.assertEqual(reconcile(attempts=[], sessions=[erp], batch_reader=lambda _: None)["status"], "unknown")
        self.assertEqual(status(attempts=[SimpleNamespace(outcome="rejected", batch_id="")]), "unknown")
