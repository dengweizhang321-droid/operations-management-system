"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NetshopColumnProps } from "../shared/module-slots";
import { InsightComparison, InsightDerivedMoneyMetric, InsightFilterBar, InsightMetric, InsightReadState, InsightSourceCoverage } from "../shared/components";
import { InsightReadError, useScopedRead } from "../shared/request-state";
import { formatDerivedMoneyPerCount, formatMetric, type DerivedMoneyPerCountV1, type InsightsContext, type MetricComparison, type MetricValue } from "@/lib/netshop/insights-contract";
import { resolveNetshopPeriods } from "@/lib/netshop/periods";
import { productSeriesColumns, type ProductScopeSeries, type ProductSeriesColumnKey } from "@/lib/netshop/product-scope-series-contract";
import { ProductPicture } from "../products/ProductsPrimitives";
import type { ProductInsightsResponse, ProductRow } from "../products/contract";
import MetricTrend from "../promotion/MetricTrend";
import StatisticalPeriodPicker from "../../statistical-period-picker";
import { shanghaiIsoToday } from "../../module-view-shared";
import { loadPanoramaContext, loadStorePanorama } from "./data";
import { panoramaSourceKeys, type PanoramaCapability, type PanoramaSectionKey, type PanoramaSource, type StorePanoramaResponse } from "./contract";
import { decodePanoramaScroll, panoramaChapter, panoramaChapters, panoramaDirectoryQuery, panoramaGrainChange, panoramaPageButtons, panoramaPageSizeChange, panoramaPageSizes, panoramaPresentationScope, panoramaPrincipalKey, panoramaQuery, panoramaScrollStorageKey, panoramaSearchChange, panoramaSeriesChartPoints, panoramaSeriesColumnLabels, panoramaSeriesPeriodLabels, panoramaSeriesRows, panoramaShop, panoramaShopChange, panoramaTokenFamily, type PanoramaSeriesPeriod } from "./ui-state";
import "../promotion/promotion.css";
import "./panorama.css";

const sourceLabels = { products: "平台商品经营", productSeries: "平台店日序列", promotion: "推广归因", sales: "ERP销售", finance: "月度财报与年度目标", workflow: "已记录经营事件" };
const sourceDescriptions = { products: "商品×日累计；当前档案另验快照", productSeries: "完整店日/自然周/月；同来源字段覆盖", promotion: "平台归因；多视角不相加", sales: "ERP原成本、净额与毛利", finance: "实际月财报与既有年度目标", workflow: "原发生时间与记录状态" };
const capabilityLabels: Record<string, string> = {
  platform_payment: "平台成交", platform_quantity: "平台成交件数", erp_net_sales: "ERP净销售", orders: "去重订单数", order_average_value: "订单客单价", order_margin: "订单毛利", large_margin_rate: "大毛利率", platform_refund: "平台退款", product_changes: "商品变化贡献", platform_trend: "平台经营趋势", platform_day_detail: "平台日/桶明细", traffic_trend: "流量经营趋势",
  page_views: "商品浏览累计", visitors: "商品访客累计", customers: "成交客户累计", conversion: "商品累计转化率", visitor_value: "商品访客价值", favorites: "收藏累计", add_cart_customers: "加购客户累计", add_cart_quantity: "加购件数", order_customers: "下单客户累计", order_quantity: "下单件数", order_payment: "下单金额", transaction_orders: "平台成交订单指标", search_impressions: "搜索曝光", search_clicks: "搜索点击", search_click_rate: "搜索点击率", search_visitors: "搜索访客累计", search_customers: "搜索成交客户累计", stay_time: "停留时长", bounce_rate: "跳失率",
  traded_products: "成交商品数", category_contribution: "类目标签贡献", top_concentration: "TOP集中度", growth_decline: "增长与下降", product_detail: "精确商品详情", inventory: "当前库存摘要",
  spend: "推广花费", attributed_payment: "广告归因成交", roas: "ROAS", cpc: "每次点击成本", spend_rate: "推广费率", trend: "推广趋势", distribution: "投入分布", promotion_detail: "推广对象详情",
  cost: "ERP成本", large_margin: "大毛利", return_amount: "ERP退货金额", return_quantity: "ERP退货件数", contribution: "ERP贡献排行",
  new_old_buyers: "原口径新老买家", b2b_payment: "企业购金额", b2b_orders: "企业购订单", b2b_quantity: "企业购件数", b2b_product_structure: "企业购商品结构", unique_customers: "去重客户", repeat_purchase: "复购", b2b_share: "B端占比",
  annual_target: "既有年度目标", finance_month: "月度财报", history: "历史同期", events: "经营事件", coverage: "店日覆盖", field_availability: "字段可用性", source_freshness: "各来源截止日", mapping: "商品映射", comparability: "可比较性", import_records: "原导入与工作流记录",
};
const reasonLabels: Record<string, string> = { no_records: "未导入记录", missing_day: "日期未覆盖", missing_field: "来源缺少字段", not_applicable: "当前来源不适用", unmapped: "未关联", ambiguous_mapping: "关联不唯一", zero_denominator: "分母为零", negative_denominator: "分母为负", incomplete_baseline: "两期覆盖不足", negative_baseline: "基期为负", unverified_source: "来源未核验", incomplete_coverage: "范围覆盖不足", no_comparable_date: "没有一一对应比较日", attribution_window_unknown: "归因窗口未核验", unsafe_integer: "数值超出安全范围", promotion_not_ready: "推广聚合未就绪", promotion_mismatch: "推广与原始来源不一致", dependency_pending: "依赖尚待接线验收" };
type Metric = MetricValue | DerivedMoneyPerCountV1;

function Value({ metric }: { metric: Metric }) {
  return <span className="sp-value" data-status={metric.status} title={metric.reasonCode ? reasonLabels[metric.reasonCode] ?? metric.reasonCode : undefined}>{metric.unit === "CNY_CENT_PER_COUNT" ? formatDerivedMoneyPerCount(metric) : formatMetric(metric)}{metric.status !== "available" && <small>{metric.status === "partial" ? "已覆盖范围 · " : ""}{reasonLabels[metric.reasonCode ?? ""] ?? metric.reasonCode}</small>}</span>;
}
function MetricCard({ label, metric, previous, yearAgo, baseline, change, props, onSelect }: {
  label: string; metric: Metric; previous?: MetricComparison; yearAgo?: MetricComparison; baseline?: Metric; change?: MetricValue; props?: NetshopColumnProps; onSelect?: () => void;
}) {
  const display = metric.unit === "CNY_CENT_PER_COUNT" ? <InsightDerivedMoneyMetric label={label} metric={metric}/> : <InsightMetric label={label} metric={metric}/>;
  return <article className="sp-kpi">{onSelect ? <button type="button" className="sp-kpi-button" aria-label={`${label}，定位对应章节`} onClick={onSelect}>{display}</button> : display}<div className="sp-compare">
    {baseline && props?.context.previous && <span>环比基期 <Value metric={baseline}/></span>}
    {previous && props?.context.previous && <span data-direction={previous.value === null || previous.value === 0 ? "neutral" : previous.value > 0 ? "up" : "down"}>环比 <InsightComparison value={previous}/></span>}
    {yearAgo && props?.context.yearAgo && <span data-direction={yearAgo.value === null || yearAgo.value === 0 ? "neutral" : yearAgo.value > 0 ? "up" : "down"}>同比 <InsightComparison value={yearAgo}/></span>}
    {change && props?.context.previous && <span>差额 <Value metric={change}/></span>}
  </div></article>;
}
function SourceIssue<T>({ source, label, onRetry }: { source: PanoramaSource<T>; label: string; onRetry: () => void }) {
  if (source.state === "ready") return null;
  return <div className="sp-gap" data-state={source.state} role={source.state === "error" ? "alert" : "status"}><strong>{label}：{source.state === "error" ? "读取失败" : source.reasonCode === "dependency_pending" ? "待接线验收" : "当前范围不可用"}</strong><p>{source.message}</p>{source.state === "error" && <button type="button" onClick={onRetry}>重新读取</button>}</div>;
}
function Gaps({ capabilities, ids }: { capabilities: PanoramaCapability[]; ids?: readonly string[] }) {
  const values = capabilities.filter(capability => capability.status === "unavailable" && (!ids || ids.includes(capability.id)));
  return values.length ? <div className="sp-ability-list">{values.map(capability => <div className="sp-gap" key={capability.id} role="status"><strong>{capabilityLabels[capability.id] ?? capability.id}</strong><p>{capability.message}</p></div>)}</div> : null;
}
function Chapter({ id, data, note, tools, children }: { id: PanoramaSectionKey; data: StorePanoramaResponse; note: string; tools?: ReactNode; children: ReactNode }) {
  const chapter = panoramaChapters.find(([key]) => key === id)!;
  return <section id={`panorama-${id}`} className="sp-chapter" data-section-state={data.sections[id].state} aria-labelledby={`panorama-heading-${id}`}><header className="sp-section-head"><div><h2 id={`panorama-heading-${id}`}><span>{chapter[1]}</span>{chapter[2]}</h2><p className="sp-caption">{note}</p></div>{tools && <div className="sp-section-tools">{tools}</div>}</header>{children}</section>;
}
function Bars({ rows }: { rows: Array<{ label: string; share: MetricValue; payment: MetricValue }> }) {
  return <div className="sp-bars">{rows.map((row, index) => <div key={`${row.label}:${index}`}><div className="sp-bar-label"><span>{row.label}</span><span><Value metric={row.payment}/> · <Value metric={row.share}/></span></div>{row.share.status === "available" && row.share.value !== null && <div className="sp-bar-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(1, row.share.value)) * 100}%` }}/></div>}</div>)}</div>;
}
function SeriesChart({ dto, period, metricKey, onDate }: { dto: ProductScopeSeries; period: PanoramaSeriesPeriod; metricKey: ProductSeriesColumnKey; onDate: (period: PanoramaSeriesPeriod, start: string, end: string) => void }) {
  const points = useMemo(() => panoramaSeriesChartPoints(dto, period, metricKey), [dto, period, metricKey]);
  const window = dto.context.periods[period];
  return <div className="sp-box sp-chart promotion-insights"><h3>{panoramaSeriesPeriodLabels[period]} · {panoramaSeriesColumnLabels[metricKey]}</h3><p className="sp-caption">实际范围 {window.startDate} — {window.endDate} · {window.days} 天 · {points.length} 个来源日期桶</p>{points.some(point => point.values[0].status === "available") ? <MetricTrend key={`${period}:${metricKey}`} labels={[panoramaSeriesColumnLabels[metricKey]]} points={points} onSelect={(start, end) => onDate(period, start, end)}/> : <p className="sp-gap" role="status">该期所选指标没有完整可用日期点。请查看明细的覆盖与字段状态。</p>}</div>;
}
function PlatformSeries({ dto, kind, props }: { dto: ProductScopeSeries; kind: "performance" | "traffic"; props: NetshopColumnProps }) {
  const choices: readonly ProductSeriesColumnKey[] = kind === "performance" ? ["payment", "quantity", "refundPayment", "transactionOrders", "orderPayment"] : ["visitors", "pageViews", "customers", "conversion", "addCartRate", "visitorValue", "favorites", "addCartCustomers", "addCartQuantity", "orderCustomers", "orderQuantity", "searchImpressions", "searchClicks", "searchClickRate", "searchVisitors", "searchCustomers"];
  const [metricKey, setMetricKey] = useState<ProductSeriesColumnKey>(kind === "performance" ? "payment" : "visitors");
  const [baseline, setBaseline] = useState<PanoramaSeriesPeriod>("previous");
  const [detailPeriod, setDetailPeriod] = useState<PanoramaSeriesPeriod>("current");
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<{ period: PanoramaSeriesPeriod; date: string; endDate: string } | null>(null);
  const periods: PanoramaSeriesPeriod[] = ["current", ...(props.context.previous ? ["previous" as const] : []), ...(props.context.yearAgo ? ["yearAgo" as const] : [])];
  const shownBaseline = periods.includes(baseline) && baseline !== "current" ? baseline : periods[1];
  const shownDetail = periods.includes(detailPeriod) ? detailPeriod : "current";
  const columns = useMemo(() => {
    const core: ProductSeriesColumnKey[] = kind === "performance" ? ["payment", "quantity", "refundPayment", "visitors", "customers", "conversion", "visitorValue"] : ["visitors", "pageViews", "customers", "conversion", "favorites", "addCartCustomers", "orderPayment"];
    return expanded ? [...productSeriesColumns] : [...new Set([...core, metricKey])];
  }, [expanded, kind, metricKey]);
  const rows = useMemo(() => panoramaSeriesRows(dto, shownDetail, columns, metricKey), [dto, shownDetail, columns, metricKey]);
  const rowId = useCallback((period: PanoramaSeriesPeriod, date: string) => `panorama-${kind}-series-${period}-${date}`, [kind]);
  const onDate = (period: PanoramaSeriesPeriod, date: string, endDate: string) => { setDetailPeriod(period); setFocus({ period, date, endDate }); };
  useEffect(() => { if (focus && focus.period === shownDetail) document.getElementById(rowId(focus.period, focus.date))?.scrollIntoView({ block: "center", behavior: "instant" }); }, [focus, shownDetail, rowId]);
  const window = dto.context.periods[shownDetail];
  return <div className="sp-source-group sp-platform-series" aria-label={kind === "performance" ? "平台经营完整日期序列" : "平台流量完整日期序列"}>
    <div className="sp-series-tools"><h3>{kind === "performance" ? "平台经营趋势与明细" : "平台流量趋势与明细"}</h3><label className="sp-filter">观察指标<select aria-label={kind === "performance" ? "平台趋势观察指标" : "流量趋势观察指标"} value={metricKey} onChange={event => setMetricKey(event.target.value as ProductSeriesColumnKey)}>{choices.map(key => <option key={key} value={key}>{panoramaSeriesColumnLabels[key]}</option>)}</select></label>{periods.length > 1 && <label className="sp-filter">独立基期曲线<select aria-label={kind === "performance" ? "平台趋势基期" : "流量趋势基期"} value={shownBaseline} onChange={event => setBaseline(event.target.value as PanoramaSeriesPeriod)}>{periods.filter(period => period !== "current").map(period => <option key={period} value={period}>{panoramaSeriesPeriodLabels[period]}</option>)}</select></label>}</div>
    <p className="sp-caption">{dto.grain === "day" ? "逐日" : dto.grain === "week" ? "周一开始的自然周，首尾按所选范围截段" : "自然月，首尾按所选范围截段"}；各期使用实际独立日期轴，点选日期定位同来源明细。周/月比率使用拥有者返回的合计分子与分母。</p>
    <div className={`sp-series-charts${shownBaseline ? "" : " sp-series-charts-single"}`}><SeriesChart dto={dto} period="current" metricKey={metricKey} onDate={onDate}/>{shownBaseline && <SeriesChart dto={dto} period={shownBaseline} metricKey={metricKey} onDate={onDate}/>}</div>
    <div className="sp-series-tools"><h3>{panoramaSeriesPeriodLabels[shownDetail]}平台日期明细</h3><div className="sp-series-periods" role="group" aria-label={kind === "performance" ? "平台日期明细期间" : "流量日期明细期间"}>{periods.map(period => <button type="button" key={period} aria-pressed={shownDetail === period} onClick={() => { setDetailPeriod(period); setFocus(null); }}>{panoramaSeriesPeriodLabels[period]}</button>)}</div><label className="sp-checks"><input type="checkbox" checked={expanded} onChange={event => setExpanded(event.target.checked)}/>展开全部21项来源指标</label></div>
    <p className="sp-caption">实际明细范围 {window.startDate} — {window.endDate} · {rows.length} 个完整来源日期桶 · 覆盖列对应“{panoramaSeriesColumnLabels[metricKey]}”。搜索和商品翻页不改变本序列。</p>
    {focus?.period === shownDetail && <p className="sp-note" role="status">已定位{panoramaSeriesPeriodLabels[shownDetail]} {focus.date}{focus.endDate !== focus.date ? ` — ${focus.endDate}` : ""}。</p>}
    <div className="sp-table-wrap sp-series-table-wrap"><table className="sp-table sp-series-table"><thead><tr><th>来源日期 / 截段</th>{columns.map(key => <th key={key} className="sp-number">{panoramaSeriesColumnLabels[key]}</th>)}<th>所选指标字段覆盖</th>{shownDetail === "current" && dto.grain === "day" && props.context.previous && <th>实际环比对应日</th>}{shownDetail === "current" && dto.grain === "day" && props.context.yearAgo && <th>实际同比对应日</th>}</tr></thead><tbody>{rows.map(row => <tr id={rowId(shownDetail, row.date)} key={row.date} data-focused={focus?.period === shownDetail && focus.date === row.date}><td><button type="button" className="sp-link" onClick={() => onDate(shownDetail, row.date, row.endDate)}>{row.date}{row.endDate !== row.date ? ` — ${row.endDate}` : ""}</button></td>{row.metrics.map(({ key, metric }) => <td key={key} className="sp-number"><Value metric={metric}/></td>)}<td><details><summary>{row.coverage.coveredShopDatePairs} / {row.coverage.expectedShopDatePairs} 店日{row.coverage.complete ? "，完整" : "，不足"}</summary><p className="sp-caption">字段：{row.coverage.fields.map(field => panoramaSeriesColumnLabels[field as ProductSeriesColumnKey] ?? field).join("、")}</p>{row.coverage.missingByShop.map(shop => <p key={shop.shopKey} className="sp-caption">{shop.shopKey.replace("\u001f", " · ")} · 缺日 {shop.dates.join("、")}</p>)}</details></td>{shownDetail === "current" && dto.grain === "day" && props.context.previous && <td>{row.calendar?.previous ?? "没有可比对应日"}</td>}{shownDetail === "current" && dto.grain === "day" && props.context.yearAgo && <td>{row.calendar?.yearAgo ?? "没有可比对应日"}</td>}</tr>)}</tbody></table></div>
  </div>;
}
function ProductTable({ data, props, onSelect }: { data: ProductInsightsResponse; props: NetshopColumnProps; onSelect: (row: ProductRow) => void }) {
  const [draft, setDraft] = useState({ q: props.context.q, value: props.context.q });
  const [searchError, setSearchError] = useState("");
  const value = draft.q === props.context.q ? draft.value : props.context.q;
  const pagination = data.sections.pagination, pages = panoramaPageButtons(pagination.page, pagination.total, pagination.pageSize);
  const rows: ProductRow[] = data.sections.items;
  const search = () => { try { props.onContextChange(panoramaSearchChange(value)); setSearchError(""); } catch (error) { setSearchError(error instanceof Error ? error.message : "搜索内容无效"); } };
  return <>
    <div className="sp-search-toolbar"><form onSubmit={event => { event.preventDefault(); search(); }}><label htmlFor="panorama-product-search">搜索商品 ID / 标题名称</label><div className="sp-search-controls"><input id="panorama-product-search" data-panorama-focus="search" aria-invalid={!!searchError} aria-label="搜索商品ID或标题名称" value={value} maxLength={120} placeholder="输入精确 ID 或标题名称" onChange={event => { setSearchError(""); setDraft({ q: props.context.q, value: event.target.value }); }}/><button className="sp-primary" type="submit">搜索</button><button type="button" onClick={() => { setSearchError(""); setDraft({ q: "", value: "" }); props.onContextChange(panoramaSearchChange("")); }}>清空</button></div>{searchError && <p className="sp-caption" role="alert">{searchError}</p>}</form><p className="sp-caption">服务端搜索仅过滤商品表；全店经营汇总保持不变。</p></div>
    <div className="sp-table-wrap"><table className="sp-table"><thead><tr><th>图片 / 商品 / 精确 ID</th><th>来源类目标签</th><th className="sp-number">平台成交</th><th className="sp-number">件数</th><th className="sp-number">访客累计</th><th className="sp-number">累计转化</th><th className="sp-number">变化金额</th><th className="sp-number">环比</th><th className="sp-number">平台退款</th><th>推广 / ERP / 覆盖</th></tr></thead><tbody>{rows.map(row => <tr key={JSON.stringify(row.identity)}><td><div className="sp-product-cell"><ProductPicture title={row.title} url={row.imageUrl} imageStatus={row.imageStatus}/><div><button type="button" className="sp-link" onClick={() => onSelect(row)}>{row.title}</button><small>{row.identity.platform} · {row.identity.shopName}</small><small>{row.identity.dimension.toUpperCase()} · {row.identity.id}</small></div></div></td><td>{row.category ?? "来源未提供"}<small>{row.categoryEvidence?.status === "verified_id" ? "有版本分类" : "来源标签；非统一类目字典"}</small></td><td className="sp-number"><Value metric={row.metrics.payment}/></td><td className="sp-number"><Value metric={row.metrics.quantity}/></td><td className="sp-number"><Value metric={row.metrics.visitors}/></td><td className="sp-number"><Value metric={row.metrics.conversion}/></td><td className="sp-number">{row.paymentDelta ? <Value metric={row.paymentDelta}/> : <span className="sp-caption">详情核验</span>}</td><td className="sp-number">{props.context.previous ? <InsightComparison value={row.comparisons.payment.previous}/> : "已关闭"}</td><td className="sp-number"><Value metric={row.metrics.refundPayment}/></td><td><button type="button" className="sp-link" onClick={() => onSelect(row)}>详情核验关联</button><small>{row.metrics.payment.status === "available" ? "本期成交字段完整" : "本期成交字段受限"}</small></td></tr>)}</tbody></table>{data.sections.items.length === 0 && <p className="sp-empty" role="status">{pagination.total > 0 ? "当前页没有商品，请调整页码。" : data.tableScope.q ? "没有匹配当前ID或标题名称的商品。" : "当前范围没有商品记录。"}</p>}</div>
    <footer className="sp-pagination" aria-label="重点商品底部分页"><span>第 {pagination.page} / {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} 页 · 共 {pagination.total} 条 · 本页 {pagination.returned} 条明细</span><label>每页<select aria-label="全景商品每页条数" data-panorama-focus="pageSize" value={pagination.pageSize} onChange={event => props.onContextChange(panoramaPageSizeChange(Number(event.target.value)))}>{panoramaPageSizes.map(size => <option key={size} value={size}>{size} 条</option>)}</select></label>{Math.ceil(pagination.total / pagination.pageSize) > 10000 && <p className="sp-caption">超出可浏览页数上限，请缩小商品搜索范围。</p>}<div className="sp-page-buttons"><button type="button" disabled={pagination.page <= 1} onClick={() => props.onContextChange({ page: pagination.page - 1, section: "products" })}>上一页</button>{pages.map((page, index) => page === null ? <span key={`gap-${index}`} aria-hidden="true">…</span> : <button type="button" key={page} aria-label={`商品第${page}页`} aria-current={page === pagination.page ? "page" : undefined} onClick={() => props.onContextChange({ page, section: "products" })}>{page}</button>)}<button type="button" disabled={!pagination.hasMore || pagination.page >= 10000} onClick={() => props.onContextChange({ page: pagination.page + 1, section: "products" })}>下一页</button></div></footer>
  </>;
}
function ProductChanges({ products, props, onSelect }: { products: ProductInsightsResponse; props: NetshopColumnProps; onSelect: (row: ProductRow) => void }) {
  const { structure, growth } = products.sections;
  const rows: ProductRow[] = growth.state === "ready" ? growth.data.items : [];
  return <div className="sp-pair"><div className="sp-box"><h3>全集配对后的商品变化</h3><dl className="sp-fact-list">{(["pairedCurrentPayment", "pairedPreviousPayment", "growthPayment", "declinePayment", "netChange"] as const).map((key, index) => <div key={key}><dt>{["可比本期成交", "可比环比基期成交", "正向增长贡献", "负向下降贡献", "可比净变化"][index]}</dt><dd><Value metric={structure.changes[key]}/></dd></div>)}</dl><p className="sp-caption">已配对 {structure.qualification.paired} 个；覆盖不足 {structure.qualification.incomplete} 个。完整两期集合先配对，再排序分页。</p></div><div className="sp-box"><h3>商品变化明细</h3>{growth.state === "ready" ? <><dl className="sp-fact-list">{rows.map(row => <div key={JSON.stringify(row.identity)}><dt><button type="button" className="sp-link" onClick={() => onSelect(row)}>{row.title}</button></dt><dd>{row.paymentDelta ? <Value metric={row.paymentDelta}/> : <InsightComparison value={row.comparisons.payment.previous}/>}</dd></div>)}</dl><p className="sp-caption">当前返回 {growth.data.pagination.returned} / {growth.data.pagination.total} 条；进入商品专题查看完整排行。</p><button type="button" onClick={() => props.onDrill("products", null, "")}>进入同店商品表现</button></> : <div className="sp-gap" role="status"><strong>商品比较读取失败</strong><p>{growth.message}</p></div>}</div></div>;
}
function PanoramaSections({ data, props, onRetry, onChapter, onSavePosition }: { data: StorePanoramaResponse; props: NetshopColumnProps; onRetry: () => void; onChapter: (id: PanoramaSectionKey) => void; onSavePosition: () => void }) {
  const products = data.sources.products.state === "ready" ? data.sources.products.data : null;
  const productSeries = data.sources.productSeries.state === "ready" ? data.sources.productSeries.data : null;
  const promotion = data.sources.promotion.state === "ready" ? data.sources.promotion.data : null;
  const sales = data.sources.sales.state === "ready" ? data.sources.sales.data : null;
  const finance = data.sources.finance.state === "ready" ? data.sources.finance.data : null;
  const workflow = data.sources.workflow.state === "ready" ? data.sources.workflow.data : null;
  const [focus, setFocus] = useState<{ start: string; end: string } | null>(null);
  const drillProduct = (row: ProductRow) => { onSavePosition(); props.onDrill("products", row.identity, "overview"); };
  const drillPromotion = () => { onSavePosition(); props.onDrill("promotion", null, "overview"); };
  const focusDate = (start: string, end: string) => { setFocus({ start, end }); document.getElementById(`panorama-promotion-day-${start}`)?.scrollIntoView({ block: "center", behavior: "instant" }); };
  const drillPromotionDate = (startDate: string, endDate: string) => {
    onSavePosition();
    // The shell records the original S query/page before changing A-only
    // preferences. Both callbacks read the canonical current shell location.
    props.onDrill("promotion", null, "products");
    props.onContextChange({ promotionPrefs: { schemaVersion: "promotion-ui-v1", sort: "spend_desc", objectDateFocus: { startDate, endDate } } });
  };
  const platformBaseline = products?.sections.baselineReads.previous.state === "ready" ? products.sections.baselineReads.previous.data : null;
  return <>
    <Chapter id="performance" data={data} note="平台成交、ERP净额与广告归因分别展示；实际基期依照当前日期规则。">
      <SourceIssue source={data.sources.products} label={sourceLabels.products} onRetry={onRetry}/>
      {products && <><div className="sp-kpis">{(["payment", "quantity", "visitors", "refundPayment"] as const).map((key, index) => <MetricCard key={key} label={["平台成交", "平台成交件数", "商品访客累计", "平台退款金额"][index]} metric={products.sections.summary[key]} baseline={platformBaseline?.[key]} previous={products.sections.comparisons[key].previous} yearAgo={products.sections.comparisons[key].yearAgo} props={props} onSelect={() => onChapter(key === "visitors" ? "traffic" : key === "refundPayment" ? "margin" : "products")}/>)}</div><p className="sp-caption">平台金额来自商品×日经营源；访客为商品×日累计。搜索、分页不改变这些汇总。</p></>}
      <div className="sp-source-group"><h3>ERP净销售与毛利</h3><SourceIssue source={data.sources.sales} label={sourceLabels.sales} onRetry={onRetry}/>{sales && <div className="sp-kpis">{(["netSales", "netQuantity", "orders", "orderAverageValue", "orderMargin", "largeMarginRate"] as const).map((key, index) => <MetricCard key={key} label={["ERP净销售", "ERP净件数", "去重订单数", "订单客单价", "订单毛利", "大毛利率"][index]} metric={sales.periods.current.metrics[key]} baseline={sales.periods.previous.metrics[key]} previous={sales.comparisons[key].previous} yearAgo={sales.comparisons[key].yearAgo} props={props} onSelect={() => onChapter("margin")}/>)}</div>}</div>
      <Gaps capabilities={data.sections.performance.capabilities} ids={["orders", "order_average_value"]}/>
      <div className="sp-source-group"><h3>推广经营</h3><SourceIssue source={data.sources.promotion} label={sourceLabels.promotion} onRetry={onRetry}/>{promotion && <div className="sp-kpis">{(["spend", "attributedPayment", "roas", "spendRate"] as const).map((key, index) => <MetricCard key={key} label={["推广花费", "广告归因成交", "ROAS", "推广费率"][index]} metric={promotion.sections.summary[key]} previous={promotion.sections.comparisons[key].previous} yearAgo={promotion.sections.comparisons[key].yearAgo} props={props} onSelect={() => onChapter("promotion")}/>)}</div>}</div>
      {products && <ProductChanges products={products} props={props} onSelect={drillProduct}/>}
      <div className="sp-source-group"><SourceIssue source={data.sources.productSeries} label={sourceLabels.productSeries} onRetry={onRetry}/>{productSeries && <PlatformSeries dto={productSeries} kind="performance" props={props}/>}</div>
    </Chapter>
    <Chapter id="traffic" data={data} note="各累计指标依照来源原定义，不把下列数值作为同一批用户的旅程漏斗。">
      <SourceIssue source={data.sources.products} label={sourceLabels.products} onRetry={onRetry}/>
      {products && <><div className="sp-kpis">{(["pageViews", "favorites", "addCartCustomers", "addCartQuantity", "orderCustomers", "orderQuantity", "orderPayment", "transactionOrders"] as const).map((key, index) => <MetricCard key={key} label={["商品浏览累计", "收藏累计", "加购客户累计", "加购件数", "下单客户累计", "下单件数", "下单金额", "平台成交订单指标"][index]} metric={products.sections.efficiency.metrics[key]}/>)}{(["visitors", "customers", "conversion", "addCartRate"] as const).map((key, index) => <MetricCard key={key} label={["商品访客累计", "成交客户累计", "商品累计转化率", "加购客户率"][index]} metric={products.sections.summary[key]} previous={products.sections.comparisons[key].previous} yearAgo={products.sections.comparisons[key].yearAgo} props={props}/>)}<MetricCard label="商品访客价值" metric={products.sections.efficiency.visitorValue} previous={products.sections.efficiency.visitorValueComparisons.previous} yearAgo={products.sections.efficiency.visitorValueComparisons.yearAgo} props={props}/></div>
        <div className="sp-source-group"><h3>来源支持的搜索经营指标</h3><div className="sp-kpis">{(["searchImpressions", "searchClicks", "searchClickRate", "searchVisitors", "searchCustomers"] as const).map((key, index) => <MetricCard key={key} label={["搜索曝光", "搜索点击", "搜索点击率", "搜索访客累计", "搜索成交客户累计"][index]} metric={products.sections.efficiency.metrics[key]}/>)}</div></div>
        <div className="sp-source-group"><h3>高访客低成交关注商品</h3><p className="sp-caption">规则 {products.sections.efficiency.rules.id}：访客累计不少于 {products.sections.efficiency.rules.minimumVisitors}、转化低于 {(products.sections.efficiency.rules.maximumConversion * 100).toFixed(2)}%，{products.sections.efficiency.rules.requireComplete ? "要求完整覆盖" : "依照来源规则"}。扫描 {products.sections.efficiency.scanned} 条、符合 {products.sections.efficiency.qualified} 条；非自动经营建议。</p><dl className="sp-fact-list">{products.sections.efficiency.watchlist.map(row => <div key={JSON.stringify(row.identity)}><dt><button type="button" className="sp-link" onClick={() => drillProduct(row)}>{row.title}</button></dt><dd><Value metric={row.metrics.visitors}/> · <Value metric={row.metrics.conversion}/></dd></div>)}</dl>{!products.sections.efficiency.watchlist.length && <p className="sp-caption">当前来源没有返回符合规则的关注商品。</p>}</div>
      </>}
      <Gaps capabilities={data.sections.traffic.capabilities} ids={["stay_time", "bounce_rate"]}/>
      <div className="sp-source-group"><SourceIssue source={data.sources.productSeries} label={sourceLabels.productSeries} onRetry={onRetry}/>{productSeries && <PlatformSeries dto={productSeries} kind="traffic" props={props}/>}</div>
    </Chapter>
    <Chapter id="products" data={data} note="结构与集中度使用完整商品集合，当前图片、映射和库存须按各自快照核验。" tools={<button type="button" onClick={() => { onSavePosition(); props.onDrill("products", null, ""); }}>进入同店商品表现 →</button>}>
      <SourceIssue source={data.sources.products} label={sourceLabels.products} onRetry={onRetry}/>
      {products && <><div className="sp-kpis"><MetricCard label="本期有数据商品" metric={products.sections.counts.dataProducts}/><MetricCard label="本期成交商品" metric={products.sections.counts.tradedProducts}/><MetricCard label="TOP5成交占比" metric={products.sections.structure.top5Share}/><MetricCard label="TOP10成交占比" metric={products.sections.structure.top10Share}/></div><div className="sp-pair"><div className="sp-box"><h3>来源类目标签贡献</h3><Bars rows={products.sections.structure.categories}/><p className="sp-caption">{products.sections.structure.categoryBasis === "verified_historical" ? "来源有已核验历史分类关系。" : "按来源类目标签分组；未建立统一分类字典或历史类目关系。"}</p></div><div className="sp-box"><h3>两期成交结构</h3><dl className="sp-fact-list">{(["continuous", "newlyTraded", "noLongerTraded", "unknownBaseline"] as const).map((key, index) => <div key={key}><dt>{["持续成交", "新增成交", "不再成交", "基期未知"][index]}</dt><dd><Value metric={products.sections.structure.classification[key]}/></dd></div>)}</dl><p className="sp-caption">“新增成交”仅说明可靠两期记录的变化，不代表新品；库存与在售状态不是历史经营依据。</p></div></div><ProductTable data={products} props={props} onSelect={drillProduct}/></>}
      <Gaps capabilities={data.sections.products.capabilities} ids={["inventory"]}/>
    </Chapter>
    <Chapter id="promotion" data={data} note="复用推广专题完整口径；京东SKU推广与全景SPU商品范围保持独立，ROAS表示归因成交/花费倍数。" tools={<button type="button" onClick={drillPromotion}>进入同店同周期推广专题 →</button>}>
      <SourceIssue source={data.sources.promotion} label={sourceLabels.promotion} onRetry={onRetry}/>
      {promotion && <><div className="sp-kpis">{(["spend", "attributedPayment", "roas", "cpc", "spendRate", "impressions", "clicks", "ctr"] as const).map((key, index) => <MetricCard key={key} label={["推广花费", "广告归因成交", "ROAS", "每次点击成本", "推广费率", "广告曝光", "广告点击", "广告点击率"][index]} metric={promotion.sections.summary[key]} previous={promotion.sections.comparisons[key].previous} yearAgo={promotion.sections.comparisons[key].yearAgo} props={props} change={key === "spend" || key === "attributedPayment" ? promotion.sections.changes[key].previous : undefined}/>)}</div><p className="sp-caption">{promotion.sections.attribution.amountDefinition === "jd_total_order_amount" ? "京东归因总订单金额" : "天猫归因净成交金额"}；{promotion.sections.attribution.orderDefinition === "jd_order_lines" ? "订单指标为归因订单行" : "订单指标为归因净成交笔数"}。归因窗口：{promotion.sections.attribution.window ?? "来源未核验"}；不据此拆出自然成交或推断增量利润。</p>
        <div className="sp-pair"><div className="sp-box sp-chart promotion-insights"><h3>花费与广告归因成交趋势</h3><MetricTrend labels={["推广花费（元）", "广告归因成交（元）"]} points={promotion.sections.trend.items.map(point => ({ startDate: point.startDate, endDate: point.endDate, values: [point.metrics.spend, point.metrics.attributedPayment] }))} onSelect={(start, end) => focusDate(start, end)}/></div><div className="sp-box"><h3>推广商品投入分布</h3><Bars rows={promotion.sections.items.map(item => ({ label: `${item.title} · ${item.id ?? "来源未提供ID"}`, share: item.spendShare, payment: item.metrics.spend }))}/><p className="sp-caption">当前返回 {promotion.sections.pagination.returned} / {promotion.sections.pagination.total} 个对象；占比由推广服务使用完整集合计算，当前条目不是全部投入分布。</p><button type="button" onClick={drillPromotion}>查看完整推广对象</button></div></div>
        <div className="sp-source-group"><h3>推广日期明细</h3>{focus && <div className="sp-note" role="status"><p>已定位 {focus.start} — {focus.end}。全店整期汇总保持原范围。</p><button type="button" onClick={() => drillPromotionDate(focus.start, focus.end)}>查看这一日期的同店推广对象 →</button></div>}<div className="sp-table-wrap"><table className="sp-table"><thead><tr><th>来源日期</th><th className="sp-number">花费</th><th className="sp-number">广告归因成交</th><th className="sp-number">ROAS</th><th className="sp-number">点击成本</th><th>覆盖</th></tr></thead><tbody>{promotion.sections.trend.items.map(point => <tr id={`panorama-promotion-day-${point.startDate}`} key={point.startDate} data-focused={point.startDate === focus?.start && point.endDate === focus?.end}><td><button type="button" className="sp-link" onClick={() => focusDate(point.startDate, point.endDate)}>{point.startDate}{point.endDate !== point.startDate ? ` — ${point.endDate}` : ""}</button></td><td className="sp-number"><Value metric={point.metrics.spend}/></td><td className="sp-number"><Value metric={point.metrics.attributedPayment}/></td><td className="sp-number"><Value metric={point.metrics.roas}/></td><td className="sp-number"><Value metric={point.metrics.cpc}/></td><td>{promotion.sections.coverage[point.coverageRef]?.complete ? "完整" : "覆盖不足"}</td></tr>)}</tbody></table></div></div>
        {promotion.sections.matchedRange && <div className="sp-note"><strong>独立辅助匹配范围：{promotion.sections.matchedRange.scopeLabel}</strong><p>花费 <Value metric={promotion.sections.matchedRange.metrics.spend}/> · 平台成交 <Value metric={promotion.sections.matchedRange.metrics.payment}/> · 辅助费率 <Value metric={promotion.sections.matchedRange.metrics.spendRate}/></p><p className="sp-caption">仅属于已匹配店日子集，不能替换上方整期推广费率。</p></div>}
      </>}
    </Chapter>
    <Chapter id="margin" data={data} note="订单毛利与大毛利率使用ERP领域原算法；平台退款与ERP退货分口径，不称净利润。" tools={<><button type="button" onClick={() => props.onNavigate("sales")}>原销售分析 →</button><button type="button" onClick={() => props.onNavigate("product")}>原商品经营 →</button></>}>
      <SourceIssue source={data.sources.sales} label={sourceLabels.sales} onRetry={onRetry}/>
      {sales && <><div className="sp-kpis">{(["netSales", "cost", "orderMargin", "largeMargin", "largeMarginRate", "returnAmount", "returnQuantity", "positiveQuantity"] as const).map((key, index) => <MetricCard key={key} label={["ERP净销售", "ERP成本", "订单毛利", "大毛利", "大毛利率", "ERP退货金额", "ERP退货件数", "ERP正向件数"][index]} metric={sales.periods.current.metrics[key]} baseline={sales.periods.previous.metrics[key]} previous={sales.comparisons[key].previous} yearAgo={sales.comparisons[key].yearAgo} props={props}/>)}</div><div className="sp-source-group sp-chart promotion-insights"><h3>ERP净销售与订单毛利趋势</h3><MetricTrend labels={["ERP净销售（元）", "订单毛利（元）"]} points={sales.daily.map(point => ({ startDate: point.date, endDate: point.date, values: [point.metrics.netSales, point.metrics.orderMargin] }))}/></div><div className="sp-source-group"><h3>ERP贡献明细</h3><div className="sp-table-wrap"><table className="sp-table"><thead><tr><th>ERP商品 / 来源身份</th><th>ERP类目</th><th className="sp-number">净销售</th><th className="sp-number">成本</th><th className="sp-number">订单毛利</th><th className="sp-number">大毛利率</th><th className="sp-number">退货金额</th></tr></thead><tbody>{sales.items.map(item => <tr key={item.id}><td>{item.title}<small>{item.id}</small></td><td>{item.category ?? "来源未提供"}</td>{(["netSales", "cost", "orderMargin", "largeMarginRate", "returnAmount"] as const).map(key => <td key={key} className="sp-number"><Value metric={item.metrics[key]}/></td>)}</tr>)}</tbody></table></div><p className="sp-caption">ERP来源当前返回 {sales.pagination.returned} / {sales.pagination.total} 条，不按商品名称自动关联平台身份。完整排行在原销售/商品经营入口查看。</p></div></>}
      {products && <div className="sp-source-group"><h3>平台退款单列</h3><div className="sp-kpis"><MetricCard label="平台退款金额" metric={products.sections.summary.refundPayment} previous={products.sections.comparisons.refundPayment.previous} yearAgo={products.sections.comparisons.refundPayment.yearAgo} props={props}/></div></div>}
      <Gaps capabilities={data.sections.margin.capabilities} ids={["contribution"]}/>
    </Chapter>
    <Chapter id="customers" data={data} note="商品客户累计沿用原口径；企业购与客户去重需独立的可靠来源和历史证据。">
      <SourceIssue source={data.sources.products} label={sourceLabels.products} onRetry={onRetry}/>
      {products && <div className="sp-kpis"><MetricCard label="成交客户累计" metric={products.sections.summary.customers} previous={products.sections.comparisons.customers.previous} yearAgo={products.sections.comparisons.customers.yearAgo} props={props}/><MetricCard label="下单客户累计" metric={products.sections.efficiency.metrics.orderCustomers}/></div>}
      <Gaps capabilities={data.sections.customers.capabilities}/>
      <p className="sp-caption">累计客户不是去重买家；不从商用品类猜测B端客户，也不使用广告点击推算访客或客户。</p>
    </Chapter>
    <Chapter id="targets" data={data} note="只读引用既有年度目标、实际月度财报和经营事件；不自动摊月目标或推断事件因果。" tools={<><button type="button" onClick={() => props.onNavigate("sales")}>原目标与财报 →</button><button type="button" onClick={() => props.onNavigate("workflow")}>原经营记录 →</button></>}>
      <SourceIssue source={data.sources.finance} label={sourceLabels.finance} onRetry={onRetry}/>
      {finance && <><h3>既有年度目标进度</h3><div className="sp-kpis">{finance.annualTargets.map(target => <MetricCard key={target.year} label={`${target.year}年度销售目标进度`} metric={target.progress}/>)}{!finance.annualTargets.length && <p className="sp-caption">当前范围没有返回已设置年度目标。</p>}</div><dl className="sp-fact-list">{finance.annualTargets.map(target => <div key={target.year}><dt>{target.year} 年原目标</dt><dd>目标 <Value metric={target.target}/> · 实际累计 <Value metric={target.actual}/></dd></div>)}</dl><div className="sp-source-group"><h3>实际月份财报</h3><div className="sp-table-wrap"><table className="sp-table sp-source-table"><thead><tr><th>财报月份</th><th className="sp-number">财报营业收入</th><th className="sp-number">财报利润</th></tr></thead><tbody>{finance.months.map(month => <tr key={month.month}><td>{month.month}</td><td className="sp-number"><Value metric={month.revenue}/></td><td className="sp-number"><Value metric={month.profit}/></td></tr>)}</tbody></table></div><p className="sp-caption">按来源实际月份显示，不将月利润分摊为所选日或商品利润。</p></div></>}
      <div className="sp-source-group"><h3>本店经营事件</h3><SourceIssue source={data.sources.workflow} label={sourceLabels.workflow} onRetry={onRetry}/>{workflow && <><ul className="sp-timeline">{workflow.items.map(item => <li key={item.id}><time>{item.occurredAt}</time><strong>{item.title}</strong><span>{item.eventType} · {item.status}</span></li>)}</ul>{!workflow.items.length && <p className="sp-caption">当前来源没有返回本店期间内的记录。</p>}<p className="sp-caption">已读 {workflow.pagination.returned} / {workflow.pagination.total} 条；按事件发生时间筛选，更新记录时间不冒充发生时间。记录与经营变化并列，不作为因果结论。</p></>}</div>
      <Gaps capabilities={data.sections.targets.capabilities} ids={["history"]}/>
    </Chapter>
    <Chapter id="dataQuality" data={data} note="逐来源披露截止日、缺口与可用字段；多源仅核验修订向量，不声称分布式原子快照。" tools={<><button type="button" onClick={() => props.onNavigate("import")}>原导入记录 →</button><button type="button" onClick={() => props.onNavigate("workflow")}>原工作流记录 →</button></>}>
      <div className="sp-table-wrap"><table className="sp-table sp-source-table"><thead><tr><th>来源</th><th>当前读取状态</th><th>截止日 / 期间</th><th>事实口径</th></tr></thead><tbody>{panoramaSourceKeys.map(key => { const source = data.sources[key]; return <tr key={key}><td>{sourceLabels[key]}</td><td>{source.state === "ready" ? "可信读取" : source.state === "error" ? "读取失败" : source.reasonCode === "dependency_pending" ? "待接线验收" : "当前范围不可用"}{source.state !== "ready" && <small>{source.message}</small>}</td><td>{source.state === "ready" ? key === "products" && products ? products.context.freshness.map(item => <small key={item.sourceId}>{item.sourceId}：{item.dataThrough ?? "无可信截止日"}</small>) : key === "productSeries" && productSeries ? productSeries.context.freshness.map(item => <small key={item.sourceId}>{item.sourceId}：{item.dataThrough ?? "无可信截止日"}</small>) : key === "promotion" && promotion ? promotion.context.freshness.map(item => <small key={item.sourceId}>{item.sourceId}：{item.dataThrough ?? "无可信截止日"}</small>) : key === "finance" && finance ? finance.months.map(item => item.month).join("、") || "无财报月份" : `${data.context.periods.current.startDate} — ${data.context.periods.current.endDate}（请求范围，不是完整覆盖证明）` : "—"}</td><td>{sourceDescriptions[key]}</td></tr>; })}</tbody></table></div>
      <div className="sp-source-group"><h3>逐来源店日覆盖</h3>{products && Object.entries(products.context.coverageBySource).map(([key, coverage]) => <InsightSourceCoverage key={`p:${key}`} label={`商品 ${products.context.effectiveScope.dimension.toUpperCase()} · ${key}`} coverage={coverage}/>)}{promotion && Object.entries(promotion.sections.coverage).map(([key, coverage]) => <InsightSourceCoverage key={`a:${key}`} label={`推广 ${promotion.context.effectiveScope.dimension.toUpperCase()} · ${key}`} coverage={coverage}/>)}</div>
      {products && <div className="sp-source-group"><h3>当前档案资料质量</h3><div className="sp-kpis">{(["missingImage", "missingCode", "missingCategory", "conflict", "stale", "unmapped"] as const).map((key, index) => <MetricCard key={key} label={["缺图", "缺编码", "缺类目", "资料冲突", "陈旧资料", "未关联"][index]} metric={products.sections.dataQuality.counts[key]}/>)}</div><p className="sp-caption">当前快照，陈旧规则 {products.sections.dataQuality.staleAfterDays} 天；不能将当前映射回填历史归属。</p></div>}
      <details className="sp-source-details"><summary>八章节字段能力与缺口</summary>{panoramaChapters.map(([id, number, title]) => <div key={id}><h3>{number} {title}</h3><ul>{data.sections[id].capabilities.map(capability => <li key={capability.id}><strong>{capabilityLabels[capability.id] ?? capability.id}：{capability.status === "available" ? "可用" : "当前不可用"}</strong> · {capability.message}</li>)}</ul></div>)}</details>
      <details className="sp-source-details"><summary>来源、映射与比较限制</summary><ul>{data.limitations.map((line, index) => <li key={`all:${index}`}>{line}</li>)}{products?.sections.metadata.limitations.map((line, index) => <li key={`p:${index}`}>{line}</li>)}{productSeries?.limitations.map((line, index) => <li key={`series:${index}`}>{line}</li>)}{promotion?.sections.limitations.map((line, index) => <li key={`a:${index}`}>{line}</li>)}{sales?.limitations.map((line, index) => <li key={`s:${index}`}>{line}</li>)}{finance?.limitations.map((line, index) => <li key={`f:${index}`}>{line}</li>)}{workflow?.limitations.map((line, index) => <li key={`w:${index}`}>{line}</li>)}</ul></details>
      <details className="sp-source-details"><summary>读取版本证据</summary><p className="sp-caption">参与源按领域、种类、范围分别核验；不同种类的令牌不作字符串相等比较。</p><ul>{data.joinedSourceRevisions.map(revision => <li key={JSON.stringify([revision.domain, revision.kind, revision.scopeKey])}>{revision.domain} / {revision.kind} · {revision.scopeKey.replace("\u001f", " · ")} · {revision.revision}</li>)}</ul></details>
    </Chapter>
  </>;
}

function SelectedPanorama({ props, refreshNonce, onChapter }: { props: NetshopColumnProps; refreshNonce: number; onChapter: (id: PanoramaSectionKey) => void }) {
  const query = panoramaQuery(props)!;
  const serialized = query.toString(), principal = panoramaPrincipalKey(props);
  const family = `${panoramaTokenFamily(query, principal)}:${refreshNonce}`;
  const token = useRef<{ family: string; snapshotToken: string; sectionToken: string } | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    const next = new URLSearchParams(serialized);
    if (token.current?.family === family) { next.set("snapshotToken", token.current.snapshotToken); next.set("sectionToken", token.current.sectionToken); }
    try {
      const data = await loadStorePanorama(next, signal);
      if (!signal.aborted) token.current = { family, snapshotToken: data.context.snapshotToken, sectionToken: data.sectionToken };
      return data;
    } catch (error) { if (!signal.aborted) token.current = null; throw error; }
  }, [family, serialized]);
  const read = useScopedRead<StorePanoramaResponse>(`${principal}:${serialized}:${refreshNonce}`, load);
  const positionKey = panoramaScrollStorageKey(props), restored = useRef("");
  const focusScope = panoramaPresentationScope(props), presentationFocus = useRef<{ scope: string; control: string } | null>(null);
  useEffect(() => { restored.current = ""; }, [refreshNonce]);
  useEffect(() => {
    if (!read.data || restored.current === positionKey) return;
    restored.current = positionKey;
    let position: number | null = null;
    try { position = decodePanoramaScroll(sessionStorage.getItem(positionKey)); sessionStorage.removeItem(positionKey); } catch { /* Browser storage is optional, and contains no business results. */ }
    if (position !== null) window.scrollTo({ top: position, behavior: "instant" });
    else if (panoramaChapter(props.context.section) !== "performance") document.getElementById(`panorama-${panoramaChapter(props.context.section)}`)?.scrollIntoView({ block: "start", behavior: "instant" });
    if (presentationFocus.current?.scope === focusScope) {
      const control = presentationFocus.current.control;
      if (control === "search" || control === "pageSize") document.querySelector<HTMLElement>(`[data-panorama-focus="${control}"]`)?.focus({ preventScroll: true });
      presentationFocus.current = null;
    }
  }, [focusScope, positionKey, props.context.section, read.data]);
  const savePosition = () => { try { sessionStorage.setItem(positionKey, String(window.scrollY)); } catch { /* Shared shell still restores the exact scope, query and page. */ } };
  const retry = () => { savePosition(); restored.current = ""; read.refresh(); };
  const contentProps: NetshopColumnProps = { ...props, onContextChange: next => {
    const control = document.activeElement?.getAttribute("data-panorama-focus");
    presentationFocus.current = control ? { scope: focusScope, control } : null;
    props.onContextChange(next);
  } };
  if (!read.data) return <InsightReadState status={read.status} error={read.error} onRetry={retry}/>;
  const periods = read.data.context.periods;
  return <><div className="sp-scope-line" aria-label="来源实际比较日期"><span><strong>本期</strong> {periods.current.startDate} — {periods.current.endDate}</span>{props.context.previous && <span><strong>环比基期</strong> {periods.previous.startDate} — {periods.previous.endDate}</span>}{props.context.yearAgo && <span><strong>同比基期</strong> {periods.yearAgo.startDate} — {periods.yearAgo.endDate}</span>}<span>{periods.rule} · Asia/Shanghai</span></div><PanoramaSections key={`${read.data.context.scopeKey}:${read.data.sectionToken}`} data={read.data} props={contentProps} onRetry={retry} onChapter={onChapter} onSavePosition={savePosition}/></>;
}

/** The shared shell owns global navigation/date history and all drill routes.
 * The selected cockpit supplies only its non-sticky single-shop controls and
 * top chapter navigation. All metrics remain in their owning source envelopes. */
export default function StorePanoramaView(props: NetshopColumnProps) {
  const [dateOpen, setDateOpen] = useState(false), [refreshNonce, setRefreshNonce] = useState(0);
  const principal = panoramaPrincipalKey(props), shop = panoramaShop(props.context);
  const directoryQuery = panoramaDirectoryQuery(props)?.toString() ?? null;
  const directoryEnabled = directoryQuery !== null;
  const directoryScope = `${principal}:${directoryQuery}:${refreshNonce}`;
  const [blocked, setBlocked] = useState<{ scope: string; code: string } | null>(null);
  const loadDirectory = useCallback(async (signal: AbortSignal) => {
    if (!directoryQuery) return null;
    try { const response = await loadPanoramaContext(new URLSearchParams(directoryQuery), signal); if (!signal.aborted) setBlocked(null); return response; }
    catch (error) { if (!signal.aborted && error instanceof InsightReadError && ["unauthenticated", "access_denied", "insights_revision_changed"].includes(error.code)) setBlocked({ scope: directoryScope, code: error.code }); throw error; }
  }, [directoryQuery, directoryScope]);
  const directory = useScopedRead<InsightsContext | null>(`${directoryScope}:${directoryEnabled}`, loadDirectory);
  const shops = [...new Set([...(directory.data?.effectiveScope.shopKeys ?? []), ...props.context.outlets])];
  const activeChapter = panoramaChapter(props.context.section);
  const onChapter = (id: PanoramaSectionKey) => { props.onContextChange({ section: id }); document.getElementById(`panorama-${id}`)?.scrollIntoView({ block: "start", behavior: "instant" }); };
  const refresh = () => {
    if (shop) { try { sessionStorage.setItem(panoramaScrollStorageKey(props), String(window.scrollY)); } catch { /* Only presentation coordinates are stored. */ } }
    setRefreshNonce(value => value + 1);
  };
  const periods = useMemo(() => { try { return resolveNetshopPeriods(props.startDate, props.endDate, props.periodKind); } catch { return null; } }, [props.startDate, props.endDate, props.periodKind]);
  const today = shanghaiIsoToday(), maxDate = props.endDate > today ? props.endDate : today;
  return <div className="netshop-panorama" data-column="panorama">
    <div className="sp-title"><div><h1>店铺全景</h1><p>单店章节驾驶舱 · 来源分组呈现</p></div><div className="sp-toolbar"><button type="button" onClick={() => props.onNavigate("import", props.context.dimension === "sku" ? "jd_sku_daily" : shop?.platform === "天猫" ? "tmall_product_daily" : "jd_spu_daily")}>数据导入记录</button></div></div>
    <InsightFilterBar sticky={false} label="店铺全景经营范围"><div className="sp-filter-row"><label className="sp-filter">平台<select aria-label="全景平台" value={props.context.platforms.length === 1 ? props.context.platforms[0] : shop?.platform ?? ""} onChange={event => props.onContextChange({ platforms: event.target.value ? [event.target.value as "京东" | "天猫"] : [], outlets: [], dimension: "spu", q: "", page: 1, product: null })}><option value="">请选择平台 / 全部授权平台</option><option value="京东">京东</option><option value="天猫">天猫</option></select></label><label className="sp-filter sp-shop-select">店铺<select aria-label="全景平台与店铺" value={shop?.key ?? ""} onChange={event => props.onContextChange(panoramaShopChange(event.target.value))}><option value="">请选择一家授权店铺</option>{shops.map(key => <option key={key} value={key}>{key.replace("\u001f", " · ")}</option>)}</select></label><label className="sp-filter sp-date-selector date-selector">统计期间<button type="button" className="sp-date-trigger" aria-label="选择全景统计期间" aria-expanded={dateOpen} disabled={!props.onApplyPeriod} onClick={() => setDateOpen(value => !value)}>{props.startDate} — {props.endDate}</button>{dateOpen && props.onApplyPeriod && <StatisticalPeriodPicker minDate={`${Number(today.slice(0, 4)) - 1}-01-01`} maxDate={maxDate} startDate={props.startDate} endDate={props.endDate} periodIntent={props.periodKind === "rolling" || props.periodKind === "quarter" ? props.periodKind : undefined} onCancel={() => setDateOpen(false)} onApply={(start, end, intent) => { setDateOpen(false); props.onContextChange({ page: 1, q: "", product: null }); props.onApplyPeriod?.(start, end, intent); }}/>}</label><label className="sp-filter">商品维度<select aria-label="全景商品维度" value={props.context.dimension} onChange={event => props.onContextChange({ dimension: event.target.value as "sku" | "spu", page: 1, product: null })}><option value="spu">SPU</option><option value="sku" disabled={shop?.platform !== "京东"}>京东SKU</option></select></label><label className="sp-filter">平台/推广明细分组<select aria-label="全景序列分组" value={props.context.grain} onChange={event => props.onContextChange(panoramaGrainChange(event.target.value))}><option value="day">逐日</option><option value="week">自然周</option><option value="month">自然月</option></select></label><fieldset className="sp-checks"><legend>比较方式</legend><label><input type="checkbox" checked={props.context.previous} onChange={event => props.onContextChange({ previous: event.target.checked })}/>环比</label><label><input type="checkbox" checked={props.context.yearAgo} onChange={event => props.onContextChange({ yearAgo: event.target.checked })}/>同比</label></fieldset><button type="button" onClick={refresh}>刷新</button></div></InsightFilterBar>
    {!periods && <p className="sp-note" role="status">所选日期或期间规则超出新全景范围；来源读取会报告具体错误。</p>}
    {directory.status === "error" && <p className="sp-note" role="alert">授权店铺目录读取失败：{directory.error}。可重新读取当前范围。</p>}
    <nav className="sp-chapters" aria-label="店铺全景章节导航">{panoramaChapters.map(([id, number, title]) => <button type="button" key={id} aria-current={activeChapter === id ? "true" : undefined} onClick={() => onChapter(id)}><span>{number}</span>{title}</button>)}</nav>
    {blocked?.scope === directoryScope ? <InsightReadState status={blocked.code === "insights_revision_changed" ? "version_changed" : "error"} error={blocked.code === "insights_revision_changed" ? "店铺目录来源版本已变化，当前受保护结果已清除。" : "来源权限失效，当前受保护结果已清除。"} onRetry={() => setRefreshNonce(value => value + 1)}/> : shop ? <SelectedPanorama props={props} refreshNonce={refreshNonce} onChapter={onChapter}/> : <div className="sp-gap" role="status"><strong>请选择一家店铺</strong><p>{!directoryEnabled ? "当前账号有数据范围限制，请先选择目标平台，再选择该平台的授权店铺。" : props.context.outlets.length > 1 ? "店铺全景只分析一家店铺，请在上方选择目标店铺；多店对比可进入店铺与平台对比。" : "先选择明确的平台与店铺，再读取该店经营全景。"}</p>{directory.status === "loading" && <p className="sp-caption">正在读取授权店铺目录…</p>}</div>}
  </div>;
}
