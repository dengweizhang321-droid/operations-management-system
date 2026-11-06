"""views.py:_dispatch 的兜底 except Exception 必须让真实异常类型进日志。

回归目标：views.py 682-687 行曾经是裸 except Exception，直接返回 503
service_unavailable 而不记录任何东西，真实异常类型（AttributeError、
OperationalError 等）无法被测试失败分类工具或人工排障看到。这里只钉住
"异常类型可见"这一点，不改变响应形状（仍是 503/service_unavailable），
也不收窄捕获范围。
"""
import json
from unittest.mock import patch

from django import test as djtest
from django.test import RequestFactory

from . import views
from .policy import Principal


class DispatchUnhandledErrorLoggingTests(djtest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.actor = Principal("dispatch-log-test@example.invalid", "Dispatch log test",
            "admin", None)

    def test_unexpected_exception_type_is_logged_before_503(self):
        request = self.factory.get("/api/ai/models",
            HTTP_X_TERUISI_REQUEST_ID="dispatch-unhandled-error-logging-test")
        with djtest.override_settings(DJANGO_PROCESS_ROLE="ai_writer"), \
                patch.object(views, "verify_principal", return_value=self.actor), \
                patch.object(views, "current_principal", return_value=self.actor), \
                patch.object(views, "authority"), \
                patch.object(views, "read",
                    side_effect=AttributeError("boom: simulated unexpected failure")):
            with self.assertLogs("ai_assistant.views", level="ERROR") as logs:
                result = views._dispatch(request, "models")
        self.assertEqual(result.status_code, 503, result.content)
        self.assertEqual(json.loads(result.content)["code"], "service_unavailable")
        combined = "\n".join(logs.output)
        # 核心断言：真实异常类型要能在日志里看到，而不是被静默吞掉。
        self.assertIn("AttributeError", combined)
        self.assertIn("boom: simulated unexpected failure", combined)
