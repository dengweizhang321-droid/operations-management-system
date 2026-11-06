"""Persist only public text deltas for a foreground Pi model dispatch."""
import json
from time import monotonic

from . import pi_service
from .pi_models import PiEvent, PiOperation, PiSession
from .policy import AiError, digest, mutation


class PublicText:
    def __init__(self, operation, message_id):
        self.operation = operation
        self.message_id = message_id
        self.pending = []
        self.size = 0
        self.offset = 0
        self.last_write = 0.0

    def append(self, delta):
        self.pending.append(delta)
        self.size += len(delta)
        if self.size >= 4096 or monotonic() - self.last_write >= 0.25:
            self.flush()

    def flush(self, *, finished=False, final=""):
        if not self.pending and not (finished and self.offset):
            return
        text = "".join(self.pending)
        try:
            principal = pi_service.principal_for_work(self.operation)
        except pi_service.PiWorkCanceled as error:
            raise AiError("Pi 已停止，已派发的模型请求禁止重发", "pi_canceled_during_dispatch", 503) from error
        with mutation(principal):
            op = PiOperation.objects.select_for_update().get(pk=self.operation.pk)
            session = PiSession.objects.select_for_update().get(pk=op.session_id)
            if op.cancel_requested or op.status != "running":
                raise AiError("Pi 已停止，已派发的模型请求禁止重发", "pi_canceled_during_dispatch", 503)
            if (session.active_operation_id, session.epoch, session.generation) != (op.id, op.epoch, op.generation):
                raise AiError("Pi 公开输出已离开原任务", "access_denied", 403)
            if text:
                pi_service.event(session, "provider_text_delta", {
                    "messageId": self.message_id, "offset": self.offset, "text": text}, op)
            if finished:
                pi_service.event(session, "provider_text_end", {"messageId": self.message_id, "finalDigest": digest(final)}, op)
        self.pending.clear()
        self.size = 0
        self.offset += len(text.encode("utf-16-le")) // 2
        self.last_write = monotonic()


def record_runner_answer(session, operation, text):
    # The Runner emits its final public message only after the gateway call
    # returns. Rounds can overlap in the event feed. Bind equal finals FIFO.
    fingerprint = digest(text)
    marker = '"finalDigest":"' + fingerprint + '"'
    events = PiEvent.objects.filter(operation=operation, data_json__contains=marker)
    used = {json.loads(data)["messageId"] for data in events.filter(event_type="assistant_message")
            .values_list("data_json", flat=True)}
    fields = {"text": text}
    for data in events.filter(event_type="provider_text_end").order_by("event_seq").values_list("data_json", flat=True):
        message_id = json.loads(data)["messageId"]
        if message_id not in used:
            fields.update(messageId=message_id, finalDigest=fingerprint)
            break
    pi_service.event(session, "assistant_message", fields, operation)
