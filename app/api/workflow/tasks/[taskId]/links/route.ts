import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getSalesDatabase } from "@/lib/sales/database";
import { createWorkflowTaskLink, deleteWorkflowTaskLink, listWorkflowTaskLinks } from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

type Context = { params: Promise<{ taskId: string }> };
export async function GET(_request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项业务关联"); const { taskId } = await context.params;
    return Response.json({ items: await listWorkflowTaskLinks(taskId, getSalesDatabase()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "读取业务关联失败"); }
}
export async function POST(request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项业务关联"); const payload = await request.json().catch(() => null) as { entityType?: unknown; entityId?: unknown; label?: unknown; url?: unknown } | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return Response.json({ error: "业务关联必须是有效的 JSON 对象" }, { status: 400 });
    const { taskId } = await context.params; return Response.json({ item: await createWorkflowTaskLink(taskId, payload, principal.email, getSalesDatabase()) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "保存业务关联失败"); }
}
export async function DELETE(request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项业务关联"); const { taskId } = await context.params; const id = new URL(request.url).searchParams.get("id");
    const deleted = await deleteWorkflowTaskLink(taskId, id, principal.email, getSalesDatabase()); if (!deleted) return Response.json({ error: "业务关联不存在" }, { status: 404 });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "删除业务关联失败"); }
}
