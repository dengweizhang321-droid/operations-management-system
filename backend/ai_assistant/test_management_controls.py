"""Configuration deletion and default routing preserve history and execution fences."""
from unittest.mock import patch
import hashlib
import hmac
from urllib.parse import urlencode

from django.db import IntegrityError
from django.test import TestCase, override_settings

from . import configuration as config, models as m, tests as support
from .policy import AiError, mutation
from .transport import signed_headers


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class ManagementControlsTests(TestCase):
    setUp = support.AiDomainTests.setUp
    user = support.AiDomainTests.user
    call = support.AiDomainTests.call

    def another_model(self, **extra):
        return m.AiModels.objects.create(id="other-model", name="Other model",
            model_name="fixture", protocol="openai_compatible", model_type="vision",
            status="enabled", base_url=self.model.base_url,
            api_key_encrypted="opaque-fixture", max_tool_rounds=1000,
            max_total_tool_calls=10000, **extra)

    def choose(self, row, **extra):
        return self.call("/api/ai/models", {"action": "set_default", "id": row.id,
            "expectedVersion": row.version, **extra}, principal=support.ADMIN)

    def receipt(self, status):
        return m.AiChatRequestReceipts.objects.create(id="chat-control", model_id=self.model.id,
            owner_email=self.owner.email, client_request_id="control-fixture",
            request_digest="a" * 64, status=status)

    def job(self, status):
        return m.AiAgentJobs.objects.create(id="agent-control", model_id=self.model.id,
            owner_email=self.owner.email, client_request_id="agent-control",
            request_digest="b" * 64, scope_json="null", task="fixture", status=status)

    def workflow(self, status):
        return m.AiWorkflowRuns.objects.create(id="workflow-control", model_id=self.model.id,
            owner_email=self.owner.email, client_request_id="workflow-control",
            request_digest="c" * 64, scope_json="null", name="fixture", graph_json="{}",
            graph_digest="d" * 64, status=status)

    def delete(self, version=None, principal=support.ADMIN):
        with mutation(principal):
            return config.delete_model({"id": self.model.id,
                "expectedVersion": str(version or self.model.version)}, principal)

    def test_delete_used_model_preserves_history_and_does_not_delete_another_model(self):
        other = self.another_model()
        conversation = m.AiConversations.objects.create(id="old-conversation", title="fixture",
            created_by=self.owner.email, model_id=self.model.id)
        m.AiConversationMessages.objects.create(id="old-message", conversation_id=conversation.id,
            role="assistant", content="Isolated historical answer")
        self.job("completed")
        self.workflow("completed")
        self.receipt("failed")
        before = {table.__name__: list(table.objects.values()) for table in
            (m.AiConversations, m.AiConversationMessages, m.AiAgentJobs,
             m.AiWorkflowRuns, m.AiChatRequestReceipts)}
        self.assertTrue(self.delete()["deleted"])
        self.assertFalse(m.AiModels.objects.filter(id=self.model.id).exists())
        self.assertTrue(m.AiModels.objects.filter(id=other.id).exists())
        for table in (m.AiConversations, m.AiConversationMessages, m.AiAgentJobs,
                      m.AiWorkflowRuns, m.AiChatRequestReceipts):
            self.assertEqual(list(table.objects.values()), before[table.__name__])
        conversation.refresh_from_db()
        self.assertEqual(conversation.model_id, self.model.id)
        self.assertFalse(self.delete()["deleted"])

    def test_signed_delete_api_binds_version_and_replays_the_existing_receipt(self):
        path = "/api/ai/models"
        query = urlencode({"id":self.model.id, "expectedVersion":self.model.version})
        secret = "isolated-management-delete-signing-secret-abcdefghijklmnopqrstuvwxyz"
        with patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET":secret}), \
            override_settings(DJANGO_INTERNAL_SECRET=secret):
            headers = signed_headers(path, {}, support.ADMIN)
            message = "\n".join(["v1", headers["X-Teruisi-Timestamp"],
                headers["X-Teruisi-Request-Id"], "DELETE", path, query,
                headers["X-Teruisi-Content-SHA256"], headers["X-Teruisi-Principal"]])
            headers["X-Teruisi-Signature"] = "v1=" + hmac.new(secret.encode(),
                message.encode(), hashlib.sha256).hexdigest()
            first = self.client.generic("DELETE", path+"?"+query, "{}",
                content_type="application/json", headers=headers)
            replay = self.client.generic("DELETE", path+"?"+query, "{}",
                content_type="application/json", headers=headers)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertTrue(first.json()["deleted"])
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")

    def test_delete_checks_current_version_and_admin_scope(self):
        with self.assertRaises(AiError) as stale:
            self.delete(version=self.model.version + 1)
        self.assertEqual(stale.exception.code, "version_conflict")
        scoped = self.user("scoped-admin@example.invalid", "admin", self.owner.scope)
        for principal in (self.owner, scoped):
            with self.subTest(role=principal.role), self.assertRaises(AiError):
                self.delete(principal=principal)
        self.assertTrue(m.AiModels.objects.filter(id=self.model.id).exists())

    def test_active_chat_agent_and_workflow_prevent_delete_or_default_demotion(self):
        other = self.another_model()
        for create, states in ((self.receipt, ("processing", "dispatched")),
            (self.job, ("queued", "running", "paused")),
            (self.workflow, ("queued", "running", "paused", "waiting_review"))):
            for status in states:
                with self.subTest(kind=create.__name__, status=status):
                    active = create(status)
                    with self.assertRaises(AiError) as blocked:
                        self.delete()
                    self.assertEqual(blocked.exception.code, "conflict")
                    response = self.choose(other)
                    self.assertEqual(response.status_code, 409, response.content)
                    self.model.refresh_from_db()
                    self.assertEqual(self.model.is_default_text_model, 1)
                    active.delete()

    def test_set_default_action_keeps_credentials_and_parameters_for_vision_and_text(self):
        other = self.another_model()
        response = self.choose(other)
        self.assertEqual(response.status_code, 200, response.content)
        item = response.json()["item"]
        self.assertTrue(item["isDefaultTextModel"])
        other.refresh_from_db(); self.model.refresh_from_db()
        self.assertEqual(other.api_key_encrypted, "opaque-fixture")
        self.assertEqual((other.max_tool_rounds, other.max_total_tool_calls), (1000, 10000))
        self.assertEqual(self.model.version, 2)
        self.assertFalse(self.model.is_default_text_model)
        self.assertEqual(config.resolve_model().id, other.id)
        replay = self.choose(other)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json()["item"]["version"], other.version)
        switched = self.choose(self.model)
        self.assertEqual(switched.status_code, 200, switched.content)
        self.assertEqual(m.AiModels.objects.filter(is_default_text_model=1).count(), 1)
        self.assertEqual(config.resolve_model().id, self.model.id)

    def test_default_action_rejects_stale_version_disabled_model_and_parameter_overwrite(self):
        other = self.another_model()
        for extra, status in (({"expectedVersion": 9}, 409),
            ({"maxToolRounds": 9}, 400), ({"apiKey": "forbidden"}, 400)):
            response = self.choose(other, **extra)
            self.assertEqual(response.status_code, status, response.content)
        other.status = "disabled"; other.save(update_fields=["status"])
        self.assertEqual(self.choose(other).status_code, 400)
        denied = self.call("/api/ai/models", {"action":"set_default", "id":self.model.id,
            "expectedVersion":self.model.version}, principal=self.owner)
        self.assertEqual(denied.status_code, 403)
        self.model.refresh_from_db()
        self.assertEqual(self.model.is_default_text_model, 1)

    def test_create_default_vision_model_and_atomic_failed_create_preserve_old_default(self):
        body = {"name":"Vision default", "modelName":"fixture", "baseUrl":self.model.base_url,
            "apiKey":"fixture-only", "protocol":"openai_compatible", "modelType":"vision",
            "isDefaultTextModel":True, "maxToolRounds":1000, "maxTotalToolCalls":10000}
        with patch.object(config, "encrypt", return_value="opaque-fixture"), \
            patch.object(m.AiModels.objects, "create", side_effect=IntegrityError("fixture")), \
            self.assertRaises(IntegrityError), mutation(support.ADMIN):
            config.save_model(body, support.ADMIN)
        self.model.refresh_from_db()
        self.assertEqual((self.model.is_default_text_model, self.model.version), (1, 1))
        with patch.object(config, "encrypt", return_value="opaque-fixture"):
            response = self.call("/api/ai/models", body, principal=support.ADMIN)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["item"]["isDefaultTextModel"])
        self.assertEqual(config.resolve_model().id, response.json()["item"]["id"])
