import {
  ensureInventorySchema,
  getInventoryDatabase,
  getReplenishmentPlanSummary,
  queryReplenishmentPlans,
  ReplenishmentPlanTransitionError,
  updateReplenishmentPlan,
  upsertReplenishmentPlan,
  type ReplenishmentPlanItem,
} from "@/lib/inventory/database";
import { getInventoryOverview } from "@/lib/inventory/overview";
import { ensureSalesSchema } from "@/lib/sales/database";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import {
  InventoryQueryContractError,
  parseInventoryPaginationParameter,
} from "@/lib/inventory/query-contract";
import { InventorySalesPeriodError } from "@/lib/inventory/sales-period";

function errorResponse(status: number, message: string) {
  return Response.json({ ok: false, message }, { status, headers: { "cache-control": "no-store" } });
}

async function readyDatabase() {
  const db = getInventoryDatabase();
  await Promise.all([ensureInventorySchema(db), ensureSalesSchema(db)]);
  return db;
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "备货计划");
    const db = await readyDatabase();
    const params = new URL(request.url).searchParams;
    const requestedStatus = params.get("status");
    const allowedStatuses: ReplenishmentPlanItem["status"][] = ["draft", "confirmed", "completed", "cancelled"];
    if (requestedStatus !== null && !allowedStatuses.includes(requestedStatus as ReplenishmentPlanItem["status"])) {
      throw new InventoryQueryContractError("备货计划状态不在允许清单中");
    }
    const status = requestedStatus as ReplenishmentPlanItem["status"] | null;
    const includeCancelledValue = params.get("includeCancelled");
    if (includeCancelledValue !== null && includeCancelledValue !== "true" && includeCancelledValue !== "false") {
      throw new InventoryQueryContractError("includeCancelled 必须是 true 或 false");
    }
    const query = params.get("q")?.trim() || undefined;
    if (query && query.length > 100) throw new InventoryQueryContractError("搜索词不能超过 100 个字符");
    const [result, summary] = await Promise.all([
      queryReplenishmentPlans(db, {
        page: parseInventoryPaginationParameter(params.get("page"), "page"),
        pageSize: parseInventoryPaginationParameter(params.get("pageSize"), "pageSize"),
        status: status ?? undefined,
        includeCancelled: includeCancelledValue === "true",
        query,
      }),
      getReplenishmentPlanSummary(db, null),
    ]);
    return Response.json({ ...result, summary }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof InventoryQueryContractError) return errorResponse(400, error.message);
    return safeApiErrorResponse(error, "读取备货计划失败。", { headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "备货计划", "修改");
    const body = await request.json().catch(() => null) as {
      key?: unknown;
      plannedQuantity?: unknown;
      acknowledgeStale?: unknown;
      startDate?: unknown;
      endDate?: unknown;
    } | null;
    if (!body || typeof body.key !== "string" || !body.key.trim()) {
      return errorResponse(400, "缺少库存建议标识");
    }
    const keyParts = body.key.split("\u001f");
    if (keyParts.length !== 2 || keyParts.some((value) => !value.trim() || value.length > 100)) {
      return errorResponse(400, "库存建议标识必须精确包含仓库与货品编码");
    }
    if (body.startDate !== undefined && (typeof body.startDate !== "string" || !body.startDate)) return errorResponse(400, "开始日期格式无效");
    if (body.endDate !== undefined && (typeof body.endDate !== "string" || !body.endDate)) return errorResponse(400, "结束日期格式无效");
    if (body.acknowledgeStale !== undefined && typeof body.acknowledgeStale !== "boolean") {
      return errorResponse(400, "acknowledgeStale 必须是 JSON 布尔值");
    }
    const plannedQuantityInput = body.plannedQuantity;
    if (plannedQuantityInput !== undefined && typeof plannedQuantityInput !== "number") {
      return errorResponse(400, "计划补货量必须使用 JSON 整数");
    }
    const db = await readyDatabase();
    const overview = await getInventoryOverview(db, {
      exactKey: body.key,
      startDate: body.startDate,
      endDate: body.endDate,
      page: 1,
      pageSize: 1,
    });
    if (overview.sync.inventoryStale && body.acknowledgeStale !== true) {
      return errorResponse(409, `库存快照 ${overview.sync.inventoryAsOf ?? ""} 已过期，请先同步最新库存或明确确认继续`);
    }
    const item = overview.items[0];
    if (!item) return errorResponse(404, "当前库存快照中未找到该货品与仓库");
    if (item.suggestedQuantity === null) return errorResponse(409, "销售需求不足，暂时无法生成补货量");
    if (item.suggestedQuantity <= 0) return errorResponse(409, "当前库存充足，无需创建补货计划");
    if (!overview.sync.latestInventoryBatchId) return errorResponse(409, "库存快照尚未就绪");

    const requestedQuantity = plannedQuantityInput === undefined
      ? item.suggestedQuantity
      : plannedQuantityInput;
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0 || requestedQuantity > 10_000_000) {
      return errorResponse(400, "计划补货量必须是 1 到 10,000,000 之间的整数");
    }

    const plan = await upsertReplenishmentPlan(db, {
      sourceBatchId: overview.sync.latestInventoryBatchId,
      productCode: item.productCode,
      productName: item.productName,
      warehouse: item.warehouse,
      suggestedQuantity: item.suggestedQuantity,
      plannedQuantity: requestedQuantity,
      coverageDays: item.coverageDays,
      reason: item.reason,
    });
    return Response.json({ ok: true, item: plan }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof InventoryQueryContractError || error instanceof InventorySalesPeriodError) return errorResponse(400, error.message);
    return safeApiErrorResponse(error, "创建备货计划失败。", { headers: { "cache-control": "no-store" } });
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "备货计划", "修改");
    const body = await request.json().catch(() => null) as {
      id?: unknown;
      status?: unknown;
      plannedQuantity?: unknown;
    } | null;
    if (!body || typeof body.id !== "string" || !body.id.trim()) return errorResponse(400, "缺少备货计划 ID");
    if (body.id.length > 128) return errorResponse(400, "备货计划 ID 长度超出限制");
    const allowedStatuses: ReplenishmentPlanItem["status"][] = ["draft", "confirmed", "completed", "cancelled"];
    if (typeof body.status !== "string" || !allowedStatuses.includes(body.status as ReplenishmentPlanItem["status"])) {
      return errorResponse(400, "备货计划状态无效");
    }
    let plannedQuantity: number | undefined;
    if (body.plannedQuantity !== undefined) {
      if (typeof body.plannedQuantity !== "number") {
        return errorResponse(400, "计划补货量必须使用 JSON 整数");
      }
      plannedQuantity = body.plannedQuantity;
      if (!Number.isSafeInteger(plannedQuantity) || plannedQuantity <= 0 || plannedQuantity > 10_000_000) {
        return errorResponse(400, "计划补货量必须是 1 到 10,000,000 之间的整数");
      }
    }

    const db = await readyDatabase();
    const plan = await updateReplenishmentPlan(db, {
      id: body.id,
      status: body.status as ReplenishmentPlanItem["status"],
      plannedQuantity,
    });
    if (!plan) return errorResponse(404, "备货计划不存在");
    return Response.json({ ok: true, item: plan }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof ReplenishmentPlanTransitionError) {
      return Response.json({ ok: false, message: error.message, code: "invalid_transition" }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    return safeApiErrorResponse(error, "更新备货计划失败。", { headers: { "cache-control": "no-store" } });
  }
}
