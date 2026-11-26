"use client";

import { useAiPageDetails } from "./ai-page-context-provider";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/http/api-client";
import { SearchableSelect } from "./ui/searchable-select";
import { validCategoryAnalysis, validCategoryDetail, validCategorySubdivisions } from "@/lib/sales/category-response";
import { StableReadContent } from "./ui/stable-read-content";
import type { ReactNode } from "react";
import Dialog from "./ui/dialog";
import type { SalesSharedFilters, SalesSharedFilterOptions } from "./sales-filter-bar";

type CategoryMetric = {
  category: string;
  grossSalesCents: number;
  refundAmountCents: number;
  netSalesCents: number;
  costAmountCents: number;
  shareRate: number;
  positiveQuantity: number;
  returnQuantity: number;
  netQuantity: number;
  refundRate: number;
  grossProfitCents: number;
  grossMarginRate: number;
  productCount: number;
  lineCount: number;
  currentWeekNetSalesCents: number;
  previousWeekNetSalesCents: number;
  yearAgoNetSalesCents: number;
  weekOverWeekRate: number | null;
  yearOverYearRate: number | null;
};

type CategoryDetailMetric = CategoryMetric & {
  trend: {
    points: Array<{ period: string; netSalesCents: number }>;
    changeRate: number | null;
    direction: "up" | "down" | "flat" | "insufficient";
  };
};

type CategoryAnalysisResponse = {
  range: { startDate: string; endDate: string; endExclusive: string; timezone: string };
  comparisonPeriods: {
    weekOverWeek: {
      current: { startDate: string; endDate: string };
      previous: { startDate: string; endDate: string };
    };
    yearAgo: { startDate: string; endDate: string };
  };
  dataCutoffDate: string | null;
  categoryHierarchy: {
    currentLevel: 1;
    levels: Array<{ level: 1; key: string; label: string }>;
    supportsDrilldown: boolean;
    source: { primary: string; fallback: string; joinKey: string; unmatchedLabel: string };
  };
  filtersApplied: { dataScope: { mode: "unrestricted" | "restricted" } };
  summary: {
    grossSalesCents: number; refundAmountCents: number; netSalesCents: number;
    positiveQuantity: number; returnQuantity: number; netQuantity: number;
    costAmountCents: number; grossProfitCents: number; grossMarginRate: number; productCount: number;
    lineCount: number; categoryCount: number;
  };
  uncategorized: { category: string; productCount: number; netSalesCents: number; shareRate: number; visible: boolean };
  structure: { items: Array<CategoryMetric & { rank: number }>; otherNetSalesCents: number; otherShareRate: number; contributionRateTotal: number };
  ranking: Array<CategoryMetric & { rank: number }>;
  trend: {
    granularity: CategoryGranularity;
    categoryLimit: number;
    returned: number;
    truncated: boolean;
    items: Array<{ period: string; category: string; netSalesCents: number; grossProfitCents: number; positiveQuantity: number; returnQuantity: number; refundAmountCents: number }>;
  };
  details: {
    items: CategoryDetailMetric[];
    pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
    sort: { by: CategorySortKey; direction: SortDirection };
    trend: { granularity: CategoryGranularity; periodLimit: number };
  };
  filterOptions: {
    categories: string[];
    channels: string[];
    platforms: string[];
    outlets: Array<{ key: string; platform: string; name: string }>;
    totals: { categories: number; channels: number; platforms: number; outlets: number };
    truncated: boolean;
    limit: number;
  };
};

type CategoryOutletMetric = {
  shop: string;
  grossSalesCents: number;
  refundAmountCents: number;
  netSalesCents: number;
  costAmountCents: number;
  shareRate: number;
  positiveQuantity: number;
  returnQuantity: number;
  netQuantity: number;
  refundRate: number;
  grossProfitCents: number;
  grossMarginRate: number;
  lineCount: number;
};

type CategoryOutletBreakdownResponse = {
  range: { startDate: string; endDate: string; endExclusive: string; timezone: string };
  category: string;
  totals: { netSalesCents: number; platformCount: number; shopCount: number };
  platforms: Array<Omit<CategoryOutletMetric, "shop"> & {
    platform: string;
    shopCount: number;
    shops: CategoryOutletMetric[];
  }>;
  pagination: { total: number; returned: number; truncated: boolean; limit: number };
};

type SubdivisionProduct = {
  productCode: string;
  productName: string;
  erpCategory: string;
  matchedBy: "manual" | "code" | "name_to_code" | "name" | "none";
  netSalesCents: number;
  netQuantity: number;
  grossMarginRate: number;
};

type SubdivisionMetric = CategoryDetailMetric & {
  subdivision: string;
  labelSource?: "static" | "custom";
  products: SubdivisionProduct[];
  productsTruncated: boolean;
};

type CategorySubdivisionsResponse = {
  range: { startDate: string; endDate: string; endExclusive: string; timezone: string };
  comparisonPeriods: CategoryAnalysisResponse["comparisonPeriods"];
  dataCutoffDate: string | null;
  mapping: {
    sources: Array<{ fileName: string; sha256: string; rowCount: number }>;
    coveredCategories: string[];
    matchOrder: string[];
    normalization: string;
    candidateRule: string;
    unclassifiedLabel: string;
    selectedMajorCategory: string;
    configVersion: string;
    majorCategories: Array<{ name: string; coveredCategories: string[]; labels: Array<{ name: string; source: "static" | "custom"; sortOrder: number }> }>;
  };
  summary: {
    grossSalesCents: number; refundAmountCents: number; netSalesCents: number;
    positiveQuantity: number; returnQuantity: number; netQuantity: number;
    costAmountCents: number; grossProfitCents: number; grossMarginRate: number; productCount: number;
    lineCount: number; subdivisionCount: number;
    shareRate: number | null; yearOverYearRate: number | null; weekOverWeekRate: number | null;
    yearAgoNetSalesCents: number; currentWeekNetSalesCents: number; previousWeekNetSalesCents: number;
  };
  coverage: Record<"manual" | "code" | "name_to_code" | "name" | "unclassified", { productCount: number; netSalesCents: number }>;
  unclassified: CategoryMetric & { subdivision: string; visible: boolean; products: SubdivisionProduct[]; productsTruncated: boolean };
  details: {
    items: SubdivisionMetric[];
    pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
    sort: { by: SubdivisionSortKey; direction: SortDirection };
    trend: { granularity: CategoryGranularity; periodLimit: number };
  };
};

const matchedByLabel: Record<SubdivisionProduct["matchedBy"], string> = {
  manual: "手动归类", code: "规格代码", name_to_code: "名称转代码", name: "名称兜底（吉客云未找到）", none: "未匹配",
};

type CategoryGranularity = "day" | "week" | "month";
type SortDirection = "asc" | "desc";
type SubdivisionSortKey = CategorySortKey | "subdivision" | "productCount";
type CategorySortKey = "netSalesCents" | "shareRate" | "netQuantity" | "refundRate" | "refundAmountCents" | "grossProfitCents" | "grossMarginRate" | "weekOverWeekRate" | "yearOverYearRate";

type CategoryUrlState = {
  granularity: CategoryGranularity;
  sortBy: CategorySortKey;
  direction: SortDirection;
  page: number;
  pageSize: number;
};

type CategoryTab = "operations" | "subdivision";

const categoryOwnedUrlKeys = [
  "salesCategoryLevel", "salesGranularity", "salesSort", "salesDirection", "salesPage", "salesPageSize", "salesCategoryTab",
] as const;
// The shell owns `module` and `view=category`; this component only serializes its bounded analysis state.
const validGranularities = new Set<CategoryGranularity>(["day", "week", "month"]);
const validSortKeys = new Set<CategorySortKey>(["netSalesCents", "shareRate", "netQuantity", "refundRate", "refundAmountCents", "grossProfitCents", "grossMarginRate", "weekOverWeekRate", "yearOverYearRate"]);
const chartColors = ["#3f7be0", "#29a77a", "#8a65d6", "#e7943f"];

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.trunc(parsed)) : fallback;
}

function readCategoryUrl(): CategoryUrlState {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URL(window.location.href).searchParams;
  const granularity = params.get("salesGranularity") as CategoryGranularity | null;
  const sortParam = params.get("salesSort");
  const sortBy = (sortParam === "monthOverMonthRate" ? "weekOverWeekRate" : sortParam) as CategorySortKey | null;
  return {
    granularity: granularity && validGranularities.has(granularity) ? granularity : "day",
    sortBy: sortBy && validSortKeys.has(sortBy) ? sortBy : "netSalesCents",
    direction: params.get("salesDirection") === "asc" ? "asc" : "desc",
    page: positiveInteger(params.get("salesPage"), 1, 100_000),
    pageSize: positiveInteger(params.get("salesPageSize"), 20, 100),
  };
}

function readCategoryTab(): CategoryTab {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URL(window.location.href).searchParams;
  return params.get("salesCategoryTab") === "subdivision" ? "subdivision" : "operations";
}

function writeCategoryUrl(state: CategoryUrlState, tab: CategoryTab, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  for (const key of categoryOwnedUrlKeys) url.searchParams.delete(key);
  url.searchParams.set("salesCategoryLevel", "1");
  if (tab === "subdivision") url.searchParams.set("salesCategoryTab", "subdivision");
  if (state.granularity !== "day") url.searchParams.set("salesGranularity", state.granularity);
  if (state.sortBy !== "netSalesCents") url.searchParams.set("salesSort", state.sortBy);
  if (state.direction !== "desc") url.searchParams.set("salesDirection", state.direction);
  if (state.page !== 1) url.searchParams.set("salesPage", String(state.page));
  if (state.pageSize !== 20) url.searchParams.set("salesPageSize", String(state.pageSize));
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", next);
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatComparison(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${formatRate(value)}`;
}

function comparisonTone(value: number | null) {
  return value === null || value === 0 ? "muted-text" : value > 0 ? "green-text" : "red-text";
}

function CategoryDetailTrend({ item }: { item: CategoryDetailMetric }) {
  const values = item.trend.points.map((point) => point.netSalesCents);
  if (values.length === 0) return <span className="category-detail-trend-empty">—</span>;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(1, maximum - minimum);
  const x = (index: number) => values.length === 1 ? 52 : 3 + index / (values.length - 1) * 98;
  const y = (value: number) => 25 - (value - minimum) / span * 22;
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const tone = item.trend.direction === "up" ? "up" : item.trend.direction === "down" ? "down" : "flat";
  return <div className={`category-detail-trend ${tone}`} title={`${item.trend.points[0]?.period} 至 ${item.trend.points.at(-1)?.period}：${formatComparison(item.trend.changeRate)}`}>
    <svg viewBox="0 0 104 28" role="img" aria-label={`${item.category}品类趋势 ${formatComparison(item.trend.changeRate)}`}>
      {values.length === 1
        ? <circle cx="52" cy="14" r="2.5" />
        : <polyline points={points} fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
    <small>{formatComparison(item.trend.changeRate)}</small>
  </div>;
}

function MultiFilter({ label, values, selected, onChange, display }: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  display?: (value: string) => string;
}) {
  const [query, setQuery] = useState("");
  const matches = values.filter((value) => !query.trim() || (display?.(value) ?? value).toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")));
  return <details className="category-filter-menu">
    <summary><span>{label}</span><strong>{selected.length ? `已选 ${selected.length}` : "全部"}</strong></summary>
    <div className="category-filter-popover">
      <label className="category-filter-search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} /></label>
      <div className="category-filter-options">
        {matches.slice(0, 200).map((value) => <label key={value} className={selected.includes(value) ? "selected" : ""}>
          <input type="checkbox" checked={selected.includes(value)} onChange={() => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])} />
          <span title={display?.(value) ?? value}>{display?.(value) ?? value}</span>
        </label>)}
        {matches.length === 0 && <p>没有匹配选项</p>}
      </div>
      {selected.length > 0 && <button type="button" onClick={() => onChange([])}>清空{label}</button>}
    </div>
  </details>;
}

function CategoryOutletDrawer({ category, data, loading, error, onClose, onRetry }: {
  category: string;
  data: CategoryOutletBreakdownResponse | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  return <Dialog
    open
    onClose={onClose}
    dialogId="category-outlet-detail"
    ariaLabel={`${category}平台店铺详情`}
    className="category-outlet-drawer"
    initialFocusRef={closeButtonRef}
  >
      <header>
        <button type="button" className="row-action" disabled={loading} onClick={onRetry}>刷新详情</button>
        <div><span className="eyebrow">PLATFORM &amp; SHOP DETAIL</span><h2 id="category-outlet-title">{category} · 平台店铺详情</h2><p>{data ? `${data.range.startDate} 至 ${data.range.endDate} · ${data.range.timezone}` : "正在读取当前筛选范围"}</p></div>
        <button ref={closeButtonRef} type="button" aria-label="关闭品类详情" onClick={onClose}>×</button>
      </header>
      {loading && !data ? <div className="category-drawer-state" role="status"><span className="state-spinner" /><strong>正在汇总平台与店铺数据</strong></div>
        : error && !data ? <div className="category-drawer-state error" role="alert"><strong>详情加载失败</strong><p>{error}</p><button type="button" className="row-action" onClick={onRetry}>重试详情</button></div>
          : data ? <>
            {error && <div className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>详情刷新失败</strong><p>{error}；当前仍显示上一次成功结果。</p></div></div>}
            <section className="category-drawer-summary data-refresh-region" aria-busy={loading}>
              <div><span>品类净销售额</span><strong>{formatCurrency(data.totals.netSalesCents)}</strong></div>
              <div><span>平台</span><strong>{formatCount(data.totals.platformCount)} 个</strong></div>
              <div><span>店铺</span><strong>{formatCount(data.totals.shopCount)} 个</strong></div>
            </section>
            <div className="category-platform-list">
              {data.platforms.map((platform) => <section key={platform.platform} className="category-platform-group">
                <div className="category-platform-heading"><div><strong>{platform.platform}</strong><span>{platform.shopCount} 个店铺 · 贡献 {formatRate(platform.shareRate)}</span></div><div><strong>{formatCurrency(platform.netSalesCents)}</strong><span>毛利率 {formatRate(platform.grossMarginRate)}</span></div></div>
                <div className="data-table-wrap"><table className="data-table category-outlet-table" data-column-filter-scope={data.pagination.truncated ? "none" : "full"}><thead><tr><th>店铺</th><th>净销售额</th><th>贡献率</th><th>净销量</th><th>退款金额</th><th>退货率</th><th>毛利额</th><th>毛利率</th></tr></thead><tbody>
                  {platform.shops.map((shop) => <tr key={`${platform.platform}-${shop.shop}`}><td><strong>{shop.shop}</strong></td><td>{formatCurrency(shop.netSalesCents)}</td><td>{formatRate(shop.shareRate)}</td><td>{formatCount(shop.netQuantity)}</td><td>{formatCurrency(shop.refundAmountCents)}</td><td>{formatRate(shop.refundRate)}</td><td>{formatCurrency(shop.grossProfitCents)}</td><td className={shop.grossMarginRate < 0 ? "orange-text" : "green-text"}>{formatRate(shop.grossMarginRate)}</td></tr>)}
                </tbody></table></div>
              </section>)}
              {data.platforms.length === 0 && <div className="category-drawer-state"><strong>当前筛选下没有平台或店铺数据</strong></div>}
            </div>
            <footer>净销售额包含负值退款；店铺身份按“平台 + 店铺”隔离。{data.pagination.truncated ? `仅展示前 ${data.pagination.limit} 个店铺。` : "已展示全部匹配店铺。"}</footer>
          </> : null}
  </Dialog>;
}

function CategoryTrend({ data }: { data: CategoryAnalysisResponse }) {
  const categories = data.ranking.slice(0, 4).map((item) => item.category);
  const periods = [...new Set(data.trend.items.map((item) => item.period))];
  const visibleValues = data.trend.items.filter((item) => categories.includes(item.category)).map((item) => item.netSalesCents);
  const minimum = Math.min(0, ...visibleValues);
  const maximum = Math.max(0, ...visibleValues);
  const span = Math.max(1, maximum - minimum);
  const x = (index: number) => periods.length <= 1 ? 30 : 30 + index / (periods.length - 1) * 640;
  const y = (value: number) => 30 + (maximum - value) / span * 140;
  const zeroY = y(0);
  return <section className="panel category-trend-panel">
    <div className="category-section-heading"><div><span className="eyebrow">CATEGORY TREND</span><h2>品类统计周期趋势</h2><p>服务端按{data.trend.granularity === "day" ? "日" : data.trend.granularity === "week" ? "自然周" : "自然月"}汇总净销售额，最多展示前 {data.trend.categoryLimit} 个品类。</p></div><div className="category-trend-legend">{categories.map((category, index) => <span key={category}><i style={{ background: chartColors[index] }} />{category}</span>)}</div></div>
    {periods.length > 0 ? <div className="category-trend-chart"><svg viewBox="0 0 700 210" role="img" aria-label="品类净销售额统计周期趋势">
      <line x1="30" y1={zeroY} x2="670" y2={zeroY} className="category-chart-axis" />
      {categories.map((category, categoryIndex) => {
        const values = new Map(data.trend.items.filter((item) => item.category === category).map((item) => [item.period, item.netSalesCents]));
        const points = periods.map((period, index) => `${x(index)},${y(values.get(period) ?? 0)}`).join(" ");
        return <polyline key={category} points={points} fill="none" stroke={chartColors[categoryIndex]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />;
      })}
      {periods.map((period, index) => (periods.length <= 8 || index % Math.ceil(periods.length / 8) === 0) && <text key={period} x={x(index)} y="195" textAnchor="middle">{period.slice(5)}</text>)}
    </svg></div> : <div className="table-state" role="status">当前筛选下没有可绘制的品类趋势。</div>}
  </section>;
}

const sortableColumns: Array<{ key: CategorySortKey; label: string }> = [
  { key: "netSalesCents", label: "净销售额" },
  { key: "shareRate", label: "贡献率" },
  { key: "netQuantity", label: "净销量" },
  { key: "refundRate", label: "退货率" },
  { key: "refundAmountCents", label: "退款金额" },
  { key: "grossProfitCents", label: "毛利额" },
  { key: "grossMarginRate", label: "毛利率" },
  { key: "yearOverYearRate", label: "同比" },
  { key: "weekOverWeekRate", label: "环比上周" },
];

function CategorySubdivisionTab({ identity, startDate, endDate, filters, onFiltersChange, channelOptions }: {
  identity?: unknown; startDate: string; endDate: string; filters: SalesSharedFilters;
  onFiltersChange: (filters: SalesSharedFilters) => void; channelOptions: string[];
}) {
  const scopeKey = JSON.stringify([startDate, endDate, filters.channels, filters.platforms, filters.outletKeys, filters.productQuery.trim()]);
  const [view, setView] = useState<{ majorCategory: string; sortBy: SubdivisionSortKey; direction: SortDirection; page: number; scope: string }>(
    { majorCategory: "直饮机", sortBy: "netSalesCents", direction: "desc", page: 1, scope: scopeKey });
  // A changed filter scope always starts from the first page without an extra effect.
  const page = view.scope === scopeKey ? view.page : 1;
  const pageSize = 20;
  const { majorCategory, sortBy, direction } = view;
  const requestKey = JSON.stringify([scopeKey, majorCategory, sortBy, direction, page]);
  const [result, setResult] = useState<{ key: string; payload: CategorySubdivisionsResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [editing, setEditing] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [showUnclassified, setShowUnclassified] = useState(false);
  const generationRef = useRef(0);
  const data = result?.key === requestKey ? result.payload : null;
  const shown = data ?? (error ? result?.payload ?? null : null);
  // Only a known non-admin hides the edit entry; the server still answers 403 for everyone else.
  const role = identity && typeof identity === "object" && "role" in identity ? (identity as { role?: unknown }).role : undefined;
  const canEdit = role === undefined || role === "admin";

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++generationRef.current;
    const timeout = window.setTimeout(() => {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setError("品类细分读取超时，请重试。"); setLoading(false); controller.abort();
    }, 30_000);
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ startDate, endDate, majorCategory, sortBy, direction, page: String(page), pageSize: String(pageSize) });
        filters.channels.forEach((value) => query.append("channel", value));
        filters.platforms.forEach((value) => query.append("platform", value));
        filters.outletKeys.forEach((value) => query.append("outlet", value));
        if (filters.productQuery.trim()) query.append("productQuery", filters.productQuery.trim());
        const payload = await requestJson<CategorySubdivisionsResponse>(`/api/sales/category-analysis/subdivisions?${query}`, { signal: controller.signal });
        if (controller.signal.aborted || generation !== generationRef.current) return;
        if (!validCategorySubdivisions(payload, { startDate, endDate, page, pageSize, sortBy, direction })) throw new Error("品类细分响应不完整，请重试。");
        setResult({ key: requestKey, payload });
      } catch (reason) {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setError(reason instanceof Error ? reason.message : "暂时无法读取品类细分");
      } finally {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted && generation === generationRef.current) setLoading(false);
      }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [startDate, endDate, filters.channels, filters.platforms, filters.outletKeys, filters.productQuery, majorCategory, sortBy, direction, page, retryKey, requestKey]);

  const patchView = (patch: Partial<typeof view>) => setView({ ...view, page: 1, ...patch, scope: scopeKey });
  const toggleExpanded = (label: string) => {
    if (editing === label) setEditing("");
    setExpanded((values) => values.includes(label) ? values.filter((value) => value !== label) : [...values, label]);
  };
  const toggleEditing = (label: string) => {
    setExpanded((values) => values.filter((value) => value !== label));
    setEditing((value) => value === label ? "" : label);
    setNewLabel(""); setEditError("");
  };
  const submitEdit = async (payload: Record<string, string>, failure: string) => {
    if (saving) return;
    setSaving(true); setEditError("");
    try {
      await requestJson("/api/settings/product-subdivisions", { method: "POST", body: payload });
      setNewLabel(""); setEditing("");
      setRetryKey((value) => value + 1);
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : failure);
    } finally {
      setSaving(false);
    }
  };
  const deleteLabel = (item: SubdivisionMetric) => {
    if (!window.confirm(`确定删除细分“${item.subdivision}”吗？\n\n删除后，该细分下当前周期有销售的 ${formatCount(item.productCount)} 个货品将转为“未归类”，可在 系统设置 › 货品细分映射 重新归类。`)) return;
    void submitEdit({ action: "delete_label", majorCategory, name: item.subdivision }, "删除细分失败");
  };
  const addLabel = () => {
    const name = newLabel.trim();
    if (!name) { setEditError("请输入新细分名称"); return; }
    void submitEdit({ action: "add_label", majorCategory, name }, "新增细分失败");
  };
  const majorOptions = (shown?.mapping.majorCategories ?? []).map((item) => ({ value: item.name, label: item.name }));
  const sortHeader = (key: SubdivisionSortKey, label: string) => {
    const active = sortBy === key;
    return <th key={key} aria-sort={active ? (direction === "desc" ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => patchView({ sortBy: key, direction: active && direction === "desc" ? "asc" : "desc" })}>{label} {active ? (direction === "desc" ? "↓" : "↑") : "↕"}</button>
    </th>;
  };

  const settingsPanel = <section className="panel category-filter-panel category-analysis-settings" aria-label="品类细分设置">
    <div className="category-filter-heading"><div><span className="eyebrow">SUBDIVISION SETTINGS</span><h2>品类细分设置</h2><p>{startDate} 至 {endDate} · 公共筛选（渠道、平台、店铺、商品搜索）已同步应用；顶部品类多选不作用于品类细分；趋势固定按日。</p></div></div>
    <div className="category-filter-layout">
      <div className="category-level-field"><span>归集依据</span><strong>货品细分映射</strong><small>按吉客云规格代码归集，手动归类优先</small></div>
      <div className="category-filter-controls">
        <div className="category-filter-fields">
          <MultiFilter label="渠道" values={channelOptions} selected={filters.channels} onChange={(channels) => onFiltersChange({ ...filters, channels })} />
        </div>
        <div className="category-filter-actions">
          <button type="button" className="row-action" disabled={loading} onClick={() => setRetryKey((value) => value + 1)}>刷新品类细分</button>
          <span>大类目</span>
          <SearchableSelect ariaLabel="大类目" className="category-major-select" value={majorCategory}
            options={majorOptions.length > 0 ? majorOptions : [{ value: majorCategory, label: majorCategory }]}
            onChange={(value) => { setExpanded([]); setEditing(""); patchView({ majorCategory: value }); }} />
          {filters.channels.length > 0 && <button type="button" className="secondary-button category-filter-reset" onClick={() => onFiltersChange({ ...filters, channels: [] })}>清空渠道</button>}
        </div>
      </div>
    </div>
    {(loading || error) && <div className={`category-filter-note ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error ? `${error}${shown ? "；当前仍显示上一次成功结果。" : ""}` : "正在读取当前范围，数据通过校验后显示。"}</div>}
  </section>;

  const productTable = (products: SubdivisionProduct[], truncated: boolean) => products.length === 0
    ? <p className="muted-text">当前周期没有货品明细。</p>
    : <><table className="data-table"><thead><tr><th>规格代码</th><th>货品名称</th><th>吉客云分类</th><th>匹配方式</th><th>净销售额</th><th>净销量</th><th>毛利率</th></tr></thead><tbody>
      {products.map((product) => <tr key={`${product.productCode}|${product.productName}|${product.erpCategory}`}><td>{product.productCode || "—"}</td><td>{product.productName || "—"}</td><td>{product.erpCategory || "—"}</td><td>{matchedByLabel[product.matchedBy]}</td><td>{formatCurrency(product.netSalesCents)}</td><td>{formatCount(product.netQuantity)}</td><td className={product.grossMarginRate < 0 ? "orange-text" : "green-text"}>{formatRate(product.grossMarginRate)}</td></tr>)}
    </tbody></table>{truncated && <p className="muted-text">仅显示前 50 个货品。</p>}</>;

  const body = !shown
    ? <section className="panel data-state sales-data-state" role={error ? "alert" : "status"}>
      <strong>{error ? "品类细分加载失败" : "正在汇总品类细分数据"}</strong><p>{error || "正在按货品细分映射汇总销售、退款和毛利…"}</p>
      {error && <button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button>}
    </section>
    : (() => {
      const summary = shown.summary;
      const unclassified = shown.unclassified;
      const coverage = shown.coverage;
      const covered = shown.mapping.coveredCategories.join("、");
      const mappedProducts = coverage.manual.productCount + coverage.code.productCount + coverage.name_to_code.productCount + coverage.name.productCount;
      return <>
        <section className="category-kpi-grid">
          <article><span>细分净销售额</span><strong>{formatCurrency(summary.netSalesCents)}</strong><small>共 {formatCount(summary.subdivisionCount)} 个细分，退款以负值参与</small></article>
          <article><span>净销量</span><strong>{formatCount(summary.netQuantity)}</strong><small>退货 {formatCount(summary.returnQuantity)} 件 · 退款 {formatCurrency(summary.refundAmountCents)}</small></article>
          <article><span>毛利额</span><strong>{formatCurrency(summary.grossProfitCents)}</strong><small>毛利率 {formatRate(summary.grossMarginRate)}</small></article>
          <article><span>已归类货品</span><strong>{formatCount(mappedProducts)}</strong><small>手动 {formatCount(coverage.manual.productCount)} / 规格代码 {formatCount(coverage.code.productCount)} / 名称转代码 {formatCount(coverage.name_to_code.productCount)} / 名称兜底 {formatCount(coverage.name.productCount)}</small></article>
          <article className={unclassified.visible ? "warning" : ""}><span>未归类货品</span><strong>{formatCount(coverage.unclassified.productCount)}</strong><small>{formatCurrency(unclassified.netSalesCents)} · 相当于已归类净额的 {formatRate(unclassified.shareRate)}</small></article>
        </section>

        {unclassified.visible && <section className="category-unclassified-notice" role="note"><span>!</span><div><strong>存在未进入细分映射的货品</strong>
          <p>{covered} 中有 {formatCount(coverage.unclassified.productCount)} 个货品未进入细分映射（净销售额 {formatCurrency(unclassified.netSalesCents)}），未计入细分。可到 系统设置 › 货品细分映射 查看并手动归类。{" "}
            <button type="button" className="category-subdivision-toggle" aria-expanded={showUnclassified} onClick={() => setShowUnclassified((value) => !value)}>{showUnclassified ? "收起货品" : "展开货品"}</button></p>
          {showUnclassified && <div className="data-table-wrap">{productTable(unclassified.products, unclassified.productsTruncated)}</div>}
        </div></section>}

        {shown.details.pagination.total === 0 ? <section className="panel data-state" role="status"><span className="state-symbol">∅</span><strong>该大类目下还没有细分</strong><p>可在 系统设置 › 货品细分映射 查看映射；系统不会用模拟数据填充空结果。</p></section> : <section className="panel table-panel category-detail-panel">
          <div className="table-toolbar"><div><h2>品类细分明细</h2><p>贡献率以已归类细分合计为分母，未归类不计入；同比为去年同期净销售额变化；环比上周按截止日近 7 天对比此前 7 天；退货率按退款金额 ÷ 正向销售额计算。点击表头可在降序、升序间切换。</p></div><span className="soft-tag">显示 {formatCount(shown.details.pagination.returned)} / {formatCount(shown.details.pagination.total)}{shown.details.pagination.truncated ? " · 后续页未加载" : ""}</span></div>
          <div className="data-table-wrap"><table className="data-table category-detail-table"><thead><tr><th>排名</th>{sortHeader("subdivision", "细分")}{sortableColumns.map((column) => sortHeader(column.key, column.label))}<th>细分趋势</th>{sortHeader("productCount", "货品数")}<th>操作</th></tr></thead><tbody>
            {shown.details.items.map((item, index) => {
              const open = expanded.includes(item.subdivision);
              const editingRow = editing === item.subdivision;
              return <Fragment key={item.subdivision}>
                <tr><td>{(shown.details.pagination.page - 1) * shown.details.pagination.pageSize + index + 1}</td><td><strong>{item.subdivision}</strong></td><td><strong>{formatCurrency(item.netSalesCents)}</strong></td><td>{formatRate(item.shareRate)}</td><td>{formatCount(item.netQuantity)}</td><td>{formatRate(item.refundRate)}</td><td>{formatCurrency(item.refundAmountCents)}</td><td>{formatCurrency(item.grossProfitCents)}</td><td className={item.grossMarginRate < 0 ? "orange-text" : "green-text"}>{formatRate(item.grossMarginRate)}</td><td className={comparisonTone(item.yearOverYearRate)} title={`去年同期 ${formatCurrency(item.yearAgoNetSalesCents)}`}>{formatComparison(item.yearOverYearRate)}</td><td className={comparisonTone(item.weekOverWeekRate)} title={`近7天 ${formatCurrency(item.currentWeekNetSalesCents)}；此前7天 ${formatCurrency(item.previousWeekNetSalesCents)}`}>{formatComparison(item.weekOverWeekRate)}</td><td><CategoryDetailTrend item={item} /></td><td>{formatCount(item.productCount)}</td><td><div className="category-subdivision-actions"><button type="button" className="category-detail-button" aria-expanded={open} onClick={() => toggleExpanded(item.subdivision)}>{open ? "收起货品" : "查看货品"}</button>{canEdit && <button type="button" className="category-detail-button" aria-expanded={editingRow} onClick={() => toggleEditing(item.subdivision)}>{editingRow ? "收起编辑" : "编辑"}</button>}</div></td></tr>
                {open && !editingRow && <tr className="category-subdivision-products"><td colSpan={14}>{productTable(item.products, item.productsTruncated)}</td></tr>}
                {editingRow && <tr className="category-subdivision-products category-subdivision-edit"><td colSpan={14}>
                  <p>细分：<strong>{item.subdivision}</strong>（{item.labelSource === "custom" ? "自定义" : "静态"}）</p>
                  <div className="category-subdivision-edit-row">
                    <button type="button" className="secondary-button" disabled={saving} onClick={() => deleteLabel(item)}>删除该细分</button>
                    <label><span>新增细分</span><input value={newLabel} maxLength={40} placeholder="输入新细分名称" aria-label="新增细分名称" disabled={saving} onChange={(event) => setNewLabel(event.target.value)} /></label>
                    <button type="button" className="primary-button" disabled={saving} onClick={addLabel}>{saving ? "保存中…" : "添加"}</button>
                  </div>
                  {editError && <p className="category-subdivision-edit-error" role="alert">{editError}</p>}
                </td></tr>}
              </Fragment>;
            })}
          </tbody>
          <tfoot><tr className="category-subdivision-total"><td>合计</td><td>共 {formatCount(summary.subdivisionCount)} 个细分</td><td><strong>{formatCurrency(summary.netSalesCents)}</strong></td><td>{summary.shareRate === null ? "—" : formatRate(summary.shareRate)}</td><td>{formatCount(summary.netQuantity)}</td><td>{formatRate(summary.grossSalesCents === 0 ? 0 : summary.refundAmountCents / summary.grossSalesCents)}</td><td>{formatCurrency(summary.refundAmountCents)}</td><td>{formatCurrency(summary.grossProfitCents)}</td><td className={summary.grossMarginRate < 0 ? "orange-text" : "green-text"}>{formatRate(summary.grossMarginRate)}</td><td className={comparisonTone(summary.yearOverYearRate)} title={`去年同期 ${formatCurrency(summary.yearAgoNetSalesCents)}`}>{formatComparison(summary.yearOverYearRate)}</td><td className={comparisonTone(summary.weekOverWeekRate)} title={`近7天 ${formatCurrency(summary.currentWeekNetSalesCents)}；此前7天 ${formatCurrency(summary.previousWeekNetSalesCents)}`}>{formatComparison(summary.weekOverWeekRate)}</td><td></td><td>{formatCount(summary.productCount)}</td><td></td></tr></tfoot></table></div>
          <footer className="category-pagination"><span>第 {shown.details.pagination.page} 页 · 每页 {shown.details.pagination.pageSize} 条 · 合计为全部细分，不是当前页</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => patchView({ page: Math.max(1, page - 1) })}>上一页</button><button type="button" disabled={!shown.details.pagination.truncated || loading} onClick={() => patchView({ page: page + 1 })}>下一页</button></div></footer>
        </section>}

        <section className="category-source-note"><strong>数据来源与口径</strong>
          <span>映射来源：{shown.mapping.sources.map((source) => `${source.fileName}（SHA-256 前 8 位 ${source.sha256.slice(0, 8)}，${formatCount(source.rowCount)} 条）`).join("；")}。</span>
          <span>按吉客云规格代码归集；只有名称的映射条目先按名称在吉客云货品档案中找到规格代码；档案中找不到的按名称兜底计入；手动归类优先。趋势按日。覆盖分类：{covered}，其中未进映射的货品归“{shown.mapping.unclassifiedLabel}”。</span>
          <span>同比：{shown.comparisonPeriods.yearAgo.startDate} 至 {shown.comparisonPeriods.yearAgo.endDate}；环比上周：近 7 天 {shown.comparisonPeriods.weekOverWeek.current.startDate} 至 {shown.comparisonPeriods.weekOverWeek.current.endDate}，对比此前 7 天 {shown.comparisonPeriods.weekOverWeek.previous.startDate} 至 {shown.comparisonPeriods.weekOverWeek.previous.endDate}。</span>
          <span>趋势：按日展示最近 {shown.details.trend.periodLimit} 个有数据日；数据截止 {shown.dataCutoffDate ?? "暂无"}。</span></section>
      </>;
    })();

  return <>{settingsPanel}<StableReadContent owner={JSON.stringify([startDate, endDate])} identity={identity} pending={loading || !data} complete={Boolean(data)} error={Boolean(error)}>{body}</StableReadContent></>;
}

export default function SalesCategoryView({ identity, startDate, endDate, filters, onFiltersChange, onFilterOptionsChange }: { identity?: unknown; startDate: string; endDate: string; filters: SalesSharedFilters; onFiltersChange: (filters: SalesSharedFilters) => void; onFilterOptionsChange?: (options: SalesSharedFilterOptions) => void }) {
  const [urlState, setUrlState] = useState<CategoryUrlState>(readCategoryUrl);
  const [tab, setTab] = useState<CategoryTab>(readCategoryTab);
  const [result, setResult] = useState<{ key: string; payload: CategoryAnalysisResponse } | null>(null);
  const requestKey = JSON.stringify([startDate, endDate, filters, urlState]);
  const data = result?.key === requestKey ? result.payload : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [detailCategory, setDetailCategory] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<CategoryOutletBreakdownResponse | null>(null);
  const [detailDataKey, setDetailDataKey] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const detailKey = JSON.stringify([detailCategory, startDate, endDate, filters.channels, filters.outletKeys, filters.platforms, filters.productQuery]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const requestGenerationRef = useRef(0);
  const detailRequestGenerationRef = useRef(0);
  useAiPageDetails("sales", {
    period: { startDate, endDate },
    filters: { dataset: "sales_category", query: filters.productQuery.trim(), platforms: filters.platforms, outletKeys: filters.outletKeys, channels: filters.channels, categories: detailCategory ? [detailCategory] : filters.categories },
  });


  const closeCategoryDetail = useCallback(() => {
    setDetailCategory(null);
    setDetailData(null);
    setDetailDataKey(null);
    setDetailError("");
  }, []);

  const updateUrlState = useCallback((patch: Partial<CategoryUrlState>, mode: "push" | "replace" = "push") => {
    const next = { ...urlState, ...patch, page: patch.page ?? 1 };
    writeCategoryUrl(next, tab, mode);
    setUrlState(next);
  }, [urlState, tab]);

  const selectTab = useCallback((next: CategoryTab) => {
    if (next === tab) return;
    writeCategoryUrl(urlState, next, "push");
    setTab(next);
  }, [urlState, tab]);

  useEffect(() => {
    const onPopState = () => { setUrlState(readCategoryUrl()); setTab(readCategoryTab()); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++requestGenerationRef.current;
    const timeout = window.setTimeout(() => {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      setError("品类读取超时，请重试。"); setLoading(false); controller.abort();
    }, 30_000);
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({
          startDate,
          endDate,
          level: "1",
          granularity: urlState.granularity,
          sortBy: urlState.sortBy,
          direction: urlState.direction,
          page: String(urlState.page),
          pageSize: String(urlState.pageSize),
        });
        filters.categories.forEach((value) => query.append("category", value));
        filters.channels.forEach((value) => query.append("channel", value));
        filters.platforms.forEach((value) => query.append("platform", value));
        filters.outletKeys.forEach((value) => query.append("outlet", value));
        if (filters.productQuery.trim()) query.append("productQuery", filters.productQuery.trim());
        const payload = await requestJson<CategoryAnalysisResponse>(`/api/sales/category-analysis?${query}`, { signal: controller.signal });
        if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
        if (!validCategoryAnalysis(payload, { startDate, endDate, ...urlState })) throw new Error("品类响应不完整，请重试。");
        setResult({ key: requestKey, payload });
        onFilterOptionsChange?.({ platforms: payload.filterOptions.platforms, shops: payload.filterOptions.outlets, categories: payload.filterOptions.categories });
      } catch (reason) {
        if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
        setError(reason instanceof Error ? reason.message : "暂时无法读取品类分析");
      } finally {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted && generation === requestGenerationRef.current) setLoading(false);
      }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [endDate, filters.categories, filters.channels, filters.outletKeys, filters.platforms, filters.productQuery, retryKey, startDate, urlState, requestKey, onFilterOptionsChange]);

  useEffect(() => {
    if (!detailCategory) return;
    const controller = new AbortController();
    const generation = ++detailRequestGenerationRef.current;
    const timeout = window.setTimeout(() => {
      if (controller.signal.aborted || generation !== detailRequestGenerationRef.current) return;
      setDetailError("品类详情读取超时，请重试。"); setDetailLoading(false); controller.abort();
    }, 30_000);
    void (async () => {
      setDetailLoading(true);
      setDetailError("");
      try {
        const query = new URLSearchParams({ startDate, endDate, category: detailCategory });
        filters.channels.forEach((value) => query.append("channel", value));
        filters.platforms.forEach((value) => query.append("platform", value));
        filters.outletKeys.forEach((value) => query.append("outlet", value));
        if (filters.productQuery.trim()) query.append("productQuery", filters.productQuery.trim());
        const payload = await requestJson<CategoryOutletBreakdownResponse>(`/api/sales/category-analysis/detail?${query}`, { signal: controller.signal });
        if (!controller.signal.aborted && generation === detailRequestGenerationRef.current) {
          if (!validCategoryDetail(payload, startDate, endDate, detailCategory)) throw new Error("品类详情响应不完整，请重试。");
          setDetailData(payload);
          setDetailDataKey(detailKey);
        }
      } catch (reason) {
        if (!controller.signal.aborted && generation === detailRequestGenerationRef.current) {
          setDetailError(reason instanceof Error ? reason.message : "暂时无法读取平台店铺详情");
        }
      } finally {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted && generation === detailRequestGenerationRef.current) setDetailLoading(false);
      }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [detailCategory, endDate, filters.channels, filters.outletKeys, filters.platforms, filters.productQuery, startDate, detailKey, detailRetry]);

  const filterOptions = data?.filterOptions ?? { categories: [], channels: [], platforms: [], outlets: [], totals: { categories: 0, channels: 0, platforms: 0, outlets: 0 }, truncated: false, limit: 200 };
  const hasChannelFilter = filters.channels.length > 0;

  const settingsPanel = (<section className="panel category-filter-panel category-analysis-settings" aria-label="品类分析设置">
      <div className="category-filter-heading"><div><span className="eyebrow">CATEGORY SETTINGS</span><h2>品类分析设置</h2><p>{startDate} 至 {endDate} · 公共筛选已同步应用，渠道与趋势粒度为品类页专属设置。</p></div><span className="soft-tag">{data?.filtersApplied.dataScope.mode === "restricted" ? "已应用账号数据范围" : "全部授权范围"}</span></div>
      <div className="category-filter-layout">
        <div className="category-level-field"><span>当前分析层级</span><strong>一级品类</strong><small>品类以 ERP 商品主数据为准，暂无下级类目</small></div>
        <div className="category-filter-controls">
          <div className="category-filter-fields">
            <MultiFilter label="渠道" values={filterOptions.channels} selected={filters.channels} onChange={(channels) => onFiltersChange({ ...filters, channels })} />
          </div>
          <div className="category-filter-actions">
            <button type="button" className="row-action" disabled={loading} onClick={() => setRetryKey((value) => value + 1)}>刷新品类</button>
            <span>趋势粒度</span>
            <div className="segmented category-granularity" role="group" aria-label="品类趋势统计粒度">{(["day", "week", "month"] as const).map((value) => <button key={value} type="button" className={urlState.granularity === value ? "active" : ""} onClick={() => updateUrlState({ granularity: value })}>{value === "day" ? "按日" : value === "week" ? "按周" : "按月"}</button>)}</div>
            {hasChannelFilter && <button type="button" className="secondary-button category-filter-reset" onClick={() => onFiltersChange({ ...filters, channels: [] })}>清空渠道</button>}
          </div>
        </div>
      </div>
      {(filterOptions.truncated || loading || error) && <div className={`category-filter-note ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || (loading ? "正在读取当前范围，数据通过校验后显示。" : `筛选选项每类最多返回 ${filterOptions.limit} 个，当前已截断。`)}</div>}
    </section>);
  const visibleDetailData = detailDataKey === detailKey ? detailData : null;
  const drawer = detailCategory && <CategoryOutletDrawer category={detailCategory} data={visibleDetailData}
    loading={detailLoading || (!visibleDetailData && !detailError)} error={detailError}
    onClose={closeCategoryDetail} onRetry={() => setDetailRetry((value) => value + 1)} />;
  const tabNav = <div className="subnav outlet-subnav" role="tablist" aria-label="品类分析工作区">{([["operations", "品类经营"], ["subdivision", "品类细分"]] as const).map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => selectTab(key)}>{label}</button>)}</div>;
  const withContent = (content: ReactNode) => <div className="sales-category-view">{tabNav}{settingsPanel}<StableReadContent owner={JSON.stringify([startDate, endDate])} identity={identity} pending={loading || !data} complete={Boolean(data)} error={Boolean(error)}>{content}</StableReadContent>{drawer}</div>;
  if (tab === "subdivision") return <div className="sales-category-view">{tabNav}<CategorySubdivisionTab identity={identity} startDate={startDate} endDate={endDate} filters={filters} onFiltersChange={onFiltersChange} channelOptions={filterOptions.channels} /></div>;
  if (!data) return withContent(<section className="panel data-state sales-data-state" role={error ? "alert" : "status"}>
    <strong>{error ? "品类分析加载失败" : "正在汇总品类经营数据"}</strong><p>{error || "正在按当前范围汇总销售、退款和毛利…"}</p>
    {error && <button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button>}
  </section>);
  const summary = data.summary;
  const maxRankingSales = Math.max(1, ...data.ranking.map((item) => Math.max(0, item.netSalesCents)));
  return withContent(<>
    <section className="category-kpi-grid">
      <article><span>品类净销售额</span><strong>{formatCurrency(summary.netSalesCents)}</strong><small>销售额扣除退款，退款以负值参与</small></article>
      <article><span>正向销量</span><strong>{formatCount(summary.positiveQuantity)}</strong><small>仅数量大于 0 的销售行</small></article>
      <article><span>退货量 / 退款</span><strong>{formatCount(summary.returnQuantity)} <em>件</em></strong><small>{formatCurrency(summary.refundAmountCents)}</small></article>
      <article><span>品类毛利额</span><strong>{formatCurrency(summary.grossProfitCents)}</strong><small>毛利率 {formatRate(summary.grossMarginRate)}</small></article>
      <article className={data.uncategorized.visible ? "warning" : ""}><span>未分类商品</span><strong>{formatCount(data.uncategorized.productCount)}</strong><small>{formatCurrency(data.uncategorized.netSalesCents)} · 占 {formatRate(data.uncategorized.shareRate)}</small></article>
    </section>

    {data.uncategorized.visible && <section className="category-unclassified-notice" role="note"><span>!</span><div><strong>存在未匹配品类的商品</strong><p>{formatCount(data.uncategorized.productCount)} 个商品未在 ERP 商品主数据或销售明细中找到品类，已统一归入“未分类”并参与总计、贡献率、趋势和明细核对。</p></div></section>}

    {summary.categoryCount === 0 ? <section className="panel data-state" role="status"><span className="state-symbol">∅</span><strong>当前筛选没有品类销售数据</strong><p>可清空筛选或切换顶部统计周期；系统不会用模拟数据填充空结果。</p></section> : <>
      <section className="category-main-grid">
        <article className="panel category-structure-panel"><div className="category-section-heading"><div><span className="eyebrow">SALES MIX</span><h2>品类结构占比</h2><p>贡献率由服务端按完整筛选范围计算，合计 {formatRate(data.structure.contributionRateTotal)}。</p></div></div><div className="category-structure-list">{data.structure.items.map((item, index) => <div key={item.category}><span className={`table-rank ${index < 3 ? `top-${index + 1}` : ""}`}>{item.rank}</span><div><strong>{item.category}</strong><small>{formatCurrency(item.netSalesCents)} · {formatRate(item.shareRate)}</small><i><b style={{ width: `${Math.max(0, Math.min(100, item.shareRate * 100))}%` }} /></i></div></div>)}{data.structure.otherNetSalesCents !== 0 && <div><span className="table-rank">+</span><div><strong>其他品类</strong><small>{formatCurrency(data.structure.otherNetSalesCents)} · {formatRate(data.structure.otherShareRate)}</small><i><b style={{ width: `${Math.max(0, Math.min(100, data.structure.otherShareRate * 100))}%` }} /></i></div></div>}</div></article>
        <article className="panel category-ranking-panel"><div className="category-section-heading"><div><span className="eyebrow">CATEGORY RANKING</span><h2>品类销售排名</h2><p>按净销售额排序，退款负值已计入。</p></div></div><div className="category-ranking-list">{data.ranking.slice(0, 8).map((item) => <div key={item.category}><span>{item.rank}</span><div><strong>{item.category}</strong><i><b style={{ width: `${Math.max(2, Math.max(0, item.netSalesCents) / maxRankingSales * 100)}%` }} /></i></div><div><strong>{formatCurrency(item.netSalesCents)}</strong><small>毛利率 {formatRate(item.grossMarginRate)}</small></div></div>)}</div></article>
      </section>
      <CategoryTrend data={data} />
      <section className="panel table-panel category-detail-panel">
        <div className="table-toolbar"><div><h2>品类经营明细</h2><p>同比为去年同期净销售额变化；环比上周按截止日近 7 天对比此前 7 天；退货率按退款金额 ÷ 正向销售额计算。</p></div><span className="soft-tag">显示 {formatCount(data.details.pagination.returned)} / {formatCount(data.details.pagination.total)}{data.details.pagination.truncated ? " · 后续页未加载" : ""}</span></div>
        <div className="data-table-wrap"><table className="data-table category-detail-table"><thead><tr><th>排名</th><th>品类</th>{sortableColumns.map((column) => <th key={column.key}><button type="button" onClick={() => updateUrlState({ sortBy: column.key, direction: urlState.sortBy === column.key && urlState.direction === "desc" ? "asc" : "desc" })}>{column.label}{urlState.sortBy === column.key ? (urlState.direction === "desc" ? " ↓" : " ↑") : ""}</button></th>)}<th>品类趋势</th><th>详情</th></tr></thead><tbody>{data.details.items.map((item, index) => <tr key={item.category}><td>{(data.details.pagination.page - 1) * data.details.pagination.pageSize + index + 1}</td><td><strong>{item.category}</strong>{item.category === "未分类" && <small className="category-unclassified-tag">需补充映射</small>}</td><td><strong>{formatCurrency(item.netSalesCents)}</strong></td><td>{formatRate(item.shareRate)}</td><td>{formatCount(item.netQuantity)}</td><td>{formatRate(item.refundRate)}</td><td>{formatCurrency(item.refundAmountCents)}</td><td>{formatCurrency(item.grossProfitCents)}</td><td className={item.grossMarginRate < 0 ? "orange-text" : "green-text"}>{formatRate(item.grossMarginRate)}</td><td className={comparisonTone(item.yearOverYearRate)} title={`去年同期 ${formatCurrency(item.yearAgoNetSalesCents)}`}>{formatComparison(item.yearOverYearRate)}</td><td className={comparisonTone(item.weekOverWeekRate)} title={`近7天 ${formatCurrency(item.currentWeekNetSalesCents)}；此前7天 ${formatCurrency(item.previousWeekNetSalesCents)}`}>{formatComparison(item.weekOverWeekRate)}</td><td><CategoryDetailTrend item={item} /></td><td><button type="button" className="category-detail-button" onClick={() => setDetailCategory(item.category)}>查看详情</button></td></tr>)}</tbody></table></div>
        <footer className="category-pagination"><span>第 {data.details.pagination.page} 页 · 每页 {data.details.pagination.pageSize} 条</span><div><button type="button" disabled={urlState.page <= 1 || loading} onClick={() => updateUrlState({ page: Math.max(1, urlState.page - 1) })}>上一页</button><button type="button" disabled={!data.details.pagination.truncated || loading} onClick={() => updateUrlState({ page: urlState.page + 1 })}>下一页</button></div></footer>
      </section>
    </>}
    <section className="category-source-note"><strong>数据来源与口径</strong><span>品类：ERP 商品主数据优先，销售明细品类兜底，以商品编码关联；未命中归“未分类”。</span><span>销售：吉客云销售单明细账，排除“刷刷仓”；净销量沿用销售总览口径，排除配件、赠品配件、补差价专用和销售行未分类，退货率 = 退款金额 / 正向销售额。</span><span>同比：{data.comparisonPeriods.yearAgo.startDate} 至 {data.comparisonPeriods.yearAgo.endDate}；环比上周：近 7 天 {data.comparisonPeriods.weekOverWeek.current.startDate} 至 {data.comparisonPeriods.weekOverWeek.current.endDate}，对比此前 7 天 {data.comparisonPeriods.weekOverWeek.previous.startDate} 至 {data.comparisonPeriods.weekOverWeek.previous.endDate}。</span><span>品类趋势：按当前{data.details.trend.granularity === "day" ? "日" : data.details.trend.granularity === "week" ? "周" : "月"}粒度展示最近 {data.details.trend.periodLimit} 个有数据周期；数据截止 {data.dataCutoffDate ?? "暂无"}。</span></section>
  </>);
}
