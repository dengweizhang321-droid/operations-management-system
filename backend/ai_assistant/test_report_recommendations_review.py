"""Independent real-PostgreSQL interleavings for recommendation installation.

The fixture never calls a model, business reader, scheduler or external sender.
Run with tools/ai-postgres-rehearsal.py against its private disposable cluster.
"""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from sales.auth import Principal
from . import models as m, report_library as library, workflow_presets
from .control_models import AiDataRevision, AiWriteAuthority
from .policy import AiError


@skipUnless(connection.vendor == "postgresql", "Requires real PostgreSQL row locks")
@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class RecommendationConcurrencyReviewTests(TransactionTestCase):
    def setUp(self):
        AiDataRevision.objects.get_or_create(domain="ai-assistant")
        AiWriteAuthority.objects.get_or_create(id=1)
        for rank, code in enumerate(("viewer", "admin")):
            AccessRole.objects.get_or_create(code=code, defaults={
                "label": code, "description": code, "rank": rank, "permissions": [],
            })
        self.admin = Principal("recommendation-review@example.invalid", "Synthetic review", "admin", None)
        AppUser.objects.create(email=self.admin.email, display_name=self.admin.display_name,
            role_id="admin", scope=None, created_at=timezone.now(), updated_at=timezone.now())

    def install(self, key, expected=0):
        return {"installRecommendation": key, "expectedVersion": expected}

    def submit(self, body, start=None):
        # Each executor thread owns and closes its own actual DB connection.
        connections.close_all()
        try:
            if start is not None:
                start.wait(timeout=10)
            try:
                return {"ok": library.save(body, self.admin)}
            except AiError as error:
                return {"error": error.code, "status": error.status}
        finally:
            connections.close_all()

    def race(self, bodies):
        gate = Barrier(len(bodies), timeout=10)
        with ThreadPoolExecutor(max_workers=len(bodies)) as executor:
            futures = [executor.submit(self.submit, body, gate) for body in bodies]
            return [future.result(timeout=20) for future in futures]

    def assert_single_winner(self, results):
        self.assertEqual(sum("ok" in row for row in results), 1, results)
        self.assertEqual([row for row in results if "error" in row],
            [{"error": "version_conflict", "status": 409}])
        self.assertEqual(m.AiLibraryRevision.objects.count(), 1)
        self.assertEqual(library.snapshot()["version"], 1)

    def test_two_recommendations_same_version_have_one_atomic_winner(self):
        baseline = deepcopy(library.snapshot(0))
        keys = [row["id"] for row in workflow_presets.PRESETS[:2]]
        results = self.race([self.install(key) for key in keys])
        self.assert_single_winner(results)
        winning = next(row["ok"]["installedRecommendation"] for row in results if "ok" in row)
        config = library.snapshot()["config"]
        for key in keys:
            preset = workflow_presets.find(key)
            for kind, items in preset["bundle"].items():
                present = [item for item in config[kind] if item["id"] == items[0]["id"]]
                self.assertEqual(present, items if key == winning else [])
        self.assertEqual(library.snapshot(0), baseline)

    def test_installation_racing_existing_editor_preserves_the_winner(self):
        skill = deepcopy(library.DEFAULTS["skills"][0])
        skill["name"] = "Synthetic user customization"
        results = self.race([self.install(workflow_presets.PRESETS[0]["id"]),
            {"kind": "skills", "item": skill, "expectedVersion": 0}])
        self.assert_single_winner(results)
        config = library.snapshot()["config"]
        stored = next(item for item in config["skills"] if item["id"] == skill["id"])
        self.assertEqual(stored, skill if "ok" in results[1] else library.DEFAULTS["skills"][0])
        # The losing user can refresh and save without erasing the installation.
        if "ok" in results[0]:
            library.save({"kind": "skills", "item": skill, "expectedVersion": 1}, self.admin)
            self.assertTrue(all(workflow_presets.presence(workflow_presets.PRESETS[0], library.snapshot()["config"])))

    def test_parallel_repeated_install_keeps_user_edits_and_revision(self):
        key = workflow_presets.PRESETS[0]["id"]
        library.save(self.install(key), self.admin)
        skill = deepcopy(workflow_presets.PRESETS[0]["bundle"]["skills"][0])
        skill.update(name="User's configured method", enabled=False)
        library.save({"kind": "skills", "item": skill, "expectedVersion": 1}, self.admin)
        before = library.snapshot()
        revision = AiDataRevision.objects.get(domain="ai-assistant").revision
        results = self.race([self.install(key, 2), self.install(key, 2)])
        self.assertTrue(all(row.get("ok", {}).get("replayed") is True for row in results), results)
        self.assertEqual(library.snapshot(), before)
        self.assertEqual(m.AiLibraryRevision.objects.count(), 2)
        self.assertEqual(AiDataRevision.objects.get(domain="ai-assistant").revision, revision)

    def test_revoked_admin_waiting_for_domain_lock_cannot_install(self):
        preflight = Event()
        actual_check = library.current_principal

        def witnessed_check(*args, **kwargs):
            result = actual_check(*args, **kwargs)
            preflight.set()
            return result

        with ThreadPoolExecutor(max_workers=1) as executor:
            with patch.object(library, "current_principal", side_effect=witnessed_check):
                with transaction.atomic():
                    AiDataRevision.objects.select_for_update().get(domain="ai-assistant")
                    future = executor.submit(self.submit, self.install(workflow_presets.PRESETS[0]["id"]))
                    self.assertTrue(preflight.wait(timeout=10), "Child never reached the unlocked authorization check")
                    AppUser.objects.filter(email=self.admin.email).update(role_id="viewer")
                result = future.result(timeout=20)
        self.assertEqual(result, {"error": "access_denied", "status": 403})
        self.assertFalse(m.AiLibraryRevision.objects.exists())
