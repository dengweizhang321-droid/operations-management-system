import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getD1Database } from "@/lib/database/d1";
import { createWorkflowTaskReminder, dismissWorkflowTaskReminder, listWorkflowTaskReminders } from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

type Context = { params: Promise<{ taskId: string }> };
export async function GET(_request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项提醒"); const { taskId } = await context.params;
    return Response.json({ items: await listWorkflowTaskReminders(taskId, getD1Database()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "读取提醒失败"); }
}
export async function POST(request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项提醒"); const payload = await request.json().catch(() => null) as { remindAt?: unknown; note?: unknown } | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return Response.json({ error: "提醒内容必须是有效的 JSON 对象" }, { status: 400 });
    const { taskId } = await context.params; return Response.json({ item: await createWorkflowTaskReminder(taskId, payload, principal.email, getD1Database()) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "保存提醒失败"); }
}
export async function DELETE(request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项提醒"); const { taskId } = await context.params; const id = new URL(request.url).searchParams.get("id");
    const dismissed = await dismissWorkflowTaskReminder(taskId, id, principal.email, getD1Database());
    if (!dismissed) return Response.json({ error: "待处理提醒不存在" }, { status: 404 });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "取消提醒失败"); }
}
