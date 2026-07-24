import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { analyzeCustomerServiceConversations } from "@/lib/customer-service/analysis";

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    const body = await request.json().catch(() => null) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];
    return Response.json({ ok: true, ...(await analyzeCustomerServiceConversations(ids, principal)) });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "AI 客服分析失败" }, { status: 400 });
  }
}
