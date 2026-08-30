import { requireAppPrincipal } from "@/lib/auth/authorization";
import {
  AI_MESSAGE_PAGE_SIZE_DEFAULT,
  AI_MESSAGE_PAGE_SIZE_MAX,
  ensureAiAssistantSchema,
  listConversationMessages,
} from "@/lib/ai/assistant-service";
import { isAiRequestCancelled } from "@/lib/ai/cancellation";
import { createWebChatEntryContext } from "@/lib/ai/entry-context";
import { answerAiQuestion } from "@/lib/ai/question-workflow";
import { getD1Database } from "@/lib/database/d1";
import {
  aiJsonResponse,
  aiRouteErrorResponse,
  optionalAiId,
  optionalAiPositiveInteger,
  parseAiPositiveInteger,
  readAiJsonObject,
  requireAiId,
  requireAiString,
} from "@/app/api/ai/route-helpers";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const db = getD1Database();
    await ensureAiAssistantSchema(db);
    const searchParams = new URL(request.url).searchParams;
    const conversationIds = searchParams.getAll("conversationId");
    const conversationId = requireAiId(conversationIds.length === 1 ? conversationIds[0] : undefined, "conversationId");
    const pageSize = parseAiPositiveInteger(searchParams, "pageSize", AI_MESSAGE_PAGE_SIZE_DEFAULT, AI_MESSAGE_PAGE_SIZE_MAX);
    const before = optionalAiPositiveInteger(searchParams, "before");
    return aiJsonResponse(await listConversationMessages(conversationId, principal, { pageSize, before }, db));
  } catch (error) {
    return aiRouteErrorResponse(error, "读取对话失败");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin", "operator", "analyst"]);
    const db = getD1Database();
    await ensureAiAssistantSchema(db);
    const payload = await readAiJsonObject(request);
    const conversationId = optionalAiId(payload.conversationId, "conversationId");
    const modelId = optionalAiId(payload.modelId, "modelId");
    const message = requireAiString(payload.message, "消息", { maximumCharacters: 12_000, maximumBytes: 48_000 });
    const title = payload.title === undefined
      ? undefined
      : requireAiString(payload.title, "标题", { maximumCharacters: 120, maximumBytes: 480 });
    const result = await answerAiQuestion({
      entry: createWebChatEntryContext({
        principal,
        requestIdHeader: request.headers.get("x-request-id"),
        signal: request.signal,
      }),
      conversationId,
      title,
      message,
      modelId,
    }, db);
    return aiJsonResponse(result);
  } catch (error) {
    if (isAiRequestCancelled(error, request.signal)) {
      return aiJsonResponse({ error: "生成已停止", code: "ai_request_cancelled" }, { status: 499 });
    }
    return aiRouteErrorResponse(error, "发送消息失败");
  }
}
