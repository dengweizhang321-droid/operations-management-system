import {
  INVENTORY_UPLOAD_CHUNK_BYTES,
  MAX_CHUNKED_INVENTORY_FILE_BYTES,
  assembleInventoryUpload,
  beginInventoryUpload,
  claimInventoryUpload,
  finishInventoryUpload,
  receiveInventoryUploadChunk,
  releaseInventoryUpload,
} from "@/lib/inventory/chunked-upload";
import { importInventoryStockBytes } from "@/lib/inventory/import-service";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { importExecutionHttpStatus, safeApiErrorResponse, type ImportExecutionLike } from "@/lib/http/api-error";
import { syncLatestInventoryProjection } from "@/lib/products/inventory-projection-sync";

function reject(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

function headerNumber(request: Request, name: string) {
  const value = Number(request.headers.get(name));
  return Number.isSafeInteger(value) ? value : NaN;
}

function snapshotDateFromBody(body: Record<string, unknown>) {
  const value = typeof body.snapshotDate === "string" ? body.snapshotDate.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "库存数据", "导入");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return reject(400, "请求内容无效");
    if (body.action === "init") {
      const snapshotDate = snapshotDateFromBody(body);
      if (!snapshotDate) return reject(400, "分仓库存分片上传必须绑定有效快照日期");
      const clientFingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
      const upload = await beginInventoryUpload({
        fileName: typeof body.fileName === "string" ? body.fileName : "",
        fileSizeBytes: Number(body.fileSizeBytes),
        chunkCount: Number(body.chunkCount),
        fingerprint: `inventory:${snapshotDate}:${clientFingerprint}`,
      });
      return Response.json({
        ok: true,
        status: "ready",
        upload,
        limits: { chunkSizeBytes: INVENTORY_UPLOAD_CHUNK_BYTES, maxFileSizeBytes: MAX_CHUNKED_INVENTORY_FILE_BYTES },
      }, { headers: { "cache-control": "no-store" } });
    }

    if (body.action === "complete") {
      const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
      const snapshotDate = snapshotDateFromBody(body);
      if (!uploadId || !snapshotDate) return reject(400, "缺少上传会话标识或有效快照日期");
      const claim = await claimInventoryUpload(uploadId);
      if (!claim.session.fingerprint.startsWith(`inventory:${snapshotDate}:`)) {
        if (claim.kind === "claimed") await releaseInventoryUpload(uploadId);
        return reject(409, "上传会话绑定的库存快照日期与本次完成请求不一致");
      }
      if (claim.kind === "completed") {
        const projection = await syncLatestInventoryProjection(principal, { signal: request.signal });
        const completed = claim.result && typeof claim.result === "object" && !Array.isArray(claim.result)
          ? { ...claim.result, inventoryProjection: projection }
          : claim.result;
        return Response.json(completed, { status: importExecutionHttpStatus(completed as ImportExecutionLike), headers: { "cache-control": "no-store" } });
      }
      try {
        const assembled = await assembleInventoryUpload(uploadId);
        const imported = await importInventoryStockBytes({
          bytes: assembled.bytes,
          fileName: assembled.session.fileName,
          fileSizeBytes: assembled.session.fileSizeBytes,
          snapshotDateOverride: snapshotDate,
        });
        const result = imported.ok
          ? { ...imported, inventoryProjection: await syncLatestInventoryProjection(principal, { signal: request.signal }) }
          : imported;
        await finishInventoryUpload(uploadId, assembled.objectKeys, result);
        return Response.json(result, { status: importExecutionHttpStatus(result), headers: { "cache-control": "no-store" } });
      } catch (error) {
        await releaseInventoryUpload(uploadId);
        throw error;
      }
    }
    return reject(400, "未知的分片上传操作");
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "库存分片上传初始化或合并失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "库存数据", "导入");
    const uploadId = request.headers.get("x-upload-id") ?? "";
    const chunkIndex = headerNumber(request, "x-chunk-index");
    if (!uploadId || !Number.isSafeInteger(chunkIndex)) return reject(400, "缺少有效的分片上传标识");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > INVENTORY_UPLOAD_CHUNK_BYTES) return reject(413, "单个分片不能超过 1MB");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return reject(400, "上传分片为空");
    const upload = await receiveInventoryUploadChunk({ uploadId, chunkIndex, bytes });
    return Response.json({ ok: true, status: "uploading", upload }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "库存分片上传失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}
