"""Operational presets reuse the existing library and reviewed report contract."""
from copy import deepcopy
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import models as m, report_library as library, reports, workflows, workflow_presets
from . import tests as fixtures
from .policy import AiError, canonical, mutation


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class WorkflowPresetTests(TestCase):
    user = fixtures.AiDomainTests.user
    call = fixtures.AiDomainTests.call

    def setUp(self):
        fixtures.AiDomainTests.setUp(self)
        self.admin = self.user("preset-admin@example.invalid", "admin", None)

    def install(self, key="ops-daily", version=0, principal=None):
        return library.save({"installRecommendation": key, "expectedVersion": version}, principal or self.admin)

    def request(self, pipeline, version, dry=True):
        return {"clientRequestId": "preset-" + pipeline, "pipelineId": pipeline, "expectedVersion": version,
                "scope": {"platform": "京东", "shop": "合成店铺", "startDate": "2026-10-01", "endDate": "2026-10-07"},
                "dryRun": dry}

    def test_read_catalog_has_no_writes_and_preserves_historical_defaults(self):
        before = canonical(library.snapshot(0))
        result = library.read(self.admin, {})
        self.assertEqual(len(result["recommended"]), 6)
        self.assertTrue(all(not item["installed"] and not item["conflict"] for item in result["recommended"]))
        self.assertFalse(m.AiLibraryRevision.objects.exists())
        self.assertEqual(len(library.snapshot()["config"]["pipelines"]), 3)
        self.install()
        self.assertEqual(canonical(library.snapshot(0)), before)
        self.assertFalse(library.read(self.admin, {"version": "0"})["recommended"][0]["installed"])

    def test_install_is_one_version_and_preserves_every_existing_item(self):
        existing = deepcopy(library.DEFAULTS["templates"][0])
        existing["writingRules"] = "由管理员调整的既有写作规范"
        library.save({"kind": "templates", "item": existing, "expectedVersion": 0}, self.admin)
        before = library.snapshot(1)
        installed = self.install(version=1)
        self.assertEqual(installed["item"]["version"], 2)
        self.assertEqual(installed["pipelineId"], "ops-daily-pipeline")
        self.assertFalse(installed["replayed"])
        self.assertEqual(m.AiLibraryRevision.objects.count(), 2)
        for kind, values in before["config"].items():
            self.assertEqual(installed["item"]["config"][kind][:-1], values)
        self.assertEqual(library.snapshot(1), before)

    def test_repeat_preserves_customized_disabled_installation_without_new_version(self):
        first = self.install()
        pipeline = deepcopy(first["item"]["config"]["pipelines"][-1])
        pipeline.update(name="我修改的名称", enabled=False)
        library.save({"kind": "pipelines", "item": pipeline, "expectedVersion": 1}, self.admin)
        before = library.snapshot()
        result = self.install(version=2)
        self.assertTrue(result["replayed"])
        self.assertEqual(result["item"], before)
        self.assertEqual(m.AiLibraryRevision.objects.count(), 2)
        item = library.read(self.admin, {})["recommended"][0]
        self.assertTrue(item["installed"])
        self.assertFalse(item["conflict"])

    def test_partial_collision_rejects_entire_bundle(self):
        skill = workflow_presets.find("ops-daily")["bundle"]["skills"][0]
        skill["body"] = "由用户占用此标识的内容"
        library.save({"kind": "skills", "item": skill, "expectedVersion": 0}, self.admin)
        before = library.snapshot()
        with self.assertRaises(AiError) as caught:
            self.install(version=1)
        self.assertEqual(caught.exception.code, "recommendation_conflict")
        self.assertEqual(library.snapshot(), before)
        self.assertEqual(m.AiLibraryRevision.objects.count(), 1)
        self.assertTrue(library.read(self.admin, {})["recommended"][0]["conflict"])

    def test_permissions_cas_unknown_and_mixed_fields_fail_without_mutation(self):
        scoped_admin = self.user("scoped-preset-admin@example.invalid", "admin", self.owner.scope)
        for principal in (self.owner, self.viewer, scoped_admin):
            with self.subTest(role=principal.role, scope=principal.scope):
                with self.assertRaises(AiError):
                    self.install(principal=principal)
        for payload in (
            {"installRecommendation": "missing", "expectedVersion": 0},
            {"installRecommendation": "ops-daily", "expectedVersion": 1},
            {"installRecommendation": "ops-daily", "expectedVersion": True},
            {"installRecommendation": "ops-daily", "expectedVersion": 0, "kind": "skills", "item": {}},
            {"installRecommendation": "ops-daily", "expectedVersion": 0, "schedule": "daily"},
        ):
            with self.subTest(payload=payload), self.assertRaises(AiError):
                library.save(payload, self.admin)
        self.assertFalse(m.AiLibraryRevision.objects.exists())
        self.install()
        with self.assertRaises(AiError) as caught:
            self.install(version=0)
        self.assertEqual(caught.exception.code, "version_conflict")

    def test_capacity_rejection_does_not_save_partial_skill_or_template(self):
        config = deepcopy(library.DEFAULTS)
        for number in range(9):
            config["pipelines"].append({**config["pipelines"][0], "id": "custom-pipeline-" + str(number)})
        config = library.validate(config)
        with mutation(self.admin):
            m.AiLibraryRevision.objects.create(version=1, config_json=canonical(config), created_by=self.admin.email)
        with self.assertRaises(AiError):
            self.install(version=1)
        self.assertEqual(library.snapshot(), {"version": 1, "config": config})
        self.assertEqual(m.AiLibraryRevision.objects.count(), 1)

    def test_signed_install_receipt_replays_and_catalog_returns_installation(self):
        payload = {"installRecommendation": "ops-daily", "expectedVersion": 0}
        first = self.call("/api/ai/report-library", payload, self.admin, request_id="preset-install")
        self.assertEqual(first.status_code, 200, first.content)
        second = self.call("/api/ai/report-library", payload, self.admin, request_id="preset-install")
        self.assertEqual(second.json(), first.json())
        self.assertEqual(m.AiLibraryRevision.objects.count(), 1)
        result = self.call("/api/ai/report-library", principal=self.admin, method="GET")
        self.assertEqual(result.status_code, 200, result.content)
        self.assertTrue(result.json()["recommended"][0]["installed"])

    def test_all_presets_complete_existing_dry_run_without_provider_or_send(self):
        with patch("ai_assistant.provider.turn") as provider, patch("ai_assistant.channels.send") as send:
            for version, preset in enumerate(workflow_presets.PRESETS):
                with self.subTest(preset=preset["id"]):
                    installed = self.install(preset["id"], version)
                    item = reports.create(self.request(installed["pipelineId"], version+1), self.admin)["item"]
                    for _ in range(5):
                        workflows.workflow_tick()
                    detail = reports.detail(item["id"], self.admin)
                    self.assertEqual(detail["item"]["status"], "completed")
                    self.assertEqual([node["type"] for node in detail["workflow"]["nodes"]], ["agent", "agent", "human_review"])
                    self.assertTrue(all(node["status"] == "skipped" for node in detail["workflow"]["nodes"]))
            provider.assert_not_called()
            send.assert_not_called()
        self.assertFalse(m.AiAgentJobs.objects.exists())
        self.assertFalse(m.AiReportDelivery.objects.exists())

    def test_formal_report_pins_preset_and_existing_tool_policy_before_edits(self):
        installed = self.install()
        with patch("ai_assistant.transport.catalog", return_value=fixtures.CATALOG), patch("ai_assistant.provider.turn") as provider:
            item = reports.create(self.request(installed["pipelineId"], 1, dry=False), self.admin)["item"]
            provider.assert_not_called()
        row = reports.get(item["id"], self.admin)
        before = row.snapshot_json
        guidance = workflows.execution_guidance(row.workflow_id)
        skill = deepcopy(installed["item"]["config"]["skills"][-1])
        skill["body"] = "修改后的指导"
        library.save({"kind": "skills", "item": skill, "expectedVersion": 1}, self.admin)
        row.refresh_from_db()
        self.assertEqual(row.snapshot_json, before)
        self.assertEqual(workflows.execution_guidance(row.workflow_id), guidance)
        self.assertIn("每日经营检查方法", guidance)
        self.assertEqual(row.workflow.allowed_tools_json, canonical(["get_data_freshness"]))
