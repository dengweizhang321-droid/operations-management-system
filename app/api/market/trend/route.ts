import { ensureMarketSchema, getMarketDatabase, getMarketItemTrend } from "@/lib/market/database";
import { ensureMarketNetshopProjection } from "@/lib/market/netshop-projection";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "市场单品趋势");
    const db = getMarketDatabase();
    await ensureMarketSchema(db);
    await ensureMarketNetshopProjection(db, principal, { signal: request.signal });
    const params = new URL(request.url).searchParams;
    const dimension = params.get("dimension");
    if (dimension !== "SKU" && dimension !== "SPU") {
      throw new PublicApiError(400, "invalid_request", "榜单维度必须为 SKU 或 SPU");
    }
    const payload = await getMarketItemTrend(db, {
      skuCode: params.get("skuCode") ?? "",
      category: params.get("category") ?? "",
      scope: params.get("scope") ?? "",
      rankingDimension: dimension,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "读取市场单品趋势失败", { headers: { "cache-control": "no-store" } });
  }
}
