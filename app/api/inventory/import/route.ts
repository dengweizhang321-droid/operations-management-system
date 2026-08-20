import {
  importNetshopBytes,
  readNetshopForm,
} from "@/lib/netshop/import-service";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";

const MAX_DIRECT_FILE_BYTES = 25 * 1024 * 1024;

function errorResponse(status: number, message: string, details: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...details }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "京东自营库存", "导入");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return errorResponse(415, "请使用 multipart/form-data 上传库存快照文件");
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) return errorResponse(400, "无法读取上传表单");
    const parsed = readNetshopForm(formData);
    const file = parsed.file;
    if (!(file instanceof File)) return errorResponse(400, "缺少名为 file 的文件");
    if (file.size === 0) return errorResponse(400, "上传文件为空");
    if (file.size > MAX_DIRECT_FILE_BYTES) return errorResponse(413, "文件超过 25MB，请拆分后上传");

    const source = parsed.source ?? "inv_selfop";
    if (source !== "inv_selfop") {
      return errorResponse(400, "/api/inventory/import/ 仅用于 source=inv_selfop 的京东自营库存快照");
    }

    const payload = await importNetshopBytes({
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      fileSizeBytes: file.size,
      source,
      note: parsed.note,
      snapshotDate: parsed.snapshotDate,
    });
    return Response.json(payload, { status: payload.ok ? (payload.status === "imported" ? 201 : 200) : 422, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "京东自营库存快照导入失败。", { shape: "import", headers: { "cache-control": "no-store" } });
  }
}
