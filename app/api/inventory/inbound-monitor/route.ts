import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import { ensureInventorySchema, getInventoryDatabase } from "@/lib/inventory/database";
import { getInventoryInboundMonitor } from "@/lib/inventory/inbound-monitor";
import {
  InventoryQueryContractError,
  normalizeInventorySelections,
  parseInventoryPaginationParameter,
} from "@/lib/inventory/query-contract";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "京东入仓库存监控");
    const db = getInventoryDatabase();
    await Promise.all([ensureInventorySchema(db), ensureErpReferenceSchema(db)]);
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() || undefined;
    if (query && query.length > 100) throw new InventoryQueryContractError("搜索词不能超过 100 个字符");
    const payload = await getInventoryInboundMonitor(db, principal, {
      query,
      warehouses: normalizeInventorySelections(params.getAll("warehouse"), { maximum: 10, label: "仓库" }),
      brands: normalizeInventorySelections(params.getAll("brand"), { maximum: 20, label: "品牌" }),
      categories: normalizeInventorySelections(params.getAll("category"), { maximum: 20, label: "品类" }),
      suppliers: normalizeInventorySelections(params.getAll("supplier"), { maximum: 20, label: "供应商" }),
      page: parseInventoryPaginationParameter(params.get("page"), "page"),
      pageSize: parseInventoryPaginationParameter(params.get("pageSize"), "pageSize"),
      signal: request.signal,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof InventoryQueryContractError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return safeApiErrorResponse(error, "读取京东入仓库存监控失败。", { headers: { "cache-control": "no-store" } });
  }
}
