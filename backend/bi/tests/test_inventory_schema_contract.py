"""BI validates its existing inventory consumer contract without JD grants."""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from teruisi_backend import health


class BiInventorySchemaContractTests(SimpleTestCase):
    def validate(self, *, bi=False, writer=False, missing_table=None, missing_column=None, missing_index=None):
        expected = health.REQUIRED_INVENTORY_WRITER_COLUMNS if writer else health.REQUIRED_INVENTORY_COLUMNS
        tables = set(health.REQUIRED_BI_INVENTORY_COLUMNS if bi else expected)
        tables.discard(missing_table)
        indexes = (health.REQUIRED_INVENTORY_WRITER_INDEXES if writer else health.REQUIRED_INVENTORY_READER_INDEXES) - {missing_index}
        def columns(_cursor, table):
            if bi and table in health.REQUIRED_JD_INVENTORY_READER_COLUMNS:
                raise AssertionError("BI must not SELECT JD tables")
            return expected[table] - ({missing_column[1]} if missing_column and missing_column[0] == table else set())
        with patch.object(health.connection.introspection,"table_names",return_value=list(tables)), \
             patch.object(health,"_column_names",side_effect=columns), \
             patch.object(health.connection.introspection,"get_constraints",return_value={name:{"index":True} for name in indexes}):
            health._validate_inventory_schema(MagicMock(),writer=writer,bi_consumer=bi)

    def test_bi_existing_contract_requires_no_jd_relations(self):
        self.validate(bi=True)
        self.assertEqual(set(health.REQUIRED_JD_INVENTORY_READER_COLUMNS),{
            "inventory_jd_logistics_"+name for name in
            ("deliveries","departments","scopes","batches","facts","mappings","manual_states")})
        self.assertTrue(health.REQUIRED_JD_INVENTORY_READER_COLUMNS.keys().isdisjoint(health.REQUIRED_BI_INVENTORY_COLUMNS))

    def test_bi_rejects_missing_original_table_column_and_index(self):
        for change in ({"missing_table":"inventory_stock_lines"},
                       {"missing_column":("inventory_stock_lines","warehouse")},
                       {"missing_index":"inv_stock_lookup_idx"}):
            with self.subTest(change=change),self.assertRaises(health.ReadinessError):
                self.validate(bi=True,**change)

    def test_inventory_reader_and_writer_still_require_all_jd_schema(self):
        for writer in (False,True):
            self.validate(writer=writer)
            for change in ({"missing_table":"inventory_jd_logistics_deliveries"},
                           {"missing_column":("inventory_jd_logistics_departments","replenishment_cycle_days")},
                           {"missing_index":"inv_jdl_fact_scope_idx"}):
                with self.subTest(writer=writer,change=change),self.assertRaises(health.ReadinessError):
                    self.validate(writer=writer,**change)

    def test_bi_state_selects_consumer_contract(self):
        cursor=MagicMock();cursor.fetchone.return_value=("bi-apply-"+"a"*32,"bi-dashboard-read-model-v1","b"*64)
        with patch.object(health.connection.introspection,"table_names",return_value=["bi_migration_runs"]), \
             patch.object(health,"_column_names",return_value=health.REQUIRED_BI_COLUMNS["bi_migration_runs"]), \
             patch.object(health.connection.introspection,"get_constraints",return_value={"bi_migration_status_idx":{}}), \
             patch.object(health,"_validate_inventory_schema") as inventory, \
             patch.object(health,"_validate_bi_monitor_permissions"), \
             patch.object(health,"_validate_inventory_revision"), \
             patch.object(health,"_validate_reader_state"):
            health._validate_bi_reader_state(cursor)
            inventory.assert_called_once_with(cursor,writer=False,bi_consumer=True)
