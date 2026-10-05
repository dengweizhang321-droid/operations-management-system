from contextlib import contextmanager
from datetime import timedelta
from io import BytesIO
import json
import os
import time
from unittest.mock import patch

from django.http import QueryDict
from django.test import TestCase, override_settings
from django.utils import timezone

from bi.errors import BiApiError
from bi.source_reader import read as read_source
from bi.source_reader import _comparison
from bi.tests.test_cockpit import PRINCIPAL
from netshop.bi_flow import _combined, projection as flow_projection
from netshop.errors import NetshopApiError
from inventory.bi_projection import projection as inventory_projection
from inventory.errors import InventoryApiError
from sales.auth import Principal
from sales.tests.factories import TEST_SECRET, signed_headers
from workflow.bi_status import projection as operations_projection
from workflow.models import WorkflowTask, WorkflowTaskActivityLog, NewProductProject, NewProductStage, NewProductActivity


class OperationsProjectionTests(TestCase):
    def task(self, key, **kwargs):
        return WorkflowTask.objects.create(id=key, title=key, created_by=PRINCIPAL.email, updated_by=PRINCIPAL.email, **kwargs)

    def test_overdue_upcoming_seven_days_not_week_and_nonbusiness_update(self):
        now = timezone.now(); today = timezone.localdate()
        self.task("overdue", due_date=(today-timedelta(days=1)).isoformat(), created_at=now-timedelta(days=8), updated_at=now)
        upcoming = self.task("upcoming", due_date=(today+timedelta(days=6)).isoformat(), created_at=now-timedelta(days=8))
        WorkflowTaskActivityLog.objects.create(id="progress", task=upcoming, action="comment.created", summary="comment", actor_email=PRINCIPAL.email)
        reminder = self.task("reminder", due_date="待排期", created_at=now-timedelta(days=8))
        WorkflowTaskActivityLog.objects.create(id="remind", task=reminder, action="reminder.created", summary="reminder", actor_email=PRINCIPAL.email)
        self.task("done", status="已完成", due_date=(today-timedelta(days=1)).isoformat())
        self.task("deleted", deleted_at=now, due_date=(today-timedelta(days=1)).isoformat())
        self.task("next", due_date=(today+timedelta(days=7)).isoformat())
        data = operations_projection(PRINCIPAL)
        groups = {row["key"]: row for row in data["groups"]}
        self.assertEqual(groups["overdue-plan"]["total"], 1)
        self.assertEqual(groups["upcoming-plan"]["total"], 1)
        self.assertEqual(groups["inactive-plan"]["total"], 2)
        self.assertEqual(data["uniqueAttentionCount"], 3)

    def test_completed_paused_projects_excluded_and_no_stage_is_pending(self):
        today = timezone.localdate(); yesterday = today-timedelta(days=1)
        def project(name, **kwargs):
            return NewProductProject.objects.create(product_name=name, proposed_date=yesterday, target_launch_date=yesterday, created_by=PRINCIPAL.email, updated_by=PRINCIPAL.email, **kwargs)
        done = project("done"); NewProductStage.objects.create(project=done, stage_key="launch", status="completed")
        project("paused", lifecycle_status="paused"); project("missing-stages")
        active = project("active", created_at=timezone.now()-timedelta(days=8))
        NewProductStage.objects.create(project=active, stage_key="launch", status="in_progress")
        NewProductActivity.objects.create(project=active, action="stage.updated", actor_email=PRINCIPAL.email, actor_role="admin", to_version=1)
        data = operations_projection(PRINCIPAL); groups = {row["key"]: row for row in data["groups"]}
        self.assertEqual(groups["overdue-launch"]["total"], 2)
        self.assertEqual(groups["inactive-launch"]["total"], 0)

    def test_mine_owner_and_twenty_item_limit_are_explicit(self):
        due = (timezone.localdate()-timedelta(days=1)).isoformat()
        for index in range(23): self.task(str(index), owner=PRINCIPAL.display_name, due_date=due)
        self.task("other", owner="other", due_date=due)
        data = operations_projection(PRINCIPAL, mine=True)
        group = next(row for row in data["groups"] if row["key"] == "overdue-plan")
        self.assertEqual(group["total"], 23); self.assertEqual(group["returned"], 20); self.assertTrue(group["truncated"])


class FlowProjectionTests(TestCase):
    def test_owning_cockpit_routes_reject_restricted_principals_before_reading(self):
        principal = Principal("viewer@example.test", "Viewer", "viewer", {"platforms": ["京东"], "warehouses": [], "channels": []})
        with self.assertRaises(NetshopApiError): flow_projection(principal, QueryDict("platform=京东"))
        with patch("inventory.bi_projection._overview_items", side_effect=AssertionError("must not read")), self.assertRaises(InventoryApiError): inventory_projection(principal)
    def test_unverified_erp_shop_mapping_cannot_expand_to_all_shops(self):
        result = flow_projection(PRINCIPAL, QueryDict("parentPlatform=天猫&parentShop=A&startDate=2026-09-01&endDate=2026-09-04"))
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reasonCode"], "erp_store_mapping_unverified")
        self.assertEqual(result["shops"], [])

    def test_local_platform_cannot_escape_parent(self):
        with self.assertRaises(NetshopApiError): flow_projection(PRINCIPAL, QueryDict("platform=天猫&parentPlatform=京东"))

    def test_combined_conversion_is_weighted_and_mixed_roi_unavailable(self):
        def body(visitors, customers):
            return {"summary": {key: {"value": value, "unit": "COUNT" if key in {"visitors", "customers"} else "CNY_CENT", "status": "available"} for key, value in {"visitors": visitors, "customers": customers, "payment": 1000, "spend": 100, "promotionPayment": 400}.items()}}
        data = _combined([body(100, 10), body(900, 18)])
        self.assertAlmostEqual(data["conversion"]["value"], .028)
        self.assertIsNone(data["roas"]["value"])
        self.assertEqual(data["payment"]["value"], 2000)

    def test_partial_known_amounts_are_disclosed_without_deriving_a_ratio(self):
        body = {"summary": {key: {"value": 100, "unit": "COUNT", "status": "partial"} for key in ["visitors", "customers", "payment", "spend", "promotionPayment"]}}
        result = _combined([body])
        self.assertEqual(result["visitors"]["value"], 100)
        self.assertEqual(result["visitors"]["status"], "partial")
        self.assertIsNone(result["conversion"]["value"])

    def test_two_window_revision_changes_fail_closed(self):
        current = {"status": "ready", "revision": "1:aaaaaaaaaaaa", "data": {"status": "ready", "periods": {"previous": {"startDate": "2026-08-01", "endDate": "2026-08-31"}}}}
        previous = {**current, "revision": "2:bbbbbbbbbbbb"}
        with patch("bi.source_reader._read_once", side_effect=[current, previous]), self.assertRaises(BiApiError):
            read_source(PRINCIPAL, "flow", {"startDate": "2026-09-01", "endDate": "2026-09-30"}, deadline=time.monotonic()+65)

    def test_nonpositive_and_partial_baselines_do_not_get_growth(self):
        m = {"value": 10, "status": "available", "unit": "CNY_CENT"}
        for other in [{**m, "value": 0}, {**m, "value": -1}, {**m, "status": "partial"}]: self.assertIsNone(_comparison({"payment": m}, {"payment": other})["payment"]["value"])


class SourceTransportTests(TestCase):
    def response(self, raw, **headers):
        body = BytesIO(raw); body.status = 200; body.headers = {"Content-Type": "application/json", "X-Finance-Data-Revision": "1:abcdef123456", **headers}
        return body

    def source(self, raw, **headers):
        @contextmanager
        def opener(request, **kwargs):
            self.request = request
            yield self.response(raw, **headers)
        with patch.dict(os.environ, {"TERUISI_DJANGO_FINANCE_READER_BASE_URL": "http://127.0.0.1:45678", "TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET}), patch("bi.source_reader.open_bounded_consumer_request", opener):
            return read_source(PRINCIPAL, "targets", {"year": "2026", "month": "2026-10"}, deadline=time.monotonic()+10)

    def test_fixed_owning_origin_exact_scope_and_signed_real_actor(self):
        raw = json.dumps({"schemaVersion": "finance-erp-targets-v1", "year": "2026", "month": "2026-10", "basis": "erp_net_sales", "complete": True, "items": []}).encode()
        result = self.source(raw)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(self.request.full_url, "http://127.0.0.1:45678/api/finance/erp-targets?year=2026&month=2026-10")
        self.assertTrue(self.request.get_header("X-teruisi-signature").startswith("v1="))

    def test_duplicate_keys_wrong_scope_unsafe_money_and_body_length_fail_closed(self):
        base = {"schemaVersion": "finance-erp-targets-v1", "year": "2026", "month": "2026-10", "basis": "erp_net_sales", "complete": True, "items": []}
        for raw in [b'{"schemaVersion":"finance-erp-targets-v1","schemaVersion":"finance-erp-targets-v1"}', json.dumps({**base, "year": "2025"}).encode(), json.dumps({**base, "unsafe": 9007199254740992}).encode(), json.dumps({**base, "unsafe": float("inf")}).encode()]:
            with self.assertRaises(BiApiError): self.source(raw)
        with self.assertRaises(BiApiError): self.source(json.dumps(base).encode(), **{"Content-Length": "1"})
