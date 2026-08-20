import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductCatalog,
} from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";
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
    const salesPeriod = resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"));
    const db = getNetshopDatabase();
    await Promise.all([ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const payload = await getNetshopProductCatalog(db, {
      query: params.get("q") ?? undefined,
      page,
      pageSize,
      shopNames: [...new Set(params.getAll("shop").map((value) => value.trim()).filter(Boolean))].slice(0, 50),
      platformNames: netshopPlatformsForPrincipal(principal, params.getAll("platform")),
      salesStartDate: salesPeriod?.startDate,
      salesEndDate: salesPeriod?.endDate,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const failure = netshopQueryErrorPayload(error, "读取网店货品数据失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
