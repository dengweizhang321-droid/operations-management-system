import { AuthorizationError, authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { createDjangoNetshopService } from "@/lib/django/netshop-service";
import { netshopPlatformsForPrincipal, netshopOutletsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { netshopQueryErrorPayload } from "@/lib/netshop/query-contract";
import { decodeStorePanorama, PanoramaResponseError, validatePanoramaQuery } from "./contract";

/** S owns this adapter; I alone registers the fixed Django reader/SDK/gateway. */
export async function readStorePanoramaApi(request: Request) {
  try {
    const principal = await requireAppPrincipal(); requireSupportedInsightScope(principal);
    const query = new URL(request.url).searchParams, spec = validatePanoramaQuery(query);
    netshopPlatformsForPrincipal(principal, spec.shared.platforms);
    netshopOutletsForPrincipal(principal, spec.shared.shops, spec.shared.platforms);
    const result = await createDjangoNetshopService().request<unknown>(principal, {
      method: "GET", path: "/api/netshop/store-panorama", query, service: "reader",
    }, { signal: request.signal, insightsTimeoutMs: 90_000 });
    if (request.signal.aborted) throw request.signal.reason;
    const current = await requireAppPrincipal();
    if (JSON.stringify([principal.email, principal.role, principal.scope]) !== JSON.stringify([current.email, current.role, current.scope])) throw new AuthorizationError(403, "access_denied", "全景取数期间账号权限已变化，请重新读取");
    const data = decodeStorePanorama(result.data, query, result.revision);
    if (request.signal.aborted) throw request.signal.reason;
    return Response.json(data, { headers: { "cache-control": "no-store", "X-Netshop-Data-Revision": result.revision! } });
  } catch (error) {
    if (error instanceof PanoramaResponseError) return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    const failure = netshopQueryErrorPayload(error, "店铺全景来源读取失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
