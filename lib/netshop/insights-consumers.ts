import { decodeInsightsContextForQuery, encodeProductIdentity, validateContextQuery, type InsightsContext, type ProductIdentity } from "./insights-contract";

export async function loadInsightsContext(query: URLSearchParams, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<InsightsContext> {
  validateContextQuery(query);
  const response = await fetchImpl(`/api/netshop/insights-context?${query}`, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? "共享范围读取失败");
  if (signal.aborted) throw new DOMException("读取已取消", "AbortError");
  return decodeInsightsContextForQuery(body, query, response.headers.get("X-Netshop-Data-Revision"));
}
export function exactProductQuery(identities: ProductIdentity[], period: { startDate: string; endDate: string }, sourceRevision: string) {
  if (!identities.length || identities.length > 100 || new Set(identities.map(encodeProductIdentity)).size !== identities.length || new Set(identities.map(i => i.dimension)).size !== 1 || !sourceRevision || sourceRevision.length > 100) throw new Error("精确商品配对范围无效");
  const query = new URLSearchParams({ view: "identities", dimension: identities[0].dimension, ...period, sourceRevision });
  for (const platform of new Set(identities.map(i => i.platform))) query.append("platform", platform);
  for (const shop of new Set(identities.map(i => `${i.platform}\u001f${i.shopName}`))) query.append("outlet", shop);
  identities.forEach(i => query.append("identity", encodeProductIdentity(i)));
  return query;
}
/** All four role examples call an existing foundation API. Business sections
 * below are explicitly synthetic and cannot be mistaken for future handlers.
 */
export function syntheticRoleConsumption(role: "P" | "A" | "S" | "C", context: InsightsContext) {
  return { role, synthetic: true as const, requestedScope: context.requestedScope, effectiveScope: context.effectiveScope, periods: context.periods, coverage: context.coverageBySource,
    fields: context.capabilities.filter(c => role === "A" ? c.sourceId.includes("promotion") : role === "P" ? !c.sourceId.includes("promotion") : true), sourceRevisions: context.sourceRevisions,
    next: role === "S" || role === "C" ? "P/A接口合main后通过所属consumer读取其业务分区" : "本模块业务接口由栏目实现并交I串行注册" };
}
