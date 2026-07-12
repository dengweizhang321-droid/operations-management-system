import {
  ensureInventorySchema,
  getInventoryDatabase,
  listReplenishmentPlans,
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
} from "@/lib/auth/authorization";

function errorResponse(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}

async function readyDatabase() {
  const db = getInventoryDatabase();
  await Promise.all([ensureInventorySchema(db), ensureSalesSchema(db)]);
  return db;
}

export async function GET() {
  try {
    await requireAppPrincipal(["admin"]);
    const db = await readyDatabase();
    return Response.json({ items: await listReplenishmentPlans(db) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "读取备货计划失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const body = await request.json().catch(() => null) as {
      key?: unknown;
      plannedQuantity?: unknown;
      acknowledgeStale?: unknown;
    } | null;
    if (!body || typeof body.key !== "string" || !body.key.trim()) {
      return errorResponse(400, "缺少库存建议标识");
    }
    const db = await readyDatabase();
    const overview = await getInventoryOverview(db);
    if (overview.sync.inventoryStale && body.acknowledgeStale !== true) {
      return errorResponse(409, `库存快照 ${overview.sync.inventoryAsOf ?? ""} 已过期，请先同步最新库存或明确确认继续`);
    }
    const item = overview.items.find((candidate) => candidate.key === body.key);
    if (!item) return errorResponse(404, "当前库存快照中未找到该货品与仓库");
    if (item.suggestedQuantity === null) return errorResponse(409, "销售需求不足，暂时无法生成补货量");
    if (item.suggestedQuantity <= 0) return errorResponse(409, "当前库存充足，无需创建补货计划");
    if (!overview.sync.latestInventoryBatchId) return errorResponse(409, "库存快照尚未就绪");

    const requestedQuantity = body.plannedQuantity === undefined
      ? item.suggestedQuantity
      : Number(body.plannedQuantity);
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
    return Response.json({ ok: true, item: plan }, { status: 201 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "创建备货计划失败";
    return Response.json({ ok: false, message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const body = await request.json().catch(() => null) as {
      id?: unknown;
      status?: unknown;
      plannedQuantity?: unknown;
    } | null;
    if (!body || typeof body.id !== "string" || !body.id.trim()) return errorResponse(400, "缺少备货计划 ID");
    const allowedStatuses: ReplenishmentPlanItem["status"][] = ["draft", "confirmed", "completed", "cancelled"];
    if (typeof body.status !== "string" || !allowedStatuses.includes(body.status as ReplenishmentPlanItem["status"])) {
      return errorResponse(400, "备货计划状态无效");
    }
    let plannedQuantity: number | undefined;
    if (body.plannedQuantity !== undefined) {
      plannedQuantity = Number(body.plannedQuantity);
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
    return Response.json({ ok: true, item: plan });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "更新备货计划失败";
    return Response.json({ ok: false, message }, { status: error instanceof ReplenishmentPlanTransitionError ? 409 : 500 });
  }
}
