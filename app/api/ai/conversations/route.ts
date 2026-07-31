import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import {
  deleteAiConversation,
  ensureAiAssistantSchema,
  listAiConversations,
  listAvailableChatModels,
  selectConversationModel,
} from "@/lib/ai/assistant-service";
import { getSalesDatabase } from "@/lib/sales/database";

export async function GET() {
  try {
    const principal = await requireAppPrincipal();
    const db = getSalesDatabase();
    await ensureAiAssistantSchema(db);
    const [items, models] = await Promise.all([
      listAiConversations(principal, db),
      listAvailableChatModels(db),
    ]);
    return Response.json({ items, models }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "读取对话列表失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin", "operator", "analyst"]);
    const payload = await request.json().catch(() => null) as { conversationId?: string; modelId?: string } | null;
    const conversationId = payload?.conversationId?.trim();
    const modelId = payload?.modelId?.trim();
    if (!conversationId || !modelId) return Response.json({ error: "conversationId 和 modelId 不能为空" }, { status: 400 });
    const item = await selectConversationModel(conversationId, modelId, principal, getSalesDatabase());
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "切换对话模型失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin", "operator", "analyst"]);
    const conversationId = new URL(request.url).searchParams.get("id")?.trim();
    if (!conversationId) return Response.json({ error: "缺少对话 id" }, { status: 400 });
    const deleted = await deleteAiConversation(conversationId, principal, getSalesDatabase());
    if (!deleted) return Response.json({ error: "对话不存在或已删除" }, { status: 404 });
    return Response.json({ ok: true, deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "删除对话失败" }, { status: 500 });
  }
}
