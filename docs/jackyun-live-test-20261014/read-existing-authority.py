"""Read the previously authorized retry receipt; no new authorization or dispatch."""
import json
import os
from pathlib import Path
import psycopg

with psycopg.connect(os.environ["JACKYUN_AUDIT_READ_DSN"]) as connection:
    connection.execute("SET TRANSACTION READ ONLY")
    rows = connection.execute(
        "SELECT request_id,status,response_status,response_payload "
        "FROM workflow_write_request_receipts "
        "WHERE path=%s AND method='POST' AND created_at >= %s "
        "AND response_payload->>'logicalExecutionId'='8548' ORDER BY created_at",
        ("/api/workflow/jackyun-recovery-authority", "2026-10-14T00:00:00+08:00"),
    ).fetchall()
    result = [dict(zip(("requestId", "status", "responseStatus", "authority"), row)) for row in rows]
    destination = Path(r"D:\codex-artifacts\jackyun-live-test-20261014\existing-human-authority.json")
    with destination.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({"receipts": len(result), "readOnly": True, "output": str(destination)}))
