"""Opt-in end-to-end audit; ordinary test runs never call external models.

Run only through the disposable market PostgreSQL rehearsal with the explicit
dated approval flag. All domain writes stay on port 55447 in a test database.
"""
from contextlib import contextmanager
from datetime import datetime, timezone as dt_timezone
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import uuid
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection, transaction
from django.db.models import Exists, OuterRef
from django.test import Client, TransactionTestCase, override_settings
from django.utils import timezone

from market.models import (
    MarketAnnotationItem, MarketAnnotationPromptVersion, MarketAnnotationJob,
    MarketMasterIdentity, MarketPriceSnapshot, MarketRankingEntry,
    MarketSkuAnnotation, MarketSubcategoryTaxonomy, MarketWriteAuthority,
    MarketDataRevision,
)
from sales.tests.factories import TEST_SECRET, signed_headers


ENABLED = os.environ.get("MARKET_CHAIN_AUDIT_APPROVAL") == "approved-up-to-50-20261014"
EPOCH = "cccccccc-1111-4111-8111-111111111111"
ROOT = Path(__file__).resolve().parents[3]
RELEASE = Path(r"D:\teruisi-runtime\teruisi-worker-sales\releases\20261014T124800Z-49f5ec9db80e195b")


@skipUnless(ENABLED, "Explicit isolated model audit approval is required")
@override_settings(MARKET_WRITE_AUTHORITY_EPOCH=EPOCH, MARKET_WRITE_CUTOVER_ID="chain-audit")
class AnnotationChainAudit(TransactionTestCase):
    available_apps = ["market"]
    def setUp(self):
        if connection.vendor != "postgresql" or str(connection.settings_dict["PORT"]) != "55447":
            raise RuntimeError("The audit requires the disposable PostgreSQL port")
        if not str(connection.settings_dict["NAME"]).startswith("test_"):
            raise RuntimeError("The audit requires a Django test database")
        self.output = Path(os.environ["MARKET_CHAIN_AUDIT_DIR"]).resolve()
        if not str(self.output).startswith("D:\\codex-artifacts\\market-annotation-chain-audit-"):
            raise RuntimeError("Private evidence must remain outside Git")
        self.samples = json.loads((self.output / "samples.private.json").read_text(encoding="utf-8"))
        self.run = "chain-" + self._testMethodName + "-" + uuid.uuid4().hex[:8]
        self.events = []
        self.log_path = self.output / (self.run + ".jsonl")
        self.stage_number = 0
        self.emit(stage="audit_source_binding",harnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            annotationsSha256=hashlib.sha256((ROOT/"backend/market/annotations.py").read_bytes()).hexdigest())
        MarketWriteAuthority.objects.update_or_create(pk=1, defaults={
            "status": "postgres", "authority_epoch": EPOCH, "cutover_id": "chain-audit",
            "migration_verify_run_id": "isolated-audit", "activated_at": timezone.now(),
        })
        MarketDataRevision.objects.update_or_create(domain="market", defaults={
            "revision":1, "source_digest":hashlib.sha256(b"isolated-chain-audit").hexdigest()})

    def emit(self, **values):
        event = {"auditRun": self.run, "at": datetime.now(dt_timezone.utc).isoformat(), **values}
        self.events.append(event)
        with self.log_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")

    @contextmanager
    def stage(self, name, **details):
        self.stage_number += 1
        number = self.stage_number
        start = time.perf_counter()
        sql_events = []
        def observe(execute, sql, params, many, context):
            query_start = time.perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                sql_events.append({"kind": sql.split(None, 1)[0],
                    "sqlSha256": hashlib.sha256(sql.encode()).hexdigest(),
                    "durationMs": round((time.perf_counter() - query_start) * 1000, 3)})
        self.emit(stage=name, sequence=number, phase="start", **details)
        try:
            with connection.execute_wrapper(observe):
                yield
        except Exception as error:
            self.emit(stage=name, sequence=number, phase="end", outcome="error",
                errorType=type(error).__name__, durationMs=round((time.perf_counter()-start)*1000, 3),
                sqlCount=len(sql_events), sqlMs=round(sum(q["durationMs"] for q in sql_events), 3), **details)
            raise
        else:
            self.emit(stage=name, sequence=number, phase="end", outcome="ok",
                durationMs=round((time.perf_counter()-start)*1000, 3), sqlCount=len(sql_events),
                sqlMs=round(sum(q["durationMs"] for q in sql_events), 3),
                slowestQueries=sorted(sql_events, key=lambda q:q["durationMs"], reverse=True)[:3], **details)

    def post(self, path, body, request_id=None):
        raw = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        response = Client().post(path, data=raw, content_type="application/json; charset=utf-8",
            headers=signed_headers(path, method="POST", body=raw, request_id=request_id or uuid.uuid4().hex))
        if response.status_code != 200:
            value = response.json()
            raise AssertionError(f"Isolated API HTTP {response.status_code}: {value.get('code')}: {value.get('error')}")
        return response

    def command(self, value, request_id=None):
        return self.post("/api/market/commands", {"contractVersion":"market-command-v1",
            "domain":"annotations", "command":value}, request_id)

    def progress(self, job_id):
        return self.post("/api/market/queries", {"operation":"annotations", "view":"progress", "params":{"jobId":job_id}}).json()

    def seed_sources(self, samples, category="商用净水设备", prompt_id="chain-audit-prompt"):
        segments = samples[0]["segments"]
        MarketAnnotationPromptVersion.objects.create(id=prompt_id, category=category, version=1,
            source="manual", status="active", segments_json=segments, prompt_body=samples[0]["promptBody"],
            created_by="admin@example.test")
        for n, segment in enumerate(segments):
            MarketSubcategoryTaxonomy.objects.create(id=f"{prompt_id}-tax-{n}", category=category, subcategory=segment)
        for n, sample in enumerate(samples):
            identity = {"category":category, "scope":"isolated-audit", "ranking_dimension":"SKU", "sku_code":sample["skuCode"]}
            row = MarketRankingEntry.objects.create(natural_key=f"{prompt_id}-rank-{n}", **identity,
                period_start="2026-10-01", period_end="2026-10-14", rank=n+1, source_row_number=n+1,
                last_import_batch_id="isolated", product_name=sample["productName"], brand=sample["brand"],
                image_url=sample["imageUrl"])
            MarketMasterIdentity.objects.create(**identity, latest_entry_id=row.pk)
            MarketPriceSnapshot.objects.create(id=f"{prompt_id}-snapshot-{n}", **identity, month="2026-10",
                image_url=sample["imageUrl"], image_content_sha256=sample["imageContentSha256"])
            if sample["fixedSegment"]:
                MarketSkuAnnotation.objects.create(id=f"{prompt_id}-annotation-{n}", **identity,
                    image_content_sha256=sample["imageContentSha256"], segment=sample["fixedSegment"],
                    image_price_cents=None, source_job_item_id="isolated-history", prompt_version_id=prompt_id,
                    reviewed_by="admin@example.test", reviewed_at=timezone.now())

    def run_chain(self, names, variant):
        samples = [s for s in self.samples if s["sampleId"] in names]
        self.assertEqual(len(samples), len(names))
        with self.stage("fixture_setup", sampleCount=len(samples), productionWrites=0):
            self.seed_sources(samples)
        with self.stage("create_plan", sampleCount=len(samples)):
            created = self.command({"action":"create_job", "category":"商用净水设备",
                "promptVersionId":"chain-audit-prompt", "executor":"cloud", "modelId":samples[0]["modelId"],
                "concurrency":12, "limit":len(samples)}).json()["result"]
        job_id = created["id"]
        with self.stage("read_created_plan"):
            before = self.progress(job_id)
        self.assertEqual(before["job"]["totalCount"], len(samples))
        with self.stage("accept_start"):
            self.command({"action":"set_cloud_run_state", "jobId":job_id, "state":"running"})
        with self.stage("select_dispatch"):
            dispatch = self.post("/api/market/queries", {"operation":"annotations", "view":"dispatch", "params":{"limit":5}}).json()
        self.assertEqual(len(dispatch["jobs"]), 1)
        with self.stage("acquire_coordinator"):
            coordinator = self.command({"action":"begin_dispatch", "jobId":job_id}).json()["result"]["coordinatorToken"]
        tasks = {}
        for _ in samples:
            with self.stage("claim_item"):
                task = self.command({"action":"claim_task", "executor":"cloud", "jobId":job_id,
                    "coordinatorToken":coordinator}).json()["result"]["task"]
            sample = next(s for s in samples if s["skuCode"] == task["skuCode"])
            tasks[sample["sampleId"]] = task
            self.emit(stage="claimed_identity", sampleId=sample["sampleId"], recognitionMode=task["recognitionMode"])
        modes = [task["recognitionMode"] for task in tasks.values()]
        self.assertEqual(modes, sorted(modes))
        node_command = [r"C:\Program Files\nodejs\node.exe", str(ROOT / "docs/market-annotation-chain-audit-20261014/trace_model.mjs"),
            "--release="+str(RELEASE), "--output="+str(self.output), "--variant="+variant,
            "--samples="+",".join(tasks), "--concurrency=12", "--stream-results=1"]
        results = []
        provider_report = None
        started = time.monotonic()
        process = subprocess.Popen(node_command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
        output_queue = queue.Queue()
        def reader():
            for line in process.stdout:
                output_queue.put(line)
            output_queue.put(None)
        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        self.emit(stage="model_batch", phase="start", variant=variant, concurrency=min(12,len(samples)))
        try:
            while True:
                if time.monotonic()-started > 210:
                    raise TimeoutError("Isolated model process exceeded its audit deadline")
                try:
                    line = output_queue.get(timeout=.5)
                except queue.Empty:
                    continue
                if line is None:
                    break
                event = json.loads(line)
                if event.get("event") != "model_result":
                    provider_report = event.get("report", provider_report)
                    continue
                result = event["result"]
                results.append(result)
                task = tasks[result["sampleId"]]
                command = {"action":"complete_task", "itemId":task["itemId"], "leaseToken":task["leaseToken"]}
                if result["outcome"] == "success":
                    command["result"] = result["prediction"]
                else:
                    failure = result["failure"]
                    command.update(error=failure["failureMessage"], failureCode=failure["failureCode"],
                        retryAfterMs=failure["retryAfterMs"], timing=result.get("timing", {}))
                with self.stage("complete_item", sampleId=result["sampleId"], modelOutcome=result["outcome"]):
                    self.command(command)
                row = MarketAnnotationItem.objects.get(pk=task["itemId"])
                self.emit(stage="stored_outcome", sampleId=result["sampleId"], status=row.status,
                    attemptCount=row.attempt_count, storedError=row.error_message,
                    upstreamError=result.get("message"), timingPersisted=bool(row.total_inference_ms))
            process.wait(timeout=5)
            if process.returncode:
                raise RuntimeError("Isolated model process failed")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            stderr = process.stderr.read()
            if stderr:
                (self.output / (self.run+"-node-stderr.log")).write_text(stderr,encoding="utf-8")
        self.emit(stage="model_batch",phase="end",durationMs=round((time.monotonic()-started)*1000,3),providerReport=provider_report)
        self.assertEqual(len(results), len(samples))
        with self.stage("release_coordinator"):
            self.command({"action":"end_dispatch", "jobId":job_id,"coordinatorToken":coordinator})
        successes = [r for r in results if r["outcome"]=="success"]
        for result in successes:
            row = MarketAnnotationItem.objects.get(pk=tasks[result["sampleId"]]["itemId"])
            with self.stage("human_review_simulated", sampleId=result["sampleId"]):
                self.command({"action":"review","jobId":job_id,"updates":[{"id":row.id,"version":row.version,
                    "segment":row.reviewed_segment,"imagePriceCents":row.reviewed_image_price_cents,"selected":True}]})
        if successes:
            request_id = uuid.uuid4().hex
            command = {"action":"commit_selected","jobId":job_id,"idempotencyKey":self.run}
            with self.stage("commit_reviewed_results"):
                committed = self.command(command,request_id).json()["result"]
            self.assertEqual(committed["committed"], len(successes))
            with self.stage("commit_receipt_replay"):
                replay = self.command(command,request_id)
            self.assertEqual(replay.headers["X-Teruisi-Write-Replay"],"1")
        else:
            self.emit(stage="review_and_commit",phase="skipped",reason="No valid prediction")
        with self.stage("final_progress_read"):
            after = self.progress(job_id)
        summary = {"run":self.run,"variant":variant,"sampleCount":len(samples),"successCount":len(successes),
            "failureCount":len(results)-len(successes),"claimOrder":list(tasks),"queuesBefore":before["queues"],
            "finalProgress":after,"modelReport":provider_report,"productionWrites":0,
            "boundaries":["Actual PostgreSQL and signed Django views via Django Client; not production Waitress HTTP",
                "Actual configured provider; candidate variant changes only per-call metadata/thinking in the audit process",
                "Review is a simulated human acceptance in a disposable database, not semantic quality approval"]}
        (self.output/(self.run+".json")).write_text(json.dumps(summary,ensure_ascii=False,default=str,indent=2),encoding="utf-8")
        print("CHAIN_AUDIT "+json.dumps({k:summary[k] for k in ("run","variant","sampleCount","successCount","failureCount")}),flush=True)

    @patch.dict(os.environ,{"TERUISI_DJANGO_INTERNAL_SECRET":TEST_SECRET})
    def test_01_current_adapter_failure_chain(self):
        self.run_chain(["A1","B1"],"current")

    @patch.dict(os.environ,{"TERUISI_DJANGO_INTERNAL_SECRET":TEST_SECRET})
    def test_02_session_header_non_thinking_chain(self):
        self.run_chain([f"{mode}{n}" for mode in ("A","B") for n in range(1,7)],"no-thinking")

    @patch.dict(os.environ,{"TERUISI_DJANGO_INTERNAL_SECRET":TEST_SECRET})
    def test_03_plan_creation_query_growth(self):
        for count in (200, 1000):
            category = f"审查合成类目{count}"
            prompt_id = f"chain-bench-{count}"
            templates = [next(s for s in self.samples if s["sampleId"] == key) for key in ("A1", "B1")]
            samples = [{**templates[n % 2], "skuCode":f"synthetic-{count}-{n}",
                "productName":f"合成商品{n}"} for n in range(count)]
            with self.stage("scale_fixture_setup", sampleCount=count):
                self.seed_sources(samples, category=category, prompt_id=prompt_id)
            with self.stage("create_plan_scale", sampleCount=count):
                result = self.command({"action":"create_job", "category":category,
                    "promptVersionId":prompt_id,"executor":"cloud","modelId":"synthetic-no-calls",
                    "limit":count,"concurrency":12}).json()["result"]
            self.assertEqual(result["totalCount"],count)
        (self.output/(self.run+".json")).write_text(json.dumps({"events":self.events,
            "productionWrites":0,"externalModelCalls":0},ensure_ascii=False,indent=2),encoding="utf-8")

    def test_04_frozen_skewed_query_plan_comparison(self):
        from market.annotations import _recognition_items, _retryable_items, _mode_expression
        from datetime import timedelta
        with connection.cursor() as c:
            c.execute("ALTER TABLE market_annotation_items SET (autovacuum_enabled=false)")
        old = [MarketAnnotationItem(id=f"old-{j}-{n}",job_id=f"old-job-{j}",category="synthetic",
            scope="audit",sku_code=f"old-sku-{n}",month="2026-10",image_content_sha256="a"*64)
            for j in range(54) for n in range(500)]
        MarketAnnotationItem.objects.bulk_create(old,batch_size=500)
        with connection.cursor() as c:
            c.execute("ANALYZE market_annotation_items")
        current = [MarketAnnotationItem(id=f"current-{n:05}",job_id="new-skewed-job",category="synthetic",
            scope="audit",sku_code=f"new-sku-{n}",month="2026-10",image_content_sha256="b"*64,
            reviewed_segment="Synthetic" if n<8109 else "",
            status="claimed" if n<3 else "queued",
            lease_expires_at=timezone.now()+timedelta(minutes=3) if n<3 else None)
            for n in range(8558)]
        MarketAnnotationItem.objects.bulk_create(current,batch_size=500)
        inflight=MarketAnnotationItem.objects.filter(**{f:OuterRef(f) for f in
            ("job_id","category","scope","sku_code","ranking_dimension","image_content_sha256")},
            status__in=["claimed","inferencing"],lease_expires_at__gt=timezone.now())
        q=_recognition_items(MarketAnnotationItem.objects.filter(job_id="new-skewed-job")).filter(
            _retryable_items()).filter(~Exists(inflight)).annotate(queue_mode=_mode_expression(["Synthetic"])).order_by(
                "queue_mode","updated_at","id")[:1]
        sql,params=q.query.sql_with_params()
        report={"syntheticOldRows":27000,"newJobRows":8558,"productionWrites":0,"externalModelCalls":0,
            "autovacuumDisabledOnlyOnDisposableTable":True,"sameFrozenSnapshotForFirstPair":True}
        with transaction.atomic():
            with connection.cursor() as c:
                c.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                c.execute("SET LOCAL statement_timeout='45s'")
                for name,setting in (("stale_statistics_default","on"),("diagnostic_hash_join","off")):
                    c.execute("SET LOCAL enable_nestloop="+setting)
                    c.execute("EXPLAIN (FORMAT JSON) "+sql,params)
                    plan=c.fetchone()[0][0]
                    start=time.perf_counter()
                    c.execute(sql,params)
                    row=c.fetchone()
                    report[name]={"durationMs":round((time.perf_counter()-start)*1000,3),
                        "selectedSyntheticId":row[0],"estimatedPlan":plan}
                self.assertEqual(report["stale_statistics_default"]["selectedSyntheticId"],
                    report["diagnostic_hash_join"]["selectedSyntheticId"])
        with connection.cursor() as c:
            start=time.perf_counter()
            c.execute("ANALYZE market_annotation_items")
            report["isolatedAnalyzeMs"]=round((time.perf_counter()-start)*1000,3)
            c.execute("EXPLAIN (FORMAT JSON) "+sql,params)
            plan=c.fetchone()[0][0]
            start=time.perf_counter()
            c.execute(sql,params)
            row=c.fetchone()
            report["fresh_statistics_default"]={"durationMs":round((time.perf_counter()-start)*1000,3),
                "selectedSyntheticId":row[0],"estimatedPlan":plan}
        self.assertEqual(report["stale_statistics_default"]["selectedSyntheticId"],
            report["fresh_statistics_default"]["selectedSyntheticId"])
        (self.output/(self.run+".json")).write_text(json.dumps(report,ensure_ascii=False,default=str,indent=2),encoding="utf-8")
        print("FROZEN_PLAN_AUDIT "+json.dumps({k:report[k]["durationMs"] for k in
            ("stale_statistics_default","diagnostic_hash_join","fresh_statistics_default")}),flush=True)
