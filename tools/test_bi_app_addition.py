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
    def test_migration_package_helpers_cannot_change(self):
        (self.base/"backend/finance/migrations/__init__.py").write_text("# original\n")
        (self.candidate/"backend/finance/migrations/__init__.py").write_text("# changed\n")
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
    def test_parent_verification_disables_child_dispatch(self):
        import integration_release_gate as gate
        original=Path(self.temp.name)/"original"
        with patch.object(gate,"active_delta",return_value={"operationId":"a"*32}),patch.object(gate,"verify_release",return_value={}) as verify,patch("integration_migration_plan.load_policy") as policy:
            policy.return_value.baseline=[str(i) for i in range(138)];policy.return_value.steps=[gate.DELTA_STEP]
            addition.original_parent(self.base,original)
            self.assertEqual(verify.call_args.kwargs,{"allow_addition":False})
    def test_partial_or_tampered_receipt_cannot_admit_startup(self):
        operation="a"*32;folder=addition.directory(self.base,operation);folder.mkdir(parents=True)
        addition.write(self.base/addition.ACTIVE,{"version":addition.VERSION,"operationId":operation,"receiptSha256":"0"*64})
        addition.write(folder/"installed.json",{"status":"schema_installed"})
        with self.assertRaises(ValueError):addition.verify_active(self.candidate,self.base,installed=True)
        with self.assertRaises(ValueError):addition.verify_active(self.candidate,self.base)
    def test_original_138_parent_never_dispatches_to_its_140_child(self):
        import integration_release_gate as gate
        witness={"parentReceiptSha256":"b"*64}
        with patch.object(gate,"validate_baseline_witness",return_value=witness),patch.object(gate,"read_json",return_value=({"operationId":"a"*32},"b"*64)),patch.object(gate,"verify_release",return_value={}) as verify:
            gate.verify_parent_138(self.base,witness)
            self.assertEqual(verify.call_args.kwargs,{"allow_delta":False,"allow_addition":False})

if __name__=="__main__":unittest.main()
