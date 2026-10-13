import copy
import uuid
from datetime import timedelta
from urllib.parse import urlencode
from unittest.mock import patch
from django.http import QueryDict
from django.test import TestCase
from django.utils import timezone
from common.import_recovery import assert_scope_baseline, fingerprint_baseline
from erp_reference.errors import ErpReferenceApiError
from erp_reference.import_service import import_payload, SOURCE_SCOPE_KEYS
from erp_reference.models import ErpReferenceImportScopeHead, ErpReferenceImportBatch, ErpReferenceImportAttempt, ErpReferenceRawUploadSession, ErpReferenceWriteAuthority, ErpProductMaster
from erp_reference.recovery import read_recovery
from erp_reference.tests.test_api import product_payload
from sales.models import SalesDataRevision
from sales.tests.factories import TEST_SECRET, signed_headers


class ImportRecoveryTests(TestCase):
    def setUp(self):
        SalesDataRevision.objects.update_or_create(domain="erp", defaults={"revision": 0, "source_digest": "0" * 64})
        ErpReferenceWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(),
            cutover_id="fixture", migration_verify_run_id="fixture", activated_at=timezone.now())

    def guarded(self, payload, token, owner="a" * 43):
        head = ErpReferenceImportScopeHead.objects.get(scope_key=SOURCE_SCOPE_KEYS["products"])
        session = ErpReferenceRawUploadSession.objects.create(actor_email="admin@example.test", source_key="products",
            fingerprint=f'erp:products:jky-recovery-v1:n8n-export-first-8548:products:{payload["rawFileHash"]}:{token}',
            file_name=payload["fileName"], file_size_bytes=payload["fileSizeBytes"], chunk_size_bytes=1048576, chunk_count=1,
            status="processing", owner_token=owner, owner_generation=1, expires_at=timezone.now() + timedelta(hours=1))
        result = copy.deepcopy(payload)
        result["publicationGuard"] = {"uploadId": str(session.id), "ownerToken": owner, "ownerGeneration": 1}
        return result, session, head

    def test_changed_baseline_rejects_old_content_inside_actual_publication_transaction(self):
        old = product_payload()
        baseline = ErpReferenceImportScopeHead.objects.get(scope_key=SOURCE_SCOPE_KEYS["products"]).state_token
        guarded, _, _ = self.guarded(old, baseline)
        newer = product_payload(raw_seed="newer")
        newer["rows"][0]["productName"] = "新资料"
        new = import_payload(newer, "admin@example.test")
        with self.assertRaisesMessage(ErpReferenceApiError, "原采集范围版本"):
            import_payload(guarded, "admin@example.test")
        self.assertEqual(ErpProductMaster.objects.get(product_code="P1").product_name, "新资料")
        self.assertEqual(ErpReferenceImportBatch.objects.count(), 1)
        self.assertEqual(ErpReferenceImportScopeHead.objects.get(scope_key=SOURCE_SCOPE_KEYS["products"]).current_batch_id, new["batch"]["id"])

    def test_same_content_reuses_current_batch_even_when_original_baseline_changed(self):
        payload = product_payload()
        token = ErpReferenceImportScopeHead.objects.get(scope_key=SOURCE_SCOPE_KEYS["products"]).state_token
        guarded, _, _ = self.guarded(payload, token)
        current = import_payload(payload, "admin@example.test")
        replay = import_payload(guarded, "admin@example.test")
        self.assertEqual(replay["status"], "duplicate")
        self.assertEqual(replay["batch"]["id"], current["batch"]["id"])
        self.assertEqual(ErpReferenceImportBatch.objects.count(), 1)

    def test_former_upload_owner_cannot_publish_even_identical_content(self):
        payload = product_payload()
        token = ErpReferenceImportScopeHead.objects.get(scope_key=SOURCE_SCOPE_KEYS["products"]).state_token
        guarded, session, _ = self.guarded(payload, token)
        import_payload(payload, "admin@example.test")
        session.owner_generation = 2
        session.owner_token = "b" * 43
        session.save()
        with self.assertRaisesMessage(ErpReferenceApiError, "所有权已变化"):
            import_payload(guarded, "admin@example.test")
        self.assertEqual(ErpReferenceImportBatch.objects.count(), 1)

    def query(self, payload):
        return QueryDict(urlencode({"recovery": "result", "source": "products", "rawFileHash": payload["rawFileHash"],
            "fileName": payload["fileName"], "fileSizeBytes": payload["fileSizeBytes"], "fingerprint": "exact-missing-session"}))

    def test_expired_or_missing_upload_still_checks_persistent_audit_and_current_ownership(self):
        payload = product_payload()
        imported = import_payload(payload, "admin@example.test")
        before = ErpReferenceImportAttempt.objects.count()
        result = read_recovery(self.query(payload), "admin@example.test")
        self.assertEqual(result["status"], "committed_current")
        self.assertEqual(result["batch"]["id"], imported["batch"]["id"])
        newer = product_payload(raw_seed="newer")
        newer["rows"][0]["productName"] = "新资料"
        import_payload(newer, "admin@example.test")
        self.assertEqual(read_recovery(self.query(payload), "admin@example.test")["status"], "committed_superseded")
        self.assertEqual(read_recovery(self.query(payload), "another@example.test")["status"], "unknown")
        self.assertEqual(ErpReferenceImportAttempt.objects.count(), before + 1)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_actual_signed_reader_requires_admin_and_rejects_repeated_or_wrong_scope(self):
        url = "/api/erp-reference/imports/recovery?recovery=scope&source=products"
        response = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["version"], "import-recovery-query-v1")
        response = self.client.get(url, headers=signed_headers(url, role="operator"))
        self.assertEqual(response.status_code, 403)
        for suffix in ["&source=combos", "&actor=admin", "&rawFileHash=" + "1" * 64]:
            target = url + suffix
            self.assertEqual(self.client.get(target, headers=signed_headers(target)).status_code, 400)

    def test_guard_parser_rejects_wrong_file_and_preserves_legacy_contract(self):
        self.assertIsNone(fingerprint_baseline("legacy", "products", "1" * 64))
        with self.assertRaises(ValueError):
            fingerprint_baseline("jky-recovery-v1:run:products:" + "1" * 64 + ":" + "2" * 64, "combos", "1" * 64)
        with self.assertRaises(ValueError):
            assert_scope_baseline("1" * 64, "2" * 64)
