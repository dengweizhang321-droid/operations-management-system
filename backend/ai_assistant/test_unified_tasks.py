"""Synthetic control/schema checks; never calls a model, connector or sender."""
from datetime import timedelta
from django.db import connection, DatabaseError, transaction
from django.test import TestCase
from django.utils import timezone
from . import models as m, tests as domain, task_definitions as definitions, task_dispatch as dispatch
from .policy import AiError, canonical, digest, mutation
from .task_models import TaskDefinition, TaskRevision, TaskGrant, TaskRun


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
        return admin, spec, definitions.save({"clientRequestId": "task-create-1", "name": "合成日报", "spec": spec}, admin)["item"]

    def synthetic_run(self, item, status="unknown"):
        now = timezone.now()
        grant = TaskGrant.objects.create(id="synthetic-grant", revision_id=item["revisionId"], owner_email=item["ownerEmail"],
            authorization_ref="synthetic_fixture_only", expires_at=now+timedelta(days=1))
        return TaskRun.objects.create(id="synthetic-task-run", task_id=item["id"], revision_id=item["revisionId"],
            grant=grant,
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
                definitions.save({"clientRequestId": "invalid", "name": "非法", "spec": spec, **extra}, actor)
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

    def test_create_is_idempotent_and_payload_changes_conflict(self):
        actor, spec, item = self.draft()
        again = definitions.save({"clientRequestId": "task-create-1", "name": "合成日报", "spec": spec}, actor)
        self.assertTrue(again["replayed"])
        self.assertEqual(again["item"]["id"], item["id"])
        from unittest.mock import patch
        with patch.object(definitions, "normalize", side_effect=AssertionError("a retry must not rebind the current skill bundle")):
            self.assertTrue(definitions.save({"clientRequestId": "task-create-1", "name": "合成日报", "spec": spec}, actor)["replayed"])
        from . import report_library
        with patch.object(report_library, "snapshot", side_effect=AiError("published method unavailable", "not_found", 404)):
            self.assertEqual(definitions.save({"clientRequestId": "task-create-1", "name": "合成日报", "spec": spec}, actor)["item"]["id"], item["id"])
        with self.assertRaises(AiError):
            definitions.save({"clientRequestId": "task-create-1", "name": "另一任务", "spec": spec}, actor)
        self.assertEqual(TaskDefinition.objects.count(), 1)

    def test_summaries_paginate_and_revision_detail_has_the_exact_spec(self):
        actor, spec, item = self.draft()
        for index in range(3):
            definitions.save({"clientRequestId": f"task-create-extra-{index}", "name": "分页", "spec": spec}, actor)
        first = definitions.listing({"limit": "2"}, actor)
        second = definitions.listing({"limit": "2", "cursor": first["nextCursor"]}, actor)
        self.assertEqual(len({r["id"] for r in first["items"] + second["items"]}), 4)
        self.assertTrue(all("spec" not in r for r in first["items"] + second["items"]))
        history = definitions.detail(item["id"], {"limit": "1"}, actor, "revisions")
        self.assertNotIn("spec", history["items"][0])
        self.assertEqual(definitions.detail(item["id"], {}, actor, "revisions", item["revisionId"])["item"]["spec"], spec)

    def test_native_terminal_incident_and_revision_pointer_guards(self):
        if connection.vendor != "postgresql":
            self.skipTest("native PostgreSQL constraints")
        actor, _spec, item = self.draft()
        with mutation():
            run = self.synthetic_run(item)
            incident = dispatch.incident(run, "dispatch_unknown", {"reason": "await_original_receipt", "body": "must_not_be_returned"})
        for sql, params in (
            ("UPDATE ai_task_runs SET status='queued',version=version+1 WHERE id=%s", [run.id]),
            ("UPDATE ai_task_incidents SET state='closed',version=version+1 WHERE id=%s", [incident.id]),
            ("UPDATE ai_task_definitions SET current_revision=current_revision+1,version=version+1 WHERE id=%s", [item["id"]]),
        ):
            with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(sql, params)
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        dispatch.incident_control(incident.id, {"expectedVersion": 1}, actor, "claim")
        dispatch.incident_control(incident.id, {"expectedVersion": 2, "resolutionNote": "已核查原记录，无重发"}, actor, "close")
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE ai_task_incidents SET resolution_note='changed',version=version+1 WHERE id=%s", [incident.id])
        evidence = definitions.detail(item["id"], {}, actor, "incidents", incident.id)["item"]["evidence"]
        self.assertEqual(evidence["reasonCode"], "await_original_receipt")
        self.assertNotIn("body", evidence)

    def test_internal_production_execution_is_closed_and_future_slots_are_not_claimed(self):
        actor, _spec, item = self.draft()
        with mutation():
            run = self.synthetic_run(item, "queued")
        self.assertIsNone(dispatch.claim(run.id, "worker", now=run.scheduled_at-timedelta(seconds=1)))
        with self.assertRaises(AiError) as blocked:
            dispatch.claim(run.id, "worker", now=run.scheduled_at)
        self.assertEqual(blocked.exception.code, "task_executor_not_adopted")
        with self.assertRaises(AiError):
            dispatch.handoff(run.id, "worker", 1, "not-an-operation")
        run.refresh_from_db()
        self.assertEqual((run.status, run.fence), ("queued", 0))

    def test_operation_binding_covers_every_frozen_input_and_session(self):
        from copy import deepcopy
        from types import SimpleNamespace as Obj
        spec = {"skill": {"kind": "bundled", "id": "fixture", "version": "1.0.0", "digest": "a"*64},
            "prompt": "精确日报", "parameters": {"day": "original"}, "modelId": "model", "modelVersion": 9,
            "shopSelection": {"platform": "京东", "shop": "志高商用设备旗舰店"}}
        run = Obj(id="run-fixed", task_id="task-fixed", revision_id="revision-fixed", grant_id="grant-fixed",
            scheduled_at=timezone.now(), occurrence_key="original", revision=Obj(spec_json=canonical(spec), spec_digest=digest(spec)),
            task=Obj(owner_email="owner", actor_role="admin", scope_json="null"))
        request = dispatch.operation_payload(run)
        payload = {key: request[key] for key in ("message", "skillIds", "shopSelection", "fileIds", "businessExecution")}
        op = Obj(session=Obj(owner_email="owner", actor_role="admin", scope_json="null", selection_json=canonical(spec["shopSelection"]),
            client_request_id="task-session-run-fixed", epoch=1, generation=1), scope_json="null", actor_role="admin",
            epoch=1, generation=1, client_request_id=run.id, kind="prompt", model_id="model", model_version=9,
            payload_json=canonical(payload), skills_json=canonical([{"id": "fixture", "version": "1.0.0", "sha256": "a"*64}]))
        dispatch.check_operation_binding(run, op)
        mutations = [lambda o: setattr(o.session, "client_request_id", "foreign-session"),
            lambda o: setattr(o, "model_version", 10), lambda o: setattr(o, "skills_json", "[]"),
            lambda o: setattr(o, "payload_json", canonical({**payload, "message": "different"})),
            lambda o: setattr(o.session, "selection_json", canonical({"platform": "京东", "shop": "别店"}))]
        for change in mutations:
            other = deepcopy(op)
            change(other)
            with self.assertRaises(AiError):
                dispatch.check_operation_binding(run, other)

    def test_postgres_delivery_receipt_shape_and_frozen_target_binding(self):
        if connection.vendor != "postgresql":
            self.skipTest("native PostgreSQL constraints")
        from . import pi_service
        from .pi_models import PiOperation, PiSession
        actor, spec, item = self.draft()
        bundle = pi_service.skills()[0]
        target = {"connector": "dingtalk", "targetType": "person", "targetId": "synthetic-self", "senderId": "synthetic-self"}
        spec = {**spec, "skill": {"kind": "bundled", "id": bundle["id"], "version": bundle["version"], "digest": bundle["sha256"]}, "deliveryTargets": [target]}
        with self.assertRaises(AiError):
            definitions.normalize({**spec, "deliveryTargets": [target, {**target, "targetId": "second", "senderId": "second"}]}, actor)
        item = definitions.save({"id": item["id"], "expectedVersion": 1, "name": "单目标", "spec": spec}, actor)["item"]
        invalid = {**spec, "deliveryTargets": [target, {**target, "targetId": "second", "senderId": "second"}]}
        with self.assertRaisesRegex(DatabaseError, "single_target_only"), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE ai_task_definitions SET current_revision=3,version=version+1 WHERE id=%s", [item["id"]])
            TaskRevision.objects.create(id="invalid-multi-target", task_id=item["id"], revision=3,
                spec_json=canonical(invalid), spec_digest=digest(invalid), created_by=actor.email)
        with mutation():
            run = self.synthetic_run(item, "leased")
            session = pi_service.create_session({"clientRequestId": "task-session-"+run.id, "scope": actor.scope, "shopSelection": spec["shopSelection"]}, actor)["session"]
            operation_id = pi_service.prompt(session["id"], dispatch.operation_payload(run), actor)["operation"]["id"]
            run.operation_id, run.status, run.version = operation_id, "delegated", 2
            run.save()
            operation = PiOperation.objects.get(pk=operation_id)
            operation.status = "succeeded"
            operation.save(update_fields=["status"])
            row = PiSession.objects.get(pk=session["id"])
            row.status, row.active_operation_id = "idle", ""
            row.save(update_fields=["status", "active_operation_id"])
        key = digest({"runId": run.id, "target": target})
        valid = {"deliveryId": key, "targetDigest": digest(target), "status": "sent", "receiptRef": "synthetic-original-receipt"}
        corrupt = [{"fabricated": {}}, {key: {}}, {key: {**valid, "status": None}},
            {key: {**valid, "targetDigest": "0"*64}}, {key: {**valid, "deliveryId": "0"*64}},
            {key: {**valid, "receiptRef": ""}}, {key: {k: v for k, v in valid.items() if k != "status"}}]
        for value in corrupt:
            with self.assertRaisesRegex(DatabaseError, "ai_unified_task_delivery_"), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("UPDATE ai_task_runs SET status='succeeded',report_status='ready',delivery_status='sent',delivery_receipts_json=%s,version=version+1 WHERE id=%s", [canonical(value), run.id])
        observed = dispatch.observe(run.id, delivery_receipt_reader=lambda *_: valid)
        self.assertEqual((observed.status, observed.report_status, observed.delivery_status), ("succeeded", "ready", "sent"))
