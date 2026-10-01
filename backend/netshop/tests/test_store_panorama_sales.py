"""S ERP projection over the actual signed registered consumer and private PG."""
from __future__ import annotations

import json
import os
from pathlib import Path
import time
from unittest.mock import patch
from urllib.parse import urlencode

from django.db.models import F
from django.http import QueryDict
from django.test import LiveServerTestCase, override_settings
from django.urls import include, path
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from sales.auth import Principal
from sales.models import SalesDataRevision, SalesOrderLine
from sales.tests.factories import TEST_SECRET, install_fixture, make_line
from netshop.errors import NetshopApiError
from netshop.insights_common import periods
from netshop.models import NetshopDataRevision
from netshop import panorama_sales_client as bridge
from netshop import store_panorama as panorama

urlpatterns = [path("api/sales/", include("sales.urls"))]
CANONICAL = "志高切肉机旗舰店"


@override_settings(ROOT_URLCONF=__name__, MEDIA_URL="/synthetic-media/", STATIC_URL="/synthetic-static/")
class RealPanoramaSalesTests(LiveServerTestCase):
    host = "127.0.0.1"

    def setUp(self):
        install_fixture()
        AccessRole.objects.get_or_create(code="viewer", defaults={"label": "Synthetic viewer", "description": "Private test role", "rank": 1})
        self.principal = Principal("panorama-sales@example.test", "Synthetic", "viewer", None)
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        self.env = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET, "TERUISI_DJANGO_SALES_READER_BASE_URL": self.live_server_url, "TERUISI_DJANGO_WORKFLOW_READER_BASE_URL": ""})
        self.env.start()
        self.context = {"effectiveScope": {"platforms": ["京东"], "shopKeys": ["京东\x1f" + CANONICAL]}, "periods": periods("2026-09-01", "2026-09-07", "custom")}
        self.identity = bridge.resolve_panorama_sales(self.context)
        self.counter = 100

    def tearDown(self):
        self.env.stop()

    def row(self, *, day="2026-09-01", amount=1000, quantity=2, order_no=None, channel=None, shop=None):
        self.counter += 1
        row = make_line(self.counter, "S" + str(self.counter), platform="京东", shop_name=shop or self.identity["rawShopName"], channel=channel or self.identity["rawChannel"],
                        ship_time=day + " 10:00:00", quantity=quantity, allocated_amount_cents=amount, cost_amount_cents=0, gross_profit_cents=7,
                        order_no="ERP-" + str(self.counter) if order_no is None else order_no)
        row.save()
        return row

    def read(self):
        return bridge.read_panorama_sales(self.principal, self.context, deadline=time.monotonic() + 65)

    def test_actual_raw_identity_native_units_and_unverified_cost_evidence(self):
        self.row(amount=1000, quantity=2)
        self.row(amount=400, quantity=3)
        self.row(amount=-99, quantity=-1)
        self.row(day="2026-08-01", amount=800)
        self.row(day="2025-09-01", amount=600)
        self.row(channel="另一渠道", amount=999999)
        result = self.read()
        current = result["periods"]["current"]["metrics"]
        self.assertEqual(current["netSales"]["value"], 1301)
        self.assertEqual(current["netSales"]["status"], "partial")
        self.assertEqual(current["netQuantity"]["unit"], "NATIVE_INTEGER_QUANTITY")
        self.assertEqual(current["netQuantity"]["value"], 4)
        self.assertEqual(current["returnQuantity"]["value"], 1)
        mean = current["orderAverageValue"]
        self.assertEqual(mean["unit"], "CNY_CENT_PER_ORDER")
        self.assertEqual(mean["value"], 1301 / 3)
        self.assertEqual(mean["denominator"], 3)
        for key in ("cost", "orderMargin", "largeMargin", "largeMarginRate"):
            self.assertIsNone(current[key]["value"])
            self.assertEqual(current[key]["reasonCode"], "unverified_source")
        self.assertEqual(result["owning"]["previous"]["periodTotals"]["current"]["values"]["costCents"], 0)
        self.assertEqual(result["owning"]["previous"]["metricMetadata"]["cost"]["verification"], "unverified_source")
        self.assertEqual(result["sourceRevisions"][0]["revision"], "7:3")
        self.assertEqual(len(result["sourceRevisions"]), 2)
        self.assertFalse(result["items"])
        self.assertFalse(result["daily"])
        bridge.verify_panorama_sales(self.principal, self.context, result, deadline=time.monotonic() + 65)

    def test_actual_no_records_null_and_missing_order_identity(self):
        no_rows = self.read()
        self.assertIsNone(no_rows["periods"]["current"]["metrics"]["netSales"]["value"])
        self.assertEqual(no_rows["periods"]["current"]["metrics"]["netSales"]["reasonCode"], "no_records")
        self.row(order_no="")
        value = self.read()["periods"]["current"]["metrics"]["orderAverageValue"]
        self.assertIsNone(value["value"])
        self.assertEqual(value["reasonCode"], "missing_order_no")

    def test_real_zero_sum_is_partial_observed_record_not_complete_shop_zero(self):
        self.row(amount=0)
        result = self.read()
        metric = result["periods"]["current"]["metrics"]["netSales"]
        self.assertEqual(metric["value"], 0)
        self.assertEqual(metric["status"], "partial")
        self.assertEqual(result["owning"]["previous"]["periodTotals"]["current"]["observations"]["completeness"], "unknown")

    def test_registered_pair_change_between_two_calls_and_final_check(self):
        self.row()
        actual, calls = bridge.read_sales_periods, [0]
        def advance(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls[0] += 1
            if calls[0] == 1:
                SalesDataRevision.objects.filter(domain="sales").update(revision=F("revision") + 1)
            return result
        with patch.object(bridge, "read_sales_periods", side_effect=advance), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 409)
        result = self.read()
        SalesDataRevision.objects.filter(domain="erp").update(revision=F("revision") + 1)
        with self.assertRaises(NetshopApiError) as raised:
            bridge.verify_panorama_sales(self.principal, self.context, result, deadline=time.monotonic() + 65)
        self.assertEqual(raised.exception.status, 409)

    def test_unknown_canonical_identity_and_no_endpoint_never_fallback(self):
        unknown = {**self.context, "effectiveScope": {"platforms": ["天猫"], "shopKeys": ["天猫\x1f未知同名店"]}}
        self.assertIsNone(bridge.resolve_panorama_sales(unknown))
        with patch.dict(os.environ, {"TERUISI_DJANGO_SALES_READER_BASE_URL": ""}), patch.object(bridge, "read_sales_periods") as rpc, self.assertRaises(NetshopApiError):
            self.read()
        rpc.assert_not_called()

    def test_real_367_year_window_is_not_truncated_or_claimed_no_records(self):
        self.context["periods"] = periods("2024-03-01", "2025-03-01", "rolling")
        self.assertEqual(self.context["periods"]["yearAgo"]["days"], 367)
        result = self.read()
        self.assertIsNone(result["owning"]["yearAgo"])
        for metric in result["periods"]["yearAgo"]["metrics"].values():
            self.assertIsNone(metric["value"])
            self.assertEqual(metric["reasonCode"], "not_applicable")

    def test_same_period_requests_deduplicate_actual_reference(self):
        self.context["periods"]["yearAgo"] = dict(self.context["periods"]["previous"])
        result = self.read()
        self.assertEqual(len(result["sourceRevisions"]), 1)

    def test_actual_s_composition_keeps_both_raw_envelopes_and_partial_record_scope(self):
        self.row(amount=1000)
        self.row(amount=1)
        params = QueryDict(urlencode({"platform": "京东", "outlet": "京东\x1f" + CANONICAL, "startDate": "2026-09-01", "endDate": "2026-09-07"}))
        result = panorama.read_store_panorama(self.principal, params)
        self.assertEqual(result["sources"]["sales"]["state"], "ready")
        self.assertEqual(result["sources"]["sales"]["data"]["periods"]["current"]["metrics"]["netSales"]["value"], 1001)
        self.assertEqual({ref["domain"] for ref in result["joinedSourceRevisions"]}, {"netshop", "sales"})
        evidence = os.environ.get("TERUISI_PANORAMA_QUERY_EVIDENCE_DIR")
        if evidence:
            with (Path(evidence) / "response-owning-sales.json").open("x", encoding="utf-8") as output:
                json.dump(result, output, ensure_ascii=False, indent=2)

    def test_actual_s_missing_order_mean_keeps_owned_reason_and_capability_gap(self):
        self.row(order_no="")
        params = QueryDict(urlencode({"platform": "京东", "outlet": "京东\x1f" + CANONICAL, "startDate": "2026-09-01", "endDate": "2026-09-07"}))
        result = panorama.read_store_panorama(self.principal, params)
        self.assertEqual(result["sources"]["sales"]["data"]["periods"]["current"]["metrics"]["orderAverageValue"]["reasonCode"], "missing_order_no")
        capability = next(c for c in result["sections"]["performance"]["capabilities"] if c["id"] == "order_average_value")
        self.assertEqual(capability["reasonCode"], "missing_field")
        evidence = os.environ.get("TERUISI_PANORAMA_QUERY_EVIDENCE_DIR")
        if evidence:
            with (Path(evidence) / "response-owning-sales-missing-order.json").open("x", encoding="utf-8") as output:
                json.dump(result, output, ensure_ascii=False, indent=2)

    def test_actual_source_actor_version_change_is_global_403(self):
        self.row()
        actual, calls = bridge.read_sales_periods, [0]
        def change(*args, **kwargs):
            data = actual(*args, **kwargs)
            calls[0] += 1
            if calls[0] == 1:
                AppUser.objects.filter(pk=self.user.pk).update(version=F("version") + 1)
            return data
        with patch.object(bridge, "read_sales_periods", side_effect=change), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 403)
