from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from unittest.mock import patch

from django.test import TestCase, SimpleTestCase
from django.utils import timezone
from access_control.models import AccessRole, AppUser
from sales.auth import Principal
from sales.models import SalesOrderLine
from sales.netshop_periods import read_netshop_periods, validate_netshop_periods, NetshopPeriodsError
from sales.netshop_period_series import period_buckets, restore_period_point, pack_period_point
from sales.tests.factories import install_fixture, make_line

IDENTITY={"platform":"京东","rawShopName":"京东一店","rawChannel":"渠道A"}
REQUEST={"operation":"netshop_periods_v1","current":{"startDate":"2026-09-01","endExclusive":"2026-09-10"},"baseline":{"startDate":"2026-08-01","endExclusive":"2026-08-06"}}


class SeriesRequestTests(SimpleTestCase):
    def test_closed_optin_both_fields_and_exact_selected_subset(self):
        for changes in ({"seriesGrain":"week"},{"seriesOutlets":[IDENTITY]},{"seriesGrain":["day"],"seriesOutlets":[IDENTITY]},{"seriesGrain":"day","seriesOutlets":[]},{"seriesGrain":"day","seriesOutlets":[IDENTITY]*2},{"seriesGrain":"day","seriesOutlets":[{**IDENTITY,"rawChannel":None}]},{"seriesGrain":"day","seriesOutlets":[IDENTITY],"rawOutlets":[{**IDENTITY,"rawChannel":"other"}]}):
            with self.assertRaises(NetshopPeriodsError):validate_netshop_periods({**REQUEST,**changes})
        original=validate_netshop_periods(REQUEST);self.assertNotIn("seriesGrain",original);self.assertNotIn("seriesIntent",original)

    def test_calendar_week_month_leap_clipping_and_full_window(self):
        w=validate_netshop_periods(REQUEST)["current"]
        self.assertEqual([(b["startDate"],b["endDate"]) for b in period_buckets(w,"week")],[("2026-09-01","2026-09-06"),("2026-09-07","2026-09-09")])
        w=validate_netshop_periods({**REQUEST,"current":{"startDate":"2024-02-28","endExclusive":"2024-03-03"}})["current"]
        self.assertEqual([(b["startDate"],b["endDate"],b["days"]) for b in period_buckets(w,"month")],[("2024-02-28","2024-02-29",2),("2024-03-01","2024-03-02",2)])


class NativeSeriesTests(TestCase):
    def setUp(self):
        install_fixture();SalesOrderLine.objects.all().delete()
        AccessRole.objects.get_or_create(code="admin",defaults={"rank":4,"label":"admin"})
        AppUser.objects.create(email="native-series@example.test",display_name="Synthetic",role_id="admin",scope=None,status="active",version=1,created_at=timezone.now(),updated_at=timezone.now())
        self.principal=Principal("native-series@example.test","Synthetic","admin",None)
        SalesOrderLine.objects.bulk_create([
            make_line(11,"day1",order_no="same",quantity=1,allocated_amount_cents=1000,cost_amount_cents=0,ship_time="2026-09-01 10:00:00"),
            make_line(12,"day2",order_no="same",quantity=1,allocated_amount_cents=2000,cost_amount_cents=500,ship_time="2026-09-02 10:00:00"),
            make_line(13,"negative",order_no="return",quantity=-1,allocated_amount_cents=-1000,cost_amount_cents=-200,ship_time="2026-09-07 10:00:00"),
            make_line(14,"zero-missing",order_no="",online_order_no="not-a-trusted-denominator",quantity=0,allocated_amount_cents=0,cost_amount_cents=0,ship_time="2026-09-08 10:00:00"),
            make_line(15,"other-shop",shop_name="B",quantity=2,allocated_amount_cents=4000,cost_amount_cents=2000,ship_time="2026-09-09 10:00:00"),
            make_line(21,"baseline",quantity=1,allocated_amount_cents=500,cost_amount_cents=100,ship_time="2026-08-02 10:00:00"),
        ])

    def read(self,grain=None,**changes):
        request={**REQUEST,**({"seriesGrain":grain,"seriesOutlets":[IDENTITY]} if grain else {}),**changes}
        return read_netshop_periods(self.principal,request)

    def capture(self,result,grain):
        target=os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
        if target:
            directory=Path(target);directory.mkdir(exist_ok=True)
            with (directory/f"sales-series-{grain}.json").open("x",encoding="utf8",newline="\n") as out:json.dump(result,out,ensure_ascii=False,allow_nan=False)
            paths=["backend/sales/netshop_periods.py","backend/sales/netshop_period_series.py","backend/netshop/sales_periods_client.py","lib/netshop/sales-periods-contract.ts","backend/sales/tests/test_netshop_period_series.py"]
            root=Path(__file__).resolve().parents[3]
            with (directory/f"sales-series-{grain}.meta.json").open("x",encoding="utf8",newline="\n") as out:json.dump({"request":{**REQUEST,"seriesGrain":grain,"seriesOutlets":[IDENTITY]},"headerRevision":"7:3","sourceHead":subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip(),"dirty":subprocess.check_output(["git","status","--porcelain"],cwd=root,text=True),"sha256":{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths},"syntheticPrivatePg":True},out,ensure_ascii=False,indent=2)

    def test_daily_zero_no_records_and_native_unknown_cost(self):
        result=self.read("day");points=[restore_period_point(point) for point in result["series"]["items"][0]["current"]]
        self.assertEqual(len(points),9);self.assertIsNone(points[2]["facts"]["values"]["netSalesCents"])
        self.assertEqual(points[2]["facts"]["orders"]["netAmountPerOrder"]["reasonCode"],"no_records")
        self.assertEqual(points[7]["facts"]["values"]["netSalesCents"],0)
        self.assertEqual(points[7]["facts"]["orders"]["netAmountPerOrder"]["reasonCode"],"missing_order_no")
        self.assertEqual(result["series"]["metricMetadata"]["cost"]["zeroCostVerification"],"unknown")
        self.capture(result,"day")

    def test_week_denominator_is_distinct_bucket_orders_not_sum_of_days(self):
        result=self.read("week");first=restore_period_point(result["series"]["items"][0]["current"][0])
        self.assertEqual(first["window"]["endDate"],"2026-09-06")
        self.assertEqual(first["facts"]["values"]["netSalesCents"],3000)
        self.assertEqual(first["facts"]["orders"]["trustedOrderCount"],1)
        self.assertEqual(first["facts"]["orders"]["netAmountPerOrder"]["value"],3000)
        self.assertEqual(first["facts"]["observations"]["observedDateCount"],2)
        self.assertEqual(first["facts"]["observations"]["completeness"],"unknown")
        self.capture(result,"week")

    def test_month_unequal_two_windows_preserve_native_amounts(self):
        result=self.read("month");item={kind:[restore_period_point(point) for point in result["series"]["items"][0][kind]] for kind in ("current","baseline")}
        self.assertEqual((item["current"][0]["window"]["days"],item["baseline"][0]["window"]["days"]),(9,5))
        self.assertEqual(item["current"][0]["facts"]["values"]["netSalesCents"],2000)
        self.assertEqual(item["baseline"][0]["facts"]["values"]["netSalesCents"],500)
        original=next(row for row in self.read()["items"] if row["identity"]==IDENTITY)
        for kind in ("current","baseline"):
            self.assertEqual(item[kind][0]["facts"],original[kind])
            self.assertEqual(pack_period_point(item[kind][0]["window"],item[kind][0]["facts"]),result["series"]["items"][0][kind][0])
        self.capture(result,"month")

    def test_selected_series_does_not_shrink_complete_parent_summary_or_candidates(self):
        plain=self.read();series=self.read("week",q="B",pageSize=1)
        self.assertNotIn("series",plain);self.assertNotIn("seriesIntent",plain["requestedScope"])
        self.assertEqual(series["periodTotals"],plain["periodTotals"])
        self.assertEqual(series["candidatePagination"]["candidateCount"],plain["candidatePagination"]["candidateCount"])
        self.assertEqual(series["items"][0]["identity"]["rawShopName"],"B")
        self.assertEqual(series["series"]["items"][0]["identity"],IDENTITY)
        self.assertEqual(series["series"],self.read("week")["series"])
        self.assertNotEqual(series["snapshotToken"],plain["snapshotToken"])
        with self.assertRaises(NetshopPeriodsError):self.read("month",snapshotToken=series["snapshotToken"])

    def test_foreign_or_unauthorized_series_member_fails_before_publication(self):
        with self.assertRaises(NetshopPeriodsError):self.read("day",seriesOutlets=[{**IDENTITY,"rawShopName":"foreign"}])
        scope={"warehouses":["denied"],"channels":[],"platforms":[]}
        AppUser.objects.filter(pk=self.principal.email).update(scope=scope)
        with self.assertRaises(NetshopPeriodsError):read_netshop_periods(Principal(self.principal.email,"Synthetic","admin",scope),{**REQUEST,"seriesGrain":"day","seriesOutlets":[IDENTITY]})

    def test_actual_leap_year_366_current_and_365_baseline_keep_all_day_buckets(self):
        SalesOrderLine.objects.bulk_create([make_line(41,"leap",ship_time="2024-02-29 10:00:00"),make_line(42,"old-year",ship_time="2023-03-01 10:00:00")])
        result=self.read("day",current={"startDate":"2024-02-28","endExclusive":"2025-02-28"},baseline={"startDate":"2023-02-28","endExclusive":"2024-02-28"})
        item={kind:[restore_period_point(point) for point in result["series"]["items"][0][kind]] for kind in ("current","baseline")}
        self.assertEqual((len(item["current"]),len(item["baseline"])),(366,365))
        self.assertEqual(item["current"][1]["window"]["startDate"],"2024-02-29")
        self.assertEqual(item["current"][1]["facts"]["rowCount"],1)
        self.assertEqual(item["current"][-1]["window"]["endDate"],"2025-02-27")
        with self.assertRaises(NetshopPeriodsError):self.read("day",current={"startDate":"2024-02-28","endExclusive":"2025-03-01"})

    def test_compact_four_objects_two_366_windows_fit_whole_budget_without_truncation(self):
        outlets=[{**IDENTITY,"rawShopName":shop} for shop in ("京东一店","B","C","D")]
        SalesOrderLine.objects.bulk_create([make_line(51+i,f"compact-{i}",shop_name=row["rawShopName"],ship_time="2024-02-29 10:00:00") for i,row in enumerate(outlets)])
        started=time.monotonic()
        result=self.read("day",seriesOutlets=outlets,current={"startDate":"2024-02-28","endExclusive":"2025-02-28"},baseline={"startDate":"2020-02-28","endExclusive":"2021-02-28"})
        raw=json.dumps(result,ensure_ascii=False,separators=(",",":"),allow_nan=False).encode()
        count=sum(len(item[kind]) for item in result["series"]["items"] for kind in ("current","baseline"))
        self.assertEqual(count,2928);self.assertLessEqual(len(raw),2*1024*1024)
        target=os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
        if target:
            directory=Path(target);directory.mkdir(exist_ok=True)
            with(directory/"compact-max-response.json").open("xb") as out:out.write(raw)
            with(directory/"compact-max-budget.json").open("x",encoding="utf8") as out:json.dump({"bytes":len(raw),"pointCount":count,"objectCount":4,"seconds":time.monotonic()-started,"status":200,"truncated":False},out,indent=2)
        from sales import netshop_periods as owner
        with patch.object(owner,"MAX_BYTES",len(raw)-1),self.assertRaises(NetshopPeriodsError) as large:self.read("day",seriesOutlets=outlets,current={"startDate":"2024-02-28","endExclusive":"2025-02-28"},baseline={"startDate":"2020-02-28","endExclusive":"2021-02-28"})
        self.assertEqual(large.exception.status,413)
