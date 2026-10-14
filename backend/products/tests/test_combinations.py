from copy import deepcopy
from unittest.mock import patch
from urllib.parse import urlencode

from django.db import connection, transaction
from django.test import SimpleTestCase, TestCase, override_settings
from erp_reference.models import ErpComboItem
from products.combinations import infer_combinations, AMOUNTS
from products.errors import ProductsApiError
from products.query import product_summary, normalize_options
from sales.auth import Principal
from sales.models import ErpProductMaster, SalesOrderLine, SalesDataRevision
from sales.tests.factories import install_fixture, make_line, signed_headers, TEST_SECRET


def relation(parent="KIT", child="A", quantity=1000):
    return dict(parent_code=parent, parent_name=parent, child_code=child,
        child_name=child, child_quantity_milli=quantity)


def fact(code, quantity, cents, key, **extra):
    return dict(source_line_key=key, order_no="ORDER", online_order_no="",
        platform="京东", shop_name="合成店", channel="合成渠道", product_code=code,
        product_name=code, specification="", category="", supplier="", quantity=quantity,
        allocated_amount_cents=cents, cost_amount_cents=cents // 2,
        fee_allocation_cents=1, gross_profit_cents=cents - cents // 2 - 1, **extra)


class AllocationTests(SimpleTestCase):
    def assert_conserved(self, lines, result):
        rows = [r for group in result.values() for r in group.values()]
        for target, source in AMOUNTS.items():
            self.assertEqual(sum(r[target] for r in rows), sum(line[source] for line in lines))
        self.assertEqual(sum(r["grossSalesCents"] for r in rows), sum(max(0, l["allocated_amount_cents"]) for l in lines))
        self.assertEqual(sum(r["refundAmountCents"] for r in rows), sum(max(0, -l["allocated_amount_cents"]) for l in lines))

    def test_full_partial_and_rounding_conserve_every_cent(self):
        lines = [fact("A", 3, 1001, "1"), fact("B", 2, 799, "2")]
        original = deepcopy(lines)
        result = infer_combinations(lines, [relation(), relation(child="B")])
        self.assertEqual(result["combo"]["KIT"]["netQuantity"], 2)
        self.assertEqual(result["single"]["A"]["netQuantity"], 1)
        self.assertEqual(result["combo"]["KIT"]["netSalesCents"], 1466)
        self.assert_conserved(lines, result)
        self.assertEqual(lines, original)

    def test_orders_outlets_channels_and_returns_do_not_cross_match(self):
        for field in ("order_no", "shop_name", "platform", "channel"):
            lines = [fact("A", 1, 100, "1"), fact("B", 1, 100, "2")]
            lines[1][field] = "OTHER"
            self.assertFalse(infer_combinations(lines, [relation(), relation(child="B")])["combo"])
        lines = [fact("A", 1, 101, "1"), fact("B", -1, -99, "2")]
        result = infer_combinations(lines, [relation(), relation(child="B")])
        self.assertFalse(result["combo"])
        self.assert_conserved(lines, result)
        lines = [fact("A", -2, -101, "1"), fact("B", -1, -99, "2")]
        result = infer_combinations(lines, [relation(), relation(child="B")])
        self.assertEqual(result["combo"]["KIT"]["netQuantity"], -1)
        self.assert_conserved(lines, result)

    def test_overlapping_bundles_zero_quantity_and_missing_order_identity(self):
        lines = [fact("A", 1, 101, "1"), fact("B", 1, 99, "2"), fact("C", 1, 1, "3"), fact("Z", 0, -1, "4")]
        relations = [relation("SMALL"), relation("SMALL", "B"), relation("BIG"), relation("BIG", "B"), relation("BIG", "C")]
        result = infer_combinations(lines, relations)
        self.assertEqual(list(result["combo"]), ["BIG"])
        self.assert_conserved(lines, result)
        for line in lines:
            line["order_no"] = ""
        self.assertFalse(infer_combinations(lines, relations)["combo"])

    def test_fractional_ratios_current_definition_and_direct_parent_sales(self):
        lines = [fact("A", 3, 1001, "1"), fact("B", 1, 99, "2")]
        result = infer_combinations(lines, [relation(quantity=1500), relation(child="B", quantity=500)])
        self.assertEqual(result["combo"]["KIT"]["netQuantity"], 2)
        self.assertFalse(result["single"])
        self.assert_conserved(lines, result)
        updated = infer_combinations(lines, [relation(quantity=4000), relation(child="B")])
        self.assertFalse(updated["combo"])
        direct = infer_combinations([fact("KIT", 1, 100, "P")], [relation()])
        self.assertEqual(direct["combo"]["KIT"]["netQuantity"], 1)


@override_settings(DJANGO_INTERNAL_SECRET=TEST_SECRET)
class CombinationQueryTests(TestCase):
    def setUp(self):
        install_fixture()
        SalesOrderLine.objects.all().delete()
        for code in ("A", "B", "KIT"):
            ErpProductMaster.objects.create(product_code=code, product_name=code,
                source_row_number=1, last_import_batch_id="fixture")
        ErpComboItem.objects.bulk_create([ErpComboItem(**relation(), source_row_number=1), ErpComboItem(**relation(child="B"), source_row_number=2)])
        SalesOrderLine.objects.bulk_create([
            make_line(101, "A", product_code="A", order_no="kit-order", quantity=3, allocated_amount_cents=1001),
            make_line(102, "B", product_code="B", order_no="kit-order", quantity=2, allocated_amount_cents=799),
            make_line(103, "X", product_code="B", order_no="other", shop_name="京东二店", quantity=1, allocated_amount_cents=333),
            make_line(104, "EX", product_code="A", order_no="excluded", warehouse="刷刷仓", quantity=100, allocated_amount_cents=99999),
            make_line(105, "UNKNOWN", product_code="UNKNOWN", quantity=1, allocated_amount_cents=999),
        ])
        self.principal = Principal("fixture@example.invalid", "Fixture", "viewer", None)
        self.options = dict(range="custom", startDate="2026-08-01", endDate="2026-08-02")

    def test_combo_margin_cards_use_bundle_cost_margin_and_exact_boundaries_independent_of_details(self):
        SalesOrderLine.objects.all().delete()
        ErpComboItem.objects.all().delete()
        # Import profit deliberately disagrees with the requested big-margin
        # formula, proving fees/order profit do not drive these bands.
        costs = [6201, 6200, 5801, 5800, 5401, 5400]
        for i, cost in enumerate(costs):
            code = f"KIT-{i}"
            ErpProductMaster.objects.create(product_code=code, product_name=code,
                category="组合装类目", source_row_number=i + 1, last_import_batch_id="fixture")
            ErpComboItem.objects.create(**relation(code), source_row_number=i + 1)
            make_line(501 + i, code, product_code=code, allocated_amount_cents=10000,
                cost_amount_cents=cost, gross_profit_cents=1000, fee_allocation_cents=777).save()
        make_line(600, "single", product_code="B", allocated_amount_cents=10000,
            cost_amount_cents=5000, gross_profit_cents=1000).save()
        single = product_summary(self.principal, {**self.options, "productKind": "single"})
        combo = product_summary(self.principal, {**self.options, "productKind": "combo"})
        expected = {"dimension": "combo", "comboCount": 6, "marginBuckets": {
            "below38Count": 1, "between38And42Count": 2,
            "between42And46Count": 2, "atLeast46Count": 1}}
        self.assertEqual(single["comboMarginMetrics"], expected)
        self.assertEqual(combo["comboMarginMetrics"], expected)
        legacy = product_summary(self.principal, self.options)
        self.assertEqual(legacy["metrics"]["grossMarginRate"], (70000 - sum(costs) - 5000) / 70000)
        ordered = product_summary(self.principal, {**self.options, "productKind": "combo", "sortBy": "grossMarginRate"})
        self.assertEqual([i["productCode"] for i in ordered["items"]], [f"KIT-{i}" for i in range(5, -1, -1)])
        self.assertEqual(single["pagination"]["total"], 1)
        rates = {i["productCode"]: i["grossMarginRate"] for i in combo["items"]}
        self.assertEqual(rates, dict(zip([f"KIT-{i}" for i in range(6)], [.3799, .38, .4199, .42, .4599, .46])))
        for band, codes in [("below38", ["KIT-0"]), ("38to42", ["KIT-1", "KIT-2"]),
            ("42to46", ["KIT-3", "KIT-4"]), ("atLeast46", ["KIT-5"])]:
            filtered = product_summary(self.principal, {**self.options, "productKind": "combo", "marginBands": [band]})
            self.assertEqual(sorted(i["productCode"] for i in filtered["items"]), codes)
            self.assertEqual(filtered["comboMarginMetrics"], expected)
        self.assertIn("组合装类目", single["filters"]["categories"])
        scoped = product_summary(self.principal, {**self.options, "productKind": "single", "query": "KIT-1"})
        self.assertEqual(scoped["comboMarginMetrics"]["comboCount"], 1)
        self.assertEqual(scoped["pagination"]["total"], 0)
        zero = make_line(601, "zero", product_code="KIT-0", quantity=0,
            allocated_amount_cents=-10000, cost_amount_cents=0, gross_profit_cents=0)
        zero.save()
        unavailable = product_summary(self.principal, {**self.options, "productKind": "combo", "marginBands": ["unavailable"]})
        self.assertEqual([i["productCode"] for i in unavailable["items"]], ["KIT-0"])
        self.assertIsNone(unavailable["items"][0]["grossMarginRate"])
        self.assertEqual(unavailable["comboMarginMetrics"]["marginBuckets"]["below38Count"], 0)

    def test_split_matches_legacy_totals_and_child_query_keeps_full_bundle(self):
        legacy = product_summary(self.principal, self.options)
        single = product_summary(self.principal, {**self.options, "productKind": "single"})
        combo = product_summary(self.principal, {**self.options, "productKind": "combo"})
        self.assertEqual(combo["items"][0]["netQuantity"], 2)
        self.assertEqual(combo["items"][0]["components"][0]["quantity"], 1)
        for field in ("grossSalesCents", "netSalesCents", "grossProfitCents"):
            self.assertEqual(single["metrics"][field] + combo["metrics"][field], legacy["metrics"][field])
        queried = product_summary(self.principal, {**self.options, "productKind": "combo", "query": "B"})
        self.assertEqual(queried["items"], combo["items"])
        page = product_summary(self.principal, {**self.options, "productKind": "combo", "projection": "page", "expectedSnapshotToken": combo["snapshotToken"]})
        self.assertEqual(page["items"], combo["items"])

    def test_scope_filters_revision_and_bounds_fail_closed(self):
        old = product_summary(self.principal, {**self.options, "productKind": "combo"})
        ErpComboItem.objects.filter(child_code="A").update(child_quantity_milli=4000)
        SalesDataRevision.objects.filter(domain="erp").update(revision=4)
        with self.assertRaises(ProductsApiError):
            product_summary(self.principal, {**self.options, "productKind": "combo", "projection": "page", "expectedSnapshotToken": old["snapshotToken"]})
        self.assertEqual(product_summary(self.principal, {**self.options, "productKind": "combo"})["items"], [])
        for kind in ("single", "combo"):
            scoped = Principal(self.principal.email, "Fixture", "viewer", {"platforms": ["京东"]})
            with self.assertRaises(ProductsApiError):
                product_summary(scoped, {**self.options, "productKind": kind})
        with patch("products.combinations.MAX_FACTS", 1):
            with self.assertRaises(ProductsApiError):
                product_summary(self.principal, {**self.options, "productKind": "single"})
        for kind in ("bad", "", 1, [], {}, True):
            with self.assertRaises(ProductsApiError):
                normalize_options({"productKind": kind})

    def test_signed_api_role_duplicate_parameter_and_read_only_postgres(self):
        url = "/api/products/summary?" + urlencode({**self.options, "productKind": "combo"})
        with patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET}):
            for role in ("viewer", "analyst", "operator", "admin"):
                response = self.client.get(url, headers=signed_headers(url, role=role))
                self.assertEqual(response.status_code, 200, response.content)
            duplicate = url + "&productKind=single"
            self.assertEqual(self.client.get(duplicate, headers=signed_headers(duplicate)).status_code, 400)
            self.assertEqual(self.client.get(url, headers=signed_headers(url, scope={"platforms": ["京东"]})).status_code, 403)
            self.assertEqual(self.client.get(url).status_code, 401)
        if connection.vendor == "postgresql":
            # Existing product reader contract already grants SELECT on these
            # tables. Verify this new query with that same narrow table set.
            tables = ("sales_order_lines", "sales_import_batches", "sales_data_revisions",
                "erp_product_master", "erp_combo_items", "product_data_revisions",
                "product_inventory_projection_control", "product_inventory_projection", "product_shipping_rates")
            with connection.cursor() as cursor:
                cursor.execute("CREATE ROLE fixture_combo_reader NOLOGIN")
                cursor.execute("GRANT USAGE ON SCHEMA public TO fixture_combo_reader")
                for table in tables:
                    cursor.execute(f"GRANT SELECT ON {table} TO fixture_combo_reader")
                cursor.execute("SET LOCAL ROLE fixture_combo_reader")
            try:
                self.assertEqual(product_summary(self.principal, {**self.options, "productKind": "combo"})["items"][0]["productCode"], "KIT")
                with transaction.atomic(), self.assertRaises(Exception):
                    SalesOrderLine.objects.filter(pk=101).update(quantity=9)
            finally:
                with connection.cursor() as cursor:
                    cursor.execute("RESET ROLE")
