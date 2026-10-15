"""Synthetic end-to-end cycle codec checks, never an operating database."""
import os
from pathlib import Path
import sys
import unittest

os.environ.pop('TERUISI_DJANGO_DATABASE_URL', None)
os.environ.update(TERUISI_DJANGO_SQLITE_PATH=':memory:', TERUISI_DJANGO_ENVIRONMENT='test', TERUISI_DJANGO_PROCESS_ROLE='development', DJANGO_SETTINGS_MODULE='teruisi_backend.settings')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import django
django.setup()
from django.db import connection
from inventory import jd_logistics as service
from inventory.tests.test_jd_inventory_health import warehouse
from jd_cycle_projection import MAX_CYCLE, warehouse_cycles, member_cycles, mask_events, event_value
from integer_series_codec import decode


class CycleProjectionTests(unittest.TestCase):
    def test_all_days_match_domain_for_known_unknown_zero_and_fractional_demand(self):
        self.assertEqual((connection.vendor, str(connection.settings_dict['NAME'])), ('sqlite', ':memory:'))
        cases = [
            {'demand': 1, 'available': 2, 'purchase': 1},
            {'demand': 31, 'available': 0},
            {'demand': 0, 'available': -3},
            {'demand': 30, 'available': 1, 'transfer': 40},
            {'demand': 30, 'available': 5000, 'on_hand': 6000},
            {'demand': None},
            {'demand': -1},
            {'date_reasons': ['source_date_mismatch']},
        ]
        rows = [{**warehouse(**args), 'id':str(index), 'departmentId':'fixture', 'goodsCode':str(index // 2), 'warehouseKey':str(index % 2)} for index, args in enumerate(cases)]
        groups = warehouse_cycles(service, rows)
        memberships = [rows[:5], rows, [], [rows[5]], rows[::2]]
        encoded = [member_cycles(service, members, groups) for members in memberships]
        values = [decode(group['quantitySeries'], MAX_CYCLE) for group in encoded]
        masks = mask_events(service, rows, groups, ['0', '1'], {str(index):index for index in range(4)})
        for cycle in range(1, MAX_CYCLE + 1):
            fresh = [{**row, **warehouse(cycle=cycle, **args)} for row, args in zip(rows, cases)]
            by_id = {row['id']:row for row in fresh}
            for position, members in enumerate(memberships):
                expected_rows = [by_id[row['id']] for row in members]
                expected = service._aggregate_metrics(expected_rows, 30)
                self.assertEqual(values[position][cycle-1], expected['suggestedReplenishmentQuantity'])
                self.assertEqual(encoded[position]['reasons'], expected['metricQualifications']['suggestedReplenishmentQuantity'])
                self.assertEqual(event_value(encoded[position]['healthEvents'], cycle), service._aggregate_inventory_health(expected_rows))
            for warehouse_key, events in masks.items():
                scoped = [row for row in fresh if not warehouse_key or row['warehouseKey'] == warehouse_key]
                for state, value in event_value(events, cycle, 'values').items():
                    selected, _counts, _tabs = service._health_filter_scope(scoped, state)
                    self.assertEqual(value, format(sum(1 << int(code) for code in {row['goodsCode'] for row in selected}), 'x'))


if __name__ == '__main__':
    unittest.main()
