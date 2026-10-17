import { requireAppPrincipal, requireUnrestrictedDataScope, authorizationErrorResponse } from "@/lib/auth/authorization";
import { createDjangoInventoryService, INVENTORY_TMALL_WAREHOUSE_PATH } from "@/lib/django/inventory-service";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";
import { parseTmallWarehouseWorkbook } from "@/lib/inventory/tmall-warehouse-workbook";
import { TMALL_WAREHOUSE_MAX_FILE_BYTES } from "@/lib/inventory/tmall-warehouse-contract";

const queryKeys = new Set(["operation", "owner", "warehouse", "q", "page", "pageSize", "batchId"]);
function fail(message: string): never { throw new PublicApiError(400, "invalid_request", message); }
async function boundedBody(request: Request) {
  const maximum = TMALL_WAREHOUSE_MAX_FILE_BYTES + 1024 * 1024;
  if (Number(request.headers.get("content-length")) > maximum) throw new PublicApiError(413, "payload_too_large", "请求超过21MiB");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) { await reader.cancel(); throw new PublicApiError(413, "payload_too_large", "请求超过21MiB"); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
async function handle(request: Request) {
  try {
    const method = request.method as "GET" | "POST";
    const principal = await requireAppPrincipal(method === "GET" ? ["viewer", "analyst", "operator", "admin"] : ["admin"]);
    requireUnrestrictedDataScope(principal, "天猫入仓监控");
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !queryKeys.has(key) || params.getAll(key).length > 1)) fail("查询字段未知或重复");
    if (method === "GET" && !["options", "monitor", "batches"].includes(params.get("operation") ?? "")) fail("请选择有效的天猫库存操作");
    if (method === "POST" && params.size) fail("导入请求不接受查询参数");
    let payload: Record<string, unknown> | undefined;
    if (method === "POST") {
      const bytes = await boundedBody(request), contentType = request.headers.get("content-type") ?? "";
      if (contentType.startsWith("multipart/form-data;")) {
        const form = await new Request(request.url, { method, headers: { "content-type": contentType }, body: bytes }).formData();
        if ([...form.keys()].some(key => !["file", "metadata"].includes(key)) || form.getAll("file").length !== 1 || form.getAll("metadata").length !== 1) fail("导入表单字段无效或重复");
        const file = form.get("file"), metadata = form.get("metadata");
        if (!(file instanceof File) || typeof metadata !== "string" || !/\.xlsx$/i.test(file.name) || file.size > TMALL_WAREHOUSE_MAX_FILE_BYTES) fail("请选择不超过20MiB的原始XLSX文件");
        try { payload = JSON.parse(metadata); } catch { fail("导入范围不是有效JSON"); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => !["owner", "snapshotDate", "collectedAt", "expectedScopeRevision"].includes(key))) fail("导入范围字段无效");
        const sourceBytes = await file.arrayBuffer();
        let parsed; try { parsed = parseTmallWarehouseWorkbook(sourceBytes); } catch (error) { fail(error instanceof Error ? error.message : "来源工作簿解析失败"); }
        if (parsed.sourceDate && parsed.sourceDate !== payload.snapshotDate) fail(`工作簿来源日期为${parsed.sourceDate}，与所选快照日期不一致`);
        if (!parsed.sourceDate && !payload.collectedAt) fail("实时导出没有日期列，须提供实际采集时刻，不能补填历史日期");
        const rawFileHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", sourceBytes))].map(value => value.toString(16).padStart(2, "0")).join("");
        payload = { ...payload, sourceDate: parsed.sourceDate ?? null, fileName: file.name, rawFileHash, rows: parsed.rows };
      } else {
        if (!contentType.startsWith("application/json")) throw new PublicApiError(415, "unsupported_media_type", "请求须为文件表单或JSON");
        try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("JSON请求格式无效"); }
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("请求体须为对象");
      if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 20 * 1024 * 1024) throw new PublicApiError(413, "payload_too_large", "规范化数据超过20MiB");
    }
    const result = await createDjangoInventoryService().requestJson<Record<string, unknown>>(principal, { method, path: INVENTORY_TMALL_WAREHOUSE_PATH, service: method === "GET" ? "reader" : "writer", rawQuery: params.toString(), payload }, { signal: request.signal });
    return Response.json(result.data, { status: result.status, headers: { "cache-control": "no-store", "x-inventory-data-revision": result.revision } });
  } catch (error) { return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "天猫入仓监控请求失败", { headers: { "cache-control": "no-store" } }); }
}
export { handle as GET, handle as POST };
