"""Opt-in real registered provider, private PostgreSQL/Runner and synthetic sources.

The caller supplies the authorised model in process memory on stdin. Credentials
are never written to this file, the private test database, output or evidence.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import threading
import unittest
import zipfile
from unittest.mock import patch

from django.db import close_old_connections
from django.test import TransactionTestCase, override_settings
from ai_assistant import tests as domain, pi_service as service, pi_worker as worker, provider, transport
from ai_assistant.pi_models import PiOperation, PiFile, PiDispatch, PiEvent
from ai_assistant.test_pi_real_stack import PiRealStackTests
from ai_assistant.policy import canonical

MODEL = json.load(sys.stdin)


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class LiveQuotaTests(TransactionTestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user
    edge = PiRealStackTests.edge
    _fixture_teardown = PiRealStackTests._fixture_teardown

    def test_registered_model_to_real_pi_and_downloadable_excel(self):
        self.actor = self.user("quota-validation@example.invalid", "admin", None)
        self.edge_reads, self.operations = [], []
        self.phase = "first"
        for field, value in MODEL["configuration"].items():
            setattr(self.model, field, value)
        self.model.api_key_encrypted = "private-memory-only-fixture"
        self.model.save()
        session = service.create_session({"clientRequestId": "quota-private-session", "title": "真实额度隔离验证"}, self.actor)["session"]["id"]
        stopped = threading.Event()
        exporter = threading.Thread(target=worker.export_loop, args=(stopped,), daemon=True)
        evidence = {"actualConfiguredProvider": True, "syntheticBusinessSources": True, "productionStateChanged": False, "rounds": []}
        actual_post = provider.bounded_json
        provider_attempts = []
        def counted_post(url, *args, **kwargs):
            provider_attempts.append(True)
            return actual_post(url, *args, **kwargs)
        try:
            with patch.dict(os.environ, {"AI_SECRET_ENCRYPTION_KEY": "private-quota-cache-test-only-123456789"}), patch.object(provider, "decrypt", return_value=MODEL["apiKey"]), patch.object(provider, "bounded_json", side_effect=counted_post), patch.object(transport, "bounded_json", side_effect=self.edge):
                exporter.start()
                prompts = [
                    "这是已授权的真实模型与Pi端到端测试，数据源均为隔离合成数据，不代表正式经营结论。请实际执行，不只描述计划。先调用get_data_freshness，再调用get_sales_summary、get_pi_netshop_performance_page、get_inventory_page_data各一次（参数尽量为空）。只根据这些返回的合成值，用已加载的excel-report技能脚本生成/workspace/outputs/quota-report.xlsx，写入分析结果、来源、指标口径、缺失数据四张表；另生成quota-report.md。金额人民币分、库存件，标明合成来源与截止日。不需要其他取数或导出，控制在必要轮次内。全程中文，最终明确文件名与验证完成。",
                    "继续同一会话：实际用本地工具检查上一轮quota-report.xlsx存在，读取文件大小；不要再次查询系统数据或重建文件。中文回复文件名、实际字节数和“续问验证完成”。",
                ]
                for index, prompt in enumerate(prompts):
                    admitted = service.prompt(session, {"clientRequestId": f"quota-round-{index}", "message": prompt, "modelId": self.model.id, "skillIds": ["excel-report"]}, self.actor)
                    operation = worker.claim()
                    self.assertEqual(operation.id, admitted["operation"]["id"])
                    self.operations.append(operation)
                    worker.perform(operation)
                    operation.refresh_from_db()
                    print(canonical({"privateOperationStatus": operation.status, "errorCode": operation.error_code,
                        "actualProviderPosts": len(provider_attempts), "dispatches": list(PiDispatch.objects.filter(operation=operation).values("kind", "status", "error_code"))}), flush=True)
                    self.assertEqual(operation.status, "succeeded", operation.error_code)
                    final = PiEvent.objects.filter(operation=operation, event_type="assistant_message").order_by("-event_seq").first()
                    self.assertIsNotNone(final)
                    text = json.loads(final.data_json)["text"]
                    self.assertGreater(sum("\u4e00" <= c <= "\u9fff" for c in text), 10)
                    evidence["rounds"].append({"status": operation.status, "generation": operation.generation,
                        "modelCalls": PiDispatch.objects.filter(operation=operation, kind="model", status="completed").count(),
                        "files": list(PiFile.objects.filter(operation=operation, direction="output").values("file_name", "size_bytes", "sha256"))})
                self.assertEqual(self.operations[0].generation, self.operations[1].generation)
                evidence["actualProviderPosts"] = len(provider_attempts)
                for name in ("get_data_freshness", "get_sales_summary", "get_pi_netshop_performance_page", "get_inventory_page_data"):
                    self.assertTrue(any(item["name"] == name for item in self.edge_reads), name)
                book = PiFile.objects.get(operation=self.operations[0], file_name="quota-report.xlsx", direction="output")
                data = base64.b64decode(service.download(book.id, self.actor, content=True)["base64"])
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    self.assertIsNone(archive.testzip())
                    self.assertEqual(len([name for name in archive.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")]), 4)
                self.assertTrue(PiFile.objects.filter(operation=self.operations[0], file_name="quota-report.md", direction="output").exists())
                output = Path(__file__).resolve().parents[2] / "docs/pi-chat-real-validation-20261018"
                # Output is outside the private test cluster and contains only synthetic facts.
                output.mkdir(parents=True, exist_ok=True)
                (output / "quota-report.xlsx").write_bytes(data)
                (output / "real-provider-validation.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf8")
        finally:
            stopped.set()
            exporter.join(timeout=5)
            close_old_connections()
            for operation in self.operations:
                try:
                    worker.dispose_environment(operation)
                except Exception:
                    pass
