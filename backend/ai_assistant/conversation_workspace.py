"""Owner-only conversation placement, independent of frozen migration records."""

import json
from django.utils import timezone
from . import models as m
from .page_context import module_key, normalize
from .policy import AiError, canonical, fields


def select(query, principal, module):
    module = module_key(module)
    query = query.filter(created_by__iexact=principal.email)
    if module == "ai":
        from django.db.models import Q
        return query.filter(Q(workspace__module_key=module) | Q(workspace__isnull=True))
    return query.filter(workspace__module_key=module)


def check(conv, principal, module):
    if not select(m.AiConversations.objects.filter(id=conv.id), principal, module).exists():
        raise AiError("对话不属于当前用户或板块", "not_found", 404)


def save_context(conv, module, context, *, replace=False):
    context = normalize(context)
    if context and context["module"] != module:
        raise AiError("页面上下文与会话板块不一致")
    item, _ = m.AiConversationWorkspace.objects.get_or_create(
        conversation=conv, defaults={"module_key": module_key(module)},
    )
    if item.module_key != module:
        raise AiError("不能改变既有会话的板块", "conflict", 409)
    if context is not None or replace:
        item.page_context_json = canonical(context)
    item.last_opened_at = timezone.now()
    item.save()
    return item


def public(conv):
    try:
        item = conv.workspace
    except m.AiConversationWorkspace.DoesNotExist:
        return {"workspaceModule": "ai", "pageContext": None}
    return {"workspaceModule": item.module_key, "pageContext": json.loads(item.page_context_json)}


def activate(body, principal):
    from .chat import conversation, conversation_record
    fields(body, {"action", "conversationId", "workspaceModule"}, {"action", "conversationId", "workspaceModule"})
    conv = conversation(body["conversationId"], principal)
    check(conv, principal, body["workspaceModule"])
    save_context(conv, body["workspaceModule"], None)
    return {"item": conversation_record(conv)}
