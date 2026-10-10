import unittest
from copy import deepcopy
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path

spec = spec_from_file_location('history_fixtures', Path(__file__).with_name('release-history-preservation.test.py'))
fixtures = module_from_spec(spec)
spec.loader.exec_module(fixtures)
history = fixtures.history


class IndependentHistoryReview(unittest.TestCase):
    def test_reimport_does_not_exempt_immutable_migration_generation(self):
        original = fixtures.row()
        original['migration_generation'] = 'synthetic-original-migration'
        changed = deepcopy(original)
        changed.update(customer_alias='synthetic-new', version=2, last_import_batch_id='new',
                       updated_at='2026-10-09T01:02:36Z', migration_generation='synthetic-replaced-migration')
        before, after = fixtures.capture([original]), fixtures.capture([changed], True)
        witness = fixtures.source(before['rows'][0], after['rows'][0], 'reimport')
        self.assertEqual(history.compare(before, after, [witness], fixtures.RECEIPTS)['status'], 'failed')
        changed['migration_generation'] = original['migration_generation']
        control = fixtures.capture([changed], True)
        valid_witness = fixtures.source(before['rows'][0], control['rows'][0], 'reimport')
        self.assertEqual(history.compare(before, control, [valid_witness], fixtures.RECEIPTS)['status'], 'passed')

    def test_prebaseline_addition_does_not_become_legal_at_maintenance_cutoff(self):
        original, added = fixtures.row(), fixtures.row(2)
        added.update(created_at='2026-10-08T23:59:59Z', updated_at='2026-10-08T23:59:59Z',
                     first_import_batch_id='new', last_import_batch_id='new')
        before, after = fixtures.capture([original]), fixtures.capture([original, added], True)
        witness = fixtures.source(None, after['rows'][1], 'addition')
        self.assertEqual(history.compare(before, after, [witness], fixtures.RECEIPTS)['status'], 'failed')

    def test_addition_at_snapshot_boundary_is_legal_only_with_exact_source(self):
        original, added = fixtures.row(), fixtures.row(2)
        added.update(created_at=fixtures.CUT, updated_at=fixtures.CUT, first_import_batch_id='new', last_import_batch_id='new')
        before, after = fixtures.capture([original]), fixtures.capture([original, added], True)
        self.assertEqual(history.compare(before, after)['status'], 'failed')
        witness = fixtures.source(None, after['rows'][1], 'addition')
        self.assertEqual(history.compare(before, after, [witness], fixtures.RECEIPTS)['status'], 'passed')

    def test_duplicate_source_witnesses_do_not_make_ambiguous_provenance_pass(self):
        changed = fixtures.row()
        changed.update(version=2, last_import_batch_id='new', updated_at='2026-10-09T01:02:36Z')
        before, after = fixtures.capture([fixtures.row()]), fixtures.capture([changed], True)
        witness = fixtures.source(before['rows'][0], after['rows'][0], 'reimport')
        self.assertEqual(history.compare(before, after, [witness, deepcopy(witness)], fixtures.RECEIPTS)['status'], 'failed')

    def test_source_receipt_labels_without_original_matching_bytes_are_unproven(self):
        changed = fixtures.row()
        changed.update(version=2, last_import_batch_id='new', updated_at='2026-10-09T01:02:36Z')
        before, after = fixtures.capture([fixtures.row()]), fixtures.capture([changed], True)
        witness = fixtures.source(before['rows'][0], after['rows'][0], 'reimport')
        self.assertEqual(history.compare(before, after, [witness])['status'], 'failed')
        bad_receipts = {witness['source']['independentReceiptSha256']: b'synthetic-corrupt-original'}
        self.assertEqual(history.compare(before, after, [witness], bad_receipts)['status'], 'failed')
        self.assertEqual(history.compare(before, after, [witness], fixtures.RECEIPTS)['status'], 'passed')


if __name__ == '__main__':
    unittest.main()
