from __future__ import annotations

import re
import uuid

from django.db import IntegrityError, transaction
from django.db.models import Case, IntegerField, Q, Sum, When

from .errors import InventoryApiError
from .models import InventoryStockLine, ReplenishmentPlanItem
from .revisions import bump_revision
from .write_requests import lock_active_authority


STATUSES = frozenset({"draft", "confirmed", "completed", "cancelled"})
TRANSITIONS = {
    "draft": {"draft", "confirmed", "cancelled"},
    "confirmed": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def plan_payload(plan: ReplenishmentPlanItem) -> dict[str, object]:
    return {
        "id": plan.id,
        "sourceBatchId": plan.source_batch_id,
        "productCode": plan.product_code,
        "productName": plan.product_name,
        "warehouse": plan.warehouse,
        "suggestedQuantity": int(plan.suggested_quantity),
        "plannedQuantity": int(plan.planned_quantity),
        "coverageDays": (
            float(plan.coverage_days_tenths) / 10
            if plan.coverage_days_tenths is not None
            else None
        ),
        "reason": plan.reason,
        "status": plan.status,
        "createdAt": plan.created_at.isoformat(),
        "updatedAt": plan.updated_at.isoformat(),
    }


def _selected(values: object, maximum: int) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, list) or len(values) > maximum:
        raise InventoryApiError("备货计划筛选无效")
    output: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 120:
            raise InventoryApiError("备货计划筛选无效")
        if value.strip() not in output:
            output.append(value.strip())
    return output


def query_plans(options: dict[str, object]) -> dict[str, object]:
    page = int(options.get("page", 1))
    page_size = int(options.get("pageSize", 50))
    if not 1 <= page <= 10_000 or not 1 <= page_size <= 100:
        raise InventoryApiError("备货计划分页参数无效")
    rows = ReplenishmentPlanItem.objects.all()
    status = options.get("status")
    if status is not None:
        if status not in STATUSES:
            raise InventoryApiError("备货计划状态无效")
        rows = rows.filter(status=status)
    elif options.get("includeCancelled") is not True:
        rows = rows.exclude(status="cancelled")
    query = options.get("query")
    if query:
        if not isinstance(query, str) or len(query) > 100:
            raise InventoryApiError("备货计划搜索词无效")
        words = list(dict.fromkeys(re.split(r"[\s,，;；]+", query.strip())))[:8]
        search = Q()
        for word in words:
            search |= Q(product_code__icontains=word) | Q(product_name__icontains=word) | Q(warehouse__icontains=word)
        rows = rows.filter(search)
    warehouses = _selected(options.get("warehouses"), 10)
    if warehouses:
        rows = rows.filter(warehouse__in=warehouses)
    brands = _selected(options.get("brands"), 20)
    categories = _selected(options.get("categories"), 20)
    if brands or categories:
        matching = InventoryStockLine.objects.filter(
            batch_id__in=rows.values("source_batch_id"),
        )
        if brands:
            matching = matching.filter(brand__in=brands)
        if categories:
            matching = matching.filter(category__in=categories)
        keys = matching.values_list("batch_id", "warehouse", "product_code")
        allowed = {(batch, warehouse, product) for batch, warehouse, product in keys}
        plan_ids = [
            plan.id
            for plan in rows.only("id", "source_batch_id", "warehouse", "product_code")
            if (plan.source_batch_id, plan.warehouse, plan.product_code) in allowed
        ]
        rows = rows.filter(id__in=plan_ids)
    rows = rows.annotate(
        status_order=Case(
            When(status="draft", then=0),
            When(status="confirmed", then=1),
            default=2,
            output_field=IntegerField(),
        )
    ).order_by("status_order", "-updated_at", "-id")
    total = rows.count()
    offset = (page - 1) * page_size
    page_rows = list(rows[offset : offset + page_size])
    return {
        "items": [plan_payload(plan) for plan in page_rows],
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total,
            "returned": len(page_rows),
            "totalPages": (total + page_size - 1) // page_size,
            "truncated": offset + len(page_rows) < total,
        },
    }


def plan_summary(current_batch_id: str | None = None) -> dict[str, int]:
    rows = ReplenishmentPlanItem.objects.all()
    counts = {
        status: rows.filter(status=status).count()
        for status in ("draft", "confirmed", "completed", "cancelled")
    }
    active = rows.filter(Q(status__in=["draft", "confirmed"]) | Q(status="completed", source_batch_id=current_batch_id or ""))
    active_quantity = active.aggregate(total=Sum("planned_quantity"))["total"] or 0
    return {
        "draftCount": counts["draft"],
        "confirmedCount": counts["confirmed"],
        "completedCount": counts["completed"],
        "cancelledCount": counts["cancelled"],
        "activeQuantity": int(active_quantity),
    }


def get_plan(plan_id: str) -> ReplenishmentPlanItem | None:
    return ReplenishmentPlanItem.objects.filter(id=plan_id).first()


def upsert_plan(data: dict[str, object], actor_email: str) -> ReplenishmentPlanItem:
    with transaction.atomic():
        lock_active_authority()
        lookup = {
            "source_batch_id": str(data["sourceBatchId"]),
            "warehouse": str(data["warehouse"]),
            "product_code": str(data["productCode"]),
            "status": "draft",
        }
        defaults = {
            "product_name": str(data["productName"]),
            "suggested_quantity": int(data["suggestedQuantity"]),
            "planned_quantity": int(data["plannedQuantity"]),
            "coverage_days_tenths": (
                round(float(data["coverageDays"]) * 10)
                if data.get("coverageDays") is not None
                else None
            ),
            "reason": str(data["reason"]),
            "created_by": actor_email[:320],
        }
        try:
            plan = ReplenishmentPlanItem.objects.select_for_update().filter(**lookup).first()
            if plan is None:
                plan = ReplenishmentPlanItem.objects.create(
                    id=str(uuid.uuid4()),
                    **lookup,
                    **defaults,
                )
            else:
                for field, value in defaults.items():
                    setattr(plan, field, value)
                plan.save()
        except IntegrityError as error:
            raise InventoryApiError("备货草稿已被其他请求更新", code="conflict", status=409) from error
        bump_revision({"kind": "replenishment_upsert", "planId": plan.id})
        return plan


def update_plan(plan_id: str, status: str, planned_quantity: int | None) -> ReplenishmentPlanItem | None:
    if status not in STATUSES:
        raise InventoryApiError("备货计划状态无效")
    with transaction.atomic():
        lock_active_authority()
        plan = ReplenishmentPlanItem.objects.select_for_update().filter(id=plan_id).first()
        if plan is None:
            return None
        if status not in TRANSITIONS.get(plan.status, set()):
            raise InventoryApiError(
                f"不能将{plan.status}状态的备货计划更新为{status}",
                code="conflict",
                status=409,
            )
        if planned_quantity is not None and plan.status != "draft":
            raise InventoryApiError("只有备货草稿可以调整计划数量", code="conflict", status=409)
        plan.status = status
        if planned_quantity is not None:
            plan.planned_quantity = planned_quantity
        plan.save()
        bump_revision({"kind": "replenishment_update", "planId": plan.id, "status": status})
        return plan
