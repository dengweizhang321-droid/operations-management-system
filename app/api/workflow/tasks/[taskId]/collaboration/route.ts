import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getSalesDatabase } from "@/lib/sales/database";
import { getWorkflowTaskCollaboration } from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "工作事项协作信息");
    const { taskId } = await context.params;
    return Response.json(await getWorkflowTaskCollaboration(taskId, getSalesDatabase()), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return workflowErrorResponse(error, "读取工作事项协作信息失败");
  }
}
