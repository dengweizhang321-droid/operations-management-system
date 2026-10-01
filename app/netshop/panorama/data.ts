import { decodeInsightsContextForQuery, insightBudget, validateContextQuery } from "@/lib/netshop/insights-contract";
import { InsightReadError } from "../shared/request-state";
import { decodeStorePanorama, PanoramaResponseError, validatePanoramaQuery } from "./contract";

const budgets = new WeakMap<AbortSignal, AbortSignal>();
function budgetSignal(signal: AbortSignal): AbortSignal {
  let bounded = budgets.get(signal);
  if (!bounded) { bounded = AbortSignal.any([signal, AbortSignal.timeout(insightBudget.requestDeadlineMs)]); budgets.set(signal, bounded); }
  return bounded;
}
function cancelled(signal: AbortSignal) { if (signal.aborted) throw signal.reason; }

/** Authority is checked before parsing an upstream HTML/empty error response. */
async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  cancelled(signal);
  if (response.status === 401 || response.status === 403) throw new InsightReadError(response.status === 401 ? "unauthenticated" : "access_denied", "来源权限失效，请重新读取当前授权范围");
  if (response.status === 409) throw new InsightReadError("insights_revision_changed", "参与来源版本已变化，请完整重读");
  if (!response.body) throw new InsightReadError("service_unavailable", "来源返回空响应");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      cancelled(signal); const next = await reader.read(); cancelled(signal);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > insightBudget.responseBytes) { await reader.cancel(); throw new InsightReadError("quality_incomplete", "全景完整响应超过2MiB，请缩小范围"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new InsightReadError("service_unavailable", "来源响应格式无效"); }
  cancelled(signal);
  if (!response.ok) {
    const error = body && typeof body === "object" ? body as Record<string, unknown> : {};
    throw new InsightReadError(typeof error.code === "string" ? error.code : "service_unavailable", typeof error.error === "string" && error.error.length <= 2000 ? error.error : "来源读取失败");
  }
  return body;
}

export async function loadStorePanorama(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  validatePanoramaQuery(query); const bounded = budgetSignal(signal); const request = new URLSearchParams(query);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      cancelled(bounded);
      const response = await fetchImpl(`/api/netshop/store-panorama?${request}`, { cache: "no-store", signal: bounded });
      const body = await readBody(response, bounded);
      const data = decodeStorePanorama(body, request, response.headers.get("X-Netshop-Data-Revision"));
      cancelled(bounded); return data;
    } catch (error) {
      cancelled(bounded);
      const code = error instanceof PanoramaResponseError || error instanceof InsightReadError ? error.code : null;
      if (code === "insights_revision_changed" && attempt === 0) { request.delete("snapshotToken"); request.delete("sectionToken"); continue; }
      if (error instanceof PanoramaResponseError) throw new InsightReadError(error.code, error.message);
      throw error;
    }
  }
  throw new InsightReadError("insights_revision_changed", "参与来源持续变化，请重新读取");
}

/** Real F directory read, with no selected outlet and no implicit first shop. */
export async function loadPanoramaContext(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  validateContextQuery(query); const bounded = budgetSignal(signal); cancelled(bounded);
  const response = await fetchImpl(`/api/netshop/insights-context?${query}`, { cache: "no-store", signal: bounded });
  const body = await readBody(response, bounded), data = decodeInsightsContextForQuery(body, query, response.headers.get("X-Netshop-Data-Revision"));
  cancelled(bounded); return data;
}
