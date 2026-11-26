"""Write side of the product subdivision mapping (sales writer process only).

Four small actions edit the two overlay tables; nothing else is touched. The
static map stays in code and the effective mapping is recomputed on read, so a
write needs no sales revision bump: every read scope carries the fresh
``config_digest``.
"""
from __future__ import annotations

from typing import Any

from django.db import IntegrityError, transaction

from . import subdivisions
from .auth import Principal
from .models import SalesProductSubdivisionOverride, SalesSubdivisionLabel
from .write_service import SalesImportServiceError

LABEL_NAME_MAX = 40
CODE_MAX = 100
SOURCE_NAME_MAX = 300
MAJOR_MAX = 40

_FIELDS = {
    "add_label": {"action", "majorCategory", "name"},
    "delete_label": {"action", "majorCategory", "name"},
    "assign": {"action", "productCode", "majorCategory", "label", "sourceName"},
    "reset_assignment": {"action", "productCode"},
}


def _invalid(message: str, *, status: int = 400, code: str = "invalid_request") -> SalesImportServiceError:
    return SalesImportServiceError(message, code=code, status=status)


def _text(payload: dict[str, Any], key: str, label: str, *, maximum: int) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise _invalid(f"{label}必须是文本")
    value = value.strip()
    if not value or len(value) > maximum:
        raise _invalid(f"{label}不能为空且不能超过 {maximum} 个字")
    return value


def _major(payload: dict[str, Any], mapping: subdivisions.EffectiveMapping) -> str:
    major = _text(payload, "majorCategory", "大类目", maximum=MAJOR_MAX)
    if major not in mapping.major_categories():
        raise _invalid("大类目无效")
    return major


def _add_label(principal: Principal, payload: dict[str, Any], mapping: subdivisions.EffectiveMapping) -> None:
    major = _major(payload, mapping)
    name = _text(payload, "name", "细分名称", maximum=LABEL_NAME_MAX)
    if subdivisions.normalize(name) == subdivisions.normalize(subdivisions.UNCLASSIFIED_LABEL):
        raise _invalid(f"细分名称不能是“{subdivisions.UNCLASSIFIED_LABEL}”")
    live = mapping.labels(major)
    if any(subdivisions.normalize(item["name"]) == subdivisions.normalize(name) for item in live):
        raise _invalid("该大类目下已有同名细分")
    if len(live) >= subdivisions.LABEL_LIMIT:
        raise _invalid(f"细分数量已达上限 {subdivisions.LABEL_LIMIT}")
    existing = SalesSubdivisionLabel.objects.select_for_update().filter(major_category=major, name=name).first()
    if existing is not None:
        existing.is_deleted = False
        existing.updated_by = principal.email
        existing.save(update_fields=["is_deleted", "updated_by", "updated_at"])
        return
    sort_order = max((item["sortOrder"] for item in mapping.labels(major, include_deleted=True)), default=-10) + 10
    SalesSubdivisionLabel.objects.create(
        major_category=major, name=name, sort_order=sort_order, is_deleted=False, updated_by=principal.email,
    )


def _delete_label(principal: Principal, payload: dict[str, Any], mapping: subdivisions.EffectiveMapping) -> None:
    major = _major(payload, mapping)
    name = _text(payload, "name", "细分名称", maximum=LABEL_NAME_MAX)
    current = next((item for item in mapping.labels(major) if item["name"] == name), None)
    if current is None:
        raise _invalid("该细分不存在或已删除")
    SalesSubdivisionLabel.objects.update_or_create(
        major_category=major, name=name,
        defaults={"is_deleted": True, "sort_order": current["sortOrder"], "updated_by": principal.email},
    )


def _assign(principal: Principal, payload: dict[str, Any], mapping: subdivisions.EffectiveMapping) -> None:
    code = _text(payload, "productCode", "吉客云规格代码", maximum=CODE_MAX)
    major = _major(payload, mapping)
    label = payload.get("label")
    if not isinstance(label, str):
        raise _invalid("细分必须是文本（空文本表示设为未归类）")
    label = label.strip()
    if label and not any(item["name"] == label for item in mapping.labels(major)):
        raise _invalid("该大类目下没有这个细分")
    defaults: dict[str, Any] = {"major_category": major, "label": label, "updated_by": principal.email}
    if "sourceName" in payload:
        source_name = payload["sourceName"]
        if not isinstance(source_name, str) or len(source_name.strip()) > SOURCE_NAME_MAX:
            raise _invalid(f"原名称不能超过 {SOURCE_NAME_MAX} 个字")
        defaults["source_name"] = source_name.strip()
    SalesProductSubdivisionOverride.objects.update_or_create(product_code=code, defaults=defaults)


def _reset_assignment(_principal: Principal, payload: dict[str, Any], _mapping: subdivisions.EffectiveMapping) -> None:
    code = _text(payload, "productCode", "吉客云规格代码", maximum=CODE_MAX)
    SalesProductSubdivisionOverride.objects.filter(product_code=code).delete()


_ACTIONS = {
    "add_label": _add_label, "delete_label": _delete_label,
    "assign": _assign, "reset_assignment": _reset_assignment,
}


def apply_edit(principal: Principal, payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if not isinstance(action, str) or action not in _ACTIONS:
        raise _invalid("action 无效")
    unknown = sorted(set(payload) - _FIELDS[action])
    if unknown:
        raise _invalid(f"请求包含未声明字段：{', '.join(unknown[:10])}", code="unknown_fields")
    try:
        with transaction.atomic():
            # Inside the transaction the calculation cache is bypassed, so validation sees committed rows.
            mapping = subdivisions.load_effective(principal)
            _ACTIONS[action](principal, payload, mapping)
    except IntegrityError as error:
        raise _invalid("细分已被其他人修改，请刷新后重试", status=409, code="conflict") from error
    return {"ok": True, "configVersion": subdivisions.config_digest()}
