"""Offline checks for the disposable v11 three-identity SQL prototype."""
from importlib import import_module
from inspect import getsource
from unittest import TestCase

from . import business_promotion_budget_v11_identity_candidate_sql as candidate


class BudgetV11IdentityCandidateStaticTests(TestCase):
    def test_v2_is_additive_and_closed(self):
        att = import_module(
            "ai_assistant.migrations.0067_business_promotion_budget_v11_attestation")
        verify = import_module(
            "ai_assistant.migrations.0068_business_promotion_budget_v11_verifier_receipt")
        v2 = candidate.verify_sql()
        self.assertIn("ai_budget_v11_verify_protected_receipt_v2(", v2)
        self.assertIn("session_user<>'teruisi_ai_budget_v11_publish_login'", v2)
        self.assertIn("NOLOGIN NOINHERIT", getsource(candidate.install_test_only))
        self.assertIn("session_user<>'teruisi_ai_budget_v11_attestor'", att.ATTEST)
        self.assertIn("session_user<>'teruisi_ai_budget_v11_publisher'",
            verify.VERIFY)
        self.assertNotIn("UPDATE public.ai_business_file_runs", v2)
        self.assertIn("readyAuthorized',false", candidate.READ_SQL)
        self.assertIn("claimed_at IS NULL", candidate.READ_SQL)

    def test_no_migration_or_web_route_is_added_by_candidate(self):
        self.assertIn("only installs in isolated PG test", getsource(candidate._isolated))
        self.assertEqual(set(candidate.ROLES), {candidate.ATTEST,candidate.SIGN,
            candidate.PUBLISH})
        self.assertNotIn("PASSWORD", candidate.ISSUE_SQL + candidate.READ_SQL +
            candidate.verify_sql())

    def test_full_owning_preflight_still_uses_unrestricted_orm_and_is_blocked(self):
        from pathlib import Path
        source = (Path(__file__).parent /
            "business_promotion_budget_v11_preflight.py").read_text(
            encoding="utf-8")
        signer = (Path(__file__).parents[1] / "business_analysis" /
            "promotion_budget_verifier_receipt_v11.py").read_text(
            encoding="utf-8")
        self.assertIn("files.get(identifier(run_id), principal)", source)
        self.assertIn("AiBusinessPromotionBudgetV11Attestation.objects.get", signer)
        self.assertNotIn("read_proof_ticket_v2", source + signer)
