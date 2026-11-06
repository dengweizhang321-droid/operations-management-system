"""The JD close authority has no `closeRequestId` alias; jackyun still does.

`edca421c` narrowed the JD payload to exactly {action, target} so the extra key
is rejected before any per-key check could run. These tests fix the actual
observable behaviour of that rejection, and keep the jackyun contrast explicit
so the two paths are never "aligned" by accident.
"""
import json
import uuid
from unittest.mock import patch
from django.test import TestCase
from sales.tests.factories import TEST_SECRET, signed_headers
from workflow import jd_customer_service_close_authority as jd
from workflow import jackyun_close_authority as jackyun
from workflow.errors import WorkflowApiError
from workflow.models import WorkflowWriteAuthority, WorkflowWriteRequestReceipt

JD_URL = "/api/workflow/jd-customer-service-close-authority"
TARGET = {
    "storeKey": "jd-chudian-weizhang",
    "kind": "pre_export_zero_effect",
    "originalExecutionId": "7250",
    "originalPlanSha256": "a" * 64,
    "failureCode": "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION",
    "period": {"scheduledDate": "2026-10-08", "startDate": "2026-09-08", "endDate": "2026-10-07"},
}
JACKYUN_TARGET = {
    "logicalExecutionId": "7100",
    "sourceExecutionId": "7150",
    "failedExecutionId": "7200",
    "planDigest": "b" * 64,
    "controlDigest": "c" * 64,
    "activeDigest": "d" * 64,
    "evidenceDigest": "e" * 64,
}


class JdCloseRequestIdRemovedTests(TestCase):
    def test_close_request_id_is_rejected_by_the_exact_key_set_not_by_uuid_shape(self):
        # A well-formed UUID is rejected exactly like a malformed one, which is
        # what proves the per-key UUID check was unreachable rather than lenient.
        for alias in (str(uuid.uuid4()), "not-a-uuid"):
            with self.subTest(alias=alias):
                with self.assertRaises(WorkflowApiError) as raised:
                    jd.validate({"action": "close", "target": TARGET, "closeRequestId": alias})
                self.assertEqual(str(raised.exception), "闭合授权必须明确绑定当前旧任务")
                self.assertEqual(raised.exception.status, 400)
                self.assertEqual(raised.exception.code, "invalid_request")

    def test_the_exact_two_key_payload_is_the_only_accepted_shape(self):
        self.assertEqual(jd.validate({"action": "close", "target": TARGET}),
                         {"action": "close", "target": TARGET})
        for payload in ({"action": "close"},
                        {"target": TARGET},
                        {"action": "close", "target": TARGET, "closeRequestId": str(uuid.uuid4())}):
            with self.subTest(payload=sorted(payload)):
                with self.assertRaises(WorkflowApiError):
                    jd.validate(payload)

    def test_identity_is_still_live_for_the_request_id_itself(self):
        # Deleting the alias branch must not retire `identity`; it still gates
        # the X-Teruisi-Request-Id used as the authorizationId.
        request_id = str(uuid.uuid4())
        self.assertIsNone(jd.identity(request_id))
        with self.assertRaises(WorkflowApiError):
            jd.identity("not-a-uuid")

    def test_jackyun_still_accepts_the_alias_for_its_half_closed_resume(self):
        alias = str(uuid.uuid4())
        payload = {"action": "close", "target": JACKYUN_TARGET, "closeRequestId": alias}
        self.assertEqual(jackyun.validate(payload), payload)
        with self.assertRaises(WorkflowApiError):
            jackyun.validate({"action": "close", "target": JACKYUN_TARGET, "closeRequestId": "not-a-uuid"})


@patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
class JdCloseRequestIdOverHttpTests(TestCase):
    def setUp(self):
        WorkflowWriteAuthority.objects.filter(id=1).update(status="postgres")

    def post(self, payload, request_id=None):
        body = json.dumps(payload).encode()
        return self.client.post(JD_URL, body, content_type="application/json",
                                headers=signed_headers(JD_URL, method="POST", body=body,
                                                       request_id=request_id or str(uuid.uuid4())))

    def test_alias_payload_is_a_400_invalid_request_and_mints_no_authority(self):
        request_id = str(uuid.uuid4())
        response = self.post({"action": "close", "target": TARGET, "closeRequestId": str(uuid.uuid4())}, request_id)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "invalid_request")
        self.assertEqual(response.json()["error"], "闭合授权必须明确绑定当前旧任务")
        self.assertFalse(WorkflowWriteRequestReceipt.objects.filter(
            request_id=request_id, status="completed", response_status=200).exists())

    def test_exact_payload_still_mints_an_authority_whose_receipt_has_no_alias(self):
        request_id = str(uuid.uuid4())
        response = self.post({"action": "close", "target": TARGET}, request_id)
        self.assertEqual(response.status_code, 200, response.content)
        value = response.json()
        self.assertEqual(value["authorizationId"], request_id)
        self.assertNotIn("closeRequestId", value)
        # read_authority re-validates the stored receipt; it must stay readable.
        url = f"{JD_URL}?authorizationId={request_id}"
        read = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(read.status_code, 200, read.content)
        self.assertEqual(read.json()["authorizationId"], request_id)
        self.assertNotIn("closeRequestId", read.json())

    def test_a_receipt_minted_before_the_key_set_narrowed_is_still_readable(self):
        # Receipts live 7 days, so one carrying the alias can outlive edca421c.
        # read_authority must not project that key back into validate(), or it
        # would reject the receipt it just authenticated -- locking an operator
        # out of a closure they were legitimately granted. The alias is dropped
        # on the way in, not used to fail the read.
        request_id = str(uuid.uuid4())
        self.assertEqual(self.post({"action": "close", "target": TARGET}, request_id).status_code, 200)
        receipt = WorkflowWriteRequestReceipt.objects.get(request_id=request_id)
        receipt.response_payload = {**receipt.response_payload, "closeRequestId": str(uuid.uuid4())}
        receipt.save(update_fields=["response_payload"])
        url = f"{JD_URL}?authorizationId={request_id}"
        read = self.client.get(url, headers=signed_headers(url))
        self.assertEqual(read.status_code, 200, read.content)
        self.assertEqual(read.json()["authorizationId"], request_id)

    def test_every_alias_shape_gets_the_key_set_error_not_a_per_key_one(self):
        # The deleted branch was unobservable: :52's exact key set raises at :53
        # before it could run, so no test can tell whether those two lines are
        # present. What is observable is that the message never comes from a
        # per-key check -- pin that, and say plainly that the deletion itself
        # rests on reading the control flow, not on this assertion.
        messages = set()
        for alias in ("not-a-uuid", str(uuid.uuid4()), "", 7, None):
            with self.subTest(alias=alias):
                with self.assertRaises(WorkflowApiError) as raised:
                    jd.validate({"action": "close", "target": TARGET, "closeRequestId": alias})
                messages.add(str(raised.exception))
        self.assertEqual(messages, {"闭合授权必须明确绑定当前旧任务"})
