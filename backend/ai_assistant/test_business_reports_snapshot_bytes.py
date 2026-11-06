"""Legacy v1 business-report snapshot must stay inside the ai_report_runs
CHECK (octet_length(snapshot_json)<=32768, migrations/0012_report_library.py).

business_analysis.budget.normalize() only bounds the plan contract on its own
(48000 bytes); the legacy path in business_reports.create() embeds the whole
normalized plan inline in snapshot_json, so a plan that is well within its own
limit can still blow the tighter, row-level bound. This pins the boundary.

Note on sourceKey length: real evidence source keys are validated by
policy.identifier() (`[A-Za-z0-9_-]{1,160}`), so a 160-character ASCII
sourceKey is a legal, reachable value in production, not just a test
artifact. This fixture uses a short "ads" key purely because that's what
business_evidence.create() is given below; it is not a claim that sourceKey
is bounded to something short in general. The boundary pinned here (n=68
ok / n=69 over, including previousReportId) is specific to this fixture's
field choices (short sourceKey, 80-char CJK ownerRole, single scenario) and
is not the worst realistic case -- a request with a long sourceKey, more
scenarios, or a long free-text question overflows at a much lower target
count. See REPORT.md for an independent reconstruction of that worse case.
"""
from copy import deepcopy
from unittest.mock import patch
from django.http import QueryDict
from django.test import TestCase, override_settings
from urllib.parse import urlencode
from netshop.models import NetshopRow
from netshop.analysis import read_page, validate_request
from . import business_evidence as evidence, business_reports as reports, models as m
from . import test_business_evidence
from .test_business_evidence import versioned_netshop_facts
from . import tests as fixtures
from .policy import AiError, canonical


# 80 CJK characters, the maximum text() allows for ownerRole.
OWNER_ROLE_CJK_80 = ("投放运营负责人张三李四王五赵六钱七孙八周九吴十郑十一王十二冯十三陈十四褚十五卫十六蒋十七沈十八韩十九杨二十"
    "冯二十一陈二十二褚二十三卫二十四" * 2)[:80]


def many_target_plan(n):
    """A legitimate plan, well inside budget.normalize()'s own 48000-byte cap,
    with n targets and an 80-char CJK ownerRole on every one."""
    targets = [{"sourceKey": "ads", "dimension": "sku", "rowIndex": i, "rowId": f"{i+1:064x}", "weight": 1,
        "minBudgetCents": 0, "maxBudgetCents": 10000, "ownerRole": OWNER_ROLE_CJK_80, "minimumRoasBps": 40000} for i in range(n)]
    return {"totalBudgetCents": 10000 * n, "reserveCents": 1000, "horizonDays": 15, "observationDays": 7,
        "reviewAfterSpendBps": 2000, "minimumClicks": 30, "minimumOrderLines": 3,
        "targets": targets,
        "scenarios": [{"name": "效率不变", "cpcFactorBps": 10000, "orderRateFactorBps": 10000,
            "orderValueFactorBps": 10000, "contributionMarginBps": 2000}]}


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class BusinessReportSnapshotByteTests(TestCase):
    """Builds real sealed v1 netshop-promotion evidence with many sku rows so
    business_budget.resolve() runs the actual Reader/stream_table path, not a
    mock -- the same path reports.create() uses in production."""
    user = test_business_evidence.BusinessEvidenceTests.user
    call = test_business_evidence.BusinessEvidenceTests.call

    def setUp(self):
        test_business_evidence.BusinessEvidenceTests.setUp(self)
        self.tools = [fixtures.CATALOG[0], *[{**fixtures.CATALOG[0], "name": name} for name in sorted(reports.TOOLS | {reports.BUDGET_TOOL})]]

    def seal_evidence(self, n):
        with versioned_netshop_facts():
            for i in range(n):
                NetshopRow.objects.create(source_row_key=f"snap-budget-{i}", source_row_hash=f"{i+1:064x}",
                    first_import_batch_id="fixture", last_import_batch_id="fixture", source_row_number=i + 1,
                    source="jd_promotion", dataset="ad", platform="京东", shop_name="合成店", business_date="2026-08-01",
                    sku_id=f"S{i}", spu_id="P1", spend_cents=3000, net_transaction_amount_cents=15000,
                    clicks=300, impressions=3000, net_orders=30,
                    metrics_json={"spendCents": 3000, "netTransactionAmountCents": 15000, "clicks": 300, "impressions": 3000, "netOrders": 30}, raw_json={})
        query = {"platform": "京东", "shop": "合成店", "dataset": "promotion", "startDate": "2026-08-01", "endDate": "2026-08-01"}
        body = {"clientRequestId": f"snap-budget-evidence-{n}", "sources": [{"key": "ads", "domain": "netshop", "query": query}]}
        evidence_id = evidence.create(body, self.admin)["item"]["id"]
        def source(name, args, principal, **kwargs):
            data = {"dataCutoffDate": "2026-08-01"} if name == "get_data_freshness" else read_page(*validate_request(QueryDict(urlencode(args))))
            return {"ok": True, "auditStatus": "recorded", "toolName": name, "data": data}
        version = 1
        with patch("ai_assistant.transport.catalog", return_value=self.catalog), patch("ai_assistant.transport.execute_tool", side_effect=source):
            while True:
                result = evidence.collect(evidence_id, {"sourceKey": "ads", "expectedVersion": version}, self.admin, "snap-budget-source")
                version += 1
                if result["item"]["sources"]["ads"]["complete"]:
                    break
        evidence.finish(evidence_id, {"expectedVersion": version, "action": "seal"}, self.admin)
        rows = evidence.analysis_table(evidence_id, {"sourceKey": "ads", "dimension": "sku", "limit": str(n)}, self.admin)["rows"]
        return evidence_id, rows

    def plan_for(self, n, evidence_id, rows):
        plan = many_target_plan(n)
        for target, row in zip(plan["targets"], rows):
            target.update(rowId=row["id"], rowIndex=row["rowIndex"])
        return plan

    def request_for(self, client_id, evidence_id, plan, *, previous_report_id=None):
        request = {"clientRequestId": client_id, "evidenceRunId": evidence_id, "question": "分析预算并说明假设", "dryRun": True, "budgetPlan": plan}
        if previous_report_id is not None:
            request["previousReportId"] = previous_report_id
        return request

    def make_previous_report(self, evidence_id, rows):
        """A minimal prior budget report on the SAME evidence_id (required by
        business_reports.create()'s previousReportId check at :171-172, which
        rejects a previous report whose snapshot evidenceRunId differs from
        the current request's), to attach via previousReportId -- that field
        adds ~68 bytes to the snapshot and must be included when pinning the
        boundary, or the pinned "ok" case is not actually safe for a real
        revision request."""
        plan = many_target_plan(1)
        plan["targets"][0].update(rowId=rows[0]["id"], rowIndex=rows[0]["rowIndex"])
        with patch("ai_assistant.transport.catalog", return_value=self.tools):
            item = reports.create(self.request_for("snap-budget-previous", evidence_id, plan), self.admin)["item"]
        return item["id"]

    def test_just_under_boundary_target_count_still_creates_report(self):
        # Binary-searched locally against this exact envelope construction
        # (many_target_plan with OWNER_ROLE_CJK_80) INCLUDING previousReportId
        # (~68 bytes): n=68 -> 32318 bytes (ok), n=69 -> 32776 bytes (over).
        # previousReportId must be part of this construction: without it,
        # n=69 looks safe (32708) but a real revision request carrying that
        # field at n=69 is actually 8 bytes over the CHECK.
        n = 68
        evidence_id, rows = self.seal_evidence(n)
        previous_id = self.make_previous_report(evidence_id, rows)
        plan = self.plan_for(n, evidence_id, rows)
        request = self.request_for("snap-budget-under", evidence_id, plan, previous_report_id=previous_id)
        with patch("ai_assistant.transport.catalog", return_value=self.tools):
            item = reports.create(request, self.admin)["item"]
        row = m.AiReportRun.objects.get(pk=item["id"])
        size = len(row.snapshot_json.encode())
        # Literal, not reports.SNAPSHOT_MAX_BYTES: this must stay pinned to
        # the migrations/0012_report_library.py CHECK value itself, so the
        # test still catches the constant drifting away from that CHECK in
        # either direction, not just being lowered.
        self.assertLessEqual(size, 32768, f"snapshot was {size} bytes")
        self.assertIn("budgetPlan", row.snapshot_json)

    def test_over_boundary_target_count_is_rejected_before_workflow_creation(self):
        n = 69
        evidence_id, rows = self.seal_evidence(n)
        previous_id = self.make_previous_report(evidence_id, rows)
        plan = self.plan_for(n, evidence_id, rows)
        request = self.request_for("snap-budget-over", evidence_id, plan, previous_report_id=previous_id)
        # The plan itself is legitimate: budget.normalize() accepts it (well
        # under its own 48000-byte cap). The rejection must come from
        # business_reports.create()'s own snapshot-size check, and it must
        # happen before any AiWorkflowRuns row is created for this request.
        before = m.AiWorkflowRuns.objects.count()
        with patch("ai_assistant.transport.catalog", return_value=self.tools):
            with self.assertRaises(AiError) as caught:
                reports.create(request, self.admin)
        self.assertEqual(caught.exception.status, 413)
        self.assertIn("32768", str(caught.exception))
        self.assertEqual(m.AiWorkflowRuns.objects.count(), before)
        self.assertFalse(m.AiReportRun.objects.filter(client_request_id="snap-budget-over").exists())

    def test_rejected_request_can_be_retried_with_a_smaller_plan(self):
        """A caller who hits the 413 can shrink the plan and retry under a new
        clientRequestId (the original stays unbound, so this isn't a replay)."""
        n_over, n_under = 70, 10  # n=70 overflows even without previousReportId (33166 bytes)
        evidence_id, rows = self.seal_evidence(n_over)
        over_plan = self.plan_for(n_over, evidence_id, rows)
        with patch("ai_assistant.transport.catalog", return_value=self.tools):
            with self.assertRaises(AiError):
                reports.create(self.request_for("snap-budget-retry", evidence_id, over_plan), self.admin)
        small_plan = deepcopy(over_plan)
        small_plan["targets"] = small_plan["targets"][:n_under]
        small_plan["totalBudgetCents"] = 10000 * n_under
        with patch("ai_assistant.transport.catalog", return_value=self.tools):
            item = reports.create(self.request_for("snap-budget-retry", evidence_id, small_plan), self.admin)["item"]
        row = m.AiReportRun.objects.get(pk=item["id"])
        self.assertLessEqual(len(row.snapshot_json.encode()), 32768)
