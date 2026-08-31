from __future__ import annotations

import json
import hashlib
import uuid

from django.db import IntegrityError, transaction
from django.db.models import Case, F, IntegerField, Value, When
from django.utils import timezone

from .errors import FinanceApiError
from .import_service import JS_SAFE_INTEGER, assert_active_authority
from .models import FinanceDataRevision, FinanceLine, FinanceTarget, FinanceTargetDeletionAudit
from .serialization import target_payload


MAX_TARGET_AMOUNT_CENTS = 10_000_000_000_000


def _bump_revision(material: str) -> None:
    revision, _ = FinanceDataRevision.objects.select_for_update().get_or_create(
        domain="finance", defaults={"revision": 0, "source_digest": "0" * 64}
    )
    revision.revision += 1
    revision.source_digest = hashlib.sha256(
        f"finance-revision-v1\n{revision.source_digest}\n{material}\n{revision.revision}".encode()
    ).hexdigest()
    revision.save()


def _text(value: object, label: str, maximum: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise FinanceApiError(f"{label}必须是字符串")
    result = value.strip()
    if (required and not result) or len(result) > maximum:
        raise FinanceApiError(f"{label}长度无效")
    return result


def _nonnegative_integer(value: object, label: str, maximum: int) -> int:
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > maximum:
        raise FinanceApiError(f"{label}必须是范围内的 JSON 非负安全整数")
    return value


def validate_target_payload(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise FinanceApiError("请求内容不是有效 JSON")
    allowed = {
        "id", "expectedVersion", "periodType", "periodKey", "platform", "shopName",
        "category", "manager", "salesTargetCents", "profitTargetCents", "smallMarginBps",
        "inventoryCleanupTargetCents", "promotionFeeRatioBps", "stagnantInventoryTargetCents",
    }
    if set(payload) - allowed:
        raise FinanceApiError("经营目标请求包含未知字段")
    period_type = _text(payload.get("periodType"), "目标周期类型", 16, required=True)
    period_key = _text(payload.get("periodKey"), "目标周期", 100, required=True)
    if period_type not in {"month", "year", "project"}:
        raise FinanceApiError("目标周期类型无效")
    if period_type == "month":
        import re
        if not re.fullmatch(r"(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])", period_key):
            raise FinanceApiError("月度目标周期应为真实的 YYYY-MM")
    if period_type == "year":
        import re
        if not re.fullmatch(r"(?:19|20|21)\d{2}", period_key):
            raise FinanceApiError("年度目标周期应为 YYYY")
    identifier = ""
    if "id" in payload:
        identifier = _text(payload["id"], "目标 ID", 128)
    expected_version = payload.get("expectedVersion")
    if identifier:
        if isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version < 1 or expected_version > JS_SAFE_INTEGER:
            raise FinanceApiError("编辑经营目标必须提供有效的 expectedVersion")
    elif expected_version is not None:
        raise FinanceApiError("新建目标不能携带 expectedVersion")
    platform = "" if period_type == "project" else _text(payload.get("platform", ""), "平台", 100, required=True)
    shop_name = "" if period_type == "project" else _text(payload.get("shopName", ""), "店铺", 100, required=True)
    return {
        "id": identifier,
        "expectedVersion": expected_version,
        "periodType": period_type,
        "periodKey": period_key,
        "platform": platform,
        "shopName": shop_name,
        "category": "" if period_type == "project" else _text(payload.get("category", ""), "品类", 100),
        "manager": _text(payload.get("manager", ""), "负责人", 120),
        "salesTargetCents": _nonnegative_integer(payload.get("salesTargetCents"), "销售额目标", MAX_TARGET_AMOUNT_CENTS),
        "profitTargetCents": _nonnegative_integer(payload.get("profitTargetCents"), "利润目标", MAX_TARGET_AMOUNT_CENTS),
        "smallMarginBps": _nonnegative_integer(payload.get("smallMarginBps"), "小毛利率目标", 10_000),
        "inventoryCleanupTargetCents": _nonnegative_integer(payload.get("inventoryCleanupTargetCents"), "库存清理目标", MAX_TARGET_AMOUNT_CENTS),
        "promotionFeeRatioBps": _nonnegative_integer(payload.get("promotionFeeRatioBps"), "推广费占比目标", 10_000),
        "stagnantInventoryTargetCents": _nonnegative_integer(payload.get("stagnantInventoryTargetCents"), "呆滞库存目标", MAX_TARGET_AMOUNT_CENTS),
    }


def list_targets(page: int, page_size: int) -> dict[str, object]:
    offset = (page - 1) * page_size
    queryset = FinanceTarget.objects.annotate(
        period_rank=Case(
            When(period_type="month", then=Value(1)),
            When(period_type="year", then=Value(2)),
            default=Value(3),
            output_field=IntegerField(),
        )
    ).order_by("period_rank", "-period_key", "platform", "shop_name", "category")
    total = queryset.count()
    selected = list(queryset[offset : offset + page_size])
    return {
        "items": [target_payload(item) for item in selected],
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total,
            "returned": len(selected),
            "truncated": offset + len(selected) < total,
        },
    }


def target_options() -> dict[str, object]:
    base = (
        FinanceLine.objects.filter(scope_type="shop")
        .exclude(scope_name="")
        .values_list("group_name", "scope_name")
        .distinct()
    )
    pairs = sorted(
        {(platform or "未分组", name) for platform, name in base},
        key=lambda item: (item[0], item[1]),
    )
    shops = [
        {
            "key": json.dumps([platform, name], ensure_ascii=False, separators=(",", ":")),
            "platform": platform,
            "name": name,
        }
        for platform, name in pairs[:300]
    ]
    return {
        "shops": shops,
        "projects": ["8系列"],
        "pagination": {
            "shops": {
                "total": len(pairs),
                "returned": len(shops),
                "truncated": len(shops) < len(pairs),
            }
        },
    }


def _target_values(input_value: dict[str, object], now_text: str) -> dict[str, object]:
    return {
        "period_type": input_value["periodType"],
        "period_key": input_value["periodKey"],
        "platform": input_value["platform"],
        "shop_name": input_value["shopName"],
        "category": input_value["category"],
        "manager": input_value["manager"],
        "sales_target_cents": input_value["salesTargetCents"],
        "profit_target_cents": input_value["profitTargetCents"],
        "small_margin_bps": input_value["smallMarginBps"],
        "inventory_cleanup_target_cents": input_value["inventoryCleanupTargetCents"],
        "promotion_fee_ratio_bps": input_value["promotionFeeRatioBps"],
        "stagnant_inventory_target_cents": input_value["stagnantInventoryTargetCents"],
        "updated_at": now_text,
    }


def upsert_target(payload: object) -> tuple[dict[str, object], bool]:
    input_value = validate_target_payload(payload)
    identifier = str(input_value["id"] or uuid.uuid4())
    expected_version = input_value["expectedVersion"]
    now_text = timezone.now().isoformat()
    with transaction.atomic():
        assert_active_authority()
        exists = FinanceTarget.objects.filter(id=identifier).exists()
        if exists:
            try:
                changed = FinanceTarget.objects.filter(
                    id=identifier, version=expected_version
                ).update(
                    **_target_values(input_value, now_text),
                    version=F("version") + 1,
                )
            except IntegrityError as error:
                raise FinanceApiError(
                    "同周期、平台、店铺和品类的经营目标已存在，请刷新后编辑",
                    status=409,
                    code="version_conflict",
                ) from error
            if changed != 1:
                if not FinanceTarget.objects.filter(id=identifier).exists():
                    raise FinanceApiError("经营目标不存在或已被删除", status=404, code="not_found")
                raise FinanceApiError(
                    "经营目标已被其他人更新，请刷新后重试",
                    status=409,
                    code="version_conflict",
                )
            target = FinanceTarget.objects.get(id=identifier)
            _bump_revision(f"target:update:{identifier}:{target.version}")
            return target_payload(target), False
        if expected_version is not None:
            raise FinanceApiError("经营目标不存在或已被删除", status=404, code="not_found")
        try:
            target = FinanceTarget.objects.create(
                id=identifier,
                version=1,
                created_at=now_text,
                **_target_values(input_value, now_text),
            )
        except IntegrityError as error:
            raise FinanceApiError(
                "经营目标 ID 或同周期、平台、店铺和品类已存在，请刷新后编辑",
                status=409,
                code="version_conflict",
            ) from error
        _bump_revision(f"target:create:{identifier}:1")
        return target_payload(target), True


def delete_target(
    identifier: str,
    expected_version: int,
    actor: str,
    reason: str,
) -> dict[str, object]:
    normalized_actor = actor.strip().lower()
    normalized_reason = reason.strip()
    if not normalized_actor or len(normalized_actor) > 320:
        raise FinanceApiError("删除操作缺少有效执行人")
    if not normalized_reason or len(normalized_reason) > 200:
        raise FinanceApiError("删除原因必须为 1 到 200 字")
    if isinstance(expected_version, bool) or expected_version < 1 or expected_version > JS_SAFE_INTEGER:
        raise FinanceApiError("删除经营目标必须提供有效的 expectedVersion")
    with transaction.atomic():
        assert_active_authority()
        try:
            target = FinanceTarget.objects.select_for_update().get(id=identifier)
        except FinanceTarget.DoesNotExist as error:
            raise FinanceApiError("经营目标不存在或已被删除", status=404, code="not_found") from error
        if target.version != expected_version:
            raise FinanceApiError(
                "经营目标已被其他人更新，请刷新后重试",
                status=409,
                code="version_conflict",
            )
        audit = FinanceTargetDeletionAudit.objects.create(
            target_id=target.id,
            period_type=target.period_type,
            period_key=target.period_key,
            platform=target.platform,
            shop_name=target.shop_name,
            category=target.category,
            actor=normalized_actor,
            old_version=target.version,
            expected_version=expected_version,
            reason=normalized_reason,
        )
        target.delete()
        _bump_revision(f"target:delete:{identifier}:{expected_version}")
    return {"deleted": True, "auditId": str(audit.audit_id)}
