from datetime import timedelta
from urllib.parse import urlencode

from django.http import QueryDict
from django.test import TestCase, override_settings
from django.utils import timezone

from sales.models import SalesImportAttempt, SalesImportBatch, SalesImportScopeHead, SalesOrderLine, SalesRawUploadSession, SalesStagedImportSession
from sales.recovery import read_recovery
from sales.tests import test_write_service as fixtures
from sales.tests.test_write_service import AUTHORITY_EPOCH, CUTOVER_ID, normalized_row
from sales.write_service import SalesImportServiceError, complete_staged_import


@override_settings(DJANGO_PROCESS_ROLE="sales_writer", DJANGO_EXPECT_READ_ONLY=False,
                   SALES_WRITE_AUTHORITY_EPOCH=AUTHORITY_EPOCH, SALES_WRITE_CUTOVER_ID=CUTOVER_ID)
class SalesRecoveryTests(TestCase):
    setUp = fixtures.SalesWriteServiceTests.setUp
    _begin_stage = fixtures.SalesWriteServiceTests._begin_stage

    def guarded(self, token, label="old"):
        raw_hash = "a" * 64
        stage_id = self._begin_stage([normalized_row(1)], fingerprint=label, raw_hash=raw_hash)
        stage = SalesStagedImportSession.objects.get(id=stage_id)
        raw = SalesRawUploadSession.objects.create(actor_email=stage.actor_email,
            client_fingerprint=f'jky-recovery-v1:n8n-export-first-8548:sales:{raw_hash}:{token}',
            file_name=stage.file_name, file_size_bytes=stage.file_size_bytes, chunk_size_bytes=1048576, chunk_count=1,
            expected_start_date=stage.expected_start_date, expected_end_date=stage.expected_end_date, expected_channels=None,
            status="processing", owner_token="a" * 43, owner_generation=1, expires_at=timezone.now() + timedelta(hours=1))
        stage.raw_upload = raw
        stage.raw_upload_owner_token = raw.owner_token
        stage.raw_upload_owner_generation = 1
        stage.save(update_fields=["raw_upload", "raw_upload_owner_token", "raw_upload_owner_generation"])
        return stage, raw

    def query(self, stage, raw):
        return QueryDict(urlencode({"recovery": "result", "startDate": "2024-01-01", "endDate": "2024-01-02", "channels": "null",
            "rawFileHash": "a" * 64, "fileName": stage.file_name, "fileSizeBytes": stage.file_size_bytes,
            "fingerprint": raw.client_fingerprint, "uploadId": str(raw.id)}), mutable=True)

    def test_old_collection_baseline_fails_inside_actual_publication_and_preserves_new_rows(self):
        token = SalesImportScopeHead.objects.first().state_token if SalesImportScopeHead.objects.exists() else "initial"
        old, _ = self.guarded(token)
        newer = self._begin_stage([normalized_row(1, allocatedAmountCents=6500)], fingerprint="newer", raw_hash="b" * 64)
        current = complete_staged_import(newer, "admin@example.test")
        with self.assertRaisesMessage(SalesImportServiceError, "原采集范围版本"):
            complete_staged_import(str(old.id), "admin@example.test")
        self.assertEqual(SalesImportBatch.objects.count(), 1)
        self.assertEqual(SalesOrderLine.objects.get().last_import_batch_id, current["batch"]["id"])

    def test_persistent_result_query_is_exact_read_only_and_reports_supersession(self):
        token = SalesImportScopeHead.objects.first().state_token if SalesImportScopeHead.objects.exists() else "initial"
        stage, raw = self.guarded(token)
        published = complete_staged_import(str(stage.id), "admin@example.test")
        query = self.query(stage, raw)
        before = SalesImportAttempt.objects.count()
        self.assertEqual(read_recovery(query, "admin@example.test")["status"], "committed_current")
        self.assertEqual(read_recovery(query, "another@example.test")["status"], "unknown")
        query["rawFileHash"] = "e" * 64
        self.assertEqual(read_recovery(query, "admin@example.test")["status"], "unknown")
        query["rawFileHash"] = "a" * 64
        self.assertEqual(SalesImportAttempt.objects.count(), before)
        raw.status = "expired"
        raw.expires_at = timezone.now() - timedelta(hours=1)
        raw.save(update_fields=["status", "expires_at"])
        self.assertEqual(read_recovery(query, "admin@example.test")["status"], "committed_current")
        newer = self._begin_stage([normalized_row(1, allocatedAmountCents=6500)], fingerprint="newer", raw_hash="b" * 64)
        complete_staged_import(newer, "admin@example.test")
        result = read_recovery(query, "admin@example.test")
        self.assertEqual(result["status"], "committed_superseded")
        self.assertEqual(result["batch"]["id"], published["batch"]["id"])

    def test_late_raw_owner_is_rejected_even_when_content_matches_current(self):
        token = SalesImportScopeHead.objects.first().state_token if SalesImportScopeHead.objects.exists() else "initial"
        stage, raw = self.guarded(token)
        current = self._begin_stage([normalized_row(1)], fingerprint="current", raw_hash="b" * 64)
        complete_staged_import(current, "admin@example.test")
        raw.owner_generation = 2
        raw.save(update_fields=["owner_generation"])
        with self.assertRaisesMessage(SalesImportServiceError, "其他 owner 接管"):
            complete_staged_import(str(stage.id), "admin@example.test")
        self.assertEqual(SalesImportBatch.objects.count(), 1)
