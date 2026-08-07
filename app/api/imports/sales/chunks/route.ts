import {
  MAX_CHUNKED_SALES_FILE_BYTES,
  SALES_UPLOAD_CHUNK_BYTES,
  assembleSalesUpload,
  beginSalesUpload,
  claimSalesUpload,
  finishSalesUpload,
  receiveSalesUploadChunk,
} from "@/lib/sales/chunked-upload";
import { importSalesLedgerBytes } from "@/lib/sales/import-service";
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
    const action = body?.action;
    if (action === "init") {
      const fileName = typeof body.fileName === "string" ? body.fileName : "";
      const fileSizeBytes = Number(body.fileSizeBytes);
      const chunkCount = Number(body.chunkCount);
      const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
      const expectedStartDate = typeof body.expectedStartDate === "string" ? body.expectedStartDate : "";
      const expectedEndDate = typeof body.expectedEndDate === "string" ? body.expectedEndDate : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedEndDate)
        || expectedStartDate > expectedEndDate) return reject(422, "销售导入必须提供有效的权威起止日期");
      const upload = await beginSalesUpload({ fileName, fileSizeBytes, chunkCount, fingerprint: `sales:${expectedStartDate}:${expectedEndDate}:${fingerprint}` });
      return Response.json({
        ok: true,
        status: "ready",
        upload,
        limits: { chunkSizeBytes: SALES_UPLOAD_CHUNK_BYTES, maxFileSizeBytes: MAX_CHUNKED_SALES_FILE_BYTES },
      });
    }

    if (action === "complete") {
      const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
      const expectedStartDate = typeof body.expectedStartDate === "string" ? body.expectedStartDate : "";
      const expectedEndDate = typeof body.expectedEndDate === "string" ? body.expectedEndDate : "";
      if (!uploadId) return reject(400, "缺少上传会话标识");
      const claim = await claimSalesUpload(uploadId);
      if (!claim.session.fingerprint.startsWith(`sales:${expectedStartDate}:${expectedEndDate}:`)) {
        await finishSalesUpload(uploadId, [], false).catch(() => undefined);
        return reject(409, "上传会话与本次销售日期范围不一致");
      }
      try {
        const assembled = await assembleSalesUpload(uploadId);
        const result = await importSalesLedgerBytes({
          bytes: assembled.bytes,
          fileName: assembled.session.fileName,
          fileSizeBytes: assembled.session.fileSizeBytes,
          expectedStartDate,
          expectedEndDate,
        });
        await finishSalesUpload(uploadId, assembled.objectKeys, result.ok);
        return Response.json(result, { status: result.ok ? (result.status === "imported" ? 201 : 200) : 422 });
      } catch (error) {
        await finishSalesUpload(uploadId, [], false).catch(() => undefined);
        throw error;
      }
    }

    return reject(400, "未知的分片上传操作");
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "分片上传初始化或合并失败";
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
    if (contentLength > SALES_UPLOAD_CHUNK_BYTES) return reject(413, "单个分片不能超过 2MB");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return reject(400, "上传分片为空");
    const upload = await receiveSalesUploadChunk({ uploadId, chunkIndex, bytes });
    return Response.json({ ok: true, status: "uploading", upload });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "分片上传失败";
    return reject(422, message);
  }
}
