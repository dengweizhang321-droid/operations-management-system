import { requireAppPrincipal } from "@/lib/auth/authorization";
import { setAiSpaceAssetFavorite } from "@/lib/ai/space";
import { PublicApiError } from "@/lib/http/api-error";
import { getSalesDatabase } from "@/lib/sales/database";
import {
  aiJsonResponse,
  aiRouteErrorResponse,
  readAiJsonObject,
  requireAiId,
  requireAiSameOriginWrite,
} from "@/app/api/ai/route-helpers";

export async function PATCH(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    requireAiSameOriginWrite(request);
    const principal = await requireAppPrincipal();
    const params = await context.params;
    const id = requireAiId(params.assetId, "assetId");
    const body = await readAiJsonObject(request);
    if (typeof body.favorite !== "boolean") throw new PublicApiError(400, "invalid_request", "favorite 必须为布尔值。");
    return aiJsonResponse({ item: await setAiSpaceAssetFavorite(id, body.favorite, principal, getSalesDatabase()) });
  } catch (error) {
    return aiRouteErrorResponse(error, "更新 AI 空间收藏失败");
  }
}
