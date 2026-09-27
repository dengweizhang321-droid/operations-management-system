from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from integration_migration_plan import Plan, PlanBlocked
from integration_migration_journal import Journal, apply_one


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = Journal(self.temp.name, "1" * 32)
        self.initial = Plan("a" * 64, "b" * 64, "c" * 64, (),
            ("ai_assistant.0014_business_evidence", "ai_assistant.0015_business_collection"))
        self.journal.initialize(self.initial)
        self.current = self.initial
        self.calls = 0

    def execute(self, step, identity):
        self.calls += 1
        self.assertEqual((step, identity), (self.current.next_step, "owner"))
        self.current = replace(self.current, completed=self.current.completed + (step,),
            remaining=self.current.remaining[1:])

    def test_two_steps_record_exact_outcomes(self):
        for _ in range(2):
            self.assertEqual(apply_one(self.journal, self.current, lambda: self.current,
                self.execute), self.current)
        self.assertEqual(self.calls, 2)
        self.assertEqual(len(self.journal.complete_digest(self.current)), 64)

    def test_response_loss_after_database_commit_never_replays(self):
        def lost(step, identity):
            self.execute(step, identity)
            raise ConnectionError("synthetic lost response")
        with self.assertRaises(ConnectionError):
            apply_one(self.journal, self.initial, lambda: self.current, lost)
        with self.assertRaises(PlanBlocked):
            apply_one(self.journal, self.current, lambda: self.current, self.execute)
        self.assertEqual(self.calls, 1)

    def test_failed_step_with_no_receipt_still_requires_audit(self):
        def fail(*_):
            self.calls += 1
            raise RuntimeError("synthetic transaction rollback")
        with self.assertRaises(RuntimeError):
            apply_one(self.journal, self.initial, lambda: self.current, fail)
        with self.assertRaises(PlanBlocked):
            apply_one(self.journal, self.initial, lambda: self.current, self.execute)
        self.assertEqual(self.calls, 1)

    def test_second_caller_cannot_reserve_same_step(self):
        self.journal.reserve(self.initial)
        other = Journal(self.temp.name, "1" * 32)
        with self.assertRaises(PlanBlocked):
            other.reserve(self.initial)

    def test_changed_source_binding_or_corrupt_journal_blocks_before_execute(self):
        for field in ("source_sha256", "binding_sha256", "policy_sha256"):
            changed = replace(self.initial, **{field: "d" * 64})
            with self.assertRaises(PlanBlocked):
                apply_one(self.journal, changed, lambda: changed, self.execute)
        (Path(self.temp.name) / "operation.json").write_bytes(b'{"incomplete":')
        with self.assertRaises(PlanBlocked):
            apply_one(self.journal, self.initial, lambda: self.initial, self.execute)
        self.assertEqual(self.calls, 0)

    def test_changed_previous_outcome_is_not_accepted_as_a_receipt(self):
        apply_one(self.journal, self.initial, lambda: self.current, self.execute)
        path = Path(self.temp.name) / "000-outcome.json"
        value = json.loads(path.read_text())
        value["afterSha256"] = "0" * 64
        path.write_text(json.dumps(value), encoding="utf-8")
        with self.assertRaises(PlanBlocked):
            apply_one(self.journal, self.current, lambda: self.current, self.execute)
        self.assertEqual(self.calls, 1)


if __name__ == "__main__":
    unittest.main()
