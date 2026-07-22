import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { ensureAiAssistantSchema, listAiConversations } from "@/lib/ai/assistant-service";
import { getSalesDatabase } from "@/lib/sales/database";

export async function GET() {
  try {
    const principal = await requireAppPrincipal();
    const db = getSalesDatabase();
    await ensureAiAssistantSchema(db);
    return Response.json({ items: await listAiConversations(principal, db) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "读取对话列表失败" }, { status: 500 });
  }
}
