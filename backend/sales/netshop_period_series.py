"""Opt-in native ERP bucket facts inside the parent two-window transaction.

No per-bucket RPC, sum-of-daily orders, cost repair or new completeness claim.
"""
from calendar import monthrange
from datetime import date, timedelta
import json

from django.db.models import DateField, F, Q
from django.db.models.functions import TruncMonth, TruncWeek

SERIES_SCHEMA = "netshop-sales-period-series-v1"
SERIES_PROJECTION = "native-period-tuples-v1"
WINDOW_COLUMNS = ["startDate", "endDate", "endExclusive", "days"]
POINT_COLUMNS = ["window", "values", "rowCount", "trustedOrderCount", "missingOrderNoRows", "netAmountPerOrderValue", "observedDateCount", "observedDateRanges"]
SERIES_BASIS = {"date": "imported_business_date", "bucket": "clipped_calendar_day_week_monday_sunday_month", "orders": "distinct_ERP_order_no_within_exact_raw_identity_and_bucket", "category": "native_resolved_category_cohort", "completeness": "unknown"}


def pack_period_point(window, facts):
    from .netshop_periods import METRICS
    return [[window[key] for key in WINDOW_COLUMNS], [facts["values"][key] for key in METRICS], facts["rowCount"], facts["orders"]["trustedOrderCount"], facts["orders"]["missingOrderNoRows"], facts["orders"]["netAmountPerOrder"]["value"], facts["observations"]["observedDateCount"], [[row["startDate"],row["endDate"]] for row in facts["observations"]["observedDateRanges"]]]


def restore_period_point(point):
    """Restore constant/uniquely determined fields; preserve the original mean.

    The consumer verifies this restored full period using its closed decoder.
    """
    from .netshop_periods import METRICS
    if type(point)is not list or len(point)!=len(POINT_COLUMNS) or type(point[0])is not list or len(point[0])!=len(WINDOW_COLUMNS) or type(point[1])is not list or len(point[1])!=len(METRICS) or type(point[7])is not list or any(type(row)is not list or len(row)!=2 for row in point[7]):
        raise ValueError("Invalid native-period tuple columns/length")
    window=dict(zip(WINDOW_COLUMNS,point[0]));values=dict(zip(METRICS,point[1]))
    count,trusted,missing,mean,observed=point[2:7]
    reason="no_records" if count==0 else "missing_order_no" if missing else "zero_denominator" if trusted==0 else None
    facts={"values":values,"rowCount":count,"rowPresence":count>0 if type(count)is int else None,
           "orders":{"basis":"ERP_order_no_only_within_exact_raw_source_identity","trustedOrderCount":trusted,"missingOrderNoRows":missing,"netAmountPerOrder":{"unit":"CNY_CENT_PER_ORDER","value":mean,"numerator":values["netSalesCents"],"denominator":trusted,"status":"unavailable" if reason else "available","reasonCode":reason}},
           "observations":{"basis":"imported_business_date_records","requestedDays":window["days"],"observedDateCount":observed,"observedDateRanges":[dict(zip(("startDate","endDate"),row)) for row in point[7]],"completeness":"unknown","absenceMeaning":"无记录日期不能判为店日缺源、真实零或完整结算"}}
    return {"window":window,"facts":facts}


def period_buckets(window, grain):
    cursor, end = date.fromisoformat(window["startDate"]), date.fromisoformat(window["endExclusive"])
    result = []
    while cursor < end:
        if grain == "day": last = cursor
        elif grain == "week": last = cursor+timedelta(days=6-cursor.weekday())
        elif grain == "month": last = cursor.replace(day=monthrange(cursor.year, cursor.month)[1])
        else: raise ValueError("Closed native bucket grain required")
        last = min(last, end-timedelta(days=1))
        result.append({"startDate":cursor.isoformat(),"endDate":last.isoformat(),"endExclusive":(last+timedelta(days=1)).isoformat(),"days":(last-cursor).days+1})
        cursor = last+timedelta(days=1)
    return result


def bucket_key(day, grain):
    return day if grain == "day" else day-timedelta(days=day.weekday()) if grain == "week" else day.replace(day=1)


def read_period_series(base, spec, scope_key, revision, *, deadline):
    from .netshop_periods import RAW_FIELDS, IDENTITY_FIELDS, METRICS, METRIC_METADATA, NetshopPeriodsError, _exact_q, _date_q, _aggregates, _period, _check
    intent = spec["seriesIntent"]; grain = intent["grain"]
    selected = Q(pk__in=[])
    for identity in intent["rawOutlets"]: selected |= _exact_q(identity)
    source = base.filter(selected)
    present = {tuple(row[field] for field in RAW_FIELDS) for row in source.values(*RAW_FIELDS).distinct()}
    if any(tuple(row[key] for key in IDENTITY_FIELDS) not in present for row in intent["rawOutlets"]):
        raise NetshopPeriodsError("图形对象不是完整授权两期候选成员", code="invalid_sales_periods_request", status=400)
    results = {tuple(row[key] for key in IDENTITY_FIELDS):{} for row in intent["rawOutlets"]}
    expression = F("business_date") if grain == "day" else TruncWeek("business_date", output_field=DateField()) if grain == "week" else TruncMonth("business_date", output_field=DateField())
    empty = {**{name:None for name in METRICS},"rowCount":0,"trustedOrderCount":0,"orderNoRows":0}
    for kind in ("current", "baseline"):
        _check(deadline); rows = source.filter(_date_q(spec[kind]))
        # Every bucket's DISTINCT denominator is computed in its own SQL group.
        grouped = {(*tuple(row[field] for field in RAW_FIELDS),row["_series_bucket"]):row for row in rows.annotate(_series_bucket=expression).values(*RAW_FIELDS,"_series_bucket").annotate(**_aggregates())}
        observed = {}
        for row in rows.values(*RAW_FIELDS,"business_date").distinct():
            identity = tuple(row[field] for field in RAW_FIELDS)
            observed.setdefault((*identity,bucket_key(row["business_date"],grain)),[]).append(row["business_date"])
        for identity in results:
            points=[]
            for window in period_buckets(spec[kind],grain):
                key=(*identity,bucket_key(date.fromisoformat(window["startDate"]),grain))
                points.append(pack_period_point(window,_period(grouped.get(key,empty),observed.get(key,[]),window)))
            results[identity][kind]=points
        _check(deadline)
    return {"schemaVersion":SERIES_SCHEMA,"projection":SERIES_PROJECTION,"windowColumns":WINDOW_COLUMNS,"metricColumns":list(METRICS),"pointColumns":POINT_COLUMNS,"scopeKey":scope_key,"intent":intent,"periods":{kind:spec[kind] for kind in ("current","baseline")},"basis":SERIES_BASIS,
            "metricMetadata":{name:dict(item) for name,item in METRIC_METADATA.items()},"sourceRevisions":[{"domain":"sales","kind":"sales_erp_revision_pair","scopeKey":scope_key,"revision":revision}],
            "items":[{"identity":identity,"identityKey":json.dumps([identity[key] for key in IDENTITY_FIELDS],ensure_ascii=False,separators=(",",":")),**results[tuple(identity[key] for key in IDENTITY_FIELDS)]} for identity in intent["rawOutlets"]]}
