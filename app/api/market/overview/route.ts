import { ensureMarketSchema, getMarketDatabase, getMarketOverview } from "@/lib/market/database";
import { ensureNetshopSchema } from "@/lib/netshop/database";
import { getCachedMarketOverview } from "@/lib/market/overview-response-cache";
import { createDjangoSalesConsumerReader } from "@/lib/django/sales-consumer-reader";
import { validateMarketOverviewCachePayload } from "@/lib/market/cache-payload-validators";
import { ensureAnnotationSchema } from "@/lib/market/annotation-schema";
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
    const salesReader = createDjangoSalesConsumerReader();
    const [, , , salesFreshness] = await Promise.all([
      ensureMarketSchema(db),
      ensureAnnotationSchema(db),
      ensureNetshopSchema(db),
      salesReader.read(principal, { operation: "freshness" }, { signal: request.signal }),
    ]);
    const result = await getCachedMarketOverview(
      db,
      { view, filters, pagination, salesRevision: salesFreshness.revision },
      () => getMarketOverview(db, principal, filters, {
        view,
        rankingPage: pagination.page,
        rankingPageSize: pagination.pageSize,
        salesReader,
        expectedSalesRevision: salesFreshness.revision,
      }),
      (payload) => validateMarketOverviewCachePayload(payload, view),
    );
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
