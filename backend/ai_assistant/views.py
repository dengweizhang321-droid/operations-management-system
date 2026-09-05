from __future__ import annotations
import hashlib
import json
import re
from threading import BoundedSemaphore
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from sales.auth import PrincipalEnvelopeError, verify_principal
from . import (
    models as m,
    configuration,
    memory,
    chat,
    workflows,
    space,
    channels,
    sandbox,
    provider,
    transport,
    knowledge,
)
from .control_models import AiWriteReceipt, AiMutationAudit
from .policy import (
    AiError,
    canonical,
    current_principal,
    digest,
    fields,
    identifier,
    mutation,
    revision,
    authority,
    uid,
)


def response(payload, status=200, replayed=False):
    result = JsonResponse(
        payload,
        status=status,
        json_dumps_params={"ensure_ascii": False, "separators": (",", ":")},
    )
    result["Cache-Control"] = "no-store"
    result["X-AI-Revision"] = revision()
    if replayed:
        result["X-Teruisi-Write-Replay"] = "1"
    return result


def body(request):
    if request.content_type != "application/json":
        raise AiError("请求必须使用 application/json", "invalid_request", 415)
    if len(request.body) > 1024 * 1024:
        raise AiError("请求正文超限", "payload_too_large", 413)
    try:
        result = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        raise AiError("请求不是有效 JSON") from e
    if not isinstance(result, dict):
        raise AiError("请求不是 JSON 对象")
    return result


def write(request, principal, handler, *, external=False, audit_only=False):
    request_id = request.headers["X-Teruisi-Request-Id"]
    identity = {
        "actor_email": principal.email.lower(),
        "principal_digest": digest({"role": principal.role, "scope": principal.scope}),
        "method": request.method,
        "path": request.path,
        "query_sha256": hashlib.sha256(
            request.META.get("QUERY_STRING", "").encode()
        ).hexdigest(),
        "body_sha256": request.headers["X-Teruisi-Content-SHA256"].lower(),
    }
    with mutation(principal, audit_only=audit_only):
        existing = AiWriteReceipt.objects.filter(request_id=request_id).first()
        if existing:
            if any(getattr(existing, k) != v for k, v in identity.items()):
                raise AiError("请求标识绑定已变化", "conflict", 409)
            if existing.status != "completed":
                raise AiError(
                    "请求已受理，禁止重复执行不确定操作", "request_pending", 409
                )
            return response(existing.response_payload, existing.response_status, True)
        receipt = AiWriteReceipt.objects.create(request_id=request_id, **identity)
        if not external:
            payload, status = handler()
            return finish(receipt, principal, payload, status)
    payload, status = handler()
    with mutation(principal, audit_only=audit_only):
        receipt = AiWriteReceipt.objects.select_for_update().get(request_id=request_id)
        if receipt.status != "processing":
            raise AiError("请求完成栅栏失效", "conflict", 409)
        return finish(receipt, principal, payload, status)


def finish(receipt, principal, payload, status):
    receipt.status = "completed"
    receipt.response_payload = payload
    receipt.response_status = status
    receipt.completed_at = timezone.now()
    receipt.save()
    AiMutationAudit.objects.create(
        request_id=receipt.request_id,
        actor_email=principal.email.lower(),
        actor_role=principal.role,
        action=receipt.method + " " + receipt.path,
        scope_digest=digest(principal.scope),
        response_digest=digest(payload),
        revision=int(revision()) + 1,
    )
    return response(payload, status)


def _dispatch(request, path=""):
    try:
        principal = verify_principal(request)
        endpoint = path.strip("/")
        routes = {
            r"models|channels|space/(?:profiles|templates)": {"GET", "POST", "DELETE"},
            r"conversations": {"GET", "PATCH", "DELETE"},
            r"chat|memories|sandbox|agent-jobs|workflow-runs|space/jobs": {
                "GET",
                "POST",
            },
            r"memories/[A-Za-z0-9_-]{1,160}": {"GET", "PATCH", "DELETE"},
            r"(?:agent-jobs|workflow-runs|space/jobs)/[A-Za-z0-9_-]{1,160}": {"GET"},
            r"(?:agent-jobs|workflow-runs)/[A-Za-z0-9_-]{1,160}/(?:cancel|resume)|space/jobs/[A-Za-z0-9_-]{1,160}/cancel|chat/cancel": {
                "POST"
            },
            r"workflow-runs/[A-Za-z0-9_-]{1,160}/nodes/[A-Za-z0-9_-]{1,160}/review": {
                "POST"
            },
            r"artifacts/[A-Za-z0-9_-]{1,160}|space/(?:meta|assets)|space/assets/[A-Za-z0-9_-]{1,160}/content": {
                "GET"
            },
            r"space/assets/[A-Za-z0-9_-]{1,160}": {"PATCH"},
            r"consumer|scheduler|callback/[A-Za-z0-9_-]{1,160}": {"POST"},
        }
        methods = next(
            (
                methods
                for pattern, methods in routes.items()
                if re.fullmatch(pattern, endpoint)
            ),
            None,
        )
        if not methods:
            raise AiError("AI 接口不存在", "not_found", 404)
        if request.method not in methods:
            raise AiError("AI 接口不支持当前方法", "invalid_request", 405)
        parts = path.strip("/").split("/")
        root = parts[0]
        payload = (
            body(request)
            if request.method not in {"GET", "DELETE"} or request.body
            else {}
        )
        consumer_read = root == "consumer" and payload.get("operation") in {
            "model-runtime",
            "model-list",
            "knowledge",
            "memory-recall",
            "analysis-describe",
        }
        writer = (
            request.method != "GET" or root in {"artifacts"}
        ) and not consumer_read
        role = settings.DJANGO_PROCESS_ROLE
        if role not in {"development", "ai_writer" if writer else "ai_reader"}:
            raise AiError("接口不属于当前读写进程", "access_denied", 403)
        authority()
        if any(len(request.GET.getlist(k)) != 1 for k in request.GET):
            raise AiError("查询参数不能重复")
        params = request.GET.dict()
        if root not in {"callback", "scheduler"}:
            principal = current_principal(
                principal, write=writer and root not in {"consumer", "artifacts"}
            )
        if root in {"models", "channels"} or parts[:2] in [
            ["space", "profiles"],
            ["space", "templates"],
        ]:
            current_principal(principal, admin=True)
        request_id = request.headers["X-Teruisi-Request-Id"]
        if root == "chat" and len(parts) == 1 and request.method == "POST":
            return response(chat.answer(payload, principal, request_id))
        if (
            root in {"agent-jobs", "workflow-runs"}
            and len(parts) == 1
            and request.method == "POST"
        ):
            result = workflows.create(payload, principal, root == "workflow-runs")
            return response(result, 200 if result["replayed"] else 201)
        if parts == ["space", "jobs"] and request.method == "POST":
            result = space.create(payload, principal)
            return response(result, 200 if result["replayed"] else 201)
        if root == "sandbox" and request.method == "POST":
            return response(sandbox.run(payload, principal, request_id), 201)
        if root == "scheduler":
            if (
                principal.email != "ai-scheduler@teruisi.internal"
                or principal.role != "operator"
                or principal.scope is not None
            ):
                raise AiError("调度身份无效", "access_denied", 403)
            fields(payload, {"queue"}, {"queue"})
            runner = {
                "agent": workflows.agent_tick,
                "workflow": workflows.workflow_tick,
                "space": space.tick,
            }.get(payload["queue"])
            if not runner:
                raise AiError("队列无效")
            return response(runner())
        if root == "callback":
            if (
                principal.email != "ai-callback@teruisi.internal"
                or principal.role != "viewer"
                or principal.scope is not None
            ):
                raise AiError("回调传输身份无效", "access_denied", 403)
            with mutation():
                return response(channels.callback(parts[1], payload))
        if consumer_read:
            return response(consumer(payload, principal, request_id))
        if not writer:
            return response(read(parts, params, principal))
        external = (
            root == "channels"
            and payload.get("action") in {"send", "test"}
            or root == "models"
            and payload.get("action") == "test"
            or root == "consumer"
        )
        return write(
            request,
            principal,
            lambda: mutate(
                parts, params, payload, principal, request_id, request.method
            ),
            external=external,
            audit_only=root in {"artifacts", "consumer"},
        )
    except (AiError, PrincipalEnvelopeError) as error:
        return JsonResponse(
            {"error": str(error), "code": error.code},
            status=error.status,
            headers={"Cache-Control": "no-store"},
        )
    except (ValueError, TypeError, KeyError):
        return JsonResponse(
            {"error": "AI 请求格式无效", "code": "invalid_request"},
            status=400,
            headers={"Cache-Control": "no-store"},
        )
    except Exception:
        return JsonResponse(
            {"error": "AI 服务暂时不可用", "code": "service_unavailable"},
            status=503,
            headers={"Cache-Control": "no-store"},
        )


def read(parts, params, principal):
    root = parts[0]
    if root == "models":
        return {
            "items": [
                configuration.model_record(r)
                for r in m.AiModels.objects.order_by(
                    "-is_default_text_model", "-updated_at"
                )[:100]
            ],
            "principal": {
                "email": principal.email,
                "displayName": principal.display_name,
                "role": principal.role,
                "scope": principal.scope,
            },
        }
    if root == "channels":
        return {
            "items": [
                channels.mapping(r)
                for r in m.AiChannels.objects.order_by("-updated_at")[:100]
            ]
        }
    if root == "conversations":
        return chat.listing(params, principal)
    if root == "chat":
        return chat.messages(params, principal)
    if root == "memories":
        return (
            memory.listing(params, principal)
            if len(parts) == 1
            else {"item": memory.mapping(memory.get(parts[1], principal))}
        )
    if root == "sandbox":
        return sandbox.history(params, principal)
    if root in {"agent-jobs", "workflow-runs"}:
        return (
            workflows.listing(params, principal, root == "workflow-runs")
            if len(parts) == 1
            else {
                "item": workflows.mapping(
                    workflows.get(parts[1], principal, root == "workflow-runs")
                )
            }
        )
    if root == "space":
        section = parts[1]
        if section == "meta":
            return space.meta(principal)
        if section == "profiles":
            return {
                "items": [
                    configuration.profile_record(r)
                    for r in m.AiSpaceModelProfiles.objects.order_by("-updated_at")[
                        :100
                    ]
                ]
            }
        if section == "templates":
            return {
                "items": [
                    space.template_record(r)
                    for r in m.AiSpaceTemplates.objects.order_by(
                        "scene", "-is_default"
                    )[:100]
                ]
            }
        if section == "jobs":
            return (
                space.listing(params, principal)
                if len(parts) == 2
                else {
                    "item": space.job_record(
                        space.get_job(parts[2], principal), principal
                    )
                }
            )
        if section == "assets":
            if len(parts) == 4 and parts[3] == "content":
                return space.download(parts[2], principal)
            return space.listing(params, principal, assets=True)
    raise AiError("AI 接口不存在", "not_found", 404)


def mutate(parts, params, payload, principal, request_id, method):
    root = parts[0]
    if root == "models":
        if method == "DELETE":
            return configuration.delete_model(params, principal), 200
        if payload.get("action") == "test":
            fields(payload, {"id", "action"}, {"id", "action"})
            model = configuration.resolve_model(payload["id"])
            with mutation(principal):
                chat.dispatch_budget(principal.email.lower(), model.id)
                chat.audit(
                    principal,
                    request_id,
                    "model_probe",
                    "started",
                    arguments={"modelId": model.id},
                )
            message = provider.probe(model)
            with mutation(principal):
                m.AiModels.objects.filter(id=model.id, version=model.version).update(
                    last_test_result=message, last_tested_at=timezone.now()
                )
                chat.audit(
                    principal,
                    request_id,
                    "model_probe",
                    "succeeded",
                    result={"message": message},
                )
            return {"ok": True, "message": message}, 200
        return {"item": configuration.save_model(payload, principal)}, 200
    if root == "channels":
        if method == "DELETE":
            fields(params, {"id"}, {"id"})
            count, _ = m.AiChannels.objects.filter(id=identifier(params["id"])).delete()
            return {"ok": True, "deleted": count > 0}, 200
        if payload.get("action") in {"test", "send"}:
            return channels.send(payload, principal), 200
        return channels.save(payload, principal), 200
    if root == "conversations":
        return (
            chat.delete(params["id"], principal)
            if method == "DELETE"
            else chat.change_model(payload, principal)
        ), 200
    if root == "memories":
        if method == "DELETE":
            return memory.archive(parts[1], payload, principal, request_id), 200
        result = memory.save(
            payload, principal, request_id, parts[1] if len(parts) > 1 else None
        )
        return result, 201 if result.get("created") else 200
    if root == "chat" and parts[1:] == ["cancel"]:
        fields(payload, {"clientRequestId"}, {"clientRequestId"})
        m.AiChatRequestReceipts.objects.filter(
            owner_email=principal.email.lower(),
            client_request_id=identifier(payload["clientRequestId"]),
            status__in=["processing", "dispatched"],
        ).update(cancel_requested=True)
        return {"ok": True}, 200
    if root in {"agent-jobs", "workflow-runs"}:
        if len(parts) == 5 and parts[2] == "nodes" and parts[4] == "review":
            return workflows.review(parts[1], parts[3], payload, principal), 200
        if len(parts) == 3 and parts[2] in {"cancel", "resume"}:
            return workflows.control(
                parts[1], payload, principal, parts[2], root == "workflow-runs"
            ), 200
    if root == "artifacts":
        return chat.csv_download(parts[1], principal, request_id), 200
    if root == "space":
        section = parts[1]
        if section == "profiles":
            return (
                configuration.delete_model(params, principal, image=True)
                if method == "DELETE"
                else {"item": configuration.save_model(payload, principal, image=True)}
            ), 200
        if section == "templates":
            if method == "DELETE":
                fields(params, {"id", "expectedVersion"}, {"id", "expectedVersion"})
                row = m.AiSpaceTemplates.objects.get(id=identifier(params["id"]))
                space.cas(row, int(params["expectedVersion"]))
                if m.AiSpaceJobs.objects.filter(template_id=row.id).exists():
                    raise AiError("模板仍被历史任务引用，可停用", "conflict", 409)
                space.admin_audit(
                    principal,
                    "delete_template",
                    "template",
                    row.id,
                    space.template_record(row),
                    None,
                )
                row.delete()
                return {"ok": True, "deleted": True}, 200
            return space.save_template(payload, principal), 200
        if section == "jobs" and len(parts) == 4 and parts[3] == "cancel":
            fields(payload, set())
            return space.cancel(parts[2], principal), 200
        if section == "assets" and len(parts) == 3:
            fields(payload, {"favorite"}, {"favorite"})
            row = space.get_asset(parts[2], principal)
            value = space.boolean(payload["favorite"], "favorite")
            if value:
                m.AiSpaceAssetFavorites.objects.get_or_create(
                    asset_id=row.id, actor_email=principal.email.lower()
                )
            else:
                m.AiSpaceAssetFavorites.objects.filter(
                    asset_id=row.id, actor_email=principal.email.lower()
                ).delete()
            return {"item": space.asset_record(row, principal)}, 200
    if root == "consumer":
        return consumer(payload, principal, request_id), 200
    raise AiError("AI 接口不存在", "not_found", 404)


def consumer(payload, principal, request_id):
    operation = payload.get("operation")
    if operation == "tool-audit":
        fields(payload, {"operation", "entry"}, {"operation", "entry"})
        entry = payload["entry"]
        fields(
            entry,
            {
                "requestId",
                "invocationId",
                "providerCallId",
                "actorEmail",
                "actorRole",
                "surface",
                "toolName",
                "arguments",
                "status",
                "durationMs",
                "result",
                "errorCode",
            },
            {
                "requestId",
                "actorEmail",
                "actorRole",
                "surface",
                "toolName",
                "status",
                "durationMs",
            },
        )
        if (
            entry["actorEmail"].lower() != principal.email.lower()
            or entry["actorRole"] != principal.role
        ):
            raise AiError("审计身份不匹配", "access_denied", 403)
        if entry["status"] not in {"started", "succeeded", "failed"}:
            raise AiError("审计状态无效")
        with mutation():
            chat.audit(
                principal,
                entry["requestId"],
                entry["toolName"],
                entry["status"],
                arguments=entry.get("arguments"),
                result=entry.get("result"),
                invocation_id=entry.get("invocationId", ""),
                provider_call_id=entry.get("providerCallId"),
                error_code=entry.get("errorCode"),
                duration=entry["durationMs"],
                surface=entry["surface"],
            )
        return {"ok": True}
    if operation in {"model-runtime", "model-list"}:
        fields(payload, {"operation", "id", "modelType", "allowFallback"})
        if operation == "model-list":
            query = m.AiModels.objects.filter(status="enabled")
            if payload.get("modelType") == "vision":
                query = query.filter(model_type__in=["vision", "image"])
            elif payload.get("modelType"):
                query = query.filter(model_type=payload["modelType"])
            return {
                "items": [
                    configuration.model_record(r)
                    for r in query.order_by("-is_default_text_model", "-updated_at")[
                        :100
                    ]
                ]
            }
        if payload.get("id"):
            query = m.AiModels.objects.filter(
                id=identifier(payload["id"]), status="enabled"
            )
            if payload.get("modelType") == "vision":
                query = query.filter(model_type__in=["vision", "image"])
            elif payload.get("modelType"):
                query = query.filter(model_type=payload["modelType"])
            model = query.first()
            if not model:
                raise AiError("模型不存在或未启用", "not_found", 404)
        else:
            model = configuration.resolve_model()
        return {
            "model": {
                field.attname: getattr(model, field.attname)
                for field in model._meta.concrete_fields
                if field.attname not in {"created_at", "updated_at", "last_tested_at"}
            }
        }
    if operation == "analysis-reply":
        fields(
            payload,
            {"operation", "modelId", "prompt", "systemPrompt", "surface", "title"},
            {"operation", "prompt", "systemPrompt"},
        )
        model = configuration.resolve_model(payload.get("modelId"))
        prompt = configuration.text(payload["prompt"], "prompt", 48000)
        system = configuration.text(payload["systemPrompt"], "systemPrompt", 16000)
        with mutation(principal):
            chat.dispatch_budget(principal.email.lower(), model.id)
            chat.audit(
                principal,
                request_id,
                "configured_analysis",
                "started",
                arguments={"modelId": model.id, "promptDigest": digest(prompt)},
            )
        result = provider.turn(model, [{"role": "user", "content": prompt}], system, [])
        reply = configuration.text(result["text"], "模型回复", 48000)
        response_payload = {"reply": reply}
        with mutation(principal):
            chat.audit(
                principal,
                request_id,
                "configured_analysis",
                "succeeded",
                result={"replyDigest": digest(reply)},
            )
            if payload.get("title"):
                conv = m.AiConversations.objects.create(
                    id=uid("ai-conversation"),
                    title=configuration.text(payload["title"], "title", 120),
                    model_id=model.id,
                    created_by=principal.email.lower(),
                )
                m.AiConversationScopes.objects.create(
                    conversation_id=conv.id, scope_json=canonical(principal.scope)
                )
                chat.append(conv.id, "user", prompt)
                chat.append(conv.id, "assistant", reply)
                response_payload["conversationId"] = conv.id
        return response_payload
    if operation == "analysis-plan":
        return sandbox.run(payload["input"], principal, request_id)
    if operation == "memory-recall":
        fields(payload, {"operation", "query"}, {"operation", "query"})
        return memory.recall(
            configuration.text(payload["query"], "query", 200), principal
        )
    if operation == "analysis-describe":
        fields(payload, {"operation"}, {"operation"})
        return sandbox.describe()
    if operation == "knowledge":
        fields(payload, {"operation", "query", "limit"})
        return knowledge.search(
            payload.get("query"), principal, payload.get("limit", 4)
        )
    raise AiError("AI consumer 操作不在白名单")


_primary_slots = BoundedSemaphore(2)
_consumer_slots = BoundedSemaphore(2)


def dispatch(request, path=""):
    # Six writer threads: at most two blocking primary requests + two nested
    # consumers. Two threads remain available for tool audits and cancellation.
    gate = None
    if request.method != "GET" and not path.endswith("/cancel"):
        if path == "consumer":
            try:
                operation = body(request).get("operation")
            except AiError:
                operation = None
            if operation in {"analysis-reply", "analysis-plan"}:
                gate = _consumer_slots
        else:
            gate = _primary_slots
    if gate and not gate.acquire(blocking=False):
        return JsonResponse(
            {"error": "AI 执行繁忙，请稍后重试", "code": "rate_limited"},
            status=429,
            headers={"Cache-Control": "no-store"},
        )
    try:
        with transport.request_budget(
            260 if path == "chat" else 195 if path == "scheduler" else 120
        ):
            result = _dispatch(request, path)
        if result.status_code < 400:
            result["X-AI-Revision"] = revision()
        return result
    finally:
        if gate:
            gate.release()
