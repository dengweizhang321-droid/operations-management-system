from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

from django.db import transaction
from django.test import SimpleTestCase, TransactionTestCase, override_settings

from inventory.errors import InventoryApiError
from inventory.models import InventoryDataRevision
from inventory.read_cache import InventoryReadCache, cache, cached_base
from sales.auth import Principal
from sales.models import SalesDataRevision


class ReadCacheTests(SimpleTestCase):
    def test_capacity_bytes_ttl_and_detached_nested_rows(self):
        local = InventoryReadCache(capacity=2, maximum_bytes=500, ttl=1)
        load = lambda: [{"nested": [1]}]
        with patch("inventory.read_cache.monotonic", return_value=1):
            first = local.read("one", load, lambda: None)
            first[0]["nested"].append(9)
            self.assertEqual(local.read("one", load, lambda: None), load())
            local.read("two", load, lambda: None)
            local.read("three", load, lambda: None)
            self.assertNotIn("one", local.entries)
            self.assertLessEqual(local.bytes, 500)
        with patch("inventory.read_cache.monotonic", return_value=3):
            local.read("new", load, lambda: None)
            self.assertEqual(list(local.entries), ["new"])
        local.read("too-big", lambda: "x"*1000, lambda: None)
        self.assertNotIn("too-big", local.entries)

    def test_failed_loader_or_changed_version_never_publishes(self):
        local = InventoryReadCache()
        def fail(): raise InventoryApiError("version changed", status=503)
        with self.assertRaises(InventoryApiError): local.read("fail", fail, lambda: None)
        with self.assertRaises(InventoryApiError): local.read("changed", lambda: [1], fail)
        self.assertEqual(local.bytes, 0)
        self.assertFalse(local.entries)

    def test_concurrent_readers_reuse_once_and_nested_guangdong_is_reentrant(self):
        local = InventoryReadCache()
        loads=[]; started=Event(); release=Event()
        def loader():
            loads.append(1); started.set(); self.assertTrue(release.wait(2))
            return local.read("nested", lambda: [2], lambda: None)
        with ThreadPoolExecutor(2) as pool:
            first=pool.submit(local.read,"outer",loader,lambda: None)
            self.assertTrue(started.wait(2))
            second=pool.submit(local.read,"outer",loader,lambda: None)
            release.set()
            self.assertEqual(first.result(2),[2]); self.assertEqual(second.result(2),[2])
        self.assertEqual(len(loads),1)


class PrincipalCacheTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        InventoryDataRevision.objects.get_or_create(domain="inventory")
        for domain in ("sales","erp"): SalesDataRevision.objects.get_or_create(domain=domain)
        self.principal=Principal("fixture@example.invalid","Fixture","admin",None)
        self.loads=0

    def tearDown(self): cache.clear()

    def load(self):
        self.loads+=1
        return [{"count":self.loads}]

    def read(self, principal=None, scope="all-stock"):
        return cached_base("test", principal or self.principal, scope, self.load)

    def test_principal_role_scope_source_and_batch_identity_invalidate(self):
        self.read(); self.read(); self.assertEqual(self.loads,1)
        self.read(Principal("other@example.invalid","Other","admin",None))
        self.read(Principal(self.principal.email,"Fixture","viewer",None))
        self.read(Principal(self.principal.email,"Fixture","admin",{"warehouses":["广东仓"]}))
        self.read(scope="other-batch")
        self.assertEqual(self.loads,5)
        for domain,model in (("inventory",InventoryDataRevision),("sales",SalesDataRevision),("erp",SalesDataRevision)):
            model.objects.filter(domain=domain).update(revision=3)
            self.read()
        self.assertEqual(self.loads,8)
        with override_settings(INVENTORY_WRITE_AUTHORITY_EPOCH="different-binding"):
            self.read()
        self.assertEqual(self.loads,9)

    def test_uncommitted_rows_and_legacy_none_principal_bypass(self):
        with transaction.atomic(): self.read(); self.read()
        self.assertFalse(cache.entries)
        cached_base("test",None,"all",self.load)
        cached_base("test",None,"all",self.load)
        self.assertEqual(self.loads,4)

    def test_source_change_during_loader_rejected_and_not_cached(self):
        def loader():
            InventoryDataRevision.objects.filter(domain="inventory").update(revision=7)
            return ["old"]
        with self.assertRaises(InventoryApiError): cached_base("changing",self.principal,"all",loader)
        self.assertFalse(cache.entries)

    def test_database_and_actual_role_are_part_of_identity(self):
        from django.db import connection
        self.read()
        with patch.dict(connection.settings_dict, NAME="other-database-identity"):
            self.read()
        self.assertEqual(self.loads,2)

    def test_regions_share_full_query_and_bind_complete_scope_and_source(self):
        from inventory.regions import regional_read
        payload={"metrics":{"count":100},"items":[{"id":1}],"mapping":{"samples":[{"id":1}]}}
        loads=[]
        def loader(): loads.append(1); return payload
        old=regional_read(self.principal,"fixture",{"query":"x","page":2},None,loader)
        self.assertEqual(old,payload)
        summary=regional_read(self.principal,"fixture",{"query":"x","page":2},"summary",loader)
        detail=regional_read(self.principal,"fixture",{"query":"x","page":2},"detail",loader)
        self.assertEqual(len(loads),2)
        self.assertEqual(summary["items"],[]); self.assertEqual(detail["items"],[{"id":1}])
        self.assertEqual(summary["metrics"],payload["metrics"])
        self.assertEqual(summary["readSnapshot"],detail["readSnapshot"])
        self.assertEqual(summary["readScope"],detail["readScope"])
        changed=regional_read(self.principal,"fixture",{"query":"y","page":2},"detail",loader)
        self.assertNotEqual(changed["readScope"],detail["readScope"])
        InventoryDataRevision.objects.filter(domain="inventory").update(revision=9)
        changed=regional_read(self.principal,"fixture",{"query":"x","page":2},"detail",loader)
        self.assertNotEqual(changed["readSnapshot"],detail["readSnapshot"])
