import { InsightReadError } from "../shared/request-state";
import { decodeProductDetail, decodeProductInsights, ProductResponseError, validateProductQuery } from "./contract";

// One scoped-read signal owns one 90s deadline, including a single 409 recovery.
const budgets = new WeakMap<AbortSignal, AbortSignal>();
function budgetSignal(signal: AbortSignal) { let bounded = budgets.get(signal); if (!bounded) { bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]); budgets.set(signal, bounded); } return bounded; }

export async function loadProductInsights(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  validateProductQuery(query);
  const bounded = budgetSignal(signal);
  const response = await fetchImpl(`/api/netshop/product-insights?${query}`, { cache: "no-store", signal: bounded });
  const body = await response.json();
  if (bounded.aborted) throw bounded.reason;
  if (!response.ok) throw new InsightReadError(typeof body?.code === "string" ? body.code : "service_unavailable", typeof body?.error === "string" ? body.error : "商品来源读取失败");
  try { return decodeProductInsights(body, query, response.headers.get("X-Netshop-Data-Revision")); } catch (error) { if (error instanceof ProductResponseError) throw new InsightReadError(error.code, error.message); throw error; }
}
export async function loadProductDetail(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  validateProductQuery(query, true);
  const bounded = budgetSignal(signal);
  const response = await fetchImpl(`/api/netshop/product-insights/detail?${query}`, { cache: "no-store", signal: bounded });
  const body = await response.json();
  if (bounded.aborted) throw bounded.reason;
  if (!response.ok) throw new InsightReadError(typeof body?.code === "string" ? body.code : "service_unavailable", typeof body?.error === "string" ? body.error : "单品来源读取失败");
  try { return decodeProductDetail(body, query, response.headers.get("X-Netshop-Data-Revision")); } catch (error) { if (error instanceof ProductResponseError) throw new InsightReadError(error.code, error.message); throw error; }
}
