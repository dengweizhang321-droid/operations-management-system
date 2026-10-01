"""Exact native-finance behavior in a disposable PostgreSQL cluster."""
import json
import os
from pathlib import Path
import subprocess
import types
from unittest.mock import patch
from uuid import uuid4

from django.db import connection, transaction
from django.db.models import F
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from access_control.models import AppUser
from finance import netshop_reads as service
from finance.analysis import finance_shop_key, get_finance_analysis
from finance.annual_progress import annual_progress
from finance.business_source_permissions import grant_actor_read
from finance.import_service import import_finance_payload
from finance.models import FinanceWriteAuthority, FinanceDataRevision, FinanceLine, FinanceTarget
from finance.tests.factories import prepared_payload
from sales.auth import Principal


class FinanceNetshopReadsTests(TestCase):
    def setUp(self):
        FinanceWriteAuthority.objects.filter(id=1).update(status="postgres")
        self.principal = Principal("finance-netshop@example.test", "Synthetic", "viewer", None)
        now = timezone.now()
        self.user = AppUser.objects.create(email=self.principal.email, display_name="Synthetic", role_id="viewer",
            status="active", scope=None, version=1, created_at=now, updated_at=now)
        import_finance_payload(prepared_payload("2026-01", "2026-03"), self.principal.email)
        self.request = {"operation": service.OPERATION, "shopKeys": [finance_shop_key("京东", "同名店")],
                        "months": ["2026-01", "2026-03"], "year": "2026"}

    def target(self, **extra):
        return FinanceTarget.objects.create(id=uuid4().hex, period_type="year", period_key="2026",
            platform=extra.pop("platform", "京东"), shop_name=extra.pop("shop_name", "同名店"),
            sales_target_cents=extra.pop("sales_target_cents", 360000), profit_target_cents=90000,
            created_at="synthetic", updated_at="synthetic", **extra)

    def export(self, name, data, request=None):
        root = os.getenv("TERUISI_FINANCE_NETSHOP_CAPACITY")
        if root:
            path = Path(root); path.mkdir(parents=True, exist_ok=True)
            with (path / name).open("x", encoding="utf-8") as output:
                json.dump({"fixture": "synthetic-private-postgresql-only", "request": request or self.request,
                    "owningRevision": data["sourceRevisions"][0]["revision"],
                    "response": {"operation": service.OPERATION, "data": data}}, output, ensure_ascii=False)

    def test_actual_native_monthly_and_annual_exact_dto_no_formula_copy(self):
        self.target()
        dto = service.read_netshop_finance(self.principal, self.request)
        native = get_finance_analysis(requested_months=self.request["months"], shop_keys=self.request["shopKeys"])
        self.assertEqual(dto["monthly"]["data"], native)
        self.assertEqual(dto["monthly"]["currentMetricStates"]["netSalesCents"]["value"], 180000)
        self.assertEqual(dto["monthly"]["currentMetricStates"]["profitCents"]["value"], 45000)
        self.assertEqual(dto["monthly"]["currentMetricStates"]["grossMarginBps"]["reasonCode"], "unverified_source")
        item = dto["annual"]["data"]["items"][0]
        self.assertEqual((item["platform"], item["netSalesCents"], item["salesProgress"]), ("京东", 180000, .5))
        self.assertEqual(item["missingMonths"], ["2026-02"])
        self.assertEqual(item["target"]["periodType"], "year")
        self.export("finance-response.json", dto)

    def test_missing_month_field_zero_and_zero_shop_omission_are_separate(self):
        request = {**self.request, "months": ["2026-01", "2026-02", "2026-03"]}
        dto = service.read_netshop_finance(self.principal, request)
        self.assertEqual(dto["monthly"]["actualMonths"], ["2026-01", "2026-03"])
        self.assertEqual(dto["monthly"]["currentMetricStates"]["netSalesCents"]["reasonCode"], "missing_month")
        self.export("finance-missing-month-response.json", dto, request)
        FinanceLine.objects.filter(group_name="京东", metric_key__in=["net_sales", "gross_sales"]).update(amount_cents=0)
        zero = service.read_netshop_finance(self.principal, self.request)
        self.assertEqual(zero["monthly"]["data"]["shops"], [])
        self.assertEqual(zero["monthly"]["currentMetricStates"]["netSalesCents"],
                         {"value": 0, "unit": "CNY_CENT", "status": "available", "reasonCode": None})
        self.assertIsNone(zero["annual"]["data"]["items"][0]["salesProgress"])
        FinanceLine.objects.filter(group_name="京东", metric_key="net_cost").update(amount_cents=None)
        missing = service.read_netshop_finance(self.principal, self.request)
        self.assertIsNone(missing["monthly"]["currentMetricStates"]["netCostCents"]["value"])
        self.assertEqual(missing["monthly"]["currentMetricStates"]["netCostCents"]["reasonCode"], "missing_field")
        self.export("finance-zero-missing-field-response.json", missing)

    def test_cross_platform_same_name_and_absent_native_identity_do_not_fallback(self):
        request = {**self.request, "shopKeys": [finance_shop_key("京东", "同名店"), finance_shop_key("天猫", "同名店")]}
        dto = service.read_netshop_finance(self.principal, request)
        self.assertEqual(dto["monthly"]["data"]["current"]["netSalesCents"], 300000)
        self.assertEqual({item["platform"] for item in dto["annual"]["data"]["items"]}, {"京东", "天猫"})
        absent = service.read_netshop_finance(self.principal, {**self.request, "shopKeys": [finance_shop_key("京东", "不存在")]})
        self.assertIsNone(absent["monthly"]["data"])
        self.assertEqual(absent["annual"]["data"]["items"], [])
        self.assertTrue(all(row["value"] is None for row in absent["monthly"]["currentMetricStates"].values()))

    def test_real_zero_whole_year_target_is_not_missing_target_or_zero_progress(self):
        self.target(sales_target_cents=0)
        dto = service.read_netshop_finance(self.principal, self.request)
        item = dto["annual"]["data"]["items"][0]
        self.assertIsNotNone(item["target"])
        self.assertEqual(item["target"]["salesTargetCents"], 0)
        self.assertEqual(item["netSalesCents"], 180000)
        self.assertIsNone(item["salesProgress"])
        self.export("finance-zero-target-response.json", dto)

    def test_annual_none_preserves_original_and_empty_never_reads_global(self):
        source = subprocess.check_output(["git", "show", "73f23edbfb0b4d348e408175607a86e9fc4d7d58:backend/finance/annual_progress.py"])
        original = types.ModuleType("finance._annual_native_baseline"); original.__package__ = "finance"
        exec(compile(source, "immutable-annual-baseline73", "exec"), original.__dict__)
        self.target()
        self.assertEqual(json.dumps(annual_progress("2026", 1, 100), ensure_ascii=False),
                         json.dumps(original.annual_progress("2026", 1, 100), ensure_ascii=False))
        self.assertEqual(annual_progress("2026", 1, 100, shop_pairs=[])["items"], [])

    def test_annual_scope_before_5001_scan_and_global_first_page(self):
        FinanceTarget.objects.bulk_create([
            FinanceTarget(id=f"unrelated-{i}", period_type="year", period_key="2026", platform="京东",
                shop_name=f"AAA-{i:05d}", sales_target_cents=1, created_at="synthetic", updated_at="synthetic")
            for i in range(5002)
        ])
        self.target(shop_name="ZZZ-末页")
        with self.assertRaisesMessage(Exception, "年度店铺数量"):
            annual_progress("2026", 1, 50)
        scoped = annual_progress("2026", 1, 1, shop_pairs=[("京东", "ZZZ-末页")])
        self.assertEqual(scoped["pagination"]["total"], 1)
        self.assertEqual(scoped["items"][0]["shopName"], "ZZZ-末页")
        self.assertIsNone(scoped["items"][0]["netSalesCents"])

    def test_annual_direct_exact_same_name_platform_and_unmapped_alias(self):
        jd = annual_progress("2026", 1, 50, shop_pairs=[("京东", "同名店")])
        tm = annual_progress("2026", 1, 50, shop_pairs=[("天猫", "同名店")])
        self.assertEqual([(row["platform"], row["netSalesCents"]) for row in jd["items"]], [("京东", 180000)])
        self.assertEqual([(row["platform"], row["netSalesCents"]) for row in tm["items"]], [("天猫", 120000)])
        self.assertIsNone(jd["items"][0]["target"])
        self.assertIsNone(jd["items"][0]["salesProgress"])
        FinanceLine.objects.filter(group_name="京东").update(group_name="")
        unknown = annual_progress("2026", 1, 50, shop_pairs=[("未分组", "同名店")])
        self.assertEqual([(row["platform"], row["netSalesCents"]) for row in unknown["items"]], [("未分组", 180000)])

    def test_four_original_roles_scope_none_and_live_actor_no_cache(self):
        for role in ("viewer", "analyst", "operator", "admin"):
            AppUser.objects.filter(email=self.user.email).update(role_id=role)
            principal = Principal(self.user.email, "Synthetic", role, None)
            dto = service.read_netshop_finance(principal, self.request)
            self.assertEqual(dto["monthly"]["currentMetricStates"]["netSalesCents"]["value"], 180000)
        AppUser.objects.filter(email=self.user.email).update(scope={"warehouses": [], "channels": [], "platforms": ["京东"]})
        with self.assertRaisesMessage(Exception, "权限"):
            service.read_netshop_finance(Principal(self.user.email, "Synthetic", "admin", None), self.request)
        with self.assertRaisesMessage(Exception, "未受限"):
            service.read_netshop_finance(Principal(self.user.email, "Synthetic", "admin",
                {"warehouses": [], "channels": [], "platforms": ["京东"]}), self.request)
        AppUser.objects.filter(email=self.user.email).update(scope=None, role_id="viewer", version=2)
        second = service.read_netshop_finance(self.principal, self.request)
        AppUser.objects.filter(email=self.user.email).update(status="inactive")
        with self.assertRaisesMessage(Exception, "不可用"):
            service.read_netshop_finance(self.principal, self.request)
        self.assertNotEqual(second["scopeKey"], dto["scopeKey"])

    def test_typed_revision_actor_changes_and_expected_token_fail_closed(self):
        first = service.read_netshop_finance(self.principal, self.request)
        with self.assertRaises(Exception) as stale:
            service.read_netshop_finance(self.principal, {**self.request, "expectedRevision": "999:aaaaaaaaaaaa"})
        self.assertEqual(stale.exception.status, 409)
        def changing(year, page, size, *, shop_pairs):
            data = annual_progress(year, page, size, shop_pairs=shop_pairs)
            # Use the existing protected writer, not a forbidden revision-row
            # rewrite that correctly fails its own guard before the read fence.
            import_finance_payload(prepared_payload("2026-04"), self.principal.email)
            return data
        with self.assertRaises(Exception) as changed:
            service.read_netshop_finance(self.principal, self.request, annual_provider=changing)
        self.assertEqual(changed.exception.status, 409)
        def revoked(year, page, size, *, shop_pairs):
            data = annual_progress(year, page, size, shop_pairs=shop_pairs)
            AppUser.objects.filter(email=self.user.email).update(version=99)
            return data
        with self.assertRaises(Exception) as denied:
            service.read_netshop_finance(self.principal, self.request, annual_provider=revoked)
        self.assertEqual(denied.exception.status, 403)
        self.assertEqual(first["sourceRevisions"][0]["kind"], "owning_revision")

    def test_parent_deadline_signed_expiry_and_transport_capacity(self):
        with self.assertRaises(Exception) as expired:
            service.read_netshop_finance(self.principal, {**self.request, "expiresAtEpochMs": 0})
        self.assertEqual(expired.exception.code, "source_not_ready")
        clock = [100.0]; reads = []
        def advance(execute, sql, params, many, context):
            value = execute(sql, params, many, context)
            if str(sql).lstrip().upper().startswith("SELECT"):
                reads.append(sql); clock[0] = 102.0
            return value
        with patch("finance.netshop_reads.time.monotonic", side_effect=lambda: clock[0]), connection.execute_wrapper(advance), self.assertRaises(Exception) as late:
            service.read_netshop_finance(self.principal, self.request, deadline=101.0)
        self.assertEqual(late.exception.code, "source_not_ready")
        self.assertEqual(len(reads), 1)
        def oversized(year, page, size, *, shop_pairs):
            data = annual_progress(year, page, size, shop_pairs=shop_pairs)
            data["syntheticOversize"] = "x" * (2 * 1024 * 1024)
            return data
        with self.assertRaises(Exception) as large:
            service.read_netshop_finance(self.principal, self.request, annual_provider=oversized)
        self.assertEqual((large.exception.status, large.exception.code), (422, "quality_incomplete"))

    def test_actual_existing_readonly_grants_five_columns_and_revocation(self):
        role = "fin_netshop_" + uuid4().hex[:12]
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE ROLE "{role}" NOLOGIN')
            cursor.execute(f'GRANT USAGE ON SCHEMA public TO "{role}"')
            # Mirror only the already existing runtime declaration, in this
            # disposable cluster; never add a production privilege.
            cursor.execute(f'GRANT SELECT ON finance_import_batches,finance_months,finance_lines,finance_targets_scoped,finance_data_revisions TO "{role}"')
            grant_actor_read(cursor, role)
            cursor.execute(f'SET LOCAL ROLE "{role}"')
        try:
            with CaptureQueriesContext(connection) as captured:
                dto = service.read_netshop_finance(self.principal, self.request)
            self.assertEqual(dto["monthly"]["currentMetricStates"]["netSalesCents"]["value"], 180000)
            actors = [q["sql"] for q in captured if "access_control_users" in q["sql"]]
            self.assertTrue(actors)
            self.assertTrue(all("display_name" not in q and "updated_at" not in q for q in actors))
        finally:
            with connection.cursor() as cursor: cursor.execute("RESET ROLE")
        with connection.cursor() as cursor:
            cursor.execute(f'REVOKE SELECT(version) ON access_control_users FROM "{role}"')
            cursor.execute(f'SET LOCAL ROLE "{role}"')
        try:
            with self.assertRaises(Exception) as denied:
                service.read_netshop_finance(self.principal, self.request)
            self.assertEqual(denied.exception.status, 503)
            self.assertFalse(connection.needs_rollback)
        finally:
            with connection.cursor() as cursor: cursor.execute("RESET ROLE")

    def test_request_and_provider_pending_do_not_claim_supported_annual(self):
        for change in ({"shopKeys": []}, {"months": []}, {"year": 2026}, {"expiresAtEpochMs": True},
                       {"sql": "SELECT"}, {"sourceUrl": "https://invalid"}, {"months": ["2026-13"]},
                       {"shopKeys": ['["京东", "同名店"]']}):
            with self.assertRaises(Exception):
                service.validate_netshop_read({**self.request, **change})
        def old_provider(year, page, size):
            raise AssertionError("Must not traverse/filter a legacy first page")
        dto = service.read_netshop_finance(self.principal, self.request, annual_provider=old_provider)
        self.assertEqual(dto["annual"]["state"], "dependency_pending")
        self.assertIsNone(dto["annual"]["data"])
