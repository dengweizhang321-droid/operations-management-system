"""Opt-in inventory regions. Legacy endpoints and consumers keep full responses."""
import hashlib
import json

from .errors import InventoryApiError
from .read_cache import cached_base, snapshot


def region_option(request):
    values = request.GET.getlist("section")
    if not values:
        return None
    if len(values) != 1 or values[0] not in {"summary", "detail"}:
        raise InventoryApiError("section 必须是 summary 或 detail")
    return values[0]


def regional_read(principal, kind, options, section, loader):
    if section is None:
        return loader()
    scope = json.dumps((kind, options), sort_keys=True, ensure_ascii=False)
    before = snapshot()
    # All regions for an identical complete query reuse one full calculation,
    # including global statistics and sorting. No current-page statistics.
    payload = cached_base("response:"+kind, principal, scope, loader)
    if snapshot() != before:
        raise InventoryApiError("分区来源已变化，请刷新重试", status=503, code="service_unavailable")
    result = dict(payload)
    if section == "summary":
        for key in ("items", "plans"):
            if key in result:
                result[key] = []
        if "mapping" in result:
            result["mapping"] = {**result["mapping"], "samples": []}
    result["readSection"] = section
    result["readScope"] = hashlib.sha256(scope.encode()).hexdigest()
    result["readSnapshot"] = hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest()
    return result
