from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from teruisi_backend.health import ReadinessError, _validate_erp_reference_schema, _validate_writer_schema


class RecoveryAuditMigrationTests(TransactionTestCase):
    def test_legacy_audits_upgrade_without_guessing_upload_identity(self):
        old_targets = [("erp_reference", "0002_erpproductmaster_erpreferenceimportscopehead_and_more"), ("sales", "0010_analysis_options")]
        new_targets = [("erp_reference", "0003_jackyun_upload_audit_binding"), ("sales", "0011_jackyun_upload_audit_binding")]
        executor = MigrationExecutor(connection)
        leaves = executor.loader.graph.leaf_nodes()
        try:
            executor.migrate(old_targets)
            old = executor.loader.project_state(old_targets).apps
            ERP = old.get_model("erp_reference", "ErpReferenceImportAttempt")
            Sales = old.get_model("sales", "SalesImportAttempt")
            erp = ERP.objects.create(source_key="products", actor_email="legacy@example.test", raw_file_hash="1" * 64,
                outcome="rejected", file_name="legacy.xlsx", file_size_bytes=512)
            sales = Sales.objects.create(id="legacy-sales-audit", actor_email="legacy@example.test", raw_file_hash="2" * 64,
                outcome="rejected", file_name="legacy.xlsx", file_size_bytes=512)
            before_erp = ERP.objects.values().get(pk=erp.pk)
            before_sales = Sales.objects.values().get(pk=sales.pk)
            with connection.cursor() as cursor:
                with self.assertRaisesMessage(ReadinessError, "erp_reference_writer_schema_incomplete"):
                    _validate_erp_reference_schema(cursor, writer=True)
                with self.assertRaisesMessage(ReadinessError, "sales_writer_schema_incomplete"):
                    _validate_writer_schema(cursor)
            executor = MigrationExecutor(connection); executor.migrate(new_targets)
            new = executor.loader.project_state(new_targets).apps
            after_erp = new.get_model("erp_reference", "ErpReferenceImportAttempt").objects.values().get(pk=erp.pk)
            after_sales = new.get_model("sales", "SalesImportAttempt").objects.values().get(pk=sales.pk)
            with connection.cursor() as cursor:
                _validate_erp_reference_schema(cursor, writer=True)
                _validate_writer_schema(cursor)
            for before, after in [(before_erp, after_erp), (before_sales, after_sales)]:
                self.assertEqual({key: after[key] for key in before}, before)
                self.assertEqual(after["raw_upload_id"], "")
                self.assertEqual(after["upload_fingerprint"], "")
            for table in ["erp_reference_import_attempts", "sales_import_attempts"]:
                with connection.cursor() as cursor:
                    constraints = connection.introspection.get_constraints(cursor, table)
                self.assertTrue(any(c["index"] and c["columns"] == ["upload_fingerprint"] for c in constraints.values()))
            # Only untouched legacy fixtures are reversed. Production rollback
            # retains the new audit columns once real upload references exist.
            executor = MigrationExecutor(connection); executor.migrate(old_targets)
            self.assertEqual(ERP.objects.values().get(pk=erp.pk), before_erp)
            self.assertEqual(Sales.objects.values().get(pk=sales.pk), before_sales)
        finally:
            MigrationExecutor(connection).migrate(leaves)
