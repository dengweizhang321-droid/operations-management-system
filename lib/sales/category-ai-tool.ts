import type { AppPrincipal } from "@/lib/auth/authorization";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";
import {
  getSalesCategoryAnalysis,
  salesCategorySortKeys,
  type SalesCategorySortKey,
} from "@/lib/sales/category-analysis";
import { ensureSalesSchema, getSalesDatabase } from "@/lib/sales/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function list(value: unknown, maximumItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 120)).filter(Boolean))].slice(0, maximumItems);
}

function integer(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.trunc(parsed)) : fallback;
}

export async function getSalesCategoryAnalysisForAi(rawArgs: unknown, principal: AppPrincipal) {
  const args = record(rawArgs);
  const startDate = text(args.startDate, 10);
  const endDate = text(args.endDate, 10);
  const sortCandidate = text(args.sortBy, 40);
  const sortBy = salesCategorySortKeys.includes(sortCandidate as SalesCategorySortKey)
    ? sortCandidate as SalesCategorySortKey
    : "netSalesCents";
  const db = getSalesDatabase();
  await Promise.all([ensureSalesSchema(db), ensureErpReferenceSchema(db)]);
  const result = await getSalesCategoryAnalysis(db, {
    startDate,
    endDate,
    categories: list(args.categories, 20),
    channels: list(args.channels, 20),
    platforms: list(args.platforms, 20),
    productQueries: list(args.productQueries, 20),
    granularity: "month",
    sortBy,
    direction: args.direction === "asc" ? "asc" : "desc",
    page: 1,
    pageSize: integer(args.limit, 20, 50),
  }, principal);
  return {
    range: result.range,
    comparisonPeriods: result.comparisonPeriods,
    dataCutoffDate: result.dataCutoffDate,
    categoryHierarchy: result.categoryHierarchy,
    filtersApplied: result.filtersApplied,
    summary: result.summary,
    uncategorized: result.uncategorized,
    ranking: result.ranking,
    trend: result.trend,
    items: result.details.items,
    totalMatched: result.details.pagination.total,
    returned: result.details.pagination.returned,
    truncated: result.details.pagination.truncated,
  };
}
