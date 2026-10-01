"""S finance evidence from registered HMAC readers and protected private facts.

The fixture keeps Finance's append-only guards enabled. Only mutation/failure
timing is injected; successful DTOs always come from the native SQL reader.
"""
from __future__ import annotations

from copy import deepcopy
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from django.test.testcases import LiveServerThread
from django.urls import include, path
from django.utils import timezone

from access_control.models import AccessRole, AppUser
from finance.analysis import finance_shop_key, get_finance_analysis
from finance.import_service import import_finance_payload
from finance.models import FinanceTarget, FinanceWriteAuthority
from finance.target_service import delete_target, upsert_target
from finance.tests.factories import prepared_payload
from netshop.errors import NetshopApiError
from netshop.insights_common import periods
from netshop.models import NetshopDataRevision
from netshop import finance_netshop_client as native_client
from sales.auth import Principal
from sales.tests.factories import TEST_SECRET
from workflow.operations_views import operation_records

urlpatterns = [path("api/finance/", include("finance.urls")),
               path("api/sales/", include("sales.urls")),
               path("api/netshop/", include("netshop.urls")),
               path("api/workflow/operations-records", operation_records)]
ROOT = Path(__file__).resolve().parents[3]
CANONICAL = "志高切肉机旗舰店"


def capture(name, data, *, request=None, metadata=None, raw=None):
    """Exclusive original UTF-8 response and a separately hashed metadata file."""
    destination = os.environ.get("TERUISI_PANORAMA_QUERY_EVIDENCE_DIR")
    if not destination:
        return
    directory = Path(destination)
    raw = raw if raw is not None else json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
    with (directory / (name + ".json")).open("xb") as output:
        output.write(raw)
    paths = ["backend/netshop/store_panorama.py", "backend/netshop/panorama_finance_client.py",
             "backend/netshop/finance_netshop_client.py", "backend/netshop/finance_netshop_contract.py",
             "backend/netshop/bounded_consumer_http.py", "backend/finance/netshop_reads.py",
             "backend/finance/import_service.py", "backend/finance/target_service.py",
             "backend/netshop/tests/test_store_panorama_finance.py", "backend/netshop/tests/test_store_panorama_sources.py"]
    code_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    proof = {"request": request, "responseFile": name + ".json", "responseBytesUtf8": len(raw),
             "responseSha256": hashlib.sha256(raw).hexdigest(), "codeSha": code_sha,
             "sourceSha256": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths if (ROOT / p).is_file()},
             "syntheticPrivateOnly": True, "grantsIssued": 0, "productionActions": [], "paidCalls": 0,
             **(metadata or {})}
    with (directory / (name + ".meta.json")).open("x", encoding="utf-8") as output:
        json.dump(proof, output, ensure_ascii=False, indent=2)


@contextmanager
def capture_finance_wire(prefix):
    """Observe the real original client stream; never substitute its contents."""
    actual, counter = native_client.open_bounded_consumer_request, [0]
    @contextmanager
    def observe(request, *, deadline):
        counter[0] += 1
        number = counter[0]
        chunks = []
        with actual(request, deadline=deadline) as response:
            original = response.read1
            headers, status = dict(response.headers), response.status
            def read1(size=-1):
                value = original(size)
                chunks.append(value)
                return value
            response.read1 = read1
            yield response
        raw = b"".join(chunks)
        capture(prefix + f"-{number:02d}", json.loads(raw), raw=raw,
            request={"method": request.method, "endpoint": native_client.PATH, "payload": json.loads(request.data)},
            metadata={"responseStatus": status, "responseHeaders": headers,
                      "owningHeaderRevision": headers.get("X-Finance-Data-Revision"), "sharedDeadline": deadline})
    with patch.object(native_client, "open_bounded_consumer_request", side_effect=observe):
        yield counter


@override_settings(ROOT_URLCONF=__name__, MEDIA_URL="/__synthetic_none__/", STATIC_URL="/__synthetic_none__/")
class PanoramaRegisteredFixture(SimpleTestCase):
    # A disposable private database outlives cases; transaction-test flush
    # correctly fails Finance append-only guards and must never disable them.
    databases = {"default"}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server_thread = LiveServerThread("127.0.0.1", lambda app: app, port=0)
        cls.server_thread.daemon = True
        cls.server_thread.start()
        cls.server_thread.is_ready.wait()
        if cls.server_thread.error:
            raise cls.server_thread.error
        cls.live_server_url = "http://127.0.0.1:" + str(cls.server_thread.port)
        cls.addClassCleanup(cls.record_close)
        cls.addClassCleanup(cls.server_thread.terminate)

    @classmethod
    def record_close(cls):
        if cls.server_thread.is_alive():
            raise AssertionError("Owned native HTTP server was not stopped")
        destination = os.environ.get("TERUISI_PANORAMA_QUERY_EVIDENCE_DIR")
        if destination:
            with (Path(destination) / (cls.__name__ + "-http-close.json")).open("x", encoding="utf-8") as output:
                json.dump({"port": cls.server_thread.port, "httpThreadClosed": True,
                           "syntheticPrivateOnly": True, "grantsIssued": 0}, output)

    def setUp(self):
        super().setUp()
        FinanceWriteAuthority.objects.update_or_create(id=1, defaults={"status": "postgres"})
        for rank, role in enumerate(("viewer", "analyst", "operator", "admin"), 1):
            AccessRole.objects.get_or_create(code=role, defaults={"rank": rank, "label": role})
        now = timezone.now()
        self.email = (self.__class__.__name__ + "." + self._testMethodName + "@panorama-private.test").lower()
        self.user = AppUser.objects.create(email=self.email, role_id="viewer", display_name="Synthetic",
            status="active", scope=None, version=1, created_at=now, updated_at=now)
        self.principal = Principal(self.email, "Synthetic", "viewer", None)
        NetshopDataRevision.objects.get_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        self.context = {"effectiveScope": {"platforms": ["京东"], "shopKeys": ["京东\x1f" + CANONICAL]},
                        "periods": periods("2026-09-01", "2026-09-07", "custom")}
        # Reset synthetic target fixtures using the real audited deletion writer.
        for target in list(FinanceTarget.objects.filter(shop_name=CANONICAL)):
            delete_target(target.id, target.version, self.email, "synthetic private fixture reset")
        self.import_months("2025-09", "2026-08", "2026-09")
        self.env = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET,
            "TERUISI_DJANGO_FINANCE_READER_BASE_URL": self.live_server_url,
            "TERUISI_DJANGO_SALES_READER_BASE_URL": self.live_server_url,
            "TERUISI_DJANGO_WORKFLOW_READER_BASE_URL": self.live_server_url})
        self.env.start()
        self.addCleanup(self.env.stop)

    def import_months(self, *months, zero=False, null_cost=False):
        native = prepared_payload(*months)
        # Only identity and provided source values change; owning algorithms
        # and the exact same-name cross-platform facts remain original.
        for month in native["months"]:
            for row in month["lines"]:
                if row["scopeType"] != "shop":
                    continue
                row["scopeName"] = CANONICAL
                row["scopeKey"] = "shop:" + row["groupName"] + ":" + CANONICAL
                if row["groupName"] == "京东":
                    if zero and row["metricKey"] in {"gross_sales", "net_sales"}:
                        row["amountCents"] = 0
                    if null_cost and row["metricKey"] == "net_cost":
                        row["amountCents"] = None
        native["rawFileHash"] = hashlib.sha256((self.id() + json.dumps(native, ensure_ascii=False)).encode()).hexdigest()
        receipt = import_finance_payload(native, self.email)
        self.seed_hash = native["rawFileHash"]
        return receipt

    def target(self, year="2026", sales=360000):
        return upsert_target({"periodType": "year", "periodKey": year, "platform": "京东",
                              "shopName": CANONICAL, "salesTargetCents": sales, "profitTargetCents": 90000})

    def read_finance(self, context=None, deadline=None):
        from netshop.panorama_finance_client import read_panorama_finance
        return read_panorama_finance(self.principal, context or self.context,
                                     deadline=deadline if deadline is not None else time.monotonic() + 65)


class RealPanoramaFinanceTests(PanoramaRegisteredFixture):
    def test_registered_three_owned_current_month_windows_and_native_payloads(self):
        data = self.read_finance()
        self.assertEqual(data["schemaVersion"], "netshop-panorama-finance-v2")
        self.assertEqual(data["scope"], {"platform": "京东", "shopName": CANONICAL,
                         "startDate": "2026-09-01", "endDate": "2026-09-07"})
        self.assertEqual(data["periodReadRefs"], {"current": 0, "previous": 1, "yearAgo": 2})
        self.assertEqual(len(data["owning"]), 3)
        for kind, month, year in (("current", "2026-09", "2026"), ("previous", "2026-08", "2026"), ("yearAgo", "2025-09", "2025")):
            native = data["owning"][data["periodReadRefs"][kind]]
            request = {"shopKeys": [finance_shop_key("京东", CANONICAL)], "months": [month], "year": year}
            self.assertEqual(native["requestedScope"], request)
            self.assertEqual(native["monthly"]["data"], get_finance_analysis(requested_months=[month], shop_keys=request["shopKeys"]))
            self.assertIn("fieldEvidence", native["monthly"])
            self.assertIn("currentMetricStates", native["monthly"])
        # Native current.previous is its own comparison, never the S baseline.
        self.assertNotEqual(data["owning"][0]["requestedScope"]["months"], data["owning"][1]["requestedScope"]["months"])
        refs = {(r["domain"], r["kind"], r["scopeKey"]): r for dto in data["owning"] for r in dto["sourceRevisions"]}
        self.assertEqual(data["sourceRevisions"], [refs[k] for k in sorted(refs)])
        capture("finance-three-months", data, metadata={"freshSeedSha256": self.seed_hash})

    def test_same_month_and_year_calls_deduplicate_by_original_request(self):
        context = deepcopy(self.context)
        context["periods"]["yearAgo"] = deepcopy(context["periods"]["previous"])
        data = self.read_finance(context)
        self.assertEqual(len(data["owning"]), 2)
        self.assertEqual(data["periodReadRefs"]["previous"], data["periodReadRefs"]["yearAgo"])

    def test_leap_year_367_day_yearago_keeps_all_13_closed_months(self):
        context = deepcopy(self.context)
        context["periods"] = periods("2024-03-01", "2025-03-01", "rolling")
        self.assertEqual(context["periods"]["yearAgo"]["days"], 367)
        data = self.read_finance(context)
        native = data["owning"][data["periodReadRefs"]["yearAgo"]]
        self.assertEqual(native["requestedScope"]["months"], [f"2023-{m:02d}" for m in range(3, 13)] + ["2024-01", "2024-02", "2024-03"])
        self.assertEqual(native["requestedScope"]["year"], "2023")
        self.assertEqual(len(data["owning"]), 4)
        capture("finance-leap-367", data, metadata={"sourceYearAgoDays": 367, "sourceMonthsNotTruncated": True})

    def test_cross_year_annual_reads_keep_both_years_and_original_zero_targets(self):
        self.import_months("2025-12", "2026-01", zero=True)
        self.target("2026", sales=0)
        context = deepcopy(self.context)
        context["periods"] = periods("2025-12-20", "2026-01-10", "custom")
        data = self.read_finance(context)
        self.assertEqual([data["owning"][index]["requestedScope"]["year"] for index in data["annualReadRefs"]], ["2025", "2026"])
        self.assertEqual(len(data["owning"]), 4)
        first = data["owning"][data["annualReadRefs"][0]]["annual"]["data"]["items"][0]
        final = data["owning"][data["annualReadRefs"][1]]["annual"]["data"]["items"][0]
        self.assertIsNone(first["target"])
        self.assertEqual(final["target"]["salesTargetCents"], 0)
        self.assertIsNone(final["salesProgress"])
        self.assertEqual(data["owning"][data["periodReadRefs"]["current"]]["requestedScope"]["months"], ["2025-12", "2026-01"])
        capture("finance-cross-year-zero-target", data, metadata={"freshSeedSha256": self.seed_hash})

    def test_missing_month_missing_cost_and_observed_zero_are_distinct(self):
        self.import_months("2026-09", zero=True, null_cost=True)
        data = self.read_finance()
        current = data["owning"][data["periodReadRefs"]["current"]]["monthly"]
        self.assertEqual(current["currentMetricStates"]["netSalesCents"], {"value": 0, "unit": "CNY_CENT", "status": "available", "reasonCode": None})
        self.assertEqual(current["currentMetricStates"]["netCostCents"]["reasonCode"], "missing_field")
        context = deepcopy(self.context)
        context["periods"] = periods("2026-09-01", "2026-10-02", "custom")
        mixed = self.read_finance(context)
        monthly = mixed["owning"][mixed["periodReadRefs"]["current"]]["monthly"]
        self.assertEqual(monthly["currentMetricStates"]["netSalesCents"]["reasonCode"], "missing_month")
        self.assertIsNone(monthly["currentMetricStates"]["netSalesCents"]["value"])
        capture("finance-zero-null-missing-month", mixed, metadata={"freshSeedSha256": self.seed_hash})

    def test_same_name_other_platform_is_never_finance_joined(self):
        data = self.read_finance()
        context = deepcopy(self.context)
        context["effectiveScope"] = {"platforms": ["天猫"], "shopKeys": ["天猫\x1f" + CANONICAL]}
        other = self.read_finance(context)
        a = data["owning"][0]["monthly"]["currentMetricStates"]["netSalesCents"]["value"]
        b = other["owning"][0]["monthly"]["currentMetricStates"]["netSalesCents"]["value"]
        self.assertEqual((a, b), (180000, 120000))
        self.assertNotEqual(data["sourceRevisions"], other["sourceRevisions"])

    def test_all_four_native_roles_with_unrestricted_scope_use_registered_source(self):
        for role in ("viewer", "analyst", "operator", "admin"):
            AppUser.objects.filter(pk=self.email).update(role_id=role)
            self.principal = Principal(self.email, "Synthetic", role, None)
            data = self.read_finance()
            self.assertEqual(data["owning"][0]["monthly"]["currentMetricStates"]["netSalesCents"]["value"], 180000)

    def test_registered_revision_mutation_between_reads_and_final_check_is_409(self):
        from netshop import panorama_finance_client as bridge
        actual, calls = bridge.read_finance_netshop, []
        def mutate(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls.append(kwargs["deadline"])
            if len(calls) == 1:
                self.target("2026")
            return result
        with patch.object(bridge, "read_finance_netshop", side_effect=mutate), self.assertRaises(NetshopApiError) as raised:
            self.read_finance()
        self.assertEqual(raised.exception.status, 409)
        data = self.read_finance()
        self.target("2025")
        with self.assertRaises(NetshopApiError) as raised:
            bridge.verify_panorama_finance(self.principal, self.context, data, deadline=time.monotonic() + 65)
        self.assertEqual(raised.exception.status, 409)

    def test_registered_actor_revocation_between_reads_is_403(self):
        from netshop import panorama_finance_client as bridge
        actual, calls = bridge.read_finance_netshop, []
        def mutate(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls.append(1)
            if len(calls) == 1:
                AppUser.objects.filter(pk=self.email).update(status="inactive")
            return result
        with patch.object(bridge, "read_finance_netshop", side_effect=mutate), self.assertRaises(NetshopApiError) as raised:
            self.read_finance()
        self.assertEqual(raised.exception.status, 403)

    def test_final_readonly_checks_every_distinct_native_request_with_same_deadline(self):
        from netshop import panorama_finance_client as bridge
        actual, requests = bridge.read_finance_netshop, []
        deadline = time.monotonic() + 65
        def observe(principal, payload, **kwargs):
            result = actual(principal, payload, **kwargs)
            requests.append({"payload": deepcopy(payload), "deadline": kwargs["deadline"], "revision": result[1]})
            return result
        with patch.object(bridge, "read_finance_netshop", side_effect=observe):
            data = self.read_finance(deadline=deadline)
            before = len(requests)
            bridge.verify_panorama_finance(self.principal, self.context, data, deadline=deadline)
        self.assertEqual(before, 3)
        self.assertEqual(len(requests), 6)
        self.assertTrue(all(r["deadline"] == deadline for r in requests))
        for first, final in zip(requests[:before], requests[before:]):
            self.assertEqual(final["payload"]["expectedRevision"], first["revision"])
            self.assertEqual(final["payload"]["months"], first["payload"]["months"])
        capture("finance-final-same-deadline", data, metadata={"nativeReads": requests})

    def test_source_configuration_absent_is_service_error_without_local_fallback(self):
        with patch.dict(os.environ, {"TERUISI_DJANGO_FINANCE_READER_BASE_URL": ""}), self.assertRaises(NetshopApiError) as raised:
            self.read_finance()
        self.assertEqual(raised.exception.status, 503)

    def test_absent_exact_store_is_no_records_not_observed_zero(self):
        context = deepcopy(self.context)
        context["effectiveScope"]["shopKeys"] = ["京东\x1f未导入合成店"]
        data = self.read_finance(context)
        for native in data["owning"]:
            metric = native["monthly"]["currentMetricStates"]["netSalesCents"]
            self.assertEqual((metric["value"], metric["status"], metric["reasonCode"]), (None, "unavailable", "no_records"))

    def test_expired_shared_deadline_after_real_first_read_prevents_second_rpc(self):
        from netshop import panorama_finance_client as bridge
        clock, actual, calls = [100.0], bridge.read_finance_netshop, []
        def expire(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls.append(kwargs["deadline"])
            clock[0] = 166.0
            return result
        with patch("netshop.store_panorama.time.monotonic", side_effect=lambda: clock[0]), \
                patch.object(bridge, "read_finance_netshop", side_effect=expire), self.assertRaises(NetshopApiError) as raised:
            self.read_finance(deadline=165.0)
        self.assertEqual((raised.exception.status, raised.exception.code), (503, "source_not_ready"))
        self.assertEqual(calls, [165.0])

    def test_original_strict_native_validator_rejects_schema_identity_and_metric_shape(self):
        data = self.read_finance()
        native = data["owning"][0]
        request = {"operation": native_client.OPERATION, **native["requestedScope"]}
        revision = native["sourceRevisions"][0]["revision"]
        native_client._assert_body(native, request, revision)
        mutants = []
        schema = deepcopy(native)
        schema["schemaVersion"] = "finance-netshop-read-untrusted"
        mutants.append(schema)
        identity = deepcopy(native)
        identity["requestedScope"]["shopKeys"] = [finance_shop_key("天猫", CANONICAL)]
        mutants.append(identity)
        metric = deepcopy(native)
        metric["monthly"]["currentMetricStates"]["netSalesCents"]["status"] = ["available"]
        mutants.append(metric)
        for mutant in mutants:
            with self.subTest(mutant=mutants.index(mutant)), self.assertRaises(NetshopApiError) as raised:
                native_client._assert_body(mutant, request, revision)
            self.assertEqual(raised.exception.status, 503)
