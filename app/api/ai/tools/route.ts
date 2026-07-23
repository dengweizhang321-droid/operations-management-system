import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";
import { getVisibleToolCatalog } from "@/lib/ai/tool-registry";

export async function GET() {
  try {
    const principal = await requireAppPrincipal();
    const items = getVisibleToolCatalog(principal);
    return Response.json(
      { items, count: items.length },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json(
      { error: error instanceof Error ? error.message : "读取 AI 工具清单失败" },
      { status: 500 },
    );
  }
}
