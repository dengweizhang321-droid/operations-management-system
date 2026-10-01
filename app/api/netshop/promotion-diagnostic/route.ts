import { AuthorizationError, authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import {
  createDjangoNetshopService,
  NETSHOP_PROMOTION_DIAGNOSTIC_PATH,
} from "@/lib/django/netshop-service";
import {
  NetshopQueryError,
  netshopQueryErrorPayload,
  readNetshopOutletFilters,
  resolveNetshopQueryPeriod,
} from "@/lib/netshop/query-contract";
import { validateDiagnosticResponse, PromotionDiagnosticBindingError, type DiagnosticPeriod } from "@/lib/jd/promotion-diagnostic-report";

const ALLOWED = new Set(["platform", "outlet", "startDate", "endDate"]);

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) {
      if (!ALLOWED.has(key) || params.getAll(key).length !== 1) {
        throw new NetshopQueryError("invalid_diagnostic_filter", "推广诊断筛选包含未知或重复参数");
      }
    }
    const period = resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"), 31);
    if (!period) throw new NetshopQueryError("invalid_date_range", "推广诊断必须选择明确的自然日范围");
    const platforms = params.getAll("platform");
    const outlets = readNetshopOutletFilters(params.getAll("outlet"));
    if (platforms.length !== 1 || platforms[0] !== "京东" || outlets.length !== 1
      || outlets[0]?.platform !== "京东") {
      throw new NetshopQueryError("invalid_diagnostic_scope", "推广诊断一次只允许一个精确京东店铺");
    }
    netshopPlatformsForPrincipal(principal, platforms);
    netshopOutletsForPrincipal(principal, outlets, platforms);
    const result = await createDjangoNetshopService().request<DiagnosticPeriod>(
      principal,
      { method: "GET", path: NETSHOP_PROMOTION_DIAGNOSTIC_PATH, query: params, service: "reader" },
      { signal: request.signal },
    );
    const currentPrincipal = await requireAppPrincipal(["admin"]);
    if (JSON.stringify([principal.email, principal.role, principal.scope]) !== JSON.stringify([currentPrincipal.email, currentPrincipal.role, currentPrincipal.scope])) {
      throw new AuthorizationError(403, "access_denied", "读取推广诊断期间账号权限已变化，请重新读取");
    }
    validateDiagnosticResponse(result.data, result.revision, { shopName: outlets[0]!.shopName, startDate: period.startDate, endDate: period.endDate });
    return Response.json(result.data, { headers: { "cache-control": "no-store", "X-Netshop-Data-Revision": result.revision! } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof PromotionDiagnosticBindingError) return Response.json({ error: error.message, code: error.code }, { status: 409, headers: { "cache-control": "no-store" } });
    const failure = netshopQueryErrorPayload(error, "读取京东推广诊断数据失败");
    return Response.json(failure.body, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
