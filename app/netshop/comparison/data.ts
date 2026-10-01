import { insightBudget } from "@/lib/netshop/insights-contract";
import { InsightReadError } from "../shared/request-state";
import { ComparisonResponseError, decodeComparisonInsights, validateComparisonQuery } from "./contract";

// A scoped signal owns a single budget, including any permitted version recovery.
const budgets = new WeakMap<AbortSignal, { signal: AbortSignal; deadline: number }>();
function interruptible<T>(promise: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { reject(signal.reason ?? new DOMException("读取已取消", "AbortError")); };
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); if (signal.aborted) { late?.(value); abort(); } else resolve(value); }, error => { signal.removeEventListener("abort", abort); if (signal.aborted) abort(); else reject(error); });
  });
}
export async function loadComparisonInsights(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  let budget = budgets.get(signal);
  if (!budget) { budget = { signal: AbortSignal.any([signal, AbortSignal.timeout(insightBudget.requestDeadlineMs)]), deadline: performance.now() + insightBudget.requestDeadlineMs }; budgets.set(signal, budget); }
  const bounded = budget.signal;
  const cancelled = () => { if (bounded.aborted) throw bounded.reason ?? new DOMException("读取已取消", "AbortError"); if (performance.now() > budget!.deadline) throw new InsightReadError("source_not_ready", "比较读取超过90秒整体期限，请缩小范围或重新读取"); };
  try {
    cancelled();
    validateComparisonQuery(query);
    cancelled();
    const response = await interruptible(fetchImpl(`/api/netshop/comparison-insights?${query}`, { cache: "no-store", signal: bounded }), bounded, late => { void late.body?.cancel().catch(() => undefined); });
    cancelled();
    if ([401, 403, 409].includes(response.status)) {
      void response.body?.cancel().catch(() => undefined);
      throw new InsightReadError(response.status === 409 ? "comparison_revision_changed" : "access_denied", response.status === 409 ? "比较来源版本已变化，请重新读取当前范围" : `当前账号或范围无权读取对比数据（${response.status}）`);
    }
    const reader = response.body?.getReader();
    let body = "", bytes = 0;
    if (reader) {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        while (true) {
          const part = await interruptible(reader.read(), bounded); cancelled(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > insightBudget.responseBytes) { void reader.cancel().catch(() => undefined); throw new InsightReadError("response_too_large", "比较响应超过2MiB，请缩小店铺或日期范围"); }
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
      finally { reader.releaseLock(); }
    }
    cancelled();
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new InsightReadError("invalid_comparison_contract", "比较来源返回无法验证的响应"); }
    if (!response.ok) {
      const failure = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      throw new InsightReadError(typeof failure.code === "string" ? failure.code : "service_unavailable", typeof failure.error === "string" ? failure.error.slice(0, 600) : `比较来源读取失败（${response.status}）`);
    }
    const data = decodeComparisonInsights(payload, query, response.headers.get("X-Netshop-Data-Revision"));
    cancelled();
    return data;
  } catch (error) {
    cancelled();
    if (error instanceof ComparisonResponseError) throw new InsightReadError(error.code, error.message);
    if (error instanceof TypeError && error.message.includes("encoded data")) throw new InsightReadError("invalid_comparison_contract", "比较响应编码无法验证");
    throw error;
  }
}
