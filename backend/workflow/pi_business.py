"""Pi work plans use the original workflow writer and its durable receipt."""
from datetime import date

from django.db import transaction
from django.views.decorators.http import require_POST

from common.pi_business_contract import action_request_id, admit, digest, receipt
from .errors import WorkflowApiError
from .models import WorkflowWriteRequestReceipt
from .operations import PRIORITIES, _normalize_task, create_task
from .operations_views import WRITE_ROLES, _operations_principal
from .revisions import revision_value
from .views import _body, _error, _json, _replay_write
from .write_requests import lock_active_operations_authority


PATH = "/api/workflow/pi-business"
KIND = "work_plan.create"


def prepare(arguments):
    required = {"title", "goal", "workContent", "owner", "shopName", "startDate", "due"}
    allowed = required | {"category", "priority"}
    if not isinstance(arguments, dict) or not required <= set(arguments) or set(arguments) - allowed:
        raise WorkflowApiError("工作计划必须包含目标、事项、负责人、业务对象和日期")
    limits = {"title": 160, "goal": 500, "workContent": 1500, "owner": 120, "shopName": 160, "category": 80}
    values = dict(arguments)
    for name, maximum in limits.items():
        if name not in values:
            continue
        value = values[name]
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
            raise WorkflowApiError(name + " 无效")
        values[name] = value.strip()
    for name in ("startDate", "due"):
        value = values[name]
        try:
            if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
                raise ValueError()
        except (ValueError, TypeError):
            raise WorkflowApiError(name + " 必须为真实 YYYY-MM-DD 日期") from None
    if values.get("priority", "normal") not in PRIORITIES:
        raise WorkflowApiError("工作项紧急程度无效")
    values.setdefault("priority", "normal")
    values.setdefault("category", "工作计划")
    body = {key: value for key, value in values.items() if key != "goal"}
    body["workContent"] = "目标：" + values["goal"] + "\n\n" + values["workContent"]
    _normalize_task(body)  # Reuse calendar, ordering, length and enum contracts.
    return {"parameters": values, "preview": {"objectType": "work_plan", "status": "待开始", **values},
        "targetVersion": digest(["workflow-task-create-v1", body]),
        "scope": {"domain": "workflow", "shopName": values["shopName"], "owner": values["owner"]}}


@require_POST
def endpoint(request):
    try:
        principal = _operations_principal(request, WRITE_ROLES, unrestricted=True)
        body = _body(request)
        if set(body) - {"phase", "kind", "arguments", "parameters", "targetVersion", "actionId", "dispatchToken"} or body.get("kind") != KIND:
            raise WorkflowApiError("工作计划业务请求无效")
        phase = body.get("phase")
        if phase == "prepare":
            if set(body) != {"phase", "kind", "arguments"}:
                raise WorkflowApiError("工作计划预览请求无效")
            lock_active_operations_authority()
            return _json(prepare(body["arguments"]), revision=revision_value())
        request_id = action_request_id(body.get("actionId"), WorkflowApiError)
        if phase == "observe":
            if set(body) != {"phase", "kind", "actionId"}:
                raise WorkflowApiError("工作计划回执查询无效")
            return _json(receipt(request_id, WorkflowWriteRequestReceipt, principal, PATH, WorkflowApiError))
        if phase != "execute" or set(body) != {"phase", "kind", "parameters", "targetVersion", "actionId", "dispatchToken"}:
            raise WorkflowApiError("工作计划执行请求无效")
        if request.headers.get("X-Teruisi-Request-Id") != request_id:
            raise WorkflowApiError("业务操作与写入回执身份不一致", code="access_denied", status=403)
        def create():
            prepared = prepare(body["parameters"])
            if prepared["targetVersion"] != body["targetVersion"]:
                raise WorkflowApiError("工作计划预览已改变，请重新确认", code="version_conflict", status=409)
            values = prepared["parameters"]
            payload = {key: value for key, value in values.items() if key != "goal"}
            payload["workContent"] = "目标：" + values["goal"] + "\n\n" + values["workContent"]
            admit(body["actionId"], body["dispatchToken"], principal, WorkflowApiError)
            item = create_task(payload, principal)
            return {"status": "succeeded", "objectType": "work_plan", "objectId": item["id"],
                "objectUrl": "/?module=workflow&view=plan&objectType=work_plan&objectId=" + item["id"],
                "item": item, "receipt": {"actionId": body["actionId"], "requestId": request_id,
                    "targetVersion": body["targetVersion"], "state": "committed"}}, 201
        return _replay_write(request, principal, create, authority_scope="operations")
    except Exception as error:
        return _error(error, "工作计划业务操作失败")
