import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { getMarketDatabase } from "@/lib/market/database";
import { executeMarketDownloadTask } from "@/lib/market/download-executor";
import { cacheMarketImages } from "@/lib/market/image-cache";

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const form = await request.formData();
    const taskId = String(form.get("taskId") ?? "").trim();
    const jdTaskId = String(form.get("jdTaskId") ?? "").trim().slice(0, 160);
    const file = form.get("file");
    if (!taskId || !(file instanceof File)) return Response.json({ error: "taskId 和下载文件必填" }, { status: 400 });
    if (!file.size || file.size > 25 * 1024 * 1024) return Response.json({ error: "文件大小必须在 1 byte 到 25 MB 之间" }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const db = getMarketDatabase();
    const result = await executeMarketDownloadTask(db, { taskId }, principal, {
      download: async () => ({ bytes, fileName: file.name.slice(0, 240), jdTaskId }),
      cacheImages: async ({ batchId }) => {
        const cached = await cacheMarketImages({ db, batchId, limit: 24 });
        return { cached: cached.cachedThisRun, queued: cached.pending };
      },
    });
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "榜单文件校验导入失败" }, { status: 400 });
  }
}
