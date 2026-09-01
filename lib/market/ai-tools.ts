import {
  getMarketBrandAnalysisForAi,
  getMarketOverviewForAi,
  getMarketPendingReviewSummaryForAi,
  getMarketPriceBandAnalysisForAi,
} from "@/lib/market/admin-service";
import type { AppPrincipal } from "@/lib/auth/authorization";

export async function callMarketTool(
  name: string,
  args: Record<string, unknown>,
  principal: AppPrincipal,
): Promise<Record<string, unknown>> {
  const { getMarketDatabase, getMarketItemTrend } = await import("@/lib/market/database");
  const { ensureMarketAdminSchema } = await import("@/lib/market/admin-service");
  const { ensureMarketNetshopProjection } = await import("@/lib/market/netshop-projection");
  const db = getMarketDatabase();
  await ensureMarketAdminSchema(db);
  await ensureMarketNetshopProjection(db, principal);
  if (name === "get_market_overview") return getMarketOverviewForAi(db, args, principal);
  if (name === "get_market_brand_analysis") return getMarketBrandAnalysisForAi(db, args, principal);
  if (name === "get_market_price_band_analysis") return getMarketPriceBandAnalysisForAi(db, args, principal);
  if (name === "get_market_pending_review_summary") return getMarketPendingReviewSummaryForAi(db, args);
  if (name === "get_market_sku_trend") {
    const skuCode = stringArg(args.skuCode, "skuCode", 80);
    const category = stringArg(args.category, "category", 120);
    const scope = stringArg(args.scope, "scope", 120);
    const dimension = stringArg(args.rankingDimension, "rankingDimension", 3);
    if (dimension !== "SKU" && dimension !== "SPU") throw new Error("rankingDimension must be SKU or SPU");
    const trend = await getMarketItemTrend(db, {
      skuCode,
      category,
      scope,
      rankingDimension: dimension,
    });
    const limit = integer(args.limit, 24, 1, 60);
    return {
      skuCode,
      category,
      scope,
      rankingDimension: dimension,
      returned: Math.min(trend.items.length, limit),
      truncated: trend.items.length > limit,
      items: trend.items.slice(-limit),
      currency: "CNY",
      monetaryUnit: "cents",
      basis: "current_top_ranking_coverage",
    };
  }
  throw new Error("market tool is not registered");
}

function stringArg(value: unknown, name: string, maxLength: number) {
  const normalized = optionalString(value, maxLength);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("string argument expected");
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (Array.from(normalized).length > maxLength) throw new Error("string argument too long");
  return normalized;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`integer argument must be between ${min} and ${max}`);
  }
  return value;
}
