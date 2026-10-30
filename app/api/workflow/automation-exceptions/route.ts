import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import {
  createDjangoWorkflowService,
  WORKFLOW_AUTOMATION_EXCEPTIONS_PATH,
} from "@/lib/django/workflow-service";
import { safeApiErrorResponse } from "@/lib/http/api-error";

const ALLOWED_PARAMS = new Set(["subjectKey", "chainKey", "planDateFrom", "planDateTo"]);

// 异常筛选三类：待人工（needs_human）、持续阻塞（stuck，判据见
// docs/自动化/通用/workflow-dingtalk-notifications.md）、无法核实
// （result_unknown）。
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
      { method: "GET", path: WORKFLOW_AUTOMATION_EXCEPTIONS_PATH, service: "reader", rawQuery: params.toString() },
      { signal: request.signal },
    );
    return Response.json(result.data, { headers: { "cache-control": "no-store", "x-workflow-data-revision": result.revision } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "读取自动化异常汇总失败。", { headers: { "cache-control": "no-store" } });
  }
}
