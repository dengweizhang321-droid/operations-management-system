"use client";
/* eslint-disable @next/next/no-img-element -- Imported competitor images use external, user-provided URLs. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarketAnnotationView from "@/app/market-annotation-view";

type CurrentUser = { email: string; role: "viewer" | "analyst" | "operator" | "admin" } | null;
type FilterOption = { value: string; count: number };
type MarketItem = {
  id: number; periodStart: string; periodEnd: string; category: string; scope: string; rank: number | null;
  skuCode: string; productName: string; brand: string; priceCents: number | null; gmvCents: number;
  quantity: number; pageViews: number; visitors: number; conversionBps: number | null;
  cartCustomers: number; searchClicks: number; imageUrl: string; productUrl: string;
  sourceImageUrl: string; imageCacheStatus: string;
  isOwn: boolean; ownSalesCents: number;
};
type MarketOverview = {
  summary: { productCount: number; categoryCount: number; brandCount: number; gmvCents: number; quantity: number; pageViews: number; visitors: number; ownProductCount: number };
  items: MarketItem[];
  trend: Array<{ period: string; gmv_cents: number; quantity: number; visitors: number; product_count: number }>;
  filters: { categories: FilterOption[]; scopes: FilterOption[]; brands: FilterOption[] };
  dataRange: { startDate: string | null; endDate: string | null };
  batches: Array<{ id: string; fileName: string; sourceType: string; rowCount: number; insertedCount: number; updatedCount: number; warningCount: number; completedAt: string | null }>;
  imageCache: { total: number; cached: number; failed: number; pending: number };
  error?: string;
};

type TabKey = "ranking" | "overview" | "compare" | "import" | "ai" | "annotation";

const money = (cents?: number | null) => cents === null || cents === undefined
  ? "—"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(cents / 100);
const count = (value = 0) => new Intl.NumberFormat("zh-CN").format(value);
const percent = (bps?: number | null) => bps === null || bps === undefined ? "—" : `${(bps / 100).toFixed(2)}%`;

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
      <span>{label}</span><strong>{values.length ? `已选 ${values.length} 项` : `全部${label}`}</strong><em>⌄</em>
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

function MarketKpis({ data }: { data: MarketOverview }) {
  const cards = [
    ["市场商品数", count(data.summary.productCount), `${count(data.summary.ownProductCount)} 个已关联自有商品`, "blue"],
    ["市场成交金额", money(data.summary.gmvCents), `覆盖 ${count(data.summary.categoryCount)} 个类目`, "green"],
    ["市场成交件数", `${count(data.summary.quantity)} 件`, `${count(data.summary.brandCount)} 个品牌`, "purple"],
    ["商品访客数", count(data.summary.visitors), `浏览量 ${count(data.summary.pageViews)}`, "orange"],
  ];
  return <section className="market-kpi-grid">{cards.map(([label, value, note, tone]) => <article className="panel" key={label}>
    <span className={`market-kpi-dot ${tone}`} /><small>{label}</small><strong>{value}</strong><p>{note}</p>
  </article>)}</section>;
}

function RankingTable({ items, compareIds, onToggleCompare }: { items: MarketItem[]; compareIds: string[]; onToggleCompare: (sku: string) => void }) {
  return <section className="panel market-table-panel">
    <div className="section-header"><div><h2>商品榜单</h2><p>指标来自导入文件；“自有”由京东 SKU/SPU 与销售明细自动匹配。</p></div><span className="soft-tag">显示 {count(items.length)} 条</span></div>
    <div className="data-table-wrap"><table className="data-table market-ranking-table"><thead><tr>
      <th>对比</th><th>排名 / 商品</th><th>品牌 / 类目</th><th>市场成交额</th><th>成交件数</th><th>访客数</th><th>转化率</th><th>自有数据关联</th>
    </tr></thead><tbody>{items.map((item) => <tr key={item.id}>
      <td><button type="button" className={`market-compare-check ${compareIds.includes(item.skuCode) ? "active" : ""}`} onClick={() => onToggleCompare(item.skuCode)} aria-label={`选择对比 ${item.productName || item.skuCode}`}>{compareIds.includes(item.skuCode) ? "✓" : "+"}</button></td>
      <td><div className="market-product-cell">{item.imageUrl ? <a href={item.productUrl || item.sourceImageUrl} target="_blank" rel="noreferrer"><img src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></a> : <span>品</span>}<div><strong>{item.rank ? `#${item.rank} ` : ""}{item.productName || "未命名商品"}</strong><small><b className={item.imageCacheStatus === "ready" ? "market-image-cache-ready" : "market-image-cache-pending"}>{item.imageCacheStatus === "ready" ? "图片已缓存" : item.imageUrl ? "图片待缓存" : "无商品图"}</b> · SKU：{item.skuCode} · {item.periodStart} 至 {item.periodEnd}</small></div></div></td>
      <td><strong>{item.brand || "未识别品牌"}</strong><small>{item.category || "未分类"} · {item.scope}</small></td>
      <td><strong>{money(item.gmvCents)}</strong><small>{item.priceCents ? `参考价 ${money(item.priceCents)}` : "未提供价格"}</small></td>
      <td>{count(item.quantity)}</td><td>{count(item.visitors)}</td><td>{percent(item.conversionBps)}</td>
      <td>{item.isOwn ? <span className="status status-success">已关联</span> : <span className="status status-warning">竞品</span>}<small>{item.isOwn ? `系统销售 ${money(item.ownSalesCents)}` : "未匹配自有 SKU/SPU"}</small></td>
    </tr>)}{items.length === 0 && <tr><td colSpan={8}><div className="table-state">当前筛选范围没有商品数据。</div></td></tr>}</tbody></table></div>
  </section>;
}

function IndustryOverview({ data }: { data: MarketOverview }) {
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of data.items) totals.set(item.category || "未分类", (totals.get(item.category || "未分类") ?? 0) + item.gmvCents);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [data.items]);
  const maxCategory = Math.max(1, ...categoryTotals.map((item) => item[1]));
  const maxTrend = Math.max(1, ...data.trend.map((item) => Number(item.gmv_cents)));
  return <section className="market-overview-grid">
    <article className="panel"><div className="section-header"><div><h2>市场趋势</h2><p>按导入周期汇总成交金额</p></div></div><div className="market-trend-chart">{data.trend.map((item) => <div key={item.period}><span style={{ height: `${Math.max(5, Number(item.gmv_cents) / maxTrend * 100)}%` }} /><strong>{money(Number(item.gmv_cents))}</strong><small>{item.period}</small></div>)}{!data.trend.length && <p>暂无趋势数据</p>}</div></article>
    <article className="panel"><div className="section-header"><div><h2>类目规模</h2><p>当前筛选商品成交额分布</p></div></div><div className="market-category-bars">{categoryTotals.map(([name, value]) => <div key={name}><label><span>{name}</span><strong>{money(value)}</strong></label><i><b style={{ width: `${value / maxCategory * 100}%` }} /></i></div>)}{!categoryTotals.length && <p>暂无类目数据</p>}</div></article>
  </section>;
}

function ComparePanel({ items, compareIds, onRemove }: { items: MarketItem[]; compareIds: string[]; onRemove: (sku: string) => void }) {
  const selected = compareIds.map((sku) => items.find((item) => item.skuCode === sku)).filter(Boolean) as MarketItem[];
  if (!selected.length) return <section className="panel data-state"><span className="state-symbol">比</span><strong>请选择需要对比的商品</strong><p>在“商品榜单”勾选 2–5 个 SKU，即可比较市场规模、流量与转化。</p></section>;
  const metrics = [
    ["市场成交额", (item: MarketItem) => money(item.gmvCents)],
    ["成交件数", (item: MarketItem) => count(item.quantity)],
    ["访客数", (item: MarketItem) => count(item.visitors)],
    ["浏览量", (item: MarketItem) => count(item.pageViews)],
    ["成交转化率", (item: MarketItem) => percent(item.conversionBps)],
    ["搜索点击", (item: MarketItem) => count(item.searchClicks)],
    ["自有销售额", (item: MarketItem) => item.isOwn ? money(item.ownSalesCents) : "竞品"],
  ] as const;
  return <section className="panel market-compare-panel"><div className="section-header"><div><h2>竞品对比</h2><p>同一页面最多对比 5 个 SKU。</p></div></div><div className="market-compare-grid"><div className="metric-labels"><strong>指标</strong>{metrics.map(([label]) => <span key={label}>{label}</span>)}</div>{selected.map((item) => <article key={item.skuCode}><button type="button" onClick={() => onRemove(item.skuCode)} aria-label={`移除 ${item.skuCode}`}>×</button><strong>{item.productName || item.skuCode}</strong><small>{item.brand || "未识别品牌"} · {item.skuCode}</small>{metrics.map(([label, render]) => <span key={label}>{render(item)}</span>)}</article>)}</div></section>;
}

function ImportPanel({ currentUser, data, onImported }: { currentUser: CurrentUser; data: MarketOverview; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState("market_ranking");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("全部");
  const [periodStart, setPeriodStart] = useState(data.dataRange.startDate ?? new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(data.dataRange.endDate ?? new Date().toISOString().slice(0, 10));
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
      setFile(null); onImported();
      if (payload?.batch?.id && (payload.imageCache?.pending ?? 0) > 0) {
        let pending = payload.imageCache?.pending ?? 0;
        let cached = payload.imageCache?.cached ?? 0;
        let failed = payload.imageCache?.failed ?? 0;
        for (let round = 0; round < 50 && pending > 0; round += 1) {
          setFeedback(`数据已导入，正在自动缓存商品图：已缓存 ${cached}，待处理 ${pending}…`);
          const cacheResponse = await fetch("/api/market/images/cache", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: payload.batch.id, limit: 24 }) });
          const cachePayload = await cacheResponse.json().catch(() => null) as { error?: string; result?: { processed: number; pending: number; cached: number; failed: number } } | null;
          if (!cacheResponse.ok || !cachePayload?.result) throw new Error(`市场数据已导入，但图片缓存中断：${cachePayload?.error || "缓存接口无响应"}`);
          ({ pending, cached, failed } = cachePayload.result);
          if (cachePayload.result.processed === 0) break;
        }
        setFeedback(`市场数据与商品图处理完成：已缓存 ${cached} 张，待处理 ${pending} 张，失败 ${failed} 张`);
        onImported();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); }
    finally { setBusy(false); }
  };
  return <div className="market-import-grid"><section className="panel market-import-card"><div className="section-header"><div><h2>导入市场数据</h2><p>支持同事模块的商品榜单与 SKU 资料文件，自动建立批次和重复校验。</p></div></div>
    {!currentUser || currentUser.role !== "admin" ? <div className="market-import-permission">仅管理员可导入市场数据。</div> : <>
      {(feedback || error) && <div className={`market-feedback ${error ? "error" : "success"}`}>{error || feedback}</div>}
      <div className="market-import-form">
        <label><span>数据类型</span><div className="market-segmented"><button type="button" className={sourceType === "market_ranking" ? "active" : ""} onClick={() => setSourceType("market_ranking")}>商品榜单</button><button type="button" className={sourceType === "sku_catalog" ? "active" : ""} onClick={() => setSourceType("sku_catalog")}>SKU 资料</button></div></label>
        <label><span>默认类目</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="文件无类目列时使用" /></label>
        <label><span>默认口径</span><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="全部 / POP / 自营" /></label>
        <label><span>周期开始</span><input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label><span>周期结束</span><input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        <label className="market-file-picker"><span>数据文件</span><input type="file" accept=".xls,.xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><strong>{file ? file.name : "选择 XLS / XLSX / CSV"}</strong><small>最大 25MB；榜单文件缺少商品 ID 时，将按商品名称与店铺生成稳定市场标识</small></label>
      </div><button type="button" className="primary-button" disabled={busy} onClick={() => void upload()}>{busy ? "正在导入…" : "开始导入"}</button>
    </>}
  </section><section className="panel market-batch-list"><div className="section-header"><div><h2>最近导入批次</h2><p>保留文件、行数、更新结果和告警。</p></div></div>{data.batches.map((batch) => <article key={batch.id}><div><strong>{batch.fileName}</strong><small>{batch.sourceType} · {batch.completedAt ? new Date(batch.completedAt).toLocaleString("zh-CN") : "处理中"}</small></div><span>{count(batch.rowCount)} 行</span><small>新增 {count(batch.insertedCount)} · 更新 {count(batch.updatedCount)} · 告警 {count(batch.warningCount)}</small></article>)}{!data.batches.length && <p className="soft-text">暂无市场数据导入记录。</p>}</section></div>;
}

function AiPanel({ currentUser, filters }: { currentUser: CurrentUser; filters: { query: string; categories: string[]; scopes: string[]; brands: string[]; startDate: string; endDate: string } }) {
  const [question, setQuestion] = useState("请分析当前市场机会、主要竞品风险，并给出三项可执行建议");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/market/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, ...filters }) });
      const payload = await response.json().catch(() => null) as { answer?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "AI 分析失败");
      setAnswer(payload?.answer || "模型未返回内容");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI 分析失败"); }
    finally { setBusy(false); }
  };
  const canUse = currentUser?.role === "admin" || currentUser?.role === "operator";
  return <section className="panel market-ai-panel"><div className="section-header"><div><h2>AI 市场洞察</h2><p>复用 AI 助理中启用的默认文本模型，并自动带入当前筛选后的真实市场数据。</p></div><span className="soft-tag">只读分析</span></div>
    {!canUse ? <div className="market-import-permission">需登录操作员或管理员账号后使用 AI 分析。</div> : <><textarea value={question} maxLength={1200} onChange={(event) => setQuestion(event.target.value)} /><div className="market-ai-actions"><span>不会自动修改商品、价格或经营数据。</span><button type="button" className="primary-button" disabled={busy || !question.trim()} onClick={() => void run()}>{busy ? "分析中…" : "生成市场洞察"}</button></div>{error && <div className="market-feedback error">{error}</div>}{answer && <article className="market-ai-answer"><strong>分析结果</strong><p>{answer}</p></article>}</>}
  </section>;
}

export default function MarketView({ customStartDate, customEndDate, currentUser }: { customStartDate: string; customEndDate: string; currentUser: CurrentUser }) {
  const [tab, setTab] = useState<TabKey>("ranking");
  const [data, setData] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      categories.forEach((value) => params.append("category", value));
      scopes.forEach((value) => params.append("scope", value));
      brands.forEach((value) => params.append("brand", value));
      if (customStartDate) params.set("startDate", customStartDate);
      if (customEndDate) params.set("endDate", customEndDate);
      const response = await fetch(`/api/market/overview?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as MarketOverview | null;
      if (!response.ok) throw new Error(payload?.error || "市场分析数据读取失败");
      if (!payload) throw new Error("市场分析返回为空");
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "市场分析数据读取失败"); }
    finally { setLoading(false); }
  }, [query, categories, scopes, brands, customStartDate, customEndDate]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load, reloadKey]);
  const toggleCompare = (sku: string) => setCompareIds((current) => current.includes(sku) ? current.filter((item) => item !== sku) : current.length >= 5 ? current : [...current, sku]);
  const tabs: Array<[TabKey, string]> = [["ranking", "商品榜单"], ["overview", "行业概览"], ["compare", `竞品对比${compareIds.length ? ` (${compareIds.length})` : ""}`], ["import", "数据导入"], ["ai", "AI 洞察"], ["annotation", "SKU AI 标注"]];
  if (loading && !data) return <section className="panel data-state"><span className="state-spinner" /><strong>正在连接市场分析数据</strong><p>正在读取榜单、SKU/SPU 与销售关联结果…</p></section>;
  if (error && !data) return <section className="panel data-state"><span className="state-symbol">!</span><strong>市场分析暂时不可用</strong><p>{error}</p><button className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>重新加载</button></section>;
  if (!data) return null;
  const aiFilters = { query, categories, scopes, brands, startDate: customStartDate, endDate: customEndDate };
  return <div className="market-module">
    <div className="subnav market-subnav" role="tablist" aria-label="市场分析视图">{tabs.map(([key, label]) => <button type="button" key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
    <section className="panel market-filter-bar"><div><span className="eyebrow">MARKET INTELLIGENCE</span><h2>市场范围与数据关联</h2><p>榜单数据与运营系统中的京东 SKU/SPU、销售明细按商品编码实时关联。</p></div><div className="market-filter-controls"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品、SKU 或品牌" aria-label="搜索市场商品" /><SearchMultiFilter label="类目" values={categories} options={data.filters.categories} onChange={setCategories} /><SearchMultiFilter label="口径" values={scopes} options={data.filters.scopes} onChange={setScopes} /><SearchMultiFilter label="品牌" values={brands} options={data.filters.brands} onChange={setBrands} /></div><footer><span className="status status-success">已接入</span><strong>{data.dataRange.startDate ?? "暂无日期"} 至 {data.dataRange.endDate ?? "暂无日期"}</strong><small>商品图缓存 {count(data.imageCache.cached)}/{count(data.imageCache.total)}{data.imageCache.pending ? ` · 待处理 ${count(data.imageCache.pending)}` : ""}</small></footer></section>
    {error && <div className="market-feedback error">{error}</div>}
    {tab !== "import" && tab !== "ai" && tab !== "annotation" && <MarketKpis data={data} />}
    {tab === "ranking" && <RankingTable items={data.items} compareIds={compareIds} onToggleCompare={toggleCompare} />}
    {tab === "overview" && <IndustryOverview data={data} />}
    {tab === "compare" && <ComparePanel items={data.items} compareIds={compareIds} onRemove={toggleCompare} />}
    {tab === "import" && <ImportPanel currentUser={currentUser} data={data} onImported={() => setReloadKey((key) => key + 1)} />}
    {tab === "ai" && <AiPanel currentUser={currentUser} filters={aiFilters} />}
    {tab === "annotation" && <MarketAnnotationView currentUser={currentUser} />}
  </div>;
}
