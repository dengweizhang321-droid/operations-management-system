"""Synthetic foundation contract and owning-reader negatives, including PG roles."""
import hashlib
import json
import time
from pathlib import Path
from datetime import date
from unittest import skipUnless
from unittest.mock import patch
from urllib.parse import urlencode

from django.db import connection, transaction, DatabaseError
from django.db.models import F, Count, Sum
from django.http import QueryDict
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from access_control.models import AppUser
from sales.auth import Principal
from sales.tests.factories import signed_headers, TEST_SECRET
from sales.summary import _custom_comparison_period
from netshop.errors import NetshopApiError
from netshop.models import NetshopDataRevision, NetshopRow, NetshopPromotionAggregateState, NetshopProductDailyScopeRevision
from netshop.insights_common import (read_context, validate_context, comparison_calendar,
    period_groups, periods, parse_identities, consistent_sources, validate_metric, compare_metrics)
from netshop.query import product_performance, promotion_overview, period, revision_value
from . import test_store_overview as overview_fixture


class InsightsFoundationTests(TestCase):
    fact = overview_fixture.StoreOverviewTests.fact

    def setUp(self):
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a"*64})
        self.principal = Principal("foundation@example.test", "Synthetic", "viewer", None)
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
        self.counter = 0

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision")+1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def spec(self, **values):
        return validate_context(QueryDict(urlencode({"platform": "京东", "dimension": "sku", "startDate": "2026-09-01", "endDate": "2026-09-01", **values}, doseq=True)))

    def performance(self, start="2026-09-01", end="2026-09-01", **kwargs):
        return product_performance(dimension="sku", query="", page=1, page_size=50, platforms=["京东"], outlets=[], requested_period=period(start, end), view="full", expected_snapshot_token=None, **kwargs)

    def test_context_has_all_sources_periods_fields_and_explicit_true_zero(self):
        self.fact(values={"transactionAmountCents": 0}); self.fact(promotion=True)
        result = read_context(self.principal, self.spec())
        self.assertEqual(len(result["coverageBySource"]), 6)
        self.assertEqual(len(result["capabilities"]), 21)
        caps = {c["field"]: c for c in result["capabilities"] if c["period"] == "current"}
        self.assertEqual(caps["payment"]["status"], "available")
        self.assertEqual(caps["visitors"]["reasonCode"], "missing_field")
        self.assertEqual(result["effectiveScope"]["shopKeys"], ["京东\x1fA"])
        self.assertEqual(result["periods"]["previous"]["endDate"], "2026-08-31")

    def test_requested_empty_shop_and_store_day_gaps_are_retained(self):
        self.fact(shop="A"); self.fact(shop="B", day="2026-09-02")
        result = read_context(self.principal, self.spec(outlet=["京东\x1fA", "京东\x1fB", "京东\x1fC"], endDate="2026-09-02"))
        coverage = result["coverageBySource"]["jd_sku_daily:sku_daily:京东:current"]
        self.assertEqual(coverage["expectedShopDatePairs"], 6)
        self.assertEqual(coverage["coveredShopDatePairs"], 2)
        self.assertFalse(coverage["complete"])
        self.assertEqual(result["effectiveScope"]["shopKeys"][-1], "京东\x1fC")

    def test_sku_and_spu_sources_are_not_added_and_catalog_is_not_history(self):
        self.fact(values={"transactionAmountCents": 100})
        NetshopRow.objects.update(dataset="product_master", business_date=None, snapshot_date="2026-09-01")
        result = read_context(self.principal, self.spec())
        self.assertEqual(result["capabilities"][0]["reasonCode"], "no_records")
        self.fact()
        self.assertEqual(read_context(self.principal, self.spec(dimension="spu"))["capabilities"][0]["reasonCode"], "no_records")
        self.assertEqual(read_context(self.principal, self.spec())["capabilities"][0]["status"], "available")

    def test_two_platform_same_name_isolated_with_unique_vector_keys(self):
        self.fact(); self.fact(platform="天猫", values={"transactionAmountCents": 0})
        result = read_context(self.principal, self.spec(platform=["京东", "天猫"], dimension="spu"))
        kinds = [r["kind"] for r in result["sourceRevisions"]]
        self.assertEqual(len(kinds), len(set(kinds)))
        self.assertEqual(len(result["capabilities"]), 42)
        self.assertEqual(len(result["coverageBySource"]), 12)
        self.assertEqual(result["effectiveScope"]["shopKeys"], ["京东\x1fA", "天猫\x1fA"])

    def test_calendar_handles_clamps_leap_day_week_and_short_tail(self):
        p = periods("2024-02-28", "2024-02-29", "custom")
        calendar = comparison_calendar(p)
        self.assertEqual(calendar[0]["yearAgo"], "2023-02-28")
        self.assertIsNone(calendar[1]["yearAgo"])
        for start, end in [("2026-03-01", "2026-03-31"), ("2026-03-29", "2026-03-31"), ("2026-08-28", "2026-09-04")]:
            previous = periods(start, end, "custom")["previous"]
            self.assertEqual((previous["startDate"], previous["endDate"]), _custom_comparison_period(date.fromisoformat(start), date.fromisoformat(end)))
        self.assertEqual([len(g) for g in period_groups("2026-09-02", "2026-09-11", "week")], [5, 5])
        self.assertEqual([len(g) for g in period_groups("2026-09-02", "2026-09-11", "seven_days")], [7, 3])
        self.assertNotEqual(periods("2026-09-24", "2026-09-30", "rolling")["previous"], periods("2026-09-24", "2026-09-30", "custom")["previous"])

    def test_366_current_retains_actual_367_year_ago_without_truncating_gaps(self):
        result = read_context(self.principal, self.spec(startDate="2025-02-28", endDate="2026-02-28", outlet="京东\x1fA"))
        self.assertEqual(result["periods"]["current"]["days"], 366)
        self.assertEqual(result["periods"]["yearAgo"]["days"], 367)
        coverage = result["coverageBySource"]["jd_sku_daily:sku_daily:京东:yearAgo"]
        self.assertEqual(coverage["expectedShopDatePairs"], 367)
        self.assertEqual(len(coverage["missingByShop"][0]["dates"]), 367)

    def test_maximum_scope_shape_keeps_all_50_shops_and_derived_missing_dates(self):
        shops = ["京东\x1f"+"合"*96+f"{i:03d}" for i in range(50)]
        result = read_context(self.principal, self.spec(startDate="2025-02-28", endDate="2026-02-28", outlet=shops))
        self.assertEqual(len(result["effectiveScope"]["shopKeys"]), 50)
        self.assertEqual(len(result["sourceRevisions"]), 102)
        self.assertEqual(result["coverageBySource"]["jd_sku_daily:sku_daily:京东:yearAgo"]["expectedShopDatePairs"], 18350)
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.assertLessEqual(len(encoded), 2*1024*1024)
        evidence = Path(r"E:\codex-artifacts\netshop-scheme2-20260930\foundation\capacity")
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence/"maximum-shape.json").write_text(json.dumps({"fixture": "synthetic-empty-source-v1", "shops": 50, "currentDays": 366, "yearAgoDays": 367, "bytes": len(encoded), "sourceMembers": 102, "truncated": False}), encoding="utf-8")

    def test_metric_states_and_bad_baselines_do_not_invent_growth(self):
        metric = {"value": 0, "unit": "CNY_CENT", "status": "available", "reasonCode": None, "sourceIds": ["jd_sku_daily"], "basis": "product_day_sum", "aggregation": "sum", "coverageRef": "current"}
        self.assertEqual(validate_metric(metric)["value"], 0)
        for bad in [{"status": "unavailable"}, {"value": float("inf")}, {"value": 9007199254740992}, {"status": "partial", "unit": "RATIO", "reasonCode": "incomplete_coverage"}]:
            with self.assertRaises(NetshopApiError): validate_metric({**metric, **bad})
        self.assertEqual(compare_metrics(metric, metric)["reasonCode"], "zero_denominator")
        self.assertEqual(compare_metrics(metric, {**metric, "value": -10})["reasonCode"], "negative_baseline")
        self.assertEqual(compare_metrics(metric, {**metric, "sourceIds": ["tmall_product_daily"]})["reasonCode"], "not_applicable")
        self.assertEqual(compare_metrics({**metric, "unit": "RATIO", "value": .2}, {**metric, "unit": "RATIO", "value": .1})["value"], 10)
        ratio = {**metric, "unit": "RATIO", "aggregation": "ratio_of_sums", "numerator": 0, "denominator": 10}
        self.assertEqual(validate_metric(ratio)["value"], 0)
        for changes in [{"denominator": 0}, {"denominator": -10}, {"value": .2}, {"numerator": float("inf")}]:
            with self.assertRaises(NetshopApiError): validate_metric({**ratio, **changes})
        self.assertEqual(compare_metrics({**metric, "unit": "SECONDS", "value": 1e308}, {**metric, "unit": "SECONDS", "value": 1e-308})["reasonCode"], "unsafe_integer")

    def test_context_rejects_unknown_duplicate_invalid_and_oversized_requests(self):
        base = {"platform": "京东", "dimension": "sku", "startDate": "2026-09-01", "endDate": "2026-09-01"}
        for delta in [{"q": "x"}, {"platform": ["京东", "京东"]}, {"outlet": ["京东\x1fA"]*2}, {"endDate": "2026-02-30"}, {"startDate": "2025-01-01", "endDate": "2026-09-01"}, {"dimension": "spu", "periodKind": ["custom", "rolling"]}, {"snapshotToken": "bad"}, {"platform": "天猫", "dimension": "sku"}, {"outlet": [f"京东\x1fS{i}" for i in range(51)]}]:
            with self.subTest(delta=delta), self.assertRaises(NetshopApiError): validate_context(QueryDict(urlencode({**base, **delta}, doseq=True)))

    def test_versions_scope_and_actor_version_bind_snapshot(self):
        self.fact(); first = read_context(self.principal, self.spec())
        self.assertEqual(read_context(self.principal, self.spec(snapshotToken=first["snapshotToken"]))["snapshotToken"], first["snapshotToken"])
        for delta in [{"outlet": "京东\x1fB"}, {"endDate": "2026-09-02"}, {"periodKind": "rolling"}]:
            with self.assertRaises(NetshopApiError): read_context(self.principal, self.spec(snapshotToken=first["snapshotToken"], **delta))
        AppUser.objects.filter(email=self.user.email).update(version=2)
        with self.assertRaises(NetshopApiError): read_context(self.principal, self.spec(snapshotToken=first["snapshotToken"]))

    def test_all_supported_roles_read_and_incompatible_scopes_fail_closed(self):
        self.fact()
        for role in ["viewer", "analyst", "operator", "admin"]:
            AppUser.objects.filter(email=self.user.email).update(role_id=role)
            self.assertEqual(read_context(Principal(self.user.email, "Synthetic", role, None), self.spec())["schemaVersion"], "netshop-insights-v1")
        for scope in [{"platforms": ["天猫"], "channels": [], "warehouses": []}, {"platforms": ["京东"], "channels": ["unknown-store"], "warehouses": []}, {"platforms": ["京东"], "channels": [], "warehouses": ["warehouse"]}, {"platforms": ["京东"], "brands": []}]:
            AppUser.objects.filter(email=self.user.email).update(scope=scope)
            with self.assertRaises(NetshopApiError): read_context(Principal(self.user.email, "Synthetic", "admin", scope), self.spec())

    def test_signed_but_stale_actor_disabled_role_scope_is_denied(self):
        self.fact()
        for updates in [{"status": "disabled"}, {"role_id": "operator"}, {"scope": {"platforms": ["天猫"], "channels": [], "warehouses": []}}]:
            AppUser.objects.filter(email=self.user.email).update(status="active", role_id="viewer", scope=None)
            AppUser.objects.filter(email=self.user.email).update(**updates)
            with self.assertRaises(NetshopApiError) as error: read_context(self.principal, self.spec())
            self.assertEqual(error.exception.status, 403)

    def test_revocation_during_read_is_denied_and_not_retried(self):
        self.fact()
        from netshop.insights_common import coverage_for
        calls = 0
        def revoke(*args):
            nonlocal calls
            calls += 1
            AppUser.objects.filter(email=self.user.email).update(version=2, status="disabled")
            return coverage_for(*args)
        with patch("netshop.insights_common.coverage_for", side_effect=revoke):
            with self.assertRaises(NetshopApiError) as error: read_context(self.principal, self.spec())
        self.assertEqual(error.exception.status, 403)
        self.assertEqual(calls, 6)

    def test_revision_and_independent_scope_vector_changes_fail_closed(self):
        self.fact()
        with patch("netshop.insights_common.revision_value", side_effect=["a", "b", "c", "d"]):
            with self.assertRaises(NetshopApiError): read_context(self.principal, self.spec())
        from netshop.store_overview import source_versions
        calls = 0
        def change(*args):
            nonlocal calls
            calls += 1
            if calls == 2: NetshopProductDailyScopeRevision.objects.update_or_create(platform="京东", shop_name="A", defaults={"data_version": 2})
            return source_versions(*args)
        with patch("netshop.insights_common.source_versions", side_effect=change):
            with self.assertRaises(NetshopApiError): read_context(self.principal, self.spec())

    def test_generic_multi_domain_guard_uses_typed_vector_and_only_two_attempts(self):
        read = iter([{"netshop:products": "x", "sales:net": "1"}, {"netshop:products": "x", "sales:net": "2"}]*2)
        with self.assertRaises(NetshopApiError): consistent_sources(lambda: next(read), lambda vector: vector)
        vector = {"netshop:products": "same", "netshop:promotion": "different"}
        self.assertEqual(consistent_sources(lambda: vector, lambda v: v)[0], vector)

    def test_exact_identity_finds_previous_rank_page_three_and_cross_shop_same_id(self):
        for i in range(120):
            self.fact(day="2026-08-31", values={"transactionAmountCents": i+1})
            NetshopRow.objects.filter(source_row_key=str(self.counter)).update(sku_id=f"P{i}")
        self.fact(shop="B", day="2026-08-31", values={"transactionAmountCents": 9999})
        NetshopRow.objects.filter(source_row_key=str(self.counter)).update(sku_id="P0")
        result = product_performance(dimension="sku", query="", page=1, page_size=100, platforms=["京东"], outlets=[], requested_period=period("2026-08-31", "2026-08-31"), view="identities", expected_snapshot_token=None, identities=[("京东", "A", "sku", "P0"), ("京东", "B", "sku", "P0"), ("京东", "A", "sku", "missing")], expected_source_revision=revision_value())
        self.assertEqual({i["shopNames"][0]: i["transactionAmountCents"] for i in result["items"]}, {"A": 1, "B": 9999})
        self.assertEqual(result["unmatched"], [["京东", "A", "sku", "missing"]])
        self.assertFalse(result["pagination"]["truncated"])
        self.assertTrue(result["items"][0]["fieldAvailability"]["transactionAmountCents"]["complete"])
        self.assertFalse(result["items"][0]["fieldAvailability"]["visitors"]["complete"])

    def test_product_presence_is_not_default_zero_and_missing_days_not_complete(self):
        self.fact(values={"transactionAmountCents": 0})
        item = self.performance()["items"][0]
        self.assertEqual(item["transactionAmountCents"], 0)
        self.assertTrue(item["fieldAvailability"]["transactionAmountCents"]["complete"])
        self.assertFalse(item["fieldAvailability"]["visitors"]["complete"])
        self.assertFalse(self.performance()["summaryFieldAvailability"]["visitors"]["complete"])
        self.assertTrue(self.performance()["summaryFieldAvailability"]["transactionAmountCents"]["complete"])
        self.assertFalse(self.performance(end="2026-09-02")["items"][0]["fieldAvailability"]["transactionAmountCents"]["complete"])

    @skipUnless(connection.vendor == "postgresql", "Requires isolated PostgreSQL execution plans")
    def test_synthetic_query_scale_controls_plans_bytes_and_elapsed(self):
        from netshop.query import PERFORMANCE_FIELD_ALIASES
        from netshop.store_overview import NumericMetricPresent
        fields = {aliases[0]: 0 for aliases in PERFORMANCE_FIELD_ALIASES.values()}
        fields.update(transactionAmountCents=1000, visitors=100, transactionCustomers=10)
        for index in range(10): self.fact(shop=f"scale-{index}", values={"transactionAmountCents": 1000, "visitors": 100, "transactionCustomers": 10})
        NetshopRow.objects.update(metrics_json=fields)
        batches = {r.shop_name: r.last_import_batch_id for r in NetshopRow.objects.all()}
        rows = []
        for shop, batch in batches.items():
            for day in range(1, 11):
                for product in range(50):
                    if day == 1 and product == 0: continue
                    key = f"scale:{shop}:{day}:{product}"
                    rows.append(NetshopRow(source_row_key=key, source_row_hash=hashlib.sha256(key.encode()).hexdigest(), first_import_batch_id=batch, last_import_batch_id=batch, source_row_number=2, source="jd_sku_daily", dataset="sku_daily", platform="京东", shop_name=shop, business_date=f"2026-09-{day:02d}", sku_id="same-product" if product == 0 else f"P{product}", metrics_json=fields, transaction_amount_cents=1000, visitors=100, transaction_customers=10))
        NetshopRow.objects.bulk_create(rows, batch_size=500)
        queryset = NetshopRow.objects.filter(source="jd_sku_daily", dataset="sku_daily", platform="京东", business_date__gte="2026-09-01", business_date__lt="2026-09-11")
        self.assertEqual(queryset.count(), 5000)
        rank_plan = queryset.values("platform", "shop_name", "sku_id").annotate(transaction_amount_cents=Sum("transaction_amount_cents"), visitors=Sum("visitors")).order_by("-transaction_amount_cents", "-visitors", "sku_id")[:50].explain(format="json", analyze=True, buffers=True)
        field_plan = queryset.values("shop_name", "business_date").annotate(rows=Count("id"), visitors_present=Count("id", filter=NumericMetricPresent(("visitors", "商品访客数")))).explain(format="json", analyze=True, buffers=True)
        with CaptureQueriesContext(connection) as calls:
            start = time.monotonic(); result = self.performance(end="2026-09-10"); elapsed = time.monotonic()-start
        self.assertEqual(result["summary"]["transactionAmountCents"], 5_000_000)
        self.assertTrue(result["summaryFieldAvailability"]["visitors"]["complete"])
        self.assertEqual(len(result["items"]), 50)
        self.assertEqual(result["pagination"]["total"], 500)
        evidence = Path(r"E:\codex-artifacts\netshop-scheme2-20260930\foundation\capacity")
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence/"query-scale.json").write_text(json.dumps({"fixture": "synthetic-5000-v1", "database": "private-postgresql", "rows": 5000, "shops": 10, "days": 10, "products": 500, "sqlCalls": len(calls), "seconds": elapsed, "bytes": len(json.dumps(result, ensure_ascii=False).encode()), "controlPaymentCents": 5_000_000, "rankPlan": json.loads(rank_plan), "fieldPlan": json.loads(field_plan), "limits": "This bounded synthetic sample does not establish production P95 or all maximum-source SQL cost"}, ensure_ascii=False, indent=2), encoding="utf-8")

    def test_identity_rejects_wrong_dimension_scope_duplicate_and_changed_revision(self):
        for identities in [[json.dumps(["天猫", "A", "sku", "1"])], [json.dumps(["京东", "B", "sku", "1"])], [json.dumps(["京东", "A", "spu", "1"])], [json.dumps(["京东", "A", "sku", "1"])]*2]:
            with self.assertRaises(NetshopApiError): parse_identities(identities, "sku", ["京东"], [{"platform": "京东", "shopName": "A"}])
        self.fact()
        with self.assertRaises(NetshopApiError): product_performance(dimension="sku", query="", page=1, page_size=100, platforms=["京东"], outlets=[], requested_period=period("2026-09-01", "2026-09-01"), view="identities", expected_snapshot_token=None, identities=[("京东", "A", "sku", "same-product")], expected_source_revision="stale")

    def promotion(self, outlets=None, end="2026-09-01"):
        return promotion_overview(platforms=["京东"], outlets=outlets or [], requested_period=period("2026-09-01", end))

    def test_old_promotion_different_store_same_day_never_forms_rate(self):
        self.fact(shop="A"); self.fact(shop="B", promotion=True)
        result = self.promotion()
        self.assertIsNone(result["summary"]["spendRate"])
        self.assertIsNone(result["daily"][0]["spendRate"])
        self.assertEqual(result["summary"]["matchedRange"]["coveredShopDatePairs"], 0)
        self.assertEqual(result["coverage"]["expectedShopDatePairs"], 2)

    def test_old_promotion_full_and_auxiliary_ranges_have_distinct_rate_semantics(self):
        self.fact(); self.fact(promotion=True)
        self.assertEqual(self.promotion()["summary"]["spendRate"], .2)
        result = self.promotion(end="2026-09-02")
        self.assertIsNone(result["summary"]["spendRate"])
        self.assertEqual(result["summary"]["matchedRange"]["spendRate"], .2)
        self.assertEqual(result["coverage"]["missingByShop"][0]["dates"], ["2026-09-02"])

    def test_old_promotion_missing_field_state_or_zero_denominator_not_available(self):
        self.fact(values={"transactionAmountCents": 0}); self.fact(promotion=True)
        self.assertEqual(self.promotion()["summary"]["spendRateReason"], "zero_denominator")
        NetshopRow.objects.filter(source="jd_sku_daily").update(metrics_json={})
        self.assertEqual(self.promotion()["summary"]["spendRateReason"], "incomplete_coverage")
        NetshopPromotionAggregateState.objects.update(ready=False)
        self.assertEqual(self.promotion()["summary"]["matchedRange"]["coveredShopDatePairs"], 0)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_public_context_live_actor_and_no_store(self):
        self.fact()
        url = "/api/netshop/insights-context?"+urlencode({"platform": "京东", "dimension": "sku", "startDate": "2026-09-01", "endDate": "2026-09-01"})
        self.assertEqual(self.client.get(url).status_code, 401)
        headers = signed_headers(url, role="viewer", email=self.user.email)
        response = self.client.get(url, headers=headers)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response["Cache-Control"], "no-store")
        AppUser.objects.filter(email=self.user.email).update(status="disabled")
        self.assertEqual(self.client.get(url, headers=headers).status_code, 403)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_reserved_edge_inherits_exact_signed_policy_and_ordinary_absent_never_falls_back(self):
        self.fact()
        url = "/api/netshop/insights-context?"+urlencode({"platform": "京东", "dimension": "sku", "startDate": "2026-09-01", "endDate": "2026-09-01"})
        self.assertEqual(self.client.get(url, headers={"X-Teruisi-Principal": "local-admin@teruisi.local"}).status_code, 401)
        valid = signed_headers(url, email="local-admin@teruisi.local", role="admin")
        self.assertEqual(self.client.get(url, headers=valid).status_code, 200)
        for email, role, scope in [("absent@example.test", "admin", None), ("local-admin@teruisi.local", "viewer", None), ("local-admin@teruisi.local", "admin", {"platforms": ["京东"], "channels": [], "warehouses": []})]:
            self.assertEqual(self.client.get(url, headers=signed_headers(url, email=email, role=role, scope=scope)).status_code, 403)
        self.assertFalse(AppUser.objects.filter(email="local-admin@teruisi.local").exists())

    @override_settings(DEBUG=False)
    def test_reserved_edge_policy_config_changed_during_read_is_denied(self):
        from django.conf import settings
        from netshop.insights_common import coverage_for
        reserved = Principal("local-admin@teruisi.local", "Local", "admin", None)
        def change(*args):
            settings.DEBUG = True
            return coverage_for(*args)
        with patch("netshop.insights_common.coverage_for", side_effect=change):
            with self.assertRaises(NetshopApiError) as error: read_context(reserved, self.spec(outlet="京东\x1fA"))
        self.assertEqual(error.exception.status, 403)

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_identity_api_live_actor_scope_and_revocation(self):
        self.fact()
        url = "/api/netshop/product-performance?"+urlencode({"view": "identities", "dimension": "sku", "platform": "京东", "startDate": "2026-09-01", "endDate": "2026-09-01", "sourceRevision": revision_value(), "identity": json.dumps(["京东", "A", "sku", "same-product"])})
        headers = signed_headers(url, role="viewer", email=self.user.email)
        self.assertEqual(self.client.get(url, headers=headers).status_code, 200)
        from netshop.views import read_product_performance
        def revoke(**kwargs):
            result = read_product_performance(**kwargs)
            AppUser.objects.filter(email=self.user.email).update(version=2)
            return result
        with patch("netshop.views.read_product_performance", side_effect=revoke):
            self.assertEqual(self.client.get(url, headers=headers).status_code, 403)

    @skipUnless(connection.vendor == "postgresql", "Requires isolated PostgreSQL")
    def test_minimum_reader_context_identity_metadata_cannot_read_extra_columns_or_write(self):
        self.fact()
        tables = ["netshop_rows", "netshop_import_batches", "netshop_data_revisions", "netshop_product_daily_scope_revisions", "netshop_promotion_scope_revisions", "netshop_promotion_aggregate_manifest"]
        with connection.cursor() as cursor:
            cursor.execute("CREATE ROLE foundation_isolated_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE")
            cursor.execute("GRANT USAGE ON SCHEMA public TO foundation_isolated_reader")
            cursor.execute("GRANT SELECT ON "+",".join(tables)+" TO foundation_isolated_reader")
            cursor.execute("GRANT SELECT(email,role,status,scope,version) ON access_control_users TO foundation_isolated_reader")
            cursor.execute("SET LOCAL ROLE foundation_isolated_reader")
        try:
            self.assertEqual(read_context(self.principal, self.spec())["schemaVersion"], "netshop-insights-v1")
            self.assertEqual(read_context(Principal("local-admin@teruisi.local", "Local", "admin", None), self.spec())["schemaVersion"], "netshop-insights-v1")
            with self.assertRaises(DatabaseError), transaction.atomic(): AppUser.objects.values("display_name").first()
            with self.assertRaises(DatabaseError), transaction.atomic(): NetshopRow.objects.update(visitors=99)
        finally:
            with connection.cursor() as cursor: cursor.execute("RESET ROLE")
