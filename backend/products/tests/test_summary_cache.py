from concurrent.futures import ThreadPoolExecutor
import time
from unittest.mock import patch
from django.test import SimpleTestCase
from products.summary_cache import SummaryCache

class SummaryCacheTests(SimpleTestCase):
    def test_single_flight_copies_and_bounded_eviction(self):
        cache=SummaryCache(capacity=2,maximum_bytes=100)
        calls=[]
        def load():
            calls.append(1)
            time.sleep(.02)
            return {"rows":[1]}
        with ThreadPoolExecutor(max_workers=5) as pool:
            values=list(pool.map(lambda _:cache.read('a',load,lambda:None),range(5)))
        self.assertEqual(len(calls),1)
        values[0]['rows'].append(2)
        self.assertEqual(cache.read('a',load,lambda:None),{'rows':[1]})
        cache.read('b',load,lambda:None);cache.read('c',load,lambda:None)
        self.assertEqual(list(cache.entries),['b','c'])
        self.assertLessEqual(cache.bytes,100)

    def test_expiry_failed_load_revision_and_oversize_never_reuse(self):
        cache=SummaryCache(ttl=.001, maximum_bytes=30)
        cache.read('a',lambda:{'n':1},lambda:None)
        time.sleep(.002)
        self.assertEqual(cache.read('a',lambda:{'n':2},lambda:None),{'n':2})
        def fail(): raise RuntimeError('changed')
        with self.assertRaises(RuntimeError):cache.read('a',lambda:{'n':3},fail)
        with self.assertRaises(RuntimeError):cache.read('b',fail,lambda:None)
        self.assertNotIn('b',cache.entries)
        cache.read('large',lambda:{'rows':'x'*100},lambda:None)
        self.assertNotIn('large',cache.entries)

    def test_identity_scope_database_authority_and_transactions(self):
        from products.summary_cache import cached_base
        from sales.auth import Principal
        options=dict(range='custom',rangeExplicit=True,startDate='2026-09-01',endDate='2026-09-30',days=None,platforms=[],shops=[])
        with patch('products.summary_cache.connection') as connection, patch('products.summary_cache.cache',SummaryCache()) as cache:
            connection.in_atomic_block=False;connection.get_autocommit.return_value=True
            connection.settings_dict={'NAME':'db-a'}
            principal=Principal('a@example.invalid','A','admin',None)
            calls=[]
            def load():calls.append(1);return {'rows':[1]}
            def read(p=principal,o=options,s='v1'):return cached_base(p,o,s,load,lambda:None)
            read();read();self.assertEqual(len(calls),1)
            read(Principal('b@example.invalid','B','admin',None));read(Principal(principal.email,'A','viewer',None))
            read(o={**options,'startDate':'2026-09-02'});read(s='v2')
            connection.settings_dict={'NAME':'db-b'};read()
            self.assertEqual(len(calls),6)
            connection.in_atomic_block=True;read();read();self.assertEqual(len(calls),8)
            connection.in_atomic_block=False;connection.get_autocommit.return_value=False
            read();read();self.assertEqual(len(calls),10)
