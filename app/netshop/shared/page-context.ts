import type { AiPageDetails } from "../../ai-page-context-provider";
import type { ShopLocationContext } from "../../shell/shop-context";
import { normalizeAiPageFilters, type AiPageFilters } from "@/lib/ai/page-context";

/** Selected page scope only. Owning readers still establish facts and authority. */
export function netshopColumnPageDetails(view: string, context: ShopLocationContext, periodKind?: string): AiPageDetails {
  const datasets: Record<string, string> = { analysis: "netshop_panorama", platforms: "netshop_comparison", products: "netshop_product_insights", promotion: "netshop_promotion_insights" };
  const filters: AiPageFilters = {
    dataset: datasets[view], platforms: context.platforms, outletKeys: context.outlets,
    ...(view !== "promotion" ? { rankingDimension: context.product?.dimension ?? context.dimension } : {}),
    query: context.q, trendGrain: context.grain, periodKind,
  };
  if (context.product) filters[context.product.dimension === "sku" ? "skus" : "spus"] = [context.product.id];
  if (context.category) filters.categories = [context.category];
  if (view === "platforms") {
    const intent = context.comparisonIntent;
    filters.comparisonMode = intent?.mode ?? "shop";
    filters.metricSource = intent?.metricSource ?? "platform";
    filters.baselineKind = intent?.selectedBaseline.kind ?? "previous";
    filters.categoryMode = intent?.category.mode ?? "all";
    filters.coverageFilter = intent?.coverageFilter ?? "all";
    if (intent?.selectedBaseline.kind === "custom") {
      filters.baselineStartDate = intent.selectedBaseline.startDate;
      filters.baselineEndDate = intent.selectedBaseline.endDate;
    }
    if (intent?.category.mode === "label_only") {
      filters.categories = [intent.category.label];
      filters.categoryPlatform = intent.category.platform;
      filters.categorySource = intent.category.sourceId;
      filters.categoryEvidence = intent.category.evidenceVersion;
    }
    if (context.comparisonPrefs) filters.metricKey = context.comparisonPrefs.metricKey;
  }
  const normalized = normalizeAiPageFilters(filters);
  if (normalized === null) return { blockedReason: "当前网店选择超过页面上下文上限。请缩小选择，或移除页面上下文后提问。" };
  return { filters: normalized, ...(view === "analysis" && context.outlets.length !== 1 ? { blockedReason: "先选择一个店铺，再询问当前全景页面。" } : {}) };
}
