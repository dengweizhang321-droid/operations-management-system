"""Product-owned detail, source association, catalogue and structure evidence."""
import json
import os
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from django.http import QueryDict
from django.test import TestCase

from netshop.errors import NetshopApiError
from netshop.models import (
    NetshopImportBatch, NetshopPromotionAggregateManifest, NetshopPromotionAggregateState,
    NetshopPromotionProductDaily, NetshopRow,
)
from netshop.product_insights import read_product_detail, read_product_insights, validate_product_query
from . import test_product_insights as product_fixtures


class ProductDetailTests(TestCase):
    setUp = product_fixtures.ProductInsightsTests.setUp
    tearDown = product_fixtures.ProductInsightsTests.tearDown
    fact = product_fixtures.ProductInsightsTests.fact
    spec = product_fixtures.ProductInsightsTests.spec
    read = product_fixtures.ProductInsightsTests.read

    def detail_spec(self, *, platform="京东", shop="A", product="P1", dimension="spu", **values):
        return validate_product_query(QueryDict(urlencode({"platform": platform, "outlet": platform + "\x1f" + shop, "dimension": dimension, "startDate": "2026-09-01", "endDate": "2026-09-01", "productIdentity": json.dumps([platform, shop, dimension, product]), **values}, doseq=True)), detail=True)

    def detail(self, **values):
        return read_product_detail(self.principal, self.detail_spec(**values))

    def master(self, *, platform="京东", shop="A", product="P1", dimension="spu", snapshot="2026-10-01", **fields):
        row = self.fact(platform=platform, shop=shop, product=product, dimension=dimension)
        source = "jd_product_master" if platform == "京东" else "tmall_product_master"
        NetshopImportBatch.objects.filter(id=row.last_import_batch_id).update(source=source, dataset="product_master", snapshot_date=snapshot)
        NetshopRow.objects.filter(pk=row.pk).update(source=source, dataset="product_master", business_date=None, snapshot_date=snapshot, **fields)
        return row

    def asset(self, *, platform="天猫", shop="A", product="P1", snapshot="2026-09-30"):
        row = self.fact(platform=platform, shop=shop, product=product)
        source, dataset = ("tmall_product_assets", "spu_assets") if platform == "天猫" else ("jd_yimei_sku", "yimei_sku")
        NetshopImportBatch.objects.filter(id=row.last_import_batch_id).update(source=source, dataset=dataset, snapshot_date=snapshot)
        NetshopRow.objects.filter(pk=row.pk).update(source=source, dataset=dataset, business_date=None, snapshot_date=snapshot, image_content_sha256="c" * 64)
        return row

    def promotion(self, *, platform="天猫", shop="A", product="P1", day="2026-09-01", spend=200, attributed=400, clicks=10):
        row = self.fact(platform=platform, shop=shop, product=product, dimension="sku" if platform == "京东" else "spu", day=day)
        source, dataset = ("jd_promotion", "ad") if platform == "京东" else ("tmall_promotion", "promotion_daily")
        NetshopImportBatch.objects.filter(id=row.last_import_batch_id).update(source=source, dataset=dataset)
        NetshopRow.objects.filter(pk=row.pk).update(source=source, dataset=dataset, metrics_json={"spendCents": spend, "netTransactionAmountCents": attributed, "clicks": clicks}, spend_cents=spend, net_transaction_amount_cents=attributed, clicks=clicks)
        NetshopPromotionAggregateManifest.objects.update_or_create(platform=platform, defaults={"ready": True, "data_version": 1})
        NetshopPromotionProductDaily.objects.create(platform=platform, shop_name=shop, business_date=day, source=source, product_id=product, spend_cents=spend, net_transaction_amount_cents=attributed, clicks=clicks, source_row_count=1, source_batch_id=row.last_import_batch_id)
        count = NetshopRow.objects.filter(platform=platform, shop_name=shop, business_date=day, source=source).count()
        NetshopPromotionAggregateState.objects.update_or_create(platform=platform, shop_name=shop, business_date=day, defaults={"source": source, "ready": True, "raw_row_count": count})

    def test_exact_detail_not_rank_page_and_baseline_values_preserved(self):
        self.fact(product="P1", values={"transactionAmountCents": 100})
        self.fact(product="P1", day="2026-08-31", values={"transactionAmountCents": 25})
        self.fact(product="P2", values={"transactionAmountCents": 9000})
        result = self.detail()["sections"]["performance"]
        self.assertEqual(result["identity"]["id"], "P1")
        self.assertEqual(result["metrics"]["payment"]["value"], 100)
        self.assertEqual(result["baselineMetrics"]["previous"]["payment"]["value"], 25)

    def test_detail_rejects_implicit_multi_store_or_cross_identity(self):
        base = {"platform": "京东", "outlet": "京东\x1fA", "startDate": "2026-09-01", "endDate": "2026-09-01", "productIdentity": json.dumps(["京东", "A", "spu", "P1"])}
        for delta in ({"outlet": []}, {"outlet": ["京东\x1fA", "京东\x1fB"]}, {"platform": ["京东", "天猫"]}, {"productIdentity": json.dumps(["京东", "B", "spu", "P1"])}):
            with self.subTest(delta=delta), self.assertRaises(NetshopApiError):
                validate_product_query(QueryDict(urlencode({**base, **delta}, doseq=True)), detail=True)

    def test_catalog_current_price_inventory_and_independent_image_dates(self):
        self.fact(platform="天猫")
        self.master(platform="天猫", price_cents=12345, total_inventory=12, available_inventory=9, sale_attribute="220V", brand="示例", product_status="上架")
        self.asset(platform="天猫", snapshot="2026-09-30")
        result = self.detail(platform="天猫")["sections"]["catalog"]["data"]
        self.assertEqual(result["price"]["value"], 12345)
        self.assertEqual(result["inventory"]["available"]["value"], 9)
        self.assertEqual(result["snapshots"]["master"], "2026-10-01")
        self.assertEqual(result["snapshots"]["image"], "2026-09-30")
        self.assertEqual(result["mapping"]["status"], "unverified")
        self.assertIsNone(result["erpCode"])

    def test_current_catalog_does_not_generate_old_daily_stock(self):
        self.fact()
        self.master(price_cents=50000, total_inventory=30, available_inventory=20)
        result = self.detail(section="daily")["sections"]["daily"]["data"]
        self.assertNotIn("inventory", result["items"][0]["metrics"])
        self.assertEqual(result["source"], "platform")

    def test_missing_master_retains_business_performance(self):
        self.fact()
        result = self.detail()["sections"]
        self.assertIsNone(result["catalog"]["data"])
        self.assertEqual(result["performance"]["metrics"]["payment"]["value"], 1000)

    def test_catalog_batch_mismatch_is_source_error_not_empty_or_lost_performance(self):
        self.fact()
        master = self.master()
        NetshopImportBatch.objects.filter(id=master.last_import_batch_id).update(row_count=2)
        result = self.detail()["sections"]
        self.assertEqual(result["catalog"]["state"], "error")
        self.assertEqual(result["performance"]["metrics"]["payment"]["value"], 1000)

    def test_tmall_erp_never_assumed_zero_cost_or_high_margin(self):
        self.fact(platform="天猫")
        self.master(platform="天猫", product_code="Precise-CODE")
        result = self.detail(platform="天猫")["sections"]["erp"]["data"]
        self.assertEqual(result["mapping"]["status"], "unverified")
        for key in ("netSales", "cost", "largeMarginRate", "orderMargin"):
            self.assertIsNone(result["metrics"][key]["value"])

    def test_historical_spu_sku_relation_unavailable_despite_current_catalog(self):
        self.fact()
        self.master()
        result = self.detail()["sections"]["skuContribution"]
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["items"], [])
        self.assertIsNone(result["relationVersion"])

    def test_platform_daily_null_gap_and_stable_version_page(self):
        self.fact()
        self.fact(day="2026-09-03")
        first = self.detail(section="daily", endDate="2026-09-03", pageSize="2")
        data = first["sections"]["daily"]["data"]
        self.assertEqual(data["pagination"]["total"], 3)
        self.assertEqual(data["items"][1]["date"], "2026-09-02")
        self.assertIsNone(data["items"][1]["metrics"]["payment"]["value"])
        second = self.detail(section="daily", endDate="2026-09-03", pageSize="2", page="2", snapshotToken=first["context"]["snapshotToken"], sectionToken=first["sectionToken"])
        self.assertEqual(second["sections"]["daily"]["data"]["items"][0]["date"], "2026-09-03")

    def test_exact_promotion_cross_store_same_id_isolated(self):
        self.fact(platform="天猫")
        self.promotion(platform="天猫", shop="A", spend=200, attributed=400)
        self.promotion(platform="天猫", shop="B", spend=900, attributed=9000)
        result = self.detail(platform="天猫")["sections"]["promotion"]["data"]
        self.assertEqual(result["metrics"]["spend"]["value"], 200)
        self.assertEqual(result["metrics"]["roas"]["value"], 2)
        self.assertEqual(result["mapping"]["status"], "verified")
        self.assertIsNone(result["attributionWindow"])

    def test_jd_follow_sku_exact_not_spu_current_relation(self):
        self.fact(dimension="sku")
        self.promotion(platform="京东")
        sku = self.detail(dimension="sku")["sections"]["promotion"]["data"]
        self.assertEqual(sku["metrics"]["spend"]["value"], 200)
        self.fact(dimension="spu")
        spu = self.detail()["sections"]["promotion"]["data"]
        self.assertIsNone(spu["metrics"]["spend"]["value"])
        self.assertEqual(spu["mapping"]["status"], "unverified")

    def test_promotion_raw_aggregate_mismatch_is_not_trusted(self):
        self.fact(platform="天猫")
        self.promotion()
        NetshopPromotionProductDaily.objects.update(spend_cents=999)
        result = self.detail(platform="天猫")["sections"]["promotion"]["data"]
        self.assertIsNone(result["metrics"]["spend"]["value"])
        self.assertEqual(result["metrics"]["spend"]["reasonCode"], "promotion_mismatch")
        self.assertIsNone(result["metrics"]["roas"]["value"])

    def test_promotion_daily_preserves_source_and_field_definitions(self):
        self.fact(platform="天猫")
        self.promotion()
        result = self.detail(platform="天猫", section="daily", source="promotion")["sections"]["daily"]["data"]
        self.assertEqual(result["source"], "promotion")
        self.assertEqual(result["items"][0]["metrics"]["attributedPayment"]["value"], 400)
        self.assertNotIn("payment", result["items"][0]["metrics"])

    def test_unverified_erp_daily_does_not_create_a_fake_join(self):
        self.fact()
        result = self.detail(section="daily", source="erp")["sections"]["daily"]
        self.assertEqual(result["state"], "error")
        self.assertIsNone(result["data"])

    def test_complete_set_top_concentration_categories_pricebands_not_current_page(self):
        for number in range(25):
            self.fact(product=f"P{number:02d}", category="A" if number < 10 else "B", values={"transactionAmountCents": (number + 1) * 100, "transactionQuantity": 1})
        result = self.read(pageSize="1", q="P00")["sections"]["structure"]
        self.assertEqual(result["denominator"]["value"], 32500)
        self.assertEqual(result["top5Payment"]["value"], 11500)
        self.assertEqual(result["top5Share"]["value"], 11500 / 32500)
        self.assertEqual(sum(bucket["payment"]["value"] for bucket in result["categories"]), 32500)
        self.assertEqual(result["priceBasis"], "transaction_mean")
        self.assertEqual(result["categoryBasis"], "source_label_only")

    def test_newly_traded_requires_explicit_zero_previous_not_absent(self):
        self.fact(product="new")
        self.fact(product="new", day="2026-08-31", values={"transactionAmountCents": 0})
        self.fact(product="unknown")
        result = self.read()["sections"]["structure"]
        self.assertEqual(result["classification"]["newlyTraded"]["value"], 1)
        self.assertEqual(result["classification"]["unknownBaseline"]["value"], 1)

    def test_watchlist_explicit_rule_sample_and_global_scan(self):
        self.fact(product="watch", values={"visitors": 400, "transactionCustomers": 2, "transactionAmountCents": 1000})
        self.fact(product="small", values={"visitors": 100, "transactionCustomers": 0})
        self.fact(product="missing", values={"visitors": 500})
        result = self.read(q="small")["sections"]["efficiency"]
        self.assertEqual(result["scanned"], 3)
        self.assertEqual(result["qualified"], 1)
        self.assertEqual(result["watchlist"][0]["identity"]["id"], "watch")
        self.assertEqual(result["rules"]["minimumVisitors"], 300)

    def test_source_only_extra_fields_and_presence_not_type_default(self):
        self.fact(values={"pageViews": 99, "favorites": 7, "orderCustomers": 4, "orderQuantity": 5, "orderPayment": 100, "searchImpressions": 100, "searchClicks": 10})
        metrics = self.read()["sections"]["efficiency"]["metrics"]
        self.assertEqual(metrics["pageViews"]["value"], 99)
        self.assertEqual(metrics["searchClickRate"]["value"], 0.1)
        self.assertIsNone(metrics["searchVisitors"]["value"])

    def test_read_only_quality_labels_and_snapshot_counts(self):
        self.fact(platform="天猫")
        self.master(platform="天猫", product_code="", raw_json={}, category="", snapshot="2026-01-01")
        self.asset()
        quality = self.read(platform="天猫")["sections"]["dataQuality"]
        self.assertEqual(quality["counts"]["missingImage"]["value"], 0)
        self.assertEqual(quality["counts"]["missingCode"]["value"], 1)
        self.assertEqual(quality["counts"]["stale"]["value"], 1)
        self.assertEqual(quality["counts"]["unmapped"]["status"], "unavailable")
        self.assertIsNone(quality["counts"]["unmapped"]["value"])
        self.assertEqual(quality["counts"]["unmapped"]["reasonCode"], "unverified_source")

    def test_list_images_exact_shop_and_assets_without_master(self):
        self.fact(platform="天猫", shop="A")
        self.fact(platform="天猫", shop="B")
        self.asset(shop="A")
        items = self.read(platform="天猫")["sections"]["items"]
        self.assertTrue(next(row for row in items if row["identity"]["shopName"] == "A")["imageUrl"])
        self.assertIsNone(next(row for row in items if row["identity"]["shopName"] == "B")["imageUrl"])

    def test_empty_implicit_scope_and_invalid_section_parameters(self):
        result = self.read()
        self.assertEqual(result["sections"]["pagination"]["total"], 0)
        for delta in ({"source": "platform"}, {"section": "daily"}, {"page": "01"}, {"pageSize": ""}):
            with self.subTest(delta=delta), self.assertRaises(NetshopApiError):
                self.spec(**delta)

    def test_detail_source_and_section_tokens_cannot_cross_kinds(self):
        self.fact()
        first = self.detail(section="daily")
        with self.assertRaises(NetshopApiError) as failure:
            self.detail(section="trends", sectionToken=first["sectionToken"])
        self.assertEqual(failure.exception.status, 409)

    def test_duplicate_current_sku_stock_is_not_double_counted(self):
        self.fact(dimension="sku")
        self.master(dimension="sku", total_inventory=10, available_inventory=8)
        duplicate = self.fact(dimension="sku")
        head = NetshopImportBatch.objects.filter(source="jd_product_master").first()
        NetshopRow.objects.filter(pk=duplicate.pk).update(source="jd_product_master", dataset="product_master", last_import_batch_id=head.id, business_date=None, snapshot_date=head.snapshot_date)
        NetshopImportBatch.objects.filter(pk=head.id).update(row_count=2)
        result = self.detail(dimension="sku")["sections"]["catalog"]["data"]
        self.assertIsNone(result["inventory"]["available"]["value"])
        self.assertEqual(result["inventory"]["available"]["reasonCode"], "ambiguous_mapping")

    def test_immutable_real_pg_wire_samples_for_frontend_consumer(self):
        self.fact(platform="天猫")
        self.fact(platform="天猫", day="2026-08-31")
        self.master(platform="天猫", total_inventory=12, available_inventory=10, price_cents=12345)
        self.asset()
        self.promotion()
        spec = self.spec(platform="天猫")
        listing = read_product_insights(self.principal, spec)
        detail = self.detail(platform="天猫", section="daily", source="promotion")
        destination = os.environ.get("TERUISI_PRODUCTS_QUERY_EVIDENCE_DIR")
        if destination:
            samples = {"wire-list.json": {"query": urlencode({"platform": "天猫", "startDate": "2026-09-01", "endDate": "2026-09-01"}), "revision": listing["context"]["sourceRevisions"][0]["revision"], "payload": listing},
                       "wire-detail.json": {"query": urlencode({"platform": "天猫", "outlet": "天猫\x1fA", "startDate": "2026-09-01", "endDate": "2026-09-01", "productIdentity": json.dumps(["天猫", "A", "spu", "P1"]), "section": "daily", "source": "promotion"}), "revision": detail["context"]["sourceRevisions"][0]["revision"], "payload": detail}}
            for name, payload in samples.items():
                with (Path(destination) / name).open("x", encoding="utf-8") as output:
                    json.dump(payload, output, ensure_ascii=False, indent=2)

    def test_complete_paired_changes_unaffected_by_page_search_or_category_history(self):
        self.fact(product="gain", values={"transactionAmountCents": 1000}, category="A")
        self.fact(product="gain", day="2026-08-31", values={"transactionAmountCents": 100}, category="B")
        self.fact(product="loss", values={"transactionAmountCents": 200}, category="A")
        self.fact(product="loss", day="2026-08-31", values={"transactionAmountCents": 800}, category="C")
        self.fact(product="unknown", category="A")
        result = self.read(category="A", q="gain", pageSize="1")["sections"]["structure"]
        changes = result["changes"]
        self.assertEqual(changes["pairedCurrentPayment"]["value"], 1200)
        self.assertEqual(changes["pairedPreviousPayment"]["value"], 900)
        self.assertEqual(changes["growthPayment"]["value"], 900)
        self.assertEqual(changes["declinePayment"]["value"], -600)
        self.assertEqual(changes["netChange"]["value"], 300)
        self.assertEqual(result["qualification"]["paired"], 2)
        self.assertEqual(result["qualification"]["missingPrevious"], 1)

    def test_payment_delta_zero_baseline_is_amount_not_infinite_rate(self):
        self.fact(values={"transactionAmountCents": 1000})
        self.fact(day="2026-08-31", values={"transactionAmountCents": 0})
        row = self.read()["sections"]["items"][0]
        self.assertEqual(row["paymentDelta"]["value"], 1000)
        self.assertEqual(row["comparisons"]["payment"]["previous"]["reasonCode"], "zero_denominator")

    def test_payment_delta_overflow_invalid_and_growth_unsafe_excluded(self):
        self.fact(values={"transactionAmountCents": 9_007_199_254_740_991})
        self.fact(day="2026-08-31", values={"transactionAmountCents": -9_007_199_254_740_991})
        result = self.read()["sections"]
        self.assertEqual(result["items"][0]["paymentDelta"]["reasonCode"], "unsafe_integer")
        self.assertIsNone(result["items"][0]["paymentDelta"]["value"])
        self.assertEqual(result["growth"]["data"]["pagination"]["total"], 0)

    def test_all_missing_payment_does_not_become_partial_zero_structure(self):
        self.fact(values={"visitors": 100})
        result = self.read()["sections"]["structure"]
        self.assertIsNone(result["top5Payment"]["value"])
        self.assertIsNone(result["categories"][0]["payment"]["value"])

    def test_detail_baseline_error_has_null_values_delta_and_preserved_current(self):
        self.fact()
        from netshop.product_insights import _aggregate
        calls = [0]
        def fail_previous(*args):
            calls[0] += 1
            if calls[0] == 2:
                raise NetshopApiError("synthetic failure", status=503, code="service_unavailable")
            return _aggregate(*args)
        with patch("netshop.product_insights._aggregate", side_effect=fail_previous):
            result = self.detail()["sections"]
        self.assertEqual(result["performance"]["metrics"]["payment"]["value"], 1000)
        self.assertIsNone(result["performance"]["baselineMetrics"]["previous"]["payment"]["value"])
        self.assertIsNone(result["performance"]["paymentDelta"]["value"])

    def test_fractional_cent_visitor_value_uses_shared_independent_schema(self):
        self.fact(values={"transactionAmountCents": 101, "visitors": 3})
        result = self.read()["sections"]["efficiency"]
        value = result["visitorValue"]
        self.assertEqual(value["metricSchemaVersion"], "netshop-money-per-count-v1")
        self.assertEqual(value["unit"], "CNY_CENT_PER_COUNT")
        self.assertEqual(value["denominatorKind"], "product_day_visitors_sum")
        self.assertEqual(value["value"], 101 / 3)
        self.assertNotIn("visitorValue", result["metrics"])
        self.assertEqual(self.detail()["sections"]["visitorValue"], value)

    def test_visitor_value_weighted_operands_and_period_comparison(self):
        self.fact(product="A", values={"transactionAmountCents": 100, "visitors": 1})
        self.fact(product="B", values={"transactionAmountCents": 1, "visitors": 100})
        self.fact(product="A", day="2026-08-31", values={"transactionAmountCents": 50, "visitors": 101})
        result = self.read()["sections"]["efficiency"]
        self.assertEqual(result["visitorValue"]["value"], 1)
        self.assertEqual(result["visitorValue"]["numerator"], 101)
        self.assertEqual(result["visitorValue"]["denominator"], 101)
        self.assertEqual(result["visitorValueComparisons"]["previous"]["value"], (1 - 50 / 101) / (50 / 101))

    def test_visitor_value_true_zero_zero_negative_missing_and_partial_denominator(self):
        from netshop.product_insights import _visitor_value
        metric = self.read()["sections"]["summary"]
        for payment, visitors, expected in ((0, 3, None), (100, 0, "zero_denominator"), (100, -3, "negative_denominator")):
            supplied = {**metric, "payment": {**metric["payment"], "value": payment, "status": "available", "reasonCode": None}, "visitors": {**metric["visitors"], "value": visitors, "status": "available", "reasonCode": None}}
            value = _visitor_value(supplied)
            self.assertEqual(value["reasonCode"], expected)
            if expected is None:
                self.assertEqual(value["value"], 0)
        self.fact(values={"transactionAmountCents": 101})
        self.assertIsNone(self.read()["sections"]["efficiency"]["visitorValue"]["value"])
        NetshopRow.objects.update(visitors=3, metrics_json={"transactionAmountCents": 101, "visitors": 3})
        self.assertIsNone(self.read(endDate="2026-09-02")["sections"]["efficiency"]["visitorValue"]["value"])

    def test_platform_daily_visitor_value_is_outside_original_metric_map(self):
        self.fact(values={"transactionAmountCents": 101, "visitors": 3})
        row = self.detail(section="daily")["sections"]["daily"]["data"]["items"][0]
        self.assertEqual(row["visitorValue"]["value"], 101 / 3)
        self.assertNotIn("visitorValue", row["metrics"])

    def test_unverified_mapping_not_reported_as_confirmed_unmapped_profile(self):
        self.fact()
        self.master(product_code="Valid-looking-code")
        profile = self.detail()["sections"]["catalog"]["data"]
        self.assertEqual(profile["mapping"]["status"], "unverified")
        self.assertIn("mapping_unverified", profile["quality"])
        self.assertNotIn("unmapped", profile["quality"])

    def test_jd_platform_code_is_not_merchant_or_erp_code(self):
        self.fact()
        self.master(product_code="Platform-SPU", raw_json={})
        result = self.detail()["sections"]["catalog"]["data"]
        self.assertIsNone(result["merchantCode"])
        self.assertIsNone(result["erpCode"])
        self.assertIn("missingCode", result["quality"])

    def test_promotion_aggregate_without_completed_raw_is_not_no_records(self):
        self.fact(platform="天猫")
        self.promotion()
        NetshopImportBatch.objects.filter(source="tmall_promotion").update(status="processing")
        result = self.detail(platform="天猫")["sections"]["promotion"]["data"]
        self.assertEqual(result["metrics"]["spend"]["reasonCode"], "promotion_mismatch")
        self.assertIsNone(result["metrics"]["spend"]["value"])

    def test_image_foreign_shop_completed_batch_cannot_validate_current_identity(self):
        self.fact(platform="天猫", shop="A")
        self.fact(platform="天猫", shop="B")
        asset_a = self.asset(shop="A")
        asset_b = self.asset(shop="B")
        NetshopRow.objects.filter(pk=asset_a.pk).update(last_import_batch_id=asset_b.last_import_batch_id)
        rows = self.read(platform="天猫")["sections"]["items"]
        self.assertIsNone(next(row for row in rows if row["identity"]["shopName"] == "A")["imageUrl"])
        self.assertTrue(next(row for row in rows if row["identity"]["shopName"] == "B")["imageUrl"])

    def test_wrong_image_dataset_not_validated_in_new_detail_list_or_quality(self):
        self.fact(platform="天猫")
        self.master(platform="天猫")
        asset = self.asset(platform="天猫")
        NetshopImportBatch.objects.filter(pk=asset.last_import_batch_id).update(dataset="product_master")
        NetshopRow.objects.filter(pk=asset.pk).update(dataset="product_master")
        result = self.detail(platform="天猫")["sections"]["catalog"]["data"]
        self.assertIsNone(result["imageUrl"])
        listing = self.read(platform="天猫")["sections"]
        self.assertIsNone(listing["items"][0]["imageUrl"])
        self.assertIsNone(listing["dataQuality"]["counts"]["missingImage"]["value"])
        self.assertEqual(listing["dataQuality"]["counts"]["missingImage"]["reasonCode"], "unverified_source")
        self.assertEqual(result["imageStatus"], "unverified")

    def test_successful_detail_baseline_expiry_stops_before_group_and_catalog(self):
        self.fact()
        from netshop.product_insights import _aggregate, _grouped
        clock, reads, next_phase = [0.0], [0], [0]
        def aggregate(*args):
            value = _aggregate(*args)
            reads[0] += 1
            if reads[0] == 3:
                clock[0] = 66.0
            return value
        def group(*args):
            next_phase[0] += 1
            return _grouped(*args)
        with patch("netshop.product_insights.time.monotonic", side_effect=lambda: clock[0]), patch("netshop.product_insights._aggregate", side_effect=aggregate), patch("netshop.product_insights._grouped", side_effect=group), self.assertRaises(NetshopApiError) as failure:
            self.detail()
        self.assertEqual(failure.exception.code, "source_not_ready")
        self.assertEqual(next_phase[0], 0)

    def test_successful_source_loader_expiry_is_not_downgraded_to_section_error(self):
        self.fact()
        from netshop.product_insights import _source_section
        clock = [0.0]
        def loader():
            value = NetshopRow.objects.count()
            clock[0] = 66.0
            return value
        with patch("netshop.product_insights.time.monotonic", side_effect=lambda: clock[0]), self.assertRaises(NetshopApiError) as failure:
            _source_section(loader, 65.0)
        self.assertEqual(failure.exception.code, "source_not_ready")

    def test_code_only_current_image_gap_is_unverified_not_missing_in_new_insights(self):
        self.fact(dimension="sku")
        self.master(dimension="sku", product_code="CURRENT-CODE")
        asset = self.asset(platform="京东")
        NetshopRow.objects.filter(pk=asset.pk).update(sku_id="", product_code="CURRENT-CODE", raw_json={"商品编码": "CURRENT-CODE"})
        profile = self.detail(dimension="sku")["sections"]["catalog"]["data"]
        self.assertEqual(profile["imageStatus"], "unverified")
        self.assertIn("image_identity_unverified", profile["quality"])
        self.assertNotIn("missingImage", profile["quality"])
        listing = self.read(dimension="sku")["sections"]
        self.assertIsNone(listing["dataQuality"]["counts"]["missingImage"]["value"])
        self.assertEqual(listing["items"][0]["imageStatus"], "unverified")

    def test_sql_boundary_budget_expiry_after_master_count_starts_no_further_select(self):
        self.fact()
        self.master()
        clock, triggered, after_expiry = [0.0], [False], [0]
        def expire(execute, sql, params, many, context):
            if triggered[0] and str(sql).lstrip().upper().startswith("SELECT"):
                after_expiry[0] += 1
            value = execute(sql, params, many, context)
            if not triggered[0] and str(sql).startswith("SELECT COUNT(*)") and '"source" = %s' in str(sql) and "jd_product_master" in params:
                triggered[0] = True
                clock[0] = 66.0
            return value
        from django.db import connection
        with patch("netshop.product_insights.time.monotonic", side_effect=lambda: clock[0]), connection.execute_wrapper(expire), self.assertRaises(NetshopApiError) as failure:
            self.detail()
        self.assertTrue(triggered[0])
        self.assertEqual(after_expiry[0], 0)
        self.assertEqual(failure.exception.code, "source_not_ready")
