"""Isolated PostgreSQL: real generic rows, synthetic content, no model call."""
from contextlib import contextmanager
import json
from unittest.mock import patch

from django import test as djtest
from django.db import DatabaseError, connection

from . import business_market_v2_active_synthetic as service
from . import business_market_v2_read_attestation as old_read
from . import models as m
from . import test_business_market_v2_execution_plan as fixture
from .policy import AiError, digest
from .test_business_market_v2_read_receipt_candidate import read_attestor


@contextmanager
def synthetic_attestor():
    with connection.cursor() as cursor:
        cursor.execute("SET SESSION AUTHORIZATION teruisi_ai_market_synthetic_attestor")
    try:
        yield
    finally:
        with connection.cursor() as cursor:
            cursor.execute("RESET SESSION AUTHORIZATION")


@djtest.override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class MarketV2SyntheticChainTests(djtest.TransactionTestCase):
    user = fixture.MarketV2ExecutionPlanTests.user
    request_body = fixture.MarketV2ExecutionPlanTests.request_body
    current_catalog = fixture.MarketV2ExecutionPlanTests.current_catalog
    create_fixed_report = fixture.MarketV2ExecutionPlanTests.create_fixed_report
    planned_evidence_body = fixture.MarketV2ExecutionPlanTests.planned_evidence_body
    selector = fixture.MarketV2ExecutionPlanTests.selector
    parked_id = fixture.MarketV2ExecutionPlanTests.parked_id
    _attest_as_role = staticmethod(fixture.MarketV2ExecutionPlanTests._attest_as_role)
    admitted = fixture.MarketV2ExecutionPlanTests.admitted
    setUp = fixture.MarketV2ExecutionPlanTests.setUp
    body = fixture.MarketV2ExecutionPlanTests.body
    create_plan = fixture.MarketV2ExecutionPlanTests.create_plan
    attested = fixture.MarketV2ExecutionPlanTests.attested
    prepared = fixture.MarketV2ExecutionPlanTests.prepared

    def source_plan(self):
        created, _, prepared = self.prepared()
        with djtest.override_settings(AI_MARKET_V2_EXECUTION_PLAN_ENABLED=True), \
                fixture.plan_attestor():
            saved = fixture.service.attest(created["reportId"], prepared["planJson"])
        return created, saved["planId"]

    def test_synthetic_chain_is_persisted_but_not_a_model_read(self):
        old, plan_id = self.source_plan()
        with djtest.override_settings(AI_MARKET_V2_SYNTHETIC_ENABLED=True), \
                synthetic_attestor(), patch("ai_assistant.provider.turn") as model:
            created = service.create(plan_id)
            model.assert_not_called()
        self.assertTrue(created["syntheticOnly"])
        self.assertFalse(created["externalProviderCalled"])
        self.assertFalse(created["persistedRead"])
        self.assertFalse(created["numericCitationAllowed"])
        self.assertEqual(created["paidCostCents"], 0)
        self.assertNotEqual(created["reportId"], old["reportId"])
        original = m.AiReportRun.objects.select_related("workflow").get(
            pk=old["reportId"])
        self.assertEqual(original.workflow.status, "paused")
        self.assertFalse(m.AiAgentJobs.objects.filter(
            workflow_run_id=original.workflow_id).exists())
        report = m.AiReportRun.objects.select_related("workflow").get(
            pk=created["reportId"])
        self.assertEqual(report.workflow.status, "paused")
        self.assertEqual(report.workflow.dry_run, 1)
        self.assertEqual(report.workflow.model_id, "market-v2-synthetic-only")
        self.assertEqual((report.workflow.version, report.workflow.mutation_token,
            report.workflow.cancel_requested, report.workflow.retryable,
            report.workflow.resume_count, report.workflow.attempt_count,
            report.workflow.lease_token, report.workflow.lease_epoch,
            report.workflow.error_message), (1,"",0,0,0,0,"",0,""))
        self.assertIsNotNone(report.workflow.next_run_at)
        self.assertIsNotNone(report.workflow.created_at)
        self.assertIsNotNone(report.workflow.updated_at)
        self.assertEqual(json.loads(report.snapshot_json)["syntheticRoot"]["planId"],
            plan_id)
        self.assertEqual(m.AiWorkflowNodeRuns.objects.filter(
            run_id=report.workflow_id).count(), 6)
        job = m.AiAgentJobs.objects.get(pk=created["jobId"])
        self.assertEqual(job.workflow_run_id, report.workflow_id)
        self.assertEqual(job.status, "paused")
        self.assertEqual((job.step_index,job.version,job.mutation_token,
            job.cancel_requested,job.retryable,job.resume_count,
            job.attempt_count,job.lease_token,job.lease_epoch,
            job.error_code,job.error_message),
            (0,1,"",0,0,0,0,"",1,"",""))
        self.assertIsNotNone(job.next_run_at)
        nodes = list(m.AiWorkflowNodeRuns.objects.filter(
            run_id=report.workflow_id))
        self.assertEqual(len(nodes),6)
        self.assertTrue(all(node.version==1 and node.mutation_token==""
            and node.input_json=="{}" and node.error_code==""
            and node.error_message=="" and node.created_at is not None
            and node.updated_at is not None for node in nodes))
        provider = m.AiAgentProviderDispatches.objects.get(
            pk=created["providerDispatchId"])
        tool = m.AiAgentToolDispatches.objects.get(pk=created["toolDispatchId"])
        self.assertEqual(provider.job_id, job.id)
        self.assertEqual(tool.job_id, job.id)
        self.assertEqual(tool.provider_dispatch_id, provider.id)
        self.assertEqual((provider.error_code,provider.error_message,
            tool.error_code,tool.error_message),("","","",""))
        self.assertTrue(all(value is not None for value in (
            provider.reserved_at,provider.provider_called_at,provider.completed_at,
            tool.reserved_at,tool.tool_called_at,tool.completed_at)))
        provider_result = m.AiAgentProviderResults.objects.get(dispatch_id=provider.id)
        tool_result = m.AiAgentToolResults.objects.get(tool_dispatch_id=tool.id)
        self.assertEqual(provider_result.response_digest,
            digest(provider_result.response_json))
        self.assertEqual(tool_result.result_digest,digest(tool_result.result_json))
        self.assertIsNotNone(provider_result.completed_at)
        self.assertIsNotNone(tool_result.completed_at)
        self.assertTrue(json.loads(provider_result.response_json)["syntheticOnly"])
        self.assertFalse(json.loads(tool_result.result_json)["data"]["persistedRead"])
        self.assertEqual(m.AiBusinessMarketV2ReadReceipt.objects.count(),0)
        with read_attestor(), self.assertRaises(DatabaseError):
            old_read.attest(tool.id)
        self.assertEqual(m.AiBusinessMarketV2ReadReceipt.objects.count(),0)

    def test_flag_role_and_duplicate_run_fail_closed(self):
        _, plan_id = self.source_plan()
        with self.assertRaises(AiError):
            service.create(plan_id)
        with djtest.override_settings(AI_MARKET_V2_SYNTHETIC_ENABLED=True), \
                self.assertRaises(AiError):
            service.create(plan_id)
        with djtest.override_settings(AI_MARKET_V2_SYNTHETIC_ENABLED=True), \
                synthetic_attestor():
            service.create(plan_id)
            with self.assertRaisesRegex(DatabaseError,
                    "ai_market_v2_synthetic_duplicate"):
                service.create(plan_id)
        self.assertEqual(m.AiBusinessMarketV2ReadReceipt.objects.count(),0)
