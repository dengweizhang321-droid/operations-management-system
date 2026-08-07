import {
  importNetshopBytes,
  readNetshopForm,
  TMALL_PLATFORM,
} from "@/lib/netshop/import-service";
import {
  ensureNetshopSchema,
  getNetshopDatabase,
  listNetshopImportBatches,
} from "@/lib/netshop/database";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import { recordRejectedImportBytes } from "@/lib/imports/content-fingerprint";

const MAX_DIRECT_FILE_BYTES = 25 * 1024 * 1024;

function errorResponse(status: number, message: string, details: Record<string, unknown> = {}) {
  return Response.json({ ok: false, status: "rejected", message, ...details }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const params = new URL(request.url).searchParams;
    const requestedLimit = Number(params.get("limit") ?? 20);
    const items = await listNetshopImportBatches(db, {
      limit: Number.isFinite(requestedLimit) ? requestedLimit : 20,
      sources: params.getAll("source"),
      platforms: netshopPlatformsForPrincipal(principal, params.getAll("platform")),
      shops: params.getAll("shop"),
    });
    return Response.json({ items, returned: items.length, truncated: items.length >= Math.max(1, Math.min(100, Math.trunc(requestedLimit || 20))) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "读取网店导入历史失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return errorResponse(415, "请使用 multipart/form-data 上传文件");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_DIRECT_FILE_BYTES + 1024 * 1024) {
      return errorResponse(413, "文件超过 25MB，请拆分后上传");
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) return errorResponse(400, "无法读取上传表单");
    const parsed = readNetshopForm(formData);
    const file = parsed.file;
    if (!(file instanceof File)) return errorResponse(400, "缺少名为 file 的文件");
    if (file.size > MAX_DIRECT_FILE_BYTES) return errorResponse(413, "文件超过 25MB，请拆分后上传");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const rejectUploadedFile = async (status: number, code: string, message: string) => {
      await recordRejectedImportBytes(getNetshopDatabase(), {
        domain: "netshop",
        bytes,
        scopeHint: {
          source: parsed.source,
          platform: parsed.platform?.trim() || null,
          shopName: parsed.shopName?.trim() || null,
          snapshotDate: parsed.snapshotDate?.trim() || null,
          startDate: parsed.expectedStartDate?.trim() || null,
          endDate: parsed.expectedEndDate?.trim() || null,
        },
        errorCode: code,
        issues: [{ code, message }],
        metadata: { fileName: file.name, fileSizeBytes: file.size, actor: principal.email },
      });
      return errorResponse(status, message);
    };
    if (!parsed.source) return rejectUploadedFile(400, "INVALID_SOURCE", "缺少或不支持 source 参数");
    if (file.size === 0) return rejectUploadedFile(400, "EMPTY_UPLOAD", "上传文件为空");
    const effectivePlatform = parsed.source.startsWith("tmall_") ? TMALL_PLATFORM : parsed.platform?.trim() || "京东";
    netshopPlatformsForPrincipal(principal, [effectivePlatform]);

    const payload = await importNetshopBytes({
      bytes,
      fileName: file.name,
      fileSizeBytes: file.size,
      source: parsed.source,
      platform: parsed.platform,
      shopName: parsed.shopName,
      note: parsed.note,
      snapshotDate: parsed.snapshotDate,
      expectedDataset: parsed.expectedDataset === "sku_daily" || parsed.expectedDataset === "spu_daily" ? parsed.expectedDataset : undefined,
      expectedStartDate: parsed.expectedStartDate,
      expectedEndDate: parsed.expectedEndDate,
    });
    return Response.json(payload, { status: payload.ok ? (payload.status === "imported" ? 201 : 200) : 422, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "网店数据导入失败";
    return Response.json({ ok: false, status: "rejected", message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
