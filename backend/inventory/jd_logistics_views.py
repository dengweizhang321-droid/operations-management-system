from django.conf import settings
from django.views.decorators.http import require_http_methods

from . import jd_logistics as service
from .errors import InventoryApiError
from .views import _body, _error, _json, _one, _positive, _principal, _replay_write, _unknown


def _consistent_read(loader):
    # JD source projections do not consume the ERP/sales inventory read cache.
    for _attempt in range(2):
        before = service.revision_value()
        result = loader()
        if service.revision_value() == before:
            return result, before
    raise InventoryApiError("京东物流数据版本持续变化，请稍后重试", code="service_unavailable", status=503)


@require_http_methods(["GET", "POST", "PATCH"])
def endpoint(request):
    try:
        if request.method == "GET":
            if settings.DJANGO_PROCESS_ROLE not in {"inventory_reader", "development"}:
                raise InventoryApiError("当前进程不是库存读取服务", code="inventory_reader_process_required", status=503)
            _unknown(request, {"operation", "departmentId", "businessUnitCode", "warehouseCode", "warehouseKey", "goodsCodeKind", "startDate", "endDate", "q", "page", "pageSize", "sourceKind", "batchId", "layout", "salesWindow", "healthState", "deliveryId"}, "京东物流")
            operation = _one(request, "operation") or "overview"
            _principal(request, {"admin"} if operation == "notifications" else {"viewer", "analyst", "operator", "admin"})
            filters = {}
            for key in ("departmentId", "businessUnitCode", "warehouseCode", "warehouseKey", "goodsCodeKind", "q", "sourceKind", "batchId", "deliveryId"):
                value = _one(request, key)
                if value is not None:
                    filters[key] = service._text(value, key, 256 if key == "warehouseKey" else 160, required=False)
            for key in ("startDate", "endDate"):
                value = _one(request, key)
                if value:
                    filters[key] = service._date(value, key)
            if filters.get("goodsCodeKind") and filters["goodsCodeKind"] not in {"department_product", "jd_sku"}:
                raise InventoryApiError("商品编码类型无效")
            layout = _one(request, "layout") or "warehouse"
            window = _one(request, "salesWindow") or "30"
            if layout not in {"warehouse", "product"} or window not in {"7", "30"}:
                raise InventoryApiError("库存布局或销量窗口无效")
            filters["layout"], filters["salesWindow"] = layout, int(window)
            health_state = _one(request, "healthState")
            if health_state is not None and health_state not in service.HEALTH_FILTER_STATES:
                raise InventoryApiError("库存健康筛选无效")
            filters["healthState"] = health_state if health_state is not None else "all"
            if filters.get("startDate") and filters.get("endDate") and not 0 < (filters["endDate"] - filters["startDate"]).days <= 366:
                raise InventoryApiError("日期范围必须为1到366天，结束日期不包含")
            filters["page"] = _positive(_one(request, "page"), 1, "page", 10000)
            filters["pageSize"] = _positive(_one(request, "pageSize"), 50, "pageSize", 100)
            if operation == "notifications":
                from .jd_logistics_notifications import read_deliveries
                payload, revision = _consistent_read(lambda: read_deliveries(filters.get("deliveryId")))
            else:
                payload, revision = _consistent_read(lambda: service.read(operation, filters))
            return _json({"success": True, "data": payload}, revision=revision)
        _unknown(request, set(), "京东物流写入")
        if len(request.body) > 24 * 1024 * 1024:
            raise InventoryApiError("导入请求过大", code="payload_too_large", status=413)
        payload = _body(request)
        operation = payload.get("operation")
        roles = {"admin"} if request.method == "POST" or operation == "settings" else {"operator", "admin"}
        principal = _principal(request, roles)
        if request.method == "POST" and (not isinstance(operation, str) or operation not in {"import", "notify"}):
            raise InventoryApiError("POST只支持导入或受控通知操作")
        def execute():
            if request.method == "POST" and operation == "notify":
                from .jd_logistics_notifications import notify
                result = notify(payload, principal.email)
            else:
                result = service.import_payload(payload, principal.email) if request.method == "POST" else service.mutate(payload, principal.email)
            return {"success": True, "data": result}, 200
        return _replay_write(request, principal, execute)
    except Exception as error:
        return _error(error, "京东物流处理失败")
