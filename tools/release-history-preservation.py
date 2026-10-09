"""Customer-service preservation evidence. No credentials, API or write SQL.

Call capture(connection, scope, key, cutoff=None) with the existing domain
reader connection. Persist only its HMAC fingerprints. Reuse the baseline's
scope, cutoff and key for the after capture. The key stays outside evidence.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from decimal import Decimal

VERSION = "teruisi-customer-history-v1"
IMPORT_FIELDS = (
    "shop_name consulted_at customer_id customer_alias consultation_type agent "
    "transferred_agent skill_group product_sku product_name first_response_at "
    "response_seconds duration_minutes customer_message_count agent_message_count "
    "satisfaction resolved conversation_id match_status match_confidence "
    "chat_started_at chat_ended_at chat_customer_alias messages"
).split()
ANNOTATION_FIELDS = (
    "robot_scope problem_type conversion_status service_issues summary_text "
    "analysis_source analyzed_at annotated_at"
).split()
META_FIELDS = "id conversation_key first_import_batch_id last_import_batch_id version created_at updated_at migration_generation".split()
FIELDS = META_FIELDS + IMPORT_FIELDS + ANNOTATION_FIELDS


def canonical(value):
    def convert(item):
        if isinstance(item, datetime):
            return item.astimezone(timezone.utc).isoformat()
        if isinstance(item, Decimal):
            return str(item.normalize())
        raise TypeError("Unsupported evidence value")
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=convert)


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def timestamp(value):
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00")) if not isinstance(value, datetime) else value
    if result.tzinfo is None:
        raise ValueError("Evidence instant must include a timezone")
    return result.astimezone(timezone.utc)


def validate_scope(scope):
    if set(scope) != {"domain", "shopNames", "startInclusive", "endExclusive", "timezone"} or scope["domain"] != "customer-service" or scope["timezone"] != "Asia/Shanghai":
        raise ValueError("Exact customer-service scope required")
    for name in ("startInclusive", "endExclusive"):
        parsed = datetime.strptime(scope[name], "%Y-%m-%d %H:%M:%S")
        if parsed.strftime("%Y-%m-%d %H:%M:%S") != scope[name]:
            raise ValueError("Invalid business boundary")
    if scope["startInclusive"] >= scope["endExclusive"] or not scope["shopNames"] or len(set(scope["shopNames"])) != len(scope["shopNames"]):
        raise ValueError("Invalid business scope")


def fingerprint_rows(rows, scope, key, cutoff, observed_at, snapshot_witness):
    validate_scope(scope)
    if not isinstance(key, bytes) or len(key) < 32:
        raise ValueError("An external 256-bit evidence key is required")
    cut, observed = timestamp(cutoff), timestamp(observed_at)
    if cut > observed:
        raise ValueError("Cutoff exceeds observed snapshot time")
    def digest(value):
        return hmac.new(key, canonical(value).encode(), hashlib.sha256).hexdigest()
    result = []
    for row in rows:
        if any(field not in row for field in FIELDS):
            raise ValueError("Incomplete domain projection")
        if row["shop_name"] not in scope["shopNames"] or not scope["startInclusive"] <= row["consulted_at"] < scope["endExclusive"]:
            raise ValueError("Row outside exact business scope")
        created = timestamp(row["created_at"])
        if created > observed or timestamp(row["updated_at"]) > observed:
            raise ValueError("Row exceeds consistent snapshot")
        result.append({"id": str(row["id"]), "identity": digest(row["conversation_key"]),
                       "shopName": row["shop_name"], "consultedAt": row["consulted_at"],
                       "createdAt": created.isoformat(), "updatedAt": timestamp(row["updated_at"]).isoformat(),
                       "firstBatchId": row["first_import_batch_id"], "lastBatchId": row["last_import_batch_id"],
                       "version": row["version"], "importDigest": digest({k: row[k] for k in IMPORT_FIELDS}),
                       "migrationGenerationDigest": digest(row["migration_generation"]),
                       "annotationDigest": digest({k: row[k] for k in ANNOTATION_FIELDS}),
                       "rowDigest": digest({k: row[k] for k in FIELDS})})
    if len({r["id"] for r in result}) != len(result) or len({r["identity"] for r in result}) != len(result):
        raise ValueError("Duplicate primary/business identity")
    result.sort(key=lambda row: int(row["id"]))
    core = {"version": VERSION, "scope": scope, "cutoff": cut.isoformat(), "observedAt": observed.isoformat(),
            "keyTag": hashlib.sha256(key).hexdigest(), "snapshotWitness": snapshot_witness,
            "rows": result, "count": len(result)}
    return {**core, "evidenceSha256": sha(core)}


def capture(connection, scope, key, cutoff=None):
    """DB-API connection must be idle; capture runs a single RR READ ONLY txn.

    Stream in batches; all business values are used only in memory for HMAC.
    No production invocation or credential handling is provided by this module.
    """
    validate_scope(scope)
    with connection.cursor() as cursor:
        cursor.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        try:
            cursor.execute("SELECT current_user, current_setting('transaction_read_only'), current_setting('transaction_isolation'), transaction_timestamp(), txid_current_snapshot()::text, has_table_privilege(current_user, 'customer_service_conversations', 'INSERT') OR has_table_privilege(current_user, 'customer_service_conversations', 'UPDATE') OR has_table_privilege(current_user, 'customer_service_conversations', 'DELETE')")
            user, readonly, isolation, observed, snapshot, can_write = cursor.fetchone()
            if user != "teruisi_customer_service_reader" or readonly != "on" or isolation != "repeatable read" or can_write:
                raise ValueError("Exact read-only domain reader required")
            cursor.execute("SELECT " + ",".join(FIELDS) + " FROM customer_service_conversations WHERE shop_name = ANY(%s) AND consulted_at >= %s AND consulted_at < %s ORDER BY id", (scope["shopNames"], scope["startInclusive"], scope["endExclusive"]))
            rows = []
            while items := cursor.fetchmany(1000):
                rows.extend(dict(zip(FIELDS, item)) for item in items)
                if len(rows) > 200_000:
                    raise ValueError("Capture exceeds approved bound")
            return fingerprint_rows(rows, scope, key, cutoff or observed, observed,
                                    {"reader": user, "readOnly": True, "isolation": isolation, "snapshot": snapshot})
        finally:
            cursor.execute("ROLLBACK")


def compare(before, after, transitions=(), source_receipts=None):
    """Transitions are independent exact source witnesses, not update exemptions.

    Each witness binds one before/after row digest, a completed source batch,
    its original raw/content hashes, shop/date range, and the independently
    checked source execution/receipt hash. Deletion and replacement still fail.
    source_receipts maps the expected SHA to original independently reviewed
    transition-receipt bytes. A hash label without those bytes is no evidence.
    """
    if not before or before.get("version") != VERSION or "rows" not in before:
        return {"status": "unprovable", "count": "unprovable", "primaryKeys": "unprovable", "businessContent": "unprovable", "reason": "missing-fixed-row-baseline"}
    for evidence in (before, after):
        core = {k: v for k, v in evidence.items() if k != "evidenceSha256"}
        if sha(core) != evidence.get("evidenceSha256"):
            raise ValueError("Evidence bytes changed")
        if evidence["count"] != len(evidence["rows"]) or len({row["id"] for row in evidence["rows"]}) != evidence["count"] or len({row["identity"] for row in evidence["rows"]}) != evidence["count"]:
            raise ValueError("Incomplete or duplicate row inventory")
        witness = evidence["snapshotWitness"]
        if witness.get("reader") != "teruisi_customer_service_reader" or witness.get("readOnly") is not True or witness.get("isolation") != "repeatable read" or not witness.get("snapshot"):
            raise ValueError("Missing consistent read-only snapshot witness")
    if any(before[k] != after[k] for k in ("scope", "cutoff", "keyTag")) or timestamp(after["observedAt"]) < timestamp(before["observedAt"]):
        raise ValueError("Snapshots do not share the baseline scope/cutoff/key")
    cut = timestamp(before["cutoff"])
    old = {r["id"]: r for r in before["rows"] if timestamp(r["createdAt"]) < cut}
    new = {r["id"]: r for r in after["rows"] if timestamp(r["createdAt"]) < cut}
    all_old = {r["id"]: r for r in before["rows"]}
    deltas, unaccounted, witnessed = [], [], []
    for row in after["rows"]:
        previous = all_old.get(row["id"])
        if previous and row == previous:
            continue
        # An addition must be observed after the original snapshot, not merely
        # after a later maintenance boundary or a caller-selected cutoff.
        kind = "reimport" if previous else "addition"
        delta = {"id": row["id"], "kind": kind, "beforeDigest": previous["rowDigest"] if previous else None, "afterDigest": row["rowDigest"]}
        deltas.append(delta)
        valid = []
        for witness in transitions:
            source = witness.get("source", {})
            try:
                hashes_valid = all(isinstance(source.get(k), str) and len(source[k]) == 64 and all(c in "0123456789abcdef" for c in source[k]) for k in ("rawFileSha256", "contentSha256", "independentReceiptSha256"))
                match = all(witness.get(k) == delta[k] for k in delta)
                raw_receipt = (source_receipts or {}).get(source.get("independentReceiptSha256"))
                source_proof = json.loads(raw_receipt) if isinstance(raw_receipt, bytes) else {}
                proof_source = {k: v for k, v in source.items() if k != "independentReceiptSha256"}
                match = match and isinstance(raw_receipt, bytes) and hashlib.sha256(raw_receipt).hexdigest() == source.get("independentReceiptSha256")
                match = match and source_proof.get("version") == "teruisi-source-transition-v1" and source_proof.get("independent") is True and source_proof.get("source") == proof_source and delta in source_proof.get("transitions", [])
                match = match and hashes_valid and source.get("status") == "completed" and bool(source.get("executionId")) and source.get("batchId") == row["lastBatchId"] and source.get("shopName") == row["shopName"]
                match = match and source["startInclusive"] <= row["consultedAt"] < source["endExclusive"]
                match = match and timestamp(before["observedAt"]) < timestamp(source["completedAt"]) <= timestamp(after["observedAt"])
                if previous:
                    match = match and row["identity"] == previous["identity"] and row["createdAt"] == previous["createdAt"] and row["firstBatchId"] == previous["firstBatchId"] and row["annotationDigest"] == previous["annotationDigest"] and row["migrationGenerationDigest"] == previous["migrationGenerationDigest"] and row["version"] == previous["version"] + 1 and timestamp(row["updatedAt"]) > timestamp(previous["updatedAt"])
                else:
                    match = match and row["firstBatchId"] == row["lastBatchId"] and timestamp(row["createdAt"]) >= timestamp(before["observedAt"])
                if match:
                    valid.append(sha(witness))
            except (KeyError, TypeError, ValueError):
                pass
        if len(valid) == 1:
            witnessed.append({**delta, "sourceWitnessSha256": valid[0]})
        else:
            unaccounted.append(delta)
    removed = sorted(set(all_old) - {r["id"] for r in after["rows"]})
    identities_equal = set(old) == set(new) and all(old[k]["identity"] == new[k]["identity"] for k in old)
    content_equal = identities_equal and all(old[k]["importDigest"] == new[k]["importDigest"] and old[k]["annotationDigest"] == new[k]["annotationDigest"] for k in old)
    return {"status": "passed" if not removed and identities_equal and not unaccounted else "failed",
            "count": "equal" if len(old) == len(new) else "changed", "beforeCount": len(old), "afterCount": len(new),
            "primaryKeys": "equal" if identities_equal else "changed", "businessContent": "equal" if content_equal else "changed",
            "strictBusinessContentPreserved": content_equal, "removedIds": removed,
            "legalTransitions": witnessed, "unaccountedTransitions": unaccounted,
            "baselineSha256": before["evidenceSha256"], "afterSha256": after["evidenceSha256"]}
