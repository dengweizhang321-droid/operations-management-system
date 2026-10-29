import hashlib
import secrets
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from . import models as m, output_schemas, skill_candidates, tests as domain
from . import pi_service as service, pi_worker as worker
from .model_capabilities import strict_schema_violations
from .pi_models import PiExport
from .policy import AiError, canonical, mutation, uid

TOOLS = ("get_pi_netshop_performance_page", "get_data_freshness")


class SkillCandidateTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user

    def settled(self, status="succeeded"):
        session = service.create_session(
            {"clientRequestId": secrets.token_hex(8)}, self.owner)["session"]["id"]
        service.prompt(session, {"clientRequestId": "p-1", "message": "task"}, self.owner)
        op = worker.claim()
        with mutation():
            op.capability_hash = hashlib.sha256(b"isolated").hexdigest()
            op.capability_expires_at = timezone.now() + timedelta(hours=1)
            op.status = status
            op.save()
        return op

    def export(self, op):
        with mutation():
            return PiExport.objects.create(
                id=uid("pi-export"), operation=op, request_digest="a" * 64,
                status="succeeded", query_json="{}",
                manifest_json=canonical({"dataset": "pi_netshop_promotion",
                                         "snapshotComplete": False, "warnings": []}))

    def content(self, **kwargs):
        value = {
            "goal": "answer one shop daily performance without this run numbers",
            "body": "check freshness, read per-shop netshop rows, summarise exceptions",
            "parameters": [{"name": "shop", "kind": "shop", "required": True,
                            "meaning": "exact shop name", "defaultRule": ""}],
            "steps": [{"order": 1, "action": "check data freshness",
                       "toolName": "get_data_freshness",
                       "missingDataBranch": "stop and report the gap"}],
            "requiredTools": list(TOOLS),
            "templateRefs": [],
            "sourceEvidenceRefs": [],
            "unverifiedRecommendations": ["raising the budget was never executed"],
            "openQuestions": ["threshold has no registered basis yet"],
        }
        value.update(kwargs)
        return value

    def body(self, **kwargs):
        resolved = output_schemas.resolve(skill_candidates.SCHEMA_REF)
        return {"schemaRef": skill_candidates.SCHEMA_REF,
                "schemaDigest": resolved["schemaDigest"],
                "content": self.content(**kwargs)}

    def test_registered_schema_satisfies_strict_mode(self):
        # P0-04's local check earns its place here: a registered schema that
        # cannot be sent with strict mode is a defect found now, not at the
        # provider after a paid call.
        resolved = output_schemas.resolve(skill_candidates.SCHEMA_REF)
        self.assertEqual(strict_schema_violations(resolved["schema"]), [])
        with self.assertRaises(AiError):
            output_schemas.resolve("no-such-schema")

    def test_request_names_the_run_and_what_it_may_cite(self):
        op = self.settled()
        export = self.export(op)
        request = skill_candidates.request_schema(op.id, self.owner)
        self.assertEqual(request["sourceOperationIds"], [op.id])
        self.assertIn(export.id, request["citableExportIds"])
        # Coverage travels with the request, so a gap belongs in the candidate's
        # open questions instead of being quietly dropped.
        self.assertIn("sourcesComplete", request["coverage"])

    def test_an_unsucceeded_run_cannot_be_distilled(self):
        for status in ("running", "failed", "unknown"):
            op = self.settled(status=status)
            with self.assertRaises(AiError):
                skill_candidates.request_schema(op.id, self.owner)

    def test_draft_is_stored_with_its_provenance_pinned(self):
        op = self.settled()
        self.export(op)
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        self.assertEqual((item["status"], item["version"]), ("draft", 1))
        self.assertIsNone(item["reviewedBy"])
        self.assertEqual(item["unverifiedRecommendations"], 1)
        self.assertTrue(item["reportVersionDigest"])
        self.assertEqual(m.AiSkillCandidate.objects.get(id=item["id"]).operation_id, op.id)
        # A second live distillation of the same run is refused, not merged.
        with self.assertRaises(AiError):
            skill_candidates.save(op.id, self.body(), self.owner, registry_tools=TOOLS)

    def test_a_stale_schema_digest_is_refused(self):
        op = self.settled()
        payload = self.body()
        payload["schemaDigest"] = "f" * 64
        with self.assertRaises(AiError):
            skill_candidates.save(op.id, payload, self.owner, registry_tools=TOOLS)
        self.assertEqual(m.AiSkillCandidate.objects.count(), 0)

    def test_unregistered_tools_and_foreign_sources_are_refused(self):
        op = self.settled()
        self.export(op)
        foreign = self.export(self.settled())
        for payload in (self.body(requiredTools=["run_arbitrary_sql"]),
                        self.body(sourceEvidenceRefs=[foreign.id])):
            with self.assertRaises(AiError):
                skill_candidates.save(op.id, payload, self.owner, registry_tools=TOOLS)
        self.assertEqual(m.AiSkillCandidate.objects.count(), 0)

    def test_content_must_match_the_registered_shape(self):
        op = self.settled()
        payload = self.body()
        payload["content"]["extra"] = "x"
        with self.assertRaises(AiError):
            skill_candidates.save(op.id, payload, self.owner, registry_tools=TOOLS)
        missing = self.body()
        del missing["content"]["steps"]
        with self.assertRaises(AiError):
            skill_candidates.save(op.id, missing, self.owner, registry_tools=TOOLS)

    def test_approval_binds_the_reviewed_content(self):
        op = self.settled()
        self.export(op)
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        # Approving against a digest the reviewer never saw is refused.
        with self.assertRaises(AiError):
            skill_candidates.review(item["id"], {
                "status": "approved", "expectedVersion": item["version"],
                "contentDigest": "e" * 64}, self.owner)
        approved = skill_candidates.review(item["id"], {
            "status": "approved", "expectedVersion": item["version"],
            "contentDigest": item["contentDigest"], "note": "ok"}, self.owner)["item"]
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(approved["reviewedBy"], self.owner.email.lower())
        # Terminal: no reopening and no second approval.
        for target in ("in_review", "approved", "rejected"):
            with self.assertRaises(AiError):
                skill_candidates.review(item["id"], {
                    "status": target, "expectedVersion": approved["version"],
                    "contentDigest": approved["contentDigest"]}, self.owner)

    def test_review_requires_the_seen_version(self):
        op = self.settled()
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        with self.assertRaises(AiError):
            skill_candidates.review(item["id"], {
                "status": "in_review", "expectedVersion": 99,
                "contentDigest": item["contentDigest"]}, self.owner)

    def test_another_account_sees_and_touches_nothing(self):
        op = self.settled()
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        self.assertEqual(skill_candidates.listing({}, self.other)["items"], [])
        with self.assertRaises(AiError):
            skill_candidates.review(item["id"], {
                "status": "approved", "expectedVersion": item["version"],
                "contentDigest": item["contentDigest"]}, self.other)
