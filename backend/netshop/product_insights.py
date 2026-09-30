"""Product-owned read-only insights over the published PostgreSQL facts.

The shared context owns dates, account fencing and typed source revisions. This
module owns complete-set product aggregation and exact identity pairing; no
browser joins, current-to-historical mapping, source writes or reader grants.
"""
from __future__ import annotations

import json
import time

from django.db import DatabaseError, transaction
from django.db.models import (
    Case, Count, Exists, ExpressionWrapper, F, FloatField, Max, OuterRef, Q, Sum, Value, When,
)

from .errors import NetshopApiError
from .insights_common import (
    MAX_SAFE, actor_fence, compare_metrics, context_versions, parse_identities,
    read_context, validate_context, validate_metric,
)
from .models import NetshopImportBatch, NetshopRow
from .query import (
    PERFORMANCE_FIELD_ALIASES, _canonical_token, positive, revision_value,
)
from .store_overview import NumericMetricPresent


PRODUCT_SCHEMA = "netshop-product-insights-v1"
CORE_FIELDS = {
    "payment": "transaction_amount_cents",
    "quantity": "transaction_quantity",
    "visitors": "visitors",
    "customers": "transaction_customers",
    "addCartCustomers": "add_cart_customers",
    "refundPayment": "refund_amount_cents",
}
CORE_KEYS = (
    "payment", "quantity", "visitors", "customers", "conversion",
    "addCartRate", "refundPayment",
)
SHARED_PARAMETERS = {
    "platform", "outlet", "dimension", "startDate", "endDate", "periodKind",
    "snapshotToken",
}
PRODUCT_PARAMETERS = {
    "q", "category", "page", "pageSize", "sort", "productIdentity", "sectionToken",
}
SORTS = {"payment_desc", "payment_asc", "visitors_desc", "visitors_asc", "conversion_desc", "conversion_asc", "growth_desc", "decline_desc"}


def validate_product_query(params, *, detail=False):
    """Only the frozen public parameters; no principal/SQL/URL inputs."""
    if set(params) - SHARED_PARAMETERS - PRODUCT_PARAMETERS or any(
        len(params.getlist(key)) != 1
        for key in params if key not in {"platform", "outlet"}
    ):
        raise NetshopApiError("商品请求包含未知或重复参数")
    shared = params.copy()
    for key in PRODUCT_PARAMETERS:
        if key in shared:
            del shared[key]
    spec = validate_context(shared)
    query, category = params.get("q", "").strip(), params.get("category", "").strip()
    if len(query) > 120 or len(category) > 200 or any(
        ord(char) < 32 or ord(char) == 127 for char in query + category
    ):
        raise NetshopApiError("商品搜索或类目无效")
    sort = params.get("sort", "payment_desc")
    if sort not in SORTS:
        raise NetshopApiError("商品排序无效")
    section_token = params.get("sectionToken")
    if section_token is not None and (
        len(section_token) != 64 or any(c not in "0123456789abcdef" for c in section_token)
    ):
        raise NetshopApiError("商品sectionToken无效")
    identity = None
    if params.get("productIdentity") is not None:
        identity = parse_identities(
            [params["productIdentity"]], spec["dimension"], spec["platforms"], spec["outlets"],
        )[0]
    if detail and identity is None or not detail and identity is not None:
        raise NetshopApiError("单品详情须精确身份，商品列表不能传详情身份")
    return {
        **spec, "query": query, "category": category,
        "page": positive(params.get("page"), 1, "page", 10000),
        "pageSize": positive(params.get("pageSize"), 20, "pageSize", 100),
        "sort": sort, "identity": identity, "sectionToken": section_token,
    }


def _check_budget(deadline):
    if time.monotonic() > deadline:
        raise NetshopApiError("商品来源读取超出65秒预算", code="source_not_ready", status=503)


def _shared_spec(spec):
    return {key: spec[key] for key in ("platforms", "outlets", "dimension", "kind", "periods", "token")}


def _source(platform, dimension):
    return ("jd_sku_daily", dimension + "_daily") if platform == "京东" else ("tmall_product_daily", "spu_daily")


def _base(context):
    """The batch must belong to this exact row's source, dataset and shop."""
    scopes = Q(pk__in=[])
    for shop_key in context["effectiveScope"]["shopKeys"]:
        platform, shop = shop_key.split("\x1f")
        source, dataset = _source(platform, context["effectiveScope"]["dimension"])
        scopes |= Q(platform=platform, shop_name=shop, source=source, dataset=dataset)
    completed = NetshopImportBatch.objects.filter(
        id=OuterRef("last_import_batch_id"), status="completed",
        platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
        source=OuterRef("source"), dataset=OuterRef("dataset"),
    )
    identity_column = context["effectiveScope"]["dimension"] + "_id"
    return NetshopRow.objects.filter(scopes, Exists(completed)).exclude(**{identity_column: ""})


def _window_rows(base, window):
    return base.filter(business_date__gte=window["startDate"], business_date__lt=window["endExclusive"])


def _identity_fields(spec):
    return ("platform", "shop_name", spec["dimension"] + "_id")


def _identity_filter(identities):
    result = Q(pk__in=[])
    for platform, shop, dimension, product in identities:
        result |= Q(platform=platform, shop_name=shop, **{dimension + "_id": product})
    return result


def _presence(column):
    return NumericMetricPresent(PERFORMANCE_FIELD_ALIASES[column])


def _annotations(fields=CORE_FIELDS, prefix="", filter_q=None):
    condition = filter_q or Q()
    values = {
        prefix + "rows": Count("id", filter=condition),
        prefix + "days": Count("business_date", distinct=True, filter=condition),
    }
    for key, column in fields.items():
        # Sum only the proved numeric rows. A typed default zero is not a fact.
        present = condition & Q(_presence(column))
        values[prefix + key] = Sum(column, filter=present)
        values[prefix + key + "_present"] = Count("id", filter=present)
    return values


def _aggregate(rows, fields=CORE_FIELDS):
    return rows.aggregate(**_annotations(fields))


def _grouped(rows, spec):
    return rows.values(*_identity_fields(spec)).annotate(
        title=Max("product_name"), category_label=Max("category"),
        **_annotations(),
    )


def _global_complete(context, kind):
    refs = [
        f"{_source(platform, context['effectiveScope']['dimension'])[0]}:"
        f"{context['effectiveScope']['dimension']}_daily:{platform}:{kind}"
        for platform in context["effectiveScope"]["platforms"]
    ]
    return bool(context["effectiveScope"]["shopKeys"]) and all(
        context["coverageBySource"][ref]["complete"] for ref in refs
        if context["coverageBySource"][ref]["expectedShopDatePairs"] > 0
    )


def _metric(key, value, status, reason, sources, coverage_ref, *, numerator=None, denominator=None):
    unit = "RATIO" if key in {"conversion", "addCartRate"} else "CNY_CENT" if key in {"payment", "refundPayment"} else "COUNT"
    if value is not None and (type(value) not in {int, float} or unit != "RATIO" and (type(value) is not int or abs(value) > MAX_SAFE)):
        value, status, reason = None, "invalid", "unsafe_integer"
    result = {
        "value": value, "unit": unit, "status": status, "reasonCode": reason,
        "basis": "product_day_sum", "sourceIds": sources,
        "aggregation": "ratio_of_sums" if unit == "RATIO" else "sum",
        "coverageRef": coverage_ref,
    }
    if unit == "RATIO":
        result.update(numerator=numerator, denominator=denominator)
    return validate_metric(result)


def _metrics(aggregate, context, kind, *, platform=None, prefix="", identity=False):
    sources = [_source(p, context["effectiveScope"]["dimension"])[0] for p in ([platform] if platform else context["effectiveScope"]["platforms"])]
    coverage_ref = "products:" + kind
    row_count = int(aggregate.get(prefix + "rows") or 0)
    complete_days = int(aggregate.get(prefix + "days") or 0) == context["periods"][kind]["days"] if identity else _global_complete(context, kind)
    result = {}
    for key in CORE_FIELDS:
        present = int(aggregate.get(prefix + key + "_present") or 0)
        value = aggregate.get(prefix + key)
        reason = None if row_count and present == row_count and complete_days else "missing_field" if present < row_count else "missing_day" if row_count else "no_records"
        status = "available" if reason is None else "partial" if present else "unavailable"
        result[key] = _metric(key, int(value) if present else None, status, reason, sources, coverage_ref)
    for key, numerator_key in (("conversion", "customers"), ("addCartRate", "addCartCustomers")):
        numerator, denominator = result[numerator_key], result["visitors"]
        reason = "incomplete_coverage" if numerator["status"] != "available" or denominator["status"] != "available" else "zero_denominator" if denominator["value"] == 0 else "negative_denominator" if denominator["value"] < 0 else None
        result[key] = _metric(key, numerator["value"] / denominator["value"] if reason is None else None, "available" if reason is None else "unavailable", reason, sources, coverage_ref, numerator=numerator["value"], denominator=denominator["value"])
    return {key: result[key] for key in CORE_KEYS}


def _comparison(current, prior, year):
    return {key: {"previous": compare_metrics(current[key], prior[key]), "yearAgo": compare_metrics(current[key], year[key])} for key in CORE_KEYS}


def _pagination(spec, total, returned):
    more = (spec["page"] - 1) * spec["pageSize"] + returned < total
    return {"page": spec["page"], "pageSize": spec["pageSize"], "total": total, "returned": returned, "hasMore": more, "truncated": more}


def _search(rows, spec):
    if spec["query"]:
        query = spec["query"]
        matching = rows.filter(Q(product_name__icontains=query) | Q(product_code__icontains=query) | Q(sku_id__icontains=query) | Q(spu_id__icontains=query)).filter(
            platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
            **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")},
        )
        rows = rows.filter(Exists(matching))
    return rows


def _empty_metrics(context, kind, platform=None):
    return _metrics({}, context, kind, platform=platform, identity=True)


def _baseline_read(loader, kind, errors, deadline):
    _check_budget(deadline)
    if kind in errors:
        return None
    try:
        # A query timeout cannot poison the current-period transaction.
        with transaction.atomic():
            return loader()
    except NetshopApiError as error:
        if error.status != 503 or error.code == "source_not_ready":
            raise
    except DatabaseError:
        pass
    _check_budget(deadline)
    errors[kind] = {"state": "error", "data": None, "code": "service_unavailable", "message": "基期事实读取失败；本期保留，比较不可用"}
    return None


def _baseline_map(base, spec, identities, kind, deadline, errors):
    _check_budget(deadline)
    window = spec["periods"][kind]
    grouped = _grouped(_window_rows(base, window).filter(_identity_filter(identities)), spec)
    return _baseline_read(lambda: {tuple(row[field] for field in _identity_fields(spec)): row for row in grouped}, kind, errors, deadline) or {}


def _rows_payload(grouped_rows, base, spec, context, deadline, errors):
    identities = [(row["platform"], row["shop_name"], spec["dimension"], row[spec["dimension"] + "_id"]) for row in grouped_rows]
    previous = _baseline_map(base, spec, identities, "previous", deadline, errors) if identities else {}
    year = _baseline_map(base, spec, identities, "yearAgo", deadline, errors) if identities else {}
    output = []
    for row in grouped_rows:
        key = tuple(row[field] for field in _identity_fields(spec))
        current_metrics = _metrics(row, context, "current", platform=row["platform"], identity=True)
        prior_metrics = _metrics(previous.get(key, {}), context, "previous", platform=row["platform"], identity=True)
        year_metrics = _metrics(year.get(key, {}), context, "yearAgo", platform=row["platform"], identity=True)
        output.append({
            "identity": {"platform": row["platform"], "shopName": row["shop_name"], "dimension": spec["dimension"], "id": row[spec["dimension"] + "_id"]},
            "title": row["title"] or row[spec["dimension"] + "_id"],
            "category": row["category_label"] or None, "imageUrl": None,
            "metrics": current_metrics, "comparisons": _comparison(current_metrics, prior_metrics, year_metrics),
        })
    return output


def _paired_query(base, spec):
    """Pair the complete SQL candidate set before ordering or LIMIT/OFFSET."""
    current, previous = spec["periods"]["current"], spec["periods"]["previous"]
    cq = Q(business_date__gte=current["startDate"], business_date__lt=current["endExclusive"])
    pq = Q(business_date__gte=previous["startDate"], business_date__lt=previous["endExclusive"])
    grouped = base.filter(cq | pq).values(*_identity_fields(spec)).annotate(
        **_annotations({"payment": "transaction_amount_cents"}, "current_", cq),
        **_annotations({"payment": "transaction_amount_cents"}, "previous_", pq),
    ).filter(
        current_rows__gt=0, previous_rows__gt=0,
        current_payment_present=F("current_rows"), previous_payment_present=F("previous_rows"),
        current_days=current["days"], previous_days=previous["days"],
        current_payment__gte=-MAX_SAFE, current_payment__lte=MAX_SAFE,
        previous_payment__gte=-MAX_SAFE, previous_payment__lte=MAX_SAFE,
    ).annotate(delta=F("current_payment") - F("previous_payment")).filter(delta__gte=-MAX_SAFE, delta__lte=MAX_SAFE)
    return grouped


def _list_rows(base, spec):
    current = _window_rows(base, spec["periods"]["current"])
    identity_columns = _identity_fields(spec)
    offset = (spec["page"] - 1) * spec["pageSize"]
    if spec["sort"] in {"growth_desc", "decline_desc"}:
        paired = _paired_query(base, spec)
        sign = {"delta__gt": 0} if spec["sort"] == "growth_desc" else {"delta__lt": 0}
        paired = paired.filter(**sign)
        # Search applies to the current list, never to summary or complete-set totals.
        matched = _search(current, spec).filter(
            platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
            **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")},
        )
        paired = paired.filter(Exists(matched)).order_by("-delta" if spec["sort"] == "growth_desc" else "delta", *identity_columns)
        total = paired.count()
        identities = [(r["platform"], r["shop_name"], spec["dimension"], r[spec["dimension"] + "_id"]) for r in paired[offset:offset + spec["pageSize"]]]
        grouped = list(_grouped(current.filter(_identity_filter(identities)), spec))
        ranks = {(p, s, i): rank for rank, (p, s, _, i) in enumerate(identities)}
        grouped.sort(key=lambda row: ranks[tuple(row[f] for f in identity_columns)])
        return grouped, total
    grouped = _grouped(_search(current, spec), spec)
    quality = Q(days=spec["periods"]["current"]["days"])
    if spec["sort"].startswith("conversion_"):
        order = F("sort_value").asc(nulls_last=True) if spec["sort"].endswith("_asc") else F("sort_value").desc(nulls_last=True)
        valid = quality & Q(visitors__gt=0, visitors__lte=MAX_SAFE, customers__gte=-MAX_SAFE, customers__lte=MAX_SAFE, visitors_present=F("rows"), customers_present=F("rows"))
        grouped = grouped.annotate(sort_value=Case(When(valid, then=ExpressionWrapper(F("customers") * 1.0 / F("visitors"), output_field=FloatField())), default=Value(None), output_field=FloatField())).order_by(order, *identity_columns)
    else:
        column, direction = spec["sort"].rsplit("_", 1)
        valid = quality & Q(**{column + "_present": F("rows"), column + "__gte": -MAX_SAFE, column + "__lte": MAX_SAFE})
        grouped = grouped.annotate(sort_value=Case(When(valid, then=F(column)), default=Value(None))).order_by(F("sort_value").asc(nulls_last=True) if direction == "asc" else F("sort_value").desc(nulls_last=True), *identity_columns)
    return list(grouped[offset:offset + spec["pageSize"]]), grouped.count()


def _section_token(context, spec):
    return _canonical_token({
        "kind": PRODUCT_SCHEMA, "contextScope": context["scopeKey"],
        "sourceRevisions": context["sourceRevisions"],
        "filter": {"q": spec["query"], "category": spec["category"], "sort": spec["sort"], "identity": spec["identity"]},
    })


def _counts(base, spec, context):
    current = _window_rows(base, spec["periods"]["current"])
    grouped = _grouped(current, spec)
    observed = grouped.count()
    traded = grouped.filter(payment__gt=0).count()
    payment_missing = grouped.exclude(payment_present=F("rows")).exists()
    sources = [_source(platform, spec["dimension"])[0] for platform in spec["platforms"]]
    complete = _global_complete(context, "current")
    return {
        "dataProducts": _metric("quantity", observed if complete or observed else None, "available" if complete else "partial" if observed else "unavailable", None if complete else "incomplete_coverage" if observed else "no_records", sources, "products:current"),
        "tradedProducts": _metric("quantity", traded if complete or observed else None, "available" if complete and not payment_missing else "partial" if observed else "unavailable", None if complete and not payment_missing else "missing_field" if payment_missing else "incomplete_coverage" if observed else "no_records", sources, "products:current"),
    }


def _cohort(base, spec):
    """Category selects current-period identities, never baseline row labels."""
    if not spec["category"]:
        return base
    candidates = _window_rows(base, spec["periods"]["current"]).filter(
        category=spec["category"], platform=OuterRef("platform"), shop_name=OuterRef("shop_name"),
        **{spec["dimension"] + "_id": OuterRef(spec["dimension"] + "_id")},
    )
    return base.filter(Exists(candidates))


def _finish(payload, principal, actor, deadline):
    context = payload["context"]
    _check_budget(deadline)
    revision = revision_value()
    if context["sourceRevisions"][0]["revision"] != revision:
        raise NetshopApiError("商品读取期间来源版本变化", code="insights_revision_changed", status=409)
    expected = []
    for platform in context["effectiveScope"]["platforms"]:
        names = [key.split("\x1f")[1] for key in context["effectiveScope"]["shopKeys"] if key.startswith(platform + "\x1f")]
        expected.extend({"domain": "netshop", "kind": platform + ":" + key, "scopeKey": context["scopeKey"], "revision": value} for key, value in sorted(context_versions(platform, names, revision).items()) if key != "netshop")
    if expected != context["sourceRevisions"][1:]:
        raise NetshopApiError("商品参与来源向量变化", code="insights_revision_changed", status=409)
    if actor_fence(principal) != actor:
        raise NetshopApiError("商品取数期间账号权限版本变化", code="access_denied", status=403)
    _check_budget(deadline)
    if len(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")) > 2 * 1024 * 1024:
        raise NetshopApiError("商品响应超过2MiB，请缩小范围", code="quality_incomplete", status=422)
    _check_budget(deadline)
    return payload


def read_product_insights(principal, spec):
    """A single shared-context read (at most two attempts), then one fact read.

    The outer deadline starts before the initial actor SQL and includes the last
    actor SQL and serialization. There is no nested retry multiplier.
    """
    deadline = time.monotonic() + 65
    actor = actor_fence(principal)
    _check_budget(deadline)
    context = read_context(principal, _shared_spec(spec))
    _check_budget(deadline)
    section_token = _section_token(context, spec)
    if spec["sectionToken"] and spec["sectionToken"] != section_token:
        raise NetshopApiError("商品sectionToken不属于当前范围或版本", code="insights_revision_changed", status=409)
    base = _cohort(_base(context), spec)
    metrics, baseline_errors = {}, {}
    for kind in ("current", "previous", "yearAgo"):
        _check_budget(deadline)
        aggregate = _aggregate(_window_rows(base, spec["periods"][kind])) if kind == "current" else _baseline_read(lambda: _aggregate(_window_rows(base, spec["periods"][kind])), kind, baseline_errors, deadline)
        metrics[kind] = _metrics(aggregate or {}, context, kind)
    grouped, total = _list_rows(base, spec)
    items = _rows_payload(grouped, base, spec, context, deadline, baseline_errors)
    growth_spec = {**spec, "sort": "decline_desc" if spec["sort"] == "decline_desc" else "growth_desc"}
    growth_rows, growth_total = _list_rows(base, growth_spec) if "previous" not in baseline_errors else ([], 0)
    growth_items = _rows_payload(growth_rows, base, growth_spec, context, deadline, baseline_errors)
    for kind in baseline_errors:
        metrics[kind] = _empty_metrics(context, kind)
        for item in items + growth_items:
            empty = _empty_metrics(context, kind, item["identity"]["platform"])
            for key in CORE_KEYS:
                item["comparisons"][key][kind] = compare_metrics(item["metrics"][key], empty[key])
    payload = {
        "schemaVersion": PRODUCT_SCHEMA, "context": context, "sectionToken": section_token,
        "tableScope": {"q": spec["query"], "category": spec["category"], "sort": spec["sort"], "page": spec["page"], "pageSize": spec["pageSize"]},
        "joinedSourceRevisions": context["sourceRevisions"], "consistency": "revision_vector_checked",
        "sections": {
            "summary": metrics["current"],
            "comparisons": _comparison(metrics["current"], metrics["previous"], metrics["yearAgo"]),
            "items": items, "pagination": _pagination(spec, total, len(items)),
            "counts": _counts(base, spec, context),
            "baselineReads": {kind: baseline_errors.get(kind, {"state": "ready", "data": metrics[kind]}) for kind in ("previous", "yearAgo")},
            "growth": baseline_errors.get("previous", {"state": "ready", "data": {"collection": "paired_full_set_before_pagination", "items": growth_items, "pagination": _pagination(spec, growth_total, len(growth_items))}}),
        },
    }
    return _finish(payload, principal, actor, deadline)


def read_product_detail(principal, spec):
    """Initial exact-identity detail; private extensions are added separately."""
    if spec["identity"] is None:
        raise NetshopApiError("详情缺少商品精确身份")
    # Do not return an independently ranked page as a single-product detail.
    raise NetshopApiError("单品详情扩展合同尚未接线", code="source_not_ready", status=503)
