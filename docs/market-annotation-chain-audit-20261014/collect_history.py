"""Collect a bounded, read-only production history and never-attempted samples.

The password comes from an ephemeral process environment. Private samples are
written outside the checkout; neither credentials nor raw products enter Git.
"""
import argparse
import json
import os
from pathlib import Path
import time

import psycopg
from psycopg.rows import dict_row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--job", required=True)
    parser.add_argument("--sample-count", type=int, default=4, choices=range(1, 7))
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if not output.is_relative_to(Path("D:/codex-artifacts").resolve()):
        raise RuntimeError("Evidence must remain outside the source checkout")
    output.mkdir(parents=True, exist_ok=True)
    conn = psycopg.connect(
        host="127.0.0.1", port=5432, dbname="teruisi_sales",
        user="teruisi_market_reader",
        password=os.environ["TERUISI_CHAIN_READER_PASSWORD"],
        connect_timeout=5,
        options="-c default_transaction_read_only=on -c statement_timeout=12000",
        row_factory=dict_row,
    )
    evidence = {"source": "production read-only market reader", "events": []}
    with conn:
        with conn.cursor() as cursor:
            cursor.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            cursor.execute("SELECT now() observed_at, current_user, current_setting('transaction_read_only') read_only")
            evidence["observation"] = cursor.fetchone()
            if evidence["observation"]["read_only"] != "on":
                raise RuntimeError("Read-only transaction is required")
            cursor.execute("""SELECT j.id,j.category,j.model_id,j.prompt_version_id,j.created_at,j.started_at,
                j.updated_at,p.prompt_body,p.segments_json
                FROM market_annotation_jobs j JOIN market_annotation_prompt_versions p ON p.id=j.prompt_version_id
                WHERE j.id=%s""", (args.job,))
            job = cursor.fetchone()
            if not job:
                raise RuntimeError("Expected job was not found")
            evidence["job"] = {k: v for k, v in job.items() if k not in {"prompt_body", "segments_json"}}
            cursor.execute("""SELECT created_at,action,after_json->>'state' state
                FROM market_master_audit_logs WHERE entity_id=%s
                AND action IN ('create_market_annotation_job','set_market_annotation_cloud_run_state','market_annotation_model_completed')
                ORDER BY created_at LIMIT 200""", (args.job,))
            evidence["events"] = cursor.fetchall()
            cursor.execute("""SELECT status,attempt_count,error_message,count(*) count,
                min(updated_at) first_update,max(updated_at) last_update
                FROM market_annotation_items WHERE job_id=%s
                GROUP BY status,attempt_count,error_message ORDER BY status,attempt_count""", (args.job,))
            evidence["outcomes"] = cursor.fetchall()
            cursor.execute("""SELECT state,last_failure_code,last_failure_message,last_started_at,
                last_heartbeat_at,updated_at FROM market_annotation_cloud_runs WHERE job_id=%s""", (args.job,))
            evidence["run"] = cursor.fetchone()
            samples = []
            for mode, fixed in (("A", False), ("B", True)):
                cursor.execute("""SELECT i.id,i.sku_code,i.product_name,i.brand,i.source_image_url,
                    i.image_content_sha256,i.reviewed_segment,c.object_key,c.mime_type,c.size_bytes
                    FROM market_annotation_items i JOIN market_image_cache c
                      ON c.source_url=i.source_image_url AND c.content_sha256=i.image_content_sha256 AND c.status='ready'
                    WHERE i.job_id=%s AND i.status='queued' AND i.attempt_count=0
                      AND ((i.reviewed_segment=ANY(%s))=%s)
                    ORDER BY i.id LIMIT %s""", (args.job, job["segments_json"], fixed, args.sample_count))
                for index, row in enumerate(cursor.fetchall(), 1):
                    samples.append({
                        "sampleId": f"{mode}{index}", "mode": mode,
                        "sourceItemId": row["id"], "modelId": job["model_id"],
                        "skuCode": row["sku_code"], "productName": row["product_name"],
                        "brand": row["brand"], "imageUrl": row["source_image_url"],
                        "imageContentSha256": row["image_content_sha256"],
                        "promptBody": job["prompt_body"], "segments": job["segments_json"],
                        "fixedSegment": row["reviewed_segment"] if fixed else None,
                        "imageCache": {"objectKey": row["object_key"], "contentSha256": row["image_content_sha256"],
                                       "mimeType": row["mime_type"], "sizeBytes": row["size_bytes"]},
                    })
            evidence["sampleSummary"] = [{"sampleId": s["sampleId"], "mode": s["mode"],
                "imageBytes": s["imageCache"]["sizeBytes"], "sourceAttemptCount": 0} for s in samples]
        conn.rollback()
    old_path = output / "samples.private.json"
    if old_path.exists():
        old = json.loads(old_path.read_text(encoding="utf-8"))
        for prior in old:
            current = next((s for s in samples if s["sampleId"] == prior["sampleId"]), None)
            if current != prior:
                raise RuntimeError("Sample extension changed an existing comparison input")
    history_path = output / ("history.json" if not (output / "history.json").exists() else f"history-{time.time_ns()}.json")
    history_path.write_text(json.dumps(evidence, ensure_ascii=False, default=str, indent=2), encoding="utf-8")
    (output / "samples.private.json").write_text(json.dumps(samples, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"history": str(output / "history.json"), "sampleCount": len(samples),
                      "productionWrites": 0, "modelCalls": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
