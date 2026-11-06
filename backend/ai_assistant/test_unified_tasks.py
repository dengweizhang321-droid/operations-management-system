"""Synthetic control/schema checks; never calls a model, connector or sender."""
from datetime import timedelta
from django.db import connection, DatabaseError, transaction
from django.test import TestCase
from django.utils import timezone
from . import models as m, tests as domain, task_definitions as definitions, task_dispatch as dispatch
from .policy import AiError, canonical, digest, mutation
from .task_models import TaskDefinition, TaskRevision, TaskRun


class UnifiedTaskTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user

    def draft(self):
        from . import report_library
        admin = self.user("task-admin@example.invalid", "admin", None)
        skill = report_library.DEFAULTS["skills"][0]
        m.AiLibraryRevision.objects.create(version=1, config_json=canonical(report_library.DEFAULTS), created_by=admin.email)
        spec = {"skill": {"kind": "library_guidance", "id": skill["id"], "version": 1, "digest": digest(skill)},
            "prompt": "读取指定一店昨天数据并写报告", "shopSelection": {"platform": "京东", "shop": "合成店"},
            "modelId": self.model.id, "modelVersion": self.model.version,
            "trigger": {"kind": "time", "timezone": "Asia/Shanghai", "cadence": "daily", "hour": 9, "minute": 0, "day": 1, "windowSeconds": 3600},
            "dataDependencies": [], "deliveryTargets": [], "missedPolicy": "skip", "parameters": {}}
        return admin, spec, definitions.save({"name": "合成日报", "spec": spec}, admin)["item"]

    def synthetic_run(self, item, status="unknown"):
        now = timezone.now()
        return TaskRun.objects.create(id="synthetic-task-run", task_id=item["id"], revision_id=item["revisionId"],
            trigger_kind="time", occurrence_key="2026-11-07T01:00:00Z", scheduled_at=now,
            deadline_at=now+timedelta(hours=1), status=status)

    def test_draft_freezes_published_skill_and_stays_disabled(self):
        actor, spec, item = self.draft()
        self.assertFalse(item["enabled"])
        self.assertEqual(item["digest"], digest(spec))
        state = definitions.detail(item["id"], {}, actor)["readiness"]
        self.assertFalse(state["ready"])
        self.assertIn("library_guidance_is_not_pi_runtime_skill", state["blockers"])
        with self.assertRaises(AiError) as blocked:
            definitions.control(item["id"], {"expectedVersion": 1}, actor, "enable")
        self.assertEqual(blocked.exception.code, "task_not_ready")
        self.assertEqual(TaskRun.objects.count(), 0)

    def test_edit_creates_immutable_revision_and_checks_cas(self):
        actor, spec, item = self.draft()
        changed = definitions.save({"id": item["id"], "expectedVersion": 1, "name": "第二版", "spec": {**spec, "prompt": "新指令"}}, actor)["item"]
        self.assertEqual(changed["revision"], 2)
        self.assertEqual(TaskRevision.objects.get(id=item["revisionId"]).spec_digest, digest(spec))
        with self.assertRaises(AiError):
            definitions.save({"id": item["id"], "expectedVersion": 1, "name": "旧客户端", "spec": spec}, actor)

    def test_body_cannot_supply_owner_or_enabled_or_unknown_scope(self):
        actor, spec, item = self.draft()
        for extra in ({"enabled": True}, {"ownerEmail": "other@example.invalid"}, {"executorKind": "n8n"}):
            with self.assertRaises(AiError):
                definitions.save({"name": "非法", "spec": spec, **extra}, actor)
        with self.assertRaises(AiError):
            definitions.normalize({**spec, "shopSelection": None}, actor)
        with self.assertRaises(AiError):
            definitions.normalize({**spec, "skill": {**spec["skill"], "digest": "0"*64}}, actor)
        self.assertEqual(TaskDefinition.objects.count(), 1)

    def test_unknown_run_is_not_reclaimed_and_incident_close_does_not_resume(self):
        actor, spec, item = self.draft()
        with mutation():
            run = self.synthetic_run(item)
            incident = dispatch.incident(run, "dispatch_unknown", {"operationId": "original"})
        self.assertIsNone(dispatch.claim(run.id, "worker-two"))
        claimed = dispatch.incident_control(incident.id, {"expectedVersion": 1}, actor, "claim")["item"]
        with self.assertRaises(AiError):
            dispatch.incident_control(incident.id, {"expectedVersion": 1}, actor, "claim")
        closed = dispatch.incident_control(incident.id, {"expectedVersion": claimed["version"], "resolutionNote": "已记录原回执；无重跑授权"}, actor, "close")
        self.assertFalse(closed["businessReplayed"])
        run.refresh_from_db()
        self.assertEqual(run.status, "unknown")

    def test_occurrence_identity_is_unique_across_revisions(self):
        actor, spec, item = self.draft()
        with mutation():
            run = self.synthetic_run(item)
        definitions.save({"id": item["id"], "expectedVersion": 1, "name": "第二版", "spec": spec}, actor)
        duplicate, created = dispatch.accept_occurrence(item["id"], trigger_kind="time", occurrence_key=run.occurrence_key, scheduled_at=run.scheduled_at)
        self.assertFalse(created)
        self.assertEqual(duplicate.id, run.id)
        self.assertEqual(duplicate.revision_id, item["revisionId"])

    def test_legacy_projection_does_not_register_tasks(self):
        actor, _spec, _item = self.draft()
        from .task_legacy_adapters import listing
        before = TaskDefinition.objects.count()
        self.assertFalse(listing(actor)["n8n"]["registrationPerformed"])
        self.assertEqual(TaskDefinition.objects.count(), before)

    def test_postgres_fences_revision_and_disabled_admission(self):
        if connection.vendor != "postgresql":
            self.skipTest("native PostgreSQL constraints")
        actor, spec, item = self.draft()
        for sql, params in (
            ("UPDATE ai_task_revisions SET spec_json=%s WHERE id=%s", ['{}', item["revisionId"]]),
            ("UPDATE ai_task_definitions SET enabled=true,version=version+1 WHERE id=%s", [item["id"]]),
            ("UPDATE ai_task_definitions SET owner_email='foreign' WHERE id=%s", [item["id"]]),
        ):
            with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(sql, params)
        self.assertFalse(TaskDefinition.objects.get(pk=item["id"]).enabled)
