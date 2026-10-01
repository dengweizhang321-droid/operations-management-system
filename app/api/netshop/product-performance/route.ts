import {
  createDjangoNetshopService,
  NETSHOP_PRODUCT_PERFORMANCE_PATH,
} from "@/lib/django/netshop-service";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
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
import { encodeProductIdentity, type ProductIdentity } from "@/lib/netshop/insights-contract";
import { AuthorizationError } from "@/lib/auth/authorization";

function readDimension(values: readonly string[]): "sku" | "spu" {
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
    readNetshopSnapshotToken(params.getAll("snapshotToken"), view === "page");
    readNetshopQueryInteger(params.get("page"), "page", 1, 1, NETSHOP_QUERY_MAX_PAGE);
    readNetshopQueryInteger(params.get("pageSize"), "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE);
    resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"));
    if (params.has("shop")) {
      throw new NetshopQueryError("invalid_outlet_filter", "店铺筛选必须使用 outlet 平台与店铺复合键");
    }
    const requestedPlatforms = params.getAll("platform");
    netshopPlatformsForPrincipal(principal, requestedPlatforms);
    netshopOutletsForPrincipal(
      principal,
      readNetshopOutletFilters(params.getAll("outlet")),
      requestedPlatforms,
    );
    if (view === "identities") {
      requireSupportedInsightScope(principal);
      const allowed = new Set(["dimension", "view", "platform", "outlet", "startDate", "endDate", "identity", "sourceRevision"]);
      for (const key of params.keys()) if (!allowed.has(key) || !["platform", "outlet", "identity"].includes(key) && params.getAll(key).length !== 1) throw new NetshopQueryError("invalid_identity", "精确配对参数重复或无效");
      const values = params.getAll("identity"), outlets = readNetshopOutletFilters(params.getAll("outlet"));
      if (!values.length || values.length > 100 || new Set(values).size !== values.length || !params.get("sourceRevision") || params.get("sourceRevision")!.length > 100 || !resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"))) throw new NetshopQueryError("invalid_identity", "精确配对身份/日期/来源版本无效");
      for (const raw of values) {
        let identity: unknown; try { identity = JSON.parse(raw); } catch { throw new NetshopQueryError("invalid_identity", "identity必须为四项JSON数组"); }
        if (!Array.isArray(identity) || identity.length !== 4 || !identity.every(v => typeof v === "string")) throw new NetshopQueryError("invalid_identity", "identity必须为四项JSON数组");
        const [platform, shopName, kind, id] = identity;
        encodeProductIdentity({ platform, shopName, dimension: kind, id } as ProductIdentity);
        if (kind !== dimension || outlets.length && !outlets.some(o => o.platform === platform && o.shopName === shopName) || requestedPlatforms.length && !requestedPlatforms.includes(platform)) throw new NetshopQueryError("invalid_identity", "identity不属于所选范围");
        netshopPlatformsForPrincipal(principal, [platform]);
      }
    } else if (params.has("identity") || params.has("sourceRevision")) throw new NetshopQueryError("invalid_identity", "配对参数仅限identities视图");
    const result = await createDjangoNetshopService().request<Record<string, unknown>>(
      principal,
      { method: "GET", path: NETSHOP_PRODUCT_PERFORMANCE_PATH, query: params, service: "reader" },
      { signal: request.signal },
    );
    if (view === "identities") {
      const current = await requireAppPrincipal();
      if (JSON.stringify([principal.email, principal.role, principal.scope]) !== JSON.stringify([current.email, current.role, current.scope])) throw new AuthorizationError(403, "access_denied", "精确配对期间账号权限已变化");
    }
    return Response.json(result.data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const failure = netshopQueryErrorPayload(error, "读取网店商品日数据失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
