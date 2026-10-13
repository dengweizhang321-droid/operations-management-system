from common.import_recovery import recovery_query, reconcile, recovery_rules_digest
from .errors import ErpReferenceApiError
from .models import ErpReferenceImportAttempt, ErpReferenceImportScopeHead, ErpReferenceRawUploadSession
from .import_service import SOURCE_SCOPE_KEYS, get_import_batch


def read_recovery(params, actor_email):
    try:
        query = recovery_query(params, {"source"})
        source = query["source"]
        if source not in SOURCE_SCOPE_KEYS:
            raise ValueError("恢复来源无效")
    except (ValueError, TypeError) as error:
        raise ErpReferenceApiError(str(error)) from error
    head = ErpReferenceImportScopeHead.objects.get(source_key=source, scope_key=SOURCE_SCOPE_KEYS[source])
    scope = {"source": source}
    result = {"ok": True, "version": "import-recovery-query-v1", "scope": scope, "stateToken": head.state_token, "rulesDigest": recovery_rules_digest("erp_reference")}
    if query["recovery"] == "scope":
        return {**result, "status": "waiting" if head.status != "ready" else "ready"}
    audits = ErpReferenceImportAttempt.objects.filter(actor_email=actor_email, source_key=source,
        scope_key=head.scope_key, raw_file_hash=query["rawFileHash"], file_name=query["fileName"], file_size_bytes=query["fileSizeBytes"])
    sessions = ErpReferenceRawUploadSession.objects.filter(actor_email=actor_email, source_key=source,
        fingerprint=query["fingerprint"], file_name=query["fileName"], file_size_bytes=query["fileSizeBytes"])
    if "uploadId" in query:
        audits = audits.filter(raw_upload_id=query["uploadId"])
        sessions = sessions.filter(id=query["uploadId"])
    else:
        from django.db.models import Q
        audits = audits.filter(Q(upload_fingerprint=query["fingerprint"]) | Q(upload_fingerprint=""))
    def batch_reader(batch_id):
        batch = get_import_batch(source, batch_id)
        if batch:
            batch["currentEffective"] = head.current_batch_id == batch_id and head.status == "ready" and batch["ownedRowCount"] == batch["rowCount"]
        return batch
    return {**result, **reconcile(attempts=audits, sessions=sessions, batch_reader=batch_reader)}
