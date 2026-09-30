"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JdSkuCatalogItem, JdSkuCatalogResponse } from "../../module-view-shared";
import { insightBudget } from "@/lib/netshop/insights-contract";
import { isNetshopIsoDate, readNetshopCatalogFilters, type NetshopCatalogFilters } from "@/lib/netshop/query-contract";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightListPagination, InsightReadState } from "../shared/components";
import { InsightReadError, useScopedRead } from "../shared/request-state";
import { ProductPicture, ProductsPanel } from "./ProductsPrimitives";
import { productPrincipalKey } from "./ProductsRead";
import { safeProductUrl, type ProductsUiChange, type ProductsUiState } from "./ui-state";

type CatalogMetadata = NetshopCatalogFilters & { policyVersion: "netshop-product-catalog-filter-v1"; asOfDate: string; scopeKey: string; sourceVersion: string; staleAfterDays: number; onSaleValues: string[]; offSaleValues: string[]; summaryBasis: "complete_store_set_before_table_filters"; filteredRows: number };
type CatalogCapabilities = { mapping: { supportedValues: ["all"]; reasonCode: "unverified_source" }; unverified_mapping: { supported: false; reasonCode: "unverified_source" }; missing_image: { supported: boolean; reasonCode: "unverified_source" | null } };
type CatalogView = JdSkuCatalogResponse & { catalogFilters?: CatalogMetadata; catalogFilterCapabilities?: CatalogCapabilities };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = (value: unknown, maximum = 8000): value is string => typeof value === "string" && value.length <= maximum;
const date = (value: unknown) => value === null || typeof value === "string" && isNetshopIsoDate(value);
function owningCatalogRevision(value: string | null | undefined): string {
  if (typeof value !== "string" || !/^\d+:[a-f0-9]{12}$/.test(value)) throw new InsightReadError("invalid_catalog_contract", "目录响应缺少有效的来源版本头");
  return value;
}

const number = (value: number | null | undefined, money = false) => value === null || value === undefined ? "—" : (money ? value / 100 : value).toLocaleString("zh-CN", { minimumFractionDigits: money ? 2 : 0, maximumFractionDigits: money ? 2 : 0 });
function quality(item: JdSkuCatalogItem) { return [!item.imageUrl ? "缺图" : null, !item.productCode ? "缺少商家码" : null, !item.category ? "缺类目" : null, !item.salesMatched ? "ERP经营未匹配" : null].filter(Boolean).join(" / ") || "本来源未报告字段缺口"; }
export function checkCatalog(value: unknown, query: URLSearchParams, revision?: string | null): CatalogView {
  if (!plain(value)) throw new Error("目录响应对象无效");
  const data = value as CatalogView;
  const pagination = data.pagination;
  // Legacy `truncated` is a pagination hint (including ordinary partial pages),
  // not the shared insight protocol's indication of an incomplete source set.
  if (!text(data.snapshotToken, 64) || !/^[a-f0-9]{64}$/.test(data.snapshotToken) || !Array.isArray(data.items) || !Array.isArray(data.shops) || !plain(data.summary) || !plain(pagination) || pagination.page !== Number(query.get("page")) || pagination.pageSize !== Number(query.get("pageSize")) || !Number.isSafeInteger(pagination.total) || pagination.total < 0 || data.items.length > pagination.pageSize || data.items.length > Math.max(0, pagination.total - (pagination.page - 1) * pagination.pageSize) || pagination.returned !== undefined && pagination.returned !== data.items.length || pagination.truncated !== undefined && typeof pagination.truncated !== "boolean" || Object.hasOwn(pagination, "hasMore") && (typeof pagination.hasMore !== "boolean" || pagination.hasMore !== ((pagination.page - 1) * pagination.pageSize + data.items.length < pagination.total))) throw new Error("目录版本或分页回执无效");
  if (new TextEncoder().encode(JSON.stringify(value)).length > insightBudget.responseBytes) throw new Error("目录响应超出有界显示容量");
  const platforms = query.getAll("platform"), outlets = query.getAll("outlet");
  const identities = new Set<string>();
  for (const item of data.items) {
    if (!plain(item)) throw new Error("目录商品对象无效");
    const identity = JSON.stringify([item.platform, item.shopName, item.spuId, item.skuId, item.saleAttribute]);
    if (!text(item.platform, 100) || !text(item.shopName, 200) || !(["spuId", "skuId", "saleAttribute", "productCode", "productName", "imageUrl", "category", "brand", "status", "productUrl", "createdAt"] as const).every(key => text(item[key])) || !date(item.snapshotDate) || platforms.length && !platforms.includes(item.platform) || outlets.length && !outlets.includes(`${item.platform}\u001f${item.shopName}`) || identities.has(identity)) throw new Error("目录商品身份重复或超出所选店铺");
    identities.add(identity);
    for (const key of ["priceCents", "costPriceCents", "netSalesCents"] as const) if (item[key] !== null && !Number.isSafeInteger(item[key])) throw new Error("目录金额不是安全整数分");
    for (const key of ["totalInventory", "availableInventory"] as const) if (item[key] !== null && !Number.isSafeInteger(item[key])) throw new Error("目录库存数值无效");
    if (typeof item.salesMatched !== "boolean" || (["grossMarginRate", "refundRate"] as const).some(key => item[key] !== null && (typeof item[key] !== "number" || !Number.isFinite(item[key])))) throw new Error("目录经营匹配或比率类型无效");
    if (item.catalogSnapshotDates !== undefined && (!plain(item.catalogSnapshotDates) || Object.keys(item.catalogSnapshotDates).length !== 4 || !(["master", "price", "inventory", "image"] as const).every(key => date(item.catalogSnapshotDates![key])))) throw new Error("目录各来源快照日期无效");
  }
  for (const shop of data.shops) if (!plain(shop) || !text(shop.platform, 100) || !text(shop.shopName, 200) || !date(shop.snapshotDate) || shop.completedAt !== null && !text(shop.completedAt, 400)) throw new Error("目录店铺选项类型无效");
  for (const key of ["totalSkus", "onSaleSkus", "totalInventory", "availableInventory"] as const) if (!Number.isSafeInteger(data.summary[key]) || Number(data.summary[key]) < 0) throw new Error("目录摘要类型无效");
  if (data.batch !== null && (!plain(data.batch) || !text(data.batch.fileName) || !date(data.batch.snapshotDate) || !Number.isSafeInteger(data.batch.rowCount) || data.batch.completedAt !== null && !text(data.batch.completedAt, 400))) throw new Error("目录批次类型无效");
  if (!plain(data.sales) || !(["periodStart", "periodEnd", "dataCutoffDate"] as const).every(key => date(data.sales[key])) || !text(data.sales.platform, 100)) throw new Error("目录ERP经营范围类型无效");
  const filters = readNetshopCatalogFilters(query);
  if (data.catalogFilters !== undefined) {
    const meta = data.catalogFilters, caps = data.catalogFilterCapabilities;
    if (!plain(meta) || meta.policyVersion !== "netshop-product-catalog-filter-v1" || !(["status", "quality", "mapping"] as const).every(key => meta[key] === filters[key as keyof NetshopCatalogFilters]) || !isNetshopIsoDate(meta.asOfDate) || !/^[a-f0-9]{64}$/.test(meta.scopeKey) || !/^\d+:[a-f0-9]{12}$/.test(meta.sourceVersion) || meta.staleAfterDays !== 30 || meta.summaryBasis !== "complete_store_set_before_table_filters" || !Number.isSafeInteger(meta.filteredRows) || meta.filteredRows < 0 || ![meta.onSaleValues, meta.offSaleValues].every(list => Array.isArray(list) && list.every(value => text(value, 100)))) throw new Error("目录筛选范围或来源版本回执无效");
    if (!plain(caps) || !plain(caps.mapping) || !Array.isArray(caps.mapping.supportedValues) || caps.mapping.supportedValues.length !== 1 || caps.mapping.supportedValues[0] !== "all" || caps.mapping.reasonCode !== "unverified_source" || !plain(caps.unverified_mapping) || caps.unverified_mapping.supported !== false || caps.unverified_mapping.reasonCode !== "unverified_source" || !plain(caps.missing_image) || typeof caps.missing_image.supported !== "boolean" || caps.missing_image.reasonCode !== (caps.missing_image.supported ? null : "unverified_source")) throw new Error("目录筛选能力回执无效");
    if (meta.sourceVersion !== owningCatalogRevision(revision)) throw new InsightReadError("insights_revision_changed", "目录来源版本与响应头不一致，请完整重读");
  } else if (["status", "quality", "mapping"].some(key => query.has(key))) throw new InsightReadError("invalid_catalog_contract", "目录来源缺少已请求的筛选版本回执");
  return data;
}

export function ProductsCatalog({ props, ui, onUi, onShops }: { props: NetshopColumnProps; ui: ProductsUiState; onUi: ProductsUiChange; onShops: (shops: string[]) => void }) {
  const [selected, setSelected] = useState<{ scope: string; item: JdSkuCatalogItem } | null>(null);
  const token = useRef<{ key: string; token: string; data: CatalogView } | null>(null);
  const query = new URLSearchParams({ startDate: props.startDate, endDate: props.endDate, page: String(props.context.page), pageSize: String(props.context.pageSize), q: props.context.q });
  props.context.platforms.forEach(platform => query.append("platform", platform)); props.context.outlets.forEach(outlet => query.append("outlet", outlet));
  const filters = ui.catalogFilters ?? { status: "all", quality: "all", mapping: "all" };
  Object.entries(filters).forEach(([key, value]) => query.set(key, value));
  const serialized = query.toString(), principal = productPrincipalKey(props), scope = `${principal}:${serialized}`;
  const familyQuery = new URLSearchParams(serialized); familyQuery.delete("page");
  const family = `${principal}:${familyQuery}`;
  const load = useCallback(async (signal: AbortSignal) => {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(insightBudget.requestDeadlineMs)]);
    for (let attempt = 0; attempt < insightBudget.attempts; attempt++) {
      const request = new URLSearchParams(serialized);
      const base = token.current?.key === family ? token.current : null;
      if (base) { request.set("view", "page"); request.set("snapshotToken", base.token); }
      try {
        // Only a page carrying the exact snapshot may retain its validated
        // full summary, metadata and capabilities. A new snapshot reloads all.
        const response = await fetch(`/api/netshop/products?${request}`, { cache: "no-store", signal: bounded });
        const body = await response.json();
        if (bounded.aborted) throw new DOMException("读取已取消", "AbortError");
        if (!response.ok) throw new InsightReadError(base && response.status === 503 ? "insights_revision_changed" : typeof body?.code === "string" ? body.code : "service_unavailable", typeof body?.error === "string" ? body.error : "货品目录读取失败");
        const revision = response.headers.get("X-Netshop-Data-Revision");
        if (base && body?.snapshotToken !== base.token) throw new InsightReadError("insights_revision_changed", "目录版本已变化");
        if (base && owningCatalogRevision(revision) !== base.data.catalogFilters?.sourceVersion) throw new InsightReadError("insights_revision_changed", "目录分页来源版本已变化，请完整重读");
        const catalog = checkCatalog(base ? { ...base.data, ...body } : body, request, revision);
        token.current = { key: family, token: catalog.snapshotToken, data: catalog };
        return catalog;
      } catch (error) {
        if (bounded.aborted) throw error;
        if (error instanceof InsightReadError && error.code.endsWith("revision_changed") && attempt + 1 < insightBudget.attempts) { token.current = null; continue; }
        token.current = null; throw error;
      }
    }
    throw new InsightReadError("insights_revision_changed", "目录来源版本持续变化");
  }, [family, serialized]);
  const read = useScopedRead(scope, load), data = read.data;
  useEffect(() => { if (data) onShops(data.shops.map(shop => `${shop.platform}\u001f${shop.shopName}`)); }, [data, onShops]);
  if (!data) return <><InsightReadState status={read.status} error={read.error} onRetry={read.refresh} />{read.status !== "loading" && <button type="button" onClick={() => { if (Object.values(filters).some(value => value !== "all")) onUi({ ...ui, catalogFilters: { status: "all", quality: "all", mapping: "all" } }, { page: 1 }); else read.refresh(); }}>重置目录筛选</button>}</>;
  const pagination = { ...data.pagination, returned: data.items.length, hasMore: data.pagination.page * data.pagination.pageSize < data.pagination.total, truncated: false };
  const item = selected?.scope === scope ? selected.item : null;
  const openPerformance = (row: JdSkuCatalogItem) => {
    if (row.platform === "京东" && row.skuId) props.onDrill("products", { platform: "京东", shopName: row.shopName, dimension: "sku", id: row.skuId }, "overview");
    else if (row.platform === "天猫" && row.spuId) props.onDrill("products", { platform: "天猫", shopName: row.shopName, dimension: "spu", id: row.spuId }, "overview");
  };
  return <div className="np-stack"><ProductsPanel title="货品档案" note="原目录的最近一次成功导入快照；经营类目筛选不作用于目录" action={<button type="button" onClick={read.refresh}>刷新目录</button>}>
    <div className="np-toolbar">
      <label>目录状态 <select aria-label="目录状态筛选" disabled={!data.catalogFilters} value={filters.status} onChange={event => onUi({ ...ui, catalogFilters: { ...filters, status: event.target.value as NetshopCatalogFilters["status"] } }, { page: 1 })}>{([["all", "全部状态"], ["on_sale", "上架"], ["off_sale", "下架"], ["unknown", "状态未知"]] as const).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>资料质量 <select aria-label="目录资料质量筛选" disabled={!data.catalogFilters} value={filters.quality} onChange={event => onUi({ ...ui, catalogFilters: { ...filters, quality: event.target.value as NetshopCatalogFilters["quality"] } }, { page: 1 })}>{([["all", "全部资料"], ["missing_image", "缺少图片"], ["missing_code", "缺少目录编码"], ["missing_category", "缺少类目"], ["conflict", "身份冲突"], ["stale", "资料陈旧"], ["unverified_mapping", "映射未核验（暂未具备）"]] as const).map(([key, label]) => <option key={key} value={key} disabled={key === "unverified_mapping" || key === "missing_image" && data.catalogFilterCapabilities?.missing_image.supported !== true}>{label}</option>)}</select></label>
      <label>ERP映射 <select aria-label="目录ERP映射筛选" disabled value={filters.mapping}><option value="all">全部映射（未核验）</option></select></label>
    </div>
    {data.catalogFilters ? <p className="np-note">当前平台、店铺的完整最新目录集合先筛选再分页；目录概况为筛选前店铺集合。机械陈旧阈值 {data.catalogFilters.staleAfterDays} 天，核验日 {data.catalogFilters.asOfDate}。ERP映射未核验{data.catalogFilterCapabilities?.missing_image.supported ? "。" : "；当前范围缺图筛选尚未具备。"}</p> : <p className="np-note">此目录读取尚未提供完整状态、质量与映射筛选能力；对应筛选保持禁用。</p>}
    <div className="np-toolbar"><button type="button" onClick={() => props.onNavigate("import", "jd_sku")}>京东SKU目录导入</button><button type="button" onClick={() => props.onNavigate("import", "tmall_product_master")}>天猫货品导入</button><button type="button" onClick={() => props.onNavigate("import", "tmall_product_assets")}>天猫SPU图片导入</button></div>
    <p className="np-caption">已导入SKU {number(data.summary.totalSkus)} 个 · 已标记上架 {number(data.summary.onSaleSkus)} 个 · 目录总库存 {number(data.summary.totalInventory)} 件 · 目录可用库存 {number(data.summary.availableInventory)} 件。该汇总沿用目录接口的筛选口径。</p>
    <div className="np-toolbar"><input aria-label="搜索货品目录名称、SPU、SKU或商家码" maxLength={120} value={props.context.q} placeholder="名称、SPU、SKU、商家码" onChange={event => props.onContextChange({ q: event.target.value, page: 1 })} /><select aria-label="货品目录每页条数" value={props.context.pageSize} onChange={event => props.onContextChange({ pageSize: Number(event.target.value), page: 1 })}>{[5, 10, 20, 50, 100].map(size => <option key={size} value={size}>{size}条/页</option>)}</select><button type="button" aria-pressed={ui.gallery} onClick={() => onUi({ ...ui, gallery: !ui.gallery })}>{ui.gallery ? "切换表格" : "图片浏览"}</button></div>
    <div className="np-column-picker" aria-label="货品目录列设置">{([["traffic", "价格 / 库存"], ["comparison", "编码 / 品牌 / 规格"], ["association", "ERP经营关联"], ["coverage", "快照 / 质量"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={ui.columns[key]} onChange={event => onUi({ ...ui, columns: { ...ui.columns, [key]: event.target.checked } })} />{label}</label>)}</div>
    {ui.gallery ? <div className="np-gallery">{data.items.map(row => <article className="np-gallery-item" key={JSON.stringify([row.platform, row.shopName, row.spuId, row.skuId, row.saleAttribute])}><div className="np-gallery-image"><ProductPicture title={row.productName} url={row.imageUrl || null} link={row.productUrl} large /></div><div className="np-gallery-body"><button type="button" className="np-link" onClick={() => setSelected({ scope, item: row })}>{row.productName || "未命名商品"}</button><small>{row.platform} · {row.shopName}<br />SPU {row.spuId || "—"} / SKU {row.skuId || "—"}</small>{ui.columns.comparison && <small>{row.productCode || "缺少商家码"} · {row.brand || "未提供品牌"} · {row.saleAttribute || "未提供规格"}</small>}{ui.columns.traffic && <small>目录价格 {number(row.priceCents, true)} 元 · 可用库存 {number(row.availableInventory)} 件</small>}{ui.columns.coverage && <small>目录 {row.catalogSnapshotDates?.master ?? row.snapshotDate ?? "未提供"} / 图片 {row.catalogSnapshotDates?.image ?? "来源日期未提供"} · {quality(row)}</small>}</div></article>)}</div> : <div className="np-table-wrap"><table className="np-table"><thead><tr><th>图片 / 商品 / 店铺</th><th>SPU / SKU ID</th>{ui.columns.comparison && <th>目录编码 / 品牌 / 类目 / 规格</th>}{ui.columns.traffic && <><th>目录价格（元）</th><th>总 / 可用库存</th></>}{ui.columns.association && <><th>ERP净销售（元）</th><th>大毛利率</th></>}<th>状态</th>{ui.columns.coverage && <th>目录快照 / 资料质量</th>}<th>操作</th></tr></thead><tbody>{data.items.map(row => <tr key={JSON.stringify([row.platform, row.shopName, row.spuId, row.skuId, row.saleAttribute])}><td><div className="np-product-cell"><ProductPicture title={row.productName} url={row.imageUrl || null} link={row.productUrl} /><div><button type="button" className="np-link" onClick={() => setSelected({ scope, item: row })}>{row.productName || "未命名商品"}</button><small>{row.platform} · {row.shopName}</small></div></div></td><td>{row.spuId || "—"}<br />{row.skuId || "—"}</td>{ui.columns.comparison && <td>{row.productCode || "— · 缺码"}<br />{row.brand || "—"} / {row.category || "—"}<br />{row.saleAttribute || "—"}</td>}{ui.columns.traffic && <><td>{number(row.priceCents, true)}</td><td>{number(row.totalInventory)} / {number(row.availableInventory)}</td></>}{ui.columns.association && <><td>{row.salesMatched ? number(row.netSalesCents, true) : "— · 经营未匹配"}</td><td>{row.salesMatched && row.grossMarginRate !== null ? `${(row.grossMarginRate * 100).toFixed(2)}%` : "— · 经营未匹配"}</td></>}<td>{row.status || "未提供"}</td>{ui.columns.coverage && <td>目录 {row.catalogSnapshotDates?.master ?? row.snapshotDate ?? "—"}<br />价格 {row.catalogSnapshotDates?.price ?? "来源日期未提供"} / 库存 {row.catalogSnapshotDates?.inventory ?? "来源日期未提供"}<br />图片 {row.catalogSnapshotDates?.image ?? "来源日期未提供"}<br />{quality(row)}</td>}<td><button type="button" onClick={() => setSelected({ scope, item: row })}>目录资料</button></td></tr>)}</tbody></table></div>}
    {data.items.length === 0 && <p className="np-empty">当前目录筛选没有匹配货品</p>}<InsightListPagination pagination={pagination} onPage={page => props.onContextChange({ page })} />
    <p className="np-note">价格和库存为目录快照 {data.batch?.snapshotDate || "未提供"}；ERP经营范围 {data.sales?.periodStart || "未提供"} — {data.sales?.periodEnd || "未提供"}，截止 {data.sales?.dataCutoffDate || "未提供"}。成本遵原领域规则；未关联不计零成本。</p>
  </ProductsPanel>
  {item && <ProductsPanel title="目录资料" note="只展示当前所选SKU资料，不声明SKU日经营或历史关系" action={<button type="button" onClick={() => setSelected(null)}>关闭资料</button>}><div className="np-row"><ProductPicture title={item.productName} url={item.imageUrl || null} link={item.productUrl} large /><h3>{item.productName}</h3></div><dl className="np-properties"><dt>平台 / 店铺</dt><dd>{item.platform} / {item.shopName}</dd><dt>SPU / SKU</dt><dd>{item.spuId || "—"} / {item.skuId || "—"}</dd><dt>目录来源编码 / 品牌</dt><dd>{item.productCode || "—"} / {item.brand || "—"}</dd><dt>规格 / 类目 / 状态</dt><dd>{item.saleAttribute || "—"} / {item.category || "—"} / {item.status || "未提供"}</dd><dt>目录价格 / 库存</dt><dd>{number(item.priceCents, true)} 元 / {number(item.totalInventory)} 总 / {number(item.availableInventory)} 可用 · 目录快照 {item.snapshotDate || "未提供"}</dd><dt>ERP经营关联</dt><dd>{item.salesMatched ? "已关联原ERP经营范围" : "经营记录未匹配"} · 成本 {item.salesMatched ? number(item.costPriceCents, true) : "—"} 元 · 退货率 {item.salesMatched && item.refundRate !== null ? `${(item.refundRate * 100).toFixed(2)}%` : "—"}</dd><dt>各来源快照</dt><dd>目录 {item.catalogSnapshotDates?.master ?? item.snapshotDate ?? "未提供"} / 价格 {item.catalogSnapshotDates?.price ?? "来源日期未提供"} / 库存 {item.catalogSnapshotDates?.inventory ?? "来源日期未提供"} / 图片 {item.catalogSnapshotDates?.image ?? "来源日期未提供"}</dd><dt>资料质量</dt><dd>{quality(item)}</dd></dl><div className="np-toolbar">{(item.platform === "京东" && item.skuId || item.platform === "天猫" && item.spuId) && <button type="button" onClick={() => openPerformance(item)}>查看{item.platform === "天猫" ? "SPU" : "SKU"}经营</button>}{safeProductUrl(item.productUrl) && <a href={safeProductUrl(item.productUrl)!} target="_blank" rel="noreferrer">平台商品链接 ↗</a>}</div>{item.platform === "天猫" && <p className="np-note">天猫SKU仅具备目录资料，不能以此生成SKU日经营、趋势或历史SKU贡献。</p>}</ProductsPanel>}
  </div>;
}
