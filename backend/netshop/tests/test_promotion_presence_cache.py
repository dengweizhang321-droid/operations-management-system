"""Actual PG cache/fallback expressions, publishing, and exact snapshot CAS."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch
from unittest import skipUnless
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, close_old_connections, connection, transaction
from django.db.models import BooleanField, Count, Exists, F, JSONField, OuterRef, Subquery, Sum, Value
from django.db.models.expressions import RawSQL
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from netshop.import_service import _bump_global_revision, import_netshop_payload
from netshop.management.commands.backfill_netshop_promotion_presence import apply_snapshot, decode_snapshot, run_batch
from netshop.models import (NetshopDataRevision, NetshopImportBatch, NetshopRow,
                           NetshopWriteAuthority, NetshopPromotionAggregateManifest)
from netshop.promotion_presence import ALIASES, FIELDS, RULE, cache_values
from netshop.store_overview import NumericMetricPresent, aggregate, PROMOTION
from .factories import netshop_row, prepared_payload


@skipUnless(connection.vendor == "postgresql", "Requires actual PostgreSQL")
class PromotionPresenceCacheTests(TestCase):
    def setUp(self):
        self.counter = 0
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(
            revision=F("revision") + 1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def row(self, metrics, *, source="jd_promotion", dataset="ad", shop="gold", cached=True):
        self.counter += 1
        row_hash, batch = "e" * 64, "batch-" + str(self.counter)
        return NetshopRow.objects.create(
            source_row_key=str(self.counter), source_row_hash=row_hash,
            first_import_batch_id=batch, last_import_batch_id=batch, source_row_number=self.counter,
            source=source, dataset=dataset, platform="京东", shop_name=shop,
            business_date="2026-09-01", metrics_json=Value(None, JSONField()) if metrics is None else metrics,
            spend_cents=17, net_transaction_amount_cents=-17,
            **(cache_values(source, dataset, metrics, row_hash, batch) if cached else {}))

    def original(self, names):
        column = '"netshop_rows"."metrics_json"'
        return RawSQL("jsonb_typeof(COALESCE(" + ",".join(column + " -> %s" for _ in names) + "))='number'",
                      list(names), output_field=BooleanField())

    def compare(self, names, queryset=None):
        qs = queryset if queryset is not None else NetshopRow.objects.all()
        direct = list(qs.annotate(old=self.original(names), new=NumericMetricPresent(names)).values_list("old", "new"))
        self.assertTrue(direct)
        self.assertTrue(all(old is new for old, new in direct), direct)
        result = qs.aggregate(oc=Count("id", filter=self.original(names)), nc=Count("id", filter=NumericMetricPresent(names)),
                              os=Sum("spend_cents", filter=self.original(names)), ns=Sum("spend_cents", filter=NumericMetricPresent(names)))
        self.assertEqual(result["oc"], result["nc"])
        self.assertEqual(result["os"], result["ns"])

    def test_eighteen_gold_full_tristate_and_unknown_three_alias_fallback(self):
        cases = [None, [1], "text", True, 3, {}, {"花费": 0},
                 {"spendCents": None, "花费": 4}, {"spendCents": "4", "花费": 4},
                 {"spendCents": {}, "花费": 4}, {"spendCents": False, "花费": 4},
                 {"spendCents": [4], "花费": 4}, [{"spendCents": 4}],
                 {"spendCents": 0}, {"spendCents": -9}, {"花费": None, "legacy": 7},
                 {"legacy": 0}, {"spendCents": 1.25}]
        for i, metrics in enumerate(cases):
            self.row(metrics, shop="shop" + str(i % 2))
        for names in [*ALIASES, (*ALIASES[0], "legacy")]:
            self.compare(names)
        # NOT must retain SQL NULL rather than converting absence to FALSE.
        names = ALIASES[0]
        rows = list(NetshopRow.objects.annotate(o=~self.original(names), n=~NumericMetricPresent(names)).values_list("o", "n"))
        self.assertTrue(all(old is new for old, new in rows))

    def test_unknown_utf8_keys_noncol_expression_and_sql_null_fallback(self):
        names = ('汉字"\'\\key', 'alias\\"two', 'x) || true')
        self.row({names[2]: 0})
        self.row({names[0]: [], names[2]: 0})
        self.compare(names)
        predicate = NumericMetricPresent(ALIASES[0])
        predicate.set_source_expressions([RawSQL("NULL::jsonb", [], output_field=JSONField())])
        self.assertEqual(list(NetshopRow.objects.annotate(p=predicate).values_list("p", flat=True)), [None, None])

    def test_invalid_rule_basis_masks_unknown_source_dataset_all_fallback(self):
        row = self.row({"spendCents": None, "花费": 9})
        original = cache_values(row.source, row.dataset, {"spendCents": None, "花费": 9}, row.source_row_hash, row.last_import_batch_id)
        changes = [
            {"numeric_presence_rule": "wrong"}, {"numeric_presence_row_hash": "f" * 64},
            {"numeric_presence_batch_id": "batch-1 "}, {"numeric_presence_mask": None},
            {"numeric_presence_null_mask": None}, {"numeric_presence_mask": -1},
            {"numeric_presence_mask": 32}, {"numeric_presence_null_mask": 32},
            {"numeric_presence_mask": 1, "numeric_presence_null_mask": 1},
        ]
        for change in changes:
            NetshopRow.objects.filter(pk=row.pk).update(**{**original, **change})
            self.compare(ALIASES[0])
        for source, dataset in [("tmall_promotion", "promotion_daily"), ("jd_promotion", "other")]:
            other = self.row({"spendCents": None, "花费": 9}, source=source, dataset=dataset)
            # Deliberately corrupt stamps; source gate must reject them.
            NetshopRow.objects.filter(pk=other.pk).update(**{**original, "numeric_presence_mask": 1, "numeric_presence_null_mask": 0,
                                                           "numeric_presence_batch_id": other.last_import_batch_id})
            self.compare(ALIASES[0], NetshopRow.objects.filter(pk=other.pk))

    def test_real_grouped_aggregate_projection_subquery_and_owner_exists(self):
        self.row({"花费": 0, "总订单金额": -9}, shop="A")
        self.row({}, shop="A")
        self.row({"spendCents": None, "花费": 9}, shop="B")
        self.assertEqual(aggregate(NetshopRow.objects.all(), PROMOTION)[("A", "2026-09-01")]["spend_present"], 1)
        qs = NetshopRow.objects.annotate(present=NumericMetricPresent(ALIASES[0]))
        # A forced outer aggregate must project every auxiliary cache column.
        self.assertEqual(qs[:2].aggregate(c=Count("id", filter=F("present")), s=Sum("spend_cents", filter=F("present"))), {"c": 1, "s": 17})
        self.assertEqual(qs.values("shop_name").annotate(c=Count("id", filter=F("present"))).aggregate(total=Sum("c")), {"total": 1})
        inner = NetshopRow.objects.filter(pk=OuterRef("pk")).annotate(p=NumericMetricPresent(ALIASES[0])).values("p")[:1]
        actual = list(NetshopRow.objects.annotate(p=Subquery(inner), own=Exists(NetshopRow.objects.filter(pk=OuterRef("pk"), source="jd_promotion"))).filter(own=True).values_list("p", flat=True))
        self.assertEqual(actual, [True, None, False])

    def test_business_update_invalidates_cache_even_same_basis_and_cache_update_retains(self):
        row = self.row({"spendCents": 0})
        for changes in [{"metrics_json": {"spendCents": "0"}}, {"source_row_hash": row.source_row_hash},
                        {"last_import_batch_id": row.last_import_batch_id}, {"source": row.source}, {"dataset": row.dataset}]:
            NetshopRow.objects.filter(pk=row.pk).update(**changes)
            row.refresh_from_db()
            self.assertTrue(all(getattr(row, name) is None for name in FIELDS))
            NetshopRow.objects.filter(pk=row.pk).update(**cache_values(row.source, row.dataset, row.metrics_json, row.source_row_hash, row.last_import_batch_id))
            row.refresh_from_db()
            self.assertEqual(row.numeric_presence_rule, RULE)
        self.compare(ALIASES[0])

    def test_exact_json_cas_rejects_stale_same_hash_batch_and_decimal_is_exact(self):
        row = self.row({"spendCents": 0}, cached=False)
        with connection.cursor() as cursor:
            cursor.execute("SELECT id,source_row_hash,last_import_batch_id,metrics_json::text FROM netshop_rows WHERE id=%s", [row.pk])
            snapshot = cursor.fetchone()
            # Simulate the important competing update: basis unchanged.
            NetshopRow.objects.filter(pk=row.pk).update(metrics_json={"spendCents": "0"})
            values = cache_values("jd_promotion", "ad", decode_snapshot(snapshot[3]), snapshot[1], snapshot[2])
            self.assertFalse(apply_snapshot(cursor, snapshot, values))
            row.refresh_from_db()
            self.assertIsNone(row.numeric_presence_mask)
        enormous = decode_snapshot('{"spendCents":1e10000,"花费":0}')
        self.assertEqual(cache_values("jd_promotion", "ad", enormous, "a" * 64, "x")["numeric_presence_mask"], 1)
        self.assertEqual(str(enormous["spendCents"]), "1E+10000")

    def test_dryrun_execute_receipts_revision_and_original_business_fields(self):
        row = self.row({"花费": 0}, cached=False)
        before = NetshopRow.objects.values().get(pk=row.pk)
        revision = NetshopDataRevision.objects.get(domain="netshop").revision
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            dry = Path(directory) / "dry"
            call_command("backfill_netshop_promotion_presence", progress_dir=str(dry), stdout=output)
            self.assertEqual(NetshopDataRevision.objects.get(domain="netshop").revision, revision)
            self.assertEqual(NetshopRow.objects.values().get(pk=row.pk), before)
            with self.assertRaises(CommandError):
                call_command("backfill_netshop_promotion_presence", execute=True, progress_dir=str(Path(directory) / "bad"))
            apply = Path(directory) / "apply"
            call_command("backfill_netshop_promotion_presence", execute=True, confirmed_cache_only=True, progress_dir=str(apply), stdout=output)
            after = NetshopRow.objects.values().get(pk=row.pk)
            self.assertEqual({k: v for k, v in after.items() if k not in FIELDS}, {k: v for k, v in before.items() if k not in FIELDS})
            self.assertEqual(NetshopDataRevision.objects.get(domain="netshop").revision, revision + 1)
            receipt = json.loads((apply / "batch-0001-complete.json").read_text())
            self.assertTrue(receipt["tokensInvalidated"])
            self.assertFalse(receipt["businessSuccess"])
            self.assertNotIn("花费", output.getvalue())
            with self.assertRaises(CommandError):
                call_command("backfill_netshop_promotion_presence", progress_dir=str(apply))

    def test_actual_writer_duplicate_same_declared_hash_changed_content_and_dto(self):
        NetshopWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid4(),
            cutover_id="presence-test", migration_verify_run_id="presence-test", activated_at=timezone.now())
        payload = prepared_payload(netshop_row(source="jd_promotion", dataset="ad", metrics={"花费": 0, "展现数": 5}, shop_name="A"))
        first = import_netshop_payload(payload, "synthetic@example.invalid")
        row = NetshopRow.objects.get()
        self.assertEqual(row.numeric_presence_mask, 5)
        self.assertEqual(row.numeric_presence_row_hash, payload["rows"][0]["sourceRowHash"])
        self.assertEqual(row.numeric_presence_batch_id, first["batch"]["id"])
        self.assertFalse(any(field in json.dumps(first) for field in FIELDS))
        self.assertEqual(import_netshop_payload(payload, "synthetic@example.invalid")["status"], "duplicate")
        changed = copy.deepcopy(payload)
        changed["rows"][0]["metrics"]["花费"] = 1
        second = import_netshop_payload(changed, "synthetic@example.invalid")
        self.assertNotEqual(first["batch"]["id"], second["batch"]["id"])
        row = NetshopRow.objects.get(shop_name="A")
        self.assertEqual(row.numeric_presence_batch_id, second["batch"]["id"])
        self.assertEqual(NetshopImportBatch.objects.count(), 2)
        # Another store and a non-target writer never borrow A's stamp.
        other = prepared_payload(netshop_row(shop_name="B"))
        import_netshop_payload(other, "synthetic@example.invalid")
        non_target = NetshopRow.objects.get(shop_name="B")
        self.assertTrue(all(getattr(non_target, name) is None for name in FIELDS))

    def test_real_catalog_readiness_rejects_missing_columns_migration_and_bad_invalidator(self):
        from teruisi_backend.health import _validate_netshop_presence_cache, ReadinessError
        mutations = [
            "ALTER TABLE netshop_rows DROP COLUMN numeric_presence_mask",
            "DELETE FROM django_migrations WHERE app='netshop' AND name='0004_promotion_presence_cache'",
            "DROP TRIGGER netshop_presence_invalidate ON netshop_rows",
            "ALTER TABLE netshop_rows DISABLE TRIGGER netshop_presence_invalidate",
            "ALTER FUNCTION netshop_presence_invalidate() SECURITY DEFINER",
            "ALTER FUNCTION netshop_presence_invalidate() SET search_path=public",
            "GRANT EXECUTE ON FUNCTION netshop_presence_invalidate() TO PUBLIC",
            "CREATE OR REPLACE FUNCTION netshop_presence_invalidate() RETURNS trigger LANGUAGE plpgsql "
            "SET search_path=pg_catalog,public AS $$ BEGIN RETURN NEW; END $$",
        ]
        with connection.cursor() as cursor:
            _validate_netshop_presence_cache(cursor)
            for sql in mutations:
                with transaction.atomic():
                    cursor.execute(sql)
                    with self.assertRaises(ReadinessError):
                        _validate_netshop_presence_cache(cursor)
                    transaction.set_rollback(True)
                _validate_netshop_presence_cache(cursor)
            with transaction.atomic():
                cursor.execute("DROP TRIGGER netshop_presence_invalidate ON netshop_rows")
                cursor.execute("CREATE TRIGGER netshop_presence_invalidate BEFORE UPDATE OF metrics_json "
                               "ON netshop_rows FOR EACH ROW EXECUTE FUNCTION netshop_presence_invalidate()")
                with self.assertRaises(ReadinessError):
                    _validate_netshop_presence_cache(cursor)
                transaction.set_rollback(True)

    def test_cache_batch_deadline_rolls_back_update_and_does_not_bump_revision(self):
        row = self.row({"花费": 0}, cached=False)
        before = NetshopDataRevision.objects.get(domain="netshop").revision
        clock = [0.0]
        def expire_after_update(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.lstrip().upper().startswith("UPDATE NETSHOP_ROWS"):
                clock[0] = 6.0
            return result
        with patch("netshop.management.commands.backfill_netshop_promotion_presence.time.monotonic", side_effect=lambda: clock[0]), connection.execute_wrapper(expire_after_update):
            with self.assertRaises(CommandError):
                run_batch(0, 50, True, "deadline-test", 1)
        row.refresh_from_db()
        self.assertIsNone(row.numeric_presence_mask)
        self.assertEqual(NetshopDataRevision.objects.get(domain="netshop").revision, before)

    def test_minimum_private_writer_can_fire_invoker_invalidator_without_function_execute(self):
        row = self.row({"花费": 0})
        role = "presence_role_" + uuid4().hex[:12]
        with connection.cursor() as cursor:
            cursor.execute('CREATE ROLE "' + role + '" NOLOGIN')
            cursor.execute('GRANT SELECT,UPDATE ON netshop_rows,netshop_data_revisions TO "' + role + '"')
            with transaction.atomic():
                cursor.execute('SET LOCAL ROLE "' + role + '"')
                self.compare(ALIASES[0])
                NetshopRow.objects.filter(pk=row.pk).update(metrics_json={"spendCents": None, "花费": 0})
                _bump_global_revision("least-private-role", uuid4().hex, "synthetic")
                self.compare(ALIASES[0])
                cursor.execute('RESET ROLE')
        row.refresh_from_db()
        self.assertIsNone(row.numeric_presence_mask)


@skipUnless(connection.vendor == "postgresql", "Requires real PG commit and independent connections")
class PromotionPresenceCommitTests(SimpleTestCase):
    databases = {"default"}

    def setUp(self):
        with transaction.atomic():
            NetshopRow.objects.all().delete()
            NetshopImportBatch.objects.all().delete()
            _bump_global_revision("cache-test-clean", uuid4().hex, "cleanup")
        NetshopWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid4(),
            cutover_id="cache-concurrency", migration_verify_run_id="cache-concurrency", activated_at=timezone.now())
        self.payload = prepared_payload(netshop_row(source="jd_promotion", dataset="ad", shop_name="Race",
                                                   metrics={"spendCents": 0, "impressions": 5, "clicks": 1}))
        self.first = import_netshop_payload(self.payload, "synthetic@example.invalid")

    def tearDown(self):
        with transaction.atomic():
            NetshopRow.objects.all().delete()
            NetshopImportBatch.objects.all().delete()
            _bump_global_revision("cache-test-clean", uuid4().hex, "cleanup")

    def snapshot(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT id,source_row_hash,last_import_batch_id,metrics_json::text FROM netshop_rows")
            return cursor.fetchone()

    def test_concurrent_json_change_same_basis_then_stale_cas_marker_rollback(self):
        snapshot = self.snapshot()
        def competitor():
            close_old_connections()
            try:
                with transaction.atomic():
                    NetshopDataRevision.objects.select_for_update().get(domain="netshop")
                    NetshopRow.objects.filter(pk=snapshot[0]).update(metrics_json={"spendCents": "0"})
                    _bump_global_revision("same-basis-json-update", uuid4().hex, "synthetic")
            finally:
                connection.close()
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(competitor).result(timeout=5)
        before = NetshopDataRevision.objects.get(domain="netshop").revision
        with transaction.atomic():
            NetshopDataRevision.objects.select_for_update().get(domain="netshop")
            with connection.cursor() as cursor:
                self.assertFalse(apply_snapshot(cursor, snapshot, cache_values("jd_promotion", "ad", decode_snapshot(snapshot[3]), snapshot[1], snapshot[2])))
                cursor.execute("SELECT count(*) FROM netshop_source_revision_markers WHERE transaction_id=txid_current()")
                self.assertEqual(cursor.fetchone()[0], 0)
        self.assertEqual(NetshopDataRevision.objects.get(domain="netshop").revision, before)
        self.assertIsNone(NetshopRow.objects.get().numeric_presence_mask)

    def test_revision_first_cache_and_normal_writer_complete_without_inverse_row_lock(self):
        snapshot = self.snapshot()
        reached_fact = Event()
        replacement = copy.deepcopy(self.payload)
        replacement["rows"][0]["metrics"]["spendCents"] = 2
        def writer():
            close_old_connections()
            def observe(execute, sql, params, many, context):
                if sql.lstrip().upper().startswith("DELETE") and '"netshop_rows"' in sql:
                    reached_fact.set()
                return execute(sql, params, many, context)
            try:
                with connection.execute_wrapper(observe):
                    return import_netshop_payload(replacement, "synthetic@example.invalid")
            finally:
                connection.close()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                NetshopDataRevision.objects.select_for_update(nowait=True).get(domain="netshop")
                future = pool.submit(writer)
                self.assertTrue(reached_fact.wait(3), "normal writer must actually reach fact SQL")
                self.assertFalse(future.done())
                with connection.cursor() as cursor:
                    self.assertTrue(apply_snapshot(cursor, snapshot, cache_values("jd_promotion", "ad", decode_snapshot(snapshot[3]), snapshot[1], snapshot[2])))
                _bump_global_revision("cache-maintenance-lock-test", uuid4().hex, "cache-only")
            published = future.result(timeout=5)
        row = NetshopRow.objects.get()
        self.assertNotEqual(self.first["batch"]["id"], published["batch"]["id"])
        self.assertEqual(row.numeric_presence_batch_id, published["batch"]["id"])
        self.assertEqual(row.spend_cents, 2)

    def test_original_guard_rejects_cache_only_update_without_revision_and_failed_publish_rolls_back(self):
        row = NetshopRow.objects.get()
        before = list(NetshopRow.objects.values())
        revision = NetshopDataRevision.objects.get(domain="netshop").revision
        with self.assertRaises(DatabaseError):
            with transaction.atomic():
                NetshopRow.objects.filter(pk=row.pk).update(numeric_presence_rule="invalid")
        self.assertEqual(list(NetshopRow.objects.values()), before)
        replacement = copy.deepcopy(self.payload)
        replacement["rows"][0]["metrics"]["spendCents"] = 3
        real_bulk = NetshopRow.objects.bulk_create
        def fail_after_insert(*args, **kwargs):
            real_bulk(*args, **kwargs)
            raise RuntimeError("synthetic post-insert failure")
        with patch.object(NetshopRow.objects, "bulk_create", side_effect=fail_after_insert):
            with self.assertRaises(RuntimeError):
                import_netshop_payload(replacement, "synthetic@example.invalid")
        self.assertEqual(list(NetshopRow.objects.values()), before)
        self.assertEqual(NetshopDataRevision.objects.get(domain="netshop").revision, revision)
        self.assertEqual(NetshopImportBatch.objects.count(), 1)
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM netshop_source_revision_markers")
            self.assertEqual(cursor.fetchone()[0], 0)
