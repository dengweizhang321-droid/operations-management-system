from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable, Iterator, Sequence, TypeVar

from django.db import DatabaseError, connection as target_connection, transaction

from sales.models import (
    UNCATEGORIZED,
    ErpProductMaster,
    SalesDataRevision,
    SalesImportBatch,
    SalesMigrationLock,
    SalesOrderLine,
    sales_projection_values,
)


CANONICAL_FORMAT_VERSION = "sales-projection-v2"
CHECKPOINT_TABLE = "sales_projection_sync_checkpoint"
POSTGRES_ADVISORY_LOCK_KEY = 740_513_462_109_601_778
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SOURCE_EPOCH_PATTERN = re.compile(r"^[0-9a-f]{32}$")

SALES_BATCH_COLUMNS = (
    "id",
    "source",
    "file_name",
    "file_size_bytes",
    "file_hash",
    "sheet_name",
    "status",
    "row_count",
    "inserted_count",
    "duplicate_count",
    "warning_count",
    "warnings_json",
    "totals_json",
    "created_at",
    "completed_at",
)
SALES_LINE_SOURCE_COLUMNS = (
    "source_line_key",
    "source_row_hash",
    "first_import_batch_id",
    "last_import_batch_id",
    "source_row_number",
    "order_no",
    "online_order_no",
    "channel",
    "platform",
    "shop_name",
    "logistics_company",
    "warehouse",
    "product_code",
    "online_spec_code",
    "product_name",
    "specification",
    "barcode",
    "supplier",
    "category",
    "quantity",
    "list_unit_price_cents",
    "cost_amount_cents",
    "allocated_unit_price_cents",
    "allocated_amount_cents",
    "fee_allocation_cents",
    "gross_profit_cents",
    "gross_margin_bps",
    "untaxed_gross_profit_cents",
    "untaxed_gross_margin_bps",
    "order_time",
    "sales_time",
    "ship_time",
    "line_ship_time",
    "business_type",
    "created_at",
    "updated_at",
)
SALES_QUERY_PROJECTION_COLUMNS = (
    "business_date",
    "platform_key",
    "channel_key",
    "shop_key",
    "resolved_category",
    "order_identity",
    "is_business_row",
    "is_net_sales_row",
    "is_net_quantity_row",
)
SALES_LINE_TARGET_COLUMNS = (
    *SALES_LINE_SOURCE_COLUMNS,
    *SALES_QUERY_PROJECTION_COLUMNS,
    "migration_generation",
)
ERP_PRODUCT_COLUMNS = (
    "product_code",
    "product_name",
    "brand",
    "specification",
    "barcode",
    "category",
    "supplier",
    "product_status",
    "source_row_number",
    "last_import_batch_id",
    "created_at",
    "updated_at",
)
ERP_PRODUCT_TARGET_COLUMNS = (*ERP_PRODUCT_COLUMNS, "migration_generation")
SALES_BATCH_TARGET_COLUMNS = (*SALES_BATCH_COLUMNS, "migration_generation")
OUTBOX_COLUMNS = (
    "event_sequence",
    "event_id",
    "source_epoch",
    "domain",
    "operation",
    "scope_json",
    "source_batch_id",
    "sales_revision",
    "erp_revision",
    "row_count",
    "content_hash",
    "canonical_format_version",
    "created_at",
)


class ProjectionSyncError(RuntimeError):
    """Fail-closed projection synchronization error."""


class SourceChangedDuringSync(ProjectionSyncError):
    """The authoritative source advanced while a target transaction was open."""


@dataclass(frozen=True)
class SourceState:
    source_epoch: str
    head_sequence: int
    head_event_id: str
    sales_revision: int
    erp_revision: int


@dataclass(frozen=True)
class ProjectionCheckpoint:
    source_epoch: str
    source_path_digest: str
    last_event_sequence: int
    last_event_id: str
    sales_revision: int
    erp_revision: int
    last_checked_at: str


@dataclass(frozen=True)
class SalesScope:
    start_date: date
    end_date: date
    channels: tuple[str, ...] | None
    canonical_json: str


@dataclass(frozen=True)
class OutboxEvent:
    event_sequence: int
    event_id: str
    source_epoch: str
    domain: str
    operation: str
    scope_json: str
    source_batch_id: str
    sales_revision: int
    erp_revision: int
    row_count: int
    content_hash: str
    canonical_format_version: str
    created_at: str
    sales_scope: SalesScope | None = None


def resolve_source_path(value: str | os.PathLike[str]) -> Path:
    try:
        path = Path(value).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ProjectionSyncError("--source 文件不存在或无法解析") from error
    if not path.is_file():
        raise ProjectionSyncError("--source 必须精确指向 SQLite 文件")
    if target_connection.vendor == "sqlite":
        target_name = str(target_connection.settings_dict.get("NAME") or "")
        if target_name and target_name != ":memory:" and not target_name.startswith("file:"):
            target_path = Path(target_name).expanduser().resolve()
            aliases = path == target_path
            if not aliases:
                try:
                    aliases = os.path.samefile(path, target_path)
                except (FileNotFoundError, OSError):
                    aliases = False
            if aliases:
                raise ProjectionSyncError("D1 只读源不能与 Django SQLite 目标使用同一文件")
    return path


def source_path_digest(path: Path) -> str:
    return hashlib.sha256(str(path).encode("utf-8")).hexdigest()


def _source_uri(path: Path) -> str:
    return f"file:{path.as_posix()}?mode=ro"


def _open_source(path: Path) -> sqlite3.Connection:
    source = sqlite3.connect(_source_uri(path), uri=True, timeout=30)
    source.row_factory = sqlite3.Row
    source.execute("PRAGMA query_only = ON")
    source.execute("BEGIN")
    return source


def _table_columns(source: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in source.execute(f'PRAGMA table_info("{table}")')}


def _validate_source_schema(source: sqlite3.Connection) -> None:
    required = {
        "sales_projection_source_state": {"id", "source_epoch"},
        "sales_projection_outbox": set(OUTBOX_COLUMNS),
        "sales_overview_cache_state": {"id", "sales_revision", "erp_product_revision"},
        "sales_import_batches": set(SALES_BATCH_COLUMNS),
        "sales_order_lines": {"id", *SALES_LINE_SOURCE_COLUMNS},
        "erp_reference_import_batches": {
            "id",
            "source_key",
            "status",
            "row_count",
            "totals_json",
        },
        "erp_product_master": set(ERP_PRODUCT_COLUMNS),
    }
    for table, columns in required.items():
        actual = _table_columns(source, table)
        if not actual:
            raise ProjectionSyncError(f"D1 源缺少必需表 {table}")
        missing = columns - actual
        if missing:
            raise ProjectionSyncError(
                f"D1 源表 {table} 缺少字段: {', '.join(sorted(missing))}"
            )


def _read_source_state(source: sqlite3.Connection) -> SourceState:
    epoch_row = source.execute(
        "SELECT source_epoch FROM sales_projection_source_state WHERE id = 1"
    ).fetchone()
    revision_row = source.execute(
        "SELECT sales_revision, erp_product_revision "
        "FROM sales_overview_cache_state WHERE id = 1"
    ).fetchone()
    if epoch_row is None or revision_row is None:
        raise ProjectionSyncError("D1 源缺少投影 source_epoch 或 revision 水位")
    source_epoch = str(epoch_row[0])
    sales_revision = int(revision_row[0])
    erp_revision = int(revision_row[1])
    if not SOURCE_EPOCH_PATTERN.fullmatch(source_epoch):
        raise ProjectionSyncError("D1 投影 source_epoch 格式无效")
    if sales_revision < 1 or erp_revision < 1:
        raise ProjectionSyncError("D1 销售/ERP revision 必须大于等于 1")
    head = source.execute(
        "SELECT event_sequence, event_id, source_epoch, sales_revision, erp_revision "
        "FROM sales_projection_outbox ORDER BY event_sequence DESC LIMIT 1"
    ).fetchone()
    if head is None:
        return SourceState(source_epoch, 0, "", sales_revision, erp_revision)
    if int(head[0]) < 1 or not str(head[1]):
        raise ProjectionSyncError("D1 outbox head 的 sequence/event_id 无效")
    if str(head[2]) != source_epoch:
        raise ProjectionSyncError("D1 outbox head 的 source_epoch 与当前源不一致")
    if int(head[3]) != sales_revision or int(head[4]) != erp_revision:
        raise ProjectionSyncError("D1 outbox head 与当前销售/ERP revision 不一致")
    return SourceState(
        source_epoch=source_epoch,
        head_sequence=int(head[0]),
        head_event_id=str(head[1]),
        sales_revision=sales_revision,
        erp_revision=erp_revision,
    )


def _read_live_source_state(path: Path) -> SourceState:
    source = _open_source(path)
    try:
        _validate_source_schema(source)
        return _read_source_state(source)
    finally:
        source.rollback()
        source.close()


def _require_source_stable(path: Path, expected: SourceState) -> None:
    if _read_live_source_state(path) != expected:
        raise SourceChangedDuringSync(
            "D1 源 revision 或 outbox head 在投影抽取期间变化，目标事务已回滚"
        )


def _checkpoint_from_row(row: Sequence[object]) -> ProjectionCheckpoint:
    checkpoint = ProjectionCheckpoint(
        source_epoch=str(row[0]),
        source_path_digest=str(row[1]),
        last_event_sequence=int(row[2]),
        last_event_id=str(row[3]),
        sales_revision=int(row[4]),
        erp_revision=int(row[5]),
        last_checked_at=str(row[6]),
    )
    if not SOURCE_EPOCH_PATTERN.fullmatch(checkpoint.source_epoch):
        raise ProjectionSyncError("projection checkpoint 的 source_epoch 格式无效")
    if not SHA256_PATTERN.fullmatch(checkpoint.source_path_digest):
        raise ProjectionSyncError("projection checkpoint 的源路径摘要格式无效")
    if checkpoint.last_event_sequence < 0:
        raise ProjectionSyncError("projection checkpoint sequence 不能为负数")
    if checkpoint.sales_revision < 1 or checkpoint.erp_revision < 1:
        raise ProjectionSyncError("projection checkpoint revision 无效")
    if bool(checkpoint.last_event_id) != (checkpoint.last_event_sequence > 0):
        raise ProjectionSyncError("projection checkpoint 的 sequence/event_id 不一致")
    try:
        datetime.fromisoformat(checkpoint.last_checked_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProjectionSyncError("projection checkpoint 的 last_checked_at 无效") from error
    return checkpoint


def _validate_checkpoint_anchor(
    source: sqlite3.Connection, checkpoint: ProjectionCheckpoint
) -> None:
    if checkpoint.last_event_sequence == 0:
        return
    row = source.execute(
        "SELECT event_id, source_epoch, domain, source_batch_id, sales_revision, "
        "erp_revision, canonical_format_version FROM sales_projection_outbox "
        "WHERE event_sequence = ?",
        (checkpoint.last_event_sequence,),
    ).fetchone()
    if row is None:
        raise ProjectionSyncError("D1 outbox 缺少 checkpoint 锚点事件")
    event_id = str(row[0])
    source_epoch = str(row[1])
    domain = str(row[2])
    source_batch_id = str(row[3])
    if (
        event_id != checkpoint.last_event_id
        or source_epoch != checkpoint.source_epoch
        or int(row[4]) != checkpoint.sales_revision
        or int(row[5]) != checkpoint.erp_revision
    ):
        raise ProjectionSyncError("D1 outbox checkpoint 锚点已变化")
    if event_id != f"{source_epoch}:{domain}:{source_batch_id}":
        raise ProjectionSyncError("D1 outbox checkpoint 锚点 event_id 无效")
    if str(row[6]) != CANONICAL_FORMAT_VERSION:
        raise ProjectionSyncError("D1 outbox checkpoint 锚点格式版本不受支持")


def read_checkpoint(*, for_update: bool = False) -> ProjectionCheckpoint | None:
    suffix = " FOR UPDATE" if for_update and target_connection.vendor == "postgresql" else ""
    try:
        with target_connection.cursor() as cursor:
            cursor.execute(
                "SELECT source_epoch, source_path_digest, last_event_sequence, "
                "last_event_id, sales_revision, erp_revision, last_checked_at "
                f"FROM {CHECKPOINT_TABLE} WHERE id = 1{suffix}"
            )
            row = cursor.fetchone()
    except DatabaseError as error:
        raise ProjectionSyncError(
            "Django 目标缺少 projection checkpoint；请先应用 0004_projection_sync"
        ) from error
    return _checkpoint_from_row(row) if row else None


def _target_revisions(*, for_update: bool) -> tuple[int, int, dict[str, SalesDataRevision]]:
    queryset = SalesDataRevision.objects.filter(domain__in=("sales", "erp"))
    if for_update:
        queryset = queryset.select_for_update()
    objects = {item.domain: item for item in queryset}
    if set(objects) != {"sales", "erp"}:
        raise ProjectionSyncError("Django 目标缺少完整的 sales/erp revision 水位")
    return int(objects["sales"].revision), int(objects["erp"].revision), objects


def _acquire_target_lock() -> None:
    if target_connection.vendor == "postgresql":
        with target_connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(%s)", [POSTGRES_ADVISORY_LOCK_KEY])
            row = cursor.fetchone()
        if not row or not bool(row[0]):
            raise ProjectionSyncError("另一个 Django 销售投影同步事务正在运行")
    try:
        lock = SalesMigrationLock.objects.select_for_update().get(name="sales_snapshot")
    except SalesMigrationLock.DoesNotExist as error:
        raise ProjectionSyncError("Django 销售迁移锁尚未初始化") from error
    if lock.owner_id:
        raise ProjectionSyncError("全量销售快照迁移正在运行，增量投影拒绝并发")


def initialize_checkpoint(path: Path) -> dict[str, object]:
    path = resolve_source_path(path)
    source = _open_source(path)
    try:
        _validate_source_schema(source)
        state = _read_source_state(source)
        _validate_checkpoint_anchor(
            source,
            ProjectionCheckpoint(
                source_epoch=state.source_epoch,
                source_path_digest=source_path_digest(path),
                last_event_sequence=state.head_sequence,
                last_event_id=state.head_event_id,
                sales_revision=state.sales_revision,
                erp_revision=state.erp_revision,
                last_checked_at="",
            ),
        )
        _require_source_stable(path, state)
        with transaction.atomic():
            _acquire_target_lock()
            if read_checkpoint(for_update=True) is not None:
                raise ProjectionSyncError("projection checkpoint 已初始化，不得重新绑定源")
            target_sales, target_erp, _ = _target_revisions(for_update=True)
            if (target_sales, target_erp) != (state.sales_revision, state.erp_revision):
                raise ProjectionSyncError(
                    "只有 Django 目标 revision 与 D1 源完全一致时才能初始化 checkpoint"
                )
            _require_source_stable(path, state)
            with target_connection.cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO {CHECKPOINT_TABLE} ("
                    "id, source_epoch, source_path_digest, last_event_sequence, last_event_id, "
                    "sales_revision, erp_revision, created_at, updated_at, last_checked_at"
                    ") VALUES (1, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    [
                        state.source_epoch,
                        source_path_digest(path),
                        state.head_sequence,
                        state.head_event_id,
                        state.sales_revision,
                        state.erp_revision,
                    ],
                )
        return {
            "status": "initialized",
            "sourceEpoch": state.source_epoch,
            "headSequence": state.head_sequence,
            "salesRevision": state.sales_revision,
            "erpRevision": state.erp_revision,
        }
    finally:
        source.rollback()
        source.close()


def _parse_iso_date(value: object, label: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ProjectionSyncError(f"销售 outbox scope 的 {label} 不是 YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ProjectionSyncError(f"销售 outbox scope 的 {label} 日期无效") from error


def _parse_sales_scope(raw: str) -> SalesScope:
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise ProjectionSyncError("销售 outbox scope_json 不是有效 JSON") from error
    if not isinstance(value, dict) or set(value) != {"startDate", "endDate", "channels"}:
        raise ProjectionSyncError("销售 outbox scope_json 字段不符合 replace_scope 契约")
    start_date = _parse_iso_date(value["startDate"], "startDate")
    end_date = _parse_iso_date(value["endDate"], "endDate")
    if start_date > end_date:
        raise ProjectionSyncError("销售 outbox scope 的开始日期晚于结束日期")
    raw_channels = value["channels"]
    channels: tuple[str, ...] | None
    if raw_channels is None:
        channels = None
    elif isinstance(raw_channels, list):
        if not raw_channels or len(raw_channels) > 100:
            raise ProjectionSyncError("销售 outbox scope 的渠道集合为空或超过 100 个")
        if any(not isinstance(channel, str) or not channel.strip() for channel in raw_channels):
            raise ProjectionSyncError("销售 outbox scope 包含无效渠道")
        normalized = tuple(sorted({channel.strip() for channel in raw_channels}))
        if list(normalized) != raw_channels:
            raise ProjectionSyncError("销售 outbox scope 的渠道集合未规范排序去重")
        channels = normalized
    else:
        raise ProjectionSyncError("销售 outbox scope 的 channels 必须为 null 或字符串数组")
    canonical = json.dumps(
        {
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "channels": list(channels) if channels is not None else None,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if raw != canonical:
        raise ProjectionSyncError("销售 outbox scope_json 不是规范编码")
    return SalesScope(start_date, end_date, channels, canonical)


def _read_pending_events(
    source: sqlite3.Connection,
    checkpoint: ProjectionCheckpoint,
    state: SourceState,
    *,
    max_events: int,
) -> list[OutboxEvent]:
    pending_count = int(
        source.execute(
            "SELECT COUNT(*) FROM sales_projection_outbox "
            "WHERE event_sequence > ? AND event_sequence <= ?",
            (checkpoint.last_event_sequence, state.head_sequence),
        ).fetchone()[0]
    )
    if pending_count > max_events:
        raise ProjectionSyncError(
            f"pending outbox 事件数 {pending_count} 超过 --max-events={max_events}；"
            "拒绝只发布固定 head 的部分状态"
        )
    sql = (
        f"SELECT {', '.join(OUTBOX_COLUMNS)} FROM sales_projection_outbox "
        "WHERE event_sequence > ? AND event_sequence <= ? ORDER BY event_sequence"
    )
    rows = source.execute(
        sql, (checkpoint.last_event_sequence, state.head_sequence)
    ).fetchall()
    events: list[OutboxEvent] = []
    expected_sequence = checkpoint.last_event_sequence + 1
    sales_revision = checkpoint.sales_revision
    erp_revision = checkpoint.erp_revision
    seen_ids: set[str] = (
        {checkpoint.last_event_id} if checkpoint.last_event_id else set()
    )
    for row in rows:
        sequence = int(row[0])
        event_id = str(row[1])
        event_epoch = str(row[2])
        domain = str(row[3])
        operation = str(row[4])
        scope_json = str(row[5])
        source_batch_id = str(row[6])
        next_sales_revision = int(row[7])
        next_erp_revision = int(row[8])
        row_count = int(row[9])
        content_hash = str(row[10])
        format_version = str(row[11])
        created_at = str(row[12])
        if sequence != expected_sequence:
            raise ProjectionSyncError(
                f"D1 outbox sequence 出现缺口或乱序：期望 {expected_sequence}，实际 {sequence}"
            )
        if event_id in seen_ids:
            raise ProjectionSyncError("D1 outbox 批次内出现重复 event_id")
        seen_ids.add(event_id)
        if event_epoch != checkpoint.source_epoch or event_epoch != state.source_epoch:
            raise ProjectionSyncError("D1 outbox 事件 source_epoch 与 checkpoint 不一致")
        if not source_batch_id:
            raise ProjectionSyncError("D1 outbox 的 source_batch_id 为空")
        expected_event_id = f"{event_epoch}:{domain}:{source_batch_id}"
        if event_id != expected_event_id:
            raise ProjectionSyncError("D1 outbox 的稳定 event_id 与来源批次不一致")
        if format_version != CANONICAL_FORMAT_VERSION:
            raise ProjectionSyncError("D1 outbox canonical format version 不受支持")
        if row_count < 0 or not SHA256_PATTERN.fullmatch(content_hash):
            raise ProjectionSyncError("D1 outbox 的 row_count 或 content_hash 无效")
        try:
            datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ProjectionSyncError("D1 outbox 的 created_at 无效") from error
        sales_scope: SalesScope | None = None
        if domain == "sales":
            if operation != "replace_scope":
                raise ProjectionSyncError("sales outbox 只能使用 replace_scope")
            if next_sales_revision != sales_revision + 1 or next_erp_revision != erp_revision:
                raise ProjectionSyncError("sales outbox revision 未按单步严格推进")
            sales_scope = _parse_sales_scope(scope_json)
        elif domain == "erp":
            if operation != "replace_all" or scope_json != '{"source":"products"}':
                raise ProjectionSyncError("ERP outbox 必须是 products replace_all")
            if next_sales_revision != sales_revision or next_erp_revision != erp_revision + 1:
                raise ProjectionSyncError("ERP outbox revision 未按单步严格推进")
        else:
            raise ProjectionSyncError("D1 outbox domain 不受支持")
        events.append(
            OutboxEvent(
                event_sequence=sequence,
                event_id=event_id,
                source_epoch=event_epoch,
                domain=domain,
                operation=operation,
                scope_json=scope_json,
                source_batch_id=source_batch_id,
                sales_revision=next_sales_revision,
                erp_revision=next_erp_revision,
                row_count=row_count,
                content_hash=content_hash,
                canonical_format_version=format_version,
                created_at=created_at,
                sales_scope=sales_scope,
            )
        )
        expected_sequence += 1
        sales_revision = next_sales_revision
        erp_revision = next_erp_revision
    if checkpoint.last_event_sequence < state.head_sequence:
        if not events or events[-1].event_sequence != state.head_sequence:
            raise ProjectionSyncError("D1 outbox 固定 head 之前存在事件缺口")
        if (sales_revision, erp_revision) != (state.sales_revision, state.erp_revision):
            raise ProjectionSyncError("D1 outbox 事件链终点 revision 与源水位不一致")
        if events[-1].event_id != state.head_event_id:
            raise ProjectionSyncError("D1 outbox 事件链终点 event_id 与固定 head 不一致")
    return events


def _chunks(values: Sequence[str], size: int = 400) -> Iterator[Sequence[str]]:
    for offset in range(0, len(values), size):
        yield values[offset : offset + size]


def _read_sales_batches(
    source: sqlite3.Connection, events: Sequence[OutboxEvent]
) -> list[dict[str, object]]:
    ids = list(dict.fromkeys(event.source_batch_id for event in events if event.domain == "sales"))
    if not ids:
        return []
    rows_by_id: dict[str, sqlite3.Row] = {}
    for chunk in _chunks(ids):
        placeholders = ",".join("?" for _ in chunk)
        for row in source.execute(
            f"SELECT {', '.join(SALES_BATCH_COLUMNS)} FROM sales_import_batches "
            f"WHERE id IN ({placeholders})",
            tuple(chunk),
        ):
            rows_by_id[str(row["id"])] = row
    result: list[dict[str, object]] = []
    for event in events:
        if event.domain != "sales":
            continue
        row = rows_by_id.get(event.source_batch_id)
        if row is None:
            raise ProjectionSyncError(
                f"销售 outbox 来源批次不存在: {event.source_batch_id[:80]}"
            )
        if str(row["status"]) != "completed" or int(row["row_count"]) != event.row_count:
            raise ProjectionSyncError("销售 outbox 与 completed 来源批次行数不一致")
        try:
            totals = json.loads(str(row["totals_json"]))
        except json.JSONDecodeError:
            totals = None
        if not isinstance(totals, dict) or totals.get("contentHash") != event.content_hash:
            raise ProjectionSyncError("销售 outbox content_hash 与来源批次摘要不一致")
    for batch_id in ids:
        result.append({column: rows_by_id[batch_id][column] for column in SALES_BATCH_COLUMNS})
    return result


def _validate_erp_events(
    source: sqlite3.Connection, events: Sequence[OutboxEvent]
) -> None:
    for event in events:
        if event.domain != "erp":
            continue
        row = source.execute(
            "SELECT source_key, status, row_count, totals_json "
            "FROM erp_reference_import_batches WHERE id = ?",
            (event.source_batch_id,),
        ).fetchone()
        if row is None:
            raise ProjectionSyncError("ERP outbox 来源批次不存在")
        if (
            str(row[0]) != "products"
            or str(row[1]) != "completed"
            or int(row[2]) != event.row_count
        ):
            raise ProjectionSyncError("ERP outbox 与 completed products 来源批次不一致")
        try:
            totals = json.loads(str(row[3]))
        except json.JSONDecodeError as error:
            raise ProjectionSyncError("ERP 来源批次 totals_json 无效") from error
        if not isinstance(totals, dict) or totals.get("contentHash") != event.content_hash:
            raise ProjectionSyncError("ERP outbox content_hash 与来源批次摘要不一致")


def _read_products(source: sqlite3.Connection) -> list[dict[str, object]]:
    return [
        {column: row[column] for column in ERP_PRODUCT_COLUMNS}
        for row in source.execute(
            f"SELECT {', '.join(ERP_PRODUCT_COLUMNS)} FROM erp_product_master "
            "ORDER BY product_code COLLATE BINARY"
        )
    ]


def _read_product_categories(source: sqlite3.Connection) -> dict[str, str]:
    return {
        str(row[0]): _normalized_category(row[1])
        for row in source.execute("SELECT product_code, category FROM erp_product_master")
    }


def _scope_sql(scope: SalesScope) -> tuple[str, list[object]]:
    end_exclusive = scope.end_date + timedelta(days=1)
    clause = "ship_time >= ? AND ship_time < ?"
    parameters: list[object] = [scope.start_date.isoformat(), end_exclusive.isoformat()]
    if scope.channels is not None:
        clause += f" AND channel IN ({','.join('?' for _ in scope.channels)})"
        parameters.extend(scope.channels)
    return clause, parameters


def _iter_sales_payloads(
    source: sqlite3.Connection,
    scope: SalesScope,
    erp_categories: dict[str, str],
    generation: str,
) -> Iterator[dict[str, object]]:
    clause, parameters = _scope_sql(scope)
    cursor = source.execute(
        f"SELECT {', '.join(SALES_LINE_SOURCE_COLUMNS)} FROM sales_order_lines "
        f"WHERE {clause} ORDER BY source_line_key COLLATE BINARY",
        parameters,
    )
    for row in cursor:
        payload = {column: row[column] for column in SALES_LINE_SOURCE_COLUMNS}
        try:
            payload.update(
                sales_projection_values(
                    payload,
                    erp_category=erp_categories.get(str(payload["product_code"]), ""),
                )
            )
        except ValueError as error:
            raise ProjectionSyncError(
                f"D1 销售行 {str(payload['source_line_key'])[:80]!r} 无法生成业务日期"
            ) from error
        payload["migration_generation"] = generation
        yield payload


def _quoted_columns(columns: Sequence[str]) -> str:
    return ", ".join(target_connection.ops.quote_name(column) for column in columns)


def _postgres_stage(
    *,
    target_table: str,
    stage_table: str,
    columns: Sequence[str],
    payloads: Iterable[dict[str, object]],
) -> int:
    quoted_target = target_connection.ops.quote_name(target_table)
    quoted_stage = target_connection.ops.quote_name(stage_table)
    quoted_columns = _quoted_columns(columns)
    with target_connection.cursor() as cursor:
        cursor.execute(
            f"CREATE TEMP TABLE IF NOT EXISTS {quoted_stage} ON COMMIT DROP AS "
            f"SELECT {quoted_columns} FROM {quoted_target} WITH NO DATA"
        )
        cursor.execute(f"TRUNCATE {quoted_stage}")
        raw_cursor = getattr(cursor, "cursor", cursor)
        count = 0
        with raw_cursor.copy(
            f"COPY {quoted_stage} ({quoted_columns}) FROM STDIN"
        ) as copy:
            for payload in payloads:
                copy.write_row(tuple(payload[column] for column in columns))
                count += 1
    return count


def _postgres_upsert_from_stage(
    *,
    target_table: str,
    stage_table: str,
    columns: Sequence[str],
    unique_field: str,
) -> None:
    quote = target_connection.ops.quote_name
    quoted_columns = _quoted_columns(columns)
    update_columns = [column for column in columns if column != unique_field]
    assignments = ", ".join(
        f"{quote(column)} = EXCLUDED.{quote(column)}" for column in update_columns
    )
    with target_connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO {quote(target_table)} ({quoted_columns}) "
            f"SELECT {quoted_columns} FROM {quote(stage_table)} "
            f"ON CONFLICT ({quote(unique_field)}) DO UPDATE SET {assignments}"
        )


def _orm_upsert(
    model,
    payloads: Iterable[dict[str, object]],
    *,
    columns: Sequence[str],
    unique_field: str,
    batch_size: int,
) -> int:
    objects = [model(**payload) for payload in payloads]
    if objects:
        model.objects.bulk_create(
            objects,
            batch_size=batch_size,
            update_conflicts=True,
            update_fields=[column for column in columns if column != unique_field],
            unique_fields=[unique_field],
        )
    return len(objects)


def _apply_sales_batches(
    batches: Sequence[dict[str, object]], generation: str, batch_size: int
) -> None:
    payloads = [{**batch, "migration_generation": generation} for batch in batches]
    if target_connection.vendor == "postgresql":
        _postgres_stage(
            target_table="sales_import_batches",
            stage_table="sales_projection_stage_batches",
            columns=SALES_BATCH_TARGET_COLUMNS,
            payloads=payloads,
        )
        _postgres_upsert_from_stage(
            target_table="sales_import_batches",
            stage_table="sales_projection_stage_batches",
            columns=SALES_BATCH_TARGET_COLUMNS,
            unique_field="id",
        )
    else:
        _orm_upsert(
            SalesImportBatch,
            payloads,
            columns=SALES_BATCH_TARGET_COLUMNS,
            unique_field="id",
            batch_size=batch_size,
        )


def _target_sales_scope(scope: SalesScope):
    queryset = SalesOrderLine.objects.filter(
        business_date__gte=scope.start_date,
        business_date__lte=scope.end_date,
    )
    if scope.channels is not None:
        queryset = queryset.filter(channel__in=scope.channels)
    return queryset


def _apply_sales_scope_postgres(
    payloads: Iterable[dict[str, object]], scope: SalesScope
) -> int:
    count = _postgres_stage(
        target_table="sales_order_lines",
        stage_table="sales_projection_stage_lines",
        columns=SALES_LINE_TARGET_COLUMNS,
        payloads=payloads,
    )
    _postgres_upsert_from_stage(
        target_table="sales_order_lines",
        stage_table="sales_projection_stage_lines",
        columns=SALES_LINE_TARGET_COLUMNS,
        unique_field="source_line_key",
    )
    quote = target_connection.ops.quote_name
    where = "target.business_date >= %s AND target.business_date <= %s"
    parameters: list[object] = [scope.start_date, scope.end_date]
    if scope.channels is not None:
        where += " AND target.channel = ANY(%s)"
        parameters.append(list(scope.channels))
    with target_connection.cursor() as cursor:
        cursor.execute(
            f"DELETE FROM {quote('sales_order_lines')} AS target WHERE {where} "
            f"AND NOT EXISTS (SELECT 1 FROM {quote('sales_projection_stage_lines')} AS stage "
            "WHERE stage.source_line_key = target.source_line_key)",
            parameters,
        )
    return count


def _apply_sales_scope_orm(
    payloads: Iterable[dict[str, object]], scope: SalesScope, batch_size: int
) -> int:
    materialized = list(payloads)
    count = _orm_upsert(
        SalesOrderLine,
        materialized,
        columns=SALES_LINE_TARGET_COLUMNS,
        unique_field="source_line_key",
        batch_size=batch_size,
    )
    keys = [str(payload["source_line_key"]) for payload in materialized]
    scoped = _target_sales_scope(scope)
    if keys:
        scoped.exclude(source_line_key__in=keys).delete()
    else:
        scoped.delete()
    return count


def _apply_products(
    products: Sequence[dict[str, object]], generation: str, batch_size: int
) -> int:
    payloads = [{**product, "migration_generation": generation} for product in products]
    if target_connection.vendor == "postgresql":
        count = _postgres_stage(
            target_table="erp_product_master",
            stage_table="sales_projection_stage_products",
            columns=ERP_PRODUCT_TARGET_COLUMNS,
            payloads=payloads,
        )
        _postgres_upsert_from_stage(
            target_table="erp_product_master",
            stage_table="sales_projection_stage_products",
            columns=ERP_PRODUCT_TARGET_COLUMNS,
            unique_field="product_code",
        )
        quote = target_connection.ops.quote_name
        with target_connection.cursor() as cursor:
            cursor.execute(
                f"DELETE FROM {quote('erp_product_master')} AS target "
                f"WHERE NOT EXISTS (SELECT 1 FROM {quote('sales_projection_stage_products')} AS stage "
                "WHERE stage.product_code = target.product_code)"
            )
        return count
    count = _orm_upsert(
        ErpProductMaster,
        payloads,
        columns=ERP_PRODUCT_TARGET_COLUMNS,
        unique_field="product_code",
        batch_size=batch_size,
    )
    codes = [str(product["product_code"]) for product in products]
    if codes:
        ErpProductMaster.objects.exclude(product_code__in=codes).delete()
    else:
        ErpProductMaster.objects.all().delete()
    return count


def _normalized_category(value: object) -> str:
    return "" if value is None else str(value).strip()


def _changed_category_codes(
    old_categories: dict[str, str], new_categories: dict[str, str]
) -> list[str]:
    return sorted(
        code
        for code in set(old_categories) | set(new_categories)
        if _normalized_category(old_categories.get(code))
        != _normalized_category(new_categories.get(code))
    )


def _recalculate_categories_postgres(product_codes: Sequence[str]) -> int:
    if not product_codes:
        return 0
    quote = target_connection.ops.quote_name
    payloads = ({"product_code": code} for code in product_codes)
    _postgres_stage(
        target_table="erp_product_master",
        stage_table="sales_projection_affected_products",
        columns=("product_code",),
        payloads=payloads,
    )
    with target_connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE {quote('sales_order_lines')} AS line SET resolved_category = "
            "COALESCE(NULLIF(BTRIM(product.category), ''), "
            "NULLIF(BTRIM(line.category), ''), %s) "
            f"FROM {quote('sales_projection_affected_products')} AS affected "
            f"LEFT JOIN {quote('erp_product_master')} AS product "
            "ON product.product_code = affected.product_code "
            "WHERE line.product_code = affected.product_code",
            [UNCATEGORIZED],
        )
        return int(cursor.rowcount)


def _recalculate_categories_orm(
    product_codes: Sequence[str], new_categories: dict[str, str], batch_size: int
) -> int:
    updated = 0
    for code_chunk in _chunks(product_codes):
        rows_to_update: list[SalesOrderLine] = []
        for line in SalesOrderLine.objects.filter(product_code__in=code_chunk).iterator(
            chunk_size=batch_size
        ):
            resolved = (
                _normalized_category(new_categories.get(line.product_code))
                or _normalized_category(line.category)
                or UNCATEGORIZED
            )
            if line.resolved_category != resolved:
                line.resolved_category = resolved
                rows_to_update.append(line)
            if len(rows_to_update) >= batch_size:
                SalesOrderLine.objects.bulk_update(
                    rows_to_update, ["resolved_category"], batch_size=batch_size
                )
                updated += len(rows_to_update)
                rows_to_update = []
        if rows_to_update:
            SalesOrderLine.objects.bulk_update(
                rows_to_update, ["resolved_category"], batch_size=batch_size
            )
            updated += len(rows_to_update)
    return updated


def _publish_checkpoint(
    checkpoint: ProjectionCheckpoint,
    state: SourceState,
    revisions: dict[str, SalesDataRevision],
    *,
    sales_changed: bool,
    erp_changed: bool,
) -> None:
    for domain, value, changed in (
        ("sales", state.sales_revision, sales_changed),
        ("erp", state.erp_revision, erp_changed),
    ):
        revision = revisions[domain]
        revision.revision = value
        if changed:
            # Incremental event hashes describe their authoritative scope, not a
            # complete table snapshot. Empty means a later full verify/apply may
            # safely install a new full-domain digest at the same revision.
            revision.source_digest = ""
        revision.save(update_fields=["revision", "source_digest", "updated_at"])
    with target_connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE {CHECKPOINT_TABLE} SET last_event_sequence = %s, last_event_id = %s, "
            "sales_revision = %s, erp_revision = %s, updated_at = CURRENT_TIMESTAMP, "
            "last_checked_at = CURRENT_TIMESTAMP "
            "WHERE id = 1 AND source_epoch = %s AND source_path_digest = %s "
            "AND last_event_sequence = %s AND last_event_id = %s "
            "AND sales_revision = %s AND erp_revision = %s",
            [
                state.head_sequence,
                state.head_event_id,
                state.sales_revision,
                state.erp_revision,
                checkpoint.source_epoch,
                checkpoint.source_path_digest,
                checkpoint.last_event_sequence,
                checkpoint.last_event_id,
                checkpoint.sales_revision,
                checkpoint.erp_revision,
            ],
        )
        if cursor.rowcount != 1:
            raise ProjectionSyncError("projection checkpoint CAS 发布失败")


def _touch_checkpoint(checkpoint: ProjectionCheckpoint) -> None:
    with target_connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE {CHECKPOINT_TABLE} SET updated_at = CURRENT_TIMESTAMP, "
            "last_checked_at = CURRENT_TIMESTAMP WHERE id = 1 AND source_epoch = %s "
            "AND source_path_digest = %s AND last_event_sequence = %s "
            "AND last_event_id = %s AND sales_revision = %s AND erp_revision = %s",
            [
                checkpoint.source_epoch,
                checkpoint.source_path_digest,
                checkpoint.last_event_sequence,
                checkpoint.last_event_id,
                checkpoint.sales_revision,
                checkpoint.erp_revision,
            ],
        )
        if cursor.rowcount != 1:
            raise ProjectionSyncError("projection checkpoint 心跳 CAS 更新失败")


def sync_projection_once(
    path: Path,
    *,
    max_events: int = 1000,
    batch_size: int = 1000,
) -> dict[str, object]:
    path = resolve_source_path(path)
    if max_events < 1 or max_events > 10_000:
        raise ProjectionSyncError("max_events 必须在 1 到 10000 之间")
    if batch_size < 100 or batch_size > 10_000:
        raise ProjectionSyncError("batch_size 必须在 100 到 10000 之间")
    path_digest = source_path_digest(path)
    source = _open_source(path)
    try:
        _validate_source_schema(source)
        state = _read_source_state(source)
        _require_source_stable(path, state)
        with transaction.atomic():
            _acquire_target_lock()
            checkpoint = read_checkpoint(for_update=True)
            if checkpoint is None:
                raise ProjectionSyncError(
                    "projection checkpoint 尚未初始化；先运行 --initialize-checkpoint"
                )
            if checkpoint.source_path_digest != path_digest:
                raise ProjectionSyncError("--source 与 checkpoint 绑定的精确 SQLite 路径不一致")
            if checkpoint.source_epoch != state.source_epoch:
                raise ProjectionSyncError("D1 source_epoch 已变化，必须停止增量并执行受控全量重建")
            if checkpoint.last_event_sequence > state.head_sequence:
                raise ProjectionSyncError("checkpoint sequence 超过 D1 outbox head")
            _validate_checkpoint_anchor(source, checkpoint)
            target_sales, target_erp, revisions = _target_revisions(for_update=True)
            if (target_sales, target_erp) != (
                checkpoint.sales_revision,
                checkpoint.erp_revision,
            ):
                raise ProjectionSyncError("Django 已发布 revision 与 checkpoint 不一致")
            events = _read_pending_events(
                source, checkpoint, state, max_events=max_events
            )
            if not events:
                if checkpoint.last_event_sequence != state.head_sequence:
                    raise ProjectionSyncError("D1 outbox pending 事件不可读取")
                if (checkpoint.sales_revision, checkpoint.erp_revision) != (
                    state.sales_revision,
                    state.erp_revision,
                ):
                    raise ProjectionSyncError("D1 revision 已推进但 outbox 没有对应事件")
                _require_source_stable(path, state)
                _touch_checkpoint(checkpoint)
                return {
                    "status": "up_to_date",
                    "headSequence": state.head_sequence,
                    "salesRevision": state.sales_revision,
                    "erpRevision": state.erp_revision,
                    "eventCount": 0,
                }

            generation = f"projection-sync-{state.head_sequence}"
            sales_batches = _read_sales_batches(source, events)
            _validate_erp_events(source, events)
            erp_events = [event for event in events if event.domain == "erp"]
            products = _read_products(source) if erp_events else []
            new_categories = (
                {
                    str(product["product_code"]): _normalized_category(
                        product["category"]
                    )
                    for product in products
                }
                if erp_events
                else _read_product_categories(source)
            )
            old_categories = (
                {
                    str(code): _normalized_category(category)
                    for code, category in ErpProductMaster.objects.values_list(
                        "product_code", "category"
                    )
                }
                if erp_events
                else {}
            )
            _apply_sales_batches(sales_batches, generation, batch_size)

            affected_categories: list[str] = []
            if erp_events:
                if erp_events[-1].row_count != len(products):
                    raise ProjectionSyncError(
                        "最终 ERP replace_all 事件行数与当前 D1 产品全集不一致"
                    )
                product_count = _apply_products(products, generation, batch_size)
                if product_count != len(products) or ErpProductMaster.objects.count() != len(products):
                    raise ProjectionSyncError("ERP replace_all 目标行数回查失败")
                affected_categories = _changed_category_codes(old_categories, new_categories)

            unique_scopes: list[SalesScope] = []
            seen_scopes: set[str] = set()
            latest_sales_event = next(
                (event for event in reversed(events) if event.domain == "sales"),
                None,
            )
            for event in events:
                if event.sales_scope and event.sales_scope.canonical_json not in seen_scopes:
                    unique_scopes.append(event.sales_scope)
                    seen_scopes.add(event.sales_scope.canonical_json)
            scope_counts: list[dict[str, object]] = []
            for scope in unique_scopes:
                payloads = _iter_sales_payloads(
                    source, scope, new_categories, generation
                )
                if target_connection.vendor == "postgresql":
                    source_count = _apply_sales_scope_postgres(payloads, scope)
                else:
                    source_count = _apply_sales_scope_orm(payloads, scope, batch_size)
                if (
                    latest_sales_event is not None
                    and latest_sales_event.sales_scope is not None
                    and latest_sales_event.sales_scope.canonical_json
                    == scope.canonical_json
                    and latest_sales_event.row_count != source_count
                ):
                    raise ProjectionSyncError(
                        "最终销售 replace_scope 事件行数与当前 D1 权威范围不一致"
                    )
                target_count = _target_sales_scope(scope).count()
                if target_count != source_count:
                    raise ProjectionSyncError("销售 replace_scope 目标行数回查失败")
                scope_counts.append(
                    {"scope": scope.canonical_json, "rowCount": source_count}
                )

            category_rows = 0
            if affected_categories:
                if target_connection.vendor == "postgresql":
                    category_rows = _recalculate_categories_postgres(affected_categories)
                else:
                    category_rows = _recalculate_categories_orm(
                        affected_categories, new_categories, batch_size
                    )

            for batch in sales_batches:
                if not SalesImportBatch.objects.filter(
                    id=str(batch["id"]), status="completed"
                ).exists():
                    raise ProjectionSyncError("销售来源批次目标回查失败")

            _require_source_stable(path, state)
            _publish_checkpoint(
                checkpoint,
                state,
                revisions,
                sales_changed=any(event.domain == "sales" for event in events),
                erp_changed=bool(erp_events),
            )
        return {
            "status": "synchronized",
            "headSequence": state.head_sequence,
            "salesRevision": state.sales_revision,
            "erpRevision": state.erp_revision,
            "eventCount": len(events),
            "salesScopes": scope_counts,
            "erpRowCount": len(products) if erp_events else None,
            "categoryRowsRecomputed": category_rows,
        }
    finally:
        source.rollback()
        source.close()


T = TypeVar("T")


def retry_source_changes(
    action: Callable[[], T],
    *,
    attempts: int = 3,
    delay_seconds: float = 0.1,
) -> T:
    if attempts < 1 or attempts > 10:
        raise ProjectionSyncError("source change retry 次数必须在 1 到 10 之间")
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except SourceChangedDuringSync:
            if attempt == attempts:
                raise
            if delay_seconds > 0:
                time.sleep(delay_seconds)
    raise AssertionError("unreachable")
