"""Bounded read-only workflow projections for cross-domain consumers."""

from __future__ import annotations

from sales.auth import Principal

from .errors import WorkflowApiError
from .new_products import search_projects


OPERATIONS = frozenset({"launch_project_search"})


def _integer(value: object, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise WorkflowApiError(f"{label} 超出允许范围")
    return value


def validate_consumer_request(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict) or set(payload) != {"operation", "query", "offset", "limit"}:
        raise WorkflowApiError("运营事务消费查询字段不完整或包含未知字段")
    operation = payload.get("operation")
    if operation not in OPERATIONS:
        raise WorkflowApiError("operation 不在固定运营事务消费查询清单中")
    query = payload.get("query")
    if not isinstance(query, str):
        raise WorkflowApiError("query 必须是字符串")
    query = query.strip()
    if not 2 <= len(query) <= 80:
        raise WorkflowApiError("query 长度必须在 2 到 80 个字符之间")
    return {
        "operation": operation,
        "query": query,
        "offset": _integer(payload.get("offset"), "offset", 0, 80_000),
        "limit": _integer(payload.get("limit"), "limit", 1, 100),
    }


def execute_consumer_query(principal: Principal, request: dict[str, object]) -> dict[str, object]:
    if principal.role not in {"viewer", "analyst", "operator", "admin"} or principal.scope is not None:
        raise WorkflowApiError("当前账号无权检索新品项目", code="access_denied", status=403)
    return search_projects(
        str(request["query"]),
        offset=int(request["offset"]),
        limit=int(request["limit"]),
    )
