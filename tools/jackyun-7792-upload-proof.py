"""Read-only proof for the single already-committed Jackyun 7792 upload.

Use the existing sales writer role for its private coordination tables, but
force a read-only transaction. Never return actor identity, owner tokens,
connection credentials, chunk contents, or sales rows.
"""
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone

import psycopg

UPLOAD = "c47722e2-b62a-42b2-82c9-74488286f6ce"
BATCH = "2144b5de068d68c25845745e59f9512ff843951709bd7032e4909fa5d1b0c782"
RAW_SHA = "6b0b87c26042e17548c8f74a72e04fb5aadd6fbe7f99d1f47319fb84851f302b"
ACTOR = "local-admin@teruisi.local"


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def collect():
    with psycopg.connect(
        host="127.0.0.1", port=5432, dbname="teruisi_sales",
        user="teruisi_sales_writer", connect_timeout=5,
        options="-c default_transaction_read_only=on -c statement_timeout=10000 "
                "-c lock_timeout=1000 -c application_name=jackyun_7792_receipt_proof",
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user,current_database(),inet_server_port(),current_setting('transaction_read_only')")
            require(cursor.fetchone() == ("teruisi_sales_writer", "teruisi_sales", 5432, "on"), "Wrong readonly source")
            cursor.execute("""SELECT status,file_size_bytes,chunk_count,received_chunk_count,
                received_bytes,expected_start_date,expected_end_date,expected_channels,
                client_fingerprint,owner_generation,result_batch_id,updated_at,expires_at
                FROM sales_raw_upload_sessions WHERE id=%s AND actor_email=%s""", (UPLOAD, ACTOR))
            row = cursor.fetchone()
            require(row is not None, "Original upload missing")
            status, size, count, received, received_bytes, start, end, channels, fingerprint, generation, linked, updated, expires = row
            require(status in ("processing", "completed"), "Upload state cannot be reconciled")
            require(str(start) == "2026-08-26" and str(end) == "2026-10-09" and channels is None, "Upload scope changed")
            require(size == 9121487 and count == 5 and received == 5 and received_bytes == size, "Upload size changed")
            scope = json.dumps({"startDate": str(start), "endDate": str(end), "channels": None}, separators=(",", ":"))
            expected_fingerprint = "sales-upload-v2:" + hashlib.sha256(scope.encode()).hexdigest() + ":" + hashlib.sha256(RAW_SHA.encode()).hexdigest()
            require(fingerprint == expected_fingerprint, "Upload fingerprint changed")
            cursor.execute("""SELECT id,status,result_batch_id,raw_file_hash,expected_start_date,
                expected_end_date,expected_channels,file_size_bytes FROM sales_staged_import_sessions
                WHERE raw_upload_id=%s AND actor_email=%s ORDER BY created_at""", (UPLOAD, ACTOR))
            staged = cursor.fetchall()
            require(len(staged) == 1, "Normalized session is not unique")
            session = staged[0]
            require(session[1:4] == ("completed", BATCH, RAW_SHA), "Normalized import is not committed")
            require(str(session[4]) == str(start) and str(session[5]) == str(end) and session[6] is None and session[7] == size, "Normalized scope changed")
            cursor.execute("SELECT status,row_count,raw_file_hash FROM sales_import_batches WHERE id=%s", (BATCH,))
            require(cursor.fetchone() == ("completed", 38574, RAW_SHA), "Committed batch changed")
            payload_sha = None
            if status == "processing":
                digest = hashlib.sha256()
                cursor.execute("SELECT chunk_index,size_bytes,sha256,payload FROM sales_raw_upload_chunks WHERE session_id=%s ORDER BY chunk_index", (UPLOAD,))
                chunks = cursor.fetchall()
                require(len(chunks) == count, "Raw chunks missing")
                total = 0
                for expected_index, (index, chunk_size, sha, payload) in enumerate(chunks):
                    payload = bytes(payload)
                    require(index == expected_index and len(payload) == chunk_size and hashlib.sha256(payload).hexdigest() == sha, "Raw chunk changed")
                    digest.update(payload)
                    total += len(payload)
                require(total == size and digest.hexdigest() == RAW_SHA, "Assembled upload changed")
                payload_sha = digest.hexdigest()
            else:
                require(linked == BATCH, "Completed upload points elsewhere")
            now = datetime.now(timezone.utc)
            require(expires > now, "Upload expired")
            return {"version": 1, "readOnly": True, "uploadId": UPLOAD.replace("-", ""),
                "status": status, "ownerGeneration": generation, "resultBatchId": linked or None,
                "normalizedSessionId": str(session[0]), "normalizedStatus": "completed",
                "batchId": BATCH, "rawFileHash": RAW_SHA, "payloadSha256": payload_sha,
                "fileSizeBytes": size, "startDate": str(start), "endDate": str(end),
                "channels": None, "actorVerified": True, "updatedAt": updated.isoformat(),
                "expiresAt": expires.isoformat(), "observedAt": now.isoformat(),
                "claimEligible": status == "completed" or updated <= now - timedelta(minutes=30)}


if __name__ == "__main__":
    try:
        print(json.dumps(collect(), ensure_ascii=True))
    except Exception as error:
        # Do not propagate a psycopg error/connection string or arbitrary data.
        print(json.dumps({"ok": False, "error": str(error) if isinstance(error, RuntimeError) else "Readonly upload proof failed"}))
        sys.exit(1)
