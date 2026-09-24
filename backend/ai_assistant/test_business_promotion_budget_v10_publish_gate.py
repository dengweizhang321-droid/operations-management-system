"""Real-role atomic v10 publication gate; isolated PostgreSQL only."""
from importlib import import_module
import json
from unittest.mock import patch

from django import test as djtest
from django.db import DatabaseError, connection, transaction
import psycopg

from . import business_volume_files, models as m
from . import test_business_promotion_budget_v10_attestation as fixture
from . import test_business_promotion_approved_content as approved_fixture
from .policy import digest, mutation


ROLE = "teruisi_ai_budget_v10_attestor"
PUBLISH = "public.ai_budget_v10_publish(%s,%s,%s,%s,%s,%s)"
OUTCOME = "public.ai_budget_v10_publish_outcome(%s,%s,%s,%s,%s)"


@djtest.override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class BudgetV10PublishGateTests(djtest.TransactionTestCase):
    user = fixture.BudgetV10AttestationTests.user
    call = fixture.BudgetV10AttestationTests.call
    collect_body = fixture.BudgetV10AttestationTests.collect_body
    bundle = fixture.BudgetV10AttestationTests.bundle
    input_for = fixture.BudgetV10AttestationTests.input_for
    insert = fixture.BudgetV10AttestationTests.insert
    seed = fixture.BudgetV10AttestationTests.seed
    setUp = fixture.BudgetV10AttestationTests.setUp
    request_body = fixture.BudgetV10AttestationTests.request_body
    current_catalog = fixture.BudgetV10AttestationTests.current_catalog
    create_fixed_report = fixture.BudgetV10AttestationTests.create_fixed_report
    base = fixture.BudgetV10AttestationTests.base
    read = fixture.BudgetV10AttestationTests.read
    append = fixture.BudgetV10AttestationTests.append
    package = fixture.BudgetV10AttestationTests.package
    promotion = fixture.BudgetV10AttestationTests.promotion
    complete = fixture.BudgetV10AttestationTests.complete
    running_job = fixture.BudgetV10AttestationTests.running_job
    five_completed = fixture.BudgetV10AttestationTests.five_completed
    approved = fixture.BudgetV10AttestationTests.approved
    _complete_budget_report = fixture.BudgetV10AttestationTests._complete_budget_report
    _stage = fixture.BudgetV10AttestationTests._stage
    _database = staticmethod(fixture.BudgetV10AttestationTests._database)
    _body = staticmethod(fixture.BudgetV10AttestationTests._body)
    _attest = fixture.BudgetV10AttestationTests._call
    complete_flow = approved_fixture.PromotionApprovedContentTests.complete_flow

    def _role_call(self, signature, params, *, role=True):
        with self._database() as db:
            if role:
                db.execute("SET SESSION AUTHORIZATION " + ROLE)
            try:
                return db.execute("SELECT " + signature, params).fetchone()[0]
            finally:
                if role:
                    db.execute("RESET SESSION AUTHORIZATION")

    def _prepared(self, *, budget=False):
        report = self._complete_budget_report() if budget else self.five_completed(
            promotion_reference=True)
        if not budget:
            self.approved(report)
        self.complete_flow(report)
        row = self._stage(report)
        body = self._body(row)
        attestation_id = self._attest(row, body, as_role=True)
        att = m.AiBusinessPromotionBudgetV10Attestation.objects.get(pk=attestation_id)
        return report, row, att

    def test_no_budget_role_publish_is_atomic_and_exact_outcome(self):
        report, row, att = self._prepared()
        request = digest(["isolated-v10-publish", row.id, row.attempt])
        args = [row.id, row.attempt, row.version, att.id,
            att.attestation_sha256, request]
        with connection.cursor() as cursor:
            import_module(
                "ai_assistant.migrations.0058_business_promotion_budget_v10_publish_gate").verify_catalog(cursor)
        with self.assertRaises(psycopg.Error):
            self._role_call(PUBLISH, args, role=False)
        with self.assertRaises(DatabaseError), transaction.atomic():
            m.AiBusinessFileRun.objects.filter(pk=row.id).update(
                status="ready", error_code="", version=row.version + 1,
                progress_json='{"stage":"ready"}')
        with self.assertRaises(psycopg.Error):
            self._role_call(PUBLISH, [row.id, row.attempt, row.version,
                att.id, "0" * 64, request])
        pending = self._role_call(OUTCOME, [row.id, row.attempt,
            request, att.id, att.attestation_sha256])
        self.assertEqual(pending["status"], "not_committed")
        committed = self._role_call(PUBLISH, args)
        self.assertEqual(committed["status"], "committed")
        # Simulated lost response: query the exact request, do not create a
        # second publication attempt or mutate the ready row.
        resolved = self._role_call(OUTCOME, [row.id, row.attempt,
            request, att.id, att.attestation_sha256])
        self.assertEqual(resolved, committed)
        self.assertEqual(self._role_call(PUBLISH, args), committed)
        row.refresh_from_db()
        self.assertEqual((row.status, row.attempt, row.version),
            ("ready", att.attempt, committed["version"]))
        self.assertEqual(json.loads(row.progress_json)["attestationId"], att.id)
        with self.assertRaises(psycopg.Error):
            self._role_call(PUBLISH, [row.id, row.attempt, row.version,
                att.id, att.attestation_sha256, "f" * 64])
        conflict = self._role_call(OUTCOME, [row.id, row.attempt,
            "f" * 64, att.id, att.attestation_sha256])
        self.assertEqual(conflict["status"], "conflict")
        with self.assertRaises(Exception):
            business_volume_files.chunk(row.id, "1", "html",
                {"sequence": "1"}, self.admin)

    def test_budget_presence_is_bound_and_direct_role_update_has_no_grant(self):
        report, row, att = self._prepared(budget=True)
        self.assertTrue(att.budget_present)
        request = digest(["isolated-budget-v10-publish", row.id])
        with self._database() as db:
            db.execute("SET SESSION AUTHORIZATION " + ROLE)
            try:
                with self.assertRaises(psycopg.Error):
                    db.execute("UPDATE public.ai_business_file_runs "
                        "SET status='ready' WHERE id=%s", [row.id])
            finally:
                db.execute("RESET SESSION AUTHORIZATION")
        result = self._role_call(PUBLISH, [row.id, row.attempt, row.version,
            att.id, att.attestation_sha256, request])
        self.assertEqual(result["status"], "committed")
        row.refresh_from_db()
        self.assertEqual(row.status, "ready")
        self.assertEqual(att.budget_plan_digest,
            json.loads(report.snapshot_json)["budgetRef"]["planDigest"])
