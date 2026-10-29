"""Permission for closing one exact old execution; never a retry permission."""
import re
import uuid
from django.utils import timezone
from .models import WorkflowWriteRequestReceipt
from .errors import WorkflowApiError

VERSION = "jackyun-operator-close-authority-v1"
PATH = "/api/workflow/jackyun-close-authority"


def validate(payload):
    if not isinstance(payload, dict) or set(payload) not in ({"action", "target"}, {"action", "target", "closeRequestId"}) or payload["action"] != "close":
        raise WorkflowApiError("闭合授权必须明确绑定当前旧任务")
    target = payload["target"]
    ids = {"logicalExecutionId", "failedExecutionId", "sourceExecutionId"}
    hashes = {"planDigest", "controlDigest", "activeDigest", "evidenceDigest"}
    if not isinstance(target, dict) or set(target) != ids | hashes:
        raise WorkflowApiError("闭合目标字段无效")
    if any(not isinstance(target[k], str) or not re.fullmatch(r"[1-9]\d{0,19}", target[k]) for k in ids):
        raise WorkflowApiError("闭合任务编号无效")
    if not int(target["logicalExecutionId"]) <= int(target["sourceExecutionId"]) <= int(target["failedExecutionId"]):
        raise WorkflowApiError("闭合任务归属无效")
    if any(not isinstance(target[k], str) or not re.fullmatch(r"[a-f0-9]{64}", target[k]) for k in hashes):
        raise WorkflowApiError("闭合目标摘要无效")
    if "closeRequestId" in payload:
        identity(payload["closeRequestId"])
    return payload


def identity(request_id):
    try:
        if str(uuid.UUID(request_id)) != request_id:
            raise ValueError()
    except (ValueError, AttributeError) as error:
        raise WorkflowApiError("闭合请求需要唯一 UUID") from error


def authorize(payload, request_id):
    identity(request_id)
    validate(payload)
    receipt = WorkflowWriteRequestReceipt.objects.get(request_id=request_id)
    return {"ok": True, "version": VERSION, "authorizationId": request_id, "workflowId": "J8kY2mQ5vR7sT4pN",
            **payload, "createdAt": receipt.created_at.isoformat(), "expiresAt": receipt.expires_at.isoformat()}


def read_authority(request_id):
    identity(request_id)
    receipt = WorkflowWriteRequestReceipt.objects.filter(request_id=request_id, path=PATH, method="POST", status="completed", response_status=200).first()
    if receipt is None or receipt.expires_at <= timezone.now():
        raise WorkflowApiError("闭合授权不存在或已过期", status=404)
    value = receipt.response_payload
    if not isinstance(value, dict) or value.get("version") != VERSION or value.get("authorizationId") != request_id:
        raise WorkflowApiError("闭合授权回执不完整", status=409)
    validate({key: value[key] for key in ("action", "target", "closeRequestId") if key in value})
    return value
