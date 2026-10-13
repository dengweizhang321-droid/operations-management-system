from common.import_recovery import recovery_query, reconcile, recovery_rules_digest
from .errors import InventoryApiError
from .models import InventoryImportAttempt, InventoryImportBatch, InventoryImportScopeHead, InventoryRawUploadSession
from .import_service import _batch_payload, _stored_content
from .query import _latest_batch


def read_recovery(params, actor_email):
    try:
        query = recovery_query(params, {"dataset", "snapshotDate"})
        if query["dataset"] not in {"stock", "age"}:
            raise ValueError("恢复来源无效")
    except (ValueError, TypeError) as error:
        raise InventoryApiError(str(error)) from error
    dataset = query["dataset"]
    scope = {"dataset": dataset, "snapshotDate": query["snapshotDate"]}
    head = InventoryImportScopeHead.objects.get(dataset=dataset)
    result = {"ok": True, "version": "import-recovery-query-v1", "scope": scope, "stateToken": head.state_token, "rulesDigest": recovery_rules_digest("inventory")}
    if query["recovery"] == "scope":
        return {**result, "status": "waiting" if head.status != "ready" else "ready"}
    audits = InventoryImportAttempt.objects.filter(actor_email=actor_email, dataset=dataset, scope_json=scope,
        scope_key=head.scope_key, raw_file_hash=query["rawFileHash"], metadata__fileName=query["fileName"], metadata__fileSizeBytes=query["fileSizeBytes"])
    sessions = InventoryRawUploadSession.objects.filter(actor_email=actor_email, dataset=dataset, snapshot_date=query["snapshotDate"],
        fingerprint=query["fingerprint"], file_name=query["fileName"], file_size_bytes=query["fileSizeBytes"])
    if "uploadId" in query:
        audits = audits.filter(metadata__rawUploadId=query["uploadId"])
        sessions = sessions.filter(id=query["uploadId"])
    else:
        audits = audits.filter(metadata__uploadFingerprint=query["fingerprint"])
    def batch_reader(batch_id):
        batch = InventoryImportBatch.objects.filter(id=batch_id, dataset=dataset, snapshot_date=query["snapshotDate"]).first()
        if not batch:
            return None
        count, digest = _stored_content(batch)
        selected = _latest_batch(dataset)
        current = selected is not None and selected.id == batch_id
        matches = count == batch.row_count and digest == batch.content_hash
        return {**_batch_payload(batch), "ownedRowCount": count,
            "evidenceConflict": current and not matches, "currentEffective": current and matches}
    return {**result, **reconcile(attempts=audits, sessions=sessions, batch_reader=batch_reader)}
