from django.conf import settings
from django.views.decorators.http import require_http_methods

from . import tmall_warehouse as service
from .errors import InventoryApiError
from .views import _body, _error, _json, _one, _positive, _principal, _replay_write, _unknown


@require_http_methods(["GET", "POST"])
def endpoint(request):
    try:
        if request.method == "GET":
            if settings.DJANGO_PROCESS_ROLE not in {"inventory_reader", "development"}:
                raise InventoryApiError("当前进程不是库存读取服务", code="inventory_reader_process_required", status=503)
            _principal(request, {"viewer", "analyst", "operator", "admin"})
            _unknown(request, {"operation", "owner", "warehouse", "q", "page", "pageSize", "batchId"}, "天猫入仓监控")
            operation = _one(request, "operation") or "monitor"
            filters = {}
            for key in ("owner", "warehouse", "q", "batchId"):
                value = _one(request, key)
                if value is not None:
                    filters[key] = service.text(value, key, 200 if key == "warehouse" else 160, required=False)
            filters["page"] = _positive(_one(request, "page"), 1, "page", 10000)
            filters["pageSize"] = _positive(_one(request, "pageSize"), 50, "pageSize", 100)
            for _attempt in range(2):
                before = service.revision_value()
                result = service.read(operation, filters)
                if service.revision_value() == before:
                    return _json({"success": True, "data": result}, revision=before)
            raise InventoryApiError("库存数据版本持续变化，请稍后重试", code="service_unavailable", status=503)
        principal = _principal(request, {"admin"})
        _unknown(request, set(), "天猫库存导入")
        if len(request.body) > 24 * 1024 * 1024:
            raise InventoryApiError("导入请求过大", code="payload_too_large", status=413)
        try:
            payload = _body(request)
        except InventoryApiError as error:
            service.record_rejection({}, principal.email, error.code)
            raise
        return _replay_write(request, principal, lambda: ({"success": True, "data": service.import_payload(payload, principal.email)}, 200))
    except Exception as error:
        return _error(error, "天猫入仓监控处理失败")
