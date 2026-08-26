import { ensureInventorySchema, getInventoryDatabase } from "@/lib/inventory/database";
import { getInventoryAgeAnalysis } from "@/lib/inventory/age-analysis";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import {
  InventoryQueryContractError,
  inventoryAgeBuckets,
  normalizeInventorySelections,
  parseInventoryPaginationParameter,
} from "@/lib/inventory/query-contract";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "库龄分析数据");
    const db = getInventoryDatabase();
    await Promise.all([ensureInventorySchema(db), ensureErpReferenceSchema(db)]);
    const params = new URL(request.url).searchParams;
    const allowedStatuses = ["healthy", "aged", "slow", "stagnant", "no_stock"] as const;
    const statusValues = normalizeInventorySelections(params.getAll("status"), {
      maximum: allowedStatuses.length,
      allowed: allowedStatuses,
      label: "库龄状态",
    });
    const warehouses = normalizeInventorySelections(params.getAll("warehouse"), { maximum: 10, label: "仓库" });
    const allowedAgeBuckets = inventoryAgeBuckets.map((bucket) => bucket.key);
    const ageBuckets = normalizeInventorySelections(params.getAll("ageBucket"), {
      maximum: allowedAgeBuckets.length,
      allowed: allowedAgeBuckets,
      label: "库龄区间",
    });
    const query = params.get("q")?.trim() || undefined;
    if (query && query.length > 100) throw new InventoryQueryContractError("搜索词不能超过 100 个字符");
    return Response.json(await getInventoryAgeAnalysis(db, {
      page: parseInventoryPaginationParameter(params.get("page"), "page"),
      pageSize: parseInventoryPaginationParameter(params.get("pageSize"), "pageSize"),
      query,
      warehouses,
      statuses: statusValues as Array<typeof allowedStatuses[number]>,
      ageBuckets: ageBuckets as Array<(typeof inventoryAgeBuckets)[number]["key"]>,
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof InventoryQueryContractError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return safeApiErrorResponse(error, "读取库龄分析数据失败", { headers: { "cache-control": "no-store" } });
  }
}
