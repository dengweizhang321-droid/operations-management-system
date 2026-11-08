"""Actual signed application paths for managed Pi skills and sandbox analysis."""
import base64
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import time
import uuid
import zipfile
from xml.etree import ElementTree

from ai_functional_environment import OUT
from ai_functional_http import call as signed_call


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


SETUP = module("functional_runner_setup", "ai-functional-runners-setup.py")
FIXTURE = module("functional_runner_fixture", "ai-functional-runners-fixture.py")


def setup():
    from django.db import connection
    from django.conf import settings
    assert settings.DJANGO_ENVIRONMENT == "development" and settings.DJANGO_PROCESS_ROLE == "development"
    assert connection.settings_dict["HOST"] == "127.0.0.1"
    with connection.cursor() as cursor:
        cursor.execute("SELECT host(inet_server_addr()), inet_server_port(), current_database(), current_user")
        assert cursor.fetchone() == ("127.0.0.1", 55488, "functional_ai", "functional_app")


def call(path, payload=None, *, actor="owner", expected=200):
    result = signed_call(path, payload, actor=actor, method="POST" if payload is not None else "GET")
    assert result["status"] == expected, (path, result)
    return result["body"]


def seed_model(model_id):
    from ai_assistant.models import AiModels
    from ai_assistant.secrets import encrypt
    AiModels.objects.create(id=model_id, name="Synthetic " + model_id, protocol="openai_compatible",
                            model_type="text", model_name=model_id, base_url="http://127.0.0.1:28446/v1",
                            api_key_encrypted=encrypt("functional-loopback-fixture-only"), api_key_suffix="only",
                            status="enabled", timeout_ms=20000, max_tokens=4096)


def provider_calls(model_id):
    path = OUT / "provider-requests.jsonl"
    return [value for line in path.read_text(encoding="utf-8").splitlines()
            if (value := json.loads(line))["model"] == model_id]


def sheet_contents(raw):
    tags = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(raw)) as book:
        assert book.testzip() is None
        content = []
        for index in range(1, 5):
            sheet = ElementTree.fromstring(book.read(f"xl/worksheets/sheet{index}.xml"))
            content.append([[c.text for c in row.findall(".//m:t", tags) + row.findall(".//m:v", tags)]
                            for row in sheet.findall(".//m:row", tags)])
        return content


def pi_skill():
    from ai_assistant import pi_service, pi_transport, pi_worker
    from ai_assistant.pi_models import PiDispatch, PiFile, PiOperation
    from pi_runner.protocol import workspace_key
    prefix = "functional-w11-" + uuid.uuid4().hex[:12]
    model_id = "isofunc-pi-" + prefix
    evidence = {"prefix": prefix, "model": model_id, "status": "started"}
    operation = None
    try:
        seed_model(model_id)
        before = SETUP.invoke(prefix + "-inventory-before", "workspace-inventory")
        assert not before["pi"]
        offering = call("/api/ai/pi/skills")
        skill = next(item for item in offering["items"] if item["id"] == "excel-report")
        ref = {key: skill[key] for key in ("id", "packageVersion", "sha256")}
        assert ref["packageVersion"] == "1.3.0"
        session = call("/api/ai/pi/sessions", {"clientRequestId": prefix, "title": "隔离受管 Excel 技能"}, expected=201)["session"]["id"]
        input_data = {"columns": ["metric", "amount_cents"],
                      "rows": [{"metric": "synthetic-refund", "amount_cents": -120}],
                      "sources": ["synthetic report input"],
                      "metricDefinitions": ["currency unit: cents"], "missingData": ["cost intentionally absent"]}
        raw = json.dumps(input_data).encode()
        uploaded = call(f"/api/ai/pi/sessions/{session}/files",
                        {"clientRequestId": prefix + "-input", "fileName": "w11-input.json", "mimeType": "application/json",
                         "base64": base64.b64encode(raw).decode()}, expected=201)["file"]
        assert uploaded["sha256"] == SETUP.sha(raw)
        queued = call(f"/api/ai/pi/sessions/{session}/messages",
                      {"clientRequestId": prefix + "-prompt", "modelId": model_id, "fileIds": [uploaded["id"]],
                       "message": "/skill:excel-report 用上传的合成文件生成 Excel。", "skillRefs": [ref]},
                      expected=202)["operation"]
        evidence.update(session=session, uploaded=uploaded, queued=queued, skillRef=ref)
        assert not queued["skillsLoaded"] and queued["skills"][0]["packageVersion"] == "1.3.0"
        os.environ["PI_SKILL_VERSION"] = "1.2.0"
        current = next(item for item in pi_service.skills() if item["id"] == "excel-report")
        assert current["packageVersion"] == "1.2.0"
        evidence["workerConfiguredOffering"] = current["packageVersion"]
        assert list(PiOperation.objects.filter(status="queued").values_list("id", flat=True)) == [queued["id"]]
        assert not PiOperation.objects.filter(status__in=["running", "canceling"]).exists()
        operation = pi_worker.claim()
        assert operation.id == queued["id"]
        pi_worker.perform(operation)
        operation.refresh_from_db()
        evidence["operation"] = {"status": operation.status, "error": operation.error_code}
        assert operation.status == "succeeded", evidence["operation"]
        loaded = PiDispatch.objects.get(operation=operation, kind="control:skills_loaded")
        assert loaded.status == "completed" and json.loads(loaded.response_json)["skills"] == [{**ref, "version": "1.3.0"}]
        evidence["loaded"] = json.loads(loaded.response_json)
        workbook = PiFile.objects.get(operation=operation, direction="output", file_name=FIXTURE.OUTPUT)
        download = call(f"/api/ai/pi/files/{workbook.id}/content")
        binary = base64.b64decode(download["base64"], validate=True)
        assert workbook.sha256 == download["sha256"] == SETUP.sha(binary)
        evidence["otherOwnerDenied"] = call(f"/api/ai/pi/files/{workbook.id}/content", actor="other", expected=404)["code"]
        content = sheet_contents(binary)
        assert all(value in str(content) for value in ("synthetic-refund", "-120", "synthetic report input",
                                                       "currency unit: cents", "cost intentionally absent"))
        with (SETUP.OUT / (prefix + ".xlsx")).open("xb") as file:
            file.write(binary)
        calls = provider_calls(model_id)
        assert len(calls) == 2 and all(item["path"] == "/v1/chat/completions" for item in calls)
        assert any(item.get("role") == "tool" for item in calls[1]["body"]["messages"])
        binding = pi_worker.identity(operation)
        state = pi_transport.command({**binding, "command": "workspace", "payload": {"action": "state"}})["workspace"]
        assert state["image"] == json.loads((SETUP.OUT / "SOURCE.json").read_bytes())["images"]["pi"]
        assert state["workspaceId"] == workspace_key(binding)
        pi_worker.dispose_environment(operation)
        evidence["cleanup"] = SETUP.invoke(prefix + "-remove-owned-volume", "remove-disposed-volume",
                                          state["workspaceId"], state["volume"])
        after = SETUP.invoke(prefix + "-inventory-after", "workspace-inventory")
        assert after["pi"] == before["pi"] and after["volumes"] == before["volumes"]
        evidence.update(status="passed", sheets=content, downloadSha256=workbook.sha256,
                        modelRequests=[item["bodySha256"] for item in calls])
    finally:
        if operation is not None:
            evidence["dispatches"] = list(PiDispatch.objects.filter(operation=operation).values(
                "kind", "status", "error_code", "request_id", "provider_request_id"))
        SETUP.record(prefix + ".json", evidence)
    print(json.dumps({"status": evidence["status"], "prefix": prefix}))


def seed_pandas_sales():
    from django.db import transaction
    from django.utils import timezone
    from netshop.models import NetshopRow
    from sales.models import SalesOrderLine
    from sales.write_service import _bump_sales_revision

    products = NetshopRow.objects.filter(platform="京东", shop_name=FIXTURE.SHOP,
                                        dataset="spu_daily", business_date=FIXTURE.DAY)
    assert sorted(products.values_list("transaction_amount_cents", flat=True)) == [3400, 4000, 24000]
    prefix = "functional-w6-sales"
    fixture = SalesOrderLine.objects.filter(source_line_key__startswith=prefix + "-")
    amounts = [-300, *range(101, 109)]
    if not fixture.exists():
        now = timezone.now().isoformat()
        with transaction.atomic():
            SalesOrderLine.objects.bulk_create([
                SalesOrderLine(source_line_key=f"{prefix}-{index}", source_row_hash=SETUP.sha(f"{prefix}-{index}".encode()),
                               first_import_batch_id=prefix, last_import_batch_id=prefix, source_row_number=index + 2,
                               order_no=f"{prefix}-order-{index}", online_order_no=f"{prefix}-order-{index}",
                               platform="京东", platform_key="京东", channel=FIXTURE.SALES_CHANNEL,
                               channel_key=FIXTURE.SALES_CHANNEL, shop_name=FIXTURE.SHOP, shop_key=FIXTURE.SHOP,
                               product_code=f"{prefix}-product-{index}", product_name=f"隔离销售品{index}",
                               category=f"隔离品类{index}", resolved_category=f"隔离品类{index}",
                               business_date=FIXTURE.DAY, business_type="退款" if amount < 0 else "销售",
                               order_time=FIXTURE.DAY, sales_time=FIXTURE.DAY, created_at=now, updated_at=now,
                               order_identity=f"{prefix}-order-{index}", quantity=-1 if amount < 0 else 1,
                               list_unit_price_cents=amount, allocated_unit_price_cents=amount, allocated_amount_cents=amount,
                               cost_amount_cents=0, fee_allocation_cents=0, gross_profit_cents=amount, gross_margin_bps=0,
                               untaxed_gross_profit_cents=amount, untaxed_gross_margin_bps=0,
                               is_business_row=True, is_net_sales_row=True, is_net_quantity_row=True)
                for index, amount in enumerate(amounts)
            ])
            _bump_sales_revision(SETUP.sha(json.dumps(amounts).encode()))
    assert sorted(fixture.values_list("allocated_amount_cents", flat=True)) == amounts
    return {"productRows": products.count(), "salesRows": fixture.count(), "amounts": amounts}


def pandas_application():
    from django.utils import timezone
    from ai_assistant.models import AiToolAuditLogs
    prefix = "functional-w6-" + uuid.uuid4().hex[:12]
    model_id = "isofunc-pi-pandas-" + prefix
    client_id = f"web-chat-v1-{int(time.time() * 1000)}-{uuid.uuid4()}"
    started = timezone.now()
    evidence = {"prefix": prefix, "model": model_id, "clientRequestId": client_id, "status": "started"}

    def broker_count(suffix):
        return SETUP.invoke(prefix + "-count-" + suffix, "pandas-requests")["count"]

    def consumer(inputs, code):
        return {"operation": "pandas-analysis", "surface": "ai_chat",
                "inputsJson": json.dumps(inputs, ensure_ascii=False), "code": code}

    try:
        evidence["seed"] = seed_pandas_sales()
        seed_model(model_id)
        before = broker_count("before")
        evidence["brokerCountBefore"] = before
        body = call("/api/ai/chat", {"clientRequestId": client_id, "workspaceModule": "sales",
                                    "message": "使用 pandas 分析隔离合成的网店商品日和销售品类数据。",
                                    "modelId": model_id})
        evidence["chat"] = body
        after_chat = broker_count("chat")
        evidence["brokerCountAfterChat"] = after_chat
        assert after_chat == before + 1
        artifact, = body["artifacts"]
        assert artifact["sourceTool"] == "run_pandas_analysis" and not artifact["truncated"]
        expected = {"product_rows": 3, "category_rows": 1, "product_cents": 31400,
                    "sales_cents": -300, "loopback_only": True}
        assert [dict(zip(artifact["columns"], row)) for row in artifact["rows"]] == [expected]
        download = call(artifact["downloadUrl"])
        raw = download["content"] if isinstance(download, dict) else download
        table = list(csv.DictReader(io.StringIO(raw.lstrip("\ufeff"))))
        assert table == [{key: str(value).lower() for key, value in expected.items()}]
        with (SETUP.OUT / (prefix + ".csv")).open("xb") as file:
            file.write(raw.encode("utf-8"))
        evidence["csvSha256"] = SETUP.sha(raw.encode("utf-8"))
        denial = call(artifact["downloadUrl"], actor="other", expected=404)
        evidence["otherOwnerDenied"] = denial["code"]

        replies = provider_calls(model_id)
        assert len(replies) == 2
        evidence["providerCalls"] = [item["bodySha256"] for item in replies]
        tool_message, = [item for item in replies[1]["body"]["messages"] if item.get("role") == "tool"]
        source_result = json.loads(tool_message["content"])
        tool_data = source_result.get("data", source_result)
        evidence["toolSourceResult"] = tool_data
        assert tool_data["cleanupVerified"] is True and tool_data["executionEnvironment"] == "isolated_container"
        assert [(item["dataset"], item["rows"], item["pages"], item["complete"]) for item in tool_data["sources"]] == [
            ("netshop_product_daily", 3, 3, True), ("sales_category", 1, 1, True)]
        assert tool_data["sources"][0]["sourceRevision"]
        assert "snapshotToken" not in json.dumps(tool_data)

        invalid = [{**FIXTURE.PANDAS_INPUTS[1], "query": {key: value for key, value in FIXTURE.PANDAS_INPUTS[1]["query"].items()
                                                        if key != "categories"}}]
        evidence["incompleteTrend"] = call("/api/ai/consumer", consumer(invalid, "result = frames['sales']"), expected=400)
        assert broker_count("incomplete") == after_chat

        evidence["failedCode"] = call("/api/ai/consumer",
                                      consumer(FIXTURE.PANDAS_INPUTS, "raise RuntimeError('synthetic user code failure')"), expected=503)
        after_failure = broker_count("failed-code")
        assert after_failure == after_chat + 1
        evidence["brokerCountAfterFailedCode"] = after_failure
        after = SETUP.invoke(prefix + "-inventory-after", "workspace-inventory")
        assert not after["containers"]
        evidence["journal"] = SETUP.invoke(prefix + "-journal", "pandas-journal")
        evidence["audits"] = list(AiToolAuditLogs.objects.filter(created_at__gte=started, actor_email="owner@functional.invalid",
            tool_name__in=("run_pandas_analysis", "get_netshop_performance", "get_sales_category_analysis")
        ).values("request_id", "tool_name", "status", "row_count", "error_code"))
        assert any(item["tool_name"] == "run_pandas_analysis" and item["status"] == "succeeded"
                   for item in evidence["audits"])
        evidence["status"] = "passed"
    finally:
        SETUP.record(prefix + ".json", evidence)
    print(json.dumps({"status": evidence["status"], "prefix": prefix}))


if __name__ == "__main__":
    setup()
    if sys.argv[1:] == ["seed-pandas"]:
        print(json.dumps(seed_pandas_sales()))
    else:
        {"pi": pi_skill, "pandas": pandas_application}[sys.argv[1]]()
