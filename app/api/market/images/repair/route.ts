import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";
import { getMarketDatabase } from "@/lib/market/database";
import { applyMarketImageRepairs, listMarketImageRepairCandidates, type MarketImageRepairMapping } from "@/lib/market/image-repair";

function integerParam(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new PublicApiError(400, "invalid_request", "分页参数必须是整数");
  return parsed;
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "市场商品图片修复");
    const params = new URL(request.url).searchParams;
    const result = await listMarketImageRepairCandidates(getMarketDatabase(), {
      page: integerParam(params.get("page"), 1),
      pageSize: integerParam(params.get("pageSize"), 100),
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "读取缺图商品失败", { headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "市场商品图片修复", "修改");
    const body = await request.json() as { repairs?: MarketImageRepairMapping[] };
    const result = await applyMarketImageRepairs(getMarketDatabase(), { repairs: body.repairs ?? [] }, principal);
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "修复商品图片失败", { headers: { "cache-control": "no-store" } });
  }
}
