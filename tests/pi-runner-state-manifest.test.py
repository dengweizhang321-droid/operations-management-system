"""Regression: transient SQLite sidecars must not change the stopped ledger manifest."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from pi_runner.runtime_upgrade import checkpoint_ledger, state_manifest


class PiRunnerStateManifestTests(unittest.TestCase):
    def test_checkpoint_then_transient_wal_sidecar_is_ignored(self):
        with tempfile.TemporaryDirectory(prefix="pi-state-wal-") as folder:
            root = Path(folder)
            database = root / "ledger.sqlite3"
            connection = sqlite3.connect(database)
            self.assertEqual(connection.execute("PRAGMA journal_mode=wal").fetchone()[0], "wal")
            connection.execute("CREATE TABLE sessions(id INTEGER PRIMARY KEY, image TEXT)")
            connection.execute("INSERT INTO sessions(image) VALUES (NULL)")
            connection.commit()
            connection.close()

            checkpoint_ledger(root)
            fresh = state_manifest(root)

            # Exact shape produced by a read-only sqlite backup connection.
            (root / "ledger.sqlite3-wal").write_bytes(b"")
            (root / "ledger.sqlite3-shm").write_bytes(b"")
            self.assertEqual(state_manifest(root), fresh)

            checkpoint_ledger(root)
            self.assertEqual(state_manifest(root), fresh)
            wal = root / "ledger.sqlite3-wal"
            self.assertTrue(not wal.exists() or wal.stat().st_size == 0)
            wal.write_bytes(b"x")
            with self.assertRaisesRegex(ValueError, "ledger_wal_not_checkpointed"):
                state_manifest(root)

            connection = sqlite3.connect(database)
            self.assertEqual(connection.execute("SELECT count(*) FROM sessions").fetchone()[0], 1)
            connection.close()

    def test_checkpoint_on_delete_journal_is_a_noop(self):
        with tempfile.TemporaryDirectory(prefix="pi-state-delete-") as folder:
            root = Path(folder)
            database = root / "ledger.sqlite3"
            connection = sqlite3.connect(database)
            connection.execute("CREATE TABLE marker(value TEXT)")
            connection.commit()
            connection.close()

            before = state_manifest(root)
            checkpoint_ledger(root)
            self.assertEqual(state_manifest(root), before)
            connection = sqlite3.connect(database)
            self.assertEqual(connection.execute("SELECT count(*) FROM marker").fetchone()[0], 0)
            connection.close()

    def test_symlink_state_is_still_rejected(self):
        with tempfile.TemporaryDirectory(prefix="pi-state-link-") as folder:
            root = Path(folder)
            target = root / "target"
            target.write_bytes(b"x")
            link = root / "ledger.sqlite3-wal"
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("symlink unavailable")
            with self.assertRaisesRegex(ValueError, "unsafe_runner_state"):
                state_manifest(root)


if __name__ == "__main__":
    unittest.main()
