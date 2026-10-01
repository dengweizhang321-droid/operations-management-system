import { insightBudget } from "@/lib/netshop/insights-contract";
import { InsightReadError } from "../shared/request-state";

type PromotionPath = "/api/netshop/promotion-insights" | "/api/netshop/promotion-insights/detail";

/** The owning decoder validates the entire DTO, requested range and revision header. */
export async function readPromotion<T>(path: PromotionPath, query: URLSearchParams, signal: AbortSignal,
  decode: (value: unknown, query: URLSearchParams, owningRevision: string | null) => T,
  fetchImpl: typeof fetch = fetch): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("推广读取超时，请缩小范围或重新读取")), insightBudget.requestDeadlineMs);
  try {
    const response = await fetchImpl(`${path}?${query}`, { cache: "no-store", signal: controller.signal });
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException("读取已取消", "AbortError");
    // Auth/revision status is authoritative even if a proxy supplies HTML,
    // an empty body or malformed bytes. Do not wait for an optional message
    // body before fencing the parent result, and never trust its error code.
    const authoritativeCode = response.status === 401 || response.status === 403 ? "access_denied" : response.status === 409 ? "promotion_revision_changed" : null;
    if (authoritativeCode) {
      void response.body?.cancel().catch(() => undefined);
      const message = response.status === 401 ? "推广读取需要有效身份（401）" : response.status === 403 ? "当前账号或范围无权读取推广数据（403）" : "推广来源版本已变化，请重新读取当前范围（409）";
      throw new InsightReadError(authoritativeCode, message);
    }
    const reader = response.body?.getReader();
    let body = "";
    if (reader) {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const decodeChunk = (chunk?: Uint8Array, stream = false) => {
        try { return decoder.decode(chunk, { stream }); }
        catch { throw new InsightReadError("invalid_promotion_contract", "推广响应编码无法验证，请重新读取"); }
      };
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > insightBudget.responseBytes) throw new InsightReadError("response_too_large", "推广响应超出安全读取范围，请缩小店铺或日期范围");
          body += decodeChunk(chunk.value, true);
        }
        body += decodeChunk();
      } finally { reader.releaseLock(); }
    }
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException("读取已取消", "AbortError");
    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch { throw new InsightReadError("invalid_promotion_contract", "推广来源返回了无法验证的响应"); }
    if (!response.ok) {
      const error = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      const message = typeof error.error === "string" ? error.error.slice(0, 600) : `推广来源读取失败（${response.status}）`;
      const code = typeof error.code === "string" ? error.code : "service_unavailable";
      throw new InsightReadError(code, message);
    }
    return decode(payload, query, response.headers.get("X-Netshop-Data-Revision"));
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException("读取已取消", "AbortError");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
