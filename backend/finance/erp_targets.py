"""ERP goal configuration under the existing finance writer and receipt fence."""
from __future__ import annotations

import re
import uuid

from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.utils import timezone

from .errors import FinanceApiError
from .import_service import assert_active_authority
from .models import FinanceErpTarget
from .target_service import _bump_revision, _nonnegative_integer, _text, MAX_TARGET_AMOUNT_CENTS

SCHEMA = "finance-erp-targets-v1"


def _payload(row):
    return {"id": row.id, "basis": "erp_net_sales", "periodType": row.period_type, "periodKey": row.period_key,
        "platform": row.platform, "shopName": row.shop_name, "salesTargetCents": row.sales_target_cents,
        "version": row.version, "updatedAt": row.updated_at.isoformat()}


def read_targets(year, month):
    if not isinstance(year, str) or not re.fullmatch(r"(?:19|20|21)\d{2}", year) or not isinstance(month, str) or not re.fullmatch(year + r"-(?:0[1-9]|1[0-2])", month):
        raise FinanceApiError("ERP目标年份或月份无效")
    queryset = FinanceErpTarget.objects.filter(Q(period_type="year", period_key=year) | Q(period_type="month", period_key=month)).order_by("period_type", "platform", "shop_name")
    rows = list(queryset[:201])
    if len(rows) > 200:
        raise FinanceApiError("ERP目标超过200项，不能静默截断", code="capacity_exceeded", status=413)
    return {"schemaVersion": SCHEMA, "basis": "erp_net_sales", "year": year, "month": month,
        "items": [_payload(row) for row in rows], "complete": True,
        "disclosure": "只读已明确设置的ERP净销售目标；不从财报目标复制金额或推算月目标"}


def upsert(payload, principal):
    allowed = {"id", "expectedVersion", "periodType", "periodKey", "platform", "shopName", "salesTargetCents"}
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise FinanceApiError("ERP目标字段无效")
    kind = _text(payload.get("periodType"), "目标类型", 8, required=True)
    period = _text(payload.get("periodKey"), "目标周期", 7, required=True)
    if kind not in {"year", "month"} or not re.fullmatch(r"(?:19|20|21)\d{2}" + (r"-(?:0[1-9]|1[0-2])" if kind == "month" else ""), period):
        raise FinanceApiError("ERP目标周期须为年度或自然月")
    platform = _text(payload.get("platform", ""), "ERP平台", 100)
    shop = _text(payload.get("shopName", ""), "ERP店铺", 100)
    if bool(platform) != bool(shop):
        raise FinanceApiError("ERP店铺目标须同时选择平台与店铺；全项目目标二者留空")
    for value in (platform, shop):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise FinanceApiError("目标身份包含非法字符")
    if "salesTargetCents" not in payload or payload["salesTargetCents"] is None:
        raise FinanceApiError("必须明确提供ERP净销售目标，零值不能自动填充")
    amount = _nonnegative_integer(payload["salesTargetCents"], "ERP净销售目标", MAX_TARGET_AMOUNT_CENTS)
    identifier = _text(payload.get("id", ""), "目标ID", 128) or str(uuid.uuid4())
    expected = payload.get("expectedVersion")
    if not payload.get("id") and "expectedVersion" in payload:
        raise FinanceApiError("新目标不能携带旧版本")
    if expected is not None and (isinstance(expected, bool) or not isinstance(expected, int) or expected < 1):
        raise FinanceApiError("目标版本无效")
    now = timezone.now()
    with transaction.atomic():
        assert_active_authority()
        existing = FinanceErpTarget.objects.select_for_update().filter(id=identifier).first()
        if existing is None and expected is not None:
            raise FinanceApiError("ERP目标不存在", code="not_found", status=404)
        if existing is not None:
            if expected != existing.version:
                raise FinanceApiError("ERP目标已变化，请刷新", code="version_conflict", status=409)
            if (existing.period_type, existing.period_key, existing.platform, existing.shop_name) != (kind, period, platform, shop):
                raise FinanceApiError("编辑不能改变ERP目标身份", code="version_conflict", status=409)
            FinanceErpTarget.objects.filter(id=identifier, version=expected).update(sales_target_cents=amount, version=F("version") + 1, updated_at=now, updated_by=principal.email)
            row = FinanceErpTarget.objects.get(id=identifier)
            created = False
        else:
            try:
                with transaction.atomic():
                    row = FinanceErpTarget.objects.create(id=identifier, period_type=kind, period_key=period, platform=platform, shop_name=shop,
                        sales_target_cents=amount, version=1, created_at=now, updated_at=now, updated_by=principal.email)
            except IntegrityError as error:
                raise FinanceApiError("同周期ERP目标已存在，请刷新后编辑", code="version_conflict", status=409) from error
            created = True
        _bump_revision(f"erp-target:{identifier}:{row.version}")
        return {"schemaVersion": SCHEMA, "item": _payload(row)}, 201 if created else 200
