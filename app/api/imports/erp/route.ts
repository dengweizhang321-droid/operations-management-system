import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";
import {
  ensureErpReferenceSchema,
  findErpReferenceBatch,
  getErpReferenceDatabase,
  listErpReferenceBatches,
} from "@/lib/erp-reference/database";
import { importErpReferenceBytes } from "@/lib/erp-reference/import-service";
import { isErpReferenceSourceKey } from "@/lib/imports/erp-reference";

const MAX_DIRECT_FILE_BYTES = 2 * 1024 * 1024;

function reject(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...extra }, { status });
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const requestedSource = params.get("source");
    if (requestedSource && !isErpReferenceSourceKey(requestedSource)) {
      return reject(400, "source 必须为 products、inventory_age 或 combos");
    }
    const source = requestedSource && isErpReferenceSourceKey(requestedSource) ? requestedSource : undefined;
    const batchId = params.get("batchId")?.trim() ?? "";
    if (batchId && !source) return reject(400, "按精确批次查询时必须提供 source");
    const batchHash = source && batchId.startsWith(`${source}:`) ? batchId.slice(source.length + 1) : "";
    if (batchId && (!/^[a-f0-9]{64}$/i.test(batchHash))) return reject(400, "batchId 与 source 不匹配或格式无效");
    const requestedLimit = Number(params.get("limit") ?? 50);
    const db = getErpReferenceDatabase();
    await ensureErpReferenceSchema(db);
    const exactBatch = source && batchHash ? await findErpReferenceBatch(db, source, batchHash) : null;
    const items = batchId
      ? (exactBatch?.id === batchId ? [exactBatch] : [])
      : await listErpReferenceBatches(
        db,
        source,
        Number.isFinite(requestedLimit) ? requestedLimit : 50,
      );
    return Response.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取 ERP 导入历史失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return reject(415, "请使用 multipart/form-data 上传 .xlsx 文件");
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_DIRECT_FILE_BYTES + 512 * 1024) {
      return reject(413, "超过 2MB 的报表请使用分片上传接口");
    }

    const formData = await request.formData().catch(() => null);
    const entry = formData?.get("file");
    const source = formData?.get("source");
    const snapshotDate = typeof formData?.get("snapshotDate") === "string"
      ? String(formData?.get("snapshotDate"))
      : undefined;
    if (!isErpReferenceSourceKey(source)) return reject(400, "缺少有效的数据来源");
    if (!(entry instanceof File)) return reject(400, "缺少名为 file 的 Excel 文件");
    if (!entry.name.toLowerCase().endsWith(".xlsx")) return reject(400, "仅支持 .xlsx 格式的吉客云报表");
    if (entry.size === 0) return reject(400, "上传文件为空");
    if (entry.size > MAX_DIRECT_FILE_BYTES) return reject(413, "超过 2MB 的报表请使用分片上传接口");

    const payload = await importErpReferenceBytes({
      source,
      bytes: new Uint8Array(await entry.arrayBuffer()),
      fileName: entry.name,
      fileSizeBytes: entry.size,
      snapshotDate,
    });
    return Response.json(payload, { status: payload.ok ? (payload.status === "imported" ? 201 : 200) : 422 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "ERP 数据导入失败";
    return reject(500, message);
  }
}
