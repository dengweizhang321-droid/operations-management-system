from django.test import SimpleTestCase

from .page_context import normalize
from .policy import AiError


class InventoryPageContextTests(SimpleTestCase):
    def test_inventory_and_collector_contexts_survive_server_validation(self):
        for module, view in (
            ("inventory", "tmall_warehouse"),
            ("n8n_workflows", "tmall_warehouse"),
            ("n8n_workflows", "jd_logistics"),
        ):
            with self.subTest(module=module, view=view):
                context = {"version": 1, "module": module, "view": view,
                           "period": {"startDate": "2026-10-01", "endDate": "2026-10-18"},
                           "filters": {}, "importSource": None}
                self.assertEqual(normalize(context), context)

    def test_unknown_or_cross_module_views_still_fail_closed(self):
        for module, view in (("inventory", "unregistered_warehouse"), ("sales", "tmall_warehouse")):
            with self.subTest(module=module, view=view), self.assertRaises(AiError):
                normalize({"module": module, "view": view})
