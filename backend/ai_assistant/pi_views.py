"""Pi routes, intentionally served only by the AI writer process."""
import json
import re

from django.conf import settings
from . import configuration, pi_service as service, pi_exports
from .policy import AiError, authority, current_principal, fields


def dispatch(request, path, principal):
    from .views import body, response
    if settings.DJANGO_PROCESS_ROLE not in {"development", "ai_writer"}:
        raise AiError("Pi 接口仅属于 AI writer", "access_denied", 403)
    authority()
    current_principal(principal, write=request.method != "GET")
    if path != path.strip("/") or request.method not in {"GET", "POST"}:
        raise AiError("Pi 接口不存在", "not_found", 404)
    if any(len(request.GET.getlist(k)) != 1 for k in request.GET):
        raise AiError("查询参数不能重复")
    params = request.GET.dict()
    parts = path.split("/")
    payload = body(request) if request.method == "POST" else {}
    if request.method == "POST" and params:
        raise AiError("Pi 写接口不接受查询参数")
    if parts == ["pi", "task-connectors"] and request.method == "GET":
        from . import task_connectors
        fields(params, set())
        return response(task_connectors.listing(principal))
    if parts == ["pi", "legacy-tasks"] and request.method == "GET":
        from . import task_legacy_adapters
        fields(params, set())
        return response(task_legacy_adapters.listing(principal))
    if parts == ["pi", "task-definitions"]:
        from . import task_definitions
        return response(task_definitions.listing(params, principal) if request.method == "GET"
                        else task_definitions.save(payload, principal), 200 if request.method == "GET" else 201)
    if len(parts) in {3, 4} and parts[:2] == ["pi", "task-definitions"]:
        from . import task_definitions
        if request.method == "GET" and (len(parts) == 3 or parts[3] in {"revisions", "runs", "incidents"}):
            return response(task_definitions.detail(parts[2], params, principal, parts[3] if len(parts) == 4 else None))
        if request.method == "POST" and len(parts) == 4 and parts[3] in {"enable", "disable"}:
            return response(task_definitions.control(parts[2], payload, principal, parts[3]))
    if len(parts) == 4 and parts[:2] == ["pi", "task-incidents"] and parts[3] in {"claim", "close"} and request.method == "POST":
        from .task_dispatch import incident_control
        return response(incident_control(parts[2], payload, principal, parts[3]))
    if parts == ["pi", "business-admission"] and request.method == "POST":
        from . import pi_business
        return response(pi_business.admission(payload, principal))
    if parts == ["pi", "skills"] and request.method == "GET":
        fields(params, set())
        from . import models as m
        from .pi_native import thinking_levels_for_model
        model_columns = (*configuration.MODEL_AVAILABLE_COLUMNS, "reasoning_mode", "generation_options_json", "max_tokens")
        return response({"items": service.skills(), "scope": principal.scope, "models": [
            {**configuration.model_record(model, available=True), "supportedThinkingLevels": thinking_levels_for_model(model)}
            for model in m.AiModels.objects.only(*model_columns).filter(status="enabled", model_type__in=["text", "vision"]).order_by("-is_default_text_model", "id")[:100]]})
    if parts == ["pi", "sessions"]:
        return response(service.listing(params, principal) if request.method == "GET" else service.create_session(payload, principal), 200 if request.method == "GET" else 201)
    if len(parts) >= 3 and parts[:2] == ["pi", "sessions"]:
        if len(parts) == 3 and request.method == "GET":
            fields(params, set())
            return response(service.detail(parts[2], principal))
        if len(parts) == 4:
            name = parts[3]
            if name == "business-actions":
                from . import pi_business
                return response(pi_business.listing(parts[2], params, principal) if request.method == "GET"
                    else pi_business.control(parts[2], payload, principal), 200 if request.method == "GET" else 202)
            if name == "workspace":
                from . import pi_workspace
                return response(pi_workspace.detail(parts[2], params, principal) if request.method == "GET"
                    else pi_workspace.control(parts[2], payload, principal), 200 if request.method == "GET" else 202)
            if name == "messages" and request.method == "POST":
                return response(service.prompt(parts[2], payload, principal), 202)
            if name == "abort" and request.method == "POST":
                return response(service.abort(parts[2], payload, principal), 202)
            if name == "events" and request.method == "GET":
                return response(service.events(parts[2], params, principal))
            if name == "files" and request.method == "POST":
                return response(service.upload(parts[2], payload, principal), 201)
    if len(parts) in {3, 4} and parts[:2] == ["pi", "files"] and request.method == "GET" and (len(parts)==3 or parts[3]=="content"):
        fields(params, set())
        return response(service.download(parts[2], principal, content=len(parts)==4))
    if len(parts) >= 4 and parts[:2] == ["pi", "operations"]:
        name = parts[3]
        if name == "evidence" and request.method == "GET" and len(parts) == 4:
            from . import pi_sources
            return response(pi_sources.evidence(parts[2], params, principal))
        if name == "stages" and request.method == "GET" and len(parts) == 4:
            from . import pi_sources
            return response(pi_sources.events_after(parts[2], params, principal))
        if name == "feedback":
            from . import task_feedback
            if request.method == "GET" and len(parts) == 4:
                fields(params, set())
                return response(task_feedback.listing(parts[2], principal))
            if request.method == "POST" and len(parts) == 4:
                return response(task_feedback.save(parts[2], payload, principal), 201)
            # A withdrawal names the correction it retires in the path, not the
            # body, so resubmitting an older body cannot retire a different one.
            if request.method == "POST" and len(parts) == 6 and parts[5] == "withdraw":
                return response(task_feedback.withdraw(parts[2], parts[4], payload, principal))
        # The read half of distillation: what the caller must send, and the
        # evidence it may cite. Served before any paid model call so the user
        # can be shown which run is about to be distilled -- without it a
        # caller cannot assemble the schemaRef/schemaDigest pair that POST
        # below requires. Ownership of parts[2] is enforced inside
        # request_schema() (via pi_sources.evidence -> _owned), the same way
        # the evidence branch above relies on it, so there is no second
        # lookup here to fall out of step with it.
        if name == "skill-candidates" and request.method == "GET" and len(parts) == 4:
            from . import skill_candidates
            fields(params, set())
            return response(skill_candidates.request_schema(parts[2], principal))
        if name == "skill-candidates" and request.method == "POST" and len(parts) == 4:
            from . import pi_gateway, skill_candidates
            from .pi_models import PiOperation
            # registry_tools must reflect this run's own operation (its granted
            # business intents), not a tool-less or unrelated catalog -- a
            # candidate step naming a tool this run never had cannot be
            # validated against some other operation's permissions. Ownership
            # of parts[2] is re-checked inside skill_candidates.save() itself
            # (via request_schema -> pi_sources.evidence); this lookup only
            # needs the row to ask the gateway what this run may call.
            operation = PiOperation.objects.filter(id=parts[2]).first()
            if operation is None or operation.session.owner_email.lower() != principal.email.lower():
                raise AiError("任务不存在或不属于当前账号", "not_found", 404)
            entries, _readonly = pi_gateway.catalog(principal, operation)
            registry_tools = {item["name"] for item in entries if "name" in item}
            return response(skill_candidates.save(parts[2], payload, principal,
                registry_tools=registry_tools), 201)
    if parts == ["pi", "skill-candidates"] and request.method == "GET":
        from . import skill_candidates
        return response(skill_candidates.listing(params, principal))
    if len(parts) == 4 and parts[:2] == ["pi", "skill-candidates"] and request.method == "POST":
        from . import skill_candidates
        if parts[3] == "review":
            return response(skill_candidates.review(parts[2], payload, principal))
        if parts[3] == "publish":
            return response(skill_candidates.publish(parts[2], payload, principal))
    raise AiError("Pi 接口不存在或方法不支持", "not_found", 404)


def gateway(request):
    from .views import response
    from . import pi_transport, pi_gateway
    if settings.DJANGO_PROCESS_ROLE not in {"development", "ai_writer"}:
        raise AiError("Pi 网关仅属于 AI writer", "access_denied", 403)
    authority()
    if request.GET:
        raise AiError("Pi 网关不接受查询参数")
    nonce = pi_transport.verify_gateway(request)
    try:
        payload = json.loads(request.body)
    except (ValueError, TypeError) as error:
        raise AiError("Pi 网关不是有效 JSON") from error
    return response(pi_gateway.execute(payload, nonce))
