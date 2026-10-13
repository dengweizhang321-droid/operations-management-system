"""Human permission receipts only; five-table business progress remains in
the original helper plan and domain import audits. Reuses write-request audit."""
import re
import uuid
from django.utils import timezone
from .models import WorkflowWriteRequestReceipt
from .errors import WorkflowApiError

VERSION = "jackyun-human-retry-authority-v1"
PATH = "/api/workflow/jackyun-recovery-authority"


def authorize(payload, request_id):
    try:
        if str(uuid.UUID(request_id)) != request_id:
            raise ValueError()
    except (ValueError, AttributeError) as error:
        raise WorkflowApiError("人工恢复请求必须绑定唯一 UUID") from error
    if not isinstance(payload, dict) or payload.get("kind") not in {"retry", "new"}:
        raise WorkflowApiError("必须明确选择原逻辑运行重试或新采集")
    required = {"kind"} if payload["kind"] == "new" else {"kind", "logicalExecutionId", "failedExecutionId"}
    if set(payload) != required:
        raise WorkflowApiError("人工恢复授权字段集合无效")
    if payload["kind"] == "retry":
        if any(not isinstance(payload[k], str) or not re.fullmatch(r"[1-9]\d{0,19}", payload[k]) for k in required - {"kind"}) or int(payload["failedExecutionId"]) < int(payload["logicalExecutionId"]):
            raise WorkflowApiError("人工恢复必须绑定精确原运行及失败尝试")
    receipt = WorkflowWriteRequestReceipt.objects.get(request_id=request_id)
    return {"ok": True, "version": VERSION, "authorizationId": request_id, "workflowId": "J8kY2mQ5vR7sT4pN",
            **payload, "createdAt": receipt.created_at.isoformat(), "expiresAt": receipt.expires_at.isoformat()}


def read_authority(request_id):
    try:
        if str(uuid.UUID(request_id)) != request_id:
            raise ValueError()
    except (ValueError, AttributeError) as error:
        raise WorkflowApiError("恢复授权 UUID 无效") from error
    receipt = WorkflowWriteRequestReceipt.objects.filter(request_id=request_id, path=PATH, method="POST", status="completed", response_status=200).first()
    if receipt is None or receipt.expires_at <= timezone.now():
        raise WorkflowApiError("人工恢复授权不存在或已过期", status=404)
    value = receipt.response_payload
    if not isinstance(value, dict) or value.get("version") != VERSION or value.get("authorizationId") != request_id:
        raise WorkflowApiError("人工恢复授权回执不完整", status=409)
    return value
