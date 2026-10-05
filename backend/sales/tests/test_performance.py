"""Actual DB negative cases for reusable calculations and progressive contracts."""
import json
import uuid
from unittest.mock import patch

from django.core.cache import cache
from django.db import connection, transaction
from django.test import TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from sales import calculation_cache as calculations
from sales.auth import Principal
from sales.models import SalesDataRevision, SalesOrderLine
from sales.tests.factories import TEST_SECRET, install_fixture, signed_headers
from sales import consumers


@override_settings(SALES_READ_CACHE_SECONDS=30)
class SalesPerformanceTests(TransactionTestCase):
    def setUp(self):
        calculations.clear()
        cache.clear()
        install_fixture()
        self.actor = Principal("one@example.test", "One", "admin", None)
        self.base = "/api/sales/summary?range=custom&startDate=2026-08-01&endDate=2026-08-02"

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_core_matches_full_and_expected_revision_fails_closed(self):
        core_url = self.base + "&view=core"
        core = self.client.get(core_url, headers=signed_headers(core_url))
        self.assertEqual(core.status_code, 200, core.content)
        full = self.client.get(self.base, headers=signed_headers(self.base))
        self.assertEqual(full.status_code, 200)
        for key in ["current", "previous", "yearAgo", "startDate", "endDate", "dataCutoffDate"]:
            self.assertEqual(core.json()[key], full.json()[key])
        self.assertEqual(core.json()["channels"], [])
        fixed = self.base + "&expectedRevision=" + core["X-Sales-Data-Revision"]
        self.assertEqual(self.client.get(fixed, headers=signed_headers(fixed)).status_code, 200)
        SalesDataRevision.objects.filter(domain="sales").update(revision=8)
        with CaptureQueriesContext(connection) as captured:
            changed = self.client.get(fixed, headers=signed_headers(fixed))
        self.assertEqual(changed.status_code, 409)
        self.assertFalse(any("SUM(" in row["sql"].upper() for row in captured))
        restricted = self.client.get(core_url, headers=signed_headers(core_url, scope={"platforms": ["京东"], "channels": [], "warehouses": []}))
        self.assertEqual(restricted.status_code, 403)

    def test_calculation_context_scope_actor_authority_and_revision(self):
        calls = []
        def loader():
            calls.append(True)
            return {"rows": [SalesOrderLine.objects.count()]}
        first = calculations.reuse("test", {"date": "2026-08-01"}, self.actor, loader)
        first["rows"].append(999)
        self.assertEqual(calculations.reuse("test", {"date": "2026-08-01"}, self.actor, loader), {"rows": [5]})
        self.assertEqual(len(calls), 1)
        calculations.reuse("test", {"date": "2026-08-02"}, self.actor, loader)
        calculations.reuse("test", {"date": "2026-08-01"}, Principal("two@example.test", "Two", "admin", None), loader)
        calculations.reuse("test", {"date": "2026-08-01"}, Principal(self.actor.email, "One", "viewer", None), loader)
        SalesDataRevision.objects.filter(domain="erp").update(revision=4)
        calculations.reuse("test", {"date": "2026-08-01"}, self.actor, loader)
        with override_settings(SALES_WRITE_AUTHORITY_EPOCH="synthetic-new-authority"):
            calculations.reuse("test", {"date": "2026-08-01"}, self.actor, loader)
        self.assertEqual(len(calls), 6)

    def test_http_hit_rechecks_dynamic_identity_after_get(self):
        from sales.views import _consistent_read
        calls = []
        def load(): calls.append(True); return {"value": len(calls)}
        identity = lambda: json.dumps(calculations.context_identity(self.actor), default=str, sort_keys=True)
        _consistent_read(load, identity)
        original_get = cache.get
        changed = False
        def get_and_change(key):
            nonlocal changed
            value = original_get(key)
            if not changed and value is not None:
                changed = True
                from erp_reference.models import ErpReferenceWriteAuthority
                ErpReferenceWriteAuthority.objects.update_or_create(id=1, defaults={"status": "postgres",
                    "authority_epoch": uuid.uuid4(), "cutover_id": "changed-synthetic-epoch",
                    "migration_verify_run_id": "erp-reference-" + "a"*32, "activated_at": timezone.now()})
            return value
        with patch.object(cache, "get", side_effect=get_and_change):
            value, _, status = _consistent_read(load, identity)
        self.assertEqual(status, "miss")
        self.assertEqual(value, {"value": 2})

    def test_database_identity_and_transaction_bypass_do_not_publish_rollback(self):
        original = connection.settings_dict["USER"]
        first = calculations.context_identity(self.actor)
        connection.settings_dict["USER"] = "different-synthetic-role"
        try:
            self.assertNotEqual(first, calculations.context_identity(self.actor))
        finally:
            connection.settings_dict["USER"] = original
        def load(): return SalesOrderLine.objects.count()
        self.assertEqual(calculations.reuse("test", {}, self.actor, load), 5)
        with transaction.atomic():
            SalesOrderLine.objects.filter(id=1).delete()
            self.assertEqual(calculations.reuse("test", {}, self.actor, load), 4)
            transaction.set_rollback(True)
        self.assertEqual(calculations.reuse("test", {}, self.actor, load), 5)

    def test_size_count_ttl_and_changing_revision(self):
        with patch.object(calculations, "MAX_ENTRIES", 2), patch.object(calculations, "MAX_BYTES", 1000), patch.object(calculations, "MAX_ENTRY_BYTES", 1000):
            for i in range(6): calculations.reuse("test", {"i": i}, self.actor, lambda: {"value": "x"*40})
            self.assertLessEqual(len(calculations._entries), 2)
            self.assertLessEqual(calculations._bytes, 1000)
            calculations.reuse("large", {}, self.actor, lambda: "x"*2000)
            self.assertLessEqual(len(calculations._entries), 2)
        calculations.clear()
        def changing():
            SalesDataRevision.objects.filter(domain="sales").update(revision=8)
            return {"value": 1}
        calculations.reuse("changing", {}, self.actor, changing)
        self.assertEqual(len(calculations._entries), 0)
        calls = []
        with patch.object(calculations.time, "monotonic", return_value=1):
            calculations.reuse("ttl", {}, self.actor, lambda: calls.append(1))
        with patch.object(calculations.time, "monotonic", return_value=32):
            calculations.reuse("ttl", {}, self.actor, lambda: calls.append(2))
        self.assertEqual(calls, [1, 2])

    def test_summary_consumer_discards_no_contract_fields_and_skips_metadata(self):
        request = consumers.validate_consumer_request({"operation": "summary", "range": "custom",
            "startDate": "2026-08-01", "endDate": "2026-08-03", "productQueries": [], "platforms": [], "outlets": [], "categories": []})
        with patch("sales.summary._filter_options", side_effect=AssertionError("discarded facets")), patch("sales.summary.latest_batch_payload", side_effect=AssertionError("discarded batch")):
            value = consumers.execute_consumer_query(self.actor, request)
        self.assertEqual(value["current"]["netSalesCents"], 14000)
        self.assertNotIn("filterOptions", value)
        self.assertNotIn("latestBatch", value)
