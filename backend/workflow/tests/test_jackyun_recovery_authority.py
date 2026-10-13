import json
import uuid
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from sales.tests.factories import TEST_SECRET, signed_headers
from workflow.models import WorkflowWriteAuthority, WorkflowWriteRequestReceipt


@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class JackyunRecoveryAuthorityTests(TestCase):
    def setUp(self):
        WorkflowWriteAuthority.objects.filter(id=1).update(status="postgres")

    def authorize(self, request_id, payload=None, role="admin"):
        url = "/api/workflow/jackyun-recovery-authority"
        body = json.dumps(payload or {"kind": "retry", "logicalExecutionId": "8548", "failedExecutionId": "8548"}).encode()
        return self.client.post(url, body, content_type="application/json", headers=signed_headers(url, method="POST", body=body, role=role, request_id=request_id))

    def test_one_human_request_reuses_original_permission_receipt_and_rejects_changed_target(self):
        request_id = str(uuid.uuid4())
        first = self.authorize(request_id)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["authorizationId"], request_id)
        self.assertEqual(self.authorize(request_id).json(), first.json())
        self.assertEqual(self.authorize(request_id, {"kind": "retry", "logicalExecutionId": "8548", "failedExecutionId": "8556"}).status_code, 409)
        self.assertEqual(WorkflowWriteRequestReceipt.objects.filter(request_id=request_id).count(), 1)

    def test_authority_read_is_protected_read_only_and_expiry_never_becomes_fresh_permission(self):
        request_id = str(uuid.uuid4()); self.authorize(request_id)
        url = f"/api/workflow/jackyun-recovery-authority?authorizationId={request_id}"
        before = list(WorkflowWriteRequestReceipt.objects.values())
        response = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["authorizationId"], request_id)
        self.assertRegex(response.headers["X-Workflow-Data-Revision"], r"^\d+:[0-9a-f]{12}$")
        self.assertEqual(list(WorkflowWriteRequestReceipt.objects.values()), before)
        self.assertEqual(self.client.get(url, headers=signed_headers(url, role="operator")).status_code, 403)
        WorkflowWriteRequestReceipt.objects.filter(request_id=request_id).update(expires_at=timezone.now())
        self.assertEqual(self.client.get(url, headers=signed_headers(url)).status_code, 404)

    def test_new_collection_is_explicit_and_ordinary_roles_cannot_mint_manual_recovery(self):
        self.assertEqual(self.authorize(str(uuid.uuid4()), {"kind": "new"}).status_code, 200)
        self.assertEqual(self.authorize(str(uuid.uuid4()), role="operator").status_code, 403)
        self.assertEqual(self.authorize(str(uuid.uuid4()), {"kind": "new", "logicalExecutionId": "8548"}).status_code, 400)
