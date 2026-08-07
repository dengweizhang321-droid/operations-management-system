"use client";
/* eslint-disable @next/next/no-img-element -- Market ranking thumbnails are imported business assets. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beginLatestRequest, invalidateLatestRequest, invokeLatestRequest, settleLatestRequest } from "@/lib/market/latest-request";
import { annotationRequestRetryKind, annotationRetryDelayMs } from "@/lib/market/annotation-retry";
import MarketAnnotationView from "./market-annotation-view";

const PRICE_RECOGNITION_REQUEST_TIMEOUT_MS = 110_000;
const PRICE_RECOGNITION_CONCURRENCY = 2;
const PRICE_RECOGNITION_BATCH_SIZE = 1;

async function postPriceRecognitionAction(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PRICE_RECOGNITION_REQUEST_TIMEOUT_MS);
  try {
    return await fetch("/api/market/master", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("价格识别请求超时，系统将自动刷新任务状态并续跑原任务");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

type CurrentUser = { email: string; role: "viewer" | "analyst" | "operator" | "admin" } | null;
type FilterOption = { value: string; count: number; label?: string };
type MarketItem = {
  id: number; periodStart: string; periodEnd: string; category: string; scope: string; rankingDimension: "SKU" | "SPU";
  operationMode: "POP" | "自营" | "未知"; subcategory: string; rank: number | null; previousRank: number | null; rankChange: number | null;
  skuCode: string; productName: string; brand: string; priceCents: number | null; marketPriceCents: number | null; marketPriceSource: string;
  averageTransactionPriceCents: number | null; discountBps: number | null; discountReference: boolean;
  gmvCents: number; quantity: number; pageViews: number; visitors: number; conversionBps: number | null;
  cartCustomers: number; searchClicks: number; imageUrl: string; productUrl: string; sourceImageUrl: string; imageCacheStatus: string;
  periodCount: number; isOwn: boolean; ownSalesCents: number; gmvOutOfBand?: boolean;
};
type MarketCompareIdentity = Pick<MarketItem, "skuCode" | "category" | "scope" | "rankingDimension">;
type MarketCompareSelection = MarketCompareIdentity & Pick<MarketItem, "productName">;
type GrowthFields = { latestPeriod: string | null; monthOverMonthBps: number | null; yearOverYearBps: number | null };
type MarketIndustryReport = {
  definition: {
    title: string; metricScope: string;
    profile: { category: string; coreSubcategories: readonly string[]; adjacentSubcategories: readonly string[]; adjacentCategories: readonly string[] };
    selectedCategories: string[]; selectedScopes: string[]; selectedRankingDimensions: string[];
  };
  period: {
    coverageMonths: number; latestPeriod: string | null; latestGmvCents: number; monthOverMonthBps: number | null; yearOverYearBps: number | null;
    peak: { period: string; gmvCents: number } | null; trough: { period: string; gmvCents: number } | null;
    latestEntryCount: number | null; latestExitCount: number | null; latestExitPeriod: string | null;
  };
  lifecycle: Array<{ period: string; entryCount: number | null; exitCount: number | null }>;
  operationModes: Array<{
    operationMode: string; gmvCents: number; quantity: number; skuCount: number; visitors: number; conversionBps: number | null;
    brandCount: number; gmvShareBps: number; averageTransactionPriceCents: number | null; gmvPerSkuCents: number;
  }>;
  brandConcentrationTrend: Array<{ period: string; gmvCents: number; brandCount: number; cr3Bps: number; cr5Bps: number }>;
  trafficQuadrants: Array<{
    quadrant: "high_traffic_high_conversion" | "high_traffic_low_conversion" | "low_traffic_high_conversion" | "low_traffic_low_conversion";
    productCount: number; gmvCents: number; quantity: number; visitors: number; conversionBps: number | null;
    visitorThreshold: number; conversionThresholdBps: number;
    examples: Array<{ skuCode: string; productName: string; gmvCents: number }>;
  }>;
  productSignals: { sampleSize: number; source: string; signals: Array<{ group: string; label: string; count: number; shareBps: number; examples: string[] }> };
  opportunities: Array<{
    subcategory: string; priceBand: string; scenario: string; gmvCents: number; quantity: number; skuCount: number; visitors: number;
    conversionBps: number | null; brandCount: number; gmvShareBps: number; growthBps: number | null; selfOperatedShareBps: number;
    pendingPriceShareBps: number; score: number; recommendation: "建议进入" | "持续观察" | "谨慎回避"; reasons: string[]; decisionReady: boolean;
  }>;
  dataQuality: {
    categoryCount: number; scopeCount: number; rankingDimensionCount: number; operationModeCount: number;
    unknownBrandSkuCount: number; unclassifiedSkuCount: number; pendingPriceSkuCount: number;
    identityReady: boolean; coverageReady: boolean; comparisonReady: boolean; warnings: string[];
  };
  externalDataGaps: Array<{ key: string; label: string; status: string; note: string }>;
};
type MarketOverview = {
  view: "ranking" | "full";
  summary: {
    productCount: number; categoryCount: number; brandCount: number; gmvCents: number; quantity: number; pageViews: number; visitors: number;
    ownProductCount: number; activeSkuCount: number; pendingAiCount: number; selfOperatedGmvCents: number; selfOperatedShareBps: number | null;
    medianMarketPriceCents: number | null; weightedMarketPriceCents: number | null; averageTransactionPriceCents: number | null;
  };
  items: MarketItem[];
  trend: Array<Record<string, string | number | null>>;
  trendTotal: number;
  trendTruncated: boolean;
  priceBands: FilterOption[];
  priceBandSummary: Array<{ priceBand: string; gmvCents: number; quantity: number; skuCount: number; popGmvCents: number; selfGmvCents: number; gmvShareBps: number; selfOperatedShareBps: number | null; mainBrands: string[] }>;
  priceBandTrend: Array<{ period: string; priceBand: string; gmvCents: number; quantity: number; gmvShareBps: number }>;
  brandAnalysis: { items: Array<{ brand: string; gmvCents: number; quantity: number; skuCount: number; bestRank: number | null; gmvShareBps: number; heroSkuGmvCents: number; heroSkuShareBps: number; priceBands: string[]; subcategories: string[] } & GrowthFields>; cr3Bps: number; cr5Bps: number; concentration: string };
  subcategorySummary: Array<{ subcategory: string; skuCount: number; gmvCents: number; gmvShareBps: number; quantity: number; averageTransactionPriceCents: number | null; selfOperatedShareBps: number | null; pendingSkuCount: number; mainBrands: string[]; mainPriceBands: string[] } & GrowthFields>;
  industryReport: MarketIndustryReport;
  filters: { categories: FilterOption[]; scopes: FilterOption[]; brands: FilterOption[]; rankingDimensions: FilterOption[]; operationModes: FilterOption[]; subcategories: FilterOption[]; priceBands: FilterOption[] };
  dataRange: { startDate: string | null; endDate: string | null };
  batches: Array<{ id: string; fileName: string; sourceType: string; rowCount: number; insertedCount: number; updatedCount: number; warningCount: number; completedAt: string | null }>;
  imageCache: { total: number; cached: number; failed: number; pending: number };
  error?: string;
};
type TrendPayload = { items: Array<Record<string, string | number | null>>; totalMonths: number; truncated: boolean; error?: string };
type ComparePayload = {
  items: Array<{
    skuCode: string; productName: string; brand: string; category: string; scope: string; rankingDimension: "SKU" | "SPU";
    gmvCents: number; quantity: number; visitors: number; conversionBps: number | null; bestRank: number | null;
    marketPriceCents: number | null; averageTransactionPriceCents: number | null;
    trend: Array<Record<string, string | number | null>>;
    trendTotalMonths: number; trendTruncated: boolean;
  }>;
  missingSkuCodes: string[];
  missingSelections: MarketCompareIdentity[];
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
type MarketSystemKpis = {
  marketIdentityTotal: number; pendingPriceCount: number; pendingAiCount: number; completedAiCount: number;
  sameImageReuseCount: number; priceOnlyRecognitionCount: number; fullRecognitionCount: number; blockedRecognitionCount: number;
};

const money = (cents?: number | null) => cents === null || cents === undefined
  ? "-"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(cents / 100);
const count = (value = 0) => new Intl.NumberFormat("zh-CN").format(value);
const percent = (bps?: number | null) => bps === null || bps === undefined ? "-" : `${(bps / 100).toFixed(2)}%`;
const growthPercent = (bps?: number | null) => bps === null || bps === undefined ? "暂无可比" : `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
const monthText = (start: string | null, end: string | null) => start && end ? `${start.slice(0, 7)} 至 ${end.slice(0, 7)}` : "暂无月份";
const shanghaiToday = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const twelveMonthReportPeriod = (referenceDate = shanghaiToday()) => {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(referenceDate);
  if (!match) return { startDate: referenceDate, endDate: referenceDate };
  const currentMonth = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const start = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 12, 1));
  const end = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 0));
  const iso = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return { startDate: iso(start), endDate: iso(end) };
};
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
const marketCompareSelectionKey = (selection: MarketCompareIdentity) => JSON.stringify([
  selection.category,
  selection.scope,
  selection.rankingDimension,
  selection.skuCode,
]);
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
  const visible = options.filter((option) => `${option.label ?? ""} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  return <div className="market-filter" ref={root}>
    <button type="button" className={values.length ? "active" : ""} onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <span>{label}</span><strong>{values.length ? `已选 ${values.length}` : `全部${label}`}</strong><em>⌄</em>
    </button>
    {open && <div className="market-filter-popover">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} autoFocus />
      <button type="button" className="market-filter-all" onClick={() => onChange([])}><i className={!values.length ? "checked" : ""} />全部{label}</button>
      <div>{visible.map((option) => <button type="button" key={option.value} onClick={() => toggle(option.value)}>
        <i className={values.includes(option.value) ? "checked" : ""} /><span>{option.label ?? option.value}</span><small>{count(option.count)}</small>
      </button>)}{visible.length === 0 && <p>未找到匹配内容</p>}</div>
    </div>}
  </div>;
}

function KpiCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className="panel"><span className={`market-kpi-dot ${tone}`} /><small>{label}</small><strong>{value}</strong><p>{note}</p></article>;
}

function marketReportDimensionLabel(data: MarketOverview) {
  const selected = data.industryReport.definition.selectedRankingDimensions;
  if (selected.length === 1) return selected[0];
  if (data.industryReport.dataQuality.rankingDimensionCount > 1) return "商品";
  return data.items[0]?.rankingDimension ?? "商品";
}

function MarketSectionNav({ active, compareCount, onChange }: { active: MarketSectionKey; compareCount: number; onChange: (section: MarketSectionKey) => void }) {
  const sections: Array<{ key: MarketSectionKey; number: string; label: string; note: string }> = [
    { key: "ranking", number: "01", label: "商品榜单", note: "TOP 商品、成交数据与单品趋势" },
    { key: "overview", number: "02", label: "行业汇报", note: "趋势、结构、竞争与机会矩阵" },
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
  const dimensionLabel = marketReportDimensionLabel(data);
  return <section className="market-kpi-grid market-kpi-grid-seven">
    <KpiCard label="主图价格中位数" value={money(data.summary.medianMarketPriceCents)} note="行业价格 KPI · 当前 TOP 榜单覆盖口径" tone="blue" />
    <KpiCard label="销售额加权主图价" value={money(data.summary.weightedMarketPriceCents)} note="按榜单销售额加权" tone="green" />
    <KpiCard label="榜单覆盖销售额" value={money(data.summary.gmvCents)} note="不能视为完整行业市场" tone="purple" />
    <KpiCard label="成交件数" value={count(data.summary.quantity)} note={`成交均价 ${money(data.summary.averageTransactionPriceCents)}`} tone="orange" />
    <KpiCard label="自营销售额占比" value={percent(data.summary.selfOperatedShareBps)} note={`${money(data.summary.selfOperatedGmvCents)} / 当前筛选销售额`} tone="green" />
    <KpiCard label={`${dimensionLabel} 数`} value={count(data.summary.productCount)} note={`${count(data.summary.brandCount)} 个品牌`} tone="blue" />
    <KpiCard label="品牌数" value={count(data.summary.brandCount)} note={`CR3 ${percent(data.brandAnalysis.cr3Bps)} · CR5 ${percent(data.brandAnalysis.cr5Bps)}`} tone="purple" />
  </section>;
}

function IndustryExecutiveSummary({ data }: { data: MarketOverview }) {
  const report = data.industryReport;
  const topSubcategory = data.subcategorySummary[0];
  const topBrand = data.brandAnalysis.items[0];
  const topOpportunity = report.opportunities[0];
  const profile = report.definition.profile;
  return <section className="panel market-industry-executive">
    <header><div><span className="eyebrow">EXECUTIVE SUMMARY</span><h2>京东商用直饮机行业汇报</h2><p>所有金额与份额均为“当前 TOP 榜单覆盖市场”，不外推为京东完整行业大盘。</p></div><div className="market-industry-scope-state"><strong className={report.dataQuality.identityReady ? "ready" : "warning"}>{report.dataQuality.identityReady ? "分析身份已锁定" : "分析身份待锁定"}</strong><small>{report.dataQuality.categoryCount} 个类目 · {report.dataQuality.scopeCount} 个榜单范围 · {report.dataQuality.rankingDimensionCount} 个榜单维度</small></div></header>
    <div className="market-industry-insight-grid">
      <article><small>市场趋势</small><strong>{report.period.latestPeriod ?? "暂无月份"} · {money(report.period.latestGmvCents)}</strong><span>环比 {growthPercent(report.period.monthOverMonthBps)} · 同比 {growthPercent(report.period.yearOverYearBps)}</span></article>
      <article><small>主力细分</small><strong>{topSubcategory?.subcategory ?? "暂无数据"}</strong><span>{topSubcategory ? `销售占比 ${percent(topSubcategory.gmvShareBps)} · 环比 ${growthPercent(topSubcategory.monthOverMonthBps)}` : "等待细分类目数据"}</span></article>
      <article><small>竞争格局</small><strong>{topBrand?.brand ?? "暂无品牌"}</strong><span>CR3 {percent(data.brandAnalysis.cr3Bps)} · CR5 {percent(data.brandAnalysis.cr5Bps)}{topBrand ? ` · 爆款依赖 ${percent(topBrand.heroSkuShareBps)}` : ""}</span></article>
      <article><small>市场机会信号</small><strong>{topOpportunity ? `${topOpportunity.subcategory} × ${topOpportunity.priceBand}` : "暂无可评级单元"}</strong><span>{topOpportunity ? `${topOpportunity.recommendation} · ${topOpportunity.score} 分${topOpportunity.decisionReady ? "" : " · 待补齐口径/价格"}` : "等待连续月份与正式价格"}</span></article>
    </div>
    <div className="market-industry-boundary"><div><strong>核心范围</strong>{profile.coreSubcategories.map((item) => <span key={item}>{item}</span>)}</div><div><strong>相邻范围（单独分析）</strong>{profile.adjacentSubcategories.map((item) => <span key={item}>{item}</span>)}{profile.adjacentCategories.map((item) => <span key={item}>{item}</span>)}</div></div>
    {report.dataQuality.warnings.length > 0 && <div className="market-industry-warnings">{report.dataQuality.warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}
  </section>;
}

function TrendSection({ data }: { data: MarketOverview }) {
  const dimensionLabel = marketReportDimensionLabel(data);
  const metrics = [
    ["gmv_cents", "销售额", (value: number | null) => money(value)],
    ["quantity", "成交件数", (value: number | null) => count(value ?? 0)],
    ["weighted_market_price_cents", "市场定位价", (value: number | null) => money(value)],
    ["average_transaction_price_cents", "成交均价", (value: number | null) => money(value)],
    ["self_gmv_cents", "POP/自营销售额", (value: number | null) => money(value)],
    ["product_count", `${dimensionLabel} 数`, (value: number | null) => count(value ?? 0)],
    ["brand_count", "品牌数", (value: number | null) => count(value ?? 0)],
  ] as const;
  const [metric, setMetric] = useState<(typeof metrics)[number][0]>("gmv_cents");
  const selected = metrics.find((item) => item[0] === metric) ?? metrics[0];
  const max = Math.max(1, ...data.trend.map((row) => Number(row[metric] ?? 0)));
  return <section className="panel market-section">
    <div className="section-header"><div><h2>月度趋势</h2><p>由服务端按完整筛选结果汇总，最多展示最近 60 个月{data.trendTruncated ? `（共 ${count(data.trendTotal)} 个月）` : ""}。</p></div><select value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}>{metrics.map((item) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select></div>
    <div className="market-trend-chart">{data.trend.map((row) => {
      const value = Number(row[metric] ?? 0);
      return <div key={String(row.period)}><span style={{ height: `${Math.max(5, value / max * 100)}%` }} /><strong>{selected[2](row[metric] === null ? null : value)}</strong><small>{String(row.period)}</small></div>;
    })}{!data.trend.length && <p>暂无趋势数据</p>}</div>
    <div className="market-lifecycle-strip">{data.industryReport.lifecycle.slice(-12).map((row) => <article key={row.period}><strong>{row.period}</strong><span>进入榜单 {row.entryCount === null ? "—" : count(row.entryCount)}</span><span>退出榜单 {row.exitCount === null ? "—" : count(row.exitCount)}</span></article>)}{!data.industryReport.lifecycle.length && <p>暂无连续月份，不能判断商品进入与退出。</p>}</div>
    <small className="market-method-note">首月无法识别新增、末月无法识别退出；进入/退出均按类目、榜单范围、SKU/SPU 维度和商品编码判断。</small>
  </section>;
}

function PriceBandSection({ data }: { data: MarketOverview }) {
  const max = Math.max(1, ...data.priceBandSummary.map((item) => item.gmvCents));
  const dimensionLabel = marketReportDimensionLabel(data);
  return <section className="panel market-section">
    <div className="section-header"><div><h2>价格带分析</h2><p>优先使用对应月份的人工确认市场定位价；尚未确认时，以源表价格区间中位数兜底划分。</p></div></div>
    <div className="market-price-band-grid">{data.priceBandSummary.map((item) => <article key={item.priceBand}>
      <div><strong>{item.priceBand}</strong><span>{money(item.gmvCents)}</span></div>
      <i><b style={{ width: `${item.gmvCents / max * 100}%` }} /></i>
      <small>销售额占比 {percent(item.gmvShareBps)} · 成交 {count(item.quantity)} · {dimensionLabel} {count(item.skuCount)} · 自营 {percent(item.selfOperatedShareBps)}</small>
      <em>{item.mainBrands.slice(0, 3).join(" / ") || "暂无主要品牌"}</em>
    </article>)}</div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>价格带</th><th>销售额</th><th>当月销售占比</th><th>成交件数</th></tr></thead><tbody>{data.priceBandTrend.map((item) => <tr key={`${item.period}-${item.priceBand}`}><td>{item.period}</td><td>{item.priceBand}</td><td>{money(item.gmvCents)}</td><td>{percent(item.gmvShareBps)}</td><td>{count(item.quantity)}</td></tr>)}{!data.priceBandTrend.length && <tr><td colSpan={5}><div className="table-state">暂无价格带月度变化数据。</div></td></tr>}</tbody></table></div>
  </section>;
}

function BrandSection({ data }: { data: MarketOverview }) {
  const max = Math.max(1, ...data.brandAnalysis.items.map((item) => item.gmvCents));
  const concentrationTrend = data.industryReport.brandConcentrationTrend.slice(-12);
  const dimensionLabel = marketReportDimensionLabel(data);
  return <section className="panel market-section">
    <div className="section-header"><div><h2>品牌竞争及品牌份额</h2><p>品牌份额为当前 TOP 榜单覆盖口径；集中度：{data.brandAnalysis.concentration}。</p></div></div>
    <div className="market-brand-list">{data.brandAnalysis.items.slice(0, 12).map((item) => <article key={item.brand}>
      <label><strong>{item.brand}</strong><span>{percent(item.gmvShareBps)}</span></label>
      <i><b style={{ width: `${item.gmvCents / max * 100}%` }} /></i>
      <small>{money(item.gmvCents)} · 成交 {count(item.quantity)} · {dimensionLabel} {count(item.skuCount)} · 最好排名 {item.bestRank ? `#${item.bestRank}` : "-"}</small>
      <small>环比 {growthPercent(item.monthOverMonthBps)} · 同比 {growthPercent(item.yearOverYearBps)} · 头部单品贡献 {percent(item.heroSkuShareBps)}</small>
      <em>{[...item.priceBands.slice(0, 2), ...item.subcategories.slice(0, 2)].join(" / ")}</em>
    </article>)}</div>
    <div className="market-concentration-trend">{concentrationTrend.map((item) => <article key={item.period}><strong>{item.period}</strong><div><span>CR3 {percent(item.cr3Bps)}</span><i><b style={{ width: `${Math.min(100, item.cr3Bps / 100)}%` }} /></i></div><div><span>CR5 {percent(item.cr5Bps)}</span><i><b style={{ width: `${Math.min(100, item.cr5Bps / 100)}%` }} /></i></div><small>{count(item.brandCount)} 个品牌</small></article>)}{!concentrationTrend.length && <p>暂无品牌集中度月度变化数据。</p>}</div>
  </section>;
}

function SubcategorySection({ data }: { data: MarketOverview }) {
  const dimensionLabel = marketReportDimensionLabel(data);
  return <section className="panel market-section market-subcategory-panel">
    <div className="section-header"><div><h2>细分类目拆分汇总</h2><p>服务端完整汇总 {dimensionLabel} 数、销售额、成交件数、价格和待确认数据。</p></div></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>细分类目</th><th>{dimensionLabel} 数</th><th>销售额</th><th>销售占比</th><th>环比</th><th>同比</th><th>成交件数</th><th>成交均价</th><th>自营占比</th><th>主要品牌</th><th>主力价格带</th><th>待确认{dimensionLabel}</th></tr></thead><tbody>
      {data.subcategorySummary.map((item) => <tr key={item.subcategory}><td>{item.subcategory || "未分类"}</td><td>{count(item.skuCount)}</td><td>{money(item.gmvCents)}</td><td>{percent(item.gmvShareBps)}</td><td>{growthPercent(item.monthOverMonthBps)}</td><td>{growthPercent(item.yearOverYearBps)}</td><td>{count(item.quantity)}</td><td>{money(item.averageTransactionPriceCents)}</td><td>{percent(item.selfOperatedShareBps)}</td><td>{item.mainBrands.join(" / ") || "-"}</td><td>{item.mainPriceBands.join(" / ") || "-"}</td><td>{count(item.pendingSkuCount)}</td></tr>)}
      {!data.subcategorySummary.length && <tr><td colSpan={12}><div className="table-state">当前筛选范围暂无细分类目数据。</div></td></tr>}
    </tbody></table></div>
  </section>;
}

function OperationModeSection({ data }: { data: MarketOverview }) {
  const dimensionLabel = marketReportDimensionLabel(data);
  const monthly = data.trend.slice(-12).map((row) => {
    const popGmvCents = Number(row.pop_gmv_cents ?? 0);
    const selfGmvCents = Number(row.self_gmv_cents ?? 0);
    const total = popGmvCents + selfGmvCents;
    return { period: String(row.period ?? ""), popGmvCents, selfGmvCents, selfShareBps: total > 0 ? Math.max(0, Math.min(10_000, Math.round(selfGmvCents / total * 10_000))) : 0 };
  });
  return <section className="panel market-section">
    <div className="section-header"><div><h2>自营与 POP 经营结构</h2><p>对比销售规模、商品效率、价格与转化，判断平台信用和商家专业服务的相对作用。</p></div></div>
    <div className="market-operation-grid">{data.industryReport.operationModes.map((item) => <article key={item.operationMode}><header><strong>{item.operationMode}</strong><span>{percent(item.gmvShareBps)}</span></header><b>{money(item.gmvCents)}</b><small>成交 {count(item.quantity)} · {dimensionLabel} {count(item.skuCount)} · 品牌 {count(item.brandCount)}</small><small>成交均价 {money(item.averageTransactionPriceCents)} · 单 {dimensionLabel} 销售额 {money(item.gmvPerSkuCents)}</small><small>访客 {count(item.visitors)} · 转化率 {percent(item.conversionBps)}</small></article>)}{!data.industryReport.operationModes.length && <p>暂无经营模式数据。</p>}</div>
    <div className="market-operation-trend">{monthly.map((item) => <article key={item.period}><strong>{item.period}</strong><i><b style={{ width: `${item.selfShareBps / 100}%` }} /><span style={{ width: `${100 - item.selfShareBps / 100}%` }} /></i><small>自营 {money(item.selfGmvCents)}（{percent(item.selfShareBps)}） · POP {money(item.popGmvCents)}</small></article>)}{!monthly.length && <p>暂无自营与 POP 月度结构数据。</p>}</div>
  </section>;
}

const quadrantMeta: Record<MarketIndustryReport["trafficQuadrants"][number]["quadrant"], { title: string; note: string }> = {
  high_traffic_high_conversion: { title: "高流量 · 高转化", note: "重点守住排名、库存和服务体验" },
  high_traffic_low_conversion: { title: "高流量 · 低转化", note: "优先检查价格、卖点和评价阻力" },
  low_traffic_high_conversion: { title: "低流量 · 高转化", note: "具备放量潜力，适合验证流量增量" },
  low_traffic_low_conversion: { title: "低流量 · 低转化", note: "谨慎投入，先验证产品定位" },
};

function TrafficQuadrantSection({ data }: { data: MarketOverview }) {
  const threshold = data.industryReport.trafficQuadrants[0];
  return <section className="panel market-section">
    <div className="section-header"><div><h2>商品流量 × 转化象限</h2><p>以当前筛选商品的平均访客与平均转化率为高低分界；样例商品来自当前 TOP 榜单样本。</p></div><small>阈值：访客 {count(threshold?.visitorThreshold ?? 0)} · 转化 {percent(threshold?.conversionThresholdBps)}</small></div>
    <div className="market-quadrant-grid">{data.industryReport.trafficQuadrants.map((item) => <article className={item.quadrant} key={item.quadrant}><header><strong>{quadrantMeta[item.quadrant].title}</strong><span>{count(item.productCount)} 个商品</span></header><b>{money(item.gmvCents)}</b><small>{quadrantMeta[item.quadrant].note}</small><small>象限转化 {percent(item.conversionBps)} · 访客 {count(item.visitors)}</small><div>{item.examples.map((example) => <span key={example.skuCode} title={example.productName}>{example.productName || example.skuCode}</span>)}</div></article>)}{!data.industryReport.trafficQuadrants.length && <p>当前数据不足以形成流量转化象限。</p>}</div>
  </section>;
}

function ProductSignalSection({ data }: { data: MarketOverview }) {
  const signals = data.industryReport.productSignals;
  const groups = [...new Set(signals.signals.map((item) => item.group))];
  return <section className="panel market-section">
    <div className="section-header"><div><h2>爆款标题与产品特征信号</h2><p>从 {count(signals.sampleSize)} 个去重商品身份的标题和已确认细分类目提取，不代表评价口碑或真实服务履约。</p></div></div>
    <div className="market-signal-groups">{groups.map((group) => <article key={group}><strong>{group}</strong><div>{signals.signals.filter((item) => item.group === group).map((item) => <span key={item.label} title={item.examples.join(" / ")}>{item.label}<b>{percent(item.shareBps)}</b><small>{count(item.count)}</small></span>)}</div></article>)}{!groups.length && <p>当前商品标题尚未识别到可汇总特征。</p>}</div>
  </section>;
}

function OpportunityMatrixSection({ data }: { data: MarketOverview }) {
  const dimensionLabel = marketReportDimensionLabel(data);
  return <section className="panel market-section market-opportunity-panel">
    <div className="section-header"><div><h2>细分类目 × 价格带 × 场景机会矩阵</h2><p>评分综合规模、最新月增长、单 {dimensionLabel} 效率、转化和自营门槛；未包含成本、推广、退货、复购与真实售后，不能直接替代投资决策。</p></div></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>建议</th><th>评分</th><th>细分类目</th><th>价格带</th><th>场景</th><th>销售额/占比</th><th>最新月增长</th><th>转化率</th><th>{dimensionLabel}/品牌</th><th>自营占比</th><th>价格完整性</th><th>主要依据</th></tr></thead><tbody>{data.industryReport.opportunities.map((item) => <tr key={`${item.subcategory}-${item.priceBand}`}><td><span className={`market-opportunity-status ${item.recommendation === "建议进入" ? "enter" : item.recommendation === "谨慎回避" ? "avoid" : "watch"}`}>{item.recommendation}</span>{!item.decisionReady && <small>待补齐数据</small>}</td><td><strong>{item.score}</strong></td><td>{item.subcategory}</td><td>{item.priceBand}</td><td>{item.scenario}</td><td>{money(item.gmvCents)}<small>{percent(item.gmvShareBps)}</small></td><td>{growthPercent(item.growthBps)}</td><td>{percent(item.conversionBps)}</td><td>{count(item.skuCount)} / {count(item.brandCount)}</td><td>{percent(item.selfOperatedShareBps)}</td><td>{item.pendingPriceShareBps ? `待确认 ${percent(item.pendingPriceShareBps)}` : "已覆盖"}</td><td>{item.reasons.join("；") || "暂无显著信号"}</td></tr>)}{!data.industryReport.opportunities.length && <tr><td colSpan={12}><div className="table-state">当前筛选范围没有可评级的细分类目与价格带组合。</div></td></tr>}</tbody></table></div>
  </section>;
}

function IndustryDataGapSection({ data }: { data: MarketOverview }) {
  return <section className="panel market-section">
    <div className="section-header"><div><h2>消费者、服务、利润与合规补充清单</h2><p>榜单数据无法回答的部分明确保持“待补充”，不使用标题、样例或估算冒充真实结论。</p></div></div>
    <div className="market-data-gap-grid">{data.industryReport.externalDataGaps.map((item) => <article key={item.key}><header><strong>{item.label}</strong><span>{item.status}</span></header><p>{item.note}</p></article>)}</div>
  </section>;
}

function RankingTable({ items, compareKeys, onToggleCompare, onTrend, onOpenCompare }: { items: MarketItem[]; compareKeys: string[]; onToggleCompare: (item: MarketItem) => void; onTrend: (item: MarketItem) => void; onOpenCompare: () => void }) {
  return <section className="panel market-table-panel">
    <div className="section-header"><div><h2>商品榜单</h2><p>标题下方固定展示周期、SKU ID、POP/自营、品牌、细分类目和确认状态。</p></div><div className="market-ranking-actions"><span className="soft-tag">显示 {count(items.length)} 条</span><button type="button" className="secondary-button" disabled={compareKeys.length < 2} onClick={onOpenCompare}>进入竞品对比{compareKeys.length ? `（${compareKeys.length}）` : ""}</button></div></div>
    <div className="data-table-wrap"><table className="data-table market-ranking-table market-ranking-table-v2"><thead><tr>
      <th>对比</th><th>排名</th><th>商品主图和标题</th><th>销售额</th><th>成交件数</th><th>市场定位价（主图）</th><th>成交均价</th><th>访客</th><th>转化率</th><th>排名变化</th><th>趋势操作</th>
    </tr></thead><tbody>{items.map((item) => <tr key={item.id}>
      <td><button type="button" className={`market-compare-check ${compareKeys.includes(marketCompareSelectionKey(item)) ? "active" : ""}`} onClick={() => onToggleCompare(item)} aria-label={`选择对比 ${item.productName || item.skuCode}`}>{compareKeys.includes(marketCompareSelectionKey(item)) ? "✓" : "+"}</button></td>
      <td><strong>{item.rank ? `#${item.rank}` : "-"}</strong><small>{item.rankingDimension}</small></td>
      <td><div className="market-product-cell">{item.imageUrl ? (marketProductHref(item.productUrl, item.skuCode) ? <a href={marketProductHref(item.productUrl, item.skuCode)} target="_blank" rel="noreferrer"><img src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></a> : <span><img src={item.imageUrl} alt={item.productName || item.skuCode} loading="lazy" /></span>) : <span>图</span>}<div>{marketProductHref(item.productUrl, item.skuCode) ? <a className="market-product-title-link" href={marketProductHref(item.productUrl, item.skuCode)} target="_blank" rel="noreferrer">{item.productName || "未命名商品"}</a> : <strong>{item.productName || "未命名商品"}</strong>}<small>{item.periodStart} 至 {item.periodEnd} · 上榜 {count(item.periodCount)} 期 · {item.rankingDimension} {item.skuCode}</small><small>{item.operationMode} · {item.brand || "品牌待识别"} · {item.subcategory || "未分类"} · {item.marketPriceSource}</small></div></div></td>
      <td><strong>{money(item.gmvCents)}</strong><small>当前 TOP 榜单覆盖口径</small></td>
      <td>{count(item.quantity)}</td>
      <td><strong>{money(item.marketPriceCents)}</strong><small>{item.marketPriceSource}</small></td>
      <td><strong>{money(item.averageTransactionPriceCents)}</strong><small>{item.discountBps === null ? "无折让率" : `${item.discountReference ? "参考" : "成交"}折让率 ${percent(item.discountBps)}`}</small></td>
      <td>{count(item.visitors)}</td><td>{percent(item.conversionBps)}</td>
      <td>{item.rankChange === null ? "-" : item.rankChange > 0 ? `↑${item.rankChange}` : item.rankChange < 0 ? `↓${Math.abs(item.rankChange)}` : "持平"}</td>
      <td><button type="button" className="row-action" onClick={() => onTrend(item)}>查看趋势</button></td>
    </tr>)}{items.length === 0 && <tr><td colSpan={11}><div className="table-state">当前市场周期和筛选条件下暂无商品数据，请调整条件或选择“全部时间”。</div></td></tr>}</tbody></table></div>
  </section>;
}

function TrendDrawer({ item, onClose }: { item: MarketItem; onClose: () => void }) {
  const [data, setData] = useState<TrendPayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ skuCode: item.skuCode, category: item.category, scope: item.scope, dimension: item.rankingDimension });
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
    {!data && !error && <div className="table-state"><span className="state-spinner" />正在读取最近 120 个月的月度趋势…</div>}
    {data && <><small>{data.truncated ? `展示最近 ${count(data.items.length)} / 共 ${count(data.totalMonths)} 个月` : `展示全部 ${count(data.totalMonths)} 个月`}</small><div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>销售额</th><th>成交件数</th><th>市场定位价</th><th>成交均价</th><th>排名</th><th>POP/自营</th><th>价格确认状态</th></tr></thead><tbody>{data.items.map((row) => <tr key={`${row.month}-${row.rank}`}>
      <td>{String(row.month)}</td><td>{money(Number(row.gmvCents ?? 0))}</td><td>{count(Number(row.quantity ?? 0))}</td><td>{money(row.marketPriceCents === null ? null : Number(row.marketPriceCents))}</td><td>{money(row.averageTransactionPriceCents === null ? null : Number(row.averageTransactionPriceCents))}</td><td>{row.rank === null ? "-" : `#${row.rank}`}</td><td>{String(row.operationMode)}</td><td>{String(row.priceStatus)} · {String(row.confirmationStatus)}</td>
    </tr>)}</tbody></table></div></>}
  </section></div>;
}

function CompareWorkspace({ selections, onClear, onRemoveCompare, onGoRanking, query, categories, scopes, rankingDimensions, operationModes, brands, subcategories, priceBands, startDate, endDate }: {
  selections: MarketCompareSelection[]; onClear: () => void; onRemoveCompare: (sku: string) => void; onGoRanking: () => void;
  query: string; categories: string[]; scopes: string[]; rankingDimensions: string[]; operationModes: string[]; brands: string[]; subcategories: string[]; priceBands: string[];
  startDate: string; endDate: string;
}) {
  const request = useMemo(() => {
    const params = new URLSearchParams({ view: "compare" });
    selections.forEach((selection) => params.append("selection", JSON.stringify(selection)));
    if (query.trim()) params.set("q", query.trim());
    categories.forEach((value) => params.append("category", value));
    scopes.forEach((value) => params.append("scope", value));
    rankingDimensions.forEach((value) => params.append("rankingDimension", value));
    operationModes.forEach((value) => params.append("operationMode", value));
    brands.forEach((value) => params.append("brand", value));
    subcategories.forEach((value) => params.append("subcategory", value));
    priceBands.forEach((value) => params.append("priceBand", value));
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const requestKey = params.toString();
    return { requestKey, url: selections.length < 2 ? null : `/api/market/master?${requestKey}` };
  }, [selections, query, categories, scopes, rankingDimensions, operationModes, brands, subcategories, priceBands, startDate, endDate]);
  const [result, setResult] = useState<{ requestKey: string; payload: ComparePayload | null; error: string } | null>(null);
  const data = result?.requestKey === request.requestKey ? result.payload : null;
  const error = result?.requestKey === request.requestKey ? result.error : "";
  const requestGeneration = useRef(0);
  useEffect(() => {
    const requestId = beginLatestRequest(requestGeneration);
    if (!request.url) return;
    const controller = new AbortController();
    void fetch(request.url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as ComparePayload | null;
        if (!response.ok || !payload) throw new Error(payload?.error || "商品对比读取失败");
        if (requestId !== requestGeneration.current) return;
        setResult({ requestKey: request.requestKey, payload, error: "" });
      })
      .catch((reason) => {
        if (requestId !== requestGeneration.current) return;
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setResult({ requestKey: request.requestKey, payload: null, error: reason instanceof Error ? reason.message : "商品对比读取失败" });
        }
      });
    return () => { invalidateLatestRequest(requestGeneration); controller.abort(); };
  }, [request]);
  if (selections.length < 2) return <section className="panel market-compare-workspace market-compare-empty">
    <div><span className="eyebrow">COMPETITOR BENCHMARK</span><h2>竞品对比工作区</h2><p>请先从商品榜单勾选 2–5 个 SKU。系统将使用当前筛选口径，对比销售额、成交件数、主图价格、成交均价、访客、转化率、排名和月度趋势。</p></div>
    <div className="market-compare-selection"><strong>已选择 {selections.length} / 5</strong>{selections.map((item) => <button type="button" key={marketCompareSelectionKey(item)} onClick={() => onRemoveCompare(marketCompareSelectionKey(item))}>{item.productName || item.skuCode}<span>×</span></button>)}</div>
    <div><button type="button" className="primary-button" onClick={onGoRanking}>前往商品榜单选择</button>{selections.length > 0 && <button type="button" className="row-action" onClick={onClear}>清空</button>}</div>
  </section>;
  const compared = selections.map((selection) => data?.items.find((item) => marketCompareSelectionKey(item) === marketCompareSelectionKey(selection))).filter(Boolean) as NonNullable<ComparePayload>["items"];
  const missingSelections = data?.missingSelections ?? [];
  const maxTrend = Math.max(1, ...compared.flatMap((item) => item.trend.slice(-12).map((row) => Number(row.gmvCents ?? 0))));
  return <section className="panel market-compare-workspace">
    <header><div><span className="eyebrow">COMPETITOR BENCHMARK</span><h2>竞品对比工作区</h2><p>主指标按当前筛选范围完整汇总；月度火花图只展示最近 12 个月。</p></div><div><strong>已选择 {selections.length} / 5</strong><button type="button" className="secondary-button" onClick={onGoRanking}>继续选择</button><button type="button" className="row-action" onClick={onClear}>清空</button></div></header>
    <div className="market-compare-selection">{selections.map((item) => <button type="button" key={marketCompareSelectionKey(item)} onClick={() => onRemoveCompare(marketCompareSelectionKey(item))}>{item.productName || item.skuCode}<span>×</span></button>)}</div>
    {error && <small className="red-text">{error}</small>}
    {!data && !error && <small>正在读取对比数据...</small>}
    {data && missingSelections.length > 0 && <small className="red-text">当前筛选范围无数据：{missingSelections.map((item) => `${item.skuCode}（${item.scope}）`).join("、")}。可调整筛选，或从上方移除。</small>}
    {data && <div className="market-compare-grid market-compare-grid-live">
      <div className="metric-labels"><strong>指标</strong>{["销售额", "成交件数", "市场定位价", "成交均价", "访客", "转化率", "最好排名", "月度趋势"].map((label) => <span key={label}>{label}</span>)}</div>
      {compared.map((item) => <article key={marketCompareSelectionKey(item)}>
        <strong title={item.productName}>{item.productName || item.skuCode}</strong><small>{item.skuCode} · {item.scope} · {item.brand || "-"} · {item.rankingDimension}{item.trendTruncated && <><br />服务端趋势最近 120 / 共 {count(item.trendTotalMonths)} 个月</>}</small><button type="button" aria-label={`移除 ${item.productName || item.skuCode}`} onClick={() => onRemoveCompare(marketCompareSelectionKey(item))}>×</button>
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
        const initialImageCache = payload.imageCache!;
        let pending = initialImageCache.pending;
        let cached = initialImageCache.cached;
        let failed = initialImageCache.failed;
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
        <label className="market-file-picker"><span>数据文件</span><input type="file" accept=".xls,.xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><strong>{file ? file.name : "选择 XLS / XLSX / CSV"}</strong><small>最大 25MB、5000 条数据；SKU/SPU 维度会独立保存。</small></label>
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
  const [masterCategories, setMasterCategories] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [masterPageSize, setMasterPageSize] = useState(30);
  const [databaseView, setDatabaseView] = useState<"cards" | "table">("cards");
  const [rankingDimensions, setRankingDimensions] = useState<string[]>([]);
  const [operationModes, setOperationModes] = useState<string[]>([]);
  const [subcategoryFilters, setSubcategoryFilters] = useState<string[]>([]);
  const [priceStatuses, setPriceStatuses] = useState<string[]>([]);
  const [annotationStatuses, setAnnotationStatuses] = useState<string[]>([]);
  const [visionModelId, setVisionModelId] = useState("");
  const [priceCategory, setPriceCategory] = useState("");
  const [masterCandidatePriceSources, setMasterCandidatePriceSources] = useState<string[]>([]);
  const [pendingPriceSources, setPendingPriceSources] = useState<string[]>([]);
  const [pendingPricePage, setPendingPricePage] = useState(1);
  const [pendingPricePageSize, setPendingPricePageSize] = useState(20);
  const [editingSku, setEditingSku] = useState<Record<string, string | number | null> | null>(null);
  const [skuDraft, setSkuDraft] = useState({ category: "", productName: "", brand: "", operationMode: "POP", subcategory: "", priceYuan: "", priceType: "标准售价" });
  const [subcategoryDrafts, setSubcategoryDrafts] = useState<Record<string, string>>({});
  const [newSubcategory, setNewSubcategory] = useState("");
  const [brandJob, setBrandJob] = useState<BrandRecognitionJob | null>(null);
  const brandRunnerStop = useRef(false);
  const loadRequestId = useRef(0);
  const latestLoadRef = useRef<() => Promise<void>>(async () => undefined);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isAdmin = currentUser?.role === "admin";
  const load = useCallback(async () => {
    const requestId = beginLatestRequest(loadRequestId);
    const params = new URLSearchParams();
    params.set("section", mode);
    if (query.trim()) params.set("q", query.trim());
    if (mode === "database") masterCategories.forEach((value) => params.append("category", value));
    else if (category) params.set("category", category);
    rankingDimensions.forEach((value) => params.append("rankingDimension", value));
    operationModes.forEach((value) => params.append("operationMode", value));
    subcategoryFilters.forEach((value) => params.append("subcategory", value));
    priceStatuses.forEach((value) => params.append("priceStatus", value));
    masterCandidatePriceSources.forEach((value) => params.append("priceSource", value));
    annotationStatuses.forEach((value) => params.append("annotationStatus", value));
    params.set("page", String(page));
    params.set("pageSize", String(masterPageSize));
    if (mode === "database") {
      masterCategories.forEach((value) => params.append("pendingPriceCategory", value));
      pendingPriceSources.forEach((value) => params.append("pendingPriceSource", value));
      params.set("pendingPricePage", String(pendingPricePage));
      params.set("pendingPricePageSize", String(pendingPricePageSize));
    }
    const settled = await settleLatestRequest(loadRequestId, requestId, async () => {
      const [response, modelsResponse] = await Promise.all([
        fetch(`/api/market/master?${params}`, { cache: "no-store" }),
        isAdmin && (mode === "database" || mode === "brand") ? fetch("/api/ai/models", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const payload = await response.json().catch(() => null) as MarketMasterWorkspace | null;
      const modelsPayload = modelsResponse
        ? await modelsResponse.json().catch(() => null) as { items?: AiModelSummary[]; error?: string } | null
        : null;
      if (!response.ok || !payload) throw new Error(payload?.error || "市场主数据读取失败");
      if (modelsResponse && !modelsResponse.ok) throw new Error(modelsPayload?.error || "运营管理系统 AI 算力读取失败");
      return { payload, modelsPayload, modelsResponse };
    });
    if (!settled.current) return;
    const { payload, modelsPayload, modelsResponse } = settled.value;
    setError("");
    setData(payload);
    setPage(payload.masterData.pagination.page);
    if (mode === "database") setPendingPricePage(payload.pendingPrices.pagination.page);
    setBrandJob(payload.brandRecognitionJob);
    setSubcategoryDrafts(Object.fromEntries(payload.subcategorySettings.items.map((item) => [String(item.subcategory), String(item.subcategory)])));
    if (modelsResponse) {
      const models = modelsPayload?.items ?? [];
      setAiModels(models);
      setBrandModelId((current) => current || models.find((item) => item.status === "enabled" && item.modelType === "text" && item.isDefaultTextModel)?.id || models.find((item) => item.status === "enabled" && item.modelType === "text")?.id || "");
      setVisionModelId((current) => current || models.find((item) => item.status === "enabled" && item.modelType === "vision")?.id || "");
    }
  }, [query, category, masterCategories, page, masterPageSize, masterCandidatePriceSources, pendingPriceSources, pendingPricePage, pendingPricePageSize, rankingDimensions, operationModes, subcategoryFilters, priceStatuses, annotationStatuses, isAdmin, mode]);
  latestLoadRef.current = load;
  const loadLatest = useCallback(() => invokeLatestRequest(latestLoadRef), []);
  useEffect(() => {
    invalidateLatestRequest(loadRequestId);
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "市场主数据读取失败")); }, 200);
    return () => { window.clearTimeout(timer); invalidateLatestRequest(loadRequestId); };
  }, [load]);
  useEffect(() => () => { brandRunnerStop.current = true; }, []);
  const post = async (body: Record<string, unknown>) => {
    setBusy(String(body.action ?? "action")); setError(""); setNotice("");
    try {
      const response = await fetch("/api/market/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "市场主数据操作失败");
      setNotice("操作已保存");
      await loadLatest();
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
      await loadLatest();
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
      await loadLatest();
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
      await loadLatest();
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
      await loadLatest();
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
      await loadLatest();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "系统品牌匹配失败"); }
    finally { setBusy(""); }
  };
  const recognizePrices = async () => {
    if (!priceCategory || !visionModelId) { setError("请选择类目，并先在 AI 助理配置中启用一个视觉模型"); return; }
    setBusy("recognize_prices"); setError(""); setNotice("正在创建价格识别任务…");
    try {
      const createResponse = await postPriceRecognitionAction({ action: "create_price_recognition_job", category: priceCategory, modelId: visionModelId, limit: 100 });
      const created = await createResponse.json().catch(() => null) as { error?: string; result?: { id?: string; totalCount?: number } } | null;
      if (!createResponse.ok || !created?.result?.id) throw new Error(created?.error || "价格识别任务创建失败");
      const jobId = created.result.id;
      const total = Number(created.result.totalCount ?? 0);
      let processed = 0;
      let failed = 0;
      let done = false;
      let workerLimit = PRICE_RECOGNITION_CONCURRENCY;
      let blockedUntil = 0;
      let retryFailures = 0;
      let successesSinceFailure = 0;
      let fatalError: unknown = null;
      const refreshRecognitionProgress = loadLatest;
      const waitForRetryWindow = async () => {
        while (!done && Date.now() < blockedUntil) await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(1_000, blockedUntil - Date.now())));
      };
      const scheduleRetry = (kind: "waiting" | "transient" | "rate_limit", retryAfterMs = 0, failureMessage = "") => {
        workerLimit = 1;
        successesSinceFailure = 0;
        if (kind !== "waiting") retryFailures += 1;
        const delayMs = annotationRetryDelayMs(kind, retryFailures, retryAfterMs);
        blockedUntil = Math.max(blockedUntil, Date.now() + delayMs);
        const seconds = Math.ceil(delayMs / 1_000);
        const cause = failureMessage.trim() ? `（${failureMessage.trim().slice(0, 300)}）` : "";
        setNotice(kind === "waiting"
          ? `已有图片正在识别，系统将在 ${seconds} 秒后自动检查。`
          : kind === "rate_limit"
            ? `模型供应商限流${cause}，已降为单通道，系统将在 ${seconds} 秒后自动续跑。`
            : `模型或网络超时${cause}，已降为单通道，系统将在 ${seconds} 秒后自动刷新并续跑。`);
      };
      const worker = async (workerIndex: number) => {
        while (!done && !fatalError) {
          if (workerIndex >= workerLimit) { await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000)); continue; }
          await waitForRetryWindow();
          if (done || fatalError || workerIndex >= workerLimit) continue;
          let response: Response;
          try {
            response = await postPriceRecognitionAction({ action: "run_price_recognition_batch", jobId, limit: PRICE_RECOGNITION_BATCH_SIZE });
          } catch (reason) {
            const retryKind = annotationRequestRetryKind(reason);
            if (retryKind) {
              scheduleRetry(retryKind);
              await refreshRecognitionProgress().catch(() => undefined);
              continue;
            }
            fatalError = reason; break;
          }
          const payload = await response.json().catch(() => null) as { error?: string; result?: { done?: boolean; waiting?: boolean; processedCount?: number; reusedCount?: number; failedCount?: number; failureKind?: string; failureCode?: string; failureMessage?: string; retryAfterMs?: number } } | null;
          if (!response.ok) {
            const retryKind = annotationRequestRetryKind({ status: response.status, message: payload?.error || "AI 价格识别失败" });
            if (retryKind) { scheduleRetry(retryKind); await refreshRecognitionProgress().catch(() => undefined); continue; }
            fatalError = new Error(payload?.error || "AI 价格识别失败"); break;
          }
          const processedThisCall = Math.max(0, Number(payload?.result?.processedCount ?? 0));
          const reusedThisCall = Math.max(0, Number(payload?.result?.reusedCount ?? 0));
          processed += processedThisCall;
          failed += Math.max(0, Number(payload?.result?.failedCount ?? 0));
          if (payload?.result?.done) done = true;
          if (payload?.result?.waiting) { scheduleRetry("waiting"); await refreshRecognitionProgress().catch(() => undefined); }
          else if (payload?.result?.failureKind === "rate_limit") { scheduleRetry("rate_limit", Number(payload.result.retryAfterMs ?? 0), payload.result.failureMessage); await refreshRecognitionProgress().catch(() => undefined); }
          else if (payload?.result?.failureKind === "transient") { scheduleRetry("transient", Number(payload.result.retryAfterMs ?? 0), payload.result.failureMessage); await refreshRecognitionProgress().catch(() => undefined); }
          else if (payload?.result?.failureKind === "permanent" && payload.result.failureMessage) setNotice(`当前图片识别失败（${payload.result.failureMessage}），系统已记录失败并继续处理其他图片。`);
          else if (!payload?.result?.failureKind && processedThisCall > reusedThisCall) {
            successesSinceFailure += processedThisCall - reusedThisCall;
            if (workerLimit === 1 && successesSinceFailure >= 3) {
              workerLimit = PRICE_RECOGNITION_CONCURRENCY;
              retryFailures = 0;
              setNotice("模型连接已稳定，系统已自动恢复双通道价格识别。");
            } else setNotice(`AI 价格识别 ${Math.min(processed, total)} / ${total}${failed ? `，失败 ${failed}` : ""}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PRICE_RECOGNITION_CONCURRENCY, total || 1) }, (_, index) => worker(index)));
      if (fatalError) throw fatalError;
      setNotice(`AI 价格识别完成，已处理 ${count(processed)} 次，结果已进入待确认候选价。`);
      await loadLatest();
    } catch (reason) {
      await loadLatest().catch(() => undefined);
      setError(reason instanceof Error ? reason.message : "AI 价格识别失败");
      setNotice("自动识别遇到不可恢复错误，已完成结果仍会保留。请检查模型配置或权限后重试。");
    }
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
      await loadLatest();
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
      <SearchMultiFilter label="三级类目" values={masterCategories} options={data.categories} onChange={(values) => { setMasterCategories(values); setPriceCategory(values.length === 1 ? values[0] : ""); setSubcategoryFilters([]); setPage(1); setPendingPricePage(1); }} />
      <SearchMultiFilter label="细分品类" values={subcategoryFilters} options={data.subcategories} onChange={(values) => { setSubcategoryFilters(values); setPage(1); }} />
      <SearchMultiFilter label="榜单维度" values={rankingDimensions} options={[{ value: "SKU", count: 0 }, { value: "SPU", count: 0 }]} onChange={(values) => { setRankingDimensions(values); setPage(1); }} />
      <SearchMultiFilter label="经营模式" values={operationModes} options={[{ value: "POP", count: 0 }, { value: "自营", count: 0 }, { value: "未知", count: 0 }]} onChange={(values) => { setOperationModes(values); setPage(1); }} />
      <SearchMultiFilter label="价格状态" values={priceStatuses} options={[{ value: "pending", label: "待确认价格", count: 0 }, { value: "confirmed", label: "已确认价格", count: 0 }, { value: "missing", label: "缺少价格", count: 0 }]} onChange={(values) => { setPriceStatuses(values); setPage(1); }} />
      <SearchMultiFilter label="候选价来源" values={masterCandidatePriceSources} options={[{ value: "ai", label: "AI 识别价", count: 0 }, { value: "non_ai", label: "非 AI 识别价", count: 0 }]} onChange={(values) => { setMasterCandidatePriceSources(values); setPage(1); }} />
      <SearchMultiFilter label="入库状态" values={annotationStatuses} options={[{ value: "pending", label: "待入库", count: 0 }, { value: "committed", label: "已入库", count: 0 }]} onChange={(values) => { setAnnotationStatuses(values); setPage(1); }} />
      <select aria-label="SKU 数据库每页条数" value={masterPageSize} onChange={(event) => { setMasterPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>每页 20 条</option><option value={30}>每页 30 条</option><option value={50}>每页 50 条</option><option value={100}>每页 100 条</option></select>
    </div><div className="market-price-recognition-inline"><select value={visionModelId} onChange={(event) => setVisionModelId(event.target.value)} disabled={!visionModels.length}><option value="">{visionModels.length ? "选择视觉模型" : "暂无已启用视觉模型"}</option>{visionModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelName}</option>)}</select><button className="secondary-button" disabled={Boolean(priceRecognitionBlocker) || !visionModelId || busy !== ""} onClick={() => void recognizePrices()}>{busy === "recognize_prices" ? "AI 识别中…" : "AI 一键识别待确认价格（最多100条）"}</button>{priceRecognitionBlocker && <span>{priceRecognitionBlocker}</span>}</div></article>}
    {mode === "database" && <><article className="panel settings-master-overview">
      <div className="settings-master-cards"><div><strong>{count(data.masterData.pagination.total)}</strong><span>主数据</span></div><div><strong>{count(data.pendingPrices.pagination.total)}</strong><span>待确认价格</span></div><div><strong>{count(data.imageCache.cached)} / {count(data.imageCache.total)}</strong><span>图片缓存</span></div><div><strong>{count(data.downloadTasks.length)}</strong><span>下载任务</span></div></div>
    </article>
    <article className="panel"><div className="section-header"><div><h3>待确认价格</h3><p>本表沿用上方三级类目多选，并可叠加候选价来源多选；AI 识别目标仍保持单类目，避免写入任务范围含糊。</p></div><div className="market-master-toolbar"><select aria-label="AI 价格识别目标类目" value={priceCategory} onChange={(event) => setPriceCategory(event.target.value)}><option value="">AI 识别目标类目</option>{data.priceRecognition.prompts.map((item) => <option key={item.category} value={item.category}>{item.category}（可识别 {count(Number(item.pending_count))}）</option>)}</select><SearchMultiFilter label="待确认价来源" values={pendingPriceSources} options={[{ value: "ai", label: "AI 识别价", count: 0 }, { value: "non_ai", label: "非 AI 识别价", count: 0 }]} onChange={(values) => { setPendingPriceSources(values); setPendingPricePage(1); }} /><select aria-label="每页条数" value={pendingPricePageSize} onChange={(event) => { setPendingPricePageSize(Number(event.target.value)); setPendingPricePage(1); }}><option value={20}>每页 20 条</option><option value={50}>每页 50 条</option><option value={100}>每页 100 条</option></select><select value={visionModelId} onChange={(event) => setVisionModelId(event.target.value)} disabled={!visionModels.length}><option value="">{visionModels.length ? "选择视觉模型" : "暂无已启用视觉模型"}</option>{visionModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelName}</option>)}</select><button className="primary-button" disabled={Boolean(priceRecognitionBlocker) || !visionModelId || busy !== ""} onClick={() => void recognizePrices()}>{busy === "recognize_prices" ? "AI 识别中…" : "AI 一键识别价格（最多100条）"}</button></div></div>{priceRecognitionBlocker && <p className="market-price-blocker">{priceRecognitionBlocker}</p>}<div className="data-table-wrap"><table className="data-table market-price-review-table"><thead><tr><th>主图</th><th>SKU / 商品链接</th><th>榜单口径</th><th>月份</th><th>候选价</th><th>来源 / AI 依据</th><th>操作</th></tr></thead><tbody>{data.pendingPrices.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <tr key={`pending-price-${row.id}`}><td>{href && row.displayImageUrl ? <a href={href} target="_blank" rel="noreferrer"><img className="market-review-image" src={String(row.displayImageUrl)} alt={String(row.productName ?? row.skuCode)} loading="lazy" /></a> : row.displayImageUrl ? <img className="market-review-image" src={String(row.displayImageUrl)} alt="" loading="lazy" /> : <span className="annotation-no-image">无图</span>}</td><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></a> : <><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></>}<code>{String(row.imageContentSha256 ?? "").slice(0, 16)}</code></td><td>{String(row.scope || row.operationMode || "-")}</td><td>{String(row.month)}</td><td>{money(Number(row.candidatePriceCents ?? 0) || null)}</td><td><strong>{priceSourceLabel(row.candidatePriceSource)}</strong>{row.candidatePriceSource === "ai_suggestion" && <small>{String(row.aiPriceType || "待判断")} · 置信度 {percent(row.aiConfidenceBps === null ? null : Number(row.aiConfidenceBps))}<br />{String(row.aiReason || "未返回识别依据")}</small>}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => confirmPrice(row)}>修改 / 确认价格</button></td></tr>; })}{!data.pendingPrices.items.length && <tr><td colSpan={7}><div className="table-state">当前筛选范围没有待确认价格。</div></td></tr>}</tbody></table></div><div className="market-pagination"><button disabled={pendingPricePage <= 1} onClick={() => setPendingPricePage((current) => Math.max(1, current - 1))}>上一页</button><label>第 <select aria-label="待确认价格页码" value={pendingPricePage} onChange={(event) => setPendingPricePage(Number(event.target.value))}>{Array.from({ length: data.pendingPrices.pagination.pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> / {data.pendingPrices.pagination.pageCount} 页</label><span>共 {count(data.pendingPrices.pagination.total)} 条</span><button disabled={pendingPricePage >= data.pendingPrices.pagination.pageCount} onClick={() => setPendingPricePage((current) => Math.min(data.pendingPrices.pagination.pageCount, current + 1))}>下一页</button></div></article>
    <article className="panel"><div className="section-header"><div><h3>TOP SKU/SPU 数据库</h3><p>卡片完整呈现商品主图、标题、价格与标签，也可切换为带图片和商品链接的表格。</p></div><div className="market-view-switch"><button className={databaseView === "cards" ? "active" : ""} onClick={() => setDatabaseView("cards")}>卡片</button><button className={databaseView === "table" ? "active" : ""} onClick={() => setDatabaseView("table")}>表格</button></div></div>{databaseView === "cards" ? <div className="market-master-product-grid">{data.masterData.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <article key={String(row.id)}><a className="market-master-product-image" href={href || undefined} target={href ? "_blank" : undefined} rel={href ? "noreferrer" : undefined}>{row.displayImageUrl ? <img src={String(row.displayImageUrl)} alt={String(row.productName ?? row.skuCode)} loading="lazy" /> : <span>暂无主图</span>}</a><div className="market-master-product-body">{href ? <a href={href} target="_blank" rel="noreferrer"><h4>{String(row.productName || row.skuCode)}</h4></a> : <h4>{String(row.productName || row.skuCode)}</h4>}<strong className="market-master-price">{money(row.officialMarketPriceCents === null ? Number(row.candidatePriceCents ?? 0) || null : Number(row.officialMarketPriceCents))}</strong><div className="market-master-tags"><span>{String(row.category)}</span><span>{String(row.operationMode)}</span><span>{String(row.rankingDimension)}</span><span>{String(row.brand || "待识别品牌")}</span><span>{String(row.priceBand || "待确认价格")}</span></div><small>#{String(row.rank ?? "-")} · {String(row.skuCode)} · {String(row.scope)}</small><footer><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => modifyProductBrand(row)}>编辑 SKU 数据</button>{href && <a href={href} target="_blank" rel="noreferrer">商品链接</a>}</footer></div></article>; })}</div> : <div className="data-table-wrap"><table className="data-table market-master-database-table"><thead><tr><th>主图</th><th>商品 / 链接</th><th>维度</th><th>POP/自营</th><th>品牌</th><th>细分类目</th><th>确认价</th><th>价格带</th><th>操作</th></tr></thead><tbody>{data.masterData.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <tr key={String(row.id)}><td className="market-master-table-image">{row.displayImageUrl ? (href ? <a href={href} target="_blank" rel="noreferrer"><img src={String(row.displayImageUrl)} alt={String(row.productName ?? row.skuCode)} loading="lazy" /></a> : <img src={String(row.displayImageUrl)} alt={String(row.productName ?? row.skuCode)} loading="lazy" />) : <span className="annotation-no-image">无图</span>}</td><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></a> : <><strong>{String(row.skuCode)}</strong><small>{String(row.productName ?? "")}</small></>}{href && <a className="market-master-table-link" href={href} target="_blank" rel="noreferrer">打开商品链接 ↗</a>}</td><td>{String(row.rankingDimension)}</td><td>{String(row.operationMode)}</td><td>{String(row.brand || "待识别")}</td><td>{String(row.subcategory ?? "")}</td><td>{money(row.officialMarketPriceCents === null ? null : Number(row.officialMarketPriceCents))}</td><td>{String(row.priceBand ?? "")}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => modifyProductBrand(row)}>编辑 SKU 数据</button></td></tr>; })}</tbody></table></div>}<div className="market-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {page} / {data.masterData.pagination.pageCount} 页</span><button disabled={page >= data.masterData.pagination.pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button></div></article></>}
    {mode === "brand" && <><article className="panel market-ai-capacity"><div className="section-header"><div><h2>运营管理系统 AI 算力</h2><p>这里直接读取“AI 助理配置”中已启用的模型，不再维护独立密钥或重复配置。</p></div><select value={brandModelId} onChange={(event) => setBrandModelId(event.target.value)} disabled={!textModels.length}>{textModels.length ? textModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelName}{item.isDefaultTextModel ? "（默认）" : ""}</option>) : <option value="">暂无已启用文本模型</option>}</select></div><div className="market-ai-model-grid">{enabledModels.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.modelType} · {item.modelName}</span><small>{item.isDefaultTextModel ? "默认文本算力" : "已接入系统算力"}</small></div>)}{!enabledModels.length && <p>尚未配置可用模型，请先到 AI 助理配置中新增并测试模型。</p>}</div></article>
    <article className="panel"><div className="section-header"><div><h3>品牌种子词典</h3><p>从 ERP、库存、店铺商品和已确认市场品牌刷新系统品牌；B店/京东自营仅匹配标题前缀，C店/POP可匹配标题任意位置。</p></div><div className="annotation-actions"><button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void upsertBrandSeed()}>新增品牌种子</button><button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void refreshBrandSeeds()}>{busy === "refresh_brand_seeds" ? "刷新中…" : "刷新系统品牌"}</button><button className="primary-button" disabled={!isAdmin || busy !== "" || !data.brandSeeds.dictionary.counts.enabled} onClick={() => void matchSystemBrandSeeds()}>{busy === "match_brand_seeds" ? "匹配中…" : "按种子匹配未知 SKU"}</button></div></div><div className="settings-master-cards"><div><strong>{count(data.brandSeeds.dictionary.counts.enabled)}</strong><span>启用种子</span></div><div><strong>{count(data.brandSeeds.dictionary.counts.system)}</strong><span>系统品牌</span></div><div><strong>{count(data.brandSeeds.dictionary.counts.manual)}</strong><span>人工补录</span></div><div><strong>{count(data.brandSeeds.unknown.pagination.total)}</strong><span>未知品牌 SKU</span></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>标准品牌</th><th>种子词</th><th>来源</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{data.brandSeeds.dictionary.items.map((row) => <tr key={String(row.id)}><td><strong>{String(row.canonical_brand)}</strong></td><td>{String(row.seed_text)}</td><td>{row.source === "manual" ? "人工补录" : "系统刷新"}<small>{String(row.source_ref || "")}</small></td><td>{row.status === "enabled" ? "启用" : "停用"}</td><td>{String(row.updated_at || "-")}</td></tr>)}{!data.brandSeeds.dictionary.items.length && <tr><td colSpan={5}><div className="table-state">词典为空，请先刷新系统品牌或新增种子。</div></td></tr>}</tbody></table></div></article>
    <article className="panel"><div className="section-header"><div><h3>未知品牌 SKU 清单</h3><p>这里只列出当前仍未匹配的去重 SKU；补录种子时会立即补齐当前 SKU，之后导入也会自动复用。</p></div><strong>{count(data.brandSeeds.unknown.pagination.total)} 个待处理</strong></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>SKU / 商品标题</th><th>店铺</th><th>匹配规则</th><th>类目</th><th>操作</th></tr></thead><tbody>{data.brandSeeds.unknown.items.map((row) => { const href = marketProductHref(row.productUrl, row.skuCode); return <tr key={`${row.category}-${row.scope}-${row.rankingDimension}-${row.skuCode}`}><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.skuCode)}</strong><small>{String(row.productName)}</small></a> : <><strong>{String(row.skuCode)}</strong><small>{String(row.productName)}</small></>}</td><td>{String(row.storeName || "-")}<small>{String(row.storeType || row.scope || "-")}</small></td><td>{row.matchPolicy === "title_prefix" ? "B店 / 自营：标题前缀" : "C店 / POP：任意位置"}</td><td>{String(row.category)}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => void upsertBrandSeed(row)}>补录品牌种子</button></td></tr>})}{!data.brandSeeds.unknown.items.length && <tr><td colSpan={5}><div className="table-state">当前筛选范围没有未知品牌 SKU。</div></td></tr>}</tbody></table></div><div className="market-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {page} / {data.brandSeeds.unknown.pagination.pageCount} 页</span><button disabled={page >= data.brandSeeds.unknown.pagination.pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button></div></article>
    <article className="panel"><div className="section-header market-brand-batch-header"><div><h3>品牌识别与人工确认</h3><p>“所有页”按当前搜索和类目筛选处理去重商品；任务可暂停、恢复，刷新或关闭页面不会丢失已完成批次。</p></div><div className="market-master-toolbar"><select value={category} disabled={busy === "recognize_brand_all"} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">全部类目</option>{data.categories.map((item) => <option key={item.value} value={item.value}>{item.value}（{count(item.count)}）</option>)}</select><input value={query} disabled={busy === "recognize_brand_all"} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、标题或品牌" />{busy === "recognize_brand_all" ? <button className="secondary-button" disabled={!isAdmin} onClick={() => void pauseBrandRecognition()}>暂停识别</button> : <button className="primary-button" disabled={!isAdmin || !brandModelId || busy !== ""} onClick={() => void recognizeAllBrands()}>{brandJob && ["queued", "running", "paused", "failed"].includes(brandJob.status) ? "继续识别" : "AI 一键识别品牌（所有页）"}</button>}<button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void confirmAllBrandSuggestions()}>{busy === "confirm_brand_all" ? "批量确认中…" : "一键确认全部候选"}</button></div></div>{brandJob && <div className="market-brand-job-progress"><header><div><strong>{brandJob.status === "completed" ? "识别完成" : brandJob.status === "paused" ? "已暂停" : brandJob.status === "failed" ? "可重试" : "识别任务进行中"}</strong><small>任务 {brandJob.id.slice(-8)} · 每批 {brandJob.batchSize} 个</small></div><b>{percent(brandJob.progressBps)}</b></header><span><i style={{ width: `${Math.min(100, brandJob.progressBps / 100)}%` }} /></span><div><label><strong>{count(brandJob.processedCount)}</strong><small>已处理</small></label><label><strong>{count(brandJob.remainingCount)}</strong><small>剩余</small></label><label><strong>{count(brandJob.recognizedCount)}</strong><small>识别出品牌</small></label><label><strong>{brandJobEta(brandJob)}</strong><small>预计剩余</small></label></div>{brandJob.lastError && <p>{brandJob.lastError}</p>}</div>}<div className="data-table-wrap"><table className="data-table market-brand-review-table"><thead><tr><th>主图</th><th>商品标题 / 类目</th><th>当前品牌</th><th>AI / 人工品牌</th><th>操作</th></tr></thead><tbody>{data.masterData.items.map((row) => { const key = brandRowKey(row); const href = marketProductHref(row.productUrl, row.skuCode); const suggested = String(row.suggestedBrand || "") || String(row.brand || ""); return <tr key={`${key}-${row.id}`}><td>{row.displayImageUrl ? <img className="market-review-image" src={String(row.displayImageUrl)} alt="" loading="lazy" /> : <span className="annotation-no-image">无图</span>}</td><td>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{String(row.productName || row.skuCode)}</strong></a> : <strong>{String(row.productName || row.skuCode)}</strong>}<small>{String(row.skuCode)} · 类目：{String(row.category)} · {String(row.scope)}</small></td><td>{String(row.brand || "待识别")}</td><td><input value={brandDrafts[key] ?? suggested} onChange={(event) => setBrandDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder="识别不了可留空" />{row.brandSuggestionStatus === "ai_pending" && <small className="market-ai-suggestion">AI 候选，待确认</small>}</td><td><div className="annotation-actions"><button className="row-action" disabled={!isAdmin || !brandModelId || busy !== ""} onClick={() => void inferBrand(row)}>{busy === `infer_brand:${key}` ? "识别中…" : "重新识别"}</button><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => confirmBrand(row)}>修改 / 确认</button></div></td></tr>; })}</tbody></table></div><div className="market-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {page} / {data.masterData.pagination.pageCount} 页</span><button disabled={page >= data.masterData.pagination.pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button></div></article></>}
    {mode === "mapping" && <article className="panel"><div className="section-header"><div><h3>映射与价格带</h3><p>细分类目、品牌别名、单品品牌确认、POP/自营映射和价格带配置均持久化并审计。</p></div><div className="annotation-actions"><button className="secondary-button" disabled={!isAdmin} onClick={() => createMapping("subcategory")}>新增细分类目映射</button><button className="secondary-button" disabled={!isAdmin} onClick={() => createMapping("brand_alias")}>新增品牌别名</button><button className="secondary-button" disabled={!isAdmin} onClick={() => createMapping("operation_mode")}>新增经营模式规则</button><button className="secondary-button" disabled={!isAdmin || busy !== ""} onClick={() => void post({ action: "apply_mappings" })}>重算并应用映射</button><button className="secondary-button" disabled={!isAdmin} onClick={createPriceBandDraft}>新建价格带版本</button></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>类型</th><th>来源</th><th>目标</th><th>状态</th><th>版本</th><th>操作</th></tr></thead><tbody>{data.mappings.items.map((row) => <tr key={String(row.id)}><td>{String(row.kind)}</td><td>{String(row.source_value)}</td><td>{String(row.target_value)}</td><td>{String(row.status)}</td><td>{String(row.version)}</td><td><button className="row-action" disabled={!isAdmin || busy !== ""} onClick={() => editMapping(row)}>编辑</button></td></tr>)}</tbody></table></div>
      <div className="market-brand-list">{data.priceBands.items.map((row) => <article key={String(row.id)}><label><strong>{String(row.category)} v{String(row.version)}</strong><span>{String(row.status)}</span></label><small>{String(row.effective_from)} · {String(row.note ?? "")}</small><div className="annotation-actions"><button className="row-action" disabled={!isAdmin || busy !== "" || row.status === "published"} onClick={() => void post({ action: "publish_price_band_version", id: row.id })}>发布</button><button className="row-action" disabled={!isAdmin || busy !== "" || row.status !== "archived"} onClick={() => void post({ action: "rollback_price_band_version", targetVersionId: row.id })}>回滚到此版本</button></div></article>)}</div>
    </article>}
    {mode === "data" && <><article className="panel"><div className="section-header"><div><h3>自动下载与导入工作流</h3><p>计算缺失范围、创建或复用下载任务，登录态未验证时保持 waiting_login。</p></div><div className="annotation-actions"><button className="secondary-button" disabled={!isAdmin} onClick={createDownloadConfig}>新增下载配置</button><button className="primary-button" disabled={!isAdmin || busy !== ""} onClick={() => void post({ action: "plan_downloads" })}>计算缺失任务</button></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>类目/口径/月/维度</th><th>状态</th><th>次数</th><th>文件</th><th>错误</th><th>执行</th></tr></thead><tbody>{data.downloadTasks.map((row) => <tr key={String(row.id)}><td>{String(row.category)} · {String(row.scope)} · {String(row.month)} · {String(row.ranking_dimension)}</td><td>{String(row.status)}</td><td>{String(row.attempt_count)}</td><td>{String(row.source_file_name ?? "")}</td><td>{String(row.error_message ?? "")}</td><td><div className="annotation-actions"><label className="row-action">上传并校验导入<input type="file" accept=".xls,.xlsx,.csv" hidden disabled={!isAdmin || busy !== "" || row.status === "imported" || row.status === "published"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDownloadedTask(row, file); event.currentTarget.value = ""; }} /></label><button className="row-action" disabled={!isAdmin || busy !== "" || row.status === "imported" || row.status === "published"} onClick={() => void post({ action: "record_download_attempt", taskId: row.id, status: "waiting_login", errorCode: "waiting_login", errorMessage: "等待京东登录验证" })}>等待登录</button></div></td></tr>)}</tbody></table></div>
    </article>
    <article className="panel"><div className="section-header"><div><h3>数据覆盖、图片缓存与审计</h3><p>覆盖检查和完整审计记录来自市场主数据审计表。</p></div></div><div className="settings-master-cards">{data.coverage.slice(0, 8).map((row) => <div key={`${row.category}-${row.scope}-${row.ranking_dimension}`}><strong>{String(row.month_min ?? "-")}~{String(row.month_max ?? "-")}</strong><span>{String(row.category)} · {String(row.scope)} · {String(row.ranking_dimension)} · SKU {String(row.sku_count)}</span></div>)}</div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>人员</th><th>动作</th><th>对象</th></tr></thead><tbody>{data.audits.map((row) => <tr key={String(row.id)}><td>{String(row.created_at)}</td><td>{String(row.actor_email)}</td><td>{String(row.action)}</td><td>{String(row.entity_type)} · {String(row.entity_id)}</td></tr>)}</tbody></table></div></article>
    </>}
    {mode === "subcategory" && <article className="panel market-subcategory-settings"><div className="section-header"><div><h2>细分品类设置</h2><p>按三级类目维护统一细分品类。保存后会同步刷新榜单、SKU 入库标注和待复核候选，并发布映射供后续导入复用。</p></div><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">请选择三级类目</option>{data.subcategorySettings.categories.map((item) => <option key={item.value} value={item.value}>{item.value}（{count(item.count)}）</option>)}</select></div>{category ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>当前细分品类</th><th>关联 SKU</th><th>已入库标注</th><th>修改为</th></tr></thead><tbody>{data.subcategorySettings.items.map((item) => <tr key={item.subcategory}><td><strong>{item.subcategory}</strong></td><td>{count(Number(item.sku_count))}</td><td>{count(Number(item.annotation_count))}</td><td><input value={subcategoryDrafts[item.subcategory] ?? item.subcategory} onChange={(event) => setSubcategoryDrafts((current) => ({ ...current, [item.subcategory]: event.target.value }))} /></td></tr>)}{!data.subcategorySettings.items.length && <tr><td colSpan={4}><div className="table-state">该三级类目尚无细分品类，可直接新增。</div></td></tr>}</tbody></table></div><label className="market-subcategory-add"><span>新增细分品类（每行一个）</span><textarea value={newSubcategory} onChange={(event) => setNewSubcategory(event.target.value)} placeholder="例如：台式净饮机&#10;商用直饮机" /></label><div className="annotation-actions"><button className="primary-button" disabled={!isAdmin || busy !== ""} onClick={() => void saveSubcategories()}>{busy === "save_subcategory_settings" ? "刷新关联数据中…" : "保存并刷新全部关联数据"}</button></div></> : <div className="table-state">请先选择三级类目。</div>}</article>}
    {editingSku && <div className="market-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingSku(null); }}><section className="panel market-sku-editor" role="dialog" aria-modal="true" aria-label="编辑 SKU 全部数据"><div className="section-header"><div><h2>编辑 SKU 全部数据</h2><p>{String(editingSku.skuCode)} · {String(editingSku.scope)} · {String(editingSku.month)}</p></div><button className="row-action" onClick={() => setEditingSku(null)}>关闭</button></div><div className="market-sku-editor-grid"><label><span>三级类目</span><input value={skuDraft.category} onChange={(event) => setSkuDraft((current) => ({ ...current, category: event.target.value }))} /></label><label><span>细分品类</span><select value={skuDraft.subcategory} onChange={(event) => setSkuDraft((current) => ({ ...current, subcategory: event.target.value }))}><option value="">未分类</option>{data.subcategories.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></label><label className="wide"><span>商品标题</span><input value={skuDraft.productName} onChange={(event) => setSkuDraft((current) => ({ ...current, productName: event.target.value }))} /></label><label><span>品牌</span><input value={skuDraft.brand} onChange={(event) => setSkuDraft((current) => ({ ...current, brand: event.target.value }))} /></label><label><span>经营模式</span><select value={skuDraft.operationMode} onChange={(event) => setSkuDraft((current) => ({ ...current, operationMode: event.target.value }))}><option value="POP">POP</option><option value="自营">自营</option><option value="未知">未知</option></select></label><label><span>市场定位价（元）</span><input type="number" min={0} step="0.01" value={skuDraft.priceYuan} onChange={(event) => setSkuDraft((current) => ({ ...current, priceYuan: event.target.value }))} /></label><label><span>价格类型</span><select value={skuDraft.priceType} onChange={(event) => setSkuDraft((current) => ({ ...current, priceType: event.target.value }))}>{["标准售价", "到手价", "券后价", "起售价", "价格区间", "最低规格价格"].map((item) => <option key={item}>{item}</option>)}</select></label></div><footer><span>类目、品牌、经营模式和细分品类会同步更新该 SKU 的关联历史；价格仅更新当前月份。</span><button className="primary-button" disabled={busy !== ""} onClick={() => void saveSku()}>{busy === "update_sku_master" ? "保存中…" : "保存全部数据"}</button></footer></section></div>}
  </section>;
}

function MarketSettingsWorkspace({ currentUser, data, onImported }: { currentUser: CurrentUser; data: MarketOverview; onImported: () => void }) {
  const [tab, setTab] = useState<MarketSettingsTab>("database");
  const [databaseArea, setDatabaseArea] = useState<"master" | "annotation">("master");
  const [systemKpis, setSystemKpis] = useState<MarketSystemKpis | null>(null);
  const [systemKpisError, setSystemKpisError] = useState("");
  const [cacheStats, setCacheStats] = useState(data.imageCache);
  const [cacheRunning, setCacheRunning] = useState(false);
  const [cacheNotice, setCacheNotice] = useState("");
  const [cacheError, setCacheError] = useState("");
  const stopImageCacheRef = useRef(false);
  const isAdmin = currentUser?.role === "admin";
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/market/master?view=system_kpis", { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as (MarketSystemKpis & { error?: string }) | null;
        if (!response.ok || !payload) throw new Error(payload?.error || "全库统计读取失败");
        setSystemKpis(payload);
        setSystemKpisError("");
      } catch (reason) {
        if (controller.signal.aborted) return;
        setSystemKpisError(reason instanceof Error ? reason.message : "全库统计读取失败");
      }
    })();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!cacheRunning) setCacheStats(data.imageCache);
  }, [cacheRunning, data.imageCache]);
  useEffect(() => () => { stopImageCacheRef.current = true; }, []);
  const refreshImageCache = async () => {
    if (!isAdmin || cacheRunning || cacheStats.pending <= 0) return;
    stopImageCacheRef.current = false;
    setCacheRunning(true);
    setCacheError("");
    let latest = cacheStats;
    let batches = 0;
    let cachedThisSession = 0;
    let failedThisSession = 0;
    try {
      while (!stopImageCacheRef.current && latest.pending > 0) {
        setCacheNotice(`正在缓存第 ${batches + 1} 批：已成功 ${count(cachedThisSession)} 张，剩余 ${count(latest.pending)} 张`);
        const response = await fetch("/api/market/images/cache", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 24 }),
        });
        const payload = await response.json().catch(() => null) as {
          error?: string;
          result?: MarketOverview["imageCache"] & { processed: number; cachedThisRun: number; failedThisRun: number };
        } | null;
        if (!response.ok || !payload?.result) throw new Error(payload?.error || "图片缓存接口无响应");
        latest = payload.result;
        batches += 1;
        cachedThisSession += payload.result.cachedThisRun;
        failedThisSession += payload.result.failedThisRun;
        setCacheStats(latest);
        if (payload.result.processed === 0) break;
      }
      if (stopImageCacheRef.current) {
        setCacheNotice(`已停止：本次完成 ${count(batches)} 批，成功 ${count(cachedThisSession)} 张，剩余 ${count(latest.pending)} 张`);
      } else if (latest.pending === 0) {
        setCacheNotice(`图片缓存完成：本次成功 ${count(cachedThisSession)} 张，失败尝试 ${count(failedThisSession)} 张`);
      } else {
        setCacheNotice(`当前没有可领取的缓存批次，可能已有任务正在处理；剩余 ${count(latest.pending)} 张`);
      }
    } catch (reason) {
      setCacheError(reason instanceof Error ? reason.message : "图片缓存刷新失败");
    } finally {
      setCacheRunning(false);
      onImported();
    }
  };
  const cachePercent = cacheStats.total > 0 ? Math.min(100, Math.round(cacheStats.cached / cacheStats.total * 100)) : 0;
  const systemKpiCards = [
    { key: "marketIdentityTotal", label: "市场商品身份", note: "类目、范围、SKU/SPU 维度与编码全库去重" },
    { key: "pendingPriceCount", label: "待确认价格", note: "仍有未确认月度价格的商品身份" },
    { key: "pendingAiCount", label: "待 AI 标注总量", note: "尚无 AI 结果；下列四种路径互斥合计" },
    { key: "completedAiCount", label: "已生成 AI 结果", note: "已有模型输出，含待人工复核" },
    { key: "sameImageReuseCount", label: "同图直接复用", note: "已有同图标准价，不调用 AI" },
    { key: "priceOnlyRecognitionCount", label: "新图仅识别价格", note: "同 SKUID 有有效历史分类" },
    { key: "fullRecognitionCount", label: "完整分类和价格", note: "新 SKUID 或没有有效历史分类" },
    { key: "blockedRecognitionCount", label: "暂不可自动识别", note: "无图、非 SKU、Prompt 不可用或失败封顶" },
  ] as const;
  const tabs: Array<{ key: MarketSettingsTab; label: string; note: string }> = [
    { key: "database", label: "SKU 数据库", note: "主数据、价格与 AI 入库" },
    { key: "subcategory", label: "细分品类设置", note: "按三级类目统一维护" },
    { key: "brand", label: "品牌确认", note: "标题识别与人工修订" },
    { key: "mapping", label: "映射配置", note: "别名、品类与价格带" },
    { key: "data", label: "数据配置", note: "导入、下载与审计" },
  ];
  return <section className="market-settings-workspace">
    <article className="panel market-settings-intro"><div><span className="eyebrow">MARKET OPERATIONS & AI</span><h2>系统和 AI 设置</h2><p>以下指标按市场数据全库独立统计，不受商品榜单的日期、类目、范围或维度筛选影响；“待 AI 标注总量”按最高算力需求归入下方四种互斥路径，四项合计与总量一致。</p></div><div>{systemKpiCards.map((item) => <span className="market-system-kpi" key={item.key} title={systemKpisError}><strong>{systemKpis ? count(systemKpis[item.key]) : "—"}</strong><em>{item.label}</em><small>{systemKpisError ? "全库统计读取失败" : item.note}</small></span>)}<div className="market-image-cache-card"><strong>{count(cacheStats.pending)}</strong><em>待缓存图片</em><div className="market-image-cache-progress" role="progressbar" aria-label="图片缓存进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={cachePercent}><b style={{ width: `${cachePercent}%` }} /></div><small className={cacheError ? "error" : ""}>{cacheError || cacheNotice || `已缓存 ${count(cacheStats.cached)} / ${count(cacheStats.total)}，失败 ${count(cacheStats.failed)}`}</small><div className="market-image-cache-actions"><button type="button" className="primary-button" disabled={!isAdmin || cacheRunning || cacheStats.pending <= 0} onClick={() => void refreshImageCache()}>{cacheRunning ? "正在分批缓存…" : cacheStats.pending > 0 ? "一键刷新图片缓存" : "图片缓存已完成"}</button>{cacheRunning && <button type="button" className="secondary-button" onClick={() => { stopImageCacheRef.current = true; setCacheNotice("正在停止，当前批次完成后停止…"); }}>停止</button>}</div></div></div></article>
    <nav className="panel market-settings-tabs" aria-label="市场系统和 AI 设置子板块">{tabs.map((item) => <button type="button" key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><strong>{item.label}</strong><small>{item.note}</small></button>)}</nav>
    {tab === "database" && <nav className="panel market-database-areas"><button className={databaseArea === "master" ? "active" : ""} onClick={() => setDatabaseArea("master")}><strong>主数据与价格</strong><small>统一筛选、查看和编辑 SKU/SPU</small></button><button className={databaseArea === "annotation" ? "active" : ""} onClick={() => setDatabaseArea("annotation")}><strong>AI 标注与批量入库</strong><small>筛选候选、列表/大图复核并入库</small></button></nav>}
    {tab === "database" ? (databaseArea === "annotation" ? <MarketAnnotationView currentUser={currentUser} embedded /> : <MarketMasterAdminPanel currentUser={currentUser} mode="database" />) : <MarketMasterAdminPanel currentUser={currentUser} mode={tab} />}
    {tab === "data" && <><MarketDataImportPanel currentUser={currentUser} data={data} onImported={onImported} /><MarketWorkflowPanel data={data} /></>}
  </section>;
}

export default function MarketView({ customStartDate, customEndDate, currentUser, onApplyPeriod }: { customStartDate: string; customEndDate: string; currentUser: CurrentUser; onApplyPeriod?: (startDate: string, endDate: string) => void }) {
  const [data, setData] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<string[]>(["SKU"]);
  const [operationModes, setOperationModes] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const [priceBands, setPriceBands] = useState<string[]>([]);
  const marketStartDate = customStartDate;
  const marketEndDate = customEndDate;
  const [compareSelections, setCompareSelections] = useState<MarketCompareSelection[]>([]);
  const compareKeys = useMemo(() => compareSelections.map(marketCompareSelectionKey), [compareSelections]);
  const [trendItem, setTrendItem] = useState<MarketItem | null>(null);
  const [activeSection, setActiveSection] = useState<MarketSectionKey>("ranking");
  const [reloadKey, setReloadKey] = useState(0);
  const loadRequestId = useRef(0);
  const initialLoad = useRef(true);
  const requestedView = activeSection === "overview" ? "full" : "ranking";
  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestId.current;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      params.set("view", requestedView);
      if (query.trim()) params.set("q", query.trim());
      categories.forEach((value) => params.append("category", value));
      scopes.forEach((value) => params.append("scope", value));
      dimensions.forEach((value) => params.append("dimension", value));
      operationModes.forEach((value) => params.append("operationMode", value));
      brands.forEach((value) => params.append("brand", value));
      subcategories.forEach((value) => params.append("subcategory", value));
      priceBands.forEach((value) => params.append("priceBand", value));
      if (marketStartDate) params.set("startDate", marketStartDate);
      if (marketEndDate) params.set("endDate", marketEndDate);
      const response = await fetch(`/api/market/overview?${params}`, { cache: "no-store", signal });
      const payload = await response.json().catch(() => null) as MarketOverview | null;
      if (!response.ok) throw new Error(payload?.error || "市场分析数据读取失败");
      if (!payload) throw new Error("市场分析返回为空");
      if (signal?.aborted || requestId !== loadRequestId.current) return;
      setData(payload);
    } catch (reason) {
      if (signal?.aborted || requestId !== loadRequestId.current) return;
      setError(reason instanceof Error ? reason.message : "市场分析数据读取失败");
    } finally {
      if (!signal?.aborted && requestId === loadRequestId.current) setLoading(false);
    }
  }, [query, categories, scopes, dimensions, operationModes, brands, subcategories, priceBands, marketStartDate, marketEndDate, requestedView]);
  useEffect(() => {
    const controller = new AbortController();
    const delay = initialLoad.current ? 0 : 350;
    initialLoad.current = false;
    const timer = window.setTimeout(() => void load(controller.signal), delay);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, reloadKey]);
  const toggleCompare = (item: MarketItem) => setCompareSelections((current) => current.some((selection) => marketCompareSelectionKey(selection) === marketCompareSelectionKey(item))
    ? current.filter((selection) => marketCompareSelectionKey(selection) !== marketCompareSelectionKey(item))
    : current.length >= 5 ? current : [...current, {
      skuCode: item.skuCode,
      productName: item.productName,
      category: item.category,
      scope: item.scope,
      rankingDimension: item.rankingDimension,
    }]);
  const removeCompare = (selectionKey: string) => setCompareSelections((current) => current.filter((item) => marketCompareSelectionKey(item) !== selectionKey));
  const applyCommercialDirectDrinkingProfile = () => {
    if (!data) return;
    const profile = data.industryReport.definition.profile;
    const preferredScope = data.filters.scopes.find((item) => item.value === "整体SKU")
      ?? data.filters.scopes.find((item) => item.value.includes("整体") && item.value.toUpperCase().includes("SKU"))
      ?? data.filters.scopes.find((item) => item.value === "全部SKU")
      ?? data.filters.scopes[0];
    setQuery("");
    setCategories([profile.category]);
    setScopes([preferredScope?.value ?? "整体SKU"]);
    setDimensions(["SKU"]);
    setOperationModes([]);
    setBrands([]);
    setSubcategories([...profile.coreSubcategories]);
    setPriceBands([]);
    const reportPeriod = twelveMonthReportPeriod();
    onApplyPeriod?.(reportPeriod.startDate, reportPeriod.endDate);
    setActiveSection("overview");
  };
  const operationOptions = useMemo(() => [{ value: "POP", count: 0 }, { value: "自营", count: 0 }, { value: "未知", count: 0 }, ...(data?.filters.operationModes ?? [])].filter((item, index, array) => array.findIndex((next) => next.value === item.value) === index), [data]);
  if (loading && !data) return <section className="panel data-state"><span className="state-spinner" /><strong>正在连接市场分析数据</strong><p>正在读取榜单、价格快照、图片缓存和 AI 标注结果…</p></section>;
  if (error && !data) return <section className="panel data-state"><span className="state-symbol">!</span><strong>市场分析暂时不可用</strong><p>{error}</p><button className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>重新加载</button></section>;
  if (!data) return null;
  const reportDimensionLabel = marketReportDimensionLabel(data);
  const sectionCopy: Record<Exclude<MarketSectionKey, "settings">, { eyebrow: string; title: string; note: string }> = {
    ranking: { eyebrow: "PRODUCT RANKING", title: "商品榜单工作台", note: "查看 TOP 商品表现、成交均价、主图价格、排名变化和单品趋势。" },
    overview: { eyebrow: "INDUSTRY REPORT", title: "行业汇报", note: "按当前 TOP 榜单覆盖口径回答市场趋势、增长结构、竞争胜负和进入机会。" },
    compare: { eyebrow: "COMPETITOR BENCHMARK", title: "竞品对比", note: "使用统一筛选口径挑选 2–5 个 SKU，进行核心指标和月度趋势对照。" },
  };
  const activeCopy = activeSection === "settings" ? null : sectionCopy[activeSection];
  return <div className="market-module">
    <MarketSectionNav active={activeSection} compareCount={compareSelections.length} onChange={setActiveSection} />
    {activeCopy && <section className="panel market-filter-bar market-filter-bar-v2">
      <div><span className="eyebrow">{activeCopy.eyebrow}</span><h2>{activeCopy.title}</h2><p>{activeCopy.note}</p>{activeSection === "overview" && <button type="button" className="secondary-button market-report-preset" onClick={applyCommercialDirectDrinkingProfile}>应用商用直饮机核心口径 · 近12月</button>}</div>
      <div className="market-filter-controls market-filter-controls-v2">
        <div className="market-overview-period market-global-period"><span>全局统计周期</span><strong>{marketStartDate} 至 {marketEndDate}</strong></div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品标题或 SKU" aria-label="搜索商品标题或 SKU" />
        <SearchMultiFilter label="类目" values={categories} options={data.filters.categories} onChange={setCategories} />
        <SearchMultiFilter label="榜单范围" values={scopes} options={data.filters.scopes} onChange={setScopes} />
        <SearchMultiFilter label="榜单维度" values={dimensions} options={data.filters.rankingDimensions.length ? data.filters.rankingDimensions : [{ value: "SKU", count: 0 }, { value: "SPU", count: 0 }]} onChange={setDimensions} />
        <SearchMultiFilter label="经营模式" values={operationModes} options={operationOptions} onChange={setOperationModes} />
        <SearchMultiFilter label="品牌" values={brands} options={data.filters.brands} onChange={setBrands} />
        <SearchMultiFilter label="细分类目" values={subcategories} options={data.filters.subcategories} onChange={setSubcategories} />
        <SearchMultiFilter label="价格带" values={priceBands} options={data.filters.priceBands} onChange={setPriceBands} />
      </div>
      <footer><span className="status status-success">当前 TOP 榜单覆盖口径</span><strong>截止 {data.dataRange.endDate ?? "暂无日期"} · 覆盖 {monthText(data.dataRange.startDate, data.dataRange.endDate)}</strong><small>有效 {reportDimensionLabel} {count(data.summary.activeSkuCount)} · 待确认 AI 数据 {count(data.summary.pendingAiCount)} · 图片缓存 {count(data.imageCache.cached)}/{count(data.imageCache.total)}{data.imageCache.pending ? ` · 待处理 ${count(data.imageCache.pending)}` : ""}</small></footer>
    </section>}
    {error && <div className="market-feedback error">{error}</div>}
    {activeSection === "ranking" && <RankingTable items={data.items} compareKeys={compareKeys} onToggleCompare={toggleCompare} onTrend={setTrendItem} onOpenCompare={() => setActiveSection("compare")} />}
    {activeSection === "overview" && data.view !== "full" ? <section className="panel data-state"><span className="state-spinner" /><strong>正在生成行业汇报</strong><p>商品榜单已可用，趋势、结构、竞争和机会矩阵正在按需汇总…</p></section> : activeSection === "overview" && <>
      <IndustryExecutiveSummary data={data} />
      <MarketKpis data={data} />
      <TrendSection data={data} />
      <PriceBandSection data={data} />
      <BrandSection data={data} />
      <SubcategorySection data={data} />
      <OperationModeSection data={data} />
      <TrafficQuadrantSection data={data} />
      <ProductSignalSection data={data} />
      <OpportunityMatrixSection data={data} />
      <IndustryDataGapSection data={data} />
    </>}
    {activeSection === "compare" && <CompareWorkspace selections={compareSelections} onClear={() => setCompareSelections([])} onRemoveCompare={removeCompare} onGoRanking={() => setActiveSection("ranking")} query={query} categories={categories} scopes={scopes} rankingDimensions={dimensions} operationModes={operationModes} brands={brands} subcategories={subcategories} priceBands={priceBands} startDate={marketStartDate} endDate={marketEndDate} />}
    {activeSection === "settings" && <MarketSettingsWorkspace currentUser={currentUser} data={data} onImported={() => setReloadKey((key) => key + 1)} />}
    {trendItem && <TrendDrawer item={trendItem} onClose={() => setTrendItem(null)} />}
  </div>;
}
