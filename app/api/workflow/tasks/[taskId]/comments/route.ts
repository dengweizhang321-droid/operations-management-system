import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getSalesDatabase } from "@/lib/sales/database";
import { createWorkflowTaskComment, listWorkflowTaskComments } from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

type Context = { params: Promise<{ taskId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项评论");
    const { taskId } = await context.params;
    return Response.json({ items: await listWorkflowTaskComments(taskId, getSalesDatabase()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "读取评论失败"); }
}
export async function POST(request: Request, context: Context) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项评论"); const payload = await request.json().catch(() => null) as { content?: unknown } | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return Response.json({ error: "评论内容必须是有效的 JSON 对象" }, { status: 400 });
    const { taskId } = await context.params;
    return Response.json({ item: await createWorkflowTaskComment(taskId, payload.content, principal.email, getSalesDatabase()) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "保存评论失败"); }
}
