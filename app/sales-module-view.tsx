"use client";
import { StableReadContent } from "./ui/stable-read-content";
import type { ReactNode } from "react";
import { useAiPageDetails } from "./ai-page-context-provider";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { fetchWithTransientRetry } from "@/lib/http/transient-retry";
import { parseProductQueries, parseProductQueriesStrict } from "@/lib/sales/read-contract";
import { validSalesSummary, type SalesSummaryProjection } from "@/lib/sales/summary-response";
import type { ModuleViewKey } from "./shell/navigation-catalog";
import type { FinanceAnalysisView as FinanceAnalysisComponent, FinanceTargetSettingsView as FinanceTargetComponent } from "./sales-finance-views";
import { ProductSalesTrend, ShopSalesDistribution } from "./module-view-business-ui";
import { createReloadableLazy } from "./shell/reloadable-lazy";
import SalesFilterBar, { readSalesSharedFilters, writeSalesSharedFilters,
  type SalesSharedFilterOptions, type SalesSharedFilters } from "./sales-filter-bar";
import { type CurrentUser, canManageFinanceTargets, type SalesRangeLabel, type SalesStats, type SalesChannel,
  salesRangeMap, channelTones, channelColors, formatCurrencyFromCents, formatCount,
  rateAsPercent, formatRate, formatNetSalesYearOverYear, netSalesYearOverYearTone,
  useDebouncedValue, formatChange, comparisonHint, Dot, MetricCard, SectionHeader } from "./module-view-shared";

const { Component: FinanceAnalysisView } = createReloadableLazy<Parameters<typeof FinanceAnalysisComponent>[0]>("sales", () => import("./sales-finance-views").then((module) => ({ default: module.FinanceAnalysisView })));
const { Component: FinanceTargetSettingsView } = createReloadableLazy<Parameters<typeof FinanceTargetComponent>[0]>("sales", () => import("./sales-finance-views").then((module) => ({ default: module.FinanceTargetSettingsView })));
const { Component: SalesCategoryView } = createReloadableLazy("sales", () => import("./sales-category-view"));

type SalesTab = ModuleViewKey<"sales">;
type ChannelDimension = "channel" | "platform";

function SalesSubnav({ active, onChange }: { active: SalesTab; onChange: (tab: SalesTab) => void }) {
  return (
    <div className="subnav inventory-subnav sales-subnav" role="tablist" aria-label="销售分析子版块">
      <button type="button" role="tab" aria-selected={active === "overview"} className={active === "overview" ? "active" : ""} onClick={() => onChange("overview")}>销售总览</button>
      <button type="button" role="tab" aria-selected={active === "channel"} className={active === "channel" ? "active" : ""} onClick={() => onChange("channel")}>渠道分析</button>
      <button type="button" role="tab" aria-selected={active === "category"} className={active === "category" ? "active" : ""} onClick={() => onChange("category")}>品类分析</button>
      <button type="button" role="tab" aria-selected={active === "finance"} className={active === "finance" ? "active" : ""} onClick={() => onChange("finance")}>财报分析</button>
      <button type="button" role="tab" aria-selected={active === "targets"} className={active === "targets" ? "active" : ""} onClick={() => onChange("targets")}>目标进度情况</button>
    </div>
  );
}

function ChannelAnalysisView({
  channels,
  platforms,
  current,
  pagination,
}: {
  channels: SalesChannel[];
  platforms: SalesChannel[];
  current: SalesStats;
  pagination?: {
    channel?: { total: number; returned: number; truncated: boolean };
    platform?: { total: number; returned: number; truncated: boolean };
  };
}) {
  const [dimension, setDimension] = useState<ChannelDimension>("channel");
  const rows = useMemo(
    () => [...(dimension === "channel" ? channels : platforms)].sort((a, b) => b.netSalesCents - a.netSalesCents),
    [channels, dimension, platforms],
  );

  if (!rows.length) {
    return (
      <section className="panel data-state channel-empty-state">
        <span className="state-symbol" aria-hidden="true">渠</span>
        <strong>暂未识别到渠道数据</strong>
        <p>当前销售明细已有成交记录，但渠道字段为空。请检查导入文件中的渠道或平台映射。</p>
      </section>
    );
  }

  const topChannel = rows[0];
  const marginLeader = rows.reduce((best, item) => item.grossMarginRate > best.grossMarginRate ? item : best, rows[0]);
  const refundLeader = rows.reduce((highest, item) => {
    const itemRate = item.grossSalesCents === 0 ? 0 : item.refundAmountCents / item.grossSalesCents;
    const highestRate = highest.grossSalesCents === 0 ? 0 : highest.refundAmountCents / highest.grossSalesCents;
    return itemRate > highestRate ? item : highest;
  }, rows[0]);
  const topThreeShare = Math.min(1, Math.max(0, rows.slice(0, 3).reduce((sum, item) => sum + item.shareRate, 0)));
  const concentrationLabel = topThreeShare >= .75 ? "集中度较高" : topThreeShare >= .5 ? "集中度适中" : "渠道较均衡";
  const maxSales = Math.max(1, ...rows.map((item) => Math.max(0, item.netSalesCents)));
  const dimensionLabel = dimension === "channel" ? "销售渠道" : "平台";
  const dimensionPagination = dimension === "channel" ? pagination?.channel : pagination?.platform;
  const refundLeaderRate = refundLeader.grossSalesCents === 0 ? 0 : refundLeader.refundAmountCents / refundLeader.grossSalesCents;

  return (
    <>
      <section className="channel-analysis-toolbar" aria-label="渠道分析维度">
        <div>
          <span className="eyebrow">渠道经营诊断</span>
          <h2>看清渠道贡献与经营质量</h2>
          <p>从销售规模、利润质量和退货风险三个角度，识别核心渠道与改善机会。</p>
        </div>
        <div className="segmented" role="group" aria-label="渠道分析口径">
          <button type="button" className={dimension === "channel" ? "active" : ""} aria-pressed={dimension === "channel"} onClick={() => setDimension("channel")}>销售渠道</button>
          <button type="button" className={dimension === "platform" ? "active" : ""} aria-pressed={dimension === "platform"} onClick={() => setDimension("platform")}>平台汇总</button>
        </div>
      </section>

      <section className="channel-kpi-grid">
        <article className="channel-kpi-card">
          <div><span>有效{dimensionLabel}</span><i className="channel-kpi-icon blue">渠</i></div>
          <strong>{formatCount(rows.length)}<small> 个</small></strong>
          <p>本周期产生销售净额的{dimensionLabel}</p>
        </article>
        <article className="channel-kpi-card">
          <div><span>头部{dimensionLabel}</span><i className="channel-kpi-icon purple">冠</i></div>
          <strong>{formatCurrencyFromCents(topChannel.netSalesCents)}</strong>
          <p title={topChannel.name}>{topChannel.name || "未分类"} · 占比 {formatRate(topChannel.shareRate)}</p>
        </article>
        <article className="channel-kpi-card">
          <div><span>Top 3 集中度</span><i className="channel-kpi-icon orange">集</i></div>
          <strong>{formatRate(topThreeShare)}</strong>
          <p>{concentrationLabel} · 按销售净额计算</p>
        </article>
        <article className="channel-kpi-card">
          <div><span>毛利表现最佳</span><i className="channel-kpi-icon green">利</i></div>
          <strong>{formatRate(marginLeader.grossMarginRate)}</strong>
          <p title={marginLeader.name}>{marginLeader.name || "未分类"} · 综合 {formatRate(current.grossMarginRate)}</p>
        </article>
      </section>

      <section className="channel-analysis-grid">
        <article className="panel channel-ranking-panel">
          <SectionHeader title={`${dimensionLabel}贡献排行`} note="销售净额、占比与毛利率综合查看" />
          <div className="channel-ranking-list">
            {rows.slice(0, 8).map((item, index) => (
              <div className="channel-ranking-row" key={item.name}>
                <span className={`channel-rank-number ${index < 3 ? `top-${index + 1}` : ""}`}>{index + 1}</span>
                <div className="channel-ranking-main">
                  <div><strong title={item.name}>{item.name || "未分类"}</strong><small>{formatCurrencyFromCents(item.netSalesCents)} · 占比 {formatRate(item.shareRate)} · 净销售同比 {formatNetSalesYearOverYear(item.salesYearOverYearRate)}</small></div>
                  <span><i style={{ width: `${Math.max(2, Math.max(0, item.netSalesCents) / maxSales * 100)}%` }} /></span>
                </div>
                <div className="channel-ranking-margin"><small>毛利率</small><strong className={item.grossMarginRate < current.grossMarginRate ? "orange-text" : "green-text"}>{formatRate(item.grossMarginRate)}</strong></div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel channel-insight-panel">
          <SectionHeader title="经营洞察" note="基于当前周期自动识别" />
          <div className="channel-insight-list">
            <article>
              <span className="insight-badge blue">集中度</span>
              <div><strong>{concentrationLabel}</strong><p>Top 3 {dimensionLabel}贡献 {formatRate(topThreeShare)} 的销售净额。</p></div>
            </article>
            <article>
              <span className="insight-badge green">利润</span>
              <div><strong title={marginLeader.name}>{marginLeader.name || "未分类"}</strong><p>毛利率 {formatRate(marginLeader.grossMarginRate)}，高于综合水平 {formatRate(marginLeader.grossMarginRate - current.grossMarginRate)}。</p></div>
            </article>
            <article>
              <span className="insight-badge orange">退货</span>
              <div><strong title={refundLeader.name}>{refundLeader.name || "未分类"}</strong><p>退货率 {formatRate(refundLeaderRate)}，为当前{dimensionLabel}中的最高值。</p></div>
            </article>
          </div>
          <div className="channel-benchmark">
            <div><span>综合毛利率</span><strong>{formatRate(current.grossMarginRate)}</strong></div>
            <div><span>综合退货率</span><strong>{formatRate(current.refundRate)}</strong></div>
            <div><span>订单总量</span><strong>{formatCount(current.orderCount)}</strong></div>
          </div>
        </article>
      </section>

      <section className="panel table-panel channel-detail-panel">
        <div className="table-toolbar">
          <div><h2>{dimensionLabel}经营明细</h2><p>按销售净额从高到低排列，数据随顶部统计周期同步更新</p></div>
          <span className="soft-tag">共 {formatCount(rows.length)} 个{dimensionLabel}</span>
        </div>
        <div className="data-table-wrap">
          <table className="data-table channel-data-table" data-column-filter-scope={dimensionPagination?.truncated === false ? "full" : "none"}>
            <thead><tr><th>排名</th><th>{dimensionLabel}</th><th>销售额（GMV）</th><th>销售净额</th><th>净额占比</th><th>净销售同比</th><th>订单毛利</th><th>毛利率</th><th>订单量</th><th>退货率</th><th>经营状态</th></tr></thead>
            <tbody>{rows.map((item, index) => {
              const refundRate = item.grossSalesCents === 0 ? 0 : item.refundAmountCents / item.grossSalesCents;
              const needsAttention = item.grossMarginRate < current.grossMarginRate - .05 || refundRate > current.refundRate + .03;
              const isCore = index < 3 && item.shareRate >= .1;
              const statusText = needsAttention ? "需要关注" : isCore ? "核心渠道" : "经营稳健";
              const statusTone = needsAttention ? "warning" : "success";
              return <tr key={item.name}>
                <td><span className={`table-rank ${index < 3 ? `top-${index + 1}` : ""}`}>{index + 1}</span></td>
                <td><div className="channel-name-cell"><span>{(item.name || "未").slice(0, 1)}</span><strong title={item.name}>{item.name || "未分类"}</strong></div></td>
                <td>{formatCurrencyFromCents(item.grossSalesCents)}</td>
                 <td><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong></td>
                 <td><div className="share-cell"><strong>{formatRate(item.shareRate)}</strong><span><i style={{ width: `${Math.max(0, Math.min(100, rateAsPercent(item.shareRate)))}%` }} /></span></div></td>
                 <td className={netSalesYearOverYearTone(item.salesYearOverYearRate)}>{formatNetSalesYearOverYear(item.salesYearOverYearRate)}</td>
                 <td>{formatCurrencyFromCents(item.grossProfitCents)}</td>
                <td className={item.grossMarginRate < current.grossMarginRate ? "orange-text" : "green-text"}><strong>{formatRate(item.grossMarginRate)}</strong></td>
                <td>{formatCount(item.orderCount)}</td>
                <td className={refundRate > current.refundRate ? "orange-text" : ""}>{formatRate(refundRate)}</td>
                <td><span className={`status status-${statusTone}`}><Dot tone={statusTone === "warning" ? "orange" : "green"} />{statusText}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function SalesView({ range, customStartDate, customEndDate, currentUser, moduleView, onModuleViewChange }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string; currentUser: CurrentUser | null; moduleView: SalesTab; onModuleViewChange: (view: SalesTab) => void }) {
  const apiRange = salesRangeMap[range];
  const activeTab = moduleView;
  const usesSalesSummary = activeTab === "overview" || activeTab === "channel";
  const canManageTargets = canManageFinanceTargets(currentUser);
  const [coreResult, setCoreResult] = useState<{ key: string; revision: string; payload: SalesSummaryProjection } | null>(null);
  const [fullResult, setFullResult] = useState<{ key: string; revision: string; payload: SalesSummaryProjection } | null>(null);
  const [readStatus, setReadStatus] = useState("正在读取核心指标");
  const generationRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [filters, setFilters] = useState<SalesSharedFilters>(readSalesSharedFilters);
  const [financeFilterOptions, setFinanceFilterOptions] = useState<SalesSharedFilterOptions | null>(null);
  const categoryOptionsKey = JSON.stringify([customStartDate, customEndDate, filters.productQuery, currentUser]);
  const [categoryOptions, setCategoryOptions] = useState<{ key: string; payload: SalesSharedFilterOptions } | null>(null);
  const publishCategoryOptions = useCallback((payload: SalesSharedFilterOptions) => {
    setCategoryOptions({ key: categoryOptionsKey, payload });
  }, [categoryOptionsKey]);
  const debouncedProductQuery = useDebouncedValue(filters.productQuery);
  const summaryKey = JSON.stringify([apiRange, customStartDate, customEndDate, filters.productQuery,
    filters.platforms, filters.outletKeys, filters.categories, currentUser]);
  const core = coreResult?.key === summaryKey ? coreResult : null;
  const full = fullResult?.key === summaryKey && (!core || (core.revision === fullResult.revision
    && core.payload.startDate === fullResult.payload.startDate && core.payload.endDate === fullResult.payload.endDate)) ? fullResult : null;
  const summary = full?.payload ?? core?.payload ?? null;
  const summaryComplete = !!full;
  const filterMetadataKey = JSON.stringify([customStartDate, customEndDate, currentUser]);
  const [filterMetadata, setFilterMetadata] = useState<{ key: string; options: SalesSharedFilterOptions } | null>(null);
  useEffect(() => {
    if (summary?.filterOptions) setFilterMetadata({ key: filterMetadataKey, options: summary.filterOptions });
  }, [filterMetadataKey, summary?.filterOptions]);
  const productQueries = useMemo(() => parseProductQueries(debouncedProductQuery), [debouncedProductQuery]);
  useAiPageDetails("sales", {
    period: activeTab === "targets" ? null : { startDate: customStartDate, endDate: customEndDate },
    filters: activeTab === "targets" ? {} : { query: debouncedProductQuery.trim(), platforms: filters.platforms, outletKeys: filters.outletKeys, categories: filters.categories },
  }, activeTab !== "category" && activeTab !== "finance");


  const updateFilters = useCallback((next: SalesSharedFilters) => {
    setFilters(next);
    writeSalesSharedFilters(next);
  }, []);

  const updateFinanceDimensionFilters = useCallback((platforms: string[], outletKeys: string[]) => {
    updateFilters({ ...filters, platforms, outletKeys });
  }, [filters, updateFilters]);

  useEffect(() => {
    setFinanceFilterOptions(null);
  }, [customEndDate, customStartDate]);

  const changeSalesTab = useCallback((tab: SalesTab) => {
    onModuleViewChange(tab);
  }, [onModuleViewChange]);

  useEffect(() => {
    const onPopState = () => setFilters(readSalesSharedFilters());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!usesSalesSummary) return;
    if (filters.productQuery !== debouncedProductQuery) {
      setLoading(true);
      setError("");
      setReadStatus("正在更新商品筛选…");
      return;
    }
    const controller = new AbortController();
    const generation = ++generationRef.current;
    const live = () => !controller.signal.aborted && generation === generationRef.current;
    setLoading(true);
    setError("");
    setReadStatus("正在读取核心指标");
    const timeout = window.setTimeout(() => {
      if (!live()) return;
      setError("销售读取超时，请重试；已成功的同范围结果仍保留。");
      setLoading(false);
      controller.abort();
    }, 30_000);
    let retryRemaining = 1;
    void (async () => {
      try {
        const query = new URLSearchParams({ range: apiRange });
        if (apiRange === "custom") { query.set("startDate", customStartDate); query.set("endDate", customEndDate); }
        const queries = parseProductQueriesStrict(debouncedProductQuery);
        if (queries.length) query.set("productQuery", queries.join(","));
        filters.platforms.forEach((value) => query.append("platform", value));
        filters.outletKeys.forEach((value) => query.append("outlet", value));
        filters.categories.forEach((value) => query.append("category", value));
        const read = async (projection: "core" | "full", revision?: string) => {
          const params = new URLSearchParams(query);
          if (projection === "core") params.set("view", "core");
          if (revision) params.set("expectedRevision", revision);
          let attempt = 0;
          const response = await fetchWithTransientRetry(`/api/sales/summary?${params}`, { cache: "no-store", signal: controller.signal }, {
            delaysMs: retryRemaining > 0 ? [1_000] : [],
            fetchImpl: async (input, init) => {
              if (attempt++ && live()) setReadStatus("读取失败，正在自动重试（1/1）");
              try {
                const response = await fetch(input, init);
                if ([500, 502, 503, 504].includes(response.status) && attempt === 1 && retryRemaining > 0 && live()) {
                  retryRemaining -= 1;
                  setReadStatus("服务暂时不可用，1 秒后自动重试（1/1）");
                }
                return response;
              } catch (reason) {
                if (attempt === 1 && retryRemaining > 0 && live()) {
                  retryRemaining -= 1;
                  setReadStatus("连接失败，1 秒后自动重试（1/1）");
                }
                throw reason;
              }
            },
          });
          const payload = await response.json().catch(() => null);
          if (response.status === 409) return null;
          if (!response.ok) throw new Error(payload?.error || payload?.message || `销售读取失败（${response.status}）`);
          const token = response.headers.get("x-sales-data-revision");
          if (!validSalesSummary(payload, projection) || !token || !/^\d+:\d+$/.test(token)
            || payload.range !== apiRange || (apiRange === "custom"
              && (payload.requestedStartDate !== customStartDate || payload.requestedEndDate !== customEndDate))) throw new Error("销售响应、周期或版本不完整，请重试。");
          return { key: summaryKey, revision: token, payload };
        };
        // At most one complete re-read if a writer commits between regions.
        for (let round = 0; round < 2; round++) {
          const initial = await read("core");
          if (!live()) return;
          if (!initial) throw new Error("销售核心指标版本变化，请重试。");
          setCoreResult(initial);
          setReadStatus("核心指标已就绪，正在读取趋势和渠道明细");
          const complete = await read("full", initial.revision);
          if (!live()) return;
          if (complete && complete.revision === initial.revision
            && complete.payload.startDate === initial.payload.startDate && complete.payload.endDate === initial.payload.endDate) { setFullResult(complete); return; }
          setReadStatus("数据版本已变化，正在重新读取（1/1）");
        }
        throw new Error("销售数据持续变化，请重试。");
      } catch (reason) {
        if (live()) setError(reason instanceof Error ? reason.message : "销售读取失败");
      } finally {
        window.clearTimeout(timeout);
        if (live()) setLoading(false);
      }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [summaryKey, retryKey, usesSalesSummary, apiRange, customStartDate, customEndDate,
    debouncedProductQuery, filters.productQuery, filters.platforms, filters.outletKeys, filters.categories]);

  const current = summary?.current;
  const previous = summary?.previous;
  const yearAgo = summary?.yearAgo;
  const channels = useMemo(() => summary?.channels ?? [], [summary?.channels]);
  const salesChannels = summary?.shops?.length ? summary.shops : channels;
  const platforms = summary?.platforms?.length ? summary.platforms : channels;
  const salesFilterOptions = activeTab === "category" && categoryOptions?.key === categoryOptionsKey
    ? categoryOptions.payload : summary?.filterOptions ?? (filterMetadata?.key === filterMetadataKey ? filterMetadata.options : { platforms: [], shops: [], categories: [] });
  const hasData = Boolean(current && (current.lineCount > 0 || current.orderCount > 0 || current.grossSalesCents !== 0 || current.netSalesCents !== 0));
  const donutBackground = useMemo(() => {
    if (!channels.length) return "#eef1f5";
    let cursor = 0;
    const stops = channels.map((channel, index) => {
      const start = cursor;
      cursor += Math.max(0, rateAsPercent(channel.shareRate));
      return `${channelColors[index % channelColors.length]} ${start}% ${Math.min(cursor, 100)}%`;
    });
    if (cursor < 100) stops.push(`#eef1f5 ${cursor}% 100%`);
    return `conic-gradient(${stops.join(",")})`;
  }, [channels]);
  const salesSubnav = <SalesSubnav active={activeTab} onChange={changeSalesTab} />;
  const sharedFilterBar = (capabilities?: { categories?: boolean; product?: boolean }, options: SalesSharedFilterOptions = salesFilterOptions) => <SalesFilterBar filters={filters} scopeKey={filterMetadataKey} key="sales-shared-filters" options={options} capabilities={capabilities} updating={usesSalesSummary && loading} scopeLabel={activeTab === "finance" ? "财报分析" : activeTab === "category" ? "品类分析" : activeTab === "channel" ? "渠道分析" : "销售总览"} onChange={updateFilters} />;

  if (activeTab === "category") return <>{salesSubnav}{sharedFilterBar()}<Suspense fallback={<section className="panel data-state" role="status">正在打开品类分析…</section>}><SalesCategoryView identity={currentUser} key={JSON.stringify(currentUser)} startDate={customStartDate} endDate={customEndDate} filters={filters} onFiltersChange={updateFilters} onFilterOptionsChange={publishCategoryOptions} /></Suspense></>;
  if (activeTab === "finance") return <>{salesSubnav}{sharedFilterBar({ categories: false, product: false }, financeFilterOptions ?? salesFilterOptions)}<Suspense fallback={<section className="panel data-state" role="status">正在打开财报分析…</section>}><FinanceAnalysisView identity={currentUser} key={JSON.stringify(currentUser)} customStartDate={customStartDate} customEndDate={customEndDate} selectedPlatforms={filters.platforms} selectedShopKeys={filters.outletKeys} onDimensionFiltersChange={updateFinanceDimensionFilters} onFilterOptionsChange={setFinanceFilterOptions} /></Suspense></>;
  if (activeTab === "targets") return <>{salesSubnav}<Suspense fallback={<section className="panel data-state" role="status">正在打开目标进度…</section>}><FinanceTargetSettingsView key={JSON.stringify(currentUser)} canManageTargets={canManageTargets} /></Suspense></>;

  const withSalesContent = (content: ReactNode) => <>{salesSubnav}{sharedFilterBar()}<StableReadContent
    owner={JSON.stringify([activeTab, customStartDate, customEndDate, currentUser])} identity={currentUser}
    pending={loading || !summaryComplete} complete={summaryComplete} error={Boolean(error)}>{content}</StableReadContent></>;

  if (!summary && !error) {
    return withSalesContent(
      <section className="panel data-state sales-data-state" role="status" aria-live="polite">
          <span className="state-spinner" aria-hidden="true" />
          <strong>正在读取{range}销售数据</strong>
          <p>{customStartDate} 至 {customEndDate} · {readStatus}</p>
        </section>
    );
  }

  if (error && !summary) {
    return withSalesContent(
      <section className="panel data-state sales-data-state data-state-error" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <strong>销售数据加载失败</strong>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>重新加载</button>
        </section>
    );
  }

  if (!hasData || !current) {
    return withSalesContent(
      <section className="panel data-state sales-data-state">
          <span className="state-symbol" aria-hidden="true">∅</span>
          <strong>{range}暂无销售数据</strong>
          <p>{productQueries.length > 0 ? "当前货品编码或名称在该统计周期内没有销售记录，可修改或清空下方查询。" : "请先在“数据导入”中上传吉客云销售单明细账，或切换其他统计周期。"}</p>
        </section>
    );
  }

  const rangeNote = summary?.startDate && summary?.endDate
    ? `${summary.startDate} 至 ${summary.endDate}`
    : `${range}实时汇总`;
  const comparisonPeriodNote = summary?.previousStartDate && summary?.previousEndDate
    ? `环比：${summary.previousStartDate} 至 ${summary.previousEndDate}`
    : "";
  const sourceNote = [comparisonPeriodNote, summary?.latestBatch?.fileName ? `最近批次：${summary.latestBatch.fileName}` : ""]
    .filter(Boolean)
    .join(" · ");

  return withSalesContent(
    <>
      <div className="sales-period-note">
        <span><Dot tone="green" />已加载真实明细</span>
        <strong>{rangeNote}</strong>
        {sourceNote && <small title={sourceNote}>{sourceNote}</small>}
      </div>
      <div className="sales-period-note" role="status" aria-live="polite"><span>{loading ? readStatus : error ? "更新未完成" : "全部区域已更新"}</span><button type="button" className="row-action" disabled={loading} onClick={() => setRetryKey((value) => value + 1)}>刷新销售数据</button></div>
      {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>销售数据刷新失败</strong><p>{error}；已成功的同范围区域仍保留。</p></div><button className="row-action" onClick={() => setRetryKey((key) => key + 1)}>重试</button></section>}
      {activeTab === "channel" ? (
        <div className="data-refresh-region" aria-busy={loading}>{summaryComplete ? <ChannelAnalysisView channels={salesChannels} platforms={platforms} current={current} pagination={{ channel: summary.groupPagination?.shops, platform: summary.groupPagination?.platforms }} /> : <section className="panel data-state" role="status">{error ? "渠道明细未完成，请重试。" : "核心指标已就绪，正在读取渠道明细…"}</section>}</div>
      ) : <>
        <section className="metrics-grid sales-metrics-grid data-refresh-region" aria-busy={loading}>
          <MetricCard label="销售额（GMV）" value={formatCurrencyFromCents(current.grossSalesCents)} change={formatChange(current.grossSalesCents, previous?.grossSalesCents)} hint={comparisonHint(current.grossSalesCents, previous?.grossSalesCents, yearAgo?.grossSalesCents)} tone="blue" />
          <MetricCard label="销售净额" value={formatCurrencyFromCents(current.netSalesCents)} change={formatChange(current.netSalesCents, previous?.netSalesCents)} hint={comparisonHint(current.netSalesCents, previous?.netSalesCents, yearAgo?.netSalesCents)} tone="green" />
          <MetricCard label="订单毛利" value={formatCurrencyFromCents(current.grossProfitCents)} change={formatChange(current.grossProfitCents, previous?.grossProfitCents)} hint={comparisonHint(current.grossProfitCents, previous?.grossProfitCents, yearAgo?.grossProfitCents)} tone="purple" />
          <MetricCard label="退货金额" value={formatCurrencyFromCents(current.refundAmountCents)} change={formatChange(current.refundAmountCents, previous?.refundAmountCents)} hint={comparisonHint(current.refundAmountCents, previous?.refundAmountCents, yearAgo?.refundAmountCents)} tone="orange" />
          <MetricCard label="净销量" value={formatCount(current.netQuantity)} change={formatChange(current.netQuantity, previous?.netQuantity)} hint={comparisonHint(current.netQuantity, previous?.netQuantity, yearAgo?.netQuantity)} tone="blue" />
          <MetricCard label="客单价" value={formatCurrencyFromCents(current.averageOrderValueCents)} change={formatChange(current.averageOrderValueCents, previous?.averageOrderValueCents)} hint={comparisonHint(current.averageOrderValueCents, previous?.averageOrderValueCents, yearAgo?.averageOrderValueCents)} tone="purple" />
          <MetricCard label="退货率" value={formatRate(current.refundRate)} change={formatChange(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate))} hint={comparisonHint(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate), rateAsPercent(yearAgo?.refundRate))} tone="orange" />
          <MetricCard label="大毛利率" value={formatRate(current.grossMarginRate)} change={formatChange(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate))} hint={comparisonHint(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate), rateAsPercent(yearAgo?.grossMarginRate))} tone="green" />
        </section>
        {summaryComplete ? <><section className="split-panels data-refresh-region" aria-busy={loading}>
          <article className="panel">
            <SectionHeader title="渠道销售构成" note="按销售净额统计渠道占比，并展示各渠道净销售同比" />
            <div className="channel-chart">
              <div className="donut" style={{ background: donutBackground }}><div><strong>{(current.netSalesCents / 1000000).toFixed(1)}</strong><small>万元净额</small></div></div>
              <div className="channel-list channel-sales-list"><div className="channel-list-head"><span>渠道</span><strong>净销售额</strong><em>占比</em><small>净销售同比</small></div>{channels.map((item, index) => <div key={item.name}><span><Dot tone={channelTones[index % channelTones.length]} />{item.name || "未分类"}</span><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong><em>{formatRate(item.shareRate)}</em><small className={netSalesYearOverYearTone(item.salesYearOverYearRate)}>{formatNetSalesYearOverYear(item.salesYearOverYearRate)}</small></div>)}</div>
            </div>
          </article>
          <article className="panel">
            <SectionHeader title="渠道毛利表现" note="平台大毛利率、净销售同比与退货率" />
            <div className="progress-list">{channels.map((item, index) => {
              const margin = Math.max(0, Math.min(rateAsPercent(item.grossMarginRate), 100));
              const tone = channelTones[index % channelTones.length];
              return <div key={item.name}><div><span>{item.name || "未分类"}<small>净销售同比 {formatNetSalesYearOverYear(item.salesYearOverYearRate)} · 退货率 {formatRate(item.refundRate)}</small></span><strong className="platform-margin"><b>{formatRate(item.grossMarginRate)}</b><small>大毛利率</small></strong></div><span className="progress-track"><i className={`bg-${tone}`} style={{ width: `${margin}%` }} /></span></div>;
            })}</div>
            <div className="insight-card"><span>数据口径</span><p>渠道构成与订单行数来自当前周期销售明细；大毛利率统一按（分摊后金额 − 货品成本）÷ 分摊后金额计算，不扣费用分摊。</p></div>
          </article>
        </section>
        <section className="product-situation-grid data-refresh-region" aria-busy={loading}><ProductSalesTrend daily={summary?.daily ?? []} selectedProductCount={productQueries.length} /><ShopSalesDistribution shops={summary?.outlets ?? []} /></section></> : <section className="panel data-state" role="status">{error ? "趋势与渠道读取未完成，请重试。" : "核心指标已就绪，正在读取趋势与渠道…"}</section>}
      </>}
    </>
  );
}
