"""Business-level smoke probe for inventory: proves the real stock-line read
path (filtered aggregate against the latest published snapshot) executes end
to end, which the schema/privilege readiness checks never exercise.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.utils import timezone

from inventory.import_service import import_inventory_payload
from inventory.models import InventoryWriteAuthority
from inventory.tests.test_imports import stock_payload, stock_row
from teruisi_backend import health


class InventoryBusinessSmokeTests(TestCase):
    def setUp(self) -> None:
        InventoryWriteAuthority.objects.filter(id=1).update(
            status="postgres",
            authority_epoch=uuid.UUID("11111111-1111-4111-8111-111111111111"),
            cutover_id="inventory-business-smoke-test",
            migration_verify_run_id="inventory-apply-" + "1" * 32,
            activated_at=timezone.now(),
        )

    def test_passes_as_a_no_op_with_no_completed_batch(self) -> None:
        # A fresh environment has no completed stock batch yet. That is not a
        # broken connection to any business data, so the probe must not block
        # an otherwise-healthy deployment waiting on its first import.
        with connection.cursor() as cursor:
            health._validate_inventory_business_smoke(cursor)

    def test_passes_against_a_real_imported_snapshot(self) -> None:
        import_inventory_payload(
            stock_payload(stock_row("P1", 1), stock_row("P2", 2)),
            "admin@example.test",
        )
        with connection.cursor() as cursor:
            health._validate_inventory_business_smoke(cursor)

    def test_fails_when_the_query_raises(self) -> None:
        import_inventory_payload(
            stock_payload(stock_row("P1", 1)), "admin@example.test",
        )
        with patch(
            "inventory.models.InventoryStockLine.objects.filter",
            side_effect=RuntimeError("boom"),
        ):
            with connection.cursor() as cursor:
                with self.assertRaises(health.ReadinessError) as caught:
                    health._validate_inventory_business_smoke(cursor)
        self.assertEqual(caught.exception.code, "inventory_business_smoke_query_failed")
