"""Durable receipts for manual code learning; no provider calls or task queue."""
from __future__ import annotations

import hashlib
import logging
import re

from django.db import transaction

from sales.auth import Principal
from .errors import WorkflowApiError
from .followup import learn_product_line_codes
from .models import WorkflowWriteRequestReceipt
from .write_requests import (
    MANUAL_LEARNING_PATH, MANUAL_LEARNING_PREFIX,
    claim_write_request, complete_write_request,
)

logger = logging.getLogger(__name__)
OPERATION_ID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


def learning_request_id(operation_id: object) -> str:
    if not isinstance(operation_id, str) or not OPERATION_ID_RE.fullmatch(operation_id):
        raise WorkflowApiError("新品学习操作编号无效")
    return MANUAL_LEARNING_PREFIX + operation_id


def execute_learning_operation(operation_id: object, principal: Principal, *, body_sha256: str) -> dict[str, object]:
    request_id = learning_request_id(operation_id)
    # Hold the existing per-request advisory lock until BOTH the mutation and
    # receipt commit. A second request cannot overtake an old execution.
    with transaction.atomic():
        claim = claim_write_request(
            request_id=request_id, actor_email=principal.email.strip().lower(),
            method="POST", path=MANUAL_LEARNING_PATH, body_sha256=body_sha256,
            query_sha256=hashlib.sha256(b"").hexdigest(), durable_learning=True,
        )
        if claim.replay_payload is not None:
            return claim.replay_payload
        try:
            # A known failure is terminal only after its business savepoint
            # has rolled back. Committed results cannot be overwritten by a
            # later response/connection failure.
            with transaction.atomic():
                result = learn_product_line_codes(principal)
            payload = {"operationId": operation_id, "status": "completed", "result": result}
        except WorkflowApiError as error:
            payload = {"operationId": operation_id, "status": "failed", "error": str(error)}
        except Exception:
            logger.exception("Manual product learning transaction rolled back")
            payload = {"operationId": operation_id, "status": "failed", "error": "本次代码学习未完成，请检查服务后重新发起学习。"}
        complete_write_request(claim, response_status=200, response_payload=payload)
        return payload


def learning_operation_status(operation_id: object, principal: Principal) -> dict[str, object]:
    request_id = learning_request_id(operation_id)
    receipt = WorkflowWriteRequestReceipt.objects.filter(
        request_id=request_id, actor_email=principal.email.strip().lower(),
        method="POST", path=MANUAL_LEARNING_PATH,
    ).first()
    if receipt is None:
        # Absence can also mean the original transaction has not committed.
        # This is an observation, never proof that a new operation is safe.
        return {"operationId": operation_id, "status": "unconfirmed"}
    if receipt.status == "completed" and receipt.response_payload.get("operationId") == operation_id:
        return receipt.response_payload
    return {"operationId": operation_id, "status": "unconfirmed"}
