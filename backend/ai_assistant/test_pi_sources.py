import hashlib
import json
import secrets
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from . import models as m, pi_sources, task_feedback, tests as domain
from . import pi_service as service, pi_worker as worker
from .pi_models import PiEvent, PiExport, PiFile
from .policy import AiError, canonical, mutation, uid


class PiSourcesTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user

    def settled(self, actor=None, status="succeeded"):
        actor = actor or self.owner
        session = service.create_session(
            {"clientRequestId": secrets.token_hex(8)}, actor)["session"]["id"]
        service.prompt(session, {"clientRequestId": "prompt-1", "message": "合成问题"}, actor)
        op = worker.claim()
        with mutation():
            op.capability_hash = hashlib.sha256(b"isolated").hexdigest()
            op.capability_expires_at = timezone.now() + timedelta(hours=1)
            op.status = status
            op.save()
            # Release the session's active operation the way pi_worker does on
            # settle. Postgres enforces this binding (ai_pi_binding_guard): an
            # active operation must still be in flight, so leaving the pointer
            # on a succeeded row is rejected there even though sqlite allows it.
            if status not in {"queued", "running", "canceling", "unknown"}:
                session_row = op.session
                session_row.status, session_row.active_operation_id = "idle", ""
                session_row.save(update_fields=["status", "active_operation_id"])
        return op

    def export(self, op, *, warnings=(), status="succeeded", file=None):
        with mutation():
            return PiExport.objects.create(
                id=uid("pi-export"), operation=op, request_digest="a" * 64,
                status=status, query_json="{}", file=file,
                manifest_json=canonical({
                    "schemaVersion": 1, "dataset": "pi_netshop_promotion",
                    "sourceDomain": "netshop", "domainRevisions": [{"netshop": 12}],
                    "fields": ["spuId", "cost"], "units": {"cost": "CNY_cents"},
                    "snapshotComplete": False, "warnings": list(warnings)}))

    def artifact(self, op):
        payload = b"x" * 10
        with mutation():
            return PiFile.objects.create(
                id=uid("pi-file"), session=op.session, operation=op,
                owner_email=op.session.owner_email, client_request_id=secrets.token_hex(6),
                request_digest="b" * 64, generation=op.generation,
                file_name="日报.xlsx", mime_type="application/vnd.ms-excel",
                # Postgres checks the digest against the bytes
                # (ai_pi_file_payload_hash), so a placeholder hash is rejected
                # there even though sqlite accepts one.
                size_bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(),
                direction="output", payload=payload)

    def stage(self, op, event_type, seq):
        with mutation():
            return PiEvent.objects.create(
                id=uid("pi-event"), session=op.session, operation=op,
                generation=op.generation, event_seq=seq, event_type=event_type,
                data_json=canonical({"text": "模型正文不应出现在证据视图"}))

    def test_report_version_is_composed_from_existing_identifiers(self):
        op = self.settled()
        artifact = self.artifact(op)
        self.export(op, file=artifact)
        view = pi_sources.evidence(op.id, {}, self.owner)
        version = view["reportVersion"]
        self.assertEqual(version["operationId"], op.id)
        self.assertEqual((version["generation"], version["epoch"]),
                         (op.generation, op.epoch))
        # Read back from the operation rather than asserting fixture values:
        # model_id, model_version and skills_json are immutable after creation
        # (PI_IDENTITIES in migration 0084), so a test cannot set them.
        self.assertEqual(version["modelVersion"], op.model_version)
        self.assertEqual(version["skills"], json.loads(op.skills_json or "[]"))
        self.assertEqual(version["fileShas"], [artifact.sha256])
        self.assertEqual(len(version["sourceManifestDigests"]), 1)
        # The digest covers the composition, so citing it pins every part.
        self.assertTrue(view["reportVersionDigest"])
        self.assertTrue(view["citable"])

    def test_coverage_is_reported_rather_than_inferred(self):
        op = self.settled()
        # A source that warned keeps coverage incomplete even though it ran.
        self.export(op, warnings=["source_revision_changed"])
        view = pi_sources.evidence(op.id, {}, self.owner)
        self.assertFalse(view["coverage"]["sourcesComplete"])
        self.assertEqual(view["sources"][0]["warnings"], ["source_revision_changed"])
        # snapshotComplete comes verbatim from the owning exporter.
        self.assertFalse(view["coverage"]["anySnapshotComplete"])
        self.assertFalse(view["sources"][0]["snapshotComplete"])

    def test_no_sources_is_not_complete_coverage(self):
        op = self.settled()
        view = pi_sources.evidence(op.id, {}, self.owner)
        self.assertEqual(view["sources"], [])
        # An empty set of sources must not read as "everything was covered".
        self.assertFalse(view["coverage"]["sourcesComplete"])

    def test_an_unsettled_or_unknown_task_is_inspectable_but_not_citable(self):
        for status in ("running", "unknown", "failed"):
            op = self.settled(status=status)
            view = pi_sources.evidence(op.id, {}, self.owner)
            self.assertFalse(view["citable"], status)
            self.assertEqual(view["reportVersion"]["status"], status)

    def test_stage_list_proves_sequence_without_copying_payloads(self):
        op = self.settled()
        self.stage(op, "tool_start", 101)
        self.stage(op, "message_update", 102)
        self.stage(op, "tool_end", 103)
        view = pi_sources.evidence(op.id, {}, self.owner)
        kinds = [item["type"] for item in view["stages"]]
        self.assertIn("tool_start", kinds)
        self.assertIn("tool_end", kinds)
        # Message deltas are not stages, and no payload text crosses over.
        self.assertNotIn("message_update", kinds)
        self.assertNotIn("模型正文不应出现在证据视图", canonical(view["stages"]))
        self.assertTrue(all(set(item) == {"eventSeq", "type", "createdAt"}
                            for item in view["stages"]))

    def test_corrections_separate_confirmed_from_everything_else(self):
        op = self.settled()
        first = task_feedback.save(op.id, {
            "targetKind": "metric_definition", "targetRef": "gross_margin",
            "newValue": "口径一", "confirmed": True}, self.owner)["item"]
        task_feedback.save(op.id, {
            "targetKind": "metric_definition", "targetRef": "gross_margin",
            "newValue": "口径二", "confirmed": True}, self.owner)
        view = pi_sources.evidence(op.id, {}, self.owner)
        statuses = {item["feedbackId"]: item["status"] for item in view["corrections"]}
        self.assertEqual(statuses[first["id"]], "superseded")
        # Only the live correction is cited by the report version.
        self.assertEqual(len(view["reportVersion"]["confirmedFeedbackIds"]), 1)
        self.assertNotIn(first["id"], view["reportVersion"]["confirmedFeedbackIds"])

    def test_another_account_cannot_read_the_evidence(self):
        op = self.settled()
        for call in (lambda: pi_sources.evidence(op.id, {}, self.other),
                     lambda: pi_sources.events_after(op.id, {}, self.other)):
            with self.assertRaises(AiError):
                call()

    def test_stage_cursor_returns_only_what_follows_it(self):
        op = self.settled()
        self.stage(op, "tool_start", 201)
        self.stage(op, "tool_end", 202)
        after_none = pi_sources.events_after(op.id, {}, self.owner)
        self.assertEqual([item["eventSeq"] for item in after_none["items"]], [201, 202])
        after_first = pi_sources.events_after(op.id, {"after": "201"}, self.owner)
        self.assertEqual([item["eventSeq"] for item in after_first["items"]], [202])
        with self.assertRaises(AiError):
            pi_sources.events_after(op.id, {"unexpected": "1"}, self.owner)
