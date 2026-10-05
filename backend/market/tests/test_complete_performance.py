from django.db import connection
from django.test import SimpleTestCase, TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from types import SimpleNamespace
from unittest.mock import patch

from market.admin import _image_summary, master_workspace
from market.models import MarketImageCache, MarketRankingEntry
from market.query import _preferred_rows, item_trend, validate_filters
from market.filter_cache import FilterCache, cached_filters
from market import query
from market.models import MarketDataRevision
from django.db import transaction


class CompleteMarketReadTests(TestCase):
    def row(self, number, **values):
        return MarketRankingEntry.objects.create(natural_key=f'perf-{number}',
            source_row_number=number, period_start=f'{2020+number//12:04d}-{number%12+1:02d}-01',
            period_end=f'{2020+number//12:04d}-{number%12+1:02d}-28', category='隔离类目',
            scope='all', ranking_dimension='SKU', sku_code='same', last_import_batch_id='fixture',
            raw_json={'large':'x'*4000}, **values)

    def test_trend_counts_all_months_but_materializes_only_display_window(self):
        for number in range(84):
            self.row(number)
        # Same code in another category is outside the full identity history.
        MarketRankingEntry.objects.create(natural_key='other', source_row_number=999,
            period_start='2030-01-01',period_end='2030-01-31', category='其他',
            scope='all',sku_code='same',last_import_batch_id='fixture')
        with CaptureQueriesContext(connection) as captured:
            result = item_trend({'operation':'trend','skuCode':'same','category':'隔离类目',
                'scope':'all','rankingDimension':'SKU'})
        self.assertEqual(result['totalMonths'],84)
        self.assertTrue(result['truncated'])
        self.assertEqual(len(result['items']),60)
        self.assertEqual(result['items'][0]['periodEnd'],'2026-12-28')
        statements = [q['sql'] for q in captured if 'market_ranking_entries' in q['sql']]
        self.assertEqual(len(statements),2)
        self.assertIn('COUNT(DISTINCT',statements[0])
        self.assertIn('LIMIT 60',statements[1])
        self.assertNotIn('raw_json',statements[1])

    def test_report_preference_is_preserved_without_raw_payload(self):
        self.row(0,price_band_filter='全部')
        other = self.row(12,price_band_filter='低价')
        other.period_start='2020-01-01'
        other.period_end='2020-01-28'
        other.save(update_fields=['period_start','period_end'])
        with CaptureQueriesContext(connection) as captured:
            result = _preferred_rows(validate_filters({}))
        self.assertEqual(len(result),1)
        self.assertEqual(result[0].price_band_filter,'全部')
        self.assertIn('raw_json',result[0].get_deferred_fields())
        self.assertFalse(any('raw_json' in q['sql'] for q in captured))

    def test_image_counts_include_unknown_states_and_empty_collection(self):
        self.assertEqual(_image_summary(),{'total':0,'cached':0,'failed':0,'pending':0})
        for n,status in enumerate(['ready','ready','failed','pending','unknown']):
            MarketImageCache.objects.create(source_url=f'https://example.invalid/{n}',status=status)
        with CaptureQueriesContext(connection) as captured:
            self.assertEqual(_image_summary(),{'total':5,'cached':2,'failed':1,'pending':2})
        self.assertEqual(len(captured),1)
        self.assertIn('GROUP BY',captured[0]['sql'])

    def test_non_data_workspace_skips_unused_full_coverage(self):
        self.row(0)
        with CaptureQueriesContext(connection) as captured:
            result = master_workspace({'section':'mapping'})
        self.assertEqual(result['coverage'],[])
        self.assertFalse(any('month_min' in q['sql'] for q in captured))
        self.assertTrue(master_workspace({'section':'data'})['coverage'])


class ScalarCacheFenceTests(SimpleTestCase):
    def test_scalar_shares_revision_role_database_and_transaction_guards(self):
        db = SimpleNamespace(in_atomic_block=False, get_autocommit=lambda:True,
            settings_dict={'ENGINE':'test','HOST':'127.0.0.1','PORT':'55523','NAME':'private','USER':'reader-a'})
        store = FilterCache(maximum_bytes=256)
        calls=[]
        def load():
            calls.append(1)
            return len(calls)
        with patch('market.filter_cache.connection',db), patch('market.filter_cache.revision_value',return_value='1:a'):
            self.assertEqual(cached_filters(load,cache_store=store),1)
            self.assertEqual(cached_filters(load,cache_store=store),1)
            db.settings_dict['USER']='reader-b'
            self.assertEqual(cached_filters(load,cache_store=store),2)
            db.settings_dict['NAME']='another'
            self.assertEqual(cached_filters(load,cache_store=store),3)
            db.in_atomic_block=True
            self.assertEqual(cached_filters(load,cache_store=store),4)
            db.in_atomic_block=False
            self.assertEqual(cached_filters(load,cache_store=store),3)
        with patch('market.filter_cache.connection',db), patch('market.filter_cache.revision_value',return_value='2:b'):
            self.assertEqual(cached_filters(load,cache_store=store),5)

    def test_scalar_capacity_is_separately_bounded_without_changing_filter_limit(self):
        store = FilterCache(maximum_bytes=256)
        store.read(('db','rev'),lambda:1000000,lambda:'rev')
        self.assertIsNotNone(store.entry)
        store.read(('db','rev2'),lambda:'x'*256,lambda:'rev2')
        self.assertIsNone(store.entry)
        self.assertEqual(FilterCache().maximum_bytes,2*1024*1024)


class ScalarCacheApplicationTests(TransactionTestCase):
    available_apps=['market']

    def test_fact_revision_invalidates_total_but_live_image_state_is_not_cached(self):
        MarketDataRevision.objects.update_or_create(domain='market',defaults={'revision':1,'source_digest':'a'*64})
        def add(number):
            return MarketRankingEntry.objects.create(natural_key=f'cached-{number}',source_row_number=number,
                period_start='2026-01-01',period_end='2026-01-31',category='cache',scope='all',
                sku_code=f'sku-{number}',image_url=f'https://example.invalid/{number}',last_import_batch_id='fixture')
        add(1)
        principal = SimpleNamespace(email='fixture@example.invalid',role='admin',scope=None)
        def sales(_principal,request):
            return {'rows':[{'productCode':code,'owned':False,'ownSalesCents':0} for code in request['productCodes']]},'1:test'
        def read():
            return query.overview(principal,{'operation':'overview','view':'ranking','page':1,'pageSize':20,
                'filters':{},'includeFilterOptions':False},sales_loader=sales)
        with patch('market.query._image_total_cache',FilterCache(maximum_bytes=256)):
            self.assertEqual(read()['imageCache']['total'],1)
            MarketImageCache.objects.create(source_url='https://example.invalid/1',status='ready')
            with CaptureQueriesContext(connection) as captured:
                result=read()
            self.assertEqual(result['imageCache']['cached'],1)
            self.assertFalse(any('SELECT DISTINCT' in q['sql'] and 'image_url' in q['sql'] for q in captured))
            with transaction.atomic():
                add(2)
                self.assertEqual(read()['imageCache']['total'],2)
                transaction.set_rollback(True)
            self.assertEqual(read()['imageCache']['total'],1)
            add(2)
            MarketDataRevision.objects.filter(domain='market').update(revision=2,source_digest='b'*64)
            self.assertEqual(read()['imageCache']['total'],2)
