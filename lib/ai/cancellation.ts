export class AiRequestCancelledError extends Error {
  constructor(message = "AI 请求已取消") {
    super(message);
    this.name = "AiRequestCancelledError";
  }
}

export function throwIfAiRequestCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AiRequestCancelledError();
}

export function isAiRequestCancelled(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || error instanceof AiRequestCancelledError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "cancelled");
}
