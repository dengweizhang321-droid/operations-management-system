import {
  MAX_CHUNKED_SALES_FILE_BYTES,
  SALES_UPLOAD_CHUNK_BYTES,
  assembleSalesUpload,
  beginSalesUpload,
  claimSalesUpload,
  finishSalesUpload,
  receiveSalesUploadChunk,
} from "@/lib/sales/chunked-upload";
import { importSalesLedgerBytes, validateSalesImportChannels, validateSalesImportDateRange } from "@/lib/sales/import-service";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { importExecutionHttpStatus, safeApiErrorResponse } from "@/lib/http/api-error";

function reject(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

function headerNumber(request: Request, name: string) {
  const value = Number(request.headers.get(name));
  return Number.isSafeInteger(value) ? value : NaN;
}

function uploadScopePrefix(startDate: string, endDate: string, channels: readonly string[] | null) {
  return `sales:${startDate}:${endDate}:${JSON.stringify(channels)}:`;
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "销售数据", "导入");
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
      const dateRange = validateSalesImportDateRange(expectedStartDate, expectedEndDate);
      if (!dateRange.ok) return reject(422, "销售导入必须提供有效的权威起止日期", {
        errors: [{ code: dateRange.code, message: dateRange.message }],
        errorCount: 1,
      });
      const channelScope = validateSalesImportChannels(body.expectedChannels);
      if (!channelScope.ok) return reject(422, "销售导入必须提供有效的权威渠道范围", {
        errors: [{ code: channelScope.code, message: channelScope.message }],
        errorCount: 1,
      });
      const upload = await beginSalesUpload({ fileName, fileSizeBytes, chunkCount, fingerprint: `${uploadScopePrefix(expectedStartDate, expectedEndDate, channelScope.channels)}${fingerprint}` });
      return Response.json({
        ok: true,
        status: "ready",
        upload,
        limits: { chunkSizeBytes: SALES_UPLOAD_CHUNK_BYTES, maxFileSizeBytes: MAX_CHUNKED_SALES_FILE_BYTES },
      }, { headers: { "cache-control": "no-store" } });
    }

    if (action === "complete") {
      const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
      const expectedStartDate = typeof body.expectedStartDate === "string" ? body.expectedStartDate : "";
      const expectedEndDate = typeof body.expectedEndDate === "string" ? body.expectedEndDate : "";
      if (!uploadId) return reject(400, "缺少上传会话标识");
      const dateRange = validateSalesImportDateRange(expectedStartDate, expectedEndDate);
      if (!dateRange.ok) return reject(422, "销售导入必须提供有效的权威起止日期", {
        errors: [{ code: dateRange.code, message: dateRange.message }],
        errorCount: 1,
      });
      const channelScope = validateSalesImportChannels(body.expectedChannels);
      if (!channelScope.ok) return reject(422, "销售导入必须提供有效的权威渠道范围", {
        errors: [{ code: channelScope.code, message: channelScope.message }],
        errorCount: 1,
      });
      const claim = await claimSalesUpload(uploadId);
      if (!claim.session.fingerprint.startsWith(uploadScopePrefix(expectedStartDate, expectedEndDate, channelScope.channels))) {
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
          expectedChannels: channelScope.channels,
        });
        await finishSalesUpload(uploadId, assembled.objectKeys, result.ok);
        return Response.json(result, { status: importExecutionHttpStatus(result), headers: { "cache-control": "no-store" } });
      } catch (error) {
        await finishSalesUpload(uploadId, [], false).catch(() => undefined);
        throw error;
      }
    }

    return reject(400, "未知的分片上传操作");
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "销售分片上传初始化或合并失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "销售数据", "导入");
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
    return safeApiErrorResponse(error, "销售分片上传失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}

// hot-reload trigger 2026-08-27: sales-ledger 费用分摊可选化
