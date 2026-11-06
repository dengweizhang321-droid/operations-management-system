"""The read half of skill-candidate distillation: GET on the create path.

skill_candidates.request_schema() existed with no route at all, so a caller
could not obtain the schemaRef/schemaDigest pair -- nor the citable evidence
ids -- that the POST on the same path requires. These tests pin the new GET
branch (pi_views.py:82-94) and, above all, that what the GET hands back is
sufficient to build a POST the server accepts.
"""
from unittest.mock import patch

from django.test import TestCase, override_settings

from sales.tests.factories import signed_headers, TEST_SECRET

from . import (output_schemas, pi_gateway, pi_sources, skill_candidates,
               test_skill_candidates as candidates, tests as domain)
from .policy import AiError, revision

TOOLS = candidates.TOOLS


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class SkillCandidateSchemaRouteTests(TestCase):
    # Borrowed rather than re-written: the operation/export fixtures are the
    # ones the create path is already tested against, so a GET proven to feed
    # that POST is proven against the same shapes.
    # Each attribute is a plain function taken off the other class, never the
    # class itself: binding `SkillCandidateTests` to a module-level name here
    # would make the loader collect and re-run all 34 of its tests under this
    # module too, inflating the count without testing anything new.
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call
    setUp = candidates.SkillCandidateTests.setUp
    settled = candidates.SkillCandidateTests.settled
    export = candidates.SkillCandidateTests.export
    content = candidates.SkillCandidateTests.content
    body = candidates.SkillCandidateTests.body

    def path(self, operation_id):
        return f"/api/ai/pi/operations/{operation_id}/skill-candidates"

    def get(self, operation_id, principal=None, query=""):
        if not query:
            return self.call(self.path(operation_id), None,
                             principal or self.owner, method="GET")
        # AiDomainTests.call signs an empty query string, so a GET that is
        # meant to carry one has to be signed over the full URL instead --
        # otherwise the 400 under test would be masked by a 401.
        actor = principal or self.owner
        url = self.path(operation_id) + query
        with patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET}), \
             override_settings(DJANGO_INTERNAL_SECRET=TEST_SECRET):
            return self.client.get(url, headers=signed_headers(
                url, email=actor.email, role=actor.role, scope=actor.scope))

    # -- the route exists and returns the dispatch contract ----------------

    def test_get_returns_the_schema_and_the_citable_evidence(self):
        op = self.settled()
        export = self.export(op)
        response = self.get(op.id)
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload["purpose"], "skill_candidate")
        self.assertEqual(payload["outputSchemaRef"], skill_candidates.SCHEMA_REF)
        self.assertEqual(payload["schemaDigest"],
                         output_schemas.resolve(skill_candidates.SCHEMA_REF)["schemaDigest"])
        self.assertEqual(payload["outputSchema"],
                         output_schemas.CATALOG[skill_candidates.SCHEMA_REF])
        self.assertEqual(payload["sourceOperationIds"], [op.id])
        self.assertIn(export.id, payload["citableExportIds"])
        self.assertIn("sourcesComplete", payload["coverage"])
        self.assertTrue(payload["reportVersionDigest"])

    def test_get_is_a_read_and_writes_nothing(self):
        # A "read outlet" that bumped the AI data revision would not be one.
        op = self.settled()
        self.export(op)
        before = int(revision())
        self.assertEqual(self.get(op.id).status_code, 200)
        self.assertEqual(int(revision()), before)

    def test_get_rejects_stray_query_parameters(self):
        # request_schema() calls pi_sources.evidence() with a hardcoded {},
        # so without the view's own fields() check an unknown filter would be
        # silently ignored rather than refused.
        op = self.settled()
        self.export(op)
        response = self.get(op.id, query="?status=approved")
        self.assertEqual(response.status_code, 400, response.content)

    def test_get_on_an_unsucceeded_run_is_409(self):
        for status in ("running", "failed", "unknown"):
            op = self.settled(status=status)
            response = self.get(op.id)
            self.assertEqual(response.status_code, 409, (status, response.content))

    # -- ownership and the writer-only gate -------------------------------

    def test_get_for_an_operation_the_caller_does_not_own_is_404(self):
        op = self.settled()
        self.export(op)
        response = self.get(op.id, self.other)
        self.assertEqual(response.status_code, 404, response.content)
        # The 404 comes from the ownership check, not from the route being
        # absent: the same path and principal pair succeeds for the owner.
        self.assertEqual(self.get(op.id).status_code, 200)

    def test_a_viewer_cannot_reach_any_run_through_this_get(self):
        # current_principal(write=False) lets a viewer past the role gate on
        # every Pi GET, which is why ownership has to be the real barrier
        # here. A viewer can never own a Pi session (create_session is a
        # write), so there is no operation this GET can hand them.
        op = self.settled()
        self.export(op)
        response = self.get(op.id, self.viewer)
        self.assertEqual(response.status_code, 404, response.content)

    def test_get_is_refused_outside_the_ai_writer_process(self):
        op = self.settled()
        self.export(op)
        with override_settings(DJANGO_PROCESS_ROLE="ai_reader"), \
             patch("ai_assistant.views.authority"):
            response = self.get(op.id)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "access_denied")

    def test_what_the_get_discloses_is_a_subset_of_the_evidence_route(self):
        # Permission rationale, asserted rather than argued: every non-static
        # value in the dispatch contract already reaches this same principal
        # through GET pi/operations/<id>/evidence, which carries the identical
        # gate. So the schema outlet needs no stricter tier of its own.
        op = self.settled()
        export = self.export(op)
        payload = self.get(op.id).json()
        evidence = pi_sources.evidence(op.id, {}, self.owner)
        self.assertEqual(payload["reportVersion"], evidence["reportVersion"])
        self.assertEqual(payload["reportVersionDigest"], evidence["reportVersionDigest"])
        self.assertEqual(payload["coverage"], evidence["coverage"])
        self.assertEqual(payload["confirmedFeedbackIds"],
                         evidence["reportVersion"]["confirmedFeedbackIds"])
        self.assertEqual(payload["citableExportIds"],
                         [item["exportId"] for item in evidence["sources"]])
        self.assertEqual(payload["citableFileIds"],
                         [item["fileId"] for item in evidence["artifacts"]])
        self.assertIn(export.id, payload["citableExportIds"])
        # Nothing beyond those, plus the static catalog entry, is disclosed.
        self.assertEqual(set(payload) - {
            "purpose", "outputSchemaRef", "schemaVersion", "schemaDigest",
            "outputSchema", "sourceOperationIds", "confirmedFeedbackIds",
            "citableExportIds", "citableFileIds", "reportVersion",
            "reportVersionDigest", "coverage"}, set())

    # -- the outlet and the inlet are a matched pair ----------------------

    def test_the_schema_this_get_returns_builds_an_accepted_create_request(self):
        """The point of the whole change: a caller holding only this GET's
        response can assemble a POST the create route accepts.

        Every value the POST needs is taken from the GET payload -- the schema
        reference, the digest the dispatch is pinned to, the content shape, and
        the evidence ids it may cite. Nothing is hardcoded from the module.
        """
        op = self.settled()
        export = self.export(op)
        dispatch = self.get(op.id).json()
        schema = dispatch["outputSchema"]

        # Build the content from the returned schema's own required list, so a
        # schema field added without updating the dispatch contract fails here.
        self.assertEqual(set(schema["required"]), {
            "goal", "body", "parameters", "steps", "requiredTools",
            "templateRefs", "sourceEvidenceRefs", "unverifiedRecommendations",
            "openQuestions"})
        content = {
            "goal": "回答单店日常表现，不含本次具体数值",
            "body": "先核数据水位，再读分店网店行，最后汇总异常",
            "parameters": [],
            "steps": [{"order": 1, "action": "核对数据水位",
                       "toolName": TOOLS[1],
                       "missingDataBranch": "缺数就停下并报缺口"}],
            "requiredTools": list(TOOLS),
            "templateRefs": [],
            # Straight from the GET: the create route refuses any reference
            # outside this run (skill_candidates.py:111-113).
            "sourceEvidenceRefs": dispatch["citableExportIds"],
            "unverifiedRecommendations": ["提高预算这条报告里没有执行过"],
            "openQuestions": ["阈值尚无登记依据"],
        }
        self.assertEqual(set(content), set(schema["properties"]))
        self.assertIn(export.id, content["sourceEvidenceRefs"])

        payload = {"schemaRef": dispatch["outputSchemaRef"],
                   "schemaDigest": dispatch["schemaDigest"],
                   "content": content}
        with patch.object(pi_gateway, "catalog",
                          return_value=([{"name": name} for name in TOOLS], [])):
            created = self.call(self.path(op.id), payload, self.owner)
        self.assertEqual(created.status_code, 201, created.content)
        item = created.json()["item"]
        self.assertEqual((item["status"], item["operationId"]), ("draft", op.id))
        # The candidate is pinned to the same report version the GET named.
        self.assertEqual(item["reportVersionDigest"], dispatch["reportVersionDigest"])
        self.assertEqual(item["schemaDigest"], dispatch["schemaDigest"])
        self.assertEqual(item["content"]["sourceEvidenceRefs"],
                         dispatch["citableExportIds"])

    def test_a_create_request_built_without_the_get_is_refused(self):
        # The negative half of the pair: guessing the digest, or citing an id
        # the GET never listed, is exactly what the create route rejects --
        # which is why the GET is the only way in.
        op = self.settled()
        self.export(op)
        dispatch = self.get(op.id).json()
        guessed = self.body()
        guessed["schemaDigest"] = "f" * 64
        with self.assertRaises(AiError):
            skill_candidates.save(op.id, guessed, self.owner, registry_tools=TOOLS)
        foreign = self.export(self.settled())
        self.assertNotIn(foreign.id, dispatch["citableExportIds"])
        with self.assertRaises(AiError):
            skill_candidates.save(op.id, self.body(sourceEvidenceRefs=[foreign.id]),
                                  self.owner, registry_tools=TOOLS)

    # -- the GET must not displace its neighbours -------------------------

    def test_neighbouring_shapes_and_methods_are_unchanged(self):
        op = self.settled()
        self.export(op)
        # A fifth segment is not the schema outlet.
        self.assertEqual(self.get(op.id, query="").status_code, 200)
        for suffix in ("/extra", "/review"):
            response = self.call(self.path(op.id) + suffix, None, self.owner,
                                 method="GET")
            self.assertEqual(response.status_code, 404, (suffix, response.content))
        # The sibling evidence GET on the same operation still answers.
        self.assertEqual(
            self.call(f"/api/ai/pi/operations/{op.id}/evidence", None, self.owner,
                      method="GET").status_code, 200)
