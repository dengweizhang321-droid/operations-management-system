"""Explicit user corrections against a finished task's report.

A correction records what the user actually changed, not the model's own
rewording: `source` separates the two, and the database refuses to mark a
model proposal as confirmed. Superseding keeps the old row, so the trail of
what was believed when stays readable.

Writes land in the AI write authority's own fence and are recorded as PiEvents
on the operation they correct, which is already the per-session audit stream
for that task. No separate audit table.
"""
import json

from django.db import transaction
from django.utils import timezone

from . import models as m
from . import pi_service as service
from .feedback_models import APPLIES_TO, SOURCES, TARGET_KINDS
from .pi_models import PiOperation
from .policy import (AiError, canonical, cas, digest, fields, identifier,
                     mutation, passive, text, text_bytes, uid)

MAX_VALUE_BYTES = 16384
MAX_TARGET_REF = 400
#: Widening a correction past the report it came from is a deliberate act, and
#: an unscoped admin is the only principal that can speak for every shop.
CROSS_SHOP_SCOPES = ("all_shops",)


def _settled(operation):
    if operation.status not in {"succeeded", "failed", "canceled", "unknown", "frozen"}:
        raise AiError("任务尚未结束，无法记录修正", "conflict", 409)


def _value(raw, field):
    # Values are passive data: bounded, canonical, never interpreted as
    # instructions and never stored as a free-form blob of unknown size.
    encoded = canonical(passive(raw, MAX_VALUE_BYTES))
    if len(encoded.encode("utf-8")) > MAX_VALUE_BYTES:
        raise AiError(f"{field} 超过长度上限")
    return encoded


def _owned(operation_id, principal, *, lock=False):
    row = PiOperation.objects.filter(id=identifier(operation_id)).first()
    if row is None or row.session.owner_email.lower() != principal.email.lower():
        raise AiError("任务不存在或不属于当前账号", "not_found", 404)
    if lock:
        return PiOperation.objects.select_for_update().get(id=row.id)
    return row


def record(row):
    return {
        "id": row.id,
        "operationId": row.operation_id,
        "generation": row.generation,
        "targetKind": row.target_kind,
        "targetRef": row.target_ref,
        "oldValue": json.loads(row.old_value_json),
        "newValue": json.loads(row.new_value_json),
        "appliesTo": row.applies_to,
        "source": row.source,
        "confirmedBy": row.confirmed_by,
        "confirmedAt": row.confirmed_at.isoformat(),
        "status": row.status,
        "version": row.version,
    }


def _event(session, operation, feedback, event_type, principal):
    # Appended to the operation's own event stream, which already orders stages
    # by (session, event_seq). Values are summarised by digest rather than
    # repeated here: the row holds them, the stream only proves what happened.
    #
    # This must go through pi_service.event() rather than creating a PiEvent
    # row directly: that function is the sole owner of session.event_seq, the
    # counter every other writer (~25 call sites) relies on to allocate the
    # next event_seq. A bespoke max(PiEvent.event_seq)+1 here would advance the
    # table past what session.event_seq knows about without moving the counter
    # itself, so the next real event() call recomputes an already-taken
    # event_seq and the (session, event_seq) unique constraint rejects it -
    # permanently, since the stale counter can never catch up on its own.
    service.event(session, event_type, {
        "feedbackId": feedback.id,
        "targetKind": feedback.target_kind,
        "appliesTo": feedback.applies_to,
        "source": feedback.source,
        "status": feedback.status,
        "valueDigest": digest({"old": feedback.old_value_json,
                               "new": feedback.new_value_json}),
        "actor": principal.email.lower(),
        "actorRole": principal.role,
    }, operation)


def listing(operation_id, principal):
    operation = _owned(operation_id, principal)
    rows = (m.AiTaskFeedback.objects
            .filter(operation=operation)
            .order_by("-confirmed_at", "id"))
    items = [record(row) for row in rows[:200]]
    return {"items": items, "returned": len(items), "total": rows.count(),
            "operationId": operation.id, "generation": operation.generation}


def save(operation_id, body, principal):
    fields(body, {"targetKind", "targetRef", "oldValue", "newValue", "appliesTo",
                  "source", "confirmed", "expectedVersion"},
           {"targetKind", "targetRef", "newValue", "confirmed"})
    if body["confirmed"] is not True:
        raise AiError("修正必须由用户明确确认")
    kind = text(body["targetKind"], "targetKind", 40)
    if kind not in TARGET_KINDS:
        raise AiError("修正对象类型无效")
    # MAX_TARGET_REF is a byte count: it mirrors the database's
    # octet_length(target_ref)<=400 CHECK (migration 0088). text() counts
    # characters, so Chinese input that text() would pass can still overflow
    # the CHECK and surface as a 500 instead of a 400.
    ref = text_bytes(body["targetRef"], "targetRef", MAX_TARGET_REF)
    applies_to = text(body.get("appliesTo", "this_report"), "appliesTo", 20)
    if applies_to not in APPLIES_TO:
        raise AiError("适用范围无效")
    source = text(body.get("source", "user"), "source", 20)
    if source not in SOURCES:
        raise AiError("修正来源无效")
    if source != "user":
        # Only the user's own confirmation is a correction. A model proposal has
        # to be reviewed and re-submitted as one; the database refuses it too.
        raise AiError("模型建议不能作为已确认修正写入", "forbidden", 403)
    if applies_to in CROSS_SHOP_SCOPES and principal.scope is not None:
        raise AiError("跨店适用范围仅限无数据范围限制的管理员", "forbidden", 403)

    with mutation(principal):
        with transaction.atomic():
            operation = _owned(operation_id, principal, lock=True)
            _settled(operation)
            # event() requires the caller to hold the session lock (it mutates
            # session.event_seq under it); the operation lock above does not
            # cover that.
            session = service.get_session(operation.session_id, principal, lock=True)
            live = (m.AiTaskFeedback.objects.select_for_update()
                    .filter(operation=operation, target_kind=kind, target_ref=ref,
                            status="confirmed").first())
            if live is not None:
                # Replacing a correction keeps the old row: what was believed
                # when stays readable, and expectedVersion proves the caller
                # saw the value being replaced. Required (not defaulted to
                # live.version) once there is a live row to replace: this
                # endpoint has no reachable caller yet (Worker's
                # PI_PUBLIC_PATH whitelist does not cover pi/operations), so
                # closing the silent-overwrite gap now costs nothing -- no
                # existing caller can be broken by it.
                if "expectedVersion" not in body:
                    raise AiError("覆盖已有修正需要提供 expectedVersion", "invalid_request", 400)
                cas(live, body["expectedVersion"])
                live.status, live.version = "superseded", live.version + 1
                live.updated_at = timezone.now()
                live.save(update_fields=["status", "version", "updated_at"])
                _event(session, operation, live, "task_feedback_superseded", principal)
            elif "expectedVersion" in body:
                # expectedVersion only means something against the live row it
                # names. With no live row for this target, the caller believed
                # one existed at that version; that belief is wrong, so this is
                # the same conflict cas() would have raised had there been a
                # row to compare against -- not something to silently ignore.
                raise AiError("该目标当前没有生效修正，expectedVersion 无意义", "conflict", 409)
            row = m.AiTaskFeedback.objects.create(
                id=uid("ai-feedback"), operation=operation,
                generation=operation.generation,
                owner_email=principal.email.lower(),
                target_kind=kind, target_ref=ref,
                old_value_json=(_value(body["oldValue"], "oldValue")
                                if "oldValue" in body
                                else (live.new_value_json if live else "null")),
                new_value_json=_value(body["newValue"], "newValue"),
                applies_to=applies_to, source=source,
                confirmed_by=principal.email.lower(),
            )
            _event(session, operation, row, "task_feedback_confirmed", principal)
    return {"item": record(row), "superseded": live.id if live else None}


def withdraw(operation_id, feedback_id, body, principal):
    fields(body, {"expectedVersion"}, {"expectedVersion"})
    with mutation(principal):
        with transaction.atomic():
            operation = _owned(operation_id, principal, lock=True)
            session = service.get_session(operation.session_id, principal, lock=True)
            row = (m.AiTaskFeedback.objects.select_for_update()
                   .filter(id=identifier(feedback_id), operation=operation).first())
            if row is None:
                raise AiError("修正不存在", "not_found", 404)
            if row.status != "confirmed":
                raise AiError("该修正已不是生效版本", "conflict", 409)
            cas(row, body["expectedVersion"])
            # Withdrawing states that the correction should not have applied. It
            # does not restore the old value: whatever the report already said
            # under it stands as the record of that run.
            row.status, row.version = "withdrawn", row.version + 1
            row.updated_at = timezone.now()
            row.save(update_fields=["status", "version", "updated_at"])
            _event(session, operation, row, "task_feedback_withdrawn", principal)
    return {"item": record(row)}
