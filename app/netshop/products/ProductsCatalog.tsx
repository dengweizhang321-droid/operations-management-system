"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JdSkuCatalogItem, JdSkuCatalogResponse } from "../../module-view-shared";
import { insightBudget } from "@/lib/netshop/insights-contract";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightListPagination, InsightReadState } from "../shared/components";
import { InsightReadError, useScopedRead } from "../shared/request-state";
import { ProductPicture, ProductsPanel } from "./ProductsPrimitives";
import { productPrincipalKey } from "./ProductsRead";
import { safeProductUrl, type ProductsUiState } from "./ui-state";

const number = (value: number | null | undefined, money = false) => value === null || value === undefined ? "—" : (money ? value / 100 : value).toLocaleString("zh-CN", { minimumFractionDigits: money ? 2 : 0, maximumFractionDigits: money ? 2 : 0 });
function quality(item: JdSkuCatalogItem) { return [!item.imageUrl ? "缺图" : null, !item.productCode ? "缺少商家码" : null, !item.category ? "缺类目" : null, !item.salesMatched ? "ERP经营未关联" : null].filter(Boolean).join(" / ") || "本来源未报告字段缺口"; }
function checkCatalog(value: unknown, query: URLSearchParams): JdSkuCatalogResponse {
  if (!value || typeof value !== "object") throw new Error("目录响应对象无效");
  const data = value as JdSkuCatalogResponse;
  const pagination = data.pagination;
  if (!/^[a-f0-9]{64}$/.test(data.snapshotToken) || !Array.isArray(data.items) || !Array.isArray(data.shops) || !data.summary || !pagination || pagination.page !== Number(query.get("page")) || pagination.pageSize !== Number(query.get("pageSize")) || !Number.isSafeInteger(pagination.total) || pagination.total < 0 || data.items.length > pagination.pageSize || pagination.returned !== undefined && pagination.returned !== data.items.length || pagination.truncated === true) throw new Error("目录版本或分页回执无效");
  if (new TextEncoder().encode(JSON.stringify(value)).length > insightBudget.responseBytes) throw new Error("目录响应超出有界显示容量");
  const platforms = query.getAll("platform"), outlets = query.getAll("outlet");
  const identities = new Set<string>();
  for (const item of data.items) {
    const identity = JSON.stringify([item.platform, item.shopName, item.spuId, item.skuId, item.saleAttribute]);
    if (!item || typeof item.platform !== "string" || typeof item.shopName !== "string" || platforms.length && !platforms.includes(item.platform) || outlets.length && !outlets.includes(`${item.platform}\u001f${item.shopName}`) || identities.has(identity)) throw new Error("目录商品身份重复或超出所选店铺");
    identities.add(identity);
    for (const key of ["priceCents", "costPriceCents", "netSalesCents"] as const) if (item[key] !== null && !Number.isSafeInteger(item[key])) throw new Error("目录金额不是安全整数分");
    for (const key of ["totalInventory", "availableInventory"] as const) if (item[key] !== null && !Number.isSafeInteger(item[key])) throw new Error("目录库存数值无效");
  }
  return data;
}

export function ProductsCatalog({ props, ui, onUi, onShops }: { props: NetshopColumnProps; ui: ProductsUiState; onUi: (next: ProductsUiState) => void; onShops: (shops: string[]) => void }) {
  const [selected, setSelected] = useState<{ scope: string; item: JdSkuCatalogItem } | null>(null);
  const token = useRef<{ key: string; token: string } | null>(null);
  const query = new URLSearchParams({ startDate: props.startDate, endDate: props.endDate, page: String(props.context.page), pageSize: String(props.context.pageSize), q: props.context.q });
  props.context.platforms.forEach(platform => query.append("platform", platform)); props.context.outlets.forEach(outlet => query.append("outlet", outlet));
  const serialized = query.toString(), principal = productPrincipalKey(props), scope = `${principal}:${serialized}`;
  const familyQuery = new URLSearchParams(serialized); familyQuery.delete("page");
  const family = `${principal}:${familyQuery}`;
  const load = useCallback(async (signal: AbortSignal) => {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(insightBudget.requestDeadlineMs)]);
    for (let attempt = 0; attempt < insightBudget.attempts; attempt++) {
      const request = new URLSearchParams(serialized);
      if (token.current?.key === family) request.set("snapshotToken", token.current.token);
      try {
        // Full responses retain the original catalog summary and snapshot. The
        // old page endpoint is not joined to a summary from another version.
        const response = await fetch(`/api/netshop/products?${request}`, { cache: "no-store", signal: bounded });
        const body = await response.json();
        if (bounded.aborted) throw new DOMException("读取已取消", "AbortError");
        if (!response.ok) throw new InsightReadError(body?.code ?? "service_unavailable", body?.error ?? "货品目录读取失败");
        const catalog = checkCatalog(body, request);
        if (token.current?.key === family && catalog.snapshotToken !== token.current.token) throw new InsightReadError("insights_revision_changed", "目录版本已变化");
        token.current = { key: family, token: catalog.snapshotToken };
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
  if (!data) return <InsightReadState status={read.status} error={read.error} onRetry={read.refresh} />;
  const pagination = { ...data.pagination, returned: data.items.length, hasMore: data.pagination.page * data.pagination.pageSize < data.pagination.total, truncated: false };
  const item = selected?.scope === scope ? selected.item : null;
  const openPerformance = (row: JdSkuCatalogItem) => {
    if (row.platform === "京东" && row.skuId) props.onDrill("products", { platform: "京东", shopName: row.shopName, dimension: "sku", id: row.skuId }, "overview");
    else if (row.platform === "天猫" && row.spuId) props.onDrill("products", { platform: "天猫", shopName: row.shopName, dimension: "spu", id: row.spuId }, "overview");
  };
  return <div className="np-stack"><ProductsPanel title="货品档案" note="原目录的最近一次成功导入快照；经营类目筛选不作用于目录" action={<button type="button" onClick={read.refresh}>刷新目录</button>}>
    <div className="np-toolbar"><button type="button" onClick={() => props.onNavigate("import", "jd_sku")}>京东SKU目录导入</button><button type="button" onClick={() => props.onNavigate("import", "tmall_product_master")}>天猫货品导入</button><button type="button" onClick={() => props.onNavigate("import", "tmall_product_assets")}>天猫SPU图片导入</button></div>
    <p className="np-caption">已导入SKU {number(data.summary.totalSkus)} 个 · 已标记上架 {number(data.summary.onSaleSkus)} 个 · 目录总库存 {number(data.summary.totalInventory)} 件 · 目录可用库存 {number(data.summary.availableInventory)} 件。该汇总沿用目录接口的筛选口径。</p>
    <div className="np-toolbar"><input aria-label="搜索货品目录名称、SPU、SKU或商家码" maxLength={120} value={props.context.q} placeholder="名称、SPU、SKU、商家码" onChange={event => props.onContextChange({ q: event.target.value, page: 1 })} /><select aria-label="货品目录每页条数" value={props.context.pageSize} onChange={event => props.onContextChange({ pageSize: Number(event.target.value), page: 1 })}>{[5, 10, 20, 50, 100].map(size => <option key={size} value={size}>{size}条/页</option>)}</select><button type="button" aria-pressed={ui.gallery} onClick={() => onUi({ ...ui, gallery: !ui.gallery })}>{ui.gallery ? "切换表格" : "图片浏览"}</button></div>
    <div className="np-column-picker" aria-label="货品目录列设置">{([["traffic", "价格 / 库存"], ["comparison", "编码 / 品牌 / 规格"], ["association", "ERP经营关联"], ["coverage", "快照 / 质量"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={ui.columns[key]} onChange={event => onUi({ ...ui, columns: { ...ui.columns, [key]: event.target.checked } })} />{label}</label>)}</div>
    {ui.gallery ? <div className="np-gallery">{data.items.map(row => <article className="np-gallery-item" key={JSON.stringify([row.platform, row.shopName, row.spuId, row.skuId, row.saleAttribute])}><div className="np-gallery-image"><ProductPicture title={row.productName} url={row.imageUrl || null} link={row.productUrl} large /></div><div className="np-gallery-body"><button type="button" className="np-link" onClick={() => setSelected({ scope, item: row })}>{row.productName || "未命名商品"}</button><small>{row.platform} · {row.shopName}<br />SPU {row.spuId || "—"} / SKU {row.skuId || "—"}</small>{ui.columns.comparison && <small>{row.productCode || "缺少商家码"} · {row.brand || "未提供品牌"} · {row.saleAttribute || "未提供规格"}</small>}{ui.columns.traffic && <small>目录价格 {number(row.priceCents, true)} 元 · 可用库存 {number(row.availableInventory)} 件</small>}{ui.columns.coverage && <small>目录快照 {row.snapshotDate || "未提供"} · {quality(row)}</small>}</div></article>)}</div> : <div className="np-table-wrap"><table className="np-table"><thead><tr><th>图片 / 商品 / 店铺</th><th>SPU / SKU ID</th>{ui.columns.comparison && <th>商家码 / 品牌 / 类目 / 规格</th>}{ui.columns.traffic && <><th>目录价格（元）</th><th>总 / 可用库存</th></>}{ui.columns.association && <><th>ERP净销售（元）</th><th>大毛利率</th></>}<th>状态</th>{ui.columns.coverage && <th>目录快照 / 资料质量</th>}<th>操作</th></tr></thead><tbody>{data.items.map(row => <tr key={JSON.stringify([row.platform, row.shopName, row.spuId, row.skuId, row.saleAttribute])}><td><div className="np-product-cell"><ProductPicture title={row.productName} url={row.imageUrl || null} link={row.productUrl} /><div><button type="button" className="np-link" onClick={() => setSelected({ scope, item: row })}>{row.productName || "未命名商品"}</button><small>{row.platform} · {row.shopName}</small></div></div></td><td>{row.spuId || "—"}<br />{row.skuId || "—"}</td>{ui.columns.comparison && <td>{row.productCode || "— · 缺码"}<br />{row.brand || "—"} / {row.category || "—"}<br />{row.saleAttribute || "—"}</td>}{ui.columns.traffic && <><td>{number(row.priceCents, true)}</td><td>{number(row.totalInventory)} / {number(row.availableInventory)}</td></>}{ui.columns.association && <><td>{row.salesMatched ? number(row.netSalesCents, true) : "— · 未关联"}</td><td>{row.salesMatched && row.grossMarginRate !== null ? `${(row.grossMarginRate * 100).toFixed(2)}%` : "— · 未关联"}</td></>}<td>{row.status || "未提供"}</td>{ui.columns.coverage && <td>{row.snapshotDate || "—"}<br />{quality(row)}</td>}<td><button type="button" onClick={() => setSelected({ scope, item: row })}>目录资料</button></td></tr>)}</tbody></table></div>}
    {data.items.length === 0 && <p className="np-empty">当前目录筛选没有匹配货品</p>}<InsightListPagination pagination={pagination} onPage={page => props.onContextChange({ page })} />
    <p className="np-note">价格和库存为目录快照 {data.batch?.snapshotDate || "未提供"}；ERP经营范围 {data.sales?.periodStart || "未提供"} — {data.sales?.periodEnd || "未提供"}，截止 {data.sales?.dataCutoffDate || "未提供"}。成本遵原领域规则；未关联不计零成本。</p>
  </ProductsPanel>
  {item && <ProductsPanel title="目录资料" note="只展示当前所选SKU资料，不声明SKU日经营或历史关系" action={<button type="button" onClick={() => setSelected(null)}>关闭资料</button>}><div className="np-row"><ProductPicture title={item.productName} url={item.imageUrl || null} link={item.productUrl} large /><h3>{item.productName}</h3></div><dl className="np-properties"><dt>平台 / 店铺</dt><dd>{item.platform} / {item.shopName}</dd><dt>SPU / SKU</dt><dd>{item.spuId || "—"} / {item.skuId || "—"}</dd><dt>商家码 / 品牌</dt><dd>{item.productCode || "—"} / {item.brand || "—"}</dd><dt>规格 / 类目 / 状态</dt><dd>{item.saleAttribute || "—"} / {item.category || "—"} / {item.status || "未提供"}</dd><dt>目录价格 / 库存</dt><dd>{number(item.priceCents, true)} 元 / {number(item.totalInventory)} 总 / {number(item.availableInventory)} 可用 · 目录快照 {item.snapshotDate || "未提供"}</dd><dt>ERP经营关联</dt><dd>{item.salesMatched ? "已关联原ERP经营范围" : "未关联"} · 成本 {item.salesMatched ? number(item.costPriceCents, true) : "—"} 元 · 退货率 {item.salesMatched && item.refundRate !== null ? `${(item.refundRate * 100).toFixed(2)}%` : "—"}</dd><dt>资料质量</dt><dd>{quality(item)}</dd></dl><div className="np-toolbar">{(item.platform === "京东" && item.skuId || item.platform === "天猫" && item.spuId) && <button type="button" onClick={() => openPerformance(item)}>查看{item.platform === "天猫" ? "SPU" : "SKU"}经营</button>}{safeProductUrl(item.productUrl) && <a href={safeProductUrl(item.productUrl)!} target="_blank" rel="noreferrer">平台商品链接 ↗</a>}</div>{item.platform === "天猫" && <p className="np-note">天猫SKU仅具备目录资料，不能以此生成SKU日经营、趋势或历史SKU贡献。</p>}</ProductsPanel>}
  </div>;
}
