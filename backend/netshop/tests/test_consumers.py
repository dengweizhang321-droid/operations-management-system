from __future__ import annotations

import json
from unittest import skipUnless
from unittest.mock import patch

from django.core.cache import cache
from django.db import connection, transaction
from django.test import TestCase, TransactionTestCase

from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow
from sales.tests.factories import TEST_SECRET, signed_headers


class _NetshopFixtureMixin:
    def setUp(self) -> None:
        # The projection total is memoized per revision in the process-local
        # cache, which outlives the per-test database rollback.
        cache.clear()
        # netshop's deferred commit trigger requires the revision bump below
        # to land in the same DB transaction as the row writes. TestCase
        # already wraps the whole test in one transaction, but
        # TransactionTestCase does not, so this needs an explicit atomic
        # block to satisfy the guard under both.
        with transaction.atomic():
            NetshopDataRevision.objects.update_or_create(
                domain="netshop", defaults={"revision": 2, "source_digest": "b" * 64}
            )
            NetshopImportBatch.objects.create(
                id="master-1", source="jd_product_master", dataset="product_master",
                platform="京东", shop_name="京东一店", file_name="master.xlsx",
                file_size_bytes=10, file_hash="b" * 64, raw_file_hash="c" * 64,
                content_hash="d" * 64, scope_key="e" * 64, published_state_token="f" * 64,
                status="completed", row_count=1, inserted_count=1, created_at="2026-08-30T00:00:00Z",
                completed_at="2026-08-30T00:01:00Z",
            )
            NetshopRow.objects.create(
                source_row_key="master-row", source_row_hash="1" * 64,
                first_import_batch_id="master-1", last_import_batch_id="master-1", source_row_number=2,
                source="jd_product_master", dataset="product_master", platform="京东", shop_name="京东一店",
                snapshot_date="2026-08-30", product_code="SPU-1", product_name="饮水机",
                sku_id="SKU-1", spu_id="SPU-1", metrics_json={}, raw_json={"商家SKU": "ERP-1", "品牌": "志高"},
                brand="志高", created_at="2026-08-30T00:00:00Z", updated_at="2026-08-30T00:00:00Z",
            )
            NetshopImportBatch.objects.create(
                id="daily-1", source="jd_sku_daily", dataset="sku_daily", platform="京东",
                shop_name="京东一店", file_name="daily.xlsx", file_size_bytes=10,
                file_hash="2" * 64, raw_file_hash="3" * 64, content_hash="4" * 64,
                scope_key="5" * 64, published_state_token="6" * 64, status="completed",
                row_count=1, inserted_count=1, date_min="2026-08-30", date_max="2026-08-30",
                created_at="2026-08-30T00:00:00Z", completed_at="2026-08-30T00:01:00Z",
            )
            NetshopRow.objects.create(
                source_row_key="daily-row", source_row_hash="7" * 64,
                first_import_batch_id="daily-1", last_import_batch_id="daily-1", source_row_number=2,
                source="jd_sku_daily", dataset="sku_daily", platform="京东", shop_name="京东一店",
                business_date="2026-08-30", product_code="P-1", product_name="饮水机",
                sku_id="SKU-1", spu_id="SPU-1", metrics_json={"transactionAmountCents": 12345}, raw_json={},
                transaction_amount_cents=12_345, created_at="2026-08-30T00:00:00Z", updated_at="2026-08-30T00:00:00Z",
            )
            NetshopDataRevision.objects.filter(domain="netshop").update(
                revision=3, source_digest="a" * 64)

    def query(self, payload: dict[str, object], *, scope=None, request_id="netshop-consumer"):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        with patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET}):
            return self.client.post(
                "/api/netshop/consumers/query", data=body, content_type="application/json",
                headers=signed_headers(
                    "/api/netshop/consumers/query", method="POST", body=body,
                    scope=scope, request_id=request_id,
                ),
            )


class NetshopConsumerContractTests(_NetshopFixtureMixin, TestCase):
    def test_product_master_lookup_is_bounded_and_scope_aware(self) -> None:
        response = self.query({
            "operation": "product_master_lookup", "lookupCodes": ["ERP-1"],
            "spuIds": [], "limit": 10,
        })
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["data"]["rows"][0]
        self.assertEqual(row["skuId"], "SKU-1")
        self.assertEqual(row["onlineSpecCode"], "ERP-1")
        self.assertEqual(response["X-Netshop-Data-Revision"], "3:aaaaaaaaaaaa")

        denied = self.query(
            {"operation": "product_master_lookup", "lookupCodes": ["ERP-1"], "spuIds": [], "limit": 10},
            scope={"warehouses": [], "channels": [], "platforms": ["天猫"]},
            request_id="netshop-consumer-scoped",
        )
        self.assertEqual(denied.status_code, 200)
        self.assertEqual(denied.json()["data"]["rows"], [])

    def test_market_projection_page_contains_only_minimal_fields(self) -> None:
        response = self.query({
            "operation": "market_projection_page", "offset": 0, "limit": 100,
            "expectedRevision": None,
        })
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()["data"]
        self.assertEqual(data["total"], 4)
        self.assertEqual({row["kind"] for row in data["rows"]}, {"metric", "identity", "brand"})
        metric = next(row for row in data["rows"] if row["kind"] == "metric")
        self.assertEqual(metric["transactionAmountCents"], 12_345)
        self.assertNotIn("raw", metric)
        self.assertNotIn("metrics", metric)

        changed = self.query({
            "operation": "market_projection_page", "offset": 0, "limit": 100,
            "expectedRevision": "2:bbbbbbbbbbbb",
        }, request_id="netshop-market-stale")
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(changed.json()["code"], "version_conflict")

    def test_market_projection_total_is_computed_once_per_revision(self) -> None:
        from django.db import connection

        # _projection_snapshot itself runs on every request (it owns the cache
        # lookup); what must NOT repeat is the expensive work behind a cache
        # hit: the full identity DISTINCT list and the brand DISTINCT count.
        # Page row fetches run on every request and must not be mistaken for
        # a recomputation.
        executed: list[str] = []

        def count_identity_sql(execute, sql, params, many, context):
            if "DISTINCT" in sql and "netshop_rows" in sql and (
                sql.startswith("SELECT COUNT(*)") or '"sku_id"' in sql
            ):
                executed.append(sql)
            return execute(sql, params, many, context)

        page = {"operation": "market_projection_page", "offset": 0, "limit": 100,
                "expectedRevision": None}
        with connection.execute_wrapper(count_identity_sql):
            first = self.query(page, request_id="netshop-total-first")
            self.assertEqual(first.status_code, 200, first.content)
            after_first = len(executed)
            # One identity DISTINCT list and one brand DISTINCT COUNT(*);
            # metric_rows.count() has no DISTINCT and is cheap, so it is not
            # part of what this memo needs to protect.
            self.assertEqual(after_first, 2, executed)
            self.assertEqual(first.json()["data"]["total"], 4)

            # Same revision: every later page must reuse the memo, so the
            # expensive identity count must not run again.
            for index in range(3):
                repeat = self.query(page, request_id=f"netshop-total-repeat-{index}")
                self.assertEqual(repeat.status_code, 200, repeat.content)
            self.assertEqual(len(executed), after_first)

            # A new revision must invalidate the memo rather than serve a
            # stale total for data that has changed underneath it.
            NetshopDataRevision.objects.filter(domain="netshop").update(
                revision=4, source_digest="e" * 64
            )
            renewed = self.query(page, request_id="netshop-total-renewed")
            self.assertEqual(renewed.status_code, 200, renewed.content)
            self.assertGreater(len(executed), after_first)

    def test_search_latest_heads_preserve_scope_dates_ties_and_exact_pagination(self) -> None:
        from django.db.models import F, OuterRef, Subquery, Value
        from django.db.models.functions import Coalesce
        from netshop.consumers import _latest_rows
        from sales.auth import Principal

        batch_template = NetshopImportBatch.objects.get(pk="master-1")
        row_template = NetshopRow.objects.get(source_row_key="master-row")

        def add(key, *, snapshot=None, date_max=None, completed="2026-08-30T00:01:00Z",
                shop="京东一店", platform="京东", source="jd_product_master", status="completed",
                row_shop=None, batch_ref=None):
            batch = NetshopImportBatch.objects.get(pk=batch_template.pk)
            batch.pk = key
            batch.file_hash = key
            batch.snapshot_date, batch.date_max = snapshot, date_max
            batch.completed_at, batch.shop_name, batch.platform = completed, shop, platform
            batch.source, batch.status = source, status
            batch.save(force_insert=True)
            row = NetshopRow.objects.get(pk=row_template.pk)
            row.pk = None
            row.source_row_key, row.sku_id = key, key
            row.last_import_batch_id = batch_ref or key
            row.shop_name, row.platform, row.source = row_shop or shop, platform, source
            row.save(force_insert=True)

        add("old", snapshot="2026-08-29")
        add("by-date-max", date_max="2026-08-31")
        add("tie-a", snapshot="2026-08-31", completed=None)
        add("tie-z", snapshot="2026-08-31", completed=None)
        add("unpublished", snapshot="2026-09-02", status="processing")
        add("shop-two", snapshot="2026-08-30", shop="京东二店")
        add("tmall", snapshot="2026-08-30", platform="天猫")
        add("promotion", snapshot="2026-08-30", source="jd_promotion")
        add("wrong-shop", snapshot="2026-08-28", row_shop="错误店铺", batch_ref="tie-z")
        # Empty snapshot_date retains the existing COALESCE contract: it does
        # not fall through to date_max and supersede the August head.
        add("empty-snapshot", snapshot="", date_max="2026-09-03")

        principal = Principal(email="analyst@example.test", display_name="Analyst", role="analyst", scope=None)
        latest = (NetshopImportBatch.objects.filter(
            **{field: OuterRef(field) for field in ("source", "dataset", "platform", "shop_name")},
            status="completed",
        ).exclude(source__in=["jd_promotion", "tmall_promotion"])
            .annotate(head_date=Coalesce("snapshot_date", "date_max", Value("")))
            .order_by("-head_date", "-completed_at", "-created_at", "-id").values("id")[:1])
        previous = (NetshopRow.objects.exclude(source__in=["jd_promotion", "tmall_promotion"])
                    .annotate(head=Subquery(latest)).filter(last_import_batch_id=F("head")))
        self.assertSetEqual(set(_latest_rows(principal).values_list("id", flat=True)),
                            set(previous.values_list("id", flat=True)))
        self.assertSetEqual(set(_latest_rows(principal).values_list("source_row_key", flat=True)),
                            {"tie-z", "shop-two", "tmall", "daily-row"})

        payload = {"operation": "row_search", "query": "饮水机", "offset": 0, "limit": 1}
        first = self.query(payload).json()["data"]
        second = self.query({**payload, "offset": 1}, request_id="second").json()["data"]
        self.assertEqual(first["total"], 4)
        self.assertTrue(first["truncated"])
        self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
        denied = self.query(payload, scope={"warehouses": [], "channels": [], "platforms": []},
                            request_id="empty-scope").json()["data"]
        self.assertEqual(denied, {"items": [], "total": 0, "truncated": False})
        scoped = self.query(payload, scope={"warehouses": [], "channels": [], "platforms": ["天猫"]},
                            request_id="tmall-scope").json()["data"]
        self.assertEqual(scoped["total"], 1)
        self.assertEqual(scoped["items"][0]["id"], "tmall:京东一店")


class NetshopProjectionKeysetPagingTests(_NetshopFixtureMixin, TestCase):
    """Keyset and memoized paging must equal the former OFFSET semantics row by row."""

    def setUp(self) -> None:
        super().setUp()
        if connection.vendor != "postgresql":
            # _latest_rows uses DISTINCT ON, which only PostgreSQL has. The
            # brand section is untouched by this change, so on SQLite swap in
            # an equivalent "all published rows in scope" stand-in; on
            # PostgreSQL the real implementation runs.
            from netshop import consumers

            def sqlite_latest_rows(principal):
                rows = NetshopRow.objects.exclude(source__in=["jd_promotion", "tmall_promotion"])
                platforms = consumers._platform_scope(principal)
                return rows.filter(platform__in=platforms) if platforms is not None else rows

            patcher = patch.object(consumers, "_latest_rows", sqlite_latest_rows)
            patcher.start()
            self.addCleanup(patcher.stop)
        with transaction.atomic():
            for index in range(7):
                platform = "天猫" if index % 3 == 0 else "京东"
                NetshopRow.objects.create(
                    source_row_key=f"m-{index:02d}", source_row_hash=f"{index:064d}",
                    first_import_batch_id="daily-1", last_import_batch_id="daily-1",
                    source_row_number=10 + index,
                    source="jd_sku_daily", dataset="spu_daily" if index % 2 else "sku_daily",
                    platform=platform, shop_name="京东一店", business_date="2026-08-30",
                    product_code=f"P-{index % 4}", product_name="x",
                    sku_id=f"SKU-{index % 5}", spu_id=f"SPU-{index % 3}",
                    metrics_json={}, raw_json={}, transaction_amount_cents=index * 100,
                    created_at="2026-08-30T00:00:00Z", updated_at="2026-08-30T00:00:00Z",
                )
            for index in range(3):
                NetshopRow.objects.create(
                    source_row_key=f"brand-{index}", source_row_hash=f"{100 + index:064d}",
                    first_import_batch_id="master-1", last_import_batch_id="master-1",
                    source_row_number=20 + index, source="jd_product_master",
                    dataset="product_master", platform="京东", shop_name="京东一店",
                    snapshot_date="2026-08-30", product_code=f"B-{index}", product_name="x",
                    sku_id=f"BSKU-{index}", spu_id="", metrics_json={}, raw_json={},
                    brand=f"品牌{index}", created_at="2026-08-30T00:00:00Z",
                    updated_at="2026-08-30T00:00:00Z",
                )
            NetshopDataRevision.objects.filter(domain="netshop").update(
                revision=5, source_digest="c" * 64)
        cache.clear()

    _ids = __import__("itertools").count()

    def reference(self, platforms):
        """The pre-change OFFSET implementation, flattened to the full ordered list."""
        from django.db.models import Q
        from netshop import consumers
        from sales.auth import Principal

        scope = None if platforms is None else {"warehouses": [], "channels": [], "platforms": platforms}
        principal = Principal(email="a@example.test", display_name="A", role="admin", scope=scope)
        metric = NetshopRow.objects.filter(source="jd_sku_daily", dataset__in=["sku_daily", "spu_daily"])
        identity = NetshopRow.objects.exclude(Q(sku_id="") & Q(spu_id="") & Q(product_code=""))
        if platforms is not None:
            metric = metric.filter(platform__in=platforms)
            identity = identity.filter(platform__in=platforms)
        brand = consumers._latest_rows(principal).filter(
            dataset="product_master").exclude(brand="").values("brand").order_by().distinct()
        out = []
        for row in metric.order_by("source_row_key"):
            out.append({
                "projectionKey": f"metric:{row.source_row_key}", "kind": "metric",
                "source": row.source, "dataset": row.dataset, "platform": row.platform,
                "shopName": row.shop_name, "businessDate": row.business_date or "",
                "skuId": row.sku_id, "spuId": row.spu_id, "productCode": row.product_code,
                "transactionAmountCents": row.transaction_amount_cents, "brand": "",
            })
        identity_rows = identity.values("platform", "sku_id", "spu_id", "product_code").order_by().distinct()
        for row in identity_rows.order_by("platform", "sku_id", "spu_id", "product_code"):
            out.append({
                "projectionKey": consumers._projection_key(
                    "identity", row["platform"], row["sku_id"], row["spu_id"], row["product_code"]),
                "kind": "identity", "source": "", "dataset": "", "platform": row["platform"],
                "shopName": "", "businessDate": "", "skuId": row["sku_id"], "spuId": row["spu_id"],
                "productCode": row["product_code"], "transactionAmountCents": 0, "brand": "",
            })
        for row in brand.order_by("brand"):
            out.append({
                "projectionKey": consumers._projection_key("brand", row["brand"]),
                "kind": "brand", "source": "", "dataset": "product_master", "platform": "",
                "shopName": "", "businessDate": "", "skuId": "", "spuId": "", "productCode": "",
                "transactionAmountCents": 0, "brand": row["brand"],
            })
        return out

    def page(self, offset, limit, scope, tag):
        response = self.query({
            "operation": "market_projection_page", "offset": offset, "limit": limit,
            "expectedRevision": None,
        }, scope=scope, request_id=f"keyset-{next(self._ids)}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["data"]

    def assert_paging_matches(self, platforms):
        scope = None if platforms is None else {"warehouses": [], "channels": [], "platforms": platforms}
        expected = self.reference(platforms)
        kinds = [row["kind"] for row in expected]
        self.assertEqual(kinds, sorted(kinds, key=["metric", "identity", "brand"].index))
        # brand rows live on 京东 only, so the 天猫 scope has no brand section
        self.assertEqual(set(kinds), {"metric", "identity"} if platforms == ["天猫"] else {"metric", "identity", "brand"})
        for limit in (1, 2, 3, 4, 7, 100):
            collected, offset, totals = [], 0, set()
            while True:
                data = self.page(offset, limit, scope, f"{platforms}-{limit}")
                totals.add(data["total"])
                collected.extend(data["rows"])
                self.assertEqual(data["truncated"], offset + len(data["rows"]) < len(expected))
                if not data["truncated"]:
                    break
                self.assertTrue(data["rows"], "truncated page must make progress")
                offset += len(data["rows"])
            self.assertEqual(totals, {len(expected)})
            self.assertEqual(collected, expected, f"limit={limit}")
        beyond = self.page(len(expected) + 5, 10, scope, "beyond")
        self.assertEqual(beyond, {"rows": [], "total": len(expected), "truncated": False})
        exact_end = self.page(len(expected), 10, scope, "end")
        self.assertEqual(exact_end["rows"], [])
        # a window starting at every offset covers each section boundary
        for offset in range(len(expected) + 1):
            data = self.page(offset, 3, scope, "win")
            self.assertEqual(data["rows"], expected[offset:offset + 3])

    def test_unscoped_paging_matches_offset_reference(self) -> None:
        self.assert_paging_matches(None)

    def test_platform_scoped_paging_matches_offset_reference(self) -> None:
        self.assert_paging_matches(["天猫"])
        self.assert_paging_matches(["京东"])

    def test_identity_list_is_queried_once_per_revision_across_pages(self) -> None:
        executed: list[str] = []

        def wrap(execute, sql, params, many, context):
            if sql.startswith("SELECT DISTINCT") and '"sku_id"' in sql:
                executed.append(sql)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(wrap):
            for offset in range(0, 20, 3):
                self.page(offset, 3, None, "once")
        self.assertEqual(len(executed), 1, executed)

    def test_metric_pages_do_not_read_wide_columns(self) -> None:
        seen: list[str] = []

        def wrap(execute, sql, params, many, context):
            if '"netshop_rows"' in sql and sql.startswith("SELECT") and "source_row_key" in sql:
                seen.append(sql)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(wrap):
            self.page(3, 2, None, "narrow")
        self.assertTrue(seen)
        self.assertFalse(any("raw_json" in sql or "metrics_json" in sql for sql in seen), seen)


class NetshopConsumerProjectionBudgetTests(_NetshopFixtureMixin, TransactionTestCase):
    # The implementation only widens statement_timeout when it is not already
    # inside someone else's atomic block. Django's TestCase wraps every test
    # in a transaction, which would make connection.in_atomic_block always
    # True and hide the widening entirely, so this needs TransactionTestCase.
    # Restricting the post-test flush to netshop's own tables avoids an
    # unrelated whole-database FK ordering failure in other apps' protected
    # tables (see market.tests.test_annotation_blockers_django for the same
    # pattern).
    available_apps = ["netshop"]

    @skipUnless(connection.vendor == "postgresql", "statement_timeout widening is PostgreSQL-only")
    def test_market_projection_total_widens_only_its_own_statement_budget(self) -> None:
        from django.conf import settings
        from netshop import consumers

        executed: list[tuple[str, object]] = []
        original = consumers._projection_snapshot

        def record(*args, **kwargs):
            with connection.execute_wrapper(
                lambda execute, sql, params, many, context: (
                    executed.append((sql, params)), execute(sql, params, many, context)
                )[1]
            ):
                return original(*args, **kwargs)

        with patch.object(consumers, "_projection_snapshot", side_effect=record):
            response = self.query({
                "operation": "market_projection_page", "offset": 0, "limit": 100,
                "expectedRevision": None,
            }, request_id="netshop-total-budget")
        self.assertEqual(response.status_code, 200, response.content)

        budget = [(sql, params) for sql, params in executed if "statement_timeout" in sql]
        # Exactly one SET LOCAL, transaction-scoped (the `true` is_local
        # argument) so it cannot leak to later requests, and carrying the
        # configured timeout value.
        self.assertEqual(len(budget), 1, executed)
        sql, params = budget[0]
        self.assertIn("set_config", sql)
        self.assertIn("true", sql)
        self.assertEqual(list(params), [str(settings.NETSHOP_PROJECTION_TOTAL_TIMEOUT_MS)])
