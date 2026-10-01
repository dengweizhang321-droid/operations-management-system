"""Actual registered signed sales endpoint on owned loopback + isolated PG.

No fake business response, production fallback, import action or model call.
The private runner installs only synthetic facts. Django owns the HTTP lifetime.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.error
import urllib.request
from unittest.mock import patch

from django.test import LiveServerTestCase, override_settings
from django.urls import include, path
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from netshop.errors import NetshopApiError
from netshop.sales_client import read_sales_consumer
from netshop.sales_periods_client import read_sales_periods
from netshop.bounded_consumer_http import open_bounded_consumer_request
from sales import netshop_periods as owner
from sales import views
from sales.auth import Principal
from sales.models import SalesDataRevision, SalesOrderLine
from sales.tests.factories import TEST_SECRET, install_fixture, make_line, signed_headers

urlpatterns = [path("api/sales/", include("sales.urls"))]
ENDPOINT = "/api/sales/consumers/query"
ROOT = Path(__file__).resolve().parents[3]
REQUEST = {"operation": "netshop_periods_v1", "current": {"startDate": "2026-08-01", "endExclusive": "2026-08-03"}, "baseline": {"startDate": "2026-07-01", "endExclusive": "2026-08-01"}}


def capture(name, request, raw, headers):
    target = os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
    if not target:
        return
    directory = Path(target); directory.mkdir(exist_ok=True)
    selected = {key: headers.get(key) for key in ("Content-Type", "X-Sales-Data-Revision", "X-Sales-Source-Revision", "X-Sales-Overview-Cache", "Cache-Control")}
    # Never persist signing headers or the synthetic internal secret.
    with (directory / (name + ".json")).open("xb") as out: out.write(raw)
    with (directory / (name + ".meta.json")).open("x", encoding="utf8") as out:
        json.dump({"request": request, "headers": selected, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "dataSource": "actual_registered_signed_loopback_synthetic_pg"}, out, ensure_ascii=False, indent=2)


@override_settings(ROOT_URLCONF=__name__, MEDIA_URL="/__synthetic_no_media__/", STATIC_URL="/__synthetic_no_static__/")
class RegisteredPeriodsHttpTests(LiveServerTestCase):
    host = "127.0.0.1"
    port = 0

    @classmethod
    def source_snapshot(cls):
        paths=["backend/netshop/tests/test_sales_periods_http.py","backend/netshop/tests/test_sales_periods_response_validation.py","tests/netshop-sales-periods-live-sdk-probe.ts","backend/netshop/sales_periods_client.py","backend/netshop/sales_client.py","backend/sales/netshop_periods.py","backend/sales/views.py","backend/sales/consumers.py","backend/sales/urls.py","backend/sales/auth.py","lib/django/sales-consumer-reader.ts","lib/netshop/sales-periods-contract.ts","lib/ai/bounded-fetch.ts"]
        return {"head":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip(),"dirty":subprocess.check_output(["git","status","--porcelain"],cwd=ROOT,text=True),"sha256":{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in paths}}

    @classmethod
    def setUpClass(cls):
        # LIFO class cleanup runs Django's normal thread termination first.
        cls.addClassCleanup(cls.record_normal_close)
        super().setUpClass()
        cls.source_before=cls.source_snapshot()

    @classmethod
    def record_normal_close(cls):
        if not hasattr(cls,"source_before"):return
        after=cls.source_snapshot()
        target=os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
        if target:
            directory=Path(target);directory.mkdir(exist_ok=True)
            with (directory/"actual-http-lifecycle.json").open("x",encoding="utf8") as out:
                json.dump({"sourceBefore":cls.source_before,"sourceAfter":after,"sourceStable":cls.source_before==after,"httpHost":cls.host,"httpPort":cls.server_thread.port,"httpThreadClosed":not cls.server_thread.is_alive(),"productionFallback":False,"paidCalls":0},out,ensure_ascii=False,indent=2)
        if cls.source_before!=after or cls.server_thread.is_alive():raise AssertionError("Private HTTP source changed or thread did not close normally")

    def setUp(self):
        super().setUp()
        install_fixture()
        for rank, role in enumerate(("viewer", "analyst", "operator", "admin"), 1):
            AccessRole.objects.get_or_create(code=role, defaults={"rank": rank, "label": role})
        self.email = "signed-periods@example.test"
        self.user = AppUser.objects.create(email=self.email, display_name="Synthetic", role_id="admin", scope=None, status="active", version=1, created_at=timezone.now(), updated_at=timezone.now())
        self.principal = Principal(self.email, "Synthetic", "admin", None)
        self.environment = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET, "TERUISI_DJANGO_SALES_READER_BASE_URL": self.live_server_url})
        self.environment.start(); self.addCleanup(self.environment.stop)
        self.assertTrue(self.live_server_url.startswith("http://127.0.0.1:"))
        self.assertNotIn(self.live_server_url.rsplit(":", 1)[1], {"5432", "8001"})

    def post(self, request=None, *, role="admin", scope=None, email=None, unsigned=False, secret=TEST_SECRET, body_override=None):
        request = deepcopy(request if request is not None else REQUEST)
        body = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode()
        headers = {} if unsigned else signed_headers(self.live_server_url + ENDPOINT, method="POST", body=body, role=role, scope=scope, email=email or self.email, secret=secret)
        headers["Content-Type"] = "application/json; charset=utf-8"
        call = urllib.request.Request(self.live_server_url + ENDPOINT, data=body_override or body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(call, timeout=5) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                return response.status, json.loads(raw), response.headers, raw
        except urllib.error.HTTPError as error:
            raw = error.read(65536)
            return error.code, json.loads(raw), error.headers, raw

    def test_actual_signature_body_and_closed_expiry_validation(self):
        for options in ({"unsigned": True}, {"secret": "wrong-synthetic-secret-with-at-least-32"}, {"body_override": b'{"operation":"freshness"}'}):
            status, body, _, _ = self.post(**options)
            self.assertEqual(status, 401); self.assertEqual(body["code"], "authentication_required")
        for invalid in (True, None, 1.5, [123], "future", 9007199254740992):
            status, body, _, _ = self.post({**REQUEST, "expiresAtEpochMs": invalid})
            self.assertEqual(status, 400); self.assertEqual(body["code"], "invalid_sales_periods_request")
        status, body, _, _ = self.post({**REQUEST, "expiresAtEpochMs": int(time.time()*1000)-1})
        self.assertEqual(status, 503); self.assertEqual(body["code"], "source_not_ready")

    def test_registered_four_roles_exact_raw_channel_and_warehouse_scope(self):
        SalesOrderLine.objects.bulk_create([make_line(10, "other-channel", channel="渠道B"), make_line(11, "other-warehouse", channel="渠道B", warehouse="另一仓"), make_line(12, "raw-spaces", channel=" 渠道B ", shop_name=" 京东一店 ")])
        scope = {"warehouses": ["主仓"], "channels": ["渠道B"], "platforms": []}
        request = {**REQUEST, "rawOutlets": [{"platform": "京东", "rawShopName": "京东一店", "rawChannel": "渠道B"}]}
        for role in ("viewer", "analyst", "operator", "admin"):
            AppUser.objects.filter(pk=self.email).update(role_id=role, scope=scope)
            status, envelope, headers, raw = self.post(request, role=role, scope=scope)
            self.assertEqual(status, 200)
            data = envelope["data"]
            self.assertEqual(data["periodTotals"]["current"]["rowCount"], 1)
            self.assertEqual(data["items"][0]["identity"], request["rawOutlets"][0])
            self.assertEqual(data["scopeMode"], "restricted")
            self.assertEqual(headers["X-Sales-Data-Revision"], "7:3")
            self.assertEqual(headers["X-Sales-Source-Revision"], "7:3")
            self.assertEqual(data["sourceRevisions"][0]["revision"], "7:3")
            self.assertEqual(headers["X-Sales-Overview-Cache"], "bypass_owned_periods_v1")
            if role == "admin": capture("registered-restricted", request, raw, headers)
        padded = {**REQUEST, "rawOutlets": [{"platform": "京东", "rawShopName": " 京东一店 ", "rawChannel": " 渠道B "}]}
        status, envelope, headers, raw = self.post(padded, scope=scope)
        # Existing grants require both raw channel and projection key to match;
        # whitespace is not an alias grant. A native platform grant is explicit.
        self.assertEqual(status, 200); self.assertEqual(envelope["data"]["periodTotals"]["current"]["rowCount"], 0)
        platform_scope = {"warehouses": ["主仓"], "channels": [], "platforms": ["京东"]}
        AppUser.objects.filter(pk=self.email).update(scope=platform_scope)
        status, envelope, headers, raw = self.post(padded, scope=platform_scope)
        self.assertEqual(status, 200); self.assertEqual(envelope["data"]["periodTotals"]["current"]["rowCount"], 1)
        self.assertEqual(envelope["data"]["items"][0]["identity"], padded["rawOutlets"][0])
        capture("registered-restricted-spaces", padded, raw, headers)

    def test_same_signed_query_does_not_reuse_cache_or_skip_live_actor(self):
        with patch.object(views, "_consistent_read", side_effect=AssertionError("New operation must not use legacy cache")):
            status, envelope, headers, raw = self.post()
            self.assertEqual(status, 200); self.assertEqual(headers["Cache-Control"], "no-store")
            capture("registered-full", REQUEST, raw, headers)
            status, repeated, _, _ = self.post()
            self.assertEqual(status, 200); self.assertEqual(repeated, envelope)
            for change in ({"status": "disabled"}, {"role_id": "viewer"}, {"scope": {"warehouses": ["denied"], "channels": [], "platforms": []}}):
                AppUser.objects.filter(pk=self.email).update(**change)
                status, body, _, _ = self.post()
                self.assertEqual(status, 403); self.assertEqual(body["code"], "access_denied")
                AppUser.objects.filter(pk=self.email).update(status="active", role_id="admin", scope=None)
            status, body, _, _ = self.post(email="absent@example.test")
            self.assertEqual(status, 403); self.assertEqual(body["code"], "access_denied")

    def test_typed_pair_scope_and_actor_version_tokens_are_registered_409(self):
        _, envelope, _, _ = self.post()
        token = envelope["data"]["snapshotToken"]
        for request in ({**REQUEST, "expectedRevision": "8:3"}, {**REQUEST, "snapshotToken": token, "categories": ["another native cohort"]}):
            status, body, _, _ = self.post(request)
            self.assertEqual(status, 409); self.assertEqual(body["code"], "sales_periods_revision_changed")
        AppUser.objects.filter(pk=self.email).update(version=2)
        status, body, _, _ = self.post({**REQUEST, "snapshotToken": token})
        self.assertEqual(status, 409); self.assertEqual(body["code"], "sales_periods_revision_changed")
        status, body, _, _ = self.post({**REQUEST, "expectedRevision": "7:abcdefabcdef"})
        self.assertEqual(status, 400); self.assertEqual(body["code"], "invalid_sales_periods_request")

    def test_actual_api_retains_complete_baseline_only_union_over_500_before_search(self):
        SalesOrderLine.objects.bulk_create([make_line(1000+i,f"http-baseline-{i}",shop_name=f"基期店{i:04d}",ship_time="2026-07-04 10:00:00") for i in range(601)])
        status, original, _, _=self.post();self.assertEqual(status,200)
        query={**REQUEST,"q":"基期店","page":6,"pageSize":100}
        status,envelope,headers,raw=self.post(query);self.assertEqual(status,200)
        data=envelope["data"]
        self.assertEqual(data["candidatePagination"]["candidateCount"],603)
        self.assertEqual(data["candidatePagination"]["filteredCount"],601)
        self.assertEqual(data["candidatePagination"]["returned"],100)
        self.assertEqual(data["periodTotals"],original["data"]["periodTotals"])
        self.assertEqual(data["snapshotToken"],original["data"]["snapshotToken"])
        self.assertTrue(all(row["current"]["rowCount"]==0 and row["baseline"]["rowCount"]==1 for row in data["items"]))
        capture("registered-baseline-union",query,raw,headers)

    def test_real_python_rpc_full_shape_none8_and_signed_parent_budget(self):
        original = urllib.request.urlopen; timeouts = []; bodies = []
        def opening(call, **options):
            timeouts.append(options["timeout"]); bodies.append(json.loads(call.data)); return original(call, **options)
        def bounded_opening(call, **options):
            timeouts.append(min(options["timeout_cap"], options["deadline"] - time.monotonic()))
            bodies.append(json.loads(call.data))
            return open_bounded_consumer_request(call, **options)
        with patch("netshop.sales_client.urllib.request.urlopen", side_effect=opening), patch("netshop.bounded_consumer_http.open_bounded_consumer_request", side_effect=bounded_opening):
            data, revision = read_sales_periods(self.principal, REQUEST, deadline=time.monotonic()+5)
            self.assertEqual(revision, "7:3"); self.assertEqual(data["periodTotals"]["current"]["values"]["netSalesCents"], 14000)
            self.assertEqual(data["metricMetadata"]["cost"]["verification"], "unverified_source")
            self.assertNotIn("expiresAtEpochMs", data["requestedScope"])
            self.assertGreater(timeouts[0], 0); self.assertLessEqual(timeouts[0], 5)
            self.assertGreater(bodies[0]["expiresAtEpochMs"], time.time()*1000-1000)
            self.assertLessEqual(bodies[0]["expiresAtEpochMs"], time.time()*1000+5000)
            legacy, legacy_revision = read_sales_consumer(self.principal, {"operation": "freshness"})
            self.assertEqual(legacy_revision, "7:3"); self.assertIn("dataCutoffDate", legacy)
            self.assertEqual(timeouts[1], 8)
        for deadline in (True, float("inf"), float("nan"), "later", 9007199254740992):
            with patch("netshop.sales_client.urllib.request.urlopen") as forbidden, patch("netshop.bounded_consumer_http.open_bounded_consumer_request") as bounded_forbidden, self.assertRaises(NetshopApiError):
                read_sales_consumer(self.principal, REQUEST, deadline=deadline)
            forbidden.assert_not_called()
            bounded_forbidden.assert_not_called()

    def test_transport_latency_cannot_reset_signed_expiry_before_actor_sql(self):
        original = views.parse_consumer_body
        def delayed(request):
            value = original(request); time.sleep(0.12); return value
        wire = {**REQUEST, "expiresAtEpochMs": int(time.time()*1000)+40}
        with patch.object(views, "parse_consumer_body", side_effect=delayed), patch.object(owner, "_actor", wraps=owner._actor) as actor:
            status, body, _, _ = self.post(wire)
            self.assertEqual(status, 503); self.assertEqual(body["code"], "source_not_ready"); actor.assert_not_called()

    def test_actual_rpc_rechecks_concurrent_actor_and_source_revision_after_read(self):
        for domain in ("actor", "erp"):
            started = threading.Event(); released = threading.Event(); failures = []
            original = owner._canonical
            def gate(value):
                encoded = original(value)
                if isinstance(value, dict) and value.get("schemaVersion") == owner.SCHEMA:
                    started.set()
                    if not released.wait(3): raise AssertionError("Synthetic concurrent fence did not release")
                return encoded
            def read():
                try: read_sales_periods(self.principal, REQUEST, deadline=time.monotonic()+5)
                except Exception as error: failures.append(error)
            with patch.object(owner, "_canonical", side_effect=gate):
                thread = threading.Thread(target=read, name="owned-signed-fence", daemon=True); thread.start()
                try:
                    self.assertTrue(started.wait(3))
                    if domain == "actor": AppUser.objects.filter(pk=self.email).update(version=2, status="disabled")
                    else: SalesDataRevision.objects.filter(domain="erp").update(revision=4)
                finally: released.set(); thread.join(5)
            self.assertFalse(thread.is_alive()); self.assertEqual(len(failures), 1)
            self.assertIsInstance(failures[0], NetshopApiError)
            self.assertEqual(failures[0].status, 403 if domain == "actor" else 409)
            self.assertEqual(failures[0].code, "access_denied" if domain == "actor" else "sales_periods_revision_changed")
            AppUser.objects.filter(pk=self.email).update(status="active", version=1)
            SalesDataRevision.objects.filter(domain="erp").update(revision=3)

    def test_actual_http_true_zero_and_missing_order_leave_cost_proof_unverified(self):
        SalesOrderLine.objects.all().delete()
        SalesOrderLine.objects.bulk_create([make_line(20, "real-http-zero", allocated_amount_cents=0, cost_amount_cents=0, gross_profit_cents=0, quantity=0)])
        status, envelope, headers, raw = self.post()
        self.assertEqual(status, 200)
        data = envelope["data"]; self.assertEqual(data["periodTotals"]["current"]["orders"]["netAmountPerOrder"]["value"], 0)
        for name in ("cost", "grossProfit", "reportedGrossProfit"):
            self.assertEqual(data["metricMetadata"][name]["verification"], "unverified_source")
            self.assertEqual(data["metricMetadata"][name]["primaryMetricUse"], "unavailable_or_partial")
        capture("registered-zero", REQUEST, raw, headers)
        SalesOrderLine.objects.bulk_create([make_line(21, "real-http-missing", order_no="", online_order_no="online-is-not-customer-count")])
        status, envelope, headers, raw = self.post(); self.assertEqual(status, 200)
        self.assertEqual(envelope["data"]["periodTotals"]["current"]["orders"]["netAmountPerOrder"]["reasonCode"], "missing_order_no")
        self.assertIsNone(envelope["data"]["periodTotals"]["current"]["orders"]["netAmountPerOrder"]["value"])
        capture("registered-missing-order", REQUEST, raw, headers)

    def test_actual_ts_sdk_signed_http_success_expiry_and_registered_conflict(self):
        env = {key: value for key, value in os.environ.items() if key in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
        env.update(TERUISI_CROSSDOMAIN_LIVE_BASE=self.live_server_url, TERUISI_DJANGO_INTERNAL_SECRET=TEST_SECRET)
        probe = subprocess.run(["node", "--import", "tsx", "tests/netshop-sales-periods-live-sdk-probe.ts"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        self.assertEqual(probe.returncode, 0, probe.stdout+probe.stderr)
        result = json.loads(probe.stdout.strip())
        self.assertEqual(result["revision"], "7:3"); self.assertEqual(result["registeredConflict"], 409)
        self.assertTrue(result["signedExpiryBounded"])
        target = os.environ.get("TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR")
        if target:
            with (Path(target)/"actual-ts-sdk-result.json").open("x", encoding="utf8") as out: json.dump(result, out, indent=2)

    def test_actual_registered_optin_series_is_one_signed_rpc_with_full_native_return(self):
        identity={"platform":"京东","rawShopName":"京东一店","rawChannel":"渠道A"}
        request={**REQUEST,"seriesGrain":"week","seriesOutlets":[identity]}
        original=open_bounded_consumer_request;calls=[]
        def opening(call,**options):calls.append(json.loads(call.data));return original(call,**options)
        with patch("netshop.bounded_consumer_http.open_bounded_consumer_request",side_effect=opening):data,revision=read_sales_periods(self.principal,request,deadline=time.monotonic()+5)
        self.assertEqual(len(calls),1);self.assertIn("expiresAtEpochMs",calls[0])
        self.assertEqual(revision,"7:3");self.assertEqual(data["series"]["sourceRevisions"],data["sourceRevisions"])
        self.assertEqual(data["series"]["items"][0]["identity"],identity)
        self.assertEqual(data["series"]["items"][0]["current"][0][0][3],2)
        self.assertEqual(data["periodTotals"]["current"]["rowCount"],4)
        status,envelope,headers,raw=self.post(request);self.assertEqual(status,200)
        self.assertEqual(envelope["data"]["series"],data["series"])
        capture("registered-optin-series",request,raw,headers)

    def test_actual_signed_rpc_four_objects_two_full_366_windows_fit_complete_budget(self):
        outlets=[{"platform":"京东","rawShopName":shop,"rawChannel":"渠道A"} for shop in ("京东一店","B","C","D")]
        SalesOrderLine.objects.bulk_create([make_line(71+i,f"http-full-year-{i}",shop_name=row["rawShopName"],ship_time="2024-02-29 10:00:00") for i,row in enumerate(outlets)])
        request={"operation":"netshop_periods_v1","current":{"startDate":"2024-02-28","endExclusive":"2025-02-28"},"baseline":{"startDate":"2020-02-28","endExclusive":"2021-02-28"},"seriesGrain":"day","seriesOutlets":outlets}
        original=open_bounded_consumer_request;calls=[]
        def opening(call,**options):calls.append(1);return original(call,**options)
        with patch("netshop.bounded_consumer_http.open_bounded_consumer_request",side_effect=opening):data,revision=read_sales_periods(self.principal,request,deadline=time.monotonic()+5)
        self.assertEqual(calls,[1]);self.assertEqual(revision,"7:3")
        self.assertEqual(sum(len(row[kind]) for row in data["series"]["items"] for kind in ("current","baseline")),2928)
        status,envelope,headers,raw=self.post(request)
        self.assertEqual(status,200);self.assertLessEqual(len(raw),2*1024*1024)
        self.assertEqual(envelope["data"],data)
        capture("registered-optin-max-series",request,raw,headers)
