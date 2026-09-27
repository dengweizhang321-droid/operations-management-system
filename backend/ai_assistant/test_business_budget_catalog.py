from importlib import import_module
from unittest import skipUnless

from django.db import connection, transaction
from django.test import TransactionTestCase

from .business_budget_catalog import verify_v11_budget_catalog
from .health import _verify_promotion_trial_file_guard


@skipUnless(connection.vendor == "postgresql", "PostgreSQL catalog regression")
class CurrentBudgetCatalogTests(TransactionTestCase):
    def verify(self):
        with connection.cursor() as cursor:
            verify_v11_budget_catalog(cursor,
                file_guard_verifier=_verify_promotion_trial_file_guard)

    def test_current_guard_verifier_accepts_v11_without_rewriting_old_migrations(self):
        old = import_module("ai_assistant.migrations.0059_business_promotion_budget_v10_reader_fence")
        with connection.cursor() as cursor, self.assertRaisesRegex(RuntimeError, "publish file guard drift"):
            old.verify_catalog(cursor)
        self.verify()

    def test_changed_security_definer_or_execute_acl_is_still_rejected(self):
        old = import_module("ai_assistant.migrations.0059_business_promotion_budget_v10_reader_fence")
        publication = import_module("ai_assistant.migrations.0058_business_promotion_budget_v10_publish_gate")
        for signature in (old.READ_SIGNATURE, old.BODY_SIGNATURE, publication.PUBLISH_SIGNATURE):
            with self.subTest(signature=signature), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("ALTER FUNCTION " + signature + " SECURITY INVOKER")
                with self.assertRaisesRegex(RuntimeError, "function body or owner drift"):
                    self.verify()
                transaction.set_rollback(True)
            self.verify()
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("GRANT EXECUTE ON FUNCTION " + old.READ_SIGNATURE + " TO PUBLIC")
            with self.assertRaisesRegex(RuntimeError, "EXECUTE ACL drift"):
                self.verify()
            transaction.set_rollback(True)
