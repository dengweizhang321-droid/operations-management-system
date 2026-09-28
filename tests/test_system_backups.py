import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
import zipfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from system_backups.storage import (BackupError, BackupStore, FILES, archive_metadata, atomic_json, checked, digest_file)
from system_backups.runner import execute


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.store = BackupStore(root / "runtime", root / "archive")
        self.store.archive.mkdir()
        (self.store.runtime / "run").mkdir(parents=True)
        atomic_json(self.store.runtime / "run/backup-retention-v2.json", {"version": "teruisi-backup-retention-v2",
                    "maximumRecoveryPoints": 3, "archiveRoot": str(self.store.archive), "pins": []})
        self.actor = "admin@example.test"
        self.backup_id = "daily-20260928T010203Z-" + "a" * 12
        self.directory = self.store.archive / self.backup_id
        self.directory.mkdir()
        data = b"PGDMP" + b"fixture" * 30000
        (self.directory / FILES[2]).write_bytes(data)
        atomic_json(self.directory / FILES[0], {"backupId": self.backup_id, "status": "completed",
                    "completedAt": "2026-09-28T01:02:04Z", "dump": {"fileName": FILES[2], "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}})
        (self.directory / FILES[1]).write_text(digest_file(self.directory / FILES[0]), encoding="utf-8")
        self.meta = archive_metadata(self.directory, full=True)

    def tearDown(self):
        self.temp.cleanup()

    def payload(self, action="backup", target="", sha=""):
        return {"id": uuid.uuid4().hex, "action": action, "target": target, "manifestSha256": sha}

    def upload_zip(self, content=None):
        if content is None:
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w", zipfile.ZIP_STORED) as archive:
                for name in FILES:
                    archive.writestr(name, (self.directory / name).read_bytes())
            content = stream.getvalue()
        upload_id = uuid.uuid4().hex
        self.store.begin_upload(self.actor, {"id": upload_id, "sizeBytes": len(content)})
        for offset in range(0, len(content), 128 * 1024):
            chunk = content[offset:offset + 128 * 1024]
            self.store.upload_chunk(self.actor, {"id": upload_id, "offset": offset, "data": base64.b64encode(chunk).decode(), "sha256": hashlib.sha256(chunk).hexdigest()})
        return upload_id

    def test_metadata_tamper_is_rejected(self):
        (self.directory / FILES[2]).write_bytes(b"x" * self.meta["sizeBytes"])
        with self.assertRaises(BackupError):
            archive_metadata(self.directory, full=True)

    def test_extra_file_is_rejected(self):
        (self.directory / "secret.txt").write_text("fixture")
        with self.assertRaises(BackupError):
            archive_metadata(self.directory)

    def test_job_retry_keeps_one_record(self):
        payload = self.payload()
        first, created = self.store.submit(self.actor, payload)
        again, duplicate = self.store.submit(self.actor, payload)
        self.assertTrue(created)
        self.assertFalse(duplicate)
        self.assertEqual(first, again)
        self.assertEqual(len(list(self.store.root.glob("job-*.json"))), 1)

    def test_job_id_cannot_cross_actor_or_operation(self):
        payload = self.payload()
        self.store.submit(self.actor, payload)
        for actor, change in (("other@example.test", {}), (self.actor, {"action": "retention"})):
            with self.assertRaises(BackupError):
                self.store.submit(actor, {**payload, **change})

    def test_unresolved_job_prevents_replay(self):
        first, _ = self.store.submit(self.actor, self.payload())
        self.store.update_job(first["id"], status="unknown")
        with self.assertRaises(BackupError):
            self.store.submit(self.actor, self.payload())

    def test_failed_job_allows_new_explicit_job(self):
        first, _ = self.store.submit(self.actor, self.payload())
        self.store.update_job(first["id"], status="failed")
        _, created = self.store.submit(self.actor, self.payload())
        self.assertTrue(created)

    def test_production_restore_and_path_injection_are_not_verbs(self):
        for payload in (self.payload("restore-production"), self.payload("export", "../production", "a" * 64)):
            with self.assertRaises(BackupError):
                self.store.submit(self.actor, payload)

    def test_chunk_retry_and_changed_bytes(self):
        upload_id = uuid.uuid4().hex
        self.store.begin_upload(self.actor, {"id": upload_id, "sizeBytes": 6})
        payload = {"id": upload_id, "offset": 0, "data": "YWJj", "sha256": hashlib.sha256(b"abc").hexdigest()}
        self.assertEqual(self.store.upload_chunk(self.actor, payload), {"offset": 3})
        self.assertEqual(self.store.upload_chunk(self.actor, payload), {"offset": 3})
        with self.assertRaises(BackupError):
            self.store.upload_chunk(self.actor, {**payload, "data": "eHl6", "sha256": hashlib.sha256(b"xyz").hexdigest()})

    def test_chunk_cannot_skip_or_cross_owner(self):
        upload_id = uuid.uuid4().hex
        self.store.begin_upload(self.actor, {"id": upload_id, "sizeBytes": 3})
        payload = {"id": upload_id, "offset": 1, "data": "YWJj", "sha256": hashlib.sha256(b"abc").hexdigest()}
        with self.assertRaises(BackupError):
            self.store.upload_chunk(self.actor, payload)
        with self.assertRaises(BackupError):
            self.store.upload_chunk("other@example.test", {**payload, "offset": 0})

    def test_zip_extract_roundtrip_and_operator_binding(self):
        upload_id = self.upload_zip()
        calls = []
        job = {**self.payload("verify-import", upload_id), "actor": self.actor}
        result = execute(self.store, job, lambda *args, **kwargs: calls.append((args, kwargs)) or {"status": "completed"})
        self.assertEqual(result["manifestSha256"], self.meta["manifestSha256"])
        self.assertTrue(result["verified"])
        self.assertFalse(result["isolatedRestoreVerified"])
        self.assertEqual(calls[0][0][2], "Verify")
        self.assertEqual(calls[0][0][3].parent, self.store.imports)

    def test_rehearsal_is_isolated_and_never_restores_production(self):
        upload_id = self.upload_zip()
        self.store.unpack(upload_id, self.actor)
        calls = []
        result = execute(self.store, {**self.payload("rehearse", upload_id), "actor": self.actor},
                         lambda *args, **kwargs: calls.append((args, kwargs)) or {"status": "completed", "serviceStateChanged": False})
        self.assertEqual(calls[0][0][2], "RestoreRehearsal")
        self.assertTrue(calls[0][1]["rehearsal"])
        self.assertFalse(result["productionRestored"])

    def test_traversal_duplicate_entries_and_symlink_rejected(self):
        for variant in ("traversal", "duplicate", "symlink"):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                for index, name in enumerate(FILES):
                    if variant == "traversal" and index == 0:
                        name = "../outside"
                    if variant == "duplicate" and index == 0:
                        name = FILES[1]
                    info = zipfile.ZipInfo(name)
                    if variant == "symlink" and index == 0:
                        info.external_attr = 0o120777 << 16
                    archive.writestr(info, (self.directory / FILES[index]).read_bytes())
            upload_id = self.upload_zip(stream.getvalue())
            with self.assertRaises(BackupError):
                self.store.unpack(upload_id, self.actor)
            self.store.discard(self.actor, upload_id)

    def test_export_download_checks_owner_and_offset(self):
        job, _ = self.store.submit(self.actor, self.payload("export", self.backup_id, self.meta["manifestSha256"]))
        result = self.store.export_zip(job["id"], self.backup_id, self.meta["manifestSha256"])
        self.store.update_job(job["id"], status="completed", result=result)
        chunk = self.store.download(self.actor, job["id"], 0)
        self.assertEqual(chunk["sha256"], hashlib.sha256(base64.b64decode(chunk["data"])).hexdigest())
        with self.assertRaises(BackupError):
            self.store.download("other@example.test", job["id"], 0)
        with self.assertRaises(BackupError):
            self.store.download(self.actor, job["id"], 1)

    def test_discard_import_preserves_source_archive(self):
        upload_id = self.upload_zip()
        imported, _ = self.store.unpack(upload_id, self.actor)
        self.store.discard(self.actor, upload_id)
        self.assertFalse(imported.exists())
        self.assertEqual(archive_metadata(self.directory, full=True), self.meta)

    def test_backup_keeps_retention_and_release_failure_separate(self):
        result = execute(self.store, {"id": "a" * 32, "action": "backup"},
            operator=lambda *args: {"backupId": "fixture", "manifestSha256": "b" * 64,
                "completedAt": "2026-01-01T00:00:00Z", "retention": {"status": "blocked"},
                "releaseRetention": {"status": "blocked"}})
        self.assertEqual(result["backupId"], "fixture")
        self.assertEqual(result["retention"]["status"], "blocked")
        self.assertEqual(result["releaseRetention"]["status"], "blocked")

    def test_hardlink_is_rejected(self):
        linked = Path(self.temp.name) / "linked"
        os.link(self.directory / FILES[2], linked)
        with self.assertRaises(BackupError):
            checked(linked)
        linked.unlink()

    def test_global_lock_rejects_overlapping_mutations(self):
        with self.store.lock():
            with self.assertRaises(BackupError):
                with self.store.lock():
                    self.fail("overlapping lock accepted")

    def test_corrupt_policy_fails_before_job_submission(self):
        atomic_json(self.store.runtime / "run/backup-retention-v2.json", {"pins": []})
        with self.assertRaises(BackupError):
            self.store.submit(self.actor, self.payload())

    def test_maintenance_fence_rejects_new_jobs(self):
        atomic_json(self.store.runtime / "run/system-maintenance.json", {"id": "a" * 32})
        with self.assertRaises(BackupError):
            self.store.submit(self.actor, self.payload())
        self.assertEqual(len(list(self.store.root.glob("job-*.json"))), 0)

    def test_expired_upload_can_still_be_discarded(self):
        upload_id = self.upload_zip()
        path = self.store.root / f"upload-{upload_id}.json"
        item = json.loads(path.read_text(encoding="utf-8"))
        item["createdAt"] = 0
        atomic_json(path, item)
        with self.assertRaises(BackupError):
            self.store.upload(upload_id, self.actor)
        self.store.discard(self.actor, upload_id)
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
