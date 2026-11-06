"""views.py:_dispatch 第二层 except 必须区分客户端输入与内部编程错误。

回归目标：这一层原先是 `except (ValueError, TypeError, KeyError)` 一律返回 400
invalid_request 且零日志。它混了两类来源：

- ValueError 有已核实的真实客户端来源（若干接口直接对查询参数 int()，坏参数以裸
  ValueError 冒到这里），该继续是 400；但原先完全不记日志。
- TypeError / KeyError 没有已核实的客户端来源（客户端字段一律先过 fields()/integer()
  等校验器，它们抛 AiError 走第一层），到这一层的是内部编程错误。原先被报成"客户端请求
  格式错误"，比第三层的 503 更隐蔽：排障时 400 通常被当成调用方传错而直接跳过。

这里钉住三件事：客户端坏输入仍是 400 且留下 WARNING、内部 TypeError/KeyError 变成
503 且留下 ERROR 级完整栈、以及两类日志都能看到真实异常类型。

注：TypeError/KeyError 的 503 由最后那层 `except Exception` 兜底提供，本文件只断言结果
（状态码、code、ERROR 级日志、栈），不关心由哪一层给出——曾经有一层专门捕获
`(TypeError, KeyError)` 的子句与 `except Exception` 逐字节同构，删掉后这些断言全绿，
说明它对行为零贡献，已移除。

后半部分（DispatchFieldGuardTests）钉的是另一类缺陷：少数接口漏了 fields() 守卫，
缺少必填参数时会在 Django 层崩成 500/503 而不是 400。
"""
import hashlib
import json
from unittest.mock import patch

from django import test as djtest
from django.test import RequestFactory

from . import policy, views
from .policy import Principal


class DispatchInvalidRequestLoggingTests(djtest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.actor = Principal("dispatch-invalid-request-test@example.invalid",
            "Dispatch invalid request test", "admin", None)

    def _dispatch(self, side_effect):
        request = self.factory.get("/api/ai/models",
            HTTP_X_TERUISI_REQUEST_ID="dispatch-invalid-request-logging-test")
        with djtest.override_settings(DJANGO_PROCESS_ROLE="ai_writer"), \
                patch.object(views, "verify_principal", return_value=self.actor), \
                patch.object(views, "current_principal", return_value=self.actor), \
                patch.object(views, "authority"), \
                patch.object(views, "read", side_effect=side_effect):
            with self.assertLogs("ai_assistant.views", level="WARNING") as logs:
                result = views._dispatch(request, "models")
        return result, logs

    # -- 真实客户端输入：仍然是 400，但不再零日志 ------------------------------

    def test_malformed_client_input_stays_400_and_is_logged_at_warning(self):
        # 真实来源形状：report_library.py:105 / views.py:578 等处对查询参数直接
        # int()，坏参数抛的就是这个裸 ValueError。
        result, logs = self._dispatch(
            ValueError("invalid literal for int() with base 10: 'abc'"))
        self.assertEqual(result.status_code, 400, result.content)
        self.assertEqual(json.loads(result.content)["code"], "invalid_request")
        combined = "\n".join(logs.output)
        # 客户端错误用 WARNING，不是 ERROR：坏客户端或扫描器不应把 ERROR 刷满。
        self.assertTrue(
            all(line.startswith("WARNING") for line in logs.output), logs.output)
        self.assertIn("ValueError", combined)
        self.assertIn("invalid literal for int() with base 10: 'abc'", combined)

    def test_json_decode_error_stays_400(self):
        # JSONDecodeError 是 ValueError 子类。注：_dispatch 自己的 body() 会把它
        # 转成 AiError（第一层），这里钉的是"万一有未转的路径也仍是 400"。
        result, logs = self._dispatch(
            json.JSONDecodeError("Expecting value", "not json", 0))
        self.assertEqual(result.status_code, 400, result.content)
        self.assertEqual(json.loads(result.content)["code"], "invalid_request")
        self.assertIn("JSONDecodeError", "\n".join(logs.output))

    # -- 内部编程错误：不再伪装成 400，改为 503 + ERROR 级日志（由末层兜底）-----

    def test_internal_type_error_becomes_503_with_error_log(self):
        # 实测注入形状：内部对 None 取下标。
        result, logs = self._dispatch(
            TypeError("'NoneType' object is not subscriptable"))
        self.assertEqual(result.status_code, 503, result.content)
        self.assertEqual(
            json.loads(result.content)["code"], "service_unavailable")
        combined = "\n".join(logs.output)
        # 内部 bug 必须是 ERROR 级，否则默认日志级别下会被过滤掉。这条 ERROR 由末层
        # `except Exception` 的 logger.exception 提供。
        self.assertTrue(
            any(line.startswith("ERROR") for line in logs.output), logs.output)
        self.assertIn("TypeError", combined)
        self.assertIn("'NoneType' object is not subscriptable", combined)
        # logger.exception 必须带上栈，否则定位不到抛出点。
        self.assertIn("Traceback", combined)

    def test_internal_key_error_becomes_503_with_error_log(self):
        # 实测注入形状：对内部 dict 取不存在的键，例如 business_evidence.py:38
        # 对库内 plan_json 取 ["sources"]。同样由末层兜底。
        result, logs = self._dispatch(KeyError("missing_internal_key"))
        self.assertEqual(result.status_code, 503, result.content)
        self.assertEqual(
            json.loads(result.content)["code"], "service_unavailable")
        combined = "\n".join(logs.output)
        self.assertTrue(
            any(line.startswith("ERROR") for line in logs.output), logs.output)
        self.assertIn("KeyError", combined)
        self.assertIn("missing_internal_key", combined)
        self.assertIn("Traceback", combined)

    def test_internal_key_error_is_not_reported_as_client_error(self):
        # 这是本次缺陷的核心：内部 KeyError 过去被报成 400 invalid_request，
        # 排障时会被当成调用方传错而跳过。钉住它不再是 400/invalid_request。
        result, _logs = self._dispatch(KeyError("missing_internal_key"))
        self.assertNotEqual(result.status_code, 400, result.content)
        self.assertNotEqual(
            json.loads(result.content)["code"], "invalid_request")


class DispatchFieldGuardTests(djtest.TestCase):
    """缺少必填参数必须在 fields()（第一层 AiError）就被拒成 400，且零日志。

    这两条路原先没有 fields() 守卫，缺参数时直接 `params["id"]` / `payload["input"]`
    取值，抛裸 KeyError。在旧的 `except (ValueError, TypeError, KeyError)` 下它被
    掩盖成 400（看起来"对"，但是 400 的理由错了，且零日志）；一旦那层按本次改动收窄成
    只接 ValueError，同一个 KeyError 就会落到末层变成 503 + ERROR 栈——把调用方漏传
    参数报成服务端故障。正确答案是补守卫，让它在取值之前就是 400。

    断言"无 ERROR 日志"是这两条测试的关键：只断言 400 的话，退回到用末层兜底
    （503）或靠旧的三元组掩盖（400 但带 KeyError）都可能蒙对。
    """

    def setUp(self):
        self.factory = RequestFactory()
        self.actor = Principal("dispatch-field-guard-test@example.invalid",
            "Dispatch field guard test", "admin", None)

    def _run(self, request, path):
        # 用 development 而不是 ai_writer：policy.authority()（policy.py:260）和
        # mutation() 的进程角色闸（policy.py:278）都对 development 短路，否则这两条
        # 写路径会先撞 "AI 写入权威未激活"(503)，根本到不了被测守卫。
        # 另外要打 policy.current_principal：mutation() 在 policy.py:287 调的是它自己
        # 模块里的名字，只打 views 的别名会在取到被测守卫前先撞 403。
        with djtest.override_settings(DJANGO_PROCESS_ROLE="development"), \
                patch.object(views, "verify_principal", return_value=self.actor), \
                patch.object(views, "current_principal", return_value=self.actor), \
                patch.object(policy, "current_principal", return_value=self.actor), \
                patch.object(views, "authority"):
            with self.assertLogs("ai_assistant.views", level="WARNING") as logs:
                # 这条 WARNING 只为满足 assertLogs 必须至少有一条记录；被测路径本身
                # 应当零日志，所以下面断言"除它以外没有别的记录"。
                views.logger.warning("field-guard-probe-sentinel")
                result = views._dispatch(request, path)
        extra = [line for line in logs.output
                 if "field-guard-probe-sentinel" not in line]
        return result, extra

    def _delete(self, url, request_id):
        # write() 在 views.py:112 读 X-Teruisi-Content-SHA256（空体即空串的 sha256）；
        # 少了它会在到达被测守卫之前就抛 KeyError，测试会假红。
        return self.factory.delete(url,
            HTTP_X_TERUISI_REQUEST_ID=request_id,
            HTTP_X_TERUISI_CONTENT_SHA256=hashlib.sha256(b"").hexdigest())

    def _post(self, body, request_id):
        raw = json.dumps(body)
        return self.factory.post("/api/ai/consumer", data=raw,
            content_type="application/json",
            HTTP_X_TERUISI_REQUEST_ID=request_id,
            HTTP_X_TERUISI_CONTENT_SHA256=hashlib.sha256(raw.encode()).hexdigest())

    def test_conversations_delete_without_id_is_400_not_503(self):
        # views.py:833 的 conversations DELETE 分支。对照同文件 views.py:825 的
        # channels DELETE：`fields(params, {"id"}, {"id"})`。
        request = self._delete("/api/ai/conversations",
            "dispatch-field-guard-conversations")
        result, extra = self._run(request, "conversations")
        self.assertEqual(result.status_code, 400, result.content)
        self.assertEqual(json.loads(result.content)["code"], "invalid_request")
        self.assertEqual(extra, [], extra)

    def test_conversations_delete_rejects_unknown_query_param(self):
        # 守卫的 allowed 集合同时钉住"不接受多余参数"，与 channels DELETE 一致。
        request = self._delete("/api/ai/conversations?id=ai-conversation-x&bogus=1",
            "dispatch-field-guard-conversations-extra")
        result, extra = self._run(request, "conversations")
        self.assertEqual(result.status_code, 400, result.content)
        self.assertEqual(json.loads(result.content)["code"], "invalid_request")
        self.assertEqual(extra, [], extra)

    def test_consumer_analysis_plan_without_input_is_400_not_503(self):
        # views.py:1058 的 analysis-plan 是 consumer() 里唯一没有 fields() 的
        # operation。对照同函数 views.py:1015 的 analysis-reply。
        request = self._post({"operation": "analysis-plan"},
            "dispatch-field-guard-analysis-plan")
        result, extra = self._run(request, "consumer")
        self.assertEqual(result.status_code, 400, result.content)
        self.assertEqual(json.loads(result.content)["code"], "invalid_request")
        self.assertEqual(extra, [], extra)

    def test_consumer_analysis_plan_rejects_unknown_body_key(self):
        # 唯一调用方 lib/ai/analysis-sandbox.ts:5 只发 {operation, input}，
        # 所以 allowed 集合就是这两个键。
        #
        # input 必须给成能通过 sandbox.run 自身 fields()（sandbox.py:315）的形状，
        # 并把 sandbox.run 整个挡掉：否则"多余键被拒"会由 sandbox 内层的守卫蒙对，
        # 删掉 views 这一层的 fields() 时测试仍然绿（实测过这个假绿）。
        request = self._post(
            {"operation": "analysis-plan", "input": {"dataset": "sales_category"},
             "bogus": 1},
            "dispatch-field-guard-analysis-plan-extra")
        with patch.object(views.sandbox, "run",
                          side_effect=AssertionError("sandbox.run 不应被调用")):
            result, extra = self._run(request, "consumer")
        self.assertEqual(result.status_code, 400, result.content)
        self.assertEqual(json.loads(result.content)["code"], "invalid_request")
        self.assertEqual(extra, [], extra)
