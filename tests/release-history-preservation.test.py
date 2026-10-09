import importlib.util
import unittest
import hashlib
from copy import deepcopy
from pathlib import Path

spec = importlib.util.spec_from_file_location("history", Path(__file__).parents[1] / "tools/release-history-preservation.py")
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)
SCOPE = {"domain": "customer-service", "shopNames": ["synthetic-shop"], "startInclusive": "2026-10-01 00:00:00", "endExclusive": "2026-10-08 00:00:00", "timezone": "Asia/Shanghai"}
KEY = b"synthetic-only-key-never-for-production-000"
CUT = "2026-10-09T00:00:00Z"
AFTER = "2026-10-09T03:00:00Z"
WITNESS = {"reader": "teruisi_customer_service_reader", "readOnly": True, "isolation": "repeatable read", "snapshot": "synthetic:1:1"}
RECEIPTS = {}


def row(identifier=1):
    result = dict.fromkeys(history.FIELDS, "")
    result.update(id=identifier, conversation_key=f"synthetic-{identifier}", shop_name="synthetic-shop", consulted_at="2026-10-07 23:59:59", first_import_batch_id="old", last_import_batch_id="old", version=1, created_at="2026-10-08T23:00:00Z", updated_at="2026-10-08T23:00:00Z", messages=[])
    return result


def capture(rows, after=False, cutoff=CUT):
    return history.fingerprint_rows(rows, SCOPE, KEY, cutoff, AFTER if after else CUT, WITNESS)


def source(before, after, kind):
    witness = {"id": after["id"], "kind": kind, "beforeDigest": before["rowDigest"] if before else None, "afterDigest": after["rowDigest"],
            "source": {"batchId": "new", "status": "completed", "shopName": "synthetic-shop", "startInclusive": SCOPE["startInclusive"], "endExclusive": SCOPE["endExclusive"], "rawFileSha256": "a" * 64, "contentSha256": "b" * 64, "independentReceiptSha256": "c" * 64, "executionId": "synthetic-execution", "completedAt": "2026-10-09T01:03:00Z"}}
    raw = history.canonical({"version": "teruisi-source-transition-v1", "independent": True, "source": {k:v for k,v in witness["source"].items() if k != "independentReceiptSha256"}, "transitions": [{k:v for k,v in witness.items() if k != "source"}]}).encode()
    digest = hashlib.sha256(raw).hexdigest(); RECEIPTS[digest] = raw; witness["source"]["independentReceiptSha256"] = digest
    return witness


class HistoryTests(unittest.TestCase):
    def test_fixed_snapshot_equal_and_no_customer_values(self):
        original = row(); original["customer_alias"] = "synthetic-sensitive-text"
        before = capture([original]); after = capture([original], True)
        self.assertEqual(history.compare(before, after)["status"], "passed")
        self.assertNotIn("synthetic-sensitive-text", history.canonical(before))
        self.assertNotIn(original["conversation_key"], history.canonical(before))

    def test_legal_premaintenance_addition_requires_source(self):
        added = row(2); added.update(created_at="2026-10-09T01:02:36Z", updated_at="2026-10-09T01:02:36Z", first_import_batch_id="new", last_import_batch_id="new")
        before, after = capture([row()]), capture([row(), added], True)
        self.assertEqual(history.compare(before, after)["status"], "failed")
        witness = source(None, after["rows"][1], "addition")
        self.assertEqual(history.compare(before, after, [witness])["status"], "failed")
        result = history.compare(before, after, [witness], RECEIPTS)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["beforeCount"], result["afterCount"])
        self.assertEqual(len(result["legalTransitions"]), 1)

    def test_equal_counts_cannot_hide_delete_and_replacement(self):
        before, after = capture([row()]), capture([row(2)], True)
        result = history.compare(before, after)
        self.assertEqual(result["count"], "equal")
        self.assertEqual(result["primaryKeys"], "changed")
        self.assertEqual(result["removedIds"], ["1"])
        self.assertEqual(result["status"], "failed")

    def test_delete_always_fails(self):
        self.assertEqual(history.compare(capture([row()]), capture([], True))["status"], "failed")

    def test_same_id_new_business_identity_fails(self):
        changed = row(); changed["conversation_key"] = "replaced"
        self.assertEqual(history.compare(capture([row()]), capture([changed], True))["primaryKeys"], "changed")

    def test_legal_reimport_preserves_annotations_but_reports_changed_content(self):
        changed = row(); changed.update(customer_alias="synthetic-new", version=2, last_import_batch_id="new", updated_at="2026-10-09T01:02:36Z")
        before, after = capture([row()]), capture([changed], True)
        self.assertEqual(history.compare(before, after)["status"], "failed")
        witness = source(before["rows"][0], after["rows"][0], "reimport")
        result = history.compare(before, after, [witness], RECEIPTS)
        self.assertEqual(result["status"], "passed")
        self.assertFalse(result["strictBusinessContentPreserved"])
        self.assertEqual(result["businessContent"], "changed")
        for key, value in [("batchId", "wrong"), ("shopName", "other"), ("contentSha256", None), ("status", "processing"), ("completedAt", "2026-10-08T23:00:00Z"), ("endExclusive", "2026-10-07 00:00:00")]:
            bad = deepcopy(witness); bad["source"][key] = value
            self.assertEqual(history.compare(before, after, [bad], RECEIPTS)["status"], "failed")

    def test_reimport_must_not_ignore_annotation_change(self):
        changed = row(); changed.update(summary_text="synthetic-summary", version=2, last_import_batch_id="new", updated_at="2026-10-09T01:02:36Z")
        before, after = capture([row()]), capture([changed], True)
        self.assertEqual(history.compare(before, after, [source(before["rows"][0], after["rows"][0], "reimport")], RECEIPTS)["status"], "failed")

    def test_left_closed_right_open_business_boundaries(self):
        original = row(); original["consulted_at"] = SCOPE["startInclusive"]
        capture([original])
        original["consulted_at"] = SCOPE["endExclusive"]
        with self.assertRaises(ValueError): capture([original])

    def test_creation_cutoff_is_exclusive_and_same_on_both_sides(self):
        exact = row(); exact.update(created_at=CUT, updated_at=CUT)
        self.assertEqual(history.compare(capture([exact]), capture([exact], True))["beforeCount"], 0)
        with self.assertRaises(ValueError): history.compare(capture([row()]), capture([row()], True, "2026-10-09T01:25:00Z"))

    def test_missing_baseline_is_unprovable_and_never_backfilled(self):
        self.assertEqual(history.compare({"total": 3299}, capture([row()], True))["status"], "unprovable")

    def test_tamper_and_key_mismatch_fail(self):
        before = capture([row()]); before["rows"][0]["id"] = "7"
        with self.assertRaises(ValueError): history.compare(before, capture([row()], True))
        after = history.fingerprint_rows([row()], SCOPE, b"different-256-bit-key-0000000000000", CUT, AFTER, WITNESS)
        with self.assertRaises(ValueError): history.compare(capture([row()]), after)

    def test_readonly_privilege_checks_and_rollback(self):
        class Cursor:
            def __init__(self): self.commands = []
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def execute(self, sql, params=None): self.commands.append((sql, params))
            def fetchone(self): return ("wrong-reader", "on", "repeatable read", CUT, "1:1", False)
        class Connection:
            def __init__(self): self.value = Cursor()
            def cursor(self): return self.value
        connection = Connection()
        with self.assertRaises(ValueError): history.capture(connection, SCOPE, KEY)
        self.assertEqual(connection.value.commands[-1][0], "ROLLBACK")
        self.assertIn("READ ONLY", connection.value.commands[0][0])


if __name__ == "__main__": unittest.main()
