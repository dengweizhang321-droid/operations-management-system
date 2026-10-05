from django.views.decorators.http import require_http_methods

from . import erp_targets
from .errors import FinanceApiError
from .views import _body, _consistent_read, _error, _json, _principal, _replay_fenced_write
from teruisi_backend.read_budget import bounded_read


@require_http_methods(["GET", "POST"])
def targets(request):
    try:
        if request.method == "GET":
            _principal(request, {"viewer", "analyst", "operator", "admin"})
            if set(request.GET) != {"year", "month"} or any(len(request.GET.getlist(key)) != 1 for key in request.GET):
                raise FinanceApiError("ERP目标读取须提供唯一year和month")
            with bounded_read(FinanceApiError):
                data, revision = _consistent_read(lambda: erp_targets.read_targets(request.GET["year"], request.GET["month"]))
            return _json(data, revision=revision)
        principal = _principal(request, {"admin"})
        return _replay_fenced_write(request, principal, lambda: erp_targets.upsert(_body(request), principal))
    except Exception as error:
        return _error(error, "ERP目标读取或保存失败")
