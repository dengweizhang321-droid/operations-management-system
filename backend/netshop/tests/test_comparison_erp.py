"""C ERP integration via the real private-PG owner, with injected RPC transport.

Business responses are never mocked. Signed registered HTTP/HMAC is independently
covered by the published sales_periods_http suite; this layer verifies C joins.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import time
from unittest.mock import patch

from django.db.models import F
from django.test import TestCase
from django.utils import timezone

from access_control.models import AppUser
from sales.auth import Principal
from sales.models import SalesDataRevision, SalesOrderLine
from sales.netshop_periods import read_netshop_periods, NetshopPeriodsError
from sales.tests.factories import install_fixture, make_line
from netshop import comparison_insights as C
from netshop.comparison_adapter import validate_comparison_metric
from netshop.errors import NetshopApiError
from netshop.models import NetshopDataRevision
from netshop.sales_client import sales_alias
from netshop.tests import test_comparison_insights as fixture


class ComparisonErpTests(TestCase):
    fact = fixture.ComparisonInsightsTests.fact
    query = fixture.ComparisonInsightsTests.query
    scope = fixture.ComparisonInsightsTests.scope
    pair = fixture.ComparisonInsightsTests.pair
    read = fixture.ComparisonInsightsTests.read
    assert_error = fixture.ComparisonInsightsTests.assert_error
    sample = fixture.ComparisonInsightsTests.sample
    canonical = "志高商用设备旗舰店"

    def setUp(self):
        install_fixture()
        SalesOrderLine.objects.all().delete()
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a"*64})
        self.principal = Principal("comparison-erp@example.test", "Synthetic", "viewer", None)
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
        self.counter, self.line_counter, self.calls = 0, 100, []
        self.hook = None
        self.transport = patch("netshop.sales_periods_client.read_sales_consumer", self.owner_transport)
        self.transport.start(); self.addCleanup(self.transport.stop)
        self.pair(shop=self.canonical)

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision")+1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def owner_transport(self, principal, request, *, deadline):
        self.calls.append({"request": deepcopy(request), "deadline": deadline})
        if self.hook: self.hook(len(self.calls), "before")
        try:
            data = read_netshop_periods(principal, request, deadline=deadline)
        except NetshopPeriodsError as error:
            raise NetshopApiError(str(error), code=error.code, status=error.status) from error
        if self.hook: self.hook(len(self.calls), "after")
        return data, data["sourceRevisions"][0]["revision"]

    def line(self, *, canonical=None, day="2026-09-01", **values):
        alias = sales_alias("京东", canonical or self.canonical)
        self.line_counter += 1
        fields = {"platform": alias["platform"], "shop_name": alias["rawShopName"], "channel": alias["rawChannel"], "ship_time": day+" 10:00:00", **values}
        row = make_line(self.line_counter, "comparison-erp-"+str(self.line_counter), **fields)
        SalesOrderLine.objects.bulk_create([row])
        return row

    def erp(self, **values):
        return self.read(comparisonScope=self.scope(metricSource="erp"), metricKey="erpNetSales", **values)

    def evidence(self, name, result, **query):
        params = self.query(comparisonScope=self.scope(metricSource="erp"), metricKey="erpNetSales", **query)
        self.sample(name, result, params)
        target = os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if target:
            with (Path(target)/(name+"-rpc-layer.json")).open("x", encoding="utf-8") as out:
                json.dump({"layer": "real_owning_reader_injected_transport_private_postgresql", "hmacLayer": "published_registered_http_suite_separate", "requests": [{"request": {k:v for k,v in c["request"].items() if k != "expiresAtEpochMs"}, "deadlineShared": c["deadline"] == self.calls[0]["deadline"]} for c in self.calls]}, out, ensure_ascii=False)

    def test_native_money_cost_order_evidence_and_only_one_final_rpc(self):
        self.line(quantity=3, allocated_amount_cents=1000, cost_amount_cents=400, gross_profit_cents=123, order_no="trusted")
        self.line(quantity=-1, allocated_amount_cents=-200, cost_amount_cents=-80, gross_profit_cents=-21, order_no="trusted")
        self.line(day="2026-08-31", quantity=2, allocated_amount_cents=500, cost_amount_cents=100, gross_profit_cents=77)
        result = self.erp()
        metric = result["sections"]["scale"]["summary"]["current"]
        self.assertEqual((metric["erpNetSales"]["value"], metric["erpNetSales"]["status"]), (800, "partial"))
        self.assertEqual((metric["orderMargin"]["value"], metric["orderMargin"]["reasonCode"]), (102, "unverified_source"))
        self.assertEqual((metric["largeMarginAmount"]["value"], metric["largeMarginAmount"]["reasonCode"]), (480, "unverified_source"))
        self.assertEqual(metric["erpOrderCount"]["value"], 1)
        self.assertEqual(metric["erpNetQuantity"]["value"], 2)
        self.assertEqual(metric["returnQuantity"]["value"], 1)
        for key in ("erpNetQuantity", "returnQuantity"):
            self.assertEqual(metric[key]["unit"], "NATIVE_INTEGER_QUANTITY")
            self.assertEqual(metric[key]["metricSchemaVersion"], "netshop-comparison-native-quantity-v1")
        for key in ("largeMargin", "returnRate", "averageOrderValue"):
            self.assertIsNone(metric[key]["value"])
        evidence = result["sections"]["comparability"]["erpEvidence"]
        self.assertEqual(evidence["source"]["periodTotals"]["current"]["orders"]["netAmountPerOrder"]["unit"], "CNY_CENT_PER_ORDER")
        self.assertEqual(evidence["source"]["metricMetadata"]["cost"]["zeroCostVerification"], "unknown")
        ref = metric["erpNetSales"]["coverageRef"]
        observation = evidence["observations"][ref]
        self.assertEqual((observation["observedShopDatePairs"], observation["expectedShopDatePairs"], observation["completeness"]), (1, 1, "unknown"))
        self.assertNotIn(ref, result["sections"]["comparability"]["coverage"])
        self.assertFalse(result["sections"]["scale"]["items"][0]["qualification"]["comparable"])
        self.assertTrue(all(p["metric"]["reasonCode"] == "not_applicable" for p in result["sections"]["trends"]["items"][0]["current"]))
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[1]["request"]["expectedRevision"], "7:3")
        self.assertEqual(self.calls[1]["request"]["snapshotToken"], evidence["source"]["snapshotToken"])
        self.assertEqual(self.calls[0]["deadline"], self.calls[1]["deadline"])
        self.assertEqual(len([v for v in result["joinedSourceRevisions"] if v["domain"] == "sales"]), 1)
        self.evidence("actual-owning-erp", result)

    def test_exact_raw_alias_rejects_same_name_other_channel_platform_and_nulls(self):
        self.line(allocated_amount_cents=111)
        self.line(allocated_amount_cents=9999, channel="other channel")
        self.line(allocated_amount_cents=8888, platform="天猫")
        result = self.erp(selectedBaseline={"kind": "custom", "startDate": "2026-08-01", "endDate": "2026-08-01"})
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"], 111)
        self.assertIsNone(result["sections"]["scale"]["summary"]["baseline"]["erpNetSales"]["value"])
        observation = result["sections"]["comparability"]["erpEvidence"]["observations"][result["sections"]["scale"]["summary"]["baseline"]["erpNetSales"]["coverageRef"]]
        self.assertEqual(observation["observedShopDatePairs"], 0)
        self.assertEqual(self.calls[0]["request"]["rawOutlets"], [{k:sales_alias("京东",self.canonical)[k] for k in ("platform","rawShopName","rawChannel")}])

    def test_no_order_number_never_source_line_count_or_primary_average(self):
        self.line(order_no="", online_order_no="online-not-trusted")
        result = self.erp()
        primary = result["sections"]["scale"]["summary"]["current"]
        self.assertEqual(primary["erpOrderCount"]["value"], 0)
        self.assertEqual(primary["erpOrderCount"]["status"], "partial")
        self.assertIsNone(primary["averageOrderValue"]["value"])
        orders = result["sections"]["comparability"]["erpEvidence"]["source"]["periodTotals"]["current"]["orders"]
        self.assertEqual((orders["missingOrderNoRows"], orders["netAmountPerOrder"]["reasonCode"]), (1, "missing_order_no"))

    def test_unmapped_or_category_never_empty_all_domain_rpc(self):
        self.line()
        result = self.read(outlet="京东\x1funknown", comparisonScope=self.scope(metricSource="erp"), metricKey="erpNetSales")
        self.assertEqual(self.calls, [])
        self.assertEqual(result["sections"]["comparability"]["erpState"], {"state":"unavailable","code":"unmapped"})
        self.assertTrue(all(o["observedShopDatePairs"] is None for o in result["sections"]["comparability"]["erpEvidence"]["observations"].values()))
        category = {"mode":"label_only","platform":"京东","sourceId":"jd_sku_daily","label":"设备","evidenceVersion":"1:aaaaaaaaaaaa"}
        result = self.read(comparisonScope=self.scope(metricSource="erp",category=category),metricKey="erpNetSales")
        self.assertEqual(self.calls, [])
        self.assertIsNone(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"])

    def test_injective_alias_whitespace_preserved_and_ambiguous_not_double_counted(self):
        original = sales_alias("京东", self.canonical)
        padded = {**original, "rawShopName":" "+original["rawShopName"]+" ", "rawChannel":" "+original["rawChannel"]+" "}
        self.line(shop_name=padded["rawShopName"], channel=padded["rawChannel"], allocated_amount_cents=321)
        with patch("netshop.comparison_adapter.sales_alias", return_value=padded): result = self.erp()
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"], 321)
        self.assertEqual(self.calls[0]["request"]["rawOutlets"][0]["rawChannel"], padded["rawChannel"])
        self.calls.clear(); self.pair(shop="second")
        def duplicate(platform,name): return {**original,"canonicalShopName":name}
        with patch("netshop.comparison_adapter.sales_alias", side_effect=duplicate): result = self.erp()
        self.assertEqual(self.calls, [])
        self.assertTrue(all(m["status"] == "ambiguous" for m in result["sections"]["comparability"]["erpEvidence"]["mappings"]))

    def test_sales_revision_or_actor_change_is_whole_read_failure(self):
        self.line()
        def changes(count,when):
            if count == 1 and when == "after": SalesDataRevision.objects.filter(domain="sales").update(revision=8)
        self.hook=changes
        self.assert_error(409, lambda: self.erp())
        SalesDataRevision.objects.filter(domain="sales").update(revision=7); self.calls.clear()
        def revokes(count,when):
            if count == 1 and when == "after": AppUser.objects.filter(pk=self.user.pk).update(status="disabled")
        self.hook=revokes
        self.assert_error(403, lambda: self.erp())

    def test_503_initial_and_after_serialization_downgrade_erp_only_once(self):
        self.line()
        for failure_call in (1,2):
            self.calls.clear()
            def fails(count,when):
                if count == failure_call and when == "before": raise NetshopApiError("private synthetic unavailable",code="service_unavailable",status=503)
            self.hook=fails
            result=self.erp()
            self.assertEqual(result["sections"]["comparability"]["erpState"],{"state":"error","code":"service_unavailable"})
            self.assertIsNone(result["sections"]["comparability"]["erpEvidence"]["source"])
            self.assertIsNone(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"])
            self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"],1000)
            self.assertFalse(any(v["domain"] == "sales" for v in result["joinedSourceRevisions"]))
            self.assertEqual(len(self.calls),failure_call)

    def test_native_cannot_claim_available_or_fractional_event_count(self):
        self.line(quantity=-2,allocated_amount_cents=-200,cost_amount_cents=0)
        metric=self.erp()["sections"]["scale"]["summary"]["current"]["returnQuantity"]
        self.assertEqual(metric["value"],2)
        for changes in ({"status":"available","reasonCode":None},{"value":1.5}):
            self.assert_error(400,lambda:validate_comparison_metric({**metric,**changes}))

    def test_parent_deadline_covers_actual_remote_owner_and_final_recheck(self):
        self.line()
        for call in (1,2):
            clock=[0.0]; self.calls.clear()
            def expires(count,when):
                if count == call and when == "after": clock[0]=66.0
            self.hook=expires
            with patch("netshop.comparison_insights.time.monotonic",side_effect=lambda:clock[0]):
                self.assert_error(503,lambda:self.erp())
            self.assertEqual(len(self.calls),call)

    def test_netshop_change_during_last_rpc_still_invalidates_whole_join(self):
        self.line()
        def changes(count,when):
            if count == 2 and when == "after": NetshopDataRevision.objects.filter(domain="netshop").update(revision=2,source_digest="b"*64)
        self.hook=changes
        self.assert_error(409,lambda:self.erp())

    def test_unknown_cost_zero_is_observation_not_credible_zero_cost_margin(self):
        self.line(quantity=0,allocated_amount_cents=0,cost_amount_cents=0,gross_profit_cents=0)
        result=self.erp()
        metrics=result["sections"]["scale"]["summary"]["current"]
        self.assertEqual((metrics["erpNetSales"]["value"],metrics["erpNetSales"]["status"]),(0,"partial"))
        self.assertEqual((metrics["largeMarginAmount"]["value"],metrics["largeMarginAmount"]["reasonCode"]),(0,"unverified_source"))
        self.assertIsNone(metrics["largeMargin"]["value"])
        self.evidence("actual-owning-erp-zero",result)

    def test_erp_evidence_size_counts_in_whole_utf8_budget(self):
        self.line()
        actual=C.build_comparison_result
        def large(*args,**kwargs):
            response=actual(*args,**kwargs)
            response["sections"]["comparability"]["erpEvidence"]["source"]["metricSemantics"]["costCents"]="合"*(1024*1024)
            return response
        with patch.object(C,"build_comparison_result",large):self.assert_error(422,lambda:self.erp())
