"""Atomic, owner-isolated Tmall warehouse snapshots and bounded monitoring."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import math
import hashlib
import json
import re
import uuid
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Count, Exists, F, Max, OuterRef, Q, Subquery, Sum
from django.utils import timezone

from .errors import InventoryApiError
from .revisions import bump_revision, revision_value
from .tmall_warehouse_models import TmallWarehouseAudit, TmallWarehouseBatch, TmallWarehouseFact, TmallWarehouseScope
from .write_requests import lock_active_authority


CONTRACT_VERSION = "tmall-warehouse-v1"
SOURCE_URL = "https://scp.tmall.com/pages/sdigit/fulfillment_realtime_inventory_good_s_ptdjd"
MAX_ROWS = 20_000
MAX_PAGE_FACTS = 5_000
QUANTITIES = {
    "availableQuantity": "available_quantity",
    "onHandQuantity": "on_hand_quantity",
    "salesOccupiedQuantity": "sales_occupied_quantity",
    "goodAvailableQuantity": "good_available_quantity",
    "goodOccupiedQuantity": "good_occupied_quantity",
    "defectiveQuantity": "defective_quantity",
    "purchaseInTransitQuantity": "purchase_in_transit_quantity",
    "transferInTransitQuantity": "transfer_in_transit_quantity",
    "sales7dQuantity": "sales_7d_quantity",
    "sales30dQuantity": "sales_30d_quantity",
}
TEXT_FIELDS = {
    "goodsId": ("goods_id", 160), "goodsCode": ("goods_code", 160),
    "goodsName": ("goods_name", 500), "warehouse": ("warehouse", 200),
    "warehouseCode": ("warehouse_code", 160), "region": ("region", 160),
    "brand": ("brand", 160),
}


def error(message, code="invalid_request", status=400):
    raise InventoryApiError(message, code=code, status=status)


def text(value, label, maximum=160, *, required=True):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        error(f"{label}无效")
    return value.strip()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def number(value):
    if value is None:
        return None
    return int(value) if value == int(value) else float(value)


def quantity(value, label):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        error(f"{label}必须是数字或null")
    try:
        parsed = Decimal(str(value))
        if not parsed.is_finite() or abs(parsed) > 1_000_000_000 or parsed.normalize().as_tuple().exponent < -6:
            error(f"{label}超出允许范围或精度")
        return number(parsed)
    except (InvalidOperation, OverflowError, ValueError):
        error(f"{label}无效")


def source_attributes(value):
    if not isinstance(value, dict) or len(value) > 150:
        error("来源扩展字段必须是最多150项的对象")
    result = {}
    for key, cell in value.items():
        key = text(key, "来源列名", 100)
        if key in {"序号", "源行号", "sourceRowNumber"}:
            continue
        if key in result:
            error("来源列名规范后重复")
        if cell is None or isinstance(cell, bool):
            result[key] = cell
        elif isinstance(cell, (int, float)):
            result[key] = quantity(cell, f"来源字段{key}")
        elif isinstance(cell, str):
            result[key] = text(cell, f"来源字段{key}", 2000, required=False) or None
        else:
            error("来源扩展字段只接受文本、数字、布尔或null")
    if len(canonical(result).encode("utf-8")) > 32_768:
        error("单行来源扩展字段过大", "payload_too_large", 413)
    return result


def normalize(payload):
    allowed = {"owner", "snapshotDate", "fileName", "rawFileHash", "rows", "expectedScopeRevision", "collectedAt", "sourceAsOf", "sourceDate", "sourceUrl", "collectorEvidence"}
    if not isinstance(payload, dict) or set(payload) - allowed:
        error("天猫库存导入包含未知字段")
    owner = text(payload.get("owner"), "货主账号标签")
    day = text(payload.get("snapshotDate"), "库存日期", 10)
    try:
        parsed_day = date.fromisoformat(day)
        if parsed_day.isoformat() != day:
            error("库存日期必须为YYYY-MM-DD")
    except ValueError:
        error("库存日期必须为YYYY-MM-DD")
    file_name = text(payload.get("fileName"), "来源文件名", 255)
    raw_hash = text(payload.get("rawFileHash"), "原文件SHA-256", 64).lower()
    if not re.fullmatch(r"[a-f0-9]{64}", raw_hash):
        error("原文件SHA-256无效")
    expected = payload.get("expectedScopeRevision")
    if expected is not None and (isinstance(expected, bool) or not isinstance(expected, int) or not 0 <= expected <= 2**63 - 1):
        error("货主范围版本无效")
    collected_at = None
    if payload.get("collectedAt") is not None:
        collected = text(payload["collectedAt"], "采集时刻", 40)
        try:
            collected_at = datetime.fromisoformat(collected.replace("Z", "+00:00"))
            if collected_at.tzinfo is None:
                error("采集时刻必须包含时区")
        except (ValueError, OverflowError):
            error("采集时刻必须为ISO日期时间")
    source_as_of = text(payload.get("sourceAsOf", ""), "来源截至时间", 40, required=False)
    source_date = payload.get("sourceDate")
    if source_date is not None:
        if source_date != day:
            error("报表来源日期与库存日期不符", "source_date_mismatch")
        source_date = parsed_day
        if collected_at is None and expected is None:
            error("没有采集时刻的历史库存导入必须提供货主范围版本", "version_conflict", 409)
    elif collected_at is None or collected_at.astimezone(ZoneInfo("Asia/Shanghai")).date() != parsed_day:
        error("无来源日期的实时库存必须绑定采集时刻的上海日期", "source_date_mismatch")
    source_url = text(payload.get("sourceUrl", SOURCE_URL), "来源网址", 300)
    if source_url != SOURCE_URL:
        error("天猫库存来源网址不符", "source_identity_mismatch")
    evidence = payload.get("collectorEvidence", {})
    if not isinstance(evidence, dict) or len(evidence) > 30:
        error("采集证据必须是最多30项的对象")
    evidence = source_attributes(evidence)
    if any(re.search(r"password|passwd|secret|token|cookie|authorization|credential|密码|口令|密钥", key, re.I) for key in evidence):
        error("采集证据不能包含凭据字段")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        error(f"来源数据必须有1到{MAX_ROWS}行；空文件不能清除已有数据")
    output, identities = [], set()
    allowed_row = set(TEXT_FIELDS) | set(QUANTITIES) | {"owner", "sourceAttributes", "sourceRowNumber"}
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict) or set(row) - allowed_row:
            error(f"第{index}行字段无效")
        # The inspected real-time export has supplier columns but no owner.
        # Empty/missing source owner uses the explicitly verified import scope;
        # a supplied nonempty source owner must still match that scope exactly.
        row_owner = text(owner if row.get("owner") in (None, "") else row["owner"], f"第{index}行货主")
        if row_owner != owner:
            error(f"第{index}行货主与声明账号标签不符", "source_identity_mismatch")
        item = {key: text(row.get(key, ""), f"第{index}行{key}", limit, required=key in {"goodsId", "warehouse"}) for key, (_field, limit) in TEXT_FIELDS.items()}
        item["warehouseKey"] = ("code:" + item["warehouseCode"]) if item["warehouseCode"] else ("name:" + item["warehouse"])
        identity = (item["goodsId"], item["warehouseKey"])
        if identity in identities:
            error(f"第{index}行货品ID和仓库重复", "duplicate_row_identity")
        identities.add(identity)
        item.update({key: quantity(row.get(key), f"第{index}行{key}") for key in QUANTITIES})
        item["sourceAttributes"] = source_attributes(row.get("sourceAttributes", {}))
        source_row = row.get("sourceRowNumber", index)
        if isinstance(source_row, bool) or not isinstance(source_row, int) or not 1 <= source_row <= 10_000_000:
            error(f"第{index}行源行号无效")
        item["sourceRowNumber"] = source_row
        output.append(item)
    output.sort(key=lambda item: (item["goodsId"], item["warehouseKey"]))
    return owner, parsed_day, file_name, raw_hash, expected, output, collected_at, source_as_of, source_date, source_url, evidence


def content_hash(owner, day, rows):
    business = [{key: value for key, value in row.items() if key != "sourceRowNumber"} for row in rows]
    # Database collation need not match Python/JavaScript code-point order.
    business.sort(key=lambda item: (item["goodsId"], item["warehouseKey"]))
    return digest({"contract": CONTRACT_VERSION, "owner": owner, "snapshotDate": day.isoformat(), "rows": business})


def fact_payload(row):
    return {
        **{key: getattr(row, field) for key, (field, _limit) in TEXT_FIELDS.items()},
        **{key: number(getattr(row, field)) for key, field in QUANTITIES.items()},
        "sourceAttributes": row.source_attributes, "sourceRowNumber": row.source_row_number,
        "warehouseKey": row.warehouse_key,
    }


def _verify(owner, day, expected_hash, row_count):
    stored = list(TmallWarehouseFact.objects.filter(owner=owner, snapshot_date=day).order_by("goods_id", "warehouse_key"))
    if len(stored) != row_count or content_hash(owner, day, [fact_payload(row) for row in stored]) != expected_hash:
        error("天猫库存落库回查不一致", "verification_failed", 500)


def record_rejection(payload, actor, code):
    with transaction.atomic():
        lock_active_authority()
        owner = payload.get("owner", "") if isinstance(payload, dict) else ""
        result = {"code": code}
        if isinstance(payload, dict):
            for key, maximum in (("fileName", 255), ("snapshotDate", 10), ("rawFileHash", 64)):
                if isinstance(payload.get(key), str) and len(payload[key]) <= maximum:
                    result[key] = payload[key]
        TmallWarehouseAudit.objects.create(owner=owner[:160] if isinstance(owner, str) else "", actor=actor, status="rejected", result=result)


def import_payload(payload, actor):
    try:
        owner_hint = text(payload.get("owner"), "货主账号标签") if isinstance(payload, dict) else ""
        observed_revision = TmallWarehouseScope.objects.filter(owner=owner_hint).values_list("revision", flat=True).first() or 0
        owner, day, file_name, raw_hash, expected, rows, collected_at, source_as_of, source_date, source_url, evidence = normalize(payload)
        expected = observed_revision if expected is None else expected
        fingerprint = content_hash(owner, day, rows)
        with transaction.atomic():
            lock_active_authority()
            # The inventory revision lock is the existing common publication
            # fence. It also serializes first creation of an owner scope.
            revision_value(for_update=True)
            scope, _created = TmallWarehouseScope.objects.get_or_create(owner=owner)
            scope = TmallWarehouseScope.objects.select_for_update().get(owner=owner)
            current = TmallWarehouseBatch.objects.filter(owner=owner, snapshot_date=day, status="completed").order_by("-scope_revision").first()
            duplicate = current is not None and current.content_hash == fingerprint
            if not duplicate and expected != scope.revision:
                error("货主库存已变化，请刷新后重试", "version_conflict", 409)
            if not duplicate and current and current.source_date is None and current.collected_at and collected_at and collected_at < current.collected_at:
                error("旧采集库存不能覆盖同日较新的实时库存", "stale_source_snapshot", 409)
            token = uuid.uuid4().hex
            batch = TmallWarehouseBatch.objects.create(
                id=uuid.uuid4().hex,
                owner=owner, snapshot_date=day, raw_file_hash=raw_hash, content_hash=fingerprint,
                file_name=file_name, row_count=len(rows), status="duplicate" if duplicate else "completed",
                reference_batch_id=current.id if duplicate else "", scope_revision=scope.revision if duplicate else scope.revision + 1,
                collected_at=collected_at, source_as_of=source_as_of,
                source_date=source_date, source_url=source_url, collector_evidence=evidence,
                warehouse_membership="\n" + "\n".join(canonical(value) for value in sorted({row["warehouse"] for row in rows})) + "\n",
                actor=actor,
            )
            if not duplicate:
                scope.owner_token = token
                scope.save(update_fields=["owner_token"])
                TmallWarehouseFact.objects.filter(owner=owner, snapshot_date=day).delete()
                TmallWarehouseFact.objects.bulk_create([
                    TmallWarehouseFact(
                        batch=batch, owner=owner, snapshot_date=day,
                        **{field: row[key] for key, (field, _limit) in TEXT_FIELDS.items()},
                        **{field: row[key] for key, field in QUANTITIES.items()},
                        warehouse_key=row["warehouseKey"],
                        source_attributes=row["sourceAttributes"], source_row_number=row["sourceRowNumber"],
                    ) for row in rows
                ], batch_size=500)
                scope.revision += 1
                scope.latest_snapshot_date = max(day, scope.latest_snapshot_date) if scope.latest_snapshot_date else day
                scope.updated_at = timezone.now()
                if TmallWarehouseScope.objects.filter(owner=owner, owner_token=token, revision=scope.revision - 1).update(
                    revision=scope.revision, latest_snapshot_date=scope.latest_snapshot_date, owner_token="", updated_at=scope.updated_at,
                ) != 1:
                    error("货主库存发布所有权已失效", "version_conflict", 409)
            _verify(owner, day, fingerprint, len(rows))
            TmallWarehouseAudit.objects.create(owner=owner, batch_id=batch.id, actor=actor, status=batch.status, result={"rowCount": len(rows), "contentHash": fingerprint, "rawFileHash": raw_hash})
            revision = bump_revision({"tmallWarehouse": batch.status, "batchId": batch.id, "scopeRevision": scope.revision})
            return {**_batch_payload(batch, not duplicate and day == scope.latest_snapshot_date), "batchId": str(batch.id), "revision": revision, "verified": True}
    except InventoryApiError as exc:
        record_rejection(payload, actor, exc.code)
        raise


def _base(**values):
    return {"contractVersion": CONTRACT_VERSION, "mode": "live", "revision": revision_value(), **values}


def _latest_facts(filters):
    latest = TmallWarehouseScope.objects.filter(owner=OuterRef("owner")).values("latest_snapshot_date")[:1]
    query = TmallWarehouseFact.objects.filter(snapshot_date=Subquery(latest))
    if filters.get("owner"):
        query = query.filter(owner=filters["owner"])
    if filters.get("warehouse"):
        query = query.filter(warehouse=filters["warehouse"])
    if filters.get("q"):
        term = filters["q"]
        query = query.filter(Q(goods_id__icontains=term) | Q(goods_code__icontains=term) | Q(goods_name__icontains=term) | Q(brand__icontains=term))
    return query


def _aggregates():
    result = {"rowCount": Count("id")}
    for key, field in QUANTITIES.items():
        result[key] = Sum(field)
        result[key + "Known"] = Count(field)
    return result


def _totals(aggregate):
    count = aggregate.get("rowCount", 0)
    return (
        {key: number(aggregate[key]) if count > 0 and aggregate[key + "Known"] == count else None for key in QUANTITIES},
        {key: {"knownRows": aggregate[key + "Known"], "totalRows": count, "complete": count > 0 and aggregate[key + "Known"] == count} for key in QUANTITIES},
    )


def _derived(row):
    available, sales = row.get("availableQuantity"), row.get("sales30dQuantity")
    purchase, transfer = row.get("purchaseInTransitQuantity"), row.get("transferInTransitQuantity")
    turnover = round(available * 30 / sales, 2) if available is not None and sales is not None and sales > 0 else None
    suggestion = max(0, math.ceil(Decimal(str(sales)) - Decimal(str(available)) - Decimal(str(purchase)) - Decimal(str(transfer)))) if all(value is not None for value in (sales, available, purchase, transfer)) and sales >= 0 else None
    return {"turnoverDays": turnover, "suggestedQuantity": suggestion, "replenishmentCycleDays": 30}


def _derived_totals(rows, totals, coverage):
    suggestions = [_derived(row)["suggestedQuantity"] for row in rows]
    totals["suggestedQuantity"] = sum(suggestions) if suggestions and all(value is not None for value in suggestions) else None
    totals["turnoverDays"] = _derived(totals)["turnoverDays"] if coverage["availableQuantity"]["complete"] and coverage["sales30dQuantity"]["complete"] else None


def _page(query, filters):
    total = query.count()
    page, size = filters.get("page", 1), filters.get("pageSize", 50)
    start = (page - 1) * size
    items = list(query[start:start + size])
    return items, {"total": total, "page": page, "pageSize": size, "returned": len(items), "truncated": start + len(items) < total}


def monitor(filters):
    query = _latest_facts(filters)
    products = query.values("owner", "goods_id").annotate(**_aggregates()).order_by("owner", "goods_id")
    grouped, page = _page(products, filters)
    totals, coverage = _totals(query.aggregate(**_aggregates()))
    row_count = next(iter(coverage.values()))["totalRows"]
    pairs = Q(pk__in=[])
    for product in grouped:
        pairs |= Q(owner=product["owner"], goods_id=product["goods_id"])
    details = list(query.filter(pairs).order_by("owner", "goods_id", "warehouse")[:MAX_PAGE_FACTS + 1])
    if len(details) > MAX_PAGE_FACTS:
        error("当前页分仓明细超过5000行，请缩小仓库筛选或分页", "query_too_large", 413)
    rows = defaultdict(list)
    for fact in details:
        values = fact_payload(fact)
        rows[(fact.owner, fact.goods_id)].append({**values, **_derived(values), "owner": fact.owner, "snapshotDate": fact.snapshot_date.isoformat(), "batchId": str(fact.batch_id)})
    items = []
    for product in grouped:
        warehouses = rows[(product["owner"], product["goods_id"])]
        first = warehouses[0]
        product_totals, product_coverage = _totals(product)
        _derived_totals(warehouses, product_totals, product_coverage)
        items.append({"owner": product["owner"], "goodsId": product["goods_id"], "goodsCode": first["goodsCode"], "goodsName": first["goodsName"], "brand": first["brand"], "snapshotDate": first["snapshotDate"], "warehouseCount": len(warehouses), "warehouses": warehouses, "totals": product_totals, "quantityCoverage": product_coverage})
    as_of = list(query.values("owner").annotate(snapshotDate=Max("snapshot_date")).order_by("owner")[:201])
    if len(as_of) > 200:
        error("货主数量超过200，请选择货主", "query_too_large", 413)
    for item in as_of:
        item["snapshotDate"] = item["snapshotDate"].isoformat()
    # Complete-scope suggestions are calculated in SQL; per-warehouse positive
    # gaps must not be cancelled by another warehouse's surplus.
    from django.db.models import Case, DecimalField, ExpressionWrapper, Value, When
    from django.db.models.functions import Ceil, Greatest
    valid = Q(available_quantity__isnull=False, sales_30d_quantity__isnull=False, sales_30d_quantity__gte=0, purchase_in_transit_quantity__isnull=False, transfer_in_transit_quantity__isnull=False)
    gap = ExpressionWrapper(F("sales_30d_quantity") - F("available_quantity") - F("purchase_in_transit_quantity") - F("transfer_in_transit_quantity"), output_field=DecimalField(max_digits=25, decimal_places=6))
    derived = query.aggregate(known=Count("id", filter=valid), suggested=Sum(Case(When(valid, then=Greatest(Ceil(gap), Value(0))), default=None, output_field=DecimalField(max_digits=25, decimal_places=0))))
    totals["suggestedQuantity"] = number(derived["suggested"]) if row_count and derived["known"] == row_count else None
    totals["turnoverDays"] = _derived(totals)["turnoverDays"] if coverage["availableQuantity"]["complete"] and coverage["sales30dQuantity"]["complete"] else None
    return _base(items=items, **page, totals=totals, quantityCoverage=coverage, rowCount=row_count, asOf=as_of, replenishmentCycleDays=30, salesBasis="明确来源30日销售出库；缺少期间或数量时保留未知")


def options(filters):
    scopes = TmallWarehouseScope.objects.filter(latest_snapshot_date__isnull=False).order_by("owner")
    owners = list(scopes.values_list("owner", flat=True)[:201])
    warehouses = list(_latest_facts({"owner": filters.get("owner")}).order_by("warehouse").values_list("warehouse", flat=True).distinct()[:501])
    if len(owners) > 200 or len(warehouses) > 500:
        error("货主或仓库选项过多，请缩小范围", "query_too_large", 413)
    revisions = {row.owner: int(row.revision) for row in scopes}
    return _base(owners=owners, warehouses=warehouses, scopeRevisions=revisions)


def _batch_payload(batch, is_current):
    return {"id": str(batch.id), "owner": batch.owner, "snapshotDate": batch.snapshot_date.isoformat(), "rowCount": batch.row_count, "status": batch.status, "fileName": batch.file_name, "rawFileHash": batch.raw_file_hash, "contentHash": batch.content_hash, "createdAt": batch.created_at.isoformat(), "collectedAt": batch.collected_at.isoformat() if batch.collected_at else None, "sourceAsOf": batch.source_as_of, "sourceDate": batch.source_date.isoformat() if batch.source_date else None, "sourceUrl": batch.source_url, "scopeRevision": batch.scope_revision, "referenceBatchId": batch.reference_batch_id, "isCurrent": is_current}


def batches(filters):
    query = TmallWarehouseBatch.objects.all()
    if filters.get("owner"):
        query = query.filter(owner=filters["owner"])
    if filters.get("batchId"):
        query = query.filter(id=filters["batchId"])
    if filters.get("warehouse"):
        query = query.filter(warehouse_membership__contains="\n" + canonical(filters["warehouse"]) + "\n")
    if filters.get("q"):
        query = query.filter(Q(file_name__icontains=filters["q"]) | Q(owner__icontains=filters["q"]))
    latest = TmallWarehouseScope.objects.filter(owner=OuterRef("owner")).values("latest_snapshot_date")[:1]
    query = query.annotate(latest_day=Subquery(latest), has_facts=Exists(TmallWarehouseFact.objects.filter(batch_id=OuterRef("id")))).order_by("-created_at", "-id")
    rows, page = _page(query, filters)
    return _base(items=[_batch_payload(row, row.has_facts and row.snapshot_date == row.latest_day) for row in rows], **page)


def read(operation, filters):
    if operation == "monitor":
        return monitor(filters)
    if operation == "options":
        return options(filters)
    if operation == "batches":
        return batches(filters)
    error("operation必须是monitor、batches或options")
