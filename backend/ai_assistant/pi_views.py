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
    if parts == ["pi", "skills"] and request.method == "GET":
        fields(params, set())
        from . import models as m
        return response({"items": service.skills(), "scope": principal.scope, "models": [configuration.model_record(model, available=True)
            for model in m.AiModels.objects.only(*configuration.MODEL_AVAILABLE_COLUMNS).filter(status="enabled", model_type__in=["text", "vision"]).order_by("-is_default_text_model", "id")[:100]]})
    if parts == ["pi", "sessions"]:
        return response(service.listing(params, principal) if request.method == "GET" else service.create_session(payload, principal), 200 if request.method == "GET" else 201)
    if len(parts) >= 3 and parts[:2] == ["pi", "sessions"]:
        if len(parts) == 3 and request.method == "GET":
            fields(params, set())
            return response(service.detail(parts[2], principal))
        if len(parts) == 4:
            name = parts[3]
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
