"""Protocol fault fixtures and separately real signed workflow GET/PG tests."""
from __future__ import annotations

from datetime import datetime, timezone as dt_timezone
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import secrets
import threading
import time
from urllib.parse import urlsplit
from unittest.mock import patch

from django.db import connection
from django.db.models import F
from django.test import LiveServerTestCase, SimpleTestCase, override_settings
from django.urls import path
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from sales.auth import Principal
from workflow.models import WorkflowDataRevision, WorkflowOperationRecord
from workflow.operations_views import operation_records
from netshop.errors import NetshopApiError
from netshop import panorama_workflow_client as client
from netshop import store_panorama as panorama

urlpatterns = [path("api/workflow/operations-records", operation_records)]
SCOPE = {"platform": "京东", "shopName": "合成店A", "startDate": "2026-09-01", "endDate": "2026-09-01"}


class WorkflowProtocolTests(SimpleTestCase):
    """Fixed HTTP bodies below are only transport/protocol negative evidence."""
    def setUp(self):
        self.secret = secrets.token_hex(40)
        self.principal = Principal("workflow-protocol@example.test", "Synthetic", "viewer", None)
        self.response = {"status": 200, "headers": {"Content-Type": "application/json", "X-Workflow-Data-Revision": "1:" + "b" * 12}, "body": b'{}'}
        outer = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass
            def do_GET(self):
                outer.path = self.path
                self.send_response(outer.response["status"])
                for key, value in outer.response["headers"].items():
                    self.send_header(key, value)
                if not outer.response.get("stream"):
                    self.send_header("Content-Length", str(len(outer.response["body"])))
                self.end_headers()
                try:
                    self.wfile.write(outer.response["body"])
                except OSError:
                    pass
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.env = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": self.secret, "TERUISI_DJANGO_WORKFLOW_READER_BASE_URL": f"http://127.0.0.1:{self.server.server_port}"})
        self.env.start()
        self.parameters = client._parameters(SCOPE, 1, 20)

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def get(self, **kwargs):
        return client._api_get(self.principal, self.parameters, time.monotonic() + 65, **kwargs)

    def test_http_authority_precedes_bad_content_and_utf8(self):
        for status in (401, 403, 409):
            for body in (b"", b"<html>error</html>", b"\xff"):
                self.response.update(status=status, body=body, headers={"Content-Type": "text/html"})
                with self.subTest(status=status, body=body), self.assertRaises(NetshopApiError) as raised:
                    self.get()
                self.assertEqual(raised.exception.status, status)

    def test_502_503_are_safe_service_errors(self):
        for status in (502, 503):
            self.response.update(status=status, body=b"private error", headers={})
            with self.assertRaises(NetshopApiError) as raised:
                self.get()
            self.assertEqual((raised.exception.status, raised.exception.code), (503, "service_unavailable"))
            self.assertNotIn("private", str(raised.exception))

    def test_invalid_utf8_duplicate_or_nonfinite_json_fail_closed(self):
        for raw in (b"\xff", b'{"items":[],"items":[]}', b'{"value":NaN}', b"[1]"):
            self.response["body"] = raw
            with self.subTest(raw=raw), self.assertRaises(NetshopApiError) as raised:
                self.get()
            self.assertEqual(raised.exception.status, 503)

    def test_declared_and_streaming_bytes_are_bounded(self):
        self.response["body"] = b"x" * (client.MAX_BYTES + 1)
        for streamed in (False, True):
            self.response["stream"] = streamed
            with self.subTest(streamed=streamed), self.assertRaises(NetshopApiError) as raised:
                self.get()
            self.assertEqual(raised.exception.status, 503)

    def test_header_revision_change_precedes_bad_success_body(self):
        self.response.update(body=b"\xff", headers={"X-Workflow-Data-Revision": "2:" + "c" * 12, "Content-Type": "text/html"})
        with self.assertRaises(NetshopApiError) as raised:
            self.get(expected_revision="1:" + "b" * 12)
        self.assertEqual(raised.exception.status, 409)

    def test_redirect_and_unconfigured_endpoint_do_not_fallback(self):
        self.response.update(status=302, headers={"Location": "http://127.0.0.1:8001/unsafe"}, body=b"")
        with self.assertRaises(NetshopApiError):
            self.get()
        with patch.dict(os.environ, {"TERUISI_DJANGO_WORKFLOW_READER_BASE_URL": ""}), self.assertRaises(NetshopApiError):
            client._config()
        for url in ("http://example.test", "http://127.0.0.1:8001/path", "http://user:pass@127.0.0.1:8001", "http://127.0.0.1:8001?query=1"):
            with self.subTest(url=url), patch.dict(os.environ, {"TERUISI_DJANGO_WORKFLOW_READER_BASE_URL": url}), self.assertRaises(NetshopApiError):
                client._config()

    def test_shanghai_range_converts_to_utc_half_open_dates(self):
        self.assertEqual(self.parameters["from"], "2026-08-31T16:00:00.000Z")
        self.assertEqual(self.parameters["to"], "2026-09-01T16:00:00.000Z")
        with self.assertRaises(NetshopApiError):
            client._parameters({**SCOPE, "endDate": "2027-09-02"}, 1, 20)

    def test_chunk_budget_expiry_never_reads_another_chunk(self):
        clock, reads = [100.0], [0]
        class Response:
            status = 200
            fp = None
            headers = Message()
            headers["Content-Type"] = "application/json"
            headers["X-Workflow-Data-Revision"] = "1:" + "b" * 12
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read1(self, _size):
                reads[0] += 1
                clock[0] = 166.0
                return b'{"items":'
        with patch("netshop.panorama_workflow_client.time.monotonic", side_effect=lambda: clock[0]), patch("urllib.request.OpenerDirector.open", return_value=Response()), self.assertRaises(NetshopApiError) as raised:
            client._api_get(self.principal, self.parameters, 165.0)
        self.assertEqual(raised.exception.code, "source_not_ready")
        self.assertEqual(reads[0], 1)

    def test_interrupted_caller_is_not_local_service_error(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=InterruptedError("fixture interruption")), self.assertRaises(InterruptedError):
            self.get()

    def test_source_scope_window_pagination_and_strict_scalars_are_checked(self):
        filters = {"types": [], "statuses": [], "shopNames": [SCOPE["shopName"]], "platforms": [SCOPE["platform"]], "owners": [], "query": "",
                   "from": self.parameters["from"], "to": self.parameters["to"], "page": 1, "pageSize": 20, "dataScope": "unrestricted"}
        item = {"id": "E1", "platform": "京东", "shopName": "合成店A", "channel": "", "occurredAt": "2026-09-01T08:00:00.000Z", "title": "合成检查", "status": "open", "type": "inspection"}
        payload = {"filtersApplied": filters, "items": [item], "pagination": {"page": 1, "pageSize": 20, "total": 1, "returned": 1, "truncated": False}}
        mutations = [lambda p: p["filtersApplied"].update(platforms=["天猫"]), lambda p: p["items"][0].update(shopName="合成店B"),
                     lambda p: p["items"][0].update(occurredAt=self.parameters["to"]), lambda p: p["pagination"].update(returned=True),
                     lambda p: p["items"][0].update(status=False), lambda p: p["items"].append(dict(p["items"][0]))]
        for mutate in mutations:
            changed = json.loads(json.dumps(payload))
            mutate(changed)
            with self.assertRaises(NetshopApiError):
                client._project(changed, self.principal, SCOPE, self.parameters, "1:" + "b" * 12, "a" * 64)


@override_settings(ROOT_URLCONF=__name__, MEDIA_URL="/fixture-media/", STATIC_URL="/fixture-static/")
class RealWorkflowApiTests(LiveServerTestCase):
    """Actual signed GET, owning list_records ORM and private PostgreSQL."""
    host = "127.0.0.1"

    def setUp(self):
        self.principal = Principal("workflow-real@example.test", "Synthetic", "viewer", None)
        # TransactionTestCase flushes data-migration seeds between methods.
        # This is a private role row, not a runtime role/grant change.
        AccessRole.objects.get_or_create(code="viewer", defaults={"label": "Synthetic viewer", "description": "Private test role", "rank": 1})
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
        WorkflowDataRevision.objects.update_or_create(domain="workflow", defaults={"revision": 1, "source_digest": "b" * 64})
        self.env = patch.dict(os.environ, {"TERUISI_DJANGO_WORKFLOW_READER_BASE_URL": self.live_server_url})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def event(self, identifier, *, platform="京东", shop="合成店A", when="2026-09-01T08:00:00+00:00", channel="C1"):
        return WorkflowOperationRecord.objects.create(id=identifier, record_type="inspection", title="合成经营记录 " + identifier, status="open", platform=platform, shop_name=shop,
            channel=channel, occurred_at=datetime.fromisoformat(when), created_by=self.principal.email, updated_by=self.principal.email)

    def read(self, **kwargs):
        return client.read_panorama_workflow(self.principal, SCOPE, deadline=time.monotonic() + 65, **kwargs)

    def test_actual_signature_exact_and_store_and_half_open_occurrence_window(self):
        self.event("included", when="2026-08-31T16:00:00+00:00")
        self.event("excluded-old", when="2026-08-31T15:59:59+00:00")
        self.event("excluded-end", when="2026-09-01T16:00:00+00:00")
        self.event("other-shop", shop="合成店B")
        self.event("other-platform", platform="天猫")
        result = self.read()
        self.assertEqual([row["id"] for row in result["items"]], ["included"])
        self.assertEqual(result["items"][0]["eventType"], "inspection")
        self.assertEqual(result["sourceRevisions"][0]["domain"], "workflow")
        self.assertEqual(result["sourceRevisions"][0]["revision"], "1:" + "b" * 12)
        client.verify_panorama_workflow(self.principal, result, deadline=time.monotonic() + 65)

    def test_actual_more_pages_are_valid_metadata_not_source_corruption(self):
        for number in range(25):
            self.event(f"E{number:02d}")
        first = self.read()
        second = self.read(page=2)
        self.assertEqual(first["pagination"], {"page": 1, "pageSize": 20, "total": 25, "returned": 20, "truncated": True})
        self.assertEqual(second["pagination"]["returned"], 5)
        self.assertFalse(second["pagination"]["truncated"])
        self.assertFalse({r["id"] for r in first["items"]} & {r["id"] for r in second["items"]})

    def test_actual_original_channel_or_platform_scope_is_preserved(self):
        scope = {"platforms": [], "channels": ["C1"], "warehouses": []}
        self.user.scope = scope
        self.user.save(update_fields=["scope"])
        self.principal = Principal(self.principal.email, "Synthetic", "viewer", scope)
        self.event("permitted", channel="C1")
        self.event("forbidden", channel="C2")
        result = self.read()
        self.assertEqual([r["id"] for r in result["items"]], ["permitted"])

    def test_actual_revision_change_between_same_gets_is_global_409(self):
        self.event("E1")
        actual, calls = client._api_get, [0]
        def advance(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls[0] += 1
            if calls[0] == 1:
                WorkflowDataRevision.objects.filter(domain="workflow").update(revision=F("revision") + 1)
            return result
        with patch.object(client, "_api_get", side_effect=advance), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 409)

    def test_actual_actor_change_and_final_revision_recheck_fail_globally(self):
        self.event("E1")
        result = self.read()
        WorkflowDataRevision.objects.filter(domain="workflow").update(revision=F("revision") + 1)
        with self.assertRaises(NetshopApiError) as raised:
            client.verify_panorama_workflow(self.principal, result, deadline=time.monotonic() + 65)
        self.assertEqual(raised.exception.status, 409)
        self.user.status = "disabled"
        self.user.save(update_fields=["status"])
        with self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 403)

    def test_actual_actor_version_changes_during_http_read_fail_403(self):
        self.event("E1")
        actual, calls = client._api_get, [0]
        def advance(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls[0] += 1
            if calls[0] == 1:
                AppUser.objects.filter(pk=self.user.pk).update(version=F("version") + 1)
            return result
        with patch.object(client, "_api_get", side_effect=advance), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 403)

    def test_different_domain_owning_revisions_join_without_false_mismatch(self):
        self.event("E1")
        data = self.read()
        netshop = {"sourceRevisions": [{"domain": "netshop", "kind": "owning_revision", "scopeKey": "a" * 64, "revision": "99:" + "c" * 12}]}
        joined = panorama._joined_vector([netshop, data])
        self.assertEqual({r["domain"] for r in joined}, {"netshop", "workflow"})
