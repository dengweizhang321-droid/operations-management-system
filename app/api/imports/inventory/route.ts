import { importInventoryStockBytes } from "@/lib/inventory/import-service";
import {
  ensureInventorySchema,
  findInventoryImportBatchByHash,
  getInventoryDatabase,
  listInventoryImportBatches,
} from "@/lib/inventory/database";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";

const MAX_DIRECT_INVENTORY_FILE_BYTES = 1024 * 1024;

function errorResponse(status: number, message: string, details: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...details }, { status });
}

export async function GET(request: Request) {
  try {
    const db = getInventoryDatabase();
    await ensureInventorySchema(db);
    const params = new URL(request.url).searchParams;
    const batchId = params.get("batchId")?.trim() ?? "";
    if (batchId && !/^[a-f0-9]{64}$/i.test(batchId)) return errorResponse(400, "batchId 格式无效");
    const requestedLimit = Number(params.get("limit") ?? 20);
    const exactBatch = batchId ? await findInventoryImportBatchByHash(db, batchId) : null;
    const items = batchId
      ? (exactBatch?.id === batchId ? [exactBatch] : [])
      : await listInventoryImportBatches(db, Number.isFinite(requestedLimit) ? requestedLimit : 20);
    return Response.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取库存同步历史失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return errorResponse(415, "请使用 multipart/form-data 上传 .xlsx 文件");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_DIRECT_INVENTORY_FILE_BYTES + 256 * 1024) {
      return errorResponse(413, "超过 1MB 的库存报表请使用分片上传接口");
    }

    const formData = await request.formData().catch(() => null);
    const entry = formData?.get("file");
    const snapshotDate = typeof formData?.get("snapshotDate") === "string" ? String(formData?.get("snapshotDate")) : undefined;
    if (!(entry instanceof File)) return errorResponse(400, "缺少名为 file 的 Excel 文件");
    if (!entry.name.toLowerCase().endsWith(".xlsx")) return errorResponse(400, "仅支持 .xlsx 格式的分仓库存查询报表");
    if (entry.size === 0) return errorResponse(400, "上传文件为空");
    if (entry.size > MAX_DIRECT_INVENTORY_FILE_BYTES) return errorResponse(413, "超过 1MB 的库存报表请使用分片上传接口");

    const payload = await importInventoryStockBytes({
      bytes: new Uint8Array(await entry.arrayBuffer()),
      fileName: entry.name,
      fileSizeBytes: entry.size,
      snapshotDateOverride: snapshotDate,
    });
    return Response.json(payload, {
      status: payload.ok ? (payload.status === "imported" ? 201 : 200) : 422,
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "库存数据同步失败";
    return Response.json({ ok: false, status: "rejected", message }, { status: 500 });
  }
}
