import { AuthorizationError, authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { createDjangoNetshopService } from "@/lib/django/netshop-service";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { netshopQueryErrorPayload } from "@/lib/netshop/query-contract";
import { decodePromotionDetailForQuery, validatePromotionQuery } from "@/lib/netshop/promotion-insights-contract";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(); requireSupportedInsightScope(principal);
    const query = new URL(request.url).searchParams, spec = validatePromotionQuery(query, true);
    netshopPlatformsForPrincipal(principal, spec.context.platforms); netshopOutletsForPrincipal(principal, spec.context.shops, spec.context.platforms);
    const result = await createDjangoNetshopService().request<unknown>(principal,
      { method: "GET", path: "/api/netshop/promotion-insights/detail", query, service: "reader" },
      { signal: request.signal, insightsTimeoutMs: 90_000 });
    const current = await requireAppPrincipal();
    if (JSON.stringify([principal.email, principal.role, principal.scope]) !== JSON.stringify([current.email, current.role, current.scope])) throw new AuthorizationError(403, "access_denied", "详情取数期间账号权限已变化");
    return Response.json(decodePromotionDetailForQuery(result.data, query, result.revision), {
      headers: { "cache-control": "no-store", "X-Netshop-Data-Revision": result.revision! },
    });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    const failure = netshopQueryErrorPayload(error, "推广对象详情读取失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
