import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { getD1Database } from "@/lib/database/d1";
import { getWorkflowTaskAttachmentDownload } from "@/lib/workflow/collaboration";
import { workflowErrorResponse } from "@/lib/workflow/errors";

function asciiFileName(name: string) { return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "attachment"; }
export async function GET(_request: Request, context: { params: Promise<{ taskId: string; attachmentId: string }> }) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]); requireUnrestrictedDataScope(principal, "工作事项附件");
    const { taskId, attachmentId } = await context.params; const result = await getWorkflowTaskAttachmentDownload(taskId, attachmentId, getD1Database());
    if (!result) return Response.json({ error: "附件不存在" }, { status: 404, headers: { "cache-control": "private, no-store" } });
    const encoded = encodeURIComponent(result.attachment.fileName);
    const body = new Uint8Array(result.bytes.byteLength); body.set(result.bytes);
    return new Response(body.buffer, { headers: {
      "cache-control": "private, no-store", "content-type": result.attachment.mimeType, "content-length": String(body.byteLength),
      "content-disposition": `attachment; filename="${asciiFileName(result.attachment.fileName)}"; filename*=UTF-8''${encoded}`, "x-content-type-options": "nosniff",
    } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return workflowErrorResponse(error, "下载附件失败"); }
}
