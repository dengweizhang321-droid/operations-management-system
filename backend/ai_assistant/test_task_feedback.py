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
            # Release the session's active operation the way pi_worker does on
            # settle. Postgres enforces this binding (ai_pi_binding_guard): an
            # active operation must still be in flight, so leaving the pointer
            # on a succeeded row is rejected there even though sqlite allows it.
            if status not in {"queued", "running", "canceling", "unknown"}:
                session_row = op.session
                session_row.status, session_row.active_operation_id = "idle", ""
                session_row.save(update_fields=["status", "active_operation_id"])
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
            op.id, self.body(newValue="不扣费用分摊", expectedVersion=first["version"]),
            self.owner)
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
        task_feedback.save(
            op.id, self.body(newValue="改第二次", expectedVersion=saved["version"]),
            self.owner)
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

    def _session_event_seq_matches_max_event(self, session_id):
        session = m.PiSession.objects.get(id=session_id)
        latest = (m.PiEvent.objects.filter(session=session)
                  .order_by("-event_seq").values_list("event_seq", flat=True).first())
        self.assertEqual(session.event_seq, latest or 0,
            "session.event_seq must stay the single source of truth for the "
            "next event's key; task_feedback must not advance PiEvent.event_seq "
            "past what the session counter knows about")

    def test_a_correction_does_not_block_the_sessions_next_message(self):
        # Regression for the production deadlock: once a correction is written
        # against a settled operation, the *next* prompt on that same session
        # must still succeed. Before the fix, task_feedback._event() computed
        # its own event_seq from max(PiEvent) without advancing
        # session.event_seq, so the following pi_service.event() call (made by
        # prompt()) recomputed an already-taken event_seq and the unique
        # constraint on (session, event_seq) raised IntegrityError -
        # permanently, since the session counter can never catch up on its own.
        op = self.settled()
        task_feedback.save(op.id, self.body(), self.owner)
        self._session_event_seq_matches_max_event(op.session_id)
        result = service.prompt(op.session_id,
            {"clientRequestId": "prompt-2", "message": "第二条消息"}, self.owner)
        self.assertFalse(result["replayed"])
        self._session_event_seq_matches_max_event(op.session_id)

    def test_repeated_corrections_including_supersede_do_not_block_the_next_message(self):
        # The supersede path writes two events in one call (superseded +
        # confirmed); withdraw writes a third on top. All three must still
        # leave the session able to continue.
        op = self.settled()
        first = task_feedback.save(op.id, self.body(), self.owner)["item"]
        task_feedback.save(
            op.id, self.body(newValue="改第二次", expectedVersion=first["version"]),
            self.owner)
        task_feedback.withdraw(
            op.id, m.AiTaskFeedback.objects.get(operation=op, status="confirmed").id,
            {"expectedVersion": 1}, self.owner)
        self._session_event_seq_matches_max_event(op.session_id)
        result = service.prompt(op.session_id,
            {"clientRequestId": "prompt-2", "message": "第二条消息"}, self.owner)
        self.assertFalse(result["replayed"])
        self._session_event_seq_matches_max_event(op.session_id)
        self.assertIsNotNone(first["id"])
    # -- targetRef is byte-limited, matching the database's
    # octet_length(target_ref)<=400 CHECK (migration 0088). sqlite test
    # databases never install that CHECK (0088's install() returns early on
    # non-postgresql vendors), so these tests cannot observe the database
    # reject an overlong value; they only prove the application now rejects
    # it first, with a clean AiError rather than ever reaching the database.

    def test_targetref_at_133_chinese_characters_399_bytes_is_accepted(self):
        # 133 * 3 = 399 bytes: one byte under the 400-byte CHECK.
        op = self.settled()
        ref = "测" * 133
        self.assertEqual(len(ref.encode("utf-8")), 399)
        saved = task_feedback.save(op.id, self.body(targetRef=ref), self.owner)["item"]
        self.assertEqual(saved["targetRef"], ref)

    def test_targetref_at_134_chinese_characters_402_bytes_is_rejected_as_400(self):
        # 134 * 3 = 402 bytes: over the 400-byte CHECK, but only 134
        # characters, which text()'s character-counting would have let
        # through (maximum=400). Must be rejected by the application itself,
        # as a 400-class AiError, not surface as a 500/IntegrityError.
        op = self.settled()
        ref = "测" * 134
        self.assertEqual(len(ref.encode("utf-8")), 402)
        with self.assertRaises(AiError) as caught:
            task_feedback.save(op.id, self.body(targetRef=ref), self.owner)
        self.assertEqual(caught.exception.status, 413)
        self.assertEqual(m.AiTaskFeedback.objects.count(), 0)

    def test_targetref_mixed_ascii_and_chinese_is_counted_in_bytes_not_chars(self):
        # 300 ASCII bytes (1 byte/char) + 34 Chinese chars (3 bytes/char) =
        # 300 + 102 = 402 bytes from only 334 characters: proves the check
        # is not a simple char-count-times-3 shortcut either.
        op = self.settled()
        ref = ("a" * 300) + ("测" * 34)
        self.assertEqual(len(ref), 334)
        self.assertEqual(len(ref.encode("utf-8")), 402)
        with self.assertRaises(AiError):
            task_feedback.save(op.id, self.body(targetRef=ref), self.owner)
        # One byte under: same character mix, one fewer Chinese character.
        ok_ref = ("a" * 300) + ("测" * 33) + "x"
        self.assertEqual(len(ok_ref.encode("utf-8")), 400)
        saved = task_feedback.save(op.id, self.body(targetRef=ok_ref), self.owner)["item"]
        self.assertEqual(saved["targetRef"], ok_ref)

    # -- expectedVersion / CAS: fields() previously had no "expectedVersion"
    # entry in save()'s allowed set, so passing it raised a 400 (unknown
    # field) and the CAS check at the mutation site ("expectedVersion" in
    # body) could never see a body that contained it: cas() was dead code
    # and a request with no expectedVersion silently overwrote whatever was
    # live.

    def test_expected_version_is_now_an_accepted_field_and_enforces_cas(self):
        op = self.settled()
        first = task_feedback.save(op.id, self.body(), self.owner)["item"]
        # Correct expectedVersion: replacement proceeds normally.
        second = task_feedback.save(
            op.id, self.body(newValue="改一次", expectedVersion=first["version"]),
            self.owner)
        self.assertEqual(second["superseded"], first["id"])

    def test_wrong_expected_version_is_rejected_as_a_conflict(self):
        op = self.settled()
        first = task_feedback.save(op.id, self.body(), self.owner)["item"]
        with self.assertRaises(AiError) as caught:
            task_feedback.save(
                op.id,
                self.body(newValue="改一次", expectedVersion=first["version"] + 1),
                self.owner)
        self.assertEqual(caught.exception.status, 409)
        # The conflicting write must not have landed.
        self.assertEqual(
            m.AiTaskFeedback.objects.filter(operation=op, status="confirmed").count(), 1)

    def test_omitting_expected_version_against_a_live_row_is_rejected_as_400(self):
        # The silent-overwrite path is closed, not preserved: this endpoint
        # has no reachable caller yet (pi/operations is not in Worker's
        # PI_PUBLIC_PATH whitelist), so there is no existing caller that
        # omitting expectedVersion here could break. Overwriting a live
        # correction now requires proving the caller saw it.
        op = self.settled()
        task_feedback.save(op.id, self.body(), self.owner)
        with self.assertRaises(AiError) as caught:
            task_feedback.save(op.id, self.body(newValue="改一次"), self.owner)
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(
            m.AiTaskFeedback.objects.filter(operation=op, status="confirmed").count(), 1)

    def test_expected_version_against_a_target_with_no_live_row_is_a_conflict(self):
        # expectedVersion only means something relative to a live row. With no
        # live correction for this target, the caller's belief that one
        # exists at that version is wrong -- this must not be silently
        # ignored and treated as a fresh, unconditional create.
        op = self.settled()
        with self.assertRaises(AiError) as caught:
            task_feedback.save(op.id, self.body(expectedVersion=999), self.owner)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(m.AiTaskFeedback.objects.count(), 0)
