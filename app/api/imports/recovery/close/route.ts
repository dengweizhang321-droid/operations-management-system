import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { createDjangoWorkflowService, WORKFLOW_JACKYUN_CLOSE_AUTHORITY_PATH } from "@/lib/django/workflow-service";
import { safeApiErrorResponse } from "@/lib/http/api-error";
const headers = { "cache-control": "no-store" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]); requireUnrestrictedDataScope(principal, "闭合吉客云任务");
    const query = new URL(request.url).searchParams;
    if (query.has("authorizationId")) {
      if ([...query.keys()].length !== 1 || query.getAll("authorizationId").length !== 1 || !uuid.test(query.get("authorizationId") ?? "")) return Response.json({ error: "闭合请求编号无效" }, { status: 400, headers });
      const result = await createDjangoWorkflowService().requestJson(principal, { method: "GET", path: WORKFLOW_JACKYUN_CLOSE_AUTHORITY_PATH, service: "writer", rawQuery: query.toString() }, { signal: request.signal });
      return Response.json(result.data, { headers });
    }
    if ([...query.keys()].some(k => k !== "requestId") || query.getAll("requestId").length > 1 || query.has("requestId") && !uuid.test(query.get("requestId") ?? "")) return Response.json({ error: "闭合查询无效" }, { status: 400, headers });
    const response = await fetch(`http://127.0.0.1:5791/coordination/jackyun-close-target${query.size ? `?${query}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    return Response.json(await response.json(), { status: response.status, headers });
  } catch (error) { return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "闭合状态暂时无法核实，请保留当前请求编号。", { headers }); }
}
export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]); requireUnrestrictedDataScope(principal, "闭合吉客云任务", "导入");
    if (request.headers.get("origin") !== new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "一键闭合只接受同源操作" }, { status: 403, headers });
    const requestId = request.headers.get("x-teruisi-close-request-id") ?? "";
    if (!uuid.test(requestId)) return Response.json({ error: "缺少唯一闭合请求编号" }, { status: 400, headers });
    const authorized = await createDjangoWorkflowService().requestJson<{ authorizationId?: string }>(principal, { method: "POST", path: WORKFLOW_JACKYUN_CLOSE_AUTHORITY_PATH, service: "writer", payload: await request.json() }, { signal: request.signal, requestId: () => requestId });
    if (authorized.data.authorizationId !== requestId) throw new Error("闭合授权回执不一致。");
    const response = await fetch("http://127.0.0.1:5791/coordination/jackyun-close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authorizationId: requestId }), signal: AbortSignal.timeout(55000) });
    return Response.json(await response.json(), { status: response.status, headers });
  } catch (error) { return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "闭合结果尚未确认；保留同一请求编号，刷新只读取原结果。", { headers }); }
}
