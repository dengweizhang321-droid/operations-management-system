from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.db import close_old_connections, connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from sales.auth import Principal
from sales.tests.factories import TEST_SECRET, signed_headers
from workflow.errors import WorkflowApiError
from workflow.learning_operations import execute_learning_operation, learning_operation_status, learning_request_id
from workflow.models import NewProductLine, NewProductLineCode, WorkflowWriteAuthority, WorkflowWriteRequestReceipt
from workflow.tests.test_followup import master
from workflow.write_requests import MANUAL_LEARNING_PATH, claim_write_request

ADMIN = Principal(email="admin@example.test", display_name="Admin", role="admin", scope=None)
EMPTY_DIGEST = hashlib.sha256(b"").hexdigest()


@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class LearningOperationTests(TestCase):
    def setUp(self):
        WorkflowWriteAuthority.objects.filter(id=1).update(status="postgres")
        self.operation_id = str(uuid.uuid4())
        self.line = NewProductLine.objects.create(name="油水分离器", match_terms=[], monitoring_start_date="2026-08-03")
        master("LEARN-1", "商用油水分离器", 1)

    def post(self, operation_id=None, **identity):
        data = json.dumps({"operationId": operation_id or self.operation_id}, separators=(",", ":")).encode()
        return self.client.post(MANUAL_LEARNING_PATH, data=data, content_type="application/json",
            headers=signed_headers(MANUAL_LEARNING_PATH, method="POST", body=data, request_id="signed-wire-request", **identity))

    def status(self, operation_id=None, **identity):
        url = MANUAL_LEARNING_PATH + "/operations/" + (operation_id or self.operation_id)
        return self.client.get(url, headers=signed_headers(url, **identity))

    def test_repeated_id_and_lost_response_return_original_result_after_catalog_changes(self):
        first = self.post()
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["status"], "completed")
        self.assertEqual(len(first.json()["result"]["added"]), 1)
        master("LEARN-2", "新款油水分离器", 2)
        with patch("workflow.learning_operations.learn_product_line_codes", side_effect=AssertionError("must not execute again")):
            self.assertEqual(self.post().json(), first.json())
            self.assertEqual(self.status().json(), first.json())
        self.assertEqual(NewProductLineCode.objects.count(), 1)
        self.assertEqual(WorkflowWriteRequestReceipt.objects.count(), 1)
        self.assertEqual(self.post(str(uuid.uuid4())).json()["result"]["added"][0]["productCode"], "LEARN-2")

    def test_failure_rolls_back_business_and_is_a_stable_terminal_receipt(self):
        def fail(principal):
            NewProductLineCode.objects.create(product_line=self.line, product_code="TEMP", product_name="temporary")
            raise WorkflowApiError("学习规则未通过校验")
        with patch("workflow.learning_operations.learn_product_line_codes", side_effect=fail):
            failed = self.post()
        self.assertEqual(failed.json()["status"], "failed")
        self.assertFalse(NewProductLineCode.objects.exists())
        with patch("workflow.learning_operations.learn_product_line_codes", side_effect=AssertionError("must not retry failed operation")):
            self.assertEqual(self.post().json(), failed.json())
            self.assertEqual(self.status().json(), failed.json())

    def test_missing_receipt_is_unconfirmed_and_status_query_has_no_side_effect(self):
        before = WorkflowWriteRequestReceipt.objects.count()
        self.assertEqual(self.status().json(), {"operationId": self.operation_id, "status": "unconfirmed"})
        self.assertEqual(WorkflowWriteRequestReceipt.objects.count(), before)
        self.assertFalse(NewProductLineCode.objects.exists())

    def test_actor_scope_roles_and_request_binding_are_enforced(self):
        first = self.post()
        self.assertEqual(self.status(email="other@example.test").json()["status"], "unconfirmed")
        self.assertEqual(self.post(email="other@example.test").status_code, 409)
        for role in ("viewer", "analyst"):
            self.assertEqual(self.status(role=role).status_code, 403)
            self.assertEqual(self.post(role=role).status_code, 403)
        scope = {"warehouses": [], "channels": [], "platforms": ["京东"]}
        self.assertEqual(self.status(scope=scope).status_code, 403)
        self.assertEqual(self.post(scope=scope).status_code, 403)
        self.assertEqual(self.status().json(), first.json())

    def test_old_receipt_survives_generic_cleanup_and_is_never_reexecuted(self):
        first = self.post().json()
        WorkflowWriteRequestReceipt.objects.filter(request_id=learning_request_id(self.operation_id)).update(expires_at=timezone.now()-timedelta(days=30))
        claim_write_request(request_id="other-write", actor_email=ADMIN.email, method="POST", path="/api/workflow/tasks",
            body_sha256=EMPTY_DIGEST, query_sha256=EMPTY_DIGEST)
        self.assertEqual(self.post().json(), first)
        self.assertEqual(self.status().json(), first)
        self.assertEqual(NewProductLineCode.objects.count(), 1)

    def test_old_processing_or_failed_receipt_never_reclaims_by_age(self):
        for status in ("processing", "failed"):
            WorkflowWriteRequestReceipt.objects.update_or_create(request_id=learning_request_id(self.operation_id), defaults={
                "actor_email": ADMIN.email, "method": "POST", "path": MANUAL_LEARNING_PATH,
                "body_sha256": hashlib.sha256(json.dumps({"operationId": self.operation_id}, separators=(",", ":")).encode()).hexdigest(),
                "query_sha256": EMPTY_DIGEST, "status": status, "expires_at": timezone.now()-timedelta(days=30),
            })
            WorkflowWriteRequestReceipt.objects.filter(request_id=learning_request_id(self.operation_id)).update(updated_at=timezone.now()-timedelta(days=30))
            self.assertEqual(self.post().status_code, 409)
            self.assertEqual(self.status().json()["status"], "unconfirmed")
        self.assertFalse(NewProductLineCode.objects.exists())

    def test_bad_operation_id_query_and_extra_fields_are_rejected(self):
        self.assertEqual(self.post("bad-id").status_code, 400)
        url = MANUAL_LEARNING_PATH + "?unexpected=1"
        data = json.dumps({"operationId": self.operation_id}).encode()
        result = self.client.post(url, data=data, content_type="application/json", headers=signed_headers(url, method="POST", body=data))
        self.assertEqual(result.status_code, 400)
        data = json.dumps({"operationId": self.operation_id, "expectedSourceBatchId": "bad"}).encode()
        result = self.client.post(MANUAL_LEARNING_PATH, data=data, content_type="application/json", headers=signed_headers(MANUAL_LEARNING_PATH, method="POST", body=data))
        self.assertEqual(result.status_code, 400)
        self.assertFalse(WorkflowWriteRequestReceipt.objects.exists())

    def test_writer_only_status_route_does_not_expand_reader_routes(self):
        from django.urls import URLResolver
        from django.urls.resolvers import RegexPattern
        from workflow.urls import read_patterns, write_patterns
        from django.urls.exceptions import Resolver404
        path = "api/workflow/new-product-lines/learn/operations/" + self.operation_id
        with self.assertRaises(Resolver404):
            URLResolver(RegexPattern(r"^api/workflow/"), read_patterns).resolve(path)
        self.assertIsNotNone(URLResolver(RegexPattern(r"^api/workflow/"), write_patterns).resolve(path))

    def test_status_query_works_with_only_existing_writer_select_privileges(self):
        if connection.vendor != "postgresql": self.skipTest("PostgreSQL privilege contract")
        from psycopg import sql
        self.post()
        role = "learning_status_" + uuid.uuid4().hex[:12]
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(role)))
            cursor.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role)))
            cursor.execute(sql.SQL("GRANT SELECT ON workflow_write_request_receipts, workflow_data_revisions TO {}").format(sql.Identifier(role)))
            cursor.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(role)))
            try:
                response = self.status()
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["status"], "completed")
            finally: cursor.execute("RESET ROLE")


class LearningOperationConcurrencyTests(TransactionTestCase):
    def test_overlapping_same_id_executes_once_and_commits_receipt_with_mutation(self):
        if connection.vendor != "postgresql":
            self.skipTest("Requires real PostgreSQL advisory locks")
        WorkflowWriteAuthority.objects.filter(id=1).update(status="postgres")
        operation_id = str(uuid.uuid4())
        line = NewProductLine.objects.create(name="Concurrent learning", monitoring_start_date="2026-08-03")
        entered, release, second_started = threading.Event(), threading.Event(), threading.Event()
        results, errors, calls, pids = [], [], [], []
        def learning(principal):
            calls.append(1)
            NewProductLineCode.objects.create(product_line=line, product_code="CONCURRENT-1", product_name="synthetic")
            entered.set()
            if not release.wait(10): raise AssertionError("fixture release timed out")
            return {"added": [], "ambiguous": [], "scanned": 3}
        def invoke(second=False):
            close_old_connections()
            try:
                if second:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        pids.append(cursor.fetchone()[0])
                    second_started.set()
                results.append(execute_learning_operation(operation_id, ADMIN, body_sha256=EMPTY_DIGEST))
            except Exception as error: errors.append(error)
            finally: connections.close_all()
        with patch("workflow.learning_operations.learn_product_line_codes", side_effect=learning):
            first = threading.Thread(target=invoke); first.start()
            try:
                self.assertTrue(entered.wait(10))
                second = threading.Thread(target=invoke, args=(True,)); second.start()
                self.assertTrue(second_started.wait(10))
                deadline = time.monotonic() + 5
                waiting = False
                while time.monotonic() < deadline:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=%s AND locktype='advisory' AND NOT granted)", [pids[0]])
                        waiting = cursor.fetchone()[0]
                    if waiting: break
                    time.sleep(0.01)
                self.assertTrue(waiting, "second execution must wait for first transaction's advisory lock")
                self.assertEqual(learning_operation_status(operation_id, ADMIN)["status"], "unconfirmed")
                self.assertFalse(NewProductLineCode.objects.filter(product_code="CONCURRENT-1").exists())
            finally: release.set()
            first.join(10); second.join(10)
        self.assertFalse(first.is_alive()); self.assertFalse(second.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0], results[1])
        self.assertEqual(NewProductLineCode.objects.filter(product_code="CONCURRENT-1").count(), 1)
        self.assertEqual(WorkflowWriteRequestReceipt.objects.get().status, "completed")
