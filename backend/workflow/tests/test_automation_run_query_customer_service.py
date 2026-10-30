"""B3 read API extended to the 京东客服链: ``list_module_results`` must
report the customer-service evidence shape (``granularity: "pairing"``,
pairing counts) for a module result whose registered
``AutomationModule.domain == "customer_service"``, instead of forcing the
netshop batch shape (``date_min``/``date_max``-style fields) onto it.

Scope: query-layer only, mirrors test_automation_run_query.py's structure.
Does not touch the promotion-chain test file or its fixtures.
"""

from __future__ import annotations

from datetime import date

from django.test import TestCase

from customer_service.models import CustomerServiceImportBatch
from workflow.automation_models import AutomationLogicalRun, AutomationModule, AutomationModuleResult
from workflow.automation_run_query import list_module_results

CHAIN_KEY = "jd_customer_service"
SUBJECT_KEY = "jd-yiyong-director"
MODULE_KEY = "jd_customer_service.test_fixture_module"
DATASET = "customer_service"
SHOP_NAME = "志高商用设备旗舰店"


def make_module(module_key: str = MODULE_KEY) -> AutomationModule:
    return AutomationModule.objects.create(
        module_key=module_key,
        label="京东客服·会话 Excel",
        platform="京东",
        chain_key=CHAIN_KEY,
        domain="customer_service",
        dataset=DATASET,
        date_policy="rolling_30d",
        evidence_requirement="pairing",
    )


def make_run(plan_date: date = date(2026, 10, 30)) -> AutomationLogicalRun:
    return AutomationLogicalRun.objects.create(
        chain_key=CHAIN_KEY,
        subject_key=SUBJECT_KEY,
        plan_date=plan_date,
        business_range={"start": "2026-10-01", "end": "2026-10-30"},
        trigger_source="schedule",
        plan_summary={"modules": [MODULE_KEY]},
    )


def make_batch(
    *,
    batch_id: str,
    session_only_count: int = 0,
    chat_only_count: int = 0,
    ambiguous_count: int = 0,
) -> CustomerServiceImportBatch:
    return CustomerServiceImportBatch.objects.create(
        id=batch_id,
        shop_name=SHOP_NAME,
        session_file_name="session.xlsx",
        chat_file_name="chat.log",
        raw_file_hash="a" * 64,
        import_hash=f"import-{batch_id}",
        content_hash="b" * 64,
        identity_set_hash="c" * 64,
        scope_key=f"customer-service:{SHOP_NAME}",
        status="completed",
        conversation_count=100,
        matched_count=100 - session_only_count - chat_only_count - ambiguous_count,
        session_only_count=session_only_count,
        chat_only_count=chat_only_count,
        ambiguous_count=ambiguous_count,
    )


class CustomerServiceModuleResultEvidenceShapeTests(TestCase):
    def test_module_result_for_customer_service_domain_reports_pairing_granularity(self):
        make_module()
        batch = make_batch(batch_id="cs-batch-1", session_only_count=4, chat_only_count=1, ambiguous_count=2)
        run = make_run()
        AutomationModuleResult.objects.create(
            logical_run=run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-10-01..2026-10-30",
            business_state="partial",
            execution_state="finished",
            netshop_import_batch_id=batch.id,
        )
        payload = list_module_results(str(run.logical_run_id), page=1, page_size=10)
        item = payload["items"][0]
        self.assertEqual(item["evidence"]["granularity"], "pairing")
        self.assertEqual(item["evidence"]["pairing"]["sessionOnlyCount"], 4)
        self.assertEqual(item["evidence"]["pairing"]["chatOnlyCount"], 1)
        self.assertEqual(item["evidence"]["pairing"]["ambiguousCount"], 2)
        self.assertTrue(item["evidence"]["pairing"]["incomplete"])
        # The netshop-only field name must not leak into this domain's
        # response shape under its own name.
        self.assertNotIn("netshopImportBatchId", item["evidence"])
        self.assertEqual(item["evidence"]["customerServiceImportBatchId"], batch.id)

    def test_module_result_for_customer_service_domain_clean_pairing_reports_not_incomplete(self):
        make_module()
        batch = make_batch(batch_id="cs-batch-clean")
        run = make_run()
        AutomationModuleResult.objects.create(
            logical_run=run,
            module_key=MODULE_KEY,
            subject_key=SUBJECT_KEY,
            dataset=DATASET,
            date_range="2026-10-01..2026-10-30",
            business_state="verified",
            execution_state="finished",
            netshop_import_batch_id=batch.id,
        )
        payload = list_module_results(str(run.logical_run_id), page=1, page_size=10)
        item = payload["items"][0]
        self.assertFalse(item["evidence"]["pairing"]["incomplete"])

    def test_module_result_for_unregistered_module_key_falls_back_to_netshop_shape(self):
        """未登记的 module_key（defensive 分支）回退到 netshop 形态，
        不是静默报错——这是防御性分支，不代表正常路径会用到。"""
        run = make_run(plan_date=date(2026, 9, 11))
        AutomationModuleResult.objects.create(
            logical_run=run,
            module_key="jd_promotion.ad_product_daily",
            subject_key="jd-yiyong-director",
            dataset="ad",
            date_range="2026-09-11",
            business_state="verified",
            execution_state="finished",
        )
        payload = list_module_results(str(run.logical_run_id), page=1, page_size=10)
        item = payload["items"][0]
        self.assertEqual(item["evidence"]["granularity"], "batch")
