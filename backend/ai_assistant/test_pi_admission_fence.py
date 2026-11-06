"""Coverage for the Pi gateway's admission fence (pi_gateway.execute + pi_native.authorize).

Synthetic Pi authority tests; no model, production or Docker calls.

Before this file, `local_complete`/`local_admit`/`pi_admission_required` had
zero hits across ai_assistant.test_*.py. In particular there was no coverage
that a null "admission" value is rejected: "admission" not in payload only
caught an omitted key, so `{"admission": null}` sailed past that gate and
reached pi_native.authorize with supplied=None, which skips its own
comparison for the same reason. See pi_gateway.py:348 and pi_native.py:64.
"""
import hashlib
import inspect
import secrets
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from . import pi_native, pi_service as service, pi_gateway as gateway, pi_worker as worker
from .policy import AiError, mutation
from . import tests as domain


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PiAdmissionFenceTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user
    call = domain.AiDomainTests.call

    def session(self, actor=None, **kwargs):
        return service.create_session({"clientRequestId": secrets.token_hex(8), **kwargs}, actor or self.owner)["session"]["id"]

    def prompt(self, session_id=None, actor=None, **kwargs):
        return service.prompt(session_id or self.session(actor), {"clientRequestId": "prompt-1", "message": "合成问题", **kwargs}, actor or self.owner)

    def running(self, **kwargs):
        """Claim a queued operation and mint a fresh capability for it, mirroring test_pi_runtime.py."""
        result = self.prompt(**kwargs)
        op = worker.claim()
        token = "isolated-capability-" + "x" * 48
        with mutation():
            op.capability_hash = hashlib.sha256(token.encode()).hexdigest()
            op.capability_expires_at = timezone.now() + timedelta(hours=1)
            op.save()
        return op, token

    def admit_payload(self, op, token, *, request_id="gateway-1", tool_call="call-1", **overrides):
        return {**worker.identity(op), "kind": "admission", "requestId": request_id, "capability": token,
            "name": "local_admit", "args": {"toolName": "read", "toolCallId": tool_call}, **overrides}

    def test_authorize_defaults_to_require_supplied(self):
        """Pin the default so a future call site that forgets the flag fails
        loud (pi_admission_changed) instead of silently skipping the check.
        This is a signature guard, not a behavior test: if someone flips the
        default back to False, this must fail before anything else does.
        """
        self.assertIs(inspect.signature(pi_native.authorize).parameters["require_supplied"].default, True)

    def test_authorize_rejects_bare_none_by_default(self):
        """Direct unit test of the function, bypassing the gateway entirely:
        authorize(op, None) must reject, not skip, unless a caller opts out.
        """
        op, _ = self.running()
        with self.assertRaises(AiError) as ctx:
            pi_native.authorize(op, None, kind="admission", name="read", lock=True)
        self.assertEqual(ctx.exception.code, "pi_admission_changed")

    def test_authorize_bare_none_allowed_when_opted_out(self):
        """The closed set of internal callers must still work with require_supplied=False."""
        op, _ = self.running()
        pi_native.authorize(op, None, kind="tool", name="read", lock=True, require_supplied=False)

    def test_omitted_admission_is_rejected(self):
        """A payload with no "admission" key at all is the legacy-Runner case."""
        op, token = self.running()
        payload = self.admit_payload(op, token)
        with self.assertRaises(AiError) as ctx:
            gateway.execute(payload, "nonce-omitted")
        self.assertEqual(ctx.exception.code, "pi_admission_required")

    def test_null_admission_is_rejected_not_bypassed(self):
        """The bug: {"admission": null} must not sail past the fence.

        Before the fix, pi_gateway.py:348 used `"admission" not in payload`
        (presence check) while pi_native.py:64 used `supplied is not None`
        (non-null check), so a payload carrying the key with a null value
        passed the gateway's gate and then skipped pi_native.authorize's own
        comparison, reaching the _local handler and returning a real
        admission snapshot. That is a version/epoch-drift bypass: a rotated
        or stale container could keep acting on a new tree generation by
        always sending null instead of echoing back its last-known fence.
        """
        op, token = self.running()
        payload = self.admit_payload(op, token, admission=None)
        with self.assertRaises(AiError) as ctx:
            gateway.execute(payload, "nonce-null")
        self.assertEqual(ctx.exception.code, "pi_admission_changed")

    def test_empty_dict_admission_is_rejected(self):
        """{} has the right type (dict) but none of the expected keys."""
        op, token = self.running()
        payload = self.admit_payload(op, token, admission={})
        with self.assertRaises(AiError) as ctx:
            gateway.execute(payload, "nonce-empty-dict")
        self.assertEqual(ctx.exception.code, "pi_admission_changed")

    def test_all_keys_null_admission_is_rejected(self):
        """Right key set, every value null: must fail the type/value check, not just the key-set check."""
        op, token = self.running()
        real = worker.native_admission(op)
        all_null = {key: None for key in real}
        payload = self.admit_payload(op, token, admission=all_null)
        with self.assertRaises(AiError) as ctx:
            gateway.execute(payload, "nonce-all-null")
        self.assertEqual(ctx.exception.code, "pi_admission_changed")

    def test_expired_real_fence_is_rejected(self):
        """A syntactically valid but stale admissionEpoch must still be rejected."""
        op, token = self.running()
        real = worker.native_admission(op)
        forged = dict(real)
        forged["admissionEpoch"] = real["admissionEpoch"] + 5
        payload = self.admit_payload(op, token, admission=forged)
        with self.assertRaises(AiError) as ctx:
            gateway.execute(payload, "nonce-expired")
        self.assertEqual(ctx.exception.code, "pi_admission_changed")

    def test_correct_current_fence_is_admitted(self):
        """The one case that must keep working: echoing back the real, current fence."""
        op, token = self.running()
        real = worker.native_admission(op)
        payload = self.admit_payload(op, token, admission=real)
        result = gateway.execute(payload, "nonce-correct")
        self.assertTrue(result["admitted"])
        self.assertEqual(result["admission"], real)

    def test_local_complete_without_admit_receipt_is_rejected(self):
        """local_complete is the one exception that may run with no "admission" key,
        but only once a prior local_admit receipt exists for the same tool call.
        With no such receipt, it must be refused rather than silently accepted.
        """
        op, token = self.running()
        payload = {**worker.identity(op), "kind": "admission", "requestId": "gateway-2", "capability": token,
            "name": "local_complete", "args": {"toolName": "read", "toolCallId": "call-no-receipt", "status": "completed"}}
        with self.assertRaises(AiError) as ctx:
            gateway.execute(payload, "nonce-complete-no-receipt")
        self.assertEqual(ctx.exception.code, "pi_local_admission_missing")
