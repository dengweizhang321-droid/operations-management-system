import json
import uuid
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from sales.tests.factories import TEST_SECRET, signed_headers
from workflow.models import WorkflowWriteAuthority, WorkflowWriteRequestReceipt

VALID_TARGET = {
    "storeKey": "jd-chudian-weizhang",
    "kind": "pre_export_zero_effect",
    "originalExecutionId": "7250",
    "originalPlanSha256": "a" * 64,
    "failureCode": "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION",
    "period": {"scheduledDate": "2026-10-08", "startDate": "2026-09-08", "endDate": "2026-10-07"},
}


@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class JdCustomerServiceCloseAuthorityTests(TestCase):
    def setUp(self):
        WorkflowWriteAuthority.objects.filter(id=1).update(status="postgres")

    def authorize(self, request_id, payload=None, role="admin"):
        url = "/api/workflow/jd-customer-service-close-authority"
        body = json.dumps(payload or {"action": "close", "target": VALID_TARGET}).encode()
        return self.client.post(url, body, content_type="application/json", headers=signed_headers(url, method="POST", body=body, role=role, request_id=request_id))

    def test_one_human_request_reuses_original_permission_receipt_and_rejects_changed_target(self):
        request_id = str(uuid.uuid4())
        first = self.authorize(request_id)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["authorizationId"], request_id)
        self.assertEqual(first.json()["version"], "jd-customer-service-operator-close-authority-v1")
        self.assertEqual(self.authorize(request_id).json(), first.json())
        changed = {**VALID_TARGET, "originalExecutionId": "7266"}
        self.assertEqual(self.authorize(request_id, {"action": "close", "target": changed}).status_code, 409)
        self.assertEqual(WorkflowWriteRequestReceipt.objects.filter(request_id=request_id).count(), 1)

    def test_authority_read_is_protected_read_only_and_expiry_never_becomes_fresh_permission(self):
        request_id = str(uuid.uuid4())
        self.authorize(request_id)
        url = f"/api/workflow/jd-customer-service-close-authority?authorizationId={request_id}"
        before = list(WorkflowWriteRequestReceipt.objects.values())
        response = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["authorizationId"], request_id)
        self.assertRegex(response.headers["X-Workflow-Data-Revision"], r"^\d+:[0-9a-f]{12}$")
        self.assertEqual(list(WorkflowWriteRequestReceipt.objects.values()), before)
        self.assertEqual(self.client.get(url, headers=signed_headers(url, role="operator")).status_code, 403)
        WorkflowWriteRequestReceipt.objects.filter(request_id=request_id).update(expires_at=timezone.now())
        self.assertEqual(self.client.get(url, headers=signed_headers(url)).status_code, 404)

    def test_ordinary_roles_cannot_mint_closure_authority(self):
        self.assertEqual(self.authorize(str(uuid.uuid4()), role="operator").status_code, 403)
        self.assertEqual(self.authorize(str(uuid.uuid4()), role="viewer").status_code, 403)

    def test_request_id_must_be_a_real_uuid(self):
        response = self.client.post(
            "/api/workflow/jd-customer-service-close-authority",
            json.dumps({"action": "close", "target": VALID_TARGET}).encode(),
            content_type="application/json",
            headers=signed_headers("/api/workflow/jd-customer-service-close-authority", method="POST",
                                    body=json.dumps({"action": "close", "target": VALID_TARGET}).encode(), request_id="not-a-uuid"),
        )
        self.assertEqual(response.status_code, 400)

    def test_store_key_outside_the_four_registered_stores_is_rejected(self):
        target = {**VALID_TARGET, "storeKey": "jd-some-other-store"}
        self.assertEqual(self.authorize(str(uuid.uuid4()), {"action": "close", "target": target}).status_code, 400)

    def test_failure_code_must_match_the_declared_recovery_kind(self):
        # PAIR_PARSE_REJECTED only belongs to downloaded_pair, never pre_export_zero_effect.
        target = {**VALID_TARGET, "failureCode": "PAIR_PARSE_REJECTED"}
        self.assertEqual(self.authorize(str(uuid.uuid4()), {"action": "close", "target": target}).status_code, 400)

    def test_previous_run_unresolved_is_never_an_approvable_failure_code(self):
        # This is the symptom code the stuck pipeline reports to n8n; it is
        # never a plan's own stored failureCode and must never be approvable.
        for kind in ("pre_export_zero_effect", "downloaded_pair"):
            target = {**VALID_TARGET, "kind": kind, "failureCode": "PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION"}
            with self.subTest(kind=kind):
                self.assertEqual(self.authorize(str(uuid.uuid4()), {"action": "close", "target": target}).status_code, 400)

    def test_downloaded_pair_only_accepts_pair_parse_rejected(self):
        target = {**VALID_TARGET, "kind": "downloaded_pair", "failureCode": "PAIR_PARSE_REJECTED"}
        self.assertEqual(self.authorize(str(uuid.uuid4()), {"action": "close", "target": target}).status_code, 200)

    def test_malformed_targets_are_rejected(self):
        for invalid in (
            None,
            [],
            {},
            {**VALID_TARGET, "injected": "x"},
            {**VALID_TARGET, "originalPlanSha256": "not-hex"},
            {**VALID_TARGET, "originalExecutionId": "../etc"},
            {**VALID_TARGET, "kind": "unknown_kind"},
            {**VALID_TARGET, "period": {"scheduledDate": "2026-10-08"}},
        ):
            with self.subTest(target=invalid):
                self.assertEqual(self.authorize(str(uuid.uuid4()), {"action": "close", "target": invalid}).status_code, 400)
        self.assertEqual(self.authorize(str(uuid.uuid4()), {"action": "retry", "target": VALID_TARGET}).status_code, 400)

    def test_close_request_id_must_be_a_uuid_when_present(self):
        payload = {"action": "close", "target": VALID_TARGET, "closeRequestId": "not-a-uuid"}
        self.assertEqual(self.authorize(str(uuid.uuid4()), payload).status_code, 400)
        payload = {"action": "close", "target": VALID_TARGET, "closeRequestId": str(uuid.uuid4())}
        self.assertEqual(self.authorize(str(uuid.uuid4()), payload).status_code, 200)
