"""Full-set catalogue predicates and exact scope/version binding on real PG."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlencode

from django.db import connection
from django.http import QueryDict
from django.test import TestCase

from netshop.catalog_filters import (
    CATALOG_FIELD_ALIASES, apply_catalog_filters, catalog_filter_binding,
    validate_catalog_filters,
)
from netshop.errors import NetshopApiError
from netshop.models import NetshopImportBatch, NetshopRow
from .test_product_insights_detail import ProductDetailTests


class ProductCatalogFilterTests(TestCase):
    setUp = ProductDetailTests.setUp
    tearDown = ProductDetailTests.tearDown
    fact = ProductDetailTests.fact
    master = ProductDetailTests.master
    asset = ProductDetailTests.asset

    def spec(self, **values):
        return validate_catalog_filters(QueryDict(urlencode(values, doseq=True)))

    def capabilities(self, **changes):
        return {"latestMaster": True, "scopeKey": hashlib.sha256(b"catalog-synthetic-full-scope").hexdigest(), "sourceVersion": "1:aaaaaaaaaaaa",
                "fields": {"product_status": True, "catalog_code": True, "category": True, "snapshot_date": True, "image_lookup": True, "exact_identity": True}, **changes}

    def rows(self):
        return NetshopRow.objects.filter(source__in=["jd_product_master", "tmall_product_master"], dataset="product_master")

    def apply(self, **values):
        return apply_catalog_filters(self.rows(), self.spec(**values), as_of_date="2026-10-01", capabilities=self.capabilities())

    def test_legacy_default_keeps_identical_queryset_and_none_binding(self):
        rows = self.rows()
        spec = self.spec(q="legacy-search", page="2")
        self.assertIs(apply_catalog_filters(rows, spec, as_of_date=None, capabilities=None), rows)
        self.assertIsNone(catalog_filter_binding(spec, as_of_date=None, capabilities=None))

    def test_all_new_parameters_bind_scope_source_date_and_policy(self):
        spec = self.spec(status="all")
        first = catalog_filter_binding(spec, as_of_date="2026-10-01", capabilities=self.capabilities())
        self.assertEqual(first["staleAfterDays"], 30)
        self.assertNotEqual(first, catalog_filter_binding(spec, as_of_date="2026-10-02", capabilities=self.capabilities()))
        self.assertNotEqual(first, catalog_filter_binding(spec, as_of_date="2026-10-01", capabilities=self.capabilities(sourceVersion="2:bbbbbbbbbbbb")))
        self.assertNotEqual(first, catalog_filter_binding(spec, as_of_date="2026-10-01", capabilities=self.capabilities(scopeKey="b" * 64)))

    def test_strict_enums_duplicate_values_and_invalid_date_rejected(self):
        for values in ({"status": "active"}, {"quality": "missing"}, {"mapping": "matched"}, {"status": ["all", "on_sale"]}, {"quality": ""}):
            with self.subTest(values=values), self.assertRaises(NetshopApiError):
                self.spec(**values)
        with self.assertRaises(NetshopApiError):
            apply_catalog_filters(self.rows(), self.spec(status="all"), as_of_date="2026-02-30", capabilities=self.capabilities())

    def test_status_no_inventory_inference_and_unrecognized_values_unknown(self):
        self.master(product="On", shop="A", product_status="上架", total_inventory=0, available_inventory=0)
        self.master(product="Off", shop="B", product_status="下架", total_inventory=100)
        self.master(product="Unknown", shop="C", product_status="正常", total_inventory=0)
        self.master(product="Blank", shop="D", product_status="")
        self.assertEqual(list(self.apply(status="on_sale").values_list("spu_id", flat=True)), ["On"])
        self.assertEqual(list(self.apply(status="off_sale").values_list("spu_id", flat=True)), ["Off"])
        self.assertEqual(set(self.apply(status="unknown").values_list("spu_id", flat=True)), {"Unknown", "Blank"})

    def test_code_predicate_same_legacy_alias_precedence_not_erp_mapping(self):
        self.master(product="Missing", shop="A", product_code="", raw_json={})
        self.master(product="Platform", shop="B", product_code="Platform-ID", raw_json={"商品编码": "Platform-ID"})
        self.master(product="Merchant", shop="C", product_code="", raw_json={"SKU商家编码": "Exact-current-code"})
        self.assertEqual(list(self.apply(quality="missing_code").values_list("spu_id", flat=True)), ["Missing"])

    def test_stale_strictly_greater_than_30_business_days_no_missing_snapshot(self):
        self.master(product="Old", shop="A", snapshot="2026-08-31")
        self.master(product="Boundary", shop="B", snapshot="2026-09-01")
        self.master(product="Recent", shop="C", snapshot="2026-09-02")
        self.master(product="Missing", shop="D", snapshot=None)
        self.master(product="Blank", shop="E", snapshot="")
        self.assertEqual(list(self.apply(quality="stale").values_list("spu_id", flat=True)), ["Old"])

    def test_missing_category_no_official_taxonomy_inferred(self):
        self.master(product="Blank", shop="A", category="")
        self.master(product="Present", shop="B", category="源标签")
        self.assertEqual(list(self.apply(quality="missing_category").values_list("spu_id", flat=True)), ["Blank"])

    def test_actual_predicate_capability_missing_is_422_never_all_rows(self):
        self.master()
        cases = (("on_sale", "all", "product_status"), ("all", "missing_image", "image_lookup"), ("all", "missing_code", "catalog_code"), ("all", "missing_category", "category"), ("all", "stale", "snapshot_date"), ("all", "conflict", "exact_identity"))
        for status, quality, field in cases:
            caps = self.capabilities()
            caps["fields"][field] = False
            with self.subTest(field=field), self.assertRaises(NetshopApiError) as failure:
                apply_catalog_filters(self.rows(), self.spec(status=status, quality=quality), as_of_date="2026-10-01", capabilities=caps)
            self.assertEqual(failure.exception.status, 422)

    def test_mapping_no_current_lookup_predicate_all_nonall_fail_closed(self):
        self.master()
        for mapping in ("verified", "unmapped", "ambiguous", "unverified"):
            with self.subTest(mapping=mapping), self.assertRaises(NetshopApiError) as failure:
                self.apply(mapping=mapping)
            self.assertEqual(failure.exception.status, 422)
        with self.assertRaises(NetshopApiError) as failure:
            self.apply(quality="unverified_mapping")
        self.assertEqual(failure.exception.status, 422)

    def test_conflict_same_exact_sku_only_cross_shop_does_not_conflict(self):
        first = self.master(product="X", shop="A", dimension="sku", product_name="Title one")
        second = self.master(product="X", shop="A", dimension="sku", product_name="Title two")
        NetshopRow.objects.filter(pk=second.pk).update(last_import_batch_id=first.last_import_batch_id)
        NetshopImportBatch.objects.filter(id=first.last_import_batch_id).update(row_count=2)
        self.master(product="X", shop="B", dimension="sku", product_name="Other shop")
        self.assertEqual(set(self.apply(quality="conflict").values_list("shop_name", flat=True)), {"A"})
        self.assertEqual(self.apply(quality="conflict").count(), 2)

    def test_conflict_without_exact_sku_identity_is_not_guessed_by_name(self):
        self.master(sku_id="")
        with self.assertRaises(NetshopApiError) as failure:
            self.apply(quality="conflict")
        self.assertEqual(failure.exception.status, 422)

    def test_image_current_exact_shop_assets_and_completed_batch(self):
        self.master(platform="天猫", shop="A")
        self.master(platform="天猫", shop="B")
        self.asset(platform="天猫", shop="A")
        self.assertEqual(list(self.apply(quality="missing_image").values_list("shop_name", flat=True)), ["B"])
        NetshopImportBatch.objects.filter(source="tmall_product_assets").update(status="processing")
        self.assertEqual(set(self.apply(quality="missing_image").values_list("shop_name", flat=True)), {"A", "B"})

    def test_full_set_before_pagination_and_source_proof_required(self):
        self.master(product="One", shop="A", product_status="上架")
        self.master(product="Two", shop="B", product_status="上架")
        rows = self.apply(status="on_sale")
        self.assertEqual(rows.count(), 2)
        self.assertEqual(len(rows.order_by("shop_name")[:1]), 1)
        with self.assertRaises(NetshopApiError):
            apply_catalog_filters(self.rows()[:1], self.spec(status="on_sale"), as_of_date="2026-10-01", capabilities=self.capabilities())
        for caps in (None, {}, self.capabilities(latestMaster=False), self.capabilities(sourceVersion="fake")):
            with self.subTest(caps=caps), self.assertRaises(NetshopApiError) as failure:
                apply_catalog_filters(self.rows(), self.spec(status="on_sale"), as_of_date="2026-10-01", capabilities=caps)
            self.assertEqual(failure.exception.status, 422)

    def test_immutable_sql_predicate_and_binding_evidence(self):
        self.master(product_status="上架", snapshot="2026-08-01")
        result = self.apply(status="on_sale", quality="stale")
        sql, params = result.query.sql_with_params()
        predicate_sql, _ = result.query.where.as_sql(result.query.get_compiler(connection=connection), connection)
        self.assertNotIn("available_inventory", predicate_sql)
        self.assertEqual(result.count(), 1)
        destination = os.environ.get("TERUISI_PRODUCTS_QUERY_EVIDENCE_DIR")
        if destination:
            with (Path(destination) / "catalog-filter-predicates.json").open("x", encoding="utf-8") as output:
                json.dump({"fixture": "synthetic-full-latest-master-v1", "aliases": CATALOG_FIELD_ALIASES, "binding": catalog_filter_binding(self.spec(status="on_sale", quality="stale"), as_of_date="2026-10-01", capabilities=self.capabilities()), "sql": sql, "parameters": params, "matchedRows": result.count(), "legacyBinding": None, "mappingPredicate": "unsupported_not_current_lookup"}, output, ensure_ascii=False, indent=2)
