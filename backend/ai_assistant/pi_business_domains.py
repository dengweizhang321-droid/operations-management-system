"""Trusted business adapters for Pi; models cannot select endpoints or writers.

The AI role owns confirmations and delivery receipts only. Workflow and inventory
mutations travel through fixed signed loopback owning writers, never ORM writes
to another authority. Unknown outcomes are observed by the original identity.
"""
import json

from django.db import connection

from . import transport
from .policy import AiError, current_principal


KIND_MAP = {"create_work_plan": "work_plan.create", "save_replenishment_draft": "replenishment_draft.create",
    "execute_registered_gap": "n8n_gap.run", "deliver_report": "report.deliver"}
OWNERS = {"work_plan.create": (8062, "/api/workflow/pi-business"),
    "replenishment_draft.create": (8052, "/api/inventory/pi-business")}


def _kind(kind):
    value = KIND_MAP.get(kind, kind)
    if value not in {*OWNERS, "n8n_gap.run", "report.deliver"}:
        raise AiError("未登记的业务动作", "access_denied", 403)
    return value


def _principal(principal, kind):
    current_principal(principal, write=True)
    if principal.role not in {"operator", "admin"}:
        raise AiError("业务动作仅允许操作员或管理员", "access_denied", 403)
    # The existing workflow/inventory writers require unrestricted principals.
    # A single-shop Pi environment does not imply inventory ownership.
    if kind in OWNERS and principal.scope is not None:
        raise AiError("该业务写入器只支持无范围限制的操作账号", "access_denied", 403)


def _owning(kind, payload, principal, *, action=None):
    if connection.in_atomic_block:
        raise AiError("跨领域调用不能持有AI事务", "service_unavailable", 503)
    port, path = OWNERS[kind]
    request_id = "pi-business:" + action.id if action is not None else None
    result = transport.bounded_json("http://127.0.0.1:" + str(port) + path, payload,
        transport.signed_headers(path, payload, principal, request_id), timeout=30, maximum=128 * 1024, internal=True)
    if not isinstance(result, dict):
        raise AiError("业务写入器回执无效", "business_result_unknown", 503)
    return result


def prepare(principal, kind, arguments):
    kind = _kind(kind)
    _principal(principal, kind)
    if kind in OWNERS:
        return _owning(kind, {"phase": "prepare", "kind": kind, "arguments": arguments}, principal)
    if kind == "n8n_gap.run":
        return transport.edge("pi_business_domain", {"phase": "prepare", "kind": kind, "arguments": arguments}, principal)
    from . import pi_business_report
    return pi_business_report.prepare(principal, arguments)


def execute(action, principal):
    from .pi_business import pre_effect_check
    kind = _kind(action.action_type)
    _principal(principal, kind)
    parameters = json.loads(action.parameters_json)
    if kind == "report.deliver":
        from . import pi_business_report
        return pi_business_report.execute(action, principal)
    payload = {"phase": "execute", "kind": kind, "actionId": action.id,
        "parameters": parameters, "targetVersion": action.target_version, "dispatchToken": action.lease_token}
    pre_effect_check(action)
    if kind in OWNERS:
        return _owning(kind, payload, principal, action=action)
    return transport.edge("pi_business_domain", payload, principal)


def observe(action, principal):
    kind = _kind(action.action_type)
    _principal(principal, kind)
    if kind == "report.deliver":
        from . import pi_business_report
        return pi_business_report.observe(action, principal)
    payload = {"phase": "observe", "kind": kind, "actionId": action.id}
    if kind in OWNERS:
        return _owning(kind, payload, principal)
    payload.update(parameters=json.loads(action.parameters_json), targetVersion=action.target_version,
        dispatchToken=action.lease_token)
    return transport.edge("pi_business_domain", payload, principal)


def recipients(principal):
    from . import pi_business_report
    _principal(principal, "report.deliver")
    return pi_business_report.recipients(principal)
