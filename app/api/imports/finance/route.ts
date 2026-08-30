import {
  ensureFinanceSchema,
  getFinanceDatabase,
  listFinanceImportBatches,
} from "@/lib/finance/database";
import { importFinanceReportBytes } from "@/lib/finance/import-service";
import { prepareNormalizedFinanceImport } from "@/lib/finance/import-service";
import { observeFinanceShadow } from "@/lib/finance/backend-routing";
import {
  createDjangoFinanceService,
  FINANCE_IMPORTS_PATH,
  getFinanceBackendMode,
} from "@/lib/django/finance-service";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { importExecutionHttpStatus, parsePositiveIntegerQuery, safeApiErrorResponse } from "@/lib/http/api-error";

const MAX_FINANCE_FILE_BYTES = 8 * 1024 * 1024;

function errorResponse(status: number, message: string) {
  return Response.json({ ok: false, status: "rejected", message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "财报导入历史");
    const params = new URL(request.url).searchParams;
    const paged = params.has("page") || params.has("pageSize");
    const page = parsePositiveIntegerQuery(paged ? params.get("page") : null, 1, "page", 10_000);
    const pageSize = parsePositiveIntegerQuery(paged ? params.get("pageSize") : params.get("limit"), 20, paged ? "pageSize" : "limit", 100);
    const mode = await getFinanceBackendMode();
    if (mode === "django") {
      const result = await createDjangoFinanceService().request<Record<string, unknown>>(
        principal,
        { method: "GET", path: FINANCE_IMPORTS_PATH, query: params, service: "reader" },
        { signal: request.signal },
      );
      return Response.json(result.data, { headers: { "cache-control": "no-store" } });
    }
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const payload = await listFinanceImportBatches(db, { page, pageSize });
    if (mode === "shadow") {
      const shadowQuery = new URLSearchParams();
      if (paged) {
        shadowQuery.set("page", String(page));
        shadowQuery.set("pageSize", String(pageSize));
      } else {
        shadowQuery.set("limit", String(pageSize));
      }
      observeFinanceShadow("imports", payload, createDjangoFinanceService().request<Record<string, unknown>>(
        principal,
        { method: "GET", path: FINANCE_IMPORTS_PATH, query: shadowQuery, service: "reader" },
        { signal: request.signal },
      ).then((result) => result.data));
    }
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "读取财报导入历史失败。", { headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "财务数据", "导入");
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
    if (!/\.xlsx?$/i.test(fileName)) return errorResponse(400, "仅支持 .xls 或 .xlsx 月度财报");
    if (bytes.byteLength === 0) return errorResponse(400, "上传文件为空");
    if (bytes.byteLength > MAX_FINANCE_FILE_BYTES) return errorResponse(413, "月度财报文件不能超过 8MB");

    const input = {
      bytes,
      fileName,
      fileSizeBytes: bytes.byteLength,
    };
    const mode = await getFinanceBackendMode();
    if (mode === "django") {
      const normalized = await prepareNormalizedFinanceImport(input);
      const result = await createDjangoFinanceService().request<Record<string, unknown>>(
        principal,
        {
          method: "POST",
          path: FINANCE_IMPORTS_PATH,
          payload: normalized as unknown as Record<string, unknown>,
          service: "writer",
          acceptedErrorStatuses: [422],
        },
        { signal: request.signal },
      );
      const headers = new Headers({ "cache-control": "no-store" });
      if (result.replayed) headers.set("x-teruisi-write-replay", "1");
      return Response.json(result.data, { status: result.status, headers });
    }
    // Shadow mode deliberately keeps D1 as the sole writer. Django receives no
    // mutation until the separately attested single-write cutover.
    const payload = await importFinanceReportBytes(input);
    return Response.json(payload, {
      status: importExecutionHttpStatus(payload),
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "月度财报导入失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}
