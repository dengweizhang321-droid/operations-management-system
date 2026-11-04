"""Read-only HTTP views over the automation run projection (B3).

Thin adapters only: parse/validate query params, call
``automation_run_query``, return JSON. No action endpoint lives here (P2
scope); gate② predicates are read, never re-implemented — see
automation_run_query.py's module docstring.
"""

from __future__ import annotations

from uuid import UUID

from django.views.decorators.http import require_http_methods

from .automation_run_query import (
    exception_summary,
    list_attempts,
    list_logical_runs,
    list_module_results,
    parse_run_list_options,
)
from .errors import WorkflowApiError
from .revisions import revision_value
from .views import _error, _json, _one, _positive, _principal, _unknown

READ_ROLES = {"viewer", "analyst", "operator", "admin"}

_RUN_LIST_PARAMS = {
    "subjectKey", "chainKey", "planDateFrom", "planDateTo",
    "executionState", "businessState", "deliveryState",
    "exceptionCategory", "page", "pageSize",
}
_SUB_LIST_PARAMS = {"page", "pageSize"}


def _uuid(value: UUID | str | None, label: str) -> str:
    if not value:
        raise WorkflowApiError(f"缺少 {label}")
    try:
        return str(UUID(str(value)))
    except ValueError as error:
        raise WorkflowApiError(f"{label} 格式无效") from error


@require_http_methods(["GET"])
def logical_runs(request):
    try:
        _principal(request, READ_ROLES, unrestricted=True)
        _unknown(request, _RUN_LIST_PARAMS, "自动化运行列表")
        page = _positive(_one(request, "page"), 1, "page", 10_000)
        page_size = _positive(_one(request, "pageSize"), 50, "pageSize", 200)
        options = parse_run_list_options(
            {
                "subjectKey": _one(request, "subjectKey"),
                "chainKey": _one(request, "chainKey"),
                "planDateFrom": _one(request, "planDateFrom"),
                "planDateTo": _one(request, "planDateTo"),
                "executionState": _one(request, "executionState"),
                "businessState": _one(request, "businessState"),
                "deliveryState": _one(request, "deliveryState"),
                "exceptionCategory": _one(request, "exceptionCategory"),
            },
            page=page,
            page_size=page_size,
        )
        payload = list_logical_runs(options)
        return _json(payload, revision=revision_value())
    except Exception as error:
        return _error(error, "读取自动化运行列表失败。")


@require_http_methods(["GET"])
def logical_run_attempts(request, logical_run_id: str):
    try:
        _principal(request, READ_ROLES, unrestricted=True)
        _unknown(request, _SUB_LIST_PARAMS, "自动化执行尝试列表")
        run_id = _uuid(logical_run_id, "logicalRunId")
        page = _positive(_one(request, "page"), 1, "page", 10_000)
        page_size = _positive(_one(request, "pageSize"), 50, "pageSize", 200)
        payload = list_attempts(run_id, page=page, page_size=page_size)
        return _json(payload, revision=revision_value())
    except Exception as error:
        return _error(error, "读取自动化执行尝试列表失败。")


@require_http_methods(["GET"])
def logical_run_module_results(request, logical_run_id: str):
    try:
        _principal(request, READ_ROLES, unrestricted=True)
        _unknown(request, _SUB_LIST_PARAMS, "自动化模块结果列表")
        run_id = _uuid(logical_run_id, "logicalRunId")
        page = _positive(_one(request, "page"), 1, "page", 10_000)
        page_size = _positive(_one(request, "pageSize"), 50, "pageSize", 200)
        payload = list_module_results(run_id, page=page, page_size=page_size)
        return _json(payload, revision=revision_value())
    except Exception as error:
        return _error(error, "读取自动化模块结果列表失败。")


@require_http_methods(["GET"])
def automation_exception_summary(request):
    try:
        _principal(request, READ_ROLES, unrestricted=True)
        _unknown(request, {"subjectKey", "chainKey", "planDateFrom", "planDateTo"}, "自动化异常汇总")
        options = parse_run_list_options(
            {
                "subjectKey": _one(request, "subjectKey"),
                "chainKey": _one(request, "chainKey"),
                "planDateFrom": _one(request, "planDateFrom"),
                "planDateTo": _one(request, "planDateTo"),
                "executionState": None,
                "businessState": None,
                "deliveryState": None,
                "exceptionCategory": None,
            },
            page=1,
            page_size=1,
        )
        payload = exception_summary(options)
        return _json(payload, revision=revision_value())
    except Exception as error:
        return _error(error, "读取自动化异常汇总失败。")
