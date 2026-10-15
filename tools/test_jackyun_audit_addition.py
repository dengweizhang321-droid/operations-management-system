import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import bi_app_addition as parent
import jackyun_audit_addition as addition
from jackyun_audit_catalog import COLUMNS, FILES, STEPS, verify_catalog

ROOT = Path(__file__).resolve().parents[1]


class CatalogueCursor:
    def __init__(self, installed, *, broken=None):
        self.installed, self.broken = installed, broken
    def execute(self, query, parameters=None):
        table = parameters[0].split(".")[-1]
        if "FROM pg_attribute" in query:
            self.rows = sorted((name, kind, True, False) for name, kind in COLUMNS[table].items()) if self.installed else []
            if self.broken == "column" and self.rows:
                self.rows[0] = (*self.rows[0][:2], False, False)
        elif "FROM pg_index" in query:
            self.rows = [(True, True, False, True, True, "btree", kind, 1) for kind in ("text_ops", "varchar_pattern_ops")]
            if self.broken == "index":
                self.rows.pop()
        else:
            raise AssertionError(query)
    def fetchall(self):
        return self.rows


class AuditAdditionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / "base"; self.root = Path(self.temp.name) / "candidate"
        (self.base / "backend/finance/migrations").mkdir(parents=True)
        (self.base / "backend/finance/migrations/0001_original.py").write_text("# original\n")
        shutil.copytree(self.base, self.root)
        for file in FILES:
            (self.root / file).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / file, self.root / file)

    def test_exact_two_migrations_and_crlf_are_supported(self):
        digest = addition.source_delta(self.root, self.base)
        for file in FILES:
            raw = (self.root / file).read_bytes().replace(b"\r\n", b"\n")
            (self.root / file).write_bytes(raw.replace(b"\n", b"\r\n"))
        self.assertEqual(addition.source_delta(self.root, self.base), digest)

    def test_extra_missing_rewritten_or_package_code_cannot_be_admitted(self):
        for relative, value in [("backend/finance/migrations/0002_other.py", "# extra"),
                                ("backend/finance/migrations/0001_original.py", "# edited"),
                                (next(iter(FILES)), "# different"),
                                ("backend/sales/migrations/__init__.py", "# injected")]:
            with self.subTest(path=relative):
                file = self.root / relative
                prior = file.read_bytes() if file.exists() else None
                file.write_text(value)
                with self.assertRaises(ValueError):
                    addition.source_delta(self.root, self.base)
                if prior is None: file.unlink()
                else: file.write_bytes(prior)
        (self.root / next(iter(FILES))).unlink()
        with self.assertRaises(ValueError): addition.source_delta(self.root, self.base)

    def test_new_catalogue_checks_types_nullability_and_both_indexes(self):
        verify_catalog(CatalogueCursor(False), installed=False)
        verify_catalog(CatalogueCursor(True), installed=True)
        for cursor, installed in [(CatalogueCursor(True), False), (CatalogueCursor(False), True),
                                  (CatalogueCursor(True, broken="column"), True), (CatalogueCursor(True, broken="index"), True)]:
            with self.assertRaises(ValueError): verify_catalog(cursor, installed=installed)

    def test_parent_140_proof_never_dispatches_to_new_generation(self):
        folder = self.base / "parent"
        with patch.object(parent, "verify_active", return_value=({"migrationCount": 140}, {}, folder)) as verify, \
                patch.object(parent, "original_parent", return_value=({}, {str(i) for i in range(139)})) as original, \
                patch.object(parent, "sha", return_value="a" * 64):
            base, digest = addition.parent_proof(self.base, self.root)
        self.assertEqual(len(base), 140); self.assertEqual(digest, "a" * 64)
        verify.assert_called_once_with(self.root, self.base)
        original.assert_called_once_with(self.base, folder / "baseline")

    def test_legacy_parent_verification_cannot_enter_child_dispatch(self):
        import integration_release_gate as gate
        (self.base / addition.ACTIVE).write_text("{}")
        with patch.object(addition, "verify_active", return_value=({"status": "verified"}, {}, self.base)) as new:
            self.assertEqual(gate.verify_release(self.root, self.base), {"status": "verified"})
            with self.assertRaises(Exception): gate.verify_release(self.root, self.base, allow_addition=False)
            self.assertEqual(new.call_count, 1)

    def test_atomic_create_only_keeps_original_and_failed_temporary(self):
        file = self.base / "record.json"
        addition.publish(file, {"id": "original"})
        original = file.read_bytes()
        with self.assertRaises(OSError): addition.publish(file, {"id": "other"})
        self.assertEqual(file.read_bytes(), original)
        self.assertTrue(list(self.base.glob("record.json.*.tmp")))
        with self.assertRaises(ValueError): addition.publish(file, {}, previous="0" * 64)

    def test_partial_receipts_and_wrong_operations_never_become_active(self):
        operation = "a" * 32
        folder = addition.directory(self.base, operation); folder.mkdir(parents=True)
        for value in [None, [], {}, {"status": "schema_installed"}]:
            (self.base / addition.ACTIVE).write_text(json.dumps(value))
            with self.assertRaises((ValueError, TypeError)): addition.verify_active(self.root, self.base)
        with self.assertRaises(ValueError): addition.directory(self.base, "../outside")
        self.assertFalse(addition.valid_rows({}))
        self.assertFalse(addition.valid_rows({name: {"columns": ["id"], "rows": True, "sha256": "a" * 64} for name in COLUMNS}))

    def test_committed_database_can_publish_missing_receipt_without_replaying(self):
        op = 'a' * 32
        folder = addition.directory(self.base, op); folder.mkdir(parents=True)
        (folder / 'plan.json').write_text('{}')
        rows = {name: {'columns': ['id'], 'rows': 1, 'sha256': 'a' * 64} for name in COLUMNS}
        plan = {'version': addition.VERSION, 'migrationSha256': 'b' * 64}
        result = addition.publish_installed(self.base, op, folder, plan, rows, rows)
        original = (folder / 'installed.json').read_bytes()
        (self.base / addition.ACTIVE).unlink()
        self.assertEqual(addition.publish_installed(self.base, op, folder, plan, rows, rows), result)
        self.assertEqual((folder / 'installed.json').read_bytes(), original)
        with self.assertRaises(ValueError):
            addition.publish_installed(self.base, op, folder, plan, rows, {})

    def test_interrupted_proof_copy_accepts_only_the_identical_original(self):
        source = self.base / 'source.json'; target = self.base / 'copy.json'
        source.write_text('{"status":"completed"}')
        digest = parent.sha(source)
        addition.copy_proof(source, target, digest)
        addition.copy_proof(source, target, digest)
        target.write_text('{')
        with self.assertRaises(ValueError): addition.copy_proof(source, target, digest)
        self.assertEqual(target.read_text(), '{')

    def test_admission_binds_private_evidence_code_and_exact_parent(self):
        for file in addition.CODE_FILES:
            (self.root / file).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / file, self.root / file)
        runtime = self.base / "runtime"; (runtime / "app").mkdir(parents=True)
        shutil.copytree(self.base / "backend", runtime / "app/backend")
        (runtime / "app/deployment.json").write_text("{}")
        proof = {"version": "jackyun-audit-private-postgres-v1", "status": "passed", "productionTouched": False,
                 "steps": list(STEPS), "codeSha256": addition.code_digest(self.root), "migrationSha256": addition.source_delta(self.root, runtime / "app"),
                 "checks": ["atomic-upgrade", "preserved-rows", "negative-catalogues", "legacy-140", "dump-restore-142", "rollback", "permissions"]}
        proof_path = self.base / "private.json"; proof_path.write_text(json.dumps(proof))
        evidence = {"version": addition.VERSION, "status": "reviewed", "steps": list(STEPS), "stepFiles": FILES,
                    "predecessorSha256": parent.sha(runtime / "app/deployment.json"), "parentReferenceSha256": "b" * 64,
                    "migrationSha256": proof["migrationSha256"], "codeSha256": proof["codeSha256"],
                    "validation": str(proof_path), "validationSha256": parent.sha(proof_path)}
        file = self.base / "evidence.json"; file.write_text(json.dumps(evidence))
        with patch.object(addition, "parent_proof", return_value=(set(), "b" * 64)):
            self.assertEqual(addition.admission(self.root, runtime, file, parent.sha(file)), evidence)
            proof["checks"].remove("dump-restore-142"); proof_path.write_text(json.dumps(proof))
            with self.assertRaises(ValueError): addition.admission(self.root, runtime, file, parent.sha(file))


if __name__ == "__main__": unittest.main()
