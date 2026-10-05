import type { ProductSummaryReadResponse } from "./summary";

// Validate before any region is shown. Page metadata is a request witness;
// full-collection metrics may never be substituted with the current page.
export function decodeProductRead(value: unknown, request: URLSearchParams): ProductSummaryReadResponse {
  if (!value || typeof value !== "object") throw new Error("商品响应格式无效");
  const p = value as ProductSummaryReadResponse;
  const view = request.get("view") ?? "full";
  if ((p.projection !== view && !(view === "initial-page" && p.projection === "full")) || !/^[a-f0-9]{64}$/.test(p.snapshotToken)) throw new Error("商品响应缺少有效数据版本或视图");
  if (request.has("snapshotToken") && p.snapshotToken !== request.get("snapshotToken")) throw new Error("商品数据版本不一致");
  const page = Number(request.get("page") ?? 1), size = Number(request.get("pageSize") ?? 50);
  const pg = p.pagination;
  if (!pg || pg.page !== page || pg.pageSize !== size || !Number.isSafeInteger(pg.total) || pg.total < 0
    || !Number.isSafeInteger(pg.returned) || pg.returned < 0 || pg.returned > size
    || pg.totalPages !== Math.ceil(pg.total / size)
    || pg.truncated !== ((page - 1) * size + pg.returned < pg.total)
    || pg.returned !== Math.min(size, Math.max(0, pg.total - (page - 1) * size))) throw new Error("商品分页响应与请求不一致");
  if (!p.sort || p.sort.by !== (request.get("sortBy") ?? "netSalesCents") || p.sort.direction !== (request.get("direction") ?? "desc")) throw new Error("商品排序响应与请求不一致");
  if (p.projection !== "overview") {
    if (!Array.isArray(p.items) || p.items.length !== pg.returned || new Set(p.items.map(i=>i.productCode)).size !== p.items.length) throw new Error("商品明细不完整或重复");
    for (const item of p.items) {
      if (!item.productCode || !Array.isArray(item.outlets) || item.outlets.some(o=>!o || typeof o.platform !== "string" || typeof o.shop !== "string")) throw new Error("商品渠道身份无效");
      for (const field of ["productCode", "productName", "brand", "supplierName", "specification", "category"] as const) if (typeof item[field] !== "string") throw new Error("商品身份字段无效");
      for (const field of ["netQuantity", "grossSalesCents", "refundAmountCents", "netSalesCents", "costCents", "feeCents", "grossProfitCents"] as const) if (!Number.isSafeInteger(item[field])) throw new Error("商品金额或销量字段无效");
      for (const field of ["grossMarginRate", "refundRate", "shippingRate", "averageSalePriceCents", "averageCostCents", "observedFeeRate", "availableQuantity", "stockValueCents", "knownStockValueCents", "costCoverageRate"] as const) if (item[field] !== null && !Number.isFinite(item[field])) throw new Error("商品比率或库存字段无效");
    }
  }
  if (p.projection !== "page") {
    const applied = p.filtersApplied;
    if (typeof p.hasSales !== "boolean" || !p.sync || !applied) throw new Error("商品范围元数据不完整");
    for (const field of ["salesThrough", "salesWindowStart", "requestedStartDate", "requestedEndDate", "dataStartDate", "dataCutoffDate", "inventoryAsOf"] as const) if (p.sync[field] !== null && (typeof p.sync[field] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.sync[field]))) throw new Error("商品数据覆盖日期无效");
    if (p.sync.latestSalesFile !== null && typeof p.sync.latestSalesFile !== "string") throw new Error("商品来源元数据无效");
    if (request.get("range") === "custom" && (p.range !== "custom" || p.sync.requestedStartDate !== request.get("startDate") || p.sync.requestedEndDate !== request.get("endDate"))) throw new Error("商品日期响应与请求不一致");
    const equal = (a: string[], b: string[]) => Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (applied.query !== (request.get("q") ?? "").trim() || !equal(applied.categories, request.getAll("category")) || !equal(applied.platforms, request.getAll("platform")) || !equal(applied.marginBands, request.getAll("marginBand")) || !Array.isArray(applied.shops) || !equal(applied.shops.map(s=>s.key), request.getAll("shop"))) throw new Error("商品筛选响应与请求不一致");
  }
  if (p.projection === "overview" || p.projection === "full") {
    const m=p.metrics;
    if (!m || m.skuCount !== pg.total || !m.marginBuckets || !p.filters
      || !Array.isArray(p.filters.categories) || !Array.isArray(p.filters.platforms) || !Array.isArray(p.filters.shops)
      || [...p.filters.categories,...p.filters.platforms].some(v=>typeof v!=="string")
      || p.filters.shops.some(v=>!v || typeof v.key!=="string" || typeof v.platform!=="string" || typeof v.shop!=="string")) throw new Error("商品全量统计或筛选不完整");
    const buckets = [m.marginBuckets.below35Count, m.marginBuckets.between35And40Count, m.marginBuckets.between40And45Count, m.marginBuckets.atLeast45Count];
    for (const v of [m.skuCount,m.lossSkuCount,m.stockedSkuCount,...buckets]) if (!Number.isSafeInteger(v) || v < 0 || v > pg.total) throw new Error("商品全量计数无效");
    if (buckets.reduce((a,b)=>a+b,0)>pg.total) throw new Error("商品毛利分布超出全量集合");
    for (const v of [m.grossSalesCents,m.netSalesCents,m.grossProfitCents]) if (!Number.isSafeInteger(v)) throw new Error("商品汇总金额无效");
    if (m.grossMarginRate !== null && !Number.isFinite(m.grossMarginRate)) throw new Error("商品汇总比率无效");
  }
  return p;
}
