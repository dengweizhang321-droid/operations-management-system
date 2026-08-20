import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import { cacheMarketImages } from "@/lib/market/image-cache";

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "市场商品图片缓存", "修改");
    const body = await request.json().catch(() => null) as { batchId?: unknown; limit?: unknown } | null;
    const batchId = typeof body?.batchId === "string" ? body.batchId.trim().slice(0, 120) : undefined;
    const limit = Number(body?.limit ?? 12);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 24) return Response.json({ error: "limit 必须是 1 到 24 的整数" }, { status: 400 });
    const result = await cacheMarketImages({ batchId, limit });
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return safeApiErrorResponse(error, "市场商品图片缓存失败", { headers: { "cache-control": "no-store" } });
  }
}
