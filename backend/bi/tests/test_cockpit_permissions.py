import os
from pathlib import Path
import secrets
from unittest import skipUnless
from unittest.mock import patch
from django.db import connection
from django.test import TestCase


@skipUnless(os.getenv("TERUISI_BI_PERMISSION_TEST") == "1", "private PG only")
class CockpitPostgresPermissionsTests(TestCase):
    def test_actual_provision_has_no_cross_domain_bi_grants(self):
        source = (Path(__file__).resolve().parents[3] / "tools" / "django-bi-service.ps1").read_text(encoding="utf-8-sig")
        # Exercise the actual SQL provisioner in the same private cluster.
        code = source.split("$code = @'\n", 1)[1].split("\n'@", 1)[0]
        from urllib.parse import quote
        d = connection.settings_dict
        url = f"postgresql://{quote(d['USER'])}:{quote(d['PASSWORD'])}@127.0.0.1:{d['PORT']}/{quote(d['NAME'])}"
        with patch.dict(os.environ, {"TERUISI_PROVISION_DATABASE_URL": url, "TERUISI_PROVISION_BI_READER_PASSWORD": secrets.token_hex(40)}):
            exec(compile(code, "private-bi-provision", "exec"), {})
        with connection.cursor() as cursor:
            for table in ["finance_erp_targets", "workflow_tasks", "netshop_rows"]:
                cursor.execute("SELECT has_table_privilege('teruisi_bi_reader', %s, 'SELECT')", [table])
                self.assertFalse(cursor.fetchone()[0], table)
            for table in ["sales_order_lines", "erp_product_master"]:
                cursor.execute("SELECT has_table_privilege('teruisi_bi_reader', %s, 'SELECT'), has_table_privilege('teruisi_bi_reader', %s, 'UPDATE')", [table, table])
                self.assertEqual(cursor.fetchone(), (True, False))
