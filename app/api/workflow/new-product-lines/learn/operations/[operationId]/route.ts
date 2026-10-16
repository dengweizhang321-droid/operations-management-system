import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { createDjangoWorkflowService, getWorkflowBackendMode } from "@/lib/django/workflow-service";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";
import { LEARNING_OPERATION_ID_RE, learningOperationPath } from "@/lib/workflow/learning-operation";

export async function GET(request: Request, context: { params: Promise<{ operationId: string }> }) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "新品销售跟进", "查询学习结果");
    const { operationId } = await context.params;
    if (!LEARNING_OPERATION_ID_RE.test(operationId) || new URL(request.url).search) {
      throw new PublicApiError(400, "invalid_request", "新品学习操作编号无效。");
    }
    await getWorkflowBackendMode();
    const result = await createDjangoWorkflowService().requestJson<Record<string, unknown>>(
      principal, { method: "GET", path: learningOperationPath(operationId), service: "writer" }, { signal: request.signal },
    );
    return Response.json(result.data, { headers: { "cache-control": "no-store", "x-workflow-data-revision": result.revision } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "新品学习结果暂时无法确认。");
  }
}
