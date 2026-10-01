from copy import deepcopy
import json
import os
from pathlib import Path
import time
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, SimpleTestCase
from django.utils import timezone
from access_control.models import AppUser, AccessRole
from sales.auth import Principal
from sales.models import SalesOrderLine, SalesDataRevision
from sales.netshop_periods import OPERATION, SCHEMA, NetshopPeriodsError, validate_netshop_periods, read_netshop_periods
from sales import netshop_periods as owner
from .factories import install_fixture, make_line


def request(**changes):
    return {"operation": OPERATION, "current": {"startDate": "2026-08-01", "endExclusive": "2026-08-03"},
            "baseline": {"startDate": "2026-07-01", "endExclusive": "2026-08-01"}, **changes}


def capture(result, name):
    evidence=os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
    if evidence:
        target=Path(evidence);target.mkdir(exist_ok=True)
        with (target/name).open("x",encoding="utf8") as out:json.dump(result,out,ensure_ascii=False,allow_nan=False)


class ContractTests(SimpleTestCase):
    def test_exact_closed_windows_and_internal_deadline(self):
        value = validate_netshop_periods(request(expiresAtEpochMs=1000))
        self.assertEqual(value["current"]["days"], 2)
        self.assertEqual(value["baseline"]["days"], 31)
        for invalid in [request(current={"startDate": "2026-02-29", "endExclusive": "2026-03-02"}),
                        request(baseline={"startDate": "2024-01-01", "endExclusive": "2025-01-02"}),
                        request(q="x"*121), request(pageSize=True), request(expectedRevision="1:abcdef"),
                        request(expiresAtEpochMs=None), request(expiresAtEpochMs=True), request(expiresAtEpochMs=1.2),
                        request(rawOutlets=[{"platform":"京东","rawShopName":"店","rawChannel":None}]),
                        request(rawOutlets=[{"platform":"京东","rawShopName":"店","rawChannel":""}]), request(taxonomyId="x")]:
            with self.assertRaises(NetshopPeriodsError): validate_netshop_periods(invalid)


class OwnedPeriodsTests(TestCase):
    def setUp(self):
        install_fixture()
        for index, role in enumerate(("viewer", "analyst", "operator", "admin")):
            AccessRole.objects.get_or_create(code=role, defaults={"rank":index+1,"label":role})
        AppUser.objects.create(email="periods@example.test",display_name="Synthetic",role_id="admin",scope=None,status="active",version=1,created_at=timezone.now(),updated_at=timezone.now())
        self.principal = Principal("periods@example.test", "Synthetic", "admin", None)

    def read(self, **changes): return read_netshop_periods(self.principal, request(**changes))

    def test_original_signed_metrics_and_no_record_nulls(self):
        result=self.read(); current=result["periodTotals"]["current"]
        self.assertEqual(current["values"]["netSalesCents"], 14000)
        self.assertEqual(current["values"]["positiveSalesCents"], 16000)
        self.assertEqual(current["values"]["refundCents"], 2000)
        self.assertEqual(current["values"]["grossProfitCents"], 4200)
        self.assertEqual(current["values"]["reportedGrossProfitCents"], 3700)
        self.assertEqual(current["orders"]["trustedOrderCount"],4)
        self.assertEqual(result["periodTotals"]["baseline"]["values"]["netSalesCents"],None)
        self.assertEqual(current["observations"]["completeness"],"unknown")
        self.assertEqual(result["sourceRevisions"][0]["revision"],"7:3")
        original=json.loads((Path(__file__).resolve().parents[3]/"tests/fixtures/netshop-sales-periods/response-periods.json").read_text(encoding="utf8"))
        self.assertEqual(owner._canonical(result),owner._canonical(original))
        self.assertEqual(result["metricMetadata"]["quantity"]["unit"],"NATIVE_INTEGER_QUANTITY")
        for name in ("cost","grossProfit","reportedGrossProfit"):
            self.assertEqual(result["metricMetadata"][name]["verification"],"unverified_source")
            self.assertEqual(result["metricMetadata"][name]["primaryMetricUse"],"unavailable_or_partial")
        capture(result,"response-periods.json")

    def test_complete_union_above_500_baseline_only_and_search_page_control(self):
        SalesOrderLine.objects.bulk_create([make_line(1000+i,f"B{i}",shop_name=f"基期店{i:04d}",ship_time="2026-07-04 10:00:00") for i in range(601)])
        all_rows=self.read(pageSize=100)
        self.assertEqual(all_rows["candidatePagination"]["candidateCount"],603)
        search=self.read(q="基期店",page=6,pageSize=100)
        self.assertEqual(search["candidatePagination"]["filteredCount"],601)
        self.assertEqual(len(search["items"]),100)
        self.assertEqual(search["periodTotals"],all_rows["periodTotals"])
        self.assertTrue(all(item["current"]["rowCount"]==0 and item["baseline"]["rowCount"]==1 for item in search["items"]))
        self.assertEqual(search["snapshotToken"],all_rows["snapshotToken"])

    def test_channel_and_raw_whitespace_never_global_or(self):
        SalesOrderLine.objects.bulk_create([make_line(10,"cB",channel="渠道B"),make_line(11,"space",shop_name=" 京东一店 ",channel=" 渠道A ")])
        selected=self.read(rawOutlets=[{"platform":"京东","rawShopName":"京东一店","rawChannel":"渠道B"}])
        self.assertEqual(selected["periodTotals"]["current"]["rowCount"],1)
        padded=self.read(rawOutlets=[{"platform":"京东","rawShopName":" 京东一店 ","rawChannel":" 渠道A "}])
        self.assertEqual(padded["items"][0]["identity"]["rawShopName"]," 京东一店 ")
        self.assertEqual(padded["periodTotals"]["current"]["rowCount"],1)

    def test_warehouse_scope_and_each_existing_role(self):
        SalesOrderLine.objects.bulk_create([make_line(10,"b",channel="渠道B"),make_line(11,"w",channel="渠道B",warehouse="另一仓")])
        scope={"warehouses":["主仓"],"channels":["渠道B"],"platforms":[]}
        for role in ("viewer","analyst","operator","admin"):
            AppUser.objects.filter(pk=self.principal.email).update(role_id=role,scope=scope)
            result=read_netshop_periods(Principal(self.principal.email,"Synthetic",role,scope),request())
            self.assertEqual(result["periodTotals"]["current"]["rowCount"],1)
            self.assertEqual(result["scopeMode"],"restricted")

    def test_trusted_order_no_only_many_sku_cross_shop_and_missing(self):
        SalesOrderLine.objects.all().delete()
        SalesOrderLine.objects.bulk_create([make_line(10,"one",order_no="same"),make_line(11,"two",order_no="same",product_code="other"),make_line(12,"shop",order_no="same",shop_name="另一店")])
        result=self.read();self.assertEqual(result["periodTotals"]["current"]["orders"]["trustedOrderCount"],2)
        SalesOrderLine.objects.bulk_create([make_line(13,"missing",order_no="",online_order_no="online-still-not-trusted")])
        result=self.read();orders=result["periodTotals"]["current"]["orders"]
        self.assertEqual(orders["missingOrderNoRows"],1);self.assertEqual(orders["netAmountPerOrder"]["reasonCode"],"missing_order_no")
        self.assertIsNone(orders["netAmountPerOrder"]["value"])
        capture(result,"response-missing-order.json")

    def test_true_zero_negative_returns_and_accessories_keep_rules(self):
        SalesOrderLine.objects.all().delete()
        SalesOrderLine.objects.bulk_create([make_line(10,"zero",allocated_amount_cents=0,cost_amount_cents=0,gross_profit_cents=0,quantity=0)])
        result=self.read();self.assertEqual(result["periodTotals"]["current"]["values"]["netSalesCents"],0)
        self.assertEqual(result["periodTotals"]["current"]["orders"]["netAmountPerOrder"]["value"],0)
        self.assertEqual(result["metricMetadata"]["cost"]["zeroCostVerification"],"unknown")
        capture(result,"response-typed-zero.json")
        SalesOrderLine.objects.all().delete()
        SalesOrderLine.objects.bulk_create([make_line(10,"ret",allocated_amount_cents=-5000,cost_amount_cents=-2000,quantity=-2),make_line(11,"acc",allocated_amount_cents=1000,category="配件",product_code="ACC")])
        values=self.read()["periodTotals"]["current"]["values"]
        self.assertEqual(values["netSalesCents"],-4000);self.assertEqual(values["returnQuantity"],2);self.assertEqual(values["positiveQuantity"],0)

    def test_native_owner_integer_gate_and_unresolved_cost_zero_evidence(self):
        # Exercise the existing owner boundary, not a newly invented cost rule.
        from sales.write_service import _normalize_row, _stored_line_content_row, _clean_zero_cost_rows, SalesImportServiceError
        source=_stored_line_content_row(make_line(20,"typed-cost",cost_amount_cents=0))
        self.assertEqual(_normalize_row(source)["costAmountCents"],0)
        for field,value in (("quantity",1.25),("costAmountCents",0.25),("costAmountCents",None)):
            invalid={**source,field:value}
            with self.assertRaises(SalesImportServiceError) as rejected:_normalize_row(invalid)
            self.assertEqual(rejected.exception.code,"INVALID_INTEGER")
        missing=dict(source);del missing["costAmountCents"]
        with self.assertRaises(SalesImportServiceError):_normalize_row(missing)
        with patch("sales.write_service.zero_cost_product_names",return_value=[]):
            with self.assertRaises(SalesImportServiceError) as snapshot:_clean_zero_cost_rows([source],None)
            self.assertEqual(snapshot.exception.code,"MISSING_SYSTEM_COST_SNAPSHOT")
            cleaned,proof,warnings,_=_clean_zero_cost_rows([source],{"sourceBatchId":"synthetic-current-cost","snapshotDate":"2026-08-02","costs":[]})
        self.assertEqual(cleaned[0]["costAmountCents"],0)
        self.assertEqual(proof["unresolvedRows"],1)
        self.assertIn("SYSTEM_COST_UNRESOLVED",[item["code"] for item in warnings])
        SalesOrderLine.objects.all().delete()
        SalesOrderLine.objects.bulk_create([make_line(20,"typed-cost",cost_amount_cents=cleaned[0]["costAmountCents"])])
        result=self.read()
        self.assertEqual(result["periodTotals"]["current"]["values"]["costCents"],0)
        self.assertEqual(result["metricMetadata"]["cost"]["verification"],"unverified_source")
        self.assertEqual(result["metricMetadata"]["reportedGrossProfit"]["originalFieldPresence"],"unknown")

    def test_raw_projection_incoherence_is_not_hidden_or_repaired(self):
        SalesOrderLine.objects.filter(id=1).update(channel_key="not-the-raw-channel")
        with self.assertRaisesRegex(NetshopPeriodsError,"RAW身份"):self.read()

    def test_expected_pair_scope_actor_and_read_end_changes_fail_closed(self):
        with self.assertRaises(NetshopPeriodsError) as mismatch:self.read(expectedRevision="8:3")
        self.assertEqual(mismatch.exception.status,409)
        token=self.read()["snapshotToken"]
        with self.assertRaises(NetshopPeriodsError):self.read(snapshotToken=token,categories=["other"])
        AppUser.objects.filter(pk=self.principal.email).update(status="disabled")
        with self.assertRaises(NetshopPeriodsError) as denied:self.read()
        self.assertEqual(denied.exception.status,403)
        AppUser.objects.filter(pk=self.principal.email).update(status="active")
        original=owner._canonical
        def drift(value):
            if type(value) is dict and value.get("schemaVersion")==SCHEMA:SalesDataRevision.objects.filter(domain="erp").update(revision=4)
            return original(value)
        with patch.object(owner,"_canonical",side_effect=drift),self.assertRaises(NetshopPeriodsError) as changed:self.read()
        self.assertEqual(changed.exception.status,409)

    def test_revoke_during_serialization_not_retried(self):
        original=owner._canonical
        def revoke(value):
            if type(value) is dict and value.get("schemaVersion")==SCHEMA:AppUser.objects.filter(pk=self.principal.email).update(version=2,scope={"warehouses":["denied"],"channels":[],"platforms":[]})
            return original(value)
        with patch.object(owner,"_canonical",side_effect=revoke),self.assertRaises(NetshopPeriodsError) as changed:self.read()
        self.assertEqual(changed.exception.status,403)

    def test_expired_rpc_and_whole_serialization_deadline(self):
        with self.assertNumQueries(0),self.assertRaises(NetshopPeriodsError) as past:self.read(expiresAtEpochMs=int(time.time()*1000)-1)
        self.assertEqual(past.exception.status,503)
        original=owner._canonical;clock=[0.0]
        def consume(value):
            encoded=original(value)
            if type(value) is dict and value.get("schemaVersion")==SCHEMA:clock[0]=2.0
            return encoded
        with patch.object(owner.time,"monotonic",side_effect=lambda:clock[0]),patch.object(owner,"_canonical",side_effect=consume),self.assertRaises(NetshopPeriodsError):
            read_netshop_periods(self.principal,request(),deadline=1.0)

    def test_utf8_budget_and_original_sql_timeout_not_increased(self):
        with patch.object(owner,"MAX_BYTES",10),self.assertRaises(NetshopPeriodsError) as large:self.read()
        self.assertEqual(large.exception.status,413)
        with connection.cursor() as cursor:cursor.execute("SHOW statement_timeout"); before=cursor.fetchone()[0]
        self.read()
        with connection.cursor() as cursor:cursor.execute("SHOW statement_timeout"); self.assertEqual(cursor.fetchone()[0],before)

    def test_minimum_reader_columns_scope_select_and_no_writes(self):
        from sales.analysis_options_permissions import provision
        with connection.cursor() as cursor:
            cursor.execute("CREATE ROLE crossdomain_min_reader NOLOGIN")
            cursor.execute("CREATE ROLE crossdomain_fixture_writer NOLOGIN")
            cursor.execute("GRANT SELECT ON sales_order_lines,sales_import_batches,sales_data_revisions TO crossdomain_min_reader")
            provision(cursor,reader="crossdomain_min_reader",writer="crossdomain_fixture_writer")
            # Only the original five actor columns are added; no broad users grant.
            cursor.execute("SET LOCAL ROLE crossdomain_min_reader")
            cursor.execute("SELECT has_column_privilege(current_user,'access_control_users','display_name','SELECT')")
            self.assertFalse(cursor.fetchone()[0])
        try:self.assertEqual(self.read()["periodTotals"]["current"]["rowCount"],4)
        finally:
            with connection.cursor() as cursor:cursor.execute("RESET ROLE")
