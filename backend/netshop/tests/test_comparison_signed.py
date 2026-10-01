"""One synthetic PG seed through actual loopback registered GET and signed RPC.

No business response or source reader is replaced. Only the test-only explicit
alias fixture extends the immutable production resolver for synthetic members.
"""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
from importlib import import_module
import json
import os
from pathlib import Path
import secrets
import socket
import time
import urllib.error
import urllib.request
from unittest.mock import patch

from django.db import transaction
from django.test import LiveServerTestCase
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from sales.models import SalesOrderLine
from sales.tests.factories import install_fixture, make_line, signed_headers
from netshop.models import NetshopDataRevision
from netshop.sales_client import sales_alias
from netshop.tests import test_comparison_insights as fixture
from netshop.tests.promotion_insights_fixtures import add_day


class ComparisonSignedGetTests(LiveServerTestCase):
    host = "127.0.0.1"
    fact = fixture.ComparisonInsightsTests.fact
    scope = fixture.ComparisonInsightsTests.scope

    def query(self, **values):
        outlets=values.pop("outlet",None)
        params=fixture.ComparisonInsightsTests.query(self,**values).copy()
        if outlets is not None:params.setlist("outlet",outlets if isinstance(outlets,list) else [outlets])
        return params

    @classmethod
    def setUpClass(cls):
        cls.secret = secrets.token_hex(40)
        cls.private_env = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": cls.secret})
        cls.private_env.start()
        try:
            super().setUpClass()
            cls.private_reader_env = patch.dict(os.environ, {"TERUISI_DJANGO_SALES_READER_BASE_URL": cls.live_server_url})
            cls.private_reader_env.start()
        except Exception:
            cls.private_env.stop()
            raise

    @classmethod
    def tearDownClass(cls):
        try:
            super().tearDownClass()
            # unittest invokes LiveServer's class cleanup after tearDownClass;
            # perform its normal terminate now so the receipt observes closure.
            cls.server_thread.terminate()
            port=cls.server_thread.port
            try:
                with socket.create_connection((cls.host,port),timeout=1):stopped=False
            except OSError:
                stopped=True
            target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
            if target:
                with (Path(target)/"signed-http-server.json").open("x",encoding="utf8") as out:
                    json.dump({"host":cls.host,"port":port,"normalStop":stopped,"framework":"Django LiveServerTestCase threaded loopback TCP","comboPin":"0254d03ac3dad276e5b9955f12f7556ffd923620","productionUsed":False},out,indent=2)
            if not stopped:raise AssertionError("Private signed HTTP server did not stop")
        finally:
            cls.private_reader_env.stop()
            cls.private_env.stop()

    def setUp(self):
        self.email = "comparison-signed@example.test"
        self.counter = 0
        self.rpc_calls = []
        self.records = []
        self.rpc_completed_hook = None
        self.aliases = {}
        self.jd_names = ["合成平台店"+str(index).zfill(2) for index in range(5)]
        self.base_keys = ["京东\x1f"+name for name in self.jd_names]+["天猫\x1f合成平台店00"]
        with transaction.atomic():
            install_fixture()
            SalesOrderLine.objects.all().delete()
            label,description,rank,permissions=import_module("access_control.migrations.0001_initial").ROLE_CATALOG["viewer"]
            AccessRole.objects.get_or_create(code="viewer",defaults={"label":label,"description":description,"rank":rank,"permissions":permissions,"version":1})
            AppUser.objects.create(email=self.email, display_name="Synthetic Signed", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
            for platform, names in (("京东", self.jd_names), ("天猫", ["合成平台店"+str(i).zfill(2) for i in range(20)])):
                for index, name in enumerate(names):
                    if platform=="京东" or index==0:
                        self.aliases[(platform,name)]={"platform":platform,"canonicalShopName":name,"rawShopName":" RAW "+name+" ","rawChannel":" exact channel "+str(index)+" "}
                    for month, first in ((9,1),(8,25)):
                        for offset in range(7):
                            day=date(2026,month,first)+timedelta(days=offset)
                            if platform=="京东" and index==4 and month==9 and offset>2: continue
                            amount=1000*(index+1) if month==9 else 1000*(6-index)
                            if platform=="京东" and index==1: amount=0 if month==8 else 2000
                            if platform=="京东" and index==2: amount=-100 if month==8 else 3000
                            for product in (1,2):
                                dimensions=("sku","spu") if platform=="京东" else ("spu",)
                                for dimension in dimensions:
                                    identity=("SKU" if dimension=="sku" else "SPU")+str(product).zfill(2)
                                    row=self.fact(platform=platform,shop=name,day=day.isoformat(),dimension=dimension,product=identity,metrics={"transactionAmountCents":amount,"transactionQuantity":2,"visitors":100,"transactionCustomers":10,"transactionOrders":7})
                                    if platform=="京东":
                                        row.sku_id="SKU"+str(product).zfill(2);row.spu_id="SPU"+str(product).zfill(2)
                                        row.save(update_fields=["sku_id","spu_id"])
                            add_day(self,platform=platform,shop=name,day=day.isoformat(),rows=[{"id":("SKU" if platform=="京东" else "SPU")+str(i).zfill(2),"values":{"spendCents":20,"netTransactionAmountCents":40,"impressions":100,"clicks":2,"netOrders":1}} for i in (1,2)])
            rows=[]
            for (platform,name), alias in self.aliases.items():
                index=self.jd_names.index(name)
                for day,amount,quantity in (("2026-09-01",100 if index!=1 else 400,1),("2026-08-25",50,1)):
                    if platform=="京东" and ((index==1 and day.startswith("2026-08")) or (index==4 and day.startswith("2026-09"))):continue
                    identifier=100+len(rows)
                    rows.append(make_line(identifier,"signed-seed-"+str(identifier),platform=platform,shop_name=alias["rawShopName"],channel=alias["rawChannel"],ship_time=day+" 10:00:00",allocated_amount_cents=amount,quantity=quantity,cost_amount_cents=20,gross_profit_cents=5,order_no="same-order"))
            first=self.aliases[("京东",self.jd_names[0])]
            for day,amount,quantity,order in (("2026-09-02",200,1,"same-order"),("2026-09-05",0,1,"zero-order"),("2026-09-06",-20,-1,"return-order")):
                identifier=100+len(rows)
                rows.append(make_line(identifier,"signed-seed-"+str(identifier),platform="京东",shop_name=first["rawShopName"],channel=first["rawChannel"],ship_time=day+" 10:00:00",allocated_amount_cents=amount,quantity=quantity,cost_amount_cents=20,gross_profit_cents=5,order_no=order))
            SalesOrderLine.objects.bulk_create(rows)
            NetshopDataRevision.objects.update_or_create(domain="netshop",defaults={"revision":2,"source_digest":"b"*64})
        self.alias_patch=patch("netshop.comparison_adapter.sales_alias",side_effect=lambda p,n:self.aliases.get((p,n),sales_alias(p,n)))
        self.alias_patch.start();self.addCleanup(self.alias_patch.stop)
        from netshop.sales_periods_client import read_sales_consumer as actual_rpc
        def trace_rpc(principal, request, *, deadline):
            before=time.monotonic()
            wall_before=time.perf_counter()
            result=actual_rpc(principal,request,deadline=deadline)
            self.rpc_calls.append({"request":deepcopy(request),"deadline":deadline,"remainingBudgetSeconds":deadline-before,"seconds":time.perf_counter()-wall_before,"revision":result[1]})
            if self.rpc_completed_hook:self.rpc_completed_hook(len(self.rpc_calls))
            return result
        self.rpc_patch=patch("netshop.sales_periods_client.read_sales_consumer",side_effect=trace_rpc)
        self.rpc_patch.start();self.addCleanup(self.rpc_patch.stop)

    def get_capture(self, name, path, params, *, status=200, signed=True):
        query=params.urlencode()
        url=self.live_server_url+path+("?"+query if query else "")
        headers=signed_headers(url,secret=self.secret,role="viewer",email=self.email,display_name="Synthetic Signed",request_id=name) if signed else {}
        before=time.perf_counter();first=len(self.rpc_calls)
        request=urllib.request.Request(url,headers=headers,method="GET")
        try:
            response=urllib.request.urlopen(request,timeout=90)
        except urllib.error.HTTPError as error:
            response=error
        with response:
            raw=response.read();actual_status=response.status;response_headers=dict(response.headers)
        payload=json.loads(raw)
        metadata={"schemaVersion":"comparison-signed-private-get-v1","synthetic":True,"layer":"actual_loopback_tcp_registered_get_hmac_wrapper_and_real_signed_registered_sales_rpc","aliasFixture":"test_only_explicit_injective_raw_triples","name":name,"url":url,"method":"GET","query":query,"status":actual_status,"signed":signed,"principal":{"email":self.email,"role":"viewer","scope":None},"responseHeaders":response_headers,"responseUtf8Bytes":len(raw),"responseSha256":hashlib.sha256(raw).hexdigest(),"seconds":time.perf_counter()-before,"rpcCalls":[{**{k:v for k,v in call.items() if k!="deadline"},"sameOuterDeadline":call["deadline"]==self.rpc_calls[first]["deadline"]} for call in self.rpc_calls[first:]]}
        target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if target:
            target=Path(target)
            with (target/(name+"-response.json")).open("xb") as out:out.write(raw)
            with (target/(name+"-request.json")).open("x",encoding="utf8") as out:json.dump({"query":query,"headerRevision":response_headers.get("X-Netshop-Data-Revision"),"synthetic":True},out,ensure_ascii=False)
            with (target/(name+"-meta.json")).open("x",encoding="utf8") as out:json.dump(metadata,out,ensure_ascii=False,indent=2)
        self.records.append(metadata)
        self.assertEqual(actual_status,status,payload)
        if status==200:
            self.assertEqual(response_headers.get("Cache-Control"),"no-store")
            self.assertLessEqual(len(raw),2*1024*1024)
            context=payload.get("currentContext",payload.get("context"))
            if context:self.assertEqual(response_headers.get("X-Netshop-Data-Revision"),next(v["revision"] for v in context["sourceRevisions"] if v["kind"]=="owning_revision"))
        return payload

    def test_same_seed_registered_signed_comparison_smoke(self):
        values={"platform":["京东","天猫"],"endDate":"2026-09-07","selectedBaseline":{"kind":"custom","startDate":"2026-08-25","endDate":"2026-08-31"}}
        result=self.get_capture("signed-c-smoke","/api/netshop/comparison-insights",self.query(**values))
        self.assertEqual(result["sections"]["scale"]["pagination"]["total"],25)
        self.assertEqual(len(result["sections"]["scale"]["items"]),20)
        self.assertTrue(result["sections"]["scale"]["pagination"]["hasMore"])
        self.get_capture("signed-c-no-signature","/api/netshop/comparison-insights",self.query(**values),signed=False,status=401)
        page2=self.get_capture("signed-c-page2","/api/netshop/comparison-insights",self.query(**values,page=2,sectionToken=result["sectionToken"]))
        self.assertEqual((page2["sections"]["scale"]["pagination"]["total"],len(page2["sections"]["scale"]["items"])),(25,5))
        self.assertEqual(page2["sections"]["scale"]["summary"],result["sections"]["scale"]["summary"])
        self.assertEqual(page2["sections"]["comparability"]["counts"],result["sections"]["comparability"]["counts"])
        self.assertFalse({row["objectKey"] for row in result["sections"]["scale"]["items"]}&{row["objectKey"] for row in page2["sections"]["scale"]["items"]})
        self.get_capture("signed-c-partial","/api/netshop/comparison-insights",self.query(**values,comparisonScope=self.scope(coverageFilter="partial")))
        subset={**values,"outlet":self.base_keys}
        platform_scope=self.scope(mode="platform",metricSource="erp")
        for grain in ("day","week","month"):
            platform=self.get_capture("signed-c-platform-"+grain,"/api/netshop/comparison-insights",self.query(**subset,comparisonScope=platform_scope,metricKey="erpNetSales",chartObjectKeys=["platform:京东","platform:天猫"],trendGrain=grain))
            self.assertEqual(len(platform["sections"]["comparability"]["erpEvidence"]["platformPeriods"]),2)
            self.assertEqual(len(self.records[-1]["rpcCalls"]),5)
            self.assertTrue(all(call["sameOuterDeadline"] for call in self.records[-1]["rpcCalls"]))
        self.get_capture("signed-c-platform-quantity","/api/netshop/comparison-insights",self.query(**subset,comparisonScope=platform_scope,metricKey="erpNetQuantity",chartObjectKeys=["platform:京东","platform:天猫"]))
        expanded={**values,"platform":"京东","outlet":next(row["shopKeys"] for row in platform["sections"]["scale"]["items"] if row["platform"]=="京东"),"comparisonScope":self.scope(metricSource="erp"),"metricKey":"erpNetSales","chartObjectKeys":[]}
        expanded_result=self.get_capture("actual-owning-erp-platform-expanded-shops","/api/netshop/comparison-insights",self.query(**expanded))
        self.assertEqual(len(expanded_result["sections"]["scale"]["items"]),5)
        self.assertEqual({row["shopName"] for row in expanded_result["sections"]["scale"]["items"]},set(self.jd_names))
        self.assertTrue(all(key.startswith("shop:京东\x1f") for key in expanded_result["chartObjectKeys"]))
        self.get_capture("signed-c-shop-native-quantity","/api/netshop/comparison-insights",self.query(**{**expanded,"metricKey":"erpNetQuantity"}))
        custom={**values,"selectedBaseline":{"kind":"custom","startDate":"2026-08-25","endDate":"2026-08-30"}}
        different=self.get_capture("signed-c-custom-unequal","/api/netshop/comparison-insights",self.query(**custom))
        self.assertFalse(different["sections"]["comparability"]["periodRelationship"]["sameLength"])
        self.get_capture("signed-c-unmapped","/api/netshop/comparison-insights",self.query(platform="天猫",outlet="天猫\x1f合成平台店19",endDate="2026-09-07",selectedBaseline=values["selectedBaseline"],comparisonScope=self.scope(metricSource="erp"),metricKey="erpNetSales"))

        # Owning P/A lists and detail use each original source's actual dimension
        # and real returned identity/token; no response bridge is manufactured.
        for platform,dimension in (("京东","sku"),("天猫","spu")):
            name=self.jd_names[0]
            shared={"platform":platform,"dimension":dimension,"outlet":platform+"\x1f"+name,"endDate":"2026-09-07"}
            product=self.get_capture("signed-p-"+dimension+"-list","/api/netshop/product-insights",self.query(**shared,pageSize=100))
            self.assertFalse(product["sections"]["pagination"]["hasMore"])
            self.assertEqual(len(product["sections"]["items"]),2)
            identity=product["sections"]["items"][0]["identity"]
            encoded=json.dumps([identity[key] for key in ("platform","shopName","dimension","id")],ensure_ascii=False)
            detail=self.get_capture("signed-p-"+dimension+"-detail","/api/netshop/product-insights/detail",self.query(**shared,productIdentity=encoded))
            self.assertEqual(detail["sections"]["performance"]["identity"],identity)
            promotion=self.get_capture("signed-a-"+dimension+"-list","/api/netshop/promotion-insights",self.query(**shared,pageSize=100))
            self.assertFalse(promotion["sections"]["pagination"]["hasMore"])
            self.assertEqual(len(promotion["sections"]["items"]),2)
            item=promotion["sections"]["items"][0]
            ad_detail=self.get_capture("signed-a-"+dimension+"-detail","/api/netshop/promotion-insights/detail",self.query(**shared,objectKind="product",objectId=item["rowKey"],shopKey=item["shopKey"],sectionToken=promotion["sectionToken"]))
            self.assertEqual(ad_detail["sections"]["item"]["id"],item["id"])

        self.get_capture("signed-c-stale-token","/api/netshop/comparison-insights",self.query(**values,sectionToken="0"*64),status=409)
        AppUser.objects.filter(email=self.email).update(status="disabled")
        self.get_capture("signed-c-revoked","/api/netshop/comparison-insights",self.query(**values),status=403)
        AppUser.objects.filter(email=self.email).update(status="active",version=2)
        target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if target:
            with (Path(target)/"signed-same-seed-manifest.json").open("x",encoding="utf8") as out:
                json.dump({"synthetic":True,"comboPin":"0254d03ac3dad276e5b9955f12f7556ffd923620","sharedPositiveSeed":{"netshopRevision":"2:bbbbbbbbbbbb","salesRevision":"7:3","shops":25,"jdExpandedShops":5,"nativeParentRawMembers":6,"current":{"startDate":"2026-09-01","endDate":"2026-09-07"},"baseline":{"startDate":"2026-08-25","endDate":"2026-08-31"}},"actualTcp":True,"mockBusinessDto":False,"businessTransportInjected":False,"captures":[{"name":record["url"],"query":record["query"],"status":record["status"],"sha256":record["responseSha256"],"bytes":record["responseUtf8Bytes"],"rpcCount":len(record["rpcCalls"])} for record in self.records]},out,ensure_ascii=False,indent=2)

    def test_registered_whole_capacity_and_parent_budget(self):
        from netshop import comparison_insights as C
        sizes=[]
        actual_builder=C.build_comparison_result
        def measured(*args,**kwargs):
            result=actual_builder(*args,**kwargs)
            sizes.append(len(json.dumps(result,ensure_ascii=False,allow_nan=False).encode("utf8")))
            return result
        with patch.object(C,"build_comparison_result",side_effect=measured):
            capped=self.get_capture("signed-c-capacity","/api/netshop/comparison-insights",self.query(platform=["京东","天猫"],startDate="2025-03-01",endDate="2026-03-01",selectedBaseline={"kind":"custom","startDate":"2023-01-01","endDate":"2024-01-01"},comparisonScope=self.scope(metricSource="erp"),metricKey="erpNetSales",chartObjectKeys=["shop:京东\x1f"+name for name in self.jd_names[:4]]),status=422)
        self.assertEqual(capped["code"],"quality_incomplete")
        self.assertTrue(sizes and sizes[0]>2*1024*1024)
        clock=[0.0]
        self.rpc_completed_hook=lambda count:clock.__setitem__(0,66.0)
        with patch("netshop.comparison_insights.time.monotonic",side_effect=lambda:clock[0]):
            expired=self.get_capture("signed-c-parent-expired","/api/netshop/comparison-insights",self.query(endDate="2026-09-07",comparisonScope=self.scope(metricSource="erp"),metricKey="erpNetSales"),status=503)
        self.assertEqual(expired["code"],"source_not_ready")
        target=os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if target:
            with (Path(target)/"signed-capacity-and-budget.json").open("x",encoding="utf8") as out:
                json.dump({"computedFullComparisonUtf8Bytes":sizes,"capacityLimitBytes":2*1024*1024,"capacityHttpStatus":422,"capacityCode":"quality_incomplete","windowsDays":[366,366],"sourceBodyTruncated":False,"parentBudgetSeconds":65,"budgetHttpStatus":503,"budgetCode":"source_not_ready","clockInjection":"test_only_monotonic_advanced_to_66_after_actual_signed_owner_RPC; HTTP seconds use unaffected perf_counter","mockBusinessDto":False,"actualTcp":True},out,indent=2)
