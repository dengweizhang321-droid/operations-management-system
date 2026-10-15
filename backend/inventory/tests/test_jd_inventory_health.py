"""Only the health classification/filter delta; all facts are synthetic."""
from datetime import timedelta
from unittest.mock import patch
import uuid

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from inventory import jd_logistics as source
from inventory.errors import InventoryApiError
from inventory.models import InventoryWriteAuthority
from inventory.tests.test_jd_logistics_stockout_v2 import pair
from sales.tests.factories import TEST_SECRET, signed_headers

BASE = "/api/inventory/jd-logistics"
ACTOR = "health-fixture@example.invalid"


def warehouse(*, available=30, demand=30, on_hand=30, purchase=0, transfer=0, cycle=30, window=30, date_reasons=None, sales7=7):
    live, snapshot = pair(on_hand=on_hand, available=available, sales30=demand, sales7=sales7)
    live.data.update(purchaseInTransitQuantity=purchase, transferInTransitQuantity=transfer)
    return {**source._warehouse_metrics(live, snapshot, date_reasons or [], window, cycle), "realtimeDate": live.business_date.isoformat(), "snapshotDate": snapshot.business_date.isoformat(), "qualifications": [], "stockoutThresholdDays": None, "monitorEnabled": False}


class InventoryHealthMathTests(SimpleTestCase):
    def test_seven_states_and_strict_slow_turnover_boundary(self):
        cases = (
            ({"available": 0, "demand": 2, "on_hand": 5, "transfer": 5}, "stockout"),
            ({"available": 1}, "replenish"),
            ({"available": 1, "transfer": 29}, "in_transit_cover"),
            ({"demand": 0, "on_hand": None}, "no_sales"),
            ({"on_hand": 181}, "slow_turnover"),
            ({"on_hand": 180}, "healthy"),
            ({"on_hand": None}, "insufficient_evidence"),
        )
        for arguments, expected in cases:
            with self.subTest(expected=expected):
                row = warehouse(**arguments)
                self.assertEqual(row["inventoryHealthState"], expected)
                self.assertEqual(row["healthCounts"][expected], 1)
                self.assertEqual(row["healthCounts"]["all"], 1)
        self.assertEqual(warehouse(demand=200, available=200, on_hand=1200)["inventoryHealthState"], "healthy")
        self.assertEqual(warehouse(demand=200, available=200, on_hand=1201)["inventoryHealthState"], "slow_turnover")

    def test_known_stockout_replenish_and_transit_do_not_require_on_hand_or_push_setup(self):
        for arguments, state in (({"available": 0, "transfer": None}, "stockout"), ({"available": 1}, "replenish"), ({"available": 1, "transfer": 29}, "in_transit_cover")):
            with self.subTest(state=state):
                row = warehouse(on_hand=None, **arguments)
                self.assertEqual(row["inventoryHealthState"], state)
                self.assertIsNone(row["turnoverDays"])
                self.assertEqual(source._monitor_warning(row["stockoutAvailableDays30d"], None, False), "unconfigured")
        zero = warehouse(available=-3, demand=0)
        self.assertEqual(zero["inventoryHealthState"], "no_sales")
        self.assertFalse(zero["hasStockout"])
        self.assertTrue(zero["hasReplenishmentNeed"])

    def test_missing_own_dependencies_stays_unknown_without_blocking_other_states(self):
        for arguments in ({"available": None}, {"demand": None}, {"demand": -1}, {"purchase": None}, {"transfer": None}, {"date_reasons": ["source_date_mismatch"]}):
            with self.subTest(arguments=arguments):
                row = warehouse(**arguments)
                self.assertEqual(row["inventoryHealthState"], "insufficient_evidence")
                self.assertTrue(row["inventoryHealthReasons"])
        self.assertEqual(warehouse(demand=0, purchase=None, transfer=None)["inventoryHealthState"], "no_sales")
        for window in (7, 30):
            self.assertEqual(warehouse(available=1, sales7=None, window=window)["inventoryHealthState"], "replenish")
            self.assertEqual(warehouse(available=30, cycle=60, window=window)["inventoryHealthState"], "replenish")

    def test_worst_warehouse_and_overlapping_flags_survive_unknown_totals(self):
        rows = [warehouse(available=0), warehouse(available=100), warehouse(available=None)]
        result = source._aggregate_metrics(rows, 30)
        self.assertIsNone(result["availableQuantity"])
        self.assertIsNone(result["suggestedReplenishmentQuantity"])
        self.assertEqual(result["inventoryHealthState"], "stockout")
        self.assertEqual((result["healthCounts"]["all"], result["healthCounts"]["stockout"], result["healthCounts"]["insufficient_evidence"]), (3, 1, 1))
        self.assertTrue(source._matches_health_filter(result, "stockout"))
        self.assertTrue(source._matches_health_filter(result, "replenish"))
        self.assertFalse(source._matches_health_filter(result, "healthy"))
        known_and_unknown = source._aggregate_inventory_health([warehouse(), warehouse(on_hand=None)])
        self.assertEqual(known_and_unknown["inventoryHealthState"], "insufficient_evidence")
        with self.assertRaises(InventoryApiError):
            source._matches_health_filter(result, "arbitrary")

    def test_product_filter_counts_overlap_and_keep_all_matching_product_warehouses(self):
        rows = []
        for department, goods, available in (("A", "SAME", 0), ("A", "SAME", 100), ("A", "SAME", None), ("A", "OTHER", 30), ("B", "SAME", 1)):
            rows.append({**warehouse(available=available), "departmentId": department, "goodsCode": goods})
        selected, counts, tabs = source._health_filter_scope(rows, "replenish")
        self.assertEqual({(row["departmentId"], row["goodsCode"]) for row in selected}, {("A", "SAME"), ("B", "SAME")})
        self.assertEqual(len(selected), 4)
        self.assertEqual((counts["all"], counts["stockout"], counts["replenish"], counts["healthy"]), (3, 1, 1, 1))
        self.assertEqual((tabs["all"], tabs["stockout"], tabs["replenish"]), (3, 1, 2))
        self.assertEqual(set(counts), set(source.HEALTH_FILTER_STATES))
        self.assertEqual(set(tabs), set(source.HEALTH_FILTER_STATES))


class InventoryHealthProjectionTests(TestCase):
    def setUp(self):
        InventoryWriteAuthority.objects.filter(id=1).update(status="postgres", authority_epoch=uuid.uuid4(), cutover_id="health-ram-fixture", migration_verify_run_id="health-ram-fixture", activated_at=timezone.now())
        source.mutate({"operation": "settings", "departmentId": "health-fixture", "businessUnitCode": "HEALTH-BU", "name": "合成健康事业部", "expectedRevision": 0}, ACTOR)
        now = timezone.now()
        today = now.astimezone(source.SHANGHAI).date()
        yesterday = today - timedelta(days=1)
        live_rows, snapshots = [], []
        for goods, warehouse_code, province, available in (("P-A", "A1", "甲省", 0), ("P-A", "A2", "乙省", 100), ("P-A", "A3", "丙省", None), ("P-B", "B1", "仅健康省", 30), ("P-C", "C1", "需补省", 1)):
            row = {"businessUnitCode": "HEALTH-BU", "goodsCode": goods, "goodsName": goods + "合成商品", "warehouseCode": warehouse_code, "warehouseName": warehouse_code + "合成仓", "snapshotDate": today.isoformat(), "onHandQuantity": 30, "availableQuantity": available, "lockedQuantity": 0, "purchaseInTransitQuantity": 0, "transferInTransitQuantity": 0}
            live_rows.append(row)
            snapshots.append({**row, "snapshotDate": yesterday.isoformat(), "sales7dQuantity": 7, "sales30dQuantity": 30, "sourceProvinceCity": province})
        for kind, rows in (("realtime_inventory", live_rows), ("inventory_snapshot", snapshots)):
            source.import_payload({"operation": "import", "sourceKind": kind, "departmentId": "health-fixture", "businessUnitCode": "HEALTH-BU", "rangeStart": yesterday.isoformat(), "rangeEnd": (today + timedelta(days=1)).isoformat(), "rawFileHash": "e" * 64, "fileName": "synthetic-health.xlsx", "complete": True, "expectedScopeRevision": 0, "origin": "manual", "collectedAt": now.isoformat(), "rows": rows}, ACTOR)
        self.filters = {"departmentId": "health-fixture", "layout": "product", "salesWindow": 30, "page": 1, "pageSize": 1}

    def test_filter_before_product_page_keeps_all_details_and_complete_filtered_totals(self):
        first = source.inventory_monitor({**self.filters, "healthState": "replenish"})
        second = source.inventory_monitor({**self.filters, "healthState": "replenish", "page": 2})
        self.assertEqual((first["total"], first["items"][0]["goodsCode"], second["items"][0]["goodsCode"]), (2, "P-A", "P-C"))
        product = first["items"][0]
        self.assertEqual((product["detailCount"], len(product["details"]), product["detailsComplete"]), (3, 3, True))
        self.assertEqual(product["inventoryHealthState"], product["summary"]["inventoryHealthState"])
        self.assertTrue(product["hasStockout"] and product["hasReplenishmentNeed"])
        self.assertEqual({row["warehouseCode"] for row in product["details"]}, {"A1", "A2", "A3"})
        self.assertEqual(first["columns"], second["columns"])
        self.assertEqual({column["label"] for column in first["columns"]}, {"甲省", "乙省", "丙省", "需补省"})
        self.assertEqual(first["totals"], second["totals"])
        self.assertEqual(first["totals"]["healthCounts"]["all"], 4)
        self.assertEqual(first["summary"]["monitoredCount"], 4)
        self.assertEqual((first["healthCounts"]["all"], first["healthFilterCounts"]["replenish"]), (3, 2))
        self.assertTrue(all("inventoryHealthState" in cell for cell in product["cells"]))

    def test_base_scope_and_warehouse_layout_use_same_product_membership_and_default(self):
        default = source.inventory_monitor(self.filters)
        explicit = source.inventory_monitor({**self.filters, "healthState": "all"})
        self.assertEqual(default, explicit)
        warehouse_scope = source.inventory_monitor({**self.filters, "layout": "warehouse", "healthState": "stockout", "pageSize": 50})
        self.assertEqual(warehouse_scope["total"], 3)
        self.assertEqual({row["warehouseCode"] for row in warehouse_scope["items"]}, {"A1", "A2", "A3"})
        search = source.inventory_monitor({**self.filters, "q": "P-C", "healthState": "replenish"})
        self.assertEqual((search["total"], search["healthCounts"]["all"], search["healthFilterCounts"]["replenish"]), (1, 1, 1))
        narrowed = source.inventory_monitor({**self.filters, "warehouseCode": "A2", "healthState": "stockout"})
        self.assertEqual((narrowed["total"], narrowed["healthCounts"]["all"], narrowed["healthFilterCounts"]["stockout"]), (0, 1, 0))
        self.assertEqual(narrowed["totals"]["inventoryHealthState"], "insufficient_evidence")
        self.assertIn("empty_scope", narrowed["totals"]["inventoryHealthReasons"])

    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_signed_get_new_filter_respects_roles_scope_and_strict_validation(self):
        url = BASE + "?operation=inventory_monitor&departmentId=health-fixture&layout=product&healthState=replenish&pageSize=1"
        for role in ("viewer", "analyst", "operator", "admin"):
            response = self.client.get(url, headers=signed_headers(url, role=role))
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()["data"]["healthState"], "replenish")
            self.assertEqual(response.json()["data"]["total"], 2)
        self.assertEqual(self.client.get(url).status_code, 401)
        restricted = self.client.get(url, headers=signed_headers(url, scope={"warehouses": ["A1"], "channels": [], "platforms": []}))
        self.assertEqual(restricted.status_code, 403)
        for query in ("healthState=unknown", "healthState=", "healthState=stockout&healthState=replenish", "healthState=all&healthFilter=stockout"):
            candidate = BASE + "?operation=inventory_monitor&" + query
            self.assertEqual(self.client.get(candidate, headers=signed_headers(candidate)).status_code, 400)
        with self.assertRaises(InventoryApiError):
            source.inventory_monitor({**self.filters, "healthState": "unknown"})
