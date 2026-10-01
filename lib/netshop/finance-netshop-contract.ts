/** Native finance month/year carrier, with separate source-presence annotations.
 * No D1 algorithm, field default, annual target spreading or daily interpolation.
 */
export const financeNetshopOperation = "netshop_finance_read_v1" as const;
export const financeNetshopSchema = "finance-netshop-read-v1" as const;
export const financeMetricKeys = [
  "grossSalesCents", "returnAmountCents", "netSalesCents", "netCostCents", "grossProfitCents",
  "grossMarginBps", "returnRateBps", "sellingExpenseCents", "smallProfitCents", "smallMarginBps",
  "otherExpenseCents", "profitCents", "profitMarginBps", "promotionExpenseCents", "promotionFeeRatioBps",
] as const;
export const financeSourceFields = [
  "gross_margin", "gross_profit", "gross_sales", "net_cost", "net_sales", "other_expense_total",
  "profit", "profit_margin", "return_amount", "selling_expense_total", "small_margin", "small_profit",
] as const;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = Record<string, unknown>;
type NativeMetrics = Record<typeof financeMetricKeys[number], number>;
export type FinanceNetshopRequest = {
  operation: typeof financeNetshopOperation; shopKeys: string[]; months: string[]; year: string;
  expiresAtEpochMs?: number; expectedRevision?: string; snapshotToken?: string;
};
export type FinanceMetricState = {
  value: number | null; unit: "CNY_CENT" | "BASIS_POINT"; status: "available" | "unavailable";
  reasonCode: null | "missing_month" | "unverified_source" | "missing_field" | "no_records";
};
type FieldEvidence = { shopKey: string; month: string; fields: Record<string, { rows: number; amountPresent: number; ratePresent: number }> };
type MonthEvidence = { month: string; status: string; batchRef: string | null; metadataVerified: boolean };
export type FinanceNativeMonthly = Record<string, Json> & {
  hasData: true; selectedMonths: string[]; previousMonths: string[]; yearAgoMonths: string[];
  current: NativeMetrics; previous: NativeMetrics | null; yearAgo: NativeMetrics | null; yearToDate: NativeMetrics;
};
export type FinanceNetshopDTO = {
  schemaVersion: typeof financeNetshopSchema; operation: typeof financeNetshopOperation; scopeKey: string; snapshotToken: string;
  requestedScope: { shopKeys: string[]; months: string[]; year: string };
  sourceRevisions: Array<{ domain: "finance"; kind: "owning_revision"; scopeKey: string; revision: string }>;
  monthly: {
    state: "ready" | "unavailable"; reasonCode: null | "no_scope_records";
    actualMonths: string[]; effectiveShopKeys: string[]; data: FinanceNativeMonthly | null;
    monthEvidence: MonthEvidence[]; fieldEvidence: FieldEvidence[]; comparisonMonthEvidence: MonthEvidence[];
    currentMetricStates: Record<typeof financeMetricKeys[number], FinanceMetricState>;
    comparisonMetricStates: { previous: Record<typeof financeMetricKeys[number], FinanceMetricState>; yearAgo: Record<typeof financeMetricKeys[number], FinanceMetricState> };
  };
  annual: { state: "ready" | "dependency_pending"; reasonCode: null | "annual_exact_scope_provider_pending";
    data: Record<string, Json> | null; rateFieldsVerification: { grossMarginBps: "unverified_source"; promotionFeeRatioBps: "unverified_source" } };
  metricSemantics: { monthlyBasis: "finance_month"; annualProgressBasis: "finance_year_progress";
    targetBasis: "finance_year_target"; nativeRatioUnit: "BASIS_POINT"; netshopIdentityMapping: "unverified";
    dailyAllocation: false; distributedSnapshot: false };
  limitations: string[];
};

const monthPattern = /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/;
const revisionPattern = /^(?:0|[1-9]\d*):[a-f0-9]{12}$/;
const amountFields: Record<string, string> = { grossSalesCents: "gross_sales", returnAmountCents: "return_amount",
  netSalesCents: "net_sales", netCostCents: "net_cost", grossProfitCents: "gross_profit",
  sellingExpenseCents: "selling_expense_total", smallProfitCents: "small_profit", otherExpenseCents: "other_expense_total" };
function fail(message: string): never { throw new Error("invalid_finance_netshop_contract: " + message); }
function object(v: unknown): RecordValue { if (!v || typeof v !== "object" || Array.isArray(v)) return fail("object"); return v as RecordValue; }
function closed(v: unknown, names: readonly string[]): RecordValue {
  const r = object(v); if (Object.keys(r).length !== names.length || names.some(k => !Object.hasOwn(r, k))) return fail("closed shape"); return r;
}
function integer(v: unknown, min = 0): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= min; }
function strings(v: unknown, max: number, pattern?: RegExp): v is string[] {
  return Array.isArray(v) && v.length <= max && v.every(s => typeof s === "string" && (!pattern || pattern.test(s))) && new Set(v).size === v.length;
}
function equal(a: unknown, b: unknown): boolean {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, value]) => [k, normalize(value)])) : v;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
function pair(key: string): string[] {
  let p: unknown; try { p = JSON.parse(key); } catch { return fail("native key"); }
  if (!Array.isArray(p) || p.length !== 2 || p.some(v => typeof v !== "string" || !v || v !== v.trim() || v.length > 100 || /[\u0000-\u001f\u007f]/.test(v)) || JSON.stringify(p) !== key) return fail("exact native pair");
  return p;
}
export function validateFinanceNetshopRequest(v: unknown): FinanceNetshopRequest {
  const r = object(v), allowed = ["operation", "shopKeys", "months", "year", "expiresAtEpochMs", "expectedRevision", "snapshotToken"];
  if (Object.keys(r).some(k => !allowed.includes(k)) || r.operation !== financeNetshopOperation
    || !strings(r.shopKeys, 50) || !r.shopKeys.length || !strings(r.months, 24, monthPattern) || !r.months.length
    || typeof r.year !== "string" || !/^(?:19|20|21)\d{2}$/.test(r.year)) return fail("request");
  r.shopKeys.forEach(pair);
  if (Object.hasOwn(r, "expiresAtEpochMs") && !integer(r.expiresAtEpochMs)
    || Object.hasOwn(r, "expectedRevision") && (typeof r.expectedRevision !== "string" || !revisionPattern.test(r.expectedRevision))
    || Object.hasOwn(r, "snapshotToken") && (typeof r.snapshotToken !== "string" || !/^[a-f0-9]{64}$/.test(r.snapshotToken))) return fail("request token");
  return { ...r, shopKeys: [...r.shopKeys].sort(), months: [...r.months].sort() } as FinanceNetshopRequest;
}
function safeJson(v: unknown, depth = 0): void {
  if (depth > 20) return fail("depth");
  if (typeof v === "number" && (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v))) return fail("unsafe scalar");
  if (v === null || ["string", "boolean", "number"].includes(typeof v)) return;
  if (Array.isArray(v)) { if (v.length > 20000) return fail("array bound"); v.forEach(x => safeJson(x, depth + 1)); return; }
  for (const value of Object.values(object(v))) safeJson(value, depth + 1);
}
function metrics(v: unknown): void { const r = closed(v, financeMetricKeys); if (Object.values(r).some(x => !integer(x, -Number.MAX_SAFE_INTEGER))) return fail("native metric units"); }
function targetValue(v: unknown): RecordValue {
  const r = closed(v, ["id", "periodType", "periodKey", "platform", "shopName", "category", "manager",
    "salesTargetCents", "profitTargetCents", "grossMarginBps", "smallMarginBps", "inventoryCleanupTargetCents",
    "promotionFeeRatioBps", "stagnantInventoryTargetCents", "version", "createdAt", "updatedAt"]);
  for (const key of ["id", "periodType", "periodKey", "platform", "shopName", "category", "manager", "createdAt", "updatedAt"]) {
    if (typeof r[key] !== "string" || r[key].length > 1000) return fail("native target text");
  }
  for (const key of ["salesTargetCents", "profitTargetCents", "grossMarginBps", "smallMarginBps",
    "inventoryCleanupTargetCents", "promotionFeeRatioBps", "stagnantInventoryTargetCents", "version"]) {
    if (!integer(r[key], -Number.MAX_SAFE_INTEGER)) return fail("native target units");
  }
  return r;
}
function monthEvidence(v: unknown, expected?: string[]): MonthEvidence[] {
  if (!Array.isArray(v) || v.length > 120) return fail("month evidence bound");
  const result = v.map(raw => {
    const r = closed(raw, ["month", "status", "batchRef", "metadataVerified"]);
    if (typeof r.month !== "string" || !monthPattern.test(r.month) || !["completed", "processing", "absent", "failed"].includes(String(r.status))
      || r.batchRef !== null && typeof r.batchRef !== "string" || typeof r.metadataVerified !== "boolean"
      || r.metadataVerified && (r.status !== "completed" || !r.batchRef)) return fail("month evidence");
    return r as MonthEvidence;
  });
  if (!equal(result.map(r => r.month), [...new Set(result.map(r => r.month))].sort()) || expected && !equal(result.map(r => r.month), expected)) return fail("month evidence scope");
  return result;
}
function nativeMonthly(v: unknown, months: string[], keys: string[]): FinanceNativeMonthly {
  const r = closed(v, ["hasData", "months", "monthPagination", "selectedMonth", "selectedMonths", "periodLabel",
    "previousMonth", "previousMonths", "yearAgoMonth", "yearAgoMonths", "current", "previous", "yearAgo", "yearToDate",
    "timeline", "targets", "progress", "expenses", "expensePagination", "shops", "shopPagination", "anomalies", "filters", "selection", "sync"]);
  if (!months.length || !keys.length || r.hasData !== true || !equal(r.selectedMonths, months) || r.selectedMonth !== months.at(-1)
    || !strings(r.previousMonths, 24, monthPattern) || !strings(r.yearAgoMonths, 24, monthPattern)) return fail("native actual months");
  if (typeof r.periodLabel !== "string" || !r.periodLabel || r.periodLabel.length > 500
    || r.previousMonth !== (r.previousMonths.length === 1 ? r.previousMonths[0] : null)
    || r.yearAgoMonth !== (r.yearAgoMonths.length === 1 ? r.yearAgoMonths[0] : null)) return fail("native month labels");
  metrics(r.current); metrics(r.yearToDate);
  for (const kind of ["previous", "yearAgo"] as const) {
    if (r[kind] !== null) metrics(r[kind]);
    if ((r[kind] === null) !== ((r[kind + "Months"] as string[]).length === 0)) return fail("native comparison");
  }
  const selection = closed(r.selection, ["allMonths", "truncated", "availableMonthCount", "months", "requestedMonths",
    "fallbackApplied", "platforms", "shops"]);
  if (!equal(selection.shops, keys) || selection.allMonths !== false || selection.fallbackApplied !== false || !equal(selection.months, months)) return fail("native owner selection");
  if (selection.truncated !== false || !integer(selection.availableMonthCount)
    || !equal(selection.requestedMonths, months) || !strings(selection.platforms, 50)) return fail("native selection scalars");
  if (!Array.isArray(r.months) || r.months.length > 144) return fail("native month options");
  for (const raw of r.months) {
    const m = closed(raw, ["month", "fileName", "importedAt", "shopCount", "subjectCount"]);
    if (typeof m.month !== "string" || !monthPattern.test(m.month) || typeof m.fileName !== "string"
      || typeof m.importedAt !== "string" || !integer(m.shopCount) || !integer(m.subjectCount)) return fail("native month scalars");
  }
  const sync = closed(r.sync, ["dataCutoffMonth", "sourceFileName", "importedAt"]);
  if (sync.dataCutoffMonth !== months.at(-1) || typeof sync.sourceFileName !== "string" || typeof sync.importedAt !== "string") return fail("native cutoff");
  if (!Array.isArray(r.shops) || r.shops.length > 500 || r.shops.some(raw => { const s = object(raw); metrics(s.actual); return typeof s.key !== "string" || !keys.includes(s.key); })) return fail("native shop identities");
  if (!Array.isArray(r.timeline) || r.timeline.length > 24 || r.timeline.some(raw => { const p = object(raw); return typeof p.month !== "string" || !monthPattern.test(p.month) || financeMetricKeys.some(k => !integer(p[k], -Number.MAX_SAFE_INTEGER)); })) return fail("native timeline");
  const targets = closed(r.targets, ["month", "year", "projects", "projectPagination", "periodPagination", "legacyCompatibility"]);
  for (const kind of ["month", "year"]) {
    const t = closed(targets[kind], ["salesTargetCents", "profitTargetCents", "smallMarginBps", "inventoryCleanupTargetCents",
      "promotionFeeRatioBps", "stagnantInventoryTargetCents", "targetCount"]);
    if (Object.values(t).some(n => !integer(n, -Number.MAX_SAFE_INTEGER)) || !integer(t.targetCount)) return fail("native target totals");
  }
  if (!Array.isArray(targets.projects) || targets.projects.length > 100) return fail("native projects");
  targets.projects.forEach(targetValue);
  for (const [name, countValue] of [["monthPagination", r.months.length], ["expensePagination", Array.isArray(r.expenses) ? r.expenses.length : -1], ["shopPagination", r.shops.length]] as const) {
    const p = closed(r[name], ["total", "returned", "truncated"]);
    if (!integer(p.total) || p.returned !== countValue || p.total < countValue || typeof p.truncated !== "boolean") return fail("native pagination");
  }
  for (const name of ["progress", "filters"]) object(r[name]);
  for (const name of ["months", "expenses", "anomalies"]) if (!Array.isArray(r[name])) return fail("native complete arrays");
  safeJson(r);
  return r as FinanceNativeMonthly;
}
function states(v: unknown, native: NativeMetrics | null, fields: FieldEvidence[], months: string[], meta: MonthEvidence[]): Record<typeof financeMetricKeys[number], FinanceMetricState> {
  const r = closed(v, financeMetricKeys), selected = fields.filter(f => months.includes(f.month));
  const completed = new Set(meta.filter(m => m.status === "completed").map(m => m.month));
  const verified = new Set(meta.filter(m => m.metadataVerified).map(m => m.month));
  const present = (e: FieldEvidence, key: string) => e.fields[key].rows > 0 && e.fields[key].amountPresent === e.fields[key].rows;
  for (const key of financeMetricKeys) {
    const state = closed(r[key], ["value", "unit", "status", "reasonCode"]);
    if (state.unit !== (key.endsWith("Bps") ? "BASIS_POINT" : "CNY_CENT")) return fail("annotated units");
    const valid = amountFields[key] ? selected.every(e => present(e, amountFields[key]))
      : key === "profitCents" ? selected.every(e => present(e, "profit"))
        || selected.every(e => e.fields.profit.rows === 0 && present(e, "small_profit") && present(e, "other_expense_total")) : false;
    let reason = native && months.every(m => verified.has(m)) && valid ? null
      : months.some(m => !completed.has(m)) ? "missing_month" : months.some(m => !verified.has(m)) ? "unverified_source"
        : native ? "missing_field" : "no_records";
    if (native && !amountFields[key] && key !== "profitCents") reason = "unverified_source";
    if (state.status !== (reason === null ? "available" : "unavailable") || state.reasonCode !== reason
      || state.value !== (reason === null ? native![key] : null)) return fail("default zero/presence annotation");
  }
  return r as Record<typeof financeMetricKeys[number], FinanceMetricState>;
}

export function decodeFinanceNetshop(value: unknown, request: unknown, owningRevision: string | null): FinanceNetshopDTO {
  const spec = validateFinanceNetshopRequest(request);
  const r = closed(value, ["schemaVersion", "operation", "scopeKey", "snapshotToken", "requestedScope", "sourceRevisions", "monthly", "annual", "metricSemantics", "limitations"]);
  if (r.schemaVersion !== financeNetshopSchema || r.operation !== financeNetshopOperation || typeof r.scopeKey !== "string"
    || !/^[a-f0-9]{64}$/.test(r.scopeKey) || typeof r.snapshotToken !== "string" || !/^[a-f0-9]{64}$/.test(r.snapshotToken)
    || !owningRevision || !revisionPattern.test(owningRevision)) return fail("envelope");
  if (!equal(r.metricSemantics, { monthlyBasis: "finance_month", annualProgressBasis: "finance_year_progress",
    targetBasis: "finance_year_target", nativeRatioUnit: "BASIS_POINT", netshopIdentityMapping: "unverified",
    dailyAllocation: false, distributedSnapshot: false })) return fail("native month/year basis");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 2 * 1024 * 1024) return fail("2MiB");
  if (!equal(r.requestedScope, { shopKeys: spec.shopKeys, months: spec.months, year: spec.year })
    || !equal(r.sourceRevisions, [{ domain: "finance", kind: "owning_revision", scopeKey: r.scopeKey, revision: owningRevision }])
    || spec.expectedRevision && spec.expectedRevision !== owningRevision || spec.snapshotToken && spec.snapshotToken !== r.snapshotToken) return fail("typed scope/revision");
  const monthly = closed(r.monthly, ["state", "reasonCode", "actualMonths", "effectiveShopKeys", "data", "monthEvidence",
    "fieldEvidence", "comparisonMonthEvidence", "currentMetricStates", "comparisonMetricStates"]);
  const meta = monthEvidence(monthly.monthEvidence, spec.months), comparisonsMeta = monthEvidence(monthly.comparisonMonthEvidence);
  if (!strings(monthly.actualMonths, 24, monthPattern) || !equal(monthly.actualMonths, meta.filter(m => m.status === "completed").map(m => m.month))
    || !strings(monthly.effectiveShopKeys, 50) || monthly.effectiveShopKeys.some(k => !spec.shopKeys.includes(k))) return fail("actual owner scope");
  const rawFields = monthly.fieldEvidence;
  if (!Array.isArray(rawFields) || rawFields.length !== spec.shopKeys.length * comparisonsMeta.length) return fail("complete field matrix");
  const seen = new Set<string>(), fields: FieldEvidence[] = rawFields.map(raw => {
    const e = closed(raw, ["shopKey", "month", "fields"]);
    if (typeof e.shopKey !== "string" || !spec.shopKeys.includes(e.shopKey) || typeof e.month !== "string" || !comparisonsMeta.some(m => m.month === e.month)) return fail("field scope");
    const identity = JSON.stringify([e.shopKey, e.month]); if (seen.has(identity)) return fail("duplicate field scope"); seen.add(identity);
    const entries = closed(e.fields, financeSourceFields);
    for (const value of Object.values(entries)) { const p = closed(value, ["rows", "amountPresent", "ratePresent"]);
      if (!integer(p.rows) || !integer(p.amountPresent) || !integer(p.ratePresent) || p.amountPresent > p.rows || p.ratePresent > p.rows) return fail("strict presence scalars"); }
    return e as FieldEvidence;
  });
  const data = monthly.data === null ? null : nativeMonthly(monthly.data, monthly.actualMonths, monthly.effectiveShopKeys);
  if (monthly.state !== (data ? "ready" : "unavailable") || monthly.reasonCode !== (data ? null : "no_scope_records")
    || data === null && monthly.effectiveShopKeys.length) return fail("monthly state");
  states(monthly.currentMetricStates, data?.current ?? null, fields, spec.months, meta);
  const comparisonStates = closed(monthly.comparisonMetricStates, ["previous", "yearAgo"]);
  for (const kind of ["previous", "yearAgo"] as const) states(comparisonStates[kind], data?.[kind] ?? null, fields, data?.[kind === "previous" ? "previousMonths" : "yearAgoMonths"] ?? [], comparisonsMeta);
  const annual = closed(r.annual, ["state", "reasonCode", "data", "rateFieldsVerification"]);
  if (!equal(annual.rateFieldsVerification, { grossMarginBps: "unverified_source", promotionFeeRatioBps: "unverified_source" })) return fail("annual unverified rates");
  if (annual.state === "dependency_pending") {
    if (annual.data !== null || annual.reasonCode !== "annual_exact_scope_provider_pending") return fail("pending annual");
  } else {
    if (annual.state !== "ready" || annual.reasonCode !== null) return fail("annual state");
    const a = closed(annual.data, ["year", "cutoffMonth", "availableMonths", "missingMonths", "items", "pagination"]);
    if (a.year !== spec.year || a.cutoffMonth !== null && (typeof a.cutoffMonth !== "string" || !monthPattern.test(a.cutoffMonth) || !a.cutoffMonth.startsWith(spec.year))
      || !strings(a.availableMonths, 12, monthPattern) || a.availableMonths.some(m => !m.startsWith(spec.year))
      || !strings(a.missingMonths, 12, monthPattern) || !Array.isArray(a.items) || a.items.length > spec.shopKeys.length) return fail("annual actual months");
    const itemKeys = new Set<string>();
    for (const raw of a.items) {
      const item = closed(raw, ["key", "platform", "shopName", "manager", "target", "netSalesCents", "profitCents", "salesProgress", "profitProgress",
        "grossMarginBps", "grossMarginGapBps", "promotionFeeRatioBps", "promotionFeeGapBps", "availableMonths", "missingMonths", "missingGrossMarginMonths"]);
      if (typeof item.key !== "string" || !spec.shopKeys.includes(item.key) || itemKeys.has(item.key)
        || !equal(pair(item.key), [item.platform, item.shopName]) || !strings(item.availableMonths, 12, monthPattern)
        || (item.netSalesCents === null) !== (item.availableMonths.length === 0) || (item.profitCents === null) !== (item.availableMonths.length === 0)) return fail("annual exact identities/absence");
      itemKeys.add(item.key);
      for (const k of ["netSalesCents", "profitCents", "grossMarginBps", "grossMarginGapBps", "promotionFeeRatioBps", "promotionFeeGapBps"]) if (item[k] !== null && !integer(item[k], -Number.MAX_SAFE_INTEGER)) return fail("annual units");
      const target = item.target === null ? null : targetValue(item.target);
      if (target && (target.periodType !== "year" || target.periodKey !== spec.year || target.platform !== item.platform || target.shopName !== item.shopName || target.category !== "")) return fail("whole-year target identity");
      for (const [valueKey, amountKey, goalKey] of [["salesProgress", "netSalesCents", "salesTargetCents"], ["profitProgress", "profitCents", "profitTargetCents"]]) {
        const goal = target?.[goalKey];
        const expected = item[amountKey] !== null && typeof goal === "number" && goal > 0 ? Number(item[amountKey]) / goal : null;
        if (item[valueKey] !== expected) return fail("native annual progress/zero target");
      }
    }
    const pagination = closed(a.pagination, ["page", "pageSize", "total", "returned", "truncated"]);
    if (pagination.page !== 1 || pagination.pageSize !== spec.shopKeys.length || pagination.total !== a.items.length
      || pagination.returned !== a.items.length || pagination.truncated !== false) return fail("complete exact annual candidates");
  }
  if (!Array.isArray(r.limitations) || r.limitations.length > 20 || r.limitations.some(s => typeof s !== "string" || s.length > 500)) return fail("limitations");
  safeJson(r);
  return r as FinanceNetshopDTO;
}
