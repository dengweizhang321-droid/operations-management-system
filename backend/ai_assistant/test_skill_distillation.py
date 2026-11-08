import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import capability_probes, output_schemas, provider, report_library, skill_candidates, task_feedback, test_skill_candidates as fixtures
from .pi_models import PiDispatch, PiEvent
from .pi_service import event
from .policy import AiError, canonical, mutation, revision
from . import test_skill_candidate_schema_route as schema_fixtures

REAL_PROVIDER_TURN = provider.turn


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class DistillationTests(TestCase):
    path = schema_fixtures.SkillCandidateSchemaRouteTests.path
    get = schema_fixtures.SkillCandidateSchemaRouteTests.get
    user = fixtures.SkillCandidateTests.user
    call = fixtures.SkillCandidateTests.call
    settled = fixtures.SkillCandidateTests.settled
    content = fixtures.SkillCandidateTests.content
    export = fixtures.SkillCandidateTests.export

    def setUp(self):
        fixtures.SkillCandidateTests.setUp(self)
        self.model.generation_options_json = canonical({"structuredOutputSupport": "json_schema"})
        self.model.last_test_result = canonical({
            "kind": "provider-capabilities-v1", "fingerprint": capability_probes.fingerprint(self.model),
            "adapterVersion": capability_probes.PROVIDER_ADAPTER_VERSION,
            "structuredOutput": {"status": "passed", "schemaDigest": output_schemas.resolve(skill_candidates.SCHEMA_REF)["schemaDigest"]},
        })
        self.model.save()
        self.op = self.settled()
        self.export(self.op)
        with mutation():
            self.op.session.refresh_from_db()
            event(self.op.session, "assistant_message", {"text": "来源显示缺少库存，需复核"}, self.op)
        self.correction = self.correct("先核实 ERP 日期")
        self.version = skill_candidates.request_schema(self.op.id, self.owner)["reportVersionDigest"]
        self.reply = {"text": canonical(self.content()), "calls": [], "truncated": False,
                      "usage": {"completion_tokens": 200}, "providerRequestId": "p1"}
        entries = [{"name": name} for name in fixtures.TOOLS]
        self.enterContext(patch("ai_assistant.pi_gateway.catalog", return_value=(entries, entries)))
        self.turn = self.enterContext(patch("ai_assistant.provider.turn", return_value=self.reply))

    def correct(self, value):
        return task_feedback.save(self.op.id, {"targetKind": "section", "targetRef": value,
            "newValue": value, "confirmed": True}, self.owner)["item"]

    def submit(self, key="request1", principal=None, version=None):
        path = f"/api/ai/pi/operations/{self.op.id}/skill-candidates/distill"
        return self.call(path, {"clientRequestId": key, "reportVersionDigest": version or self.version},
                         principal or self.owner)

    def test_finished_report_becomes_one_traceable_draft(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.content)
        candidate = response.json()["item"]
        self.assertEqual(candidate["status"], "draft")
        self.assertEqual(candidate["feedbackIds"], [self.correction["id"]])
        self.assertEqual(candidate["reportVersionDigest"], self.version)
        prompt = json.loads(self.turn.call_args.args[1][0]["content"])
        self.assertEqual(prompt["corrections"][0]["value"], "先核实 ERP 日期")
        self.assertIn("缺少库存", prompt["report"])
        self.assertTrue(prompt["sources"])
        self.assertEqual(self.turn.call_args.args[3], [])
        self.assertEqual(self.turn.call_args.kwargs["structured_output"]["name"], "skill-candidate-v1")
        self.assertEqual(self.submit().json()["item"]["id"], candidate["id"])
        self.assertEqual(self.submit("another").status_code, 409)
        self.turn.assert_called_once()

    def publication(self, query, principal):
        url = "/api/ai/pi/skill-candidates?" + query
        secret = schema_fixtures.TEST_SECRET
        with patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": secret}), override_settings(DJANGO_INTERNAL_SECRET=secret):
            return self.client.get(url, headers=schema_fixtures.signed_headers(
                url, email=principal.email, role=principal.role, scope=principal.scope))

    def test_synthetic_report_review_publish_guidance_and_disable_keep_original_versions(self):
        draft = self.submit().json()["item"]
        candidate_id = draft["id"]
        route = f"/api/ai/pi/skill-candidates/{candidate_id}"
        tools = [{"name": "get_netshop_performance"}]
        question = "合成测试触发词"
        self.assertEqual(self.publication("publicationPage=1", self.admin).json()["items"], [])
        self.assertEqual(report_library.guidance(question, None, tools)[1]["skills"], [])
        approved = self.call(route + "/review", {"status": "approved", "expectedVersion": draft["version"],
            "contentDigest": draft["contentDigest"], "note": "synthetic human approval"}, self.owner).json()["item"]
        for actor in (self.owner, self.other, self.scoped_admin, self.viewer):
            self.assertEqual(self.publication("publicationPage=1", actor).status_code, 403)
            self.assertEqual(self.publication("publicationId=" + candidate_id, actor).status_code, 403)
        before = self.publication("publicationPage=1", self.admin).json()["items"][0]
        self.assertEqual(before["publication"]["state"], "unpublished")
        self.assertEqual(before["reportVersionDigest"], self.version)
        self.assertEqual(before["reviewedBy"], self.owner.email)
        self.assertNotIn("content", before)
        payload = {"expectedVersion": approved["version"], "contentDigest": approved["contentDigest"],
                   "expectedLibraryVersion": 0, "domains": ["netshop"], "keywords": [question]}
        for changed in ({"expectedVersion": draft["version"]}, {"contentDigest": "d" * 64}, {"expectedLibraryVersion": 7}):
            self.assertEqual(self.call(route + "/publish", {**payload, **changed}, self.admin).status_code, 409)
        result = self.call(route + "/publish", payload, self.admin)
        self.assertEqual(result.status_code, 200, result.content)
        published = result.json()["publication"]
        self.assertEqual((published["state"], published["publishedLibraryVersion"]), ("enabled", 1))
        self.assertEqual(self.publication("publicationId=" + candidate_id, self.admin).json()["items"][0]["publication"], published)
        self.assertEqual(self.get(self.op.id, query="?includeDistillations=1").json()["distillation"]["candidate"]["publication"], published)
        self.assertEqual(self.call(route + "/publish", payload, self.admin).json()["publication"], published)
        self.assertEqual(self.call(route + "/publish", {**payload, "keywords": ["another"]}, self.admin).status_code, 409)
        events = PiEvent.objects.filter(operation=self.op, event_type=skill_candidates.PUBLICATION_EVENT)
        self.assertEqual(events.count(), 1)
        receipt = json.loads(events.get().data_json)
        self.assertEqual((receipt["candidateVersion"], receipt["contentDigest"], receipt["reportVersionDigest"]),
                         (approved["version"], approved["contentDigest"], self.version))
        self.assertEqual(report_library.snapshot()["version"], 1)
        skill = next(item for item in report_library.snapshot()["config"]["skills"] if item["id"] == published["skillId"])
        self.assertEqual(skill["body"], before["method"]["body"])
        with mutation(self.admin):
            frozen = report_library.pin("w11a-frozen", question, None, tools)
        self.assertEqual(frozen["skills"]["skills"][0]["id"], skill["id"])
        generic = {"kind": "skills", "expectedVersion": 1}
        self.assertEqual(self.call("/api/ai/report-library", {**generic, "item": {**skill, "body": "rewritten"}}, self.admin).status_code, 409)
        self.assertEqual(self.call("/api/ai/report-library", {**generic, "item": {**skill, "id": "candidate-00000000-0000-0000-0000-000000000000"}}, self.admin).status_code, 409)
        self.assertEqual(self.call("/api/ai/report-library", {**generic, "item": {**skill, "enabled": False}}, self.admin).status_code, 200)
        refreshed = self.publication("publicationId=" + candidate_id, self.admin).json()["items"][0]["publication"]
        self.assertEqual((refreshed["state"], refreshed["publishedLibraryVersion"], refreshed["libraryVersion"]), ("disabled", 1, 2))
        self.assertEqual(report_library.guidance(question, None, tools, [skill["id"]])[1]["skills"], [])
        self.assertEqual(report_library.guidance(question, None, tools, [skill["id"]], report_library.snapshot(1))[1], frozen["skills"])
        with mutation(self.admin):
            self.assertEqual(report_library.pin("w11a-child", "", None, [], parent_id="w11a-frozen"), frozen)
        self.assertEqual(self.call(route + "/publish", payload, self.admin).json()["publication"], refreshed)
        self.assertEqual((events.count(), report_library.snapshot()["version"]), (1, 2))
        self.turn.assert_called_once()

    def test_unverified_model_stops_before_dispatch_or_draft(self):
        self.model.last_test_result = None
        self.model.save(update_fields=["last_test_result"])
        self.assertEqual(self.submit().json()["code"], "structured_output_unverified")
        self.assertFalse(PiDispatch.objects.filter(operation=self.op, kind="skill_distillation").exists())
        self.turn.assert_not_called()

    def test_report_drift_and_narrowed_scope_prevent_stale_approval(self):
        from dataclasses import replace
        from access_control.models import AppUser
        draft = self.submit().json()["item"]
        route = "/api/ai/pi/skill-candidates/" + draft["id"] + "/review"
        review = {"status": "approved", "expectedVersion": draft["version"], "contentDigest": draft["contentDigest"]}
        self.correct("source report changed")
        self.assertEqual(self.call(route, review, self.owner).json()["code"], "version_conflict")
        narrowed = replace(self.owner, scope={**self.owner.scope, "warehouses": []})
        AppUser.objects.filter(email=self.owner.email).update(scope=narrowed.scope)
        self.assertEqual(self.call(route, {**review, "status": "rejected"}, narrowed).status_code, 404)
        self.assertEqual(self.call("/api/ai/pi/skill-candidates", principal=narrowed, method="GET").json()["items"], [])
        self.assertEqual(self.get(self.op.id, narrowed).status_code, 404)
        AppUser.objects.filter(email=self.owner.email).update(scope=self.owner.scope)
        self.assertEqual(self.call(route, {**review, "status": "rejected"}, self.owner).json()["item"]["status"], "rejected")

    def test_bad_output_is_terminal_without_writing_a_candidate(self):
        self.reply["text"] = canonical(self.content(steps=[{"action": "missing keys"}]))
        self.assertEqual(self.submit().status_code, 422)
        self.assertEqual(self.submit().status_code, 422)
        self.assertFalse(skill_candidates.m.AiSkillCandidate.objects.exists())
        self.turn.assert_called_once()

    def test_evidence_change_during_provider_turn_refuses_the_candidate(self):
        def change(*args, **kwargs):
            self.correct("期间发生变化")
            return self.reply
        self.turn.side_effect = change
        self.assertEqual(self.submit().status_code, 409)
        self.assertFalse(skill_candidates.m.AiSkillCandidate.objects.exists())

    def test_lost_reply_cannot_be_dispatched_under_another_key(self):
        self.turn.side_effect = AiError("运输失败", "provider_timeout", 503)
        self.assertEqual(self.submit().status_code, 503)
        self.assertEqual(self.submit("another").status_code, 409)
        self.turn.assert_called_once()
        self.assertEqual(PiDispatch.objects.get(kind="skill_distillation").status, "unknown")

    def test_local_credential_failure_allows_a_fresh_attempt_without_double_send(self):
        self.turn.side_effect = REAL_PROVIDER_TURN
        with patch("ai_assistant.provider.bounded_json") as network:
            response = self.submit()
            self.assertEqual(response.status_code, 503, response.content)
            network.assert_not_called()
        self.assertEqual(PiDispatch.objects.get(kind="skill_distillation").status, "completed")
        self.turn.side_effect = None
        self.assertEqual(self.submit("after-credential-fix").status_code, 201)

    def test_complete_empty_provider_reply_does_not_block_a_new_authorization(self):
        self.turn.side_effect = REAL_PROVIDER_TURN
        reply = {"choices": [{"finish_reason": "length", "message": {"content": ""}}], "usage": {"completion_tokens": 8}}
        with patch("ai_assistant.provider.decrypt", return_value="test-only"), patch(
                "ai_assistant.provider.bounded_json", return_value=reply) as transport:
            response = self.submit()
            self.assertEqual(response.json()["code"], "provider_output_limit")
            transport.assert_called_once()
        self.assertEqual(PiDispatch.objects.get(kind="skill_distillation").status, "completed")
        self.assertEqual(self.submit().json()["code"], "provider_output_limit")
        self.turn.side_effect = None
        self.assertEqual(self.submit("new-intent").status_code, 201)

    def test_catalog_uses_the_finished_operation_scope_even_after_owner_scope_widens(self):
        from dataclasses import replace
        from access_control.models import AppUser
        widened = replace(self.owner, scope=None)
        AppUser.objects.filter(email=self.owner.email).update(scope=None)
        with patch("ai_assistant.pi_gateway.catalog", return_value=([], [])) as catalog:
            self.submit(principal=widened)
        self.assertEqual(catalog.call_args.args[0].scope, self.owner.scope)
        self.assertEqual(catalog.call_args.args[1].id, self.op.id)

    def test_fully_received_invalid_provider_shape_is_terminal(self):
        self.turn.side_effect = REAL_PROVIDER_TURN
        malformed = {"choices": [{"finish_reason": "stop", "message": {"content": {"bad": "shape"}}}]}
        with patch("ai_assistant.provider.decrypt", return_value="test-only"), patch(
                "ai_assistant.provider.bounded_json", return_value=malformed):
            self.assertEqual(self.submit().json()["code"], "invalid_provider_response")
        self.assertEqual(PiDispatch.objects.get(kind="skill_distillation").status, "completed")
        self.turn.side_effect = None
        self.assertEqual(self.submit("retry-explicit").status_code, 201)

    def test_foreign_owner_and_stale_report_cannot_start_paid_turn(self):
        self.assertEqual(self.submit(principal=self.other).status_code, 404)
        self.assertEqual(self.submit(version="a" * 64).status_code, 409)
        self.turn.assert_not_called()

    def test_optional_receipts_preserve_legacy_read_and_bound_recovery(self):
        path = f"/api/ai/pi/operations/{self.op.id}/skill-candidates"
        legacy = self.call(path, principal=self.owner, method="GET")
        self.assertEqual(legacy.status_code, 200, legacy.content)
        self.assertNotIn("distillation", legacy.json())
        self.assertEqual(self.submit().status_code, 201)
        before = int(revision())
        result = self.get(self.op.id, query="?includeDistillations=1&distillationRequestId=request1")
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(int(revision()), before)
        state = result.json()["distillation"]
        self.assertFalse(state["blocked"])
        self.assertEqual(state["requested"], {"clientRequestId": "request1", "status": "completed", "errorCode": None})
        self.assertEqual(state["candidate"]["status"], "draft")
        self.assertEqual(self.get(self.op.id, self.other, query="?includeDistillations=1").status_code, 404)
        self.assertEqual(self.get(self.op.id, query="?includeDistillations=0").status_code, 400)
        self.assertEqual(self.get(self.op.id, query="?distillationRequestId=request1").status_code, 400)
        self.turn.assert_called_once()

    def test_receipts_distinguish_unknown_from_known_terminal_failure(self):
        query = "?includeDistillations=1&distillationRequestId=request1"
        self.turn.side_effect = provider.ProviderCredentialError("local failure", "service_unavailable", 503)
        self.assertEqual(self.submit().status_code, 503)
        state = self.get(self.op.id, query=query).json()["distillation"]
        self.assertFalse(state["blocked"])
        self.assertEqual(state["requested"]["status"], "completed")
        self.assertEqual(state["requested"]["errorCode"], "service_unavailable")
        self.turn.side_effect = AiError("unknown send", "provider_timeout", 503)
        self.assertEqual(self.submit("second").status_code, 503)
        state = self.get(self.op.id, query=query).json()["distillation"]
        self.assertTrue(state["blocked"])
        self.assertEqual(state["latest"]["status"], "unknown")
        self.assertIsNone(state["candidate"])

    def withdraw(self, key="request1", version=None):
        return self.call(f"/api/ai/pi/operations/{self.op.id}/skill-candidates/distill",
            {"clientRequestId": key, "reportVersionDigest": version or self.version,
             "withdrawAuthorization": True}, self.owner)

    def test_withdraw_fences_a_report_rejected_before_dispatch_and_requires_new_intent(self):
        correction = self.correct("new report basis")
        self.assertEqual(self.submit().status_code, 409)
        self.assertFalse(PiDispatch.objects.filter(operation=self.op, kind="skill_distillation").exists())
        self.assertTrue(self.withdraw().json()["withdrawn"])
        # Even if the old report version is current again, the delayed old POST
        # hits its terminal authorization receipt before any provider call.
        task_feedback.withdraw(self.op.id, correction["id"], {"expectedVersion": correction["version"]}, self.owner)
        self.assertEqual(skill_candidates.request_schema(self.op.id, self.owner)["reportVersionDigest"], self.version)
        self.assertEqual(self.submit().json()["code"], "distillation_authorization_withdrawn")
        self.turn.assert_not_called()
        current = skill_candidates.request_schema(self.op.id, self.owner)["reportVersionDigest"]
        self.assertEqual(self.submit("new-authorized-request", version=current).status_code, 201)
        self.turn.assert_called_once()

    def test_competing_candidate_does_not_prevent_withdrawing_unadmitted_request(self):
        self.assertEqual(self.submit("other-tab").status_code, 201)
        self.assertEqual(self.submit().status_code, 409)
        self.assertTrue(self.withdraw().json()["withdrawn"])
        self.assertEqual(self.submit().json()["code"], "distillation_authorization_withdrawn")
        self.turn.assert_called_once()

    def test_withdraw_wins_between_first_check_and_locked_admission(self):
        def withdraw_before_locked_admission(*args):
            self.assertTrue(self.withdraw().json()["withdrawn"])
            entries = [{"name": name} for name in fixtures.TOOLS]
            return entries, entries
        with patch("ai_assistant.pi_gateway.catalog", side_effect=withdraw_before_locked_admission):
            response = self.submit()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "distillation_authorization_withdrawn")
        self.turn.assert_not_called()

    def test_withdraw_refuses_already_dispatched_or_unknown_and_is_idempotent(self):
        self.turn.side_effect = AiError("unknown send", "provider_timeout", 503)
        self.assertEqual(self.submit().status_code, 503)
        self.assertEqual(self.withdraw().status_code, 409)
        self.assertEqual(PiDispatch.objects.get(operation=self.op, kind="skill_distillation").status, "unknown")
        self.assertTrue(self.withdraw("never-sent").json()["withdrawn"])
        self.assertTrue(self.withdraw("never-sent").json()["withdrawn"])
        self.assertEqual(PiDispatch.objects.filter(operation=self.op, request_id="never-sent").count(), 1)

    def test_legacy_malformed_candidate_remains_readable_and_can_be_rejected(self):
        basis = skill_candidates.request_schema(self.op.id, self.owner)
        saved = skill_candidates.save(self.op.id, {"schemaRef": basis["outputSchemaRef"],
            "schemaDigest": basis["schemaDigest"], "content": self.content(parameters=None)},
            self.owner, registry_tools=fixtures.TOOLS)["item"]
        response = self.get(self.op.id, query="?includeDistillations=1")
        self.assertIsNone(response.json()["distillation"]["candidate"]["content"]["parameters"])
        reviewed = skill_candidates.review(saved["id"], {"status": "rejected",
            "expectedVersion": saved["version"], "contentDigest": saved["contentDigest"]}, self.owner)
        self.assertEqual(reviewed["item"]["status"], "rejected")
