import { requireAppPrincipal, requireUnrestrictedDataScope, authorizationErrorResponse } from "@/lib/auth/authorization";
import { createDjangoInventoryService, INVENTORY_JD_LOGISTICS_PATH } from "@/lib/django/inventory-service";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";
import { jdInventoryHealthStates, jdLogisticsSources, type JdLogisticsSource } from "@/lib/inventory/jd-logistics-contract";
import { parseJdLogisticsWorkbook, JD_LOGISTICS_MAX_FILE_BYTES } from "@/lib/inventory/jd-logistics-workbook";

const MAX_BYTES = 48 * 1024 * 1024;
const readOperations = new Set(["options", "overview", "flows", "transfers", "mappings", "products", "batches", "settings", "inventory_monitor", "notifications"]);
const queryKeys = new Set(["operation", "departmentId", "businessUnitCode", "warehouseCode", "warehouseKey", "goodsCodeKind", "startDate", "endDate", "q", "page", "pageSize", "sourceKind", "batchId", "layout", "salesWindow", "healthState", "deliveryId"]);
const healthStates = new Set<string>(["all", ...jdInventoryHealthStates]);
const fail = (message: string): never => { throw new PublicApiError(400, "invalid_request", message); };
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new PublicApiError(413, "payload_too_large", "导入请求超过48MiB上限");
  const reader = request.body?.getReader();
  if (!reader) return fail("请求体不能为空");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new PublicApiError(413, "payload_too_large", "导入请求超过48MiB上限"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
async function handle(request: Request) {
  try {
    const method = request.method as "GET" | "POST" | "PATCH";
    const principal = await requireAppPrincipal(method === "GET" ? ["viewer", "analyst", "operator", "admin"] : method === "POST" ? ["admin"] : ["operator", "admin"]);
    requireUnrestrictedDataScope(principal, "京东物流导入与POP核对");
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !queryKeys.has(key) || params.getAll(key).length > 1)) fail("京东物流查询参数未知或重复");
    if (params.has("healthState") && !healthStates.has(params.get("healthState")!)) fail("库存健康筛选无效");
    if (method === "GET" && !readOperations.has(params.get("operation") ?? "")) fail("请选择有效的京东物流查询操作");
    if (method === "GET" && params.get("operation") === "notifications" && principal.role !== "admin") throw new PublicApiError(403, "access_denied", "仅管理员可查询物流提醒投递结果");
    let payload: Record<string, unknown> | undefined;
    if (method !== "GET") {
      const bytes = await boundedBody(request);
      const contentType = request.headers.get("content-type") ?? "";
      if (method === "POST" && contentType.startsWith("multipart/form-data;")) {
        const form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
        if ([...form.keys()].some(key => !["file", "metadata"].includes(key)) || form.getAll("file").length !== 1 || form.getAll("metadata").length !== 1) fail("导入表单字段无效或重复");
        const file = form.get("file"), metadata = form.get("metadata");
        if (!(file instanceof File) || typeof metadata !== "string") return fail("请选择原始XLSX或流水/店铺商品CSV并提供导入范围");
        if (!/\.(xlsx|csv)$/i.test(file.name) || file.size > JD_LOGISTICS_MAX_FILE_BYTES) fail("仅支持不超过40MiB的XLSX或受控流水/店铺商品CSV文件");
        try { payload = JSON.parse(metadata); } catch { return fail("导入范围格式无效"); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.operation !== "import" || payload.origin !== "manual") return fail("手工导入元数据无效");
        const sourceKind = payload.sourceKind as JdLogisticsSource;
        if (!jdLogisticsSources.includes(sourceKind) || typeof payload.businessUnitCode !== "string") return fail("来源或事业部无效");
        if (/\.csv$/i.test(file.name) && !["flow", "shop_products"].includes(sourceKind)) return fail("CSV仅支持已核验的流水和店铺商品来源");
        const fileBytes = await file.arrayBuffer();
        let rows;
        try { rows = parseJdLogisticsWorkbook(fileBytes, sourceKind, payload.businessUnitCode, { collectedAt: typeof payload.collectedAt === "string" ? payload.collectedAt : undefined, allowDeclaredBusinessUnit: payload.complete === true }); } catch (error) { return fail(error instanceof Error ? error.message : "工作簿解析失败"); }
        const rawFileHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes))].map(value => value.toString(16).padStart(2, "0")).join("");
        payload = { ...payload, rows, rawFileHash, fileName: file.name };
      } else {
        if (!contentType.startsWith("application/json")) throw new PublicApiError(415, "unsupported_media_type", "请求须使用JSON或文件表单");
        try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail("JSON请求格式无效"); }
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail("请求体须为JSON对象");
      if (method === "POST" && !["import", "notify"].includes(String(payload.operation)) || method === "PATCH" && !["mapping", "manual", "settings"].includes(String(payload.operation))) fail("京东物流写入操作无效");
      if (method === "PATCH" && payload.operation === "settings" && principal.role !== "admin") throw new PublicApiError(403, "access_denied", "仅管理员可维护物流账号设置");
      if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 24 * 1024 * 1024) throw new PublicApiError(413, "payload_too_large", "标准化后的物流数据超过24MiB上限，请缩小完整来源范围后导入");
    }
    const result = await createDjangoInventoryService().requestJson<Record<string, unknown>>(principal, {
      method, path: INVENTORY_JD_LOGISTICS_PATH, service: method === "GET" ? "reader" : "writer", rawQuery: params.toString(), payload,
    }, { signal: request.signal });
    return Response.json(result.data, { status: result.status, headers: { "cache-control": "no-store", "x-inventory-data-revision": result.revision } });
  } catch (error) {
    return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "京东物流请求失败", { headers: { "cache-control": "no-store" } });
  }
}
export { handle as GET, handle as POST, handle as PATCH };
