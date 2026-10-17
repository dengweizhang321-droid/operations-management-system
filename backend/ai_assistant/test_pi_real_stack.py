"""Opt-in real Pi / HMAC / Django queue / export / XLSX vertical test.

Only the external model HTTP response and the central edge transport are
synthetic. Pi, its native local tools, the rootless container, signed runner
transport, Django authority/state, file bytes and reviewed skill are real.
"""
import base64
import io
import json
import os
from pathlib import Path
import threading
import time
import unittest
import zipfile
from unittest.mock import patch

from django.db import close_old_connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from . import tests as domain
from . import pi_service as service, pi_worker as worker, pi_exports, datasets, transport
from .pi_models import PiOperation, PiSession, PiExport, PiFile, PiDispatch
from .policy import canonical, mutation


def entry(name):
    return {"name": name, "title": name, "description": "Synthetic isolated stack fixture; no business facts or production calls.",
        "risk": "read_only", "allowedRoles": ["admin"], "scopePolicy": "principal_scope",
        "inputSchema": {"type": "object", "additionalProperties": False, "properties": {
            "dataset": {"type": "string"}, "queryJson": {"type": "string", "maxLength": 16000},
            "exportId": {"type": "string"}, "page": {"type": "integer"}, "limit": {"type": "integer"},
            "platform": {"type": "string"}, "shop": {"type": "string"}, "view": {"type": "string"}}},
        "annotations": {"readOnlyHint": True},
        "execution": {"mode": "direct", "allowedSurfaces": ["pi_agent"], "maxCallsPerRequest": 8, "maxResultCharacters": 40000}}


@unittest.skipUnless(os.getenv("PI_REAL_STACK_TEST") == "1", "explicit independent real-Pi fixture required")
@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiRealStackTests(TransactionTestCase):
    reset_sequences = False
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user

    def _fixture_teardown(self):
        if os.getenv("PI_REAL_STACK_SKIP_FLUSH") == "1":
            from django.conf import settings
            from django.db import connection
            config = connection.settings_dict
            if (settings.DJANGO_ENVIRONMENT != "test" or connection.vendor != "postgresql"
                    or config["HOST"] != "127.0.0.1" or not 55541 <= int(config["PORT"]) <= 55549
                    or not config["NAME"].startswith("test_")):
                raise RuntimeError("real-Pi no-flush scope must be the dedicated disposable PostgreSQL test cluster")
            # The single-case isolated database is dropped by DiscoverRunner;
            # protected production TRUNCATE guards remain entirely unchanged.
            return
        return super()._fixture_teardown()

    def edge(self, url, payload, headers, **kwargs):
        self.assertTrue(url.endswith("/api/ai/internal/edge"))
        action = payload["action"]
        names = ["get_data_freshness", "get_sales_summary", "get_inventory_page_data", "get_pi_netshop_performance_page",
            "query_system_dataset", "start_pi_dataset_export", "get_pi_dataset_export", "describe_system_datasets"]
        if action == "catalog": return {"entries": [entry(name) for name in names]}
        self.assertEqual(action, "execute")
        name, args = payload["name"], payload["arguments"]
        self.assertEqual(payload["surface"], "pi_agent")
        self.edge_reads.append({"phase": self.phase, "name": name, "args": args})
        if name == "get_data_freshness":
            data = {"source": "synthetic fixtures", "sales": {"date": "2026-10-16"}, "inventory": {"date": "2026-10-16"}}
        elif name == "get_sales_summary":
            data = {"netSalesCents": 10000, "source": "synthetic sales", "dataCutoffDate": "2026-10-16"}
        elif name in {"get_inventory_page_data", "get_pi_netshop_performance_page"}:
            promotion = name == "get_pi_netshop_performance_page"
            data = {"items": [{"id": "fixture-promotion" if promotion else "fixture-stock", "value": 300 if promotion else 12}],
                "pagination": {"page": args.get("page", 1), "pageSize": args.get("limit", 20), "total": 1, "returned": 1, "hasMore": False, "truncated": False},
                "sourceRevision": "fixture-netshop-v1" if promotion else "fixture-inventory-v1", "units": {"value": "CNY_cents" if promotion else "pieces"},
                "dataCutoffDate": "2026-10-16", "filtersApplied": {"platforms": [args.get("platform", "京东")], "shop": args.get("shop")}}
        elif name == "query_system_dataset":
            data = datasets.consumer({"operation": "datasets-query", "surface": "pi_agent", **args}, self.actor, payload["requestId"])
        elif name == "start_pi_dataset_export":
            self.assertNotIn("sessionId", args)
            data = pi_exports.consumer({"operation": "pi-export-start", "operationId": payload["requestId"], "surface": "pi_agent", **args}, self.actor, payload["requestId"])
        elif name == "get_pi_dataset_export":
            data = pi_exports.consumer({"operation": "pi-export-status", "surface": "pi_agent", **args}, self.actor, payload["requestId"])
        elif name == "describe_system_datasets":
            data = datasets.describe(self.actor, surface="pi_agent")
        else: raise AssertionError(name)
        return {"toolName": name, "ok": True, "auditStatus": "recorded", "data": data}

    def model_post(self, url, body, headers, **kwargs):
        self.assertEqual(url, "https://api.openai.com/v1/chat/completions")
        self.provider_rounds += 1
        self.assertLess(self.provider_rounds, 30)
        self.history.append(body["messages"])
        self.last_tool_fixture = next((item.get("content") for item in reversed(body["messages"]) if item.get("role") == "tool"), None)
        calls = []
        text = None
        def call(name, args):
            calls.append({"id": f"synthetic-{self.provider_rounds}-{len(calls)}", "type": "function",
                "function": {"name": name, "arguments": canonical(args)}})
        if self.phase == "continue":
            if self.stage == 0:
                call("bash", {"command": "cat /workspace/outputs/context-marker.txt"})
                self.stage = 1
            else:
                self.assertIn("synthetic-persistent-context", canonical(body["messages"]))
                text = "已接着同一 Pi 会话读取上一轮文件。合成验收。"
        elif self.stage == 0:
            if self.phase == "first":
                call("query_system_dataset", {"dataset": "sales_summary", "queryJson": "{}"})
                call("start_pi_dataset_export", {"dataset": "inventory_age", "queryJson": canonical({"limit": 20})})
            call("start_pi_dataset_export", {"dataset": "pi_netshop_promotion", "queryJson": canonical({"platform": "京东", "shop": "合成店A", "limit": 20})})
            self.stage = 1
        elif self.stage == 1:
            exports = list(PiExport.objects.filter(operation_id=self.current_op.id))
            self.assertTrue(exports)
            for row in exports:
                # Export handles must first appear in the model-visible actual
                # Pi tool history. No hidden session/operation ID is supplied.
                self.assertIn(row.id, canonical(body["messages"]))
                call("get_pi_dataset_export", {"exportId": row.id})
            if all(row.status == "succeeded" for row in exports): self.stage = 2
        elif self.stage == 2:
            # Exercise a real report script above the former 8 KB business-tool
            # argument budget, through provider validation and native Pi bash.
            script = "# isolated report-code padding\n" * 1000 + """import glob,json,pathlib,subprocess
inputs=[json.loads(pathlib.Path(p).read_text()) for p in glob.glob('/workspace/inputs/*/*.json')]
assert inputs, 'missing exported data'
rows=[]
for source in inputs:
 for row in source['rows']: rows.append({'domain':source['dataset'],'value':row['value']})
"""
            if self.phase == "first": script += "rows.append({'domain':'sales_summary','value':10000})\n"
            script += """report={'columns':['domain','value'],'rows':rows,'sources':['Synthetic Django source fixtures, cutoff 2026-10-16'],'metricDefinitions':['sales/promotion monetary values are CNY cents; stock is pieces'],'missingData':['Synthetic fixture only; does not represent production freshness or business findings']}
pathlib.Path('/workspace/work/report-input.json').write_text(json.dumps(report))
subprocess.run(['python3','/opt/pi/skill-bundles/1.0.0/excel-report/scripts/create_report.py','/workspace/work/report-input.json','/workspace/outputs/report.xlsx'],check=True)
pathlib.Path('/workspace/outputs/context-marker.txt').write_text('synthetic-persistent-context')
"""
            call("bash", {"command": "python3 - <<'PY'\n"+script+"PY"})
            self.stage = 3
        else:
            text = "Excel 已生成；来源为隔离合成数据，金额单位为人民币分，库存为件。缺失数据与口径已列入工作簿。"
        message = {"role": "assistant", "content": text, **({"tool_calls": calls} if calls else {})}
        return {"id": f"synthetic-provider-{self.provider_rounds}", "choices": [{"message": message, "finish_reason": "tool_calls" if calls else "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 20}}

    def run_round(self, session, message, **kwargs):
        value = service.prompt(session, {"clientRequestId": "real-stack-"+self.phase, "message": message,
            "skillIds": ["excel-report"], **kwargs}, self.actor)
        op = worker.claim()
        self.assertEqual(op.id, value["operation"]["id"])
        self.current_op = op
        self.operations.append(op)
        self.stage = 0
        worker.perform(op)
        final = PiOperation.objects.get(pk=op.pk)
        self.assertEqual(final.status, "succeeded", canonical({"error": final.error_code,
            "dispatches": list(PiDispatch.objects.filter(operation=op).values("kind", "status", "error_code")), "rounds": self.provider_rounds,
            "syntheticToolResult": str(getattr(self, "last_tool_fixture", ""))[:4000]}))
        self.assertTrue(service.operation_record(final)["skillsLoaded"])
        return op

    @patch.dict(os.environ, {"AI_SECRET_ENCRYPTION_KEY": "isolated-real-stack-private-cache-fixture-123456",
        "TERUISI_DJANGO_AI_EDGE_BASE_URL": "http://127.0.0.1:3000",
        "TERUISI_DJANGO_INTERNAL_SECRET": "isolated-real-stack-edge-signature-fixture-123456789"})
    def test_queue_to_real_pi_export_xlsx_and_single_shop_continuation(self):
        self.actor = self.user("real-pi-stack@example.invalid", "admin", None)
        self.edge_reads, self.history, self.operations = [], [], []
        self.provider_rounds = 0
        self.phase = "first"
        self.model.generation_options_json = canonical({"contextWindowTokens": 128000, "taskTimeoutMs": 180000})
        self.model.save()
        self.session_id = service.create_session({"clientRequestId": "real-stack-session", "title": "真实Pi隔离合成验证"}, self.actor)["session"]["id"]
        stopped = threading.Event()
        exporter = threading.Thread(target=worker.export_loop, args=(stopped,), daemon=True)
        try:
            with patch("ai_assistant.provider.decrypt", return_value="synthetic-never-sent-to-provider"), patch("ai_assistant.provider.bounded_json", side_effect=self.model_post), patch.object(transport, "bounded_json", side_effect=self.edge):
                exporter.start()
                first = self.run_round(self.session_id, "STACK:first：综合销售、推广和库存，制作有来源、口径及缺数说明的Excel。")
                first_report = PiFile.objects.get(operation=first, direction="output", file_name="report.xlsx")
                first_bytes = service.download(first_report.id, self.actor, content=True)
                with zipfile.ZipFile(io.BytesIO(base64.b64decode(first_bytes["base64"]))) as book:
                    table = book.read("xl/worksheets/sheet1.xml").decode()
                    for source in ("sales_summary", "inventory_age", "pi_netshop_promotion"):
                        self.assertIn(source, table)
                    self.assertEqual(table.count("<row>"), 4)
                self.phase = "continue"
                continued = self.run_round(self.session_id, "STACK:continue：接着同一会话读取上一轮留下的文件。")
                self.assertEqual((first.epoch, first.generation), (continued.epoch, continued.generation))
                self.phase = "single"
                single = self.run_round(self.session_id, "STACK:single：改为只分析京东合成店A并生成Excel。", shopSelection={"platform": "京东", "shop": "合成店A"})
                self.assertGreater(single.generation, first.generation)
                self.assertTrue(all(read["args"].get("shop") == "合成店A" for read in self.edge_reads if read["phase"] == "single" and read["name"] == "get_pi_netshop_performance_page"))
            files = list(PiFile.objects.filter(operation=single, direction="output", file_name="report.xlsx"))
            self.assertEqual(len(files), 1)
            response = service.download(files[0].id, self.actor, content=True)
            with zipfile.ZipFile(io.BytesIO(base64.b64decode(response["base64"]))) as book:
                self.assertEqual(len([name for name in book.namelist() if name.startswith("xl/worksheets/")]), 4)
                self.assertIn("缺失数据", book.read("xl/workbook.xml").decode())
            self.assertTrue(PiDispatch.objects.filter(operation=single, kind="model", provider_request_id__startswith="synthetic-provider-").exists())
        finally:
            stopped.set()
            exporter.join(timeout=5)
            close_old_connections()
            for operation in self.operations:
                try: worker.dispose_environment(operation)
                except Exception: pass
