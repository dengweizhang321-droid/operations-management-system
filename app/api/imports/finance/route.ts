import {
  ensureFinanceSchema,
  getFinanceDatabase,
  listFinanceImportBatches,
} from "@/lib/finance/database";
import { importFinanceReportBytes } from "@/lib/finance/import-service";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";
import { recordRejectedImportBytes } from "@/lib/imports/content-fingerprint";

const MAX_FINANCE_FILE_BYTES = 8 * 1024 * 1024;

function errorResponse(status: number, message: string) {
  return Response.json({ ok: false, status: "rejected", message }, { status });
}

export async function GET(request: Request) {
  try {
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const items = await listFinanceImportBatches(db, Number.isFinite(requestedLimit) ? requestedLimit : 20);
    return Response.json({ items });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取财报导入历史失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const contentType = request.headers.get("content-type") ?? "";
    const isMultipart = contentType.toLowerCase().startsWith("multipart/form-data");
    const isBinary = contentType.toLowerCase().startsWith("application/octet-stream");
    if (!isMultipart && !isBinary) return errorResponse(415, "请上传 .xls 或 .xlsx 财报文件");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FINANCE_FILE_BYTES + 512 * 1024) return errorResponse(413, "月度财报文件不能超过 8MB");
    let fileName = "";
    let bytes: Uint8Array;
    if (isBinary) {
      const encodedName = request.headers.get("x-file-name") ?? "";
      try {
        fileName = decodeURIComponent(encodedName);
      } catch {
        return errorResponse(400, "财报文件名编码无效");
      }
      bytes = new Uint8Array(await request.arrayBuffer());
    } else {
      const formData = await request.formData().catch(() => null);
      const entry = formData?.get("file");
      if (!(entry instanceof File)) return errorResponse(400, "缺少名为 file 的财报文件");
      fileName = entry.name;
      bytes = new Uint8Array(await entry.arrayBuffer());
    }
    if (bytes.byteLength > MAX_FINANCE_FILE_BYTES) return errorResponse(413, "月度财报文件不能超过 8MB");
    const rejectUploadedFile = async (status: number, code: string, message: string) => {
      await recordRejectedImportBytes(getFinanceDatabase(), {
        domain: "finance",
        bytes,
        scopeHint: { source: "monthly-finance-report" },
        errorCode: code,
        issues: [{ code, message }],
        metadata: { fileName, fileSizeBytes: bytes.byteLength, actor: principal.email },
      });
      return errorResponse(status, message);
    };
    if (!/\.xlsx?$/i.test(fileName)) return rejectUploadedFile(400, "INVALID_FILE_EXTENSION", "仅支持 .xls 或 .xlsx 月度财报");
    if (bytes.byteLength === 0) return rejectUploadedFile(400, "EMPTY_UPLOAD", "上传文件为空");

    const payload = await importFinanceReportBytes({
      bytes,
      fileName,
      fileSizeBytes: bytes.byteLength,
    });
    return Response.json(payload, {
      status: payload.ok ? (payload.status === "imported" ? 201 : 200) : 422,
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({
      ok: false,
      status: "rejected",
      message: error instanceof Error ? error.message : "月度财报导入失败",
    }, { status: 500 });
  }
}
