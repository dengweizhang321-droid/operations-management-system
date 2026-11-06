"""Candidate steps validate registration without changing execution rights."""
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from . import (pi_gateway, skill_candidates, test_skill_candidates as candidates,
               tests as domain)
from .policy import AiError, canonical, digest, mutation, uid

TOOLS = candidates.TOOLS


class SkillCandidateStepToolTests(TestCase):
    # Reuse plain fixture functions without collecting the other test class.
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call
    setUp = candidates.SkillCandidateTests.setUp
    settled = candidates.SkillCandidateTests.settled
    export = candidates.SkillCandidateTests.export
    content = candidates.SkillCandidateTests.content
    body = candidates.SkillCandidateTests.body

    def step(self, tool, order=1):
        return {"order": order, "action": "读取数据", "toolName": tool,
                "missingDataBranch": "缺数就停下并报缺口"}

    def saved(self, **content_kwargs):
        op = self.settled()
        self.export(op)
        return skill_candidates.save(op.id, self.body(**content_kwargs),
                                     self.owner, registry_tools=TOOLS)["item"]

    def refused(self, **content_kwargs):
        op = self.settled()
        self.export(op)
        before = skill_candidates.m.AiSkillCandidate.objects.count()
        with self.assertRaises(AiError) as caught:
            skill_candidates.save(op.id, self.body(**content_kwargs),
                                  self.owner, registry_tools=TOOLS)
        self.assertEqual(skill_candidates.m.AiSkillCandidate.objects.count(), before)
        self.assertEqual((caught.exception.code, caught.exception.status),
                         ("invalid_request", 400))
        return caught.exception

    def test_unregistered_step_is_refused_without_requiredtools(self):
        error = self.refused(requiredTools=[], steps=[self.step("unregistered_tool_xyz")])
        self.assertIn("unregistered_tool_xyz", str(error))
        self.assertIn("steps[0].toolName", str(error))

    def test_registered_step_is_accepted_without_requiredtools(self):
        item = self.saved(requiredTools=[], steps=[self.step(TOOLS[0])])
        self.assertEqual(item["status"], "draft")
        self.assertEqual(item["content"]["steps"][0]["toolName"], TOOLS[0])

    def test_every_step_is_checked(self):
        steps = [self.step(TOOLS[0], 1), self.step(TOOLS[1], 2),
                 self.step("unregistered_tool_xyz", 3)]
        error = self.refused(requiredTools=[], steps=steps)
        self.assertIn("steps[2].toolName", str(error))

    def test_empty_and_omitted_step_tools_remain_acceptable(self):
        empty = self.step("")
        omitted = self.step("", 2)
        del omitted["toolName"]
        item = self.saved(requiredTools=[], steps=[empty, omitted])
        self.assertEqual(item["content"]["steps"], [empty, omitted])

    def test_non_string_tool_names_return_400(self):
        for value in (None, False, 0, 1, [], {}):
            with self.subTest(value=value):
                error = self.refused(requiredTools=[], steps=[self.step(value)])
                self.assertIn("steps[0].toolName", str(error))

    def test_malformed_steps_return_400(self):
        for value in (None, "get_data_freshness", {}, [None], ["get_data_freshness"]):
            with self.subTest(value=value):
                self.refused(requiredTools=[], steps=value)

    def test_steps_and_requiredtools_need_not_agree(self):
        item = self.saved(requiredTools=[TOOLS[0]], steps=[self.step(TOOLS[1])])
        self.assertEqual(item["content"]["requiredTools"], [TOOLS[0]])
        other = self.saved(requiredTools=list(TOOLS), steps=[])
        self.assertEqual(other["content"]["steps"], [])

    def test_requiredtools_keeps_its_original_rejection(self):
        for name in ("run_arbitrary_sql", ""):
            with self.subTest(name=name):
                error = self.refused(requiredTools=[name], steps=[])
                self.assertEqual(str(error), f"候选引用了未登记的工具：{name}")

    def test_step_membership_uses_the_supplied_catalog(self):
        op = self.settled()
        self.export(op)
        with self.assertRaises(AiError) as caught:
            skill_candidates.save(
                op.id, self.body(requiredTools=[], steps=[self.step(TOOLS[0])]),
                self.owner, registry_tools=(TOOLS[1],))
        self.assertEqual(caught.exception.status, 400)
        self.assertIn(TOOLS[0], str(caught.exception))

    def test_route_uses_registration_catalog_and_preserves_operation(self):
        # The second result is an execution subset. A registered name may
        # remain valid candidate text even when it is not executable now.
        for tool, expected in ((TOOLS[1], 201), ("unregistered_tool_xyz", 400)):
            with self.subTest(tool=tool):
                op = self.settled()
                self.export(op)
                before = skill_candidates.m.AiSkillCandidate.objects.count()
                with patch.object(pi_gateway, "catalog", return_value=(
                        [{"name": name} for name in TOOLS], [])) as catalog:
                    response = self.call(
                        f"/api/ai/pi/operations/{op.id}/skill-candidates",
                        self.body(requiredTools=[], steps=[self.step(tool)]), self.owner)
                self.assertEqual(response.status_code, expected, response.content)
                actor, operation = catalog.call_args[0]
                self.assertEqual((actor, operation.id), (self.owner, op.id))
                self.assertEqual(skill_candidates.m.AiSkillCandidate.objects.count(),
                                 before + int(expected == 201))

    def test_legacy_candidate_with_unknown_step_still_reads(self):
        op = self.settled()
        export = self.export(op)
        request = skill_candidates.request_schema(op.id, self.owner)
        legacy = self.content(steps=[self.step("retired_tool_xyz")],
                              sourceEvidenceRefs=[export.id])
        # Simulate the old save path with a complete INSERT. Candidate
        # content/provenance are immutable in PostgreSQL, even for drafts.
        now = timezone.now()
        with mutation(self.owner):
            skill_candidates.m.AiSkillCandidate.objects.create(
                id=uid("ai-candidate"), operation_id=op.id,
                owner_email=self.owner.email.lower(),
                report_version_digest=request["reportVersionDigest"],
                report_version_json=canonical(request["reportVersion"]),
                content_json=canonical(legacy), content_digest=digest(legacy),
                schema_ref=request["outputSchemaRef"],
                schema_digest=request["schemaDigest"],
                feedback_ids_json=canonical(request["confirmedFeedbackIds"]),
                unverified_count=len(legacy["unverifiedRecommendations"]),
                status="draft", reviewed_by="", reviewed_at=None, review_note="",
                version=1, created_at=now, updated_at=now)
        listed = skill_candidates.listing({}, self.owner)["items"]
        self.assertEqual(listed[0]["content"]["steps"], legacy["steps"])
        self.assertEqual(listed[0]["contentDigest"], digest(legacy))
        self.assertEqual(listed[0]["reportVersionDigest"], request["reportVersionDigest"])
        response = self.call("/api/ai/pi/skill-candidates", None,
                             self.owner, method="GET")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["items"][0]["content"]["steps"], legacy["steps"])
