"""Durable, independently paged data exports for Pi's container workspace.

No pandas or generated Python executes in Django. Resource limits fail closed;
they never turn a prefix, TOP result, or clipped field into a complete export.
"""
import hashlib
import json
import os
import re

from django.utils import timezone
from . import datasets, pandas_sandbox, pi_service as service
from .pi_models import PiSession, PiOperation, PiExport, PiExportPage
from .policy import AiError, canonical, digest, fields, identifier, mutation, passive, scope_covers, uid

PI_PAGED = {"pi_netshop_product_daily", "pi_netshop_promotion"}


def pi_page(data, rows, args, expected_total, expected_revision):
    page = data.get("pagination")
    if not isinstance(page, dict):
        raise AiError("Pi 数据来源缺少分页证明")
    p, size, total = (page.get(key) for key in ("page", "pageSize", "total"))
    revision = data.get("sourceRevision")
    if (type(p) is not int or p != args.get("page", 1) or type(size) is not int or size != args.get("limit", 20)
            or not 1 <= size <= 20 or type(total) is not int or total < 0
            or expected_total is not None and total != expected_total
            or len(rows) != max(0, min(size, total-(p-1)*size)) or page.get("returned", len(rows)) != len(rows)
            or not isinstance(revision, str) or not revision or expected_revision is not None and revision != expected_revision
            or data.get("truncatedFields")):
        raise AiError("Pi 来源分页、字段或版本不完整，未声明完整导出")
    more = p*size < total
    if any(type(page.get(key)) is not bool or page[key] != more for key in ("hasMore", "truncated") if key in page):
        raise AiError("Pi 来源分页标记不一致")
    if not any(key in page for key in ("hasMore", "truncated")):
        raise AiError("Pi 来源缺少末页证明")
    for key in ("platform", "shop"):
        if key in args:
            applied = data.get("filtersApplied", {})
            if (key == "platform" and applied.get("platforms") != [args[key]]) or (key == "shop" and applied.get("shop") != args[key]):
                raise AiError("Pi 来源筛选证明与本轮店铺不一致", "access_denied", 403)
    return more, total, revision


def export_record(row):
    result = {"id": row.id, "exportId": row.id, "status": row.status, "progress": json.loads(row.progress_json),
        "manifest": json.loads(row.manifest_json), "errorCode": row.error_code}
    if row.file_id:
        result["file"] = service.file_record(row.file)
    return result


def consumer(payload, principal, request_id):
    if payload.get("operation") == "pi-export-status":
        fields(payload, {"operation", "exportId", "surface"}, {"operation", "exportId"})
        row = PiExport.objects.filter(id=identifier(payload["exportId"])).first()
        if not row:
            raise AiError("Pi 导出不存在", "not_found", 404)
        session = service.get_session(row.operation.session_id, principal)
        if session.status == "frozen" or row.operation.generation != session.generation or not scope_covers(principal.scope, row.operation.scope_json):
            raise AiError("Pi 导出已隔离", "not_found", 404)
        return export_record(row)
    fields(payload, {"operation", "sessionId", "operationId", "dataset", "queryJson", "collection", "columns", "surface"}, {"operation", "dataset", "queryJson"})
    if "operationId" in payload:
        bound_operation = PiOperation.objects.filter(id=identifier(payload["operationId"])).first()
        if not bound_operation:
            raise AiError("Pi 执行操作不存在", "not_found", 404)
        session_id = bound_operation.session_id
        if "sessionId" in payload and payload["sessionId"] != session_id:
            raise AiError("Pi 导出会话绑定不匹配", "access_denied", 403)
    elif "sessionId" in payload:
        session_id = payload["sessionId"]
        bound_operation = None
    else:
        raise AiError("Pi 导出缺少受信执行身份", "access_denied", 403)
    if payload.get("surface", "pi_agent") != "pi_agent":
        raise AiError("Pi 导出入口无效", "access_denied", 403)
    dataset = identifier(payload["dataset"])
    query_raw = payload["queryJson"]
    if not isinstance(query_raw, str) or len(query_raw.encode()) > 16000:
        raise AiError("Pi 导出查询无效")
    try:
        query = json.loads(query_raw)
    except (ValueError, TypeError) as error:
        raise AiError("Pi 导出查询不是 JSON 对象") from error
    passive(query, 16000)
    if not isinstance(query, dict) or set(query) & {"cursor", "textOffset"} or query.get("page", 1) != 1:
        raise AiError("Pi 导出必须从完整范围第一页开始")
    records = dataset in datasets.record_catalog.SPECS
    if not records and dataset not in pandas_sandbox.PAGED_DATASETS and dataset not in PI_PAGED:
        raise AiError("来源没有完整分页契约，不能把 TOP 或聚合结果声明为完整导出")
    path = payload.get("collection", "rows" if records else "items")
    if not isinstance(path, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,3}", path) or records and path != "rows":
        raise AiError("导出 collection 无效")
    columns = payload.get("columns")
    if columns is not None:
        pandas_sandbox.select_columns([], columns)
    with mutation(principal):
        session = service.get_session(session_id, principal, lock=True)
        op = PiOperation.objects.filter(id=session.active_operation_id, status="running").first()
        if not op or bound_operation is not None and bound_operation.id != op.id:
            raise AiError("Pi 导出必须绑定当前执行操作", "conflict", 409)
        service.principal_for(op)
        if not scope_covers(principal.scope, op.scope_json):
            raise AiError("Pi 导出权限不匹配", "access_denied", 403)
        from . import pi_selection
        query = pi_selection.validate_dataset(dataset, query, pi_selection.for_operation(op))
        request = {"dataset": dataset, "query": query, "collection": path, "columns": columns}
        binding = digest(request)
        row, _ = PiExport.objects.get_or_create(operation=op, request_digest=binding,
            defaults={"id": uid("pi-export"), "query_json": canonical(request)})
        return export_record(row)


def claim():
    with mutation():
        row = PiExport.objects.select_for_update().filter(status="queued").order_by("created_at", "id").first()
        if row:
            row.status, row.updated_at = "running", timezone.now()
            row.save(update_fields=["status", "updated_at"])
        return row


def perform(row):
    # A crashed export only contains read effects. It is marked failed by the
    # worker startup audit; it is never silently restarted with a fresh query.
    op = row.operation
    request = json.loads(row.query_json)
    dataset, query, path = request["dataset"], request["query"], request["collection"]
    records = dataset in datasets.record_catalog.SPECS
    args, cursors, count, used, pages, total = dict(query), set(), 0, 0, 0, None
    expected_revision = None
    first, last = None, None
    max_rows = int(os.getenv("PI_EXPORT_MAX_ROWS", "100000"))
    max_pages = int(os.getenv("PI_EXPORT_MAX_PAGES", "10000"))
    if not 2001 <= max_rows <= 1000000 or not 21 <= max_pages <= 20000:
        raise AiError("Pi 导出资源配置无效", "service_unavailable", 503)
    try:
        while True:
            principal = service.principal_for(PiOperation.objects.get(pk=op.pk))
            from . import pi_selection
            args = pi_selection.validate_dataset(dataset, args, pi_selection.for_operation(op))
            if pages >= max_pages:
                raise AiError("Pi 导出达到页资源限额，未声明完整", "payload_too_large", 413)
            envelope = datasets.query(dataset, {"query": args}, principal, f"{row.id}.{pages}", surface="pi_agent")
            first, last = first or envelope, envelope
            data = envelope["data"]
            parent, current = pandas_sandbox.collection(data, path)
            if records:
                if (type(data.get("hasMore")) is not bool or data.get("truncatedFields")
                        or any(v.get("nextOffset") is not None for v in data.get("cellWindows", {}).values())):
                    raise AiError("源字段截断，导出不完整")
                more, cursor = data["hasMore"], data.get("nextCursor")
                if (more and (not current or not isinstance(cursor, str) or not cursor or cursor in cursors)
                        or not more and (cursor is not None or data.get("truncated"))):
                    raise AiError("源分页或截断标志不一致")
            elif dataset in PI_PAGED:
                if path != "items":
                    raise AiError("Pi 网店分页必须使用 items")
                more, total, expected_revision = pi_page(data, current, args, total, expected_revision)
                cursor = None
            else:
                more, total = pandas_sandbox.native_page(dataset, data, path, parent, current, args, total)
                cursor = None
            projected = pandas_sandbox.select_columns(current, request["columns"])
            encoded = canonical(projected)
            count, used, pages = count+len(projected), used+len(encoded.encode()), pages+1
            if count > max_rows or used > service.MAX_OUTPUT_FILE - 100000:
                raise AiError("Pi 导出达到行数或字节资源限额，未声明完整", "payload_too_large", 413)
            provenance = {"source": envelope.get("source"), "dataCutoffDate": envelope.get("dataCutoffDate"),
                "queriedAt": envelope.get("queriedAt"), "freshness": envelope.get("freshness"),
                "domainRevision": data.get("domainRevision", data.get("sourceRevision", data.get("revision"))),
                "fields": data.get("columns"), "units": data.get("units"), "rows": len(projected)}
            with mutation():
                service.principal_for(PiOperation.objects.get(pk=op.pk))
                PiExportPage.objects.create(id=uid("pi-export-page"), export=row, ordinal=pages,
                    rows_json=encoded, provenance_json=canonical(provenance))
                row.progress_json, row.updated_at = canonical({"rows": count, "pages": pages, "bytes": used}), timezone.now()
                row.save(update_fields=["progress_json", "updated_at"])
            if not more:
                break
            if records:
                cursors.add(cursor)
                args = {**query, "cursor": cursor}
            else:
                args = {**query, "page": pages+1, "limit": data["pagination"]["pageSize"]}
        rows, sources = [], []
        for page in PiExportPage.objects.filter(export=row).order_by("ordinal"):
            rows.extend(json.loads(page.rows_json))
            sources.append(json.loads(page.provenance_json))
        raw = canonical({"dataset": dataset, "rows": rows}).encode()
        fields_spec = datasets.record_catalog.SPECS.get(dataset, {}).get("fields", {})
        columns = request["columns"] or (list(rows[0]) if rows else query.get("columns", []))
        revisions = list(dict.fromkeys(canonical(item["domainRevision"]) for item in sources))
        units = last["data"].get("units", {name: fields_spec.get(name, {}).get("unit") for name in columns})
        warnings = []
        if any(item["domainRevision"] is None for item in sources): warnings.append("source_revision_unknown")
        if len(revisions)>1: warnings.append("source_revision_changed")
        if last.get("dataCutoffDate") is None: warnings.append("data_cutoff_unknown")
        if not units or any(value is None for value in units.values()): warnings.append("field_units_incomplete")
        manifest = {"schemaVersion": 1, "dataset": dataset, "query": query, "collection": path, "fields": columns,
            "units": units, "warnings": warnings, "snapshotComplete": False,
            "sourceDomain": first["source"].get("domain"), "domainRevisions": [json.loads(item) for item in revisions],
            "dataCutoffDate": last.get("dataCutoffDate"), "rows": count, "pages": pages, "complete": True,
            "sha256": hashlib.sha256(raw).hexdigest(), "consistency": "live_per_page", "pageProvenanceSha256": digest(sources),
            "revisionCoverage": "observed" if all(item["domainRevision"] is not None for item in sources) else "unknown"}
        with mutation():
            service.principal_for(PiOperation.objects.get(pk=op.pk))
            session = PiSession.objects.select_for_update().get(pk=op.session_id)
            f = service.save_file(session, op, row.id, f"{dataset}.json", "application/json", raw, direction="export", manifest=manifest)
            row.file, row.status, row.manifest_json, row.updated_at = f, "succeeded", canonical(manifest), timezone.now()
            row.save()
    except Exception as error:
        with mutation():
            row.status, row.error_code, row.updated_at = "failed", getattr(error, "code", "pi_export_failed"), timezone.now()
            row.save(update_fields=["status", "error_code", "updated_at"])
        if not isinstance(error, AiError):
            raise
