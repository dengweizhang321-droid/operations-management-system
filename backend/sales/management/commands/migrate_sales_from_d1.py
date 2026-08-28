from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Sequence

from django.core.management.base import BaseCommand, CommandError
from django.db import connection as target_connection, models, transaction
from django.db.models.functions import Collate
from django.utils import timezone

from sales.models import (
    ErpProductMaster,
    SalesDataRevision,
    SalesImportBatch,
    SalesMigrationLock,
    SalesMigrationRun,
    SalesOrderLine,
)


@dataclass(frozen=True)
class TableSpec:
    source_table: str
    model: type[models.Model]
    columns: tuple[str, ...]
    order_by: str
    unique_fields: tuple[str, ...]
    source_only_columns: tuple[str, ...] = ()

    @property
    def payload_columns(self) -> tuple[str, ...]:
        return tuple(column for column in self.columns if column not in self.source_only_columns)

    @property
    def update_fields(self) -> list[str]:
        primary_key = self.model._meta.pk.name
        immutable_conflict_fields = {primary_key, *self.unique_fields}
        return [column for column in self.payload_columns if column not in immutable_conflict_fields] + ["migration_generation"]


BATCH_COLUMNS = (
    "id", "source", "file_name", "file_size_bytes", "file_hash", "sheet_name", "status",
    "row_count", "inserted_count", "duplicate_count", "warning_count", "warnings_json",
    "totals_json", "created_at", "completed_at",
)
LINE_COLUMNS = (
    "id", "source_line_key", "source_row_hash", "first_import_batch_id", "last_import_batch_id",
    "source_row_number", "order_no", "online_order_no", "channel", "platform", "shop_name",
    "logistics_company", "warehouse", "product_code", "online_spec_code", "product_name",
    "specification", "barcode", "supplier", "category", "quantity", "list_unit_price_cents",
    "cost_amount_cents", "allocated_unit_price_cents", "allocated_amount_cents",
    "fee_allocation_cents", "gross_profit_cents", "gross_margin_bps",
    "untaxed_gross_profit_cents", "untaxed_gross_margin_bps", "order_time", "sales_time",
    "ship_time", "line_ship_time", "business_type", "created_at", "updated_at",
)
PRODUCT_COLUMNS = (
    "product_code", "product_name", "brand", "specification", "barcode", "category", "supplier",
    "product_status", "source_row_number", "last_import_batch_id", "created_at", "updated_at",
)

SPECS = (
    TableSpec("sales_import_batches", SalesImportBatch, BATCH_COLUMNS, "id", ("id",)),
    TableSpec("erp_product_master", ErpProductMaster, PRODUCT_COLUMNS, "product_code", ("product_code",)),
    TableSpec(
        "sales_order_lines",
        SalesOrderLine,
        LINE_COLUMNS,
        "source_line_key",
        ("source_line_key",),
        source_only_columns=("id",),
    ),
)

# Version the complete digest contract, not only the row JSON. Version 1 was
# produced while the D1-local integer id still participated in the sales-line
# material. Version 2 deliberately excludes that allocation-local id and binds
# the table name plus the exact ordered column list into every table digest.
CANONICAL_FORMAT_VERSION = "sales-projection-v2"


def _canonical_bytes(values: Sequence[Any]) -> bytes:
    return (json.dumps(list(values), ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def _new_table_digest(spec: TableSpec) -> Any:
    digest = hashlib.sha256()
    digest.update(
        _canonical_bytes(
            (
                CANONICAL_FORMAT_VERSION,
                "table",
                spec.source_table,
                *spec.payload_columns,
            )
        )
    )
    return digest


def _source_uri(path: Path) -> str:
    # sqlite URI accepts a forward-slash Windows absolute path (file:D:/...).
    return f"file:{path.as_posix()}?mode=ro"


def _paths_alias(left: Path, right: Path) -> bool:
    left = left.resolve()
    right = right.resolve()
    if left == right:
        return True
    try:
        return os.path.samefile(left, right)
    except (FileNotFoundError, OSError):
        return False


def _reject_source_target_alias(source: Path) -> None:
    if target_connection.vendor != "sqlite":
        return
    target_name = str(target_connection.settings_dict.get("NAME") or "")
    if not target_name or target_name == ":memory:" or target_name.startswith("file:"):
        return
    if _paths_alias(source, Path(target_name).expanduser()):
        raise CommandError("D1 只读源不能与 Django SQLite 目标使用同一文件")


def _open_source(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(_source_uri(path), uri=True, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    connection.execute("BEGIN")
    return connection


def _read_live_source_revision(path: Path) -> tuple[int, int]:
    connection = sqlite3.connect(_source_uri(path), uri=True, timeout=30)
    try:
        connection.execute("PRAGMA query_only = ON")
        row = connection.execute(
            "SELECT sales_revision, erp_product_revision FROM sales_overview_cache_state WHERE id = 1"
        ).fetchone()
        if row is None:
            raise CommandError("D1 源版本水位在迁移期间消失")
        return int(row[0]), int(row[1])
    finally:
        connection.close()


def _ensure_source_stable(path: Path, expected: tuple[int, int]) -> None:
    if _read_live_source_revision(path) != expected:
        raise CommandError("D1 源版本水位在迁移期间变化，目标事务已拒绝提交")


def _validate_source(connection: sqlite3.Connection) -> tuple[int, int]:
    for spec in SPECS:
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", (spec.source_table,)
        ).fetchone()
        if not exists:
            raise CommandError(f"D1 源缺少必需表 {spec.source_table}")
        actual = {row[1] for row in connection.execute(f"PRAGMA table_info({spec.source_table})")}
        missing = set(spec.columns) - actual
        if missing:
            raise CommandError(f"D1 源表 {spec.source_table} 缺少字段: {', '.join(sorted(missing))}")
    sales_count = int(connection.execute("SELECT COUNT(*) FROM sales_order_lines").fetchone()[0])
    if sales_count <= 0:
        raise CommandError("D1 销售事实为空，拒绝覆盖目标快照")
    state_table = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sales_overview_cache_state' LIMIT 1"
    ).fetchone()
    if not state_table:
        raise CommandError("D1 源缺少 sales_overview_cache_state，无法绑定真实数据版本")
    revision = connection.execute(
        "SELECT sales_revision, erp_product_revision FROM sales_overview_cache_state WHERE id = 1"
    ).fetchone()
    if revision is None or int(revision[0]) < 1 or int(revision[1]) < 1:
        raise CommandError("D1 源缺少有效的销售/ERP版本水位")
    return int(revision[0]), int(revision[1])


def _lock_snapshot(run_id: str) -> SalesMigrationLock:
    lock = SalesMigrationLock.objects.select_for_update().get(name="sales_snapshot")
    if lock.owner_id:
        raise CommandError("已有销售快照迁移持有目标写锁")
    lock.owner_id = run_id
    lock.save(update_fields=["owner_id", "updated_at"])
    return lock


def _verify_target_revisions(source_revision: tuple[int, int]) -> None:
    target = dict(SalesDataRevision.objects.filter(domain__in=["sales", "erp"]).values_list("domain", "revision"))
    if (int(target.get("sales", 0)), int(target.get("erp", 0))) != source_revision:
        raise CommandError("目标销售/ERP版本水位与D1源不一致")


def _source_rows(connection: sqlite3.Connection, spec: TableSpec, batch_size: int) -> Iterator[list[sqlite3.Row]]:
    columns = ", ".join(f'"{column}"' for column in spec.payload_columns)
    cursor = connection.execute(
        f'SELECT {columns} FROM "{spec.source_table}" '
        f'ORDER BY "{spec.order_by}" COLLATE BINARY ASC'
    )
    while True:
        rows = cursor.fetchmany(batch_size)
        if not rows:
            return
        yield rows


def _source_digest(connection: sqlite3.Connection, spec: TableSpec, batch_size: int) -> tuple[int, str]:
    digest = _new_table_digest(spec)
    count = 0
    for rows in _source_rows(connection, spec, batch_size):
        for row in rows:
            digest.update(_canonical_bytes(tuple(row)))
        count += len(rows)
    return count, digest.hexdigest()


def _target_binary_collation(vendor: str) -> str:
    if vendor == "sqlite":
        return "BINARY"
    if vendor == "postgresql":
        return "C"
    raise CommandError(f"不支持在 {vendor} 上校验销售快照的二进制排序")


def _target_digest(spec: TableSpec, batch_size: int) -> tuple[int, str]:
    digest = _new_table_digest(spec)
    count = 0
    collation = _target_binary_collation(target_connection.vendor)
    queryset = spec.model.objects.order_by(Collate(models.F(spec.order_by), collation)).values_list(
        *spec.payload_columns
    )
    for values in queryset.iterator(chunk_size=batch_size):
        digest.update(_canonical_bytes(values))
        count += 1
    return count, digest.hexdigest()


def _apply_table(connection: sqlite3.Connection, spec: TableSpec, batch_size: int, generation: str) -> tuple[int, str]:
    digest = _new_table_digest(spec)
    count = 0
    for rows in _source_rows(connection, spec, batch_size):
        objects = []
        for row in rows:
            values = tuple(row)
            digest.update(_canonical_bytes(values))
            payload = dict(zip(spec.payload_columns, values, strict=True))
            payload["migration_generation"] = generation
            objects.append(spec.model(**payload))
        spec.model.objects.bulk_create(
            objects,
            batch_size=batch_size,
            update_conflicts=True,
            update_fields=spec.update_fields,
            unique_fields=list(spec.unique_fields),
        )
        count += len(objects)
    # The D1 tables are authoritative full snapshots for this migration slice.
    spec.model.objects.exclude(migration_generation=generation).delete()
    return count, digest.hexdigest()


def _fingerprint(path: Path) -> str:
    """Bind approval to the same filesystem object without treating live writes
    to unrelated D1 domains as a different source file.

    The sales/ERP revision plus complete table digests bind the approved
    business snapshot.  Device/inode detects replacement at the same path,
    while remaining stable when workerd updates other tables in the same D1.
    """
    stat = path.stat()
    return hashlib.sha256(
        f"file-identity-v2\n{stat.st_dev}\n{stat.st_ino}".encode()
    ).hexdigest()


def _domain_digest(domain: str, table_digests: dict[str, str]) -> str:
    if domain == "sales":
        table_names = ("sales_import_batches", "sales_order_lines")
    else:
        table_names = ("erp_product_master",)
    material = _canonical_bytes(
        (
            CANONICAL_FORMAT_VERSION,
            "domain",
            domain,
            *((table_name, table_digests[table_name]) for table_name in table_names),
        )
    )
    return hashlib.sha256(material).hexdigest()


def _approved_dry_run(
    approved_run_id: str,
    *,
    source_fingerprint: str,
    source_path_digest: str,
    source_revision: str,
    source_counts: dict[str, int],
    source_digests: dict[str, str],
) -> SalesMigrationRun:
    try:
        approval = SalesMigrationRun.objects.select_for_update().get(id=approved_run_id)
    except SalesMigrationRun.DoesNotExist as error:
        raise CommandError("--approved-run-id 不存在") from error
    if not approval.dry_run or approval.status != "dry_run_completed" or approval.completed_at is None:
        raise CommandError("审批运行不是已成功完成的 dry-run")
    if approval.canonical_format_version != CANONICAL_FORMAT_VERSION:
        raise CommandError("审批运行的 canonical format version 与当前命令不一致")
    if approval.consumed_by_run_id or approval.approval_consumed_at is not None:
        raise CommandError("该 dry-run 审批已被消费，不得重复使用")
    if SalesMigrationRun.objects.filter(approved_run_id=approval.id).exists():
        raise CommandError("该 dry-run 审批已关联 apply 运行，不得重复使用")
    expected = {
        "source_path_digest": source_path_digest,
        "source_fingerprint": source_fingerprint,
        "source_revision": source_revision,
        "source_counts": source_counts,
        "source_digests": source_digests,
    }
    actual = {
        "source_path_digest": approval.source_path_digest,
        "source_fingerprint": approval.source_fingerprint,
        "source_revision": approval.source_revision,
        "source_counts": approval.source_counts,
        "source_digests": approval.source_digests,
    }
    mismatches = [field for field in expected if expected[field] != actual[field]]
    if mismatches:
        raise CommandError(
            "D1 源与 dry-run 审批不一致: " + ", ".join(mismatches)
        )
    return approval


class Command(BaseCommand):
    help = "Stream an authoritative, verified sales read-model snapshot from a read-only local D1 SQLite file."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--source", required=True, help="Path to the local D1 SQLite file")
        parser.add_argument("--batch-size", type=int, default=1000)
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--dry-run", action="store_true", help="Read and digest the source without changing business tables")
        mode.add_argument("--verify-only", action="store_true", help="Compare the complete source and target snapshots")
        mode.add_argument("--apply", action="store_true", help="Apply exactly one previously approved dry-run snapshot")
        parser.add_argument(
            "--approved-run-id",
            default="",
            help="Successful, unconsumed --dry-run id required by --apply",
        )

    def handle(self, *args, **options):
        try:
            source = Path(options["source"]).expanduser().resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise CommandError("--source 文件不存在或无法解析") from error
        if not source.is_file():
            raise CommandError("--source 必须指向 SQLite 文件")
        _reject_source_target_alias(source)
        batch_size = int(options["batch_size"])
        if batch_size < 100 or batch_size > 10_000:
            raise CommandError("--batch-size 必须在 100 到 10000 之间")
        dry_run = bool(options["dry_run"])
        verify_only = bool(options["verify_only"])
        apply = bool(options["apply"])
        approved_run_id = str(options.get("approved_run_id") or "").strip()
        if not dry_run and not verify_only and not apply:
            raise CommandError("必须显式选择 --dry-run、--verify-only 或 --apply；省略模式不会写入")
        if apply and not approved_run_id:
            raise CommandError("--apply 必须同时提供 --approved-run-id <dry-run run id>")
        if approved_run_id and not apply:
            raise CommandError("--approved-run-id 只能与 --apply 同时使用")
        if len(approved_run_id) > 64:
            raise CommandError("--approved-run-id 无效")
        run_id = uuid.uuid4().hex
        generation = uuid.uuid4().hex
        path_digest = hashlib.sha256(str(source).encode("utf-8")).hexdigest()
        source_fingerprint = _fingerprint(source)
        run = SalesMigrationRun.objects.create(
            id=run_id,
            status="processing" if apply else "checking",
            dry_run=dry_run,
            source_fingerprint=source_fingerprint,
            source_path_digest=path_digest,
            generation=generation,
            canonical_format_version=CANONICAL_FORMAT_VERSION,
        )
        connection: sqlite3.Connection | None = None
        try:
            connection = _open_source(source)
            source_revision = _validate_source(connection)
            source_revision_token = f"{source_revision[0]}:{source_revision[1]}"
            run.source_revision = source_revision_token
            run.save(update_fields=["source_revision"])
            source_counts: dict[str, int] = {}
            source_digests: dict[str, str] = {}
            for spec in SPECS:
                source_counts[spec.source_table], source_digests[spec.source_table] = _source_digest(
                    connection, spec, batch_size
                )

            if dry_run:
                _ensure_source_stable(source, source_revision)
                run.status = "dry_run_completed"
                run.source_counts = source_counts
                run.source_digests = source_digests
                run.completed_at = timezone.now()
                run.save(
                    update_fields=[
                        "status",
                        "source_counts",
                        "source_digests",
                        "completed_at",
                    ]
                )
                self.stdout.write(
                    json.dumps(
                        {
                            "status": run.status,
                            "runId": run_id,
                            "canonicalFormatVersion": CANONICAL_FORMAT_VERSION,
                            "sourceCounts": source_counts,
                            "sourceDigests": source_digests,
                            "sourceRevision": source_revision_token,
                        },
                        ensure_ascii=False,
                    )
                )
                return

            if verify_only:
                target_counts: dict[str, int] = {}
                target_digests: dict[str, str] = {}
                # select_for_update serializes verification against apply without
                # changing the lock row or any business/revision table.
                with transaction.atomic():
                    lock = SalesMigrationLock.objects.select_for_update().get(name="sales_snapshot")
                    if lock.owner_id:
                        raise CommandError("已有销售快照迁移持有目标写锁")
                    for spec in SPECS:
                        target_counts[spec.source_table], target_digests[spec.source_table] = _target_digest(
                            spec, batch_size
                        )
                    if source_counts != target_counts or source_digests != target_digests:
                        raise CommandError("源与目标销售快照的行数或摘要不一致")
                    _verify_target_revisions(source_revision)
                    run.target_revision = source_revision_token
                _ensure_source_stable(source, source_revision)
                run.status = "verified"
                run.source_counts = source_counts
                run.source_digests = source_digests
                run.target_counts = target_counts
                run.target_digests = target_digests
                run.completed_at = timezone.now()
                run.save(update_fields=["status", "source_counts", "source_digests", "target_counts", "target_digests", "target_revision", "completed_at"])
                self.stdout.write(
                    json.dumps(
                        {
                            "status": run.status,
                            "runId": run_id,
                            "canonicalFormatVersion": CANONICAL_FORMAT_VERSION,
                            "sourceCounts": source_counts,
                            "sourceRevision": source_revision_token,
                        },
                        ensure_ascii=False,
                    )
                )
                return

            with transaction.atomic():
                lock = _lock_snapshot(run_id)
                approval = _approved_dry_run(
                    approved_run_id,
                    source_fingerprint=source_fingerprint,
                    source_path_digest=path_digest,
                    source_revision=source_revision_token,
                    source_counts=source_counts,
                    source_digests=source_digests,
                )
                applied_counts: dict[str, int] = {}
                applied_digests: dict[str, str] = {}
                for spec in SPECS:
                    applied_counts[spec.source_table], applied_digests[spec.source_table] = _apply_table(
                        connection, spec, batch_size, generation
                    )
                if source_counts != applied_counts or source_digests != applied_digests:
                    raise CommandError("apply 期间读取的 D1 快照与已审批摘要不一致")
                target_counts: dict[str, int] = {}
                target_digests: dict[str, str] = {}
                for spec in SPECS:
                    target_counts[spec.source_table], target_digests[spec.source_table] = _target_digest(spec, batch_size)
                if source_counts != target_counts or source_digests != target_digests:
                    raise CommandError("迁移后目标销售快照的行数或摘要校验失败")
                _ensure_source_stable(source, source_revision)
                for domain, source_value in (
                    ("sales", source_revision[0]),
                    ("erp", source_revision[1]),
                ):
                    revision, _ = SalesDataRevision.objects.select_for_update().get_or_create(domain=domain)
                    domain_digest = _domain_digest(domain, source_digests)
                    if revision.revision > source_value:
                        raise CommandError(f"拒绝把 {domain} 数据版本从 {revision.revision} 降级到 {source_value}")
                    if revision.revision == source_value and revision.source_digest and revision.source_digest != domain_digest:
                        raise CommandError(f"D1 {domain} 数据在未提升版本水位时发生变化，拒绝发布")
                    revision.revision = source_value
                    revision.source_digest = domain_digest
                    revision.save(update_fields=["revision", "source_digest", "updated_at"])
                run.status = "completed"
                run.source_counts = source_counts
                run.target_counts = target_counts
                run.source_digests = source_digests
                run.target_digests = target_digests
                run.target_revision = source_revision_token
                run.approved_run_id = approval.id
                run.completed_at = timezone.now()
                approval.consumed_by_run_id = run_id
                approval.approval_consumed_at = run.completed_at
                approval.save(update_fields=["consumed_by_run_id", "approval_consumed_at"])
                run.save(update_fields=["status", "source_counts", "target_counts", "source_digests", "target_digests", "target_revision", "approved_run_id", "completed_at"])
                lock.owner_id = ""
                lock.save(update_fields=["owner_id", "updated_at"])
            self.stdout.write(
                json.dumps(
                    {
                        "status": "completed",
                        "runId": run_id,
                        "approvedRunId": approved_run_id,
                        "canonicalFormatVersion": CANONICAL_FORMAT_VERSION,
                        "counts": source_counts,
                        "digests": source_digests,
                        "sourceRevision": source_revision_token,
                    },
                    ensure_ascii=False,
                )
            )
        except Exception as error:
            run.status = "failed"
            run.error_code = error.__class__.__name__[:100]
            run.error_message = str(error)[:2000]
            run.completed_at = timezone.now()
            run.save(update_fields=["status", "error_code", "error_message", "completed_at"])
            if isinstance(error, CommandError):
                raise
            raise CommandError("销售数据迁移失败；业务表事务已回滚，请查看迁移审计记录") from error
        finally:
            if connection is not None:
                connection.rollback()
                connection.close()
