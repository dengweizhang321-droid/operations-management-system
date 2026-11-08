"""Inspect or reclaim one stopped Pi shell. Keep its original workspace volume."""
import json

from django.core.management.base import BaseCommand, CommandError

from ai_assistant.pi_models import PiSession
from ai_assistant.pi_workspace import reclaim_stopped
from ai_assistant.policy import AiError, identifier
from sales.auth import Principal


class Command(BaseCommand):
    help = "Inspect one stopped Pi shell, or apply the exact independently approved container/volume binding."

    def add_arguments(self, parser):
        parser.add_argument("--session", required=True)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--request-id")
        parser.add_argument("--container-id")
        parser.add_argument("--image")
        parser.add_argument("--volume")
        parser.add_argument("--last-seq", type=int)

    def handle(self, *args, **options):
        try:
            session_id = identifier(options["session"], "session")
            session = PiSession.objects.filter(pk=session_id).first()
            if not session:
                raise CommandError("会话不存在")
            principal = Principal(session.owner_email, session.owner_email, session.actor_role, json.loads(session.scope_json))
            supplied = [options[k] for k in ("request_id", "container_id", "image", "volume", "last_seq")]
            if options["apply"] and any(v is None for v in supplied) or not options["apply"] and any(v is not None for v in supplied):
                raise CommandError("--apply 要求完整的原请求 ID、容器 ID、镜像、卷和 Runner 序号")
            kwargs = {}
            if options["apply"]:
                kwargs = {"request_id": supplied[0], "expected": dict(zip(("containerId", "image", "volume", "lastSeq"), supplied[1:]))}
            result = reclaim_stopped(session_id, principal, **kwargs)
        except AiError as error:
            raise CommandError(f"{error.code}: {error}") from None
        self.stdout.write(json.dumps(result, ensure_ascii=False))
