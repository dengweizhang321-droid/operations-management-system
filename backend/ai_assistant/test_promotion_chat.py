from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from . import chat, models as m, provider, tests as support
from .chat import _promotion_evidence, _promotion_locator, _promotion_prompt_conflicts, _promotion_request_args, PROMOTION_SHOP, PROMOTION_TOOL
from .test_dataset_chat import wire
from .policy import AiError, canonical


class PromotionChatLocatorTests(SimpleTestCase):
    def test_explicit_scope_routes_directly_and_followups_reuse_only_verified_range(self):
        principal = SimpleNamespace(role="admin", scope=None)
        expected = {"shopName": "志高商用设备旗舰店", "startDate": "2026-09-20", "endDate": "2026-09-25", "mode": "overview"}
        prompt = "分析志高商用设备旗舰店2026年9月20日至25日的推广效果，和前6天比较，给出HTML/Excel报告"
        self.assertEqual(_promotion_request_args(prompt, None, principal), expected)
        prior = {**expected, "sourceRevision": "799:9af9045ada91"}
        self.assertEqual(_promotion_request_args("哪些搜索词最值得调整？", prior, principal), expected)
        self.assertEqual(_promotion_request_args("这些关键词的成交为什么下降？", prior, principal), expected)
        self.assertEqual(_promotion_request_args("这个计划的访客变化呢？", prior, principal), expected)
        self.assertEqual(_promotion_request_args("分析推广带来的销售变化", prior, principal), expected)
        for ordinary in ("换成销售分析，按SKU出报告", "生成 SKU 销售明细报告", "按SKU给我店铺销售明细"):
            with self.subTest(ordinary=ordinary):
                self.assertIsNone(_promotion_request_args(ordinary, prior, principal))
        self.assertEqual(_promotion_request_args("改成9月21日至26日的推广", prior, principal)["startDate"], "2026-09-21")
        self.assertEqual(_promotion_request_args("分析志高商用设备旗舰店2026-09-21推广", None, principal)["startDate"], "2026-09-21")
        self.assertEqual(_promotion_request_args("看2026-09-21这天的计划", prior, principal)["endDate"], "2026-09-21")
        self.assertEqual(_promotion_request_args("查看前期2026年9月14日至19日的关键词", prior, principal)["startDate"], "2026-09-20")
        self.assertEqual(_promotion_request_args("比较志高商用设备旗舰店2026-09-14至2026-09-19与2026-09-20至2026-09-25的推广", None, principal)["startDate"], "2026-09-20")
        self.assertIsNone(_promotion_request_args("生成库存报告", prior, principal))
        self.assertIsNone(_promotion_request_args("分析志高商用设备旗舰店推广效果", None, principal))
        with self.assertRaisesRegex(Exception, "仅支持"):
            _promotion_request_args("分析志高切肉机旗舰店2026年9月20日至25日的推广", None, principal)
        with self.assertRaisesRegex(Exception, "仅支持"):
            _promotion_request_args("比较志高商用设备旗舰店和志高切肉机旗舰店2026年9月20日至25日推广", None, principal)
        with self.assertRaisesRegex(Exception, "相邻等长周期"):
            _promotion_request_args("比较2026-09-01至2026-09-05与2026-09-20至2026-09-25推广", None, principal)
        with self.assertRaisesRegex(Exception, "没有.*权限"):
            _promotion_request_args(prompt, None, SimpleNamespace(role="analyst", scope=None))

    def test_ordinary_shop_date_and_report_do_not_supply_promotion_intent(self):
        operator = SimpleNamespace(role="operator", scope={"warehouses": [], "channels": [], "platforms": ["京东"]})
        for prompt in (
            f"查2026-11-05京东{PROMOTION_SHOP}商品日数据，若不支持请报告原因。",
            f"查2026-11-05京东{PROMOTION_SHOP}商品日数据，若不支持请输出原因。",
            f"查看2026-11-05京东{PROMOTION_SHOP}各SKU，出一份报告。",
            f"归因2026-11-05京东{PROMOTION_SHOP}销量下降。",
        ):
            with self.subTest(prompt=prompt):
                self.assertIsNone(_promotion_request_args(prompt, None, operator))
        prior = {"shopName": PROMOTION_SHOP, "startDate": "2026-11-01", "endDate": "2026-11-05"}
        for prompt in ("按SKU出库存报告", "不查推广，生成销售报告", "查销量下降原因并列SKU",
                       "不查推广，只给我商品SKU报告", "不用查推广，按SKU出报告"):
            self.assertIsNone(_promotion_request_args(prompt, prior, operator))

    def test_only_successful_exact_tool_result_is_persisted(self):
        locator = {
            "shopName": "志高商用设备旗舰店",
            "startDate": "2026-09-20",
            "endDate": "2026-09-25",
            "sourceRevision": "799:9af9045ada91",
        }
        success = (PROMOTION_TOOL, {"ok": True, "data": {"reportLocator": locator}})
        self.assertEqual(_promotion_locator([success]), locator)
        self.assertIsNone(_promotion_locator([(PROMOTION_TOOL, {"ok": False, "data": {"reportLocator": locator}})]))
        self.assertIsNone(_promotion_locator([("other_tool", success[1])]))
        self.assertIsNone(_promotion_locator([(PROMOTION_TOOL, {"ok": True, "data": {"reportLocator": {
            **locator, "shopName": "其他店"
        }}})]))
        self.assertIsNone(_promotion_locator([success, (PROMOTION_TOOL, {"ok": True, "data": {
            "status": "source_unavailable", "reason": "缺日"
        }})]))
        self.assertIsNone(_promotion_locator([success, (PROMOTION_TOOL, {"ok": False, "error": {
            "message": "新范围无权限"
        }})]))
        self.assertTrue(_promotion_prompt_conflicts("改成2026年9月21日至26日", locator))
        self.assertTrue(_promotion_prompt_conflicts("改成9月21日至26日", locator))
        self.assertTrue(_promotion_prompt_conflicts("改成9月21日", locator))
        self.assertTrue(_promotion_prompt_conflicts("换成志高切肉机旗舰店", locator))
        self.assertFalse(_promotion_prompt_conflicts("分析志高商用设备旗舰店2026年9月20日至25日", locator))
        self.assertFalse(_promotion_prompt_conflicts("前期2026-09-14哪天拉低了效果？", locator))
        self.assertFalse(_promotion_prompt_conflicts("比较前期2026-09-14到2026-09-19的计划", locator))
        self.assertFalse(_promotion_prompt_conflicts("本期2026-09-20到2026-09-25，前期2026-09-14到2026-09-19", locator))
        self.assertFalse(_promotion_prompt_conflicts("比较前期2026年9月14日至19日", locator))

    def test_object_evidence_is_a_small_subset_of_successful_tool_rows(self):
        locator = {"shopName": "志高商用设备旗舰店", "startDate": "2026-09-20",
                   "endDate": "2026-09-25", "sourceRevision": "799:9af9045ada91"}
        result = {"ok": True, "data": {"status": "complete", "mode": "table", "reportLocator": locator,
                "tableKey": "plans", "title": "计划诊断", "totalRows": 10, "page": 1, "hasMore": True,
                "rows": [{"name": "计划甲", "clicksCurrent": 12, "groupKey": '["P1"]',
                          "unrelatedRawCustomerData": "do not persist"}] * 10}}
        evidence = _promotion_evidence([(PROMOTION_TOOL, result)], locator)
        self.assertEqual(len(evidence["rows"]), 5)
        self.assertEqual(evidence["rows"][0]["groupKey"], '["P1"]')
        self.assertNotIn("unrelatedRawCustomerData", evidence["rows"][0])
        self.assertEqual(evidence["startDate"], "2026-09-20")
        self.assertIsNone(_promotion_evidence([(PROMOTION_TOOL, result), (PROMOTION_TOOL, {"ok": True, "data": {
            "status": "source_changed", "reason": "来源已变"
        }})], locator))


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PromotionChatFlowTests(TestCase):
    user = support.AiDomainTests.user

    def setUp(self):
        support.AiDomainTests.setUp(self)
        self.owner = self.user("promotion-admin@example.invalid", "admin", None)

    def test_chat_persists_report_and_reuses_exact_scope_for_object_followup(self):
        locator = {"shopName": "志高商用设备旗舰店", "startDate": "2026-09-20",
                   "endDate": "2026-09-25", "sourceRevision": "799:9af9045ada91"}
        entry = deepcopy(support.CATALOG[0])
        entry["name"] = PROMOTION_TOOL
        entry["title"] = "京东推广诊断"
        entries = [deepcopy(support.CATALOG[0]), entry]
        overview = {"ok": True, "data": {"status": "complete", "mode": "overview", "reportLocator": locator}}
        def execute_first(name, *args, **kwargs):
            return {"ok": True, "data": {"through": "2026-09-25"}} if name == "get_data_freshness" else overview
        first = [wire("openai_compatible", answer="花费下降，点击增加；请人工复核计划转化。")]
        with patch.object(chat.transport, "catalog", return_value=entries), \
             patch.object(chat.transport, "execute_tool", side_effect=execute_first) as queried, \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", side_effect=first) as model:
            answer = chat.answer({"clientRequestId": "promotion-first", "message": "分析志高商用设备旗舰店2026年9月20日至25日推广"},
                                 self.owner, "promotion-first")
            self.assertEqual([call.args[0] for call in queried.call_args_list], ["get_data_freshness", PROMOTION_TOOL])
            self.assertIn("verified_promotion_diagnostic", canonical(model.call_args.args[1]["messages"]))
        self.assertEqual(answer["execution"]["promotionReport"], locator)
        self.assertEqual(answer["execution"]["toolCalls"], 2)
        self.assertIn("HTML 与 XLSX 已附", answer["reply"])
        conv_id = answer["conversationId"]
        messages = chat.messages({"conversationId": conv_id, "messageId": answer["assistantMessageId"]}, self.owner)
        self.assertEqual(messages["items"][0]["execution"]["promotionReport"], locator)

        second = [wire("openai_compatible", PROMOTION_TOOL, {**locator, "mode": "relations",
            "tableKey": "plans", "groupKey": '["P1"]'}),
                  wire("openai_compatible", answer="此计划与一个已核对 SKU 共现，仍需复核归因。")]
        relation = {"ok": True, "data": {"status": "complete", "mode": "relations", "reportLocator": locator,
            "target": {"tableKey": "plans", "groupKey": '["P1"]'}, "targetEvidence": {"name": "计划甲", "groupKey": '["P1"]'},
            "relationCoverage": "current_source", "relations": [{"label": "此计划的跟单SKU", "tableKey": "planSku",
                "totalRows": 1, "rows": [{"skuId": "SKU1", "planKey": '["P1"]'}]}]}}
        def execute_second(name, args, *rest, **kwargs):
            if name == "get_data_freshness":
                return {"ok": True, "data": {"through": "2026-09-25"}}
            return relation if args.get("mode") == "relations" else overview
        with patch.object(chat.transport, "catalog", return_value=entries), \
             patch.object(chat.transport, "execute_tool", side_effect=execute_second), \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", side_effect=second) as model:
            followup = chat.answer({"clientRequestId": "promotion-followup", "conversationId": conv_id,
                                    "message": "这个计划的成交为什么下降？请给出对应SKU依据"}, self.owner, "promotion-followup")
            self.assertIn("verified_promotion_context", canonical(model.call_args_list[0].args[1]["messages"]))
        self.assertEqual(followup["execution"]["promotionReport"], locator)
        self.assertEqual(followup["execution"]["promotionEvidence"]["relations"][0]["rows"][0]["skuId"], "SKU1")

    def test_changed_scope_pending_or_missing_source_never_falls_back_to_old_report(self):
        from .chat import _latest_promotion_locator, _latest_promotion_state, _promotion_request_args
        old = {"shopName": "志高商用设备旗舰店", "startDate": "2026-09-20",
               "endDate": "2026-09-25", "sourceRevision": "799:9af9045ada91"}
        new = {"shopName": old["shopName"], "startDate": "2026-09-21", "endDate": "2026-09-26"}
        conv = m.AiConversations.objects.create(id="promotion-state", title="测试", model_id=self.model.id, created_by=self.owner.email)
        previous = chat.append(conv.id, "assistant", "旧范围回答")
        previous.execution_json = canonical({"promotionRequestedScope": {key: old[key] for key in new},
                                             "promotionReport": old, "promotionStatus": "complete"})
        previous.save(update_fields=["execution_json"])
        requested = chat.append(conv.id, "user", "改成9月21日至26日")
        requested.execution_json = canonical({"promotionRequestedScope": new, "promotionStatus": "pending"})
        requested.save(update_fields=["execution_json"])
        self.assertEqual(_latest_promotion_state(conv)["scope"], new)
        self.assertIsNone(_latest_promotion_locator(conv))
        self.assertEqual(_promotion_request_args("继续看搜索词", new, self.owner)["startDate"], "2026-09-21")
        unavailable = chat.append(conv.id, "assistant", "新范围缺源")
        unavailable.execution_json = canonical({"promotionRequestedScope": new, "promotionStatus": "source_unavailable"})
        unavailable.save(update_fields=["execution_json"])
        self.assertEqual(_latest_promotion_state(conv)["status"], "source_unavailable")
        self.assertIsNone(_latest_promotion_locator(conv))
        other = chat.append(conv.id, "user", "换成志高切肉机旗舰店")
        other.execution_json = canonical({"promotionScopeInvalidated": True})
        other.save(update_fields=["execution_json"])
        self.assertEqual(_latest_promotion_state(conv)["status"], "unsupported_store")
        self.assertIsNone(_latest_promotion_locator(conv))

    def test_ordinary_turn_uses_normal_tools_and_ends_old_promotion_context(self):
        locator = {"shopName": PROMOTION_SHOP, "startDate": "2026-11-01",
                   "endDate": "2026-11-05", "sourceRevision": "1:0123456789ab"}
        entry = deepcopy(support.CATALOG[0])
        entry["name"] = PROMOTION_TOOL
        for case, ordinary in enumerate(("不查推广，只给我商品SKU报告", "按SKU给我店铺销售明细")):
            with self.subTest(ordinary=ordinary):
                conv = m.AiConversations.objects.create(id=f"prior-promotion-{case}", title="测试",
                            model_id=self.model.id, created_by=self.owner.email)
                previous = chat.append(conv.id, "assistant", "旧推广")
                previous.execution_json = canonical({"promotionReport": locator})
                previous.save(update_fields=["execution_json"])
                with patch.object(chat.transport, "catalog", return_value=[deepcopy(support.CATALOG[0]), entry]), \
                     patch.object(chat.transport, "execute_tool", return_value={"ok": True, "data": {}}) as queried, \
                     patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
                     patch.object(provider, "bounded_json", side_effect=[
                         wire("openai_compatible", "get_data_freshness", {}),
                         wire("openai_compatible", answer="普通问数"),
                         wire("openai_compatible", answer="没有继承推广"),
                     ]) as model:
                    chat.answer({"clientRequestId": f"ordinary-shop-{case}", "conversationId": conv.id,
                                 "message": ordinary}, self.owner, f"ordinary-shop-{case}")
                    chat.answer({"clientRequestId": f"ordinary-followup-{case}", "conversationId": conv.id,
                                 "message": "这些SKU的报告呢"}, self.owner, f"ordinary-followup-{case}")
                self.assertEqual([call.args[0] for call in queried.call_args_list], ["get_data_freshness"])
                for call in model.call_args_list:
                    payload = canonical(call.args[1])
                    self.assertNotIn(PROMOTION_TOOL, payload)
                    self.assertNotIn("verified_promotion_context", payload)
                self.assertIsNone(chat._latest_promotion_locator(conv))

    def test_explicit_promotion_page_entry_uses_the_selected_shop_and_period(self):
        period = {"startDate": "2026-11-01", "endDate": "2026-11-05"}
        scope = {"shopName": PROMOTION_SHOP, **period}
        locator = {**scope, "sourceRevision": "1:0123456789ab"}
        prompt = "请结合当前页面的数据分析重点变化、异常及可能原因，并说明数据来源和统计范围。"
        context = {"module": "shop", "view": "promotion", "period": period, "filters": {
            "dataset": "netshop_promotion_insights", "platforms": ["京东"], "outletKeys": ["京东\x1f" + PROMOTION_SHOP],
        }}
        payload = {"workspaceModule": "shop", "pageContext": context, "message": prompt}
        entry = deepcopy(support.CATALOG[0])
        entry["name"] = PROMOTION_TOOL
        catalog = [deepcopy(support.CATALOG[0]), entry]

        def execute(name, *args, **kwargs):
            return {"ok": True, "data": {}} if name == "get_data_freshness" else {"ok": True, "data": {
                "status": "complete", "mode": "overview", "reportLocator": locator,
            }}

        with patch.object(chat.transport, "catalog", return_value=catalog), \
             patch.object(chat.transport, "execute_tool", side_effect=execute) as queried, \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", return_value=wire("openai_compatible", answer="已核对页面范围")) as model:
            result = chat.answer({**payload, "clientRequestId": "promotion-page"}, self.owner, "promotion-page")
            self.assertEqual(result["execution"]["promotionReport"], locator)
            self.assertEqual(queried.call_args_list[1].args[:2], (PROMOTION_TOOL, {**scope, "mode": "overview"}))
            self.assertEqual(queried.call_args_list[1].kwargs["policy_digest"], chat.digest(catalog))
            self.assertIn("verified_promotion_diagnostic", canonical(model.call_args.args[1]["messages"]))

        # Selecting a different platform, multiple shops, a long period or a
        # narrower product filter cannot silently select the known JD shop.
        invalid_contexts = (
            {**context, "filters": {"platforms": ["天猫"], "outletKeys": ["天猫\x1f" + PROMOTION_SHOP]}},
            {**context, "filters": {"platforms": ["京东"], "outletKeys": ["京东\x1f" + PROMOTION_SHOP, "京东\x1f其他店"]}},
            {**context, "period": {**period, "startDate": "2026-10-20"}},
            {**context, "filters": {**context["filters"], "skus": ["123"]}},
        )
        with patch.object(chat.transport, "catalog", return_value=catalog), \
             patch.object(chat.transport, "execute_tool") as queried, \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", return_value=wire("openai_compatible", answer="普通页问数")) as model:
            for index, invalid in enumerate(invalid_contexts):
                chat.answer({**payload, "pageContext": invalid, "conversationId": result["conversationId"],
                             "clientRequestId": f"promotion-page-other-{index}"}, self.owner, f"promotion-page-other-{index}")
            chat.answer({**payload, "message": "结合当前页面查库存报告",
                         "clientRequestId": "promotion-page-switch"}, self.owner, "promotion-page-switch")
            queried.assert_not_called()
            self.assertTrue(all(PROMOTION_TOOL not in canonical(call.args[1]) for call in model.call_args_list))

        restricted = (
            self.user("promotion-page-operator@example.invalid", "operator", None),
            self.user("promotion-page-scoped@example.invalid", "admin",
                      {"warehouses": [], "channels": [], "platforms": ["京东"]}),
        )
        with patch.object(chat.transport, "catalog", return_value=[support.CATALOG[0]]), \
             patch.object(chat.transport, "execute_tool") as queried, patch.object(provider, "turn") as model:
            for principal in restricted:
                with self.assertRaises(AiError) as caught:
                    chat.answer({**payload, "clientRequestId": "promotion-page-denied"}, principal, "promotion-page-denied")
                self.assertEqual((caught.exception.status, caught.exception.code), (403, "access_denied"))
                self.assertIn("没有京东推广深度诊断权限", str(caught.exception))
            queried.assert_not_called()
            model.assert_not_called()

    def test_model_cannot_change_prechecked_shop_date_or_revision(self):
        locator = {"shopName": "志高商用设备旗舰店", "startDate": "2026-09-20",
                   "endDate": "2026-09-25", "sourceRevision": "799:9af9045ada91"}
        entry = deepcopy(support.CATALOG[0]); entry["name"] = PROMOTION_TOOL
        def execute(name, *args, **kwargs):
            return {"ok": True, "data": {"through": "2026-09-25"}} if name == "get_data_freshness" else {
                "ok": True, "data": {"status": "complete", "mode": "overview", "reportLocator": locator}}
        wrong = wire("openai_compatible", PROMOTION_TOOL, {"shopName": locator["shopName"],
            "startDate": "2026-09-21", "endDate": "2026-09-26", "mode": "table",
            "tableKey": "plans", "sourceRevision": locator["sourceRevision"]})
        with patch.object(chat.transport, "catalog", return_value=[deepcopy(support.CATALOG[0]), entry]), \
             patch.object(chat.transport, "execute_tool", side_effect=execute) as queried, \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", return_value=wrong):
            with self.assertRaises(AiError) as caught:
                chat.answer({"clientRequestId": "wrong-scope", "message": "分析志高商用设备旗舰店2026年9月20日至25日推广"},
                            self.owner, "wrong-scope")
        self.assertEqual(caught.exception.code, "access_denied")
        self.assertEqual(queried.call_count, 2)
        self.assertFalse(m.AiConversationMessages.objects.filter(role="assistant").exists())

    def test_duplicate_overview_after_detail_reuses_preflight_not_last_detail(self):
        locator = {"shopName": "志高商用设备旗舰店", "startDate": "2026-09-20",
                   "endDate": "2026-09-25", "sourceRevision": "799:9af9045ada91"}
        entry = deepcopy(support.CATALOG[0]); entry["name"] = PROMOTION_TOOL
        overview = {"ok": True, "data": {"status": "complete", "mode": "overview", "reportLocator": locator}}
        detail = {"ok": True, "data": {"status": "complete", "mode": "relations", "reportLocator": locator,
                  "target": {"tableKey": "plans", "groupKey": '["P1"]'}, "targetEvidence": {"groupKey": '["P1"]'},
                  "relations": []}}
        def execute(name, args, *rest, **kwargs):
            if name == "get_data_freshness": return {"ok": True, "data": {"through": "2026-09-25"}}
            return detail if args.get("mode") == "relations" else overview
        batch = wire("openai_compatible", PROMOTION_TOOL, {**locator, "mode": "relations", "tableKey": "plans", "groupKey": '["P1"]'})
        batch["choices"][0]["message"]["tool_calls"].append({"id": "overview-repeat", "type": "function",
            "function": {"name": PROMOTION_TOOL, "arguments": canonical({key: locator[key] for key in ("shopName", "startDate", "endDate")})}})
        with patch.object(chat.transport, "catalog", return_value=[deepcopy(support.CATALOG[0]), entry]), \
             patch.object(chat.transport, "execute_tool", side_effect=execute) as queried, \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", side_effect=[batch, wire("openai_compatible", answer="已复核对象依据。")]) as model:
            result = chat.answer({"clientRequestId": "overview-reuse", "message": "分析志高商用设备旗舰店2026年9月20日至25日推广"},
                                 self.owner, "overview-reuse")
        self.assertEqual(queried.call_count, 3)
        self.assertEqual(result["execution"]["toolCalls"], 3)
        tool_frames = [frame for frame in model.call_args_list[-1].args[1]["messages"] if frame["role"] == "tool"]
        self.assertEqual(len(tool_frames), 2)
        self.assertEqual(__import__("json").loads(tool_frames[-1]["content"])["data"]["mode"], "overview")
