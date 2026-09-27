"""Synthetic recovery tests; private key and password never leave this process."""
from pathlib import Path
import io
import sys
import tempfile
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import protected_ai_archive_recovery as recovery
from protected_ai_archive_v2_stream import seal_reader_to_file, open_verified_stream


class RecoveryEnvelopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = b"synthetic-only-recovery-password"
        cls.private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cls.public = cls.private.public_key().public_bytes(serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo)
        cls.encrypted = cls.private.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.BestAvailableEncryption(cls.password))
        cls.recipient = recovery.public_fingerprint(cls.public)

    def setUp(self):
        self.envelope, self.source = recovery.create_envelope(self.public,
            key_id="backup-synthetic-1", context_sha256="a" * 64,
            expected_recipient_sha256=self.recipient)

    def restore(self, **changes):
        params = dict(envelope=self.envelope, encrypted_private_pem=self.encrypted,
            password=self.password, expected_key_id="backup-synthetic-1",
            expected_context_sha256="a" * 64,
            expected_recipient_sha256=self.recipient)
        return recovery.recover_envelope(**(params | changes))

    def test_recovery_material_opens_existing_stream_without_original_provider(self):
        content = b"PGDMP" + b"synthetic custom-dump fixture" * 100000
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "backup.aead"
            sealed = seal_reader_to_file(io.BytesIO(content), archive,
                key_id="backup-synthetic-1", context_sha256="a" * 64,
                key_provider=self.source)
            del self.source
            restored = self.restore()
            with open_verified_stream(archive,
                    expected_key_id="backup-synthetic-1",
                    expected_context_sha256="a" * 64,
                    key_provider=restored) as verified:
                self.assertEqual(verified.evidence, sealed)
                sink = io.BytesIO()
                verified.copy_to_test_sink(sink, discard_on_failure=sink.close)
                self.assertEqual(sink.getvalue(), content)

    def test_wrong_password_recipient_context_and_archive_are_rejected(self):
        for change in ({"password": b"wrong-synthetic-password"},
                {"expected_recipient_sha256": "b" * 64},
                {"expected_context_sha256": "b" * 64},
                {"expected_key_id": "other-backup"}):
            with self.subTest(change=next(iter(change))), self.assertRaises(recovery.RecoveryBlocked):
                self.restore(**change)

    def test_metadata_rebinding_cannot_decrypt_oaep_ciphertext(self):
        changed = {**self.envelope, "contextSha256": "b" * 64}
        with self.assertRaises(recovery.RecoveryBlocked):
            self.restore(envelope=changed, expected_context_sha256="b" * 64)

    def test_ciphertext_corruption_and_extra_fields_are_rejected(self):
        for changed in ({**self.envelope, "wrappedKey": "!"},
                {**self.envelope, "wrappedKey": "A" * 512},
                {**self.envelope, "unexpected": True}):
            with self.assertRaises(recovery.RecoveryBlocked):
                self.restore(envelope=changed)

    def test_public_only_and_plaintext_private_keys_cannot_restore(self):
        plain = self.private.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        for value in (self.public, plain):
            with self.assertRaises(recovery.RecoveryBlocked):
                self.restore(encrypted_private_pem=value)

    def test_new_backup_uses_a_fresh_data_key_and_pinned_public_key(self):
        second, provider = recovery.create_envelope(self.public,
            key_id="backup-synthetic-1", context_sha256="a" * 64,
            expected_recipient_sha256=self.recipient)
        self.assertNotEqual(second["wrappedKey"], self.envelope["wrappedKey"])
        self.assertNotEqual(provider.resolve_key("backup-synthetic-1", "seal"),
            self.source.resolve_key("backup-synthetic-1", "seal"))
        with self.assertRaises(recovery.RecoveryBlocked):
            recovery.create_envelope(self.public, key_id="backup-synthetic-1",
                context_sha256="a" * 64, expected_recipient_sha256="f" * 64)

    def test_restored_key_cannot_seal_or_open_another_archive(self):
        restored = self.restore()
        for identity, purpose in (("other", "open"),
                ("backup-synthetic-1", "seal"), ("backup-synthetic-1", "unknown")):
            with self.assertRaises(recovery.RecoveryBlocked):
                restored.resolve_key(identity, purpose)


if __name__ == "__main__":
    unittest.main()
