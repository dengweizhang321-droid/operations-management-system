import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductPerformance,
  type NetshopProductPerformanceDimension,
} from "@/lib/netshop/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformOptionsForPrincipal, netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import {
  NETSHOP_QUERY_MAX_PAGE,
  NETSHOP_QUERY_MAX_PAGE_SIZE,
  netshopQueryErrorPayload,
  readNetshopQueryInteger,
  resolveNetshopQueryPeriod,
} from "@/lib/netshop/query-contract";

function readDimension(value: string | null): NetshopProductPerformanceDimension {
  return value === "spu" ? "spu" : "sku";
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const params = new URL(request.url).searchParams;
    const dimension = readDimension(params.get("dimension"));
    const page = readNetshopQueryInteger(params.get("page"), "page", 1, 1, NETSHOP_QUERY_MAX_PAGE);
    const pageSize = readNetshopQueryInteger(params.get("pageSize"), "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE);
    const period = resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"));
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const payload = await getNetshopProductPerformance(db, {
      dimension,
      query: params.get("q") ?? undefined,
      page,
      pageSize,
      platformNames: netshopPlatformsForPrincipal(principal, params.getAll("platform")),
      shopNames: [...new Set(params.getAll("shop").map((value) => value.trim()).filter(Boolean))].slice(0, 50),
      startDate: period?.startDate,
      endDate: period?.endDate,
    });
    const platformOptions = netshopPlatformOptionsForPrincipal(principal)
      .filter((platform) => dimension === "spu" || platform === "京东");
    return Response.json(
      { ...payload, platforms: platformOptions },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const failure = netshopQueryErrorPayload(error, "读取网店商品日数据失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
