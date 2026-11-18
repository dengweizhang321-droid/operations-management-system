import json
from django.db.models import Count, Q
from common.import_recovery import recovery_query, reconcile, recovery_rules_digest
from .models import SalesImportAttempt, SalesImportBatch, SalesImportScopeHead, SalesRawUploadSession, SalesOrderLine
from .write_service import _scope_key, _scope_material, batch_payload, validate_import_date_range, validate_import_channels, SalesImportServiceError


def read_recovery(params, actor_email):
    try:
        query = recovery_query(params, {"startDate", "endDate", "channels"})
        start, end = validate_import_date_range(query["startDate"], query["endDate"])
        channels = validate_import_channels(json.loads(query["channels"]))
    except (ValueError, TypeError) as error:
        raise SalesImportServiceError(str(error), status=400) from error
    scope = _scope_material(start, end, channels)
    head = SalesImportScopeHead.objects.filter(scope_key=_scope_key()).first()
    result = {"ok": True, "version": "import-recovery-query-v1", "scope": scope, "stateToken": head.state_token if head else "initial", "rulesDigest": recovery_rules_digest("sales")}
    if query["recovery"] == "scope":
        return {**result, "status": "waiting" if head and head.status != "ready" else "ready"}
    audits = SalesImportAttempt.objects.filter(actor_email=actor_email, domain="sales", scope_json=scope,
        raw_file_hash=query["rawFileHash"], file_name=query["fileName"], file_size_bytes=query["fileSizeBytes"])
    sessions = SalesRawUploadSession.objects.filter(actor_email=actor_email, expected_start_date=start, expected_end_date=end,
        expected_channels=list(channels) if channels else None, client_fingerprint=query["fingerprint"],
        file_name=query["fileName"], file_size_bytes=query["fileSizeBytes"])
    if "uploadId" in query:
        audits = audits.filter(raw_upload_id=query["uploadId"])
        sessions = sessions.filter(id=query["uploadId"])
    else:
        audits = audits.filter(Q(upload_fingerprint=query["fingerprint"]) | Q(upload_fingerprint=""))
    def batch_reader(batch_id):
        batch = SalesImportBatch.objects.filter(id=batch_id, scope_json=scope).first()
        if not batch:
            return None
        rows = SalesOrderLine.objects.filter(business_date__gte=start, business_date__lte=end, is_business_row=True)
        if channels:
            rows = rows.filter(channel__in=channels)
        # One aggregate over the date range: avoids a separate NOT-matching EXISTS probe that the
        # planner can turn into a full-table scan when no foreign rows exist.
        counts = rows.aggregate(total=Count("id"), owned=Count("id", filter=Q(last_import_batch_id=batch_id)))
        owned = counts["owned"]
        return {**batch_payload(batch), "ownedRowCount": owned,
            "currentEffective": owned == batch.row_count and counts["total"] == owned}
    return {**result, **reconcile(attempts=audits, sessions=sessions, batch_reader=batch_reader)}
