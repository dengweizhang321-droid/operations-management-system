"""Exact operator authority for failed closure or executed-plan verification.

The local helper independently checks terminal execution, ownership, sources
and plan CAS before committing. Authority is never itself a completed result
and never grants old-source recovery or a business rerun.
"""
import re
import uuid
from django.utils import timezone
from .models import WorkflowWriteRequestReceipt
from .errors import WorkflowApiError

VERSION = "jd-customer-service-operator-reconcile-authority-v2"
PATH = "/api/workflow/jd-customer-service-close-authority"

STORE_KEYS = {
    "jd-yiyong-director",
    "jd-maidehao-operator1",
    "jd-chudian-weizhang",
    "jd-cuizhiwang-dengweizhang",
}

# Mirrors inspectCustomerServiceCloseEvidence() and controlled verification.
# Widening this set is a business-rule decision, not a Django-only change:
# the TypeScript consumer must accept the same code for the same kind first.
FAILURE_CODES_BY_KIND = {
    "pre_export_zero_effect": {
        "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION",
        "CHAT_PAGE_NOT_READY_MANUAL_ACTION",
        "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION",
    },
    "downloaded_pair": {"PAIR_PARSE_REJECTED"},
    "downloaded_list_only": {"CHAT_PAGE_MISMATCH", "CHAT_PAGE_NOT_READY_MANUAL_ACTION"},
    "executed_verify": {""},
}

HEX64 = re.compile(r"[a-f0-9]{64}")
EXECUTION_ID = re.compile(r"[A-Za-z0-9_-]{1,96}")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _period(value):
    if not isinstance(value, dict) or set(value) != {"scheduledDate", "startDate", "endDate"}:
        raise WorkflowApiError("闭合目标业务区间字段无效")
    for key in ("scheduledDate", "startDate", "endDate"):
        if not isinstance(value[key], str) or not ISO_DATE.fullmatch(value[key]):
            raise WorkflowApiError("闭合目标业务区间日期无效")
    return value


def validate(payload):
    if not isinstance(payload, dict) or set(payload) != {"action", "target"} or payload["action"] not in {"close", "verify"}:
        raise WorkflowApiError("闭合授权必须明确绑定当前旧任务")
    target = payload["target"]
    required = {"storeKey", "kind", "originalExecutionId", "originalPlanSha256", "failureCode", "period"}
    if not isinstance(target, dict) or set(target) != required:
        raise WorkflowApiError("闭合目标字段无效")
    if target["storeKey"] not in STORE_KEYS:
        raise WorkflowApiError("闭合目标店铺超出京东客服四店范围")
    if target["kind"] not in FAILURE_CODES_BY_KIND:
        raise WorkflowApiError("闭合恢复种类无效")
    if (payload["action"] == "verify") != (target["kind"] == "executed_verify"):
        raise WorkflowApiError("验证续接与失败闭合授权不可混用")
    if not isinstance(target["originalExecutionId"], str) or not EXECUTION_ID.fullmatch(target["originalExecutionId"]):
        raise WorkflowApiError("闭合原任务编号无效")
    if not isinstance(target["originalPlanSha256"], str) or not HEX64.fullmatch(target["originalPlanSha256"]):
        raise WorkflowApiError("闭合原计划摘要无效")
    if target["failureCode"] not in FAILURE_CODES_BY_KIND[target["kind"]]:
        raise WorkflowApiError("该恢复种类不允许闭合此失败码")
    _period(target["period"])
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
    return {"ok": True, "version": VERSION, "authorizationId": request_id,
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
