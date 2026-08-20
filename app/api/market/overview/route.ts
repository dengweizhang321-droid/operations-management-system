import { ensureMarketSchema, getMarketDatabase, getMarketOverview } from "@/lib/market/database";
import { ensureNetshopSchema } from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";
import { getCachedMarketOverview } from "@/lib/market/overview-response-cache";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import { parseMarketOverviewQuery } from "@/lib/market/query-contract";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "市场分析概览");
    const params = new URL(request.url).searchParams;
    const { view, pagination, filters } = parseMarketOverviewQuery(params);
    const db = getMarketDatabase();
    await Promise.all([ensureMarketSchema(db), ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const result = await getCachedMarketOverview(db, { view, filters, pagination }, () =>
      getMarketOverview(db, filters, { view, rankingPage: pagination.page, rankingPageSize: pagination.pageSize }));
    return Response.json(result.payload, {
      headers: { "cache-control": "no-store", "x-market-overview-cache": result.status },
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "市场分析数据读取失败", {
      headers: { "cache-control": "no-store" },
    });
  }
}
