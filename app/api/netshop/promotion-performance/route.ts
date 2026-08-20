import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopPromotionPerformance,
} from "@/lib/netshop/database";
import {
  NETSHOP_QUERY_MAX_PAGE,
  NETSHOP_QUERY_MAX_PAGE_SIZE,
  netshopQueryErrorPayload,
  readNetshopQueryInteger,
  resolveNetshopQueryPeriod,
} from "@/lib/netshop/query-contract";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const params = new URL(request.url).searchParams;
    const page = readNetshopQueryInteger(params.get("page"), "page", 1, 1, NETSHOP_QUERY_MAX_PAGE);
    const pageSize = readNetshopQueryInteger(params.get("pageSize"), "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE);
    const period = resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"));
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const payload = await getNetshopPromotionPerformance(db, {
      query: params.get("q") ?? undefined,
      page,
      pageSize,
      platformNames: netshopPlatformsForPrincipal(principal, params.getAll("platform")),
      shopNames: [...new Set(params.getAll("shop").map((value) => value.trim()).filter(Boolean))].slice(0, 50),
      startDate: period?.startDate,
      endDate: period?.endDate,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const failure = netshopQueryErrorPayload(error, "读取网店推广数据失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
