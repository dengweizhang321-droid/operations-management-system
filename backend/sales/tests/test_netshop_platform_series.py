from copy import deepcopy
import hashlib,json,os,subprocess,time
from pathlib import Path
from unittest.mock import patch
from django.test import TestCase,SimpleTestCase
from django.utils import timezone
from access_control.models import AppUser,AccessRole
from sales.auth import Principal
from sales.models import SalesOrderLine,SalesDataRevision
from sales import netshop_periods as owner
from sales.netshop_periods import read_netshop_periods,validate_netshop_periods,NetshopPeriodsError
from sales.netshop_period_series import restore_period_point
from sales.tests.factories import install_fixture,make_line

REQUEST={"operation":"netshop_periods_v1","current":{"startDate":"2026-09-01","endExclusive":"2026-09-10"},"baseline":{"startDate":"2026-08-01","endExclusive":"2026-08-06"}}


class PlatformRequestTests(SimpleTestCase):
    def test_closed_platform_selection_and_raw_mutual_exclusion(self):
        for changes in ({"seriesPlatforms":[]},{"seriesGrain":"day","seriesPlatforms":["京东","京东"]},{"seriesGrain":["day"],"seriesPlatforms":["京东"]},{"seriesGrain":"day","seriesPlatforms":[["京东"]]},{"seriesGrain":"day","seriesPlatforms":["ghost"]},{"seriesGrain":"day","seriesPlatforms":["天猫"],"rawOutlets":[{"platform":"京东","rawShopName":"A","rawChannel":"渠道A"}]},{"seriesGrain":"day","seriesPlatforms":["京东"],"seriesOutlets":[]}):
            with self.assertRaises(NetshopPeriodsError):validate_netshop_periods({**REQUEST,**changes})
        value=validate_netshop_periods({**REQUEST,"seriesGrain":"week","seriesPlatforms":["天猫","京东"]});self.assertEqual(value["seriesPlatforms"],["京东","天猫"])


class NativePlatformSeriesTests(TestCase):
    def setUp(self):
        install_fixture();SalesOrderLine.objects.all().delete()
        for rank,role in enumerate(("viewer","analyst","operator","admin"),1):AccessRole.objects.get_or_create(code=role,defaults={"label":role,"rank":rank})
        AppUser.objects.create(email="platform-series@example.test",display_name="Synthetic",role_id="admin",scope=None,status="active",version=1,created_at=timezone.now(),updated_at=timezone.now())
        self.principal=Principal("platform-series@example.test","Synthetic","admin",None)
        rows=[]
        for i in range(6):
            rows.extend([make_line(100+i*3,f"j-{i}-a",shop_name=f"J{i}",order_no="same",allocated_amount_cents=1000,cost_amount_cents=0,ship_time="2026-09-01 10:00:00"),make_line(101+i*3,f"j-{i}-b",shop_name=f"J{i}",order_no="same",allocated_amount_cents=2000,cost_amount_cents=500,ship_time="2026-09-02 10:00:00"),make_line(102+i*3,f"j-{i}-old",shop_name=f"J{i}",order_no="same",allocated_amount_cents=500,cost_amount_cents=100,ship_time="2026-08-02 10:00:00")])
        rows.extend([make_line(201,"tm",platform="天猫",shop_name="T0",channel="共用渠道",order_no="same",allocated_amount_cents=4000,ship_time="2026-09-01 10:00:00"),make_line(202,"negative",shop_name="J0",order_no="return",allocated_amount_cents=-500,cost_amount_cents=-100,quantity=-1,ship_time="2026-09-07 10:00:00"),make_line(203,"zero",shop_name="J0",order_no="",online_order_no="not-trusted",allocated_amount_cents=0,cost_amount_cents=0,quantity=0,ship_time="2026-09-08 10:00:00")])
        SalesOrderLine.objects.bulk_create(rows)

    def read(self,grain="week",**changes):return read_netshop_periods(self.principal,{**REQUEST,"seriesGrain":grain,"seriesPlatforms":["京东","天猫"],**changes})
    def capture(self,result,grain):
        folder=os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
        if not folder:return
        folder=Path(folder);folder.mkdir(exist_ok=True);root=Path(__file__).resolve().parents[3]
        with(folder/f"platform-series-{grain}.json").open("x",encoding="utf8",newline="\n")as out:json.dump(result,out,ensure_ascii=False,allow_nan=False)
        paths=["backend/sales/netshop_platform_series.py","backend/sales/netshop_periods.py","backend/netshop/sales_periods_client.py","lib/netshop/sales-periods-contract.ts","backend/sales/tests/test_netshop_platform_series.py"]
        with(folder/f"platform-series-{grain}.meta.json").open("x",encoding="utf8",newline="\n")as out:json.dump({"request":{**REQUEST,"seriesGrain":grain,"seriesPlatforms":["京东","天猫"]},"revision":"7:3","sourceHead":subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip(),"sha256":{p:hashlib.sha256((root/p).read_bytes()).hexdigest()for p in paths},"synthetic":True},out,ensure_ascii=False,indent=2)

    def test_full_platform_more_than_four_raw_and_composite_distinct_week_orders(self):
        result=self.read();jd=result["platformSeries"]["items"][0];point=restore_period_point(jd["current"][0])
        self.assertEqual(jd["rawCandidateCount"],6);self.assertEqual(len(jd["rawMembers"]),6)
        self.assertEqual(point["facts"]["values"]["netSalesCents"],18000)
        self.assertEqual(point["facts"]["orders"]["trustedOrderCount"],6)
        self.assertEqual(point["facts"]["orders"]["netAmountPerOrder"]["value"],3000)
        self.assertEqual(point["window"]["endDate"],"2026-09-06")
        for grain in ("day","week","month"):self.capture(self.read(grain),grain)

    def test_q_page_do_not_shrink_full_raw_union_platform_or_summary(self):
        before=self.read();after=self.read(q="T0",pageSize=1)
        self.assertEqual(before["platformSeries"],after["platformSeries"]);self.assertEqual(before["periodTotals"],after["periodTotals"])
        self.assertEqual(after["candidatePagination"]["candidateCount"],7);self.assertEqual(after["items"][0]["identity"]["platform"],"天猫")
        raw=read_netshop_periods(self.principal,REQUEST);self.assertEqual(raw["periodTotals"],after["periodTotals"]);self.assertNotIn("platformSeries",raw)
        with self.assertRaises(NetshopPeriodsError):self.read("month",snapshotToken=before["snapshotToken"])

    def test_authorized_empty_platform_nulls_are_not_unauthorized_platform(self):
        SalesOrderLine.objects.filter(platform="天猫").delete()
        empty=self.read()["platformSeries"]["items"][1]
        self.assertEqual(empty["availability"],{"status":"unavailable","reasonCode":"no_records"})
        self.assertEqual(empty["rawMembers"],[])
        self.assertTrue(all(restore_period_point(p)["facts"]["values"]["netSalesCents"]is None for kind in ("current","baseline") for p in empty[kind]))
        scope={"warehouses":[],"channels":[],"platforms":["京东"]};AppUser.objects.filter(pk=self.principal.email).update(scope=scope)
        with self.assertRaises(NetshopPeriodsError)as denied:read_netshop_periods(Principal(self.principal.email,"Synthetic","admin",scope),{**REQUEST,"seriesGrain":"week","seriesPlatforms":["天猫"]})
        self.assertEqual(denied.exception.status,403)

    def test_all_roles_warehouse_platform_or_channel_branches_keep_original_authority(self):
        for role in ("viewer","analyst","operator","admin"):
            scope={"warehouses":["主仓"],"channels":["渠道A"],"platforms":[]};AppUser.objects.filter(pk=self.principal.email).update(role_id=role,scope=scope)
            p=Principal(self.principal.email,"Synthetic",role,scope)
            result=read_netshop_periods(p,{**REQUEST,"seriesGrain":"week","seriesPlatforms":["京东"]})
            self.assertEqual(result["platformSeries"]["items"][0]["rawCandidateCount"],6)
            with self.assertRaises(NetshopPeriodsError)as denied:read_netshop_periods(p,{**REQUEST,"seriesGrain":"day","seriesPlatforms":["天猫"]})
            self.assertEqual(denied.exception.status,403)
        scope={"warehouses":["主仓"],"channels":[],"platforms":[]};AppUser.objects.filter(pk=self.principal.email).update(scope=scope)
        self.assertEqual(len(read_netshop_periods(Principal(self.principal.email,"Synthetic","admin",scope),{**REQUEST,"seriesGrain":"week","seriesPlatforms":["京东","天猫"]})["platformSeries"]["items"]),2)

    def test_actor_revision_and_expired_signed_budget_fail_before_publication(self):
        original=owner._canonical
        def revoked(value):
            if type(value)is dict and "platformSeries"in value:AppUser.objects.filter(pk=self.principal.email).update(version=2)
            return original(value)
        with patch.object(owner,"_canonical",side_effect=revoked),self.assertRaises(NetshopPeriodsError)as failure:self.read()
        self.assertEqual(failure.exception.status,403)
        AppUser.objects.filter(pk=self.principal.email).update(version=1)
        def changed(value):
            if type(value)is dict and "platformSeries"in value:SalesDataRevision.objects.filter(domain="erp").update(revision=4)
            return original(value)
        with patch.object(owner,"_canonical",side_effect=changed),self.assertRaises(NetshopPeriodsError)as failure:self.read()
        self.assertEqual(failure.exception.status,409)
        with self.assertNumQueries(0),self.assertRaises(NetshopPeriodsError):self.read(expiresAtEpochMs=int(time.time()*1000)-1)

    def test_fifty_raw_two_platforms_full_366_365_days_fit_budget(self):
        SalesOrderLine.objects.all().delete();rows=[];outlets=[]
        for platform,label in (("京东","J"),("天猫","T")):
            for i in range(25):
                identity={"platform":platform,"rawShopName":f"{label}{i:02}","rawChannel":"共享渠道"};outlets.append(identity)
                rows.append(make_line(500+len(rows),f"annual-{label}{i}",platform=platform,shop_name=identity["rawShopName"],channel=identity["rawChannel"],order_no="same",ship_time="2024-02-29 10:00:00"))
        SalesOrderLine.objects.bulk_create(rows)
        request={"operation":"netshop_periods_v1","current":{"startDate":"2024-02-28","endExclusive":"2025-02-28"},"baseline":{"startDate":"2023-02-28","endExclusive":"2024-02-28"},"rawOutlets":outlets,"seriesGrain":"day","seriesPlatforms":["京东","天猫"]}
        result=read_netshop_periods(self.principal,request);self.assertEqual(result["candidatePagination"]["candidateCount"],50)
        self.assertEqual([row["rawCandidateCount"]for row in result["platformSeries"]["items"]],[25,25])
        self.assertEqual(sum(len(row[kind])for row in result["platformSeries"]["items"]for kind in ("current","baseline")),1462)
        self.assertLessEqual(len(json.dumps(result,ensure_ascii=False).encode()),2*1024*1024)
        folder=os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
        if folder:
            folder=Path(folder);folder.mkdir(exist_ok=True)
            with(folder/"platform-max.json").open("x",encoding="utf8",newline="\n")as out:json.dump(result,out,ensure_ascii=False)
            with(folder/"platform-max.meta.json").open("x",encoding="utf8",newline="\n")as out:json.dump({"request":request,"revision":"7:3","bytes":len(json.dumps(result,ensure_ascii=False).encode()),"pointCount":1462,"rawCount":50},out,ensure_ascii=False)
