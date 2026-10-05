import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import bi_app_addition as addition

ROOT=Path(__file__).resolve().parents[1]

class FiniteAdditionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)/"base";self.candidate=Path(self.temp.name)/"candidate"
        (self.base/"backend/finance/migrations").mkdir(parents=True)
        (self.base/"backend/finance/migrations/0006_base.py").write_text("# unchanged\n")
        shutil.copytree(self.base,self.candidate)
        shutil.copyfile(ROOT/addition.FILE,self.candidate/addition.FILE)
    def test_only_exact_reviewed_step_is_accepted(self):
        self.assertEqual(len(addition.source_delta(self.candidate,self.base)),64)
    def test_existing_migration_rewrite_is_rejected(self):
        (self.candidate/"backend/finance/migrations/0006_base.py").write_text("# rewritten\n")
        with self.assertRaises(ValueError):addition.source_delta(self.candidate,self.base)
    def test_missing_existing_migration_is_rejected(self):
        (self.candidate/"backend/finance/migrations/0006_base.py").unlink()
        with self.assertRaises(ValueError):addition.source_delta(self.candidate,self.base)
    def test_second_addition_and_changed_step_are_rejected(self):
        (self.candidate/"backend/finance/migrations/0008_extra.py").write_text("# extra\n")
        with self.assertRaises(ValueError):addition.source_delta(self.candidate,self.base)
        (self.candidate/"backend/finance/migrations/0008_extra.py").unlink()
        (self.candidate/addition.FILE).write_text("# changed\n")
        with self.assertRaises(ValueError):addition.source_delta(self.candidate,self.base)
    def test_evidence_hash_duplicate_and_operation_escape_are_rejected(self):
        path=Path(self.temp.name)/"e.json";path.write_text('{"x":1,"x":2}')
        with self.assertRaises(ValueError):addition.read(path)
        with self.assertRaises(ValueError):addition.read(path,"0"*64)
        with self.assertRaises(ValueError):addition.directory(self.base,"../escape")
    def test_parent_generation_not_overwritten_by_release_dispatch(self):
        import integration_release_gate as gate
        self.assertEqual(gate.DELTA_STEP,"netshop.0004_promotion_presence_cache")
        self.assertEqual(addition.STEP,"finance.0007_finance_erp_targets")

if __name__=="__main__":unittest.main()
