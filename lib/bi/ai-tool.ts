import { requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { requestDjangoBiCockpit } from "@/lib/django/bi-service";
import type { AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";
import { decodeBiCockpit, inventoryData, operationsData, flowData } from "./cockpit-contract";

export async function getBiCockpitForAi(args: Record<string, unknown>, context: AiToolExecutionContext) {
  requireUnrestrictedDataScope(context.principal, "BI经营驾驶舱");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) query.set(key, String(value));
  if (!query.has("range")) query.set("range", "month");
  const result = await requestDjangoBiCockpit<unknown>(context.principal, query.toString(), { signal: context.signal });
  const data = decodeBiCockpit(result.data), operations = operationsData(data.sources.operations), inventory = inventoryData(data.sources.inventory), flow = flowData(data.sources.flow);
  return { contractVersion: data.contractVersion, revision: data.revision, sourceRevisions: data.sourceRevisions,
    periods: data.erp.periods, filters: data.erp.filters, sales: { current: data.erp.sales.current, previous: data.erp.sales.previous, yearAgo: data.erp.sales.yearAgo },
    goals: { periods: data.goals.periods, sourceStatus: data.goals.sourceStatus, disclosure: data.goals.disclosure },
    shops: { total: data.erp.shops.length, returned: Math.min(20, data.erp.shops.length), truncated: data.erp.shops.length > 20, items: data.erp.shops.slice(0, 20).map(row => ({ name: row.name, platform: row.platform, current: row.current.netSalesCents, yoy: row.yoy, severity: row.severity })) },
    categories: { total: data.erp.categories.length, returned: Math.min(20, data.erp.categories.length), truncated: data.erp.categories.length > 20, items: data.erp.categories.slice(0, 20).map(row => ({ name: row.name, netSalesCents: row.current.netSalesCents, yoy: row.yoy, mom: row.mom })) },
    operations: operations ? { uniqueAttentionCount: operations.uniqueAttentionCount, groups: operations.groups.map(({ key, total }) => ({ key, total })) } : null,
    inventory: inventory ? { snapshotDate: inventory.snapshotDate, stale: inventory.stale, metrics: inventory.metrics, guangdong: { counts: inventory.guangdong.counts, watchCount: inventory.guangdong.watchCount, pendingCount: inventory.guangdong.pendingCount } } : null,
    flow: flow ? { status: flow.status, reasonCode: flow.reasonCode, summary: flow.summary } : null,
    sourceStatus: Object.fromEntries(Object.entries(data.sources).map(([key, value]) => [key, { status: value.status, reasonCode: value.reasonCode }])),
    limitations: [...data.limitations, ...data.erp.limitations, "AI只返回有界经营摘要；不可比指标不推断0%"] };
}
