export type BiWindow = { startDate: string; endDate: string; endExclusive: string; days: number };
export type BiMetric = {
  netSalesCents: number | null; costCents: number | null; grossProfitCents: number | null; orderMarginCents: number | null;
  positiveSalesCents: number | null; refundCents: number | null; grossMarginRate: number | null; refundRate: number | null;
  trustedOrders: number | null; missingOrderNoRows: number | null; averageOrderValueCents: number | null;
  orderStatus: string; rowCount: number; status: string;
  coverage: { observedDays: number; expectedDays: number; dateComplete: boolean; basis: string };
};
export type BiCashMetric = Pick<BiMetric, "netSalesCents" | "rowCount" | "coverage">;
export type BiStore = { key: string; platform: string; name: string; current: BiMetric; previous: BiMetric; yearAgo: BiMetric; yoy: number | null; deltaCents: number | null; severity: string };
export type BiCategory = { name: string; current: BiMetric; previous: BiMetric; yearAgo: BiMetric; yoy: number | null; mom: number | null; categoryBasis: string };
export type ErpGoal = { id: string; basis: "erp_net_sales"; periodType: "year" | "month"; periodKey: string; platform: string; shopName: string; salesTargetCents: number; version: number; updatedAt: string };
export type BiGoalProgress = { kind: "year" | "month"; period: string; basis: string; targetCents: number | null; actualCents: number | null; completion: number | null; targetStatus: string; actualCoverageComplete: boolean; startDate: string; endDate: string; pace: number; targetedShops: number; companyTarget: boolean; mom: number | null; yoy: number | null; progressChangePp: number | null; sourceTargetIds: string[] };
export type BiSource = { source: string; status: "ready" | "unavailable"; revision: string | null; reasonCode?: string; data: Record<string, unknown> | null };
export type BiOperations = { asOfDate: string; mine: boolean; uniqueAttentionCount: number; invalidDueDateCount: number; groups: Array<{ key: string; label: string; kind: "plan" | "launch"; bucket: string; total: number; truncated: boolean; items: Array<{ id: string; title: string; owner: string; dueDate: string | null; lastProgressAt: string }> }> };
export type BiInventory = { hasInventory: boolean; snapshotDate: string | null; stale: boolean; metrics: Record<string, number | boolean | null>; riskValueCents: number; riskShareKnown: number | null; buckets: Array<{ label: string; knownStockValueCents: number; positions: number }>; guangdong: { watchCount: number; pendingCount: number; counts: Record<string, number>; total: number; truncated: boolean; items: Array<{ productCode: string; productName: string; availableQuantity: number | null; turnoverDays: number | null; leadDays: number | null; riskLabel: string }> } };
export type BiFlowMetric = { value: number | null; unit: string; status: string; reasonCode?: string | null };
export type BiFlowComparison = { value: number | null; method: string; status: string; reasonCode?: string | null };
export type BiFlow = { status: string; reasonCode?: string | null; summary: Record<string, BiFlowMetric>; comparisons?: Record<string, BiFlowComparison>; platforms: Array<{ platform: string; metrics: Record<string, BiFlowMetric>; comparisons: Record<string, unknown> }>; shops: Array<{ platform: string; shopName: string; metrics: Record<string, BiFlowMetric> }>; options: Array<{ platform: string; shopName: string }>; coverage?: Record<string, unknown> };
export type BiCockpit = {
  contractVersion: "bi-cockpit-v1"; projection: "cockpit"; revision: string;
  sourceRevisions: Record<string, string | null>;
  erp: { periods: { timezone: "Asia/Shanghai"; asOfDate: string; current: BiWindow; previous: BiWindow; yearAgo: BiWindow; rule: string; goalWindows: Record<string, BiWindow> };
    filters: { platform: string; shop: string }; options: Array<{ platform: string; shop: string }>;
    sales: { current: BiMetric; previous: BiMetric; yearAgo: BiMetric; daily: Array<BiMetric & { date: string }> };
    shops: BiStore[]; categories: BiCategory[]; goalActuals: Record<string, unknown>; limitations: string[] };
  goals: { basis: "erp_net_sales"; periods: BiGoalProgress[]; items: ErpGoal[]; sourceStatus: string; disclosure: string };
  sources: Record<"targets" | "operations" | "inventory" | "flow", BiSource>; limitations: string[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BI响应结构无效");
  return value as Record<string, unknown>;
}
function boundedArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("BI响应超出成员范围");
  return value;
}
function number(value: unknown, nullable = true, integer = false) {
  if (value === null && nullable) return;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || integer && !Number.isSafeInteger(value)) throw new Error("BI数字无效，不能显示伪零");
}
function metric(value: unknown) {
  const row = record(value);
  for (const key of ["netSalesCents", "costCents", "grossProfitCents", "orderMarginCents", "positiveSalesCents", "refundCents", "trustedOrders", "missingOrderNoRows"]) number(row[key], true, true);
  for (const key of ["grossMarginRate", "refundRate", "averageOrderValueCents"]) number(row[key]);
  number(row.rowCount, false, true);
  const coverage = record(row.coverage);
  number(coverage.observedDays, false, true); number(coverage.expectedDays, false, true);
  if (typeof coverage.dateComplete !== "boolean" || row.netSalesCents !== null && row.costCents !== null && row.grossProfitCents !== Number(row.netSalesCents) - Number(row.costCents)) throw new Error("BI大毛利或覆盖口径不一致");
}
function window(value: unknown) {
  const row = record(value);
  for (const key of ["startDate", "endDate", "endExclusive"]) if (typeof row[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(String(row[key]))) throw new Error("BI日期无效");
  number(row.days, false, true);
  if (Number(row.days) < 1 || Number(row.days) > 366) throw new Error("BI日期范围超限");
  const first = Date.parse(String(row.startDate)), last = Date.parse(String(row.endDate)), exclusive = Date.parse(String(row.endExclusive));
  if (![first, last, exclusive].every(Number.isFinite) || new Date(first).toISOString().slice(0, 10) !== row.startDate || new Date(last).toISOString().slice(0, 10) !== row.endDate || (last - first) / 86_400_000 + 1 !== row.days || exclusive - last !== 86_400_000) throw new Error("BI日期窗口不一致");
}

function safeTree(value: unknown, depth = 0) {
  if (depth > 30) throw new Error("BI响应层级超限");
  if (typeof value === "number") number(value, false);
  if (Array.isArray(value)) { boundedArray(value, 1000); value.forEach(child => safeTree(child, depth + 1)); }
  else if (value && typeof value === "object") Object.values(value).forEach(child => safeTree(child, depth + 1));
}

export function decodeBiFlowReply(value: unknown): { contractVersion: "bi-flow-v1"; projection: "flow"; revision: string; window: BiWindow; source: BiSource } {
  safeTree(value); const data = record(value);
  if (data.contractVersion !== "bi-flow-v1" || data.projection !== "flow" || typeof data.revision !== "string" || !/^[a-f0-9]{64}$/.test(data.revision)) throw new Error("BI流量响应契约无效");
  window(data.window); const source = record(data.source);
  if (source.source !== "flow" || !["ready", "unavailable"].includes(String(source.status)) || source.status === "unavailable" && source.data !== null) throw new Error("BI流量来源状态无效");
  flowData(source as BiSource);
  return value as ReturnType<typeof decodeBiFlowReply>;
}

export function operationsData(source: BiSource): BiOperations | null {
  if (source.status !== "ready" || !source.data) return null;
  const data = source.data;
  if (data.schemaVersion !== "workflow-bi-status-v1" || typeof data.mine !== "boolean") throw new Error("运营来源契约无效");
  number(data.uniqueAttentionCount, false, true); number(data.invalidDueDateCount, false, true);
  if (boundedArray(data.groups, 6).length !== 6) throw new Error("运营分组缺失");
  for (const value of data.groups as unknown[]) { const group = record(value); number(group.total, false, true); boundedArray(group.items, 20); if (typeof group.key !== "string" || typeof group.label !== "string") throw new Error("运营分组无效"); }
  return data as unknown as BiOperations;
}

export function inventoryData(source: BiSource): BiInventory | null {
  if (source.status !== "ready" || !source.data) return null;
  const data = source.data, gd = record(data.guangdong);
  if (data.schemaVersion !== "inventory-bi-cockpit-v1" || typeof data.hasInventory !== "boolean") throw new Error("库存来源契约无效");
  record(data.metrics); boundedArray(data.buckets, 6); boundedArray(gd.items, 20); record(gd.counts);
  for (const key of ["watchCount", "pendingCount", "total"]) number(gd[key], false, true);
  return data as unknown as BiInventory;
}

export function flowData(source: BiSource): BiFlow | null {
  if (source.status !== "ready" || !source.data) return null;
  const data = source.data;
  if (data.schemaVersion !== "netshop-bi-flow-v1" || !["ready", "unavailable"].includes(String(data.status))) throw new Error("流量来源契约无效");
  record(data.summary); boundedArray(data.shops, 100); boundedArray(data.platforms, 2); boundedArray(data.options, 100);
  const metrics = [data.summary, ...(data.shops as unknown[]).map(row => record(row).metrics), ...(data.platforms as unknown[]).map(row => record(row).metrics)];
  for (const values of metrics) for (const value of Object.values(record(values))) { const m = record(value); number(m.value); if (typeof m.status !== "string" || typeof m.unit !== "string" || !["available", "partial"].includes(m.status) && m.value !== null) throw new Error("流量不可用指标不能显示数值"); }
  return data as unknown as BiFlow;
}

export function decodeBiCockpit(value: unknown): BiCockpit {
  safeTree(value);
  const root = record(value);
  if (root.contractVersion !== "bi-cockpit-v1" || root.projection !== "cockpit" || typeof root.revision !== "string" || !/^[a-f0-9]{64}$/.test(root.revision)) throw new Error("BI版本未启用或契约不匹配");
  const erp = record(root.erp), periods = record(erp.periods), sales = record(erp.sales);
  if (periods.timezone !== "Asia/Shanghai") throw new Error("BI业务时区不匹配");
  for (const key of ["current", "previous", "yearAgo"]) { window(periods[key]); metric(sales[key]); }
  for (const row of boundedArray(sales.daily, 366)) metric(row);
  for (const row of boundedArray(erp.shops, 200)) { const item = record(row); metric(item.current); metric(item.previous); metric(item.yearAgo); number(item.yoy); number(item.deltaCents, true, true); }
  for (const row of boundedArray(erp.categories, 200)) { const item = record(row); metric(item.current); metric(item.previous); metric(item.yearAgo); number(item.yoy); number(item.mom); if (typeof item.name !== "string") throw new Error("BI分类无效"); }
  for (const row of boundedArray(erp.options, 200)) { const item = record(row); if (typeof item.platform !== "string" || typeof item.shop !== "string") throw new Error("BI店铺身份无效"); }
  const goals = record(root.goals);
  if (goals.basis !== "erp_net_sales" || boundedArray(goals.periods, 2).length !== 2) throw new Error("BI目标口径无效");
  for (const row of goals.periods as unknown[]) { const item = record(row); for (const key of ["targetCents", "actualCents"]) number(item[key], true, true); for (const key of ["completion", "pace", "mom", "yoy", "progressChangePp"]) number(item[key]); }
  for (const row of boundedArray(goals.items, 200)) { const item = record(row); if (item.basis !== "erp_net_sales") throw new Error("财报目标不能当ERP目标"); number(item.salesTargetCents, false, true); number(item.version, false, true); }
  const sources = record(root.sources);
  for (const key of ["targets", "operations", "inventory", "flow"]) {
    const source = record(sources[key]);
    if (!["ready", "unavailable"].includes(String(source.status)) || source.source !== key || source.status === "ready" && !source.data || source.status === "unavailable" && source.data !== null) throw new Error("BI所属来源状态无效");
  }
  operationsData(sources.operations as BiSource); inventoryData(sources.inventory as BiSource); flowData(sources.flow as BiSource);
  return value as BiCockpit;
}
