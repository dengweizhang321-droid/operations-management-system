"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { insightBudget, type MetricValue } from "@/lib/netshop/insights-contract";
import { resolveNetshopPeriods } from "@/lib/netshop/periods";
import { shanghaiIsoToday } from "../../module-view-shared";
import StatisticalPeriodPicker from "../../statistical-period-picker";
import { SearchableMultiSelect } from "../../ui/searchable-select";
import type { ShopLocationContext } from "../../shell/shop-context";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightFilterBar, InsightListPagination, InsightReadState, InsightSourceCoverage } from "../shared/components";
import { InsightReadError, useScopedRead } from "../shared/request-state";
import { comparisonMetricKeys, comparisonSorts, defaultComparisonScope, type ComparisonIntent, type ComparisonPrefs, type ComparisonResponse, type ComparisonRow, type ComparisonMetricKey, type ComparisonCategory, type ComparisonMetric } from "./contract";
import { loadComparisonInsights } from "./data";
import { ComparisonTrendChart, ComparisonAmountBars, type ComparisonChartSeries } from "./ComparisonCharts";
import { ComparisonMetricCard, ComparisonMetricCell, ComparisonChangeCell, ComparisonQualification, ComparisonPanel, comparisonMetricLabels, comparisonObjectLabel, comparisonReason } from "./ComparisonPrimitives";
import "./comparison.css";

type ComparisonContext = ShopLocationContext & { comparisonIntent?: ComparisonIntent | null; comparisonPrefs?: ComparisonPrefs | null };
const erpKeys: ComparisonMetricKey[] = ["erpNetSales", "orderMargin", "largeMargin", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate"];
const defaultPrefs: ComparisonPrefs = { schemaVersion: "comparison-ui-v1", metricKey: "payment", chartObjectKeys: [], columnKeys: ["payment", "quantity", "visitors", "conversion", "spend", "roas", "spendRate"], sort: "value_desc" };
const sortLabels = { value_desc: "本期从高到低", value_asc: "本期从低到高", growth_desc: "增长从高到低", decline_desc: "下降从高到低", name_asc: "对象名称" };
/** Business intent stays in the shared shell URL. Display preferences use its account-bound history. */
export function buildComparisonQuery(props: Pick<NetshopColumnProps, "startDate" | "endDate" | "periodKind" | "context">, intent: ComparisonIntent, prefs: ComparisonPrefs) {
  const { context } = props;
  const { selectedBaseline, ...comparisonScope } = intent;
  const query = new URLSearchParams({ startDate: props.startDate, endDate: props.endDate, periodKind: props.periodKind, dimension: context.dimension, comparisonScope: JSON.stringify(comparisonScope), selectedBaseline: JSON.stringify(selectedBaseline), chartObjectKeys: JSON.stringify(prefs.chartObjectKeys), metricKey: prefs.metricKey, trendGrain: context.grain, page: String(context.page), pageSize: String(context.pageSize), sort: prefs.sort });
  (context.platforms.length ? context.platforms : ["京东", "天猫"]).forEach(platform => query.append("platform", platform));
  context.outlets.forEach(outlet => query.append("outlet", outlet));
  return query;
}
function indexedMetric(metric: ComparisonMetric, basis: ComparisonMetric): MetricValue {
  const valid = metric.status === "available" && metric.value !== null && basis.status === "available" && basis.value !== null && basis.value > 0;
  return { value: valid ? metric.value! / basis.value! * 100 : null, unit: "MULTIPLE", status: valid ? "available" : "unavailable", reasonCode: valid ? null : metric.reasonCode ?? basis.reasonCode ?? "incomplete_baseline", basis: metric.basis, sourceIds: metric.sourceIds, aggregation: "source_value_only", coverageRef: metric.coverageRef };
}

export default function ComparisonColumn(props: NetshopColumnProps) {
  const context: ComparisonContext = props.context;
  // This intersection is confined to C until I supplies the same frozen fields in ShopLocationContext.
  const change = props.onContextChange as (patch: Partial<ComparisonContext>) => void;
  const drill = props.onDrill as (view: Parameters<NetshopColumnProps["onDrill"]>[0], product: Parameters<NetshopColumnProps["onDrill"]>[1], section?: string, scopePatch?: Pick<ShopLocationContext,"platforms"|"outlets">) => void;
  const intent = context.comparisonIntent ?? { ...defaultComparisonScope, selectedBaseline: { kind: "previous" } };
  const savedPrefs = context.comparisonPrefs ?? defaultPrefs;
  const prefs: ComparisonPrefs = { ...savedPrefs, metricKey: erpKeys.includes(savedPrefs.metricKey) === (intent.metricSource === "erp") ? savedPrefs.metricKey : intent.metricSource === "erp" ? "erpNetSales" : "payment" };
  const [dateOpen, setDateOpen] = useState<"current" | "baseline" | null>(null), [indexed, setIndexed] = useState(false), [structurePeriod, setStructurePeriod] = useState<"current" | "baseline">("current");
  const serialized = String(buildComparisonQuery(props, intent, prefs));
  const principal = JSON.stringify([props.currentUser?.email ?? "edge-local", props.currentUser?.role ?? "edge-local", props.currentUser?.scopeRestricted ?? false]);
  const family = new URLSearchParams(serialized); family.delete("page");
  const familyKey = `${principal}:${family}`, readKey = `${principal}:${serialized}`;
  const token = useRef<{ key: string; snapshotToken: string; sectionToken: string } | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    for (let attempt=0;attempt<insightBudget.attempts;attempt++) {
      const next = new URLSearchParams(serialized);
      if (token.current?.key === familyKey) { next.set("snapshotToken", token.current.snapshotToken); next.set("sectionToken", token.current.sectionToken); }
      try { const response = await loadComparisonInsights(next, signal); if (!signal.aborted) token.current = { key: familyKey, snapshotToken: response.currentContext.snapshotToken, sectionToken: response.sectionToken }; return response; }
      catch (error) { if (signal.aborted) throw error; token.current = null; if (error instanceof InsightReadError && error.code.endsWith("revision_changed") && attempt+1<insightBudget.attempts) continue; throw error; }
    }
    throw new InsightReadError("comparison_revision_changed","比较来源版本持续变化，请重新读取");
  }, [familyKey, serialized]);
  const read = useScopedRead<ComparisonResponse>(readKey, load), data = read.data;
  const applyIntent = (patch: Partial<ComparisonIntent>) => change({ comparisonIntent: { ...intent, ...patch }, page: 1 });
  const applyPrefs = (patch: Partial<ComparisonPrefs>, resetPage = true) => change({ comparisonPrefs: { ...prefs, ...patch }, ...(resetPage ? { page: 1 } : {}) });
  const today = shanghaiIsoToday(), maxDate = props.endDate > today ? props.endDate : today;
  const defaultMinimumDate = `${Number(today.slice(0,4))-1}-01-01`, minimumDate = props.startDate < defaultMinimumDate ? props.startDate : defaultMinimumDate;
  const localPeriods = useMemo(() => { try { return resolveNetshopPeriods(props.startDate, props.endDate, props.periodKind); } catch { return null; } }, [props.startDate, props.endDate, props.periodKind]);
  const baselineWindow = data?.baselineContext.periods.current ?? (intent.selectedBaseline.kind === "custom" ? intent.selectedBaseline : intent.selectedBaseline.kind === "yearAgo" ? localPeriods?.yearAgo : localPeriods?.previous);
  const chartOptions = data?.sections.comparability.items ?? [];
  const selectedChartKeys = data?.chartObjectKeys ?? prefs.chartObjectKeys;
  const shopOptions = [...new Set([...(data?.currentContext.effectiveScope.shopKeys ?? []), ...(data?.baselineContext.effectiveScope.shopKeys ?? []), ...context.outlets])];
  const categories = data?.sections.structure.categoryOptions.filter(item => item.status === "label_only" && item.platform && item.sourceId && item.label && item.version) ?? [];
  const categorySelections: ComparisonCategory[] = [{ mode: "all" }, { mode: "unknown" }, ...categories.map(item => ({ mode: "label_only" as const, platform: item.platform!, sourceId: item.sourceId!, label: item.label!, evidenceVersion: item.version! }))];
  const selectedCategory = JSON.stringify(intent.category);
  const metricOptions = comparisonMetricKeys.filter(key => erpKeys.includes(key) === (intent.metricSource === "erp"));
  const population = data?.sections.comparability.items ?? [];
  const objectLabel = (key: string) => { const row = population.find(item => item.objectKey === key); return row ? comparisonObjectLabel(row) : key; };
  const onObject = (row: ComparisonRow) => {
    if (row.kind === "platform") { change({ platforms: [row.platform], outlets: context.outlets.filter(key => key.startsWith(`${row.platform}\u001f`)), comparisonIntent: { ...intent, mode: "shop" }, comparisonPrefs: { ...prefs, chartObjectKeys: [] }, page: 1 }); }
    else drill("analysis", null, "", { platforms:[row.platform], outlets:row.shopKeys });
  };
  const onProductTopic = (key: string) => { const row=population.find(item => item.objectKey === key); if (row) drill("products",null,"overview",{platforms:[row.platform],outlets:row.shopKeys}); };
  const trends: ComparisonChartSeries[] = (data?.sections.trends.items ?? []).flatMap(item => {
    if (indexed && item.indexBasis.status !== "available") return [];
    return (["current", "baseline"] as const).map(period => ({ key: `${item.objectKey}:${period}`, label: `${objectLabel(item.objectKey)} · ${period === "current" ? "本期" : "基期"}`, values: item[period].map(point => ({ label: point.date, metric: indexed ? indexedMetric(point.metric, item.indexBasis[period]) : point.metric })) }));
  });
  // Chart object cap is four. Each object keeps both periods; render paired charts to keep all four objects visible.
  const currentTrends = trends.filter(series => series.key.endsWith(":current")), baselineTrends = trends.filter(series => series.key.endsWith(":baseline"));
  const sharedPageNote = "规模、效率和推广表共用服务端分页；主图对象与完整排名分别选择。";
  const renderObject = (row: ComparisonRow) => <><button type="button" onClick={() => onObject(row)}>{comparisonObjectLabel(row)}</button><small>{row.kind === "platform" ? `${row.shopKeys.length} 家精确子店 · 点击展开` : "进入店铺全景"}</small></>;
  const pagination = data?.sections.scale.pagination;
  // The bounded wire returns one row once. These references preserve the same server page and order.
  const pageRows = new Map(data?.sections.scale.items.map(row => [row.objectKey,row]) ?? []);
  const efficiencyRows = data?.sections.efficiency.items.flatMap(key => { const row=pageRows.get(key); return row ? [row] : []; }) ?? [];
  const promotionRows = data?.sections.promotion.items.flatMap(key => { const row=pageRows.get(key); return row ? [row] : []; }) ?? [];
  const kpiKeys: ComparisonMetricKey[] = [...new Set<ComparisonMetricKey>([prefs.metricKey, ...(intent.metricSource === "erp" ? ["orderMargin","largeMargin","returnQuantity"] as const : ["quantity","transactionOrders","spend"] as const)])];
  return <div className="netshop-comparison" data-column="comparison">
    <header className="nc-heading"><div><div className="nc-eyebrow">均衡对比看板</div><h1>店铺与平台对比</h1><p>按来源分别观察规模、效率、结构与变化</p></div>{context.returnTo && <button type="button" className="secondary-button" onClick={props.onReturn}>返回原范围</button>}</header>
    <InsightFilterBar sticky={false} label="对比经营范围"><div className="nc-controls">
      <label>对比对象<select aria-label="对比模式" value={intent.mode} onChange={event => change({ comparisonIntent: { ...intent, mode: event.target.value === "platform" ? "platform" : "shop" }, comparisonPrefs: { ...prefs, chartObjectKeys: [] }, page:1 })}><option value="shop">店铺对比</option><option value="platform">平台对比</option></select></label>
      <label>平台<SearchableMultiSelect values={context.platforms} options={[{value:"京东",label:"京东"},{value:"天猫",label:"天猫"}]} ariaLabel="对比平台" allLabel="全部授权平台" onChange={values => change({ platforms: values.filter((value):value is "京东"|"天猫" => value === "京东" || value === "天猫"), outlets: context.outlets.filter(key => !values.length || values.includes(key.split("\u001f")[0])), dimension: !values.length || values.includes("天猫") ? "spu" : context.dimension, comparisonIntent: { ...intent, category: { mode: "all" } }, comparisonPrefs: { ...prefs, chartObjectKeys: [] }, page: 1 })} /></label>
      <label>店铺<SearchableMultiSelect values={context.outlets} options={shopOptions.map(value => ({ value, label: value.replace("\u001f"," · ") }))} ariaLabel="对比店铺" allLabel="全部授权店铺" maxSelections={50} onChange={outlets => change({ outlets, comparisonPrefs: { ...prefs, chartObjectKeys: [] }, page: 1 })} /></label>
      <label className="nc-date date-selector">本期<button type="button" aria-label="选择对比本期" aria-expanded={dateOpen === "current"} disabled={!props.onApplyPeriod} onClick={() => setDateOpen(value => value === "current" ? null : "current")}>{props.startDate} — {props.endDate}</button>{dateOpen === "current" && props.onApplyPeriod && <StatisticalPeriodPicker minDate={minimumDate} maxDate={maxDate} startDate={props.startDate} endDate={props.endDate} periodIntent={props.periodKind === "rolling" || props.periodKind === "quarter" ? props.periodKind : undefined} onCancel={() => setDateOpen(null)} onApply={(start,end,periodIntent) => { setDateOpen(null); props.onApplyPeriod?.(start,end,periodIntent); }} />}</label>
      <label>基期规则<select aria-label="对比基期规则" value={intent.selectedBaseline.kind} onChange={event => { const kind = event.target.value; if (kind === "custom") setDateOpen("baseline"); else { setDateOpen(null); applyIntent({ selectedBaseline: { kind: kind === "yearAgo" ? "yearAgo" : "previous" } }); } }}><option value="previous">所属前期</option><option value="yearAgo">所属去年同期</option><option value="custom">独立自定义</option></select></label>
      <label className="nc-date date-selector">基期<button type="button" aria-label="选择对比独立基期" aria-expanded={dateOpen === "baseline"} disabled={!baselineWindow} onClick={() => setDateOpen(value => value === "baseline" ? null : "baseline")}>{baselineWindow ? `${baselineWindow.startDate} — ${baselineWindow.endDate}` : "当前日期规则不可用"}</button>{dateOpen === "baseline" && baselineWindow && <StatisticalPeriodPicker minDate={minimumDate < baselineWindow.startDate ? minimumDate : baselineWindow.startDate} maxDate={maxDate} startDate={baselineWindow.startDate} endDate={baselineWindow.endDate} onCancel={() => setDateOpen(null)} onApply={(startDate,endDate) => { setDateOpen(null); applyIntent({ selectedBaseline: { kind: "custom", startDate, endDate } }); }} />}</label>
      <label>指标来源<select aria-label="对比指标来源" value={intent.metricSource} onChange={event => { const source = event.target.value === "erp" ? "erp" : "platform"; change({ comparisonIntent: { ...intent, metricSource: source }, comparisonPrefs: { ...prefs, metricKey: source === "erp" ? "erpNetSales" : "payment", columnKeys: source === "erp" ? erpKeys : defaultPrefs.columnKeys }, page: 1 }); }}><option value="platform">平台商品 / 推广</option><option value="erp">ERP 净销售 / 毛利</option></select></label>
      <label>分类<select aria-label="对比分类" value={selectedCategory} onChange={event => { const category = categorySelections.find(item => JSON.stringify(item) === event.target.value); if (category) applyIntent({ category }); }}><option value={JSON.stringify({mode:"all"})}>全部来源标签</option><option value={JSON.stringify({mode:"unknown"})}>未知来源标签</option>{intent.category.mode === "label_only" && !categorySelections.some(item => JSON.stringify(item) === selectedCategory) && <option value={selectedCategory}>所选标签证据待重读：{intent.category.label}</option>}{categories.map(item => <option key={`${item.platform}:${item.sourceId}:${item.label}:${item.version}`} value={JSON.stringify({mode:"label_only",platform:item.platform,sourceId:item.sourceId,label:item.label,evidenceVersion:item.version})}>{item.platform} · {item.label}（来源标签）</option>)}</select></label>
      <label>覆盖筛选<select aria-label="对比覆盖状态" value={intent.coverageFilter} onChange={event => applyIntent({ coverageFilter: event.target.value === "complete" ? "complete" : event.target.value === "partial" ? "partial" : "all" })}><option value="all">全部，资格分别标明</option><option value="complete">两期完整覆盖</option><option value="partial">部分覆盖</option></select></label>
      <label>比较指标<select aria-label="对比指标" value={prefs.metricKey} onChange={event => { const key = metricOptions.find(key => key === event.target.value); if (key) applyPrefs({ metricKey: key }); }}>{metricOptions.map(key => <option value={key} key={key}>{comparisonMetricLabels[key]}</option>)}</select></label>
    </div></InsightFilterBar>
    {data && <div className="nc-periods"><span><strong>本期</strong> {data.currentContext.periods.current.startDate} — {data.currentContext.periods.current.endDate}，{data.currentContext.periods.current.days} 天</span><span><strong>基期</strong> {data.baselineContext.periods.current.startDate} — {data.baselineContext.periods.current.endDate}，{data.baselineContext.periods.current.days} 天</span><span>{data.sections.comparability.periodRelationship.sameLength ? "两期等长" : "两期长度不同，金额按原值比较"}；重叠 {data.sections.comparability.periodRelationship.overlapDays} 天</span></div>}
    {intent.category.mode !== "all" && <p className="nc-notice">当前按本期来源标签选择商品 cohort；这不是官方或历史类目结构。推广或 ERP 无可靠分类关系时，对应区块不可用。</p>}
    <InsightReadState status={read.status} error={read.error} onRetry={read.refresh} />
    {data && <>
      <div className="nc-object-selector"><strong>主图对象（最多 4 个）</strong><SearchableMultiSelect values={selectedChartKeys} options={chartOptions.map(row => ({ value: row.objectKey, label: `${comparisonObjectLabel(row)}${row.qualification.comparable ? "" : " · 部分覆盖/不可比"}` }))} ariaLabel="对比主图对象" allLabel="使用服务端默认对象" maxSelections={4} onChange={chartObjectKeys => applyPrefs({ chartObjectKeys }, false)} /></div>
      <div className="nc-grid">
        <ComparisonPanel number="3.1" title="规模与增长" note={sharedPageNote} tools={<div className="nc-tools"><select aria-label="对比排名排序" value={prefs.sort} onChange={event => { const sort = comparisonSorts.find(sort => sort === event.target.value); if (sort) applyPrefs({ sort }); }}>{comparisonSorts.map(sort => <option key={sort} value={sort}>{sortLabels[sort]}</option>)}</select><button type="button" onClick={read.refresh}>重新读取</button></div>}>
          <div className="nc-kpis">{kpiKeys.map(key => <div className="nc-kpi" key={key}><ComparisonMetricCard label={comparisonMetricLabels[key]} metric={data.sections.scale.summary.current[key]} /><div className="nc-kpi-foot">基期 <ComparisonMetricCell metric={data.sections.scale.summary.baseline[key]} /> · <ComparisonChangeCell comparison={data.sections.scale.summary.comparisons[key]} /></div></div>)}</div>
          <div className="nc-table-scroll" tabIndex={0} aria-label="规模对比列表，横向滚动"><table className="nc-table"><thead><tr><th>对比对象</th><th>本期 · {comparisonMetricLabels[prefs.metricKey]}</th><th>基期</th><th>差额</th><th>变化</th><th>本期占比</th><th>基期占比</th><th>可比资格</th></tr></thead>{[true,false].map(complete => <tbody key={String(complete)}>{data.sections.scale.items.some(row => row.qualification.comparable === complete) && <tr className="nc-table-group"><td colSpan={8}>{complete ? "本页两期完整可比排名" : "本页部分覆盖与不可比查看（不参与完整排名）"}</td></tr>}{data.sections.scale.items.filter(row => row.qualification.comparable === complete).map(row => <tr key={row.objectKey}><td>{renderObject(row)}</td><td><ComparisonMetricCell metric={row.current[prefs.metricKey]} /></td><td><ComparisonMetricCell metric={row.baseline[prefs.metricKey]} /></td><td><ComparisonMetricCell metric={row.delta} /></td><td><ComparisonChangeCell comparison={row.comparisons[prefs.metricKey]} /></td><td><ComparisonMetricCell metric={row.share.current} /></td><td><ComparisonMetricCell metric={row.share.baseline} /></td><td><ComparisonQualification row={row} /><small>{row.exclusionReasons.map(comparisonReason).join("；")}</small></td></tr>)}</tbody>)}</table></div>
          {pagination && <InsightListPagination pagination={pagination} busy={read.status === "loading"} onPage={page => change({ page })} />}
          <p className="nc-caption">{intent.coverageFilter === "complete" ? "当前筛选两期字段完整覆盖对象，可比资格仍逐对象核验。" : "当前包含查看对象；不可比对象标明原因，不属于完整可比排名。"} 汇总取完整授权范围，不按当前页或主图选择重新加总。</p>
          <div className="nc-kpis">{[["持续对象本期",data.sections.scale.contributions.continuousCurrent],["持续对象基期",data.sections.scale.contributions.continuousBaseline],["持续对象变化",data.sections.scale.contributions.continuousDelta],["集合变化差额",data.sections.scale.contributions.scopeDelta]].map(([label,metric]) => <div className="nc-kpi" key={String(label)}><ComparisonMetricCard label={String(label)} metric={metric as ComparisonMetric} /></div>)}</div><p className="nc-caption">持续对象拆分：{data.sections.scale.contributions.status === "available" ? "身份与两期资格成立" : comparisonReason(data.sections.scale.contributions.reasonCode)}</p>
        </ComparisonPanel>
        <ComparisonPanel number="3.2" title="经营效率" half note="比率由拥有方按合计分子和分母计算，不平均店铺比例。">
          <details className="nc-columns"><summary>综合表列设置（规模 / 效率 / 推广）</summary><div>{comparisonMetricKeys.map(key => <label key={key}><input type="checkbox" checked={prefs.columnKeys.includes(key)} onChange={event => applyPrefs({ columnKeys: event.target.checked ? [...prefs.columnKeys,key].slice(0,24) : prefs.columnKeys.filter(column => column !== key) },false)} />{comparisonMetricLabels[key]}</label>)}</div></details>
          <div className="nc-table-scroll" tabIndex={0} aria-label="经营指标矩阵，横向滚动"><table className="nc-table"><thead><tr><th>对比对象</th>{prefs.columnKeys.filter((key):key is ComparisonMetricKey => (comparisonMetricKeys as readonly string[]).includes(key)).map(key => <th key={key}>{comparisonMetricLabels[key]}</th>)}<th>可比资格</th></tr></thead><tbody>{efficiencyRows.map(row => <tr key={row.objectKey}><td>{renderObject(row)}</td>{prefs.columnKeys.filter((key):key is ComparisonMetricKey => (comparisonMetricKeys as readonly string[]).includes(key)).map(key => <td key={key}><ComparisonMetricCell metric={row.current[key]} /><small>基期 <ComparisonMetricCell metric={row.baseline[key]} /></small></td>)}<td><ComparisonQualification row={row} /></td></tr>)}</tbody></table></div>
          <p className="nc-caption">{sharedPageNote}</p>{data.sections.efficiency.definitions.map(note => <p className="nc-caption" key={note}>{note}</p>)}
          <h3>完整候选集合的指标分布</h3><div className="nc-distribution-scroll" tabIndex={0} aria-label="完整候选指标分布，可纵向滚动"><ComparisonAmountBars rows={data.sections.efficiency.distribution.map(point => ({key:point.objectKey,label:`${objectLabel(point.objectKey)}${point.qualification.comparable ? "" : point.qualification.currentComplete && point.qualification.baselineComplete ? "（定义不可比）" : "（部分覆盖）"}`,metric:point.metric}))} /></div><p className="nc-caption">分布使用服务端完整候选集合，不以当前排名页替代全部对象。</p>
        </ComparisonPanel>
        <ComparisonPanel number="3.3" title="趋势对比" half note="本期与基期分别使用真实日期；两期异长不缩放金额。" tools={<div className="nc-tools"><select aria-label="对比趋势粒度" value={context.grain} onChange={event => change({grain:event.target.value === "month" ? "month" : event.target.value === "week" ? "week" : "day"})}><option value="day">日</option><option value="week">自然周</option><option value="month">月</option></select><button type="button" aria-pressed={!indexed} onClick={() => setIndexed(false)}>绝对值</button><button type="button" aria-pressed={indexed} onClick={() => setIndexed(true)}>有效基准 = 100</button></div>}>
          <div className="nc-trend-pair"><div><h3>本期 · {comparisonMetricLabels[prefs.metricKey]}</h3><ComparisonTrendChart series={currentTrends} indexed={indexed} title={`本期${comparisonMetricLabels[prefs.metricKey]}趋势`} /></div><div><h3>基期 · {comparisonMetricLabels[prefs.metricKey]}</h3><ComparisonTrendChart series={baselineTrends} indexed={indexed} title={`基期${comparisonMetricLabels[prefs.metricKey]}趋势`} /></div></div>
          {indexed && data.sections.trends.items.filter(item => item.indexBasis.status !== "available").map(item => <p className="nc-caption" key={item.objectKey}>{objectLabel(item.objectKey)}：{comparisonReason(item.indexBasis.reasonCode)}，未绘制指数。</p>)}{data.sections.trends.definitions.map(note => <p className="nc-caption" key={note}>{note}</p>)}
        </ComparisonPanel>
        <ComparisonPanel number="3.4" title="商品与类目结构" half note="来源标签与成交均价价格带；不推断官方或历史类目。" tools={<div className="nc-tools"><button type="button" aria-pressed={structurePeriod === "current"} onClick={() => setStructurePeriod("current")}>本期结构</button><button type="button" aria-pressed={structurePeriod === "baseline"} onClick={() => setStructurePeriod("baseline")}>基期结构</button></div>}>
          {data.sections.structure.items.map(item => <div className="nc-structure-object" key={item.objectKey}><h3>{objectLabel(item.objectKey)}</h3><div className="nc-links"><button type="button" onClick={() => onProductTopic(item.objectKey)}>查看商品专题</button></div><div className="nc-kpis"><ComparisonMetricCard label="成交商品数" metric={item.counts[structurePeriod]} /><ComparisonMetricCard label="TOP5 成交集中度" metric={item[structurePeriod].top5Share} /><ComparisonMetricCard label="TOP10 成交集中度" metric={item[structurePeriod].top10Share} /><ComparisonMetricCard label="结构金额分母" metric={item[structurePeriod].denominator} /></div><div className="nc-trend-pair"><div><h3>类目标签占比</h3><div className="nc-table-scroll"><table className="nc-table"><thead><tr><th>来源标签</th><th>成交金额</th><th>占比</th><th>商品数</th></tr></thead><tbody>{item[structurePeriod].categories.map((bucket,index) => <tr key={`${bucket.label}:${index}`}><td>{bucket.label}</td><td><ComparisonMetricCell metric={bucket.payment} /></td><td><ComparisonMetricCell metric={bucket.share} /></td><td><ComparisonMetricCell metric={bucket.products} /></td></tr>)}</tbody></table></div></div><div><h3>成交均价价格带</h3><ComparisonAmountBars rows={item[structurePeriod].priceBands.map((bucket,index) => ({key:`${bucket.label}:${index}`,label:bucket.label,metric:bucket.payment}))} /></div></div></div>)}
          <p className="nc-caption">同款对照：{comparisonReason(data.sections.structure.sameProduct.reasonCode)}。</p>{data.sections.structure.definitions.map(note => <p className="nc-caption" key={note}>{note}</p>)}
        </ComparisonPanel>
        <ComparisonPanel number="3.5" title="推广对比" half note="同平台优先；归因成交与平台成交并列观察，ROAS 不等于利润或增量。">
          {data.sections.promotion.sourceStates.filter(source => source.state !== "ready").map(source => <p className="nc-notice" role={source.state === "error" ? "alert" : "status"} key={`${source.period}:${source.platform}`}>{source.platform} · {source.period === "current" ? "本期" : "基期"}推广：{source.state === "error" ? "来源读取失败" : "当前来源不可用"}（{comparisonReason(source.code)}）。其他可靠来源可继续查看。</p>)}
          <div className="nc-table-scroll" tabIndex={0} aria-label="推广对比表，横向滚动"><table className="nc-table"><thead><tr><th>对比对象</th>{(["spend","attributedPayment","roas","ctr","cpc","spendRate"] as const).map(key => <th key={key}>{comparisonMetricLabels[key]}</th>)}<th>推广专题</th></tr></thead><tbody>{promotionRows.map(row => <tr key={row.objectKey}><td>{renderObject(row)}</td>{(["spend","attributedPayment","roas","ctr","cpc","spendRate"] as const).map(key => <td key={key}><ComparisonMetricCell metric={row.current[key]} /><small>基期 <ComparisonMetricCell metric={row.baseline[key]} /> · <ComparisonChangeCell comparison={row.comparisons[key]} /></small></td>)}<td><button type="button" onClick={() => drill("promotion",null,"",{platforms:[row.platform],outlets:row.shopKeys})}>查看精确范围</button></td></tr>)}</tbody></table></div><p className="nc-caption">{sharedPageNote}</p>{data.sections.promotion.sourceDefinitions.map(note => <p className="nc-caption" key={note}>{note}</p>)}
        </ComparisonPanel>
        <ComparisonPanel number="3.6" title="可比性与差异" note="以下为完整授权候选并集，独立于当前排名页和主图选择。">
          {data.sections.comparability.erpState.state !== "ready" && <p className="nc-notice" role={data.sections.comparability.erpState.state === "error" ? "alert" : "status"}>ERP 比较：{data.sections.comparability.erpState.state === "error" ? "来源读取失败" : data.sections.comparability.erpState.state === "dependency_pending" ? "所属比较来源准备中" : "当前来源不可用"}（{comparisonReason(data.sections.comparability.erpState.code)}）。不可用字段保留缺源原因。</p>}
          <div className="nc-kpis">{[["候选对象",data.sections.comparability.counts.candidates],["本期完整",data.sections.comparability.counts.currentComplete],["基期完整",data.sections.comparability.counts.baselineComplete],["两期完整可比",data.sections.comparability.counts.comparable]].map(([label,count]) => <div className="nc-kpi" key={String(label)}><span>{label}</span><strong className="nc-count">{count}</strong></div>)}</div>
          <div className="nc-table-scroll" tabIndex={0} aria-label="可比对象集合，横向滚动"><table className="nc-table"><thead><tr><th>对象</th><th>本期出现</th><th>基期出现</th><th>本期完整</th><th>基期完整</th><th>资格与原因</th></tr></thead><tbody>{population.map(row => <tr key={row.objectKey}><td>{comparisonObjectLabel(row)}</td><td>{row.currentPresence ? "有来源记录" : "未提供记录"}</td><td>{row.baselinePresence ? "有来源记录" : "未提供记录"}</td><td>{row.qualification.currentComplete ? "是" : "否"}</td><td>{row.qualification.baselineComplete ? "是" : "否"}</td><td><ComparisonQualification row={row} /><small>{row.exclusionReasons.map(comparisonReason).join("；")}</small></td></tr>)}</tbody></table></div>
          <div className="nc-trend-pair">{(["current","baseline"] as const).map(period => <div key={period}><h3>{period === "current" ? "本期" : "基期"}逐源覆盖</h3>{Object.entries((period === "current" ? data.currentContext : data.baselineContext).coverageBySource).filter(([key]) => key.endsWith(":current")).map(([key,coverage]) => <InsightSourceCoverage key={key} coverage={coverage} label={key.replace(/:current$/,"")} />)}</div>)}</div>
          <details className="nc-columns"><summary>参与来源的附加覆盖</summary>{Object.entries(data.sections.comparability.coverage).map(([key,coverage]) => <InsightSourceCoverage key={key} coverage={coverage} label={key} />)}</details>
          <ul className="nc-source-list">{data.sections.comparability.limitations.map(note => <li key={note}>{note}</li>)}</ul><details className="nc-columns"><summary>来源版本与一致性说明</summary><p className="nc-caption">各参与域读取前后修订复验；不宣称分布式原子快照。</p><ul className="nc-source-list">{data.joinedSourceRevisions.map((revision,index) => <li key={`${revision.domain}:${revision.kind}:${index}`}>{revision.domain} · {revision.kind} · {revision.revision}</li>)}</ul></details>
        </ComparisonPanel>
      </div>
    </>}
  </div>;
}

