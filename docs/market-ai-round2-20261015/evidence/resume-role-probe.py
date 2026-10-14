"""Exact grant and signed-view probes in the disposable 55459 database only."""
import json
import os
from pathlib import Path
import time
import uuid
from urllib.parse import urlparse

target = urlparse(os.environ.get("TERUISI_DJANGO_DATABASE_URL", ""))
if target.hostname != "127.0.0.1" or target.port != 55459 or os.environ.get("TERUISI_DJANGO_ENVIRONMENT") != "test":
    raise RuntimeError("Resume probe requires its disposable database")
import django
django.setup()
from django.db import connection, transaction
from django.test import Client, override_settings
from django.test.utils import CaptureQueriesContext
from market import annotations
from market.models import MarketAnnotationCloudRun, MarketMasterAuditLog, MarketWriteAuthority, MarketWriteRequestReceipt
from market.tests.test_annotation_queue import PRINCIPAL, QueueFixtures, RESULT
from sales.tests.factories import signed_headers

client = Client()
secret = os.environ["TERUISI_DJANGO_INTERNAL_SECRET"]
stages = []
def stage(name, callback):
    started_at = time.time(); started = time.perf_counter()
    try:
        value = callback(); status = "succeeded"
    except Exception:
        status = "failed"; raise
    finally:
        stages.append({"stage": name, "startedAt": started_at, "endedAt": time.time(),
                       "durationMs": round((time.perf_counter()-started)*1000, 3), "status": status})
    return value

def signed(payload, request_id=None, role="operator", scope=None):
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    return client.post("/api/market/commands", data=raw, content_type="application/json", headers=signed_headers(
        "/api/market/commands", method="POST", body=raw, request_id=request_id or str(uuid.uuid4()),
        email=PRINCIPAL.email, role=role, scope=scope, secret=secret))

fixtures = QueueFixtures()
job = stage("create_synthetic_plan", lambda: fixtures.job("resume-role-job"))
fixtures.item(job, "resume-role-item")
MarketAnnotationCloudRun.objects.filter(job_id=job.id).update(state="paused")
run = MarketAnnotationCloudRun.objects.get(job_id=job.id)
command = {"action": "set_cloud_run_state", "jobId": job.id, "state": "running",
           "expectedControlVersion": annotations._control_version(run), "operationId": str(uuid.uuid4())}
authority = MarketWriteAuthority.objects.get(pk=1)
with override_settings(MARKET_WRITE_AUTHORITY_EPOCH=str(authority.authority_epoch), MARKET_WRITE_CUTOVER_ID=authority.cutover_id):
    with connection.cursor() as cursor:
        cursor.execute("SET ROLE teruisi_market_reader")
    try:
        with transaction.atomic():
            list(MarketWriteRequestReceipt.objects.values("request_id", "response_payload")[:1])
    except Exception as error:
        if getattr(error.__cause__, "sqlstate", "") != "42501": raise
        reader_denied = True
    else: raise AssertionError("Reader gained receipt permissions")
    finally:
        with connection.cursor() as cursor: cursor.execute("RESET ROLE")
    with connection.cursor() as cursor: cursor.execute("SET ROLE teruisi_market_writer")
    try:
        response = stage("start_signed_control", lambda: signed({"contractVersion": "market-command-v1", "domain": "annotations", "command": command}, "annotation-control-"+command["operationId"]))
        if response.status_code != 200: raise AssertionError("Runtime writer control failed: "+str(response.status_code))
        before = (MarketWriteRequestReceipt.objects.count(), MarketMasterAuditLog.objects.count())
        with CaptureQueriesContext(connection) as queries:
            query = signed({"contractVersion": "market-annotation-control-query-v1", "command": command})
        if query.status_code != 200 or query.json().get("outcome") != "succeeded": raise AssertionError("Signed writer receipt query failed")
        if any(row["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "TRUNCATE")) for row in queries): raise AssertionError("Receipt query wrote data")
        if before != (MarketWriteRequestReceipt.objects.count(), MarketMasterAuditLog.objects.count()): raise AssertionError("Query created receipt or audit")
        denied = signed({"contractVersion": "market-annotation-control-query-v1", "command": command}, role="viewer")
        scoped = signed({"contractVersion": "market-annotation-control-query-v1", "command": command}, scope={"platforms": ["京东"]})
        if denied.status_code != 403 or scoped.status_code != 403: raise AssertionError("Query widened role or scope")
        def business(action):
            result = signed({"contractVersion": "market-command-v1", "domain": "annotations", "command": action})
            if result.status_code != 200: raise AssertionError("Signed lifecycle failed: "+str(result.status_code))
            return result.json()["result"]
        claimed = stage("claim_signed", lambda: business({"action": "claim_task", "jobId": job.id}))["task"]
        stage("image_simulated", lambda: len(b"synthetic-clear-image"))
        result = stage("model_simulated", lambda: dict(RESULT))
        stage("validation_local", lambda: result["segment"] in ["测试细分"] and result["priceType"] == "到手价")
        stage("complete_signed", lambda: business({"action": "complete_task", "itemId": claimed["itemId"], "leaseToken": claimed["leaseToken"], "result": result,
              "timing": {"imageLoadMs": 1, "imagePrepareMs": 1, "modelCallMs": 1, "totalMs": 3, "inputBytes": 21}}))
    finally:
        with connection.cursor() as cursor: cursor.execute("RESET ROLE")
    with connection.cursor() as cursor: cursor.execute("SET ROLE teruisi_market_reader")
    try:
        progress = stage("readback_reader", lambda: annotations.execute_annotation_query({"operation": "annotations", "view": "progress", "params": {"jobId": job.id}}, PRINCIPAL))
        if progress["modelCompletedUnits"] != 1 or progress["job"]["completedCount"] != 1: raise AssertionError("Lifecycle readback counts disagree")
    finally:
        with connection.cursor() as cursor: cursor.execute("RESET ROLE")
report = {"readerReceiptPayloadSelectDenied": reader_denied, "writerSignedControl": True, "writerQueryReadOnly": True,
          "scopeAndRoleRejected": True, "externalModelCalls": 0, "productionWrites": 0,
          "statistics": {"modelSimulated": 1, "history": 0, "failed": 0, "unknown": 0}, "stages": stages,
          "parallelStagesSummed": False}
Path(os.environ["MARKET_RESUME_ROLE_REPORT"]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report), flush=True)
