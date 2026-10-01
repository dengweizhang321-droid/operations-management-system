"""Corrupt actual owning PG/registered HTTP envelopes, never invent success facts."""
from copy import deepcopy
import json
from pathlib import Path

from django.test import SimpleTestCase

from netshop.errors import NetshopApiError
from netshop.sales_periods_client import read_sales_periods
from sales.auth import Principal

ROOT = Path(__file__).resolve().parents[3]
REQUEST = {"operation": "netshop_periods_v1", "current": {"startDate": "2026-08-01", "endExclusive": "2026-08-03"}, "baseline": {"startDate": "2026-07-01", "endExclusive": "2026-08-01"}}
P = Principal("synthetic-validation@example.test", "Synthetic", "admin", None)


def fixture():
    return json.loads((ROOT/"tests/fixtures/netshop-sales-periods/response-periods.json").read_text(encoding="utf8"))


class CompleteResponseValidationTests(SimpleTestCase):
    def read(self, data, request=REQUEST):
        return read_sales_periods(P, request, reader=lambda *_args, **_kwargs: (data, "7:3"))[0]

    def test_original_actual_pg_positive_and_complete_negative_matrix(self):
        original = fixture(); self.assertEqual(self.read(original), original)
        changes = [
            (("scopeMode",), ["restricted"]), (("scopeKey",), "not-a-sha"), (("snapshotToken",), None),
            (("items",0,"identity"), None), (("items",0,"identityKey"), "noncanonical-foreign-key"),
            (("items",0,"identity","rawShopName"), "FOREIGN-Q店"), (("items",0,"identity","rawChannel"), "FOREIGN-Q渠道"),
            (("items",0,"current","rowCount"), True), (("periodTotals","current","rowPresence"), 1),
            (("periodTotals","current","values","costCents"), 0.5), (("periodTotals","current","values","netQuantity"), 1.25),
            (("periodTotals","current","orders","netAmountPerOrder","status"), ["available"]),
            (("periodTotals","current","orders","netAmountPerOrder","unit"), ["CNY_CENT_PER_ORDER"]),
            (("periodTotals","baseline","orders","netAmountPerOrder","reasonCode"), ["no_records"]),
            (("periodTotals","current","orders","netAmountPerOrder","value"), 999),
            (("periodTotals","current","orders","trustedOrderCount"), False),
            (("periodTotals","baseline","values","netSalesCents"), 0),
            (("periodTotals","current","observations","observedDateRanges"), []),
            (("items",0,"current","observations","observedDateRanges"), []),
            (("periodTotals","current","observations","observedDateRanges"), [{"startDate":"2026-07-31","endDate":"2026-08-02"}]),
            (("periodTotals","current","observations","observedDateRanges"), [{"startDate":"2026-08-01","endDate":"2026-08-03"}]),
            (("periodTotals","current","observations","observedDateRanges"), [{"startDate":"2026-02-29","endDate":"2026-08-02"}]),
            (("periodTotals","current","observations","observedDateRanges"), [{"startDate":"2026-08-01","endDate":"2026-08-01"},{"startDate":"2026-08-02","endDate":"2026-08-02"}]),
            (("periodTotals","current","observations","observedDateCount"), True),
            (("periodTotals","current","observations","completeness"), "complete"),
            (("candidatePagination","filteredCount"), True), (("candidatePagination","pageSize"), 0.5),
            (("latestRelevantBatch","rowCount"), 9007199254740992), (("sourceRevisions",0,"kind"), ["sales_erp_revision_pair"]),
            (("metricMetadata","quantity","unit"), "COUNT"), (("metricMetadata","cost","zeroCostVerification"), "validatedZero"),
            (("metricSemantics","costCents"), ["verified"]),
        ]
        for path, value in changes:
            data = deepcopy(original); node = data
            for key in path[:-1]: node = node[key]
            node[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(NetshopApiError) as rejected: self.read(data)
            self.assertEqual(rejected.exception.code, "invalid_sales_periods_contract")
        for mutation in (lambda d:d["items"].reverse(), lambda d:d["items"].__setitem__(1,deepcopy(d["items"][0])), lambda d:d["periodTotals"]["current"]["observations"]["observedDateRanges"].append(deepcopy(d["periodTotals"]["current"]["observations"]["observedDateRanges"][0]))):
            data = deepcopy(original); mutation(data)
            with self.assertRaises(NetshopApiError): self.read(data)

    def test_nested_unknown_fields_fail_at_every_declared_boundary(self):
        original = fixture()
        for path in [(),("requestedScope",),("periods","current"),("periodTotals","current"),("periodTotals","current","values"),("periodTotals","current","orders"),("periodTotals","current","orders","netAmountPerOrder"),("periodTotals","current","observations"),("periodTotals","current","observations","observedDateRanges",0),("items",0),("items",0,"identity"),("candidatePagination",),("sourceRevisions",0),("latestRelevantBatch",),("metricMetadata",),("metricMetadata","cost")]:
            data = deepcopy(original); node = data
            for key in path: node = node[key]
            node["unknown"] = "not-declared"
            with self.subTest(path=path), self.assertRaises(NetshopApiError): self.read(data)

    def test_explicit_raw_scope_cannot_accept_a_second_or_switched_candidate(self):
        # Mutated actual full response still has a valid canonical foreign key;
        # explicit selected scope is a separate mandatory check, not just key syntax.
        data = fixture(); selected = deepcopy(data["items"][0]["identity"])
        request = {**REQUEST,"rawOutlets":[selected]}; data["requestedScope"]["rawOutlets"] = [selected]
        with self.assertRaises(NetshopApiError): self.read(data, request)
        data["items"][1]["identity"] = {"platform":"京东","rawShopName":"ZZ-FOREIGN-Q店","rawChannel":"FOREIGN-Q渠道"}
        identity = data["items"][1]["identity"]
        data["items"][1]["identityKey"] = json.dumps([identity[k] for k in ("platform","rawShopName","rawChannel")],ensure_ascii=False,separators=(",",":"))
        with self.assertRaises(NetshopApiError): self.read(data, request)

    def test_actual_registered_http_envelopes_consume_without_weakening_quality(self):
        directory = ROOT/"tests/fixtures/netshop-sales-periods-registered"
        for path in directory.glob("registered-*.json"):
            if path.name.endswith(".meta.json"): continue
            metadata = json.loads(path.with_name(path.stem+".meta.json").read_text(encoding="utf8"))
            envelope = json.loads(path.read_text(encoding="utf8"))
            data = self.read(envelope["data"], metadata["request"])
            self.assertEqual(data["metricMetadata"]["cost"]["verification"], "unverified_source")
            self.assertEqual(data["sourceRevisions"][0]["revision"], metadata["headers"]["X-Sales-Data-Revision"])
        # This test is gated by actual captures committed after the HTTP run.
        self.assertTrue((directory/"registered-full.json").exists())

    def test_actual_single_selected_http_candidate_cannot_switch_to_foreign_canonical_key(self):
        directory=ROOT/"tests/fixtures/netshop-sales-periods-registered"
        metadata=json.loads((directory/"registered-restricted.meta.json").read_text(encoding="utf8"))
        data=json.loads((directory/"registered-restricted.json").read_text(encoding="utf8"))["data"]
        self.assertEqual(len(data["items"]),1)
        self.assertEqual(self.read(data,metadata["request"]),data)
        identity={"platform":"京东","rawShopName":"FOREIGN-Q店","rawChannel":"FOREIGN-Q渠道"}
        data["items"][0]["identity"]=identity
        data["items"][0]["identityKey"]=json.dumps([identity[key] for key in ("platform","rawShopName","rawChannel")],ensure_ascii=False,separators=(",",":"))
        with self.assertRaises(NetshopApiError) as rejected:self.read(data,metadata["request"])
        self.assertEqual(rejected.exception.code,"invalid_sales_periods_contract")
