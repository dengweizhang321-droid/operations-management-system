"""Read-only product subdivision mapping list for system settings.

Lists ERP product master rows (the Jackyun product archive) that fall into a
subdivision map, plus covered-category products that are not in the map, plus
map entries that no ERP product matches. The map ships with the code, so this
never writes anything.
"""
from __future__ import annotations

from typing import Any

from django.db.models import Q

from . import subdivisions
from .auth import Principal
from .calculation_cache import reuse
from .models import ErpProductMaster
from .query import SalesAccessError, SalesRequestError, binary_text_key

CANDIDATE_LIMIT = 20000
MAX_PAGE_SIZE = 100
MAX_QUERY_LENGTH = 100
STATUSES = ("all", "mapped", "unclassified", "missing")
_STATUS_ORDER = {"mapped": 0, "unclassified": 1, "missing": 2}


def _compute() -> dict[str, Any]:
    covered = list(subdivisions.covered_categories())
    master = list(
        ErpProductMaster.objects.filter(
            Q(category__in=covered)
            | Q(product_code__in=list(subdivisions.raw_codes()))
            | Q(product_name__in=list(subdivisions.raw_names()))
        ).order_by().values("product_code", "product_name", "specification", "category", "product_status")[: CANDIDATE_LIMIT + 1]
    )
    if len(master) > CANDIDATE_LIMIT:
        raise SalesRequestError(f"货品细分映射候选货品超过 {CANDIDATE_LIMIT}，暂不支持")

    rows: list[dict[str, Any]] = []
    master_codes: set[str] = set()
    master_names: set[str] = set()
    for item in master:
        code, name = item["product_code"] or "", item["product_name"] or ""
        label, matched_by = subdivisions.resolve(code, name)
        if label is None and item["category"] not in covered:
            continue
        master_codes.add(subdivisions.normalize(code))
        master_names.add(subdivisions.normalize(name))
        rows.append({
            "specCode": code, "goodsCode": code, "productName": name,
            "specification": item["specification"] or "", "erpCategory": item["category"] or "",
            "productStatus": item["product_status"] or "",
            "subdivision": label, "matchedBy": matched_by or "none",
            "status": "mapped" if label is not None else "unclassified",
        })

    seen: set[tuple[str, str]] = set()
    for code, name, label in subdivisions.entries():
        if (code, name) in seen:
            continue
        seen.add((code, name))
        code_key, name_key = subdivisions.normalize(code), subdivisions.normalize(name)
        if (code_key and code_key in master_codes) or (name_key and name_key in master_names):
            continue
        rows.append({
            "specCode": code, "goodsCode": code, "productName": name, "specification": "",
            "erpCategory": "", "productStatus": "", "subdivision": label, "matchedBy": "none", "status": "missing",
        })

    order = {label: index for index, label in enumerate(subdivisions.subdivision_labels())}
    rows.sort(key=lambda r: (
        _STATUS_ORDER[r["status"]], order.get(r["subdivision"], len(order)),
        binary_text_key(r["specCode"]), binary_text_key(r["productName"]),
    ))
    counts = {status: sum(1 for r in rows if r["status"] == status) for status in ("mapped", "unclassified", "missing")}
    per_label: dict[str, int] = {}
    for r in rows:
        if r["status"] == "mapped":
            per_label[r["subdivision"]] = per_label.get(r["subdivision"], 0) + 1
    return {
        "rows": rows,
        "totals": {**counts, "entries": len(subdivisions.entries()), "subdivisions": len(order)},
        "subdivisions": [{"label": label, "productCount": per_label.get(label, 0)} for label in order],
    }


def get_product_subdivisions(params: dict[str, Any], principal: Principal) -> dict[str, Any]:
    # Product master data is not warehouse/channel scoped; fail closed for scoped actors.
    if principal.scope is not None:
        raise SalesAccessError("货品细分映射仅限不受数据范围限制的账号查看")
    query = params["q"].strip()
    if len(query) > MAX_QUERY_LENGTH:
        raise SalesRequestError(f"q 不能超过 {MAX_QUERY_LENGTH} 字")
    status = params["status"]
    if status not in STATUSES:
        raise SalesRequestError("status 必须是 all, mapped, unclassified, missing 之一")
    subdivision = params["subdivision"].strip()
    if subdivision and subdivision not in subdivisions.subdivision_labels():
        raise SalesRequestError("subdivision 无效")
    computed = reuse("product-subdivisions", {"mapVersion": subdivisions.map_version()}, principal, _compute)

    needle = query.casefold()
    selected = [
        r for r in computed["rows"]
        if (status == "all" or r["status"] == status)
        and (not subdivision or r["subdivision"] == subdivision)
        and (not needle or needle in " ".join(
            str(r[key] or "") for key in ("specCode", "goodsCode", "productName", "specification", "erpCategory", "subdivision")
        ).casefold())
    ]
    page, page_size = params["page"], params["pageSize"]
    offset = (page - 1) * page_size
    items = selected[offset : offset + page_size]
    return {
        "mapping": subdivisions.mapping_info(),
        "totals": computed["totals"],
        "subdivisions": computed["subdivisions"],
        "items": items,
        "pagination": {"page": page, "pageSize": page_size, "total": len(selected), "returned": len(items), "truncated": offset + len(items) < len(selected)},
        "filters": {"q": query, "status": status, "subdivision": subdivision},
    }
