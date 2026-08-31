import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getD1Database } from "@/lib/database/d1";
import { createWorkflowTaskAttachment, deleteWorkflowTaskAttachment, listWorkflowTaskAttachments, MAX_WORKFLOW_ATTACHMENT_BYTES } from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

type Context = { params: Promise<{ taskId: string }> };
export async function GET(_request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项附件"); const { taskId } = await context.params;
    return Response.json({ items: await listWorkflowTaskAttachments(taskId, getD1Database()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "读取附件失败"); }
}
export async function POST(request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项附件");
    const rawContentLength = request.headers.get("content-length");
    if (rawContentLength === null) return Response.json({ error: "上传附件必须声明内容长度", code: "length_required" }, { status: 411, headers: { "cache-control": "no-store" } });
    if (!/^\d+$/.test(rawContentLength)) return Response.json({ error: "内容长度无效", code: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength > MAX_WORKFLOW_ATTACHMENT_BYTES + 64 * 1024) return Response.json({ error: "单个附件不能超过 10MB", code: "payload_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择要上传的附件", code: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
    const { taskId } = await context.params; return Response.json({ item: await createWorkflowTaskAttachment(taskId, file, principal.email, getD1Database()) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "上传附件失败"); }
}
export async function DELETE(request: Request, context: Context) {
  try { const principal = await requireAppPrincipal(["operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项附件"); const { taskId } = await context.params; const id = new URL(request.url).searchParams.get("id");
    const deleted = await deleteWorkflowTaskAttachment(taskId, id, principal.email, getD1Database()); if (!deleted) return Response.json({ error: "附件不存在" }, { status: 404 });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "删除附件失败"); }
}
