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
        for row in result["combo"].values():
            if all(child["sales"] is not None for child in row["components"]):
                for field in (*AMOUNTS, "grossSalesCents", "refundAmountCents"):
                    self.assertEqual(sum(child["sales"][field] for child in row["components"]), row[field])
                for child in row["components"]:
                    self.assertEqual(child["sales"]["netQuantity"], row["netQuantity"] * child["quantity"])

    def test_full_partial_and_rounding_conserve_every_cent(self):
        lines = [fact("A", 3, 1001, "1"), fact("B", 2, 799, "2")]
        original = deepcopy(lines)
        result = infer_combinations(lines, [relation(), relation(child="B")])
        self.assertEqual(result["combo"]["KIT"]["netQuantity"], 2)
        self.assertEqual(result["single"]["A"]["netQuantity"], 1)
        self.assertEqual(result["combo"]["KIT"]["netSalesCents"], 1466)
        children = result["combo"]["KIT"]["components"]
        self.assertEqual([child["sales"]["netQuantity"] for child in children], [2, 2])
        self.assertEqual([child["sales"]["netSalesCents"] for child in children], [667, 799])
        for field in (*AMOUNTS, "grossSalesCents", "refundAmountCents"):
            self.assertEqual(sum(child["sales"][field] for child in children), result["combo"]["KIT"][field])
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
        self.assertIsNone(direct["combo"]["KIT"]["components"][0]["sales"])


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
        self.assertEqual([i["productCode"] for i in ordered["items"] if i["productKind"] == "combo"], [f"KIT-{i}" for i in range(5, -1, -1)])
        # 单品维度按单一规格原始汇总：直接开单的 KIT-0..KIT-5 与 B 各自成行，
        # 不因为存在组合装配比而从单品维度消失。
        self.assertEqual(single["pagination"]["total"], 7)
        self.assertEqual(single["productMarginMetrics"]["productCount"], 7)
        self.assertEqual(single["productMarginMetrics"]["marginBuckets"],
            {"below38Count": 1, "between38And42Count": 2, "between42And46Count": 2, "atLeast46Count": 2})
        self.assertEqual(combo["productMarginMetrics"]["productCount"], 6)
        rates = {i["productCode"]: i["grossMarginRate"] for i in combo["items"] if i["productKind"] == "combo"}
        self.assertEqual(rates, dict(zip([f"KIT-{i}" for i in range(6)], [.3799, .38, .4199, .42, .4599, .46])))
        for band, codes in [("below38", ["KIT-0"]), ("38to42", ["KIT-1", "KIT-2"]),
            ("42to46", ["KIT-3", "KIT-4"]), ("atLeast46", ["KIT-5"])]:
            filtered = product_summary(self.principal, {**self.options, "productKind": "combo", "marginBands": [band]})
            self.assertEqual(sorted(i["productCode"] for i in filtered["items"] if i["productKind"] == "combo"), codes)
            self.assertEqual(filtered["comboMarginMetrics"], expected)
        self.assertIn("组合装类目", single["filters"]["categories"])
        scoped = product_summary(self.principal, {**self.options, "productKind": "single", "query": "KIT-1"})
        self.assertEqual(scoped["comboMarginMetrics"]["comboCount"], 1)
        # KIT-1 本身是直接开单的规格，单品维度按规格代码搜索必须命中。
        self.assertEqual([i["productCode"] for i in scoped["items"]], ["KIT-1"])
        zero = make_line(601, "zero", product_code="KIT-0", quantity=0,
            allocated_amount_cents=-10000, cost_amount_cents=0, gross_profit_cents=0)
        zero.save()
        unavailable = product_summary(self.principal, {**self.options, "productKind": "combo", "marginBands": ["unavailable"]})
        self.assertEqual([i["productCode"] for i in unavailable["items"]], ["KIT-0"])
        self.assertIsNone(unavailable["items"][0]["grossMarginRate"])
        self.assertEqual(unavailable["comboMarginMetrics"]["marginBuckets"]["below38Count"], 0)

    def test_single_keeps_raw_specification_scope_independent_of_bundles(self):
        legacy = product_summary(self.principal, self.options)
        single = product_summary(self.principal, {**self.options, "productKind": "single"})
        combo = product_summary(self.principal, {**self.options, "productKind": "combo"})
        self.assertEqual(combo["items"][0]["netQuantity"], 2)
        self.assertEqual(combo["items"][0]["components"][0]["quantity"], 1)
        for field in ("grossSalesCents", "netSalesCents", "grossProfitCents"):
            self.assertEqual(combo["metrics"][field], legacy["metrics"][field])
        # 单品是单一规格口径，等于不传 productKind 的原始规格汇总；A、B 被凑成
        # KIT 后在单品维度仍保留完整销量，不与组合装剩余量耦合。
        self.assertEqual([i["productCode"] for i in single["items"]],
            [i["productCode"] for i in legacy["items"]])
        for a, b in zip(single["items"], legacy["items"]):
            for field in ("netQuantity", "grossSalesCents", "netSalesCents", "grossProfitCents"):
                self.assertEqual(a[field], b[field])
            self.assertEqual(a["productKind"], "single")
            self.assertEqual(a["components"], [])
        # 仍只覆盖 ERP/库存授权货品集合，UNKNOWN 不在其中。
        self.assertEqual({i["productCode"] for i in single["items"]}, {"A", "B"})
        self.assertEqual([i["netQuantity"] for i in single["items"] if i["productCode"] == "A"], [3])
        queried = product_summary(self.principal, {**self.options, "productKind": "combo", "query": "B"})
        self.assertEqual({i["productCode"] for i in queried["items"]}, {"KIT", "B"})
        page = product_summary(self.principal, {**self.options, "productKind": "combo", "projection": "page", "expectedSnapshotToken": combo["snapshotToken"]})
        self.assertEqual(page["items"], combo["items"])

    def test_scope_filters_revision_and_bounds_fail_closed(self):
        old = product_summary(self.principal, {**self.options, "productKind": "combo"})
        ErpComboItem.objects.filter(child_code="A").update(child_quantity_milli=4000)
        SalesDataRevision.objects.filter(domain="erp").update(revision=4)
        with self.assertRaises(ProductsApiError):
            product_summary(self.principal, {**self.options, "productKind": "combo", "projection": "page", "expectedSnapshotToken": old["snapshotToken"]})
        self.assertTrue(all(item["productKind"] == "single" for item in product_summary(self.principal, {**self.options, "productKind": "combo"})["items"]))
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


class CombinationScopeTests(TestCase):
    """Only lines of ERP relation codes are loaded for bundle inference."""

    def setUp(self):
        install_fixture()
        SalesOrderLine.objects.all().delete()
        self.unrelated = [f"U{i}" for i in range(6)]
        for code in ("A", "B", "C", "KIT", "KIT3", *self.unrelated):
            ErpProductMaster.objects.create(product_code=code, product_name=code,
                source_row_number=1, last_import_batch_id="fixture")
        ErpComboItem.objects.bulk_create([
            ErpComboItem(**relation(), source_row_number=1),
            ErpComboItem(**relation(child="B"), source_row_number=2),
            ErpComboItem(**relation("KIT3", "C"), source_row_number=3)])
        lines = [
            make_line(101, "A", product_code="A", order_no="kit-order", quantity=3, allocated_amount_cents=1001),
            make_line(102, "B", product_code="B", order_no="kit-order", quantity=2, allocated_amount_cents=799),
            make_line(103, "C", product_code="C", order_no="c-order", quantity=2, allocated_amount_cents=500),
        ]
        # Unrelated single-SKU lines share the bundle order.
        lines += [make_line(200 + i, code, product_code=code, order_no="kit-order",
            quantity=i + 1, allocated_amount_cents=100 * (i + 1)) for i, code in enumerate(self.unrelated)]
        SalesOrderLine.objects.bulk_create(lines)
        self.principal = Principal("fixture@example.invalid", "Fixture", "viewer", None)
        self.options = dict(range="custom", startDate="2026-08-01", endDate="2026-08-02")

    def summary(self, kind):
        return product_summary(self.principal, {**self.options, "productKind": kind, "pageSize": 100})

    def test_combo_result_unchanged_with_unrelated_lines_mixed_into_order(self):
        from products.combinations import combination_performance
        groups, relation_codes = combination_performance(self.principal, "2026-08-01", "2026-08-03",
            [], [], self.loaded_revision())
        self.assertEqual(relation_codes, {"A", "B", "C", "KIT", "KIT3"})
        self.assertEqual(groups["combo"]["KIT"]["netQuantity"], 2)
        self.assertEqual(groups["combo"]["KIT"]["netSalesCents"], 1466)
        self.assertEqual(groups["combo"]["KIT3"]["netQuantity"], 2)
        self.assertEqual(groups["combo"]["KIT3"]["netSalesCents"], 500)
        self.assertEqual(set(groups["single"]), {"A"})
        self.assertEqual(groups["single"]["A"]["netQuantity"], 1)

    def loaded_revision(self):
        from products.models import ProductInventoryProjectionControl
        return ProductInventoryProjectionControl.objects.get().active_revision

    def test_unrelated_lines_do_not_count_toward_fact_cap(self):
        # 6 relation-free lines + 3 relation lines: cap 3 fits only relation lines.
        with patch("products.combinations.MAX_FACTS", 3):
            single = self.summary("single")
            combo = self.summary("combo")
        self.assertEqual({i["productCode"] for i in single["items"]},
            {"A", "B", "C", *self.unrelated})
        self.assertIn("items", combo)
        with patch("products.combinations.MAX_FACTS", 2):
            with self.assertRaises(ProductsApiError):
                self.summary("single")

    def test_combo_view_sources_unrelated_from_aggregate_and_relation_codes_from_inference(self):
        single = {i["productCode"]: i for i in self.summary("single")["items"]}
        combo = {i["productCode"]: i for i in self.summary("combo")["items"]}
        for code in self.unrelated:
            for field in ("netQuantity", "grossSalesCents", "netSalesCents", "costCents", "grossProfitCents"):
                self.assertEqual(combo[code][field], single[code][field], (code, field))
            self.assertEqual(combo[code]["productKind"], "single")
            self.assertEqual(combo[code]["components"], [])
        # B and C are fully consumed into bundles: no single row, no double count.
        self.assertNotIn("B", combo)
        self.assertNotIn("C", combo)
        # A is partially consumed: only the remainder (3 - 2) is shown.
        self.assertEqual(combo["A"]["productKind"], "single")
        self.assertEqual(combo["A"]["netQuantity"], 1)
        self.assertEqual(combo["KIT"]["netQuantity"], 2)
        self.assertEqual(combo["KIT3"]["netQuantity"], 2)
        self.assertEqual(single["A"]["netQuantity"], 3)
        self.assertEqual(single["B"]["netQuantity"], 2)

    def test_combo_shop_filters_match_single_when_filter_excludes_relation_only_shop(self):
        # 天猫店 only sells relation code C; a 京东 platform filter excludes it.
        make_line(300, "C-TM", product_code="C", order_no="tm-order", platform="天猫",
            shop_name="天猫店", quantity=1, allocated_amount_cents=250).save()
        options = {**self.options, "platforms": ["京东"], "pageSize": 100}
        single = product_summary(self.principal, {**options, "productKind": "single"})
        combo = product_summary(self.principal, {**options, "productKind": "combo"})
        self.assertEqual(combo["filters"]["shops"], single["filters"]["shops"])
        self.assertEqual(combo["filters"]["platforms"], single["filters"]["platforms"])
        self.assertIn("天猫", single["filters"]["platforms"])
