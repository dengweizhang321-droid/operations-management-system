import copy
import json
from datetime import timedelta
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from sales.auth import Principal

from . import dingtalk_schedules as schedules, dingtalk_settings, models as m, schedule_monitor as monitor
from .policy import AiError, canonical
from . import test_dingtalk_schedules as fixture
from .tests import ADMIN


def sample(day=None, count=1):
    day = day or timezone.localdate().isoformat()
    rows = [{"productCode": "P" + str(i), "productName": "合成型号", "warehouse": "广东仓", "risk": "healthy",
             "riskSource": "备货跟进", "autoRisk": "urgent", "riskReason": "待实物库存增加",
             "availableQuantity": 10, "inTransitQuantity": 5} for i in range(min(count, 20))]
    data = {"page": "inventory.guangdong", "currency": "CNY", "monetaryUnit": "cents",
        "version": "inventory/sales", "sourceSnapshot": "a" * 64,
        "sync": {"inventoryAsOf": day, "inventoryAgeAsOf": day, "salesThrough": day,
                 "inventoryStale": False, "latestInventoryBatchId": "fixture-batch"},
        "metrics": {"itemCount": count, "availableQuantity": 10 * count, "inTransitQuantity": 5 * count,
                    "knownStockValueCents": 12345, "missingCostCount": 0, "missingStockCount": 0},
        "distribution": [{"risk": risk, "itemCount": count if risk == "healthy" else 0} for risk in sorted(monitor.RISKS)],
        "pagination": {"page": 1, "pageSize": 20, "total": count, "totalPages": (count + 19) // 20},
        "items": rows, "disclosures": ["人工清单"]}
    fresh = {"timezone": "Asia/Shanghai", "currentBusinessDate": day,
             "sales": {"through": day}, "inventory": {"asOf": day}}
    return fresh, data


def bridge(fresh, data):
    def execute(name, *args, **kwargs):
        return {"ok": True, "toolName": name, "data": copy.deepcopy(fresh if name == "get_data_freshness" else data)}
    return execute


def analysis(facts, **changes):
    return canonical({"factsDigest": facts["factsDigest"], "summary": "已关注的备货仍需核实实物到仓。",
        "observations": [{"productCode": "P0", "evidenceIds": ["gd-1"], "interpretation": "当前为备货跟进，不能据此认定现货充足。"}],
        "actions": [{"productCode": "P0", "evidenceIds": ["gd-1"], "suggestion": "请负责人核实到仓进展。", "condition": "以实物库存变化为准。"}],
        "limitations": ["无可比历史，无法判断趋势。"], **changes})


class MonitorContractTests(SimpleTestCase):
    def collect(self, fresh=None, data=None, **kw):
        baseline = sample()
        fresh, data = fresh or baseline[0], data or baseline[1]
        with patch.object(monitor.transport, "catalog", return_value=[{"name": "get_data_freshness"}, {"name": "get_inventory_page_data"}]), \
                patch.object(monitor.transport, "execute_tool", side_effect=bridge(fresh, data)):
            return monitor.collect(Principal("fixture@example.invalid", "Fixture", "analyst", None), "run", baseline[0]["currentBusinessDate"], Mock(), **kw)

    def test_full_aggregates_and_partial_detail_are_explicit_and_stable(self):
        fresh, data = sample(count=23)
        facts = self.collect(fresh, data)
        self.assertEqual((facts["detailReturned"], facts["detailTotal"], facts["detailComplete"]), (20, 23, False))
        self.assertEqual(facts, self.collect(fresh, data, verify=True))
        content = monitor.render(facts, analysis(facts))
        self.assertIn("23 个型号", content)
        self.assertIn("20/23", content)
        self.assertIn("healthy（备货跟进，原判urgent）", content)
        self.assertIn("123.45 元", content)

    def test_invalid_source_dates_coverage_stock_and_identity_fail_closed(self):
        for mutate in (
            lambda f, d: d["sync"].update(inventoryStale=True),
            lambda f, d: d["sync"].update(inventoryAsOf="2099-01-01"),
            lambda f, d: d["metrics"].update(missingStockCount=1),
            lambda f, d: d["pagination"].update(total=3),
            lambda f, d: d["distribution"][0].update(itemCount=42),
            lambda f, d: d["items"][0].update(warehouse="广东仓-欧洲站"),
            lambda f, d: d["items"][0].pop("riskSource"),
            lambda f, d: d.update(sourceSnapshot=""),
            lambda f, d: f.update(currentBusinessDate="2020-01-01"),
            lambda f, d: f["sales"].update(through="2020-01-01"),
        ):
            fresh, data = sample()
            mutate(fresh, data)
            with self.subTest(mutate=mutate), self.assertRaises(AiError):
                self.collect(fresh, data)

    def test_existing_domain_stale_policy_and_missing_age_are_preserved(self):
        fresh, data = sample()
        old = (timezone.localdate() - timedelta(days=2)).isoformat()
        fresh["inventory"]["asOf"] = data["sync"]["inventoryAsOf"] = old
        data["sync"]["inventoryAgeAsOf"] = None
        self.assertIsNone(self.collect(fresh, data)["data"]["sync"]["inventoryAgeAsOf"])

    def test_wrong_digest_evidence_products_numbers_and_size_are_rejected(self):
        facts = self.collect()
        bad = [analysis(facts, factsDigest="wrong"), analysis(facts, summary="库存还有30台"),
               analysis(facts, summary="库存共有一千台"), analysis(facts, summary="周转三百天"),
               analysis(facts, summary="需求增加百分之五"), analysis(facts, summary="预计两天到货"),
               analysis(facts, summary="https://example.invalid"), analysis(facts, summary="长" * 501)]
        for field, value in (("productCode", "other"), ("evidenceIds", ["gd-other"])):
            decoded = json.loads(analysis(facts))
            decoded["actions"][0][field] = value
            bad.append(canonical(decoded))
        for reply in bad:
            with self.subTest(reply=reply[:60]), self.assertRaises(AiError):
                monitor.render(facts, reply)


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class SchedulePilotTests(TestCase):
    user = fixture.DingTalkScheduleTests.user
    def setUp(self):
        fixture.DingTalkScheduleTests.setUp(self)
        self.config["bindings"] = [{**self.config["bindings"][0], "scope": None}]
        from access_control.models import AppUser
        AppUser.objects.filter(email=self.owner.email).update(scope=None)

    def prepare(self, **kw):
        item = schedules.save({**self.payload, **kw}, ADMIN)["item"]
        result = schedules.run_now({"id": item["id"], "expectedVersion": item["version"]}, ADMIN)
        return item, m.AiDingTalkScheduleRun.objects.get(pk=result["id"])

    def test_explicit_binding_legacy_edit_and_disabled_model_can_be_stopped(self):
        item, run = self.prepare(modelId=self.model.id)
        self.model.status = "disabled"; self.model.save()
        stopped = schedules.save({**self.payload, "id": item["id"], "expectedVersion": 1, "enabled": False}, ADMIN)["item"]
        self.assertEqual(stopped["modelId"], self.model.id)
        self.assertEqual(stopped["version"], 2)
        with self.assertRaises(AiError):
            schedules.save({**self.payload, "id": item["id"], "expectedVersion": 2}, ADMIN)

    def test_new_runs_have_independent_context_and_model_snapshot(self):
        item, first = self.prepare(modelId=self.model.id)
        captured = []
        def answer(body, *args, **kw):
            captured.append((body, kw["dingtalk_session"].id))
            return {"reply": "合成结果"}
        sender = Mock()
        with patch("ai_assistant.transport.edge", side_effect=fixture.background), patch.object(schedules.chat, "answer", side_effect=answer):
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
            schedules.run_now({"id": item["id"], "expectedVersion": 1}, ADMIN)
            schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
        self.assertNotEqual(captured[0][1], captured[1][1])
        self.assertIsNone(captured[0][0]["conversationId"])
        self.assertIsNone(captured[1][0]["conversationId"])
        self.assertEqual(captured[0][0]["clientRequestId"], "ding-scheduled-" + first.id)
        first.refresh_from_db()
        self.assertEqual(json.loads(first.model_snapshot_json)["id"], self.model.id)
        self.assertEqual((first.analysis_status, first.delivery_status), ("succeeded", "succeeded"))

    def test_pilot_success_persists_facts_content_and_three_stages(self):
        item, run = self.prepare(modelId=self.model.id, executionMode="guangdong_monitor")
        fresh, data = sample()
        def answer(body, *args, **kw):
            self.assertIn("scheduled_analysis", kw)
            run.refresh_from_db()
            self.assertEqual((run.data_status, run.analysis_status, run.delivery_status), ("succeeded", "running", "pending"))
            return {"reply": analysis(kw["scheduled_analysis"]["facts"])}
        # This low-level fake keeps the signed tool bridge API and live identity
        # checks intact; it never calls a provider or external platform.
        def edge(action, payload, principal):
            if action == "authorize_background": return fixture.background()
            if action == "catalog": return {"entries": [{"name": "get_data_freshness"}, {"name": "get_inventory_page_data"}]}
            return bridge(fresh, data)(payload["name"])
        sender = Mock(side_effect=lambda session, content, before_send: before_send())
        with patch("ai_assistant.transport.edge", side_effect=edge), patch.object(schedules.chat, "answer", side_effect=answer) as paid:
            self.assertTrue(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
            self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
        paid.assert_called_once(); sender.assert_called_once()
        run.refresh_from_db()
        self.assertEqual((run.status, run.data_status, run.analysis_status, run.delivery_status), ("sent", "succeeded", "succeeded", "succeeded"))
        self.assertIn("广东仓库存监控", run.content_text)
        self.assertIn("factsDigest", json.loads(run.facts_json))
        self.assertIn("completedAt", json.loads(run.stage_details_json)["delivery"])

    def test_source_or_model_change_blocks_delivery_without_second_generation(self):
        for change in ("source", "source_during_preparation", "date", "model", "bad_analysis", "data_failure", "send_unknown"):
            with self.subTest(change=change):
                item, run = self.prepare(executionMode="guangdong_monitor")
                fresh, data = sample()
                calls = []
                external = []
                def edge(action, payload, principal):
                    if action == "authorize_background": return fixture.background()
                    if action == "catalog": return {"entries": [{"name": "get_data_freshness"}, {"name": "get_inventory_page_data"}]}
                    calls.append(payload["name"])
                    if change == "data_failure": return {"ok": False}
                    return bridge(fresh, data)(payload["name"])
                def answer(body, *args, **kw):
                    if change == "source": data["sourceSnapshot"] = "b" * 64
                    if change == "date": fresh["currentBusinessDate"] = "2020-01-01"
                    if change == "model": m.AiModels.objects.filter(pk=self.model.id).update(version=self.model.version + 1)
                    return {"reply": "bad" if change == "bad_analysis" else analysis(kw["scheduled_analysis"]["facts"])}
                def send(session, content, before_send):
                    if change == "source_during_preparation": data["sourceSnapshot"] = "c" * 64
                    before_send()
                    external.append(content)
                    raise TimeoutError()
                sender = Mock(side_effect=send)
                with patch("ai_assistant.transport.edge", side_effect=edge), patch.object(schedules.chat, "answer", side_effect=answer) as paid:
                    schedules.step(lambda: dingtalk_settings.effective(self.config), sender)
                    self.assertFalse(schedules.step(lambda: dingtalk_settings.effective(self.config), sender))
                run.refresh_from_db()
                self.assertLessEqual(paid.call_count, 1)
                self.assertEqual(len(external), int(change == "send_unknown"))
                if change == "send_unknown":
                    self.assertEqual((run.status, run.delivery_status), ("unknown", "unknown"))
                elif change == "data_failure":
                    self.assertEqual((run.data_status, run.analysis_status), ("failed", "not_required"))
                elif change in ("source", "source_during_preparation"):
                    self.assertEqual((run.error_code, run.analysis_status), ("schedule_source_changed", "succeeded"))
                self.model.refresh_from_db()

    def test_interruption_preserves_completed_phases_and_no_replay(self):
        item, run = self.prepare()
        m.AiDingTalkScheduleRun.objects.filter(pk=run.id).update(status="sending", data_status="succeeded", analysis_status="succeeded", delivery_status="running")
        schedules.recover_interrupted()
        run.refresh_from_db()
        self.assertEqual((run.status, run.data_status, run.analysis_status, run.delivery_status), ("unknown", "succeeded", "succeeded", "unknown"))
