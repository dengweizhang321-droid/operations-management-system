import type { NetshopColumnProps } from "../shared/module-slots";
import type { ShopLocationContext } from "../../shell/shop-context";
import { netshopOutletKey, readNetshopOutletFilters } from "@/lib/netshop/query-contract";
import type { InsightPlatform } from "@/lib/netshop/insights-contract";
import { restoreProductScopeSeriesMetric, resolveProductScopeSeriesCoverage, type ProductScopeSeries, type ProductSeriesColumnKey } from "@/lib/netshop/product-scope-series-contract";

export const panoramaChapters = [
  ["performance", "01", "经营成绩与变化"], ["traffic", "02", "流量与成交"],
  ["products", "03", "商品结构"], ["promotion", "04", "推广经营"],
  ["margin", "05", "毛利与退货"], ["customers", "06", "客户与企业购"],
  ["targets", "07", "目标与复盘"], ["dataQuality", "08", "数据与口径"],
] as const;
export type PanoramaChapter = typeof panoramaChapters[number][0];
export const panoramaPageSizes = [5, 10, 20] as const;
export type PanoramaSeriesPeriod = "current" | "previous" | "yearAgo";
export const panoramaSeriesPeriodLabels = { current: "本期", previous: "环比基期", yearAgo: "同比基期" };
export const panoramaSeriesColumnLabels: Record<ProductSeriesColumnKey, string> = {
  payment: "平台成交", quantity: "成交件数", visitors: "商品访客累计", customers: "成交客户累计", conversion: "商品累计转化率", addCartRate: "加购客户率", refundPayment: "平台退款",
  pageViews: "商品浏览累计", favorites: "收藏累计", addCartCustomers: "加购客户累计", addCartQuantity: "加购件数", orderCustomers: "下单客户累计", orderQuantity: "下单件数", orderPayment: "下单金额", transactionOrders: "平台成交订单指标",
  searchImpressions: "搜索曝光", searchClicks: "搜索点击", searchVisitors: "搜索访客累计", searchCustomers: "搜索成交客户累计", searchClickRate: "搜索点击率", visitorValue: "商品访客价值",
};
export function panoramaGrainChange(grain: string): Partial<ShopLocationContext> {
  if (!["day", "week", "month"].includes(grain)) throw new Error("明细分组无效");
  return { grain: grain as ShopLocationContext["grain"], page: 1 };
}
/** Rendering projection only. Values, operands and field/day coverage are
 * restored by the owning decoder helpers, without aggregating browser rows. */
export function panoramaSeriesRows(dto: ProductScopeSeries, period: PanoramaSeriesPeriod, columns: readonly ProductSeriesColumnKey[], coverageColumn: ProductSeriesColumnKey) {
  return dto.series[period].map(point => {
    const metrics = columns.map(key => ({ key, metric: restoreProductScopeSeriesMetric(dto, point, key) }));
    const coverageMetric = restoreProductScopeSeriesMetric(dto, point, coverageColumn);
    const calendar = dto.grain === "day" && period === "current" ? dto.context.calendar.find(day => day.date === point.date) : undefined;
    return { date: point.date, endDate: point.endDate, metrics, coverage: resolveProductScopeSeriesCoverage(dto, coverageMetric.coverageRef), calendar };
  });
}
export function panoramaSeriesChartPoints(dto: ProductScopeSeries, period: PanoramaSeriesPeriod, key: ProductSeriesColumnKey) {
  return dto.series[period].map(point => ({ startDate: point.date, endDate: point.endDate, values: [restoreProductScopeSeriesMetric(dto, point, key)] }));
}

export function panoramaChapter(value: string): PanoramaChapter {
  return panoramaChapters.some(([key]) => key === value) ? value as PanoramaChapter : "performance";
}
export function panoramaPageSize(value: number): number {
  return panoramaPageSizes.some(size => size === value) ? value : 5;
}
/** An absent or multiple selection is never silently reduced to the first shop. */
export function panoramaShop(context: Pick<ShopLocationContext, "platforms" | "outlets" | "dimension">): { platform: InsightPlatform; shopName: string; key: string } | null {
  if (context.outlets.length !== 1) return null;
  try {
    const [shop] = readNetshopOutletFilters(context.outlets);
    if (!shop || !["京东", "天猫"].includes(shop.platform) || context.platforms.length && !context.platforms.includes(shop.platform as InsightPlatform) || shop.platform === "天猫" && context.dimension === "sku") return null;
    return { platform: shop.platform as InsightPlatform, shopName: shop.shopName, key: netshopOutletKey(shop.platform, shop.shopName) };
  } catch { return null; }
}
export function panoramaShopChange(key: string): Partial<ShopLocationContext> {
  if (!key) return { outlets: [], q: "", page: 1, product: null };
  const [shop] = readNetshopOutletFilters([key]);
  if (!shop || !["京东", "天猫"].includes(shop.platform)) throw new Error("请选择有效的授权店铺");
  return { platforms: [shop.platform as InsightPlatform], outlets: [netshopOutletKey(shop.platform, shop.shopName)], dimension: "spu", q: "", page: 1, product: null };
}
export function panoramaSearchChange(value: string): Partial<ShopLocationContext> {
  const q = value.trim();
  if (q.length > 120 || /[\u0000-\u001f\u007f]/.test(q)) throw new Error("搜索内容不能超过120个字符或包含控制字符");
  return { q, page: 1, section: "products", product: null };
}
export function panoramaPageSizeChange(value: number): Partial<ShopLocationContext> {
  if (!panoramaPageSizes.some(size => size === value)) throw new Error("每页条数无效");
  return { pageSize: value, page: 1, section: "products" };
}
export function panoramaPrincipalKey(props: Pick<NetshopColumnProps, "currentUser">): string {
  return JSON.stringify([props.currentUser?.email ?? "edge-local", props.currentUser?.role ?? "edge-local", props.currentUser?.scopeRestricted ?? false]);
}
/** Restricted principals do not expose their platform grants in browser props.
 * Require an explicit platform instead of guessing a two-platform request that
 * would correctly be denied by the authoritative reader. */
export function panoramaDirectoryQuery(props: Pick<NetshopColumnProps, "context" | "currentUser" | "startDate" | "endDate" | "periodKind">): URLSearchParams | null {
  const shop = panoramaShop(props.context);
  if (props.currentUser?.scopeRestricted && !props.context.platforms.length && !shop) return null;
  const platforms = props.context.platforms.length ? props.context.platforms : shop ? [shop.platform] : ["京东", "天猫"];
  const query = new URLSearchParams({ dimension: "spu", startDate: props.startDate, endDate: props.endDate, periodKind: props.periodKind });
  platforms.forEach(platform => query.append("platform", platform));
  return query;
}
export function panoramaQuery(props: Pick<NetshopColumnProps, "context" | "startDate" | "endDate" | "periodKind">): URLSearchParams | null {
  const shop = panoramaShop(props.context);
  if (!shop) return null;
  // All eight source envelopes are read together; a chapter is presentation
  // state in the shared shell, not a different business read.
  return new URLSearchParams({ platform: shop.platform, outlet: shop.key, dimension: props.context.dimension, startDate: props.startDate, endDate: props.endDate, periodKind: props.periodKind, section: "performance", q: props.context.q.trim(), page: String(props.context.page), pageSize: String(panoramaPageSize(props.context.pageSize)), grain: props.context.grain });
}
/** The owning product page token permits page changes only. Search, section,
 * page size, principal and every scope dimension get a new token family. */
export function panoramaTokenFamily(query: URLSearchParams, principal: string): string {
  const next = new URLSearchParams(query); next.delete("page"); next.delete("snapshotToken"); next.delete("sectionToken"); next.sort();
  return `${principal}:${next}`;
}
export function panoramaPageButtons(page: number, total: number, pageSize: number): Array<number | null> {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || page < 1 || page > 10000 || !Number.isSafeInteger(page)) return [];
  const last = Math.min(10000, Math.max(1, Math.ceil(total / pageSize)));
  const bounded = Math.min(last, page);
  const selected = new Set([1, last, bounded - 1, bounded, bounded + 1].filter(value => value >= 1 && value <= last));
  const result: Array<number | null> = [];
  [...selected].sort((a, b) => a - b).forEach(value => {
    const before = result.at(-1);
    if (typeof before === "number" && value > before + 1) result.push(null);
    result.push(value);
  });
  return result;
}
export function panoramaPresentationScope(props: Pick<NetshopColumnProps, "context" | "startDate" | "endDate" | "periodKind" | "currentUser">): string {
  return JSON.stringify([panoramaPrincipalKey(props), panoramaShop(props.context)?.key ?? null, props.context.dimension, props.startDate, props.endDate, props.periodKind, props.context.grain]);
}
export function panoramaScrollStorageKey(props: Pick<NetshopColumnProps, "context" | "startDate" | "endDate" | "periodKind" | "currentUser">): string {
  const query = panoramaQuery(props);
  return `panorama-scroll-v1:${panoramaPrincipalKey(props)}:${query?.toString() ?? "unselected"}:${panoramaChapter(props.context.section)}`;
}
export function decodePanoramaScroll(value: string | null): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 10_000_000 ? number : null;
}
