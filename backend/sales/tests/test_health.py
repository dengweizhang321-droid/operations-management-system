from __future__ import annotations

from django.db import connection
from django.test import TestCase, override_settings

from sales.models import SalesDataRevision


EPOCH = "a" * 32
PATH_DIGEST = "b" * 64
SALES_DIGEST = "c" * 64
ERP_DIGEST = "d" * 64


class HealthTests(TestCase):
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

    def _create_checkpoint(
        self,
        *,
        sales_revision: int = 7,
        erp_revision: int = 3,
        sequence: int = 0,
        event_id: str = "",
        checked_at: str | None = None,
    ) -> None:
        checked_expression = "CURRENT_TIMESTAMP" if checked_at is None else "%s"
        parameters: list[object] = [
            EPOCH,
            PATH_DIGEST,
            sequence,
            event_id,
            sales_revision,
            erp_revision,
        ]
        if checked_at is not None:
            parameters.append(checked_at)
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO sales_projection_sync_checkpoint ("
                "id, source_epoch, source_path_digest, last_event_sequence, last_event_id, "
                "sales_revision, erp_revision, created_at, updated_at, last_checked_at"
                f") VALUES (1, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, "
                f"CURRENT_TIMESTAMP, {checked_expression})",
                parameters,
            )

    def _create_ready_projection(self) -> None:
        self._create_revisions()
        self._create_checkpoint()

    def test_liveness_does_not_require_database_projection(self):
        response = self.client.get("/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "teruisi-django"})
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_readiness_requires_revision_and_initialized_checkpoint(self):
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        self._create_revisions()
        self.assertEqual(self.client.get("/health/ready").status_code, 503)
        self._create_checkpoint()
        response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["projection"], "ready")

    def test_readiness_rejects_zero_revision_and_malformed_digest(self):
        self._create_revisions(sales_revision=0, erp_digest="not-a-digest")
        self._create_checkpoint()
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    def test_readiness_accepts_empty_incremental_digest_when_checkpoint_matches(self):
        self._create_revisions(sales_digest="", erp_digest="")
        self._create_checkpoint(
            sequence=4,
            event_id=f"{EPOCH}:sales:batch-4",
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 200)

    def test_readiness_rejects_checkpoint_revision_or_event_identity_mismatch(self):
        self._create_revisions()
        self._create_checkpoint(
            sales_revision=6,
            sequence=4,
            event_id=f"{EPOCH}:unknown:batch-4",
        )
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    @override_settings(PROJECTION_SYNC_MAX_AGE_SECONDS=60)
    def test_readiness_rejects_stale_sync_heartbeat(self):
        self._create_revisions()
        self._create_checkpoint(checked_at="2000-01-01T00:00:00+00:00")
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    @override_settings(DJANGO_EXPECT_READ_ONLY=True)
    def test_readiness_fails_when_online_connection_is_writable(self):
        self._create_ready_projection()
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
