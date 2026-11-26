"""Product subdivision mapping list for system settings (read side).

Lists ERP product master rows (the Jackyun product archive) that fall into a
subdivision map, plus covered-category products that are not in the map, plus
static map entries the archive does not know ("missing"), plus manual
assignments for codes the archive does not know. The effective result comes
from ``subdivisions.load_effective`` so it always agrees with the analysis API.
Edits are written by ``subdivision_edits`` (sales writer process only).
"""
from __future__ import annotations

from typing import Any

from . import subdivisions
from .auth import Principal
from .calculation_cache import reuse
from .query import SalesAccessError, SalesRequestError, binary_text_key

MAX_PAGE_SIZE = 100
MAX_QUERY_LENGTH = 100
STATUSES = ("all", "mapped", "unclassified", "missing")
_STATUS_ORDER = {"mapped": 0, "unclassified": 1, "missing": 2}


def _row(code: str, name: str, **extra: Any) -> dict[str, Any]:
    return {
        "specCode": code, "productName": name, "specification": "", "supplier": "", "erpCategory": "",
        "productStatus": "", "majorCategory": None, "subdivision": None, "matchedBy": "none", "status": "unclassified",
        "overridden": False, "defaultSubdivision": None, "sourceName": "", **extra,
    }


def _compute(mapping: subdivisions.EffectiveMapping) -> dict[str, Any]:
    covered_all = mapping.covered_categories()
    master = subdivisions.master_candidates(
        covered_all, sorted({*mapping.static_codes(), *mapping.manual_codes(), *(i["code"] for i in mapping.sales_lookup())}),
        sorted({name for _code, name, _label, _major in mapping.entries if name}),
    )
    covered_major = {category: major for major in mapping.major_categories() for category in mapping.covered_categories(major)}

    rows: list[dict[str, Any]] = []
    master_codes: set[str] = set()
    master_names: set[str] = set()
    for item in master:
        code, name = item["product_code"] or "", item["product_name"] or ""
        label, major, matched_by = mapping.resolve(code, name)
        manual = mapping.manual_for(code)
        # Every archive row counts as "found", even when it is not listed below.
        master_codes.add(subdivisions.normalize(code))
        master_names.add(subdivisions.normalize(name))
        if matched_by is None:
            major = covered_major.get(item["category"])
            if major is None:
                continue
        rows.append(_row(
            code, name, specification=item["specification"] or "", supplier=subdivisions.supplier_for(code, item["supplier"]),
            erpCategory=item["category"] or "", productStatus=item["product_status"] or "",
            majorCategory=major, subdivision=label, matchedBy=matched_by or "none",
            status="mapped" if label is not None else "unclassified",
            overridden=manual is not None, defaultSubdivision=mapping.resolve(code, name, use_manual=False)[0],
            sourceName=manual["sourceName"] if manual else "",
        ))

    # Manual assignments whose code the archive does not know stay visible and removable.
    for manual in mapping.manual_items():
        if subdivisions.normalize(manual["code"]) in master_codes:
            continue
        label = manual["label"] if manual["label"] and mapping.is_live(manual["major"], manual["label"]) else None
        rows.append(_row(
            manual["code"], manual["sourceName"], majorCategory=manual["major"], subdivision=label, matchedBy="manual",
            supplier=subdivisions.supplier_for(manual["code"], ""),
            status="mapped" if label is not None else "unclassified", overridden=True, sourceName=manual["sourceName"],
        ))

    # Name-only entries resolved through the historical sales lines whose code the archive lacks.
    manual_code_keys = {subdivisions.normalize(m["code"]) for m in mapping.manual_items()}
    for item in mapping.sales_lookup():
        code_key = subdivisions.normalize(item["code"])
        if code_key in master_codes or code_key in manual_code_keys:
            continue
        label, _major, matched = mapping.resolve(item["code"], item["name"])
        label = label if matched == "sales_name_to_code" else None
        rows.append(_row(
            item["code"], item["name"], supplier=subdivisions.supplier_for(item["code"], ""), majorCategory=item["major"],
            subdivision=label, matchedBy="sales_name_to_code", status="mapped" if label is not None else "unclassified",
            defaultSubdivision=label,
        ))

    fallback_keys = mapping.fallback_keys()
    manual_keys = {subdivisions.normalize(item["code"]) for item in mapping.manual_items()}
    seen: set[tuple[str, str]] = set()
    for code, name, label, major in mapping.entries:
        if (code, name) in seen:
            continue
        seen.add((code, name))
        code_key, name_key = subdivisions.normalize(code), subdivisions.normalize(name)
        if code_key:
            if code_key in master_codes or code_key in manual_keys:
                continue
            if mapping.has_sales_code(code):
                # The archive lacks this code but the sales lines carry it: counted by code, listed from sales.
                live_label = label if mapping.is_live(major, label) else None
                rows.append(_row(
                    code, name, supplier=subdivisions.supplier_for(code, ""), majorCategory=major, subdivision=live_label,
                    matchedBy="code", status="mapped" if live_label is not None else "unclassified", defaultSubdivision=live_label,
                ))
                continue
            counted = "code"
        else:
            # Name-only entries that the archive resolved, or a manual code replaced, are not "missing".
            if name_key in master_names or name_key not in fallback_keys:
                continue
            counted = "name"
        live_label = label if mapping.is_live(major, label) else None
        rows.append(_row(
            code, name, majorCategory=major, subdivision=live_label, matchedBy=counted, status="missing",
            defaultSubdivision=live_label, sourceName=name if not code else "",
        ))

    order = {(major, item["name"]): index for major in mapping.major_categories() for index, item in enumerate(mapping.labels(major))}
    major_order = {major: index for index, major in enumerate(mapping.major_categories())}
    rows.sort(key=lambda r: (
        _STATUS_ORDER[r["status"]], major_order.get(r["majorCategory"], len(major_order)),
        order.get((r["majorCategory"], r["subdivision"]), len(order)),
        binary_text_key(r["specCode"]), binary_text_key(r["productName"]),
    ))
    return {"rows": rows, "entries": len({(code, name) for code, name, _l, _m in mapping.entries})}


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
    mapping = subdivisions.load_effective(principal)
    major = (params.get("majorCategory") or "").strip()
    if major and major not in mapping.major_categories():
        raise SalesRequestError("majorCategory 无效")
    subdivision = params["subdivision"].strip()
    if subdivision and subdivision not in mapping.label_names(major or None):
        raise SalesRequestError("subdivision 无效")
    computed = reuse(
        "product-subdivisions", {"mapVersion": mapping.version, "configVersion": mapping.config_version}, principal,
        lambda: _compute(mapping),
    )

    in_major = [r for r in computed["rows"] if not major or r["majorCategory"] == major]
    counts = {key: sum(1 for r in in_major if r["status"] == key) for key in ("mapped", "unclassified", "missing")}
    per_label: dict[tuple[str, str], int] = {}
    for r in in_major:
        if r["status"] == "mapped":
            per_label[(r["majorCategory"], r["subdivision"])] = per_label.get((r["majorCategory"], r["subdivision"]), 0) + 1
    shown_majors = [major] if major else mapping.major_categories()
    subdivision_list = [
        {"label": item["name"], "majorCategory": name, "productCount": per_label.get((name, item["name"]), 0)}
        for name in shown_majors for item in mapping.labels(name)
    ]
    needle = query.casefold()
    selected = [
        r for r in in_major
        if (status == "all" or r["status"] == status)
        and (not subdivision or r["subdivision"] == subdivision)
        and (not needle or needle in " ".join(
            str(r[key] or "") for key in ("specCode", "productName", "specification", "supplier", "erpCategory", "majorCategory", "subdivision")
        ).casefold())
    ]
    page, page_size = params["page"], params["pageSize"]
    offset = (page - 1) * page_size
    items = selected[offset : offset + page_size]
    return {
        "mapping": mapping.mapping_info(major or mapping.major_categories()[0]),
        "totals": {**counts, "entries": computed["entries"], "subdivisions": len(subdivision_list)},
        "subdivisions": subdivision_list,
        "items": items,
        "pagination": {"page": page, "pageSize": page_size, "total": len(selected), "returned": len(items), "truncated": offset + len(items) < len(selected)},
        "filters": {"q": query, "status": status, "subdivision": subdivision, "majorCategory": major},
    }
