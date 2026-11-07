from datetime import timedelta
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from . import models as m, workflows, workflow_timing
from . import tests as fixtures
from .policy import AiError

CATALOG = fixtures.CATALOG


class TimingWindowsTests(SimpleTestCase):
    def test_parallel_intervals_are_unioned_and_unknown_is_not_zero(self):
        start = timezone.now()
        end = start + timedelta(seconds=10)
        self.assertEqual(workflow_timing.union_milliseconds([
            (start, end), (start + timedelta(seconds=3), end + timedelta(seconds=2)),
        ]), 12000)
        self.assertIsNone(workflow_timing.milliseconds(start, None))
        self.assertIsNone(workflow_timing.milliseconds(end, start))


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class WorkflowTimingTests(TestCase):
    setUp = fixtures.AiDomainTests.setUp
    user = fixtures.AiDomainTests.user

    def create(self, suffix, *, human=False):
        nodes = [{"key": "first", "type": "agent", "instruction": "synthetic first"}]
        nodes.append({"key": "second", "type": "human_review" if human else "agent",
                      "instruction": "synthetic second", "dependsOn": ["first"]})
        return workflows.create({"clientRequestId": "timing-" + suffix, "name": "timing",
                                 "graph": {"nodes": nodes}}, self.owner, True)["item"]["id"]

    @staticmethod
    def response():
        return {"text": "synthetic result", "calls": [],
                "frame": {"role": "assistant", "content": "synthetic result"},
                "usage": {}, "providerRequestId": "fixture"}

    def test_completed_child_advances_next_node_without_extra_tick(self):
        with patch.object(workflows.transport, "catalog", return_value=CATALOG), \
                patch.object(workflows.provider, "turn", return_value=self.response()) as provider:
            run_id = self.create("advance")
            workflows.workflow_tick()
            first = m.AiWorkflowNodeRuns.objects.get(run_id=run_id, node_key="first")
            workflows.agent_tick(job_id=first.agent_job_id)
            workflows.workflow_tick()
            second = m.AiWorkflowNodeRuns.objects.get(run_id=run_id, node_key="second")
            self.assertEqual(second.status, "running")
            self.assertTrue(second.agent_job_id)
            self.assertEqual(provider.call_count, 1)  # Advancing does not call another model.
            workflows.agent_tick(job_id=second.agent_job_id)
            self.assertEqual(workflows.workflow_tick()["status"], "completed")
            self.assertEqual(workflows.workflow_tick()["status"], "idle")
            self.assertEqual(provider.call_count, 2)
            row = m.AiWorkflowRuns.objects.get(pk=run_id)
            timing = workflows.mapping(row)["timing"]
            self.assertEqual(len(timing["nodes"]), 2)
            self.assertFalse(timing["truncated"])
            self.assertFalse(timing["additive"])
            self.assertGreaterEqual(timing["wallMs"], 0)

    def test_same_tick_stops_at_human_review_and_cancel_does_not_advance(self):
        with patch.object(workflows.transport, "catalog", return_value=CATALOG), \
                patch.object(workflows.provider, "turn", return_value=self.response()) as provider:
            run_id = self.create("human", human=True)
            workflows.workflow_tick()
            first = m.AiWorkflowNodeRuns.objects.get(run_id=run_id, node_key="first")
            workflows.agent_tick(job_id=first.agent_job_id)
            self.assertEqual(workflows.workflow_tick()["status"], "waiting_review")
            self.assertEqual(workflows.workflow_tick()["status"], "idle")
            self.assertEqual(m.AiAgentJobs.objects.filter(workflow_run_id=run_id).count(), 1)
            self.assertEqual(provider.call_count, 1)
            row = m.AiWorkflowRuns.objects.get(pk=run_id)
            self.assertIsNone(workflows.mapping(row)["timing"]["humanReviewUnionMs"])
            workflows.control(run_id, {"expectedVersion": row.version}, self.owner, "cancel", True)
            self.assertEqual(workflows.workflow_tick()["status"], "idle")

    def test_inflight_dispatch_and_missing_timestamp_remain_unknown(self):
        with patch.object(workflows.transport, "catalog", return_value=CATALOG):
            run_id = self.create("unknown")
            workflows.workflow_tick()
            first = m.AiWorkflowNodeRuns.objects.get(run_id=run_id, node_key="first")
            job = m.AiAgentJobs.objects.get(pk=first.agent_job_id)
            m.AiAgentProviderDispatches.objects.create(
                id="timing-unknown-dispatch", job=job, dispatch_ordinal=1,
                owner_email=self.owner.email, actor_role=self.owner.role,
                model_id=job.model_id, model_version=job.model_version,
                tool_policy_digest=job.tool_policy_digest, request_digest="a" * 64,
                lease_epoch=1,
            )
            result = workflows.mapping(m.AiWorkflowRuns.objects.get(pk=run_id))["timing"]
            self.assertEqual(result["unknownDispatches"], 1)
            self.assertIsNone(result["providerDispatchUnionMs"])
            self.assertIsNone(result["wallMs"])

    def test_unknown_child_does_not_create_or_replay_successor(self):
        with patch.object(workflows.transport, "catalog", return_value=CATALOG), \
                patch.object(workflows.provider, "turn", side_effect=AiError(
                    "synthetic unavailable", "provider_unavailable", 503)) as provider:
            run_id = self.create("failed")
            workflows.workflow_tick()
            first = m.AiWorkflowNodeRuns.objects.get(run_id=run_id, node_key="first")
            workflows.agent_tick(job_id=first.agent_job_id)
            workflows.workflow_tick()
            workflows.workflow_tick()
            second = m.AiWorkflowNodeRuns.objects.get(run_id=run_id, node_key="second")
            self.assertIsNone(second.agent_job_id)
            self.assertEqual(provider.call_count, 1)
