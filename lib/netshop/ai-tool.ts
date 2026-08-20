import type { AppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductPerformance,
  getNetshopPromotionPerformance,
} from "@/lib/netshop/database";
import { NetshopQueryError, type NetshopOutletFilter } from "@/lib/netshop/query-contract";

type NetshopAiArgs = {
  dataset?: "product_daily" | "promotion";
  startDate?: string;
  endDate?: string;
  platform?: string;
  shop?: string;
  query?: string;
  limit?: number;
};

export async function getNetshopPerformanceForAi(rawArgs: unknown, principal: AppPrincipal) {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as NetshopAiArgs;
  const platformNames = netshopPlatformsForPrincipal(principal, args.platform ? [args.platform] : []);
  const shopName = typeof args.shop === "string" ? args.shop.trim() : "";
  if (shopName && (typeof args.platform !== "string" || !args.platform.trim())) {
    throw new NetshopQueryError("invalid_outlet_filter", "按店铺查询时必须同时提供平台");
  }
  const outlets: NetshopOutletFilter[] = shopName
    ? [{ platform: args.platform!.trim(), shopName }]
    : [];
  const limit = Math.max(1, Math.min(20, Math.trunc(Number(args.limit ?? 10)) || 10));
  const db = getNetshopDatabase();
  await ensureNetshopSchema(db);
  if (args.dataset === "promotion") {
    const result = await getNetshopPromotionPerformance(db, {
      startDate: args.startDate,
      endDate: args.endDate,
      platformNames,
      outlets,
      query: args.query,
      page: 1,
      pageSize: limit,
    });
    return {
      dataset: "promotion",
      monetaryUnit: result.monetaryUnit,
      requestedPeriod: result.requestedPeriod,
      dataCutoffDate: result.dataCutoffDate,
      coverage: result.coverage,
      summary: result.summary,
      returned: result.items.length,
      truncated: result.pagination.truncated,
      items: result.items,
    };
  }
  const result = await getNetshopProductPerformance(db, {
    dimension: "spu",
    startDate: args.startDate,
    endDate: args.endDate,
    platformNames,
    outlets,
    query: args.query,
    page: 1,
    pageSize: limit,
  });
  return {
    dataset: "product_daily",
    monetaryUnit: result.monetaryUnit,
    requestedPeriod: result.requestedPeriod,
    dataCutoffDate: result.dataCutoffDate,
    visitorAggregation: result.visitorAggregation,
    coverage: result.coverage,
    summary: result.summary,
    returned: result.items.length,
    truncated: result.pagination.truncated,
    items: result.items,
  };
}
