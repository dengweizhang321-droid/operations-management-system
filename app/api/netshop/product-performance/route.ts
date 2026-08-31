import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductPerformance,
  getNetshopProductPerformancePage,
  getNetshopProductPerformanceSummary,
  type NetshopProductPerformanceDimension,
} from "@/lib/netshop/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopOutletsForPrincipal, netshopPlatformOptionsForPrincipal, netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import {
  NETSHOP_QUERY_MAX_PAGE,
  NETSHOP_QUERY_MAX_PAGE_SIZE,
  NetshopQueryError,
  netshopQueryErrorPayload,
  readNetshopOutletFilters,
  readNetshopProductPerformanceView,
  readNetshopQueryInteger,
  readNetshopSnapshotToken,
  resolveNetshopQueryPeriod,
} from "@/lib/netshop/query-contract";

function readDimension(values: readonly string[]): NetshopProductPerformanceDimension {
  if (values.length === 0) return "sku";
  if (values.length !== 1 || (values[0] !== "sku" && values[0] !== "spu")) {
    throw new NetshopQueryError("invalid_dimension", "dimension 必须且只能是 sku 或 spu");
  }
  return values[0];
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const params = new URL(request.url).searchParams;
    const dimension = readDimension(params.getAll("dimension"));
    const view = readNetshopProductPerformanceView(params.getAll("view"));
    const snapshotToken = readNetshopSnapshotToken(params.getAll("snapshotToken"), view === "page");
    const page = readNetshopQueryInteger(params.get("page"), "page", 1, 1, NETSHOP_QUERY_MAX_PAGE);
    const pageSize = readNetshopQueryInteger(params.get("pageSize"), "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE);
    const period = resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"));
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
    const input = {
      dimension,
      query: params.get("q") ?? undefined,
      page,
      pageSize,
      platformNames,
      outlets,
      startDate: period?.startDate,
      endDate: period?.endDate,
    };
    const payload = view === "page"
      ? await getNetshopProductPerformancePage(db, { ...input, snapshotToken: snapshotToken! })
      : view === "summary"
        ? await getNetshopProductPerformanceSummary(db, input)
        : await getNetshopProductPerformance(db, input);
    const platformOptions = netshopPlatformOptionsForPrincipal(principal)
      .filter((platform) => dimension === "spu" || platform === "京东");
    return Response.json(
      view === "full" ? { ...payload, platforms: platformOptions } : payload,
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const failure = netshopQueryErrorPayload(error, "读取网店商品日数据失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
