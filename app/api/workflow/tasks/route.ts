import {
  createWorkflowTask,
  deleteWorkflowTask,
  listWorkflowTasksPage,
  updateWorkflowTask,
  type CreateWorkflowTaskInput,
  type UpdateWorkflowTaskInput,
} from "@/lib/workflow/tasks";
import { getD1Database } from "@/lib/database/d1";
import { workflowErrorResponse } from "@/lib/workflow/errors";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作计划");
    const params = new URL(request.url).searchParams;
    const payload = await listWorkflowTasksPage({
      query: params.get("q") ?? params.get("query") ?? undefined,
      statuses: params.getAll("status"),
      priorities: params.getAll("priority"),
      owners: params.getAll("owner"),
      shopNames: params.getAll("shopName"),
      dueFrom: params.get("dueFrom"),
      dueTo: params.get("dueTo"),
      page: params.get("page"),
      pageSize: params.get("pageSize"),
    }, getD1Database());
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return workflowErrorResponse(error, "读取工作计划失败");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作计划");
    const payload = await request.json().catch(() => null) as CreateWorkflowTaskInput | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json({ error: "工作项内容必须是有效的 JSON 对象", code: "invalid_request" },
        { status: 400, headers: { "cache-control": "no-store" } });
    }
    const db = getD1Database();
    const item = await createWorkflowTask(payload, principal.email, db);
    return Response.json({ item }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return workflowErrorResponse(error, "保存工作项失败");
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作计划");
    const id = new URL(request.url).searchParams.get("id");
    const payload = await request.json().catch(() => null) as UpdateWorkflowTaskInput | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json({ error: "缺少可更新的工作项字段", code: "invalid_request" },
        { status: 400, headers: { "cache-control": "no-store" } });
    }
    const db = getD1Database();
    const item = await updateWorkflowTask(id, payload, principal.email, db);
    if (!item) return Response.json({ error: "工作项不存在或已删除", code: "not_found" }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return workflowErrorResponse(error, "更新工作项失败");
  }
}

export async function DELETE(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作计划");
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const expectedVersion = params.get("expectedVersion");
    const db = getD1Database();
    const deleted = await deleteWorkflowTask(id, expectedVersion, principal.email, db);
    if (!deleted) return Response.json({ error: "工作项不存在或已删除", code: "not_found" }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return workflowErrorResponse(error, "删除工作项失败");
  }
}
