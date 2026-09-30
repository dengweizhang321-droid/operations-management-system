import { readNetshopOutletFilters, netshopOutletKey } from "@/lib/netshop/query-contract";
import { encodeProductIdentity, type ProductIdentity, type InsightPlatform } from "@/lib/netshop/insights-contract";

export type ShopLocationContext = {
  platforms: InsightPlatform[]; outlets: string[]; dimension: "sku" | "spu";
  previous: boolean; yearAgo: boolean; grain: "day" | "week" | "month";
  section: string; category: string; q: string; page: number; pageSize: number;
  product: ProductIdentity | null; returnTo: string | null;
};
export const shopContextKeys = ["shopPlatform", "shopOutlet", "shopDimension", "shopPrevious", "shopYearAgo", "shopGrain", "shopSection", "shopCategory", "shopQ", "shopPage", "shopPageSize", "shopProduct", "shopReturn"] as const;
export const defaultShopLocationContext: ShopLocationContext = { platforms: [], outlets: [], dimension: "spu", previous: true, yearAgo: true, grain: "day", section: "", category: "", q: "", page: 1, pageSize: 20, product: null, returnTo: null };

function single(params: URLSearchParams, key: string): string | null { const values = params.getAll(key); return values.length === 1 ? values[0] : null; }
function boundedText(value: string | null, limit: number) { return value && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value) ? value : ""; }
function positive(value: string | null, fallback: number, max: number) { return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? Number(value) : fallback; }
export function validShopReturn(value: string | null): string | null {
  if (!value || value.length > 16000 || !value.startsWith("/?") || value.includes("\u0000")) return null;
  const url = new URL(value, "https://teruisi-shell.invalid");
  if (url.pathname !== "/" || url.hash || url.searchParams.getAll("module").length !== 1 || url.searchParams.get("module") !== "shop" || url.searchParams.has("shopReturn")) return null;
  return value;
}
export function parseShopLocationContext(params: URLSearchParams): ShopLocationContext {
  const platforms = [...new Set(params.getAll("shopPlatform"))].filter((p): p is InsightPlatform => p === "京东" || p === "天猫").sort();
  let outlets: string[] = [];
  try { outlets = readNetshopOutletFilters(params.getAll("shopOutlet")).filter(o => ["京东", "天猫"].includes(o.platform) && (!platforms.length || platforms.includes(o.platform as InsightPlatform))).map(o => netshopOutletKey(o.platform, o.shopName)).sort(); } catch { /* Invalid bookmarks normalize to no selected shops, never a guessed shop. */ }
  const dimension = single(params, "shopDimension") === "sku" && !platforms.includes("天猫") ? "sku" : "spu";
  const grain = single(params, "shopGrain");
  let product: ProductIdentity | null = null;
  try {
    const raw = single(params, "shopProduct");
    if (raw && raw.length <= 700) {
      const value = JSON.parse(raw);
      if (Array.isArray(value) && value.length === 4 && value.every(v => typeof v === "string")) {
        const [platform, shopName, kind, id] = value;
        const candidate = { platform, shopName, dimension: kind, id } as ProductIdentity;
        encodeProductIdentity(candidate);
        if (kind === dimension && (!platforms.length || platforms.includes(platform as InsightPlatform)) && (!outlets.length || outlets.includes(netshopOutletKey(platform, shopName)))) product = candidate;
      }
    }
  } catch { /* Invalid exact identities cannot select another product. */ }
  return { platforms, outlets, dimension, previous: single(params, "shopPrevious") !== "0", yearAgo: single(params, "shopYearAgo") !== "0", grain: grain === "week" || grain === "month" ? grain : "day", section: boundedText(single(params, "shopSection"), 60), category: boundedText(single(params, "shopCategory"), 120), q: boundedText(single(params, "shopQ"), 120).trim(), page: positive(single(params, "shopPage"), 1, 10000), pageSize: positive(single(params, "shopPageSize"), 20, 100), product, returnTo: validShopReturn(single(params, "shopReturn")) };
}
export function writeShopLocationContext(params: URLSearchParams, context: ShopLocationContext) {
  const draft = new URLSearchParams();
  context.platforms.forEach(p => draft.append("shopPlatform", p)); context.outlets.forEach(k => draft.append("shopOutlet", k));
  draft.set("shopDimension", context.dimension); draft.set("shopPrevious", context.previous ? "1" : "0"); draft.set("shopYearAgo", context.yearAgo ? "1" : "0"); draft.set("shopGrain", context.grain);
  draft.set("shopSection", context.section); draft.set("shopCategory", context.category); draft.set("shopQ", context.q); draft.set("shopPage", String(context.page)); draft.set("shopPageSize", String(context.pageSize));
  if (context.product) draft.set("shopProduct", encodeProductIdentity(context.product));
  if (context.returnTo) draft.set("shopReturn", context.returnTo);
  const normalized = parseShopLocationContext(draft);
  shopContextKeys.forEach(k => params.delete(k));
  normalized.platforms.forEach(p => params.append("shopPlatform", p)); normalized.outlets.forEach(k => params.append("shopOutlet", k));
  if (normalized.dimension !== "spu") params.set("shopDimension", normalized.dimension);
  if (!normalized.previous) params.set("shopPrevious", "0"); if (!normalized.yearAgo) params.set("shopYearAgo", "0");
  if (normalized.grain !== "day") params.set("shopGrain", normalized.grain);
  for (const [k, v] of [["shopSection", normalized.section], ["shopCategory", normalized.category], ["shopQ", normalized.q], ["shopReturn", normalized.returnTo]] as const) if (v) params.set(k, v);
  if (normalized.page !== 1) params.set("shopPage", String(normalized.page)); if (normalized.pageSize !== 20) params.set("shopPageSize", String(normalized.pageSize));
  if (normalized.product) params.set("shopProduct", encodeProductIdentity(normalized.product));
}
