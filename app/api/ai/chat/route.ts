import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import {
  ensureAiAssistantSchema,
  listConversationMessages,
} from "@/lib/ai/assistant-service";
import { isAiRequestCancelled } from "@/lib/ai/cancellation";
import { createWebChatEntryContext } from "@/lib/ai/entry-context";
import { answerAiQuestion } from "@/lib/ai/question-workflow";
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
    const payload = await request.json().catch(() => null) as { conversationId?: string; title?: string; message?: string; modelId?: string } | null;
    if (!payload?.message?.trim()) return Response.json({ error: "消息不能为空" }, { status: 400 });
    const result = await answerAiQuestion({
      entry: createWebChatEntryContext({
        principal,
        requestIdHeader: request.headers.get("x-request-id"),
        signal: request.signal,
      }),
      conversationId: payload.conversationId,
      title: payload.title,
      message: payload.message,
      modelId: payload.modelId,
    }, db);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    if (isAiRequestCancelled(error, request.signal)) {
      return Response.json({ error: "生成已停止", code: "ai_request_cancelled" }, { status: 499 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "发送消息失败" }, { status: 500 });
  }
}
