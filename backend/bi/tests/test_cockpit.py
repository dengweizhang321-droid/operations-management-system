from datetime import date, timedelta
import json
import time
from unittest.mock import patch

from django.http import QueryDict
from django.test import TestCase, override_settings
from django.utils import timezone

from bi.cockpit import goals, parse_request, read_cockpit, read_flow
from bi.cockpit_sales import periods, sales_projection
from bi.errors import BiApiError
from sales.auth import Principal
from sales.models import SalesOrderLine
from sales.tests.factories import install_fixture, make_line, signed_headers, TEST_SECRET

PRINCIPAL = Principal(email="admin@example.test", display_name="Test Admin", role="admin", scope=None)


@override_settings(DJANGO_PROCESS_ROLE="development")
class CockpitSalesTests(TestCase):
    def setUp(self):
        install_fixture()
        self.options = parse_request(QueryDict("range=custom&startDate=2026-08-01&endDate=2026-08-02"))

    def test_source_category_margin_and_trusted_orders(self):
        data = sales_projection(PRINCIPAL, self.options)
        current = data["sales"]["current"]
        self.assertEqual(current["netSalesCents"], 14000)
        self.assertEqual(current["grossProfitCents"], 4200)
        self.assertEqual(current["orderMarginCents"], 3700)
        self.assertEqual(current["trustedOrders"], 4)
        self.assertEqual(current["averageOrderValueCents"], 3500)
        self.assertEqual({row["name"] for row in data["categories"]}, {"饮水设备", "制冰设备", "未分类"})

    def test_same_order_multi_line_and_cross_shop_are_distinct(self):
        SalesOrderLine.objects.bulk_create([make_line(6, "L6", order_no="order-1"), make_line(7, "L7", order_no="order-1", shop_name="京东二店")])
        current = sales_projection(PRINCIPAL, self.options)["sales"]["current"]
        self.assertEqual(current["trustedOrders"], 5)

    def test_fallback_order_identity_is_not_a_customer_order(self):
        SalesOrderLine.objects.filter(pk=1).update(order_no="", order_identity="L1")
        current = sales_projection(PRINCIPAL, self.options)["sales"]["current"]
        self.assertEqual(current["missingOrderNoRows"], 1)
        self.assertIsNone(current["averageOrderValueCents"])

    def test_absent_baseline_is_not_a_healthy_shop(self):
        data = sales_projection(PRINCIPAL, self.options)
        self.assertTrue(all(row["yoy"] is None and row["severity"] == "unknown" for row in data["shops"]))
        self.assertIsNone(data["sales"]["previous"]["netSalesCents"])

    def test_negative_net_and_refund_do_not_clip(self):
        SalesOrderLine.objects.filter(is_business_row=True).update(allocated_amount_cents=-1000)
        current = sales_projection(PRINCIPAL, self.options)["sales"]["current"]
        self.assertEqual(current["netSalesCents"], -4000)
        self.assertEqual(current["refundCents"], 4000)
        self.assertIsNone(current["refundRate"])

    def test_month_previous_uses_calendar_and_year_leap_clips(self):
        options = parse_request(QueryDict("range=month"))
        value = periods(options, date(2026, 10, 5))
        self.assertEqual(value["current"]["endDate"], "2026-10-04")
        self.assertEqual(value["previous"]["startDate"], "2026-09-01")
        self.assertEqual(value["previous"]["endDate"], "2026-09-04")
        leap = periods(parse_request(QueryDict("range=custom&startDate=2024-02-29&endDate=2024-02-29")), date(2026, 10, 5))
        self.assertEqual(leap["yearAgo"]["startDate"], "2023-02-28")

    def test_first_day_uses_current_goal_calendar_without_faking_zero_actuals(self):
        value = periods(parse_request(QueryDict("range=yesterday")), date(2027, 1, 1))
        self.assertEqual(value["goalWindows"]["annual"]["startDate"], "2027-01-01")
        self.assertEqual(value["goalWindows"]["month"]["startDate"], "2027-01-01")
        self.assertEqual(value["goalWindows"]["annual"]["days"], 0)
        self.assertEqual(value["goalWindows"]["month"]["days"], 0)
        november = periods(parse_request(QueryDict("range=yesterday")), date(2026, 11, 1))
        self.assertEqual(november["goalWindows"]["month"]["startDate"], "2026-11-01")
        self.assertEqual(november["goalWindows"]["month"]["days"], 0)

    def test_parameters_reject_duplicates_unknown_future_and_unbound_shop(self):
        for query in ["range=month&range=month", "range=month&limit=3", "range=custom&startDate=2026-02-30&endDate=2026-03-01", "shop=A", "flowShop=123"]:
            with self.subTest(query=query), self.assertRaises(BiApiError): parse_request(QueryDict(query))
        with self.assertRaises(BiApiError): periods(parse_request(QueryDict("range=today")))

    def test_sources_fail_independently_and_auth_fails_closed(self):
        with patch("bi.cockpit.read_source", side_effect=BiApiError("missing", status=503, code="source_not_configured")):
            data, revision = read_cockpit(PRINCIPAL, self.options)
        self.assertEqual(len(revision), 64)
        self.assertTrue(all(row["status"] == "unavailable" for row in data["sources"].values()))
        self.assertIsNone(data["goals"]["periods"][0]["targetCents"])
        with patch("bi.cockpit.read_source", side_effect=BiApiError("denied", status=403)):
            with self.assertRaises(BiApiError) as caught: read_cockpit(PRINCIPAL, self.options)
        self.assertEqual(caught.exception.status, 403)

    def test_deferred_flow_does_not_block_core_and_local_flow_does_not_scan_erp(self):
        calls = []
        def unavailable(principal, source, params, **kwargs):
            calls.append(source); raise BiApiError("missing", status=503)
        with patch("bi.cockpit.read_source", unavailable):
            data, _ = read_cockpit(PRINCIPAL, {**self.options, "deferFlow": True})
        self.assertNotIn("flow", calls)
        self.assertEqual(data["sources"]["flow"]["reasonCode"], "deferred")
        with patch("bi.cockpit.sales_projection", side_effect=AssertionError("ERP must not be rescanned")), patch("bi.cockpit.read_source", unavailable):
            flow, _ = read_flow(PRINCIPAL, self.options)
        self.assertEqual(flow["contractVersion"], "bi-flow-v1")

    def test_personal_counts_bind_actor_to_cockpit_revision(self):
        other = Principal(email="another@example.test", display_name="Other", role="viewer", scope=None)
        with patch("bi.cockpit.read_source", side_effect=BiApiError("missing", status=503)):
            _, a = read_cockpit(PRINCIPAL, self.options); _, b = read_cockpit(other, self.options)
        self.assertNotEqual(a, b)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_public_backend_role_and_scope(self):
        url = "/api/bi/cockpit?range=custom&startDate=2026-08-01&endDate=2026-08-02"
        with patch("bi.cockpit.read_source", side_effect=BiApiError("missing", status=503)):
            response = self.client.get(url, headers=signed_headers(url, role="viewer"))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response["X-Bi-Data-Revision"], response.json()["revision"])
        self.assertEqual(response["Cache-Control"], "no-store")
        restricted = self.client.get(url, headers=signed_headers(url, scope={"platforms": ["京东"], "shops": []}))
        self.assertEqual(restricted.status_code, 403, restricted.content)


class ErpGoalsTests(TestCase):
    def sales(self):
        window = {"startDate": "2026-10-01", "endDate": "2026-10-04", "days": 4}
        entry = {"netSalesCents": 100, "coverage": {"dateComplete": True}}
        return {"filters": {"platform": "", "shop": ""}, "periods": {"goalWindows": {"annual": {**window, "startDate": "2026-01-01"}, "annualPrevious": {**window, "endDate": "2026-09-30"}, "annualYearAgo": window, "month": window, "monthPrevious": window, "monthYearAgo": window}}, "goalActuals": {**{key: entry.copy() for key in ["annual", "annualPrevious", "annualYearAgo", "month", "monthPrevious", "monthYearAgo"]}, "shops": []}}

    def source(self, amount):
        return {"status": "ready", "data": {"items": [{"id": "erp-1", "basis": "erp_net_sales", "periodType": "month", "periodKey": "2026-10", "platform": "", "shopName": "", "salesTargetCents": amount}]}}

    def test_missing_zero_and_explicit_targets_are_distinct(self):
        self.assertEqual(goals(self.sales(), {"status": "ready", "data": {"items": []}})["periods"][1]["targetStatus"], "not_set")
        self.assertEqual(goals(self.sales(), self.source(0))["periods"][1]["targetStatus"], "zero_target")
        self.assertEqual(goals(self.sales(), self.source(200))["periods"][1]["completion"], .5)

    def test_incomplete_dates_block_completion(self):
        data = self.sales(); data["goalActuals"]["month"]["coverage"] = {"dateComplete": False}
        self.assertIsNone(goals(data, self.source(200))["periods"][1]["completion"])

    def test_financial_target_basis_is_rejected(self):
        source = self.source(200); source["data"]["items"][0]["basis"] = "finance"
        with self.assertRaises(BiApiError): goals(self.sales(), source)

    def test_company_target_not_reused_for_shop_filter(self):
        data = self.sales(); data["filters"] = {"platform": "京东", "shop": "A"}
        self.assertIsNone(goals(data, self.source(200))["periods"][1]["targetCents"])
