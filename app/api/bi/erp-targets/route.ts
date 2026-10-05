import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { createDjangoFinanceService, FINANCE_ERP_TARGETS_PATH } from "@/lib/django/finance-service";
import { safeApiErrorResponse, PublicApiError } from "@/lib/http/api-error";
import { readBoundedJsonObject } from "@/lib/http/bounded-json";

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "ERP经营目标配置");
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new PublicApiError(415, "invalid_request", "目标配置只接受JSON");
    const payload = await readBoundedJsonObject(request, 8192);
    const result = await createDjangoFinanceService().request(principal, { method: "POST", path: FINANCE_ERP_TARGETS_PATH, payload: payload as Record<string, unknown>, service: "writer" }, { signal: request.signal });
    return Response.json(result.data, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "ERP目标保存失败", { headers: { "cache-control": "no-store" } });
  }
}
