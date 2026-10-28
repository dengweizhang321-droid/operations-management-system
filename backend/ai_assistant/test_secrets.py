from unittest.mock import patch

from django.test import TestCase

from . import secrets
from .policy import AiError

# 合成测试值：32+ 字节、够高熵，不是任何真实密钥。
VALID_KEY = "synthetic-test-master-key-0123456789-abcdefgh"


class AiSecretEncryptionKeyValidationTests(TestCase):
    """AI 凭证加密主钥 fail-closed 校验：合法密钥通过、过短/占位值在首次加解密时就被拒绝。"""

    def test_valid_key_round_trips(self):
        with patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": VALID_KEY}):
            encrypted = secrets.encrypt("provider-api-key-fixture")
            self.assertNotEqual(encrypted, "provider-api-key-fixture")
            self.assertEqual(secrets.decrypt(encrypted), "provider-api-key-fixture")

    def test_short_key_is_rejected(self):
        with patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "too-short"}):
            with self.assertRaises(AiError):
                secrets.encrypt("provider-api-key-fixture")

    def test_empty_key_is_rejected(self):
        with patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": ""}):
            with self.assertRaises(AiError):
                secrets.encrypt("provider-api-key-fixture")

    def test_documented_placeholder_is_rejected_even_if_long_enough(self):
        # "changeme" 本身不足 32 字节；用占位词重复拼出同样长度，仍应被规则识别为占位/低熵。
        with patch.dict(
            "os.environ",
            {"AI_SECRET_ENCRYPTION_KEY": "changeme-changeme-changeme-changeme"},
        ):
            with self.assertRaises(AiError):
                secrets.encrypt("provider-api-key-fixture")

    def test_example_like_value_is_rejected(self):
        with patch.dict(
            "os.environ",
            {"AI_SECRET_ENCRYPTION_KEY": "example-example-example-example-key"},
        ):
            with self.assertRaises(AiError):
                secrets.encrypt("provider-api-key-fixture")

    def test_low_entropy_key_is_rejected(self):
        with patch.dict("os.environ", {"AI_SECRET_ENCRYPTION_KEY": "a" * 40}):
            with self.assertRaises(AiError):
                secrets.encrypt("provider-api-key-fixture")
