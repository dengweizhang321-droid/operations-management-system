"""Product-owned published fact fixtures; no shared factories are modified."""
from __future__ import annotations

import hashlib
import json
from unittest.mock import patch
from urllib.parse import urlencode

from django.db.models import F
from django.http import QueryDict
from django.test import TestCase
from django.utils import timezone

from access_control.models import AppUser
from sales.auth import Principal
from netshop.errors import NetshopApiError
from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow
from netshop.product_insights import read_product_insights, validate_product_query


class ProductInsightsTests(TestCase):
    def setUp(self):
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        self.principal = Principal("products@example.test", "Synthetic", "viewer", None)
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
        self.counter = 0

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def fact(self, *, product="P1", shop="A", platform="京东", dimension="spu", day="2026-09-01", values=None, category="设备", title=None, status="completed"):
        self.counter += 1
        source = "jd_sku_daily" if platform == "京东" else "tmall_product_daily"
        dataset = dimension + "_daily"
        batch = NetshopImportBatch.objects.create(id=f"products-{self.counter}", source=source, dataset=dataset, platform=platform, shop_name=shop, file_size_bytes=0, file_hash=f"{self.counter:064x}", raw_file_hash="a" * 64, content_hash="b" * 64, scope_key="c" * 64, status=status, row_count=1, date_min=day, date_max=day)
        metrics = {"transactionAmountCents": 1000, "transactionQuantity": 2, "visitors": 100, "transactionCustomers": 10, "addCartCustomers": 20, "refundAmountCents": 0} if values is None else values
        columns = {"transactionAmountCents": "transaction_amount_cents", "transactionQuantity": "transaction_quantity", "visitors": "visitors", "transactionCustomers": "transaction_customers", "addCartCustomers": "add_cart_customers", "refundAmountCents": "refund_amount_cents"}
        row = NetshopRow.objects.create(source_row_key=f"product-{self.counter}", source_row_hash="d" * 64, first_import_batch_id=batch.id, last_import_batch_id=batch.id, source_row_number=2, source=source, dataset=dataset, platform=platform, shop_name=shop, business_date=day, sku_id=product if dimension == "sku" else "SKU-" + product, spu_id=product if dimension == "spu" else "SPU-" + product, category=category, product_name=title or product, product_code="ERP-" + product, metrics_json=metrics, **{columns[key]: value for key, value in metrics.items() if key in columns and isinstance(value, int)})
        return row

    def spec(self, **values):
        return validate_product_query(QueryDict(urlencode({"platform": "京东", "startDate": "2026-09-01", "endDate": "2026-09-01", **values}, doseq=True)))

    def read(self, **values):
        return read_product_insights(self.principal, self.spec(**values))

    def test_real_integer_summary_and_weighted_ratios(self):
        self.fact()
        self.fact(product="P2", values={"transactionAmountCents": 400, "transactionQuantity": 1, "visitors": 10, "transactionCustomers": 5, "addCartCustomers": 4, "refundAmountCents": 20})
        result = self.read()
        self.assertEqual(result["sections"]["summary"]["payment"]["value"], 1400)
        self.assertEqual(result["sections"]["summary"]["conversion"]["value"], 15 / 110)
        self.assertEqual(result["sections"]["summary"]["addCartRate"]["value"], 24 / 110)

    def test_current_first_page_baseline_third_page_identity_pairing(self):
        for number in range(60):
            self.fact(product=f"P{number:03d}", values={"transactionAmountCents": 10000 - number})
            self.fact(product=f"P{number:03d}", day="2026-08-31", values={"transactionAmountCents": 10000 - ((number + 40) % 60)})
        result = self.read()
        first = result["sections"]["items"][0]
        self.assertEqual(first["identity"]["id"], "P000")
        self.assertEqual(first["comparisons"]["payment"]["previous"]["value"], 40 / 9960)
        self.assertEqual(result["sections"]["pagination"]["total"], 60)

    def test_summary_does_not_change_with_table_search_or_page(self):
        self.fact(product="P1")
        self.fact(product="P2")
        all_result, searched, paged = self.read(), self.read(q="P1"), self.read(page="2", pageSize="1")
        self.assertEqual(all_result["sections"]["summary"], searched["sections"]["summary"])
        self.assertEqual(all_result["sections"]["summary"], paged["sections"]["summary"])
        self.assertEqual(searched["sections"]["pagination"]["total"], 1)

    def test_cross_shop_same_product_never_pairs(self):
        self.fact(shop="A", values={"transactionAmountCents": 1000})
        self.fact(shop="B", values={"transactionAmountCents": 2000})
        self.fact(shop="A", day="2026-08-31", values={"transactionAmountCents": 100})
        self.fact(shop="B", day="2026-08-31", values={"transactionAmountCents": 500})
        rows = self.read()["sections"]["items"]
        self.assertEqual({r["identity"]["shopName"]: r["comparisons"]["payment"]["previous"]["value"] for r in rows}, {"A": 9, "B": 3})

    def test_field_presence_real_zero_and_missing_are_separate(self):
        self.fact(values={"transactionAmountCents": 0, "visitors": 0})
        result = self.read()["sections"]["summary"]
        self.assertEqual(result["payment"]["value"], 0)
        self.assertEqual(result["payment"]["status"], "available")
        self.assertIsNone(result["customers"]["value"])
        self.assertEqual(result["customers"]["reasonCode"], "missing_field")
        self.assertIsNone(result["conversion"]["value"])

    def test_partial_additive_but_no_primary_ratio(self):
        self.fact()
        result = self.read(endDate="2026-09-02")["sections"]["summary"]
        self.assertEqual(result["payment"]["status"], "partial")
        self.assertEqual(result["payment"]["value"], 1000)
        self.assertIsNone(result["conversion"]["value"])

    def test_zero_negative_and_missing_baselines_are_not_growth(self):
        for product, baseline in (("zero", 0), ("negative", -100)):
            self.fact(product=product)
            self.fact(product=product, day="2026-08-31", values={"transactionAmountCents": baseline})
        self.fact(product="missing")
        rows = {row["identity"]["id"]: row for row in self.read()["sections"]["items"]}
        self.assertEqual(rows["zero"]["comparisons"]["payment"]["previous"]["reasonCode"], "zero_denominator")
        self.assertEqual(rows["negative"]["comparisons"]["payment"]["previous"]["reasonCode"], "negative_baseline")
        self.assertEqual(rows["missing"]["comparisons"]["payment"]["previous"]["reasonCode"], "incomplete_baseline")

    def test_growth_is_full_database_pairing_before_sort_and_page(self):
        for number in range(60):
            self.fact(product=f"P{number:03d}", values={"transactionAmountCents": 10000 - number})
            self.fact(product=f"P{number:03d}", day="2026-08-31", values={"transactionAmountCents": 9999 - number if number != 59 else 0})
        result = self.read(sort="growth_desc")
        self.assertEqual(result["sections"]["items"][0]["identity"]["id"], "P059")
        self.assertEqual(result["sections"]["growth"]["data"]["collection"], "paired_full_set_before_pagination")

    def test_sku_spu_separate_and_tmall_sku_rejected(self):
        self.fact(dimension="sku", values={"transactionAmountCents": 100})
        self.fact(dimension="spu", values={"transactionAmountCents": 200})
        self.assertEqual(self.read()["sections"]["summary"]["payment"]["value"], 200)
        self.assertEqual(self.read(dimension="sku")["sections"]["summary"]["payment"]["value"], 100)
        with self.assertRaises(NetshopApiError) as failure:
            self.spec(platform="天猫", dimension="sku")
        self.assertEqual(failure.exception.status, 422)

    def test_snapshot_and_section_tokens_are_different_kinds(self):
        self.fact()
        first = self.read()
        self.assertNotEqual(first["sectionToken"], first["context"]["snapshotToken"])
        second = self.read(sectionToken=first["sectionToken"], snapshotToken=first["context"]["snapshotToken"], page="2")
        self.assertEqual(first["sectionToken"], second["sectionToken"])
        with self.assertRaises(NetshopApiError) as failure:
            self.read(snapshotToken=first["sectionToken"])
        self.assertEqual(failure.exception.status, 409)

    def test_actor_revocation_mid_product_read_fails_closed(self):
        self.fact()
        from netshop.product_insights import _list_rows
        def revoke(*args):
            AppUser.objects.filter(email=self.user.email).update(status="disabled", version=2)
            return _list_rows(*args)
        with patch("netshop.product_insights._list_rows", side_effect=revoke), self.assertRaises(NetshopApiError) as failure:
            self.read()
        self.assertEqual(failure.exception.status, 403)

    def test_completed_batch_and_exact_owning_scope_required(self):
        self.fact(product="valid")
        self.fact(product="unfinished", status="processing", values={"transactionAmountCents": 999999})
        wrong = self.fact(product="wrong")
        NetshopImportBatch.objects.filter(id=wrong.last_import_batch_id).update(shop_name="B")
        self.assertEqual(self.read()["sections"]["summary"]["payment"]["value"], 1000)

    def test_unknown_duplicate_and_oversized_parameters_rejected(self):
        for delta in ({"sql": "anything"}, {"page": ["1", "2"]}, {"sort": "payment"}, {"pageSize": "101"}, {"q": "q" * 121}, {"sectionToken": "bad"}):
            with self.subTest(delta=delta), self.assertRaises(NetshopApiError):
                self.spec(**delta)

    def test_counts_full_set_no_page_or_search_totals(self):
        self.fact(product="paid")
        self.fact(product="zero", values={"transactionAmountCents": 0})
        result = self.read(q="zero")["sections"]
        self.assertEqual(result["counts"]["dataProducts"]["value"], 2)
        self.assertEqual(result["counts"]["tradedProducts"]["value"], 1)

    def test_baseline_fact_503_is_section_error_and_keeps_current(self):
        self.fact()
        from netshop.product_insights import _aggregate
        calls = [0]
        def fail_baseline(*args):
            calls[0] += 1
            if calls[0] == 2:
                raise NetshopApiError("Synthetic reader error", code="service_unavailable", status=503)
            return _aggregate(*args)
        with patch("netshop.product_insights._aggregate", side_effect=fail_baseline):
            result = self.read()["sections"]
        self.assertEqual(result["summary"]["payment"]["value"], 1000)
        self.assertEqual(result["baselineReads"]["previous"]["state"], "error")
        self.assertEqual(result["comparisons"]["payment"]["previous"]["reasonCode"], "incomplete_baseline")

    def test_baseline_access_denied_never_returns_current_payload(self):
        self.fact()
        from netshop.product_insights import _aggregate
        calls = [0]
        def fail_baseline(*args):
            calls[0] += 1
            if calls[0] == 2:
                raise NetshopApiError("Synthetic revoked", code="access_denied", status=403)
            return _aggregate(*args)
        with patch("netshop.product_insights._aggregate", side_effect=fail_baseline), self.assertRaises(NetshopApiError) as failure:
            self.read()
        self.assertEqual(failure.exception.status, 403)

    def test_current_category_cohort_keeps_different_baseline_category(self):
        self.fact(category="A")
        self.fact(day="2026-08-31", category="B", values={"transactionAmountCents": 500})
        result = self.read(category="A")["sections"]
        self.assertEqual(result["comparisons"]["payment"]["previous"]["value"], 1)
        self.assertEqual(result["items"][0]["comparisons"]["payment"]["previous"]["value"], 1)
        self.assertEqual(result["growth"]["data"]["pagination"]["total"], 1)

    def test_null_conversion_sort_keeps_candidates_and_stable_tie(self):
        self.fact(product="A-missing", values={"transactionAmountCents": 2000})
        self.fact(product="B-valid")
        self.fact(product="C-zero", values={"visitors": 0, "transactionCustomers": 10})
        result = self.read(sort="conversion_desc")["sections"]
        self.assertEqual(result["pagination"]["total"], 3)
        self.assertEqual([row["identity"]["id"] for row in result["items"]], ["B-valid", "A-missing", "C-zero"])
        self.assertIsNone(result["items"][1]["metrics"]["conversion"]["value"])

    def test_search_identity_does_not_cut_selected_products_daily_history(self):
        self.fact(title="old name", day="2026-09-01")
        self.fact(title="new name", day="2026-09-02")
        result = self.read(q="new name", endDate="2026-09-02")["sections"]
        self.assertEqual(result["items"][0]["metrics"]["payment"]["value"], 2000)
