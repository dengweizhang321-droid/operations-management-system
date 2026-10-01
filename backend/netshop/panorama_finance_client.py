"""S-only selection of complete owning natural-month/year finance reads.

No default zero becomes a metric and no daily/year target allocation occurs.
Actual three-period months and annual references remain separate native reads.
"""
from __future__ import annotations

import json

from .errors import NetshopApiError
from .finance_netshop_client import read_finance_netshop
from .insights_common import actor_fence

SCHEMA_VERSION = "netshop-panorama-finance-v2"


def finance_read_plan(context):
    platform, name = context["effectiveScope"]["shopKeys"][0].split("\x1f", 1)
    shop = json.dumps([platform, name], ensure_ascii=False, separators=(",", ":"))
    requests = []
    def add(kind, year):
        window = context["periods"][kind]
        first, last = window["startDate"][:7], window["endDate"][:7]
        cursor, months = first, []
        while cursor <= last:
            if len(months) >= 24:
                raise NetshopApiError("财报自然月超过所属上限，不能截月", code="quality_incomplete", status=422)
            months.append(cursor)
            y, month = (int(v) for v in cursor.split("-"))
            cursor = f"{y + (month == 12):04d}-{1 if month == 12 else month + 1:02d}"
        request = {"operation": "netshop_finance_read_v1", "shopKeys": [shop], "months": months, "year": year}
        if request not in requests:
            requests.append(request)
        return requests.index(request)
    refs = {kind: add(kind, context["periods"][kind]["startDate"][:4]) for kind in ("current", "previous", "yearAgo")}
    years = list(dict.fromkeys([context["periods"]["current"]["startDate"][:4], context["periods"]["current"]["endDate"][:4]]))
    annual = [add("current", year) for year in years]
    if len(requests) > 4:
        raise NetshopApiError("财报拥有方请求超过四次预算", code="quality_incomplete", status=422)
    return {"requests": requests, "periodReadRefs": refs, "annualReadRefs": annual}


def _references(owning):
    values, revision = {}, None
    for body in owning:
        for ref in body["sourceRevisions"]:
            if revision is not None and revision != ref["revision"]:
                raise NetshopApiError("财报独立读取的参与版本不一致", code="insights_revision_changed", status=409)
            revision = ref["revision"]
            key = (ref["domain"], ref["kind"], ref["scopeKey"])
            if key in values and values[key]["revision"] != revision:
                raise NetshopApiError("财报参与向量不一致", code="insights_revision_changed", status=409)
            values[key] = ref
    return [values[key] for key in sorted(values)]


def read_panorama_finance(principal, context, *, deadline):
    from .store_panorama import _budget
    _budget(deadline)
    actor = actor_fence(principal)
    if principal.scope is not None:
        raise NetshopApiError("原财报与目标只支持未受限数据范围账号", code="access_denied", status=403)
    plan, bodies, revision = finance_read_plan(context), [], None
    for request in plan["requests"]:
        _budget(deadline)
        body, actual = read_finance_netshop(principal, {**request, **({"expectedRevision": revision} if revision is not None else {})}, deadline=deadline)
        if revision is not None and actual != revision:
            raise NetshopApiError("财报多次读取期间来源版本已变化", code="insights_revision_changed", status=409)
        revision = actual
        bodies.append(body)
    if actor_fence(principal) != actor:
        raise NetshopApiError("财报读取期间账号权限变化", code="access_denied", status=403)
    platform, name = context["effectiveScope"]["shopKeys"][0].split("\x1f", 1)
    current = context["periods"]["current"]
    _budget(deadline)
    return {"schemaVersion": SCHEMA_VERSION, "scope": {"platform": platform, "shopName": name, "startDate": current["startDate"], "endDate": current["endDate"]},
            "sourceRevisions": _references(bodies), "owning": bodies, "periodReadRefs": plan["periodReadRefs"], "annualReadRefs": plan["annualReadRefs"],
            "limitations": [
                "财报按各期覆盖的完整自然月份读取；非整月日范围不按天摊月，原比较目录不替代S实际基期",
                "年度目标与财报全年进度属于原年度来源，目标零/无目标/缺月分别保留，不线性摊成月目标",
                "主值只消费currentMetricStates及原annual状态；raw默认0、BPS、timeline均不是额外可用性证明",
                "原网店映射仍unverified；来源修订一致不表示多域原子快照或事件因果",
            ]}


def verify_panorama_finance(principal, context, data, *, deadline):
    from .store_panorama import _budget
    _budget(deadline)
    actor = actor_fence(principal)
    plan, reread = finance_read_plan(context), []
    if data["periodReadRefs"] != plan["periodReadRefs"] or data["annualReadRefs"] != plan["annualReadRefs"] or len(data["owning"]) != len(plan["requests"]):
        raise NetshopApiError("财报最终核验范围变化", code="insights_revision_changed", status=409)
    expected = _references(data["owning"])
    revision = expected[0]["revision"]
    for request, prior in zip(plan["requests"], data["owning"]):
        _budget(deadline)
        body, actual = read_finance_netshop(principal, {**request, "expectedRevision": revision, "snapshotToken": prior["snapshotToken"]}, deadline=deadline)
        if actual != revision or body != prior:
            raise NetshopApiError("财报拥有方月/年度事实或版本变化", code="insights_revision_changed", status=409)
        reread.append(body)
    if actor_fence(principal) != actor:
        raise NetshopApiError("财报最终核验期间账号权限变化", code="access_denied", status=403)
    if _references(reread) != expected:
        raise NetshopApiError("财报最终参与向量变化", code="insights_revision_changed", status=409)
    _budget(deadline)
