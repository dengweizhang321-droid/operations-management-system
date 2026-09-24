"""Isolated PostgreSQL sealed-v4 application HMAC and source replay checks."""
import hashlib
from unittest.mock import patch

from django.test import TransactionTestCase, override_settings

from access_control.models import AppUser
from business_analysis.contracts import canonical, digest
from finance.models import FinanceDataRevision
from netshop.models import NetshopDataRevision

from . import (business_v4_seal_hmac as seal_hmac,
    business_v4_seal_verify as verifier,
    business_v4_validation as validation, models as m)
from .policy import AiError
from .test_business_v4_seal_writer_gate import BusinessV4SealWriterGateTests as gate


class BusinessV4SealVerifyTests(TransactionTestCase):
    promotion_owner = gate.promotion_owner
    rebuild_plan = gate.rebuild_plan
    finance_owner = gate.finance_owner
    owner = gate.owner
    collect = gate.collect
    complete_mixed = gate.complete_mixed
    attempt = gate.attempt
    database = gate.database
    body = gate.body
    call_as_sealer = gate.call_as_sealer
    setUp = gate.setUp
    tearDown = gate.tearDown

    def sealed(self, *, authentic=True):
        attempt_id = self.attempt()
        body = self.body(attempt_id)
        signature = seal_hmac.sign(canonical(body))
        self.assertEqual(signature["keyId"], body["keyId"])
        self.call_as_sealer(body, mac=signature["bodyMac"] if authentic
            else "f" * 64)
        return body

    def test_real_application_mac_and_segments_verify_after_new_source_revision(self):
        body = self.sealed()
        before = (m.AiBusinessV4Chunk.objects.count(),
            m.AiBusinessV4ValidationSegment.objects.count())
        proof = verifier.verify_seal(self.parent.id, self.principal)
        self.assertEqual(proof["evidenceVersion"], body["evidenceVersion"])
        self.assertEqual(proof["sealedDigest"], hashlib.sha256(
            canonical(body).encode("utf-8")).hexdigest())
        self.assertTrue(proof["internalSealVerified"])
        self.assertTrue(proof["segmentHmacVerified"])
        self.assertFalse(proof["upstreamSignatureVerified"])
        self.assertFalse(proof["reportGenerationSupported"])
        self.assertEqual((m.AiBusinessV4Chunk.objects.count(),
            m.AiBusinessV4ValidationSegment.objects.count()), before)
        finance = FinanceDataRevision.objects.get(domain="finance")
        netshop = NetshopDataRevision.objects.get(domain="netshop")
        FinanceDataRevision.objects.filter(pk=finance.pk).update(
            revision=finance.revision + 1,
            source_digest=digest([finance.source_digest, "later-finance"]))
        NetshopDataRevision.objects.filter(pk=netshop.pk).update(
            revision=netshop.revision + 1,
            source_digest=digest([netshop.source_digest, "later-shop"]))
        self.assertEqual(verifier.verify_seal(self.parent.id,
            self.principal)["sealedDigest"], proof["sealedDigest"])

    def test_database_accepted_random_hex_mac_is_not_a_verified_seal(self):
        self.sealed(authentic=False)
        self.assertEqual(m.AiBusinessV4Run.objects.get(
            pk=self.parent.pk).status, "sealed")
        with self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)

    def test_missing_segment_revoked_actor_and_unknown_key_are_rejected(self):
        self.sealed()
        original = m.AiBusinessV4ValidationSegment.objects.filter
        def omit(*args, **kwargs):
            return original(*args, **kwargs).exclude(
                source__source_key="finance-context")
        with patch.object(m.AiBusinessV4ValidationSegment.objects, "filter",
                side_effect=omit), self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)
        with patch.object(validation, "_mac", return_value="0" * 64), \
                self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)
        AppUser.objects.filter(email=self.principal.email).update(status="inactive")
        with self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)
        AppUser.objects.filter(email=self.principal.email).update(status="active")
        with override_settings(DJANGO_INTERNAL_SECRET="rotated-seal-key-" + "x" * 48), \
                self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)

    def test_unsealed_cross_run_and_reader_process_never_get_authority(self):
        other = m.AiBusinessV4Run.objects.exclude(pk=self.parent.pk).get(
            owner_email=self.principal.email)
        with self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)
        self.sealed()
        with self.assertRaises(AiError):
            verifier.verify_seal(other.id, self.principal)
        with override_settings(DJANGO_PROCESS_ROLE="ai_reader"), \
                self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)
        original = m.AiBusinessV4Seal.objects.filter
        with patch.object(m.AiBusinessV4Seal.objects, "filter",
                side_effect=lambda *args, **kwargs: original(*args, **kwargs).none()), \
                self.assertRaises(AiError):
            verifier.verify_seal(self.parent.id, self.principal)
