import hashlib
import secrets
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from . import models as m, task_feedback, tests as domain
from . import pi_service as service, pi_worker as worker
from .policy import AiError, mutation


class TaskFeedbackTests(TestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user

    def settled(self, actor=None, status="succeeded"):
        """A finished operation: corrections describe reports that exist."""
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
        return op

    def body(self, **kwargs):
        return {"targetKind": "metric_definition", "targetRef": "gross_margin",
                "newValue": "按分摊后金额合计计算", "confirmed": True, **kwargs}

    def test_correction_binds_the_settled_operation_and_its_generation(self):
        op = self.settled()
        saved = task_feedback.save(op.id, self.body(), self.owner)["item"]
        self.assertEqual(saved["operationId"], op.id)
        self.assertEqual(saved["generation"], op.generation)
        self.assertEqual((saved["status"], saved["version"], saved["source"]),
                         ("confirmed", 1, "user"))
        # Default scope is the report it came from, never wider by accident.
        self.assertEqual(saved["appliesTo"], "this_report")
        self.assertEqual(saved["confirmedBy"], self.owner.email.lower())
        listed = task_feedback.listing(op.id, self.owner)
        self.assertEqual([item["id"] for item in listed["items"]], [saved["id"]])

    def test_a_task_still_in_flight_cannot_be_corrected(self):
        op = self.settled(status="running")
        with self.assertRaises(AiError):
            task_feedback.save(op.id, self.body(), self.owner)

    def test_model_proposals_cannot_be_written_as_confirmed(self):
        op = self.settled()
        with self.assertRaises(AiError):
            task_feedback.save(op.id, self.body(source="model_suggested"), self.owner)
        self.assertEqual(m.AiTaskFeedback.objects.count(), 0)

    def test_unconfirmed_and_invalid_enumerations_are_refused(self):
        op = self.settled()
        for body in (self.body(confirmed=False),
                     self.body(targetKind="whatever"),
                     self.body(appliesTo="every_shop"),
                     self.body(source="somewhere"),
                     {"targetRef": "x", "newValue": "y", "confirmed": True},
                     self.body(extra="x")):
            with self.assertRaises(AiError):
                task_feedback.save(op.id, body, self.owner)
        self.assertEqual(m.AiTaskFeedback.objects.count(), 0)

    def test_cross_shop_scope_requires_an_unscoped_principal(self):
        # self.owner is scoped, so it may correct its own report but cannot
        # speak for every shop.
        op = self.settled()
        with self.assertRaises(AiError):
            task_feedback.save(op.id, self.body(appliesTo="all_shops"), self.owner)
        self.assertEqual(
            task_feedback.save(op.id, self.body(appliesTo="this_shop"),
                               self.owner)["item"]["appliesTo"], "this_shop")
        # An unscoped account owning its own report may widen it deliberately.
        unscoped = self.user("unscoped@example.invalid", "admin", None)
        own = self.settled(actor=unscoped)
        self.assertEqual(
            task_feedback.save(own.id, self.body(appliesTo="all_shops"),
                               unscoped)["item"]["appliesTo"], "all_shops")

    def test_superseding_keeps_the_previous_row_and_carries_its_value_forward(self):
        op = self.settled()
        first = task_feedback.save(op.id, self.body(), self.owner)["item"]
        second = task_feedback.save(
            op.id, self.body(newValue="不扣费用分摊"), self.owner)
        self.assertEqual(second["superseded"], first["id"])
        # The old row stays readable rather than being rewritten.
        self.assertEqual(
            m.AiTaskFeedback.objects.get(id=first["id"]).status, "superseded")
        # The replaced value becomes the new row's old value, so the change is
        # legible without reading the previous record.
        self.assertEqual(second["item"]["oldValue"], "按分摊后金额合计计算")
        self.assertEqual(
            m.AiTaskFeedback.objects.filter(operation=op, status="confirmed").count(), 1)

    def test_withdrawing_needs_the_seen_version_and_does_not_restore_the_old_value(self):
        op = self.settled()
        saved = task_feedback.save(op.id, self.body(), self.owner)["item"]
        with self.assertRaises(AiError):
            task_feedback.withdraw(op.id, saved["id"], {"expectedVersion": 99}, self.owner)
        done = task_feedback.withdraw(
            op.id, saved["id"], {"expectedVersion": saved["version"]}, self.owner)
        self.assertEqual(done["item"]["status"], "withdrawn")
        # Withdrawn is terminal for that row; it is not a toggle.
        with self.assertRaises(AiError):
            task_feedback.withdraw(
                op.id, saved["id"], {"expectedVersion": done["item"]["version"]}, self.owner)
        self.assertEqual(
            task_feedback.listing(op.id, self.owner)["items"][0]["status"], "withdrawn")

    def test_another_account_can_neither_read_nor_correct_the_operation(self):
        op = self.settled()
        task_feedback.save(op.id, self.body(), self.owner)
        for call in (lambda: task_feedback.listing(op.id, self.other),
                     lambda: task_feedback.save(op.id, self.body(), self.other)):
            with self.assertRaises(AiError):
                call()

    def test_every_write_is_recorded_on_the_operations_event_stream(self):
        op = self.settled()
        saved = task_feedback.save(op.id, self.body(), self.owner)["item"]
        task_feedback.save(op.id, self.body(newValue="改第二次"), self.owner)
        task_feedback.withdraw(
            op.id, m.AiTaskFeedback.objects.get(operation=op, status="confirmed").id,
            {"expectedVersion": 1}, self.owner)
        kinds = list(m.PiEvent.objects.filter(operation=op)
                     .order_by("event_seq")
                     .values_list("event_type", flat=True))
        for expected in ("task_feedback_confirmed", "task_feedback_superseded",
                         "task_feedback_withdrawn"):
            self.assertIn(expected, kinds)
        # Values are proven by digest, not repeated into the audit stream.
        data = (m.PiEvent.objects.filter(operation=op, event_type="task_feedback_confirmed")
                .values_list("data_json", flat=True).first())
        self.assertIn("valueDigest", data)
        self.assertNotIn("按分摊后金额合计计算", data)
        self.assertIn(saved["id"], "".join(
            m.PiEvent.objects.filter(operation=op).values_list("data_json", flat=True)))
