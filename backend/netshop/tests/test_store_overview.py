from datetime import date
import hashlib
from unittest.mock import patch
from urllib.parse import urlencode

from unittest import skipUnless
from django.db import connection, transaction, DatabaseError
from django.test import TestCase
from django.db.models import F
from sales.auth import Principal
from sales.summary import _custom_comparison_period, _period_for
from sales.tests.factories import signed_headers, TEST_SECRET
from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow, NetshopPromotionShopDaily, NetshopPromotionAggregateManifest, NetshopPromotionAggregateState
from netshop.store_overview import read, validate, periods, MAX_SAFE
from netshop.errors import NetshopApiError
from django.http import QueryDict


class StoreOverviewTests(TestCase):
    def setUp(self):
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        self.principal = Principal("reader@example.test", "Reader", "viewer", None)
        self.counter = 0

    def tearDown(self):
        # Synthetic direct ORM fixtures obey the real deferred source/revision
        # guard before Django's constraint check; the test transaction rolls back.
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def fact(self, shop="A", day="2026-09-01", platform="京东", promotion=False, values=None, dataset_override=None):
        self.counter += 1
        source = ("jd_promotion" if platform == "京东" else "tmall_promotion") if promotion else ("jd_sku_daily" if platform == "京东" else "tmall_product_daily")
        dataset = ("ad" if platform == "京东" else "promotion_daily") if promotion else ("sku_daily" if platform == "京东" else "spu_daily")
        if dataset_override is not None:
            dataset = dataset_override
        batch = NetshopImportBatch.objects.create(id=f"batch-{self.counter}", source=source, dataset=dataset, platform=platform, shop_name=shop, file_size_bytes=0, file_hash=f"{self.counter:064x}", raw_file_hash="a"*64, content_hash="b"*64, scope_key="c"*64, status="completed")
        metrics = values if values is not None else {"spendCents": 200, "netTransactionAmountCents": 400} if promotion else {"transactionAmountCents": 1000, "visitors": 100, "transactionCustomers": 10}
        column_map = {"transactionAmountCents": "transaction_amount_cents", "visitors": "visitors", "transactionCustomers": "transaction_customers", "spendCents": "spend_cents", "netTransactionAmountCents": "net_transaction_amount_cents"}
        NetshopRow.objects.create(source_row_key=str(self.counter), source_row_hash="d"*64, first_import_batch_id=batch.id, last_import_batch_id=batch.id, source_row_number=2, source=source, dataset=dataset, platform=platform, shop_name=shop, business_date=day, sku_id="same-product", spu_id="same-spu", metrics_json=metrics, **{column_map[k]: v for k, v in metrics.items()})
        if promotion:
            NetshopPromotionAggregateManifest.objects.update_or_create(platform=platform, defaults={"ready": True, "data_version": 1})
            NetshopPromotionShopDaily.objects.create(platform=platform, shop_name=shop, business_date=day, source=source, source_row_count=1, source_batch_id=batch.id, spend_cents=metrics.get("spendCents", 0), net_transaction_amount_cents=metrics.get("netTransactionAmountCents", 0))
            NetshopPromotionAggregateState.objects.create(platform=platform, shop_name=shop, business_date=day, source=source, ready=True, raw_row_count=1)

    def spec(self, **kwargs):
        values = {"platform": "京东", "startDate": "2026-09-01", "endDate": "2026-09-01", **kwargs}
        return validate(QueryDict(urlencode(values, doseq=True)))

    def test_integer_cents_and_product_cumulative_conversion(self):
        self.fact(); self.fact(promotion=True)
        result = read(self.principal, self.spec())
        self.assertEqual(result["summary"]["payment"]["value"], 1000)
        self.assertEqual(result["summary"]["conversion"]["value"], .1)
        self.assertEqual(result["summary"]["spendRate"]["value"], .2)
        self.assertEqual(result["summary"]["roas"]["value"], 2)
        self.assertEqual(result["summary"]["uvValue"]["value"], None)
        self.assertEqual(result["daily"][0]["metrics"], result["summary"])

    def test_bi_spu_is_unique_and_does_not_change_professional_sku_overview(self):
        self.fact()
        self.fact(dataset_override="spu_daily", values={"transactionAmountCents": 2000, "visitors": 20, "transactionCustomers": 4})
        spec = self.spec(); spec["biSummary"] = True
        bi = read(self.principal, spec)
        self.assertEqual(bi["summary"]["visitors"]["value"], 20)
        self.assertEqual(bi["summary"]["conversion"]["value"], .2)
        self.assertEqual(bi["daily"], [])
        self.assertEqual(read(self.principal, self.spec())["summary"]["visitors"]["value"], 100)

    def test_same_day_different_shops_never_form_a_ratio(self):
        self.fact(shop="A"); self.fact(shop="B", promotion=True)
        result = read(self.principal, self.spec())
        self.assertIsNone(result["summary"]["spendRate"]["value"])
        self.assertEqual(result["coverageBySource"]["jd_sku_daily"]["coveredShopDatePairs"], 1)
        self.assertEqual(result["coverageBySource"]["jd_sku_daily"]["expectedShopDatePairs"], 2)

    def test_missing_fields_are_not_default_zeros(self):
        self.fact(values={"transactionAmountCents": 0})
        result = read(self.principal, self.spec())
        self.assertEqual(result["summary"]["payment"]["status"], "available")
        self.assertEqual(result["summary"]["payment"]["value"], 0)
        self.assertEqual(result["summary"]["visitors"]["reasonCode"], "missing_field")
        self.assertIsNone(result["summary"]["visitors"]["value"])

    def test_zero_denominator_and_zero_baseline(self):
        self.fact(values={"transactionAmountCents": 0, "visitors": 0, "transactionCustomers": 0})
        self.fact(day="2026-08-31", values={"transactionAmountCents": 0, "visitors": 0, "transactionCustomers": 0})
        result = read(self.principal, self.spec())
        self.assertIsNone(result["summary"]["conversion"]["value"])
        self.assertEqual(result["comparisons"]["payment"]["previous"]["reasonCode"], "zero_denominator")

    def test_ratios_sum_first_and_can_exceed_one(self):
        self.fact(values={"transactionAmountCents": 100, "visitors": 100, "transactionCustomers": 10}); self.fact(promotion=True, values={"spendCents": 300, "netTransactionAmountCents": 100})
        self.fact(day="2026-09-02", values={"transactionAmountCents": 100, "visitors": 10, "transactionCustomers": 5}); self.fact(day="2026-09-02", promotion=True, values={"spendCents": 100, "netTransactionAmountCents": 100})
        result = read(self.principal, self.spec(endDate="2026-09-02", detailGrain="seven_days"))
        self.assertEqual(result["summary"]["conversion"]["value"], 15/110)
        self.assertEqual(result["summary"]["spendRate"]["value"], 2)
        self.assertEqual(result["details"][0]["metrics"], result["summary"])

    def test_field_presence_and_aggregate_manifest_are_independent(self):
        self.fact(); self.fact(promotion=True)
        NetshopPromotionShopDaily.objects.update(spend_cents=999)
        result = read(self.principal, self.spec())
        self.assertEqual(result["summary"]["spend"]["reasonCode"], "promotion_mismatch")
        self.assertIsNone(result["summary"]["spendRate"]["value"])
        NetshopPromotionAggregateManifest.objects.update(ready=False)
        self.assertEqual(read(self.principal, self.spec())["summary"]["spend"]["reasonCode"], "promotion_not_ready")

    def test_partial_period_never_gets_complete_comparison_or_ratio(self):
        self.fact(); self.fact(promotion=True)
        result = read(self.principal, self.spec(endDate="2026-09-02"))
        self.assertEqual(result["summary"]["payment"]["status"], "partial")
        self.assertIsNone(result["summary"]["spendRate"]["value"])
        self.assertIsNone(result["comparisons"]["payment"]["previous"]["value"])
        self.assertIsNone(result["daily"][1]["metrics"]["payment"]["value"])

    def test_safe_integer_and_same_name_platform_isolation(self):
        self.fact(values={"transactionAmountCents": MAX_SAFE+1})
        self.fact(platform="天猫", values={"transactionAmountCents": 300})
        self.assertEqual(read(self.principal, self.spec())["summary"]["payment"]["status"], "invalid")
        self.assertEqual(read(self.principal, self.spec(platform="天猫"))["summary"]["payment"]["value"], 300)

    def test_shop_details_bind_token_and_cannot_escape_scope(self):
        self.fact(); self.fact(shop="B")
        result = read(self.principal, self.spec(outlet="京东\x1fA"))
        spec = self.spec(outlet="京东\x1fA", view="shop", shopKey="京东\x1fA", overviewToken=result["overviewToken"])
        self.assertEqual(read(self.principal, spec)["overviewToken"], result["overviewToken"])
        spec["shopKey"] = "京东\x1fB"
        with self.assertRaises(NetshopApiError): read(self.principal, spec)
        spec["shopKey"] = "京东\x1fA"; NetshopDataRevision.objects.update(revision=2)
        with self.assertRaises(NetshopApiError): read(self.principal, spec)

    def test_rolling_and_custom_keep_different_intent(self):
        rolling = periods("2026-09-24", "2026-09-30", "last7")
        custom = periods("2026-09-24", "2026-09-30", "custom")
        self.assertEqual(rolling["previous"]["startDate"], "2026-09-17")
        self.assertEqual(custom["previous"]["startDate"], "2026-08-24")

    def test_date_algorithm_matches_existing_sales_contract(self):
        for start, end in [("2026-03-01", "2026-03-31"), ("2024-02-01", "2024-02-29"), ("2026-03-29", "2026-03-31"), ("2026-08-28", "2026-09-04"), ("2026-09-30", "2026-09-30")]:
            actual = periods(start, end, "custom")
            expected = _custom_comparison_period(date.fromisoformat(start), date.fromisoformat(end))
            self.assertEqual((actual["previous"]["startDate"], actual["previous"]["endDate"]), expected)
        self.assertEqual(periods("2026-07-01", "2026-09-30", "quarter")["previous"]["endDate"], _period_for("quarter", "2026-09-30")["previousEndDate"])

    def test_leap_day_does_not_double_count_baseline(self):
        for day in ["2024-02-28", "2024-02-29", "2023-02-28"]: self.fact(day=day)
        result = read(self.principal, self.spec(startDate="2024-02-28", endDate="2024-02-29"))
        self.assertEqual(result["comparisons"]["payment"]["yearAgo"]["value"], 1)
        self.assertIsNone(result["daily"][1]["comparisonDates"]["yearAgo"])
        self.assertIsNone(result["daily"][1]["comparisons"]["payment"]["yearAgo"]["value"])

    def test_natural_week_and_seven_day_tail_are_distinct(self):
        result = read(self.principal, self.spec(startDate="2026-09-02", endDate="2026-09-11", trendGrain="week", detailGrain="seven_days"))
        self.assertEqual([r["days"] for r in result["trend"]], [5, 5])
        self.assertEqual([r["days"] for r in result["details"]], [3, 7])

    def test_seven_day_average_needs_six_prior_days(self):
        for d in range(26, 32): self.fact(day=f"2026-08-{d}")
        self.fact()
        result = read(self.principal, self.spec())
        self.assertEqual(result["movingAverage"][0]["paymentCents"], 1000)
        NetshopRow.objects.filter(business_date="2026-08-26").delete()
        self.assertIsNone(read(self.principal, self.spec())["movingAverage"][0]["paymentCents"])

    def test_repeated_revision_changes_fail_closed(self):
        self.fact()
        with patch("netshop.store_overview.revision_value", side_effect=["a", "b", "c", "d"]):
            with self.assertRaises(NetshopApiError): read(self.principal, self.spec())

    def test_reject_duplicate_invalid_dates_and_unsupported_grains(self):
        for query in ["platform=京东&platform=天猫", "platform=京东&startDate=2026-02-30&endDate=2026-03-01", "platform=京东&startDate=2025-01-01&endDate=2026-01-03", "platform=京东&startDate=2026-09-01&endDate=2026-09-02&trendGrain=year"]:
            with self.assertRaises(NetshopApiError): validate(QueryDict(query))

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_public_reader_auth_and_no_store(self):
        self.fact()
        url = "/api/netshop/store-overview?" + urlencode({"platform": "京东", "startDate": "2026-09-01", "endDate": "2026-09-01"})
        self.assertEqual(self.client.get(url).status_code, 401)
        response = self.client.get(url, headers=signed_headers(url, role="viewer"))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response["Cache-Control"], "no-store")
        response = self.client.get(url, headers=signed_headers(url, scope={"platforms": ["天猫"], "brands": []}))
        self.assertEqual(response.status_code, 403)

    def test_manifest_changes_without_global_change_are_fenced(self):
        self.fact(); self.fact(promotion=True)
        from netshop.store_overview import source_versions
        calls = 0
        def changing(*args):
            nonlocal calls
            calls += 1
            if calls % 2 == 0: NetshopPromotionAggregateManifest.objects.update(data_version=F("data_version") + 1)
            return source_versions(*args)
        with patch("netshop.store_overview.source_versions", side_effect=changing):
            with self.assertRaises(NetshopApiError): read(self.principal, self.spec())
        self.assertEqual(calls, 4)

    def test_non_numeric_field_is_not_evidence_of_a_default_zero(self):
        self.fact()
        NetshopRow.objects.update(metrics_json={"visitors": "--", "transactionAmountCents": 1000, "transactionCustomers": 10})
        result = read(self.principal, self.spec())
        self.assertIsNone(result["summary"]["visitors"]["value"])
        self.assertEqual(result["summary"]["visitors"]["reasonCode"], "missing_field")

    @skipUnless(connection.vendor == "postgresql", "Requires isolated PostgreSQL")
    def test_minimum_reader_selects_new_overview_and_cannot_write(self):
        self.fact()
        tables = ["netshop_rows", "netshop_import_batches", "netshop_data_revisions", "netshop_product_daily_scope_revisions", "netshop_promotion_scope_revisions", "netshop_promotion_aggregate_manifest", "netshop_promotion_shop_daily", "netshop_promotion_aggregate_state"]
        with connection.cursor() as c:
            c.execute("CREATE ROLE overview_isolated_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE")
            c.execute("GRANT USAGE ON SCHEMA public TO overview_isolated_reader")
            # Names are fixed developer-controlled relation identifiers.
            c.execute("GRANT SELECT ON " + ",".join(tables) + " TO overview_isolated_reader")
            c.execute("SET LOCAL ROLE overview_isolated_reader")
        try:
            result = read(self.principal, self.spec())
            self.assertEqual(result["summary"]["payment"]["value"], 1000)
            with self.assertRaises(DatabaseError):
                with transaction.atomic():
                    NetshopRow.objects.update(visitors=99)
        finally:
            with connection.cursor() as c: c.execute("RESET ROLE")

    def test_preset_length_and_extreme_dates_fail_as_invalid_range(self):
        for start, end, kind in [("2026-09-01", "2026-09-02", "last7"), ("2026-09-02", "2026-09-20", "month"), ("0001-01-01", "0001-01-01", "custom"), ("9999-12-31", "9999-12-31", "custom")]:
            with self.assertRaises(NetshopApiError): periods(start, end, kind)

    def test_negative_baseline_is_explicitly_not_a_normal_growth_rate(self):
        self.fact(values={"transactionAmountCents": 100, "visitors": 10, "transactionCustomers": 1})
        self.fact(day="2026-08-31", values={"transactionAmountCents": -100, "visitors": 10, "transactionCustomers": 1})
        result = read(self.principal, self.spec())
        self.assertEqual(result["comparisons"]["payment"]["previous"]["reasonCode"], "negative_baseline")
        self.assertIsNone(result["comparisons"]["payment"]["previous"]["value"])

    def test_screenshot_ranges_all_shops_and_freshness_outside_selected_period(self):
        for platform in ("京东", "天猫"):
            for shop in ("A", "B", "C", "D"):
                self.fact(shop=shop, day="2026-09-20", platform=platform)
                self.fact(shop=shop, day="2026-09-20", platform=platform, promotion=True)
            self.fact(shop="A", day="2026-09-29", platform=platform)
            self.fact(shop="A", day="2026-09-29", platform=platform, promotion=True)
            self.fact(shop="B", day="2026-09-30", platform=platform)
            # A newer unfinished row is not a valid freshness witness.
            NetshopImportBatch.objects.filter(id=f"batch-{self.counter}").update(status="running")
            for end in ("2026-09-24", "2026-09-26"):
                for selected in ({}, {"outlet": platform + "\x1fA"}):
                    with self.subTest(platform=platform, end=end, selected=selected):
                        result = read(self.principal, self.spec(
                            platform=platform, startDate="2026-09-20", endDate=end, **selected,
                        ))
                        self.assertEqual(len(result["shopOptions"]), 4)
                        self.assertEqual([f["dataThrough"] for f in result["freshness"]],
                                         ["2026-09-29", "2026-09-29"])
                        self.assertEqual(result["summary"]["payment"]["value"],
                                         1000 if selected else 4000)
