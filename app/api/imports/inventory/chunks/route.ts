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
} from "@/lib/auth/authorization";

function reject(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...extra }, { status });
}

function headerNumber(request: Request, name: string) {
  const value = Number(request.headers.get(name));
  return Number.isSafeInteger(value) ? value : NaN;
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return reject(400, "请求内容无效");
    if (body.action === "init") {
      const upload = await beginInventoryUpload({
        fileName: typeof body.fileName === "string" ? body.fileName : "",
        fileSizeBytes: Number(body.fileSizeBytes),
        chunkCount: Number(body.chunkCount),
        fingerprint: typeof body.fingerprint === "string" ? body.fingerprint : "",
      });
      return Response.json({
        ok: true,
        status: "ready",
        upload,
        limits: { chunkSizeBytes: INVENTORY_UPLOAD_CHUNK_BYTES, maxFileSizeBytes: MAX_CHUNKED_INVENTORY_FILE_BYTES },
      });
    }

    if (body.action === "complete") {
      const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
      if (!uploadId) return reject(400, "缺少上传会话标识");
      const claim = await claimInventoryUpload(uploadId);
      if (claim.kind === "completed") {
        const stored = claim.result as { ok?: boolean; status?: string };
        return Response.json(claim.result, { status: stored.ok ? (stored.status === "imported" ? 201 : 200) : 422 });
      }
      try {
        const assembled = await assembleInventoryUpload(uploadId);
        const result = await importInventoryStockBytes({
          bytes: assembled.bytes,
          fileName: assembled.session.fileName,
          fileSizeBytes: assembled.session.fileSizeBytes,
        });
        await finishInventoryUpload(uploadId, assembled.objectKeys, result);
        return Response.json(result, { status: result.ok ? (result.status === "imported" ? 201 : 200) : 422 });
      } catch (error) {
        await releaseInventoryUpload(uploadId);
        throw error;
      }
    }
    return reject(400, "未知的分片上传操作");
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "库存分片上传初始化或合并失败";
    return reject(500, message);
  }
}

export async function PUT(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const uploadId = request.headers.get("x-upload-id") ?? "";
    const chunkIndex = headerNumber(request, "x-chunk-index");
    if (!uploadId || !Number.isSafeInteger(chunkIndex)) return reject(400, "缺少有效的分片上传标识");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > INVENTORY_UPLOAD_CHUNK_BYTES) return reject(413, "单个分片不能超过 1MB");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return reject(400, "上传分片为空");
    const upload = await receiveInventoryUploadChunk({ uploadId, chunkIndex, bytes });
    return Response.json({ ok: true, status: "uploading", upload });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "库存分片上传失败";
    return reject(422, message);
  }
}
