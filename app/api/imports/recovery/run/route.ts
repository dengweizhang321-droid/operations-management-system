import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { createDjangoWorkflowService, WORKFLOW_JACKYUN_RECOVERY_AUTHORITY_PATH } from "@/lib/django/workflow-service";
import { safeApiErrorResponse } from "@/lib/http/api-error";

export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const principal = await requireAppPrincipal(["admin"]); requireUnrestrictedDataScope(principal, "完整恢复运行");
    const query = new URL(request.url).searchParams;
    if (query.has("authorizationId")) {
      if ([...query.keys()].length !== 1 || query.getAll("authorizationId").length !== 1 || !/^[a-f0-9-]{36}$/.test(query.get("authorizationId") ?? "")) return Response.json({ error: "授权身份无效" }, { status: 400, headers });
      const result = await createDjangoWorkflowService().requestJson(principal, { method: "GET", path: WORKFLOW_JACKYUN_RECOVERY_AUTHORITY_PATH,
        service: "writer", rawQuery: query.toString() }, { signal: request.signal });
      return Response.json(result.data, { headers });
    }
    if ([...query.keys()].length) return Response.json({ error: "目标查询参数无效" }, { status: 400, headers });
    const response = await fetch("http://127.0.0.1:5791/coordination/jackyun-recovery-target", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    return Response.json(result, { status: response.status, headers });
  } catch (error) { return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "完整恢复目标无法确认。", { headers }); }
}

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const principal = await requireAppPrincipal(["admin"]); requireUnrestrictedDataScope(principal, "完整恢复运行", "导入");
    if (request.headers.get("origin") !== new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "完整恢复只接受同源操作" }, { status: 403, headers });
    const requestId = request.headers.get("x-teruisi-recovery-request-id") ?? "";
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId)) return Response.json({ error: "缺少唯一完整恢复请求编号" }, { status: 400, headers });
    const body = await request.json();
    const authorized = await createDjangoWorkflowService().requestJson<{ authorizationId?: string }>(principal, { method: "POST",
      path: WORKFLOW_JACKYUN_RECOVERY_AUTHORITY_PATH, service: "writer", payload: body }, { signal: request.signal, requestId: () => requestId });
    if (authorized.data.authorizationId !== requestId) throw new Error("恢复授权回执不一致。");
    const response = await fetch("http://127.0.0.1:5791/coordination/jackyun-recovery-dispatch", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ authorizationId: requestId }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    return Response.json(result, { status: response.status, headers });
  } catch (error) { return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "派发结果尚未确认；保留当前请求编号，重试只协调原结果。", { headers }); }
}
