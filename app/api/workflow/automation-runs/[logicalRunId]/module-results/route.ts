import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { createDjangoWorkflowService } from "@/lib/django/workflow-service";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";

type RouteContext = { params: Promise<{ logicalRunId: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_PARAMS = new Set(["page", "pageSize"]);

function moduleResultsPath(logicalRunId: string) {
  if (!UUID_RE.test(logicalRunId)) throw new PublicApiError(400, "invalid_request", "logicalRunId 格式无效。");
  return `/api/workflow/automation-runs/${logicalRunId.toLowerCase()}/module-results`;
}

// 四级下钻第三级：一个 logical run 下的模块结果，含三轴状态与批次/覆盖
// 证据（granularity: "batch"，不声称逐日已核验）。
export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "自动化运行投影");
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) {
      if (!ALLOWED_PARAMS.has(key)) {
        return Response.json({ error: `不支持的查询参数：${key}`, code: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
      }
    }
    const path = moduleResultsPath((await context.params).logicalRunId);
    const result = await createDjangoWorkflowService().requestJson<Record<string, unknown>>(
      principal,
      { method: "GET", path, service: "reader", rawQuery: params.toString() },
      { signal: request.signal },
    );
    return Response.json(result.data, { headers: { "cache-control": "no-store", "x-workflow-data-revision": result.revision } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "读取自动化模块结果失败。", { headers: { "cache-control": "no-store" } });
  }
}
