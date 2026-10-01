"""C author checks on real synthetic PostgreSQL owning facts and identities."""
from __future__ import annotations

from datetime import date, timedelta
import hashlib
import json
import os
from pathlib import Path
import time
from unittest.mock import patch
from urllib.parse import urlencode

from django.db import connection
from django.db.models import F
from django.http import QueryDict
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from access_control.models import AppUser
from sales.auth import Principal
from netshop import comparison_insights as C
from netshop.comparison_contract import parse_comparison_v1
from netshop.errors import NetshopApiError
from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow, NetshopPromotionShopDaily, NetshopPromotionAggregateManifest
from netshop.tests.promotion_insights_fixtures import add_day


class ComparisonInsightsTests(TestCase):
    def setUp(self):
        self.principal = Principal("comparison@example.test", "Synthetic", "viewer", None)
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a"*64})
        self.counter = 0

    def tearDown(self):
        # Published fact fixture writes retain the real commit revision guard.
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision")+1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def fact(self, shop="A", day="2026-09-01", platform="京东", dimension="spu", product="same", category="设备", metrics=None):
        self.counter += 1
        source = "jd_sku_daily" if platform == "京东" else "tmall_product_daily"
        dataset = dimension+"_daily"
        batch = NetshopImportBatch.objects.create(id="comparison-"+str(self.counter), source=source, dataset=dataset, platform=platform, shop_name=shop, file_size_bytes=1, file_hash=f"{self.counter:064x}", raw_file_hash="a"*64, content_hash="b"*64, scope_key="c"*64, status="completed", row_count=1, date_min=day, date_max=day)
        values = {"transactionAmountCents": 1000, "transactionQuantity": 2, "visitors": 100, "transactionCustomers": 10, "transactionOrders": 7} if metrics is None else metrics
        from netshop.product_insights import ALL_FIELDS
        canonical = {"payment": "transactionAmountCents", "quantity": "transactionQuantity", "customers": "transactionCustomers", "refundPayment": "refundAmountCents"}
        columns = {canonical.get(k, k): v for k, v in ALL_FIELDS.items()}
        return NetshopRow.objects.create(source_row_key="comparison-row-"+str(self.counter), source_row_hash="d"*64, first_import_batch_id=batch.id, last_import_batch_id=batch.id, source_row_number=2, source=source, dataset=dataset, platform=platform, shop_name=shop, business_date=day, sku_id=product if dimension == "sku" else "SKU-"+product, spu_id=product if dimension == "spu" else "SPU-"+product, category=category, product_name="Synthetic "+product, metrics_json=values, **{columns[k]: v for k, v in values.items() if k in columns and type(v) is int})

    def query(self, **values):
        defaults = {"platform": "京东", "startDate": "2026-09-01", "endDate": "2026-09-01"}
        for key, value in values.items(): defaults[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) and key != "platform" else value
        return QueryDict(urlencode(defaults, doseq=True))

    def read(self, **values): return C.read_comparison_insights(self.principal, self.query(**values))

    def scope(self, **values):
        return {"schemaVersion": "comparison-scope-v1", "mode": "shop", "metricSource": "platform", "category": {"mode": "all"}, "coverageFilter": "all", **values}

    def pair(self, **values):
        self.fact(**values)
        self.fact(day="2026-08-31", **values)

    def assert_error(self, status, callable):
        with self.assertRaises(NetshopApiError) as caught: callable()
        self.assertEqual(caught.exception.status, status)
        return caught.exception

    def test_real_weighted_product_ratios_and_transaction_order_presence(self):
        self.pair(shop="A")
        self.pair(shop="B", metrics={"transactionAmountCents": 400, "transactionQuantity": 1, "visitors": 10, "transactionCustomers": 5})
        result = self.read()
        summary = result["sections"]["scale"]["summary"]
        self.assertEqual(summary["current"]["payment"]["value"], 1400)
        self.assertEqual(summary["current"]["conversion"]["value"], 15/110)
        self.assertEqual(summary["current"]["visitorValue"]["value"], 1400/110)
        rows = {r["shopName"]: r for r in result["sections"]["scale"]["items"]}
        self.assertEqual(rows["A"]["current"]["transactionOrders"]["value"], 7)
        self.assertIsNone(rows["B"]["current"]["transactionOrders"]["value"])
        self.assertIsNone(rows["A"]["current"]["averageOrderValue"]["value"])

    def test_custom_independent_overlapping_unequal_windows_preserve_both_envelopes(self):
        self.fact(day="2026-09-01")
        self.fact(day="2026-09-02")
        result = self.read(endDate="2026-09-02", selectedBaseline={"kind": "custom", "startDate": "2026-09-02", "endDate": "2026-09-02"})
        self.assertEqual(result["currentContext"]["periods"]["current"]["days"], 2)
        self.assertEqual(result["baselineContext"]["periods"]["current"]["days"], 1)
        self.assertIn("previous", result["baselineContext"]["periods"])
        self.assertIn("calendar", result["baselineContext"])
        self.assertEqual(result["sections"]["scale"]["summary"]["delta"]["value"], 1000)
        self.assertEqual(result["sections"]["comparability"]["periodRelationship"], {"sameLength": False, "overlapDays": 1})

    def test_current_and_baseline_only_shop_union_never_zero_fill(self):
        self.fact(shop="current")
        self.fact(shop="baseline", day="2026-08-31")
        result = self.read()
        candidates = {r["shopName"]: r for r in result["sections"]["comparability"]["items"]}
        self.assertEqual(len(candidates), 2)
        self.assertFalse(candidates["baseline"]["currentPresence"])
        rows = {r["shopName"]: r for r in result["sections"]["scale"]["items"]}
        self.assertIsNone(rows["baseline"]["current"]["payment"]["value"])
        self.assertEqual(result["sections"]["scale"]["contributions"]["status"], "unavailable")

    def test_same_name_same_product_cross_platform_exact_pairing(self):
        self.pair(platform="京东", shop="same", metrics={"transactionAmountCents": 1000})
        self.pair(platform="天猫", shop="same", metrics={"transactionAmountCents": 2000})
        result = self.read(platform=["京东", "天猫"])
        rows = result["sections"]["scale"]["items"]
        self.assertEqual(len({r["objectKey"] for r in rows}), 2)
        self.assertEqual({r["platform"]: r["current"]["payment"]["value"] for r in rows}, {"京东": 1000, "天猫": 2000})

    def test_platform_members_not_mixed_in_ranking(self):
        self.pair(shop="A"); self.pair(shop="B")
        result = self.read(comparisonScope=self.scope(mode="platform"))
        rows = result["sections"]["scale"]["items"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["objectKey"], "platform:京东")
        self.assertEqual(rows[0]["current"]["payment"]["value"], 2000)
        self.assertEqual(rows[0]["shopKeys"], ["京东\x1fA", "京东\x1fB"])

    def test_structure_observed_bucket_counts_remain_partial_with_parent_coverage(self):
        self.fact(shop="A"); self.fact(shop="A", day="2026-09-02")
        self.fact(shop="B")
        result = self.read(endDate="2026-09-02", comparisonScope=self.scope(mode="platform"))
        structure = result["sections"]["structure"]["items"][0]["current"]
        for bucket in structure["categories"]+structure["priceBands"]:
            metric = bucket["products"]
            self.assertEqual((metric["status"], metric["reasonCode"]), ("partial", "incomplete_coverage"))
            self.assertGreater(metric["value"], 0)
            self.assertFalse(result["sections"]["comparability"]["coverage"][metric["coverageRef"]]["complete"])

    def test_complete_pairs_rank_before_partial_even_higher_current(self):
        self.pair(shop="complete", metrics={"transactionAmountCents": 1})
        self.fact(shop="partial", metrics={"transactionAmountCents": 9999})
        rows = self.read()["sections"]["scale"]["items"]
        self.assertEqual(rows[0]["shopName"], "complete")
        self.assertFalse(rows[1]["qualification"]["baselineComplete"])

    def test_full_pairing_before_growth_sort_page_and_chart_never_filters_summary(self):
        for i in range(25):
            self.fact(shop=f"S{i:02}", metrics={"transactionAmountCents": 1000+i})
            self.fact(shop=f"S{i:02}", day="2026-08-31", metrics={"transactionAmountCents": 1000-i*2})
        result = self.read(sort="growth_desc", pageSize="1", chartObjectKeys=["shop:京东\x1fS00"])
        self.assertEqual(result["sections"]["scale"]["items"][0]["shopName"], "S24")
        self.assertEqual(result["sections"]["scale"]["pagination"]["total"], 25)
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"], sum(1000+i for i in range(25)))
        self.assertEqual(len(result["sections"]["structure"]["items"]), 1)

    def test_true_zero_negative_missing_baseline_and_first_bucket_index(self):
        for name, value in (("zero", 0), ("negative", -100)):
            self.fact(shop=name)
            self.fact(shop=name, day="2026-08-31", metrics={"transactionAmountCents": value})
        rows = {r["shopName"]: r for r in self.read()["sections"]["scale"]["items"]}
        self.assertEqual(rows["zero"]["comparisons"]["payment"]["reasonCode"], "zero_denominator")
        self.assertIn("zero_denominator", rows["zero"]["exclusionReasons"])
        self.assertEqual(rows["negative"]["comparisons"]["payment"]["reasonCode"], "negative_baseline")
        self.assertIn("negative_baseline", rows["negative"]["exclusionReasons"])
        indices = self.read()["sections"]["trends"]["items"]
        self.assertTrue(all(t["indexBasis"]["status"] == "unavailable" for t in indices))

    def test_growth_sort_uses_relative_change_and_excludes_zero_negative(self):
        for name, value, prior in (("large_absolute", 2000, 1000), ("large_relative", 30, 10), ("zero", 9999, 0), ("negative", 9999, -10)):
            self.fact(shop=name, metrics={"transactionAmountCents": value})
            self.fact(shop=name, day="2026-08-31", metrics={"transactionAmountCents": prior})
        rows = self.read(sort="growth_desc")["sections"]["scale"]["items"]
        self.assertEqual([r["shopName"] for r in rows[:2]], ["large_relative", "large_absolute"])
        self.assertTrue(all(not r["qualification"]["comparable"] for r in rows[2:]))
        self.assertEqual(next(r for r in rows if r["shopName"] == "zero")["delta"]["value"], 9999)

    def test_efficiency_change_is_percentage_points_not_relative_average(self):
        self.fact(metrics={"transactionAmountCents": 1000, "visitors": 100, "transactionCustomers": 20})
        self.fact(day="2026-08-31", metrics={"transactionAmountCents": 1000, "visitors": 100, "transactionCustomers": 10})
        row = self.read(metricKey="conversion")["sections"]["scale"]["items"][0]
        self.assertEqual(row["comparisons"]["conversion"]["value"], 10)
        self.assertEqual(row["comparisons"]["conversion"]["method"], "percentage_points")
        self.assertIsNone(row["share"]["current"]["value"])

    def test_coverage_filter_does_not_change_population_summary(self):
        self.pair(shop="A"); self.fact(shop="B")
        result = self.read(comparisonScope=self.scope(coverageFilter="complete"))
        self.assertEqual(result["sections"]["scale"]["pagination"]["total"], 1)
        self.assertEqual(result["sections"]["comparability"]["counts"]["candidates"], 2)
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"], 2000)

    def test_label_evidence_server_checked_reference_cohort_and_a_unmapped(self):
        self.fact(product="cohort", category="设备")
        self.fact(product="cohort", category="旧标签", day="2026-08-31", metrics={"transactionAmountCents": 200})
        self.pair(product="other", category="别类", metrics={"transactionAmountCents": 999})
        category = {"mode": "label_only", "platform": "京东", "sourceId": "jd_sku_daily", "label": "设备", "evidenceVersion": "1:aaaaaaaaaaaa"}
        result = self.read(comparisonScope=self.scope(category=category))
        self.assertEqual(result["sections"]["scale"]["summary"]["baseline"]["payment"]["value"], 200)
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["spend"]["reasonCode"], "unmapped")
        self.assertTrue(all(s["state"] == "unavailable" for s in result["sections"]["promotion"]["sourceStates"]))
        self.assert_error(409, lambda: self.read(comparisonScope=self.scope(category={**category, "evidenceVersion": "2:bbbbbbbbbbbb"})))
        self.assert_error(409, lambda: self.read(comparisonScope=self.scope(category={**category, "sourceId": "tmall_product_daily"})))
        self.assert_error(422, lambda: self.read(comparisonScope=self.scope(category={**category, "label": "caller invented"})))

    def test_unknown_cohort_keeps_baseline_identity(self):
        self.fact(category=""); self.fact(day="2026-08-31", category="过去")
        self.pair(product="other")
        result = self.read(comparisonScope=self.scope(category={"mode": "unknown"}))
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"], 1000)
        self.assertEqual(result["sections"]["scale"]["summary"]["baseline"]["payment"]["value"], 1000)

    def test_a_owner_weighted_ratios_paired_whole_and_source_scope(self):
        for day in ("2026-09-01", "2026-08-31"):
            add_day(self, day=day, shop="A")
            add_day(self, day=day, shop="A", promotion=False)
            add_day(self, day=day, shop="B", rows=[{"id": "same", "values": {"spendCents": 800, "netTransactionAmountCents": 400, "impressions": 900, "clicks": 8, "netOrders": 2}}])
            add_day(self, day=day, shop="B", promotion=False)
        result = self.read(dimension="sku", metricKey="roas")
        summary = result["sections"]["scale"]["summary"]["current"]
        self.assertEqual(summary["roas"]["value"], 800/1000)
        self.assertEqual(summary["ctr"]["value"], 10/1000)
        self.assertEqual(summary["cpc"]["value"], 1000/10)
        self.assertEqual(summary["spendRate"]["value"], 1000/2000)
        self.assertTrue(all(s["dimension"] == "sku" for s in result["sections"]["promotion"]["sourceScopes"]))
        self.sample("actual-owning-a", result, self.query(dimension="sku", metricKey="roas"))

    def sample(self, name, result, query):
        evidence = os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if evidence:
            with (Path(evidence)/(name+"-response.json")).open("x", encoding="utf-8") as output: json.dump(result, output, ensure_ascii=False)
            with (Path(evidence)/(name+"-request.json")).open("x", encoding="utf-8") as output: json.dump({"query": query.urlencode(), "headerRevision": result["currentContext"]["sourceRevisions"][0]["revision"], "synthetic": True}, output, ensure_ascii=False)

    def test_three_exact_candidates_cross_platform_partial_and_real_a_sample(self):
        self.pair(shop="same", platform="京东")
        self.fact(shop="partial", platform="京东")
        for day in ("2026-09-01", "2026-08-31"):
            add_day(self, shop="same", day=day, platform="京东")
            add_day(self, shop="same", day=day, platform="京东", promotion=False)
            add_day(self, shop="same", day=day, platform="天猫")
            add_day(self, shop="same", day=day, platform="天猫", promotion=False)
        query = self.query(platform=["京东", "天猫"])
        result = C.read_comparison_insights(self.principal, query)
        self.assertEqual(result["sections"]["comparability"]["counts"]["candidates"], 3)
        self.assertEqual({s["dimension"] for s in result["sections"]["promotion"]["sourceScopes"]}, {"sku", "spu"})
        rows = result["sections"]["scale"]["items"]
        self.assertEqual(sum(r["qualification"]["comparable"] for r in rows), 2)
        self.assertIsNone(result["sections"]["scale"]["summary"]["current"]["roas"]["value"])
        self.sample("actual-owning-mixed", result, query)
        for day in ("2026-09-02", "2026-08-30"):
            self.fact(shop="same", platform="京东", day=day)
            for platform in ("京东", "天猫"):
                add_day(self, shop="same", day=day, platform=platform)
                add_day(self, shop="same", day=day, platform=platform, promotion=False)
        baseline = {"kind": "custom", "startDate": "2026-08-30", "endDate": "2026-08-31"}
        values = {"platform": ["京东", "天猫"], "endDate": "2026-09-02", "selectedBaseline": baseline}
        two_chart = self.query(**values, chartObjectKeys=["shop:京东\x1fsame", "shop:天猫\x1fsame"])
        result = C.read_comparison_insights(self.principal, two_chart)
        self.assertEqual(len(result["sections"]["trends"]["items"]), 2)
        self.assertEqual(len(result["sections"]["trends"]["items"][0]["current"]), 2)
        self.sample("actual-owning-two-chart", result, two_chart)
        platform = self.query(**values, comparisonScope=self.scope(mode="platform"), chartObjectKeys=["platform:京东", "platform:天猫"])
        result = C.read_comparison_insights(self.principal, platform)
        self.assertEqual({r["kind"] for r in result["sections"]["scale"]["items"]}, {"platform"})
        self.assertEqual(len(result["sections"]["scale"]["items"]), 2)
        self.sample("actual-owning-platform", result, platform)
        category = {"mode": "label_only", "platform": "京东", "sourceId": "jd_sku_daily", "label": "设备", "evidenceVersion": "1:aaaaaaaaaaaa"}
        label = self.query(**values, comparisonScope=self.scope(category=category), chartObjectKeys=["shop:京东\x1fsame", "shop:京东\x1fpartial"])
        result = C.read_comparison_insights(self.principal, label)
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"], 3000)
        self.assertTrue(all(s["state"] == "unavailable" for s in result["sections"]["promotion"]["sourceStates"]))
        self.sample("actual-owning-label", result, label)

    def test_cross_platform_product_efficiency_is_parallel_only(self):
        self.pair(platform="京东"); self.pair(platform="天猫")
        result = self.read(platform=["京东", "天猫"], metricKey="conversion")
        self.assertTrue(all(not r["qualification"]["comparable"] and "not_applicable" in r["exclusionReasons"] for r in result["sections"]["scale"]["items"]))
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["conversion"]["reasonCode"], "not_applicable")
        self.assertTrue(all(r["current"]["conversion"]["status"] == "available" for r in result["sections"]["scale"]["items"]))

    def test_a_mismatched_shop_day_never_fee_ratio_complete(self):
        add_day(self, shop="A")
        add_day(self, shop="B", promotion=False)
        result = self.read(dimension="sku")
        self.assertIsNone(result["sections"]["scale"]["summary"]["current"]["spendRate"]["value"])

    def test_source_publication_mismatch_is_not_true_zero(self):
        add_day(self)
        NetshopPromotionShopDaily.objects.update(spend_cents=999)
        result = self.read(dimension="sku", metricKey="spend")
        metric = result["sections"]["scale"]["summary"]["current"]["spend"]
        self.assertIsNone(metric["value"])
        self.assertEqual(metric["reasonCode"], "promotion_mismatch")

    def test_all_metric_refs_resolve_and_real_dto_sample(self):
        self.pair()
        result = self.read()
        refs = {**result["currentContext"]["coverageBySource"], **result["baselineContext"]["coverageBySource"], **result["sections"]["comparability"]["coverage"]}
        def check(value):
            if isinstance(value, dict):
                if "coverageRef" in value: self.assertIn(value["coverageRef"], refs)
                for child in value.values(): check(child)
            elif isinstance(value, list):
                for child in value: check(child)
        check(result)
        evidence = os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if evidence:
            with (Path(evidence)/"actual-owning-response.json").open("x", encoding="utf-8") as output: json.dump(result, output, ensure_ascii=False)
            with (Path(evidence)/"actual-owning-request.json").open("x", encoding="utf-8") as output: json.dump({"query": self.query().urlencode(), "headerRevision": result["currentContext"]["sourceRevisions"][0]["revision"], "synthetic": True}, output, ensure_ascii=False)

    def test_strict_query_json_duplicate_unknown_parameter_and_illegal_windows(self):
        self.assert_error(400, lambda: self.read(unknown="x"))
        q = self.query(); q = q.copy(); q.appendlist("metricKey", "payment"); q.appendlist("metricKey", "spend")
        self.assert_error(400, lambda: C.read_comparison_insights(self.principal, q))
        self.assert_error(400, lambda: self.read(selectedBaseline='{"kind":"custom","kind":"previous"}'))
        self.assert_error(400, lambda: self.read(selectedBaseline={"kind": "custom", "startDate": "2026-09-30", "endDate": "2026-09-01"}))
        self.assert_error(400, lambda: self.read(selectedBaseline={"kind": "custom", "startDate": "20260901", "endDate": "2026-09-01"}))
        self.assert_error(422, lambda: self.read(selectedBaseline={"kind": "custom", "startDate": "2024-01-01", "endDate": "2025-01-01"}))
        self.assert_error(422, lambda: self.read(comparisonScope=self.scope(category={"mode": "verified_id", "id": "fake"})))

    def test_strict_json_unicode_chart_duplicates_and_enum_types(self):
        self.assert_error(400, lambda: self.read(chartObjectKeys=["shop:京东\x1fA", "shop:京东\x1fA"]))
        self.assert_error(400, lambda: self.read(chartObjectKeys=["invented:A"]))
        self.assert_error(400, lambda: self.read(comparisonScope=self.scope(mode=True)))
        self.assert_error(400, lambda: self.read(page="01"))
        self.assert_error(400, lambda: self.read(metricKey="largeMargin"))
        params = self.query().copy()
        params["comparisonScope"] = '{"schemaVersion":"comparison-scope-v1","mode":"shop","metricSource":"platform","category":{"mode":"label_only","platform":"京东","sourceId":"jd_sku_daily","label":"\\ud800","evidenceVersion":"1:a"},"coverageFilter":"all"}'
        self.assert_error(400, lambda: C.read_comparison_insights(self.principal, params))

    def test_legitimate_derived_367_cannot_be_independent_current(self):
        spec = parse_comparison_v1(self.query(startDate="2025-03-01", endDate="2026-03-01", selectedBaseline={"kind": "custom", "startDate": "2026-01-01", "endDate": "2026-01-01"}))
        self.assertEqual(spec["currentSpec"]["periods"]["yearAgo"]["days"], 366)
        # F current 2024-02-29..2025-02-28 is 366; yearAgo clamps both ends
        # to 2023-02-28..2024-02-28 and remains legal. A 367 derived case is
        # 2025-02-28..2026-02-28 -> 2024-02-28..2025-02-28.
        self.assert_error(422, lambda: parse_comparison_v1(self.query(startDate="2025-02-28", endDate="2026-02-28", selectedBaseline={"kind": "yearAgo"})))

    def test_section_token_bound_two_windows_actor_classification_and_display(self):
        self.pair()
        token = self.read()["sectionToken"]
        self.assertEqual(self.read(sectionToken=token)["sectionToken"], token)
        self.assert_error(409, lambda: self.read(sectionToken=token, selectedBaseline={"kind": "custom", "startDate": "2026-09-01", "endDate": "2026-09-01"}))
        self.assert_error(409, lambda: self.read(sectionToken=token, trendGrain="week"))
        NetshopDataRevision.objects.update(revision=2, source_digest="b"*64)
        self.assert_error(409, lambda: self.read(sectionToken=token))

    def test_fake_chart_outlet_or_scope_never_resurrected(self):
        self.pair()
        self.assert_error(403, lambda: self.read(chartObjectKeys=["shop:京东\x1funauthorized"]))
        self.user.scope = {"platforms": ["京东"], "channels": [], "warehouses": []}; self.user.save()
        self.principal = Principal(self.principal.email, "Synthetic", "viewer", self.user.scope)
        self.assert_error(403, lambda: self.read(platform="天猫"))
        self.user.scope = {"platforms": ["京东"], "channels": ["limited"], "warehouses": []}; self.user.save()
        self.principal = Principal(self.principal.email, "Synthetic", "viewer", self.user.scope)
        self.assert_error(403, lambda: self.read())

    def test_actor_change_between_contexts_fails_whole_read(self):
        self.pair()
        actual = C.read_context
        count = 0
        def changing(*args, **kwargs):
            nonlocal count
            result = actual(*args, **kwargs); count += 1
            if count == 1: AppUser.objects.filter(pk=self.user.pk).update(version=2)
            return result
        with patch.object(C, "read_context", changing):
            self.assert_error(403, lambda: self.read())

    def test_revision_change_between_contexts_fails_whole_read(self):
        self.pair()
        actual = C.read_context
        count = 0
        def changing(*args, **kwargs):
            nonlocal count
            result = actual(*args, **kwargs); count += 1
            if count == 1: NetshopDataRevision.objects.update(revision=F("revision")+1, source_digest="b"*64)
            return result
        with patch.object(C, "read_context", changing): self.assert_error(409, lambda: self.read())

    def test_revision_changed_inside_real_owner_projection_fails(self):
        self.pair()
        actual = C.load_comparison_sources
        def changing(*args, **kwargs):
            result = actual(*args, **kwargs)
            NetshopDataRevision.objects.update(revision=F("revision")+1, source_digest="b"*64)
            return result
        with patch.object(C, "load_comparison_sources", changing): self.assert_error(409, lambda: self.read())

    def test_nonempty_promotion_typed_revision_changes_without_global_change(self):
        add_day(self)
        add_day(self, promotion=False)
        actual = C.load_comparison_sources
        def changing(*args, **kwargs):
            result = actual(*args, **kwargs)
            NetshopPromotionAggregateManifest.objects.filter(platform="京东").update(data_version=F("data_version")+1)
            return result
        with patch.object(C, "load_comparison_sources", changing): self.assert_error(409, lambda: self.read(dimension="sku"))

    def test_503_local_source_preserves_product_but_403_409_fail_closed(self):
        self.pair()
        with patch("netshop.comparison_adapter._promotion_scope", side_effect=NetshopApiError("synthetic timeout", code="source_not_ready", status=503)):
            result = self.read()
            self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"], 1000)
            self.assertTrue(all(s["state"] == "error" for s in result["sections"]["promotion"]["sourceStates"]))
        for status in (403, 409):
            with patch("netshop.comparison_adapter._promotion_scope", side_effect=NetshopApiError("synthetic fence", code="access_denied", status=status)): self.assert_error(status, lambda: self.read())

    def test_shared_deadline_sql_after_expiry_no_next_sql(self):
        self.pair()
        clock = [0.0]
        executed = []
        def expires(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.lstrip().upper().startswith("SELECT"):
                executed.append(sql); clock[0] = 66.0
            return result
        with patch("netshop.comparison_insights.time.monotonic", lambda: clock[0]), connection.execute_wrapper(expires):
            self.assert_error(503, lambda: self.read())
        self.assertEqual(len(executed), 1)

    def test_shared_deadline_second_context_and_serialization_count(self):
        self.pair()
        clock = [0.0]
        actual = C.read_context
        count = 0
        def expires(*args, **kwargs):
            nonlocal count
            value = actual(*args, **kwargs); count += 1
            if count == 2: clock[0] = 66.0
            return value
        with patch("netshop.comparison_insights.time.monotonic", lambda: clock[0]), patch.object(C, "read_context", expires): self.assert_error(503, lambda: self.read())
        clock[0] = 0.0
        actual_dumps = json.dumps
        def encode(value, *args, **kwargs):
            result = actual_dumps(value, *args, **kwargs)
            if isinstance(value, dict) and value.get("schemaVersion") == "netshop-comparison-v1": clock[0] = 66.0
            return result
        with patch("netshop.comparison_insights.time.monotonic", lambda: clock[0]), patch.object(C.json, "dumps", encode): self.assert_error(503, lambda: self.read())

    def test_whole_utf8_response_size_including_two_f_contexts(self):
        self.pair()
        actual = C.build_comparison_result
        def large(*args, **kwargs):
            value = actual(*args, **kwargs)
            value["baselineContext"]["limitations"].append("合"*(1024*1024))
            return value
        with patch.object(C, "build_comparison_result", large): self.assert_error(422, lambda: self.read())

    def test_last_actor_and_version_checks_count_toward_deadline(self):
        self.pair()
        clock = [0.0]
        actual = C.actor_fence
        calls = 0
        def actor(*args):
            nonlocal calls
            result = actual(*args); calls += 1
            if calls == 2: clock[0] = 66.0
            return result
        with patch("netshop.comparison_insights.time.monotonic", lambda: clock[0]), patch.object(C, "actor_fence", actor): self.assert_error(503, lambda: self.read())

    def test_no_business_writes_during_read(self):
        self.pair()
        with CaptureQueriesContext(connection) as captured: self.read()
        business_writes = [q["sql"] for q in captured if q["sql"].lstrip().split(" ", 1)[0].upper() in {"INSERT", "UPDATE", "DELETE"}]
        self.assertEqual(business_writes, [])

    def test_erp_dependency_pending_honest_all_metrics(self):
        self.pair()
        result = self.read(comparisonScope=self.scope(metricSource="erp"), metricKey="erpNetSales")
        self.assertEqual(result["sections"]["comparability"]["erpState"]["state"], "dependency_pending")
        self.assertIsNone(result["sections"]["scale"]["summary"]["current"]["erpNetSales"]["value"])
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["largeMargin"]["unit"], "RATIO")
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["largeMarginAmount"]["unit"], "CNY_CENT")
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["largeMarginAmount"]["basis"], "erp_large_margin")
        self.assertEqual(len(result["sections"]["scale"]["summary"]["current"]), 21)

    def test_366_day_windows_are_independent_and_missing_buckets_not_zero(self):
        self.fact(day="2025-03-01")
        self.fact(day="2026-03-01")
        self.fact(day="2023-01-01")
        self.fact(day="2024-01-01")
        result = self.read(startDate="2025-03-01", endDate="2026-03-01", selectedBaseline={"kind": "custom", "startDate": "2023-01-01", "endDate": "2024-01-01"})
        self.assertEqual(result["currentContext"]["periods"]["current"]["days"], 366)
        self.assertEqual(result["baselineContext"]["periods"]["current"]["days"], 366)
        trend = result["sections"]["trends"]["items"][0]
        self.assertEqual(len(trend["current"]), 366)
        self.assertIsNone(trend["current"][1]["metric"]["value"])
        self.assertEqual(trend["current"][1]["metric"]["reasonCode"], "no_records")
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["status"], "partial")
        self.assertEqual(result["sections"]["efficiency"]["items"], [r["objectKey"] for r in result["sections"]["scale"]["items"]])

    def test_safe_integer_failure_is_invalid_not_rounded(self):
        self.fact(metrics={"transactionAmountCents": 9_007_199_254_740_992})
        metric = self.read()["sections"]["scale"]["summary"]["current"]["payment"]
        self.assertIsNone(metric["value"])
        self.assertEqual((metric["status"], metric["reasonCode"]), ("invalid", "unsafe_integer"))

    def test_representative_60000_facts_50_shops_30_day_two_periods(self):
        dates = [(date(2026, month, 1)+timedelta(days=i)).isoformat() for month in (8, 9) for i in range(30)]
        for shop in range(50):
            self.counter += 1
            name = f"Representative {shop:02}"
            batch = NetshopImportBatch.objects.create(id=f"comparison-scale-{shop}", source="jd_sku_daily", dataset="spu_daily", platform="京东", shop_name=name, file_size_bytes=1, file_hash=f"{self.counter:064x}", raw_file_hash="a"*64, content_hash="b"*64, scope_key="c"*64, status="completed", row_count=1200, date_min=dates[0], date_max=dates[-1])
            facts = [NetshopRow(source_row_key=f"scale-{shop}-{day}-{product}", source_row_hash="d"*64, first_import_batch_id=batch.id, last_import_batch_id=batch.id, source_row_number=i+2, source="jd_sku_daily", dataset="spu_daily", platform="京东", shop_name=name, business_date=day, spu_id=f"P{product:02}", sku_id=f"SKU{product:02}", category="Synthetic category", product_name="Synthetic scale", metrics_json={"transactionAmountCents": 1000, "transactionQuantity": 2, "visitors": 100, "transactionCustomers": 10}, transaction_amount_cents=1000, transaction_quantity=2, visitors=100, transaction_customers=10) for i, (day, product) in enumerate((day, product) for day in dates for product in range(20))]
            NetshopRow.objects.bulk_create(facts, batch_size=500)
        before = time.monotonic()
        with CaptureQueriesContext(connection) as queries:
            result = self.read(endDate="2026-09-30", selectedBaseline={"kind": "custom", "startDate": "2026-08-01", "endDate": "2026-08-30"})
        seconds = time.monotonic()-before
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.assertEqual(result["sections"]["scale"]["summary"]["current"]["payment"]["value"], 30_000_000)
        self.assertEqual(result["sections"]["scale"]["pagination"]["total"], 50)
        self.assertEqual(result["sections"]["comparability"]["counts"]["comparable"], 50)
        self.assertEqual(len(result["sections"]["scale"]["items"]), 20)
        self.assertLess(seconds, 65)
        self.assertLess(len(encoded), 2*1024*1024)
        self.assertLess(len(queries), 250)
        evidence = os.environ.get("TERUISI_COMPARISON_EVIDENCE_DIR")
        if evidence:
            projection_sql = next(q["sql"] for q in queries if 'AS "payment_present"' in q["sql"] and 'GROUP BY' in q["sql"] and '"business_date"' in q["sql"] and '"transactionOrders_present"' in q["sql"])
            with connection.cursor() as cursor:
                cursor.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+projection_sql)
                plan = cursor.fetchone()[0]
            with (Path(evidence)/"representative-projection-plan.json").open("x", encoding="utf-8") as output: json.dump(plan, output, indent=2)
            with (Path(evidence)/"representative-scale.json").open("x", encoding="utf-8") as output:
                json.dump({"synthetic": True, "facts": 60_000, "shops": 50, "daysEachPeriod": 30, "seconds": seconds, "readSqlCount": len(queries), "responseUtf8Bytes": len(encoded), "candidates": 50, "returned": 20}, output, indent=2)
            with (Path(evidence)/"representative-owning-response.json").open("x", encoding="utf-8") as output: json.dump(result, output, ensure_ascii=False)
