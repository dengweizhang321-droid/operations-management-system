from copy import deepcopy
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from . import chat, provider, tests as support
from .chat import _promotion_evidence, _promotion_locator, _promotion_prompt_conflicts, PROMOTION_TOOL
from .test_dataset_chat import wire
from .policy import canonical


class PromotionChatLocatorTests(SimpleTestCase):
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

    def test_chat_persists_report_and_reuses_exact_scope_for_object_followup(self):
        locator = {"shopName": "志高商用设备旗舰店", "startDate": "2026-09-20",
                   "endDate": "2026-09-25", "sourceRevision": "799:9af9045ada91"}
        entry = deepcopy(support.CATALOG[0])
        entry["name"] = PROMOTION_TOOL
        entry["title"] = "京东推广诊断"
        entries = [entry]
        first = [wire("openai_compatible", PROMOTION_TOOL, {
            "shopName": locator["shopName"], "startDate": locator["startDate"], "endDate": locator["endDate"]}),
                 wire("openai_compatible", answer="花费下降，点击增加；请人工复核计划转化。")]
        with patch.object(chat.transport, "catalog", return_value=entries), \
             patch.object(chat.transport, "execute_tool", return_value={"ok": True, "data": {
                 "status": "complete", "mode": "overview", "reportLocator": locator}}), \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", side_effect=first):
            answer = chat.answer({"clientRequestId": "promotion-first", "message": "分析志高商用设备旗舰店2026年9月20日至25日推广"},
                                 self.owner, "promotion-first")
        self.assertEqual(answer["execution"]["promotionReport"], locator)
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
        with patch.object(chat.transport, "catalog", return_value=entries), \
             patch.object(chat.transport, "execute_tool", return_value=relation), \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", side_effect=second) as model:
            followup = chat.answer({"clientRequestId": "promotion-followup", "conversationId": conv_id,
                                    "message": "这个计划对应SKU依据"}, self.owner, "promotion-followup")
            self.assertIn("verified_promotion_context", canonical(model.call_args_list[0].args[1]["messages"]))
        self.assertEqual(followup["execution"]["promotionReport"], locator)
        self.assertEqual(followup["execution"]["promotionEvidence"]["relations"][0]["rows"][0]["skuId"], "SKU1")
