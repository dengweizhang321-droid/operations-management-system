"""Isolated recovery/control evidence checks; no provider or Runner effects."""
import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import pi_context, pi_workspace as workspace
from .pi_models import PiControl, PiDispatch, PiOperation, PiSession
from .policy import AiError, canonical, mutation
from . import test_pi_workspace as fixtures


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class RecoveryTests(TestCase):
    setUp = fixtures.PiWorkspaceTests.setUp
    user = fixtures.PiWorkspaceTests.user
    session = fixtures.PiWorkspaceTests.session
    prompt = fixtures.PiWorkspaceTests.prompt
    ready = fixtures.PiWorkspaceTests.ready
    send = fixtures.PiWorkspaceTests.send
    runner = fixtures.PiWorkspaceTests.runner

    def test_normal_detail_is_bounded_evidence_and_does_not_send_or_write(self):
        op = self.ready()
        before = (PiControl.objects.count(), PiOperation.objects.count(), PiDispatch.objects.count())
        with patch.object(workspace.pi_transport, "command") as send:
            first = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
            again = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        self.assertFalse(send.called)
        self.assertEqual(first, again)
        self.assertEqual(first["goal"]["operationId"], op.id)
        self.assertEqual(first["goal"]["text"], "合成问题")
        self.assertFalse(first["compaction"]["automatic"])
        self.assertIsNone(first["contextBudget"]["currentInputTokens"])
        self.assertEqual(before, (PiControl.objects.count(), PiOperation.objects.count(), PiDispatch.objects.count()))

    def test_compact_freezes_manifest_under_original_receipt_and_duplicate_never_resends(self):
        op = self.ready()
        with patch.object(workspace.pi_transport, "command") as send:
            result = self.send(op.session_id, "compact", {"customInstructions": "保留中文修正"})
            again = self.send(op.session_id, "compact", {"customInstructions": "保留中文修正"})
        self.assertFalse(send.called)
        self.assertTrue(again["replayed"])
        self.assertEqual(again["control"]["id"], result["control"]["id"])
        control = PiControl.objects.get(pk=result["control"]["id"])
        snapshot = json.loads(control.operation.payload_json)["recovery"]
        self.assertEqual(snapshot["goal"]["operationId"], op.id)
        self.assertEqual(snapshot["binding"]["throughControlSeq"], 0)
        self.assertIn(canonical(snapshot), json.loads(control.payload_json)["customInstructions"])
        self.assertIn("保留中文修正", json.loads(control.payload_json)["customInstructions"])

    def test_original_unknown_dispatch_is_retained_and_blocks_new_compact(self):
        op = self.ready()
        with mutation():
            PiDispatch.objects.create(id="unknown-model", operation=op, kind="model", request_id="original",
                request_digest="synthetic", status="unknown", response_json=canonical({"providerFrame": "private"}))
        with patch.object(workspace.pi_transport, "command") as send:
            state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
            with self.assertRaises(AiError) as caught: self.send(op.session_id, "compact")
        self.assertEqual(caught.exception.code, "pi_compact_unsafe")
        self.assertEqual(state["unresolvedDispatches"]["items"][0]["dispatchId"], "unknown-model")
        self.assertNotIn("providerFrame", canonical(state))
        self.assertFalse(send.called)
        self.assertEqual(PiControl.objects.count(), 0)

    def test_user_decisions_are_verbatim_with_omission_and_original_control_ids(self):
        op = self.ready()
        with mutation():
            for i in range(pi_context.LIMIT+2):
                PiControl.objects.create(id=f"decision-{i}", session_id=op.session_id, operation=op,
                    client_request_id=f"decision-{i}", request_digest="synthetic", epoch=op.epoch,
                    generation=op.generation, control_seq=i+1, command="steer", status="completed",
                    payload_json=canonical({"message": "已确认修正"*1000}))
        state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        decisions = state["userDecisionsAndCorrections"]
        self.assertTrue(decisions["hasMore"])
        self.assertEqual(len(decisions["items"]), pi_context.LIMIT)
        self.assertTrue(decisions["items"][0]["evidence"]["truncated"])
        self.assertEqual(decisions["items"][0]["controlId"], f"decision-{pi_context.LIMIT+1}")
        self.assertLess(len(canonical(state).encode()), 96*1024)
        next_page = workspace.detail(op.session_id, {"recoveryBeforeControlSeq": str(decisions["nextBeforeControlSeq"])}, self.owner, poll=False)["recovery"]
        self.assertEqual(next_page["userDecisionsAndCorrections"]["items"][0]["controlSeq"], 2)
        source = workspace.detail(op.session_id, {"recoveryControlSeq": "1", "recoveryTextOffset": "1200"}, self.owner, poll=False)["recovery"]["sourceControl"]
        self.assertEqual(source["controlId"], "decision-0")
        self.assertEqual(source["offset"], 1200)
        self.assertIsNotNone(source["nextOffset"])

    def test_compaction_blocks_new_writers_until_original_terminal_receipt(self):
        op = self.ready()
        self.send(op.session_id, "compact")
        with patch.object(workspace.pi_transport, "command") as send:
            with self.assertRaises(AiError): self.send(op.session_id, "terminal_create", key="new-terminal")
        self.assertFalse(send.called)
        self.assertEqual(PiControl.objects.count(), 1)

    def test_frozen_generation_cannot_reveal_recovery_evidence(self):
        op = self.ready()
        with mutation(): PiSession.objects.filter(pk=op.session_id).update(status="frozen")
        state = workspace.detail(op.session_id, {}, self.owner, poll=False)["recovery"]
        self.assertEqual(state, {"schemaVersion": "pi-recovery-v1", "status": "frozen", "available": False})
