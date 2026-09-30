import type { ShopLocationContext } from "../../shell/shop-context";

export const productSortOptions = [
  ["payment_desc", "平台销售额从高到低"], ["payment_asc", "平台销售额从低到高"],
  ["visitors_desc", "访客累计从高到低"], ["visitors_asc", "访客累计从低到高"],
  ["conversion_desc", "转化率从高到低"], ["conversion_asc", "转化率从低到高"],
  ["growth_desc", "销售额增长贡献"], ["decline_desc", "销售额下降贡献"],
] as const;
export type ProductSort = typeof productSortOptions[number][0];
export type ProductColumnGroup = "traffic" | "comparison" | "association" | "coverage";
export type ProductsUiState = {
  sort: ProductSort;
  columns: Record<ProductColumnGroup, boolean>;
  gallery: boolean;
  detailSource: "platform" | "promotion" | "erp";
  topic: "home" | "growth" | "traffic" | "list";
};
export type ProductsUiChange = (value: ProductsUiState, patch?: Partial<ShopLocationContext>) => void;
export const defaultProductsUiState: ProductsUiState = {
  sort: "payment_desc", columns: { traffic: true, comparison: true, association: true, coverage: true }, gallery: false, detailSource: "platform", topic: "home",
};

/** Local presentation settings survive a shell drill/return. They contain no
 * results or source tokens and cannot authorize an API scope. */
export function productsUiStorageKey(context: ShopLocationContext, startDate: string, endDate: string, principal: string, periodKind = "custom") {
  return `netshop-products-ui-v1:${JSON.stringify([principal, startDate, endDate, periodKind, [...context.platforms].sort(), [...context.outlets].sort(), context.dimension])}`;
}
export function decodeProductsUiState(raw: string | null): ProductsUiState {
  const fallback = () => ({ ...defaultProductsUiState, columns: { ...defaultProductsUiState.columns } });
  if (!raw || raw.length > 1500) return fallback();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fallback();
    const v = value as Record<string, unknown>;
    const keys = ["sort", "columns", "gallery", "detailSource", "topic"];
    if (Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key)) || typeof v.sort !== "string" || !productSortOptions.some(([key]) => key === v.sort) || typeof v.gallery !== "boolean" || typeof v.detailSource !== "string" || !["platform", "promotion", "erp"].includes(v.detailSource) || typeof v.topic !== "string" || !["home", "growth", "traffic", "list"].includes(v.topic)) return fallback();
    if (!v.columns || typeof v.columns !== "object" || Array.isArray(v.columns) || Object.getPrototypeOf(v.columns) !== Object.prototype) return fallback();
    const c = v.columns as Record<string, unknown>;
    const columnKeys = Object.keys(defaultProductsUiState.columns);
    if (Object.keys(c).length !== columnKeys.length || Object.keys(c).some(key => !columnKeys.includes(key)) || columnKeys.some(key => typeof c[key] !== "boolean")) return fallback();
    return {
      sort: v.sort as ProductSort,
      columns: { traffic: c.traffic, comparison: c.comparison, association: c.association, coverage: c.coverage } as ProductsUiState["columns"],
      gallery: v.gallery,
      detailSource: v.detailSource as ProductsUiState["detailSource"],
      topic: v.topic as ProductsUiState["topic"],
    };
  } catch { return fallback(); }
}
export function safeProductUrl(raw: string | null | undefined) {
  if (!raw || raw.length > 2000) return null;
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function safeProductImageUrl(raw: string | null | undefined) {
  // Preserve the existing authenticated Tmall asset path. Product links still
  // require an explicit HTTP(S) URL; arbitrary relative URLs are not accepted.
  return raw && /^\/api\/netshop\/product-images\/[a-f0-9]{64}$/.test(raw) ? raw : safeProductUrl(raw);
}
export const productReasonLabels: Record<string, string> = {
  no_records: "未导入记录", missing_day: "缺少日期", missing_field: "来源缺少字段", not_applicable: "当前来源不适用",
  unmapped: "未关联", ambiguous_mapping: "关联不唯一", zero_denominator: "分母为零", negative_denominator: "分母为负",
  incomplete_baseline: "基期覆盖不足", negative_baseline: "基期为负", unverified_source: "来源未核验",
  attribution_window_unknown: "归因窗口未核验", unsafe_integer: "数值超出安全范围", incomplete_coverage: "范围覆盖不足",
  no_comparable_date: "没有对应比较日", promotion_not_ready: "推广来源未就绪", promotion_mismatch: "推广与原始来源不一致",
  missingImage: "缺少图片", missingCode: "缺少商家编码", missingCategory: "缺少类目", conflict: "资料冲突", stale: "资料陈旧", mapping_unverified: "ERP映射未核验",
};
export const productMappingLabels = { verified: "已验证关联", unmapped: "未关联", ambiguous: "关联不唯一", unverified: "关联未核验" } as const;
