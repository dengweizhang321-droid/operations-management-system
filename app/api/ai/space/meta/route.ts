import { requireAppPrincipal } from "@/lib/auth/authorization";
import { getAiSpaceMeta } from "@/lib/ai/space";
import { getSalesDatabase } from "@/lib/sales/database";
import { aiJsonResponse, aiRouteErrorResponse } from "@/app/api/ai/route-helpers";

export async function GET() {
  try {
    const principal = await requireAppPrincipal();
    return aiJsonResponse(await getAiSpaceMeta(principal, getSalesDatabase()));
  } catch (error) {
    return aiRouteErrorResponse(error, "读取 AI 空间配置失败");
  }
}
