import { resolveNetshopQueryPeriod } from "@/lib/netshop/query-contract";
import type { InsightPlatform } from "@/lib/netshop/insights-contract";

/** Requested business intent. It carries no authority or proof of taxonomy. */
export type ComparisonIntentV1 = {
  schemaVersion: "comparison-scope-v1";
  mode: "shop" | "platform";
  metricSource: "platform" | "erp";
  selectedBaseline: { kind: "previous" | "yearAgo" } | { kind: "custom"; startDate: string; endDate: string };
  category: { mode: "all" | "unknown" } | { mode: "label_only"; platform: InsightPlatform; sourceId: string; label: string; evidenceVersion: string };
  coverageFilter: "all" | "complete" | "partial";
};
/** Presentation hints only; the owning reader validates metric and object keys. */
export const comparisonMetricKeys = ["payment", "quantity", "visitors", "customers", "conversion", "visitorValue", "transactionOrders", "spend", "attributedPayment", "roas", "ctr", "cpc", "spendRate", "erpNetSales", "orderMargin", "largeMargin", "largeMarginAmount", "erpNetQuantity", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate"] as const;
export const comparisonPresentationSorts = ["value_desc", "value_asc", "growth_desc", "decline_desc", "name_asc"] as const;
export type ComparisonPresentationPrefs = {
  schemaVersion: "comparison-ui-v1";
  metricKey: typeof comparisonMetricKeys[number];
  chartObjectKeys: string[];
  columnKeys: string[];
  sort: typeof comparisonPresentationSorts[number];
};
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function choice(value: unknown, allowed: readonly string[]): value is string { return typeof value === "string" && allowed.includes(value); }
function text(value: unknown, maximum: number, allowShopSeparator = false): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && !(allowShopSeparator ? /[\u0000-\u001e\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
}
export function decodeComparisonIntent(raw: string | null): ComparisonIntentV1 | null {
  if (!raw || raw.length > 2200) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!exact(value, ["schemaVersion", "mode", "metricSource", "selectedBaseline", "category", "coverageFilter"])
      || value.schemaVersion !== "comparison-scope-v1" || !choice(value.mode, ["shop", "platform"])
      || !choice(value.metricSource, ["platform", "erp"]) || !choice(value.coverageFilter, ["all", "complete", "partial"])) return null;
    const baseline = value.selectedBaseline;
    if (exact(baseline, ["kind"]) && choice(baseline.kind, ["previous", "yearAgo"])) { /* Original F semantics. */ }
    else if (exact(baseline, ["kind", "startDate", "endDate"]) && baseline.kind === "custom"
      && typeof baseline.startDate === "string" && typeof baseline.endDate === "string") {
      resolveNetshopQueryPeriod(baseline.startDate, baseline.endDate, 366);
    } else return null;
    const category = value.category;
    if (exact(category, ["mode"]) && choice(category.mode, ["all", "unknown"])) { /* No invented ID. */ }
    else if (!exact(category, ["mode", "platform", "sourceId", "label", "evidenceVersion"])
      || category.mode !== "label_only" || !choice(category.platform, ["京东", "天猫"])
      || !text(category.sourceId, 200) || !text(category.label, 120) || !text(category.evidenceVersion, 200)) return null;
    return value as ComparisonIntentV1;
  } catch { return null; }
}
export function decodeComparisonPresentationPrefs(raw: string | null): ComparisonPresentationPrefs | null {
  if (!raw || raw.length > 4600) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!exact(value, ["schemaVersion", "metricKey", "chartObjectKeys", "columnKeys", "sort"])
      || value.schemaVersion !== "comparison-ui-v1" || !choice(value.metricKey, comparisonMetricKeys) || !choice(value.sort, comparisonPresentationSorts)) return null;
    const { chartObjectKeys, columnKeys } = value;
    if (!Array.isArray(chartObjectKeys) || chartObjectKeys.length > 4 || !chartObjectKeys.every(key => text(key, 500, true))
      || new Set(chartObjectKeys).size !== chartObjectKeys.length || !Array.isArray(columnKeys) || columnKeys.length > 24
      || !columnKeys.every(key => text(key, 64)) || new Set(columnKeys).size !== columnKeys.length) return null;
    return value as ComparisonPresentationPrefs;
  } catch { return null; }
}
