"""Protocol-level negative corpus from actual private-PG native DTO fixtures."""
from copy import deepcopy
import json
from pathlib import Path

from django.test import SimpleTestCase
from netshop.finance_netshop_contract import validate_finance_body
from netshop.finance_netshop_client import _assert_body
from netshop.errors import NetshopApiError

ROOT = Path(__file__).resolve().parents[3] / "tests/fixtures/netshop-finance"


class FinanceNetshopContractTests(SimpleTestCase):
    def fixture(self, filename="finance-response.json"):
        return json.loads((ROOT / filename).read_text(encoding="utf-8"))

    def validate(self, fixture):
        return validate_finance_body(fixture["response"]["data"], fixture["request"], fixture["owningRevision"])

    def test_all_original_native_dtos_are_valid_without_recomputing_finance_formulas(self):
        for file in ROOT.glob("*.json"):
            self.assertIsNotNone(self.validate(self.fixture(file.name)))

    def test_all_q_f01_variants_and_full_carrier_paths_are_rejected(self):
        mutations = [
            lambda d: d["monthly"]["currentMetricStates"]["netSalesCents"].update(value=999),
            lambda d: d["monthly"].update(comparisonMetricStates=None),
            lambda d: d["monthly"]["data"]["shops"].append({**deepcopy(d["monthly"]["data"]["shops"][0]),
                "key": '["天猫","FOREIGN"]', "groupName": "天猫", "name": "FOREIGN"}),
            lambda d: d["monthly"]["data"].pop("timeline"),
            lambda d: d["monthly"]["data"]["current"].update(netSalesCents=True),
            lambda d: d["monthly"]["currentMetricStates"]["netSalesCents"].update(unit="COUNT"),
            lambda d: d["monthly"]["data"]["selection"].update(shops=['["天猫","同名店"]']),
            lambda d: d["monthly"]["data"]["selectedMonths"].append("2026-02"),
            lambda d: d["monthly"]["data"]["expenses"][0].update(abnormal=0),
            lambda d: d["monthly"]["fieldEvidence"][0]["fields"]["net_sales"].update(amountPresent=0),
            lambda d: d["monthly"]["fieldEvidence"].pop(),
            lambda d: d["monthly"]["fieldEvidence"][0].update(shopKey='["天猫","FOREIGN"]'),
            lambda d: d["monthly"]["comparisonMetricStates"]["previous"]["netSalesCents"].update(value=0),
            lambda d: d["annual"]["data"]["items"][0]["target"].update(periodType="month"),
            lambda d: d["annual"]["data"]["items"][0].update(salesProgress=99),
            lambda d: d["annual"]["data"]["pagination"].update(pageSize=True),
            lambda d: d["sourceRevisions"][0].update(kind="sales_pair"),
            lambda d: d["metricSemantics"].update(dailyAllocation=0),
            lambda d: d["monthly"]["data"].update(timeline=[]),
            lambda d: d["monthly"]["data"].update(previousMonths=["2025-12"]),
            lambda d: d["monthly"]["comparisonMonthEvidence"].pop(),
            lambda d: d["annual"]["data"].update(cutoffMonth="2026-04"),
            lambda d: d["annual"]["data"]["items"][0].update(manager=[""]),
            lambda d: d["annual"]["data"]["items"][0].update(missingMonths=["2025-02"]),
        ]
        for index, mutation in enumerate(mutations):
            fixture = self.fixture(); body = fixture["response"]["data"]; mutation(body)
            with self.subTest(index=index), self.assertRaises(NetshopApiError):
                _assert_body(body, fixture["request"], fixture["owningRevision"])

    def test_primitive_status_reason_basis_units_dates_identity_have_no_string_coercion(self):
        paths = [
            ("schemaVersion",), ("operation",), ("scopeKey",), ("snapshotToken",),
            ("metricSemantics", "monthlyBasis"), ("metricSemantics", "nativeRatioUnit"),
            ("monthly", "state"), ("monthly", "monthEvidence", 0, "status"),
            ("monthly", "monthEvidence", 0, "month"), ("monthly", "fieldEvidence", 0, "shopKey"),
            ("monthly", "currentMetricStates", "netSalesCents", "unit"),
            ("monthly", "currentMetricStates", "netSalesCents", "status"),
            ("annual", "state"), ("annual", "data", "year"),
            ("annual", "data", "items", 0, "platform"),
        ]
        for path in paths:
            for wrapper in (lambda v: [v], lambda v: {"value": v}, lambda _v: True):
                fixture = self.fixture(); node = fixture["response"]["data"]
                for key in path[:-1]: node = node[key]
                node[path[-1]] = wrapper(node[path[-1]])
                with self.subTest(path=path), self.assertRaises(ValueError):
                    self.validate(fixture)
        missing = self.fixture("finance-missing-month-response.json")
        missing["response"]["data"]["monthly"]["monthEvidence"][1]["status"] = ["absent"]
        with self.assertRaises(ValueError): self.validate(missing)

    def test_required_field_shapes_and_presence_default_zero_never_open(self):
        for key in ("data", "monthEvidence", "fieldEvidence", "currentMetricStates", "comparisonMetricStates"):
            fixture = self.fixture(); fixture["response"]["data"]["monthly"].pop(key)
            with self.assertRaises(ValueError): self.validate(fixture)
        for key in ("current", "yearToDate", "targets", "progress", "filters", "sync", "shops", "expenses", "anomalies"):
            fixture = self.fixture(); fixture["response"]["data"]["monthly"]["data"].pop(key)
            with self.assertRaises(ValueError): self.validate(fixture)
        fixture = self.fixture("finance-zero-missing-field-response.json")
        fixture["response"]["data"]["monthly"]["currentMetricStates"]["netCostCents"].update(value=0, status="available", reasonCode=None)
        with self.assertRaises(ValueError): self.validate(fixture)
