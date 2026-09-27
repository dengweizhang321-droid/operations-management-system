from dataclasses import replace
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from integration_migration_plan import (
    PlanBlocked, PRIVILEGED_STEPS, build_plan, confirm_single_step, load_policy,
    python_source_sha256)


class IntegrationPlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy = load_policy(ROOT / "config/integration-migration-policy-v1.json")

    def setUp(self):
        import hashlib
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "backend").mkdir()
        (self.root / "tools").mkdir()
        (self.root / "backend/source.py").write_bytes(b"# synthetic source\n")
        self.policy = replace(self.policy, files=(("backend/source.py",
            hashlib.sha256(b"# synthetic source\n").hexdigest()),))

    def plan(self, prefix=0, *, applied=None, pending=None, binding="a" * 64):
        applied = (applied if applied is not None else [key.split(".", 1)
            for key in self.policy.baseline + self.policy.steps[:prefix]])
        pending = (pending if pending is not None else [(*key.split(".", 1), False)
            for key in self.policy.steps[prefix:]])
        return build_plan(self.policy, self.root, applied, pending, binding)

    def test_exact_prefix_chooses_only_the_reviewed_privileged_steps(self):
        for index, name in enumerate(self.policy.steps):
            with self.subTest(name=name):
                current = self.plan(index)
                self.assertEqual(current.next_step, name)
                self.assertEqual(current.next_identity,
                    "privileged" if name in PRIVILEGED_STEPS else "owner")
        self.assertIsNone(self.plan(74).next_identity)

    def test_missing_duplicate_unknown_and_gap_receipts_are_rejected(self):
        base = [key.split(".", 1) for key in self.policy.baseline]
        for changed in (base[1:], base + [base[0]], base + [["ai_assistant", "0081_unknown"]],
                base + [self.policy.steps[1].split(".", 1)]):
            with self.assertRaises(PlanBlocked):
                self.plan(applied=changed)

    def test_reverse_extra_reordered_and_partial_plans_are_rejected(self):
        pending = [(*key.split(".", 1), False) for key in self.policy.steps]
        for changed in ([(*pending[0][:2], True), *pending[1:]], pending[1:],
                [pending[1], pending[0], *pending[2:]], pending + [("x", "0001_extra", False)]):
            with self.assertRaises(PlanBlocked):
                self.plan(pending=changed)

    def test_one_committed_step_is_required_without_automatic_replay(self):
        self.assertTrue(confirm_single_step(self.plan(0), self.plan(1)))
        for after in (self.plan(0), self.plan(2), self.plan(1, binding="b" * 64)):
            with self.assertRaises(PlanBlocked):
                confirm_single_step(self.plan(0), after)

    def test_source_modification_or_new_importable_file_blocks_before_plan(self):
        before = self.plan()
        (self.root / "tools/unreviewed.py").write_text("# extra", encoding="utf-8")
        with self.assertRaises(PlanBlocked):
            self.plan()
        (self.root / "tools/unreviewed.py").unlink()
        (self.root / "backend/source.py").write_text("# changed", encoding="utf-8")
        with self.assertRaises(PlanBlocked):
            self.plan()
        self.assertEqual(len(before.sha256), 64)

    def test_binding_changes_and_missing_binding_cannot_reuse_approval(self):
        self.assertNotEqual(self.plan().sha256, self.plan(binding="b" * 64).sha256)
        for binding in ("", "A" * 64, None, True):
            with self.assertRaises(PlanBlocked):
                self.plan(binding=binding)

    def test_policy_rejects_alternate_stream_paths_and_duplicate_keys(self):
        with self.assertRaises(PlanBlocked):
            replace(self.policy, files=(("backend/source.py:other.py", "a" * 64),))
        path = self.root / "policy.json"
        path.write_text('{"version":"x","version":"y"}', encoding="utf-8")
        with self.assertRaises(PlanBlocked):
            load_policy(path)

    def test_git_line_endings_preserve_python_semantics_but_not_literal_changes(self):
        source = b'payload = """one\ntwo"""\n'
        windows = source.replace(b"\n", b"\r\n")
        self.assertEqual(python_source_sha256(source), python_source_sha256(windows))
        first, second = {}, {}
        exec(compile(source, "synthetic-lf", "exec"), first)
        exec(compile(windows, "synthetic-crlf", "exec"), second)
        self.assertEqual(first["payload"], second["payload"])
        self.assertNotEqual(python_source_sha256(source),
            python_source_sha256(source.replace(b"two", b"other")))


if __name__ == "__main__":
    unittest.main()
