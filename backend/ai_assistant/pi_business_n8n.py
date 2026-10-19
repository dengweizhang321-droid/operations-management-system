"""Private n8n node admission from exact native evidence and the current actor.

The token is an action-bound dispatch fence, not an account credential. It is
kept between trusted Windows services and never returned to Pi or the browser.
"""
import hmac
import json

from django.conf import settings

from . import pi_business, transport
from .pi_models import PiBusinessAction
from .policy import AiError, authority, canonical, fields, identifier, mutation


def capabilities(principal):
    return transport.edge("pi_business_domain", {"phase": "capabilities", "kind": "n8n_gap.run"}, principal)


def admission(request):
    from .views import response
    if (settings.DJANGO_PROCESS_ROLE not in {"ai_writer", "development"}
            or request.method != "POST" or request.GET
            or request.META.get("REMOTE_ADDR") not in {"127.0.0.1", "::1"}
            or len(request.body) > 2048):
        raise AiError("原生业务节点准入无效", "access_denied", 403)
    authority()
    try:
        payload = json.loads(request.body)
        fields(payload, {"actionId", "dispatchToken", "executionId"}, {"actionId", "dispatchToken", "executionId"})
        action_id = identifier(payload["actionId"])
        token = payload["dispatchToken"]
        from workflow.pi_business_n8n import read_execution_marker
        native = read_execution_marker(payload["executionId"])
    except Exception:
        raise AiError("原生执行证据尚未核实，禁止派发节点", "pi_n8n_evidence_unavailable", 403) from None
    if (not isinstance(token, str) or len(token) > 200
            or native["executionId"] != native["originalExecutionId"]
            or native["status"] not in {"new", "running", "waiting"}):
        raise AiError("原生执行不属于当前动作", "access_denied", 403)
    with mutation():
        action = PiBusinessAction.objects.select_for_update().filter(pk=action_id).first()
        if (not action or action.action_type != "execute_registered_gap" or action.status != "dispatched"
                or not action.lease_token or not hmac.compare_digest(token, action.lease_token)):
            raise AiError("原业务派发已失效", "access_denied", 403)
        parameters = json.loads(action.parameters_json)
        marker = {"actionId": action.id, "dispatchToken": action.lease_token, "targetVersion": action.target_version,
            **{key: parameters.get(key) for key in ("startDate", "endDate", "scheduledAt")}}
        if (native["marker"] != marker or native["storeKey"] != parameters.get("storeKey")
                or native["versionId"] != parameters.get("registeredVersion")):
            raise AiError("原生执行范围或版本已变化", "access_denied", 403)
        # The webhook may reach its first node before its POST acknowledgement.
        # Exact native evidence binds that first execution without dispatching again.
        pi_business._principal(action, effect=True)
        result = json.loads(action.result_json)
        bound = result.get("executionId") or result.get("receipt", {}).get("executionId")
        if bound and str(bound) != native["executionId"]:
            raise AiError("业务动作已绑定另一执行", "access_denied", 403)
        if not bound:
            result.update(status="running", executionId=native["executionId"])
            result.setdefault("receipt", {}).update(executionId=native["executionId"], workflowId=native["workflowId"],
                versionId=native["versionId"], storeKey=native["storeKey"])
            action.result_json = canonical(result)
            action.version += 1
            action.save(update_fields=["result_json", "version"])
            pi_business._audit(action, "native_execution_bound", {"executionId": native["executionId"], "versionId": native["versionId"]})
        pi_business.authorize_n8n(action.id, native["executionId"])
        pi_business._audit(action, "native_node_admitted", {"executionId": native["executionId"], "version": action.version})
    return response({"ok": True, "actionId": action_id, "executionId": native["executionId"]})
