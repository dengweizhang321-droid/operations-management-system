"""Published whole-shop series fixtures; isolated PostgreSQL only."""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from django.db import connection
from django.db.models import F
from django.http import QueryDict
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from netshop import product_scope_series as series
from netshop.errors import NetshopApiError
from netshop.models import NetshopDataRevision, NetshopImportBatch, NetshopRow
from netshop.product_insights import ALL_FIELDS, PERFORMANCE_FIELD_ALIASES
from sales.auth import Principal
from . import test_product_insights as owner_fixtures


class ProductScopeSeriesTests(TestCase):
    setUp = owner_fixtures.ProductInsightsTests.setUp
    tearDown = owner_fixtures.ProductInsightsTests.tearDown
    fact = owner_fixtures.ProductInsightsTests.fact

    def params(self, **extra):
        return QueryDict(urlencode({
            "platform": "京东", "outlet": "京东\x1fA", "dimension": "spu",
            "startDate": "2026-09-01", "endDate": "2026-09-01", **extra,
        }, doseq=True))

    def read(self, **extra):
        return series.read_product_scope_series(self.principal, self.params(**extra))

    def cell(self, dto, key, period="current", index=0):
        return dto["series"][period][index]["cells"][series.COLUMN_KEYS.index(key)]

    def export(self, name, dto, params):
        root = os.environ.get("TERUISI_FOUNDATION_CAPACITY_EVIDENCE_DIR")
        if root:
            path = Path(root)
            path.mkdir(parents=True, exist_ok=True)
            envelope = {"fixture": "synthetic-private-postgresql-only", "query": params.urlencode(),
                        "owningRevision": dto["context"]["sourceRevisions"][0]["revision"], "body": dto}
            with (path / name).open("x", encoding="utf-8") as output:
                json.dump(envelope, output, ensure_ascii=False, allow_nan=False)

    def test_full_shop_not_list_page_and_precise_day_coverage(self):
        for number in range(31):
            self.fact(product=f"P{number}")
        self.fact(shop="B", product="P0", values={"transactionAmountCents": 90000})
        self.fact(dimension="sku", values={"transactionAmountCents": 80000})
        self.fact(status="failed", values={"transactionAmountCents": 70000})
        dto = self.read(endDate="2026-09-02")
        self.assertEqual(self.cell(dto, "payment")[0:3], [31000, "available", None])
        self.assertEqual(self.cell(dto, "payment", index=1)[0:3], [None, "unavailable", "no_records"])
        ref = dto["series"]["current"][0]["coverageRef"]
        self.assertEqual(dto["pointCoverage"][ref]["rows"], 31)
        self.assertFalse(dto["context"]["coverageBySource"]["jd_sku_daily:spu_daily:京东:current"]["complete"])
        for field in ("q", "page", "pageSize", "category", "productIdentity"):
            with self.assertRaises(NetshopApiError):
                self.read(**{field: "1"})
        self.export("series-day-response.json", dto, self.params(endDate="2026-09-02"))

    def test_numeric_zero_missing_field_and_non_numeric_projection(self):
        self.fact(values={"transactionAmountCents": 0, "visitors": 0, "transactionCustomers": 0})
        dto = self.read()
        self.assertEqual(self.cell(dto, "payment")[0:3], [0, "available", None])
        self.assertEqual(self.cell(dto, "quantity")[0:3], [None, "unavailable", "missing_field"])
        self.assertEqual(self.cell(dto, "conversion")[0:3], [None, "unavailable", "zero_denominator"])
        self.export("series-zero-response.json", dto, self.params())
        self.fact(day="2026-09-02", values={"transactionAmountCents": False, "visitors": "invalid"})
        dto = self.read(startDate="2026-09-02", endDate="2026-09-02")
        self.assertEqual(self.cell(dto, "payment")[0:3], [None, "unavailable", "missing_field"])

    def test_natural_week_weighted_operands_and_tail(self):
        for offset in range(8):
            day = str(date(2026, 9, 6) + timedelta(days=offset))
            values = {"transactionAmountCents": 0, "transactionQuantity": 0, "visitors": 0,
                      "transactionCustomers": 0, "addCartCustomers": 0, "refundAmountCents": 0}
            if offset == 1:
                values.update(transactionAmountCents=400, visitors=10, transactionCustomers=5)
            if offset == 2:
                values.update(transactionAmountCents=1000, visitors=100, transactionCustomers=10)
            self.fact(day=day, values=values)
        dto = self.read(startDate="2026-09-06", endDate="2026-09-13", grain="week")
        self.assertEqual([(p["date"], p["endDate"]) for p in dto["series"]["current"]],
                         [("2026-09-06", "2026-09-06"), ("2026-09-07", "2026-09-13")])
        self.assertEqual(self.cell(dto, "conversion", index=1)[0], 15 / 110)
        self.assertEqual(self.cell(dto, "conversion", index=1)[4:], [15, 110])
        self.assertEqual(self.cell(dto, "visitorValue", index=1)[0], 1400 / 110)
        self.export("series-week-response.json", dto, self.params(startDate="2026-09-06", endDate="2026-09-13", grain="week"))

    def test_month_keeps_leap_and_real_comparison_windows(self):
        self.fact(day="2024-02-29")
        dto = self.read(startDate="2024-02-01", endDate="2024-02-29", periodKind="month", grain="month")
        self.assertEqual(dto["context"]["periods"]["previous"]["days"], 31)
        self.assertEqual(dto["context"]["periods"]["yearAgo"]["days"], 28)
        self.assertEqual(dto["series"]["previous"][0]["endDate"], "2024-01-31")
        self.assertEqual(dto["series"]["yearAgo"][0]["endDate"], "2023-02-28")
        self.assertEqual(self.cell(dto, "payment")[0:3], [1000, "partial", "missing_day"])
        self.assertIsNone(self.cell(dto, "conversion")[0])
        self.export("series-month-response.json", dto, self.params(startDate="2024-02-01", endDate="2024-02-29", periodKind="month", grain="month"))

    def test_bucket_field_dates_are_not_whole_point_or_period_dates(self):
        self.fact(day="2026-09-07", values={"transactionAmountCents": 10, "visitors": 0})
        self.fact(day="2026-09-08", values={"transactionAmountCents": 20, "visitors": 1, "transactionCustomers": 1})
        params = self.params(startDate="2026-09-07", endDate="2026-09-08", grain="week")
        dto = series.read_product_scope_series(self.principal, params)
        point = dto["series"]["current"][0]
        coverage = dto["pointCoverage"][point["coverageRef"]]
        self.assertEqual(coverage["missingFieldDates"][series.FIELD_KEYS.index("payment")], [])
        self.assertEqual(coverage["missingFieldDates"][series.FIELD_KEYS.index("visitors")], [])
        self.assertEqual(coverage["missingFieldDates"][series.FIELD_KEYS.index("customers")], ["2026-09-07"])
        self.assertEqual(self.cell(dto, "customers")[0:3], [1, "partial", "missing_field"])
        self.assertIsNone(self.cell(dto, "conversion")[0])
        self.export("series-field-coverage-response.json", dto, params)

    def test_single_explicit_scope_sku_spu_and_foreign_batch(self):
        for suffix in ("&outlet=京东%1FB", "&platform=天猫", "&grain=day", "&grain=seven_days", "&grain=day&grain=month"):
            query = self.params()
            query = QueryDict(query.urlencode() + suffix)
            if suffix == "&grain=day":
                series.validate_product_scope_series_query(query)
            else:
                with self.assertRaises(NetshopApiError):
                    series.validate_product_scope_series_query(query)
        without_shop = self.params().copy(); without_shop.pop("outlet")
        with self.assertRaises(NetshopApiError):
            series.read_product_scope_series(self.principal, without_shop)
        self.fact(dimension="sku", values={"transactionAmountCents": 100})
        self.fact(dimension="spu", values={"transactionAmountCents": 200})
        self.assertEqual(self.cell(self.read(dimension="sku"), "payment")[0], 100)
        self.assertEqual(self.cell(self.read(), "payment")[0], 200)
        with self.assertRaises(NetshopApiError) as denied:
            self.read(platform="天猫", outlet="天猫\x1fA", dimension="sku")
        self.assertEqual(denied.exception.status, 422)
        row = self.fact(day="2026-09-02")
        batch = NetshopImportBatch.objects.get(id=row.last_import_batch_id)
        batch.shop_name = "B"; batch.save(update_fields=["shop_name"])
        self.assertEqual(self.cell(self.read(startDate="2026-09-02", endDate="2026-09-02"), "payment")[0:3],
                         [None, "unavailable", "no_records"])

    def test_source_and_authority_changes_are_not_missing_data(self):
        self.fact()
        original = series._bucket_aggregates
        def change(*args):
            value = original(*args)
            NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1)
            return value
        with patch.object(series, "_bucket_aggregates", side_effect=change), self.assertRaises(NetshopApiError) as stale:
            self.read()
        self.assertEqual(stale.exception.status, 409)
        original_columns = series._columns
        def authority(context):
            value = original_columns(context)
            type(self.user).objects.filter(email=self.user.email).update(version=2)
            return value
        with patch.object(series, "_columns", side_effect=authority), self.assertRaises(NetshopApiError) as denied:
            self.read()
        self.assertEqual(denied.exception.status, 403)

    def test_each_existing_role_and_restricted_scope_fail_closed(self):
        self.fact()
        for role in ("viewer", "analyst", "operator", "admin"):
            type(self.user).objects.filter(email=self.user.email).update(role_id=role)
            principal = Principal(self.user.email, "Synthetic", role, None)
            dto = series.read_product_scope_series(principal, self.params())
            self.assertEqual(self.cell(dto, "payment")[0], 1000)
        for scope in (
            {"platforms": ["天猫"], "channels": [], "warehouses": []},
            {"platforms": ["京东"], "channels": ["restricted"], "warehouses": []},
            {"platforms": ["京东"], "channels": [], "warehouses": ["restricted"]},
        ):
            type(self.user).objects.filter(email=self.user.email).update(scope=scope)
            principal = Principal(self.user.email, "Synthetic", "admin", scope)
            with self.assertRaises(NetshopApiError) as denied:
                series.read_product_scope_series(principal, self.params())
            self.assertEqual(denied.exception.status, 403)
        type(self.user).objects.filter(email=self.user.email).update(scope=None, status="inactive")
        with self.assertRaises(NetshopApiError) as inactive:
            series.read_product_scope_series(Principal(self.user.email, "Synthetic", "admin", None), self.params())
        self.assertEqual(inactive.exception.status, 403)

    def test_source_scope_vector_change_even_without_global_revision_change(self):
        from netshop.models import NetshopProductDailyScopeRevision
        self.fact()
        NetshopProductDailyScopeRevision.objects.create(platform="京东", shop_name="A", data_version=1)
        original = series._columns
        def change(context):
            values = original(context)
            NetshopProductDailyScopeRevision.objects.filter(platform="京东", shop_name="A").update(data_version=F("data_version") + 1)
            return values
        with patch.object(series, "_columns", side_effect=change), self.assertRaises(NetshopApiError) as stale:
            self.read()
        self.assertEqual(stale.exception.status, 409)

    def test_sql_failure_rolls_back_before_503(self):
        self.fact()
        def failed_statement(*_args):
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1/0")  # Real private-PG transaction error.
        with patch.object(series, "_bucket_aggregates", side_effect=failed_statement), self.assertRaises(NetshopApiError) as failure:
            self.read()
        self.assertEqual(failure.exception.status, 503)
        self.assertFalse(connection.needs_rollback)
        self.assertEqual(NetshopRow.objects.count(), 1)

    def test_whole_deadline_blocks_sql_after_expired_statement(self):
        self.fact()
        clock = [100.0]
        executed = []
        def advance(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if "SELECT" in str(sql).upper():
                executed.append(sql)
                clock[0] = 102.0
            return result
        with patch("netshop.product_insights.time.monotonic", side_effect=lambda: clock[0]), connection.execute_wrapper(advance), self.assertRaises(NetshopApiError) as failure:
            series.read_product_scope_series(self.principal, self.params(), deadline=101.0)
        self.assertEqual(failure.exception.code, "source_not_ready")
        self.assertEqual(len(executed), 1)
        for invalid in (True, float("nan"), float("inf"), "later"):
            with self.assertRaises(NetshopApiError):
                series.read_product_scope_series(self.principal, self.params(), deadline=invalid)

    def test_unsafe_integer_and_forced_transport_overflow(self):
        self.fact(values={"transactionAmountCents": 9_007_199_254_740_992})
        self.assertEqual(self.cell(self.read(), "payment")[0:3], [None, "invalid", "unsafe_integer"])
        original = series._columns
        def oversized(context):
            value = original(context); value[0]["syntheticOversize"] = "x" * (2 * 1024 * 1024)
            return value
        with patch.object(series, "_columns", side_effect=oversized), self.assertRaises(NetshopApiError) as failure:
            self.read()
        self.assertEqual((failure.exception.status, failure.exception.code), (422, "quality_incomplete"))

    def test_maximum_real_1099_points_21_columns_without_truncation(self):
        start, end = date(2024, 2, 28), date(2026, 2, 28)
        batch = NetshopImportBatch.objects.create(id="series-max", source="jd_sku_daily", dataset="spu_daily",
            platform="京东", shop_name="A", file_size_bytes=0, file_hash="f"*64, raw_file_hash="a"*64,
            content_hash="b"*64, scope_key="c"*64, status="completed", row_count=732,
            date_min=str(start), date_max=str(end))
        metrics = {PERFORMANCE_FIELD_ALIASES[column][0]: 10 for column in ALL_FIELDS.values()}
        rows = []
        for offset in range((end - start).days + 1):
            day = str(start + timedelta(days=offset))
            rows.append(NetshopRow(source_row_key=f"series-max-{day}", source_row_hash="d"*64,
                first_import_batch_id=batch.id, last_import_batch_id=batch.id, source_row_number=offset+2,
                source="jd_sku_daily", dataset="spu_daily", platform="京东", shop_name="A",
                business_date=day, sku_id="SKU-A", spu_id="SPU-A", metrics_json=metrics,
                **{column: 10 for column in ALL_FIELDS.values()}))
        NetshopRow.objects.bulk_create(rows)
        params = self.params(startDate="2025-02-28", endDate="2026-02-28")
        with CaptureQueriesContext(connection) as queries:
            dto = series.read_product_scope_series(self.principal, params)
        self.assertEqual([len(dto["series"][key]) for key in series.PERIODS], [366, 366, 367])
        self.assertEqual(sum(len(v) for v in dto["series"].values()), 1099)
        self.assertEqual(len(dto["columnDefinitions"]), 21)
        self.assertEqual(len(dto["context"]["calendar"]), 366)
        byte_count = len(json.dumps(dto, ensure_ascii=False, allow_nan=False).encode("utf-8"))
        self.assertLessEqual(byte_count, 2 * 1024 * 1024)
        self.assertEqual(self.cell(dto, "payment", "yearAgo", 366)[0:3], [10, "available", None])
        self.export("series-max-response.json", dto, params)
        root = os.environ.get("TERUISI_FOUNDATION_CAPACITY_EVIDENCE_DIR")
        if root:
            with (Path(root) / "series-max-size.json").open("x", encoding="utf-8") as output:
                json.dump({"fixture": "synthetic-private-postgresql-only", "points": 1099,
                           "columns": 21, "bytes": byte_count, "queries": len(queries)}, output)
