"""AES-GCM compatibility with the former WebCrypto ciphertext; no plaintext in evidence."""

import base64
import hashlib
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from teruisi_backend.settings import validate_secret
from .policy import AiError


def _key():
    secret = os.getenv("AI_SECRET_ENCRYPTION_KEY", "").strip()
    # 启动阶段（teruisi_backend/settings.py，非 DEBUG 时）已做过同一校验；这里
    # 对每次取钥再校验一次，使 DEBUG/测试环境（启动校验被跳过）在首次加解密
    # 时也 fail-closed，不接受过短或占位密钥。校验规则与 Worker 侧
    # lib/ai/crypto.ts 的 isAcceptableEncryptionKey 保持一致（见该文件注释）。
    try:
        validate_secret("AI_SECRET_ENCRYPTION_KEY", secret, required=True)
    except RuntimeError as error:
        raise AiError("AI 凭证加密服务未安全配置", "service_unavailable", 503) from error
    return AESGCM(hashlib.sha256(secret.encode()).digest())


def encrypt(value):
    if not value:
        return ""
    iv = os.urandom(12)
    payload = _key().encrypt(iv, value.encode(), None)
    return ".".join(
        base64.urlsafe_b64encode(v).decode().rstrip("=") for v in (iv, payload)
    )


def decrypt(value):
    if not value:
        return ""
    try:
        parts = value.split(".")
        if len(parts) != 2:
            raise ValueError()
        iv, payload = [base64.urlsafe_b64decode(v + "=" * (-len(v) % 4)) for v in parts]
        if len(iv) != 12:
            raise ValueError()
        return _key().decrypt(iv, payload, None).decode()
    except Exception as error:
        raise AiError("AI 凭证解密失败", "service_unavailable", 503) from error
