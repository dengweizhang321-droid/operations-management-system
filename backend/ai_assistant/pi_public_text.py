"""Persist only public text deltas for a foreground Pi model dispatch."""
from time import monotonic

from . import pi_service
from .pi_models import PiOperation, PiSession
from .policy import AiError, mutation


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

    def flush(self, *, finished=False):
        if not self.pending and not (finished and self.offset):
            return
        text = "".join(self.pending)
        principal = pi_service.principal_for_work(self.operation)
        with mutation(principal):
            op = PiOperation.objects.select_for_update().get(pk=self.operation.pk)
            session = PiSession.objects.select_for_update().get(pk=op.session_id)
            if op.cancel_requested or op.status != "running":
                raise pi_service.PiWorkCanceled()
            if (session.active_operation_id, session.epoch, session.generation) != (op.id, op.epoch, op.generation):
                raise AiError("Pi 公开输出已离开原任务", "access_denied", 403)
            if text:
                pi_service.event(session, "provider_text_delta", {
                    "messageId": self.message_id, "offset": self.offset, "text": text}, op)
            if finished:
                pi_service.event(session, "provider_text_end", {"messageId": self.message_id}, op)
        self.pending.clear()
        self.size = 0
        self.offset += len(text.encode("utf-16-le")) // 2
        self.last_write = monotonic()
