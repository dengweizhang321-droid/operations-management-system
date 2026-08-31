import {
  ensureInventorySchema,
  getInventoryDatabase,
} from "@/lib/inventory/database";
import {
  getInventoryDashboardOverview,
  getInventoryFullOverview,
  getInventoryOverview,
  getInventoryPlanOverview,
} from "@/lib/inventory/overview";
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
  parseInventoryOverviewView,
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
    await ensureInventorySchema(db);
    const params = new URL(request.url).searchParams;
    const requestedView = parseInventoryOverviewView(params);
    if (requestedView === "dashboard") {
      const payload = await getInventoryDashboardOverview(db, principal, {
        startDate: params.get("startDate")?.trim() || undefined,
        endDate: params.get("endDate")?.trim() || undefined,
        signal: request.signal,
      });
      return Response.json(payload, { headers: { "cache-control": "no-store" } });
    }
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
    const planOptions = {
      planPage: parseInventoryPaginationParameter(params.get("planPage"), "page"),
      planPageSize: parseInventoryPaginationParameter(params.get("planPageSize"), "pageSize"),
      planStatus: planStatus ?? undefined,
      includeCancelledPlans: planStatus === "cancelled" || requestedIncludeCancelled === "true",
    };
    const query = params.get("q")?.trim() || undefined;
    if (query && query.length > 100) throw new InventoryQueryContractError("搜索词不能超过 100 个字符");
    const commonOptions = {
      query,
      warehouses: readInventorySelections(params, "warehouse", { maximum: 10, label: "仓库" }),
      brands: readInventorySelections(params, "brand", { maximum: 20, label: "品牌" }),
      categories: readInventorySelections(params, "category", { maximum: 20, label: "品类" }),
    };
    if (requestedView === "plan") {
      const payload = await getInventoryPlanOverview(db, principal, {
        startDate: params.get("startDate")?.trim() || undefined,
        endDate: params.get("endDate")?.trim() || undefined,
        ...commonOptions,
        ...planOptions,
        signal: request.signal,
      });
      return Response.json(payload, { headers: { "cache-control": "no-store" } });
    }
    const overviewOptions = {
      startDate: params.get("startDate")?.trim() || undefined,
      endDate: params.get("endDate")?.trim() || undefined,
      ...commonOptions,
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
      ...planOptions,
      signal: request.signal,
    };
    const payload = requestedView === "full"
      ? await getInventoryFullOverview(db, principal, overviewOptions)
      : await getInventoryOverview(db, principal, overviewOptions);
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
