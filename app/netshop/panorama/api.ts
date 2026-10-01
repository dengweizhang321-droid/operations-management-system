import { AuthorizationError, authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { createDjangoNetshopService } from "@/lib/django/netshop-service";
import { netshopPlatformsForPrincipal, netshopOutletsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { netshopQueryErrorPayload } from "@/lib/netshop/query-contract";
import { decodeStorePanorama, PanoramaResponseError, validatePanoramaQuery } from "./contract";

/** S owns this adapter; I alone registers the fixed Django reader/SDK/gateway. */
export async function readStorePanoramaApi(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]), deadline = performance.now()+90_000;
  const checkBudget = () => { if (signal.aborted) throw signal.reason; if (performance.now() >= deadline) throw new DOMException("全景读取超时", "TimeoutError"); };
  try {
    checkBudget();
    const principal = await requireAppPrincipal(); requireSupportedInsightScope(principal);
    checkBudget();
    const query = new URL(request.url).searchParams, spec = validatePanoramaQuery(query);
    netshopPlatformsForPrincipal(principal, spec.shared.platforms);
    netshopOutletsForPrincipal(principal, spec.shared.shops, spec.shared.platforms);
    const result = await createDjangoNetshopService().request<unknown>(principal, {
      method: "GET", path: "/api/netshop/store-panorama", query, service: "reader",
    }, { signal, insightsTimeoutMs: 90_000 });
    checkBudget();
    const current = await requireAppPrincipal();
    checkBudget();
    if (JSON.stringify([principal.email, principal.role, principal.scope]) !== JSON.stringify([current.email, current.role, current.scope])) throw new AuthorizationError(403, "access_denied", "全景取数期间账号权限已变化，请重新读取");
    const data = decodeStorePanorama(result.data, query, result.revision);
    checkBudget();
    const response = Response.json(data, { headers: { "cache-control": "no-store", "X-Netshop-Data-Revision": result.revision! } });
    checkBudget(); return response;
  } catch (error) {
    if (error instanceof PanoramaResponseError) return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    const failure = netshopQueryErrorPayload(error, "店铺全景来源读取失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
