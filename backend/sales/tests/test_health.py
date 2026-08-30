from __future__ import annotations

from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from erp_reference.models import ErpReferenceSyncCheckpoint
from sales.models import (
    ErpProductMaster,
    SalesCutoverAttestation,
    SalesDataRevision,
    SalesWriteAuthority,
)
from sales.tests.cutover_fixtures import install_lightweight_attestation


SALES_DIGEST = "c" * 64
ERP_DIGEST = "d" * 64
WRITER_EPOCH = "11111111-1111-4111-8111-111111111111"
WRITER_CUTOVER = "sales-cutover-20260828"


class HealthTests(TestCase):
    def _create_erp_product(self) -> None:
        ErpProductMaster.objects.create(
            product_code="P1",
            product_name="ERP readiness fixture",
            source_row_number=1,
            last_import_batch_id="products:baseline",
            created_at="2026-08-28 00:00:00",
            updated_at="2026-08-28 00:00:00",
        )

    def _create_revisions(
        self,
        *,
        sales_revision: int = 7,
        erp_revision: int = 3,
        sales_digest: str = SALES_DIGEST,
        erp_digest: str = ERP_DIGEST,
    ) -> None:
        SalesDataRevision.objects.bulk_create(
            [
                SalesDataRevision(
                    domain="sales", revision=sales_revision, source_digest=sales_digest
                ),
                SalesDataRevision(domain="erp", revision=erp_revision, source_digest=erp_digest),
            ]
        )
        if len(erp_digest) == 64:
            self._create_erp_product()
            ErpReferenceSyncCheckpoint.objects.create(
                id=1,
                source_epoch="a" * 32,
                source_path_digest="b" * 64,
                last_event_sequence=0,
                last_event_id="",
                erp_revision=erp_revision,
                content_hash=erp_digest,
                row_count=1,
                source_batch_id="products:baseline",
            )

    def test_liveness_does_not_require_database_state(self):
        response = self.client.get("/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "teruisi-django"})
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_reader_readiness_requires_initialized_revisions(self):
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        self._create_revisions()
        response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reader"], "ready")
        self.assertNotIn("projection", response.json())

    def test_readiness_rejects_zero_revision_and_malformed_digest(self):
        self._create_revisions(sales_revision=0, erp_digest="not-a-digest")
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    def test_readiness_rejects_empty_source_digest(self):
        self._create_revisions(sales_digest="", erp_digest="")
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    def test_readiness_rejects_missing_empty_or_stale_erp_checkpoint(self):
        SalesDataRevision.objects.bulk_create(
            [
                SalesDataRevision(domain="sales", revision=7, source_digest=SALES_DIGEST),
                SalesDataRevision(domain="erp", revision=3, source_digest=ERP_DIGEST),
            ]
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        ErpReferenceSyncCheckpoint.objects.create(
            id=1,
            source_epoch="a" * 32,
            source_path_digest="b" * 64,
            erp_revision=3,
            content_hash=ERP_DIGEST,
            row_count=0,
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        self._create_erp_product()
        ErpReferenceSyncCheckpoint.objects.filter(id=1).update(
            row_count=1,
            last_checked_at=timezone.now(),
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 200)
        ErpReferenceSyncCheckpoint.objects.filter(id=1).update(
            last_checked_at=timezone.now() - timedelta(seconds=61)
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    def test_readiness_rejects_checkpoint_revision_or_row_count_divergence(self):
        self._create_revisions()
        ErpReferenceSyncCheckpoint.objects.filter(id=1).update(erp_revision=4)
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        ErpReferenceSyncCheckpoint.objects.filter(id=1).update(
            erp_revision=3,
            row_count=2,
            last_checked_at=timezone.now(),
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    @override_settings(DJANGO_EXPECT_READ_ONLY=True)
    def test_readiness_fails_when_online_connection_is_writable(self):
        self._create_revisions()
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    @override_settings(
        DJANGO_PROCESS_ROLE="sales_writer",
        DJANGO_EXPECT_READ_ONLY=False,
        DJANGO_ENVIRONMENT="test",
        SALES_WRITE_AUTHORITY_EPOCH=WRITER_EPOCH,
        SALES_WRITE_CUTOVER_ID=WRITER_CUTOVER,
    )
    def test_writer_readiness_uses_authority(self):
        self._create_revisions()
        install_lightweight_attestation(WRITER_CUTOVER)
        SalesWriteAuthority.objects.filter(id=1).update(
            status="active",
            authority_epoch=WRITER_EPOCH,
            cutover_id=WRITER_CUTOVER,
        )
        response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["writer"], "ready")
        self.assertNotIn("projection", response.json())

        SalesWriteAuthority.objects.filter(id=1).update(
            authority_epoch="22222222-2222-4222-8222-222222222222"
        )
        response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "sales_writer_unavailable")

    @override_settings(
        DJANGO_PROCESS_ROLE="sales_writer",
        DJANGO_EXPECT_READ_ONLY=False,
        DJANGO_ENVIRONMENT="test",
        SALES_WRITE_AUTHORITY_EPOCH=WRITER_EPOCH,
        SALES_WRITE_CUTOVER_ID=WRITER_CUTOVER,
        ERP_REFERENCE_SYNC_MAX_AGE_SECONDS=60,
    )
    def test_writer_readiness_fails_closed_without_fresh_erp_bridge_state(self):
        install_lightweight_attestation(WRITER_CUTOVER)
        SalesWriteAuthority.objects.filter(id=1).update(
            status="active",
            authority_epoch=WRITER_EPOCH,
            cutover_id=WRITER_CUTOVER,
        )
        SalesDataRevision.objects.bulk_create(
            [
                SalesDataRevision(domain="sales", revision=7, source_digest=SALES_DIGEST),
                SalesDataRevision(domain="erp", revision=3, source_digest=ERP_DIGEST),
            ]
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

        checkpoint = ErpReferenceSyncCheckpoint.objects.create(
            id=1,
            source_epoch="a" * 32,
            source_path_digest="b" * 64,
            erp_revision=3,
            content_hash=ERP_DIGEST,
            row_count=0,
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        self._create_erp_product()
        ErpReferenceSyncCheckpoint.objects.filter(id=checkpoint.id).update(
            row_count=1,
            last_checked_at=timezone.now(),
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 200)

        ErpReferenceSyncCheckpoint.objects.filter(id=checkpoint.id).update(
            last_checked_at=timezone.now() - timedelta(seconds=61)
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    @override_settings(
        DJANGO_PROCESS_ROLE="sales_writer",
        DJANGO_EXPECT_READ_ONLY=False,
        DJANGO_ENVIRONMENT="test",
        SALES_WRITE_AUTHORITY_EPOCH=WRITER_EPOCH,
        SALES_WRITE_CUTOVER_ID=WRITER_CUTOVER,
    )
    def test_writer_readiness_fails_closed_on_erp_revision_digest_or_count_divergence(self):
        self._create_revisions()
        install_lightweight_attestation(WRITER_CUTOVER)
        SalesWriteAuthority.objects.filter(id=1).update(
            status="active",
            authority_epoch=WRITER_EPOCH,
            cutover_id=WRITER_CUTOVER,
        )
        checkpoint = ErpReferenceSyncCheckpoint.objects.get(id=1)

        checkpoint.erp_revision = 4
        checkpoint.save(update_fields=["erp_revision", "last_checked_at"])
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

        checkpoint.erp_revision = 3
        checkpoint.content_hash = "e" * 64
        checkpoint.save(update_fields=["erp_revision", "content_hash", "last_checked_at"])
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

        checkpoint.content_hash = ERP_DIGEST
        checkpoint.row_count = 2
        checkpoint.save(update_fields=["content_hash", "row_count", "last_checked_at"])
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    @override_settings(
        DJANGO_PROCESS_ROLE="sales_writer",
        DJANGO_EXPECT_READ_ONLY=False,
        DJANGO_ENVIRONMENT="test",
        SALES_WRITE_AUTHORITY_EPOCH=WRITER_EPOCH,
        SALES_WRITE_CUTOVER_ID=WRITER_CUTOVER,
    )
    def test_writer_readiness_fails_closed_while_authority_is_pending(self):
        response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "sales_writer_unavailable")

    @override_settings(
        DJANGO_PROCESS_ROLE="sales_writer",
        DJANGO_EXPECT_READ_ONLY=False,
        DJANGO_ENVIRONMENT="test",
        SALES_WRITE_AUTHORITY_EPOCH=WRITER_EPOCH,
        SALES_WRITE_CUTOVER_ID=WRITER_CUTOVER,
    )
    def test_writer_readiness_requires_an_untampered_v2_attestation(self):
        self._create_revisions()
        SalesWriteAuthority.objects.filter(id=1).update(
            status="active", authority_epoch=WRITER_EPOCH, cutover_id=WRITER_CUTOVER
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        attestation = install_lightweight_attestation(WRITER_CUTOVER)
        self.assertEqual(self.client.get("/health/ready").status_code, 200)
        payload = dict(attestation.payload)
        payload["d1Blockers"] = dict(payload["d1Blockers"])
        del payload["d1Blockers"]["uploadChunks"]
        SalesCutoverAttestation.objects.filter(cutover_id=WRITER_CUTOVER).update(
            payload=payload
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    def test_non_loopback_peer_is_rejected(self):
        response = self.client.get("/health/live", REMOTE_ADDR="192.0.2.10")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "loopback_only")
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_forwarded_address_is_ignored_but_invalid_host_is_rejected(self):
        response = self.client.get(
            "/health/live",
            REMOTE_ADDR="127.0.0.1",
            HTTP_X_FORWARDED_FOR="192.0.2.10",
        )
        self.assertEqual(response.status_code, 200)
        response = self.client.get(
            "/health/live", REMOTE_ADDR="127.0.0.1", HTTP_HOST="attacker.example"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_host")

    @override_settings(DJANGO_MAX_HEADER_BYTES=128)
    def test_oversized_headers_are_rejected_before_the_view(self):
        response = self.client.get("/health/live", HTTP_X_FILLER="x" * 256)
        self.assertEqual(response.status_code, 431)
        self.assertEqual(response.json()["code"], "request_headers_too_large")

    @override_settings(DJANGO_MAX_BODY_BYTES=16)
    def test_oversized_body_is_rejected_before_the_view(self):
        response = self.client.generic(
            "GET", "/health/live", data=b"", CONTENT_LENGTH="17"
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["code"], "request_body_too_large")
