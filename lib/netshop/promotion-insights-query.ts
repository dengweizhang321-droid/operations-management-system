import { isNetshopIsoDate, NetshopQueryError, readNetshopOutletFilters, readNetshopQueryInteger } from "./query-contract";
import { encodeProductIdentity, validateContextQuery, type ProductIdentity } from "./insights-contract";
import { PROMOTION_OBJECT_KINDS, PROMOTION_SORTS, type PromotionObjectKind, type PromotionSort } from "./promotion-insights-contract";

const sharedKeys = ["platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"] as const;
const extraKeys = ["trendGrain", "q", "objectKind", "objectId", "shopKey", "page", "pageSize", "sort", "sectionToken", "focusDate", "objectStartDate", "objectEndDate", "productIdentity"] as const;
const allowed = new Set<string>([...sharedKeys, ...extraKeys]);
function reject(message: string): never { throw new NetshopQueryError("invalid_promotion_request", message); }
function boundedText(value: string | null, maximum: number, label: string) {
  if (value === null) return null;
  if (!value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) reject(`${label}无效`);
  return value;
}
export function promotionContextQuery(params: URLSearchParams) {
  const query = new URLSearchParams();
  for (const key of sharedKeys) params.getAll(key).forEach(value => query.append(key, value));
  if (!query.has("dimension")) query.set("dimension", query.get("platform") === "京东" ? "sku" : "spu");
  return query;
}
export function validatePromotionQuery(params: URLSearchParams, detail = false) {
  for (const key of params.keys()) if (!allowed.has(key) || !["platform", "outlet"].includes(key) && params.getAll(key).length !== 1) reject("推广请求包含未知或重复参数");
  if (!detail && (params.has("objectId") || params.has("shopKey"))) reject("对象行键与精确详情店铺只用于详情接口");
  if (params.getAll("platform").length !== 1) reject("推广分析须选择唯一平台，分别保留归因定义");
  const contextQuery = promotionContextQuery(params), context = validateContextQuery(contextQuery);
  const platform = context.platforms[0];
  if (context.dimension !== (platform === "京东" ? "sku" : "spu")) reject("推广费率须使用京东SKU日或天猫SPU日来源");
  const trendGrain = params.get("trendGrain") ?? "day";
  if (!["day", "week", "month"].includes(trendGrain)) reject("趋势粒度无效");
  const objectKind = params.get("objectKind") ?? "product", sort = params.get("sort") ?? "spend_desc";
  if (!PROMOTION_OBJECT_KINDS.includes(objectKind as PromotionObjectKind) || !PROMOTION_SORTS.includes(sort as PromotionSort)) reject("推广对象或排序无效");
  let productIdentity: ProductIdentity | null = null;
  const rawIdentity = params.get("productIdentity");
  if (rawIdentity !== null) {
    if (rawIdentity.length > 700) reject("精确商品焦点超出边界");
    let values: unknown;
    try { values = JSON.parse(rawIdentity); } catch { reject("精确商品焦点须为共享身份四元组"); }
    if (!Array.isArray(values) || values.length !== 4 || !values.every(v => typeof v === "string")) reject("精确商品焦点须为共享身份四元组");
    const [focusPlatform, focusShop, dimension, id] = values;
    const identity = { platform: focusPlatform, shopName: focusShop, dimension, id } as ProductIdentity;
    if (encodeProductIdentity(identity) !== JSON.stringify(values)) reject("精确商品焦点须使用规范身份");
    if (objectKind !== "product" || identity.platform !== platform || identity.dimension !== context.dimension || context.shops.length && !context.shops.some(s => s.platform === identity.platform && s.shopName === identity.shopName) || detail && params.get("shopKey") !== `${identity.platform}\u001f${identity.shopName}`) reject("精确商品焦点须属于当前平台、店铺、维度和商品视角");
    productIdentity = identity;
  }
  const rawQ = params.get("q") ?? "";
  if (rawQ.length > 120 || /[\u0000-\u001f\u007f]/.test(rawQ)) reject("表内搜索超出边界");
  const q = rawQ.trim();
  const page = readNetshopQueryInteger(params.get("page"), "page", 1, 1, 10000);
  const pageSize = readNetshopQueryInteger(params.get("pageSize"), "pageSize", 20, 1, 100);
  const sectionToken = params.get("sectionToken");
  if (sectionToken !== null && !/^[a-f0-9]{64}$/.test(sectionToken)) reject("推广章节令牌无效");
  const shopKey = params.get("shopKey"), objectId = boundedText(params.get("objectId"), 64, "对象键");
  if (objectId !== null && !/^[a-f0-9]{64}$/.test(objectId)) reject("详情须使用所属版本的完整对象行键");
  if (shopKey !== null) {
    const [shop] = readNetshopOutletFilters([shopKey]);
    if (shop.platform !== platform || context.shops.length && !context.shops.some(item => item.platform === shop.platform && item.shopName === shop.shopName)) reject("详情店铺不属于所选范围");
  }
  if (objectId !== null && shopKey === null || detail && (objectId === null || shopKey === null || sectionToken === null || !params.has("objectKind"))) reject("详情必须同时提供对象键、精确店铺、对象种类及所属章节版本");
  const focusDate = params.get("focusDate"), start = params.get("objectStartDate"), end = params.get("objectEndDate");
  if (detail && (focusDate !== null || start !== null || end !== null)) reject("对象详情使用原整期，不能混入列表日期定位范围");
  if (focusDate !== null && (start !== null || end !== null) || (start === null) !== (end === null)) reject("对象日期须提供一种完整范围");
  const objectStartDate = focusDate ?? start ?? context.window.startDate;
  const objectEndDate = focusDate ?? end ?? context.window.endDate;
  if (!isNetshopIsoDate(objectStartDate) || !isNetshopIsoDate(objectEndDate) || objectStartDate > objectEndDate || objectStartDate < context.window.startDate || objectEndDate > context.window.endDate) reject("对象日期必须在当前统计范围内");
  return { contextQuery, context, platform, trendGrain: trendGrain as "day" | "week" | "month", objectKind: objectKind as PromotionObjectKind, sort: sort as PromotionSort, q, page, pageSize, sectionToken, shopKey, objectId, objectStartDate, objectEndDate, productIdentity };
}
