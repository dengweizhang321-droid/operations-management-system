"""Explicit cache maintenance; default dry-run, bounded, no business imports.

Each successful batch advances the *existing* global revision/digest. Existing
pagination tokens become stale. Receipts are metadata only and create-only;
JSON snapshots remain memory/SQL parameters and never reach output or files.
"""
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import uuid
import time
from contextlib import contextmanager

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from netshop.import_service import _bump_global_revision
from netshop.models import NetshopDataRevision
from netshop.promotion_presence import FIELDS, RULE, cache_values

MAX_BYTES = 2 * 1024 * 1024
BATCH_SECONDS = 5


class CasMiss(Exception):
    pass


def decode_snapshot(snapshot):
    # SQL NULL and non-object roots both produce missing bits. Decimal prevents
    # historical arbitrary JSONB numbers being rounded or becoming infinity.
    return None if snapshot is None else json.loads(
        snapshot, parse_int=Decimal, parse_float=Decimal,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("invalid JSON number")),
    )


def apply_snapshot(cursor, record, values):
    """Exact JSONB CAS; a miss rolls back even the BEFORE-statement marker."""
    row_id, row_hash, batch_id, snapshot = record[:4]
    try:
        with transaction.atomic():
            cursor.execute(
                "UPDATE netshop_rows SET " + ", ".join(f"{name}=%s" for name in FIELDS) +
                ' WHERE id=%s AND source COLLATE "C"=%s AND dataset COLLATE "C"=%s'
                ' AND source_row_hash COLLATE "C"=%s AND last_import_batch_id COLLATE "C"=%s'
                " AND metrics_json IS NOT DISTINCT FROM %s::jsonb",
                [*(values[name] for name in FIELDS), row_id, "jd_promotion", "ad",
                 row_hash, batch_id, snapshot],
            )
            if cursor.rowcount != 1:
                raise CasMiss()
        return True
    except CasMiss:
        return False


@contextmanager
def bounded_batch():
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT setting::integer FROM pg_settings WHERE name='statement_timeout'")
            configured = cursor.fetchone()[0]
        cap = min(configured, 7000) if configured else 7000
        deadline = time.monotonic() + BATCH_SECONDS
        def bounded(execute, sql, params, many, context):
            # Cleanup is still allowed after expiry; no additional owning SQL.
            if sql.lstrip().upper().startswith(("ROLLBACK", "RELEASE SAVEPOINT")):
                return execute(sql, params, many, context)
            remaining = int((deadline - time.monotonic()) * 1000)
            if remaining <= 0:
                raise CommandError("缓存批事务超过5秒，整批回滚")
            execute("SELECT set_config('statement_timeout', %s, true)",
                    [str(min(cap, remaining)) + "ms"], False, context)
            return execute(sql, params, many, context)
        with connection.execute_wrapper(bounded):
            yield
            if time.monotonic() >= deadline:
                raise CommandError("缓存批事务超过5秒，整批回滚")


def run_batch(after_id, batch_size, execute, maintenance_id, batch_number):
    with bounded_batch():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout = '1000ms'")
            if execute:
                # Same lock order as the original BEFORE-statement revision
                # guard: global revision first, then any owning row locks.
                NetshopDataRevision.objects.select_for_update(nowait=True).get(domain="netshop")
            cursor.execute(
                "SELECT id,source_row_hash,last_import_batch_id,metrics_json::text," +
                ",".join(FIELDS) +
                ' FROM netshop_rows WHERE source COLLATE "C"=%s AND dataset COLLATE "C"=%s'
                " AND id>%s ORDER BY id LIMIT %s",
                ["jd_promotion", "ad", after_id, batch_size],
            )
            records = cursor.fetchall()
            if sum(len((record[3] or "").encode("utf-8")) for record in records) > MAX_BYTES:
                raise CommandError("批次JSON超过2MiB，未更新；请减小batch-size")
            changed = misses = already = 0
            for record in records:
                values = cache_values("jd_promotion", "ad", decode_snapshot(record[3]), record[1], record[2])
                if tuple(values[name] for name in FIELDS) == tuple(record[4:]):
                    already += 1
                elif not execute or apply_snapshot(cursor, record, values):
                    changed += 1
                else:
                    misses += 1
            revision = None
            if execute and changed:
                label = f"cache-maintenance:{maintenance_id}:{batch_number}"
                receipt_hash = hashlib.sha256(json.dumps(
                    [RULE, label, after_id, records[-1][0], changed, misses],
                    separators=(",", ":"),
                ).encode()).hexdigest()
                revision = _bump_global_revision(label, receipt_hash, "cache-only:" + RULE)
            return {"scanned": len(records), "changed" if execute else "wouldChange": changed,
                    "casMiss": misses, "alreadyCurrent": already,
                    "afterId": records[-1][0] if records else after_id,
                    "revision": revision, "tokensInvalidated": bool(revision)}


def write_receipt(directory, name, data):
    with (directory / name).open("x", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, sort_keys=True)
        stream.write("\n")


class Command(BaseCommand):
    help = "JD/ad派生presence缓存维护（默认dry-run；真实更新会推进原revision并使token失效）"

    def add_arguments(self, parser):
        parser.add_argument("--execute", action="store_true")
        parser.add_argument("--confirmed-cache-only", action="store_true")
        parser.add_argument("--progress-dir", required=True)
        parser.add_argument("--after-id", type=int, default=0)
        parser.add_argument("--batch-size", type=int, default=50)
        parser.add_argument("--max-batches", type=int, default=1)

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            raise CommandError("仅支持PostgreSQL精确JSONB CAS")
        if options["execute"] != options["confirmed_cache_only"]:
            raise CommandError("execute必须与confirmed-cache-only同时明确提供")
        if not (1 <= options["batch_size"] <= 250 and 1 <= options["max_batches"] <= 100
                and options["after_id"] >= 0):
            raise CommandError("batch-size 1..250 / max-batches 1..100 / after-id>=0")
        directory = Path(options["progress_dir"]).absolute()
        if any(part.is_symlink() or getattr(part, "is_junction", lambda: False)()
               for part in [directory, *directory.parents]):
            raise CommandError("progress-dir不可使用符号链接")
        try:
            directory.mkdir(parents=False, exist_ok=False)
        except OSError:
            raise CommandError("progress-dir必须是现存父目录下全新目录") from None
        run_id = uuid.uuid4().hex
        common = {"runId": run_id, "kind": "cache-maintenance", "rule": RULE,
                  "execute": options["execute"], "businessSuccess": False,
                  "revisionPolicy": "original-global-revision-per-changed-batch"}
        write_receipt(directory, "start.json", {**common, "afterId": options["after_id"]})
        after_id = options["after_id"]
        try:
            for number in range(1, options["max_batches"] + 1):
                # Persist intention before SQL; absent completion is explicitly
                # uncertain after a crash. A fresh run can safely CAS/recheck.
                write_receipt(directory, f"batch-{number:04d}-intent.json", {**common, "afterId": after_id})
                result = run_batch(after_id, options["batch_size"], options["execute"], run_id, number)
                write_receipt(directory, f"batch-{number:04d}-complete.json", {**common, **result})
                self.stdout.write(json.dumps({**common, **result}, ensure_ascii=False, sort_keys=True))
                after_id = result["afterId"]
                if result["scanned"] < options["batch_size"]:
                    break
            write_receipt(directory, "complete.json", {**common, "afterId": after_id,
                          "status": "bounded-run-completed",
                          "exhausted": result["scanned"] < options["batch_size"]})
        except BaseException:
            # Database exceptions can contain bound JSON. Never emit their text.
            write_receipt(directory, "failed.json", {**common, "lastCompletedAfterId": after_id,
                          "status": "stopped-review-intent-vs-completion"})
            raise CommandError("缓存维护停止；仅检查元数据receipt，未完成意图不能当成功") from None
