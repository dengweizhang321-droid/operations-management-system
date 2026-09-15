import { requireAppPrincipal, requireUnrestrictedDataScope, authorizationErrorResponse } from "@/lib/auth/authorization";
import { createDjangoFinanceService, FINANCE_TARGET_IMPORT_PATH } from "@/lib/django/finance-service";
import {
  MAX_ANNUAL_TARGET_FILE_BYTES,
  parseAnnualTargetWorkbook,
} from "@/lib/finance/annual-target-import";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "经营目标", "导入");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new PublicApiError(415, "unsupported_media_type", "请上传 .xlsx 店铺年度目标文件");
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_ANNUAL_TARGET_FILE_BYTES + 256 * 1024) {
      throw new PublicApiError(413, "payload_too_large", "店铺年度目标文件不能超过 2MB");
    }
    const formData = await request.formData().catch(() => null);
    const year = String(formData?.get("year") ?? "").trim();
    if (!/^(?:19|20|21)\d{2}$/.test(year)) throw new PublicApiError(400, "invalid_request", "导入年份应为 YYYY");
    const entry = formData?.get("file");
    if (!(entry instanceof File)) throw new PublicApiError(400, "invalid_request", "缺少名为 file 的年度目标文件");
    if (!/\.xlsx$/i.test(entry.name)) throw new PublicApiError(400, "invalid_request", "仅支持 .xlsx 店铺年度目标文件");
    if (entry.name.length > 200) throw new PublicApiError(400, "invalid_request", "年度目标文件名不能超过 200 字");
    if (entry.size <= 0) throw new PublicApiError(400, "invalid_request", "上传文件为空");
    if (entry.size > MAX_ANNUAL_TARGET_FILE_BYTES) throw new PublicApiError(413, "payload_too_large", "店铺年度目标文件不能超过 2MB");
    const bytes = new Uint8Array(await entry.arrayBuffer());
    let parsed;
    try {
      parsed = parseAnnualTargetWorkbook(bytes);
    } catch (error) {
      throw new PublicApiError(422, "invalid_request", error instanceof Error ? error.message : "年度目标文件解析失败");
    }
    const result = await createDjangoFinanceService().request<Record<string, unknown>>(
      principal,
      {
        method: "POST",
        path: FINANCE_TARGET_IMPORT_PATH,
        payload: {
          ...parsed,
          year,
          fileName: entry.name,
          fileSizeBytes: bytes.byteLength,
          fileSha256: await sha256Hex(bytes),
        },
        service: "writer",
      },
      { signal: request.signal },
    );
    const headers = new Headers({ "cache-control": "no-store" });
    if (result.replayed) headers.set("x-teruisi-write-replay", "1");
    return Response.json(result.data, { status: result.status, headers });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "店铺年度目标导入失败。", { headers: { "cache-control": "no-store" } });
  }
}
