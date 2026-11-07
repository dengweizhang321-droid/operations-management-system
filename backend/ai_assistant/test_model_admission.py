"""Normal signed entrypoints with isolated provider replies and synthetic inputs."""
import base64
import hashlib
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import capability_probes as probes, configuration, models as m, output_schemas, provider, space, transport
from . import tests as support
from .control_models import AiWriteReceipt
from .policy import AiError, canonical, mutation
from .test_provider_responses import message, reply


def request_identity(path, principal, client_id):
    binding = "\n".join((path, principal.email.lower(), client_id))
    return "w10-probe-" + hashlib.sha256(binding.encode()).hexdigest()


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class ModelAdmissionTests(TestCase):
    setUp = support.AiDomainTests.setUp
    user = support.AiDomainTests.user
    call = support.AiDomainTests.call
    image_bytes = support.AiDomainTests.image_bytes

    def probe_call(self, path, fields, *, principal=support.ADMIN, key=None):
        key = key or str(uuid.uuid4())
        return self.call(path, {"action": "test", "clientRequestId": key, **fields}, principal=principal,
                         request_id=request_identity(path, principal, key))

    def enable_schema_declaration(self, protocol="openai_compatible", **generation_options):
        self.model.protocol = protocol
        self.model.generation_options_json = canonical({"structuredOutputSupport": "json_schema", **generation_options})
        self.model.save(update_fields=["protocol", "generation_options_json"])
        return {"id": self.model.id, "expectedVersion": self.model.version, "testMode": "structured_output"}

    def native_reply(self, url, body, *_args, **_kwargs):
        self.assertNotIn("tools", body)
        if url.endswith("/responses"):
            native = body["text"]["format"]
            self.assertIs(native["strict"], True)
        elif url.endswith("/messages"):
            native = body["output_config"]["format"]
        else:
            self.assertEqual(body["response_format"]["type"], "json_schema")
            native = {"type": "json_schema", **body["response_format"]["json_schema"]}
            self.assertIs(native["strict"], True)
        self.assertEqual(native["type"], "json_schema")
        schema = native["schema"]
        nonce = schema["properties"]["goal"]["enum"][0]
        self.assertNotIn(nonce, canonical({k: v for k, v in body.items()
                                           if k in {"messages", "system", "input", "instructions"}}))
        self.assertEqual(set(schema["required"]), set(output_schemas.SKILL_CANDIDATE_V1["required"]))
        value = {key: [] for key in schema["required"]}
        value.update(goal=nonce, body="synthetic method",
                     steps=[{"order": 1, "action": "inspect", "toolName": "", "missingDataBranch": "stop"}])
        content = canonical(value)
        if url.endswith("/responses"):
            return reply([message(content)])
        if url.endswith("/messages"):
            return {"content": [{"type": "text", "text": content}], "stop_reason": "end_turn"}
        return {"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}

    def test_native_schema_requests_on_three_existing_adapters(self):
        contract = output_schemas.resolve(probes.STRUCTURED_CONTRACT)
        for protocol, options, suffix in (
            ("openai_compatible", {}, "/chat/completions"),
            ("openai_compatible", {"openaiApiMode": "responses"}, "/responses"),
            ("anthropic", {}, "/messages"),
        ):
            with self.subTest(suffix=suffix):
                body = self.enable_schema_declaration(protocol, **options)
                key = str(uuid.uuid4())
                with (patch.object(provider, "decrypt", return_value="synthetic"),
                      patch.object(provider, "bounded_json", side_effect=self.native_reply) as paid):
                    outcome = self.probe_call("/api/ai/models", body, key=key)
                    self.assertEqual(outcome.status_code, 200, outcome.content)
                    self.assertTrue(outcome.json()["ok"])
                    replay = self.probe_call("/api/ai/models", body, key=key)
                    self.assertEqual(replay["X-Teruisi-Write-Replay"], "1")
                    self.assertEqual(paid.call_count, 1)
                    self.assertTrue(paid.call_args.args[0].endswith(suffix))
                self.model.refresh_from_db()
                probes.require_structured(self.model, contract)
                self.assertNotIn("SCHEMA_OK_", self.model.last_test_result)
                self.assertNotIn("synthetic method", self.model.last_test_result)
                with self.assertRaisesRegex(AiError, "尚未通过"):
                    probes.require_structured(self.model, {**contract, "schemaDigest": "different"})
        self.model.version += 1
        self.assertEqual(probes.record(self.model)["structuredOutput"]["status"], "expired")
        with self.assertRaisesRegex(AiError, "尚未通过"):
            probes.require_structured(self.model, contract)

    def test_declaration_json_and_tool_success_do_not_qualify(self):
        body = self.enable_schema_declaration()
        path = "/api/ai/models"
        contract = output_schemas.resolve(probes.STRUCTURED_CONTRACT)
        with patch.object(probes, "tool_roundtrip"):
            probes.run(self.model, support.ADMIN, "synthetic-tool-probe", "tool_roundtrip_json")
        self.model.refresh_from_db()
        self.assertEqual(probes.record(self.model)["nonStreaming"]["status"], "passed")
        with self.assertRaisesRegex(AiError, "尚未通过"):
            probes.require_structured(self.model, contract)
        for content in ('{"goal":"ordinary JSON"}', "READY"):
            with (patch.object(provider, "decrypt", return_value="synthetic"),
                  patch.object(provider, "bounded_json", return_value={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}) as paid):
                denied = self.probe_call(path, body, principal=self.owner)
                self.assertEqual(denied.status_code, 403, denied.content)
                paid.assert_not_called()
                result = self.probe_call(path, body)
                self.assertEqual(result.status_code, 200, result.content)
                self.assertFalse(result.json()["ok"])
                self.assertEqual(result.json()["capabilityProbe"]["structuredOutput"]["status"], "failed")
                paid.assert_called_once()

    def test_unknown_native_result_retains_receipt_and_cannot_replay(self):
        body = self.enable_schema_declaration()
        path = "/api/ai/models"
        key = str(uuid.uuid4())
        with (patch.object(provider, "decrypt", return_value="synthetic"),
              patch.object(provider, "bounded_json", side_effect=transport.ProviderTransportError(
                  stage="response_headers", reason="timeout", request_started=True)) as paid):
            self.assertEqual(self.probe_call(path, body, key=key).status_code, 503)
            self.assertEqual(self.probe_call(path, body, key=key).status_code, 409)
            paid.assert_called_once()
        self.model.refresh_from_db()
        self.assertEqual(probes.record(self.model)["structuredOutput"]["status"], "inconclusive")
        self.assertEqual(AiWriteReceipt.objects.get(request_id=request_identity(path, support.ADMIN, key)).status, "processing")

    def image_profile(self):
        return m.AiSpaceModelProfiles.objects.create(id="image-profile", name="Synthetic images",
            model_name="fixture", base_url="https://api.openai.com/v1", api_key_encrypted="fixture")

    def image_reply(self, url, body, *_args, **_kwargs):
        self.assertEqual(url, "https://api.openai.com/v1/images/generations")
        self.assertEqual(body["n"], 1)
        width, height = map(int, body["size"].split("x"))
        raw = self.image_bytes(width, height)
        return {"data": [{"b64_json": base64.b64encode(raw).decode()}]}

    def test_image_scenes_and_sizes_are_admitted_independently_in_normal_jobs(self):
        profile = self.image_profile()
        path = "/api/ai/space/profiles"
        with (patch.object(space, "decrypt", return_value="synthetic"),
              patch.object(space.transport, "bounded_json", side_effect=self.image_reply) as paid):
            for index, scene_spec in enumerate(space.SCENES):
                scene, size = scene_spec["id"], scene_spec["defaultSize"]
                with self.subTest(scene=scene):
                    template = m.AiSpaceTemplates.objects.create(id=f"template-{scene}", scene=scene,
                        name="fixture", prompt_template="{product_name}", size=size,
                        model_profile_id=profile.id, updated_by=support.ADMIN.email)
                    job_body = {"clientRequestId": f"image-job-{scene}", "scene": scene,
                                "templateId": template.id, "productName": "合成夹具", "count": 1}
                    probe_body = {"id": profile.id, "expectedVersion": profile.version, "scene": scene, "size": size}
                    blocked = self.call("/api/ai/space/jobs", job_body)
                    self.assertEqual(blocked.json()["code"], "image_capability_unverified")
                    self.assertEqual(paid.call_count, index * 2)
                    key = str(uuid.uuid4())
                    passed = self.probe_call(path, probe_body, key=key)
                    self.assertEqual(passed.status_code, 200, passed.content)
                    self.assertTrue(passed.json()["ok"])
                    self.assertIn(scene_spec["description"], paid.call_args.args[1]["prompt"])
                    self.assertEqual(self.probe_call(path, probe_body, key=key)["X-Teruisi-Write-Replay"], "1")
                    self.assertEqual(m.AiSpaceAssets.objects.count(), index)
                    profile.refresh_from_db()
                    with self.assertRaisesRegex(AiError, "尚未通过"):
                        space.require_image_admission(profile, scene, next(other for other in space.SIZES if other != size))
                    meta = self.call("/api/ai/space/meta", method="GET").json()
                    self.assertTrue(next(t for t in meta["templates"] if t["id"] == template.id)["isEnabled"])
                    self.assertEqual(len(meta["profiles"][0]["imageAdmissions"]), index + 1)
                    self.assertEqual(self.call("/api/ai/space/jobs", job_body).status_code, 201)
                    self.assertEqual(space.tick()["status"], "succeeded")
                    self.assertEqual(paid.call_args.args[1]["size"], size)
                    self.assertIn("合成夹具", paid.call_args.args[1]["prompt"])
            self.assertEqual(paid.call_count, 6)
        self.assertEqual(m.AiSpaceAssets.objects.count(), 3)
        profile.refresh_from_db()
        self.assertEqual(len(space.image_admissions(profile)), 3)
        self.assertEqual(configuration.profile_record(profile)["lastSuccessResult"], "真实图片生成成功")
        with mutation(support.ADMIN):
            configuration.save_model({"id": profile.id, "expectedVersion": profile.version,
                "name": profile.name, "modelName": "candidate-model"}, support.ADMIN, image=True)
        profile.refresh_from_db()
        self.assertEqual(space.image_admissions(profile), [])
        self.assertEqual(m.AiSpaceAssets.objects.count(), 3)

    def test_wrong_size_and_unknown_images_never_open_admission(self):
        profile = self.image_profile()
        profile.last_success_result = "真实图片生成成功"
        profile.save(update_fields=["last_success_result"])
        path = "/api/ai/space/profiles"
        body = {"id": profile.id, "expectedVersion": profile.version, "scene": "promotion", "size": "1536x1024"}
        wrong = {"data": [{"b64_json": base64.b64encode(self.image_bytes()).decode()}]}
        unknown = transport.ProviderTransportError(stage="response_headers", reason="timeout", request_started=True)
        with (patch.object(space, "decrypt", return_value="synthetic"),
              patch.object(space.transport, "bounded_json", side_effect=[wrong, unknown]) as paid):
            self.assertEqual(self.probe_call(path, body, principal=self.owner).status_code, 403)
            self.assertEqual(self.probe_call(path, {**body, "size": "4096x4096"}).status_code, 400)
            self.assertEqual(self.probe_call(path, {**body, "expectedVersion": 2}).status_code, 409)
            paid.assert_not_called()
            failed = self.probe_call(path, body)
            self.assertEqual(failed.status_code, 200, failed.content)
            self.assertFalse(failed.json()["ok"])
            key = str(uuid.uuid4())
            self.assertEqual(self.probe_call(path, body, key=key).status_code, 503)
            self.assertEqual(self.probe_call(path, body, key=key).status_code, 409)
            self.assertEqual(paid.call_count, 2)
        profile.refresh_from_db()
        self.assertEqual(space.image_admissions(profile), [])
        self.assertEqual(profile.last_success_result, "真实图片生成成功")
