"""Real PG positive-filter equivalence against the original COALESCE predicate."""
import hashlib
from unittest import skipUnless

from django.db import connection
from django.db.models import BooleanField, Count, F, JSONField, Sum, Value
from django.db.models.expressions import RawSQL
from django.test import TestCase

from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow
from netshop.store_overview import NumericMetricPresent


@skipUnless(connection.vendor == "postgresql", "Requires actual PostgreSQL JSONPath")
class NumericMetricPresentJsonPathTests(TestCase):
    def setUp(self):
        NetshopRow.objects.all().delete()
        NetshopImportBatch.objects.all().delete()
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        self.counter = 0
        self.batch = NetshopImportBatch.objects.create(id="presence-fixture", source="jd_promotion", dataset="ad", platform="京东", shop_name="fixture", file_size_bytes=0, file_hash="a" * 64, raw_file_hash="b" * 64, content_hash="c" * 64, scope_key="d" * 64, status="completed")

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def row(self, label, metrics, amount=17):
        self.counter += 1
        if metrics is None:
            metrics = Value(None, output_field=JSONField())
        return NetshopRow.objects.create(source_row_key="presence-" + label, source_row_hash="e" * 64, first_import_batch_id=self.batch.id, last_import_batch_id=self.batch.id, source_row_number=self.counter, source="jd_promotion", dataset="ad", platform="京东", shop_name=label, business_date="2026-09-01", metrics_json=metrics, spend_cents=amount, net_transaction_amount_cents=-amount)

    def old(self, names):
        # Immutable pre-candidate expression; evaluate it in the same real PG
        # aggregate as the production expression, not with a fake compiler.
        column = '(CASE WHEN "netshop_rows"."source_row_key"=%s THEN NULL::jsonb ELSE "netshop_rows"."metrics_json" END)'
        sql = "jsonb_typeof(COALESCE(" + ",".join(column + " -> %s" for _ in names) + "))='number'"
        return RawSQL(sql, [v for name in names for v in ["presence-sql-null", name]], output_field=BooleanField())

    def new(self, names):
        predicate = NumericMetricPresent(names)
        # JSONField is non-NULL in the factual table; exercise SQL NULL through
        # a real bound SQL expression without altering production constraints.
        predicate.set_source_expressions([RawSQL('(CASE WHEN "netshop_rows"."source_row_key"=%s THEN NULL::jsonb ELSE "netshop_rows"."metrics_json" END)', ["presence-sql-null"], output_field=JSONField())])
        return predicate

    def groups(self, names):
        return list(NetshopRow.objects.values("shop_name", "business_date").annotate(
            old_count=Count("id", filter=self.old(names)), new_count=Count("id", filter=self.new(names)),
            old_sum=Sum("spend_cents", filter=self.old(names)), new_sum=Sum("spend_cents", filter=self.new(names)),
        ).order_by("shop_name", "business_date"))

    def test_eighteen_gold_states_and_ordered_two_and_three_aliases(self):
        cases = {
            "sql-null": {}, "json-null": None, "array": [1, 2], "string": "text", "bool": True, "number": 3,
            "empty": {}, "missing-alias": {"花费": 0}, "canonical-null": {"spendCents": None, "花费": 4},
            "canonical-string": {"spendCents": "4", "花费": 4}, "canonical-object": {"spendCents": {"x": 1}, "花费": 4},
            "canonical-bool": {"spendCents": False, "花费": 4}, "canonical-array": {"spendCents": [4], "花费": 4},
            "root-array-object": [{"spendCents": 4}], "zero": {"spendCents": 0}, "negative": {"spendCents": -9},
            "alias-order-block": {"花费": None, "legacySpend": 7}, "third-alias": {"legacySpend": 0},
        }
        for label, metrics in cases.items():
            self.row(label, metrics)
        for aliases in [("spendCents", "花费"), ("spendCents", "花费", "legacySpend")]:
            expected_true = {"missing-alias", "zero", "negative"} | ({"third-alias"} if len(aliases) == 3 else set())
            for row in self.groups(aliases):
                self.assertEqual(row["new_count"], row["old_count"])
                self.assertEqual(row["new_sum"], row["old_sum"])
                self.assertEqual(row["new_count"], int(row["shop_name"] in expected_true))
                self.assertEqual(row["new_sum"], 17 if row["shop_name"] in expected_true else None)

    def test_multi_field_positive_count_and_sum_do_not_trust_typed_defaults(self):
        self.row("same", {"花费": 0, "总订单金额": -7}, 0)
        self.row("same-2", {"spendCents": None, "花费": 99, "netTransactionAmountCents": 0}, -9)
        self.row("missing", {}, 900000)
        fields = (("spendCents", "花费"), ("netTransactionAmountCents", "总订单金额"))
        for names in fields:
            data = NetshopRow.objects.aggregate(old_count=Count("id", filter=self.old(names)), new_count=Count("id", filter=self.new(names)), old_sum=Sum("spend_cents", filter=self.old(names)), new_sum=Sum("spend_cents", filter=self.new(names)))
            self.assertEqual(data["new_count"], data["old_count"])
            self.assertEqual(data["new_sum"], data["old_sum"])
        self.assertEqual(NetshopRow.objects.aggregate(c=Count("id", filter=self.new(fields[0])), s=Sum("spend_cents", filter=self.new(fields[0]))), {"c": 1, "s": 0})

    def test_unicode_quotes_backslash_and_jsonpath_tokens_are_bound_key_names(self):
        aliases = ("汉字\"'\\key", "alias\\\"two", "x) || true || (@.key")
        self.row("keys", {aliases[2]: 0})
        self.row("blocked", {aliases[0]: [], aliases[2]: 0})
        for row in self.groups(aliases):
            self.assertEqual(row["new_count"], row["old_count"])
            self.assertEqual(row["new_sum"], row["old_sum"])
            self.assertEqual(row["new_count"], int(row["shop_name"] == "keys"))

    def test_absence_nullity_difference_is_only_a_positive_filter_contract(self):
        self.row("empty", {})
        self.row("sql-null", {})
        values = {r["shop_name"]: r for r in NetshopRow.objects.annotate(old=self.old(("spendCents", "花费")), new=self.new(("spendCents", "花费"))).values("shop_name", "old", "new")}
        self.assertIsNone(values["empty"]["old"])
        self.assertIs(values["empty"]["new"], False)
        self.assertIsNone(values["sql-null"]["old"])
        self.assertIsNone(values["sql-null"]["new"])
