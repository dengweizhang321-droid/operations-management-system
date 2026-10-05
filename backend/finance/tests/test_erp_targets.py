import json
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.db import connection, transaction, DatabaseError
from finance.models import FinanceErpTarget, FinanceTarget, FinanceWriteAuthority
from sales.tests.factories import TEST_SECRET, signed_headers

@override_settings(DJANGO_PROCESS_ROLE="development")
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class ErpTargetApiTests(TestCase):
    def setUp(self):
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor: cursor.execute("SET CONSTRAINTS finance_source_revision_required DEFERRED")
        FinanceWriteAuthority.objects.filter(pk=1).update(status="postgres")
        self.payload = {"periodType": "month", "periodKey": "2026-10", "platform": "", "shopName": "", "salesTargetCents": 20000}

    def post(self, payload, request_id="target-1", role="admin"):
        url = "/api/finance/erp-targets"; body = json.dumps(payload, ensure_ascii=False)
        return self.client.post(url, data=body, content_type="application/json", headers=signed_headers(url, method="POST", body=body, request_id=request_id, role=role))

    def test_new_explicit_target_replay_and_fiscal_table_unchanged(self):
        first = self.post(self.payload)
        self.assertEqual(first.status_code, 201, first.content)
        replay = self.post(self.payload)
        self.assertEqual(replay.status_code, 201, replay.content)
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
        self.assertEqual(FinanceErpTarget.objects.count(), 1)
        self.assertEqual(FinanceTarget.objects.count(), 0)
        url = "/api/finance/erp-targets?year=2026&month=2026-10"
        read = self.client.get(url, headers=signed_headers(url, role="viewer"))
        self.assertEqual(read.status_code, 200, read.content)
        self.assertEqual(read.json()["items"][0]["basis"], "erp_net_sales")

    def test_reader_cannot_write(self):
        response = self.post(self.payload, role="viewer")
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(FinanceErpTarget.objects.count(), 0)

    def test_postgres_goal_source_write_requires_revision_in_same_transaction(self):
        if connection.vendor != "postgresql": self.skipTest("private PostgreSQL guard")
        row = self.post(self.payload).json()["item"]
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS finance_source_revision_required IMMEDIATE")
            cursor.execute("SET CONSTRAINTS finance_source_revision_required DEFERRED")
        try:
            with self.assertRaises(DatabaseError), transaction.atomic():
                FinanceErpTarget.objects.filter(id=row["id"]).update(sales_target_cents=999)
                with connection.cursor() as cursor: cursor.execute("SET CONSTRAINTS finance_source_revision_required IMMEDIATE")
        finally:
            with connection.cursor() as cursor: cursor.execute("SET CONSTRAINTS finance_source_revision_required DEFERRED")
        self.assertEqual(FinanceErpTarget.objects.get(id=row["id"]).sales_target_cents, 20000)

    def test_stale_version_and_identity_mutation_are_rejected(self):
        row = self.post(self.payload).json()["item"]
        updated = self.post({**self.payload, "id": row["id"], "expectedVersion": 1, "salesTargetCents": 30000}, "target-2")
        self.assertEqual(updated.status_code, 200, updated.content)
        stale = self.post({**self.payload, "id": row["id"], "expectedVersion": 1}, "target-3")
        self.assertEqual(stale.status_code, 409, stale.content)
        identity = self.post({**self.payload, "id": row["id"], "expectedVersion": 2, "periodKey": "2026-09"}, "target-4")
        self.assertEqual(identity.status_code, 409, identity.content)

    def test_missing_null_negative_duplicate_scope_are_not_zero(self):
        for index, payload in enumerate([{key: value for key, value in self.payload.items() if key != "salesTargetCents"}, {**self.payload, "salesTargetCents": None}, {**self.payload, "salesTargetCents": -1}, {**self.payload, "platform": "京东"}, {**self.payload, "expectedVersion": 1}]):
            response = self.post(payload, f"invalid-{index}")
            self.assertEqual(response.status_code, 400, response.content)
        self.post(self.payload)
        self.assertEqual(self.post(self.payload, "duplicate-identity").status_code, 409)
