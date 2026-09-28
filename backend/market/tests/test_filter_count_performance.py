"""Exact facet counts must use the already deployed narrow indexes."""
from collections import Counter
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext

from market.errors import MarketApiError
from market.models import MarketRankingEntry, MarketDataRevision
from market.query import _database_options, _load_filter_options


class FacetCountRegressionTests(TestCase):
    def test_exact_duplicate_blank_unicode_and_tie_counts_for_all_facets(self):
        fields = ('category', 'scope', 'brand', 'ranking_dimension', 'operation_mode', 'subcategory')
        values = ('', '中文', 'a', '中文', 'a', 'b', 'a', 'b', '   ', 'a%_')
        rows = []
        for i, value in enumerate(values):
            row = MarketRankingEntry.objects.create(natural_key=f'facet-{i}', source_row_number=i,
                period_start='2026-09-01', period_end='2026-09-01', sku_code=f'sku-{i}',
                last_import_batch_id='synthetic', **dict.fromkeys(fields, value))
            rows.append(row)
        for field in fields:
            counts = Counter(getattr(row, field) for row in rows if getattr(row, field) != '')
            expected = [{'value': value, 'count': count} for value, count in
                        sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(_database_options(MarketRankingEntry.objects.all(), field), expected)
            # Requiring id again silently loses the existing covering facet index.
            self.assertIn('COUNT(*)', captured[0]['sql'])
            self.assertEqual(_database_options(MarketRankingEntry.objects.filter(pk=-1), field), [])

    def test_partial_scan_failure_never_returns_partial_or_zero_options(self):
        from market.query import _database_options as original
        calls = []
        def fail_after_first(queryset, field):
            calls.append(field)
            if len(calls) == 2:
                raise MarketApiError('fixture deadline', status=503, code='query_timeout')
            return original(queryset, field)
        with patch('market.query._database_options', side_effect=fail_after_first):
            with self.assertRaises(MarketApiError):
                _load_filter_options()
        self.assertEqual(calls, ['category', 'scope'])

    def test_local_query_limits_restored_after_success_and_failure(self):
        if connection.vendor != 'postgresql':
            self.skipTest('Requires PostgreSQL SET LOCAL semantics')
        def settings():
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('statement_timeout'),current_setting('max_parallel_workers_per_gather')")
                return cursor.fetchone()
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='1234ms'")
            cursor.execute('SET LOCAL max_parallel_workers_per_gather=1')
        before = settings()
        _load_filter_options()
        self.assertEqual(settings(), before)
        with patch('market.query._database_options', side_effect=RuntimeError('fixture failure')):
            with self.assertRaises(RuntimeError):
                _load_filter_options()
        self.assertEqual(settings(), before)


class FacetRevisionRegressionTests(TransactionTestCase):
    def test_committed_fact_change_and_revision_rebuild_exact_counts(self):
        from market import filter_cache
        from market.query import filter_options
        from market.revisions import bump_revision
        from django.db import transaction
        MarketDataRevision.objects.update_or_create(domain='market', defaults={
            'revision': 0, 'source_digest': 'a'*64})
        with patch.object(filter_cache, 'cache', filter_cache.FilterCache()):
            self.assertEqual(filter_options()['categories'], [])
            with transaction.atomic():
                MarketRankingEntry.objects.create(natural_key='changed', source_row_number=1,
                    period_start='2026-09-01', period_end='2026-09-01', sku_code='synthetic',
                    category='新增类目', last_import_batch_id='synthetic')
                bump_revision({'fixture': 'new fact'})
            self.assertEqual(filter_options()['categories'], [{'value': '新增类目', 'count': 1}])
            with transaction.atomic():
                MarketRankingEntry.objects.all().delete()
                bump_revision({'fixture': 'removed fact'})
            self.assertEqual(filter_options()['categories'], [])
