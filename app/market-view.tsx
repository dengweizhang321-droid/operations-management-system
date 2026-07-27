"use client";
/* eslint-disable @next/next/no-img-element -- Market ranking thumbnails are imported business assets. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarketAnnotationView from "./market-annotation-view";

type CurrentUser = { email: string; role: "viewer" | "analyst" | "operator" | "admin" } | null;
type FilterOption = { value: string; count: number };
type MarketItem = {
  id: number; periodStart: string; periodEnd: string; category: string; scope: string; rankingDimension: "SKU" | "SPU";
  operationMode: "POP" | "自营" | "未知"; subcategory: string; rank: number | null; previousRank: number | null; rankChange: number | null;
  skuCode: string; productName: string; brand: string; priceCents: number | null; marketPriceCents: number | null; marketPriceSource: string;
  averageTransactionPriceCents: number | null; discountBps: number | null; discountReference: boolean;
  gmvCents: number; quantity: number; pageViews: number; visitors: number; conversionBps: number | null;
  cartCustomers: number; searchClicks: number; imageUrl: string; productUrl: string; sourceImageUrl: string; imageCacheStatus: string;
  periodCount: number; isOwn: boolean; ownSalesCents: number; gmvOutOfBand?: boolean;
};
type MarketOverview = {
  summary: {
    productCount: number; categoryCount: number; brandCount: number; gmvCents: number; quantity: number; pageViews: number; visitors: number;
    ownProductCount: number; activeSkuCount: number; pendingAiCount: number; selfOperatedGmvCents: number; selfOperatedShareBps: number | null;
    medianMarketPriceCents: number | null; weightedMarketPriceCents: number | null; averageTransactionPriceCents: number | null;
  };
  items: MarketItem[];
  trend: Array<Record<string, string | number | null>>;
  priceBands: FilterOption[];
  priceBandSummary: Array<{ priceBand: string; gmvCents: number; quantity: number; skuCount: number; popGmvCents: number; selfGmvCents: number; gmvShareBps: number; selfOperatedShareBps: number | null; mainBrands: string[] }>;
  priceBandTrend: Array<{ period: string; priceBand: string; gmvCents: number; quantity: number; gmvShareBps: number }>;
  brandAnalysis: { items: Array<{ brand: string; gmvCents: number; quantity: number; skuCount: number; bestRank: number | null; gmvShareBps: number; priceBands: string[]; subcategories: string[] }>; cr3Bps: number; cr5Bps: number; concentration: string };
  subcategorySummary: Array<{ subcategory: string; skuCount: number; gmvCents: number; gmvShareBps: number; quantity: number; averageTransactionPriceCents: number | null; selfOperatedShareBps: number | null; pendingSkuCount: number; mainBrands: string[]; mainPriceBands: string[] }>;
  filters: { categories: FilterOption[]; scopes: FilterOption[]; brands: FilterOption[]; rankingDimensions: FilterOption[]; operationModes: FilterOption[]; subcategories: FilterOption[]; priceBands: FilterOption[] };
  dataRange: { startDate: string | null; endDate: string | null };
  batches: Array<{ id: string; fileName: string; sourceType: string; rowCount: number; insertedCount: number; updatedCount: number; warningCount: number; completedAt: string | null }>;
  imageCache: { total: number; cached: number; failed: number; pending: number };
  error?: string;
};
type TrendPayload = { items: Array<Record<string, string | number | null>>; error?: string };
type ComparePayload = {
  items: Array<{
    skuCode: string; productName: string; brand: string; category: string; rankingDimension: string;
    gmvCents: number; quantity: number; visitors: number; conversionBps: number | null; bestRank: number | null;
    marketPriceCents: number | null; averageTransactionPriceCents: number | null;
    trend: Array<Record<string, string | number | null>>;
  }>;
  error?: string;
};
type BrandRecognitionJob = {
  id: string; modelId: string; query: string; category: string; status: "queued" | "running" | "paused" | "failed" | "completed";
  totalCount: number; processedCount: number; remainingCount: number; recognizedCount: number; emptyCount: number;
  batchSize: number; progressBps: number; createdAt: string; startedAt: string | null; updatedAt: string; completedAt: string | null; lastError: string;
};
type MarketMasterWorkspace = {
  masterData: { items: Array<Record<string, string | number | null>>; pagination: { total: number; page: number; pageSize: number; pageCount: number } };
  pendingPrices: { items: Array<Record<string, string | number | null>>; pagination: { total: number; page: number; pageSize: number; pageCount: number } };
  mappings: { items: Array<Record<string, string | number | null>> };
  priceBands: { items: Array<Record<string, unknown>> };
  downloadTasks: Array<Record<string, string | number | null>>;
  downloadConfigs: Array<Record<string, string | number | null>>;
  coverage: Array<Record<string, string | number | null>>;
  imageCache: { total: number; cached: number; failed: number; pending: number };
  categories: FilterOption[];
  subcategories: FilterOption[];
  priceRecognition: { prompts: Array<{ prompt_id: string; category: string; pending_count: number }> };
  brandRecognitionJob: BrandRecognitionJob | null;
  brandSeeds: {
    dictionary: {
      items: Array<Record<string, string | number | null>>;
      counts: { total: number; enabled: number; system: number; manual: number };
    };
    unknown: {
      items: Array<Record<string, string | number | null>>;
      pagination: { total: number; page: number; pageCount: number };
    };
  };
  statusCounts: { total: number; pendingPrices: number; confirmedPrices: number };
  subcategorySettings: {
    category: string; categories: FilterOption[];
    items: Array<{ subcategory: string; sku_count: number; annotation_count: number; status: string; sort_order: number }>;
  };
  audits: Array<Record<string, string | number | null>>;
  error?: string;
};
type MarketSectionKey = "ranking" | "overview" | "compare" | "settings";
type MarketSettingsTab = "database" | "subcategory" | "brand" | "mapping" | "data";
type AiModelSummary = { id: string; name: string; modelType: "text" | "vision"; modelName: string; status: "enabled" | "disabled"; isDefaultTextModel: boolean };

const money = (cents?: number | null) => cents === null || cents === undefined
  ? "-"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(cents / 100);
const count = (value = 0) => new Intl.NumberFormat("zh-CN").format(value);
const percent = (bps?: number | null) => bps === null || bps === undefined ? "-" : `${(bps / 100).toFixed(2)}%`;
const monthText = (start: string | null, end: string | null) => start && end ? `${start.slice(0, 7)} 至 ${end.slice(0, 7)}` : "暂无月份";
const marketProductHref = (productUrl: unknown, skuCode: unknown) => {
  const direct = typeof productUrl === "string" ? productUrl.trim() : "";
  if (/^https:\/\//i.test(direct)) return direct;
  const sku = String(skuCode ?? "").trim();
  return /^\d{6,20}$/.test(sku) ? `https://item.jd.com/${sku}.html` : "";
};
const priceSourceLabel = (source: unknown) => ({
  ai_suggestion: "AI 主图识别",
  source_table: "源表参考价（非 AI）",
  average_transaction: "成交均价（非 AI）",
  missing: "暂无候选价",
}[String(source ?? "")] ?? String(source ?? "未知来源"));
const manualMarketPriceLabel = "人工确认市场定位价（元）";
const brandJobEta = (job: BrandRecognitionJob | null) => {
  if (!job?.startedAt || job.processedCount <= 0 || job.remainingCount <= 0) return job?.status === "completed" ? "已完成" : "运行后计算";
  const elapsedSeconds = Math.max(1, (Date.now() - new Date(job.startedAt).getTime()) / 1000);
  const remainingSeconds = Math.round(job.remainingCount / (job.processedCount / elapsedSeconds));
  if (remainingSeconds < 60) return "约 1 分钟内";
  if (remainingSeconds < 3600) return `约 ${Math.ceil(remainingSeconds / 60)} 分钟`;
  return `约 ${(remainingSeconds / 3600).toFixed(1)} 小时`;
};

function SearchMultiFilter({ label, values, options, onChange }: { label: string; values: string[]; options: FilterOption[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const visible = options.filter((option) => option.value.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  return <div className="market-filter" ref={root}>
    <button type="button" className={values.length ? "active" : ""} onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <span>{label}</span><strong>{values.length ? `已选 ${values.length}` : `全部${label}`}</strong><em>⌄</em>
    </button>
    {open && <div className="market-filter-popover">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} autoFocus />
      <button type="button" className="market-filter-all" onClick={() => onChange([])}><i className={!values.length ? "checked" : ""} />全部{label}</button>
      <div>{visible.map((option) => <button type="button" key={option.value} onClick={() => toggle(option.value)}>
        <i className={values.includes(option.value) ? "checked" : ""} /><span>{option.value}</span><small>{count(option.count)}</small>
      </button>)}{visible.length === 0 && <p>未找到匹配内容</p>}</div>
    </div>}
  </div>;
}

function KpiCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className="panel"><span className={`market-kpi-dot ${tone}`} /><small>{label}</small><strong>{value}</strong><p>{note}</p></article>;
}

function MarketSectionNav({ active, compareCount, onChange }: { active: MarketSectionKey; compareCount: number; onChange: (section: MarketSectionKey) => void }) {
  const sections: Array<{ key: MarketSectionKey; number: string; label: string; note: string }> = [
    { key: "ranking", number: "01", label: "商品榜单", note: "TOP 商品、成交数据与单品趋势" },
    { key: "overview", number: "02", label: "市场概括", note: "规模、价格带、品牌与细分类目" },
    { key: "compare", number: "03", label: "竞品对比", note: "2–5 个 SKU 的指标与趋势对照" },
    { key: "settings", number: "04", label: "系统和 AI 设置", note: "主数据、导入、映射与 AI 工作流" },
  ];
  return <nav className="panel market-section-nav" aria-label="市场分析子板块">
    {sections.map((section) => <button type="button" key={section.key} className={active === section.key ? "active" : ""} aria-current={active === section.key ? "page" : undefined} onClick={() => onChange(section.key)}>
      <span>{section.number}</span><div><strong>{section.label}</strong><small>{section.note}</small></div>{section.key === "compare" && compareCount > 0 ? <em>{compareCount}</em> : <i>›</i>}
    </button>)}
  </nav>;
}

function MarketKpis({ data }: { data: MarketOverview }) {
  return <section className="market-kpi-grid market-kpi-grid-seven">
    <KpiCard label="主图价格中位数" value={money(data.summary.medianMarketPriceCents)} note="行业价格 KPI · 当前 TOP 榜单覆盖口径" tone="blue" />
    <KpiCard label="销售额加权主图价" value={money(data.summary.weightedMarketPriceCents)} note="按榜单销售额加权" tone="green" />
    <KpiCard label="榜单覆盖销售额" value={money(data.summary.gmvCents)} note="不能视为完整行业市场" tone="purple" />
    <KpiCard label="成交件数" value={count(data.summary.quantity)} note={`成交均价 ${money(data.summary.averageTransactionPriceCents)}`} tone="orange" />
    <KpiCard label="自营销售额占比" value={percent(data.summary.selfOperatedShareBps)} note={`${money(data.summary.selfOperatedGmvCents)} / 当前筛选销售额`} tone="green" />
    <KpiCard label="SKU 数" value={count(data.summary.productCount)} note={`${count(data.summary.brandCount)} 个品牌`} tone="blue" />
    <KpiCard label="品牌数" value={count(data.summary.brandCount)} note={`CR3 ${percent(data.brandAnalysis.cr3Bps)} · CR5 ${percent(data.brandAnalysis.cr5Bps)}`} tone="purple" />
  </section>;
}

function TrendSection({ data }: { data: MarketOverview }) {
  const metrics = [
    ["gmv_cents", "销售额", (value: number | null) => money(value)],
    ["quantity", "成交件数", (value: number | null) => count(value ?? 0)],
    ["weighted_market_price_cents", "市场定位价", (value: number | null) => money(value)],
    ["average_transaction_price_cents", "成交均价", (value: number | null) => money(value)],
    ["self_gmv_cents", "POP/自营销售额", (value: number | null) => money(value)],
    ["product_count", "SKU 数", (value: number | null) => count(value ?? 0)],
    ["brand_count", "品牌数", (value: number | null) => count(value ?? 0)],
  ] as const;
  const [metric, setMetric] = useState<(typeof metrics)[number][0]>("gmv_cents");
  const selected = metrics.find((item) => item[0] === metric) ?? metrics[0];
  const max = Math.max(1, ...data.trend.map((row) => Number(row[metric] ?? 0)));
  return <section className="panel market-section">
    <div className="section-header"><div><h2>月度趋势</h2><p>全部趋势均由服务端按完整筛选结果汇总。</p></div><select value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}>{metrics.map((item) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select></div>
    <div className="market-trend-chart">{data.trend.map((row) => {
      const value = Number(row[metric] ?? 0);
      return <div key={String(row.period)}><span style={{ height: `${Math.max(5, value / max * 100)}%` }} /><strong>{selected[2](row[metric] === null ? null : value)}</strong><small>{String(row.period)}</small></div>;
    })}{!data.trend.length && <p>暂无趋势数据</p>}</div>
  </section>;
}

function PriceBandSection({ data }: { data: MarketOverview }) {
  const max = Math.max(1, ...data.priceBandSummary.map((item) => item.gmvCents));
  return <section className="panel market-section">
    <div className="section-header"><div><h2>价格带分析</h2><p>价格带按照对应月份的市场定位价划分。</p></div></div>
    <div className="market-price-band-grid">{data.priceBandSummary.map((item) => <article key={item.priceBand}>
      <div><strong>{item.priceBand}</strong><span>{money(item.gmvCents)}</span></div>
      <i><b style={{ width: `${item.gmvCents / max * 100}%` }} /></i>
      <small>销售额占比 {percent(item.gmvShareBps)} · 成交 {count(item.quantity)} · SKU {count(item.skuCount)} · 自营 {percent(item.selfOperatedShareBps)}</small>
      <em>{item.mainBrands.slice(0, 3).join(" / ") || "暂无主要品牌"}</em>
    </article>)}</div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>价格带</th><th>销售额</th><th>当月销售占比</th><th>成交件数</th></tr></thead><tbody>{data.priceBandTrend.map((item) => <tr key={`${item.period}-${item.priceBand}`}><td>{item.period}</td><td>{item.priceBand}</td><td>{money(item.gmvCents)}</td><td>{percent(item.gmvShareBps)}</td><td>{count(item.quantity)}</td></tr>)}{!data.priceBandTrend.length && <tr><td colSpan={5}><div className="table-state">暂无价格带月度变化数据。</div></td></tr>}</tbody></table></div>
  </section>;
}

function BrandSection({ data }: { data: MarketOverview }) {
  const max = Math.max(1, ...data.brandAnalysis.items.map((item) => item.gmvCents));
  return <section className="panel market-section">
    <div className="section-header"><div><h2>品牌竞争及品牌份额</h2><p>品牌份额为当前 TOP 榜单覆盖口径；集中度：{data.brandAnalysis.concentration}。</p></div></div>
    <div className="market-brand-list">{data.brandAnalysis.items.slice(0, 12).map((item) => <article key={item.brand}>
      <label><strong>{item.brand}</strong><span>{percent(item.gmvShareBps)}</span></label>
      <i><b style={{ width: `${item.gmvCents / max * 100}%` }} /></i>
      <small>{money(item.gmvCents)} · 成交 {count(item.quantity)} · SKU {count(item.skuCount)} · 最好排名 {item.bestRank ? `#${item.bestRank}` : "-"}</small>
      <em>{[...item.priceBands.slice(0, 2), ...item.subcategories.slice(0, 2)].join(" / ")}</em>
    </article>)}</div>
  </section>;
}

function SubcategorySection({ data }: { data: MarketOverview }) {
  return <section className="panel market-section market-subcategory-panel">
    <div className="section-header"><div><h2>细分类目拆分汇总</h2><p>服务端完整汇总 SKU 数、销售额、成交件数、价格和待确认数据。</p></div></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>细分类目</th><th>SKU 数</th><th>销售额</th><th>销售占比</th><th>成交件数</th><th>成交均价</th><th>自营占比</th><th>主要品牌</th><th>主力价格带</th><th>待确认 SKU</th></tr></thead><tbody>
      {data.subcategorySummary.map((item) => <tr key={item.subcategory}><td>{item.subcategory || "未分类"}</td><td>{count(item.skuCount)}</td><td>{money(item.gmvCents)}</td><td>{percent(item.gmvShareBps)}</td><td>{count(item.quantity)}</td><td>{money(item.averageTransactionPriceCents)}</td><td>{percent(item.selfOperatedShareBps)}</td><td>{item.mainBrands.join(" / ") || "-"}</td><td>{item.mainPriceBands.join(" / ") || "-"}</td><td>{count(item.pendingSkuCount)}</td></tr>)}
      {!data.subcategorySummary.length && <tr><td colSpan={10}><div className="table-state">当前筛选范围暂无细分类目数据。</div></td></tr>}
    </tbody></table></div>
  </section>;
}

function RankingTable({ items, compareIds, onToggleCompare, onTrend, onOpenCompare }: { items: MarketItem[]; compareIds: string[]; onToggleCompare: (sku: string) => void; onTrend: (item: MarketItem) => void; onOpenCompare: () => void }) {
  return <section className="panel market-table-panel">
    <div className="section-header"><div><h2>商品榜单</h2><p>标题下方固定展示周期、SKU ID、POP/自营、品牌、细分类目和确认状态。</p></div><div className="market-ranking-actions"><span className="soft-tag">显示 {count(items.length)} 条</span><button type="button" className="secondary-button" disabled={compareIds.length < 2} onClick={onOpenCompare}>进入竞品对比{compareIds.length ? `（${compareIds.length}）` : ""}</button></div></div>
    <div className="data-table-wrap"><table className="data-table market-ranking-table market-ranking-table-v2"><thead><tr>
      <th>对比</th><th>排名</th><th>商品主图和标题</th><th>销售额</th><th>成交件数</th><th>市场定位价（主图）</th><th>成交均价</th><th>访客</th><th>转化率</th><th>排名变化</th><th>趋势操作</th>
    </tr></thead><tbody>{items.map((item) => <tr key={item.id}>
      <td><button type="button" className={`market-compare-check ${compareIds.includes(item.skuCode) ? "active" : ""}`} onClick={() => onToggleCompare(item.skuCode)} aria-label={`选择对比 ${item.productName || item.skuCode}`}>{compareIds.includes(item.skuCode) ? "✓" : "+"}</button></td>
      <td><strong>{item.rank ? `#${item.rank}` : "-"}</strong><small>{item.rankingDimension}</small></td>
      <td><div className="market-product-cell">{item.imageUrl ? (marketProductHref(item.productUrl, item.skuCode) ? <a href={marketProductHref(item.productUrl, item.skuCode)} target="_blank" rel="noreferrer"><img src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></a> : <span><img src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></span>) : <span>图</span>}<div>{marketProductHref(item.productUrl, item.skuCode) ? <a className="market-product-title-link" href={marketProductHref(item.productUrl, item.skuCode)} target="_blank" rel="noreferrer">{item.productName || "未命名商品"}</a> : <strong>{item.productName || "未命名商品"}</strong>}<small>{item.periodStart} 至 {item.periodEnd} · 上榜 {count(item.periodCount)} 期 · SKU {item.skuCode}</small><small>{item.operationMode} · {item.brand || "品牌待识别"} · {item.subcategory || "未分类"} · {item.marketPriceSource}</small></div></div></td>
      <td><strong>{money(item.gmvCents)}</strong><small>当前 TOP 榜单覆盖口径</small></td>
      <td>{count(item.quantity)}</td>
      <td><strong>{money(item.marketPriceCents)}</strong><small>{item.marketPriceSource}</small></td>
      <td><strong>{money(item.averageTransactionPriceCents)}</strong><small>{item.discountBps === null ? "无折让率" : `${item.discountReference ? "参考" : "成交"}折让率 ${percent(item.discountBps)}`}</small></td>
      <td>{count(item.visitors)}</td><td>{percent(item.conversionBps)}</td>
      <td>{item.rankChange === null ? "-" : item.rankChange > 0 ? `↑${item.rankChange}` : item.rankChange < 0 ? `↓${Math.abs(item.rankChange)}` : "持平"}</td>
      <td><button type="button" className="row-action" onClick={() => onTrend(item)}>查看趋势</button></td>
    </tr>)}{items.length === 0 && <tr><td colSpan={11}><div className="table-state">当前筛选范围没有商品数据。</div></td></tr>}</tbody></table></div>
  </section>;
}

function TrendDrawer({ item, onClose }: { item: MarketItem; onClose: () => void }) {
  const [data, setData] = useState<TrendPayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ skuCode: item.skuCode, category: item.category, dimension: item.rankingDimension });
    void fetch(`/api/market/trend?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as TrendPayload | null;
        if (!response.ok || !payload) throw new Error(payload?.error || "趋势读取失败");
        setData(payload);
      })
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "趋势读取失败"); });
    return () => controller.abort();
  }, [item]);
  return <div className="modal-backdrop" onClick={onClose}><section className="market-trend-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
    <header><div><span>{item.skuCode}</span><h3>{item.productName || item.skuCode}</h3><small>{item.category} · {item.rankingDimension}</small></div><button onClick={onClose} aria-label="关闭">×</button></header>
    {error && <div className="market-feedback error">{error}</div>}
    {!data && !error && <div className="table-state"><span className="state-spinner" />正在读取全量月度趋势…</div>}
    {data && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>销售额</th><th>成交件数</th><th>市场定位价</th><th>成交均价</th><th>排名</th><th>POP/自营</th><th>价格确认状态</th></tr></thead><tbody>{data.items.map((row) => <tr key={`${row.month}-${row.rank}`}>
      <td>{String(row.month)}</td><td>{money(Number(row.gmvCents ?? 0))}</td><td>{count(Number(row.quantity ?? 0))}</td><td>{money(row.marketPriceCents === null ? null : Number(row.marketPriceCents))}</td><td>{money(row.averageTransactionPriceCents === null ? null : Number(row.averageTransactionPriceCents))}</td><td>{row.rank === null ? "-" : `#${row.rank}`}</td><td>{String(row.operationMode)}</td><td>{String(row.priceStatus)} · {String(row.confirmationStatus)}</td>
    </tr>)}</tbody></table></div>}
  </section></div>;
}

function CompareWorkspace({ items, compareIds, onClear, onToggleCompare, onGoRanking, categories, rankingDimensions, operationModes, brands, subcategories, priceBands, startDate, endDate }: {
  items: MarketItem[]; compareIds: string[]; onClear: () => void; onToggleCompare: (sku: string) => void; onGoRanking: () => void;
  categories: string[]; rankingDimensions: string[]; operationModes: string[]; brands: string[]; subcategories: string[]; priceBands: string[];
  startDate: string; endDate: string;
}) {
  const selected = useMemo(() => compareIds.map((sku) => items.find((item) => item.skuCode === sku)).filter(Boolean) as MarketItem[], [compareIds, items]);
  const [data, setData] = useState<ComparePayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (compareIds.length < 2) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ view: "compare" });
    compareIds.forEach((sku) => params.append("skuCode", sku));
    categories.forEach((value) => params.append("category", value));
    [...new Set(selected.map((item) => item.scope).filter(Boolean))].forEach((value) => params.append("scope", value));
    rankingDimensions.forEach((value) => params.append("rankingDimension", value));
    operationModes.forEach((value) => params.append("operationMode", value));
    brands.forEach((value) => params.append("brand", value));
    subcategories.forEach((value) => params.append("subcategory", value));
    priceBands.forEach((value) => params.append("priceBand", value));
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    void fetch(`/api/market/master?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as ComparePayload | null;
        if (!response.ok || !payload) throw new Error(payload?.error || "商品对比读取失败");
        setData(payload);
        setError("");
      })
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "商品对比读取失败"); });
    return () => controller.abort();
  }, [compareIds, categories, rankingDimensions, operationModes, brands, subcategories, priceBands, startDate, endDate, selected]);
  if (selected.length < 2) return <section className="panel market-compare-workspace market-compare-empty">
    <div><span className="eyebrow">COMPETITOR BENCHMARK</span><h2>竞品对比工作区</h2><p>请先从商品榜单勾选 2–5 个 SKU。系统将使用当前筛选口径，对比销售额、成交件数、主图价格、成交均价、访客、转化率、排名和月度趋势。</p></div>
    <div className="market-compare-selection"><strong>已选择 {selected.length} / 5</strong>{selected.map((item) => <button type="button" key={item.skuCode} onClick={() => onToggleCompare(item.skuCode)}>{item.productName || item.skuCode}<span>×</span></button>)}</div>
    <button type="button" className="primary-button" onClick={onGoRanking}>前往商品榜单选择</button>
  </section>;
  const compared = compareIds.map((skuCode) => data?.items.find((item) => item.skuCode === skuCode)).filter(Boolean) as NonNullable<ComparePayload>["items"];
  const maxTrend = Math.max(1, ...compared.flatMap((item) => item.trend.map((row) => Number(row.gmvCents ?? 0))));
  return <section className="panel market-compare-workspace">
    <header><div><span className="eyebrow">COMPETITOR BENCHMARK</span><h2>竞品对比工作区</h2><p>当前筛选条件会同步应用到所选 SKU 的完整汇总和月度趋势。</p></div><div><strong>已选择 {selected.length} / 5</strong><button type="button" className="secondary-button" onClick={onGoRanking}>继续选择</button><button type="button" className="row-action" onClick={onClear}>清空</button></div></header>
    <div className="market-compare-selection">{selected.map((item) => <button type="button" key={item.skuCode} onClick={() => onToggleCompare(item.skuCode)}>{item.productName || item.skuCode}<span>×</span></button>)}</div>
    {error && <small className="red-text">{error}</small>}
    {!data && !error && <small>正在读取对比数据...</small>}
    {data && <div className="market-compare-grid market-compare-grid-live">
      <div className="metric-labels"><strong>指标</strong>{["销售额", "成交件数", "市场定位价", "成交均价", "访客", "转化率", "最好排名", "月度趋势"].map((label) => <span key={label}>{label}</span>)}</div>
      {compared.map((item) => <article key={item.skuCode}>
        <strong title={item.productName}>{item.productName || item.skuCode}</strong><small>{item.skuCode} · {item.brand || "-"} · {item.rankingDimension}</small><button type="button" aria-label={`移除 ${item.productName || item.skuCode}`} onClick={() => onToggleCompare(item.skuCode)}>×</button>
        <span>{money(item.gmvCents)}</span><span>{count(item.quantity)}</span><span>{money(item.marketPriceCents)}</span><span>{money(item.averageTransactionPriceCents)}</span>
        <span>{count(item.visitors)}</span><span>{percent(item.conversionBps)}</span><span>{item.bestRank ? `#${item.bestRank}` : "-"}</span>
        <span><i className="market-compare-spark">{item.trend.slice(-12).map((row) => <b key={String(row.month)} style={{ height: `${Math.max(4, Number(row.gmvCents ?? 0) / maxTrend * 28)}px` }} title={`${String(row.month)} ${money(Number(row.gmvCents ?? 0))}`} />)}</i></span>
      </article>)}
    </div>}
  </section>;
}

export function MarketDataImportPanel({ currentUser, data, onImported }: { currentUser: CurrentUser; data: MarketOverview | null; onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState("market_ranking");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("全部SKU");
  const [priceBandFilter, setPriceBandFilter] = useState("全部");
  const [periodStart, setPeriodStart] = useState(data?.dataRange.startDate ?? new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(data?.dataRange.endDate ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const upload = async () => {
    if (!file) { setError("请先选择 XLS、XLSX 或 CSV 文件"); return; }
    setBusy(true); setError(""); setFeedback("");
    try {
      const form = new FormData();
      form.set("file", file); form.set("sourceType", sourceType); form.set("category", category);
      form.set("scope", scope); form.set("priceBandFilter", priceBandFilter); form.set("periodStart", periodStart); form.set("periodEnd", periodEnd);
      const response = await fetch("/api/market/import", { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as { error?: string; message?: string; batch?: { id: string }; imageCache?: { pending: number; cached: number; failed: number } } | null;
      if (!response.ok) throw new Error(payload?.error || "导入失败");
      setFeedback(payload?.message || "市场数据导入完成");
      setFile(null); onImported?.();
      if (payload?.batch?.id && (payload.imageCache?.pending ?? 0) > 0) {
        let pending = payload.imageCache.pending;
        let cached = payload.imageCache.cached;
        let failed = payload.imageCache.failed;
        for (let round = 0; round < 50 && pending > 0; round += 1) {
          setFeedback(`数据已导入，正在自动缓存商品图：已缓存 ${cached}，待处理 ${pending}`);
          const cacheResponse = await fetch("/api/market/images/cache", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: payload.batch.id, limit: 24 }) });
          const cachePayload = await cacheResponse.json().catch(() => null) as { error?: string; result?: { processed: number; pending: number; cached: number; failed: number } } | null;
          if (!cacheResponse.ok || !cachePayload?.result) throw new Error(`市场数据已导入，但图片缓存中断：${cachePayload?.error || "缓存接口无响应"}`);
          ({ pending, cached, failed } = cachePayload.result);
          if (cachePayload.result.processed === 0) break;
        }
        setFeedback(`市场数据与商品图处理完成：已缓存 ${cached} 张，待处理 ${pending} 张，失败 ${failed} 张`);
        onImported?.();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); }
    finally { setBusy(false); }
  };
  return <section className="panel market-import-card"><div className="section-header"><div><h2>市场数据导入</h2><p>位于市场分析 → 系统和 AI 设置；导入会保留原榜单、图片缓存和已确认价格。</p></div></div>
    {!currentUser || currentUser.role !== "admin" ? <div className="market-import-permission">仅管理员可导入市场数据。</div> : <>
      {(feedback || error) && <div className={`market-feedback ${error ? "error" : "success"}`}>{error || feedback}</div>}
      <div className="market-import-form">
        <label><span>数据类型</span><div className="market-segmented"><button type="button" className={sourceType === "market_ranking" ? "active" : ""} onClick={() => setSourceType("market_ranking")}>商品榜单</button><button type="button" className={sourceType === "sku_catalog" ? "active" : ""} onClick={() => setSourceType("sku_catalog")}>SKU 资料</button></div></label>
        <label><span>默认类目</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="文件无类目列时使用" /></label>
        <label><span>默认口径</span><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="全部SKU / POP SKU / 自营 SPU" /></label>
        <label><span>榜单价格段</span><input value={priceBandFilter} onChange={(event) => setPriceBandFilter(event.target.value)} placeholder="全部 / 0-500 / 500-1000" /></label>
        <label><span>周期开始</span><input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label><span>周期结束</span><input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        <label className="market-file-picker"><span>数据文件</span><input type="file" accept=".xls,.xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><strong>{file ? file.name : "选择 XLS / XLSX / CSV"}</strong><small>最大 25MB；SKU/SPU 维度会独立保存。</small></label>
      </div><button type="button" className="primary-button" disabled={busy} onClick={() => void upload()}>{busy ? "正在导入…" : "开始导入"}</button>
    </>}
  </section>;
}

export function MarketWorkflowPanel({ data }: { data: MarketOverview | null }) {
  return <section className="panel market-batch-list"><div className="section-header"><div><h2>AI 数据工作流与任务记录</h2><p>自动下载导入、结构化校验、缺失字段识别、人工确认和发布均在此跟踪。</p></div></div>
    <div className="market-workflow-steps">{["自动下载导入", "结构化校验", "缺失字段识别", "人工确认", "发布到分析"].map((step, index) => <article key={step}><strong>{index + 1}</strong><span>{step}</span></article>)}</div>
    {data?.batches.map((batch) => <article key={batch.id}><div><strong>{batch.fileName}</strong><small>{batch.sourceType} · {batch.completedAt ? new Date(batch.completedAt).toLocaleString("zh-CN") : "处理中"}</small></div><span>{count(batch.rowCount)} 行</span><small>新增 {count(batch.insertedCount)} · 更新 {count(batch.updatedCount)} · 告警 {count(batch.warningCount)}</small></article>)}
    {!data?.batches.length && <p className="soft-text">暂无市场数据任务记录。</p>}
  </section>;
}

export function MarketMasterAdminPanel({ currentUser, mode = "database" }: { currentUser: CurrentUser; mode?: MarketSettingsTab }) {
  const [data, setData] = useState<MarketMasterWorkspace | null>(null);
  const [aiModels, setAiModels] = useState<AiModelSummary[]>([]);
  const [brandModelId, setBrandModelId] = useState("");
  const [brandDrafts, setBrandDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [masterPageSize, setMasterPageSize] = useState(30);
  const [databaseView, setDatabaseView] = useState<"cards" | "table">("cards");
  const [rankingDimension, setRankingDimension] = useState("");
  const [operationMode, setOperationMode] = useState("");
  const [subcategoryFilter, setSubcategoryFilter] = useState("");
  const [priceStatus, setPriceStatus] = useState<"" | "pending" | "confirmed" | "missing">("");
  const [annotationStatus, setAnnotationStatus] = useState<"" | "pending" | "committed">("");
  const [visionModelId, setVisionModelId] = useState("");
  const [priceCategory, setPriceCategory] = useState("");
  const [pendingPriceSource, setPendingPriceSource] = useState<"" | "ai" | "non_ai">("");
  const [pendingPricePage, setPendingPricePage] = useState(1);
  const [pendingPricePageSize, setPendingPricePageSize] = useState(20);
  const [editingSku, setEditingSku] = useState<Record<string, string | number | null> | null>(null);
  const [skuDraft, setSkuDraft] = useState({ category: "", productName: "", brand: "", operationMode: "POP", subcategory: "", priceYuan: "", priceType: "标准售价" });
  const [subcategoryDrafts, setSubcategoryDrafts] = useState<Record<string, string>>({});
  const [newSubcategory, setNewSubcategory] = useState("");
  const [brandJob, setBrandJob] = useState<BrandRecognitionJob | null>(null);
  const brandRunnerStop = useRef(false);
  const loadRequestId = useRef(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isAdmin = currentUser?.role === "admin";
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    const params = new URLSearchParams();
    params.set("section", mode);
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    if (rankingDimension) params.set("rankingDimension", rankingDimension);
    if (operationMode) params.set("operationMode", operationMode);
    if (subcategoryFilter) params.set("subcategory", subcategoryFilter);
    if (priceStatus) params.set("priceStatus", priceStatus);
    if (pendingPriceSource) params.set("priceSource", pendingPriceSource);
    if (annotationStatus) params.set("annotationStatus", annotationStatus);
    params.set("page", String(page));
    params.set("pageSize", String(masterPageSize));
    const [response, modelsResponse] = await Promise.all([
      fetch(`/api/market/master?${params}`, { cache: "no-store" }),
      isAdmin && (mode === "database" || mode === "brand") ? fetch("/api/ai/models", { cache: "no-store" }) : Promise.resolve(null),
    ]);
    const payload = await response.json().catch(() => null) as MarketMasterWorkspace | null;
    const modelsPayload = modelsResponse
      ? await modelsResponse.json().catch(() => null) as { items?: AiModelSummary[]; error?: string } | null
      : null;
    if (requestId !== loadRequestId.current) return;
    if (!response.ok || !payload) throw new Error(payload?.error || "市场主数据读取失败");
    if (modelsResponse && !modelsResponse.ok) throw new Error(modelsPayload?.error || "运营管理系统 AI 算力读取失败");
    setData(payload);
    setBrandJob(payload.brandRecognitionJob);
    setPriceCategory((current) => current || payload.priceRecognition.prompts[0]?.category || "");
    setSubcategoryDrafts(Object.fromEntries(payload.subcategorySettings.items.map((item) => [String(item.subcategory), String(item.subcategory)])));
    if (modelsResponse) {
      const models = modelsPayload?.items ?? [];
      setAiModels(models);
      setBrandModelId((current) => current || models.find((item) => item.status === "enabled" && item.modelType === "text" && item.isDefaultTextModel)?.id || models.find((item) => item.status === "enabled" && item.modelType === "text")?.id || "");
      setVisionModelId((current) => current || models.find((item) => item.status === "enabled" && item.modelType === "vision")?.id || "");
    }
  }, [query, category, page, masterPageSize, pendingPriceSource, rankingDimension, operationMode, subcategoryFilter, priceStatus, annotationStatus, isAdmin, mode]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "市场主数据读取失败")); }, 200); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => () => { brandRunnerStop.current = true; }, []);
  const post = async (body: Record<string, unknown>) => {
    setBusy(String(body.action ?? "action")); setError(""); setNotice("");
    try {
      const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "市场主数据操作失败");
      setNotice("操作已保存");
      await load();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "市场主数据操作失败"); return false; }
    finally { setBusy(""); }
  };
  const brandRowKey = (row: Record<string, string | number | null>) => `${row.category}|${row.scope}|${row.rankingDimension}|${row.skuCode}`;
  const inferBrand = async (row: Record<string, string | number | null>) => {
    if (!brandModelId) { setError("请先在 AI 助理配置中启用一个文本模型"); return; }
    const key = brandRowKey(row);
    setBusy(`infer_brand:${key}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "infer_brand", modelId: brandModelId, productName: row.productName }) });
      const payload = await response.json().catch(() => null) as { error?: string; result?: { brand?: string } } | null;
      if (!response.ok) throw new Error(payload?.error || "AI 品牌识别失败");
      const brand = payload?.result?.brand?.trim() ?? "";
      setBrandDrafts((current) => ({ ...current, [key]: brand }));
      setNotice(brand ? `AI 建议品牌：${brand}，请人工确认后保存` : "AI 无法可靠识别，已按要求留空，可手工填写");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI 品牌识别失败"); }
    finally { setBusy(""); }
  };
  const confirmBrand = (row: Record<string, string | number | null>) => {
    const key = brandRowKey(row);
    const brand = (brandDrafts[key] ?? String(row.brand ?? "")).trim();
    if (!brand) { setError("品牌为空时保持待识别；如需确认，请先填写品牌"); return; }
    void post({ action: "confirm_brand", category: row.category, scope: row.scope, rankingDimension: row.rankingDimension, skuCode: row.skuCode, brand });
  };
  const editSku = (row: Record<string, string | number | null>) => {
    setEditingSku(row);
    setSkuDraft({
      category: String(row.category ?? ""), productName: String(row.productName ?? ""), brand: String(row.brand ?? ""),
      operationMode: String(row.operationMode ?? "POP"), subcategory: String(row.subcategory ?? ""),
      priceYuan: row.officialMarketPriceCents === null ? (row.candidatePriceCents === null ? "" : String(Number(row.candidatePriceCents) / 100)) : String(Number(row.officialMarketPriceCents) / 100),
      priceType: ["标准售价", "到手价", "券后价", "起售价", "价格区间", "最低规格价格"].includes(String(row.aiPriceType)) ? String(row.aiPriceType) : "标准售价",
    });
  };
  const modifyProductBrand = editSku;
  const confirmPrice = editSku;
  const saveSku = async () => {
    if (!editingSku) return;
    const priceYuan = skuDraft.priceYuan.trim() === "" ? null : Number(skuDraft.priceYuan);
    if (priceYuan !== null && (!Number.isFinite(priceYuan) || priceYuan < 0 || priceYuan > 1_000_000)) { setError(`${manualMarketPriceLabel}必须是 0 到 1,000,000 之间的数字`); return; }
    const saved = await post({ action: "update_sku_master", originalCategory: editingSku.category, category: skuDraft.category, scope: editingSku.scope,
      rankingDimension: editingSku.rankingDimension, skuCode: editingSku.skuCode, month: editingSku.month, productName: skuDraft.productName,
      brand: skuDraft.brand, operationMode: skuDraft.operationMode, subcategory: skuDraft.subcategory,
      priceCents: priceYuan === null ? null : Math.round(priceYuan * 100), priceType: skuDraft.priceType });
    if (saved) setEditingSku(null);
  };
  const saveSubcategories = async () => {
    if (!category) { setError("请先选择一个三级类目"); return; }
    const renames = Object.entries(subcategoryDrafts).filter(([source, target]) => target.trim() && source !== target.trim()).map(([source, target]) => ({ source, target: target.trim() }));
    const additions = newSubcategory.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
    const saved = await post({ action: "save_subcategory_settings", category, renames, additions });
    if (saved) setNewSubcategory("");
  };
  const runBrandRecognitionJob = async (jobId: string) => {
    brandRunnerStop.current = false;
    setBusy("recognize_brand_all"); setError("");
    try {
      while (!brandRunnerStop.current) {
        const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run_brand_recognition_job_batch", jobId }) });
        const payload = await response.json().catch(() => null) as { error?: string; result?: { job?: BrandRecognitionJob | null; done?: boolean; paused?: boolean; waiting?: boolean } } | null;
        if (!response.ok) throw new Error(payload?.error || "批量品牌识别失败");
        const nextJob = payload?.result?.job ?? null;
        if (nextJob) {
          setBrandJob(nextJob);
          setNotice(`品牌识别 ${percent(nextJob.progressBps)}：已处理 ${count(nextJob.processedCount)} / ${count(nextJob.totalCount)}，剩余 ${count(nextJob.remainingCount)}`);
        }
        if (payload?.result?.done || payload?.result?.paused || nextJob?.status === "completed" || nextJob?.status === "paused") break;
        if (payload?.result?.waiting) await new Promise((resolve) => window.setTimeout(resolve, 800));
      }
      if (!brandRunnerStop.current) {
        const latest = await fetch(`/api/market/master?view=brand_job&q=${encodeURIComponent(query.trim())}&category=${encodeURIComponent(category)}`, { cache: "no-store" }).then((response) => response.json()) as BrandRecognitionJob | null;
        setBrandJob(latest);
        if (latest?.status === "completed") setNotice(`全页品牌识别已完成：共处理 ${count(latest.processedCount)} 个商品，生成 ${count(latest.recognizedCount)} 个品牌候选。`);
      }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "批量品牌识别失败"); }
    finally { setBusy(""); }
  };
  const recognizeAllBrands = async () => {
    if (!brandModelId) { setError("请先选择已启用的文本模型"); return; }
    setBusy("recognize_brand_all"); setError(""); setNotice("正在创建可恢复的全页品牌识别任务…");
    try {
      let job = brandJob;
      if (job && ["queued", "running", "paused", "failed"].includes(job.status)) {
        const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resume_brand_recognition_job", jobId: job.id }) });
        const payload = await response.json().catch(() => null) as { error?: string; result?: BrandRecognitionJob } | null;
        if (!response.ok || !payload?.result) throw new Error(payload?.error || "品牌识别任务恢复失败");
        job = payload.result;
      } else {
        const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_brand_recognition_job", modelId: brandModelId, q: query.trim(), category, batchSize: 40 }) });
        const payload = await response.json().catch(() => null) as { error?: string; result?: BrandRecognitionJob } | null;
        if (!response.ok || !payload?.result) throw new Error(payload?.error || "品牌识别任务创建失败");
        job = payload.result;
      }
      setBrandJob(job);
      if (job.status === "completed") { setNotice("当前筛选范围没有待识别商品。"); setBusy(""); return; }
      await runBrandRecognitionJob(job.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "批量品牌识别失败"); setBusy(""); }
  };
  const pauseBrandRecognition = async () => {
    if (!brandJob) return;
    brandRunnerStop.current = true;
    setNotice("正在暂停；当前 40 条完成后停止…");
    try {
      const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause_brand_recognition_job", jobId: brandJob.id }) });
      const payload = await response.json().catch(() => null) as { error?: string; result?: BrandRecognitionJob } | null;
      if (!response.ok || !payload?.result) throw new Error(payload?.error || "品牌识别任务暂停失败");
      setBrandJob(payload.result); setNotice(`任务已暂停，进度 ${percent(payload.result.progressBps)}，刷新或关闭页面不会丢失。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "品牌识别任务暂停失败"); }
    finally { setBusy(""); }
  };
  const confirmAllBrandSuggestions = async () => {
    setBusy("confirm_brand_all"); setError(""); setNotice("正在确认当前筛选下的全部 AI 品牌候选…");
    let confirmed = 0;
    try {
      for (;;) {
        const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm_brand_suggestions_batch", q: query.trim(), category, batchSize: 25 }) });
        const payload = await response.json().catch(() => null) as { error?: string; result?: { confirmed?: number; done?: boolean } } | null;
        if (!response.ok) throw new Error(payload?.error || "批量确认品牌失败");
        confirmed += Number(payload?.result?.confirmed ?? 0);
        setNotice(`已确认 ${count(confirmed)} 个品牌候选`);
        if (payload?.result?.done || !payload?.result?.confirmed) break;
      }
      setNotice(`一键确认完成，共写入 ${count(confirmed)} 个品牌规则。`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "批量确认品牌失败"); }
    finally { setBusy(""); }
  };
  const refreshBrandSeeds = async () => {
    setBusy("refresh_brand_seeds"); setError(""); setNotice("正在从 ERP、库存、店铺商品和已确认市场品牌刷新系统词典…");
    try {
      const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh_brand_seeds" }) });
      const payload = await response.json().catch(() => null) as { error?: string; result?: { discovered?: number; inserted?: number; refreshed?: number; disabled?: number; manualPreserved?: number } } | null;
      if (!response.ok) throw new Error(payload?.error || "系统品牌刷新失败");
      const result = payload?.result;
      setNotice(`系统品牌刷新完成：发现 ${count(result?.discovered ?? 0)} 个，新增 ${count(result?.inserted ?? 0)} 个，更新 ${count(result?.refreshed ?? 0)} 个，停用失效系统种子 ${count(result?.disabled ?? 0)} 个，保留人工种子 ${count(result?.manualPreserved ?? 0)} 个。`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "系统品牌刷新失败"); }
    finally { setBusy(""); }
  };
  const upsertBrandSeed = async (row?: Record<string, string | number | null>) => {
    const suggestedBrand = row ? String(row.productName ?? "").split(/[（(\s]/)[0]?.slice(0, 30) ?? "" : "";
    const canonicalBrand = window.prompt("标准品牌名称", suggestedBrand)?.trim() ?? "";
    if (!canonicalBrand) return;
    const seedText = window.prompt("标题中的品牌种子词（可与标准品牌不同）", canonicalBrand)?.trim() ?? "";
    if (!seedText) return;
    setBusy("upsert_brand_seed"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        action: "upsert_brand_seed", canonicalBrand, seedText,
        category: row?.category, scope: row?.scope, rankingDimension: row?.rankingDimension, skuCode: row?.skuCode,
      }) });
      const payload = await response.json().catch(() => null) as { error?: string; result?: { appliedRows?: number } } | null;
      if (!response.ok) throw new Error(payload?.error || "品牌种子保存失败");
      setNotice(`品牌种子“${seedText} → ${canonicalBrand}”已保存${row ? `，当前 SKU 的 ${count(payload?.result?.appliedRows ?? 0)} 条历史记录已补齐` : ""}。`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "品牌种子保存失败"); }
    finally { setBusy(""); }
  };
  const matchSystemBrandSeeds = async () => {
    setBusy("match_brand_seeds"); setError(""); setNotice("正在按 B店/京东自营前缀规则与 C店/POP任意位置规则匹配未知品牌…");
    try {
      const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "match_brand_seeds", category }) });
      const payload = await response.json().catch(() => null) as { error?: string; result?: { scanned?: number; matchedSkuCount?: number; changedRows?: number; remainingSkuCount?: number; prefixMatched?: number; anywhereMatched?: number } } | null;
      if (!response.ok) throw new Error(payload?.error || "系统品牌匹配失败");
      const result = payload?.result;
      setNotice(`系统品牌匹配完成：扫描 ${count(result?.scanned ?? 0)} 个未知 SKU，匹配 ${count(result?.matchedSkuCount ?? 0)} 个（标题前缀 ${count(result?.prefixMatched ?? 0)}、任意位置 ${count(result?.anywhereMatched ?? 0)}），更新 ${count(result?.changedRows ?? 0)} 条历史记录，剩余 ${count(result?.remainingSkuCount ?? 0)} 个。`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "系统品牌匹配失败"); }
    finally { setBusy(""); }
  };
  const recognizePrices = async () => {
    if (!priceCategory || !visionModelId) { setError("请选择类目，并先在 AI 助理配置中启用一个视觉模型"); return; }
    setBusy("recognize_prices"); setError(""); setNotice("正在创建价格识别任务…");
    try {
      const createResponse = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_price_recognition_job", category: priceCategory, modelId: visionModelId, limit: 100 }) });
      const created = await createResponse.json().catch(() => null) as { error?: string; result?: { id?: string; totalCount?: number } } | null;
      if (!createResponse.ok || !created?.result?.id) throw new Error(created?.error || "价格识别任务创建失败");
      const total = Number(created.result.totalCount ?? 0);
      for (let index = 0; index <= total; index += 1) {
        const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run_price_recognition_next", jobId: created.result.id }) });
        const payload = await response.json().catch(() => null) as { error?: string; result?: { done?: boolean } } | null;
        if (!response.ok) throw new Error(payload?.error || "AI 价格识别失败");
        setNotice(`AI 价格识别 ${Math.min(index + 1, total)} / ${total}`);
        if (payload?.result?.done) break;
      }
      setNotice(`AI 价格识别完成，${count(total)} 条结果已进入待确认候选价。`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI 价格识别失败"); }
    finally { setBusy(""); }
  };
  const createMapping = (kind: string) => {
    const sourceValue = window.prompt("来源值") ?? "";
    const targetValue = window.prompt("目标值") ?? "";
    if (!sourceValue || !targetValue) return;
    void post({ action: "upsert_mapping", kind, sourceValue, targetValue, status: "published" });
  };
  const editMapping = (row: Record<string, string | number | null>) => {
    const targetValue = window.prompt("新的目标值", String(row.target_value ?? "")) ?? "";
    if (!targetValue.trim()) return;
    void post({
      action: "upsert_mapping",
      id: row.id,
      kind: row.kind,
      category: row.category,
      sourceValue: row.source_value,
      targetValue,
      status: row.status,
      effectiveFrom: row.effective_from,
    });
  };
  const createDownloadConfig = () => {
    const category = window.prompt("类目") ?? "";
    const scope = window.prompt("榜单口径（例如：全部、POP、自营）", "全部") ?? "全部";
    const rankingDimension = window.prompt("榜单维度 SKU/SPU", "SKU") ?? "SKU";
    const monthStart = window.prompt("起始月份 YYYY-MM") ?? "";
    const monthEnd = window.prompt("结束月份 YYYY-MM", monthStart) ?? monthStart;
    if (!category || !monthStart || !monthEnd) return;
    void post({ action: "upsert_download_config", category, scope, rankingDimension, monthStart, monthEnd, status: "enabled" });
  };
  const createPriceBandDraft = () => {
    const category = window.prompt("类目，留空表示全部", "*") ?? "*";
    const raw = window.prompt("价格带配置：label:min-max，每行一条", "0-499:0-50000\n500-999:50000-100000\n1000+:100000-") ?? "";
    const items = raw.split(/\n+/).map((line) => {
      const [label, range] = line.split(":");
      const [min, max] = (range ?? "").split("-");
      return { label: (label ?? "").trim(), minCents: min ? Number(min) : null, maxCents: max ? Number(max) : null };
    }).filter((item) => item.label);
    if (!items.length) return;
    void post({ action: "create_price_band_version", category, items });
  };
  const importDownloadedTask = async (row: Record<string, string | number | null>, file: File) => {
    setBusy("execute_download_task"); setError(""); setNotice("");
    try {
      const form = new FormData();
      form.set("taskId", String(row.id));
      form.set("file", file);
      const response = await fetch("/api/market/master/execute", { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "榜单文件校验导入失败");
      setNotice("文件已按任务口径校验并导入");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "榜单文件校验导入失败"); }
    finally { setBusy(""); }
  };
  if (!data) return <section className="panel data-state"><span className="state-spinner" /><strong>正在读取 TOP SKU 主数据中心</strong></section>;
  const enabledModels = aiModels.filter((item) => item.status === "enabled");
  const textModels = enabledModels.filter((item) => item.modelType === "text");
  const visionModels = enabledModels.filter((item) => item.modelType === "vision");
  const priceRecognitionBlocker = !isAdmin
    ? "仅管理员可以创建价格识别任务。"
    : !visionModels.length
      ? "当前没有已启用的视觉模型：请先到 AI 助理配置新增并启用视觉模型；文本模型不能代替主图识别。"
      : !priceCategory
        ? "请选择需要识别价格的类目。"
        : "";
  return <section className="settings-market-master-live">
    {(error || notice) && <div className={`market-feedback ${error ? "error" : "success"}`}>{error || notice}</div>}
    {mode === "database" && <article className="panel market-master-unified-toolbar"><div className="section-header"><div><h2>SKU 数据库与价格审核</h2><p>待确认价格已合并到 TOP SKU/SPU 主数据；同一张列表可筛选、查看候选价并直接编辑完整 SKU 数据。</p></div><div className="market-view-switch"><button className={databaseView === "cards" ? "active" : ""} onClick={() => setDatabaseView("cards")}>大图</button><button className={databaseView === "table" ? "active" : ""} onClick={() => setDatabaseView("table")}>列表</button></div></div><div className="market-master-filter-grid">
      <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、标题或品牌" />
      <select value={category} onChange={(event) => { const next = event.target.value; setCategory(next); setPriceCategory(next); setSubcategoryFilter(""); setPage(1); }}><option value="">全部三级类目</option>{data.categories.map((item) => <option key={item.value} value={item.value}>{item.value}（{count(item.count)}）</option>)}</select>
      <select value={subcategoryFilter} onChange={(event) => { setSubcategoryFilter(event.target.value); setPage(1); }}><option value="">全部细分品类</option>{data.subcategories.map((item) => <option key={item.value} value={item.value}>{item.value}（{count(item.count)}）</option>)}</select>
      <select value={rankingDimension} onChange={(event) => { setRankingDimension(event.target.value); setPage(1); }}><option value="">SKU + SPU</option><option value="SKU">SKU</option><option value="SPU">SPU</option></select>
      <select value={operationMode} onChange={(event) => { setOperationMode(event.target.value); setPage(1); }}><option value="">全部经营模式</option><option value="POP">POP</option><option value="自营">自营</option><option value="未知">未知</option></select>
      <select value={priceStatus} onChange={(event) => { setPriceStatus(event.target.value as typeof priceStatus); setPage(1); }}><option value="">全部价格状态</option><option value="pending">待确认价格</option><option value="confirmed">已确认价格</option><option value="missing">缺少价格</option></select>
      <select value={pendingPriceSource} onChange={(event) => { setPendingPriceSource(event.target.value as typeof pendingPriceSource); setPage(1); }}><option value="">全部候选价来源</option><option value="ai">AI 识别价</option><option value="non_ai">非 AI 识别价</option></select>
      <select value={annotationStatus} onChange={(event) => { setAnnotationStatus(event.target.value as typeof annotationStatus); setPage(1); }}><option value="">全部入库状态</option><option value="pending">待入库</option><option value="committed">已入库</option></select>
      <select aria-label="SKU 数据库每页条数" value={masterPageSize} onChange={(event) => { setMasterPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>每页 20 条</option><option value={30}>每页 30 条</option><option value={50}>每页 50 条</option><option value={100}>每页 100 条</option></select>
    </div><div className="market-price-recognition-inline"><select value={visionModelId} onChange={(event) => setVisionModelId(event.target.value)} disabled={!visionModels.length}><option value="">{visionModels.length ? "选择视觉模型" : "暂无已启用视觉模型"}</option>{visionModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelName}</option>)}</select><button className="secondary-button" disabled={Boolean(priceRecognitionBlocker) || !visionModelId || busy !== ""} onClick={() => void recognizePrices()}>{busy === "recognize_prices" ? "AI 识别中…" : "AI 一键识别待确认价格（最多100条）"}</button>{priceRecognitionBlocker && <span>{priceRecognitionBlocker}</span>}</div></article>}
    {mode === "database" && <><article className="panel settings-master-overview"><div className="section-header"><div><h2>TOP SKU/SPU 主数据中心</h2><p>主数据、待确认价格和图片均来自服务端数据库；主图和标题均可直接打开商品链接。</p></div><div className="market-master-toolbar"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、标题或品牌" /><select value={category} onChange={(event) => { const nextCategory = event.target.value; setCategory(nextCategory); setPriceCategory(nextCategory); setPage(1); setPendingPricePage(1); }}><option value="">全部类目</option>{data.categories.map((item) => <option key={item.value} value={item.value}>{item.value}（{count(item.count)}）</option>)}</select><select aria-label="SKU 数据库每页条数" value={masterPageSize} onChange={(event) => { setMasterPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>每页 20 条</option><option value={30}>每页 30 条</option><option value={50}>每页 50 条</option><option value={100}>每页 100 条</option></select></div></div>
      <div className="settings-master-cards"><div><strong>{count(data.masterData.pagination.total)}</strong><span>主数据</span></div><div><strong>{count(data.pendingPrices.pagination.total)}</strong><span>待确认价格</span></div><div><strong>{count(data.imageCache.cached)} / {count(data.imageCache.total)}</strong><span>图片缓存</span></div><div><strong>{count(data.downloadTasks.length)}</strong><span>下载任务</span></div></div>
    </article>
    <article className="panel"><div className="section-header"><div><h3>待确认价格</h3><p>本表同时包含源表参考价、成交均价和 AI 主图候选价；只有明确标注“AI 主图识别”的记录来自视觉模型，人工确认后才会进入正式价格带。</p></div><div className="market-master-toolbar"><select value={priceCategory} onChange={(event) => { setPriceCategory(event.target.value); setPendingPricePage(1); }}><option value="">选择类目</option>{data.priceRecognition.prompts.map((item) => <option key={item.category} value={item.category}>{item.category}（可识别 {count(Number(item.pending_count))}）</option>)}</select><select aria-label="候选价来源" value={pendingPriceSource} onChange={(event) => { setPendingPriceSource(event.target.value as "" | "ai" | "non_ai"); setPendingPricePage(1); }}><option value="">全部价格来源</option><option value="ai">AI 识别价</option><option value="non_ai">非 AI 识别价</option></select><select aria-label="每页条数" value={pendingPricePageSize} onChange={(event) => { setPendingPricePageSize(Number(event.target.value)); setPendingPricePage(1); }}><option value={20}>每页 20 条</option><option value={50}>每页 50 条</option><option value={100}>每页 100 条</option></select><select value={visionModelId} onChange={(event) => setVisionModelId(event.target.value)} disabled={!visionModels.length}><option value="">{visionModels.length ? "选择视觉模型" : "暂无已启用视觉模型"}</option>{visionModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelName}</option>)}</select><button className="primary-button" disabled={Boolean(priceRecognitionBlocker) || !visionModelId || busy !== ""} onClick={() => void recognizePrices()}>{busy === "recognize_prices" ? "AI 识别中…" : "AI 一键识别价格（最多100条）"}</button></div></div>{priceRecognitionBlocker && <p className="market-price-blocker">{priceRecognitionBlocker}</p>}<div className="data-table-wrap"><table className="data-table market-price-review-table"><thead><tr><th>主图</th><th>SKU / 商品链接</th><th>榜单口径</th><th>月份</th><th>候选价</th><th>来源 / AI 依据</th><th>操作</th></tr></thead><tbody>{data.pendingPrices.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <tr key={`pending-price-${row.id}`}><td>{href && row.displayImageUrl ? <a href={href} target="_blank" rel="noreferrer"><img className="market-review-image" src={String(row.displayImageUrl)} alt={String(row.productName ?? row.skuCode)} loading="lazy" /></a> : row.displayImageUrl ? <img className="market-review-image" src={String(row.displayImageUrl)} alt="" loading="lazy" /> : <span className="annotation-no-image">无图</span>}</td><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></a> : <><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></>}<code>{String(row.imageContentSha256 ?? "").slice(0, 16)}</code></td><td>{String(row.scope || row.operationMode || "-")}</td><td>{String(row.month)}</td><td>{money(Number(row.candidatePriceCents ?? 0) || null)}</td><td><strong>{priceSourceLabel(row.candidatePriceSource)}</strong>{row.candidatePriceSource === "ai_suggestion" && <small>{String(row.aiPriceType || "待判断")} · 置信度 {percent(row.aiConfidenceBps === null ? null : Number(row.aiConfidenceBps))}<br />{String(row.aiReason || "未返回识别依据")}</small>}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => confirmPrice(row)}>修改 / 确认价格</button></td></tr>; })}{!data.pendingPrices.items.length && <tr><td colSpan={7}><div className="table-state">当前筛选范围没有待确认价格。</div></td></tr>}</tbody></table></div><div className="market-pagination"><button disabled={pendingPricePage <= 1} onClick={() => setPendingPricePage((current) => Math.max(1, current - 1))}>上一页</button><label>第 <select aria-label="待确认价格页码" value={pendingPricePage} onChange={(event) => setPendingPricePage(Number(event.target.value))}>{Array.from({ length: data.pendingPrices.pagination.pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> / {data.pendingPrices.pagination.pageCount} 页</label><span>共 {count(data.pendingPrices.pagination.total)} 条</span><button disabled={pendingPricePage >= data.pendingPrices.pagination.pageCount} onClick={() => setPendingPricePage((current) => Math.min(data.pendingPrices.pagination.pageCount, current + 1))}>下一页</button></div></article>
    <article className="panel"><div className="section-header"><div><h3>TOP SKU/SPU 数据库</h3><p>卡片突出主图、标题、价格与标签，也可切换为紧凑表格。</p></div><div className="market-view-switch"><button className={databaseView === "cards" ? "active" : ""} onClick={() => setDatabaseView("cards")}>卡片</button><button className={databaseView === "table" ? "active" : ""} onClick={() => setDatabaseView("table")}>表格</button></div></div>{databaseView === "cards" ? <div className="market-master-product-grid">{data.masterData.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <article key={String(row.id)}><a className="market-master-product-image" href={href || undefined} target={href ? "_blank" : undefined} rel={href ? "noreferrer" : undefined}>{row.displayImageUrl ? <img src={String(row.displayImageUrl)} alt={String(row.productName ?? row.skuCode)} loading="lazy" /> : <span>暂无主图</span>}</a><div className="market-master-product-body">{href ? <a href={href} target="_blank" rel="noreferrer"><h4>{String(row.productName || row.skuCode)}</h4></a> : <h4>{String(row.productName || row.skuCode)}</h4>}<strong className="market-master-price">{money(row.officialMarketPriceCents === null ? Number(row.candidatePriceCents ?? 0) || null : Number(row.officialMarketPriceCents))}</strong><div className="market-master-tags"><span>{String(row.category)}</span><span>{String(row.operationMode)}</span><span>{String(row.rankingDimension)}</span><span>{String(row.brand || "待识别品牌")}</span><span>{String(row.priceBand || "待确认价格")}</span></div><small>#{String(row.rank ?? "-")} · {String(row.skuCode)} · {String(row.scope)}</small><footer><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => modifyProductBrand(row)}>修改品牌</button>{href && <a href={href} target="_blank" rel="noreferrer">商品链接</a>}</footer></div></article>; })}</div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>商品</th><th>维度</th><th>POP/自营</th><th>品牌</th><th>细分类目</th><th>确认价</th><th>价格带</th><th>操作</th></tr></thead><tbody>{data.masterData.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <tr key={String(row.id)}><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></a> : <><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></>}</td><td>{String(row.rankingDimension)}</td><td>{String(row.operationMode)}</td><td>{String(row.brand || "待识别")}</td><td>{String(row.subcategory ?? "")}</td><td>{money(row.officialMarketPriceCents === null ? null : Number(row.officialMarketPriceCents))}</td><td>{String(row.priceBand ?? "")}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => modifyProductBrand(row)}>修改</button></td></tr>; })}</tbody></table></div>}<div className="market-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {page} / {data.masterData.pagination.pageCount} 页</span><button disabled={page >= data.masterData.pagination.pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button></div></article></>}
    {mode === "brand" && <><article className="panel market-ai-capacity"><div className="section-header"><div><h2>运营管理系统 AI 算力</h2><p>这里直接读取“AI 助理配置”中已启用的模型，不再维护独立密钥或重复配置。</p></div><select value={brandModelId} onChange={(event) => setBrandModelId(event.target.value)} disabled={!textModels.length}>{textModels.length ? textModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelName}{item.isDefaultTextModel ? "（默认）" : ""}</option>) : <option value="">暂无已启用文本模型</option>}</select></div><div className="market-ai-model-grid">{enabledModels.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.modelType} · {item.modelName}</span><small>{item.isDefaultTextModel ? "默认文本算力" : "已接入系统算力"}</small></div>)}{!enabledModels.length && <p>尚未配置可用模型，请先到 AI 助理配置中新增并测试模型。</p>}</div></article>
    <article className="panel"><div className="section-header"><div><h3>品牌种子词典</h3><p>从 ERP、库存、店铺商品和已确认市场品牌刷新系统品牌；B店/京东自营仅匹配标题前缀，C店/POP可匹配标题任意位置。</p></div><div className="annotation-actions"><button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void upsertBrandSeed()}>新增品牌种子</button><button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void refreshBrandSeeds()}>{busy === "refresh_brand_seeds" ? "刷新中…" : "刷新系统品牌"}</button><button className="primary-button" disabled={!isAdmin || busy !== "" || !data.brandSeeds.dictionary.counts.enabled} onClick={() => void matchSystemBrandSeeds()}>{busy === "match_brand_seeds" ? "匹配中…" : "按种子匹配未知 SKU"}</button></div></div><div className="settings-master-cards"><div><strong>{count(data.brandSeeds.dictionary.counts.enabled)}</strong><span>启用种子</span></div><div><strong>{count(data.brandSeeds.dictionary.counts.system)}</strong><span>系统品牌</span></div><div><strong>{count(data.brandSeeds.dictionary.counts.manual)}</strong><span>人工补录</span></div><div><strong>{count(data.brandSeeds.unknown.pagination.total)}</strong><span>未知品牌 SKU</span></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>标准品牌</th><th>种子词</th><th>来源</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{data.brandSeeds.dictionary.items.map((row) => <tr key={String(row.id)}><td><strong>{String(row.canonical_brand)}</strong></td><td>{String(row.seed_text)}</td><td>{row.source === "manual" ? "人工补录" : "系统刷新"}<small>{String(row.source_ref || "")}</small></td><td>{row.status === "enabled" ? "启用" : "停用"}</td><td>{String(row.updated_at || "-")}</td></tr>)}{!data.brandSeeds.dictionary.items.length && <tr><td colSpan={5}><div className="table-state">词典为空，请先刷新系统品牌或新增种子。</div></td></tr>}</tbody></table></div></article>
    <article className="panel"><div className="section-header"><div><h3>未知品牌 SKU 清单</h3><p>这里只列出当前仍未匹配的去重 SKU；补录种子时会立即补齐当前 SKU，之后导入也会自动复用。</p></div><strong>{count(data.brandSeeds.unknown.pagination.total)} 个待处理</strong></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>SKU / 商品标题</th><th>店铺</th><th>匹配规则</th><th>类目</th><th>操作</th></tr></thead><tbody>{data.brandSeeds.unknown.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <tr key={`${row.category}-${row.scope}-${row.rankingDimension}-${row.skuCode}`}><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.skuCode)}</strong><small>{String(row.productName)}</small></a> : <><strong>{String(row.skuCode)}</strong><small>{String(row.productName)}</small></>}</td><td>{String(row.storeName || "-")}<small>{String(row.storeType || row.scope || "-")}</small></td><td>{row.matchPolicy === "title_prefix" ? "B店 / 自营：标题前缀" : "C店 / POP：任意位置"}</td><td>{String(row.category)}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => void upsertBrandSeed(row)}>补录品牌种子</button></td></tr>})}{!data.brandSeeds.unknown.items.length && <tr><td colSpan={5}><div className="table-state">当前筛选范围没有未知品牌 SKU。</div></td></tr>}</tbody></table></div><div className="market-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {page} / {data.brandSeeds.unknown.pagination.pageCount} 页</span><button disabled={page >= data.brandSeeds.unknown.pagination.pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button></div></article>
    <article className="panel"><div className="section-header market-brand-batch-header"><div><h3>品牌识别与人工确认</h3><p>“所有页”按当前搜索和类目筛选处理去重商品；任务可暂停、恢复，刷新或关闭页面不会丢失已完成批次。</p></div><div className="market-master-toolbar"><select value={category} disabled={busy === "recognize_brand_all"} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">全部类目</option>{data.categories.map((item) => <option key={item.value} value={item.value}>{item.value}（{count(item.count)}）</option>)}</select><input value={query} disabled={busy === "recognize_brand_all"} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、标题或品牌" />{busy === "recognize_brand_all" ? <button className="secondary-button" disabled={!isAdmin} onClick={() => void pauseBrandRecognition()}>暂停识别</button> : <button className="primary-button" disabled={!isAdmin || !brandModelId || busy !== ""} onClick={() => void recognizeAllBrands()}>{brandJob && ["queued", "running", "paused", "failed"].includes(brandJob.status) ? "继续识别" : "AI 一键识别品牌（所有页）"}</button>}<button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void confirmAllBrandSuggestions()}>{busy === "confirm_brand_all" ? "批量确认中…" : "一键确认全部候选"}</button></div></div>{brandJob && <div className="market-brand-job-progress"><header><div><strong>{brandJob.status === "completed" ? "识别完成" : brandJob.status === "paused" ? "已暂停" : brandJob.status === "failed" ? "可重试" : "识别任务进行中"}</strong><small>任务 {brandJob.id.slice(-8)} · 每批 {brandJob.batchSize} 个</small></div><b>{percent(brandJob.progressBps)}</b></header><span><i style={{ width: `${Math.min(100, brandJob.progressBps / 100)}%` }} /></span><div><label><strong>{count(brandJob.processedCount)}</strong><small>已处理</small></label><label><strong>{count(brandJob.remainingCount)}</strong><small>剩余</small></label><label><strong>{count(brandJob.recognizedCount)}</strong><small>识别出品牌</small></label><label><strong>{brandJobEta(brandJob)}</strong><small>预计剩余</small></label></div>{brandJob.lastError && <p>{brandJob.lastError}</p>}</div>}<div className="data-table-wrap"><table className="data-table market-brand-review-table"><thead><tr><th>主图</th><th>商品标题 / 类目</th><th>当前品牌</th><th>AI / 人工品牌</th><th>操作</th></tr></thead><tbody>{data.masterData.items.map((row) => { const key = brandRowKey(row); const href = marketProductHref(row.productUrl, row.skuCode); const suggested = String(row.suggestedBrand || "") || String(row.brand || ""); return <tr key={`${key}-${row.id}`}><td>{row.displayImageUrl ? <img className="market-review-image" src={String(row.displayImageUrl)} alt="" loading="lazy" /> : <span className="annotation-no-image">无图</span>}</td><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.productName || row.skuCode)}</strong></a> : <strong>{String(row.productName || row.skuCode)}</strong>}<small>{String(row.skuCode)} · 类目：{String(row.category)} · {String(row.scope)}</small></td><td>{String(row.brand || "待识别")}</td><td><input value={brandDrafts[key] ?? suggested} onChange={(event) => setBrandDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder="识别不了可留空" />{row.brandSuggestionStatus === "ai_pending" && <small className="market-ai-suggestion">AI 候选，待确认</small>}</td><td><div className="annotation-actions"><button className="row-action" disabled={!isAdmin || !brandModelId || busy !== ""} onClick={() => void inferBrand(row)}>{busy === `infer_brand:${key}` ? "识别中…" : "重新识别"}</button><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => confirmBrand(row)}>修改 / 确认</button></div></td></tr>; })}</tbody></table></div><div className="market-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {page} / {data.masterData.pagination.pageCount} 页</span><button disabled={page >= data.masterData.pagination.pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button></div></article></>}
    {mode === "mapping" && <article className="panel"><div className="section-header"><div><h3>映射与价格带</h3><p>细分类目、品牌别名、单品品牌确认、POP/自营映射和价格带配置均持久化并审计。</p></div><div className="annotation-actions"><button className="secondary-button" disabled={!isAdmin} onClick={() => createMapping("subcategory")}>新增细分类目映射</button><button className="secondary-button" disabled={!isAdmin} onClick={() => createMapping("brand_alias")}>新增品牌别名</button><button className="secondary-button" disabled={!isAdmin} onClick={() => createMapping("operation_mode")}>新增经营模式规则</button><button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void post({ action: "apply_mappings" })}>重算并应用映射</button><button className="secondary-button" disabled={!isAdmin} onClick={createPriceBandDraft}>新建价格带版本</button></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>类型</th><th>来源</th><th>目标</th><th>状态</th><th>版本</th><th>操作</th></tr></thead><tbody>{data.mappings.items.map((row) => <tr key={String(row.id)}><td>{String(row.kind)}</td><td>{String(row.source_value)}</td><td>{String(row.target_value)}</td><td>{String(row.status)}</td><td>{String(row.version)}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => editMapping(row)}>编辑</button></td></tr>)}</tbody></table></div>
      <div className="market-brand-list">{data.priceBands.items.map((row) => <article key={String(row.id)}><label><strong>{String(row.category)} v{String(row.version)}</strong><span>{String(row.status)}</span></label><small>{String(row.effective_from)} · {String(row.note ?? "")}</small><div className="annotation-actions"><button className="row-action" disabled={!isAdmin || row.status === "published"} onClick={() => void post({ action: "publish_price_band_version", id: row.id })}>发布</button><button className="row-action" disabled={!isAdmin} onClick={() => void post({ action: "rollback_price_band_version", targetVersionId: row.id })}>回滚到此版本</button></div></article>)}</div>
    </article>}
    {mode === "data" && <><article className="panel"><div className="section-header"><div><h3>自动下载与导入工作流</h3><p>计算缺失范围、创建或复用下载任务，登录态未验证时保持 waiting_login。</p></div><div className="annotation-actions"><button className="secondary-button" disabled={!isAdmin} onClick={createDownloadConfig}>新增下载配置</button><button className="primary-button" disabled={!isAdmin || busy !== ""} onClick={() => void post({ action: "plan_downloads" })}>计算缺失任务</button></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>类目/口径/月/维度</th><th>状态</th><th>次数</th><th>文件</th><th>错误</th><th>执行</th></tr></thead><tbody>{data.downloadTasks.map((row) => <tr key={String(row.id)}><td>{String(row.category)} · {String(row.scope)} · {String(row.month)} · {String(row.ranking_dimension)}</td><td>{String(row.status)}</td><td>{String(row.attempt_count)}</td><td>{String(row.source_file_name ?? "")}</td><td>{String(row.error_message ?? "")}</td><td><div className="annotation-actions"><label className="row-action">上传并校验导入<input type="file" accept=".xls,.xlsx,.csv" hidden disabled={!isAdmin || busy !== "" || row.status === "imported" || row.status === "published"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDownloadedTask(row, file); event.currentTarget.value = ""; }} /></label><button className="row-action" disabled={!isAdmin || busy !== "" || row.status === "imported" || row.status === "published"} onClick={() => void post({ action: "record_download_attempt", taskId: row.id, status: "waiting_login", errorCode: "waiting_login", errorMessage: "等待京东登录验证" })}>等待登录</button></div></td></tr>)}</tbody></table></div>
    </article>
    <article className="panel"><div className="section-header"><div><h3>数据覆盖、图片缓存与审计</h3><p>覆盖检查和完整审计记录来自市场主数据审计表。</p></div></div><div className="settings-master-cards">{data.coverage.slice(0, 8).map((row) => <div key={`${row.category}-${row.scope}-${row.ranking_dimension}`}><strong>{String(row.month_min ?? "-")}~{String(row.month_max ?? "-")}</strong><span>{String(row.category)} · {String(row.scope)} · {String(row.ranking_dimension)} · SKU {String(row.sku_count)}</span></div>)}</div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>人员</th><th>动作</th><th>对象</th></tr></thead><tbody>{data.audits.map((row) => <tr key={String(row.id)}><td>{String(row.created_at)}</td><td>{String(row.actor_email)}</td><td>{String(row.action)}</td><td>{String(row.entity_type)} · {String(row.entity_id)}</td></tr>)}</tbody></table></div></article>
    </>}
    {mode === "subcategory" && <article className="panel market-subcategory-settings"><div className="section-header"><div><h2>细分品类设置</h2><p>按三级类目维护统一细分品类。保存后会同步刷新榜单、SKU 入库标注和待复核候选，并发布映射供后续导入复用。</p></div><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">请选择三级类目</option>{data.subcategorySettings.categories.map((item) => <option key={item.value} value={item.value}>{item.value}（{count(item.count)}）</option>)}</select></div>{category ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>当前细分品类</th><th>关联 SKU</th><th>已入库标注</th><th>修改为</th></tr></thead><tbody>{data.subcategorySettings.items.map((item) => <tr key={item.subcategory}><td><strong>{item.subcategory}</strong></td><td>{count(Number(item.sku_count))}</td><td>{count(Number(item.annotation_count))}</td><td><input value={subcategoryDrafts[item.subcategory] ?? item.subcategory} onChange={(event) => setSubcategoryDrafts((current) => ({ ...current, [item.subcategory]: event.target.value }))} /></td></tr>)}{!data.subcategorySettings.items.length && <tr><td colSpan={4}><div className="table-state">该三级类目尚无细分品类，可直接新增。</div></td></tr>}</tbody></table></div><label className="market-subcategory-add"><span>新增细分品类（每行一个）</span><textarea value={newSubcategory} onChange={(event) => setNewSubcategory(event.target.value)} placeholder="例如：台式净饮机&#10;商用直饮机" /></label><div className="annotation-actions"><button className="primary-button" disabled={!isAdmin || busy !== ""} onClick={() => void saveSubcategories()}>{busy === "save_subcategory_settings" ? "刷新关联数据中…" : "保存并刷新全部关联数据"}</button></div></> : <div className="table-state">请先选择三级类目。</div>}</article>}
    {editingSku && <div className="market-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingSku(null); }}><section className="panel market-sku-editor" role="dialog" aria-modal="true" aria-label="编辑 SKU 全部数据"><div className="section-header"><div><h2>编辑 SKU 全部数据</h2><p>{String(editingSku.skuCode)} · {String(editingSku.scope)} · {String(editingSku.month)}</p></div><button className="row-action" onClick={() => setEditingSku(null)}>关闭</button></div><div className="market-sku-editor-grid"><label><span>三级类目</span><input value={skuDraft.category} onChange={(event) => setSkuDraft((current) => ({ ...current, category: event.target.value }))} /></label><label><span>细分品类</span><input value={skuDraft.subcategory} onChange={(event) => setSkuDraft((current) => ({ ...current, subcategory: event.target.value }))} /></label><label className="wide"><span>商品标题</span><input value={skuDraft.productName} onChange={(event) => setSkuDraft((current) => ({ ...current, productName: event.target.value }))} /></label><label><span>品牌</span><input value={skuDraft.brand} onChange={(event) => setSkuDraft((current) => ({ ...current, brand: event.target.value }))} /></label><label><span>经营模式</span><select value={skuDraft.operationMode} onChange={(event) => setSkuDraft((current) => ({ ...current, operationMode: event.target.value }))}><option value="POP">POP</option><option value="自营">自营</option><option value="未知">未知</option></select></label><label><span>市场定位价（元）</span><input type="number" min={0} step="0.01" value={skuDraft.priceYuan} onChange={(event) => setSkuDraft((current) => ({ ...current, priceYuan: event.target.value }))} /></label><label><span>价格类型</span><select value={skuDraft.priceType} onChange={(event) => setSkuDraft((current) => ({ ...current, priceType: event.target.value }))}>{["标准售价", "到手价", "券后价", "起售价", "价格区间", "最低规格价格"].map((item) => <option key={item}>{item}</option>)}</select></label></div><footer><span>类目、品牌、经营模式和细分品类会同步更新该 SKU 的关联历史；价格仅更新当前月份。</span><button className="primary-button" disabled={busy !== ""} onClick={() => void saveSku()}>{busy === "update_sku_master" ? "保存中…" : "保存全部数据"}</button></footer></section></div>}
  </section>;
}

function MarketSettingsWorkspace({ currentUser, data, onImported }: { currentUser: CurrentUser; data: MarketOverview; onImported: () => void }) {
  const [tab, setTab] = useState<MarketSettingsTab>("database");
  const [databaseArea, setDatabaseArea] = useState<"master" | "annotation">("master");
  const tabs: Array<{ key: MarketSettingsTab; label: string; note: string }> = [
    { key: "database", label: "SKU 数据库", note: "主数据、价格与 AI 入库" },
    { key: "subcategory", label: "细分品类设置", note: "按三级类目统一维护" },
    { key: "brand", label: "品牌确认", note: "标题识别与人工修订" },
    { key: "mapping", label: "映射配置", note: "别名、品类与价格带" },
    { key: "data", label: "数据配置", note: "导入、下载与审计" },
  ];
  return <section className="market-settings-workspace">
    <article className="panel market-settings-intro"><div><span className="eyebrow">MARKET OPERATIONS & AI</span><h2>系统和 AI 设置</h2><p>参考现有市场系统的分栏结构，统一维护 SKU/SPU 主数据、品牌确认、价格、映射、导入与 AI 标注；模型算力直接继承运营管理系统的 AI 助理配置。</p></div><div><span><strong>{count(data.summary.activeSkuCount)}</strong>有效 SKU</span><span><strong>{count(data.summary.pendingAiCount)}</strong>待确认 AI 数据</span><span><strong>{count(data.imageCache.pending)}</strong>待缓存图片</span></div></article>
    <nav className="panel market-settings-tabs" aria-label="市场系统和 AI 设置子板块">{tabs.map((item) => <button type="button" key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><strong>{item.label}</strong><small>{item.note}</small></button>)}</nav>
    {tab === "database" && <nav className="panel market-database-areas"><button className={databaseArea === "master" ? "active" : ""} onClick={() => setDatabaseArea("master")}><strong>主数据与价格</strong><small>统一筛选、查看和编辑 SKU/SPU</small></button><button className={databaseArea === "annotation" ? "active" : ""} onClick={() => setDatabaseArea("annotation")}><strong>AI 标注与批量入库</strong><small>筛选候选、列表/大图复核并入库</small></button></nav>}
    {tab === "database" ? (databaseArea === "annotation" ? <MarketAnnotationView currentUser={currentUser} embedded /> : <MarketMasterAdminPanel currentUser={currentUser} mode="database" />) : <MarketMasterAdminPanel currentUser={currentUser} mode={tab} />}
    {tab === "data" && <><MarketDataImportPanel currentUser={currentUser} data={data} onImported={onImported} /><MarketWorkflowPanel data={data} /></>}
  </section>;
}

export default function MarketView({ customStartDate, customEndDate, currentUser }: { customStartDate: string; customEndDate: string; currentUser: CurrentUser }) {
  const [data, setData] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<string[]>(["SKU"]);
  const [operationModes, setOperationModes] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const [priceBands, setPriceBands] = useState<string[]>([]);
  const [marketStartDate, setMarketStartDate] = useState(customStartDate);
  const [marketEndDate, setMarketEndDate] = useState(customEndDate);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [trendItem, setTrendItem] = useState<MarketItem | null>(null);
  const [activeSection, setActiveSection] = useState<MarketSectionKey>("ranking");
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      categories.forEach((value) => params.append("category", value));
      dimensions.forEach((value) => params.append("dimension", value));
      operationModes.forEach((value) => params.append("operationMode", value));
      brands.forEach((value) => params.append("brand", value));
      subcategories.forEach((value) => params.append("subcategory", value));
      priceBands.forEach((value) => params.append("priceBand", value));
      if (marketStartDate) params.set("startDate", marketStartDate);
      if (marketEndDate) params.set("endDate", marketEndDate);
      const response = await fetch(`/api/market/overview?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as MarketOverview | null;
      if (!response.ok) throw new Error(payload?.error || "市场分析数据读取失败");
      if (!payload) throw new Error("市场分析返回为空");
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "市场分析数据读取失败"); }
    finally { setLoading(false); }
  }, [query, categories, dimensions, operationModes, brands, subcategories, priceBands, marketStartDate, marketEndDate]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load, reloadKey]);
  const toggleCompare = (sku: string) => setCompareIds((current) => current.includes(sku) ? current.filter((item) => item !== sku) : current.length >= 5 ? current : [...current, sku]);
  const operationOptions = useMemo(() => [{ value: "POP", count: 0 }, { value: "自营", count: 0 }, { value: "未知", count: 0 }, ...(data?.filters.operationModes ?? [])].filter((item, index, array) => array.findIndex((next) => next.value === item.value) === index), [data]);
  if (loading && !data) return <section className="panel data-state"><span className="state-spinner" /><strong>正在连接市场分析数据</strong><p>正在读取榜单、价格快照、图片缓存和 AI 标注结果…</p></section>;
  if (error && !data) return <section className="panel data-state"><span className="state-symbol">!</span><strong>市场分析暂时不可用</strong><p>{error}</p><button className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>重新加载</button></section>;
  if (!data) return null;
  const sectionCopy: Record<Exclude<MarketSectionKey, "settings">, { eyebrow: string; title: string; note: string }> = {
    ranking: { eyebrow: "PRODUCT RANKING", title: "商品榜单工作台", note: "查看 TOP 商品表现、成交均价、主图价格、排名变化和单品趋势。" },
    overview: { eyebrow: "MARKET OVERVIEW", title: "市场概括", note: "按当前 TOP 榜单覆盖口径汇总规模、价格带、品牌竞争和细分类目。" },
    compare: { eyebrow: "COMPETITOR BENCHMARK", title: "竞品对比", note: "使用统一筛选口径挑选 2–5 个 SKU，进行核心指标和月度趋势对照。" },
  };
  const activeCopy = activeSection === "settings" ? null : sectionCopy[activeSection];
  return <div className="market-module">
    <MarketSectionNav active={activeSection} compareCount={compareIds.length} onChange={setActiveSection} />
    {activeCopy && <section className="panel market-filter-bar market-filter-bar-v2">
      <div><span className="eyebrow">{activeCopy.eyebrow}</span><h2>{activeCopy.title}</h2><p>{activeCopy.note}</p></div>
      <div className="market-filter-controls market-filter-controls-v2">
        {activeSection === "overview" && <div className="market-overview-period"><label><span>开始日期</span><input type="date" value={marketStartDate} max={marketEndDate || undefined} onChange={(event) => setMarketStartDate(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={marketEndDate} min={marketStartDate || undefined} onChange={(event) => setMarketEndDate(event.target.value)} /></label><button type="button" className="row-action" onClick={() => { setMarketStartDate(""); setMarketEndDate(""); }}>全部时间</button></div>}
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品标题或 SKU" aria-label="搜索商品标题或 SKU" />
        <SearchMultiFilter label="类目" values={categories} options={data.filters.categories} onChange={setCategories} />
        <SearchMultiFilter label="榜单维度" values={dimensions} options={data.filters.rankingDimensions.length ? data.filters.rankingDimensions : [{ value: "SKU", count: 0 }, { value: "SPU", count: 0 }]} onChange={setDimensions} />
        <SearchMultiFilter label="经营模式" values={operationModes} options={operationOptions} onChange={setOperationModes} />
        <SearchMultiFilter label="品牌" values={brands} options={data.filters.brands} onChange={setBrands} />
        <SearchMultiFilter label="细分类目" values={subcategories} options={data.filters.subcategories} onChange={setSubcategories} />
        <SearchMultiFilter label="价格带" values={priceBands} options={data.filters.priceBands} onChange={setPriceBands} />
      </div>
      <footer><span className="status status-success">当前 TOP 榜单覆盖口径</span><strong>截止 {data.dataRange.endDate ?? "暂无日期"} · 覆盖 {monthText(data.dataRange.startDate, data.dataRange.endDate)}</strong><small>有效 SKU {count(data.summary.activeSkuCount)} · 待确认 AI 数据 {count(data.summary.pendingAiCount)} · 图片缓存 {count(data.imageCache.cached)}/{count(data.imageCache.total)}{data.imageCache.pending ? ` · 待处理 ${count(data.imageCache.pending)}` : ""}</small></footer>
    </section>}
    {error && <div className="market-feedback error">{error}</div>}
    {activeSection === "ranking" && <RankingTable items={data.items} compareIds={compareIds} onToggleCompare={toggleCompare} onTrend={setTrendItem} onOpenCompare={() => setActiveSection("compare")} />}
    {activeSection === "overview" && <>
      <MarketKpis data={data} />
      <TrendSection data={data} />
      <PriceBandSection data={data} />
      <BrandSection data={data} />
      <SubcategorySection data={data} />
    </>}
    {activeSection === "compare" && <CompareWorkspace items={data.items} compareIds={compareIds} onClear={() => setCompareIds([])} onToggleCompare={toggleCompare} onGoRanking={() => setActiveSection("ranking")} categories={categories} rankingDimensions={dimensions} operationModes={operationModes} brands={brands} subcategories={subcategories} priceBands={priceBands} startDate={marketStartDate} endDate={marketEndDate} />}
    {activeSection === "settings" && <MarketSettingsWorkspace currentUser={currentUser} data={data} onImported={() => setReloadKey((key) => key + 1)} />}
    {trendItem && <TrendDrawer item={trendItem} onClose={() => setTrendItem(null)} />}
  </div>;
}
