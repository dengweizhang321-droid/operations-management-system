import {
  XLSX_CONTENT_TYPE,
  importSalesLedgerBytes,
} from "@/lib/sales/import-service";
import {
  ensureSalesSchema,
  getSalesDatabase,
  listSalesImportBatches,
} from "@/lib/sales/database";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";

const MAX_DIRECT_FILE_BYTES = 2 * 1024 * 1024;

function errorResponse(status: number, message: string, details: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...details }, { status });
}

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const db = getSalesDatabase();
    await ensureSalesSchema(db);
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const items = await listSalesImportBatches(db, Number.isFinite(requestedLimit) ? requestedLimit : 20);
    return Response.json({ items });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "读取销售导入历史失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Small reports keep the original single-request import path. Larger files use /chunks. */
export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return errorResponse(415, "请使用 multipart/form-data 上传 .xlsx 文件");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_DIRECT_FILE_BYTES + 1024 * 1024) {
      return errorResponse(413, "超过 2MB 的报表请使用分片上传接口");
    }

    const formData = await request.formData().catch(() => null);
    const entry = formData?.get("file");
    if (!(entry instanceof File)) return errorResponse(400, "缺少名为 file 的 Excel 文件");
    if (!entry.name.toLowerCase().endsWith(".xlsx")) return errorResponse(400, "仅支持 .xlsx 格式的销售单明细账");
    if (entry.size === 0) return errorResponse(400, "上传文件为空");
    if (entry.size > MAX_DIRECT_FILE_BYTES) return errorResponse(413, "超过 2MB 的报表请使用分片上传接口");

    const payload = await importSalesLedgerBytes({
      bytes: new Uint8Array(await entry.arrayBuffer()),
      fileName: entry.name,
      fileSizeBytes: entry.size,
    });
    return Response.json(payload, {
      status: payload.ok ? (payload.status === "imported" ? 201 : 200) : 422,
      headers: { "x-import-content-type": XLSX_CONTENT_TYPE },
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "销售数据导入失败";
    return Response.json({ ok: false, status: "rejected", message }, { status: 500 });
  }
}
