"""All-six-source native S composition on one private signed HTTP/PG fixture."""
from __future__ import annotations

from datetime import datetime
from contextlib import contextmanager
import hashlib
import json
import time
import threading
import uuid
import urllib.error
import urllib.request
from unittest.mock import patch
from urllib.parse import urlencode

from django.db import connection, connections, transaction
from django.db.models import F
from django.http import QueryDict
from django.test import override_settings
from django.urls import path

from access_control.models import AppUser
from finance import views as finance_views
from finance.errors import FinanceApiError
from netshop import panorama_finance_client as finance_bridge
from netshop import finance_netshop_client as native_finance
from netshop import store_panorama as panorama
from netshop.errors import NetshopApiError
from netshop.models import (NetshopDataRevision, NetshopImportBatch, NetshopRow,
    NetshopPromotionAggregateState, NetshopPromotionProductDaily, NetshopPromotionShopDaily)
from netshop.panorama_sales_client import resolve_panorama_sales
from netshop.views import _json
from sales.auth import Principal, verify_principal
from sales.models import ErpProductMaster, SalesDataRevision, SalesImportBatch, SalesOrderLine
from sales.tests.factories import make_line, signed_headers
from workflow.models import WorkflowDataRevision, WorkflowOperationRecord

from .promotion_insights_fixtures import add_day
from .test_store_panorama_finance import (CANONICAL, PanoramaRegisteredFixture, capture,
    capture_finance_wire, urlpatterns as native_urls)

S_PATH = "/api/netshop/store-panorama"


def private_panorama_view(request):
    """Private URL binding of the unchanged S service; public registration is I's."""
    result = panorama.read_store_panorama(verify_principal(request), request.GET)
    revision = next(ref["revision"] for ref in result["context"]["sourceRevisions"]
                    if ref["domain"] == "netshop" and ref["kind"] == "owning_revision")
    return _json(result, revision=revision)


urlpatterns = [path(S_PATH.lstrip("/"), private_panorama_view), *native_urls]


@override_settings(ROOT_URLCONF=__name__)
class RealPanoramaAllSourcesTests(PanoramaRegisteredFixture):
    def setUp(self):
        super().setUp()
        self.query = {"platform": "京东", "outlet": "京东\x1f" + CANONICAL,
                      "startDate": "2026-09-01", "endDate": "2026-09-01", "dimension": "spu"}
        self.context["periods"] = panorama._validate(QueryDict(urlencode(self.query)))[0]["periods"]
        self.counter = int(hashlib.sha256(self.id().encode()).hexdigest()[:8], 16)
        # The original source guard requires revision publication in the SAME
        # transaction as fixture fact writes. It remains enabled throughout.
        with transaction.atomic():
            for model in (NetshopPromotionAggregateState, NetshopPromotionProductDaily,
                          NetshopPromotionShopDaily, NetshopRow, NetshopImportBatch):
                model.objects.filter(shop_name=CANONICAL).delete()
            for day, amount in (("2026-09-01", 3000), ("2026-08-31", 2000), ("2025-09-01", 1000)):
                batch, rows = add_day(self, shop=CANONICAL, day=day, promotion=False,
                    rows=[{"id": "SKU-S1", "spu": "SPU-P1", "title": "合成全景商品", "values": {"transactionAmountCents": amount,
                           "transactionQuantity": 2, "visitors": 100, "transactionCustomers": 10},
                           "typed": {"transaction_quantity": 2, "visitors": 100, "transaction_customers": 10}}])
                batch.dataset = "spu_daily"
                batch.save(update_fields=["dataset"])
                rows[0].dataset = "spu_daily"
                rows[0].save(update_fields=["dataset"])
                add_day(self, shop=CANONICAL, day=day, promotion=False)
                add_day(self, shop=CANONICAL, day=day)
            NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1,
                source_digest=hashlib.sha256((self.id() + "facts").encode()).hexdigest())
        self.identity = resolve_panorama_sales(self.context)
        # Native sales factory uses batch-1 and P1; no production importer/API.
        SalesDataRevision.objects.update_or_create(domain="sales", defaults={"revision": 7, "source_digest": "sales"})
        SalesDataRevision.objects.update_or_create(domain="erp", defaults={"revision": 3, "source_digest": "erp"})
        SalesImportBatch.objects.get_or_create(id="batch-1", defaults={"source": "test", "file_name": "synthetic-sales.xlsx",
            "file_size_bytes": 100, "file_hash": "a" * 64, "sheet_name": "合成", "status": "completed",
            "row_count": 0, "inserted_count": 0, "duplicate_count": 0, "warning_count": 0,
            "warnings_json": "[]", "totals_json": "{}", "created_at": "2026-09-01 10:00:00", "completed_at": "2026-09-01 10:00:00"})
        ErpProductMaster.objects.get_or_create(product_code="P1", defaults={"product_name": "合成商品", "brand": "", "specification": "",
            "barcode": "", "category": "合成类目", "supplier": "", "product_status": "", "source_row_number": 1,
            "last_import_batch_id": "synthetic-erp", "created_at": "2026-09-01 10:00:00", "updated_at": "2026-09-01 10:00:00"})
        SalesOrderLine.objects.filter(shop_name=self.identity["rawShopName"]).delete()
        for index, (day, amount, channel) in enumerate((("2026-09-01", 1400, self.identity["rawChannel"]),
            ("2026-08-31", 800, self.identity["rawChannel"]), ("2025-09-01", 600, self.identity["rawChannel"]),
            ("2026-09-01", 999999, "另一合成渠道")), 1):
            identifier = self.counter + index
            make_line(identifier, "all-six-" + str(identifier), platform="京东", shop_name=self.identity["rawShopName"], channel=channel,
                      ship_time=day + " 10:00:00", quantity=2, allocated_amount_cents=amount, cost_amount_cents=0, gross_profit_cents=7).save()
        WorkflowDataRevision.objects.update_or_create(domain="workflow", defaults={"revision": 1, "source_digest": "b" * 64})
        WorkflowOperationRecord.objects.filter(shop_name=CANONICAL).delete()
        self.event = WorkflowOperationRecord.objects.create(id=uuid.uuid4().hex, record_type="inspection", title="合成经营核对记录", status="open",
            platform="京东", shop_name=CANONICAL, channel=self.identity["rawChannel"], occurred_at=datetime.fromisoformat("2026-09-01T08:00:00+00:00"),
            created_by=self.email, updated_by=self.email)
        self.target()

    def read(self):
        return panorama.read_store_panorama(self.principal, QueryDict(urlencode(self.query)))

    def get_http(self, endpoint, query, name, *, evidence_metadata=None):
        url = self.live_server_url + endpoint + "?" + urlencode(query)
        headers = signed_headers(url, role=self.principal.role, email=self.email, scope=self.principal.scope)
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=65) as response:
            raw, status, response_headers = response.read(2 * 1024 * 1024 + 1), response.status, dict(response.headers)
        body = json.loads(raw)
        self.assertEqual(status, 200, body)
        if not hasattr(self, "http_headers"):
            self.http_headers = {}
        self.http_headers[name] = response_headers
        capture(name, body, raw=raw, request={"method": "GET", "endpoint": endpoint, "query": query},
            metadata={"responseStatus": status, "responseHeaders": response_headers, "privateHttpPort": self.server_thread.port,
                      "freshSeedSha256": self.seed_hash, "requestPrincipalRole": self.principal.role, "requestPrincipalScope": self.principal.scope,
                      "nativeDomainReaders": [self.live_server_url + p for p in ("/api/sales/consumers/query", "/api/finance/consumers/query", "/api/workflow/operations-records")],
                      "privateSRouteBinding": endpoint == S_PATH, **(evidence_metadata or {})})
        return body

    def test_all_six_original_sources_and_independent_native_topics_details(self):
        with capture_finance_wire("response-owning-all-six-finance-rpc") as wire:
            result = self.get_http(S_PATH, self.query, "response-owning-all-six")
        self.assertEqual(wire[0], 6)
        self.assertEqual({name: source["state"] for name, source in result["sources"].items()},
            {name: "ready" for name in ("products", "productSeries", "promotion", "sales", "finance", "workflow")})
        self.assertEqual(result["sources"]["sales"]["data"]["periods"]["current"]["metrics"]["netSales"]["value"], 1400)
        self.assertEqual(result["sources"]["products"]["data"]["sections"]["summary"]["payment"]["value"], 3000)
        self.assertEqual(result["sources"]["workflow"]["data"]["items"][0]["id"], self.event.id)
        self.assertEqual({ref["domain"] for ref in result["joinedSourceRevisions"]}, {"netshop", "sales", "finance", "workflow"})
        self.assertEqual(result["sources"]["promotion"]["data"]["context"]["effectiveScope"]["dimension"], "sku")
        self.assertEqual(result["sources"]["finance"]["data"]["schemaVersion"], "netshop-panorama-finance-v2")
        p = self.get_http("/api/netshop/product-insights", self.query, "response-owning-direct-products")
        self.assertEqual(p["sections"]["summary"], result["sources"]["products"]["data"]["sections"]["summary"])
        identity = json.dumps(["京东", CANONICAL, "spu", "SPU-P1"], ensure_ascii=False, separators=(",", ":"))
        self.get_http("/api/netshop/product-insights/detail", {**self.query, "productIdentity": identity}, "response-owning-direct-product-detail")
        aquery = {**self.query, "dimension": "sku", "objectKind": "product", "trendGrain": "day"}
        a = self.get_http("/api/netshop/promotion-insights", aquery, "response-owning-direct-promotion")
        item = next(item for item in a["sections"]["items"] if item["drillable"] and item["id"] is not None)
        self.get_http("/api/netshop/promotion-insights/detail", {**aquery, "objectId": item["rowKey"], "shopKey": item["shopKey"],
                      "sectionToken": a["sectionToken"]}, "response-owning-direct-promotion-detail")
        owning_revision = next(ref["revision"] for ref in result["context"]["sourceRevisions"]
                               if ref["domain"] == "netshop" and ref["kind"] == "owning_revision")
        for name in ("response-owning-all-six", "response-owning-direct-products", "response-owning-direct-product-detail",
                     "response-owning-direct-promotion", "response-owning-direct-promotion-detail"):
            self.assertEqual(self.http_headers[name]["X-Netshop-Data-Revision"], owning_revision)

    def test_scoped_finance_is_explicit_not_applicable_and_rpc_never_runs(self):
        scope = {"platforms": ["京东"], "channels": [], "warehouses": []}
        AppUser.objects.filter(pk=self.email).update(scope=scope)
        self.principal = Principal(self.email, "Synthetic", "viewer", scope)
        with patch.object(finance_bridge, "read_finance_netshop") as rpc:
            result = self.read()
        rpc.assert_not_called()
        self.assertEqual(result["sources"]["finance"]["state"], "unavailable")
        self.assertEqual(result["sources"]["finance"]["reasonCode"], "not_applicable")
        self.assertEqual(result["sources"]["products"]["state"], "ready")

    def test_missing_finance_configuration_is_error_503_preserving_real_p_and_a(self):
        with patch.dict("os.environ", {"TERUISI_DJANGO_FINANCE_READER_BASE_URL": ""}):
            result = self.read()
        self.assertEqual(result["sources"]["finance"]["state"], "error")
        self.assertEqual(result["sources"]["finance"]["code"], "service_unavailable")
        self.assertTrue(all(result["sources"][name]["state"] == "ready" for name in ("products", "promotion", "productSeries")))
        self.assertEqual(result["sections"]["targets"]["state"], "partial")
        self.assertEqual(result["sections"]["dataQuality"]["state"], "partial")

    def test_multiple_missing_domain_configs_keep_real_independent_product_sections(self):
        with patch.dict("os.environ", {"TERUISI_DJANGO_FINANCE_READER_BASE_URL": "", "TERUISI_DJANGO_WORKFLOW_READER_BASE_URL": "",
                                     "TERUISI_DJANGO_SALES_READER_BASE_URL": ""}):
            result = self.read()
        self.assertTrue(all(result["sources"][name]["state"] == "error" for name in ("sales", "finance", "workflow")))
        self.assertTrue(all(result["sources"][name]["state"] == "ready" for name in ("products", "promotion", "productSeries")))
        self.assertEqual(result["sections"]["targets"]["state"], "error")

    def test_finance_deadline_is_shared_by_every_initial_and_final_native_rpc(self):
        actual, deadlines = finance_bridge.read_finance_netshop, []
        def observe(*args, **kwargs):
            result = actual(*args, **kwargs)
            deadlines.append(kwargs["deadline"])
            return result
        with patch.object(finance_bridge, "read_finance_netshop", side_effect=observe):
            result = self.read()
        self.assertEqual(result["sources"]["finance"]["state"], "ready")
        self.assertEqual(len(deadlines), 6)
        self.assertEqual(len(set(deadlines)), 1)

    def test_full_response_over_two_mib_is_rejected_without_source_truncation(self):
        actual = panorama.read_panorama_finance
        def transport_capacity_fault(*args, **kwargs):
            data = actual(*args, **kwargs)
            # Explicit response-size failure injection after a real native read,
            # never a synthetic business amount or a success capture.
            data["limitations"].append("容量故障注入" * (2 * 1024 * 1024 // 6))
            return data
        with patch.object(panorama, "read_panorama_finance", side_effect=transport_capacity_fault), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual((raised.exception.status, raised.exception.code), (422, "quality_incomplete"))

    def private_writer(self, action):
        """A separate ordinary writer connection outside the S read-only frame."""
        errors = []
        def run():
            try:
                action()
            except Exception as error:
                errors.append(error)
            finally:
                connections.close_all()
        worker = threading.Thread(target=run)
        worker.start()
        worker.join(5)
        self.assertFalse(worker.is_alive(), "Owned private synthetic writer did not stop")
        if errors:
            raise errors[0]

    def test_registered_finance_403_clears_entire_s_response(self):
        actual, calls = finance_bridge.read_finance_netshop, []
        def revoke(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls.append(1)
            if len(calls) == 1:
                self.private_writer(lambda: AppUser.objects.filter(pk=self.email).update(status="inactive"))
            return result
        with patch.object(finance_bridge, "read_finance_netshop", side_effect=revoke), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual((raised.exception.status, raised.exception.code), (403, "access_denied"))
        self.assertEqual(len(calls), 1)

    def test_registered_native_finance_unsigned_401_is_global_rejection(self):
        actual = native_finance.open_bounded_consumer_request
        @contextmanager
        def unsigned(request, *, deadline):
            # Authentication-only fault against the genuine registered route.
            request.remove_header("X-teruisi-signature")
            with actual(request, deadline=deadline) as response:
                yield response
        with patch.object(native_finance, "open_bounded_consumer_request", side_effect=unsigned), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual(raised.exception.status, 401)

    def test_registered_finance_409_clears_entire_s_response(self):
        actual, calls = finance_bridge.read_finance_netshop, []
        def advance(*args, **kwargs):
            result = actual(*args, **kwargs)
            calls.append(1)
            if len(calls) == 1:
                self.private_writer(lambda: self.target("2025"))
            return result
        with patch.object(finance_bridge, "read_finance_netshop", side_effect=advance), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual((raised.exception.status, raised.exception.code), (409, "insights_revision_changed"))
        self.assertEqual(len(calls), 1)

    def test_real_finance_revision_change_at_final_verification_prevents_s_return(self):
        actual = panorama.verify_panorama_finance
        def advance(*args, **kwargs):
            self.private_writer(lambda: self.target("2025"))
            return actual(*args, **kwargs)
        with patch.object(panorama, "verify_panorama_finance", side_effect=advance), self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual((raised.exception.status, raised.exception.code), (409, "insights_revision_changed"))

    def final_finance_fault(self, status, calls):
        """Runtime failure of a real final POST, after all initial SQL reads."""
        actual = finance_views.execute_consumer_query
        def execute(principal, request):
            phase = "final" if "snapshotToken" in request else "initial"
            calls.append({"phase": phase, "months": request["months"], "year": request["year"],
                          "expectedRevision": request.get("expectedRevision"), "snapshotTokenPresent": "snapshotToken" in request})
            if phase == "final":
                raise FinanceApiError("synthetic final consumer runtime fault", status=status,
                                      code="service_unavailable" if status == 503 else "access_denied" if status in {401, 403} else "insights_revision_changed")
            return actual(principal, request)
        return patch.object(finance_views, "execute_consumer_query", side_effect=execute)

    def assert_source_facts_equal(self, actual, prior):
        # Owning readers issue a fresh correlation requestId per read. Compare
        # every other field recursively without changing either response/copy.
        def facts(value):
            if isinstance(value, dict):
                return {key: facts(item) for key, item in value.items() if key != "requestId"}
            if isinstance(value, list):
                return [facts(item) for item in value]
            return value
        self.assertEqual(facts(actual), facts(prior))

    def test_real_finance_final_http_503_downgrades_only_finance_and_rebuilds_s(self):
        healthy = self.read()
        calls = []
        with self.final_finance_fault(503, calls):
            result = self.get_http(S_PATH, self.query, "response-final-finance-503", evidence_metadata={
                "faultInjection": True, "faultPhase": "final-owning-snapshot-post", "injectedHttpStatus": 503, "nativeRequests": calls})
        self.assertEqual([call["phase"] for call in calls], ["initial"] * 3 + ["final"])
        self.assertEqual(result["sources"]["finance"], {"state": "error", "data": None, "code": "service_unavailable",
                         "message": "所属只读来源暂时不可用；其他已核验章节仍可查看"})
        for key in ("products", "productSeries", "promotion", "sales", "workflow"):
            self.assertEqual(result["sources"][key]["state"], "ready")
            self.assert_source_facts_equal(result["sources"][key]["data"], healthy["sources"][key]["data"])
        self.assertFalse(any(ref["domain"] == "finance" for ref in result["joinedSourceRevisions"]))
        self.assertEqual({ref["domain"] for ref in result["joinedSourceRevisions"]}, {"netshop", "sales", "workflow"})
        self.assertNotEqual(result["sectionToken"], healthy["sectionToken"])
        self.assertEqual(set(result["sections"]), set(panorama.SECTION_KEYS))
        self.assertEqual(result["sections"]["targets"]["state"], "partial")
        self.assertEqual(result["sections"]["dataQuality"]["state"], "partial")
        self.assertEqual(result["sections"]["performance"]["state"], "ready")
        caps = {cap["id"]: cap for cap in result["sections"]["targets"]["capabilities"]}
        for key in ("annual_target", "finance_month", "history"):
            self.assertEqual(caps[key]["status"], "unavailable")
        self.assertEqual(caps["events"]["status"], "available")

    def test_real_final_workflow_sql_error_rolls_back_before_sales_and_finance_reads(self):
        healthy = self.read()
        actual_sales, sql_after, verified = panorama.verify_panorama_sales, [], []
        def fail_workflow(*_args, **_kwargs):
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1/0 /* synthetic final Workflow DB fault */")
        def verify_sales(*args, **kwargs):
            with connection.cursor() as cursor:
                cursor.execute("SELECT 42 /* actual next owner read after rollback */")
                sql_after.append(cursor.fetchone()[0])
            result = actual_sales(*args, **kwargs)
            verified.append("sales")
            return result
        with patch.object(panorama, "verify_panorama_workflow", side_effect=fail_workflow), \
                patch.object(panorama, "verify_panorama_sales", side_effect=verify_sales):
            result = self.read()
        self.assertEqual(sql_after, [42])
        self.assertEqual(verified, ["sales"])
        self.assertEqual(result["sources"]["workflow"]["state"], "error")
        self.assertIsNone(result["sources"]["workflow"]["data"])
        for key in ("products", "productSeries", "promotion", "sales", "finance"):
            self.assertEqual(result["sources"][key]["state"], "ready")
            self.assert_source_facts_equal(result["sources"][key]["data"], healthy["sources"][key]["data"])
        self.assertFalse(any(ref["domain"] == "workflow" for ref in result["joinedSourceRevisions"]))
        self.assertNotEqual(result["sectionToken"], healthy["sectionToken"])
        capture("response-final-workflow-db-error", result, request={"method": "service", "query": self.query},
                metadata={"faultInjection": True, "faultPhase": "final-workflow-verify", "actualFaultSql": "SELECT 1/0",
                          "nextOwnerSqlValue": 42, "actualNextNativeOwnerVerified": "sales"})

    def test_registered_final_finance_401_403_409_remain_global_rejections(self):
        for status in (401, 403, 409):
            calls = []
            with self.subTest(status=status), self.final_finance_fault(status, calls), self.assertRaises(NetshopApiError) as raised:
                self.read()
            self.assertEqual(raised.exception.status, status)
            self.assertEqual([call["phase"] for call in calls], ["initial"] * 3 + ["final"])

    def test_parent_deadline_expiry_during_final_verify_stops_later_owners_globally(self):
        clock, actual, completed = [100.0], panorama.verify_panorama_workflow, []
        def expire(*args, **kwargs):
            result = actual(*args, **kwargs)
            completed.append("workflow")
            clock[0] = 166.0
            return result
        with patch("netshop.store_panorama.time.monotonic", side_effect=lambda: clock[0]), \
                patch.object(panorama, "verify_panorama_workflow", side_effect=expire), \
                patch.object(panorama, "verify_panorama_sales") as sales, \
                patch.object(panorama, "verify_panorama_finance") as finance, self.assertRaises(NetshopApiError) as raised:
            self.read()
        self.assertEqual((raised.exception.status, raised.exception.code), (503, "source_not_ready"))
        self.assertEqual(completed, ["workflow"])
        sales.assert_not_called()
        finance.assert_not_called()

    def test_final_interruption_remains_global_and_prevents_later_owner_reads(self):
        with patch.object(panorama, "verify_panorama_workflow", side_effect=InterruptedError("synthetic cancellation")), \
                patch.object(panorama, "verify_panorama_sales") as sales, \
                patch.object(panorama, "verify_panorama_finance") as finance, self.assertRaises(InterruptedError):
            self.read()
        sales.assert_not_called()
        finance.assert_not_called()
