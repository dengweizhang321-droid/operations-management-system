import hashlib,json,os
from pathlib import Path
from unittest.mock import patch
from . import test_sales_periods_http as prior
from netshop.sales_periods_client import read_sales_periods
from sales.models import SalesOrderLine
from sales.tests.factories import make_line


class PlatformSignedHttpTests(prior.RegisteredPeriodsHttpTests):
    @classmethod
    def source_snapshot(cls):
        source=super().source_snapshot()
        for name in ("backend/sales/netshop_platform_series.py","backend/sales/tests/test_netshop_platform_series.py","backend/netshop/tests/test_sales_periods_platform_http.py"):
            source["sha256"][name]=hashlib.sha256((prior.ROOT/name).read_bytes()).hexdigest()
        return source

    def test_actual_one_rpc_platform_whole_50_raw_and_full_year_windows(self):
        SalesOrderLine.objects.all().delete();outlets=[];rows=[]
        for platform,label in (("京东","J"),("天猫","T")):
            for i in range(25):
                identity={"platform":platform,"rawShopName":f"{label}{i:02}","rawChannel":"共享渠道"};outlets.append(identity)
                rows.append(make_line(700+len(rows),f"http-{label}-{i}",platform=platform,shop_name=identity["rawShopName"],channel=identity["rawChannel"],order_no="same",ship_time="2024-02-29 10:00:00"))
        SalesOrderLine.objects.bulk_create(rows)
        request={"operation":"netshop_periods_v1","current":{"startDate":"2024-02-28","endExclusive":"2025-02-28"},"baseline":{"startDate":"2023-02-28","endExclusive":"2024-02-28"},"rawOutlets":outlets,"seriesGrain":"day","seriesPlatforms":["京东","天猫"]}
        calls=[]
        def opening(call,**options):
            calls.append(json.loads(call.data))
            return prior.open_bounded_consumer_request(call,**options)
        with patch("netshop.bounded_consumer_http.open_bounded_consumer_request",side_effect=opening):
            body,revision=read_sales_periods(self.principal,request)
        self.assertEqual(len(calls),1);self.assertIn("expiresAtEpochMs",calls[0]);self.assertEqual(revision,"7:3")
        self.assertEqual([item["rawCandidateCount"]for item in body["platformSeries"]["items"]],[25,25])
        self.assertEqual(sum(len(row[kind])for row in body["platformSeries"]["items"]for kind in ("current","baseline")),1462)
        status,envelope,headers,raw=self.post(request);self.assertEqual(status,200);self.assertEqual(envelope["data"],body)
        self.assertLessEqual(len(raw),2*1024*1024)
        prior.capture("registered-platform-max",request,raw,headers)
