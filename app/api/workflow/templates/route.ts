import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getD1Database } from "@/lib/database/d1";
import {
  createWorkflowTaskTemplate,
  deleteWorkflowTaskTemplate,
  listWorkflowTaskTemplates,
  updateWorkflowTaskTemplate,
  type WorkflowTaskTemplateInput,
} from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

function invalidJson(message: string) {
  return Response.json({ error: message, code: "invalid_request" }, {
    status: 400,
    headers: { "cache-control": "no-store" },
  });
}

function routeError(error: unknown, fallback: string) {
  const authorization = authorizationErrorResponse(error);
  return authorization ?? workflowErrorResponse(error, fallback);
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作事项模板");
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true"
      && (principal.role === "operator" || principal.role === "admin");
    return Response.json({ items: await listWorkflowTaskTemplates(includeInactive, getD1Database()) }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return routeError(error, "读取模板失败");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作事项模板");
    const payload = await request.json().catch(() => null) as WorkflowTaskTemplateInput | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return invalidJson("模板必须是有效的 JSON 对象");
    return Response.json({ item: await createWorkflowTaskTemplate(payload, principal.email, getD1Database()) }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return routeError(error, "保存模板失败");
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作事项模板");
    const id = new URL(request.url).searchParams.get("id");
    const payload = await request.json().catch(() => null) as WorkflowTaskTemplateInput | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return invalidJson("模板必须是有效的 JSON 对象");
    const item = await updateWorkflowTaskTemplate(id, payload, principal.email, getD1Database());
    if (!item) return Response.json({ error: "模板不存在", code: "not_found" }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error, "更新模板失败");
  }
}

export async function DELETE(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作事项模板");
    const params = new URL(request.url).searchParams;
    const deleted = await deleteWorkflowTaskTemplate(params.get("id"), params.get("expectedVersion"), getD1Database());
    if (!deleted) return Response.json({ error: "模板不存在", code: "not_found" }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error, "删除模板失败");
  }
}
