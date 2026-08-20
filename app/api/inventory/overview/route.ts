import {
  ensureInventorySchema,
  getInventoryDatabase,
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
  normalizeInventorySelections,
  parseInventoryPaginationParameter,
} from "@/lib/inventory/query-contract";
import { InventorySalesPeriodError } from "@/lib/inventory/sales-period";

function readInventorySelections(
  params: URLSearchParams,
  key: string,
  options: { maximum: number; allowed?: readonly string[]; label: string },
) {
  return normalizeInventorySelections(params.getAll(key), options);
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "库存健康数据");
    const db = getInventoryDatabase();
    await Promise.all([ensureInventorySchema(db), ensureSalesSchema(db)]);
    const params = new URL(request.url).searchParams;
    const requestedPlanStatus = params.get("planStatus");
    const allowedPlanStatuses = ["draft", "confirmed", "completed", "cancelled"] as const;
    if (requestedPlanStatus !== null && !allowedPlanStatuses.some((status) => status === requestedPlanStatus)) {
      throw new InventoryQueryContractError("planStatus 必须是 draft、confirmed、completed 或 cancelled");
    }
    const planStatus = requestedPlanStatus as typeof allowedPlanStatuses[number] | null;
    const requestedIncludeCancelled = params.get("includeCancelledPlans");
    if (requestedIncludeCancelled !== null && requestedIncludeCancelled !== "true" && requestedIncludeCancelled !== "false") {
      throw new InventoryQueryContractError("includeCancelledPlans 必须是 true 或 false");
    }
    const query = params.get("q")?.trim() || undefined;
    if (query && query.length > 100) throw new InventoryQueryContractError("搜索词不能超过 100 个字符");
    const payload = await getInventoryOverview(db, {
      query,
      startDate: params.get("startDate")?.trim() || undefined,
      endDate: params.get("endDate")?.trim() || undefined,
      warehouses: readInventorySelections(params, "warehouse", { maximum: 10, label: "仓库" }),
      warehouseTypes: readInventorySelections(params, "warehouseType", {
        maximum: 3,
        allowed: ["owned", "jd_rdc", "other"],
        label: "仓库类型",
      }) as Array<"owned" | "jd_rdc" | "other">,
      statuses: readInventorySelections(params, "status", {
        maximum: 6,
        allowed: ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"],
        label: "库存状态",
      }) as Array<"urgent" | "replenish" | "healthy" | "slow" | "stagnant" | "no_sales">,
      page: parseInventoryPaginationParameter(params.get("page"), "page"),
      pageSize: parseInventoryPaginationParameter(params.get("pageSize"), "pageSize"),
      planPage: parseInventoryPaginationParameter(params.get("planPage"), "page"),
      planPageSize: parseInventoryPaginationParameter(params.get("planPageSize"), "pageSize"),
      planStatus: planStatus ?? undefined,
      includeCancelledPlans: planStatus === "cancelled" || requestedIncludeCancelled === "true",
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof InventoryQueryContractError || error instanceof InventorySalesPeriodError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return safeApiErrorResponse(error, "读取库存健康数据失败", { headers: { "cache-control": "no-store" } });
  }
}
