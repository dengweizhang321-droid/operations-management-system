"""Whole authorized native platform buckets, not a four-RAW approximation."""
import json
from datetime import date
from django.db.models import DateField, F
from django.db.models.functions import TruncMonth, TruncWeek
from .netshop_period_series import SERIES_PROJECTION, WINDOW_COLUMNS, POINT_COLUMNS, SERIES_BASIS, period_buckets, bucket_key, pack_period_point

PLATFORM_SERIES_SCHEMA="netshop-sales-platform-series-v1"
PLATFORM_BASIS={**SERIES_BASIS,"grouping":"exact_source_platform","membership":"complete_authorized_parent_raw_union"}


def read_platform_series(base,principal,spec,scope_key,revision,*,deadline):
    from .netshop_periods import RAW_FIELDS, IDENTITY_FIELDS, METRICS, METRIC_METADATA, _date_q, _aggregates, _period, _check, NetshopPeriodsError
    from .models import SalesOrderLine
    from .query import _apply_principal_scope
    intent=spec["platformSeriesIntent"];names=intent["platformNames"];grain=intent["grain"]
    scope=principal.scope
    if scope is not None and (scope["platforms"] or scope["channels"]):
        authority,_=_apply_principal_scope(SalesOrderLine.objects.filter(is_business_row=True),principal)
        for platform in names:
            _check(deadline)
            if platform not in scope["platforms"] and not authority.filter(platform=platform,platform_key=platform).exists():
                raise NetshopPeriodsError("当前账号无该平台的来源授权",code="access_denied",status=403)
    source=base.filter(platform__in=names)
    members={name:[] for name in names}
    for row in source.values(*RAW_FIELDS).distinct():
        members[row["platform"]].append({key:row[field] for key,field in zip(IDENTITY_FIELDS,RAW_FIELDS)})
    for rows in members.values():rows.sort(key=lambda item:tuple(item[key].encode() for key in IDENTITY_FIELDS))
    result={name:{} for name in names}
    expression=F("business_date") if grain=="day" else TruncWeek("business_date",output_field=DateField()) if grain=="week" else TruncMonth("business_date",output_field=DateField())
    empty={**{name:None for name in METRICS},"rowCount":0,"trustedOrderCount":0,"orderNoRows":0}
    for kind in ("current","baseline"):
        _check(deadline);rows=source.filter(_date_q(spec[kind]))
        # _aggregates DISTINCT includes RAW tuple + order_no, even when the SQL
        # GROUP is a platform, so same numbers in different RAW stores remain distinct.
        grouped={(row["platform"],row["_platform_bucket"]):row for row in rows.annotate(_platform_bucket=expression).values("platform","_platform_bucket").annotate(**_aggregates())}
        observed={}
        for row in rows.values("platform","business_date").distinct():observed.setdefault((row["platform"],bucket_key(row["business_date"],grain)),[]).append(row["business_date"])
        for platform in names:
            result[platform][kind]=[]
            for window in period_buckets(spec[kind],grain):
                key=(platform,bucket_key(date.fromisoformat(window["startDate"]),grain))
                result[platform][kind].append(pack_period_point(window,_period(grouped.get(key,empty),observed.get(key,[]),window)))
        _check(deadline)
    return {"schemaVersion":PLATFORM_SERIES_SCHEMA,"projection":SERIES_PROJECTION,"windowColumns":WINDOW_COLUMNS,"metricColumns":list(METRICS),"pointColumns":POINT_COLUMNS,"scopeKey":scope_key,"intent":intent,"periods":{kind:spec[kind] for kind in ("current","baseline")},"basis":PLATFORM_BASIS,"metricMetadata":{key:dict(value) for key,value in METRIC_METADATA.items()},"sourceRevisions":[{"domain":"sales","kind":"sales_erp_revision_pair","scopeKey":scope_key,"revision":revision}],"items":[{"platform":platform,"identityKey":json.dumps(["platform",platform],ensure_ascii=False,separators=(",",":")),"rawMembers":members[platform],"rawCandidateCount":len(members[platform]),"availability":{"status":"available" if members[platform] else "unavailable","reasonCode":None if members[platform] else "no_records"},**result[platform]} for platform in names]}
