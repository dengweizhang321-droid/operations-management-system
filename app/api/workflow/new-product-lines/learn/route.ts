import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import {
  createDjangoWorkflowService,
  getWorkflowBackendMode,
  WORKFLOW_NEW_PRODUCT_LINE_LEARN_PATH,
} from "@/lib/django/workflow-service";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";
import { readBoundedJsonObject } from "@/lib/http/bounded-json";
import { LEARNING_OPERATION_ID_RE, LEARNING_REQUEST_PREFIX } from "@/lib/workflow/learning-operation";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "新品销售跟进", "学习代码");
    await getWorkflowBackendMode();
    const result = await createDjangoWorkflowService().requestJson<Record<string, unknown>>(
      principal,
      { method: "GET", path: WORKFLOW_NEW_PRODUCT_LINE_LEARN_PATH, service: "reader", rawQuery: new URL(request.url).searchParams.toString() },
      { signal: request.signal },
    );
    return Response.json(result.data, { headers: { "cache-control": "no-store", "x-workflow-data-revision": result.revision } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "预览吉客云新品代码失败。");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "新品销售跟进", "学习代码");
    await getWorkflowBackendMode();
    const payload = await readBoundedJsonObject(request, 256);
    const operationId = payload.operationId;
    if (Object.keys(payload).length !== 1 || typeof operationId !== "string" || !LEARNING_OPERATION_ID_RE.test(operationId)
      || new URL(request.url).search) {
      throw new PublicApiError(400, "invalid_request", "新品学习操作编号无效。");
    }
    const result = await createDjangoWorkflowService().requestJson<Record<string, unknown>>(
      principal,
      { method: "POST", path: WORKFLOW_NEW_PRODUCT_LINE_LEARN_PATH, service: "writer", payload: { operationId } },
      { signal: request.signal, requestId: () => `${LEARNING_REQUEST_PREFIX}${operationId}` },
    );
    return Response.json(result.data, { headers: { "cache-control": "no-store", "x-workflow-data-revision": result.revision } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "学习吉客云新品代码失败。");
  }
}
