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
from netshop.models import NetshopDataRevision, NetshopRow
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
        self.calls.append({"request": deepcopy(request), "deadline": deadline, "remainingBudgetSeconds":deadline-time.monotonic()})
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

    def test_native_money_cost_order_evidence_and_one_primed_series_final_rpc(self):
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
        self.assertEqual(result["sections"]["trends"]["items"][0]["current"][0]["metric"]["value"],800)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[1]["request"]["expectedRevision"], "7:3")
        self.assertNotIn("snapshotToken",self.calls[1]["request"])
        self.assertEqual(self.calls[2]["request"]["snapshotToken"], evidence["source"]["snapshotToken"])
        self.assertEqual(len({c["deadline"] for c in self.calls}),1)
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
        for failure_call in (1,2,3):
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
        for call in (1,2,3):
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
            if count == 3 and when == "after": NetshopDataRevision.objects.filter(domain="netshop").update(revision=2,source_digest="b"*64)
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

    def test_owned_day_week_month_two_shops_distinct_orders_and_full_summary(self):
        second="志高商用厨电旗舰店"
        self.pair(shop=second)
        self.line(day="2026-09-01",allocated_amount_cents=100,cost_amount_cents=20,order_no="same-order")
        self.line(day="2026-09-02",allocated_amount_cents=200,cost_amount_cents=40,order_no="same-order")
        self.line(day="2026-09-05",allocated_amount_cents=0,cost_amount_cents=0,order_no="zero-order")
        self.line(day="2026-09-06",allocated_amount_cents=-20,cost_amount_cents=-4,quantity=-1,order_no="return-order")
        self.line(canonical=second,day="2026-09-01",allocated_amount_cents=400,cost_amount_cents=80,order_no="same-order")
        for canonical in (self.canonical,second):self.line(canonical=canonical,day="2026-08-25",allocated_amount_cents=50,cost_amount_cents=10,order_no="baseline")
        baseline={"kind":"custom","startDate":"2026-08-25","endDate":"2026-08-31"}
        for grain in ("day","week","month"):
            self.calls.clear()
            values={"endDate":"2026-09-07","selectedBaseline":baseline,"trendGrain":grain,"chartObjectKeys":["shop:京东\x1f"+self.canonical,"shop:京东\x1f"+second]}
            result=self.erp(**values)
            self.assertEqual(len(self.calls),3)
            source=result["sections"]["comparability"]["erpEvidence"]["source"]
            self.assertEqual(len(source["series"]["items"]),2)
            self.assertEqual(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"],680)
            self.assertEqual(result["sections"]["comparability"]["erpEvidence"]["temporalState"],{"state":"ready","code":None})
            first=next(t for t in result["sections"]["trends"]["items"] if t["objectKey"].endswith(self.canonical))
            if grain=="day":
                self.assertEqual(len(first["current"]),7)
                self.assertEqual(first["current"][4]["metric"]["value"],0)
                self.assertEqual(first["current"][5]["metric"]["value"],-20)
                self.assertIsNone(first["current"][2]["metric"]["value"])
                self.assertEqual(first["current"][2]["metric"]["reasonCode"],"no_records")
            else:
                self.assertEqual(first["current"][0]["metric"]["value"],280)
                from sales.netshop_period_series import restore_period_point
                own=next(i for i in source["series"]["items"] if i["identity"]["rawShopName"]==sales_alias("京东",self.canonical)["rawShopName"])
                self.assertEqual(restore_period_point(own["current"][0])["facts"]["orders"]["trustedOrderCount"],3)
            for point in first["current"]:
                observation=result["sections"]["comparability"]["erpEvidence"]["observations"][point["metric"]["coverageRef"]]
                self.assertEqual((observation["startDate"],observation["endDate"]),(point["date"],point["bucketEnd"]))
                self.assertEqual(observation["completeness"],"unknown")
            self.evidence("actual-owning-erp-series-"+grain,result,**values)

    def test_primed_plot_absent_both_and_baseline_only_no_false_current_zero(self):
        no_erp="志高商用厨电旗舰店"
        self.pair(shop=no_erp)
        self.line(day="2026-08-31",allocated_amount_cents=77)
        result=self.erp(chartObjectKeys=["shop:京东\x1f"+self.canonical,"shop:京东\x1f"+no_erp])
        self.assertEqual(len(self.calls),3)
        self.assertEqual(len(self.calls[1]["request"]["seriesOutlets"]),1)
        for series in result["sections"]["trends"]["items"]:
            self.assertIsNone(series["current"][0]["metric"]["value"])
            self.assertEqual(series["current"][0]["metric"]["reasonCode"],"no_records")
        self.assertEqual(next(t for t in result["sections"]["trends"]["items"] if t["objectKey"].endswith(self.canonical))["baseline"][0]["metric"]["value"],77)

    def _representative_four_raw_series(self, day_count, expect_capacity_rejection=False):
        from datetime import date,timedelta
        from netshop.sales_client import CONTROLLED_JD_ALIASES
        names=list(CONTROLLED_JD_ALIASES)
        for name in names:
            if name!=self.canonical:self.pair(shop=name)
        windows=[date(2025,3,1),date(2023,1,1)]
        rows=[]
        for name in names:
            alias=sales_alias("京东",name)
            for start in windows:
                for index in range(day_count):
                    day=(start+timedelta(days=index)).isoformat();self.line_counter+=1
                    rows.append(make_line(self.line_counter,"max-series-"+str(self.line_counter),platform="京东",shop_name=alias["rawShopName"],channel=alias["rawChannel"],ship_time=day+" 10:00:00",allocated_amount_cents=100,cost_amount_cents=40,gross_profit_cents=20,order_no="weekly-order-"+str(index//7)))
        SalesOrderLine.objects.bulk_create(rows,batch_size=500)
        values={"startDate":"2025-03-01","endDate":(windows[0]+timedelta(days=day_count-1)).isoformat(),"selectedBaseline":{"kind":"custom","startDate":"2023-01-01","endDate":(windows[1]+timedelta(days=day_count-1)).isoformat()},"chartObjectKeys":["shop:京东\x1f"+n for n in names]}
        actual_builder=C.build_comparison_result
        def measured(*args,**kwargs):
            response=actual_builder(*args,**kwargs)
            target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
            if target:
                with (Path(target)/("erp-series-"+str(day_count)+"-"+args[0]["trendGrain"]+"-body-sizes.json")).open("x",encoding="utf8") as out:
                    json.dump({"bytes":len(json.dumps(response,ensure_ascii=False).encode("utf8")),"fields":{key:len(json.dumps(value,ensure_ascii=False).encode("utf8")) for key,value in response.items()},"sections":{key:len(json.dumps(value,ensure_ascii=False).encode("utf8")) for key,value in response["sections"].items()}},out,indent=2)
            return response
        before=time.monotonic()
        with patch.object(C,"build_comparison_result",measured):
            if expect_capacity_rejection:
                failure=self.assert_error(422,lambda:self.erp(**values))
                self.assertEqual(failure.code,"quality_incomplete")
                self.assertEqual(len(self.calls),2)
                target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
                results=[]
                for grain in ("week","month"):
                    self.calls.clear();before=time.monotonic()
                    response=self.erp(**{**values,"trendGrain":grain})
                    size=len(json.dumps(response,ensure_ascii=False).encode("utf8"))
                    self.assertLess(size,2*1024*1024)
                    results.append({"grain":grain,"daysEachPeriod":day_count,"bytes":size,"seconds":time.monotonic()-before,"points":sum(len(t[p]) for t in response["sections"]["trends"]["items"] for p in ("current","baseline")),"rpcCalls":len(self.calls)})
                    self.evidence("actual-owning-erp-series-max-"+grain,response,**{**values,"trendGrain":grain})
                if target:
                    with (Path(target)/"erp-series-max-supported-grains.json").open("x",encoding="utf8") as out:json.dump(results,out,indent=2)
                return
            result=self.erp(**values)
        seconds=time.monotonic()-before
        encoded=json.dumps(result,ensure_ascii=False).encode("utf8")
        self.assertEqual(len(self.calls),3)
        self.assertEqual(sum(len(t[p]) for t in result["sections"]["trends"]["items"] for p in ("current","baseline")),8*day_count)
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"],400*day_count)
        self.assertLess(len(encoded),2*1024*1024);self.assertLess(seconds,65)
        self.evidence("actual-owning-erp-series-representative",result,**values)
        target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if target:
            with (Path(target)/"erp-series-representative.json").open("x",encoding="utf8") as out:json.dump({"rawOutlets":4,"daysEachPeriod":day_count,"points":8*day_count,"sourceRows":8*day_count,"seconds":seconds,"bytes":len(encoded),"rpcCalls":len(self.calls),"sameOuterDeadline":len({c["deadline"] for c in self.calls})==1},out,indent=2)

    def test_representative_four_raw_two_120_day_windows_all_points_and_budget(self):
        self._representative_four_raw_series(120)

    def test_four_raw_two_366_legal_windows_whole_response_honestly_rejects_capacity(self):
        self._representative_four_raw_series(366,True)

    def _platform_fixture(self, count=5, *, with_tmall=False, rows=True):
        """Explicit synthetic alias fixture only; all business facts use the owner."""
        NetshopRow.objects.all().delete()
        aliases = {}
        for platform, number in [("京东", count), ("天猫", int(with_tmall))]:
            for index in range(number):
                name = "合成平台店"+str(index).zfill(2)
                aliases[(platform, name)] = {"platform": platform, "canonicalShopName": name, "rawShopName": " RAW "+name+" ", "rawChannel": " exact channel "+str(index)+" "}
                self.pair(platform=platform, shop=name)
                if rows:
                    self.line(day="2026-09-01", platform=platform, shop_name=aliases[(platform,name)]["rawShopName"], channel=aliases[(platform,name)]["rawChannel"], allocated_amount_cents=100, order_no="same-order")
                    self.line(day="2026-08-25", platform=platform, shop_name=aliases[(platform,name)]["rawShopName"], channel=aliases[(platform,name)]["rawChannel"], allocated_amount_cents=50, order_no="same-order")
        return aliases

    def _platform_read(self, *, metricKey="erpNetSales", **values):
        return self.read(comparisonScope=self.scope(mode="platform", metricSource="erp"), metricKey=metricKey, **values)

    def _platform_evidence(self, name, result, *, metricKey="erpNetSales", **values):
        params = self.query(comparisonScope=self.scope(mode="platform", metricSource="erp"), metricKey=metricKey, **values)
        self.sample(name, result, params)
        target = os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if target:
            with (Path(target)/(name+"-rpc-layer.json")).open("x", encoding="utf8") as out:
                json.dump({"layer":"real_owning_reader_injected_transport_private_postgresql", "aliasFixture":"test_only_explicit_injective_raw_triples", "hmacLayer":"published_registered_http_suite_separate", "bytes":len(json.dumps(result,ensure_ascii=False).encode("utf8")), "requests":[{"request":{k:v for k,v in c["request"].items() if k!="expiresAtEpochMs"}, "deadlineShared":c["deadline"]==self.calls[0]["deadline"], "remainingBudgetSeconds":c["remainingBudgetSeconds"], "expiresAtEpochMs":c["request"]["expiresAtEpochMs"]} for c in self.calls]},out,ensure_ascii=False,indent=2)

    def test_platform_owned_day_week_month_more_than_four_raw_full_candidates(self):
        from sales.netshop_period_series import restore_period_point
        aliases = self._platform_fixture(with_tmall=True)
        names = [name for (platform,name) in aliases if platform=="京东"]
        first = aliases[("京东",names[0])]
        self.line(day="2026-09-02", shop_name=first["rawShopName"], channel=first["rawChannel"], allocated_amount_cents=200, order_no="same-order")
        self.line(day="2026-09-05", shop_name=first["rawShopName"], channel=first["rawChannel"], allocated_amount_cents=0, order_no="zero-order")
        self.line(day="2026-09-06", shop_name=first["rawShopName"], channel=first["rawChannel"], quantity=-1, allocated_amount_cents=-20, order_no="return-order")
        # A baseline-only member remains in the full authorized platform union.
        last = aliases[("京东",names[-1])]
        SalesOrderLine.objects.filter(shop_name=last["rawShopName"],business_date="2026-09-01").delete()
        # A current-only member also remains; neither period can shrink the union.
        current_only = aliases[("京东",names[1])]
        SalesOrderLine.objects.filter(shop_name=current_only["rawShopName"],business_date="2026-08-25").delete()
        values = {"platform":["京东","天猫"], "endDate":"2026-09-07", "selectedBaseline":{"kind":"custom","startDate":"2026-08-25","endDate":"2026-08-31"}, "chartObjectKeys":["platform:京东"]}
        with patch("netshop.comparison_adapter.sales_alias", side_effect=lambda p,n:aliases.get((p,n),sales_alias(p,n))):
            for grain in ("day","week","month"):
                self.calls.clear()
                result = self._platform_read(**values, trendGrain=grain)
                evidence = result["sections"]["comparability"]["erpEvidence"]
                group = evidence["source"]["platformSeries"]["items"][0]
                self.assertEqual((group["rawCandidateCount"],len(group["rawMembers"])),(5,5))
                self.assertEqual(len(evidence["source"]["items"]),6)
                self.assertEqual(len(result["sections"]["scale"]["items"]),2)
                self.assertEqual(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"],680)
                self.assertEqual(result["sections"]["trends"]["items"][0]["objectKey"],"platform:京东")
                self.assertEqual(evidence["temporalState"],{"state":"ready","code":None})
                self.assertEqual(self.calls[1]["request"]["seriesPlatforms"],["京东"])
                self.assertNotIn("seriesOutlets",self.calls[1]["request"])
                self.assertEqual(len(self.calls),5)
                self.assertEqual(self.calls[1]["request"]["expectedRevision"],"7:3")
                self.assertNotIn("snapshotToken",self.calls[1]["request"])
                self.assertEqual(self.calls[-1]["request"]["snapshotToken"],evidence["source"]["snapshotToken"])
                self.assertEqual(len({c["deadline"] for c in self.calls}),1)
                self.assertGreater(self.calls[0]["remainingBudgetSeconds"],self.calls[1]["remainingBudgetSeconds"])
                self.assertTrue(all(a["remainingBudgetSeconds"]>b["remainingBudgetSeconds"] for a,b in zip(self.calls,self.calls[1:])))
                self.assertEqual(sorted(c["request"]["expiresAtEpochMs"] for c in self.calls),[c["request"]["expiresAtEpochMs"] for c in reversed(self.calls)])
                self.assertEqual([carrier["platform"] for carrier in evidence["platformPeriods"]],["京东","天猫"])
                rows={row["platform"]:row for row in result["sections"]["scale"]["items"]}
                self.assertEqual(rows["京东"]["current"]["erpNetSales"]["value"],580)
                self.assertEqual(rows["天猫"]["current"]["erpNetSales"]["value"],100)
                for carrier in evidence["platformPeriods"]:
                    self.assertEqual(carrier["request"]["expectedRevision"],"7:3")
                    self.assertFalse(any(key.startswith("series") for key in carrier["request"]))
                    self.assertEqual(carrier["source"]["items"],[item for item in evidence["source"]["items"] if item["identity"]["platform"]==carrier["platform"]])
                self.assertEqual(len([v for v in result["joinedSourceRevisions"] if v["domain"]=="sales"]),3)
                trend = result["sections"]["trends"]["items"][0]
                if grain=="day":
                    self.assertEqual([p["metric"]["value"] for p in trend["current"]],[400,200,None,None,0,-20,None])
                    self.assertEqual(trend["current"][2]["metric"]["reasonCode"],"no_records")
                else:
                    self.assertEqual(trend["current"][0]["metric"]["value"],580)
                    self.assertEqual(restore_period_point(group["current"][0])["facts"]["orders"]["trustedOrderCount"],6)
                for period in ("current","baseline"):
                    for point in trend[period]:
                        observation = evidence["observations"][point["metric"]["coverageRef"]]
                        self.assertEqual((observation["startDate"],observation["endDate"]),(point["date"],point["bucketEnd"]))
                        self.assertEqual(observation["completeness"],"unknown")
                        self.assertNotEqual(point["metric"]["status"],"available")
                self._platform_evidence("actual-owning-erp-platform-"+grain,result,**values,trendGrain=grain)
            both={**values,"chartObjectKeys":["platform:京东","platform:天猫"]}
            for grain in ("day","week","month"):
                self.calls.clear()
                result=self._platform_read(**both,trendGrain=grain)
                self.assertEqual(self.calls[1]["request"]["seriesPlatforms"],["京东","天猫"])
                self.assertEqual(len(self.calls),5)
                self.assertEqual(len(result["sections"]["trends"]["items"]),2)
                self._platform_evidence("actual-owning-erp-platform-both-"+grain,result,**both,trendGrain=grain)
            self.calls.clear()
            result=self._platform_read(**both,metricKey="erpNetQuantity")
            rows={row["platform"]:row for row in result["sections"]["scale"]["items"]}
            self.assertEqual(result["sections"]["scale"]["summary"]["current"]["erpNetQuantity"]["value"],6)
            self.assertEqual(rows["京东"]["current"]["erpNetQuantity"]["value"],5)
            self.assertEqual(rows["天猫"]["current"]["erpNetQuantity"]["value"],1)
            self.assertEqual(len(self.calls),5)
            self.assertTrue(all(point["metric"]["unit"]=="NATIVE_INTEGER_QUANTITY" for item in result["sections"]["trends"]["items"] for period in ("current","baseline") for point in item[period]))
            self._platform_evidence("actual-owning-erp-platform-both-quantity-day",result,**both,metricKey="erpNetQuantity")

    def test_platform_authorized_empty_group_and_unmapped_platform(self):
        aliases = self._platform_fixture(count=1, rows=False)
        self.pair(platform="天猫",shop="unmapped")
        with patch("netshop.comparison_adapter.sales_alias",side_effect=lambda p,n:aliases.get((p,n),sales_alias(p,n))):
            result=self._platform_read(platform=["京东","天猫"],chartObjectKeys=["platform:京东","platform:天猫"])
        evidence=result["sections"]["comparability"]["erpEvidence"]
        self.assertEqual(self.calls[1]["request"]["seriesPlatforms"],["京东"])
        group=evidence["source"]["platformSeries"]["items"][0]
        self.assertEqual((group["rawMembers"],group["rawCandidateCount"]),([],0))
        trends={t["objectKey"]:t for t in result["sections"]["trends"]["items"]}
        for period in ("current","baseline"):
            self.assertEqual(trends["platform:京东"][period][0]["metric"]["reasonCode"],"no_records")
            self.assertEqual(trends["platform:天猫"][period][0]["metric"]["reasonCode"],"unmapped")
            self.assertIsNone(trends["platform:京东"][period][0]["metric"]["value"])
        self._platform_evidence("actual-owning-erp-platform-empty",result,platform=["京东","天猫"],chartObjectKeys=["platform:京东","platform:天猫"])

    def test_platform_full_fifty_members_then_hidden_forty_nine_fail_closed(self):
        from netshop import comparison_adapter as adapter
        aliases=self._platform_fixture(count=50)
        with patch("netshop.comparison_adapter.sales_alias",side_effect=lambda p,n:aliases[(p,n)]):
            result=self._platform_read(chartObjectKeys=["platform:京东"],trendGrain="month")
            source=result["sections"]["comparability"]["erpEvidence"]["source"]
            self.assertEqual((len(source["items"]),len(source["platformSeries"]["items"][0]["rawMembers"])),(50,50))
            self._platform_evidence("actual-owning-erp-platform-fifty",result,chartObjectKeys=["platform:京东"],trendGrain="month")
            actual=adapter.read_sales_periods
            def hide_one(*args,**kwargs):
                data,pair=actual(*args,**kwargs)
                if data.get("platformSeries"):
                    data=deepcopy(data)
                    group=data["platformSeries"]["items"][0]
                    group["rawMembers"].pop();group["rawCandidateCount"]-=1
                return data,pair
            self.calls.clear()
            with patch.object(adapter,"read_sales_periods",side_effect=hide_one):
                rejected=self._platform_read(chartObjectKeys=["platform:京东"],trendGrain="month")
            failed=rejected["sections"]["comparability"]["erpEvidence"]
            self.assertEqual((failed["state"],failed["code"]),("error","invalid_sales_platform_membership"))
            self.assertIsNone(failed["source"])
            self.assertFalse(any(v["domain"]=="sales" for v in rejected["joinedSourceRevisions"]))

    def test_platform_three_rpc_late_source_errors_authority_and_same_pair_change(self):
        aliases=self._platform_fixture(count=1)
        with patch("netshop.comparison_adapter.sales_alias",side_effect=lambda p,n:aliases[(p,n)]):
            for status in (503,403,409):
                self.calls.clear()
                def error(count,when):
                    if count==3 and when=="before":raise NetshopApiError("synthetic late ERP failure",code="synthetic_erp_late",status=status)
                self.hook=error
                if status==503:
                    result=self._platform_read(chartObjectKeys=["platform:京东"])
                    evidence=result["sections"]["comparability"]["erpEvidence"]
                    self.assertEqual((evidence["state"],evidence["source"]),("error",None))
                    self.assertEqual(evidence["code"],"synthetic_erp_late")
                    self.assertFalse(any(v["domain"]=="sales" for v in result["joinedSourceRevisions"]))
                    self.assertTrue(all(p["metric"]["value"] is None for t in result["sections"]["trends"]["items"] for period in ("current","baseline") for p in t[period]))
                else:self.assert_error(status,lambda:self._platform_read(chartObjectKeys=["platform:京东"]))
                self.assertEqual(len(self.calls),3)
            self.calls.clear()
            def change(count,when):
                if count==1 and when=="after":SalesOrderLine.objects.filter(business_date="2026-09-01").update(allocated_amount_cents=999)
            self.hook=change
            self.assert_error(409,lambda:self._platform_read(chartObjectKeys=["platform:京东"]))

    def test_platform_parent_deadline_actor_and_native_order_quantity_projection(self):
        aliases=self._platform_fixture(count=2)
        first=aliases[("京东","合成平台店00")]
        self.line(day="2026-09-02",shop_name=first["rawShopName"],channel=first["rawChannel"],order_no="same-order",allocated_amount_cents=-20,quantity=-2)
        with patch("netshop.comparison_adapter.sales_alias",side_effect=lambda p,n:aliases[(p,n)]):
            for key,expected in (("erpOrderCount",2),("erpNetQuantity",0),("returnQuantity",2)):
                result=self.read(endDate="2026-09-07",comparisonScope=self.scope(mode="platform",metricSource="erp"),metricKey=key,trendGrain="week",chartObjectKeys=["platform:京东"])
                metric=result["sections"]["trends"]["items"][0]["current"][0]["metric"]
                self.assertEqual((metric["value"],metric["status"]),(expected,"partial"))
                if key!="erpOrderCount":self.assertEqual(metric["unit"],"NATIVE_INTEGER_QUANTITY")
            for call in (1,2,3):
                clock=[0.0];self.calls.clear()
                def expires(count,when):
                    if count==call and when=="after":clock[0]=66.0
                self.hook=expires
                with patch("netshop.comparison_insights.time.monotonic",side_effect=lambda:clock[0]):
                    self.assert_error(503,lambda:self._platform_read(chartObjectKeys=["platform:京东"]))
                self.assertEqual(len(self.calls),call)
            self.calls.clear()
            def revoke(count,when):
                if count==3 and when=="after":AppUser.objects.filter(pk=self.user.pk).update(status="disabled")
            self.hook=revoke
            self.assert_error(403,lambda:self._platform_read(chartObjectKeys=["platform:京东"]))

    def test_platform_representative_fifty_raw_60000_product_facts_two_thirty_day_periods(self):
        from datetime import date,timedelta
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        from netshop.models import NetshopImportBatch
        aliases=self._platform_fixture(count=49,with_tmall=True,rows=False)
        dates=[(date(2026,month,1)+timedelta(days=i)).isoformat() for month in (8,9) for i in range(30)]
        NetshopRow.objects.all().delete()
        rows=[]
        for index,((platform,name),alias) in enumerate(aliases.items()):
            source="jd_sku_daily" if platform=="京东" else "tmall_product_daily"
            batch=NetshopImportBatch.objects.create(id=f"platform-scale-{index}",source=source,dataset="spu_daily",platform=platform,shop_name=name,file_size_bytes=1,file_hash=f"{index+1:064x}",raw_file_hash="a"*64,content_hash="b"*64,scope_key="c"*64,status="completed",row_count=1200,date_min=dates[0],date_max=dates[-1])
            facts=[NetshopRow(source_row_key=f"platform-scale-{index}-{day}-{product}",source_row_hash="d"*64,first_import_batch_id=batch.id,last_import_batch_id=batch.id,source_row_number=i+2,source=source,dataset="spu_daily",platform=platform,shop_name=name,business_date=day,spu_id=f"P{product:02}",sku_id=f"SKU{product:02}",category="Synthetic category",product_name="Synthetic scale",metrics_json={"transactionAmountCents":1000,"transactionQuantity":2,"visitors":100,"transactionCustomers":10},transaction_amount_cents=1000,transaction_quantity=2,visitors=100,transaction_customers=10) for i,(day,product) in enumerate((day,product) for day in dates for product in range(20))]
            NetshopRow.objects.bulk_create(facts,batch_size=500)
            for day in dates:
                self.line_counter+=1
                rows.append(make_line(self.line_counter,"platform-scale-erp-"+str(self.line_counter),platform=platform,shop_name=alias["rawShopName"],channel=alias["rawChannel"],ship_time=day+" 10:00:00",allocated_amount_cents=100,cost_amount_cents=40,order_no="weekly-order-"+str(date.fromisoformat(day).isocalendar().week)))
        SalesOrderLine.objects.bulk_create(rows,batch_size=500)
        values={"platform":["京东","天猫"],"endDate":"2026-09-30","selectedBaseline":{"kind":"custom","startDate":"2026-08-01","endDate":"2026-08-30"},"chartObjectKeys":["platform:京东","platform:天猫"]}
        before=time.monotonic()
        with patch("netshop.comparison_adapter.sales_alias",side_effect=lambda p,n:aliases[(p,n)]),CaptureQueriesContext(connection) as queries:
            result=self._platform_read(**values)
        elapsed=time.monotonic()-before
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"],30_000_000)
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"],150_000)
        self.assertEqual(sum(len(item["rawMembers"]) for item in result["sections"]["comparability"]["erpEvidence"]["source"]["platformSeries"]["items"]),50)
        self.assertEqual(len(self.calls),5)
        self.assertEqual(len(result["sections"]["trends"]["items"][0]["current"]),30)
        size=len(json.dumps(result,ensure_ascii=False).encode("utf8"))
        self.assertLess(size,2*1024*1024);self.assertLess(elapsed,65)
        self._platform_evidence("actual-owning-erp-platform-representative",result,**values)
        target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if target:
            with (Path(target)/"erp-platform-representative.json").open("x",encoding="utf8") as out:
                json.dump({"synthetic":True,"productFacts":60000,"erpFacts":3000,"rawOutlets":50,"daysEachPeriod":30,"points":120,"seconds":elapsed,"sqlCount":len(queries),"sqlWallSeconds":sum(float(q["time"]) for q in queries),"responseUtf8Bytes":size,"rpcCalls":len(self.calls)},out,indent=2)

    def test_platform_child_carriers_late_error_authority_and_global_same_pair_fence(self):
        aliases=self._platform_fixture(count=1,with_tmall=True)
        with patch("netshop.comparison_adapter.sales_alias",side_effect=lambda p,n:aliases[(p,n)]):
            for call in (3,4,5):
                for status in (503,401,403,409):
                    self.calls.clear()
                    def fails(count,when):
                        if count==call and when=="before":raise NetshopApiError("synthetic child/parent failure",code="synthetic_carrier_failure",status=status)
                    self.hook=fails
                    values={"platform":["京东","天猫"],"chartObjectKeys":["platform:京东","platform:天猫"]}
                    if status==503:
                        result=self._platform_read(**values)
                        evidence=result["sections"]["comparability"]["erpEvidence"]
                        self.assertEqual((evidence["state"],evidence["source"]),("error",None))
                        self.assertNotIn("platformPeriods",evidence)
                        self.assertEqual(evidence["temporalState"],{"state":"unavailable","code":"source_error"})
                        self.assertFalse(any(v["domain"]=="sales" for v in result["joinedSourceRevisions"]))
                        self.assertTrue(all(row[p]["erpNetSales"]["value"] is None for row in result["sections"]["scale"]["items"] for p in ("current","baseline")))
                    else:self.assert_error(status,lambda:self._platform_read(**values))
                    self.assertEqual(len(self.calls),call)
            self.calls.clear()
            def changed(count,when):
                if count==3 and when=="before":SalesOrderLine.objects.filter(platform="京东",business_date="2026-09-01").update(allocated_amount_cents=999)
            self.hook=changed
            self.assert_error(409,lambda:self._platform_read(platform=["京东","天猫"],chartObjectKeys=["platform:京东"]))
