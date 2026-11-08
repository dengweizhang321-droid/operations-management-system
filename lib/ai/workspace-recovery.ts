import type { AiPageModule } from "./page-context";

const CHAT_RECEIPT_STATUSES = ["processing", "dispatched", "succeeded", "failed", "unknown", "cancelled", "stopped", "stopping"] as const;
type AiChatReceiptStatus = typeof CHAT_RECEIPT_STATUSES[number];
export type AiChatRequestReceipt = {
  status: AiChatReceiptStatus;
  conversationId?: string | null;
  assistantMessageId?: string | null;
  dispatchState?: string;
  cancelRequested?: boolean;
};

function readReceipt(payload: unknown): AiChatRequestReceipt | null {
  if (!payload || typeof payload !== "object" || !("request" in payload)) return null;
  const receipt = payload.request as AiChatRequestReceipt | null;
  if (!receipt || !CHAT_RECEIPT_STATUSES.includes(receipt.status)) return null;
  return receipt;
}

export async function requestAiChatStop(
  clientRequestId: string,
  workspaceModule: AiPageModule,
  fetcher: typeof fetch = fetch,
): Promise<AiChatRequestReceipt> {
  // Stop is independent of the response stream and its AbortSignal.
  const response = await fetcher("/api/ai/chat/cancel", {
    method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
    body: JSON.stringify({ clientRequestId, workspaceModule }),
  });
  const receipt = readReceipt(await response.json());
  if (!response.ok || !receipt) throw new Error("停止请求尚未确认。");
  return receipt;
}

/** Recovery only reads durable receipts and the exact saved reply. It never dispatches. */
export async function recoverAiWorkspaceRequest(input: {
  clientRequestId: string; module: AiPageModule; signal: AbortSignal;
  isCurrent: () => boolean;
  fetcher?: typeof fetch;
}): Promise<{ conversationId: string } | AiChatRequestReceipt | null> {
  const fetcher = input.fetcher ?? fetch;
  const current = () => !input.signal.aborted && input.isCurrent();
  const params = new URLSearchParams({ clientRequestId: input.clientRequestId, workspaceModule: input.module });
  const receiptResponse = await fetcher(`/api/ai/chat?${params}`, { cache: "no-store", signal: input.signal });
  const receipt = readReceipt(await receiptResponse.json());
  if (!current() || !receiptResponse.ok || !receipt) return null;
  if (["cancelled", "stopped", "stopping", "unknown"].includes(receipt.status)
    || (receipt.status === "failed" && receipt.dispatchState === "not_sent")) return receipt;
  if (receipt.status !== "succeeded") return null;
  const { conversationId, assistantMessageId } = receipt;
  if (!conversationId || !assistantMessageId) throw new Error("上次回复的回执不完整，请稍后刷新。");
  const target = new URLSearchParams({ conversationId, messageId: assistantMessageId, workspaceModule: input.module });
  const savedResponse = await fetcher(`/api/ai/chat?${target}`, { cache: "no-store", signal: input.signal });
  const saved = await savedResponse.json() as { conversation?: { id?: string }; items?: { id?: string; conversationId?: string }[] };
  if (!current()) return null;
  if (!savedResponse.ok || saved.conversation?.id !== conversationId
    || saved.items?.length !== 1 || saved.items[0].id !== assistantMessageId
    || saved.items[0].conversationId !== conversationId) throw new Error("尚未完整读回上次回复，已保留恢复记录，请稍后刷新。");
  return { conversationId };
}
