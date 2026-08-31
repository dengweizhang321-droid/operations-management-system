import {
  MAX_CHUNKED_SALES_FILE_BYTES,
  SALES_UPLOAD_CHUNK_BYTES,
  assembleSalesUpload,
  beginSalesUpload,
  claimSalesUpload,
  finishSalesUpload,
  receiveSalesUploadChunk,
} from "@/lib/sales/chunked-upload";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { importExecutionHttpStatus, safeApiErrorResponse } from "@/lib/http/api-error";
import { importProductShippingRateBytes } from "@/lib/products/shipping-rate-import-service";

const UPLOAD_SCOPE_PREFIX = "sku-shipping-rates:";

function reject(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json(
    { ok: false, status: "rejected", message, ...extra },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function headerNumber(request: Request, name: string) {
  const value = Number(request.headers.get(name));
  return Number.isSafeInteger(value) ? value : NaN;
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "SKU 快递费率", "导入");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return reject(400, "请求内容无效");
    if (body.action === "init") {
      const clientFingerprint = typeof body.fingerprint === "string" ? body.fingerprint.slice(0, 220) : "";
      const upload = await beginSalesUpload({
        fileName: typeof body.fileName === "string" ? body.fileName : "",
        fileSizeBytes: Number(body.fileSizeBytes),
        chunkCount: Number(body.chunkCount),
        fingerprint: `${UPLOAD_SCOPE_PREFIX}${clientFingerprint}`,
      });
      return Response.json({
        ok: true,
        status: "ready",
        upload,
        limits: {
          chunkSizeBytes: SALES_UPLOAD_CHUNK_BYTES,
          maxFileSizeBytes: MAX_CHUNKED_SALES_FILE_BYTES,
        },
      }, { headers: { "cache-control": "no-store" } });
    }
    if (body.action === "complete") {
      const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
      if (!uploadId) return reject(400, "缺少上传会话标识");
      const claim = await claimSalesUpload(uploadId);
      if (!claim.session.fingerprint.startsWith(UPLOAD_SCOPE_PREFIX)) {
        await finishSalesUpload(uploadId, [], false).catch(() => undefined);
        return reject(409, "上传会话未绑定 SKU 快递费率数据集");
      }
      try {
        const assembled = await assembleSalesUpload(uploadId);
        const result = await importProductShippingRateBytes({
          bytes: assembled.bytes,
          fileName: assembled.session.fileName,
          fileSizeBytes: assembled.session.fileSizeBytes,
          actor: principal.email,
        });
        await finishSalesUpload(uploadId, assembled.objectKeys, result.ok);
        return Response.json(result, {
          status: importExecutionHttpStatus(result),
          headers: { "cache-control": "no-store" },
        });
      } catch (error) {
        await finishSalesUpload(uploadId, [], false).catch(() => undefined);
        throw error;
      }
    }
    return reject(400, "未知的分片上传操作");
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "SKU 快递费率分片上传失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "SKU 快递费率", "导入");
    const uploadId = request.headers.get("x-upload-id") ?? "";
    const chunkIndex = headerNumber(request, "x-chunk-index");
    if (!uploadId || !Number.isSafeInteger(chunkIndex)) return reject(400, "缺少有效的分片上传标识");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > SALES_UPLOAD_CHUNK_BYTES) return reject(413, "单个分片不能超过 2MB");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return reject(400, "上传分片为空");
    const upload = await receiveSalesUploadChunk({ uploadId, chunkIndex, bytes });
    return Response.json({ ok: true, status: "uploading", upload }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "SKU 快递费率分片上传失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}
