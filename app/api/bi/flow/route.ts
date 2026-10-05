import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope, AuthorizationError } from "@/lib/auth/authorization";
import { requestDjangoBiFlow } from "@/lib/django/bi-service";
import { decodeBiFlowReply } from "@/lib/bi/cockpit-contract";
import { safeApiErrorResponse } from "@/lib/http/api-error";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "BI流量与转化");
    const result = await requestDjangoBiFlow<unknown>(principal, new URL(request.url).searchParams.toString(), { signal: request.signal });
    const current = await requireAppPrincipal();
    if (JSON.stringify(current) !== JSON.stringify(principal)) throw new AuthorizationError(403, "access_denied", "读取期间账号权限已变化");
    return Response.json(decodeBiFlowReply(result.data), { headers: { "cache-control": "no-store", "x-bi-data-revision": result.revision } });
  } catch (error) { return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "流量与转化读取失败"); }
}
