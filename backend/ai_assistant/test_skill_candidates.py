import hashlib
import secrets
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from . import (models as m, output_schemas, pi_gateway, prompt_settings,
               report_library, skill_candidates, tests as domain)
from . import pi_service as service, pi_worker as worker
from .model_capabilities import strict_schema_violations
from .pi_models import PiEvent, PiExport
from .policy import AiError, canonical, mutation, uid

TOOLS = ("get_pi_netshop_performance_page", "get_data_freshness")


class SkillCandidateTests(TestCase):
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call

    def setUp(self):
        domain.AiDomainTests.setUp(self)
        self.admin = self.user("candidate-admin@example.invalid", "admin", None)
        # A scoped admin (role == "admin" but scope is not None) is not an
        # unscoped admin. publish() (and report_library.save it delegates to)
        # must reject this principal the same way it rejects an owner or a
        # viewer -- the old admin() fixture across this codebase only ever
        # constructed scope=None, so this permission tier had no coverage.
        self.scoped_admin = self.user(
            "candidate-scoped-admin@example.invalid", "admin", self.owner.scope)

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
            # Release the session's active operation the way pi_worker does on
            # settle. Postgres enforces this binding (ai_pi_binding_guard): an
            # active operation must still be in flight, so leaving the pointer
            # on a succeeded row is rejected there even though sqlite allows it.
            if status not in {"queued", "running", "canceling", "unknown"}:
                session_row = op.session
                session_row.status, session_row.active_operation_id = "idle", ""
                session_row.save(update_fields=["status", "active_operation_id"])
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

    def approved(self, **content_kwargs):
        """A candidate taken all the way to approved, ready to publish."""
        op = self.settled()
        self.export(op)
        item = skill_candidates.save(op.id, self.body(**content_kwargs), self.owner,
                                     registry_tools=TOOLS)["item"]
        return skill_candidates.review(item["id"], {
            "status": "approved", "expectedVersion": item["version"],
            "contentDigest": item["contentDigest"]}, self.owner)["item"]

    # -- publish(): state machine --------------------------------------

    def test_only_approved_candidates_can_be_published(self):
        # expectedLibraryVersion must be present in every call here: leaving
        # it off makes fields() raise invalid_request/400 before the status
        # guard is ever reached, which would let this test pass green even if
        # the "only approved" check were deleted entirely.
        op = self.settled()
        draft = skill_candidates.save(op.id, self.body(), self.owner,
                                      registry_tools=TOOLS)["item"]
        with self.assertRaises(AiError) as caught:
            skill_candidates.publish(
                draft["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        self.assertEqual(caught.exception.status, 409)
        skill_candidates.review(draft["id"], {
            "status": "in_review", "expectedVersion": draft["version"],
            "contentDigest": draft["contentDigest"]}, self.owner)
        with self.assertRaises(AiError) as caught:
            skill_candidates.publish(
                draft["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        self.assertEqual(caught.exception.status, 409)
        rejected_op = self.settled()
        self.export(rejected_op)
        rejected = skill_candidates.save(rejected_op.id, self.body(), self.owner,
                                         registry_tools=TOOLS)["item"]
        rejected = skill_candidates.review(rejected["id"], {
            "status": "rejected", "expectedVersion": rejected["version"],
            "contentDigest": rejected["contentDigest"]}, self.owner)["item"]
        with self.assertRaises(AiError) as caught:
            skill_candidates.publish(
                rejected["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0},
                self.admin)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(m.AiLibraryRevision.objects.count(), 0)

    def test_publishing_twice_is_refused_not_silently_overwritten(self):
        item = self.approved()
        first = skill_candidates.publish(
            item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        self.assertEqual(first["library"]["version"], 1)
        with self.assertRaises(AiError) as caught:
            skill_candidates.publish(
                item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 1}, self.admin)
        self.assertEqual(caught.exception.status, 409)

    def test_publish_cas_rejects_a_stale_library_version(self):
        item = self.approved()
        with self.assertRaises(AiError) as caught:
            skill_candidates.publish(
                item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 99}, self.admin)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(m.AiLibraryRevision.objects.count(), 0)

    # -- publish(): permissions ------------------------------------------

    def test_publish_requires_unscoped_admin_not_owner_or_viewer(self):
        item = self.approved()
        for actor in (self.owner, self.viewer, self.other):
            with self.assertRaises(AiError) as caught:
                skill_candidates.publish(
                    item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, actor)
            self.assertEqual(caught.exception.status, 403)

    def test_scoped_admin_cannot_publish(self):
        # role == "admin" but scope is not None: current_principal(admin=True)
        # must reject this the same as any other non-unscoped-admin principal.
        item = self.approved()
        with self.assertRaises(AiError) as caught:
            skill_candidates.publish(
                item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0},
                self.scoped_admin)
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(m.AiLibraryRevision.objects.count(), 0)

    def test_admin_can_publish_a_candidate_it_does_not_own(self):
        # publish() is deliberately not owner-gated: an admin reviewing
        # someone else's approved candidate must still be able to publish it.
        item = self.approved()
        self.assertNotEqual(self.owner.email.lower(), self.admin.email.lower())
        published = skill_candidates.publish(
            item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        self.assertEqual(published["library"]["version"], 1)

    # -- publish(): domains / keywords -----------------------------------

    def test_domains_must_be_registered_and_non_empty_and_unique(self):
        item = self.approved()
        for domains in ([], ["not-a-real-domain"], ["netshop", "netshop"],
                         list(prompt_settings.DOMAINS) + ["sales"]):
            with self.assertRaises(AiError) as caught:
                skill_candidates.publish(
                    item["id"], {"domains": domains, "expectedLibraryVersion": 0}, self.admin)
            self.assertEqual(caught.exception.status, 400)
        self.assertEqual(m.AiLibraryRevision.objects.count(), 0)

    def published_skill(self, published, candidate_id):
        # DEFAULTS already ships a "shop-diagnosis" skill with domains ==
        # ["netshop"], so filtering by domains collides with it; the slug
        # publish() derives from the candidate id is the only stable key.
        # Computed via the module's own helper rather than re-deriving the
        # format here, so this test does not silently stop matching if that
        # derivation ever changes again.
        row = m.AiSkillCandidate.objects.get(id=candidate_id)
        slug = skill_candidates._slug_from_candidate(row)
        return next(s for s in published["library"]["config"]["skills"] if s["id"] == slug)

    def test_keywords_default_to_alias_round_robin_across_domains(self):
        item = self.approved()
        published = skill_candidates.publish(
            item["id"], {"domains": ["netshop", "inventory"], "expectedLibraryVersion": 0},
            self.admin)
        skill = self.published_skill(published, item["id"])
        # Round robin: the first word of each domain's ALIASES tuple appears
        # before either domain's second word.
        self.assertEqual(skill["keywords"][0], prompt_settings.ALIASES["netshop"][0])
        self.assertEqual(skill["keywords"][1], prompt_settings.ALIASES["inventory"][0])
        self.assertLessEqual(len(skill["keywords"]), skill_candidates.MAX_KEYWORDS)
        # Never just the bare domain label alone driving selection: a keyword
        # list that happened to start with the label is fine, what matters is
        # it also carries the non-label aliases a real question would use.
        self.assertTrue(set(skill["keywords"]) - {"网店", "库存"})

    def test_explicit_keywords_in_the_request_override_the_default(self):
        item = self.approved()
        published = skill_candidates.publish(
            item["id"], {"domains": ["netshop"], "keywords": ["自定义触发词"],
                         "expectedLibraryVersion": 0}, self.admin)
        skill = self.published_skill(published, item["id"])
        self.assertEqual(skill["keywords"], ["自定义触发词"])

    def test_domain_with_no_aliases_and_no_explicit_keywords_is_refused(self):
        # Every registered domain currently has ALIASES, so this exercises the
        # explicit guard rather than a reachable production domain.
        with patch.dict(prompt_settings.ALIASES, {"netshop": ()}):
            item = self.approved()
            with self.assertRaises(AiError) as caught:
                skill_candidates.publish(
                    item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0},
                    self.admin)
            self.assertEqual(caught.exception.status, 400)

    # -- publish(): end to end with guidance() ----------------------------

    def test_goal_with_leading_whitespace_past_the_slice_still_publishes(self):
        # _validate_content's own text() check strips before measuring length,
        # but the stored content keeps the raw, unstripped goal (canonical()
        # does not strip). A goal padded with >80 leading spaces then slices
        # down to pure whitespace for name/description, which
        # report_library.validate_item()'s text() strips to "" and rejects --
        # with an error that names "名称", a field the publish caller never
        # passed. Regression guard for exactly that: publish() must strip
        # before slicing, not slice before stripping.
        padded_goal = (" " * 100) + "diagnose one shop's daily netshop performance"
        item = self.approved(goal=padded_goal)
        published = skill_candidates.publish(
            item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        skill = self.published_skill(published, item["id"])
        self.assertTrue(skill["name"])
        self.assertFalse(skill["name"].startswith(" "))
        self.assertIn("diagnose one shop", skill["name"])

    def test_published_skill_is_actually_selected_by_guidance(self):
        item = self.approved(goal="diagnose one shop's daily netshop performance")
        skill_candidates.publish(
            item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        snapshot = report_library.snapshot()
        tools = [{"name": "get_netshop_performance", "allowedSurfaces": ["pi_agent"]}]
        prompt, evidence = report_library.guidance(
            "京东店铺今天的转化怎么样", None, tools, library=snapshot)
        row = m.AiSkillCandidate.objects.get(id=item["id"])
        published_id = skill_candidates._slug_from_candidate(row)
        self.assertIn(published_id, [s["id"] for s in evidence["skills"]])
        self.assertIn(item["content"]["body"], prompt)

    def test_event_is_written_through_pi_service_event_not_hand_rolled(self):
        # Regression guard for the exact defect task_feedback._event() had on
        # this same branch point: computing event_seq by hand (instead of
        # through pi_service.event(), which increments session.event_seq)
        # leaves the session's counter stale. The next event on that session
        # would then collide on the (session, event_seq) unique constraint.
        item = self.approved()
        op = m.AiSkillCandidate.objects.get(id=item["id"]).operation
        session_before = op.session.event_seq
        skill_candidates.publish(
            item["id"], {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        op.session.refresh_from_db()
        self.assertEqual(op.session.event_seq, session_before + 1)
        # A second, unrelated event on the same session must not collide.
        service.event(op.session, "synthetic_followup", {})
        self.assertEqual(
            PiEvent.objects.filter(session=op.session).values_list("event_seq", flat=True)
            .distinct().count(),
            PiEvent.objects.filter(session=op.session).count())

    # -- routing: 4 endpoints on pi_views.dispatch ------------------------

    def test_save_route_passes_this_operations_catalog_to_save(self):
        op = self.settled()
        self.export(op)
        body = self.body()
        with patch.object(skill_candidates, "save", return_value={"item": {}}) as save, \
             patch.object(pi_gateway, "catalog", return_value=([], [])) as catalog:
            response = self.call(f"/api/ai/pi/operations/{op.id}/skill-candidates",
                                  body, self.owner)
            self.assertEqual(response.status_code, 201, response.content)
            # The regression this guards: a prior implementation's test only
            # asserted the *return value* of a fully-replaced catalog(), which
            # cannot detect a caller passing the wrong (or no) operation. This
            # asserts the actual call arguments instead.
            self.assertEqual(catalog.call_count, 1)
            called_principal, called_operation = catalog.call_args[0]
            self.assertEqual(called_operation.id, op.id)
            save.assert_called_once()
            self.assertEqual(save.call_args[0][0], op.id)
            self.assertEqual(save.call_args[1]["registry_tools"], set())

    def test_save_route_rejects_an_operation_the_caller_does_not_own(self):
        # self.other does not own op; the route's own ownership check (ahead
        # of skill_candidates.save()'s internal one) must reject before ever
        # calling the gateway.
        op = self.settled()
        with patch.object(pi_gateway, "catalog") as catalog:
            response = self.call(f"/api/ai/pi/operations/{op.id}/skill-candidates",
                                  self.body(), self.other)
            self.assertEqual(response.status_code, 404)
            catalog.assert_not_called()

    def test_listing_route(self):
        op = self.settled()
        self.export(op)
        skill_candidates.save(op.id, self.body(), self.owner, registry_tools=TOOLS)
        response = self.call("/api/ai/pi/skill-candidates", None, self.owner, method="GET")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["returned"], 1)

    def test_review_route(self):
        op = self.settled()
        self.export(op)
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        response = self.call(
            f"/api/ai/pi/skill-candidates/{item['id']}/review",
            {"status": "approved", "expectedVersion": item["version"],
             "contentDigest": item["contentDigest"]}, self.owner)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["item"]["status"], "approved")

    def test_publish_route(self):
        item = self.approved()
        response = self.call(
            f"/api/ai/pi/skill-candidates/{item['id']}/publish",
            {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["library"]["version"], 1)

    def test_unknown_action_segment_and_extra_segment_are_404(self):
        item = self.approved()
        body = {"domains": ["netshop"], "expectedLibraryVersion": 0}
        for path in (f"/api/ai/pi/skill-candidates/{item['id']}/no-such-action",
                     f"/api/ai/pi/skill-candidates/{item['id']}/publish/extra"):
            response = self.call(path, body, self.admin)
            self.assertEqual(response.status_code, 404, (path, response.content))

    def test_nonexistent_candidate_id_is_404_not_500(self):
        response = self.call(
            "/api/ai/pi/skill-candidates/ai-candidate-does-not-exist/publish",
            {"domains": ["netshop"], "expectedLibraryVersion": 0}, self.admin)
        self.assertEqual(response.status_code, 404, response.content)

    def test_wrong_method_on_skill_candidates_listing_is_404(self):
        response = self.call("/api/ai/pi/skill-candidates", {}, self.owner, method="POST")
        self.assertEqual(response.status_code, 404, response.content)
    # -- review_note is byte-limited, matching the database's
    # octet_length(review_note)<=2000 CHECK (migration 0089). sqlite test
    # databases never install that CHECK, so these tests only prove the
    # application rejects an overlong note before it would ever reach the
    # database.

    def test_review_note_at_666_chinese_characters_1998_bytes_is_accepted(self):
        op = self.settled()
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        note = "审" * 666
        self.assertEqual(len(note.encode("utf-8")), 1998)
        approved = skill_candidates.review(item["id"], {
            "status": "approved", "expectedVersion": item["version"],
            "contentDigest": item["contentDigest"], "note": note}, self.owner)["item"]
        self.assertEqual(approved["reviewNote"], note)

    def test_review_note_at_667_chinese_characters_2001_bytes_is_rejected_as_400(self):
        # 667 * 3 = 2001 bytes, over the 2000-byte CHECK, from only 667
        # characters -- text()'s character count (maximum=2000) would have
        # allowed this.
        op = self.settled()
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        note = "审" * 667
        self.assertEqual(len(note.encode("utf-8")), 2001)
        with self.assertRaises(AiError) as caught:
            skill_candidates.review(item["id"], {
                "status": "approved", "expectedVersion": item["version"],
                "contentDigest": item["contentDigest"], "note": note}, self.owner)
        self.assertEqual(caught.exception.status, 413)
        # The rejected review must not have landed: still draft.
        self.assertEqual(m.AiSkillCandidate.objects.get(id=item["id"]).status, "draft")

    def test_review_note_at_exactly_2000_bytes_is_accepted(self):
        # Pins the upper edge itself, not just a value 2 bytes under it: pure
        # Chinese text can only land on multiples of 3 (2000 % 3 == 2), so a
        # mixed-width note is needed to hit the boundary exactly, the same way
        # targetRef's mixed-width test does.
        op = self.settled()
        item = skill_candidates.save(op.id, self.body(), self.owner,
                                     registry_tools=TOOLS)["item"]
        note = ("审" * 666) + "xy"
        self.assertEqual(len(note.encode("utf-8")), 2000)
        approved = skill_candidates.review(item["id"], {
            "status": "approved", "expectedVersion": item["version"],
            "contentDigest": item["contentDigest"], "note": note}, self.owner)["item"]
        self.assertEqual(approved["reviewNote"], note)
