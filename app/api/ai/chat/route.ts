import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import {
  appendConversationMessage,
  createConversation,
  ensureAiAssistantSchema,
  generateAssistantReply,
  listConversationMessages,
  requireConversationAccess,
  resolveChatModel,
} from "@/lib/ai/assistant-service";
import { getSalesDatabase } from "@/lib/sales/database";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const db = getSalesDatabase();
    await ensureAiAssistantSchema(db);
    const searchParams = new URL(request.url).searchParams;
    const conversationId = searchParams.get("conversationId");
    if (!conversationId) return Response.json({ error: "conversationId 不能为空" }, { status: 400 });
    return Response.json({ items: await listConversationMessages(conversationId, principal, db) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "读取对话失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin", "operator", "analyst"]);
    const db = getSalesDatabase();
    await ensureAiAssistantSchema(db);
    const payload = await request.json().catch(() => null) as { conversationId?: string; title?: string; message?: string } | null;
    if (!payload?.message?.trim()) return Response.json({ error: "消息不能为空" }, { status: 400 });
    const model = await resolveChatModel(db);
    if (!model) return Response.json({ error: "尚未配置可用的文本模型" }, { status: 400 });
    const conversationId = payload.conversationId ?? await createConversation(payload.title || "新对话", principal.email, model.id, db);
    if (payload.conversationId) await requireConversationAccess(conversationId, principal, db);
    await appendConversationMessage(conversationId, "user", payload.message.trim(), db);
    const reply = await generateAssistantReply({ prompt: payload.message.trim(), principal, conversationId, model }, db);
    return Response.json({ conversationId, reply }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "发送消息失败" }, { status: 500 });
  }
}
