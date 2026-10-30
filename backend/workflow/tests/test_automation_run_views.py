"""HTTP-layer tests for the B3 automation-run read endpoints: auth,
parameter whitelisting, routing, and the "unavailable" (not zero/guessed
success) failure shape. Query-layer behaviour (filters, pagination,
stuck-run judgment, gate② predicate pass-through) is covered by
test_automation_run_query.py.
"""

from __future__ import annotations

import os
from datetime import date
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from sales.tests.factories import TEST_SECRET, signed_headers
from workflow.automation_run_views import (
    automation_exception_summary,
    logical_run_attempts,
    logical_run_module_results,
    logical_runs,
)


ENV = patch.dict(os.environ, {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})


class LogicalRunsViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.route = "/api/workflow/automation-runs"
        ENV.start()
        self.addCleanup(ENV.stop)

    def test_missing_principal_is_rejected_before_query(self):
        with patch("workflow.automation_run_views.list_logical_runs") as query:
            response = logical_runs(self.factory.get(self.route))
            self.assertEqual(response.status_code, 401)
            query.assert_not_called()

    def test_scoped_principal_is_rejected_unrestricted_only(self):
        request = self.factory.get(self.route, headers=signed_headers(self.route, scope={"brands": ["test"]}))
        self.assertEqual(logical_runs(request).status_code, 403)

    def test_write_method_is_rejected(self):
        self.assertEqual(logical_runs(self.factory.post(self.route)).status_code, 405)

    def test_unknown_query_parameter_is_rejected(self):
        route = self.route + "?foo=bar"
        request = self.factory.get(route, headers=signed_headers(route))
        self.assertEqual(logical_runs(request).status_code, 400)

    def test_oversized_page_size_is_rejected_not_clamped(self):
        route = self.route + "?pageSize=99999"
        request = self.factory.get(route, headers=signed_headers(route))
        self.assertEqual(logical_runs(request).status_code, 400)

    def test_valid_request_returns_200_with_no_store_and_revision_header(self):
        with patch("workflow.automation_run_views.list_logical_runs", return_value={"items": [], "pagination": {}}), \
                patch("workflow.automation_run_views.revision_value", return_value="1:abcdef123456"):
            request = self.factory.get(self.route, headers=signed_headers(self.route))
            response = logical_runs(request)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Cache-Control"], "no-store")
            self.assertEqual(response["X-Workflow-Data-Revision"], "1:abcdef123456")

    def test_three_axis_filter_params_are_forwarded_independently(self):
        captured = {}

        def fake_parse(params, *, page, page_size):
            captured.update(params)
            from workflow.automation_run_query import RunListOptions

            return RunListOptions(
                subject_key=None, chain_key=None, plan_date_from=None, plan_date_to=None,
                execution_states=(), business_states=(), delivery_states=(), exception_category=None,
                page=page, page_size=page_size,
            )

        route = self.route + "?executionState=needs_human&businessState=gap_remaining&deliveryState=failed"
        request = self.factory.get(route, headers=signed_headers(route))
        with patch("workflow.automation_run_views.parse_run_list_options", side_effect=fake_parse), \
                patch("workflow.automation_run_views.list_logical_runs", return_value={"items": [], "pagination": {}}), \
                patch("workflow.automation_run_views.revision_value", return_value="1:abcdef123456"):
            response = logical_runs(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured["executionState"], "needs_human")
        self.assertEqual(captured["businessState"], "gap_remaining")
        self.assertEqual(captured["deliveryState"], "failed")

    def test_query_layer_unavailable_error_surfaces_as_503_not_empty_success(self):
        from workflow.automation_run_query import _unavailable

        with patch("workflow.automation_run_views.list_logical_runs", side_effect=_unavailable()):
            request = self.factory.get(self.route, headers=signed_headers(self.route))
            response = logical_runs(request)
            self.assertEqual(response.status_code, 503)
            import json

            body = json.loads(response.content)
            self.assertEqual(body["code"], "automation_projection_unavailable")


class SubResourceViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.run_id = "123e4567-e89b-12d3-a456-426614174000"
        ENV.start()
        self.addCleanup(ENV.stop)

    def test_attempts_route_rejects_unknown_params_and_requires_auth(self):
        route = f"/api/workflow/automation-runs/{self.run_id}/attempts"
        self.assertEqual(logical_run_attempts(self.factory.get(route), self.run_id).status_code, 401)
        bad_route = route + "?bogus=1"
        request = self.factory.get(bad_route, headers=signed_headers(bad_route))
        self.assertEqual(logical_run_attempts(request, self.run_id).status_code, 400)

    def test_attempts_route_returns_200_for_valid_request(self):
        route = f"/api/workflow/automation-runs/{self.run_id}/attempts"
        with patch("workflow.automation_run_views.list_attempts", return_value={"items": [], "pagination": {}}), \
                patch("workflow.automation_run_views.revision_value", return_value="1:abcdef123456"):
            request = self.factory.get(route, headers=signed_headers(route))
            response = logical_run_attempts(request, self.run_id)
            self.assertEqual(response.status_code, 200)

    def test_module_results_route_returns_200_for_valid_request(self):
        route = f"/api/workflow/automation-runs/{self.run_id}/module-results"
        with patch("workflow.automation_run_views.list_module_results", return_value={"items": [], "pagination": {}}), \
                patch("workflow.automation_run_views.revision_value", return_value="1:abcdef123456"):
            request = self.factory.get(route, headers=signed_headers(route))
            response = logical_run_module_results(request, self.run_id)
            self.assertEqual(response.status_code, 200)


class ExceptionSummaryViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.route = "/api/workflow/automation-exceptions"
        ENV.start()
        self.addCleanup(ENV.stop)

    def test_requires_auth_and_rejects_unknown_params(self):
        self.assertEqual(automation_exception_summary(self.factory.get(self.route)).status_code, 401)
        bad_route = self.route + "?page=1"
        request = self.factory.get(bad_route, headers=signed_headers(bad_route))
        self.assertEqual(automation_exception_summary(request).status_code, 400)

    def test_returns_three_distinct_categories(self):
        payload = {
            "needsHuman": {"count": 0, "label": "待人工"},
            "stuck": {"count": 0, "label": "持续阻塞"},
            "resultUnknown": {"count": 0, "label": "无法核实"},
            "basis": {},
        }
        with patch("workflow.automation_run_views.exception_summary", return_value=payload), \
                patch("workflow.automation_run_views.revision_value", return_value="1:abcdef123456"):
            request = self.factory.get(self.route, headers=signed_headers(self.route))
            response = automation_exception_summary(request)
            self.assertEqual(response.status_code, 200)
            import json

            body = json.loads(response.content)
            self.assertEqual(set(body.keys()) - {"basis"}, {"needsHuman", "stuck", "resultUnknown"})
