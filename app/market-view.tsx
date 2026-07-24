"use client";
/* eslint-disable @next/next/no-img-element -- Market ranking thumbnails are imported business assets. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CurrentUser = { email: string; role: "viewer" | "analyst" | "operator" | "admin" } | null;
type FilterOption = { value: string; count: number };
type MarketItem = {
  id: number; periodStart: string; periodEnd: string; category: string; scope: string; rankingDimension: "SKU" | "SPU";
  operationMode: "POP" | "自营" | "未知"; subcategory: string; rank: number | null; previousRank: number | null; rankChange: number | null;
  skuCode: string; productName: string; brand: string; priceCents: number | null; marketPriceCents: number | null; marketPriceSource: string;
  averageTransactionPriceCents: number | null; discountBps: number | null; discountReference: boolean;
  gmvCents: number; quantity: number; pageViews: number; visitors: number; conversionBps: number | null;
  cartCustomers: number; searchClicks: number; imageUrl: string; productUrl: string; sourceImageUrl: string; imageCacheStatus: string;
  isOwn: boolean; ownSalesCents: number;
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
  priceBandSummary: Array<{ priceBand: string; gmvCents: number; quantity: number; skuCount: number; popGmvCents: number; selfGmvCents: number; selfOperatedShareBps: number | null; mainBrands: string[] }>;
  brandAnalysis: { items: Array<{ brand: string; gmvCents: number; quantity: number; skuCount: number; bestRank: number | null; gmvShareBps: number; priceBands: string[]; subcategories: string[] }>; cr3Bps: number; cr5Bps: number; concentration: string };
  subcategorySummary: Array<{ subcategory: string; skuCount: number; gmvCents: number; gmvShareBps: number; quantity: number; averageTransactionPriceCents: number | null; selfOperatedShareBps: number | null; pendingSkuCount: number; mainBrands: string[]; mainPriceBands: string[] }>;
  filters: { categories: FilterOption[]; scopes: FilterOption[]; brands: FilterOption[]; rankingDimensions: FilterOption[]; operationModes: FilterOption[]; subcategories: FilterOption[]; priceBands: FilterOption[] };
  dataRange: { startDate: string | null; endDate: string | null };
  batches: Array<{ id: string; fileName: string; sourceType: string; rowCount: number; insertedCount: number; updatedCount: number; warningCount: number; completedAt: string | null }>;
  imageCache: { total: number; cached: number; failed: number; pending: number };
  error?: string;
};
type TrendPayload = { items: Array<Record<string, string | number | null>>; error?: string };

const money = (cents?: number | null) => cents === null || cents === undefined
  ? "-"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(cents / 100);
const count = (value = 0) => new Intl.NumberFormat("zh-CN").format(value);
const percent = (bps?: number | null) => bps === null || bps === undefined ? "-" : `${(bps / 100).toFixed(2)}%`;
const monthText = (start: string | null, end: string | null) => start && end ? `${start.slice(0, 7)} 至 ${end.slice(0, 7)}` : "暂无月份";

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
      <small>成交 {count(item.quantity)} · SKU {count(item.skuCount)} · 自营 {percent(item.selfOperatedShareBps)}</small>
      <em>{item.mainBrands.slice(0, 3).join(" / ") || "暂无主要品牌"}</em>
    </article>)}</div>
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

function RankingTable({ items, compareIds, onToggleCompare, onTrend }: { items: MarketItem[]; compareIds: string[]; onToggleCompare: (sku: string) => void; onTrend: (item: MarketItem) => void }) {
  return <section className="panel market-table-panel">
    <div className="section-header"><div><h2>商品榜单</h2><p>标题下方固定展示周期、SKU ID、POP/自营、品牌、细分类目和确认状态。</p></div><span className="soft-tag">显示 {count(items.length)} 条</span></div>
    <div className="data-table-wrap"><table className="data-table market-ranking-table market-ranking-table-v2"><thead><tr>
      <th>对比</th><th>排名</th><th>商品主图和标题</th><th>销售额</th><th>成交件数</th><th>市场定位价（主图）</th><th>成交均价</th><th>访客</th><th>转化率</th><th>排名变化</th><th>趋势操作</th>
    </tr></thead><tbody>{items.map((item) => <tr key={item.id}>
      <td><button type="button" className={`market-compare-check ${compareIds.includes(item.skuCode) ? "active" : ""}`} onClick={() => onToggleCompare(item.skuCode)} aria-label={`选择对比 ${item.productName || item.skuCode}`}>{compareIds.includes(item.skuCode) ? "✓" : "+"}</button></td>
      <td><strong>{item.rank ? `#${item.rank}` : "-"}</strong><small>{item.rankingDimension}</small></td>
      <td><div className="market-product-cell">{item.imageUrl ? <a href={item.productUrl || item.sourceImageUrl} target="_blank" rel="noreferrer"><img src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></a> : <span>图</span>}<div><strong>{item.productName || "未命名商品"}</strong><small>{item.periodStart} 至 {item.periodEnd} · SKU {item.skuCode}</small><small>{item.operationMode} · {item.brand || "未识别品牌"} · {item.subcategory || "未分类"} · {item.marketPriceSource}</small></div></div></td>
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

function CompareFloating({ items, compareIds, onClear }: { items: MarketItem[]; compareIds: string[]; onClear: () => void }) {
  const selected = compareIds.map((sku) => items.find((item) => item.skuCode === sku)).filter(Boolean) as MarketItem[];
  if (selected.length < 2) return null;
  return <div className="market-compare-floating"><strong>已选择 {selected.length} 个 SKU</strong><div>{selected.map((item) => <span key={item.skuCode}>{item.productName || item.skuCode}</span>)}</div><button type="button" onClick={onClear}>清空</button></div>;
}

export function MarketDataImportPanel({ currentUser, data, onImported }: { currentUser: CurrentUser; data: MarketOverview | null; onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState("market_ranking");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("全部SKU");
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
      form.set("scope", scope); form.set("periodStart", periodStart); form.set("periodEnd", periodEnd);
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
  return <section className="panel market-import-card"><div className="section-header"><div><h2>市场数据导入</h2><p>位于系统设置 → 主数据与映射；导入会保留原榜单、图片缓存和已确认价格。</p></div></div>
    {!currentUser || currentUser.role !== "admin" ? <div className="market-import-permission">仅管理员可导入市场数据。</div> : <>
      {(feedback || error) && <div className={`market-feedback ${error ? "error" : "success"}`}>{error || feedback}</div>}
      <div className="market-import-form">
        <label><span>数据类型</span><div className="market-segmented"><button type="button" className={sourceType === "market_ranking" ? "active" : ""} onClick={() => setSourceType("market_ranking")}>商品榜单</button><button type="button" className={sourceType === "sku_catalog" ? "active" : ""} onClick={() => setSourceType("sku_catalog")}>SKU 资料</button></div></label>
        <label><span>默认类目</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="文件无类目列时使用" /></label>
        <label><span>默认口径</span><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="全部SKU / POP SKU / 自营 SPU" /></label>
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

export default function MarketView({ customStartDate, customEndDate }: { customStartDate: string; customEndDate: string; currentUser: CurrentUser }) {
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
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [trendItem, setTrendItem] = useState<MarketItem | null>(null);
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
      if (customStartDate) params.set("startDate", customStartDate);
      if (customEndDate) params.set("endDate", customEndDate);
      const response = await fetch(`/api/market/overview?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as MarketOverview | null;
      if (!response.ok) throw new Error(payload?.error || "市场分析数据读取失败");
      if (!payload) throw new Error("市场分析返回为空");
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "市场分析数据读取失败"); }
    finally { setLoading(false); }
  }, [query, categories, dimensions, operationModes, brands, subcategories, priceBands, customStartDate, customEndDate]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load, reloadKey]);
  const toggleCompare = (sku: string) => setCompareIds((current) => current.includes(sku) ? current.filter((item) => item !== sku) : current.length >= 5 ? current : [...current, sku]);
  const operationOptions = useMemo(() => [{ value: "POP", count: 0 }, { value: "自营", count: 0 }, { value: "未知", count: 0 }, ...(data?.filters.operationModes ?? [])].filter((item, index, array) => array.findIndex((next) => next.value === item.value) === index), [data]);
  if (loading && !data) return <section className="panel data-state"><span className="state-spinner" /><strong>正在连接市场分析数据</strong><p>正在读取榜单、价格快照、图片缓存和 AI 标注结果…</p></section>;
  if (error && !data) return <section className="panel data-state"><span className="state-symbol">!</span><strong>市场分析暂时不可用</strong><p>{error}</p><button className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>重新加载</button></section>;
  if (!data) return null;
  return <div className="market-module">
    <section className="panel market-filter-bar market-filter-bar-v2">
      <div><span className="eyebrow">MARKET INTELLIGENCE 2.0</span><h2>市场分析看板</h2><p>所有指标均为当前 TOP 榜单覆盖口径，不能描述为完整行业市场。</p></div>
      <div className="market-filter-controls market-filter-controls-v2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品标题或 SKU" aria-label="搜索商品标题或 SKU" />
        <SearchMultiFilter label="类目" values={categories} options={data.filters.categories} onChange={setCategories} />
        <SearchMultiFilter label="榜单维度" values={dimensions} options={data.filters.rankingDimensions.length ? data.filters.rankingDimensions : [{ value: "SKU", count: 0 }, { value: "SPU", count: 0 }]} onChange={setDimensions} />
        <SearchMultiFilter label="经营模式" values={operationModes} options={operationOptions} onChange={setOperationModes} />
        <SearchMultiFilter label="品牌" values={brands} options={data.filters.brands} onChange={setBrands} />
        <SearchMultiFilter label="细分类目" values={subcategories} options={data.filters.subcategories} onChange={setSubcategories} />
        <SearchMultiFilter label="价格带" values={priceBands} options={data.filters.priceBands} onChange={setPriceBands} />
      </div>
      <footer><span className="status status-success">当前 TOP 榜单覆盖口径</span><strong>截止 {data.dataRange.endDate ?? "暂无日期"} · 覆盖 {monthText(data.dataRange.startDate, data.dataRange.endDate)}</strong><small>有效 SKU {count(data.summary.activeSkuCount)} · 待确认 AI 数据 {count(data.summary.pendingAiCount)} · 图片缓存 {count(data.imageCache.cached)}/{count(data.imageCache.total)}{data.imageCache.pending ? ` · 待处理 ${count(data.imageCache.pending)}` : ""}</small></footer>
    </section>
    {error && <div className="market-feedback error">{error}</div>}
    <MarketKpis data={data} />
    <TrendSection data={data} />
    <PriceBandSection data={data} />
    <BrandSection data={data} />
    <SubcategorySection data={data} />
    <RankingTable items={data.items} compareIds={compareIds} onToggleCompare={toggleCompare} onTrend={setTrendItem} />
    <CompareFloating items={data.items} compareIds={compareIds} onClear={() => setCompareIds([])} />
    {trendItem && <TrendDrawer item={trendItem} onClose={() => setTrendItem(null)} />}
  </div>;
}
