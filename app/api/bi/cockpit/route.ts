import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope, AuthorizationError } from "@/lib/auth/authorization";
import { requestDjangoBiCockpit } from "@/lib/django/bi-service";
import { decodeBiCockpit } from "@/lib/bi/cockpit-contract";
import { safeApiErrorResponse } from "@/lib/http/api-error";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "BI综合经营驾驶舱");
    const query = new URL(request.url).searchParams;
    if (query.toString().length > 2048) return Response.json({ error: "BI查询超过容量", code: "invalid_request" }, { status: 400 });
    const result = await requestDjangoBiCockpit(principal, query.toString(), { signal: request.signal });
    const current = await requireAppPrincipal();
    if (JSON.stringify(principal) !== JSON.stringify(current)) throw new AuthorizationError(403, "access_denied", "读取期间账号权限已变化");
    return Response.json(decodeBiCockpit(result.data), { headers: { "cache-control": "no-store", "x-bi-data-revision": result.revision } });
  } catch (error) {
    return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "BI驾驶舱读取失败", { headers: { "cache-control": "no-store" } });
  }
}
