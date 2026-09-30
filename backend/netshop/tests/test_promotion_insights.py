"""Promotion query semantics verified on the independently launched synthetic PG."""
import hashlib
import json
import os
import time
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from urllib.parse import urlencode

from django.db import connection, transaction, DatabaseError
from django.db.models import F, Count, Sum
from django.http import QueryDict
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from access_control.models import AppUser
from sales.auth import Principal
from netshop.errors import NetshopApiError
from netshop.models import (NetshopDataRevision, NetshopProductDailyScopeRevision, NetshopPromotionScopeRevision,
    NetshopPromotionAggregateManifest, NetshopPromotionAggregateState, NetshopPromotionProductDaily, NetshopPromotionShopDaily)
from netshop.promotion_diagnostic import SHOP_NAME
from netshop.promotion_insights import read_promotion_insights, read_promotion_detail, _read_facts, _row_key
from netshop.insights_common import periods
from .promotion_insights_fixtures import add_day


class PromotionInsightsTests(TestCase):
    def setUp(self):
        self.counter = 0
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a"*64})
        self.principal = Principal("promotion@example.test", "Synthetic", "viewer", None)
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer",
            status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision")+1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def params(self, **kwargs):
        return QueryDict(urlencode({"platform": "京东", "startDate": "2026-09-01", "endDate": "2026-09-01", **kwargs}, doseq=True))

    def read(self, **kwargs): return read_promotion_insights(self.principal, self.params(**kwargs))

    def admin(self):
        self.user.role_id = "admin"; self.user.version += 1
        self.user.save(update_fields=["role", "version"])
        self.principal = Principal(self.principal.email, "Synthetic", "admin", None)

    def day(self, **kwargs): return add_day(self, **kwargs)

    def pair(self, **kwargs):
        self.day(**kwargs)
        self.day(promotion=False, **{k: v for k, v in kwargs.items() if k != "rows"})

    def test_complete_summary_real_zero_definitions_and_cpc_unrounded(self):
        self.day(rows=[{"id": "same", "values": {"spendCents": 100, "netTransactionAmountCents": 0, "impressions": 30, "clicks": 3, "netOrders": 0}}])
        self.day(promotion=False)
        result = self.read()
        m = result["sections"]["summary"]
        self.assertEqual(result["columnVersion"], "netshop-promotion-v1")
        self.assertEqual(m["attributedPayment"]["value"], 0)
        self.assertEqual(m["orders"]["status"], "available")
        self.assertEqual(m["spendRate"]["value"], .1)
        self.assertEqual(m["roas"]["value"], 0)
        self.assertEqual(m["ctr"]["value"], .1)
        self.assertEqual(m["cpc"]["unit"], "CNY_CENT_PER_COUNT")
        self.assertEqual(m["cpc"]["value"], 100/3)
        self.assertFalse(result["sections"]["shops"]["visible"])
        self.assertEqual(result["sections"]["attribution"]["orderDefinition"], "jd_order_lines")
        self.assertIsNone(result["sections"]["attribution"]["window"])
        self.assertIsNone(result["sections"]["items"][0]["metrics"]["spendRate"]["value"])

    def test_misaligned_store_day_never_produces_main_or_matched_rate(self):
        self.day(shop="A"); self.day(shop="B", promotion=False)
        result = self.read()["sections"]
        self.assertIsNone(result["summary"]["spendRate"]["value"])
        self.assertEqual(result["summary"]["spendRate"]["reasonCode"], "incomplete_coverage")
        self.assertIsNone(result["matchedRange"]["metrics"]["spendRate"]["value"])
        self.assertEqual(result["matchedRange"]["shopDates"], [{"shopKey": "京东\x1fA", "dates": []}, {"shopKey": "京东\x1fB", "dates": []}])

    def test_partial_matching_is_separate_and_weighted_sum_not_average(self):
        self.pair(); self.day(day="2026-09-02")
        section = self.read(endDate="2026-09-02")["sections"]
        self.assertIsNone(section["summary"]["spendRate"]["value"])
        self.assertEqual(section["matchedRange"]["metrics"]["spendRate"]["value"], .2)
        self.assertEqual(section["matchedRange"]["shopDates"][0]["dates"], ["2026-09-01"])
        self.assertEqual(section["summary"]["spend"]["value"], 400)

    def test_rates_efficiency_and_shares_use_weighted_full_numerators(self):
        self.day(shop="A", rows=[{"id": "same", "values": {"spendCents": 100, "netTransactionAmountCents": 1000, "impressions": 10, "clicks": 1, "netOrders": 1}}])
        self.day(shop="B", rows=[{"id": "same", "values": {"spendCents": 900, "netTransactionAmountCents": 900, "impressions": 100, "clicks": 3, "netOrders": 1}}])
        self.day(shop="A", promotion=False, rows=[{"id": "same", "values": {"transactionAmountCents": 1000}}])
        self.day(shop="B", promotion=False, rows=[{"id": "same", "values": {"transactionAmountCents": 3000}}])
        section = self.read()["sections"]
        self.assertEqual(section["summary"]["spendRate"]["value"], .25)
        self.assertEqual(section["summary"]["cpc"]["value"], 250)
        self.assertEqual(section["summary"]["roas"]["value"], 1.9)
        self.assertEqual(section["summary"]["ctr"]["value"], 4/110)
        self.assertEqual({r["shopName"]: r["spendShare"]["value"] for r in section["shops"]["items"]}, {"A": .1, "B": .9})

    def test_missing_field_does_not_turn_projection_zero_into_observed_zero(self):
        self.day(rows=[{"values": {"spendCents": 0, "clicks": 0}}])
        section = self.read()["sections"]
        self.assertEqual(section["summary"]["spend"]["status"], "available")
        self.assertEqual(section["summary"]["spend"]["value"], 0)
        self.assertIsNone(section["summary"]["orders"]["value"])
        self.assertEqual(section["summary"]["orders"]["reasonCode"], "missing_field")
        self.assertEqual(section["summary"]["cpc"]["reasonCode"], "zero_denominator")

    def test_missing_day_and_empty_requested_shop_remain_gaps(self):
        self.pair()
        result = self.read(endDate="2026-09-02", outlet=["京东\x1fA", "京东\x1fEMPTY"])
        self.assertEqual(result["sections"]["summary"]["spend"]["status"], "partial")
        self.assertIsNone(result["sections"]["trend"]["items"][1]["metrics"]["spend"]["value"])
        empty = next(r for r in result["sections"]["shops"]["items"] if r["shopName"] == "EMPTY")
        self.assertEqual(empty["metrics"]["spend"]["reasonCode"], "no_records")

    def test_invalid_manifest_state_shop_product_or_raw_owner_is_not_zero(self):
        self.pair()
        cases = [(NetshopPromotionAggregateManifest, {"ready": False}, "promotion_not_ready"),
            (NetshopPromotionAggregateState, {"ready": False}, "promotion_mismatch"),
            (NetshopPromotionShopDaily, {"clicks": 99}, "promotion_mismatch"),
            (NetshopPromotionProductDaily, {"spend_cents": 99}, "promotion_mismatch")]
        for model, update, reason in cases:
            original = model.objects.values(*update).first()
            model.objects.update(**update)
            m = self.read()["sections"]["summary"]["spend"]
            self.assertIsNone(m["value"])
            self.assertEqual(m["reasonCode"], reason)
            model.objects.update(**original)

    def test_raw_control_reconciliation_before_metric_conversion(self):
        self.pair()
        p = periods("2026-09-01", "2026-09-01", "custom")
        facts = _read_facts("京东", ["A"], p, time.monotonic()+65)
        self.assertEqual(facts["failures"], {})
        self.assertEqual(facts["shopRaw"][("A", "2026-09-01")]["spend_cents"], 200)
        NetshopPromotionProductDaily.objects.update(clicks=99)
        facts = _read_facts("京东", ["A"], p, time.monotonic()+65)
        self.assertEqual(facts["failures"][("A", "2026-09-01")], "promotion_mismatch")

    def test_import_batch_ownership_is_checked_and_failed_fact_not_used(self):
        batch, _ = self.day()
        batch.shop_name = "Wrong"; batch.save(update_fields=["shop_name"])
        self.assertEqual(self.read()["sections"]["summary"]["spend"]["reasonCode"], "promotion_mismatch")
        batch.shop_name = "A"; batch.status = "failed"; batch.save(update_fields=["shop_name", "status"])
        self.assertIsNone(self.read()["sections"]["summary"]["spend"]["value"])

    def test_cross_store_same_id_isolated_and_exact_detail_lookup(self):
        self.pair(); self.pair(shop="B")
        result = self.read()
        rows = result["sections"]["items"]
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["rowKey"], rows[1]["rowKey"])
        detail = read_promotion_detail(self.principal, self.params(objectKind="product", objectId=rows[0]["rowKey"], shopKey=rows[0]["shopKey"], sectionToken=result["sectionToken"]))
        self.assertEqual(detail["sections"]["item"]["rowKey"], rows[0]["rowKey"])
        with self.assertRaises(NetshopApiError):
            read_promotion_detail(self.principal, self.params(objectKind="product", objectId=rows[0]["rowKey"], shopKey=rows[1]["shopKey"], sectionToken=result["sectionToken"]))

    def test_plan_ids_same_name_and_true_relationships_unknown_id_not_drillable(self):
        self.admin()
        rows = []
        for id in ["P1", "P2", None]:
            rows.append({"id": "same", "values": {"spendCents": 10, "netTransactionAmountCents": 20, "impressions": 10, "clicks": 1, "netOrders": 0},
                "raw": {"计划ID": id, "推广计划": "同名计划", "单元ID": "U1", "关键词": "真实词", "搜索词": "真实搜索", "匹配方式": "精确", "智能投放推广SKU ID": "AD", "触发SKU ID": "TRIGGER"}})
        self.day(shop=SHOP_NAME, rows=rows)
        result = self.read(objectKind="plan")
        plans = result["sections"]["items"]
        self.assertEqual({r["id"] for r in plans}, {"P1", "P2", None})
        self.assertEqual(len({r["rowKey"] for r in plans}), 3)
        null = next(r for r in plans if r["id"] is None)
        self.assertFalse(null["drillable"])
        with self.assertRaises(NetshopApiError):
            read_promotion_detail(self.principal, self.params(objectKind="plan", objectId=null["rowKey"], shopKey=null["shopKey"], sectionToken=result["sectionToken"]))
        real = next(r for r in plans if r["id"] == "P1")
        detail = read_promotion_detail(self.principal, self.params(objectKind="plan", objectId=real["rowKey"], shopKey=real["shopKey"], sectionToken=result["sectionToken"]))
        self.assertTrue(detail["sections"]["relations"])
        self.assertIn("推广SKU=AD", detail["sections"]["relations"][0]["description"])
        self.assertEqual(len(detail["sections"]["trend"]["items"]), 1)

    def test_unsupported_dimensions_reports_scope_and_tmall_semantics(self):
        self.admin()
        self.pair(platform="天猫")
        result = self.read(platform="天猫", objectKind="keyword")
        section = result["sections"]
        self.assertEqual(section["items"], [])
        self.assertEqual(section["objectCapabilities"]["keyword"]["reasonCode"], "not_applicable")
        self.assertEqual(section["attribution"]["amountDefinition"], "tmall_net_amount")
        self.assertEqual(section["attribution"]["orderDefinition"], "tmall_net_transactions")
        self.assertEqual(section["diagnostic"]["reportFormats"], [])

    def test_mapping_missing_or_multiple_and_tmall_exact_product_rate(self):
        self.pair(platform="天猫")
        matched = self.read(platform="天猫")["sections"]["items"][0]
        self.assertEqual(matched["mapping"]["status"], "matched")
        self.assertEqual(matched["metrics"]["spendRate"]["value"], .2)
        self.day(shop="B")
        unmapped = next(r for r in self.read()["sections"]["items"] if r["shopName"] == "B")
        self.assertEqual(unmapped["mapping"]["status"], "unmapped")
        self.assertIsNone(unmapped["mapping"]["linkIdentity"])
        self.day(promotion=False, shop="B", rows=[{"id": "same", "spu": "SPU1", "values": {"transactionAmountCents": 100}}, {"id": "same", "spu": "SPU2", "values": {"transactionAmountCents": 200}}])
        ambiguous = next(r for r in self.read()["sections"]["items"] if r["shopName"] == "B")
        self.assertEqual(ambiguous["mapping"]["status"], "ambiguous")
        self.assertIsNone(ambiguous["mapping"]["linkIdentity"])

    def test_cross_day_and_comparison_spu_relationship_change_is_ambiguous(self):
        self.day(); self.day(promotion=False, rows=[{"id": "same", "spu": "OLD", "values": {"transactionAmountCents": 100}}])
        self.day(day="2026-08-31", promotion=False, rows=[{"id": "same", "spu": "NEW", "values": {"transactionAmountCents": 200}}])
        item = self.read()["sections"]["items"][0]
        self.assertEqual(item["mapping"]["status"], "ambiguous")
        self.assertIsNone(item["mapping"]["linkIdentity"])
        self.assertEqual(item["metrics"]["spend"]["value"], 200)
        self.assertTrue(item["drillable"])

    def test_nonadmin_cannot_read_plan_terms_and_default_never_loads_raw_dimensions(self):
        self.day(shop=SHOP_NAME)
        for kind in ("plan", "unit", "keyword", "search_term"):
            with self.assertRaises(NetshopApiError) as failure: self.read(objectKind=kind)
            self.assertEqual(failure.exception.status, 403)
        result = self.read()
        self.assertEqual(result["sections"]["objectCapabilities"]["plan"]["status"], "unavailable")
        self.assertEqual(result["sections"]["diagnostic"]["reportFormats"], [])

    def test_search_and_date_focus_only_affect_list_and_pair_corresponding_dates(self):
        self.pair(); self.pair(day="2026-09-02"); self.pair(day="2026-08-01"); self.pair(day="2026-08-02")
        all = self.read(endDate="2026-09-02")
        focus = self.read(endDate="2026-09-02", objectStartDate="2026-09-02", objectEndDate="2026-09-02")
        self.assertEqual(all["sections"]["summary"], focus["sections"]["summary"])
        self.assertEqual(all["sections"]["trend"], focus["sections"]["trend"])
        self.assertEqual(focus["sections"]["items"][0]["metrics"]["spend"]["value"], 200)
        self.assertEqual(focus["sections"]["listScope"]["comparisonDates"]["previous"], ["2026-08-02"])
        absent = self.read(endDate="2026-09-02", q="NO MATCH")
        self.assertEqual(absent["sections"]["items"], [])
        self.assertEqual(absent["sections"]["summary"], all["sections"]["summary"])

    def test_percentage_points_and_zero_negative_missing_baselines(self):
        self.pair()
        self.day(day="2026-08-31", rows=[{"id": "same", "values": {"spendCents": 0, "netTransactionAmountCents": 0, "impressions": 100, "clicks": 1, "netOrders": 0}}])
        m = self.read()["sections"]["comparisons"]
        self.assertEqual(m["spend"]["previous"]["reasonCode"], "zero_denominator")
        self.assertAlmostEqual(m["ctr"]["previous"]["value"], 1)
        self.assertEqual(m["ctr"]["previous"]["method"], "percentage_points")
        self.assertEqual(m["spend"]["yearAgo"]["reasonCode"], "incomplete_baseline")

    def test_negative_baseline_and_negative_denominator_are_explained(self):
        self.day()
        self.day(day="2026-08-31", rows=[{"id": "same", "values": {"spendCents": -100, "netTransactionAmountCents": 400, "impressions": 100, "clicks": -2, "netOrders": 1}}])
        section = self.read()["sections"]
        self.assertEqual(section["comparisons"]["spend"]["previous"]["reasonCode"], "negative_baseline")
        self.assertEqual(section["comparisons"]["cpc"]["previous"]["reasonCode"], "incomplete_baseline")
        self.assertIsNone(section["comparisons"]["spend"]["previous"]["value"])

    def test_paired_full_universe_before_growth_pagination_and_search(self):
        current, prior = [], []
        for i in range(120):
            current.append({"id": f"P{i:03d}", "values": {"spendCents": 100+i, "netTransactionAmountCents": 200, "impressions": 100, "clicks": 2, "netOrders": 1}})
            prior.append({"id": f"P{i:03d}", "values": {"spendCents": 500 if i == 0 else 10, "netTransactionAmountCents": 200, "impressions": 100, "clicks": 2, "netOrders": 1}})
        self.day(rows=current); self.day(day="2026-08-31", rows=prior)
        section = self.read(sort="spend_change_asc", pageSize=20)["sections"]
        self.assertEqual(section["pagination"]["total"], 120)
        self.assertEqual(section["items"][0]["id"], "P000")
        self.assertAlmostEqual(section["items"][0]["comparisons"]["spend"]["previous"]["value"], -.8)
        self.assertEqual(section["pagination"]["returned"], 20)
        self.assertTrue(section["pagination"]["hasMore"])
        found = self.read(q="P000", pageSize=1)["sections"]
        self.assertEqual(found["items"][0]["metrics"]["spend"]["value"], 100)
        self.assertEqual(found["summary"]["spend"]["value"], sum(100+i for i in range(120)))
        self.assertEqual(section["contributions"]["comparedObjectCount"], 120)
        self.assertEqual(section["contributions"]["excludedObjectCount"], 0)
        self.assertEqual(section["contributions"]["previous"]["spendDecrease"][0]["id"], "P000")
        self.assertLessEqual(len(section["contributions"]["previous"]["spendIncrease"]), 10)

    def test_verified_source_absence_zero_and_unknown_identity_blocks_inference(self):
        values = {"spendCents": 100, "netTransactionAmountCents": 200, "impressions": 100, "clicks": 2, "netOrders": 1}
        self.day(rows=[{"id": "P1", "values": values}])
        self.day(day="2026-08-31", rows=[{"id": "P2", "values": values}])
        section = self.read()["sections"]
        current = next(r for r in section["items"] if r["id"] == "P1")
        gone = next(r for r in section["items"] if r["id"] == "P2")
        self.assertEqual(current["comparisons"]["spend"]["previous"]["reasonCode"], "zero_denominator")
        self.assertEqual(current["changes"]["spend"]["previous"]["value"], 100)
        self.assertEqual(gone["metrics"]["spend"]["value"], 0)
        self.assertEqual(gone["changes"]["spend"]["previous"]["value"], -100)
        self.assertIn("已导入", " ".join(section["limitations"]))
        # An unowned identity in a completely reconciled store-day means that
        # the object universe is not complete, even when additive totals match.
        from netshop.models import NetshopRow
        NetshopRow.objects.filter(business_date="2026-08-31").update(sku_id="")
        NetshopPromotionProductDaily.objects.filter(business_date="2026-08-31").update(product_id="")
        section = self.read()["sections"]
        current = next(r for r in section["items"] if r["id"] == "P1")
        self.assertIsNone(current["changes"]["spend"]["previous"]["value"])
        unknown = next(r for r in section["items"] if r["id"] is None)
        self.assertFalse(unknown["drillable"])
        self.assertEqual(unknown["changes"]["spend"]["previous"]["reasonCode"], "not_applicable")
        self.assertEqual(section["contributions"]["comparedObjectCount"], 0)
        self.assertEqual(section["contributions"]["excludedObjectCount"], 2)

    def test_lazy_dimensions_unknown_bucket_not_entity_and_focus_share(self):
        self.admin()
        values = {"spendCents": 100, "netTransactionAmountCents": 200, "impressions": 100, "clicks": 2, "netOrders": 1}
        self.day(shop=SHOP_NAME, rows=[{"id": "P1", "values": values, "raw": {"推广计划": "缺少真实ID"}}])
        self.day(shop=SHOP_NAME, day="2026-08-31", rows=[{"id": "P1", "values": values, "raw": {"推广计划": "缺少真实ID"}}])
        with patch("netshop.promotion_insights._scalar", side_effect=AssertionError("Default product must not scan raw dimensions")):
            default = self.read()["sections"]
        self.assertTrue(default["objectCapabilities"]["plan"]["canQuery"])
        self.assertIsNone(default["objectCapabilities"]["plan"]["unidentifiedCount"])
        plans = self.read(objectKind="plan")["sections"]
        self.assertEqual(plans["objectCapabilities"]["plan"]["unidentifiedCount"], 1)
        self.assertEqual(plans["items"][0]["metrics"]["spend"]["value"], 100)
        self.assertEqual(plans["items"][0]["changes"]["spend"]["previous"]["reasonCode"], "not_applicable")
        self.assertEqual(plans["contributions"]["excludedObjectCount"], 1)
        self.assertIsNone(plans["objectCapabilities"]["keyword"]["unidentifiedCount"])

    def test_conflicting_raw_identity_aliases_stay_unknown_not_named_fallback(self):
        self.admin()
        values = {"spendCents": 100, "netTransactionAmountCents": 200, "impressions": 100, "clicks": 2, "netOrders": 1}
        self.day(shop=SHOP_NAME, rows=[{"id": "SKU", "values": values, "raw": {"计划ID": "P1", "计划id": "P2", "推广计划": "不能当ID"}}])
        section = self.read(objectKind="plan")["sections"]
        self.assertIsNone(section["items"][0]["id"])
        self.assertEqual(section["items"][0]["metrics"]["spend"]["value"], 100)
        self.assertFalse(section["items"][0]["drillable"])
        self.assertEqual(section["objectCapabilities"]["plan"]["unidentifiedCount"], 1)

    def test_empty_product_identity_has_no_shared_link_even_when_both_sources_empty_id(self):
        self.day(platform="天猫", rows=[{"id": "", "values": {"spendCents": 100, "netTransactionAmountCents": 200, "impressions": 10, "clicks": 1, "netOrders": 1}}])
        self.day(platform="天猫", promotion=False, rows=[{"id": "", "values": {"transactionAmountCents": 1000}}])
        item = self.read(platform="天猫")["sections"]["items"][0]
        self.assertIsNone(item["id"])
        self.assertFalse(item["drillable"])
        self.assertEqual(item["mapping"]["status"], "unmapped")
        self.assertIsNone(item["mapping"]["linkIdentity"])
        self.assertIsNone(item["metrics"]["spendRate"]["value"])

    def test_scale_complete_5000_facts_preserves_weighted_rates_and_measures_plan(self):
        from netshop.models import NetshopRow
        for shop in range(10):
            for day in range(1, 11):
                identities = [f"P{i:03d}" for i in range(50)]
                self.day(shop=f"S{shop}", day=f"2026-09-{day:02d}", rows=[{"id": id, "values": {"spendCents": 200, "netTransactionAmountCents": 400, "impressions": 100, "clicks": 3, "netOrders": 1}} for id in identities])
                self.day(shop=f"S{shop}", day=f"2026-09-{day:02d}", promotion=False, rows=[{"id": id, "values": {"transactionAmountCents": 1000}} for id in identities])
        with CaptureQueriesContext(connection) as calls:
            start = time.monotonic(); result = self.read(endDate="2026-09-10"); elapsed = time.monotonic()-start
        self.assertEqual(result["sections"]["summary"]["spend"]["value"], 1_000_000)
        self.assertEqual(result["sections"]["summary"]["spendRate"]["value"], .2)
        self.assertEqual(result["sections"]["pagination"]["total"], 500)
        self.assertEqual(len(result["sections"]["items"]), 20)
        self.assertEqual(result["sections"]["contributions"]["excludedObjectCount"], 500)
        evidence = os.environ.get("TERUISI_FOUNDATION_CAPACITY_EVIDENCE_DIR")
        if evidence:
            source = NetshopRow.objects.filter(source="jd_promotion", business_date__gte="2026-09-01", business_date__lt="2026-09-11")
            plan = source.values("shop_name", "business_date", "sku_id").annotate(count=Count("id"), spend=Sum("spend_cents")).explain(format="json", analyze=True, buffers=True)
            with (Path(evidence)/"promotion-query-scale.json").open("x", encoding="utf-8") as output:
                json.dump({"fixture": "synthetic-promotion-5000-v1", "promotionRows": 5000, "productRows": 5000,
                    "shops": 10, "days": 10, "objects": 500, "sqlCalls": len(calls), "seconds": elapsed,
                    "bytes": len(json.dumps(result, ensure_ascii=False).encode()), "controlSpendCents": 1_000_000,
                    "plan": json.loads(plan), "limitation": "This synthetic sample does not establish production P95 or maximum-source cost."}, output, ensure_ascii=False, indent=2)

    def test_leap_date_focus_does_not_compare_to_shorter_baseline(self):
        self.pair(day="2024-02-29")
        self.pair(day="2023-02-28")
        section = self.read(startDate="2024-02-28", endDate="2024-02-29", focusDate="2024-02-29")["sections"]
        self.assertEqual(section["listScope"]["comparisonDates"]["yearAgo"], [])
        self.assertIsNone(section["items"][0]["comparisons"]["spend"]["yearAgo"]["value"])

    def test_actual_response_examples_are_preserved_create_new_for_decoder(self):
        evidence = os.environ.get("TERUISI_FOUNDATION_CAPACITY_EVIDENCE_DIR")
        if not evidence: self.skipTest("Evidence root only provided by independent PG runner")
        self.admin(); self.day(shop=SHOP_NAME, rows=[{"id": "SKU1", "values": {"spendCents": 100, "netTransactionAmountCents": 300, "impressions": 20, "clicks": 3, "netOrders": 2}, "raw": {"计划ID": "P1", "推广计划": "合成计划", "单元ID": "U1", "关键词": "合成词", "搜索词": "合成搜索", "匹配方式": "精确"}}])
        self.day(shop=SHOP_NAME, promotion=False, rows=[{"id": "SKU1", "values": {"transactionAmountCents": 1000}}])
        product = self.read()
        plan = self.read(objectKind="plan")
        row = plan["sections"]["items"][0]
        detail = read_promotion_detail(self.principal, self.params(objectKind="plan", objectId=row["rowKey"], shopKey=row["shopKey"], sectionToken=plan["sectionToken"]))
        root = Path(evidence); root.mkdir(parents=True, exist_ok=True)
        for name, data in [("response-product.json", product), ("response-plan.json", plan), ("response-detail.json", detail)]:
            with (root/name).open("x", encoding="utf-8") as output: json.dump(data, output, ensure_ascii=False, indent=2)

    def test_changed_source_vector_stale_token_actor_revocation_fail_closed(self):
        self.pair()
        result = self.read()
        def changing(*args, **kwargs):
            facts = _read_facts(*args, **kwargs)
            NetshopProductDailyScopeRevision.objects.create(platform="京东", shop_name="A", data_version=2)
            return facts
        with patch("netshop.promotion_insights._read_facts", side_effect=changing):
            with self.assertRaises(NetshopApiError) as failure: self.read()
        self.assertEqual(failure.exception.code, "insights_revision_changed")
        with self.assertRaises(NetshopApiError) as failure: self.read(sectionToken=result["sectionToken"])
        self.assertEqual(failure.exception.code, "insights_revision_changed")
        def revoked(*args, **kwargs):
            facts = _read_facts(*args, **kwargs)
            AppUser.objects.filter(pk=self.user.pk).update(status="disabled", version=2)
            return facts
        with patch("netshop.promotion_insights._read_facts", side_effect=revoked):
            with self.assertRaises(NetshopApiError) as failure: self.read()
        self.assertEqual(failure.exception.code, "access_denied")

    def test_scope_permissions_unknown_parameters_and_wrong_dimensions(self):
        self.pair()
        for values in [{"platform": ["京东", "天猫"]}, {"dimension": "spu"}, {"category": "unverified"}, {"pageSize": 101}, {"focusDate": "2026-08-01"}, {"objectStartDate": "2026-09-01"}]:
            with self.assertRaises(NetshopApiError): self.read(**values)
        scope = {"platforms": ["天猫"], "channels": [], "warehouses": []}
        AppUser.objects.filter(pk=self.user.pk).update(scope=scope, version=2)
        with self.assertRaises(NetshopApiError) as failure:
            read_promotion_insights(Principal(self.principal.email, "Synthetic", "viewer", scope), self.params())
        self.assertEqual(failure.exception.status, 403)

    def test_entry_and_final_actor_queries_inside_whole_deadline(self):
        from netshop.promotion_insights import actor_fence
        self.pair()
        for trigger in [1, 2]:
            clock, calls = [0.0], [0]
            def slow_actor(principal):
                result = actor_fence(principal)
                calls[0] += 1
                if calls[0] == trigger: clock[0] = 66.0
                return result
            with patch("netshop.promotion_insights.time.monotonic", side_effect=lambda: clock[0]), patch("netshop.promotion_insights.actor_fence", side_effect=slow_actor):
                with self.assertRaises(NetshopApiError) as failure: self.read()
            self.assertEqual(failure.exception.code, "source_not_ready")

    def test_complete_response_budget_not_implicit_truncation(self):
        self.pair()
        with patch("netshop.promotion_insights.MAX_RESPONSE_BYTES", 50):
            with self.assertRaises(NetshopApiError) as failure: self.read()
        self.assertEqual(failure.exception.status, 422)

    @skipUnless(connection.vendor == "postgresql", "Independent PostgreSQL grant verification")
    def test_select_only_role_cannot_write_sources(self):
        self.pair()
        role = "promotion_reader_test"
        tables = ["netshop_rows", "netshop_import_batches", "netshop_data_revisions", "netshop_product_daily_scope_revisions", "netshop_promotion_scope_revisions", "netshop_promotion_aggregate_manifest", "netshop_promotion_aggregate_state", "netshop_promotion_shop_daily", "netshop_promotion_product_daily"]
        with connection.cursor() as cursor:
            cursor.execute('CREATE ROLE "'+role+'" NOLOGIN')
            cursor.execute('GRANT USAGE ON SCHEMA public TO "'+role+'"')
            cursor.execute('GRANT SELECT ON '+','.join('"'+t+'"' for t in tables)+' TO "'+role+'"')
            cursor.execute('GRANT SELECT(email,role,status,scope,version) ON access_control_users TO "'+role+'"')
        try:
            with transaction.atomic():
                with connection.cursor() as cursor: cursor.execute('SET LOCAL ROLE "'+role+'"')
                self.assertEqual(self.read()["sections"]["summary"]["spend"]["value"], 200)
                with self.assertRaises(DatabaseError):
                    with transaction.atomic():
                        with connection.cursor() as cursor: cursor.execute("UPDATE netshop_rows SET spend_cents=999")
        finally:
            with connection.cursor() as cursor:
                cursor.execute('RESET ROLE')
                cursor.execute('DROP OWNED BY "'+role+'"')
                cursor.execute('DROP ROLE "'+role+'"')
