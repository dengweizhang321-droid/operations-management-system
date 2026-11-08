from copy import deepcopy

from django.test import SimpleTestCase
from netshop.query import _performance_summary_payload

from . import report_library as library


class ShopConversionGuidanceTests(SimpleTestCase):
    def test_guidance_distinguishes_product_day_ratio_from_period_deduplication(self):
        params = {"snapshot": "fixture", "dimension": "spu", "requested_period": {
            "startDate": "2026-09-01", "endDate": "2026-09-02"}}
        facts = {"transaction_customers": 2, "transaction_quantity": 8, "visitors": 20}
        owner = _performance_summary_payload(facts, **params)
        self.assertEqual(owner["summary"]["conversionRate"], 0.1)
        self.assertNotEqual(owner["summary"]["conversionRate"], 8 / 20)
        self.assertEqual(owner["visitorAggregation"], "product_day_sum")
        self.assertIsNone(_performance_summary_payload({**facts, "visitors": 0}, **params)["summary"]["conversionRate"])

        tools = [{"name": "get_netshop_performance"}]
        default_prompt, default_evidence = library.guidance("店铺转化率", {}, tools, library=library.snapshot(0))
        config = deepcopy(library.DEFAULTS)
        config["skills"][0]["body"] = "旧版自定义方法"
        pinned = {"version": 7, "config": config}
        prompt, evidence = library.guidance("店铺转化率", {}, tools, library=pinned)
        for composed in (default_prompt, prompt):
            for cue in ("成交客户数÷访客数", "分母为零", "区间去重", "不能跨日或跨商品相加"):
                self.assertIn(cue, composed)
        self.assertIn("旧版自定义方法", prompt)
        self.assertEqual(config["skills"][0]["body"], "旧版自定义方法")
        self.assertEqual(default_evidence["version"], 0)
        self.assertEqual(evidence["version"], 7)
        self.assertEqual([skill["id"] for skill in evidence["skills"]], ["shop-diagnosis"])
        self.assertEqual(library.guidance("库存", {}, [{"name": "get_inventory_health"}], library=pinned)[1]["skills"][0]["id"],
                         "inventory-diagnosis")
