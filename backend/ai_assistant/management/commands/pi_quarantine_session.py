"""Inspect, or irreversibly quarantine, one idle independent Pi session whose
old container shell is not reclaimable (missing native-capabilities image
label, no admission/history proof, or both). Quarantine freezes the session
(same effect on the API as a permission change) and queues the one
control:freeze dispatch that lets the existing worker export loop ask Runner
to dispose the container. Never deletes a database row, never calls Docker
directly, and never touches more than one session per invocation.
"""
import json

from django.core.management.base import BaseCommand, CommandError

from ai_assistant.pi_models import PiSession
from ai_assistant.pi_workspace import pi_quarantine_session, quarantine_observation
from ai_assistant.policy import AiError, identifier
from sales.auth import Principal


class Command(BaseCommand):
    help = "Inspect one idle Pi session, or quarantine its unreclaimable stopped shell."

    def add_arguments(self, parser):
        parser.add_argument("--session", required=True)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--request-id")
        parser.add_argument("--confirm-session")

    def handle(self, *args, **options):
        try:
            session_id = identifier(options["session"], "session")
            session = PiSession.objects.filter(pk=session_id).first()
            if not session:
                raise CommandError("会话不存在")
            principal = Principal(session.owner_email, session.owner_email, session.actor_role, json.loads(session.scope_json))
            if options["apply"]:
                if not options["request_id"] or not options["confirm_session"]:
                    raise CommandError("--apply 要求同时提供 --request-id 和 --confirm-session")
                if options["confirm_session"] != session_id:
                    raise CommandError("--confirm-session 必须与 --session 完全一致")
                result = pi_quarantine_session(session_id, principal, request_id=identifier(options["request_id"], "requestId"))
            else:
                if options["request_id"] or options["confirm_session"]:
                    raise CommandError("观察模式不接受 --request-id 或 --confirm-session")
                result = quarantine_observation(session_id, principal)
        except AiError as error:
            raise CommandError(f"{error.code}: {error}") from None
        self.stdout.write(json.dumps(result, ensure_ascii=False))
