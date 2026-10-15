"""Exact finite-generation boundaries; synthetic files and catalogues only."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import ai_schedule_addition as addition
import ai_schedule_addition_catalog as catalog
import bi_app_addition as common
import jackyun_audit_addition as parent

ROOT = Path(__file__).resolve().parents[1]


class CatalogueCursor:
    def __init__(self, installed, broken=None):
        self.installed, self.broken = installed, broken
    def execute(self, query, args=None):
        table = args[0].split(".")[-1]
        if "FROM pg_attribute" in query:
            self.rows = sorted((name, kind, True, False, "", "") for name, kind in catalog.COLUMNS[table].items()) if self.installed else []
            if self.rows and self.broken == "nullable":
                self.rows[0] = (*self.rows[0][:2], False, False, "", "")
            if self.rows and self.broken == "default":
                self.rows[0] = (*self.rows[0][:3], True, "", "")
        elif "FROM pg_constraint" in query:
            self.rows = [(name, "c", True, False, False, definition) for name, definition in sorted(catalog.CONSTRAINTS[table].items())] if self.installed else []
            if self.rows and self.broken == "weakened":
                self.rows[0] = (*self.rows[0][:-1], "CHECK (true)")
            if self.rows and self.broken == "unvalidated":
                self.rows[0] = (*self.rows[0][:2], False, *self.rows[0][3:])
        else:
            raise AssertionError(query)
    def fetchall(self):
        return self.rows


class ScheduleAdditionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / "base"
        self.root = Path(self.temp.name) / "candidate"
        (self.base / "backend/ai_assistant/migrations").mkdir(parents=True)
        (self.base / "backend/ai_assistant/migrations/0082_original.py").write_text("# synthetic parent\n")
        shutil.copytree(self.base, self.root)
        for file in catalog.FILES:
            shutil.copyfile(ROOT / file, self.root / file)
        def tables(cursor):
            value = copy.deepcopy(catalog.REFERENCE142)
            if cursor.installed:
                from postgres_restore_semantics import normalize_dump_expression
                for table, columns in catalog.COLUMNS.items():
                    value[table]["columns"] += [[name, kind, True, None, "", "", '"default"'] for name, kind in columns.items()]
                    value[table]["constraints"] += [[name, "c", True, False, False, normalize_dump_expression(expression)] for name, expression in catalog.CONSTRAINTS[table].items()]
                    value[table]["constraints"].sort(key=lambda row: row[0])
            return value
        self.enterContext(patch.object(catalog, "inspect_tables", side_effect=tables))
        self.enterContext(patch.object(catalog, "inspect_functions", return_value=catalog.REFERENCE_FUNCTIONS))

    def rows(self):
        return {name: {"columns": ["id"], "rows": 2, "sha256": "a" * 64} for name in catalog.COLUMNS}

    def test_source_accepts_only_exact_0083_and_unchanged_parent(self):
        original = addition.source_delta(self.root, self.base)
        file = self.root / next(iter(catalog.FILES))
        raw = file.read_bytes().replace(b"\r\n", b"\n")
        file.write_bytes(raw.replace(b"\n", b"\r\n"))
        self.assertEqual(addition.source_delta(self.root, self.base), original)
        for relative in ("backend/ai_assistant/migrations/0084_unknown.py", "backend/ai_assistant/migrations/0082_original.py", next(iter(catalog.FILES))):
            target = self.root / relative
            before = target.read_bytes() if target.exists() else None
            target.write_text("# changed\n")
            with self.assertRaises(ValueError): addition.source_delta(self.root, self.base)
            target.unlink() if before is None else target.write_bytes(before)

    def test_catalogue_checks_columns_defaults_and_complete_check_semantics(self):
        catalog.verify_catalog(CatalogueCursor(False), installed=False)
        catalog.verify_catalog(CatalogueCursor(True), installed=True)
        for installed, actual, broken in [(False, True, None), (True, False, None),
                (True, True, "nullable"), (True, True, "default"), (True, True, "weakened"), (True, True, "unvalidated")]:
            with self.subTest(installed=installed, broken=broken), self.assertRaises(ValueError):
                catalog.verify_catalog(CatalogueCursor(actual, broken), installed=installed)

    def test_complete_baseline_table_guard_acl_and_index_drift_is_rejected(self):
        for section, operation in [
            ("columns", lambda rows: rows.pop(1)), ("columns", lambda rows: rows.append(["extra", "text", False, None, "", "", '"default"'])),
            ("triggers", lambda rows: rows.pop()), ("acl", lambda rows: rows.append(["teruisi_ai_reader", "UPDATE", False])),
            ("indexes", lambda rows: rows[0].__setitem__(1, False)), ("policies", lambda rows: rows.append(["new-policy"]))]:
            value = copy.deepcopy(catalog.REFERENCE142)
            operation(value["ai_dingtalk_schedules"][section])
            with self.subTest(section=section), patch.object(catalog, "inspect_tables", return_value=value), self.assertRaises(ValueError):
                catalog.verify_catalog(CatalogueCursor(False), installed=False)

    def test_parent_verification_uses_fixed_142_baseline_without_child_dispatch(self):
        folder = self.base / "original-audit"
        with patch.object(parent, "verify_active", return_value=({"migrationCount": 142}, {}, folder)) as verify, \
                patch.object(parent, "parent_proof", return_value=({str(i) for i in range(140)}, "b" * 64)) as original, \
                patch.object(common, "sha", return_value="c" * 64):
            base, reference = addition.parent_proof(self.base, self.root)
        self.assertEqual(len(base), 142)
        self.assertEqual(reference, "c" * 64)
        verify.assert_called_once_with(self.root, self.base)
        original.assert_called_once_with(self.base, folder / "baseline")

    def test_completed_database_can_publish_missing_receipt_without_reapplying(self):
        operation = "a" * 32
        folder = addition.directory(self.base, operation); folder.mkdir(parents=True)
        (folder / "plan.json").write_text("{}")
        plan = {"migrationSha256": "c" * 64}
        first = addition.publish_installed(self.base, operation, folder, plan, self.rows(), self.rows())
        receipt = (folder / "installed.json").read_bytes()
        (self.base / addition.ACTIVE).unlink()
        self.assertEqual(addition.publish_installed(self.base, operation, folder, plan, self.rows(), self.rows()), first)
        self.assertEqual((folder / "installed.json").read_bytes(), receipt)
        with self.assertRaises(ValueError):
            addition.publish_installed(self.base, operation, folder, plan, self.rows(), {})

    def test_prepared_backup_cannot_be_borrowed_between_candidates_or_owners(self):
        args = ("a" * 64, "b" * 64, "c" * 32, "d" * 64, "e" * 32)
        metadata = {"version": "teruisi-ai-schedule-prepared-backup-v1", "candidateEvidenceSha256": args[0],
            "preparedManifestSha256": args[1], "preparedAppId": args[2], "preparedReceiptSha256": args[3], "maintenanceId": args[4]}
        addition.bind_prepared_backup({"preparedAiScheduleTools": metadata}, *args)
        for key in metadata:
            changed = {**metadata, key: "f" * len(metadata[key])}
            with self.subTest(key=key), self.assertRaises(ValueError):
                addition.bind_prepared_backup({"preparedAiScheduleTools": changed}, *args)
        for value in ({}, {"preparedAiScheduleTools": None}, {"preparedAiScheduleTools": [metadata]}):
            with self.assertRaises(ValueError): addition.bind_prepared_backup(value, *args)

    def test_child_dispatch_never_changes_the_legacy_parent_verification(self):
        import integration_release_gate as gate
        (self.base / addition.ACTIVE).write_text("{}")
        with patch.object(addition, "verify_active", return_value=({"status": "verified"}, {}, self.base)) as child:
            self.assertEqual(gate.verify_release(self.root, self.base), {"status": "verified"})
            with self.assertRaises(Exception): gate.verify_release(self.root, self.base, allow_addition=False)
            self.assertEqual(child.call_count, 1)

    def test_rows_and_atomic_receipts_keep_original_on_ambiguous_outcome(self):
        self.assertTrue(addition.valid_rows(self.rows()))
        for rows in ({}, [], {**self.rows(), "extra": {}}):
            self.assertFalse(addition.valid_rows(rows))
        file = self.base / "receipt.json"
        addition.publish(file, {"value": 1})
        original = file.read_bytes()
        with self.assertRaises(OSError): addition.publish(file, {"value": 2})
        self.assertEqual(file.read_bytes(), original)
        self.assertTrue(list(self.base.glob("receipt.json.*.tmp")))


if __name__ == "__main__":
    unittest.main()
