"""店铺级推广（阿里妈妈“店铺直达”等主体类型为“店铺”的行）的写入与读取契约。

约定：店铺级行的 spu_id 为 ``店铺:<主体ID>``；它进入 netshop_rows 和店铺推广日汇总，
但不生成商品日行、不计入 product_count，读取侧把它单列为“其中店铺级推广”。
没有店铺级行的店铺和历史数据，聚合与响应必须与此前一致。
"""
import copy
import hashlib
from urllib.parse import urlencode
from uuid import uuid4

from django.db.models import F, Sum
from django.http import QueryDict
from django.test import TestCase
from django.utils import timezone

from access_control.models import AppUser
from netshop.errors import NetshopApiError
from netshop.import_service import import_netshop_payload, validate_import_payload
from netshop.models import (
    NetshopDataRevision, NetshopPromotionAggregateControl, NetshopPromotionAggregateManifest,
    NetshopPromotionAggregateState, NetshopPromotionProductDaily, NetshopPromotionShopDaily, NetshopRow,
)
from netshop.promotion_insights import read_promotion_insights
from netshop.query import promotion_overview
from sales.auth import Principal

from .factories import netshop_row, prepared_payload
from .promotion_insights_fixtures import add_day

SHOP = "天猫-志高丽力专卖店"
OTHER_SHOP = "天猫-志高炊之王专卖店"
DAY = "2026-11-12"
ACTOR = "synthetic@example.invalid"


def promo(subject_id, *, store=False, spend=1000, net=0, plan="plan-a", day=DAY, shop=SHOP, number=2):
    """One normalized promotion row exactly as the Worker emits it."""
    raw = {
        "日期": day, "主体ID": subject_id, "主体类型": "店铺" if store else "商品",
        "主体名称": "店铺首页" if store else "商品" + subject_id, "计划ID": plan, "花费": spend / 100,
    }
    return netshop_row(
        source="tmall_promotion", dataset="promotion_daily", platform="天猫", shop_name=shop, business_date=day,
        sku_id="", spu_id=("店铺:" + subject_id) if store else subject_id, product_code="",
        product_name=raw["主体名称"], row_number=number,
        metrics={"spendCents": spend, "netTransactionAmountCents": net, "impressions": 100, "clicks": 5, "netOrders": 1 if net else 0},
        raw=raw,
    )


class StoreLevelPromotionTestCase(TestCase):
    def setUp(self):
        self.counter = 0
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        from netshop.models import NetshopWriteAuthority
        NetshopWriteAuthority.objects.filter(id=1).update(
            status="postgres", authority_epoch=uuid4(), cutover_id="store-level-test",
            migration_verify_run_id="store-level-test", activated_at=timezone.now())

    def tearDown(self):
        NetshopDataRevision.objects.filter(domain="netshop").update(
            revision=F("revision") + 1, source_digest=hashlib.sha256(self.id().encode()).hexdigest())

    def load(self, *rows, seed="store-level-file"):
        return import_netshop_payload(prepared_payload(*rows, raw_seed=seed), ACTOR)

    def shop_day(self, shop=SHOP, day=DAY):
        return NetshopPromotionShopDaily.objects.get(platform="天猫", shop_name=shop, business_date=day)


class WriterAggregationTests(StoreLevelPromotionTestCase):
    def mixed(self):
        # The real Lili shape: products (one with two plans) plus a store subject, one day.
        return [
            promo("10001", spend=1000, net=5000, plan="p1", number=2),
            promo("10002", spend=2000, net=0, plan="p1", number=3),
            promo("355577887", store=True, spend=4000, net=35800, plan="direct", number=4),
        ]

    def test_store_row_counts_in_shop_total_but_not_in_products(self):
        result = self.load(*self.mixed())
        self.assertEqual(result["status"], "imported")
        shop = self.shop_day()
        self.assertEqual(shop.spend_cents, 7000)
        self.assertEqual(shop.net_transaction_amount_cents, 40800)
        self.assertEqual(shop.product_count, 2)
        self.assertEqual(shop.source_row_count, 3)
        products = NetshopPromotionProductDaily.objects.filter(platform="天猫", shop_name=SHOP, business_date=DAY)
        self.assertEqual(sorted(products.values_list("product_id", flat=True)), ["10001", "10002"])
        self.assertFalse(products.filter(product_id__startswith="店铺").exists())
        self.assertEqual(products.aggregate(v=Sum("spend_cents"))["v"], 3000)
        # The store-level part is exactly shop minus the sum of products.
        self.assertEqual(shop.spend_cents - 3000, 4000)
        self.assertEqual(shop.source_row_count - products.aggregate(v=Sum("source_row_count"))["v"], 1)

    def test_state_manifest_and_control_reconcile_with_store_rows(self):
        self.load(*self.mixed())
        state = NetshopPromotionAggregateState.objects.get(platform="天猫", shop_name=SHOP, business_date=DAY)
        self.assertTrue(state.ready)
        self.assertEqual(state.raw_row_count, 3)  # every raw row, store row included
        self.assertEqual(state.product_row_count, 2)  # products only
        manifest = NetshopPromotionAggregateManifest.objects.get(platform="天猫")
        self.assertTrue(manifest.ready)
        self.assertEqual(manifest.raw_row_count, 3)
        self.assertEqual(manifest.product_row_count, 2)
        self.assertEqual(manifest.shop_day_count, 1)
        control = NetshopPromotionAggregateControl.objects.get(platform="天猫")
        self.assertEqual((control.bootstrap_raw_row_count, control.bootstrap_product_row_count, control.bootstrap_shop_day_count), (3, 2, 1))
        # Raw rows persist the store subject with its reserved identity.
        store = NetshopRow.objects.get(spu_id="店铺:355577887")
        self.assertEqual(store.raw_json["主体类型"], "店铺")
        self.assertEqual(store.spend_cents, 4000)

    def test_same_numeric_id_for_store_and_product_never_collides(self):
        result = self.load(
            promo("355577887", spend=1500, net=100, number=2),
            promo("355577887", store=True, spend=4000, number=3),
        )
        self.assertEqual(result["status"], "imported")
        keys = list(NetshopRow.objects.values_list("source_row_key", flat=True))
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(NetshopRow.objects.count(), 2)
        product = NetshopPromotionProductDaily.objects.get()
        self.assertEqual((product.product_id, product.spend_cents), ("355577887", 1500))
        self.assertEqual(self.shop_day().spend_cents, 5500)
        self.assertEqual(self.shop_day().product_count, 1)

    def test_store_only_day_has_shop_total_and_no_product_rows(self):
        self.load(promo("355577887", store=True, spend=4000))
        shop = self.shop_day()
        self.assertEqual((shop.spend_cents, shop.product_count, shop.source_row_count), (4000, 0, 1))
        self.assertFalse(NetshopPromotionProductDaily.objects.exists())
        state = NetshopPromotionAggregateState.objects.get()
        self.assertEqual((state.raw_row_count, state.product_row_count, state.ready), (1, 0, True))

    def test_reimport_replaces_store_level_rows_atomically(self):
        self.load(*self.mixed())
        changed = self.mixed()
        changed[2] = promo("355577887", store=True, spend=900, net=0, plan="direct", number=4)
        result = self.load(*changed, seed="store-level-file-2")
        self.assertEqual(result["status"], "imported")
        self.assertEqual(self.shop_day().spend_cents, 3900)
        self.assertEqual(NetshopRow.objects.filter(spu_id__startswith="店铺:").count(), 1)
        # Dropping the store row in a newer version leaves no stale store-level amount behind.
        self.load(*self.mixed()[:2], seed="store-level-file-3")
        self.assertEqual(self.shop_day().spend_cents, 3000)
        self.assertFalse(NetshopRow.objects.filter(spu_id__startswith="店铺:").exists())

    def test_writer_rejects_forged_identity_in_both_directions(self):
        product_posing_as_store = promo("10001", spend=100)
        product_posing_as_store["spuId"] = "店铺:10001"
        with self.assertRaises(NetshopApiError):
            validate_import_payload(prepared_payload(product_posing_as_store))
        store_posing_as_product = promo("355577887", store=True)
        store_posing_as_product["spuId"] = "355577887"
        with self.assertRaises(NetshopApiError):
            validate_import_payload(prepared_payload(store_posing_as_product))
        mismatched = promo("355577887", store=True)
        mismatched["spuId"] = "店铺:999"
        with self.assertRaises(NetshopApiError):
            validate_import_payload(prepared_payload(mismatched))
        self.assertFalse(NetshopRow.objects.exists())

    def test_unique_product_count_and_master_reconciliation_ignore_store_subject(self):
        result = self.load(*self.mixed())
        batch_totals = result["batch"]
        self.assertEqual(batch_totals["rowCount"], 3)
        stored = __import__("netshop.models", fromlist=["NetshopImportBatch"]).NetshopImportBatch.objects.get(id=batch_totals["id"])
        self.assertEqual(stored.totals_json["uniqueProductCount"], 2)
        self.assertFalse(any("店铺:" in w.get("message", "") for w in result["warnings"]))


class FilesWithoutStoreRowsAreUnchangedTests(StoreLevelPromotionTestCase):
    def test_product_only_payload_aggregates_exactly_as_before(self):
        rows = [promo("10001", spend=1000, net=5000, number=2), promo("10002", spend=2000, number=3)]
        payload = prepared_payload(*rows)
        # The content fingerprint depends only on the normalized rows: pin it so any change
        # to the identity or business-row contract is caught here.
        from netshop.import_service import _fingerprint
        validated = validate_import_payload(copy.deepcopy(payload))
        _scope, _scope_json, content_hash = _fingerprint(validated, validated["rows"])
        self.assertEqual(content_hash, PRODUCT_ONLY_CONTENT_HASH)
        result = import_netshop_payload(payload, ACTOR)
        self.assertEqual(result["status"], "imported")
        shop = self.shop_day()
        self.assertEqual((shop.spend_cents, shop.product_count, shop.source_row_count), (3000, 2, 2))
        state = NetshopPromotionAggregateState.objects.get()
        self.assertEqual((state.raw_row_count, state.product_row_count), (2, 2))
        self.assertEqual(NetshopPromotionProductDaily.objects.count(), 2)
        self.assertEqual(import_netshop_payload(payload, ACTOR)["status"], "duplicate")


# Pinned: computed identically on the pre-change baseline (2321b923) and on this branch.
# The rows are the two product rows of the test above.
PRODUCT_ONLY_CONTENT_HASH = "c9c16eeabdf51e1dfb4f73bbc59999c090c9bf6dc35ceb38453f610140ca8081"


class ReaderTests(StoreLevelPromotionTestCase):
    def setUp(self):
        super().setUp()
        self.principal = Principal("store-level@example.test", "Synthetic", "viewer", None)
        AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer",
            status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())

    def read(self, shop):
        params = QueryDict(urlencode({"platform": "天猫", "outlet": "天猫\x1f" + shop, "startDate": DAY, "endDate": DAY}, doseq=True))
        return read_promotion_insights(self.principal, params)

    def product_day(self, shop, *products):
        add_day(self, shop=shop, day=DAY, platform="天猫", promotion=False,
                rows=[{"id": pid, "values": {"transactionAmountCents": amount}} for pid, amount in products])

    def test_insights_include_store_spend_in_total_and_disclose_it_separately(self):
        self.load(
            promo("10001", spend=1000, net=5000, number=2),
            promo("355577887", store=True, spend=4000, net=35800, number=3),
        )
        self.product_day(SHOP, ("10001", 20000))
        result = self.read(SHOP)
        sections = result["sections"]
        self.assertEqual(sections["summary"]["spend"]["value"], 5000)
        self.assertEqual(sections["summary"]["spend"]["status"], "available")
        self.assertTrue(result["sections"]["dataQuality"]["aggregateReconciled"], sections["dataQuality"])
        # Product objects never contain the store subject.
        ids = [item["id"] for item in sections["items"]]
        self.assertEqual(ids, ["10001"])
        self.assertEqual(sections["pagination"]["total"], 1)
        self.assertFalse(any(str(item["id"]).startswith("店铺") for item in sections["contributions"]["previous"]["spendIncrease"]))
        store = sections["storeLevel"]
        self.assertTrue(store["reconciled"])
        self.assertEqual(store["unit"], "CNY_CENT")
        self.assertEqual(store["periods"]["current"]["spendCents"], 4000)
        self.assertEqual(store["periods"]["current"]["attributedPaymentCents"], 35800)
        self.assertEqual(store["periods"]["current"]["rowCount"], 1)
        self.assertEqual(store["periods"]["current"]["dates"], [DAY])
        self.assertEqual(store["periods"]["current"]["byShop"][0]["shopName"], SHOP)
        self.assertEqual(store["periods"]["previous"]["rowCount"], 0)
        # Shop table total is the whole shop spend; the product item is only its own share.
        self.assertEqual(sections["shops"]["items"][0]["metrics"]["spend"]["value"], 5000)
        self.assertEqual(sections["items"][0]["metrics"]["spend"]["value"], 1000)

    def test_store_only_day_still_reconciles(self):
        self.load(promo("355577887", store=True, spend=4000, net=0))
        self.product_day(SHOP, ("10001", 20000))
        sections = self.read(SHOP)["sections"]
        self.assertTrue(sections["dataQuality"]["aggregateReconciled"], sections["dataQuality"])
        self.assertEqual(sections["summary"]["spend"]["value"], 4000)
        self.assertEqual(sections["items"], [])
        self.assertEqual(sections["storeLevel"]["periods"]["current"]["spendCents"], 4000)

    def test_shop_without_store_rows_has_no_store_level_key(self):
        self.load(promo("10001", spend=1000, net=5000, shop=OTHER_SHOP), seed="other-shop")
        self.product_day(OTHER_SHOP, ("10001", 20000))
        sections = self.read(OTHER_SHOP)["sections"]
        self.assertNotIn("storeLevel", sections)
        self.assertEqual(sections["summary"]["spend"]["value"], 1000)
        self.assertTrue(sections["dataQuality"]["aggregateReconciled"])

    def test_store_level_does_not_leak_across_shops(self):
        self.load(promo("355577887", store=True, spend=4000), seed="lili")
        self.load(promo("10001", spend=1000, shop=OTHER_SHOP), seed="other")
        self.product_day(OTHER_SHOP, ("10001", 20000))
        self.assertNotIn("storeLevel", self.read(OTHER_SHOP)["sections"])

    def test_old_overview_derives_store_level_and_omits_it_when_absent(self):
        self.load(
            promo("10001", spend=1000, net=5000, number=2),
            promo("355577887", store=True, spend=4000, net=35800, number=3),
        )
        self.load(promo("10001", spend=700, shop=OTHER_SHOP), seed="other")
        self.product_day(SHOP, ("10001", 20000))
        self.product_day(OTHER_SHOP, ("10001", 20000))
        period = {"startDate": DAY, "endDate": DAY, "endExclusive": "2026-11-13", "days": 1}
        with_store = promotion_overview(platforms=["天猫"], outlets=[{"platform": "天猫", "shopName": SHOP}], requested_period=period)
        summary = with_store["summary"]
        self.assertEqual(summary["spendCents"], 5000)
        self.assertEqual(summary["productCount"], 1)
        self.assertEqual(summary["storeLevel"]["spendCents"], 4000)
        self.assertEqual(summary["storeLevel"]["netTransactionAmountCents"], 35800)
        self.assertEqual(summary["storeLevel"]["rowCount"], 1)
        without = promotion_overview(platforms=["天猫"], outlets=[{"platform": "天猫", "shopName": OTHER_SHOP}], requested_period=period)
        self.assertNotIn("storeLevel", without["summary"])
        self.assertEqual(without["summary"]["spendCents"], 700)

    def test_reader_fails_closed_when_shop_total_lacks_the_store_rows(self):
        self.load(promo("10001", spend=1000, number=2), promo("355577887", store=True, spend=4000, number=3))
        self.product_day(SHOP, ("10001", 20000))
        NetshopPromotionShopDaily.objects.filter(shop_name=SHOP).update(spend_cents=1000, source_row_count=1)
        sections = self.read(SHOP)["sections"]
        self.assertFalse(sections["dataQuality"]["aggregateReconciled"])
        self.assertEqual(sections["summary"]["spend"]["status"], "unavailable")
