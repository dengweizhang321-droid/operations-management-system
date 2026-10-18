"""Real finite history, including both reviewed Tmall parent variants."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import bi_app_addition as common
import pi_agent_addition as pi
from schema_proof_fixture import ProofChain
from schema_proof_probe import probe


class SchemaProofFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="schema-proof-flow-")
        cls.chain = ProofChain(Path(__file__).resolve().parents[1], cls.temp.name)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_all_ancestors_once_and_each_public_call_is_fresh(self):
        chain = self.chain
        for _ in range(2):
            result = probe(chain.root, chain.runtime)
            self.assertEqual(result["result"]["migrationCount"], 150)
            self.assertEqual(result["original139"], 1)
        receipt, plan, folder, base = pi._verify_active_with_base(chain.root, chain.runtime)
        self.assertIsInstance(base, frozenset)
        self.assertEqual(len(base), 149)
        self.assertEqual(len(pi.verify_active(chain.root, chain.runtime)), 3)
        self.assertEqual(len(pi.load_plan(chain.runtime, plan["operationId"])), 2)
        with self.assertRaises(AttributeError):
            base.add("poison")
        self.assertEqual(receipt["migrationCount"], 150)

    def test_each_pointer_plan_receipt_source_tmp_and_duplicate_are_rejected(self):
        c = self.chain
        for module in c.modules:
            generation = next(g for g, folder in c.folders.items() if folder == module.directory(c.runtime, f"{g:032x}"))
            folder = c.folders[generation]
            for file in (c.runtime / module.ACTIVE, folder / "plan.json", folder / "finalized.json"):
                original = file.read_bytes()
                try:
                    file.write_bytes(b'{"status":"wrong","status":"duplicate"}')
                    with self.assertRaises((ValueError, RuntimeError, KeyError)):
                        pi.verify_active(c.root, c.runtime)
                finally:
                    file.write_bytes(original)
                self.assertEqual(pi.verify_active(c.root, c.runtime)[0]["migrationCount"], 150)
            migration = next((folder / "baseline/backend").glob("*/migrations/*.py"))
            original = migration.read_bytes()
            try:
                migration.write_bytes(original + b"\n# private changed source\n")
                with self.assertRaises((ValueError, RuntimeError)):
                    pi.verify_active(c.root, c.runtime)
            finally:
                migration.write_bytes(original)
            if hasattr(module, "load_plan"):
                temporary = folder / "interrupted.tmp"
                temporary.write_bytes(b"partial")
                try:
                    with self.assertRaises(ValueError):
                        pi.verify_active(c.root, c.runtime)
                finally:
                    temporary.unlink()

    def test_installed_branch_checks_its_own_receipt_and_exception_does_not_cache(self):
        c = self.chain
        pointer_file = c.runtime / pi.ACTIVE
        original = pointer_file.read_bytes()
        try:
            pointer = common.read(pointer_file)
            pointer["receiptSha256"] = common.sha(c.folders[150] / "installed.json")
            pointer_file.write_bytes(common.canonical(pointer))
            self.assertEqual(pi.verify_active(c.root, c.runtime, installed=True)[0]["status"], "schema_installed")
            with self.assertRaises(ValueError):
                pi.verify_active(c.root, c.runtime)
        finally:
            pointer_file.write_bytes(original)
        self.assertEqual(probe(c.root, c.runtime)["original139"], 1)

    def test_tmall_147_parent_variant_uses_original_exact_branch(self):
        with tempfile.TemporaryDirectory(prefix="schema-proof-147-") as directory:
            c = ProofChain(Path(__file__).resolve().parents[1], directory, monitoring=False)
            self.assertEqual(probe(c.root, c.runtime)["result"]["migrationCount"], 150)
            self.assertEqual(probe(c.root, c.runtime)["original139"], 1)
