"""Light progress reads use synthetic data and never call images or models."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import os
from pathlib import Path
import statistics
from tempfile import TemporaryDirectory
import time
import uuid
from unittest import skipUnless
from unittest.mock import patch

from django.db import DatabaseError, close_old_connections, connection, connections, transaction
from django.test import TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from market import annotations, views
from market.errors import MarketApiError
from market.models import (MarketAnnotationCloudRun, MarketAnnotationItem, MarketAnnotationJob,
    MarketDataRevision, MarketMasterAuditLog, MarketWriteAuthority)
from market.revisions import bump_revision, revision_value
from market.tests.factories import body_bytes
from market.tests.test_annotation_queue import QueueFixtures, PRINCIPAL
from sales.tests.factories import TEST_SECRET, signed_headers


EPOCH = "11111111-1111-4111-8111-111111111111"
CUTOVER = "market-light-progress-test"


def evidence(name, value):
    target = os.environ.get("MARKET_PROGRESS_LIGHT_EVIDENCE")
    if target:
        directory = Path(target).resolve()
        if not directory.is_relative_to(Path("D:/codex-artifacts")):
            raise RuntimeError("Evidence must remain outside Git")
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (name + ".json")).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


@override_settings(MARKET_WRITE_AUTHORITY_EPOCH=EPOCH, MARKET_WRITE_CUTOVER_ID=CUTOVER)
@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class ProgressLightTests(QueueFixtures, TransactionTestCase):
    available_apps = ["market"]

    def setUp(self):
        MarketWriteAuthority.objects.update_or_create(id=1, defaults={"status": "postgres",
            "authority_epoch": EPOCH, "cutover_id": CUTOVER,
            "migration_verify_run_id": "synthetic", "activated_at": timezone.now()})
        MarketDataRevision.objects.update_or_create(domain="market", defaults={"revision": 0, "source_digest": "a" * 64})

    def payload(self, job_id, view="progress_light"):
        return {"operation": "annotations", "view": view, "params": {"jobId": job_id}}

    def post(self, payload, *, role="viewer", scope=None, signed=True):
        body = body_bytes(payload)
        headers = signed_headers("/api/market/queries", method="POST", body=body,
            request_id="light-" + uuid.uuid4().hex, role=role, scope=scope) if signed else {}
        return self.client.post("/api/market/queries", data=body, content_type="application/json", headers=headers)

    def test_one_item_aggregate_no_heavy_helpers_no_writes_and_common_values_match(self):
        job = self.job("live-counts")
        job.started_at = timezone.now()
        job.total_count = 999
        job.save()
        now = timezone.now()
        for n, (status, attempt, expiry) in enumerate([
            ("queued", 0, None), ("queued", 3, None), ("failed", 1, None), ("failed", 3, None),
            ("claimed", 1, now + timedelta(minutes=1)), ("inferencing", 1, now - timedelta(minutes=1)),
            ("claimed", 1, None), ("review_pending", 0, None), ("approved", 1, None),
            ("rejected", 1, None), ("committed", 1, None), ("superseded", 0, None),
        ]):
            self.item(job, "item-" + str(n), status=status, attempt_count=attempt, lease_expires_at=expiry)
        original = list(MarketAnnotationJob.objects.values())
        original_items = list(MarketAnnotationItem.objects.order_by("id").values())
        detailed = annotations.execute_annotation_query(self.payload(job.id, "progress"), PRINCIPAL)
        def reject_writes(execute, sql, params, many, context):
            self.assertNotIn(sql.lstrip().split()[0].upper(), {"INSERT", "UPDATE", "DELETE", "TRUNCATE"})
            return execute(sql, params, many, context)
        with patch.object(annotations, "_summarize_job", side_effect=AssertionError("heavy summary")), \
                patch.object(annotations, "_queue_progress", side_effect=AssertionError("heavy queue")), \
                patch.object(annotations, "_recognition_items", side_effect=AssertionError("audit annotation")), \
                connection.execute_wrapper(reject_writes), CaptureQueriesContext(connection) as captured:
            response = self.post(self.payload(job.id))
        self.assertEqual(response.status_code, 200, response.content)
        light = response.json()
        self.assertEqual(set(light), {"job", "activeClaims", "cloudRun", "sampledAt"})
        self.assertEqual(light["job"], detailed["job"])
        self.assertEqual(light["cloudRun"], detailed["cloudRun"])
        self.assertEqual(light["activeClaims"], 1)
        self.assertEqual(light["job"]["remainingInferenceCount"], 5)
        self.assertEqual(light["job"]["totalCount"], 11)
        self.assertEqual(light["job"]["completedCount"], 4)
        self.assertEqual(light["job"]["failedCount"], 2)
        item_queries = [q["sql"] for q in captured if 'FROM "market_annotation_items"' in q["sql"]]
        self.assertEqual(len(item_queries), 1)
        self.assertNotIn("market_master_audit_logs", " ".join(q["sql"] for q in captured))
        self.assertIsNotNone(timezone.datetime.fromisoformat(light["sampledAt"].replace("Z", "+00:00")))
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["X-Market-Data-Revision"], revision_value())
        self.assertEqual(list(MarketAnnotationJob.objects.values()), original)
        self.assertEqual(list(MarketAnnotationItem.objects.order_by("id").values()), original_items)

    def test_month_records_are_not_reported_as_unique_inference_units(self):
        job = self.job("months")
        for month in ("2026-08", "2026-09", "2026-10"):
            self.item(job, month, sku="same", month=month)
        light = self.post(self.payload(job.id)).json()
        detailed = annotations.execute_annotation_query(self.payload(job.id, "progress"), PRINCIPAL)
        self.assertEqual(light["job"]["remainingInferenceCount"], 3)
        self.assertEqual(detailed["remainingInferenceUnits"], 1)
        self.assertNotIn("uniqueInferenceUnits", light)
        self.assertNotIn("remainingInferenceUnits", light)

    def test_contract_roles_scope_authority_revision_and_not_found(self):
        job = self.job("contract")
        self.item(job, "queued")
        for role in ("viewer", "analyst", "operator", "admin"):
            self.assertEqual(self.post(self.payload(job.id), role=role).status_code, 200)
        self.assertEqual(self.post(self.payload(job.id), signed=False).status_code, 401)
        self.assertEqual(self.post(self.payload(job.id), scope={"warehouses": [], "channels": [], "platforms": ["JD"]}).status_code, 403)
        self.assertEqual(self.post(self.payload("missing")).status_code, 404)
        for params in ({}, {"jobId": ""}, {"jobId": 1}, {"jobId": "x" * 129}, {"jobId": job.id, "page": 1}):
            self.assertEqual(self.post({**self.payload(job.id), "params": params}).status_code, 400)
        self.assertEqual(self.post({**self.payload(job.id), "extra": 1}).status_code, 400)
        MarketWriteAuthority.objects.filter(id=1).update(cutover_id="foreign")
        self.assertEqual(self.post(self.payload(job.id)).status_code, 503)
        MarketWriteAuthority.objects.filter(id=1).update(cutover_id=CUTOVER)
        MarketDataRevision.objects.filter(domain="market").update(source_digest="")
        self.assertEqual(self.post(self.payload(job.id)).status_code, 503)

    def test_statuses_and_run_control_version_match_existing_projection(self):
        job = self.job("states")
        self.item(job, "one", status="failed", attempt_count=3)
        for run_state in ("running", "paused", "completed"):
            token = uuid.uuid4().hex * 2
            MarketAnnotationCloudRun.objects.filter(job_id=job.id).update(state=run_state,
                retry_state_json={"controlVersion": token}, last_failure_code="inference_result_unknown")
            response = self.post(self.payload(job.id))
            self.assertEqual(response.status_code, 200, response.content)
            light = response.json()
            self.assertEqual(light["job"]["status"], "review_ready")
            self.assertEqual(light["cloudRun"]["state"], run_state)
            self.assertEqual(light["cloudRun"]["controlVersion"], token)
            self.assertEqual(light["cloudRun"]["lastFailureCode"], "inference_result_unknown")
        MarketAnnotationItem.objects.filter(job_id=job.id).update(status="committed")
        self.assertEqual(self.post(self.payload(job.id)).json()["job"]["status"], "committed")
        for status in ("cancelled", "deleted", "committed"):
            MarketAnnotationJob.objects.filter(id=job.id).update(status=status)
            self.assertEqual(self.post(self.payload(job.id)).json()["job"]["status"], status)
        MarketAnnotationCloudRun.objects.filter(job_id=job.id).update(retry_state_json={"controlVersion": "invalid"})
        self.assertEqual(self.post(self.payload(job.id)).status_code, 409)
        MarketAnnotationCloudRun.objects.filter(job_id=job.id).delete()
        self.assertIsNone(self.post(self.payload(job.id)).json()["cloudRun"])

    def test_real_gate_release_reuses_running_intent_and_preserves_paused_unknown(self):
        from market import annotation_activity
        from teruisi_backend.automation_drain import PROTOCOL
        running = self.job("gate-running")
        paused = self.job("gate-paused")
        unknown = self.job("gate-unknown")
        for job in (running, paused, unknown):
            self.item(job, "item-" + job.id)
        MarketAnnotationCloudRun.objects.filter(job_id=paused.id).update(state="paused")
        MarketAnnotationCloudRun.objects.filter(job_id=unknown.id).update(state="paused", last_failure_code="inference_result_unknown")
        before_versions = {run.job_id: annotations._control_version(run) for run in MarketAnnotationCloudRun.objects.all()}
        with TemporaryDirectory(prefix="market-progress-gate-") as directory:
            runtime = Path(directory)
            (runtime / "run").mkdir()
            gate = runtime / "run/automation-drain.json"
            with patch.object(annotations, "deployed_runtime", return_value=runtime), \
                    patch.object(annotation_activity, "deployed_runtime", return_value=runtime), \
                    patch.object(annotations, "_set_cloud_run", side_effect=AssertionError("must not auto resume")):
                for phase in ("helpers", "requests"):
                    gate.write_text(json.dumps({"version": PROTOCOL, "id": "a" * 32,
                        "phase": phase, "runtimeRoot": str(runtime)}), encoding="utf-8")
                    self.assertEqual(annotations._dispatch({"limit": 5})["jobs"], [])
                    self.assertTrue(self.claim(running)["stopped"])
                    self.assertEqual(MarketAnnotationItem.objects.get(id="item-" + running.id).attempt_count, 0)
                gate.unlink()
                self.assertEqual([row["jobId"] for row in annotations._dispatch({"limit": 5})["jobs"]], [running.id])
                lease = annotations._dispatch_lease({"jobId": running.id}, release=False)
                task = self.claim(running, coordinatorToken=lease["coordinatorToken"])["task"]
                self.assertIsNotNone(task)
                try:
                    self.assertIsNone(self.claim(paused)["task"])
                    self.assertIsNone(self.claim(unknown)["task"])
                    self.assertEqual(MarketAnnotationCloudRun.objects.get(job_id=unknown.id).last_failure_code, "inference_result_unknown")
                    for run in MarketAnnotationCloudRun.objects.all():
                        self.assertEqual(annotations._control_version(run), before_versions[run.job_id])
                finally:
                    annotation_activity.release(annotations._digest(task["leaseToken"]))

    def test_pause_after_dispatch_and_gate_before_claim_persistence_reject_without_attempt(self):
        from teruisi_backend.automation_drain import PROTOCOL, read_gate
        job = self.job("gate-race")
        self.item(job, "one")
        self.assertEqual(annotations._dispatch({"limit": 5})["jobs"][0]["jobId"], job.id)
        lease = annotations._dispatch_lease({"jobId": job.id}, release=False)
        annotations._set_cloud_run({"jobId": job.id, "state": "paused"}, PRINCIPAL)
        self.assertIsNone(self.claim(job, coordinatorToken=lease["coordinatorToken"])["task"])
        self.assertEqual(MarketAnnotationItem.objects.get(id="one").attempt_count, 0)
        annotations._set_cloud_run({"jobId": job.id, "state": "running"}, PRINCIPAL)
        with TemporaryDirectory(prefix="market-progress-late-gate-") as directory:
            runtime = Path(directory)
            (runtime / "run").mkdir()
            calls = 0
            def close_before_persist(root):
                nonlocal calls
                calls += 1
                if calls == 2:
                    (runtime / "run/automation-drain.json").write_text(json.dumps({"version": PROTOCOL,
                        "id": "b" * 32, "phase": "requests", "runtimeRoot": str(runtime)}), encoding="utf-8")
                return read_gate(root)
            with patch.object(annotations, "deployed_runtime", return_value=runtime), \
                    patch.object(annotations, "read_gate", side_effect=close_before_persist):
                result = self.claim(job)
            self.assertTrue(result["stopped"])
            self.assertEqual(calls, 2)
            item = MarketAnnotationItem.objects.get(id="one")
            self.assertEqual((item.status, item.attempt_count, item.lease_token_hash), ("queued", 0, ""))

    def test_gate_created_after_final_check_is_rejected_by_actual_native_barrier(self):
        from market import annotation_activity
        from teruisi_backend.automation_drain import PROTOCOL, read_gate
        job = self.job("barrier-race")
        self.item(job, "one")
        with TemporaryDirectory(prefix="market-progress-barrier-gate-") as directory:
            runtime = Path(directory)
            (runtime / "run").mkdir()
            calls = 0
            def close_after_check(root):
                nonlocal calls
                calls += 1
                value = read_gate(root)
                if calls == 2:
                    (runtime / "run/automation-drain.json").write_text(json.dumps({"version": PROTOCOL,
                        "id": "c" * 32, "phase": "helpers", "runtimeRoot": str(runtime)}), encoding="utf-8")
                return value
            with patch.object(annotations, "deployed_runtime", return_value=runtime), \
                    patch.object(annotation_activity, "deployed_runtime", return_value=runtime), \
                    patch.object(annotations, "read_gate", side_effect=close_after_check):
                result = self.claim(job)
            self.assertTrue(result["stopped"])
            self.assertEqual(calls, 2)
            item = MarketAnnotationItem.objects.get(id="one")
            self.assertEqual((item.status, item.attempt_count, item.lease_token_hash), ("queued", 0, ""))
            self.assertNotIn(item.lease_token_hash, annotation_activity._leases)

    @skipUnless(connection.vendor == "postgresql", "PostgreSQL snapshot required")
    def test_parent_transaction_is_unchanged_and_failure_rolls_back_settings(self):
        def settings():
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('transaction_isolation'), current_setting('transaction_read_only'), "
                    "current_setting('statement_timeout'), current_setting('lock_timeout'), current_setting('idle_in_transaction_session_timeout')")
                return cursor.fetchone()
        before = settings()
        with transaction.atomic():
            parent = settings()
            with self.assertRaises(MarketApiError), patch.object(views, "revision_value") as revision:
                views._progress_light_read(lambda: {})
            revision.assert_not_called()
            self.assertEqual(settings(), parent)
        with self.assertRaisesRegex(RuntimeError, "fixture failure"):
            views._progress_light_read(lambda: (_ for _ in ()).throw(RuntimeError("fixture failure")))
        self.assertEqual(settings(), before)
        with connection.cursor() as cursor:
            cursor.execute("SET statement_timeout = '1200ms'")
            cursor.execute("SET lock_timeout = '700ms'")
        try:
            configured = settings()
            observed, _ = views._progress_light_read(lambda: {"settings": settings()})
            self.assertEqual(observed["settings"][:4], ("repeatable read", "on", "1200ms", "700ms"))
            self.assertEqual(settings(), configured)
            with patch.object(views, "monotonic", side_effect=[0, 6]), self.assertRaises(MarketApiError) as caught:
                views._progress_light_read(lambda: {})
            self.assertEqual((caught.exception.code, caught.exception.status), ("query_timeout", 503))
            self.assertEqual(settings(), configured)
        finally:
            with connection.cursor() as cursor:
                cursor.execute("RESET statement_timeout")
                cursor.execute("RESET lock_timeout")

    @skipUnless(connection.vendor == "postgresql", "PostgreSQL snapshot required")
    def test_revision_churn_does_not_create_false_503_or_mix_snapshot_values(self):
        job = self.job("churn")
        self.item(job, "one")
        original = views._execute_query
        sequence = 0
        def commit_new_version():
            nonlocal sequence
            close_old_connections()
            try:
                sequence += 1
                with transaction.atomic():
                    MarketAnnotationJob.objects.filter(id=job.id).update(local_model_name=str(sequence))
                    MarketAnnotationItem.objects.filter(job_id=job.id).update(status="committed")
                    MarketAnnotationCloudRun.objects.filter(job_id=job.id).update(state="paused", retry_state_json={"controlVersion": f"{sequence:064x}"})
                    bump_revision({"synthetic": sequence})
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as writer:
            def changing_loader(principal, payload):
                writer.submit(commit_new_version).result(timeout=10)
                return original(principal, payload)
            with patch.object(views, "_execute_query", side_effect=changing_loader):
                old = self.post(self.payload(job.id, "progress"))
                self.assertEqual(old.status_code, 503)
                for _ in range(5):
                    # This stable committed state is observed before the writer
                    # changes metadata, item counts, run version and revision.
                    MarketAnnotationItem.objects.filter(job_id=job.id).update(status="queued")
                    expected_revision = revision_value()
                    expected_job = MarketAnnotationJob.objects.get(id=job.id).local_model_name
                    expected_run = MarketAnnotationCloudRun.objects.get(job_id=job.id).retry_state_json["controlVersion"]
                    response = self.post(self.payload(job.id))
                    self.assertEqual(response.status_code, 200, response.content)
                    value = response.json()
                    self.assertEqual(response["X-Market-Data-Revision"], expected_revision)
                    self.assertEqual(value["job"]["localModelName"], expected_job)
                    self.assertEqual(value["job"]["remainingInferenceCount"], 1)
                    self.assertEqual(value["job"]["committedCount"], 0)
                    self.assertEqual(value["cloudRun"]["controlVersion"], expected_run)
                    self.assertNotEqual(revision_value(), expected_revision)

    @skipUnless(connection.vendor == "postgresql", "PostgreSQL runtime role required")
    def test_minimal_reader_grants_and_read_only_snapshot(self):
        from psycopg import sql
        job = self.job("reader")
        self.item(job, "one")
        role = "market_light_" + uuid.uuid4().hex[:12]
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE ROLE {} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS").format(sql.Identifier(role)))
            cursor.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role)))
            for table in ("market_annotation_jobs", "market_annotation_items", "market_annotation_cloud_runs",
                    "market_annotation_concurrency_settings", "market_data_revisions", "market_write_authority"):
                cursor.execute(sql.SQL("GRANT SELECT ON {} TO {}").format(sql.Identifier(table), sql.Identifier(role)))
        observed = []
        def inspect_snapshot(principal, payload):
            with connection.cursor() as cursor:
                cursor.execute("SHOW transaction_read_only")
                self.assertEqual(cursor.fetchone()[0], "on")
                cursor.execute("SHOW transaction_isolation")
                self.assertEqual(cursor.fetchone()[0], "repeatable read")
                with self.assertRaises(DatabaseError), transaction.atomic():
                    cursor.execute("UPDATE market_annotation_items SET selected = true")
                observed.append(True)
            return annotations.execute_annotation_query(payload, principal)
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(role)))
            with patch.object(views, "_execute_query", side_effect=inspect_snapshot):
                response = self.post(self.payload(job.id))
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(observed, [True])
            with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("SELECT * FROM sales_order_lines LIMIT 1")
        finally:
            with connection.cursor() as cursor:
                cursor.execute("RESET ROLE")
                cursor.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
                cursor.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))

    @skipUnless(connection.vendor == "postgresql", "PostgreSQL benchmark required")
    def test_synthetic_6023_records_with_history_benchmark(self):
        history = self.job("history")
        MarketAnnotationItem.objects.bulk_create([MarketAnnotationItem(id=f"history-{n}", job_id=history.id,
            category=history.category, sku_code=f"old-{n}", status="committed", month="2026-08",
            image_content_sha256="b" * 64) for n in range(18000)], batch_size=500)
        MarketMasterAuditLog.objects.bulk_create([MarketMasterAuditLog(actor_email=PRINCIPAL.email,
            actor_role=PRINCIPAL.role, entity_type="market_annotation_mode", entity_id=f"history-{n}", action="synthetic",
            after_json={"recognitionMode": "full", "historyReused": n % 3 == 0}) for n in range(18000)], batch_size=500)
        job = self.job("benchmark", concurrency=12)
        statuses = ["queued", "failed", "review_pending", "approved", "committed"]
        rows = []
        for n in range(6023):
            rows.append(MarketAnnotationItem(id=f"current-{n}", job_id=job.id, category=job.category,
                sku_code=f"sku-{n // 3}", month=f"2026-{8 + n % 3:02}", image_content_sha256="a" * 64,
                status=statuses[(n // 3) % len(statuses)], attempt_count=n % 4,
                reviewed_by="history_same_image" if n % 7 == 0 else "", total_inference_ms=100 if n % 5 == 0 else 0))
        MarketAnnotationItem.objects.bulk_create(rows, batch_size=500)
        samples = {"progress": [], "progress_light": []}
        sql_counts = {}
        for repeat in range(4):
            values = {}
            for view in ("progress", "progress_light"):
                with CaptureQueriesContext(connection) as captured:
                    start = time.perf_counter()
                    response = self.post(self.payload(job.id, view))
                    elapsed = (time.perf_counter() - start) * 1000
                self.assertEqual(response.status_code, 200, response.content)
                values[view] = response.json()
                if repeat:
                    samples[view].append(round(elapsed, 3))
                sql_counts[view] = len([q for q in captured if q["sql"].lstrip().startswith("SELECT")])
            for key in ("job", "activeClaims", "cloudRun"):
                self.assertEqual(values["progress"][key], values["progress_light"][key])
        result = {"syntheticJobRecords": 6023, "syntheticHistoryRecords": 18000,
            "syntheticHistoryAudits": 18000, "externalModelCalls": 0, "productionTouched": False,
            "warmSamplesMs": samples, "medianMs": {key: round(statistics.median(value), 3) for key, value in samples.items()},
            "selectQueries": sql_counts, "sharedValuesEqual": True, "productionP95": None}
        evidence("synthetic-benchmark", result)
        print("PROGRESS_LIGHT_BENCHMARK " + json.dumps(result), flush=True)
