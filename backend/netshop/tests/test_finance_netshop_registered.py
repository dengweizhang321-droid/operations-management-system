"""Actual registered HMAC consumer + original urllib client, private PG only.

The slow loopback proxy forwards to the real registered source before delaying
its real response. No business response is mocked, no grants are issued.
"""
from copy import deepcopy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.request
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings, RequestFactory
from django.test.testcases import LiveServerThread
from django.urls import include, path
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from finance.analysis import get_finance_analysis
from finance.import_service import import_finance_payload
from finance.models import FinanceWriteAuthority, FinanceTarget
from finance.target_service import upsert_target, delete_target
from finance.tests.factories import prepared_payload, changed_raw_file, finance_line
from netshop import finance_netshop_client as client
from netshop.errors import NetshopApiError
from sales.auth import Principal, verify_principal
from sales.tests.factories import TEST_SECRET, signed_headers

urlpatterns = [path("api/finance/", include("finance.urls"))]
ENDPOINT = "/api/finance/consumers/query"
ROOT = Path(__file__).resolve().parents[3]
REQUEST = {"operation": "netshop_finance_read_v1", "shopKeys": ['["京东","同名店"]'],
           "months": ["2026-01", "2026-03"], "year": "2026"}


def evidence(name, payload):
    location = os.getenv("TERUISI_FINANCE_NETSHOP_CAPACITY")
    if location:
        directory = Path(location); directory.mkdir(exist_ok=True)
        with (directory / name).open("x", encoding="utf-8") as output:
            json.dump(payload, output, ensure_ascii=False, indent=2)


class SlowProxy:
    def __init__(self, upstream, mode, owning_bytes=None, revision=None):
        self.upstream, self.mode = upstream, mode
        self.owning_bytes, self.revision = owning_bytes, revision
        self.stop = threading.Event()
        self.handlers_closed = threading.Event()
        proxy = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                try:
                    raw = self.rfile.read(int(self.headers["Content-Length"]))
                    headers = {k: self.headers[k] for k in self.headers if k.lower().startswith("x-teruisi")}
                    headers["Content-Type"] = "application/json"
                    # Native HMAC canonical path and body remain unchanged.
                    if proxy.owning_bytes is not None:
                        # A source operation is prefetched with a separate
                        # ordinary native request. This isolates the client's
                        # receive budget from source SQL expiry; signed incoming
                        # header/body and native source bytes are still real.
                        verify_principal(RequestFactory().post(ENDPOINT, data=raw, content_type="application/json", headers=headers))
                        body, revision = proxy.owning_bytes, proxy.revision
                    else:
                        call = urllib.request.Request(proxy.upstream + ENDPOINT, data=raw, method="POST", headers=headers)
                        with urllib.request.urlopen(call, timeout=5) as upstream:
                            body = upstream.read(client.MAX_BYTES + 1)
                            revision = upstream.headers["X-Finance-Data-Revision"]
                    if proxy.mode in {"status", "headers"}:
                        lines = ([b"HTTP/", b"1.1 ", b"200 OK\r\n"] if proxy.mode == "status" else [b"HTTP/1.1 200 OK\r\n"]) + [b"Content-Type: application/json\r\n",
                                 ("X-Finance-Data-Revision: " + revision + "\r\n").encode(),
                                 ("Content-Length: " + str(len(body)) + "\r\n").encode(), b"\r\n"]
                        for line in lines:
                            if proxy.stop.wait(.025): return
                            self.wfile.write(line); self.wfile.flush()
                    else:
                        if proxy.mode == "headers_then_body" and proxy.stop.wait(.035): return
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("X-Finance-Data-Revision", revision)
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                    # Actual owning bytes, slowly delivered from the source.
                    for offset in range(0, len(body), 64):
                        if proxy.stop.wait(.015): return
                        self.wfile.write(body[offset:offset+64]); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                finally:
                    proxy.handlers_closed.set()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        self.thread.start()

    @property
    def url(self): return "http://127.0.0.1:" + str(self.server.server_port)

    def close(self):
        self.stop.set(); self.server.shutdown(); self.server.server_close(); self.thread.join(2)
        self.handlers_closed.wait(2)
        if self.thread.is_alive(): raise AssertionError("Owned slow proxy did not close")


@override_settings(ROOT_URLCONF=__name__, MEDIA_URL="/__private_none__/", STATIC_URL="/__private_none__/")
class RegisteredFinanceHttpTests(SimpleTestCase):
    # Ordinary transaction-test flushing legitimately rejects append-only
    # finance evidence. Keep guards intact: this disposable DB is dropped by
    # the runner, and each case installs new facts via the real private writer.
    databases = {"default"}
    host = "127.0.0.1"
    port = 0

    @classmethod
    def setUpClass(cls):
        cls.addClassCleanup(cls.record_close)
        super().setUpClass()
        cls.server_thread = LiveServerThread(cls.host, lambda app: app, port=0)
        cls.server_thread.daemon = True
        cls.server_thread.start(); cls.server_thread.is_ready.wait()
        if cls.server_thread.error: raise cls.server_thread.error
        cls.live_server_url = "http://127.0.0.1:" + str(cls.server_thread.port)
        cls.addClassCleanup(cls.server_thread.terminate)
        paths = ["backend/finance/consumers.py", "backend/finance/views.py", "backend/finance/netshop_reads.py",
                 "backend/netshop/finance_netshop_client.py", "backend/netshop/finance_netshop_contract.py",
                 "backend/netshop/bounded_consumer_http.py"]
        cls.source_paths = paths
        cls.before = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}

    @classmethod
    def record_close(cls):
        if not hasattr(cls, "before"): return
        after = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in cls.source_paths}
        evidence("registered-http-lifecycle.json", {"sourceBefore": cls.before, "sourceAfter": after,
            "sourceStable": cls.before == after, "httpPort": cls.server_thread.port,
            "httpThreadClosed": not cls.server_thread.is_alive(), "grantsIssuedByTests": 0,
            "syntheticPrivateOnly": True, "productionActions": [], "paidCalls": 0})
        if cls.before != after or cls.server_thread.is_alive(): raise AssertionError("HTTP source drift or live resource")

    def setUp(self):
        super().setUp()
        FinanceWriteAuthority.objects.update_or_create(id=1, defaults={"status": "postgres"})
        for rank, role in enumerate(("viewer", "analyst", "operator", "admin"), 1):
            AccessRole.objects.get_or_create(code=role, defaults={"rank": rank, "label": role})
        now = timezone.now()
        self.email = self._testMethodName + "@registered-finance.test"
        self.user = AppUser.objects.create(email=self.email, role_id="viewer", display_name="Synthetic",
            status="active", scope=None, version=1, created_at=now, updated_at=now)
        self.principal = Principal(self.email, "Synthetic", "viewer", None)
        original = prepared_payload("2026-01", "2026-03")
        original["rawFileHash"] = hashlib.sha256(self.id().encode()).hexdigest()
        import_finance_payload(original, self.email)
        for goal in list(FinanceTarget.objects.filter(period_type="year", period_key="2026", shop_name="同名店")):
            delete_target(goal.id, goal.version, self.email, "synthetic private fixture reset")
        self.env = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET,
            "TERUISI_DJANGO_FINANCE_READER_BASE_URL": self.live_server_url})
        self.env.start(); self.addCleanup(self.env.stop)
        self.assertTrue(self.live_server_url.startswith("http://127.0.0.1:"))
        self.assertNotIn(self.live_server_url.rsplit(":", 1)[1], {"5432", "8001"})

    def post(self, payload=None, *, role="viewer", scope=None, unsigned=False, body=None):
        raw = body if body is not None else json.dumps(payload or REQUEST, ensure_ascii=False, separators=(",", ":")).encode()
        headers = {} if unsigned else signed_headers(self.live_server_url + ENDPOINT, method="POST", body=raw,
                    role=role, scope=scope, email=self.email)
        headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.live_server_url + ENDPOINT, data=raw, method="POST", headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            actual = response.read(client.MAX_BYTES + 1)
            return response.status, json.loads(actual), dict(response.headers), actual

    def test_registered_four_original_roles_complete_native_month_year_no_store(self):
        upsert_target({"periodType": "year", "periodKey": "2026", "platform": "京东", "shopName": "同名店",
                       "salesTargetCents": 360000, "profitTargetCents": 90000})
        for role in ("viewer", "analyst", "operator", "admin"):
            AppUser.objects.filter(pk=self.email).update(role_id=role)
            status, result, headers, raw = self.post(role=role)
            self.assertEqual(status, 200, result)
            dto = result["data"]
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(headers["X-Finance-Data-Revision"], dto["sourceRevisions"][0]["revision"])
            self.assertEqual(dto["monthly"]["data"], get_finance_analysis(requested_months=REQUEST["months"], shop_keys=REQUEST["shopKeys"]))
            self.assertEqual(dto["annual"]["data"]["items"][0]["salesProgress"], .5)
            evidence("registered-" + role + ".json", {"request": REQUEST, "response": result,
                "owningRevision": headers["X-Finance-Data-Revision"], "bytes": len(raw), "syntheticPrivateOnly": True})

    def test_original_python_urllib_client_to_actual_registered_reader(self):
        data, revision = client.read_finance_netshop(self.principal, REQUEST, deadline=time.monotonic()+3)
        self.assertEqual(data["monthly"]["currentMetricStates"]["netSalesCents"]["value"], 180000)
        self.assertEqual(revision, data["sourceRevisions"][0]["revision"])
        self.assertEqual(data["annual"]["data"]["items"][0]["target"], None)
        evidence("registered-python-rpc.json", {"request": REQUEST, "response": {"operation": client.OPERATION, "data": data},
                "owningRevision": revision, "syntheticPrivateOnly": True})

    def test_unknown_duplicate_unsigned_scope_and_live_actor_refuse(self):
        self.assertEqual(self.post(unsigned=True)[0], 401)
        for payload in ({**REQUEST, "sql": "SELECT"}, {**REQUEST, "callerSourceURL": "http://invalid"}, {**REQUEST, "months": []}):
            self.assertEqual(self.post(payload)[0], 400)
        body = json.dumps(REQUEST, ensure_ascii=False).encode()
        self.assertEqual(self.post(body=body[:-1] + b',"year":"2026"}')[0], 400)
        scope = {"warehouses": [], "channels": [], "platforms": ["京东"]}
        AppUser.objects.filter(pk=self.email).update(scope=scope)
        self.assertEqual(self.post()[0], 403)
        self.assertEqual(self.post(scope=scope)[0], 403)
        with self.assertRaises(NetshopApiError) as denied:
            client.read_finance_netshop(self.principal, REQUEST)
        self.assertEqual(denied.exception.status, 403)
        AppUser.objects.filter(pk=self.email).update(scope=None, status="inactive")
        self.assertEqual(self.post()[0], 403)

    def test_registered_typed_revision_snapshot_and_signed_expiry(self):
        data, _ = client.read_finance_netshop(self.principal, REQUEST)
        self.assertEqual(self.post({**REQUEST, "expectedRevision": "999:aaaaaaaaaaaa"})[0], 409)
        AppUser.objects.filter(pk=self.email).update(version=2)
        self.assertEqual(self.post({**REQUEST, "snapshotToken": data["snapshotToken"]})[0], 409)
        status, result, _, _ = self.post({**REQUEST, "expiresAtEpochMs": 0})
        self.assertEqual((status, result["code"]), (503, "source_not_ready"))

    def test_registered_real_zero_null_field_cross_platform_year_scope(self):
        imported = changed_raw_file(prepared_payload("2026-01", "2026-03"))
        for month in imported["months"]:
            for row in month["lines"]:
                if row["scopeType"] == "shop" and row["groupName"] == "京东":
                    if row["metricKey"] in {"gross_sales", "net_sales"}: row["amountCents"] = 0
                    if row["metricKey"] == "net_cost": row["amountCents"] = None
        import_finance_payload(imported, self.email)
        data, _ = client.read_finance_netshop(self.principal, REQUEST)
        self.assertEqual(data["monthly"]["data"]["shops"], [])
        self.assertEqual(data["monthly"]["currentMetricStates"]["netSalesCents"]["value"], 0)
        self.assertEqual(data["monthly"]["currentMetricStates"]["netCostCents"]["reasonCode"], "missing_field")
        both = {**REQUEST, "shopKeys": ['["京东","同名店"]', '["天猫","同名店"]']}
        data, _ = client.read_finance_netshop(self.principal, both)
        self.assertEqual({r["platform"]: r["netSalesCents"] for r in data["annual"]["data"]["items"]}, {"京东": 0, "天猫": 120000})

    def test_live_slow_status_headers_and_body_share_whole_parent_deadline(self):
        results = []
        status, source, headers, raw = self.post()
        self.assertEqual(status, 200, source)
        for mode in ("status", "headers", "body", "headers_then_body"):
            proxy = SlowProxy(self.live_server_url, mode, raw, headers["X-Finance-Data-Revision"])
            try:
                with patch.dict(os.environ, {"TERUISI_DJANGO_FINANCE_READER_BASE_URL": proxy.url}):
                    before = time.monotonic()
                    with self.assertRaises(NetshopApiError) as timeout:
                        client.read_finance_netshop(self.principal, REQUEST, deadline=before+.05)
                    elapsed = time.monotonic()-before
                    self.assertEqual(timeout.exception.status, 503)
                    self.assertLess(elapsed, .10, (mode, elapsed))
                    results.append({"mode": mode, "deadlineMs": 50, "elapsedMs": elapsed*1000,
                                    "status": timeout.exception.status, "code": timeout.exception.code})
            finally:
                proxy.close()
            self.assertFalse(proxy.thread.is_alive())
        evidence("registered-live-slow-deadlines.json", {"results": results, "actualRegisteredSourceForwarded": True,
                 "sourcePrefetchedSeparatelyToIsolateClientReceiveBudget": True,
                 "allProxyThreadsClosed": True, "productionTouched": False})

    def test_actual_large_native_field_matrix_rejects_2mib_without_truncation(self):
        months = [f"{year}-{month:02d}" for year in range(2019, 2025) for month in range(1, 13)]
        native = prepared_payload(*months)
        shops = [f"budget-shop-{i:02d}" for i in range(50)]
        for month in native["months"]:
            for name in shops:
                for metric in ("net_sales", "profit"):
                    month["lines"].append(finance_line(month["month"], metric, 1, scope_type="shop",
                        scope_name=name, group_name="京东", scope_key="shop:京东:" + name))
            month["shopCount"] += 50
        native["rawFileHash"] = hashlib.sha256(b"synthetic-large-native-field-matrix").hexdigest()
        import_finance_payload(native, self.email)
        request = {**REQUEST, "shopKeys": [json.dumps(["京东", name], ensure_ascii=False, separators=(",", ":")) for name in shops],
                   "months": [m for m in months if m[:4] in {"2023", "2024"}], "year": "2024"}
        status, result, _, _ = self.post(request)
        self.assertEqual((status, result["code"]), (422, "quality_incomplete"), result)
        evidence("registered-real-capacity-rejection.json", {"request": request, "status": status,
            "code": result["code"], "nativeImportedMonths": 72, "nativeShopPairs": 50,
            "noPayloadOrFieldTruncation": True, "syntheticPrivateOnly": True})
