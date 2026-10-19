"""Editable formal replenishment drafts, prepared by the inventory owner."""
from django.db import transaction
from django.views.decorators.http import require_POST

from common.pi_business_contract import action_request_id, admit, digest, receipt
from .errors import InventoryApiError
from .models import InventoryImportScopeHead, InventoryWriteRequestReceipt, ReplenishmentPlanItem
from .plans import plan_payload, upsert_plan
from .query import inventory_overview
from .revisions import revision_value
from .views import _body, _error, _json, _principal, _replay_write
from .write_requests import lock_active_authority


PATH = "/api/inventory/pi-business"
KIND = "replenishment_draft.create"


def prepare(arguments, principal):
    required = {"warehouse", "productCode"}
    if (not isinstance(arguments, dict) or not required <= set(arguments)
            or set(arguments) - required - {"plannedQuantity", "notes", "acknowledgeStale"}):
        raise InventoryApiError("补货草稿参数无效")
    values = dict(arguments)
    notes_supplied = "notes" in values
    for name, maximum in (("warehouse", 100), ("productCode", 100), ("notes", 1000)):
        value = values.get(name, "")
        if not isinstance(value, str) or len(value.strip()) > maximum or name in required and not value.strip():
            raise InventoryApiError(name + " 无效")
        values[name] = value.strip()
    acknowledge = values.get("acknowledgeStale", False)
    if type(acknowledge) is not bool:
        raise InventoryApiError("acknowledgeStale 必须为布尔值")
    values["acknowledgeStale"] = acknowledge
    quantity = values.get("plannedQuantity")
    if quantity is not None and (type(quantity) is not int or not 1 <= quantity <= 10_000_000):
        raise InventoryApiError("备货数量必须为1至10,000,000之间的整数")
    key = values["warehouse"] + "\x1f" + values["productCode"]
    before = revision_value()
    result = inventory_overview(principal, {"view": "overview", "exactKey": key, "page": 1, "pageSize": 1})
    if before != revision_value():
        raise InventoryApiError("库存版本已变化，请重新预览", code="version_conflict", status=409)
    if not result["controls"]["autoReplenishmentEnabled"] or result["quality"]["recommendationsSuppressed"]:
        raise InventoryApiError("正式补货依据尚未通过库存质量门禁", code="conflict", status=409)
    if result["sync"]["inventoryStale"] and not acknowledge:
        raise InventoryApiError("库存快照已过期，请明确确认后再创建草稿", code="conflict", status=409)
    items = result["items"]
    if len(items) != 1 or items[0]["key"] != key or not items[0].get("includedInInventory", True):
        raise InventoryApiError("最新库存中没有该精确货品和仓库", code="not_found", status=404)
    item = items[0]
    suggested = item["suggestedQuantity"]
    if suggested is None or item.get("sales30d") is None or item.get("productSales30d") is None:
        raise InventoryApiError("近30日销量或在途依据不完整，不能保存正式补货草稿", code="conflict", status=409)
    existing = ReplenishmentPlanItem.objects.filter(source_batch_id=result["sync"]["latestInventoryBatchId"],
        warehouse=values["warehouse"], product_code=values["productCode"], status="draft").first()
    prior = plan_payload(existing) if existing else None
    if quantity is None:
        quantity = int(prior["plannedQuantity"] if prior else suggested)
    if not 1 <= quantity <= 10_000_000:
        raise InventoryApiError("当前没有正向补货建议，请明确填写草稿数量", code="conflict", status=409)
    values["plannedQuantity"] = quantity
    if prior and not notes_supplied:
        values["notes"] = prior["notes"]
    preview = {"objectType": "replenishment_draft", "status": "draft", "editable": True,
        "parameters": values, "source": result["sync"], "inventoryRevision": before,
        "productName": item["productName"], "availableQuantity": item["availableQuantity"],
        "sourceInTransitQuantity": item["sourceInTransitQuantity"], "plannedInTransitQuantity": item["plannedInTransitQuantity"],
        "sales30d": item["sales30d"], "productSales30d": item["productSales30d"], "suggestedQuantity": suggested,
        "coverageDays": item["coverageDays"], "reason": item["reason"], "existingDraft": prior,
        "salesPolicy": "latest_sales_cutoff_previous_30_calendar_days_positive_quantity"}
    # Exact formal inputs and existing editable object are frozen; no free-form
    # calculation or source values are accepted from the model.
    return {"parameters": values, "preview": preview, "targetVersion": digest(preview),
        "scope": {"domain": "inventory", "warehouse": values["warehouse"], "productCode": values["productCode"]}}, result, item


@require_POST
def endpoint(request):
    try:
        principal = _principal(request, {"operator", "admin"})
        body = _body(request)
        if set(body) - {"phase", "kind", "arguments", "parameters", "targetVersion", "actionId", "dispatchToken"} or body.get("kind") != KIND:
            raise InventoryApiError("补货草稿业务请求无效")
        phase = body.get("phase")
        if phase == "prepare":
            if set(body) != {"phase", "kind", "arguments"}:
                raise InventoryApiError("补货草稿预览请求无效")
            lock_active_authority()
            prepared, _, _ = prepare(body["arguments"], principal)
            return _json(prepared, revision=revision_value())
        request_id = action_request_id(body.get("actionId"), InventoryApiError)
        if phase == "observe":
            if set(body) != {"phase", "kind", "actionId"}:
                raise InventoryApiError("补货草稿回执查询无效")
            return _json(receipt(request_id, InventoryWriteRequestReceipt, principal, PATH, InventoryApiError))
        if phase != "execute" or set(body) != {"phase", "kind", "parameters", "targetVersion", "actionId", "dispatchToken"}:
            raise InventoryApiError("补货草稿执行请求无效")
        if request.headers.get("X-Teruisi-Request-Id") != request_id:
            raise InventoryApiError("业务操作与写入回执身份不一致", code="access_denied", status=403)
        def create():
            # The inventory owner serializes formal inputs and the existing
            # draft before comparing the exact confirmation version.
            InventoryImportScopeHead.objects.select_for_update().filter(dataset="stock").first()
            args = body["parameters"]
            if not isinstance(args, dict):
                raise InventoryApiError("补货草稿参数无效")
            list(ReplenishmentPlanItem.objects.select_for_update().filter(warehouse=args.get("warehouse"),
                product_code=args.get("productCode"), status="draft").order_by("id")[:100])
            revision_value(for_update=True)
            prepared, result, item = prepare(args, principal)
            if prepared["targetVersion"] != body["targetVersion"]:
                raise InventoryApiError("库存或草稿已变化，请重新预览确认", code="version_conflict", status=409)
            values = prepared["parameters"]
            admit(body["actionId"], body["dispatchToken"], principal, InventoryApiError)
            prior = prepared["preview"]["existingDraft"] or {}
            plan = upsert_plan({"sourceBatchId": result["sync"]["latestInventoryBatchId"],
                "productCode": item["productCode"], "productName": item["productName"], "brand": item["brand"],
                "category": item["category"], "supplier": item["supplier"], "warehouse": item["warehouse"],
                "suggestedQuantity": item["suggestedQuantity"], "plannedQuantity": values["plannedQuantity"],
                "coverageDays": item["coverageDays"], "currentStockQuantity": item["availableQuantity"],
                "sales30dQuantity": item["productSales30d"], "reason": item["reason"], "notes": values["notes"],
                "buyer": prior.get("buyer", ""), "operatorName": prior.get("operatorName", ""),
                "department": prior.get("department", ""), "planType": prior.get("planType", ""),
                "orderDate": existing_date(prior.get("orderDate")), "expectedArrivalDate": existing_date(prior.get("expectedArrivalDate")),
                "requiresInspection": prior.get("requiresInspection", False),
                "status": "draft"}, principal.email)
            return {"status": "succeeded", "objectType": "replenishment_draft", "objectId": plan.id,
                "objectUrl": "/?module=inventory&view=plan&objectType=replenishment_draft&objectId=" + plan.id,
                "item": plan_payload(plan), "receipt": {"actionId": body["actionId"], "requestId": request_id,
                    "targetVersion": body["targetVersion"], "state": "committed"}}, 201
        # The existing generic inventory route predates atomic replay receipts.
        # Here both the original writer and its completed receipt commit once.
        with transaction.atomic():
            return _replay_write(request, principal, create)
    except Exception as error:
        return _error(error, "补货草稿业务操作失败")


def existing_date(value):
    from datetime import date
    return date.fromisoformat(value) if value else None
