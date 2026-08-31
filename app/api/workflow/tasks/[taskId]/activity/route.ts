import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getD1Database } from "@/lib/database/d1";
import { listWorkflowTaskActivity } from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项活动记录");
    const { taskId } = await context.params;
    return Response.json({ items: await listWorkflowTaskActivity(taskId, getD1Database()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "读取活动记录失败"); }
}
