/** Internal whole-shop P projection; no route, UI, grant or alternate fact store. */
import {
  decodeDerivedMoneyPerCount, decodeInsightsContextForQuery, decodeMetric,
  sameRevisionVector, validateContextQuery, type DerivedMoneyPerCountV1,
  type InsightsContext, type MetricValue, type SourceRevision, type SourceCoverage,
} from "./insights-contract";
import { resolveNetshopPeriods } from "./periods";

export const productScopeSeriesSchema = "netshop-product-scope-series-v1" as const;
export const productScopeSeriesProjection = "point-field-cells-v1" as const;
export const productSeriesFields = [
  "payment", "quantity", "visitors", "customers", "addCartCustomers", "refundPayment",
  "pageViews", "favorites", "addCartQuantity", "orderCustomers", "orderQuantity",
  "orderPayment", "transactionOrders", "searchImpressions", "searchClicks",
  "searchVisitors", "searchCustomers",
] as const;
export const productSeriesColumns = [
  "payment", "quantity", "visitors", "customers", "conversion", "addCartRate", "refundPayment",
  "pageViews", "favorites", "addCartCustomers", "addCartQuantity", "orderCustomers",
  "orderQuantity", "orderPayment", "transactionOrders", "searchImpressions", "searchClicks",
  "searchVisitors", "searchCustomers", "searchClickRate", "visitorValue",
] as const;
export type ProductSeriesColumnKey = typeof productSeriesColumns[number];
type Period = "current" | "previous" | "yearAgo";
type Grain = "day" | "week" | "month";
type Status = MetricValue["status"];
export type ProductSeriesCell = [
  number | null, Status, MetricValue["reasonCode"], number, number | null, number | null,
];
export type ProductSeriesColumn = {
  key: ProductSeriesColumnKey; unit: MetricValue["unit"] | "CNY_CENT_PER_COUNT";
  basis: "product_day_sum"; aggregation: "sum" | "ratio_of_sums"; sourceIds: string[]; fields: string[];
  metricSchemaVersion?: "netshop-money-per-count-v1"; denominatorKind?: "product_day_visitors_sum";
};
export type ProductSeriesCoverage = {
  sourceId: string; shopKey: string; dates: string[]; observedDates: string[];
  rows: number; presentCounts: number[]; missingFieldDates: string[][];
};
export type ProductSeriesPoint = { date: string; endDate: string; coverageRef: string; cells: ProductSeriesCell[] };
export type ProductScopeSeries = {
  schemaVersion: typeof productScopeSeriesSchema; projection: typeof productScopeSeriesProjection;
  context: InsightsContext; grain: Grain; columnDefinitions: ProductSeriesColumn[];
  coverageFields: string[]; pointCoverage: Record<string, ProductSeriesCoverage>;
  series: Record<Period, ProductSeriesPoint[]>; joinedSourceRevisions: SourceRevision[];
  consistency: "revision_vector_checked"; sectionToken: string; limitations: string[];
};

function fail(message: string): never { throw new Error("invalid_product_scope_series: " + message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("object");
  return value as Record<string, unknown>;
}
function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const r = record(value);
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) return fail("closed fields");
  return r;
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)]));
  return v;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function safe(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v); }
function count(v: unknown, max = Number.MAX_SAFE_INTEGER): v is number { return safe(v) && v >= 0 && v <= max; }
function token(v: unknown): v is string { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
function dates(start: string, end: string): string[] {
  const result: string[] = [], last = Date.parse(end + "T00:00:00Z");
  for (let n = Date.parse(start + "T00:00:00Z"); n <= last; n += 86_400_000) result.push(new Date(n).toISOString().slice(0, 10));
  return result;
}
function groups(start: string, end: string, grain: Grain): string[][] {
  const values = dates(start, end), result: string[][] = [];
  for (const day of values) {
    const previous = result.at(-1);
    const boundary = grain === "day" || grain === "month" && previous?.[0].slice(0, 7) !== day.slice(0, 7)
      || grain === "week" && new Date(day + "T00:00:00Z").getUTCDay() === 1;
    if (!previous || boundary) result.push([day]); else previous.push(day);
  }
  return result;
}
function fieldDependencies(key: string): string[] {
  return ({ conversion: ["customers", "visitors"], addCartRate: ["addCartCustomers", "visitors"],
    searchClickRate: ["searchClicks", "searchImpressions"], visitorValue: ["payment", "visitors"] } as Record<string, string[]>)[key] ?? [key];
}
function columnDefinition(key: ProductSeriesColumnKey, sourceId: string): ProductSeriesColumn {
  const ratio = ["conversion", "addCartRate", "searchClickRate", "visitorValue"].includes(key);
  const money = ["payment", "refundPayment", "orderPayment"].includes(key);
  return {
    key, unit: key === "visitorValue" ? "CNY_CENT_PER_COUNT" : ratio ? "RATIO" : money ? "CNY_CENT" : "COUNT",
    basis: "product_day_sum", aggregation: ratio ? "ratio_of_sums" : "sum",
    sourceIds: [sourceId], fields: fieldDependencies(key),
    ...(key === "visitorValue" ? { metricSchemaVersion: "netshop-money-per-count-v1" as const, denominatorKind: "product_day_visitors_sum" as const } : {}),
  };
}
export function validateProductScopeSeriesQuery(query: URLSearchParams) {
  if (query.getAll("grain").length > 1) return fail("duplicate grain");
  const grain = query.get("grain") ?? "day";
  if (!["day", "week", "month"].includes(grain)) return fail("grain");
  const shared = new URLSearchParams(query); shared.delete("grain");
  const scope = validateContextQuery(shared);
  if (scope.platforms.length !== 1 || scope.shops.length !== 1) return fail("explicit single shop");
  return { shared, grain: grain as Grain, scope };
}

/** Rebuild the original scalar/derived metric from the explicit v1 projection.
 * Its ref is resolvable as pointCoverage[point.coverageRef] + column fields.
 */
export function restoreProductScopeSeriesMetric(
  dto: ProductScopeSeries, point: ProductSeriesPoint, key: ProductSeriesColumnKey,
): MetricValue | DerivedMoneyPerCountV1 {
  const index = productSeriesColumns.indexOf(key), column = dto.columnDefinitions[index], cell = point.cells[index];
  if (!column || !cell || cell[3] !== index || !dto.pointCoverage[point.coverageRef]) return fail("metric reference");
  const metric = {
    value: cell[0], status: cell[1], reasonCode: cell[2], coverageRef: point.coverageRef + "#" + index,
    unit: column.unit, basis: column.basis, sourceIds: column.sourceIds, aggregation: column.aggregation,
    ...(column.aggregation === "ratio_of_sums" ? { numerator: cell[4], denominator: cell[5] } : {}),
    ...(key === "visitorValue" ? { metricSchemaVersion: column.metricSchemaVersion, denominatorKind: column.denominatorKind } : {}),
  };
  return key === "visitorValue" ? decodeDerivedMoneyPerCount(metric) : decodeMetric(metric);
}

/** Resolve a reconstructed metric ref to exact same-source field/day coverage. */
export function resolveProductScopeSeriesCoverage(dto: ProductScopeSeries, metricRef: string): SourceCoverage & {
  sourceId: string; fields: string[];
} {
  const match = /^(series:(?:current|previous|yearAgo):\d{4}-\d{2}-\d{2})#([0-9]+)$/.exec(metricRef);
  if (!match || String(Number(match[2])) !== match[2]) return fail("field coverage ref");
  const point = dto.pointCoverage[match[1]], column = dto.columnDefinitions[Number(match[2])];
  if (!point || !column) return fail("unresolved field coverage");
  const missing = new Set(column.fields.flatMap(field => point.missingFieldDates[productSeriesFields.indexOf(field as typeof productSeriesFields[number])]));
  const missingDates = point.dates.filter(day => missing.has(day)), covered = point.dates.length - missingDates.length;
  return { sourceId: point.sourceId, fields: column.fields, expectedShopDatePairs: point.dates.length,
    coveredShopDatePairs: covered, complete: covered === point.dates.length,
    missingByShop: missingDates.length ? [{ shopKey: point.shopKey, dates: missingDates }] : [], truncated: false };
}

export function decodeProductScopeSeries(
  value: unknown, query: URLSearchParams, owningRevision: string | null,
): ProductScopeSeries {
  const validated = validateProductScopeSeriesQuery(query);
  const v = closed(value, ["schemaVersion", "projection", "context", "grain", "columnDefinitions", "coverageFields",
    "pointCoverage", "series", "joinedSourceRevisions", "consistency", "sectionToken", "limitations"]);
  if (v.schemaVersion !== productScopeSeriesSchema || v.projection !== productScopeSeriesProjection
    || v.grain !== validated.grain || !token(v.sectionToken) || v.consistency !== "revision_vector_checked") return fail("identity");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 2 * 1024 * 1024) return fail("2MiB");
  const context = decodeInsightsContextForQuery(v.context, validated.shared, owningRevision);
  const expectedPeriods = resolveNetshopPeriods(context.periods.current.startDate, context.periods.current.endDate, context.effectiveScope.periodKind);
  if (!same(context.periods, expectedPeriods)) return fail("actual derived periods");
  const [platform] = context.effectiveScope.platforms, [shopKey] = context.effectiveScope.shopKeys;
  if (context.effectiveScope.platforms.length !== 1 || context.effectiveScope.shopKeys.length !== 1
    || shopKey !== context.requestedScope.shopKeys[0]) return fail("effective scope");
  const source = platform === "京东" ? "jd_sku_daily" : "tmall_product_daily";
  const dataset = context.effectiveScope.dimension + "_daily";
  const fullSource = source + ":" + dataset + ":" + platform;
  if (!Array.isArray(v.columnDefinitions) || v.columnDefinitions.length !== productSeriesColumns.length
    || !same(v.coverageFields, productSeriesFields)) return fail("projection definitions");
  const columns = productSeriesColumns.map((key, index) => {
    const expected = columnDefinition(key, source), actual = closed((v.columnDefinitions as unknown[])[index], Object.keys(expected));
    for (const name of Object.keys(expected)) if (!same(actual[name], expected[name as keyof typeof expected])) return fail("column semantics");
    return actual as ProductSeriesColumn;
  });
  if (!Array.isArray(v.joinedSourceRevisions)
    || !sameRevisionVector(v.joinedSourceRevisions as SourceRevision[], context.sourceRevisions)
    || !same(v.joinedSourceRevisions, context.sourceRevisions)) return fail("typed revision vector");
  if (!Array.isArray(v.limitations) || v.limitations.length > 20
    || v.limitations.some(s => typeof s !== "string" || !s || s.length > 500)) return fail("limitations");
  const series = closed(v.series, ["current", "previous", "yearAgo"]), coverages = record(v.pointCoverage);
  const refs = new Set<string>();
  const dto = { ...v, context, columnDefinitions: columns } as ProductScopeSeries;
  for (const period of ["current", "previous", "yearAgo"] as const) {
    const window = context.periods[period], expectedGroups = groups(window.startDate, window.endDate, validated.grain);
    const points = series[period];
    if (!Array.isArray(points) || points.length !== expectedGroups.length) return fail("complete actual period");
    const fullMissing = new Set(context.coverageBySource[fullSource + ":" + period].missingByShop.flatMap(r => r.dates));
    for (let index = 0; index < points.length; index++) {
      const point = closed(points[index], ["date", "endDate", "coverageRef", "cells"]);
      const group = expectedGroups[index], ref = "series:" + period + ":" + group[0];
      if (point.date !== group[0] || point.endDate !== group.at(-1) || point.coverageRef !== ref || refs.has(ref)) return fail("point period reference");
      refs.add(ref);
      const coverage = closed(coverages[ref], ["sourceId", "shopKey", "dates", "observedDates", "rows", "presentCounts", "missingFieldDates"]);
      if (coverage.sourceId !== fullSource || coverage.shopKey !== shopKey || !same(coverage.dates, group)
        || !Array.isArray(coverage.observedDates) || !same(coverage.observedDates, group.filter(d => (coverage.observedDates as unknown[]).includes(d)))
        || coverage.observedDates.some(d => fullMissing.has(d)) || !count(coverage.rows)
        || coverage.rows < coverage.observedDates.length || (coverage.rows === 0) !== (coverage.observedDates.length === 0)
        || !Array.isArray(coverage.presentCounts) || coverage.presentCounts.length !== productSeriesFields.length
        || coverage.presentCounts.some(n => !count(n, coverage.rows as number))
        || !Array.isArray(coverage.missingFieldDates) || coverage.missingFieldDates.length !== productSeriesFields.length) return fail("point field coverage");
      const absentDates = group.filter(d => !(coverage.observedDates as string[]).includes(d));
      for (let fieldIndex = 0; fieldIndex < productSeriesFields.length; fieldIndex++) {
        const missing = coverage.missingFieldDates[fieldIndex], present = coverage.presentCounts[fieldIndex];
        if (!Array.isArray(missing) || !same(missing, group.filter(d => missing.includes(d)))
          || absentDates.some(d => !missing.includes(d))
          || present === coverage.rows && !same(missing, absentDates)
          || present === 0 && !same(missing, group)
          || present < coverage.rows && !missing.some(d => (coverage.observedDates as string[]).includes(d))) return fail("field missing dates");
      }
      if (!Array.isArray(point.cells) || point.cells.length !== columns.length) return fail("complete cells");
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
        const column = columns[columnIndex], raw = point.cells[columnIndex];
        if (!Array.isArray(raw) || raw.length !== 6 || raw[3] !== columnIndex
          || raw[0] !== null && (typeof raw[0] !== "number" || !Number.isFinite(raw[0]))
          || raw[4] !== null && !safe(raw[4]) || raw[5] !== null && !safe(raw[5])) return fail("strict cell");
        const metric = restoreProductScopeSeriesMetric(dto, point as ProductSeriesPoint, column.key);
        resolveProductScopeSeriesCoverage(dto, metric.coverageRef);
        if (column.aggregation === "sum") {
          if (raw[4] !== null || raw[5] !== null) return fail("additive ratio fields");
          const field = productSeriesFields.indexOf(column.key as typeof productSeriesFields[number]);
          const present = coverage.presentCounts[field] as number, rows = coverage.rows as number;
          const reason = !rows ? "no_records" : present < rows ? "missing_field" : coverage.observedDates.length < group.length ? "missing_day" : null;
          const status = reason === null ? "available" : present ? "partial" : "unavailable";
          if (metric.status === "invalid") {
            if (!present || metric.reasonCode !== "unsafe_integer" || metric.value !== null) return fail("invalid source evidence");
          } else if (metric.status !== status || metric.reasonCode !== reason || present === 0 && metric.value !== null) return fail("zero or field status");
        } else {
          const [numerator, denominator] = column.fields.map(field => restoreProductScopeSeriesMetric(dto, point as ProductSeriesPoint, field as ProductSeriesColumnKey));
          if (raw[4] !== numerator.value || raw[5] !== denominator.value) return fail("same-source summed operands");
          const invalid = column.key === "visitorValue" && [numerator, denominator].some(m => m.status === "invalid");
          const reason = invalid ? "unsafe_integer" : numerator.status !== "available" || denominator.status !== "available" ? "incomplete_coverage"
            : denominator.value === 0 ? "zero_denominator" : Number(denominator.value) < 0 ? "negative_denominator" : null;
          const status = invalid ? "invalid" : reason === null ? "available" : "unavailable";
          if (metric.status !== status || metric.reasonCode !== reason
            || reason === null && metric.value !== Number(numerator.value) / Number(denominator.value)) return fail("weighted ratio semantics");
        }
      }
    }
  }
  if (Object.keys(coverages).length !== refs.size || Object.keys(coverages).some(ref => !refs.has(ref))) return fail("unresolved coverage");
  return dto;
}
