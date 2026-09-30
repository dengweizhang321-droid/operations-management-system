import { InsightReadError } from "../shared/request-state";
import { decodeProductDetail, decodeProductInsights, validateProductQuery } from "./contract";

export async function loadProductInsights(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  validateProductQuery(query);
  const response = await fetchImpl(`/api/netshop/product-insights?${query}`, { cache: "no-store", signal });
  const body = await response.json();
  if (signal.aborted) throw new DOMException("读取已取消", "AbortError");
  if (!response.ok) throw new InsightReadError(typeof body?.code === "string" ? body.code : "service_unavailable", typeof body?.error === "string" ? body.error : "商品来源读取失败");
  return decodeProductInsights(body, query, response.headers.get("X-Netshop-Data-Revision"));
}
export async function loadProductDetail(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  validateProductQuery(query, true);
  const response = await fetchImpl(`/api/netshop/product-insights/detail?${query}`, { cache: "no-store", signal });
  const body = await response.json();
  if (signal.aborted) throw new DOMException("读取已取消", "AbortError");
  if (!response.ok) throw new InsightReadError(typeof body?.code === "string" ? body.code : "service_unavailable", typeof body?.error === "string" ? body.error : "单品来源读取失败");
  return decodeProductDetail(body, query, response.headers.get("X-Netshop-Data-Revision"));
}
