from django.test import SimpleTestCase

from netshop.errors import NetshopApiError
from netshop.insights_common import validate_metric, validate_derived_money_per_count, compare_derived_money_per_count


def price(**overrides):
    return {"metricSchemaVersion": "netshop-money-per-count-v1", "unit": "CNY_CENT_PER_COUNT", "denominatorKind": "clicks", "aggregation": "ratio_of_sums", "value": 101 / 3, "numerator": 101, "denominator": 3, "status": "available", "reasonCode": None, "basis": "platform_attributed", "sourceIds": ["jd_promotion"], "coverageRef": "jd_promotion:current", **overrides}


class DerivedMoneyTests(SimpleTestCase):
    def test_fractional_price_does_not_relax_amounts_and_true_zero_is_preserved(self):
        self.assertEqual(validate_derived_money_per_count(price())["value"], 101 / 3)
        self.assertEqual(validate_derived_money_per_count(price(value=0, numerator=0))["value"], 0)
        for unit in ("CNY_CENT", "COUNT"):
            with self.assertRaises(NetshopApiError): validate_metric({**price(), "unit": unit})

    def test_exact_version_operand_source_and_state_contract(self):
        for invalid in ({"metricSchemaVersion": "unversioned"}, {"unit": "RATIO"}, {"denominatorKind": "orders"}, {"aggregation": "sum"}, {"aggregation": "source_value_only"}, {"status": "partial", "reasonCode": "incomplete_coverage"}, {"numerator": 1.5}, {"numerator": 9007199254740992}, {"numerator": None}, {"numerator": True}, {"denominator": 0}, {"denominator": -1}, {"denominator": .5}, {"denominator": 9007199254740992}, {"denominator": None}, {"denominator": True}, {"value": float("inf")}, {"value": .33}, {"value": -101 / 3, "numerator": -101}, {"sourceIds": []}, {"sourceIds": ["jd_promotion", "jd_promotion"]}, {"basis": "unverified"}):
            with self.subTest(invalid=invalid), self.assertRaises(NetshopApiError): validate_derived_money_per_count(price(**invalid))
        missing = price(); del missing["numerator"]
        with self.assertRaises(NetshopApiError): validate_derived_money_per_count(missing)

    def test_unavailable_reasons_and_comparison_semantics(self):
        for reason in ("missing_field", "missing_day", "zero_denominator", "negative_denominator", "incomplete_coverage"):
            p = price(status="unavailable", value=None, numerator=None, denominator=None, reasonCode=reason)
            self.assertEqual(validate_derived_money_per_count(p)["reasonCode"], reason)
            with self.assertRaises(NetshopApiError): validate_derived_money_per_count({**p, "value": 0})
        self.assertEqual(compare_derived_money_per_count(price(), price(denominator=6, value=101 / 6))["value"], 1)
        self.assertEqual(compare_derived_money_per_count(price(), price(denominatorKind="item_quantity"))["reasonCode"], "not_applicable")
        self.assertEqual(compare_derived_money_per_count(price(), price(numerator=0, value=0))["reasonCode"], "zero_denominator")
        negative = price(denominatorKind="item_quantity", numerator=-101, value=-101 / 3, basis="erp_net_sales")
        self.assertEqual(compare_derived_money_per_count({**negative, "numerator": 101, "value": 101 / 3}, negative)["reasonCode"], "negative_baseline")

    def test_weighted_cpc_is_computed_from_total_integer_operands(self):
        p = price(numerator=101, denominator=101, value=1)
        self.assertEqual(validate_derived_money_per_count(p)["value"], 1)
        with self.assertRaises(NetshopApiError): validate_derived_money_per_count({**p, "value": (100 / 1 + 1 / 100) / 2})
