import type { AppPrincipal } from "@/lib/auth/authorization";
import type { AiToolSurface } from "@/lib/ai/tool-registry-contract";

export const aiQuestionEntrySources = ["web_chat"] as const;
export type AiQuestionEntrySource = (typeof aiQuestionEntrySources)[number];

export type AiQuestionEntryContext = {
  principal: AppPrincipal;
  source: AiQuestionEntrySource;
  surface: Extract<AiToolSurface, "ai_chat">;
  requestId: string;
  signal?: AbortSignal;
};

export function createWebChatEntryContext(input: {
  principal: AppPrincipal;
  requestIdHeader?: string | null;
  signal?: AbortSignal;
}): AiQuestionEntryContext {
  return {
    principal: input.principal,
    source: "web_chat",
    surface: "ai_chat",
    requestId: normalizeRequestId(input.requestIdHeader),
    signal: input.signal,
  };
}

function normalizeRequestId(value?: string | null): string {
  const candidate = value?.trim() ?? "";
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(candidate)) return candidate;
  return `ai-chat-${crypto.randomUUID()}`;
}
