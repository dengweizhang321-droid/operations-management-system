"""Bounded JD logistics imports, source projections and independent manual evidence.

Imports replace a complete declared source slice. Rows deliberately keep identical
occurrences: the source has not supplied a proven stable event identifier.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime
import hashlib
import json
import math
import re
import uuid
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.db.models import OuterRef, Q, Subquery
from django.utils import timezone

from .errors import InventoryApiError
from .jd_logistics_models import (JdLogisticsAudit, JdLogisticsBatch, JdLogisticsDepartment, JdLogisticsFact, JdLogisticsProductMapping, JdLogisticsScope, JdLogisticsTransferManual)
from .revisions import bump_revision, revision_value
from .write_requests import lock_active_authority

CONTRACT_VERSION = "jd-logistics-v1"
SOURCE_KINDS = ("flow", "shop_products", "realtime_inventory", "inventory_snapshot")
SOURCE_URLS = {"flow": "https://wl.jdl.com/bsc-inventory/flow", "shop_products": "https://wl.jdl.com/supplychain-bbi/esg", "realtime_inventory": "https://jh.jdl.com/#/storage/RealInventory", "inventory_snapshot": "https://jh.jdl.com/#/OfflineInventorySmall"}
MAX_ROWS = 20_000
MAX_READ_ROWS = 50_000
SHANGHAI = ZoneInfo("Asia/Shanghai")
COMMON_FIELDS = {"businessUnitCode", "goodsCode", "goodsName"}
FLOW_TEXT = {"warehouseCode", "warehouseName", "businessType", "inventoryStatus", "inventoryType", "channel", "unit", "merchantDocumentNo", "relatedDocumentNo", "merchantGoodsCode", "merchantMark"}
FLOW_NUMBERS = {"actualBegin", "actualChange", "actualEnd", "availableBegin", "availableChange", "availableEnd"}
PRODUCT_TEXT = {"platform", "shopName", "shopProductCode", "platformSku", "isvCode", "merchantMark", "merchantGoodsCode", "unit", "productStatus"}
INVENTORY_TEXT = {"warehouseCode", "warehouseName", "inventoryStatus", "inventoryType", "unit", "regionCode", "regionName", "merchantGoodsCode", "merchantMark"}
INVENTORY_NUMBERS = {"onHandQuantity", "availableQuantity", "lockedQuantity", "inTransitQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "sales7dQuantity", "sales30dQuantity"}


def _error(message, code="invalid_request", status=400):
    raise InventoryApiError(message, code=code, status=status)


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value):
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value, label, maximum=160, *, required=True):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        _error(f"{label}无效")
    return value.strip()


def _integer(value, label, maximum=1_000_000_000, *, minimum=-1_000_000_000):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        _error(f"{label}必须是范围内整数")
    return value


def _source_attributes(value):
    # Source-only business columns remain textual evidence, not new numeric
    # metrics. Text/null also gives the TS and Python canonical hash one type.
    if not isinstance(value, dict) or len(value) > 100:
        _error("来源扩展字段必须是最多100项的规范对象")
    result = {}
    for raw_key, raw_value in value.items():
        key = _text(raw_key, "来源扩展列名", 100)
        if key == "序号":
            continue  # Display row positions do not change business content.
        if key in result:
            _error("来源扩展列名规范后重复")
        if raw_value is None:
            result[key] = None
        else:
            text = _text(raw_value, f"来源扩展字段{key}", 1000, required=False)
            result[key] = text or None
    return result


def _date(value, label):
    value = _text(value, label, 10)
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        _error(f"{label}必须为YYYY-MM-DD")
    if parsed.isoformat() != value:
        _error(f"{label}必须为YYYY-MM-DD")
    return parsed


def _time(value):
    value = _text(value, "业务发生时间", 40)
    if len(value) < 16 or value[10] not in {"T", " "}:
        _error("业务发生时间必须包含实际时分")
    fraction = re.search(r"\.(\d+)", value)
    if fraction and len(fraction.group(1)) > 6:
        _error("业务发生时间最多支持6位微秒，不能截断来源精度")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        _error("业务发生时间无效")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=SHANGHAI)
    return parsed.astimezone(SHANGHAI).isoformat()


def _keys(payload, allowed, required=()):
    if not isinstance(payload, dict) or set(payload) - set(allowed) or set(required) - set(payload):
        _error("请求字段不完整或包含未知字段")


def _department(identifier):
    identifier = _text(identifier, "事业部ID", 80)
    row = JdLogisticsDepartment.objects.filter(id=identifier).first()
    if row is None:
        _error("请先登记来源事业部", "source_not_registered", 409)
    return row


def _department_payload(row):
    return {"id": row.id, "name": row.name, "businessUnitCode": row.business_unit_code, "storeKeys": row.store_keys, "capabilities": {kind: row.capabilities.get(kind) is True for kind in SOURCE_KINDS}, "logisticsEnabled": row.logistics_enabled, "monitorEnabled": row.monitor_enabled, "pushEnabled": row.push_enabled, "stockoutThresholdDays": row.stockout_threshold_days, "replenishmentCycleDays": row.replenishment_cycle_days, "revision": row.revision, "updatedAt": row.updated_at.isoformat()}


def _mapping_payload(row):
    if row is None:
        return {"erpGoodsCode": "", "erpGoodsName": "", "status": "unconfirmed", "note": "", "revision": 0}
    return {"erpGoodsCode": row.erp_goods_code, "erpGoodsName": row.erp_goods_name, "status": row.status, "note": row.note, "revision": row.revision}


def _manual_payload(row, flow_revision):
    return {"transferStatus": row.transfer_status if row else "pending", "erpDocumentNo": row.erp_document_no if row else "", "note": row.note if row else "", "revision": row.revision if row else 0, "needsReview": bool(row and row.flow_revision != flow_revision), "erpVerified": False}


def _base(**values):
    return {"contractVersion": CONTRACT_VERSION, "mode": "live", "revision": revision_value(), **values}


def _audit(department_id, operation, object_key, actor, before, after):
    JdLogisticsAudit.objects.create(department_id=department_id, operation=operation, object_key=object_key, actor=actor, before=before, after=after)


def normalize_rows(source_kind, rows, business_unit_code, start, end, warehouse_code=""):
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        _error(f"来源数据必须有1到{MAX_ROWS}行；空文件不能清除已有数据")
    output = []
    for index, row in enumerate(rows, 1):
        allowed = COMMON_FIELDS | {"sourceRowNumber", "goodsCodeKind", "sourceAttributes"}
        if source_kind == "flow":
            allowed |= FLOW_TEXT | FLOW_NUMBERS | {"businessTime", "documentNo"}
        elif source_kind == "shop_products":
            allowed |= PRODUCT_TEXT | {"isCombo"}
        else:
            allowed |= INVENTORY_TEXT | INVENTORY_NUMBERS | {"snapshotDate", "sourceProvinceCity"}
        if source_kind != "shop_products":
            allowed |= {"warehouseKey", "warehouseIdentityKind"}
        _keys(row, allowed, COMMON_FIELDS)
        normalized = {key: _text(row.get(key, ""), f"第{index}行{key}", 500 if key == "goodsName" else 160,
                                 required=key != "goodsName" and not (source_kind == "shop_products" and key == "goodsCode")) for key in COMMON_FIELDS}
        if normalized["businessUnitCode"] != business_unit_code:
            _error(f"第{index}行事业部与登记来源不符", "source_identity_mismatch")
        goods_kind = "department_product" if source_kind in {"flow", "shop_products"} else "jd_sku"
        if row.get("goodsCodeKind", goods_kind) != goods_kind:
            _error(f"第{index}行商品编码类型与来源不符", "source_identity_mismatch")
        normalized["goodsCodeKind"] = goods_kind
        normalized["sourceAttributes"] = _source_attributes(row.get("sourceAttributes", {}))
        if source_kind == "flow":
            normalized.update({key: _text(row.get(key, ""), f"第{index}行{key}", 500 if key == "warehouseName" else 100 if key == "warehouseCode" else 160, required=key in {"warehouseCode", "businessType"}) for key in FLOW_TEXT})
            normalized.update({key: _integer(row.get(key), f"第{index}行{key}") for key in FLOW_NUMBERS})
            normalized["businessTime"] = _time(row.get("businessTime"))
            normalized["documentNo"] = _text(row.get("documentNo"), f"第{index}行京东单据")
            business_date = date.fromisoformat(normalized["businessTime"][:10])
        elif source_kind == "shop_products":
            # The official shop-product CSV omits platform. Preserve the
            # unknown source field instead of assigning all shared-BU shops
            # to JD; shop names/ESG remain source relationships, not grants.
            normalized.update({key: _text(row.get(key, ""), f"第{index}行{key}", 200, required=key in {"shopName", "shopProductCode"}) for key in PRODUCT_TEXT})
            if normalized["productStatus"] != "启用":
                _error("店铺商品数据集仅接受事业部的启用关系全集，停用或未提供状态不能混入", "source_scope_mismatch")
            is_combo = row.get("isCombo")
            if is_combo is not None and not isinstance(is_combo, bool):
                _error(f"第{index}行isCombo无效")
            normalized["isCombo"] = is_combo
            business_date = start
        else:
            normalized.update({key: _text(row.get(key, ""), f"第{index}行{key}", 100 if key == "warehouseCode" else 200, required=False) for key in INVENTORY_TEXT})
            normalized.update({key: None if row.get(key) is None else _integer(row[key], f"第{index}行{key}") for key in INVENTORY_NUMBERS})
            if all(normalized[key] is None for key in INVENTORY_NUMBERS):
                _error(f"第{index}行缺少库存数量")
            business_date = _date(row.get("snapshotDate"), f"第{index}行快照日")
            normalized["snapshotDate"] = business_date.isoformat()
            normalized["sourceProvinceCity"] = _text(row.get("sourceProvinceCity", ""), f"第{index}行源省市", 200, required=False)
        if not start <= business_date < end:
            _error(f"第{index}行业务日期超出声明的左闭右开范围", "range_mismatch")
        if warehouse_code and normalized.get("warehouseCode") != warehouse_code:
            _error(f"第{index}行仓库与声明范围不符", "source_identity_mismatch")
        if source_kind != "shop_products":
            code, name = normalized["warehouseCode"], normalized["warehouseName"]
            if not code and not name:
                _error(f"第{index}行缺少源仓库编码或名称")
            identity_kind = "code" if code else "name"
            warehouse_key = f"{identity_kind}:{code or name}"
            if row.get("warehouseIdentityKind", identity_kind) != identity_kind or row.get("warehouseKey", warehouse_key) != warehouse_key:
                _error(f"第{index}行仓库身份与来源不符", "source_identity_mismatch")
            normalized["warehouseIdentityKind"], normalized["warehouseKey"] = identity_kind, warehouse_key
        output.append((normalized, business_date))
    return output


def _slice(query, kind, start, end, warehouse, warehouse_key=""):
    # Product relationships are a full business-unit snapshot, not per-account facts.
    if kind != "shop_products":
        query = query.filter(business_date__gte=start, business_date__lt=end)
    if warehouse:
        query = query.filter(warehouse_code=warehouse)
    if warehouse_key:
        query = query.filter(warehouse_key=warehouse_key)
    return query


def _content_hash(rows):
    # Sorted list preserves duplicate multiplicity while excluding row positions.
    return _hash(sorted(_canonical(row) for row in rows))


def _batch_payload(row):
    return {"batchId": str(row.id), "sourceKind": row.source_kind, "sourceStatus": "enabled" if row.source_kind == "shop_products" else None, "departmentId": row.department_id, "businessUnitCode": row.department.business_unit_code, "rangeStart": row.range_start.isoformat(), "rangeEnd": row.range_end.isoformat(), "warehouseCode": row.warehouse_code, "warehouseKey": row.warehouse_key, "fileName": row.file_name, "rawFileHash": row.raw_file_hash, "contentHash": row.content_hash, "rowCount": row.row_count, "status": row.status, "referenceBatchId": row.reference_batch_id, "scopeRevision": row.scope_revision, "origin": row.origin, "storeKey": row.store_key, "sourceBindingVerified": False, "collectedAt": row.collected_at.isoformat(), "sourceAsOf": row.source_as_of, "collectorEvidence": row.collector_evidence, "createdAt": row.created_at.isoformat()}


def _current_selection(batch):
    query = _slice(JdLogisticsFact.objects.filter(department_id=batch.department_id, source_kind=batch.source_kind), batch.source_kind, batch.range_start, batch.range_end, batch.warehouse_code, batch.warehouse_key)
    rows = list(query.values_list("data", flat=True)[:MAX_ROWS + 1])
    content_hash = _content_hash(rows) if len(rows) <= MAX_ROWS else ""
    scope = JdLogisticsScope.objects.filter(department_id=batch.department_id, source_kind=batch.source_kind).first()
    return {"current": len(rows) == batch.row_count and content_hash == batch.content_hash, "verifiedRowCount": len(rows), "contentHash": content_hash, "scopeRevision": scope.revision if scope else 0}


def _import_payload(payload, actor):
    allowed = {"operation", "sourceKind", "departmentId", "businessUnitCode", "rangeStart", "rangeEnd", "warehouseCode", "warehouseKey", "rawFileHash", "fileName", "rows", "complete", "expectedScopeRevision", "origin", "storeKey", "identityEvidence", "collectedAt", "collectorEvidence", "sourceAsOf"}
    _keys(payload, allowed, {"sourceKind", "departmentId", "businessUnitCode", "rangeStart", "rangeEnd", "rawFileHash", "fileName", "rows", "complete", "expectedScopeRevision"})
    kind = payload["sourceKind"]
    if not isinstance(kind, str) or kind not in SOURCE_KINDS:
        _error("来源类型无效")
    department = _department(payload["departmentId"])
    if payload["businessUnitCode"] != department.business_unit_code:
        _error("来源事业部与登记绑定不符", "source_identity_mismatch")
    if payload["complete"] is not True:
        _error("只接受已确认完整筛选范围的数据", "incomplete_source")
    start, end = _date(payload["rangeStart"], "开始日期"), _date(payload["rangeEnd"], "结束日期")
    if not 0 < (end - start).days <= 366:
        _error("导入范围必须为1到366天（结束日期不包含）")
    warehouse = _text(payload.get("warehouseCode", ""), "仓库范围", 100, required=False)
    warehouse_key = _text(payload.get("warehouseKey", ""), "仓库身份范围", 256, required=False)
    if warehouse_key and not warehouse_key.startswith(("code:", "name:")):
        _error("仓库身份范围无效")
    if warehouse and warehouse_key and warehouse_key != "code:" + warehouse:
        _error("仓库编码与仓库身份范围不符")
    if kind == "shop_products" and (warehouse or warehouse_key):
        _error("店铺商品关系不可按仓库归属替换")
    raw_hash = _text(payload["rawFileHash"], "原文件SHA-256", 64).lower()
    if not re.fullmatch(r"[a-f0-9]{64}", raw_hash):
        _error("原文件SHA-256无效")
    filename = _text(payload["fileName"], "文件名", 255)
    expected = _integer(payload["expectedScopeRevision"], "来源版本", minimum=0)
    origin = payload.get("origin", "manual")
    if not isinstance(origin, str) or origin not in {"manual", "workflow"}:
        _error("导入来源无效")
    store_key = _text(payload.get("storeKey", ""), "受控账号", 100, required=False)
    evidence = payload.get("identityEvidence", {})
    if not isinstance(evidence, dict):
        _error("来源身份观察证据无效")
    if origin == "workflow":
        if not department.logistics_enabled or department.capabilities.get(kind) is not True or store_key not in department.store_keys:
            _error("来源采集尚未启用或账号未绑定该事业部", "source_not_enabled", 409)
        _keys(evidence, {"observedBusinessUnitCode", "observedAt", "sourceUrl", "storeKey"}, {"observedBusinessUnitCode", "observedAt", "sourceUrl", "storeKey"})
        if evidence["observedBusinessUnitCode"] != department.business_unit_code or evidence["storeKey"] != store_key or evidence["sourceUrl"] != SOURCE_URLS[kind]:
            _error("采集器页面读回身份与注册绑定不符", "source_identity_mismatch")
        observed = datetime.fromisoformat(_time(evidence["observedAt"]))
        if not -300 <= (timezone.now() - observed).total_seconds() <= 24 * 3600:
            _error("采集身份观察证据已过期", "source_identity_stale")
    elif evidence or store_key:
        _error("手工文件导入不能声明采集器身份")
    collector_evidence = payload.get("collectorEvidence", {})
    _keys(collector_evidence, {"runId", "executionId", "protocol"})
    collector_evidence = {key: _text(value, key, 160) for key, value in collector_evidence.items()}
    if origin == "manual" and collector_evidence:
        _error("手工导入不能声明自动执行身份")
    collected_at = datetime.fromisoformat(_time(payload["collectedAt"])) if payload.get("collectedAt") else timezone.now()
    if origin == "workflow" and not -300 <= (timezone.now() - collected_at).total_seconds() <= 24 * 3600:
        _error("实际采集时点已过期或在未来", "source_identity_stale")
    source_as_of = payload.get("sourceAsOf", "")
    if source_as_of:
        source_as_of = _date(source_as_of, "来源截止日").isoformat() if isinstance(source_as_of, str) and len(source_as_of) == 10 else _time(source_as_of)
    normalized = normalize_rows(kind, payload["rows"], department.business_unit_code, start, end, warehouse)
    if warehouse_key and any(row.get("warehouseKey") != warehouse_key for row, _day in normalized):
        _error("来源仓库身份与声明范围不符", "source_identity_mismatch")
    if kind == "realtime_inventory" and origin == "workflow" and any(day != collected_at.astimezone(SHANGHAI).date() for _row, day in normalized):
        _error("实时库存只能标记实际上海采集日", "range_mismatch")
    if not source_as_of:
        source_as_of = max(row["businessTime"] for row, _day in normalized) if kind == "flow" else collected_at.astimezone(SHANGHAI).isoformat() if kind in {"realtime_inventory", "shop_products"} else max(day.isoformat() for _row, day in normalized)
    content_hash = _content_hash(row for row, _day in normalized)
    scope_id = _hash([department.id, kind])
    with transaction.atomic():
        lock_active_authority()
        # Revision control row serializes the create-if-absent path, including SQLite tests.
        revision_value(for_update=True)
        department = JdLogisticsDepartment.objects.select_for_update().get(id=department.id)
        if origin == "workflow" and (not department.logistics_enabled or department.capabilities.get(kind) is not True or store_key not in department.store_keys):
            _error("来源设置已变化，请重新规划采集", "version_conflict", 409)
        scope, _created = JdLogisticsScope.objects.get_or_create(id=scope_id, defaults={"department": department, "source_kind": kind})
        scope = JdLogisticsScope.objects.select_for_update().get(id=scope_id)
        owner = uuid.uuid4().hex
        scope.owner_token = owner
        scope.save(update_fields=["owner_token"])
        current = _slice(JdLogisticsFact.objects.filter(department=department, source_kind=kind), kind, start, end, warehouse, warehouse_key)
        current_rows = list(current.values_list("data", flat=True)[:MAX_ROWS + 1])
        duplicate = bool(current_rows) and len(current_rows) == len(normalized) and _content_hash(current_rows) == content_hash
        reference = ""
        if duplicate:
            candidate = JdLogisticsBatch.objects.filter(department=department, source_kind=kind, range_start=start, range_end=end, warehouse_code=warehouse, warehouse_key=warehouse_key, content_hash=content_hash, status="imported").order_by("-created_at").first()
            # A content-equal subset is not the same exact business scope.
            duplicate = candidate is not None
            reference = candidate.id if candidate else ""
        if scope.revision != expected and not duplicate:
            _error("来源版本已变化，请刷新后重试", "version_conflict", 409)
        batch = JdLogisticsBatch.objects.create(department=department, source_kind=kind, range_start=start, range_end=end, warehouse_code=warehouse, warehouse_key=warehouse_key, raw_file_hash=raw_hash, content_hash=content_hash, file_name=filename, row_count=len(normalized), status="duplicate" if duplicate else "imported", reference_batch_id=reference, scope_revision=scope.revision if duplicate else scope.revision + 1, origin=origin, store_key=store_key, identity_evidence=evidence, collector_evidence=collector_evidence, collected_at=collected_at, source_as_of=source_as_of, actor=actor)
        if not duplicate:
            current.delete()
            occurrences = Counter()
            facts = []
            for row, day in normalized:
                row_hash = _hash(row)
                occurrences[row_hash] += 1
                facts.append(JdLogisticsFact(department=department, batch=batch, source_kind=kind, business_date=day, warehouse_code=row.get("warehouseCode", ""), warehouse_key=row.get("warehouseKey", ""), goods_code=row["goodsCode"], goods_code_kind=row["goodsCodeKind"], document_no=row.get("documentNo", ""), row_hash=row_hash, occurrence=occurrences[row_hash], data=row))
            JdLogisticsFact.objects.bulk_create(facts, batch_size=500)
            if JdLogisticsFact.objects.filter(batch=batch).count() != len(normalized):
                _error("导入后的行数回查不一致", "publish_verification_failed", 500)
            if _content_hash(JdLogisticsFact.objects.filter(batch=batch).values_list("data", flat=True)) != content_hash:
                _error("导入后的内容回查不一致", "publish_verification_failed", 500)
            # The whole source business unit is fenced, including overlapping warehouse scopes.
            changed = JdLogisticsScope.objects.filter(id=scope_id, owner_token=owner, revision=expected).update(revision=expected + 1, owner_token="", updated_at=timezone.now())
            if changed != 1:
                _error("来源写入所有权失效", "version_conflict", 409)
            bump_revision({"jdLogistics": kind, "departmentId": department.id, "batchId": str(batch.id)})
        else:
            JdLogisticsScope.objects.filter(id=scope_id, owner_token=owner).update(owner_token="", updated_at=timezone.now())
        bump_revision({"jdLogisticsAttempt": str(batch.id), "status": batch.status})
        _audit(department.id, "import", str(batch.id), actor, {}, {"sourceKind": kind, "status": batch.status, "rowCount": batch.row_count, "contentHash": content_hash, "rawFileHash": raw_hash})
        return _base(**_batch_payload(batch), verifiedRowCount=len(normalized), erpVerificationAvailable=False)


def _flow_revision(department_id, document_no, goods_code):
    rows = sorted(JdLogisticsFact.objects.filter(department_id=department_id, source_kind="flow", document_no=document_no, goods_code=goods_code).values_list("row_hash", flat=True))
    mapping = JdLogisticsProductMapping.objects.filter(department_id=department_id, goods_code_kind="department_product", goods_code=goods_code).first()
    return _hash([rows, mapping.revision if mapping else 0])


def _flow_revision_map(keys):
    if not keys:
        return {}
    grouped = defaultdict(list)
    departments = {key[0] for key in keys}
    rows = JdLogisticsFact.objects.filter(department_id__in=departments, source_kind="flow").values_list("department_id", "document_no", "goods_code", "row_hash")[:MAX_READ_ROWS + 1]
    for index, (department, document, goods, digest) in enumerate(rows):
        if index == MAX_READ_ROWS:
            _error("事业部流水较多，请分拆来源范围后查询", "query_too_large", 413)
        key = (department, document, goods)
        if key in keys:
            grouped[key].append(digest)
    mapping_versions = {(row.department_id, row.goods_code): row.revision for row in JdLogisticsProductMapping.objects.filter(department_id__in=departments, goods_code_kind="department_product")}
    return {key: _hash([sorted(digests), mapping_versions.get((key[0], key[2]), 0)]) for key, digests in grouped.items()}


def mutate(payload, actor):
    operation = payload.get("operation")
    if not isinstance(operation, str) or operation not in {"settings", "mapping", "manual"}:
        _error("维护操作无效")
    common = {"operation", "departmentId", "expectedRevision"}
    fields = {"settings": {"name", "businessUnitCode", "storeKeys", "capabilities", "logisticsEnabled", "monitorEnabled", "pushEnabled", "stockoutThresholdDays", "replenishmentCycleDays"}, "mapping": {"goodsCode", "goodsCodeKind", "erpGoodsCode", "erpGoodsName", "status", "note"}, "manual": {"documentNo", "goodsCode", "transferStatus", "erpDocumentNo", "note", "expectedFlowRevision"}}
    _keys(payload, common | fields[operation], common)
    identifier = _text(payload["departmentId"], "事业部ID", 80)
    expected = _integer(payload["expectedRevision"], "人工版本", minimum=0)
    with transaction.atomic():
        lock_active_authority()
        revision_value(for_update=True)
        if operation == "settings":
            row = JdLogisticsDepartment.objects.select_for_update().filter(id=identifier).first()
            if (row.revision if row else 0) != expected:
                _error("事业部设置已变化，请刷新后重试", "version_conflict", 409)
            before = _department_payload(row) if row else {}
            name = _text(payload.get("name", row.name if row else None), "事业部名称", 200)
            business_unit = _text(payload.get("businessUnitCode", row.business_unit_code if row else None), "事业部编码", 100)
            if row and business_unit != row.business_unit_code:
                _error("已登记事业部编码不能修改，请新增独立事业部")
            if JdLogisticsDepartment.objects.filter(business_unit_code=business_unit).exclude(id=identifier).exists():
                _error("同一事业部已登记，多个账号应绑定同一事业部", "source_already_registered", 409)
            stores = payload.get("storeKeys", row.store_keys if row else [])
            if not isinstance(stores, list) or len(stores) > 30 or any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value) for value in stores) or len(set(stores)) != len(stores):
                _error("受控账号绑定无效")
            caps = payload.get("capabilities", row.capabilities if row else {})
            if not isinstance(caps, dict) or set(caps) - set(SOURCE_KINDS) or any(not isinstance(value, bool) for value in caps.values()):
                _error("来源能力必须是明确布尔值")
            caps = {kind: caps.get(kind, False) for kind in SOURCE_KINDS}
            flags = {}
            for key, model_key in (("logisticsEnabled", "logistics_enabled"), ("monitorEnabled", "monitor_enabled"), ("pushEnabled", "push_enabled")):
                value = payload.get(key, getattr(row, model_key) if row else False)
                if not isinstance(value, bool):
                    _error(f"{key}必须是明确布尔值")
                flags[model_key] = value
            if row is None and (any(caps.values()) or any(flags.values())):
                _error("新增事业部的能力及采集、监控、推送开关必须全部关闭")
            if flags["logistics_enabled"] and (not stores or not any(caps.values())):
                _error("启用物流采集前必须绑定受控账号并配置来源能力")
            if row is None:
                row = JdLogisticsDepartment(id=identifier)
            row.name, row.business_unit_code, row.store_keys, row.capabilities = name, business_unit, stores, caps
            for key, value in flags.items():
                setattr(row, key, value)
            threshold = payload.get("stockoutThresholdDays", row.stockout_threshold_days)
            row.stockout_threshold_days = None if threshold is None else _integer(threshold, "缺货提醒天数", 3650, minimum=1)
            cycle = payload.get("replenishmentCycleDays", row.replenishment_cycle_days)
            row.replenishment_cycle_days = _integer(cycle, "补货周期天数", 3650, minimum=1)
            row.revision = expected + 1
            row.updated_by, row.updated_at = actor, timezone.now()
            row.save()
            after = _department_payload(row)
            object_key = _hash(identifier)
        else:
            department = _department(identifier)
            goods = _text(payload.get("goodsCode"), "事业部商品编号")
            if not JdLogisticsFact.objects.filter(department=department, goods_code=goods).exists():
                _error("当前事业部没有该商品来源事实", "source_not_found", 409)
            if operation == "mapping":
                goods_kind = payload.get("goodsCodeKind", "department_product")
                if not isinstance(goods_kind, str) or goods_kind not in {"department_product", "jd_sku"}:
                    _error("商品编码类型无效")
                if not JdLogisticsFact.objects.filter(department=department, goods_code=goods, goods_code_kind=goods_kind).exists():
                    _error("当前事业部没有该编码类型的商品来源事实", "source_not_found", 409)
                object_key = _hash([identifier, goods_kind, goods])
                row = JdLogisticsProductMapping.objects.select_for_update().filter(id=object_key).first()
                before = _mapping_payload(row)
                if before["revision"] != expected:
                    _error("商品人工映射已变化，请刷新后重试", "version_conflict", 409)
                values = {"erp_goods_code": _text(payload.get("erpGoodsCode", ""), "ERP货品编号", required=False), "erp_goods_name": _text(payload.get("erpGoodsName", ""), "ERP货品名称", 500, required=False), "note": _text(payload.get("note", ""), "备注", 1000, required=False)}
                status = payload.get("status", "confirmed")
                if not isinstance(status, str) or status not in {"confirmed", "ignored", "unconfirmed"} or status == "confirmed" and not values["erp_goods_code"]:
                    _error("映射状态无效，已确认映射必须有ERP编号")
                row = row or JdLogisticsProductMapping(id=object_key, department=department, goods_code=goods, goods_code_kind=goods_kind)
                for key, value in values.items():
                    setattr(row, key, value)
                row.status = status
                row.revision, row.updated_by, row.updated_at = expected + 1, actor, timezone.now()
                row.save()
                after = {"departmentId": identifier, "goodsCodeKind": goods_kind, "goodsCode": goods, **_mapping_payload(row)}
            else:
                document = _text(payload.get("documentNo"), "京东单据")
                if not JdLogisticsFact.objects.filter(department=department, source_kind="flow", goods_code=goods, document_no=document).exists():
                    _error("当前事业部没有该调拨商品来源事实", "source_not_found", 409)
                object_key = _hash([identifier, document, goods])
                row = JdLogisticsTransferManual.objects.select_for_update().filter(id=object_key).first()
                flow_revision = _flow_revision(identifier, document, goods)
                before = _manual_payload(row, flow_revision)
                if before["revision"] != expected or payload.get("expectedFlowRevision") != flow_revision:
                    _error("人工状态或京东流水已变化，请刷新后重试", "version_conflict", 409)
                status = payload.get("transferStatus")
                if not isinstance(status, str) or status not in {"pending", "completed", "ignored"}:
                    _error("人工调拨状态无效")
                row = row or JdLogisticsTransferManual(id=object_key, department=department, document_no=document, goods_code=goods)
                row.transfer_status = status
                row.erp_document_no = _text(payload.get("erpDocumentNo", ""), "ERP单据", required=False)
                row.note = _text(payload.get("note", ""), "备注", 1000, required=False)
                row.flow_revision = flow_revision
                row.revision, row.updated_by, row.updated_at = expected + 1, actor, timezone.now()
                row.save()
                after = {"departmentId": identifier, "documentNo": document, "goodsCode": goods, "flowRevision": flow_revision, **_manual_payload(row, flow_revision)}
        _audit(identifier, operation, object_key, actor, before, after)
        bump_revision({"jdLogistics": operation, "object": object_key, "revision": expected + 1})
        return _base(**after)


def import_payload(payload, actor):
    try:
        return _import_payload(payload, actor)
    except InventoryApiError as error:
        # Rejections do not create source scopes, fingerprints or business batches.
        with transaction.atomic():
            lock_active_authority()
            identifier = payload.get("departmentId", "") if isinstance(payload, dict) else ""
            identifier = identifier[:80] if isinstance(identifier, str) else ""
            _audit(identifier, "import_rejected", "", actor, {}, {"code": error.code})
        raise


def options():
    from .jd_logistics_notifications import notification_policy
    departments = list(JdLogisticsDepartment.objects.order_by("name", "id")[:201])
    if len(departments) > 200:
        _error("事业部数量超出当前页面上限", "query_too_large", 413)
    warehouses = {}
    for key, code, name in JdLogisticsFact.objects.exclude(warehouse_key="").values_list("warehouse_key", "warehouse_code", "data__warehouseName").distinct()[:501]:
        warehouses[key] = {"key": key, "code": code, "name": name or code, "identityKind": "code" if code else "name"}
    policy = notification_policy()
    return _base(departments=[_department_payload(row) for row in departments], warehouses=[value for _key, value in sorted(warehouses.items())[:500]], scopeRevisions=[{"departmentId": row.department_id, "sourceKind": row.source_kind, "revision": row.revision} for row in JdLogisticsScope.objects.order_by("id")[:800]], sourceKinds=list(SOURCE_KINDS), erpVerificationAvailable=False, notification=policy, notificationAvailable=policy["enabled"] and policy["configured"])


def _query(options, kind=None):
    query = JdLogisticsFact.objects.all()
    if kind:
        query = query.filter(source_kind=kind)
    if options.get("departmentId"):
        query = query.filter(department_id=options["departmentId"])
    if options.get("departmentIds"):
        query = query.filter(department_id__in=options["departmentIds"])
    if options.get("businessUnitCode"):
        query = query.filter(department__business_unit_code=options["businessUnitCode"])
    if options.get("warehouseCode"):
        query = query.filter(warehouse_code=options["warehouseCode"])
    if options.get("warehouseKey"):
        query = query.filter(warehouse_key=options["warehouseKey"])
    if options.get("goodsCodeKind"):
        query = query.filter(goods_code_kind=options["goodsCodeKind"])
    if options.get("startDate"):
        query = query.filter(business_date__gte=options["startDate"])
    if options.get("endDate"):
        query = query.filter(business_date__lt=options["endDate"])
    if options.get("q"):
        term = options["q"]
        query = query.filter(Q(goods_code__icontains=term) | Q(document_no__icontains=term) | Q(data__goodsName__icontains=term))
    return query


def _page(items, options):
    page, size = options.get("page", 1), options.get("pageSize", 50)
    start = (page - 1) * size
    return {"items": items[start:start + size], "total": len(items), "page": page, "pageSize": size}


def _rows(options, kind):
    rows = list(_query(options, kind).select_related("department", "batch").order_by("business_date", "id")[:MAX_READ_ROWS + 1])
    if len(rows) > MAX_READ_ROWS:
        _error("当前范围数据较多，请缩短日期或选择事业部", "query_too_large", 413)
    return rows


def _manual_maps(rows):
    departments = {row.department_id for row in rows}
    goods = {row.goods_code for row in rows}
    mappings = {(row.department_id, row.goods_code_kind, row.goods_code): row for row in JdLogisticsProductMapping.objects.filter(department_id__in=departments, goods_code__in=goods)}
    manuals = {(row.department_id, row.document_no, row.goods_code): row for row in JdLogisticsTransferManual.objects.filter(department_id__in=departments, goods_code__in=goods)}
    return mappings, manuals


def _transfer_items(options):
    rows = _rows(options, "flow")
    mappings, manuals = _manual_maps(rows)
    groups = defaultdict(list)
    for row in rows:
        # Retain unknown transfer events for review; physical quantities use only
        # the explicitly observed source type and component pairs below.
        if "调拨" in row.data["businessType"]:
            groups[(row.department_id, row.document_no, row.goods_code)].append(row)
    flow_revisions = _flow_revision_map(set(groups))
    items = []
    for (department_id, document, goods), facts in groups.items():
        outgoing, incoming, out_warehouses, in_warehouses = 0, 0, set(), set()
        anomaly = False
        unknown = False
        destination_hints = set()
        for fact in facts:
            data = fact.data
            quantity = data["actualChange"]
            warehouse = data["warehouseName"] or data["warehouseCode"]
            kind, component = data["businessType"], data["inventoryType"]
            if kind == "仓间调拨内配出库回传" and component == "内配出锁定" and quantity < 0:
                outgoing += -quantity
                out_warehouses.add(warehouse)
            elif kind == "仓间调拨入库回传" and component == "可销售" and quantity > 0:
                incoming += quantity
                in_warehouses.add(warehouse)
            elif kind == "仓间调拨内配出库回传" and component == "在途库存" and quantity >= 0:
                destination_hints.add(warehouse)
            elif kind == "仓间调拨入库回传" and component == "在途库存" and quantity <= 0:
                pass  # Matching in-transit decrement is not another physical dispatch.
            elif kind == "仓间调拨内配出库单下发预占" and component in {"可销售", "内配出锁定"}:
                pass  # Reservation is not physical dispatch or receipt.
            else:
                unknown = True
        if not in_warehouses:
            in_warehouses.update(destination_hints)
        merchant_docs = {fact.data["merchantDocumentNo"] for fact in facts if fact.data["merchantDocumentNo"]}
        anomaly = anomaly or incoming > outgoing or len(out_warehouses) > 1 or len(in_warehouses) > 1 or len(merchant_docs) > 1
        status = "quantity_anomaly" if anomaly else "review" if unknown or not outgoing else "completed" if incoming == outgoing else "partial" if incoming else "in_transit"
        flow_revision = flow_revisions[(department_id, document, goods)]
        manual = _manual_payload(manuals.get((department_id, document, goods)), flow_revision)
        times = [fact.data["businessTime"] for fact in facts]
        items.append({"id": _hash([department_id, document, goods]), "departmentId": department_id, "businessUnitCode": facts[0].department.business_unit_code, "documentNo": document, "goodsCode": goods, "goodsName": facts[-1].data["goodsName"], **_mapping_payload(mappings.get((department_id, "department_product", goods))), "mappingRevision": _mapping_payload(mappings.get((department_id, "department_product", goods)))["revision"], "outQuantity": outgoing, "inQuantity": incoming, "outWarehouses": sorted(out_warehouses), "inWarehouses": sorted(in_warehouses), "jdStatus": status, "firstBusinessTime": min(times), "lastBusinessTime": max(times), **manual, "flowRevision": flow_revision, "sharedBusinessUnitFlow": True, "coverageComplete": False})
    items.sort(key=lambda item: (item["lastBusinessTime"], item["id"]), reverse=True)
    return items


def _inventory_date_pair(live, snapshot):
    qualifications = []
    pairing, lag = "unqualified", None
    if live:
        live_day = live.batch.collected_at.astimezone(SHANGHAI).date()
        if live.business_date != live_day:
            qualifications.append("realtime_collection_date_mismatch")
    if snapshot:
        try:
            source_day = date.fromisoformat(snapshot.batch.source_as_of[:10])
        except (TypeError, ValueError):
            source_day = None
        if source_day != snapshot.business_date:
            qualifications.append("snapshot_source_as_of_mismatch")
        if snapshot.business_date > snapshot.batch.collected_at.astimezone(SHANGHAI).date():
            qualifications.append("snapshot_business_date_in_future")
    if live and snapshot:
        lag = (live_day - snapshot.business_date).days
        # The source snapshot is officially available through T-1. T live
        # inventory paired with T-1's rolling sales is the regular daily case.
        # An explicitly supplied same-day snapshot is also a comparable period.
        if lag not in {0, 1}:
            qualifications.append("source_date_mismatch")
        elif not qualifications:
            pairing = "same_day" if lag == 0 else "previous_day"
    return qualifications, pairing, lag


LIVE_METRICS = ("onHandQuantity", "availableQuantity", "lockedQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity")
SALES_METRICS = ("sales7dQuantity", "sales30dQuantity")
DERIVED_METRICS = ("postReplenishmentQuantity", "turnoverDays", "availableDays", "availableWithTransitDays", "nativeTurnover30d", "stockoutAvailableDays30d", "suggestedReplenishmentQuantity")
MATRIX_METRICS = LIVE_METRICS + SALES_METRICS + DERIVED_METRICS
MAX_MATRIX_COLUMNS = 200
MAX_PRODUCT_DETAILS = 200
MAX_MATRIX_DETAILS = 5_000


def _reasons(*collections):
    return sorted({value for collection in collections for value in collection})


def _native_turnover(data):
    value = data.get("sourceAttributes", {}).get("30天周转")
    if value is None or value == "":
        return None, ["native_turnover_not_provided"]
    if not isinstance(value, str) or not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value):
        return None, ["invalid_native_turnover"]
    parsed = float(value)
    return (parsed, []) if math.isfinite(parsed) else (None, ["invalid_native_turnover"])


def _warehouse_metrics(live, snapshot, date_qualifications, sales_window, replenishment_cycle_days=30):
    live_data = live.data if live else {}
    snapshot_data = snapshot.data if snapshot else {}
    metrics = {key: live_data.get(key) for key in LIVE_METRICS}
    metrics.update({key: snapshot_data.get(key) for key in SALES_METRICS})
    reasons = {}
    live_reasons = (["missing_realtime_source"] if live is None else []) + (["realtime_collection_date_mismatch"] if "realtime_collection_date_mismatch" in date_qualifications else [])
    snapshot_reasons = (["missing_snapshot_source"] if snapshot is None else []) + [value for value in date_qualifications if value != "realtime_collection_date_mismatch"]
    for key in LIVE_METRICS:
        reasons[key] = _reasons(live_reasons, ["missing_" + key] if metrics[key] is None else [])
    for key in SALES_METRICS:
        reasons[key] = _reasons(snapshot_reasons, ["missing_" + key] if metrics[key] is None else [])
    reasons["postReplenishmentQuantity"] = _reasons(*(reasons[key] for key in ("availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity")))
    metrics["postReplenishmentQuantity"] = sum(metrics[key] for key in ("availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity")) if not reasons["postReplenishmentQuantity"] else None
    demand_key = "sales7dQuantity" if sales_window == 7 else "sales30dQuantity"
    for target, numerator, denominator, window in (("turnoverDays", "onHandQuantity", "sales30dQuantity", 30), ("stockoutAvailableDays30d", "availableQuantity", "sales30dQuantity", 30), ("availableDays", "availableQuantity", demand_key, sales_window), ("availableWithTransitDays", "postReplenishmentQuantity", demand_key, sales_window)):
        ratio_reasons = _reasons(reasons[numerator], reasons[denominator], date_qualifications)
        if metrics[denominator] is not None and metrics[denominator] <= 0:
            ratio_reasons = _reasons(ratio_reasons, ["nonpositive_" + denominator])
        reasons[target] = ratio_reasons
        metrics[target] = round(metrics[numerator] / metrics[denominator] * window, 2) if not ratio_reasons else None
    native, native_reasons = _native_turnover(snapshot_data)
    metrics["nativeTurnover30d"] = native
    reasons["nativeTurnover30d"] = _reasons(snapshot_reasons, native_reasons)
    cycle = _integer(replenishment_cycle_days, "补货周期天数", 3650, minimum=1)
    suggested_reasons = _reasons(*(reasons[key] for key in ("availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "sales30dQuantity")), date_qualifications)
    if metrics["sales30dQuantity"] is not None and metrics["sales30dQuantity"] < 0:
        suggested_reasons = _reasons(suggested_reasons, ["negative_sales30dQuantity"])
    suggested = None
    if not suggested_reasons:
        # Integer numerator retains exact ceiling semantics even for large
        # quantities or fractional daily demand; zero demand follows the same
        # formula so a known negative net stock still produces a shortage.
        shortage_numerator = metrics["sales30dQuantity"] * cycle - 30 * sum(metrics[key] for key in ("availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity"))
        suggested = max(0, (shortage_numerator + 29) // 30)
    metrics["suggestedReplenishmentQuantity"] = suggested
    reasons["suggestedReplenishmentQuantity"] = suggested_reasons
    return {**metrics, "metricQualifications": reasons, "replenishmentCycleDays": cycle, "replenishmentCycleDaysValues": [cycle]}


def _monitor_warning(available_days_30d, threshold, enabled):
    if threshold is None or not enabled:
        return "unconfigured"
    if available_days_30d is None:
        return "insufficient_evidence"
    return "stockout_risk" if available_days_30d < threshold else "within_threshold"


def _aggregate_metrics(rows, sales_window, *, scope_total=False):
    metrics, reasons = {}, {}
    for key in LIVE_METRICS + SALES_METRICS:
        field_reasons = _reasons(*(row["metricQualifications"][key] for row in rows))
        if not rows:
            field_reasons = ["empty_scope"]
        metrics[key] = sum(row[key] for row in rows) if not field_reasons else None
        reasons[key] = field_reasons
    reasons["postReplenishmentQuantity"] = _reasons(*(reasons[key] for key in ("availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity")))
    metrics["postReplenishmentQuantity"] = sum(metrics[key] for key in ("availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity")) if not reasons["postReplenishmentQuantity"] else None
    demand = "sales7dQuantity" if sales_window == 7 else "sales30dQuantity"
    for target, numerator, denominator, window in (("turnoverDays", "onHandQuantity", "sales30dQuantity", 30), ("stockoutAvailableDays30d", "availableQuantity", "sales30dQuantity", 30), ("availableDays", "availableQuantity", demand, sales_window), ("availableWithTransitDays", "postReplenishmentQuantity", demand, sales_window)):
        # A known zero warehouse demand participates as zero in a positive
        # group demand; it does not invalidate a ratio for the complete group.
        member_reasons = [[reason for reason in row["metricQualifications"][target] if not reason.startswith("nonpositive_")] for row in rows]
        field_reasons = _reasons(reasons[numerator], reasons[denominator], *member_reasons)
        if len({row["realtimeDate"] for row in rows}) > 1 or len({row["snapshotDate"] for row in rows}) > 1:
            field_reasons = _reasons(field_reasons, ["period_mismatch"])
        if metrics[denominator] is not None and metrics[denominator] <= 0:
            field_reasons = _reasons(field_reasons, ["nonpositive_" + denominator])
        reasons[target] = field_reasons
        metrics[target] = round(metrics[numerator] / metrics[denominator] * window, 2) if not field_reasons else None
    metrics["nativeTurnover30d"] = None
    reasons["nativeTurnover30d"] = ["native_turnover_not_additive"]
    # Each warehouse owns its shortage. An excess at a different warehouse is
    # not transferable replenishment, so do not subtract across warehouses.
    suggested_reasons = _reasons(*(row["metricQualifications"]["suggestedReplenishmentQuantity"] for row in rows))
    if not rows:
        suggested_reasons = ["empty_scope"]
    metrics["suggestedReplenishmentQuantity"] = sum(row["suggestedReplenishmentQuantity"] for row in rows) if not suggested_reasons else None
    cycles = sorted({row["replenishmentCycleDays"] for row in rows})
    if len(cycles) > 1:
        suggested_reasons = _reasons(suggested_reasons, ["mixed_replenishment_cycles"])
    reasons["suggestedReplenishmentQuantity"] = suggested_reasons
    thresholds = {row["stockoutThresholdDays"] for row in rows}
    threshold = next(iter(thresholds)) if len(thresholds) == 1 else None
    enabled = bool(rows) and all(row["monitorEnabled"] for row in rows)
    warning = _monitor_warning(metrics["stockoutAvailableDays30d"], threshold, enabled)
    qualifications = _reasons(*(row["qualifications"] for row in rows), *(reasons[key] for key in MATRIX_METRICS))
    if len({row["realtimeDate"] for row in rows}) > 1 or len({row["snapshotDate"] for row in rows}) > 1:
        qualifications = _reasons(qualifications, ["period_mismatch"])
    return {**metrics, "metricQualifications": reasons, "qualifications": qualifications, "warningState": warning, "stockoutThresholdDays": threshold, "replenishmentCycleDays": cycles[0] if len(cycles) == 1 else None, "replenishmentCycleDaysValues": cycles, "realtimeDates": sorted({row["realtimeDate"] for row in rows if row["realtimeDate"]}), "snapshotDates": sorted({row["snapshotDate"] for row in rows if row["snapshotDate"]})}


def _product_matrix(items, filters, sales_window):
    columns, groups = {}, defaultdict(list)
    for row in items:
        province = row["sourceProvinceCity"]
        identity = ["source_province_city", province] if province else ["warehouse", row["departmentId"], row["warehouseKey"]]
        column_key = _hash(identity)
        column = columns.setdefault(column_key, {"key": column_key, "label": province or row["warehouseName"] or row["warehouseKey"], "kind": "source_province_city" if province else "warehouse", "sourceProvinceCity": province or None, "warehouseKeys": set()})
        column["warehouseKeys"].add(row["warehouseKey"])
        row = {**row, "columnKey": column_key}
        groups[(row["departmentId"], row["goodsCode"])].append(row)
    if len(columns) > MAX_MATRIX_COLUMNS:
        _error("当前库存矩阵超过200列，请选择事业部或仓库", "query_too_large", 413)
    products = []
    for (department_id, goods), details in sorted(groups.items()):
        details.sort(key=lambda row: (row["warehouseName"], row["warehouseKey"]))
        reference = details[0]
        cells = defaultdict(list)
        for row in details:
            cells[row["columnKey"]].append(row)
        products.append({"id": _hash([department_id, "jd_sku", goods]), "departmentId": department_id, "businessUnitCode": reference["businessUnitCode"], "goodsCodeKind": "jd_sku", "goodsCode": goods, "goodsName": reference["goodsName"], "erpGoodsCode": reference["erpGoodsCode"], "erpGoodsName": reference["erpGoodsName"], "imageUrl": None, "price": None, "summary": _aggregate_metrics(details, sales_window), "cells": [{"columnKey": key, **_aggregate_metrics(values, sales_window)} for key, values in sorted(cells.items())], "details": details[:MAX_PRODUCT_DETAILS], "detailCount": len(details), "detailsComplete": len(details) <= MAX_PRODUCT_DETAILS, "detailsTruncated": len(details) > MAX_PRODUCT_DETAILS})
    page = _page(products, filters)
    if sum(len(item["details"]) for item in page["items"]) > MAX_MATRIX_DETAILS:
        _error("当前页展开明细超过5000行，请缩小每页单品数", "query_too_large", 413)
    ordered_columns = sorted(columns.values(), key=lambda column: (column["kind"], column["label"], column["key"]))
    return {**page, "layout": "product", "salesWindow": sales_window, "columns": [{**column, "warehouseKeys": sorted(column["warehouseKeys"])} for column in ordered_columns], "totals": _aggregate_metrics(items, sales_window, scope_total=True)}


def inventory_monitor(filters):
    layout = filters.get("layout", "warehouse")
    sales_window = filters.get("salesWindow", 30)
    if layout not in {"warehouse", "product"} or isinstance(sales_window, bool) or sales_window not in {7, 30}:
        _error("库存布局或销量窗口无效")
    # Bound the actual current projection, not months of unrelated flow history.
    # The correlated latest day is per business unit and source, before the cap.
    latest_day = JdLogisticsFact.objects.filter(department_id=OuterRef("department_id"), source_kind=OuterRef("source_kind")).order_by("-business_date").values("business_date")[:1]
    query = _query(filters).filter(source_kind__in=["realtime_inventory", "inventory_snapshot"], business_date=Subquery(latest_day))
    rows = list(query.select_related("department", "batch").order_by("business_date", "id")[:MAX_READ_ROWS + 1])
    if len(rows) > MAX_READ_ROWS:
        _error("当前库存明细较多，请选择事业部或仓库", "query_too_large", 413)
    latest_days = {}
    for row in rows:
        source_key = (row.department_id, row.source_kind)
        latest_days[source_key] = max(latest_days.get(source_key, row.business_date), row.business_date)
    groups = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row.business_date == latest_days[(row.department_id, row.source_kind)]:
            groups[(row.department_id, row.goods_code, row.warehouse_key)][row.source_kind].append(row)
    mappings, _manuals = _manual_maps(rows)
    departments = {row.id: row for row in JdLogisticsDepartment.objects.filter(id__in={key[0] for key in groups})}
    items = []
    for (department_id, goods, warehouse_key), sources in sorted(groups.items()):
        live_rows, snapshot_rows = sources.get("realtime_inventory", []), sources.get("inventory_snapshot", [])
        live = live_rows[0] if len(live_rows) == 1 else None
        snap = snapshot_rows[0] if len(snapshot_rows) == 1 else None
        reference = (live_rows or snapshot_rows)[0]
        mapping = mappings.get((department_id, "jd_sku", goods))
        department = departments[department_id]
        qualifications = []
        if not live_rows:
            qualifications.append("missing_realtime_source")
        if not snapshot_rows:
            qualifications.append("missing_snapshot_source")
        if len(live_rows) > 1 or len(snapshot_rows) > 1:
            qualifications.append("ambiguous_source_rows")
        date_qualifications, date_pairing, date_lag = _inventory_date_pair(live, snap)
        qualifications.extend(date_qualifications)
        if not mapping or mapping.status != "confirmed":
            qualifications.append("unconfirmed_product_mapping")
        data = live.data if live else {}
        snapshot_data = snap.data if snap else {}
        metrics = _warehouse_metrics(live, snap, date_qualifications, sales_window, department.replenishment_cycle_days)
        if any(metrics[key] is None for key in LIVE_METRICS + SALES_METRICS):
            qualifications.append("missing_quantity_components")
        if metrics["sales30dQuantity"] is not None and metrics["sales30dQuantity"] <= 0:
            qualifications.append("nonpositive_sales30d")
        if not reference.data.get("regionCode"):
            qualifications.append("region_unmapped")
        qualified = metrics["turnoverDays"] is not None and metrics["postReplenishmentQuantity"] is not None
        threshold = department.stockout_threshold_days
        warning = _monitor_warning(metrics["stockoutAvailableDays30d"], threshold, department.monitor_enabled)
        items.append({"id": _hash([department_id, goods, warehouse_key]), "departmentId": department_id, "businessUnitCode": department.business_unit_code, "goodsCode": goods, "goodsName": reference.data["goodsName"], "goodsCodeKind": "jd_sku", "warehouseCode": reference.warehouse_code, "warehouseKey": warehouse_key, "warehouseIdentityKind": reference.data["warehouseIdentityKind"], "warehouseName": reference.data["warehouseName"], "regionCode": reference.data.get("regionCode") or None, "regionName": reference.data.get("regionName") or None, "sourceProvinceCity": snapshot_data.get("sourceProvinceCity") or None, "datePairing": date_pairing, "sourceDateLagDays": date_lag, "salesAsOfDate": snap.business_date.isoformat() if snap else None, "erpGoodsCode": mapping.erp_goods_code if mapping else "", "erpGoodsName": mapping.erp_goods_name if mapping else "", "realtimeDate": live.business_date.isoformat() if live else None, "snapshotDate": snap.business_date.isoformat() if snap else None, "realtimeBatchId": live.batch_id if live else None, "snapshotBatchId": snap.batch_id if snap else None, "realtimeCollectedAt": live.batch.collected_at.isoformat() if live else None, "snapshotSourceAsOf": snap.batch.source_as_of if snap else None, **metrics, "monitorEnabled": department.monitor_enabled, "stockoutThresholdDays": threshold, "warningState": warning, "qualifications": qualifications, "qualified": qualified})
    summary = {"monitoredCount": len(items), "qualifiedCount": sum(item["qualified"] for item in items), "stockoutRiskCount": sum(item["warningState"] == "stockout_risk" for item in items)}
    projection = _product_matrix(items, filters, sales_window) if layout == "product" else {**_page(items, filters), "layout": "warehouse", "salesWindow": sales_window}
    from .jd_logistics_notifications import notification_available
    return _base(**projection, summary=summary, notificationAvailable=notification_available(), coverageWarnings=["本页销量采用京东销售出库件数，不是店铺成交订单数。各指标仅按自身依赖计算：缺少7日销量、ERP标签或快照不抹去可计算的实时库存与补货后库存；ERP待对照单独披露。", "系统周转采用现货÷30日销售出库×30；缺货提醒独立采用可用÷30日销售出库×30，固定30日不随7/30显示窗口切换。可售天数采用所选窗口，补货后采用可用＋采购在途＋调拨在途；均先合计数量及需求，不平均分仓天数。", "实时日T可配对截至T或T-1的快照销量，两个日期分别展示；来源时期不可比时合计天数为未知，范围数量只对完整成员求和。汇总表示当前范围，不代表全国。", "列使用源省市原文；缺省市时按独立来源仓显示，不猜测大区。京东原生30天周转只在来源单仓明细显示，不对其求和或平均；图片和价格缺少来源时为空；通知须独立全局渠道及事业部三开配置，并经服务端当前风险重算、动态目标核验和投递账本约束。"])



def read(operation, filters):
    if operation in {"options", "settings"}:
        return options()
    if operation == "inventory_monitor":
        return inventory_monitor(filters)
    if operation == "batches":
        query = JdLogisticsBatch.objects.select_related("department").all()
        for key, field in (("departmentId", "department_id"), ("businessUnitCode", "department__business_unit_code"), ("sourceKind", "source_kind"), ("batchId", "id")):
            if filters.get(key):
                query = query.filter(**{field: filters[key]})
        total = query.count()
        page, size = filters["page"], filters["pageSize"]
        rows = query.order_by("-created_at", "-id")[(page - 1) * size:page * size]
        return _base(items=[{**_batch_payload(row), **({"currentSelection": _current_selection(row)} if filters.get("batchId") else {})} for row in rows], total=total, page=page, pageSize=size)
    if operation in {"flows", "products", "inventory"}:
        kind = "flow" if operation == "flows" else "shop_products" if operation == "products" else filters.get("sourceKind")
        if kind not in SOURCE_KINDS:
            _error("库存来源类型无效")
        query = _query(filters, kind).select_related("department").order_by("-business_date", "id")
        total = query.count()
        page, size = filters["page"], filters["pageSize"]
        rows = list(query[(page - 1) * size:page * size])
        mappings, manuals = _manual_maps(rows)
        items = []
        revisions = _flow_revision_map({(row.department_id, row.document_no, row.goods_code) for row in rows}) if kind == "flow" else {}
        for row in rows:
            key = (row.department_id, row.document_no, row.goods_code)
            items.append({**row.data, "id": row.id, "departmentId": row.department_id, "batchId": row.batch_id, "mapping": _mapping_payload(mappings.get((row.department_id, row.goods_code_kind, row.goods_code))), "manual": _manual_payload(manuals.get(key), revisions.get(key, "")), "flowRevision": revisions.get(key, ""), "sharedBusinessUnitFlow": kind == "flow"})
        return _base(items=items, total=total, page=page, pageSize=size, erpVerificationAvailable=False)
    if operation == "mappings":
        rows = _rows(filters, None)
        mappings, _manuals = _manual_maps(rows)
        groups = defaultdict(list)
        for row in rows:
            # Official CSV can contain an ESG relation awaiting a department
            # product. Preserve each relation; never merge all blank codes.
            relation_key = _hash({key: row.data.get(key, "") for key in ("platform", "shopName", "shopProductCode")}) if not row.goods_code else ""
            groups[(row.department_id, row.goods_code_kind, row.goods_code, relation_key)].append(row)
        items = []
        for (department_id, goods_kind, goods, relation_key), facts in groups.items():
            links = [row.data for row in facts if row.source_kind == "shop_products"]
            marks = sorted({row.data.get("merchantMark", "") for row in facts if row.data.get("merchantMark")})
            items.append({"departmentId": department_id, "businessUnitCode": facts[0].department.business_unit_code, "goodsCodeKind": goods_kind, "goodsCode": goods, "goodsName": facts[-1].data["goodsName"], "sourceRelationKey": relation_key, "mappingAllowed": bool(goods), "merchantMark": ", ".join(marks), **_mapping_payload(mappings.get((department_id, goods_kind, goods))), "shopLinks": links[:100], "shopLinkCount": len(links), "shopLinksTruncated": len(links) > 100})
        items.sort(key=lambda item: (item["departmentId"], item["goodsCode"]))
        return _base(**_page(items, filters))
    if operation == "transfers":
        return _base(**_page(_transfer_items(filters), filters), erpVerificationAvailable=False, coverageWarnings=["调拨仅依据已导入流水；首次接入和筛选区间可能缺少同单历史，人工状态不代表ERP回查。"])
    if operation == "overview":
        transfers = _transfer_items(filters)
        goods = set(_query(filters).values_list("department_id", "goods_code_kind", "goods_code").distinct()[:MAX_READ_ROWS + 1])
        confirmed = set(JdLogisticsProductMapping.objects.filter(status__in=["confirmed", "ignored"]).values_list("department_id", "goods_code_kind", "goods_code"))
        latest = JdLogisticsBatch.objects.select_related("department").filter(status="imported")
        if filters.get("departmentId"):
            latest = latest.filter(department_id=filters["departmentId"])
        if filters.get("businessUnitCode"):
            latest = latest.filter(department__business_unit_code=filters["businessUnitCode"])
        return _base(summary={"flowCount": _query(filters, "flow").count(), "transferCount": len(transfers), "pendingMappingCount": len(goods - confirmed), "pendingTransferCount": sum(item["transferStatus"] == "pending" or item["needsReview"] for item in transfers), "completedTransferCount": sum(item["transferStatus"] == "completed" and not item["needsReview"] for item in transfers)}, departments=options()["departments"], latestBatches=[_batch_payload(row) for row in latest.order_by("-created_at")[:12]], coverageWarnings=["京东来源按事业部共享；调拨状态为人工确认，尚无ERP单据只读核验。"], erpVerificationAvailable=False)
    _error("读取操作无效")
