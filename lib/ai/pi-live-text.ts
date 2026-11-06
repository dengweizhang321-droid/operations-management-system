type TextEvent = { type: string; operationId: string; data: Record<string, unknown> };

/** Events are already ordered and deduplicated by the session event cursor. */
export function piLiveText(events: TextEvent[], operationId?: string): string {
  if (!operationId) return "";
  let preview = "", runner = "", messageId: string | undefined;
  for (const event of events) {
    if (event.operationId !== operationId) continue;
    const data = event.data;
    if (event.type === "provider_text_delta" && typeof data.messageId === "string" && typeof data.text === "string") {
      if (messageId !== data.messageId) {
        messageId = data.messageId;
        preview = "";
      }
      if (preview.length === data.offset) preview += data.text;
    } else if (event.type === "provider_text_end" && messageId === data.messageId) {
      messageId = undefined;
      preview = "";
    } else if (event.type === "text_delta" && typeof data.text === "string") {
      runner += data.text;
    } else if (event.type === "assistant_message") {
      runner = "";
    }
  }
  return messageId ? preview : runner;
}
