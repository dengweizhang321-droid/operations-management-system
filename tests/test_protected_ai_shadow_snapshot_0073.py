"""Pure, process-free checks for the default-closed synthetic 0073 shadow."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/protected-ai-shadow-snapshot-0073.py"
spec = importlib.util.spec_from_file_location("shadow_snapshot_0073", SCRIPT)
assert spec and spec.loader
shadow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shadow)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def synthetic_seed() -> dict:
    return {"upgrade": "0072->0073", "afterBackupRestored": True,
        "beforeBackupRestored": True, "emptyReverseAndReapply": True,
        "defaultRoleNoLoginAndNoPassword": True,
        "newAttestationRows": 0, "oldFileChunkCount": 2,
        "productionWrites": False}


def protected_fixture() -> dict:
    result = {f"protected_business_test_{i}": [] for i in range(8)}
    result["protected_business_budget_v11_verifier_keys"] = [
        {"key_id": "synthetic", "secret": "in-memory-test"}]
    return result


class ShadowSnapshotPureTests(unittest.TestCase):
    def test_default_refusal_precedes_any_database_or_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "not-a-source"
            with self.assertRaisesRegex(shadow.ShadowBlocked,
                    "disabled by default"):
                shadow.main(["--run-root", str(root), "--target-port", "55852"])
            self.assertFalse(root.exists())

    def test_exact_synthetic_source_and_seed_required(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "checkout"
            run = root / ".runtime" / "ai-pg-123456abcdef"
            run.mkdir(parents=True)
            db = {"HOST": "127.0.0.1", "PORT": "55851",
                "NAME": "teruisi_ai_rehearsal", "USER": "ai_rehearsal_admin"}
            self.assertEqual(shadow.validate_isolation(root, run, db,
                synthetic_seed(), 55852, enabled=True), 55851)
            for bad in ({**synthetic_seed(), "productionWrites": True},
                    {**synthetic_seed(), "oldFileChunkCount": 0},
                    {**synthetic_seed(), "upgrade": "0073->0074"}):
                with self.assertRaises(shadow.ShadowBlocked):
                    shadow.validate_isolation(root, run, db, bad, 55852,
                        enabled=True)
            with self.assertRaises(shadow.ShadowBlocked):
                shadow.validate_isolation(root, run, db, synthetic_seed(),
                    55851, enabled=True)
            with self.assertRaises(shadow.ShadowBlocked):
                shadow.validate_isolation(root, run, {**db, "HOST": "0.0.0.0"},
                    synthetic_seed(), 55852, enabled=True)

    def test_file_chunk_root_requires_nonempty_verified_html_and_xlsx(self):
        rows = [("run", 1, 1, "html", 1, b"<p>x</p>",
                    sha(b"<p>x</p>")),
                ("run", 1, 1, "xlsx", 1, b"xlsx-bytes",
                    sha(b"xlsx-bytes"))]
        first = shadow.file_digest_rows(rows)
        self.assertEqual(first["chunkCount"], 2)
        self.assertEqual(first["formats"], ["html", "xlsx"])
        self.assertEqual(first, shadow.file_digest_rows(list(reversed(rows))))
        self.assertNotIn("xlsx-bytes", json.dumps(first))
        for invalid in (rows[:1], rows + rows[:1],
                [rows[0], (*rows[1][:-1], sha(b"changed"))],
                [rows[0], (*rows[1][:5], b"", sha(b""))]):
            with self.assertRaises(shadow.ShadowBlocked):
                shadow.file_digest_rows(invalid)

    def test_protected_root_requires_nine_tables_and_one_synthetic_key(self):
        rows = protected_fixture()
        digest = shadow.protected_row_digest(rows)
        self.assertEqual(len(digest), 9)
        self.assertEqual(digest[
            "protected_business_budget_v11_verifier_keys"]["rowCount"], 1)
        self.assertNotIn("in-memory-test", json.dumps(digest))
        for invalid in ({**rows, "protected_business_budget_v11_verifier_keys": []},
                {**rows, "protected_business_budget_v11_verifier_keys": [
                    {"key_id": "a"}, {"key_id": "b"}]},
                {key: value for key, value in rows.items()
                    if key != "protected_business_test_0"}):
            with self.assertRaises(shadow.ShadowBlocked):
                shadow.protected_row_digest(invalid)

    def test_manifest_context_binds_snapshot_rows_files_and_roles(self):
        rows = shadow.protected_row_digest(protected_fixture())
        files = shadow.file_digest_rows([
            ("run", 1, 1, "html", 1, b"html", sha(b"html")),
            ("run", 1, 1, "xlsx", 1, b"xlsx", sha(b"xlsx"))])
        evidence = {"contentSha256": "a" * 64}
        args = ("snapshot", evidence, rows, files, [("role", False)],
            55851, 55852)
        manifest, context = shadow.snapshot_manifest(*args)
        self.assertEqual(context, shadow.snapshot_manifest(*args)[1])
        self.assertFalse(manifest["formalBackupPathVerified"])
        self.assertFalse(manifest["longTermKeyCustodyVerified"])
        self.assertFalse(manifest["productionWrites"])
        for changed in (("snapshot2", *args[1:]),
                (args[0], {"contentSha256": "b" * 64}, *args[2:]),
                (*args[:3], {**files, "chunkRootSha256": "c" * 64}, *args[4:]),
                (*args[:4], [("other-role", False)], *args[5:])):
            self.assertNotEqual(context, shadow.snapshot_manifest(*changed)[1])

    def test_process_key_is_strict_and_existing_formal_flags_unchanged(self):
        key = shadow.SyntheticKeyProvider(b"k" * 32)
        self.assertEqual(key.resolve_key(shadow.ARCHIVE_KEY_ID, "seal"),
            b"k" * 32)
        for key_id, purpose in (("other", "seal"),
                (shadow.ARCHIVE_KEY_ID, "publish")):
            with self.assertRaises(shadow.ShadowBlocked):
                key.resolve_key(key_id, purpose)
        with self.assertRaises(shadow.ShadowBlocked):
            shadow.SyntheticKeyProvider(b"short")
        formal = (ROOT / "tools/postgres-consistent-backup.py").read_text(
            encoding="utf-8")
        self.assertIn('FORMAL_DUMP_FLAGS = ("--no-owner", "--no-privileges")',
            formal)
        self.assertIn('FORMAL_RESTORE_FLAGS = ("--no-owner", "--no-privileges")',
            formal)


if __name__ == "__main__":
    unittest.main()
