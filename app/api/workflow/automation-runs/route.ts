import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import {
  createDjangoWorkflowService,
  WORKFLOW_AUTOMATION_RUNS_PATH,
} from "@/lib/django/workflow-service";
import { safeApiErrorResponse } from "@/lib/http/api-error";

const ALLOWED_PARAMS = new Set([
  "subjectKey", "chainKey", "planDateFrom", "planDateTo",
  "executionState", "businessState", "deliveryState", "exceptionCategory",
  "page", "pageSize",
]);

// 服务端薄适配：只做鉴权、参数名白名单和转发；真实筛选、分页与硬上限在
// Django 侧（backend/workflow/automation_run_query.py）执行。三轴
// （executionState/businessState/deliveryState）各自独立筛选，不合成一个
// status 参数 —— 这是 B1/B2 的设计前提。
export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "自动化运行投影");
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) {
      if (!ALLOWED_PARAMS.has(key)) {
        return Response.json({ error: `不支持的查询参数：${key}`, code: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
      }
    }
    const result = await createDjangoWorkflowService().requestJson<Record<string, unknown>>(
      principal,
      { method: "GET", path: WORKFLOW_AUTOMATION_RUNS_PATH, service: "reader", rawQuery: params.toString() },
      { signal: request.signal },
    );
    return Response.json(result.data, { headers: { "cache-control": "no-store", "x-workflow-data-revision": result.revision } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "读取自动化运行列表失败。", { headers: { "cache-control": "no-store" } });
  }
}
