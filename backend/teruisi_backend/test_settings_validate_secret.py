from django.test import SimpleTestCase

from .settings import validate_secret

# 合成测试值：32+ 字节、够高熵，不是任何真实密钥。
VALID_SECRET = "synthetic-test-master-key-0123456789-abcdefgh"


class ValidateSecretTests(SimpleTestCase):
    """validate_secret() 是 AI_SECRET_ENCRYPTION_KEY 等密钥在 Django 进程启动
    时（settings.py 加载期）fail-closed 校验的共用规则；DJANGO_SECRET_KEY /
    TERUISI_DJANGO_INTERNAL_SECRET 已在非 DEBUG 环境下用它校验，这里补齐对
    该函数本身、以及 AI 主钥场景的直接覆盖。
    """

    def test_valid_secret_passes(self):
        self.assertEqual(
            validate_secret("AI_SECRET_ENCRYPTION_KEY", VALID_SECRET, required=True),
            VALID_SECRET,
        )

    def test_too_short_secret_is_rejected(self):
        with self.assertRaises(RuntimeError):
            validate_secret("AI_SECRET_ENCRYPTION_KEY", "too-short", required=True)

    def test_documented_placeholder_is_rejected(self):
        with self.assertRaises(RuntimeError):
            validate_secret("AI_SECRET_ENCRYPTION_KEY", "changeme", required=True)

    def test_example_like_value_is_rejected_even_if_long_enough(self):
        with self.assertRaises(RuntimeError):
            validate_secret(
                "AI_SECRET_ENCRYPTION_KEY",
                "example-example-example-example-key",
                required=True,
            )

    def test_low_entropy_value_is_rejected(self):
        with self.assertRaises(RuntimeError):
            validate_secret("AI_SECRET_ENCRYPTION_KEY", "a" * 40, required=True)

    def test_empty_value_allowed_when_not_required(self):
        self.assertEqual(
            validate_secret("AI_SECRET_ENCRYPTION_KEY", "", required=False), ""
        )

    def test_empty_value_rejected_when_required(self):
        with self.assertRaises(RuntimeError):
            validate_secret("AI_SECRET_ENCRYPTION_KEY", "", required=True)
