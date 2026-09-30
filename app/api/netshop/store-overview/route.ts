import { AuthorizationError, authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal, netshopOutletsForPrincipal } from "@/lib/netshop/access";
import { readNetshopOutletFilters, netshopQueryErrorPayload } from "@/lib/netshop/query-contract";
import { createDjangoNetshopService, NETSHOP_STORE_OVERVIEW_PATH } from "@/lib/django/netshop-service";
import { decodeStoreOverview } from "@/lib/netshop/store-overview-contract";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const query = new URL(request.url).searchParams;
    netshopPlatformsForPrincipal(principal, query.getAll("platform"));
    netshopOutletsForPrincipal(principal, readNetshopOutletFilters(query.getAll("outlet")), query.getAll("platform"));
    const result = await createDjangoNetshopService().request<unknown>(principal, { method: "GET", path: NETSHOP_STORE_OVERVIEW_PATH, query, service: "reader" }, { signal: request.signal, overviewTimeoutMs: 90_000 });
    const currentPrincipal = await requireAppPrincipal();
    if (JSON.stringify([principal.email, principal.role, principal.scope]) !== JSON.stringify([currentPrincipal.email, currentPrincipal.role, currentPrincipal.scope])) {
      throw new AuthorizationError(403, "access_denied", "取数期间账号权限已变化，请重新读取总览");
    }
    return Response.json(decodeStoreOverview(result.data), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    const failure = netshopQueryErrorPayload(error, "读取网店均衡总览失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
