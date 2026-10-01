"""Panorama composition tests: owning readers over private PostgreSQL facts.

Failure injection is explicitly distinguished from the successful real owning
queries. These fixtures never read a live business source.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from django.db import connection
from django.db.models import F
from django.http import QueryDict
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from access_control.models import AppUser
from sales.auth import Principal
from netshop.errors import NetshopApiError
from netshop.models import NetshopDataRevision
from netshop.store_panorama import _validate
from netshop import store_panorama as panorama
from .promotion_insights_fixtures import add_day


def params(**values):
    return QueryDict(urlencode({"platform": "京东", "outlet": "京东\x1fA", "startDate": "2026-09-01", "endDate": "2026-09-01", **values}, doseq=True))


class StorePanoramaValidationTests(SimpleTestCase):
    def test_requires_one_explicit_platform_and_store(self):
        for values in ({"outlet": []}, {"platform": ["京东", "天猫"]}, {"outlet": ["京东\x1fA", "京东\x1fB"]}, {"outlet": "天猫\x1fA"}):
            with self.subTest(values=values), self.assertRaises(NetshopApiError):
                _validate(params(**values))

    def test_rejects_unknown_duplicate_control_and_unsafe_table_parameters(self):
        for values in ({"principal": "admin"}, {"q": ["a", "b"]}, {"q": "a\nb"}, {"page": "01"}, {"pageSize": "101"}, {"section": "else"}, {"sectionToken": "b" * 63}):
            with self.subTest(values=values), self.assertRaises(NetshopApiError):
                _validate(params(**values))

    def test_default_scope_and_product_table_size_are_explicit(self):
        spec, table, token = _validate(params())
        self.assertEqual(spec["dimension"], "spu")
        self.assertEqual(table, {"q": "", "page": 1, "pageSize": 5, "section": "performance"})
        self.assertIsNone(token)

    def test_sections_do_not_change_shared_source_spec(self):
        first = _validate(params())[0]
        for section in ("performance", "traffic", "products", "promotion", "margin", "customers", "targets", "dataQuality"):
            self.assertEqual(_validate(params(section=section))[0], first)


class StorePanoramaTests(TestCase):
    def setUp(self):
        self.counter = 0
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        self.principal = Principal("panorama@example.test", "Synthetic", "viewer", None)
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def product(self, *, product="P1", shop="A", platform="京东", day="2026-09-01", payment=3000):
        metrics = {"transactionAmountCents": payment, "transactionQuantity": 2, "visitors": 100, "transactionCustomers": 10, "addCartCustomers": 20, "refundAmountCents": 0}
        typed = {"transaction_quantity": 2, "visitors": 100, "transaction_customers": 10, "add_cart_customers": 20, "refund_amount_cents": 0}
        batch, rows = add_day(self, platform=platform, shop=shop, day=day, promotion=False, rows=[{"id": product, "spu": product, "title": "合成商品 " + product, "values": metrics, "typed": typed}])
        if platform == "京东":
            batch.dataset = "spu_daily"
            batch.save(update_fields=["dataset"])
            rows[0].dataset = "spu_daily"
            rows[0].save(update_fields=["dataset"])
        return rows[0]

    def promotion(self, *, shop="A", platform="京东", day="2026-09-01"):
        add_day(self, shop=shop, platform=platform, day=day)
        if platform == "京东":
            add_day(self, shop=shop, platform=platform, day=day, promotion=False)

    def read(self, **values):
        from netshop.store_panorama import read_store_panorama
        return read_store_panorama(self.principal, params(**values))

    def test_real_jd_owning_envelopes_keep_spu_and_sku_denominators(self):
        self.product()
        self.promotion()
        response = self.read()
        self.assertEqual(response["sources"]["products"]["state"], "ready")
        self.assertEqual(response["sources"]["promotion"]["state"], "ready")
        p, a = response["sources"]["products"]["data"], response["sources"]["promotion"]["data"]
        self.assertEqual(p["sections"]["summary"]["payment"]["value"], 3000)
        self.assertEqual(a["sections"]["summary"]["spendRate"]["value"], .2)
        self.assertEqual(response["context"]["effectiveScope"]["dimension"], "spu")
        self.assertEqual(a["context"]["effectiveScope"]["dimension"], "sku")
        self.assertNotEqual(p["context"]["snapshotToken"], a["context"]["snapshotToken"])
        self.assertEqual(p["context"]["snapshotToken"], response["context"]["snapshotToken"])
        self.assertEqual(list(response["sections"]), list(panorama.SECTION_KEYS))
        self.assertEqual(response["sections"]["performance"]["state"], "partial")
        self.assertEqual(response["sections"]["margin"]["state"], "unavailable")
        self.assertEqual(response["sections"]["targets"]["state"], "unavailable")
        for key in ("sales", "finance", "workflow"):
            self.assertEqual(response["sources"][key]["reasonCode"], "dependency_pending")
        encoded = json.dumps(response)
        self.assertEqual(encoded.count('"netshop-product-insights-v1"'), 1)
        self.assertEqual(encoded.count('"netshop-promotion-v1"'), 1)
        evidence = os.environ.get("TERUISI_PANORAMA_QUERY_EVIDENCE_DIR")
        if evidence:
            with (Path(evidence) / "response-owning-jd.json").open("x", encoding="utf-8") as output:
                json.dump(response, output, ensure_ascii=False, indent=2)

    def test_real_tmall_owning_queries_use_the_same_spu_scope(self):
        self.product(platform="天猫")
        self.promotion(platform="天猫")
        response = self.read(platform="天猫", outlet="天猫\x1fA")
        self.assertEqual(response["sources"]["products"]["data"]["sections"]["summary"]["payment"]["value"], 3000)
        self.assertEqual(response["sources"]["promotion"]["data"]["sections"]["summary"]["spendRate"]["value"], 200 / 3000)
        self.assertEqual(response["sources"]["promotion"]["data"]["context"]["snapshotToken"], response["context"]["snapshotToken"])

    def test_real_cross_store_identical_identity_does_not_mix(self):
        self.product(shop="A", payment=3000)
        self.product(shop="B", payment=9000)
        self.promotion(shop="A")
        self.promotion(shop="B")
        a, b = self.read(), self.read(outlet="京东\x1fB")
        for response, expected in ((a, 3000), (b, 9000)):
            self.assertEqual(response["sources"]["products"]["data"]["sections"]["summary"]["payment"]["value"], expected)
            self.assertEqual(response["sources"]["promotion"]["data"]["sections"]["summary"]["spend"]["value"], 200)
        self.assertNotEqual(a["sectionToken"], b["sectionToken"])

    def test_real_search_and_page_change_only_product_table(self):
        for number in range(7):
            self.product(product="P" + str(number), payment=1000 + number)
        self.promotion()
        plain, searched, paged = self.read(), self.read(q="P6"), self.read(page="2")
        for response in (searched, paged):
            self.assertEqual(response["sources"]["products"]["data"]["sections"]["summary"], plain["sources"]["products"]["data"]["sections"]["summary"])
            self.assertEqual(response["sources"]["promotion"]["data"]["sections"]["summary"], plain["sources"]["promotion"]["data"]["sections"]["summary"])
        self.assertEqual(searched["sources"]["products"]["data"]["sections"]["pagination"]["total"], 1)
        self.assertEqual(paged["sources"]["products"]["data"]["sections"]["pagination"]["returned"], 2)
        self.assertEqual(plain["tableScope"]["pageSize"], 5)
        self.assertEqual(paged["tableScope"]["page"], 2)

    def test_real_missing_day_and_field_remain_owning_partial_or_null(self):
        self.product()
        self.promotion()
        result = self.read(endDate="2026-09-02")
        self.assertEqual(result["sources"]["products"]["data"]["sections"]["summary"]["payment"]["status"], "partial")
        self.assertIsNone(result["sources"]["promotion"]["data"]["sections"]["summary"]["spendRate"]["value"])
        capabilities = {c["id"]: c for c in result["sections"]["traffic"]["capabilities"]}
        self.assertEqual(capabilities["conversion"]["status"], "unavailable")
        self.assertEqual(capabilities["stay_time"]["reasonCode"], "unverified_source")

    def test_real_comparison_dates_are_owning_calendar_dates(self):
        self.product(day="2026-09-01", payment=3000)
        self.product(day="2026-08-01", payment=1000)
        response = self.read()
        self.assertEqual(response["context"]["periods"]["previous"]["startDate"], "2026-08-31")
        response = self.read(endDate="2026-09-02")
        self.assertEqual(response["context"]["periods"]["previous"]["startDate"], "2026-08-01")
        self.assertEqual(response["context"]["periods"]["previous"]["endDate"], "2026-08-02")

    def test_local_product_503_preserves_real_promotion_source(self):
        self.promotion()
        with patch.object(panorama, "_read_products", side_effect=NetshopApiError("private cause", status=503)):
            response = self.read()
        self.assertEqual(response["sources"]["products"], {"state": "error", "data": None, "code": "service_unavailable", "message": "所属只读来源暂时不可用；其他已核验章节仍可查看"})
        self.assertEqual(response["sources"]["promotion"]["state"], "ready")
        self.assertEqual(response["sections"]["traffic"]["state"], "error")
        self.assertEqual(response["sections"]["performance"]["state"], "partial")

    def test_local_promotion_503_preserves_real_product_source(self):
        self.product()
        with patch.object(panorama, "_read_promotion", side_effect=NetshopApiError("private cause", status=503)):
            response = self.read()
        self.assertEqual(response["sources"]["products"]["state"], "ready")
        self.assertEqual(response["sources"]["promotion"]["state"], "error")
        self.assertNotIn("private cause", json.dumps(response))

    def test_authoritative_401_403_409_never_become_local_sources(self):
        for status, code in ((401, "authentication_required"), (403, "access_denied"), (409, "insights_revision_changed")):
            with self.subTest(status=status), patch.object(panorama, "_read_products", side_effect=NetshopApiError("reject", status=status, code=code)), patch.object(panorama, "_read_promotion") as promotion:
                with self.assertRaises(NetshopApiError) as raised:
                    self.read()
                self.assertEqual(raised.exception.status, status)
                promotion.assert_not_called()

    def test_scope_token_cannot_be_reused_for_other_table_or_store(self):
        self.product()
        token = self.read()["sectionToken"]
        self.assertEqual(self.read(sectionToken=token)["sectionToken"], token)
        for changed in ({"page": "2"}, {"section": "promotion"}):
            with self.subTest(changed=changed):
                response = self.read(sectionToken=token, **changed)
                self.assertEqual(response["sectionToken"], token)
                for key, value in changed.items():
                    self.assertEqual(response["tableScope"][key], int(value) if key == "page" else value)
        for changed in ({"q": "P1"}, {"pageSize": "10"}, {"outlet": "京东\x1fB"}):
            with self.subTest(changed=changed), self.assertRaises(NetshopApiError) as raised:
                self.read(sectionToken=token, **changed)
            self.assertEqual(raised.exception.status, 409)

    def test_add_cart_customers_uses_full_efficiency_field(self):
        self.product()
        response = self.read()
        capabilities = {c["id"]: c for c in response["sections"]["traffic"]["capabilities"]}
        self.assertEqual(capabilities["add_cart_customers"]["status"], "available")
        self.assertEqual(response["sources"]["products"]["data"]["sections"]["efficiency"]["metrics"]["addCartCustomers"]["value"], 20)

    def test_optional_raw_json_does_not_prove_customer_or_traffic_projection(self):
        row = self.product(platform="天猫")
        row.metrics_json.update(averageStaySeconds=20, bounceRate=.1, newTransactionCustomers=5, repeatTransactionCustomers=5)
        row.save(update_fields=["metrics_json"])
        response = self.read(platform="天猫", outlet="天猫\x1fA")
        for section, names in (("traffic", ("stay_time", "bounce_rate")), ("customers", ("new_old_buyers",))):
            capabilities = {c["id"]: c for c in response["sections"][section]["capabilities"]}
            for name in names:
                self.assertEqual(capabilities[name]["status"], "unavailable")
                self.assertEqual(capabilities[name]["reasonCode"], "unverified_source")

    def test_actor_change_after_product_owner_finishes_fails_whole_read(self):
        self.product()
        real = panorama._read_products
        def changed(*args):
            result = real(*args)
            AppUser.objects.filter(pk=self.user.pk).update(version=F("version") + 1)
            return result
        with patch.object(panorama, "_read_products", side_effect=changed), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 403)

    def test_revision_change_between_owners_fails_whole_read(self):
        self.product()
        self.promotion()
        real = panorama._read_products
        def changed(*args):
            result = real(*args)
            NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1)
            return result
        with patch.object(panorama, "_read_products", side_effect=changed), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 409)

    def test_whole_budget_expiry_after_product_prevents_promotion_read(self):
        self.product()
        clock = [100.0]
        real = panorama._read_products
        def expired(*args):
            value = real(*args)
            clock[0] += 66
            return value
        with patch("netshop.store_panorama.time.monotonic", side_effect=lambda: clock[0]), patch.object(panorama, "_read_products", side_effect=expired), patch.object(panorama, "_read_promotion") as promotion:
            with self.assertRaises(NetshopApiError) as raised:
                self.read()
            self.assertEqual(raised.exception.status, 503)
            promotion.assert_not_called()

    def test_last_actor_read_is_inside_outer_deadline(self):
        clock, calls = [100.0], [0]
        real = panorama.actor_fence
        def expired(*args):
            value = real(*args)
            calls[0] += 1
            if calls[0] == 2:
                clock[0] += 66
            return value
        with patch("netshop.store_panorama.time.monotonic", side_effect=lambda: clock[0]), patch.object(panorama, "actor_fence", side_effect=expired), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(calls[0], 2)

    def test_serialization_is_inside_outer_deadline(self):
        clock = [100.0]
        real = panorama._encode_response
        def expired(payload):
            value = real(payload)
            clock[0] += 66
            return value
        with patch("netshop.store_panorama.time.monotonic", side_effect=lambda: clock[0]), patch.object(panorama, "_encode_response", side_effect=expired), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 503)

    def test_actual_sql_finishing_after_deadline_blocks_next_read(self):
        clock, completed = [100.0], []
        def expire_after_actual_sql(execute, sql, values, many, context):
            result = execute(sql, values, many, context)
            completed.append(str(sql))
            clock[0] = 166.0
            return result
        with patch("netshop.store_panorama.time.monotonic", side_effect=lambda: clock[0]), connection.execute_wrapper(panorama._sql_fence(165.0)), connection.execute_wrapper(expire_after_actual_sql):
            with connection.cursor() as cursor:
                with self.assertRaises(NetshopApiError):
                    cursor.execute("/* owning read */ SELECT 42")
                with self.assertRaises(NetshopApiError):
                    cursor.execute("SELECT 43")
        self.assertEqual(completed, ["/* owning read */ SELECT 42"])

    def test_budget_covers_initial_actor_sql_before_any_business_read(self):
        calls, completed = [0], []
        def clock():
            calls[0] += 1
            return 100.0 if calls[0] == 1 else 166.0
        def record_completed(execute, sql, values, many, context):
            result = execute(sql, values, many, context)
            completed.append(str(sql))
            return result
        with patch("netshop.store_panorama.time.monotonic", side_effect=clock), connection.execute_wrapper(record_completed), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(completed, [])

    def test_combined_response_overflow_fails_without_truncation(self):
        self.product()
        real = panorama._read_products
        def oversized(*args):
            result = real(*args)
            result["sections"]["metadata"]["limitations"].append("x" * (2 * 1024 * 1024))
            return result
        with patch.object(panorama, "_read_products", side_effect=oversized), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 422)

    def test_platform_permission_rejection_uses_live_actor(self):
        scope = {"platforms": ["天猫"], "channels": [], "warehouses": []}
        self.user.scope = scope
        self.user.save(update_fields=["scope"])
        self.principal = Principal(self.principal.email, "Synthetic", "viewer", scope)
        with self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 403)
