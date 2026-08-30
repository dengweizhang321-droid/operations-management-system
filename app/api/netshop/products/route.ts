import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductCatalog,
} from "@/lib/netshop/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import {
  NETSHOP_QUERY_MAX_PAGE,
  NETSHOP_QUERY_MAX_PAGE_SIZE,
  NetshopQueryError,
  netshopQueryErrorPayload,
  readNetshopOutletFilters,
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
    if (params.has("shop")) {
      throw new NetshopQueryError("invalid_outlet_filter", "店铺筛选必须使用 outlet 平台与店铺复合键");
    }
    const requestedPlatforms = params.getAll("platform");
    const platformNames = netshopPlatformsForPrincipal(principal, requestedPlatforms);
    const outlets = netshopOutletsForPrincipal(
      principal,
      readNetshopOutletFilters(params.getAll("outlet")),
      requestedPlatforms,
    );
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const payload = await getNetshopProductCatalog(db, principal, {
      query: params.get("q") ?? undefined,
      page,
      pageSize,
      outlets,
      platformNames,
      salesChannels: principal.scope === null ? null : principal.scope.channels,
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
