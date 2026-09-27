"""Recovery-key envelopes for the existing authenticated stream archive.

The backup side needs only the operator-pinned public key. Private-key custody
and the formal PostgreSQL operator are deliberately outside this module.
This module never reads production credentials or grants release permission.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import secrets

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


VERSION = "teruisi-archive-recovery-envelope-v1"
DOMAIN = b"teruisi:archive-recovery-envelope:v1\x00"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
KEY_ID = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")
FIELDS = {"version", "keyId", "contextSha256", "recipientSha256", "wrappedKey"}


class RecoveryBlocked(ValueError):
    """Recovery material or its trusted binding is missing or changed."""


def _public_fingerprint(key: rsa.RSAPublicKey) -> str:
    if key.key_size not in (3072, 4096) or key.public_numbers().e != 65537:
        raise RecoveryBlocked("recovery RSA key size or exponent is not admitted")
    der = key.public_bytes(serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()


def public_fingerprint(public_pem: bytes) -> str:
    if type(public_pem) is not bytes or not 1 <= len(public_pem) <= 8192:
        raise RecoveryBlocked("recovery public key size invalid")
    try:
        key = serialization.load_pem_public_key(public_pem)
    except (ValueError, TypeError):
        raise RecoveryBlocked("recovery public key invalid") from None
    if not isinstance(key, rsa.RSAPublicKey):
        raise RecoveryBlocked("recovery key must be RSA")
    return _public_fingerprint(key)


def _binding(key_id: str, context: str, recipient: str) -> dict[str, str]:
    if (not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id)
            or not isinstance(context, str) or not HEX64.fullmatch(context)
            or not isinstance(recipient, str) or not HEX64.fullmatch(recipient)):
        raise RecoveryBlocked("recovery envelope binding invalid")
    return {"version": VERSION, "keyId": key_id,
        "contextSha256": context, "recipientSha256": recipient}


def _padding(binding: dict[str, str]) -> padding.OAEP:
    label = DOMAIN + json.dumps(binding, sort_keys=True,
        separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
        algorithm=hashes.SHA256(), label=label)


class ArchiveKey:
    """One in-memory key, restricted to one archive ID and operation."""
    def __init__(self, key: bytes, key_id: str, *, seal: bool):
        if type(key) is not bytes or len(key) != 32:
            raise RecoveryBlocked("archive key length invalid")
        self._key = key
        self._key_id = key_id
        self._seal = seal

    def resolve_key(self, key_id: str, purpose: str) -> bytes:
        if (key_id != self._key_id or purpose not in ("seal", "open")
                or purpose == "seal" and not self._seal):
            raise RecoveryBlocked("archive key purpose or identity mismatch")
        return self._key


def create_envelope(public_pem: bytes, *, key_id: str,
                    context_sha256: str,
                    expected_recipient_sha256: str) -> tuple[dict, ArchiveKey]:
    binding = _binding(key_id, context_sha256, expected_recipient_sha256)
    if public_fingerprint(public_pem) != expected_recipient_sha256:
        raise RecoveryBlocked("recovery public key differs from pinned recipient")
    public = serialization.load_pem_public_key(public_pem)
    key = secrets.token_bytes(32)
    wrapped = public.encrypt(key, _padding(binding))
    return {**binding, "wrappedKey": base64.b64encode(wrapped).decode("ascii")}, \
        ArchiveKey(key, key_id, seal=True)


def recover_envelope(envelope: dict, encrypted_private_pem: bytes,
                     password: bytes, *, expected_key_id: str,
                     expected_context_sha256: str,
                     expected_recipient_sha256: str) -> ArchiveKey:
    binding = _binding(expected_key_id, expected_context_sha256,
        expected_recipient_sha256)
    if (type(envelope) is not dict or set(envelope) != FIELDS
            or any(envelope.get(name) != value for name, value in binding.items())
            or type(envelope.get("wrappedKey")) is not str
            or not 1 <= len(envelope["wrappedKey"]) <= 1024):
        raise RecoveryBlocked("recovery envelope does not match trusted binding")
    if (type(encrypted_private_pem) is not bytes
            or not 1 <= len(encrypted_private_pem) <= 16384
            or not encrypted_private_pem.startswith(
                b"-----BEGIN ENCRYPTED PRIVATE KEY-----")
            or type(password) is not bytes or not 16 <= len(password) <= 1024):
        raise RecoveryBlocked("encrypted recovery private key and password required")
    try:
        private = serialization.load_pem_private_key(encrypted_private_pem, password)
        if (not isinstance(private, rsa.RSAPrivateKey)
                or _public_fingerprint(private.public_key()) !=
                    expected_recipient_sha256):
            raise RecoveryBlocked("recovery private key differs from pinned recipient")
        wrapped = base64.b64decode(envelope["wrappedKey"], validate=True)
        if len(wrapped) != private.key_size // 8:
            raise RecoveryBlocked("wrapped archive key size invalid")
        key = private.decrypt(wrapped, _padding(binding))
    except (ValueError, TypeError, binascii.Error):
        raise RecoveryBlocked("recovery key or envelope authentication failed") from None
    return ArchiveKey(key, expected_key_id, seal=False)
