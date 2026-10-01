import { AuthorizationError, authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { createDjangoNetshopService } from "@/lib/django/netshop-service";
import { netshopPlatformsForPrincipal, netshopOutletsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { netshopQueryErrorPayload } from "@/lib/netshop/query-contract";
import { ComparisonResponseError, decodeComparisonInsights, validateComparisonQuery } from "./contract";

/** Dedicated read adapter; its fixed path is registered only by coordinator I. */
export async function readComparisonApi(request: Request) {
  try {
    const principal = await requireAppPrincipal(); requireSupportedInsightScope(principal);
    const query = new URL(request.url).searchParams, spec = validateComparisonQuery(query);
    netshopPlatformsForPrincipal(principal, spec.shared.platforms);
    netshopOutletsForPrincipal(principal, spec.shared.shops, spec.shared.platforms);
    const result = await createDjangoNetshopService().request<unknown>(principal, { method: "GET", path: "/api/netshop/comparison-insights", query, service: "reader" }, { signal: request.signal, insightsTimeoutMs: 90_000 });
    const current = await requireAppPrincipal();
    if (JSON.stringify([principal.email, principal.role, principal.scope]) !== JSON.stringify([current.email, current.role, current.scope])) throw new AuthorizationError(403, "access_denied", "取数期间账号权限已变化，请重新读取");
    const data = decodeComparisonInsights(result.data, query, result.revision ?? null);
    return Response.json(data, { headers: { "cache-control": "no-store", "X-Netshop-Data-Revision": result.revision! } });
  } catch (error) {
    if (error instanceof ComparisonResponseError) return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    const failure = netshopQueryErrorPayload(error, "比较来源读取失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
