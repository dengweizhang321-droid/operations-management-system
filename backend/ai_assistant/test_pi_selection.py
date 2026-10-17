import unittest
from types import SimpleNamespace
from . import pi_selection as selection
from .policy import AiError


class PiSelectionTests(unittest.TestCase):
    def test_real_scope_intersection_and_exact_shop_identity(self):
        actor = SimpleNamespace(scope=None)
        one = {"platform": "京东", "shop": "测试店"}
        self.assertEqual(selection.normalize(one, actor), one)
        for scope in ({"platforms": ["天猫"], "channels": [], "warehouses": []},
                      {"platforms": ["京东"], "channels": ["不能假定店铺"], "warehouses": []}):
            with self.assertRaises(AiError):
                selection.normalize(one, SimpleNamespace(scope=scope))
        for value in ({"shop": "测试店"}, {**one, "role": "admin"}, {**one, "shop": "x\n"}):
            with self.assertRaises(AiError):
                selection.normalize(value, actor)

    def test_every_data_access_is_bound_to_current_shop_and_session(self):
        one = {"platform": "京东", "shop": "测试店"}
        self.assertEqual(selection.bind_arguments("get_pi_netshop_performance_page", {"dataset": "promotion"}, one), {"dataset": "promotion", **one})
        args = selection.bind_arguments("start_pi_dataset_export", {"sessionId": "s", "dataset": "pi_netshop_promotion", "queryJson": "{}"}, one, "s")
        self.assertIn('"shop":"测试店"', args["queryJson"])
        for name, args in [("get_pi_netshop_performance_page", {"shop": "另一店"}),
                           ("query_system_dataset", {"dataset": "rows_sales_order_lines", "queryJson": "{}"}),
                           ("get_inventory_health", {}),
                           ("start_pi_dataset_export", {"sessionId": "other", "dataset": "pi_netshop_promotion", "queryJson": "{}"})]:
            with self.assertRaises(AiError):
                selection.bind_arguments(name, args, one, "s")
        self.assertEqual(selection.filter_catalog([{"name": "get_data_freshness"}, {"name": "get_inventory_health"}], one), [{"name": "get_data_freshness"}])
